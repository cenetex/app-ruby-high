// tsup strips the `node:` prefix from built-in module imports, turning
// `import { DatabaseSync } from "node:sqlite"` into `import ... from "sqlite"`.
// Node 24 can only resolve the `node:`-prefixed form for the sqlite built-in,
// so we restore it after bundling.
import { readFileSync, writeFileSync } from "node:fs";

for (const file of ["dist/index.js", "dist/routes.js"]) {
  try {
    const before = readFileSync(file, "utf-8");
    const after = before.replace(
      /import\s*\{([^}]*)\}\s*from\s*"sqlite"/g,
      'import {$1} from "node:sqlite"'
    );
    if (before !== after) {
      writeFileSync(file, after, "utf-8");
      console.log(`fix-node-sqlite-import: patched ${file}`);
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
