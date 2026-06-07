import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/routes.ts", "src/services/core-pack-nfts.ts", "src/services/hall-pass-nfts.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: false,
    target: "es2022",
  },
  {
    entry: ["src/viewer-privy-client.ts"],
    format: ["esm", "iife"],
    globalName: "RubyHighPrivyClientModule",
    dts: true,
    clean: false,
    splitting: false,
    target: "es2022",
    platform: "browser",
    noExternal: [/.*/],
  },
]);
