/**
 * PDF → text extraction.
 *
 * Uses pdf-parse's internal parser directly (not the main entry) to avoid
 * the side-effect where the main entry reads test fixtures off disk.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type PdfData = {
  text: string;
  numpages: number;
  info: Record<string, string>;
};

// Import the internal parser to skip the test-file side effect.
const pdfParseFn = require("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
  options?: object,
) => Promise<PdfData>;

export interface PdfExtract {
  title: string;
  pageCount: number;
  /** Raw text per page (or best-effort page-sized chunks). */
  pages: string[];
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtract> {
  const buf = Buffer.from(bytes);
  const pageTexts: string[] = [];

  const data = await pdfParseFn(buf, {
    pagerender(pageData: unknown) {
      type PageData = { getTextContent: () => Promise<{ items: Array<{ str: string }> }> };
      return (pageData as PageData)
        .getTextContent()
        .then((tc) => {
          const text = tc.items.map((i) => i.str).join(" ").trim();
          if (text.length > 20) pageTexts.push(text);
          return text;
        });
    },
  });

  // Fallback: split the full concatenated text on form-feed characters.
  const pages =
    pageTexts.length > 0
      ? pageTexts
      : data.text
          .split(/\f/)
          .map((p) => p.trim())
          .filter((p) => p.length > 30);

  return {
    title: (data.info?.Title ?? "").trim(),
    pageCount: data.numpages,
    pages: pages.length > 0 ? pages : [data.text.trim()],
  };
}
