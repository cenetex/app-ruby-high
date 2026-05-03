import { describe, expect, it } from "vitest";
import { parseApkg } from "../content/anki/parse.js";

// Anki .apkg is "ZIP containing a SQLite db." We don't ship a fixture
// .apkg in the test bundle, so these tests focus on the input-validation
// edge cases the parser is responsible for handling clearly:
//   - non-ZIP bytes
//   - ZIP without an Anki collection inside
//   - ZIP with the new .anki21b zstd format we can't read
// Round-trip of a real deck is covered by manual smoke testing the
// import endpoint with an actual .apkg.

describe("parseApkg — input validation", () => {
  it("throws a clear error on non-ZIP bytes", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
    await expect(parseApkg(garbage)).rejects.toThrow();
  });

  it("throws a 'no Anki collection' error on a ZIP without collection.anki2", async () => {
    // Build the smallest possible ZIP via JSZip so we don't need a
    // pre-baked fixture. Stick a junk text file inside; no .anki* db.
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("readme.txt", "this is not an Anki deck");
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    await expect(parseApkg(bytes)).rejects.toThrow(/Anki/i);
  });

  it("throws a helpful 'use legacy export' error for the .anki21b zstd format", async () => {
    // Same trick — a ZIP with the modern zstd-compressed db file present
    // but unparseable. The parser should call this out specifically so
    // the user knows to re-export with the legacy option.
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("collection.anki21b", new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]));
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    await expect(parseApkg(bytes)).rejects.toThrow(/legacy support|anki21b|zstd/i);
  });
});
