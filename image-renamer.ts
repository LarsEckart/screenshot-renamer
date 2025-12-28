#!/usr/bin/env bun

const VERSION = "1.0.0";

import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const HISTORY_FILE = join(homedir(), ".config", "image-renamer", "history.txt");

async function logRename(oldPath: string, newPath: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `${timestamp}\t${oldPath}\t${newPath}\n`;
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await appendFile(HISTORY_FILE, entry);
}

const client = new Anthropic();

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function getImageMediaType(ext: string): ImageMediaType {
  const types: Record<string, ImageMediaType> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return types[ext.toLowerCase()] || "image/png";
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
  const mediaType = getImageMediaType(ext);

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
            text: `Suggest a short, descriptive filename for this image (without extension).
The name should be:
- Lowercase with hyphens (e.g., "orange-cat-on-couch", "sunset-over-mountains")
- Max 50 characters, aim for 2-5 words
- Descriptive of the main subject/content
- No generic names like "image" or "photo"

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

async function processImage(imagePath: string, dryRun = false) {
  const ext = extname(imagePath).toLowerCase();
  const dir = dirname(imagePath);
  const currentName = basename(imagePath);

  // Validate file extension
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    console.error(`❌ Unsupported file type: ${ext}`);
    console.error(`   Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`);
    process.exit(1);
  }

  // Check file exists
  try {
    await stat(imagePath);
  } catch {
    console.error(`❌ File not found: ${imagePath}`);
    process.exit(1);
  }

  console.log(`🖼️  Processing: ${currentName}`);

  const suggestedName = await suggestName(imagePath);
  if (!suggestedName) {
    console.error("   ❌ Could not get suggestion from API");
    process.exit(1);
  }

  const newFilename = `${suggestedName}${ext}`;
  const newPath = join(dir, newFilename);

  if (newFilename === currentName) {
    console.log("   ✓ Already has a good name");
    return;
  }

  // Check if target already exists, add number suffix if needed
  let finalPath = newPath;
  let finalName = newFilename;
  let counter = 1;
  while ((await Bun.file(finalPath).exists()) && finalPath !== imagePath) {
    finalName = `${suggestedName}-${counter}${ext}`;
    finalPath = join(dir, finalName);
    counter++;
  }

  if (dryRun) {
    console.log(`   → Would rename to: ${finalName}\n`);
    console.log(`mv ${JSON.stringify(imagePath)} ${JSON.stringify(finalPath)}`);
  } else {
    await rename(imagePath, finalPath);
    await logRename(imagePath, finalPath);
    console.log(`   ✅ Renamed to: ${finalName}`);
  }
}

function showHelp() {
  console.log(`
Image Renamer v${VERSION} - Uses Claude Vision to give images descriptive names

Usage: image-renamer [options] <image>

Arguments:
  image               Path to image file to rename

Options:
  --dry-run, -n       Show what would be renamed without making changes
  --version, -v       Show version number
  --help, -h          Show this help message

Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}

Environment:
  ANTHROPIC_API_KEY   Required: Your Anthropic API key

Examples:
  image-renamer signal-2025-11-19-14-23-47-588.jpg
  image-renamer --dry-run ~/Downloads/IMG_20231015_123456.jpg
`);
}

// CLI - only run when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-n");

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`image-renamer ${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // Find the image path (first non-flag argument)
  const imagePath = args.find((arg) => !arg.startsWith("-"));

  if (!imagePath) {
    console.error("❌ Please provide an image file to rename\n");
    showHelp();
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  console.log(
    dryRun
      ? `🔍 DRY RUN MODE v${VERSION} - file will not be renamed\n`
      : `🚀 Starting image renamer v${VERSION}...\n`
  );

  processImage(imagePath, dryRun);
}
