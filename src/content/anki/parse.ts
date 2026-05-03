/**
 * Anki .apkg parser. The .apkg file format is a ZIP archive containing
 * a SQLite database (collection.anki2 or collection.anki21) plus media
 * files. This module extracts the cards as plain {front, back, deckName}
 * triples; turning them into multiple-choice questions is a separate step
 * (see distractors.ts) that needs an LLM.
 *
 * Pure-JS dependencies (jszip + sql.js) so this works in Node + browser
 * with no native build. wasm SQLite is heavy but the import is one-shot —
 * the user kicks off a deck import, we parse it, generate distractors,
 * and ship a ContentPack the rest of the system already knows how to play.
 */

import JSZip from "jszip";
import initSqlJs from "sql.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AnkiCard {
  /** Front face of the card — what the student sees. */
  front: string;
  /** Back face — the canonical correct answer. Will become the MC
   *  question's "correct" option after distractor generation. */
  back: string;
  /** Deck name from the .apkg, e.g. "AP Biology::Cells". Used as the
   *  ContentPack subject so the channels rail can group questions. */
  deckName: string;
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
    // sql.js needs the wasm binary; resolve from node_modules. Works in
    // both source-tree and dist-tree runs (same multi-candidate trick as
    // the question bank loader).
    const candidates = [
      resolve(here, "..", "..", "..", "node_modules", "sql.js", "dist"),
      resolve(here, "..", "..", "node_modules", "sql.js", "dist"),
      resolve(here, "..", "node_modules", "sql.js", "dist"),
    ];
    sqlJsCache = (initSqlJs as unknown as (opts: unknown) => Promise<unknown>)({
      locateFile: (file: string) => {
        for (const dir of candidates) {
          const path = resolve(dir, file);
          // We can't fs.existsSync here cheaply; sql.js uses this only when
          // it can't bundle the wasm. We'll catch failures via the read below.
          return path;
        }
        return file;
      },
    });
  }
  return sqlJsCache;
}

/** Parse an .apkg byte buffer into a list of cards + the deck name.
 *  Throws if the archive can't be read, the SQLite db is missing, or
 *  the schema doesn't match what Anki ships (notes + cards tables). */
export async function parseApkg(bytes: Uint8Array): Promise<AnkiDeck> {
  const zip = await JSZip.loadAsync(bytes);
  // Modern Anki ships .anki21b (zstd-compressed) or .anki21; older clients
  // ship .anki2. Prefer newer formats; fall back to older.
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
    // .anki21b uses zstd which jszip can't decompress. Tell the user clearly.
    if (zip.file("collection.anki21b")) {
      throw new Error(
        "This deck uses the newer .anki21b format (zstd-compressed). Re-export it from Anki with the 'Legacy support' option enabled, or use a deck saved from Anki 2.1.x.",
      );
    }
    throw new Error("No collection.anki2 / .anki21 found in the archive — is this really an Anki .apkg file?");
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
      `SELECT n.id AS noteId, n.flds AS flds, c.did AS did
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
      const did = String(row[2] ?? "");
      const [front, back] = splitFields(flds);
      if (!front || !back) continue; // skip malformed cards
      cards.push({
        front: stripHtml(front),
        back: stripHtml(back),
        deckName: decks.get(did) ?? "default",
        noteId,
      });
    }
    return { name: pickDeckName(decks) ?? "Untitled Deck", cards };
  } finally {
    db.close();
  }
}

/** Split Anki field string. Fields are joined by 0x1f (unit separator). */
function splitFields(flds: string): string[] {
  return flds.split(String.fromCharCode(0x1f));
}

/** Best-effort HTML strip — Anki cards often have minimal markup. */
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
    // ignore — older decks may have a different col format; fall back
  }
  return out;
}

function pickDeckName(decks: Map<string, string>): string | null {
  // Prefer the largest non-default deck name; fall back to the first.
  let chosen: string | null = null;
  for (const name of decks.values()) {
    if (name === "Default") continue;
    if (!chosen || name.length < chosen.length) chosen = name;
  }
  return chosen ?? decks.values().next().value ?? null;
}
