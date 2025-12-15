#!/usr/bin/env bun

const VERSION = "1.1.3";

import { appendFile, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const SUPPORTED_EXTENSIONS = [".png"];
const SCREENSHOTS_DIR = process.cwd();
const DEFAULT_DAYS = 7;
const HISTORY_FILE = join(homedir(), ".config", "screenshot-renamer", "history.txt");

async function logRename(oldPath: string, newPath: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp}\t${oldPath}\t${newPath}\n`;
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await appendFile(HISTORY_FILE, entry);
}

const client = new Anthropic();

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Try to extract nested API error message from JSON
  const jsonMatch = message.match(/\{.*"message"\s*:\s*"([^"]+)".*\}/);
  if (jsonMatch?.[1]) {
    return jsonMatch[1];
  }
  return message;
}

async function getImageMediaType(ext: string): Promise<"image/png"> {
  const types: Record<string, "image/png"> = {
    ".png": "image/png",
  };
  return types[ext.toLowerCase()] || "image/png";
}

const MACOS_SCREENSHOT_PATTERN =
  /^Screenshot (\d{4}-\d{2}-\d{2}) at (\d{1,2})\.(\d{2})\.\d{2}/;

export function isMacOSScreenshot(filename: string): boolean {
  return MACOS_SCREENSHOT_PATTERN.test(filename);
}

export function getDateTimePrefix(filename: string): string {
  const match = filename.match(MACOS_SCREENSHOT_PATTERN);
  if (!match) throw new Error(`Not a macOS screenshot: ${filename}`);
  const date = match[1]!;
  const hour = match[2]!.padStart(2, "0");
  const minute = match[3]!;
  return `${date}-${hour}-${minute}`;
}

export function sanitizeFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function suggestName(imagePath: string): Promise<string | null> {
  const ext = extname(imagePath).toLowerCase();
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mediaType = await getImageMediaType(ext);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: "text",
            text: `Analyze this screenshot and suggest a short, descriptive filename (without extension).
The name should be:
- Lowercase with hyphens (e.g., "slack-conversation-about-deployment")
- Max 50 characters
- Descriptive of what's shown (app name, content type, key details)
- No generic names like "screenshot" or "image"

Reply with ONLY the suggested filename, nothing else.`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (textBlock && textBlock.type === "text") {
    return sanitizeFilename(textBlock.text);
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

async function processScreenshots(directory: string, dryRun = false, days = DEFAULT_DAYS) {
  const files = await readdir(directory);
  const candidates = files.filter((f) => {
    const ext = extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext) && isMacOSScreenshot(f);
  });

  // Filter to only files created within the specified number of days
  const images: string[] = [];
  for (const f of candidates) {
    if (await isRecentFile(join(directory, f), days)) {
      images.push(f);
    }
  }

  if (images.length === 0) {
    console.log("No images found in", directory);
    return;
  }

  console.log(`Found ${images.length} image(s) to process...\n`);

  for (const image of images) {
    const imagePath = join(directory, image);
    const ext = extname(image);

    console.log(`📷 Processing: ${image}`);

    try {
      const suggestedName = await suggestName(imagePath);
      if (!suggestedName) {
        console.log("   ⚠️  Could not get suggestion, skipping\n");
        continue;
      }

      const dateTimePrefix = getDateTimePrefix(image);
      const newFilename = `${dateTimePrefix}-${suggestedName}${ext}`;
      const newPath = join(directory, newFilename);

      if (newFilename === image) {
        console.log("   ✓ Already has a good name\n");
        continue;
      }

      // Check if target already exists, add number suffix if needed
      let finalPath = newPath;
      let finalName = newFilename;
      let counter = 1;
      const existingFiles = await readdir(directory);
      while (existingFiles.includes(finalName)) {
        finalName = `${suggestedName}-${counter}${ext}`;
        finalPath = join(directory, finalName);
        counter++;
      }

      if (dryRun) {
        console.log(`   → Would rename to: ${finalName}\n`);
      } else {
        await rename(imagePath, finalPath);
        await logRename(imagePath, finalPath);
        console.log(`   ✅ Renamed to: ${finalName}\n`);
      }
    } catch (error) {
      console.error(`   ❌ Error: ${formatErrorMessage(error)}\n`);
    }
  }
}

// CLI - only run when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");

  // Parse --days flag
  let days = DEFAULT_DAYS;
  const daysIndex = args.findIndex(arg => arg === "--days" || arg === "-d");
  if (daysIndex !== -1 && args[daysIndex + 1]) {
    const parsedDays = parseInt(args[daysIndex + 1], 10);
    if (isNaN(parsedDays) || parsedDays < 1) {
      console.error("❌ --days must be a positive integer");
      process.exit(1);
    }
    days = parsedDays;
  }

  // Parse folder argument (first non-flag argument, excluding --days value)
  const flagsWithValues = new Set(["--days", "-d"]);
  const folderArg = args.find((arg, i) => {
    if (arg.startsWith("-")) return false;
    // Check if previous arg was a flag that takes a value
    const prevArg = args[i - 1];
    if (prevArg && flagsWithValues.has(prevArg)) return false;
    return true;
  });
  const targetDir = folderArg ? folderArg : SCREENSHOTS_DIR;

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`screenshot-renamer ${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Screenshot Renamer v${VERSION} - Uses Claude Vision to give screenshots descriptive names

Usage: screenshot-renamer [options] [folder]

Arguments:
  folder              Directory to process (default: current directory)

Options:
  --days <n>, -d <n>  Only process screenshots from the last n days (default: ${DEFAULT_DAYS})
  --dry-run, -n       Show what would be renamed without making changes
  --version, -v       Show version number
  --help, -h          Show this help message

Environment:
  ANTHROPIC_API_KEY    Required: Your Anthropic API key
`);
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  console.log(
    dryRun
      ? `🔍 DRY RUN MODE v${VERSION} - no files will be renamed\n`
      : `🚀 Starting screenshot renamer v${VERSION}...\n`,
  );
  console.log(`📁 Target directory: ${targetDir}`);
  console.log(`📅 Looking back: ${days} day${days === 1 ? "" : "s"}\n`);
  processScreenshots(targetDir, dryRun, days);
}
