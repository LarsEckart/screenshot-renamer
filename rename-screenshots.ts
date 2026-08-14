#!/usr/bin/env bun

const VERSION = "1.6.2";

import { appendFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import {
  AUTHENTICATION_HELP_TEXT,
  resolveSuggestionAuth,
  suggestNameFromImage,
  type SuggestionAuth,
} from "./llm";
import { print, printError } from "./cli-output";

const SUPPORTED_EXTENSIONS = [".png"];
const SCREENSHOTS_DIR = process.cwd();
const DEFAULT_DAYS = 7;
const ANALYSIS_CONCURRENCY = 3;
const HISTORY_FILE = join(homedir(), ".config", "screenshot-renamer", "history.txt");

type ImageAnalysisResult =
  | {
      image: string;
      status: "suggested";
      suggestedName: string;
    }
  | {
      image: string;
      status: "no-suggestion";
    }
  | {
      error: unknown;
      image: string;
      status: "error";
    };

type MapWithConcurrencyOptions<T, U> = {
  onResolved?: (result: U, item: T, index: number) => void | Promise<void>;
  onStarted?: (item: T, index: number) => void | Promise<void>;
};

async function logRename(oldPath: string, newPath: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp}\t${oldPath}\t${newPath}\n`;
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await appendFile(HISTORY_FILE, entry);
}

export function formatErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  // Try to extract nested API error message from JSON
  const jsonMatch = message.match(/\{.*"message"\s*:\s*"([^"]+)".*\}/);
  if (jsonMatch?.[1]) {
    return jsonMatch[1];
  }
  return message;
}

export function getUniqueFilename(
  baseName: string,
  extension: string,
  reservedNames: ReadonlySet<string>
): string {
  let candidate = `${baseName}${extension}`;
  let counter = 1;

  while (reservedNames.has(candidate)) {
    candidate = `${baseName}-${counter}${extension}`;
    counter++;
  }

  return candidate;
}

export async function mapWithConcurrency<T, U>(
  items: ReadonlyArray<T>,
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
  options?: MapWithConcurrencyOptions<T, U>
): Promise<Array<U>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Concurrency must be a positive integer, got ${concurrency}`);
  }

  // SAFETY: every worker writes results[currentIndex] before finishing, and
  // the workers together cover indices 0..items.length - 1, so no holes remain.
  const results = Array.from({ length: items.length }) as Array<U>;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex++;
      const item = items[currentIndex]!;
      await options?.onStarted?.(item, currentIndex);
      const result = await mapper(item, currentIndex);
      results[currentIndex] = result;
      await options?.onResolved?.(result, item, currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

const MACOS_SCREENSHOT_PATTERN = /^Screenshot (\d{4}-\d{2}-\d{2}) at (\d{1,2})\.(\d{2})\.\d{2}/;

export function isMacOSScreenshot(filename: string): boolean {
  return MACOS_SCREENSHOT_PATTERN.test(filename);
}

export function getDateTimePrefix(filename: string): string {
  const match = filename.match(MACOS_SCREENSHOT_PATTERN);
  if (!match) {
    throw new Error(`Not a macOS screenshot: ${filename}`);
  }
  const date = match[1]!;
  const hour = match[2]!.padStart(2, "0");
  const minute = match[3]!;
  return `${date}-${hour}-${minute}`;
}

export function sanitizeFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 50);
}

export function getSuggestedBaseName(image: string, suggestedName: string): string {
  return `${getDateTimePrefix(image)}-${suggestedName}`;
}

export function getSuggestedFilename(image: string, suggestedName: string): string {
  return `${getSuggestedBaseName(image, suggestedName)}${extname(image)}`;
}

async function suggestName(
  imagePath: string,
  suggestionAuth: SuggestionAuth
): Promise<string | null> {
  const imageData = await Bun.file(imagePath).arrayBuffer();
  const base64 = Buffer.from(imageData).toString("base64");

  const suggestion = await suggestNameFromImage(
    `Analyze this screenshot and suggest a short, descriptive filename (without extension).
The name should be:
- Lowercase with hyphens (e.g., "slack-conversation-about-deployment")
- Max 50 characters
- Descriptive of what's shown (app name, content type, key details)
- No generic names like "screenshot" or "image"

Reply with ONLY the suggested filename, nothing else.`,
    base64,
    "image/png",
    suggestionAuth
  );

  if (suggestion) {
    return sanitizeFilename(suggestion);
  }

  return null;
}

async function isRecentFile(filePath: string, maxDaysOld: number): Promise<boolean> {
  const stats = await stat(filePath);
  const createdAt = stats.birthtime.getTime();
  const now = Date.now();
  const maxAgeMs = maxDaysOld * 24 * 60 * 60 * 1000;
  return now - createdAt <= maxAgeMs;
}

async function analyzeImage(
  directory: string,
  image: string,
  suggestionAuth: SuggestionAuth
): Promise<ImageAnalysisResult> {
  const imagePath = join(directory, image);

  try {
    const suggestedName = await suggestName(imagePath, suggestionAuth);
    if (!suggestedName) {
      return {
        image,
        status: "no-suggestion",
      };
    }

    return {
      image,
      status: "suggested",
      suggestedName,
    };
  } catch (error) {
    return {
      error,
      image,
      status: "error",
    };
  }
}

