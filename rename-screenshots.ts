#!/usr/bin/env bun

import { appendFile, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const SUPPORTED_EXTENSIONS = [".png"];
const SCREENSHOTS_DIR = import.meta.dir;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_FILE = join(homedir(), ".config", "screenshot-renamer", "history.txt");

async function logRename(oldPath: string, newPath: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp}\t${oldPath}\t${newPath}\n`;
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await appendFile(HISTORY_FILE, entry);
}

const client = new Anthropic();

async function getImageMediaType(ext: string): Promise<"image/png"> {
  const types: Record<string, "image/png"> = {
    ".png": "image/png",
  };
  return types[ext.toLowerCase()] || "image/png";
}

const MACOS_SCREENSHOT_PATTERN =
  /^Screenshot (\d{4}-\d{2}-\d{2}) at (\d{1,2})\.(\d{2})\.\d{2}/;

function isMacOSScreenshot(filename: string): boolean {
  return MACOS_SCREENSHOT_PATTERN.test(filename);
}

function getDateTimePrefix(filename: string): string {
  const match = filename.match(MACOS_SCREENSHOT_PATTERN);
  if (!match) throw new Error(`Not a macOS screenshot: ${filename}`);
  const date = match[1]!;
  const hour = match[2]!.padStart(2, "0");
  const minute = match[3]!;
  return `${date}-${hour}-${minute}`;
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
    // Sanitize: remove any chars that aren't alphanumeric or hyphens
    return textBlock.text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }
  return null;
}

async function isRecentFile(filePath: string): Promise<boolean> {
  const stats = await stat(filePath);
  const createdAt = stats.birthtime.getTime();
  const now = Date.now();
  return now - createdAt <= SEVEN_DAYS_MS;
}

async function processScreenshots(directory: string, dryRun = false) {
  const files = await readdir(directory);
  const candidates = files.filter((f) => {
    const ext = extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext) && isMacOSScreenshot(f);
  });

  // Filter to only files created in the last 7 days
  const images: string[] = [];
  for (const f of candidates) {
    if (await isRecentFile(join(directory, f))) {
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
      console.error(
        `   ❌ Error:`,
        error instanceof Error ? error.message : error,
        "\n",
      );
    }
  }
}

// CLI
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("-n");

// Parse folder argument (first non-flag argument)
const folderArg = args.find(arg => !arg.startsWith("-"));
const targetDir = folderArg ? folderArg : SCREENSHOTS_DIR;

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Screenshot Renamer - Uses Claude Vision to give screenshots descriptive names

Usage: bun rename-screenshots.ts [options] [folder]

Arguments:
  folder           Directory to process (default: current script directory)

Options:
  --dry-run, -n    Show what would be renamed without making changes
  --help, -h       Show this help message

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
    ? "🔍 DRY RUN MODE - no files will be renamed\n"
    : "🚀 Starting screenshot renamer...\n",
);
console.log(`📁 Target directory: ${targetDir}\n`);
processScreenshots(targetDir, dryRun);
