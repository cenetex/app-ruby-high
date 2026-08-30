#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { transform } from "esbuild";
import {
  renderViewerClientScript,
  renderViewerCss,
} from "../dist/viewer-assets.js";

const outputs = [
  {
    path: new URL("../dist/viewer-client.js", import.meta.url),
    loader: "js",
    source: renderViewerClientScript(),
  },
  {
    path: new URL("../dist/viewer.css", import.meta.url),
    loader: "css",
    source: renderViewerCss(),
  },
];

for (const output of outputs) {
  const transformed = await transform(output.source, {
    loader: output.loader,
    minify: true,
    target: "es2022",
  });
  await writeCompressed(output.path, transformed.code);
}

const privyPath = new URL("../dist/viewer-privy-client.global.js", import.meta.url);
await writeCompressed(privyPath, await readFile(privyPath));

async function writeCompressed(path, value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  await writeFile(path, body);
  await writeFile(new URL(`${path.pathname}.gz`, path), gzipSync(body, { level: 9 }));
  await writeFile(
    new URL(`${path.pathname}.br`, path),
    brotliCompressSync(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      },
    }),
  );
}

console.log("viewer assets built and precompressed");