async function handleCompletedAnalysis(
  directory: string,
  analysis: ImageAnalysisResult,
  reservedNames: Set<string>,
  dryRun: boolean,
  completedCount: number,
  totalCount: number
): Promise<void> {
  print(`🏷️ Renaming (${completedCount}/${totalCount}): ${analysis.image}`);

  if (analysis.status === "error") {
    printError(`   ❌ Analysis failed: ${formatErrorMessage(analysis.error)}\n`);
    return;
  }

  if (analysis.status === "no-suggestion") {
    print("   ⚠️  Could not get suggestion, skipping\n");
    return;
  }

  const ext = extname(analysis.image);
  const imagePath = join(directory, analysis.image);
  const baseFilename = getSuggestedBaseName(analysis.image, analysis.suggestedName);
  const newFilename = `${baseFilename}${ext}`;

  if (newFilename === analysis.image) {
    print("   ✓ Already has a good name\n");
    return;
  }

  const finalName = getUniqueFilename(baseFilename, ext, reservedNames);
  const finalPath = join(directory, finalName);

  reservedNames.delete(analysis.image);
  reservedNames.add(finalName);

  try {
    if (dryRun) {
      print(`   → Would rename to: ${finalName}\n`);
      return;
    }

    await rename(imagePath, finalPath);
    await logRename(imagePath, finalPath);
    print(`   ✅ Renamed to: ${finalName}\n`);
  } catch (error) {
    reservedNames.delete(finalName);
    reservedNames.add(analysis.image);
    printError(`   ❌ Error: ${formatErrorMessage(error)}\n`);
  }
}

async function processScreenshots(
  directory: string,
  suggestionAuth: SuggestionAuth,
  dryRun = false,
  days = DEFAULT_DAYS
) {
  const files = await readdir(directory);
  const candidates = files.filter((f) => {
    const ext = extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext) && isMacOSScreenshot(f);
  });

  // Filter to only files created within the specified number of days
  const images: Array<string> = [];
  for (const f of candidates) {
    if (await isRecentFile(join(directory, f), days)) {
      images.push(f);
    }
  }

  if (images.length === 0) {
    print(`No images found in ${directory}`);
    return;
  }

  print(`Found ${images.length} image(s) to process...\n`);

  const reservedNames = new Set(await readdir(directory));
  let completedCount = 0;

  await mapWithConcurrency(
    images,
    ANALYSIS_CONCURRENCY,
    (image) => analyzeImage(directory, image, suggestionAuth),
    {
      onResolved: async (analysis) => {
        completedCount++;
        await handleCompletedAnalysis(
          directory,
          analysis,
          reservedNames,
          dryRun,
          completedCount,
          images.length
        );
      },
      onStarted: (image, index) => {
        print(`🔍 Analyzing (${index + 1}/${images.length}): ${image}`);
      },
    }
  );
}

// CLI - only run when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");

  // Parse --days flag
  let days = DEFAULT_DAYS;
  const daysIndex = args.findIndex((arg) => arg === "--days" || arg === "-d");
  if (daysIndex !== -1) {
    const daysArgument = args[daysIndex + 1];
    if (daysArgument) {
      const parsedDays = Number.parseInt(daysArgument, 10);
      if (Number.isNaN(parsedDays) || parsedDays < 1) {
        printError("❌ --days must be a positive integer");
        process.exit(1);
      }
      days = parsedDays;
    }
  }

  const useClaudeApi = args.includes("--claude-api");

  // Parse folder argument (first non-flag argument, excluding --days value)
  const flagsWithValues = new Set(["--days", "-d"]);
  const folderArg = args.find((arg, i) => {
    if (arg.startsWith("-")) {
      return false;
    }
    // Check if previous arg was a flag that takes a value
    const prevArg = args[i - 1];
    if (prevArg && flagsWithValues.has(prevArg)) {
      return false;
    }
    return true;
  });
  const targetDir = folderArg ? folderArg : SCREENSHOTS_DIR;

  if (args.includes("--version") || args.includes("-v")) {
    print(`screenshot-renamer ${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    print(`
Screenshot Renamer v${VERSION} - Uses GPT vision models to give screenshots descriptive names

Usage: screenshot-renamer [options] [folder]

Arguments:
  folder              Directory to process (default: current directory)

Options:
  --days <n>, -d <n>  Only process screenshots from the last n days (default: ${DEFAULT_DAYS})
  --dry-run, -n       Show what would be renamed without making changes
  --version, -v       Show version number
  --help, -h          Show this help message

${AUTHENTICATION_HELP_TEXT}
`);
    process.exit(0);
  }

  try {
    const suggestionAuth = await resolveSuggestionAuth({ useClaudeApi });

    print(
      dryRun
        ? `🔍 DRY RUN MODE v${VERSION} - no files will be renamed\n`
        : `🚀 Starting screenshot renamer v${VERSION}...\n`
    );
    print(`📁 Target directory: ${targetDir}`);
    print(`📅 Looking back: ${days} day${days === 1 ? "" : "s"}\n`);
    print(`⚡ LLM analysis concurrency: ${ANALYSIS_CONCURRENCY}\n`);
    await processScreenshots(targetDir, suggestionAuth, dryRun, days);
  } catch (error) {
    printError(`❌ ${formatErrorMessage(error)}`);
    process.exit(1);
  }
}
