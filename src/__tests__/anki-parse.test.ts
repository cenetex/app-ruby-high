import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { parseApkg, type AnkiDeck } from "../content/anki/parse.js";

// Anki .apkg = ZIP containing a SQLite db. Two test categories:
//   1. Input validation — non-ZIP, ZIP without an Anki collection,
//      ZIP with the unsupported .anki21b zstd format.
//   2. End-to-end round-trip — build a minimal .apkg programmatically
//      using the same libs the parser uses (sql.js + jszip), then parse
//      it back and verify the cards land. This is the missing E2E
//      coverage that the original draft of this feature didn't have.

describe("parseApkg — input validation", () => {
  it("throws a clear error on non-ZIP bytes", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
    await expect(parseApkg(garbage)).rejects.toThrow();
  });

  it("throws a 'no Anki collection' error on a ZIP without collection.anki2", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "this is not an Anki deck");
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    await expect(parseApkg(bytes)).rejects.toThrow(/Anki/i);
  });

  it("throws a helpful 'use legacy export' error for the .anki21b zstd format", async () => {
    const zip = new JSZip();
    zip.file("collection.anki21b", new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]));
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    await expect(parseApkg(bytes)).rejects.toThrow(/legacy support|anki21b|zstd/i);
  });

  it("rejects oversized compressed collection entries before SQLite loads them", async () => {
    const zip = new JSZip();
    zip.file("collection.anki21", new Uint8Array(17 * 1024 * 1024));
    const bytes = new Uint8Array(await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    }));

    await expect(parseApkg(bytes)).rejects.toThrow(/too large after decompression/i);
  });
});

