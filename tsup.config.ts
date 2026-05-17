import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/routes.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: false,
    target: "es2022",
  },
  {
    entry: ["src/viewer-privy-client.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
    splitting: false,
    target: "es2022",
    platform: "browser",
    noExternal: [/@privy-io\//, "react", "react-dom", /^react-dom\//],
  },
]);
