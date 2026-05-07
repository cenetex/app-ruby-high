/**
 * Anki .apkg parser. The .apkg file format is a ZIP archive containing
 * a SQLite database (collection.anki2 or collection.anki21) plus media
 * files. This module extracts the cards as plain front/back records
 * with deck names and note tags; turning them into multiple-choice questions is a separate
 * step (see distractors.ts) that needs an LLM.
 *
 * Pure-JS dependencies (jszip + sql.js) so this works in Node + browser
 * with no native build. wasm SQLite is heavy (~700 KB) but only loads
 * the first time someone imports a deck — the loader is lazy + cached.
 *
 * The pack-store import route uses this parser before turning cards into
 * multiple-choice questions. Tests cover input validation plus a
 * programmatically-built .apkg fixture to verify the round-trip end-to-end.
 */

import JSZip from "jszip";
import initSqlJs from "sql.js";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AnkiCard {
  /** Front face of the card — what the student sees as the prompt. */
  front: string;
  /** Back face — the canonical correct answer. Becomes the MC question's
   *  "correct" option after distractor generation. */
  back: string;
  /** Deck name from the .apkg, e.g. "AP Biology::Cells". Used as the
   *  ContentPack subject so the channels rail can group questions. */
  deckName: string;
  /** Normalized Anki note tags. Tags are a fallback grouping signal when
   *  the deck does not use meaningful subdecks. */
  tags: string[];
  /** Note id from Anki — used as a stable identifier for the resulting
   *  question so re-imports don't shuffle ids. */
  noteId: string;
}

export interface AnkiDeck {
  /** Top-level deck name — the import dialog's "Pack name" suggestion. */
  name: string;
  cards: AnkiCard[];
}

let sqlJsCache: Promise<unknown> | null = null;

async function loadSqlJs() {
  if (!sqlJsCache) {
    const here = dirname(fileURLToPath(import.meta.url));
    // sql.js needs the wasm binary; resolve from node_modules. Multiple
    // candidates because tsup bundles to dist/ and we want the same
    // module to work in src/ too.
    const candidates = [
      resolve(here, "..", "..", "..", "..", "node_modules", "sql.js", "dist"),
      resolve(here, "..", "..", "..", "node_modules", "sql.js", "dist"),
      resolve(here, "..", "..", "node_modules", "sql.js", "dist"),
      resolve(here, "..", "node_modules", "sql.js", "dist"),
    ];
    let dir: string | null = null;
    for (const c of candidates) {
      try {
        await stat(resolve(c, "sql-wasm.wasm"));
        dir = c;
        break;
      } catch { /* not here, keep looking */ }
    }
    sqlJsCache = (initSqlJs as unknown as (opts: unknown) => Promise<unknown>)({
      locateFile: (file: string) => (dir ? resolve(dir, file) : file),
    });
  }
  return sqlJsCache;
}

/** Parse an .apkg byte buffer into a list of cards + the deck name.
 *  Throws if the archive can't be read, the SQLite db is missing, or
 *  the schema doesn't match what Anki ships (notes + cards tables). */
export async function parseApkg(bytes: Uint8Array): Promise<AnkiDeck> {
  const zip = await JSZip.loadAsync(bytes);
  // Modern Anki ships .anki21b (zstd-compressed) or .anki21; older
  // clients ship .anki2. Prefer newer formats, fall back to older.
  const dbCandidates = ["collection.anki21", "collection.anki2"];
  let dbBytes: Uint8Array | null = null;
  for (const name of dbCandidates) {
    const entry = zip.file(name);
    if (entry) {
      dbBytes = await entry.async("uint8array");
      break;
    }
  }
  if (!dbBytes) {
    if (zip.file("collection.anki21b")) {
      throw new Error(
        "This deck uses the newer .anki21b format (zstd-compressed). " +
        "Re-export it from Anki with the 'Legacy support' option enabled, " +
        "or use a deck saved from Anki 2.1.x.",
      );
    }
    throw new Error(
      "No collection.anki2 / .anki21 found in the archive — is this really an Anki .apkg file?",
    );
  }
  return readDeckFromSqlite(dbBytes);
}

