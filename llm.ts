import { rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  defaultProviderAuthContext,
  type Api,
  type Credential,
  type CredentialStore,
  type Model,
} from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { z } from "zod";

const PI_AUTH_FILE = join(homedir(), ".pi", "agent", "auth.json");
const FILENAME_SUGGESTION_SYSTEM_PROMPT =
  "You analyze images and suggest concise, descriptive filenames. Reply with only the filename, never extra commentary.";
const ANTHROPIC_MODEL: Model<Api> = getBuiltinModel("anthropic", "claude-haiku-4-5");
const OPENAI_CODEX_MODEL: Model<Api> = getBuiltinModel("openai-codex", "gpt-5.6-luna");
const OPENAI_MODEL: Model<Api> = getBuiltinModel("openai", "gpt-5.6-luna");
const OPENROUTER_MODEL: Model<Api> = getBuiltinModel("openrouter", "openai/gpt-5.6-luna");

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

// looseObject keeps unknown keys: the auth file belongs to Pi and may carry
// fields this tool does not know about, and they must survive a write.
const oAuthCredentialSchema = z.looseObject({
  access: z.string(),
  expires: z.number(),
  refresh: z.string(),
  type: z.literal("oauth"),
});

const apiKeyCredentialSchema = z.looseObject({
  env: z.record(z.string(), z.string()).optional(),
  key: z.string().optional(),
  type: z.literal("api_key"),
});

const credentialSchema = z.union([oAuthCredentialSchema, apiKeyCredentialSchema]);
const authFileSchema = z.record(z.string(), z.unknown());

async function readAuthFile(): Promise<Record<string, Credential>> {
  const authFile = Bun.file(PI_AUTH_FILE);
  if (!(await authFile.exists())) {
    return {};
  }

  const parsed = authFileSchema.safeParse(await authFile.json());
  if (!parsed.success) {
    return {};
  }

  const credentials: Record<string, Credential> = {};
  for (const [providerId, entry] of Object.entries(parsed.data)) {
    const credential = credentialSchema.safeParse(entry);
    if (credential.success) {
      credentials[providerId] = credential.data;
    }
  }

  return credentials;
}

async function writeAuthFile(credentials: Record<string, Credential>): Promise<void> {
  const tempPath = `${PI_AUTH_FILE}.tmp`;
  // node:fs over Bun.write for the mode option: this file holds OAuth tokens
  // and must stay readable only by the current user.
  await writeFile(tempPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, PI_AUTH_FILE);
}

function createPiAuthFileCredentialStore(): CredentialStore {
  // Serializes read-modify-write cycles per provider so a token refresh cannot
  // overwrite a concurrent write. Pi's own store uses a cross-process file
  // lock; a promise queue is enough for a single-process CLI.
  const queues = new Map<string, Promise<void>>();

  const enqueue = (providerId: string, operation: () => Promise<void>): Promise<void> => {
    const previous = queues.get(providerId) ?? Promise.resolve();
    const run = previous.then(operation);
    queues.set(
      providerId,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  };

  return {
    async delete(providerId) {
      await enqueue(providerId, async () => {
        const credentials = await readAuthFile();
        if (providerId in credentials) {
          delete credentials[providerId];
          await writeAuthFile(credentials);
        }
      });
    },

    async list() {
      return Object.entries(await readAuthFile()).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }));
    },

    async modify(providerId, fn) {
      let result: Credential | undefined;
      await enqueue(providerId, async () => {
        const credentials = await readAuthFile();
        result = await fn(credentials[providerId]);
        if (result !== undefined) {
          credentials[providerId] = result;
          await writeAuthFile(credentials);
        }
      });
      return result;
    },

    async read(providerId) {
      return (await readAuthFile())[providerId];
    },
  };
}

const models = builtinModels({
  authContext: defaultProviderAuthContext(),
  credentials: createPiAuthFileCredentialStore(),
});

type ResolvedAuth = {
  apiKey?: string;
  model: Model<Api>;
};

type ResolveSuggestionAuthOptions = {
  useClaudeApi?: boolean;
};

export type SuggestionAuth = ResolvedAuth;

function resolveAnthropicAuth(useClaudeApi?: boolean): ResolvedAuth | null {
  if (!useClaudeApi) {
    return null;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error("`--claude-api` requires ANTHROPIC_API_KEY to be set");
  }

  return {
    apiKey: anthropicApiKey,
    model: ANTHROPIC_MODEL,
  };
}

export async function resolveSuggestionAuth(
  options: ResolveSuggestionAuthOptions = {}
): Promise<SuggestionAuth> {
  const anthropicAuth = resolveAnthropicAuth(options.useClaudeApi);
  if (anthropicAuth) {
    return anthropicAuth;
  }

  let piAuthError: string | null = null;

  try {
    // Refreshes the OAuth token and persists it back to auth.json when needed.
    const codexAuth = await models.getAuth("openai-codex");
    if (codexAuth?.auth.apiKey) {
      return {
        apiKey: codexAuth.auth.apiKey,
        model: OPENAI_CODEX_MODEL,
      };
    }
  } catch (error) {
    piAuthError = error instanceof Error ? error.message : String(error);
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (openRouterApiKey) {
    return {
      apiKey: openRouterApiKey,
      model: OPENROUTER_MODEL,
    };
  }

  const openAIApiKey = process.env.OPENAI_API_KEY;
  if (openAIApiKey) {
    return {
      apiKey: openAIApiKey,
      model: OPENAI_MODEL,
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
  Override:  --claude-api (uses ANTHROPIC_API_KEY with Anthropic Claude Haiku 4.5)
  Preferred: Pi openai-codex auth from ~/.pi/agent/auth.json (GPT-5.6 Luna)
  Fallback:  OPENROUTER_API_KEY (GPT-5.6 Luna)
  Fallback:  OPENAI_API_KEY (GPT-5.6 Luna)`;

export async function suggestNameFromImage(
  prompt: string,
  imageBase64: string,
  mimeType: SupportedImageMimeType,
  authOverride?: SuggestionAuth
): Promise<string | null> {
  const auth = authOverride ?? (await resolveSuggestionAuth());
  const response = await models.complete(
    auth.model,
    {
      messages: [
        {
          content: [
            {
              data: imageBase64,
              mimeType,
              type: "image",
            },
            {
              text: prompt,
              type: "text",
            },
          ],
          role: "user",
          timestamp: Date.now(),
        },
      ],
      systemPrompt: FILENAME_SUGGESTION_SYSTEM_PROMPT,
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
