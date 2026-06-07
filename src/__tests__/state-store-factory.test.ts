import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStateStore } from "../services/state-store-factory.js";
import { StateStore } from "../services/state-store.js";
import { DynamoStateStore } from "../services/dynamo-state-store.js";

describe("createStateStore", () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.restoreAllMocks();
  });

  it("defaults to JSON-file backend when nothing is set", async () => {
    delete process.env.RUBY_HIGH_STORE_BACKEND;
    delete process.env.RUBY_HIGH_DYNAMO_TABLE;
    const store = await createStateStore();
    expect(store).toBeInstanceOf(StateStore);
  });

  it("returns DynamoStateStore when explicitly configured via opts", async () => {
    const store = await createStateStore({
      backend: "dynamodb",
      dynamoTable: "ruby-high-test",
      region: "us-east-1",
    });
    expect(store).toBeInstanceOf(DynamoStateStore);
    expect(store.describe()).toBe("dynamodb://us-east-1/ruby-high-test");
  });

  it("returns DynamoStateStore when env opts in", async () => {
    process.env.RUBY_HIGH_STORE_BACKEND = "dynamodb";
    process.env.RUBY_HIGH_DYNAMO_TABLE = "from-env";
    process.env.AWS_REGION = "us-west-2";
    const store = await createStateStore();
    expect(store).toBeInstanceOf(DynamoStateStore);
    expect(store.describe()).toBe("dynamodb://us-west-2/from-env");
  });

  it("accepts the dynamo / ddb aliases on the backend env var", async () => {
    process.env.RUBY_HIGH_DYNAMO_TABLE = "t";
    for (const alias of ["dynamo", "ddb", "DYNAMODB", "  DDB  "]) {
      process.env.RUBY_HIGH_STORE_BACKEND = alias;
      const store = await createStateStore();
      expect(store).toBeInstanceOf(DynamoStateStore);
    }
  });

  it("throws a clear error when dynamodb is requested without a table name", async () => {
    delete process.env.RUBY_HIGH_DYNAMO_TABLE;
    await expect(createStateStore({ backend: "dynamodb" })).rejects.toThrow(/RUBY_HIGH_DYNAMO_TABLE/);
  });

  it("falls back to JSON for an unknown backend value, with a warning", async () => {
    process.env.RUBY_HIGH_STORE_BACKEND = "redis";
    const store = await createStateStore();
    expect(store).toBeInstanceOf(StateStore);
    expect(console.warn).toHaveBeenCalled();
  });

  it("opts.jsonPath is wired through to the JSON backend", async () => {
    const store = await createStateStore({ backend: "json", jsonPath: "/tmp/explicit.json" });
    expect(store).toBeInstanceOf(StateStore);
    expect(store.describe()).toBe("/tmp/explicit.json");
  });

  it("ignores bad TTL env values and warns", async () => {
    process.env.RUBY_HIGH_STORE_BACKEND = "dynamodb";
    process.env.RUBY_HIGH_DYNAMO_TABLE = "t";
    process.env.RUBY_HIGH_STATE_TTL_SECONDS = "not-a-number";
    const store = await createStateStore();
    expect(store).toBeInstanceOf(DynamoStateStore);
    expect(console.warn).toHaveBeenCalled();
  });
});
