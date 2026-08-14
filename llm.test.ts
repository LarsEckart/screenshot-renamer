import { afterEach, expect, test } from "bun:test";
import { resolveSuggestionAuth } from "./llm";

const originalEnv = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
});

test("uses the explicit claude api key override", async () => {
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
  process.env.OPENROUTER_API_KEY = "openrouter-test-key";
  process.env.OPENAI_API_KEY = "openai-test-key";

  const auth = await resolveSuggestionAuth({ useClaudeApi: true });

  expect(auth.apiKey).toBe("anthropic-test-key");
  expect(auth.model.id).toBe("claude-haiku-4-5");
});
