#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const app = process.env.FLY_APP || "ruby-high";

function git(args, opts = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function dirtyFingerprint() {
  const hash = createHash("sha256");
  const diff = git(["diff", "--binary", "HEAD"]);
  hash.update(diff);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const path of untracked.split("\0").filter(Boolean).sort()) {
    hash.update("\0file:");
    hash.update(path);
    hash.update("\0");
    try {
      hash.update(readFileSync(path));
    } catch {
      hash.update("<unreadable>");
    }
  }
  return hash.digest("hex").slice(0, 12);
}

function buildId() {
  const head = git(["rev-parse", "--short=12", "HEAD"]).trim();
  const dirty = git(["status", "--porcelain=v1", "--untracked-files=normal"]).trim();
  if (!dirty) return head;
  return `${head}-dirty-${dirtyFingerprint()}`;
}

const id = process.env.RUBY_HIGH_BUILD || buildId();
if (process.argv.includes("--print-build-id")) {
  console.log(id);
  process.exit(0);
}

const deploy = spawnSync("flyctl", [
  "deploy",
  "--app",
  app,
  "--remote-only",
  "--build-arg",
  `RUBY_HIGH_BUILD=${id}`,
], { stdio: "inherit" });

if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const smoke = spawnSync("npm", ["run", "smoke:prod"], { stdio: "inherit" });
process.exit(smoke.status ?? 1);
