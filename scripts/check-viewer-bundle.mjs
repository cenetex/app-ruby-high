// Post-build guard for the cacheable viewer client.
//
// The viewer ships as an inline <script> that viewer-parts/script.ts builds by
// stringifying bundled functions (runViewerClient, the pure helpers, …) with
// Function.prototype.toString and concatenating them into one IIFE. esbuild
// renames module-scope identifiers when the same name exists in another bundled
// module (e.g. escapeHtml -> escapeHtml4), so the stringified bodies reference
// the *renamed* identifiers. If the IIFE doesn't also declare those names the
// viewer throws a ReferenceError at boot and never starts — yet the script is
// still syntactically valid, so `new Function(script)` and the per-file
// transpiled checks all pass. This guard runs against the real bundle and fails
// the build when the IIFE references an identifier it never declares.
import { parse } from "acorn";
import { readFile } from "node:fs/promises";

// Identifiers the browser provides at runtime. Anything referenced but not
// declared in the IIFE and not on this list is a real undeclared reference.
const BROWSER_GLOBALS = new Set([
  "window", "document", "navigator", "location", "localStorage", "sessionStorage",
  "showLeaderboard",
  "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "fetch",
  "Promise", "JSON", "Object", "Array", "Uint8Array", "String", "Number", "Boolean", "Math",
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Error",
  "TypeError", "RangeError", "Intl", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "parseInt", "parseFloat", "isNaN", "isFinite",
  "escape", "unescape", "URL", "URLSearchParams", "Headers", "Request", "Response",
  "FormData", "Blob", "File", "FileReader", "AbortController", "AbortSignal",
  "TextEncoder", "TextDecoder", "atob", "btoa", "crypto", "performance",
  "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event",
  "EventTarget", "MutationObserver", "IntersectionObserver", "ResizeObserver",
  "PerformanceObserver",
  "HTMLElement", "Element", "SVGElement", "Node", "NodeList", "DocumentFragment", "PublicKeyCredential",
  "Image", "Audio", "globalThis", "self", "undefined", "NaN", "Infinity",
  "arguments", "Function", "Proxy", "Reflect", "BigInt", "structuredClone",
  "queueMicrotask", "getComputedStyle", "matchMedia", "getSelection", "Range",
  "alert", "confirm", "prompt", "history", "screen", "WebSocket", "EventSource",
  "DOMParser", "XMLHttpRequest", "Notification", "ClipboardItem", "scrollTo",
  "scrollBy",
]);

function makeScope(parent) {
  return { vars: new Set(), parent };
}
function declare(scope, name) {
  if (name) scope.vars.add(name);
}
function resolve(scope, name) {
  for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return true;
  return false;
}

function bindPattern(node, scope) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": declare(scope, node.name); break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "RestElement") bindPattern(p.argument, scope);
        else bindPattern(p.value, scope);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) if (el) bindPattern(el, scope);
      break;
    case "AssignmentPattern": bindPattern(node.left, scope); break;
    case "RestElement": bindPattern(node.argument, scope); break;
  }
}

// Hoist `var` declarations from nested blocks (but not nested functions) up to
// the enclosing function/program scope, matching real var semantics.
function hoistVars(node, scope) {
  const stack = [];
  for (const key in node) if (key !== "type") pushChildren(node[key], stack);
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") continue;
    if (n.type === "VariableDeclaration") {
      if (n.kind === "var") for (const d of n.declarations) bindPattern(d.id, scope);
      continue;
    }
    for (const key in n) if (key !== "type") pushChildren(n[key], stack);
  }
}
function pushChildren(value, stack) {
  if (Array.isArray(value)) {
    for (const c of value) if (c && typeof c.type === "string") stack.push(c);
  } else if (value && typeof value.type === "string") {
    stack.push(value);
  }
}