/** Convenience: read .apkg from disk. Used by tests and CLI helpers. */
export async function parseApkgFile(path: string): Promise<AnkiDeck> {
  const bytes = await readFile(path);
  return parseApkg(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

interface SqlJsDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}
interface SqlJsModule { Database: new (data: Uint8Array) => SqlJsDatabase }

async function readDeckFromSqlite(dbBytes: Uint8Array): Promise<AnkiDeck> {
  const SQL = (await loadSqlJs()) as SqlJsModule;
  const db = new SQL.Database(dbBytes);
  try {
    // Anki schema: `notes` holds the note content (flds = field 0x1f
    // separated string). `cards` joins notes to decks via did. The deck
    // catalog lives in the `col` table as a JSON blob.
    const decks = readDeckCatalog(db);
    const cards: AnkiCard[] = [];
    const rows = db.exec(
      `SELECT n.id AS noteId, n.flds AS flds, n.tags AS tags, c.did AS did
       FROM cards c JOIN notes n ON c.nid = n.id
       ORDER BY c.id`,
    );
    if (rows.length === 0) {
      // Empty deck — return an empty card list. Caller decides whether
      // that's an error (no questions to play with).
      return { name: pickDeckName(decks) ?? "Untitled Deck", cards: [] };
    }
    for (const row of rows[0]!.values) {
      const noteId = String(row[0]);
      const flds = String(row[1] ?? "");
      const tags = parseTags(String(row[2] ?? ""));
      const did = String(row[3] ?? "");
      const [front, back] = splitFields(flds);
      if (!front || !back) continue; // skip malformed cards
      cards.push({
        front: stripHtml(front),
        back: stripHtml(back),
        deckName: decks.get(did) ?? "default",
        tags,
        noteId,
      });
    }
    return { name: pickDeckName(decks) ?? "Untitled Deck", cards };
  } finally {
    db.close();
  }
}

/** Anki field separator is the ASCII unit-separator char (0x1f). */
function splitFields(flds: string): string[] {
  return flds.split(String.fromCharCode(0x1f));
}

/** Best-effort HTML strip — Anki cards often have minimal markup
 *  (`<br>`, entities). Anything more elaborate (LaTeX, MathJax, audio
 *  refs) goes through unchanged; the LLM gets to read it. */
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseTags(raw: string): string[] {
  if (!raw.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw.trim().split(/\s+/)) {
    const normalized = tag.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function readDeckCatalog(db: SqlJsDatabase): Map<string, string> {
  const out = new Map<string, string>();
  // `col` has a single row; `decks` is a JSON map keyed by deck id.
  const rows = db.exec(`SELECT decks FROM col LIMIT 1`);
  if (rows.length === 0) return out;
  const blob = rows[0]!.values[0]?.[0];
  if (typeof blob !== "string") return out;
  try {
    const parsed = JSON.parse(blob) as Record<string, { name?: string }>;
    for (const [id, val] of Object.entries(parsed)) {
      if (val && typeof val.name === "string") out.set(id, val.name);
    }
  } catch {
    // older decks may have a different col format; best-effort parse,
    // bail silently and use the "default" fallback per-card
  }
  return out;
}

function pickDeckName(decks: Map<string, string>): string | null {
  const commonRoot = commonDeckRoot(Array.from(decks.values()));
  if (commonRoot) return commonRoot;

  // Prefer the shortest non-default deck name (avoids the long
  // "Default::Subdeck::Subsubdeck" path strings Anki produces); fall
  // back to whatever's there.
  let chosen: string | null = null;
  for (const name of decks.values()) {
    if (name === "Default") continue;
    if (!chosen || name.length < chosen.length) chosen = name;
  }
  return chosen ?? decks.values().next().value ?? null;
}

function commonDeckRoot(names: string[]): string | null {
  const meaningful = names
    .filter((name) => name && name !== "Default")
    .map((name) => name.split("::").map((part) => part.trim()).filter(Boolean))
    .filter((parts) => parts.length > 1);
  if (meaningful.length < 2) return null;
  const root = meaningful[0]?.[0];
  if (!root) return null;
  return meaningful.every((parts) => parts[0] === root) ? root : null;
}
