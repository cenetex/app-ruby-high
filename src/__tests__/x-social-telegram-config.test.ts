import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../routes/x-social.ts",
);
const src = readFileSync(srcPath, "utf8");

describe("Telegram config GET — bot token isolation", () => {
  it("GET /x/telegram handler does not reference botToken", () => {
    const getHandlerMatch = src.match(
      /ctx\.method === "GET".*?telegram[\s\S]*?return true;/m,
    );
    expect(getHandlerMatch).toBeTruthy();
    const getHandler = getHandlerMatch![0];

    const hasBotTokenInGet = /botToken/i.test(getHandler);
    expect(hasBotTokenInGet).toBe(false);
  });

  it("getConfig does not return botToken in the source", () => {
    const getConfigLines = src.split("\n").filter(
      (l) => /getConfig/.test(l) && /botToken/i.test(l),
    );
    expect(getConfigLines).toHaveLength(0);
  });
});