// Pre-bind every declaration at this block/function level so forward references
// (a helper that calls a sibling declared later) resolve the way they do at
// runtime, where the call only happens after every const is initialized.
function hoistBlock(stmts, scope) {
  for (const n of stmts) {
    if (!n || typeof n.type !== "string") continue;
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
      if (n.id) declare(scope, n.id.name);
    } else if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) bindPattern(d.id, scope);
    }
  }
  for (const n of stmts) {
    if (n && typeof n.type === "string" && n.type !== "FunctionDeclaration") hoistVars(n, scope);
  }
}

function walk(node, scope, undeclared) {
  if (!node || typeof node.type !== "string") return;
  const recur = (child, sc) => walk(child, sc, undeclared);
  switch (node.type) {
    case "Program":
      hoistBlock(node.body, scope);
      for (const s of node.body) recur(s, scope);
      return;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const fnScope = makeScope(scope);
      if (node.id && node.type !== "FunctionDeclaration") declare(fnScope, node.id.name);
      for (const p of node.params) bindPattern(p, fnScope);
      if (node.body.type === "BlockStatement") {
        hoistBlock(node.body.body, fnScope);
        for (const s of node.body.body) recur(s, fnScope);
      } else {
        recur(node.body, fnScope);
      }
      return;
    }
    case "BlockStatement": {
      const blockScope = makeScope(scope);
      hoistBlock(node.body, blockScope);
      for (const s of node.body) recur(s, blockScope);
      return;
    }
    case "SwitchStatement": {
      recur(node.discriminant, scope);
      const blockScope = makeScope(scope);
      const all = [];
      for (const c of node.cases) for (const s of c.consequent) all.push(s);
      hoistBlock(all, blockScope);
      for (const c of node.cases) {
        if (c.test) recur(c.test, blockScope);
        for (const s of c.consequent) recur(s, blockScope);
      }
      return;
    }
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement": {
      const loopScope = makeScope(scope);
      for (const part of ["init", "left"]) {
        const decl = node[part];
        if (decl && decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) { bindPattern(d.id, loopScope); if (d.init) recur(d.init, loopScope); }
        } else if (decl) {
          recur(decl, loopScope);
        }
      }
      for (const part of ["right", "test", "update", "body"]) if (node[part]) recur(node[part], loopScope);
      return;
    }
    case "CatchClause": {
      const catchScope = makeScope(scope);
      if (node.param) bindPattern(node.param, catchScope);
      hoistBlock(node.body.body, catchScope);
      for (const s of node.body.body) recur(s, catchScope);
      return;
    }
    case "VariableDeclaration":
      for (const d of node.declarations) { bindPattern(d.id, scope); if (d.init) recur(d.init, scope); }
      return;
    case "MemberExpression":
      recur(node.object, scope);
      if (node.computed) recur(node.property, scope);
      return;
    case "Property":
      if (node.computed) recur(node.key, scope);
      recur(node.value, scope);
      return;
    case "Identifier":
      if (!resolve(scope, node.name) && !BROWSER_GLOBALS.has(node.name)) {
        undeclared.set(node.name, (undeclared.get(node.name) ?? 0) + 1);
      }
      return;
    case "LabeledStatement":
      recur(node.body, scope);
      return;
    case "BreakStatement":
    case "ContinueStatement":
      return;
  }
  for (const key in node) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const c of value) if (c && typeof c.type === "string") recur(c, scope);
    } else if (value && typeof value.type === "string") {
      recur(value, scope);
    }
  }
}

const clientScript = await readFile(new URL("../dist/viewer-client.js", import.meta.url), "utf8");
const ast = parse(clientScript, { ecmaVersion: 2022, sourceType: "script" });
const undeclared = new Map();
walk(ast, makeScope(null), undeclared);

if (undeclared.size > 0) {
  const detail = [...undeclared.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `  ${name} (×${count})`)
    .join("\n");
  throw new Error(
    "viewer bundle references identifiers it never declares — the browser client "
    + "will throw a ReferenceError at boot:\n" + detail
    + "\n\nThis usually means esbuild renamed a serialized helper (see "
    + "viewer-parts/script.ts). If a name above is a new browser global, add it "
    + "to BROWSER_GLOBALS in scripts/check-viewer-bundle.mjs.",
  );
}

console.log("viewer bundle ok");
