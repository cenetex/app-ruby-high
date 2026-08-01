import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLlmChatCompletions,
  llmChatCompletionsUrl,
  llmProviderInfo,
  llmHeaders,
  llmProviderKind,
  prepareLlmRequestBody,
  resolveCourseModel,
  resolveLlmApiKey,
  resolveLlmModel,
  resolveStudentModel,
} from "../services/llm-provider.js";
import { DEFAULT_COURSE_MODEL, DEFAULT_OPENROUTER_MODEL, DEFAULT_STUDENT_MODEL } from "../model-defaults.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("llm-provider", () => {
  it("defaults to OpenRouter when no local endpoint is configured", () => {
    expect(DEFAULT_OPENROUTER_MODEL).toBe("openai/gpt-5.6-luna");
    expect(DEFAULT_STUDENT_MODEL).toBe("openai/gpt-5.6-luna");
    expect(DEFAULT_COURSE_MODEL).toBe("openai/gpt-5.6-terra");
    expect(llmProviderKind()).toBe("openrouter");
    expect(llmChatCompletionsUrl()).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(llmProviderInfo().defaultModel).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveLlmModel("")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(resolveStudentModel()).toBe(DEFAULT_STUDENT_MODEL);
    expect(resolveCourseModel()).toBe(DEFAULT_COURSE_MODEL);
    expect(resolveLlmModel("custom/model")).toBe("custom/model");
    expect(resolveLlmApiKey("sk-user")).toBe("sk-user");
  });

  it("allows course generation to use a dedicated model", () => {
    vi.stubEnv("RUBY_HIGH_COURSE_MODEL", "custom/course-model");

    expect(resolveCourseModel()).toBe("custom/course-model");
    expect(resolveStudentModel()).toBe(DEFAULT_STUDENT_MODEL);
  });

  it("applies GPT-5.6 Chat Completions compatibility defaults", () => {
    expect(prepareLlmRequestBody({
      model: DEFAULT_STUDENT_MODEL,
      messages: [],
      temperature: 0.95,
    })).toEqual({
      model: "openai/gpt-5.6-luna",
      messages: [],
      reasoning_effort: "none",
    });

    expect(prepareLlmRequestBody({
      model: DEFAULT_COURSE_MODEL,
      messages: [],
      temperature: 0.45,
    })).toEqual({
      model: "openai/gpt-5.6-terra",
      messages: [],
    });
  });

  it("normalizes a local OpenAI-compatible base URL", () => {
    vi.stubEnv("RUBY_HIGH_LLM_BASE_URL", "http://127.0.0.1:8080/v1/");

    expect(llmProviderKind()).toBe("local");
    expect(llmChatCompletionsUrl()).toBe("http://127.0.0.1:8080/v1/chat/completions");
  });

  it("replaces remote model ids with the configured local model", async () => {
    vi.stubEnv("RUBY_HIGH_LLM_PROVIDER", "local");
    vi.stubEnv("RUBY_HIGH_LLM_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("RUBY_HIGH_LLM_MODEL", "smollm3:3b");

    let capturedUrl = "";
    let capturedBody: any = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });

    await fetchLlmChatCompletions({
      apiKey: null,
      body: {
        model: DEFAULT_OPENROUTER_MODEL,
        messages: [{ role: "user", content: "hi" }],
      },
    });

    expect(capturedUrl).toBe("http://localhost:11434/v1/chat/completions");
    expect(capturedBody.model).toBe("smollm3:3b");
    expect(llmHeaders(null)).toMatchObject({ Authorization: "Bearer local" });
  });
});
