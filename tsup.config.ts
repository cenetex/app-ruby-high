import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/routes.ts", "src/viewer-assets.ts", "src/services/dynamo-state-store.ts", "src/services/core-pack-nfts.ts", "src/services/hall-pass-nfts.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: true,
    target: "es2022",
  },
  {
    entry: ["src/viewer-privy-client.ts"],
    format: ["iife"],
    globalName: "RubyHighPrivyClientModule",
    // This browser-only bundle vendors the complete Privy/React dependency
    // graph. Production minification keeps it under the enforced 10 MiB
    // delivery budget without weakening the bundle check.
    minify: true,
    dts: true,
    clean: false,
    splitting: false,
    target: "es2022",
    platform: "browser",
    noExternal: [/.*/],
  },
]);
