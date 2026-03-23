import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { complete, getModel, getModels, type Api, type Model } from "@mariozechner/pi-ai";
import { getOAuthApiKey, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";

const PI_AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");
const FILENAME_SUGGESTION_SYSTEM_PROMPT =
  "You analyze images and suggest concise, descriptive filenames. Reply with only the filename, never extra commentary.";
const OPENAI_CODEX_MODEL = getModel("openai-codex", "gpt-5.4-mini");
const OPENROUTER_MODEL = getModel("openrouter", "openai/gpt-5.4-mini");
const OPENAI_MODEL =
  getModels("openai").find((model) => model.id === "gpt-5.4-mini") ??
  getModel("openai", "gpt-5-mini");

if (!OPENAI_CODEX_MODEL) {
  throw new Error("Could not resolve openai-codex:gpt-5.4-mini from @mariozechner/pi-ai");
}

if (!OPENROUTER_MODEL) {
  throw new Error("Could not resolve openrouter:openai/gpt-5.4-mini from @mariozechner/pi-ai");
}

if (!OPENAI_MODEL) {
  throw new Error("Could not resolve an OpenAI fallback model from @mariozechner/pi-ai");
}

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

type OAuthAuthFileEntry = OAuthCredentials & { type?: string };
type OAuthAuthFile = Record<string, OAuthAuthFileEntry>;

type ResolvedAuth = {
  model: Model<Api>;
  apiKey?: string;
};

export type SuggestionAuth = ResolvedAuth;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOAuthAuthFileEntry(value: unknown): value is OAuthAuthFileEntry {
  return (
    isRecord(value) &&
    typeof value.access === "string" &&
    typeof value.refresh === "string" &&
    typeof value.expires === "number"
  );
}

async function loadPiAuthFile(): Promise<OAuthAuthFile | null> {
  const authFile = Bun.file(PI_AUTH_FILE);
  if (!(await authFile.exists())) {
    return null;
  }

  const parsed = (await authFile.json()) as unknown;
  if (!isRecord(parsed)) {
    return null;
  }

  const auth: OAuthAuthFile = {};
  for (const [provider, credentials] of Object.entries(parsed)) {
    if (isOAuthAuthFileEntry(credentials)) {
      auth[provider] = credentials;
    }
  }

  return auth;
}

async function savePiAuthFile(auth: OAuthAuthFile): Promise<void> {
  const tempPath = `${PI_AUTH_FILE}.tmp`;
  await Bun.write(tempPath, `${JSON.stringify(auth, null, 2)}\n`);
  await rename(tempPath, PI_AUTH_FILE);
}

async function resolvePiCodexAuth(): Promise<ResolvedAuth | null> {
  const auth = await loadPiAuthFile();
  const openAICodexCredentials = auth?.["openai-codex"];
  if (!openAICodexCredentials) {
    return null;
  }

  const refreshed = await getOAuthApiKey("openai-codex", auth);
  if (!refreshed) {
    return null;
  }

  const previousCredentials = auth["openai-codex"];
  const nextCredentials = {
    ...previousCredentials,
    ...refreshed.newCredentials,
  };

  if (JSON.stringify(previousCredentials) !== JSON.stringify(nextCredentials)) {
    auth["openai-codex"] = nextCredentials;
    await savePiAuthFile(auth);
  }

  return {
    model: OPENAI_CODEX_MODEL,
    apiKey: refreshed.apiKey,
  };
}

export async function resolveSuggestionAuth(): Promise<SuggestionAuth> {
  let piAuthError: string | null = null;

  try {
    const piAuth = await resolvePiCodexAuth();
    if (piAuth) {
      return piAuth;
    }
  } catch (error) {
    piAuthError = error instanceof Error ? error.message : String(error);
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (openRouterApiKey) {
    return {
      model: OPENROUTER_MODEL,
      apiKey: openRouterApiKey,
    };
  }

  const openAIApiKey = process.env.OPENAI_API_KEY;
  if (openAIApiKey) {
    return {
      model: OPENAI_MODEL,
      apiKey: openAIApiKey,
    };
  }

  if (piAuthError) {
    throw new Error(
      `Could not use Pi openai-codex auth (${piAuthError}). Set OPENROUTER_API_KEY or OPENAI_API_KEY as a fallback.`
    );
  }

  throw new Error(
    "No supported auth configured. Use Pi's openai-codex auth in ~/.pi/agent/auth.json, or set OPENROUTER_API_KEY, or set OPENAI_API_KEY."
  );
}

export async function assertSuggestionAuthConfigured(): Promise<void> {
  await resolveSuggestionAuth();
}

export const AUTHENTICATION_HELP_TEXT = `Authentication:
  Preferred: Pi openai-codex auth from ~/.pi/agent/auth.json (GPT-5.4 mini)
  Fallback:  OPENROUTER_API_KEY (GPT-5.4 mini)
  Fallback:  OPENAI_API_KEY (GPT-5 mini fallback)`;

export async function suggestNameFromImage(
  prompt: string,
  imageBase64: string,
  mimeType: SupportedImageMimeType,
  authOverride?: SuggestionAuth
): Promise<string | null> {
  const auth = authOverride ?? (await resolveSuggestionAuth());
  const response = await complete(
    auth.model,
    {
      systemPrompt: FILENAME_SUGGESTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          timestamp: Date.now(),
          content: [
            {
              type: "image",
              data: imageBase64,
              mimeType,
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      maxTokens: 100,
    }
  );

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage ?? "Failed to get filename suggestion");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (textBlock && textBlock.type === "text") {
    return textBlock.text;
  }

  return null;
}