describe("parseApkg — end-to-end with a programmatic fixture", () => {
  it("round-trips a 5-card deck: cards, deck name, note ids", async () => {
    const fixture = await buildApkgFixture({
      deckName: "Capitals 101",
      cards: [
        { front: "Capital of France?", back: "Paris" },
        { front: "Capital of Japan?", back: "Tokyo" },
        { front: "Capital of Brazil?", back: "Brasília" },
        { front: "Capital of Australia?", back: "Canberra" },
        { front: "Capital of Egypt?", back: "Cairo" },
      ],
    });
    const deck: AnkiDeck = await parseApkg(fixture);
    expect(deck.name).toBe("Capitals 101");
    expect(deck.cards).toHaveLength(5);
    const fronts = deck.cards.map((c) => c.front).sort();
    expect(fronts).toEqual([
      "Capital of Australia?",
      "Capital of Brazil?",
      "Capital of Egypt?",
      "Capital of France?",
      "Capital of Japan?",
    ]);
    // Each card has a stable noteId (we provided 1..5).
    const ids = new Set(deck.cards.map((c) => c.noteId));
    expect(ids.size).toBe(5);
    // Deck name is propagated to each card.
    for (const c of deck.cards) {
      expect(c.deckName).toBe("Capitals 101");
      expect(c.tags).toEqual([]);
    }
  });

  it("preserves subdeck names + note tags and names the deck by common root", async () => {
    const fixture = await buildApkgFixture({
      deckName: "Biology",
      cards: [
        { front: "Cell boundary?", back: "Membrane", deckName: "Biology::Cells", tags: ["cells", "unit-1"] },
        { front: "DNA unit?", back: "Nucleotide", deckName: "Biology::Genetics", tags: ["genetics", "unit-1"] },
      ],
    });
    const deck = await parseApkg(fixture);
    expect(deck.name).toBe("Biology");
    expect(deck.cards.map((c) => c.deckName)).toEqual(["Biology::Cells", "Biology::Genetics"]);
    expect(deck.cards.map((c) => c.tags)).toEqual([["cells", "unit-1"], ["genetics", "unit-1"]]);
  });

  it("strips minimal HTML markup from card content", async () => {
    const fixture = await buildApkgFixture({
      deckName: "HTML Test",
      cards: [
        { front: "What is <b>HTML</b>?", back: "Markup<br/>language" },
      ],
    });
    const deck = await parseApkg(fixture);
    expect(deck.cards[0]?.front).toBe("What is HTML?");
    // <br/> becomes \n
    expect(deck.cards[0]?.back).toContain("Markup\nlanguage");
  });

  it("preserves image media references for image-occlusion style cards", async () => {
    const fixture = await buildApkgFixture({
      deckName: "Image Occlusion",
      cards: [
        {
          front: '<img src="occlusion.png">Identify the hidden label',
          back: "left ventricle",
          tags: ["image-occlusion"],
        },
      ],
      media: [{ entry: "0", name: "occlusion.png", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }],
    });
    const deck = await parseApkg(fixture);
    expect(deck.cards[0]?.front).toBe("Identify the hidden label");
    expect(deck.cards[0]?.frontHtml).toContain("occlusion.png");
    expect(deck.cards[0]?.media).toHaveLength(1);
    expect(deck.cards[0]?.media?.[0]).toMatchObject({
      name: "occlusion.png",
      mimeType: "image/png",
    });
    expect(deck.cards[0]?.media?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("skips malformed cards (missing front or back) without throwing", async () => {
    // Anki notes are field-separator delimited; if a card has only one
    // field the back is empty — we drop it silently rather than ship a
    // half-question into the bank.
    const fixture = await buildApkgFixture({
      deckName: "Mixed",
      cards: [
        { front: "Good front", back: "Good back" },
      ],
      // Inject one raw note row with a malformed flds value (no separator).
      malformedFlds: ["only-one-field"],
    });
    const deck = await parseApkg(fixture);
    // Only the well-formed card lands.
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]?.front).toBe("Good front");
  });

  it("handles a deck with zero cards (empty notes table) without throwing", async () => {
    const fixture = await buildApkgFixture({ deckName: "Empty Deck", cards: [] });
    const deck = await parseApkg(fixture);
    expect(deck.cards).toHaveLength(0);
    expect(deck.name).toBe("Empty Deck");
  });
});

// ── fixture builder ─────────────────────────────────────────────────────
// Constructs a minimal .apkg from scratch. Uses sql.js to write the
// SQLite collection inline + jszip to wrap it. This is the same path
// the parser uses to read, so the round-trip exercises the format
// agreement.

interface FixtureOpts {
  deckName: string;
  cards: Array<{ front: string; back: string; deckName?: string; tags?: string[] }>;
  malformedFlds?: string[];
  media?: Array<{ entry: string; name: string; bytes: Uint8Array }>;
}

async function buildApkgFixture(opts: FixtureOpts): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // Minimal Anki schema — just the columns the parser actually reads.
  db.run(`CREATE TABLE col (
    id INTEGER PRIMARY KEY,
    crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER, dty INTEGER,
    usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT,
    dconf TEXT, tags TEXT
  )`);
  db.run(`CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
    tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT
  )`);
  db.run(`CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER,
    type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER,
    reps INTEGER, lapses INTEGER, "left" INTEGER, odue INTEGER, odid INTEGER,
    flags INTEGER, data TEXT
  )`);
  const deckNames = Array.from(new Set([opts.deckName, ...opts.cards.map((c) => c.deckName ?? opts.deckName)]));
  const deckIdByName = new Map(deckNames.map((name, index) => [name, String(index + 1)]));
  const decksJson = JSON.stringify(Object.fromEntries(deckNames.map((name, index) => [String(index + 1), { name }])));
  db.run(`INSERT INTO col (id, decks, conf, models, dconf, tags) VALUES (1, ?, '{}', '{}', '{}', '{}')`, [decksJson]);
  // Insert real cards.
  let nid = 1;
  const FS = String.fromCharCode(0x1f);
  for (const c of opts.cards) {
    const flds = `${c.front}${FS}${c.back}`;
    const tags = c.tags && c.tags.length > 0 ? ` ${c.tags.join(" ")} ` : "";
    const did = deckIdByName.get(c.deckName ?? opts.deckName) ?? "1";
    db.run(`INSERT INTO notes (id, tags, flds, sfld) VALUES (?, ?, ?, ?)`, [nid, tags, flds, c.front]);
    db.run(`INSERT INTO cards (id, nid, did) VALUES (?, ?, ?)`, [nid, nid, did]);
    nid++;
  }
  // Inject malformed rows if requested (for the skip-malformed test).
  for (const flds of opts.malformedFlds ?? []) {
    db.run(`INSERT INTO notes (id, flds, sfld) VALUES (?, ?, ?)`, [nid, flds, flds]);
    db.run(`INSERT INTO cards (id, nid, did) VALUES (?, ?, ?)`, [nid, nid, 1]);
    nid++;
  }
  const dbBytes = db.export();
  db.close();
  // Wrap as .apkg (ZIP with collection.anki21).
  const zip = new JSZip();
  zip.file("collection.anki21", dbBytes);
  if (opts.media && opts.media.length > 0) {
    zip.file("media", JSON.stringify(Object.fromEntries(opts.media.map((asset) => [asset.entry, asset.name]))));
    for (const asset of opts.media) {
      zip.file(asset.entry, asset.bytes);
    }
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
