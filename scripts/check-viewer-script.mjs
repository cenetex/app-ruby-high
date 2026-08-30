import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();

function resolveLocalModule(specifier, fromFile) {
  const base = resolve(dirname(fromFile), specifier);
  const ext = extname(base);
  const candidates = ext === ".js"
    ? [base.slice(0, -3) + ".ts", base]
    : ext
      ? [base]
      : [base + ".ts", resolve(base, "index.ts")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
  return found;
}

function loadTsModule(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const source = readFileSync(file, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const text = ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    });
    throw new Error(text);
  }

  const module = { exports: {} };
  cache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      return loadTsModule(resolveLocalModule(specifier, file));
    }
    return require(specifier);
  };
  const run = new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText);
  run(module.exports, localRequire, module, file, dirname(file));
  return module.exports;
}

const viewer = loadTsModule(resolve(root, "src/viewer.ts"));
new Function(viewer.renderViewerClientScript());
console.log("viewer script syntax ok");
