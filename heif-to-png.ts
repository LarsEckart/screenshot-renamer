#!/usr/bin/env bun

const VERSION = "1.5.0";

import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { z } from "zod";
import { print, printError } from "./cli-output";

const DEFAULT_INPUT_DIRECTORY = "~/Downloads";
const DEFAULT_OUTPUT_DIRECTORY = "./outputs";
const PNG_EXTENSION = ".png";
const HISTORY_FILE = join(homedir(), ".config", "heif-to-png", "history.json");
const SUPPORTED_EXTENSIONS = [".heic", ".heif"] as const;

type ConversionSummary = {
  converted: number;
  failed: number;
  found: number;
  skipped: number;
};

type CliOptions = {
  dryRun: boolean;
  inputDirectory: string;
  outputDirectory: string;
  overwrite: boolean;
};

const conversionHistoryEntrySchema = z.object({
  convertedAt: z.string(),
  outputPath: z.string(),
  sourceFilename: z.string(),
});

const conversionHistorySchema = z.record(z.string(), conversionHistoryEntrySchema);

type ConversionHistoryEntry = z.infer<typeof conversionHistoryEntrySchema>;

type ConversionHistory = Record<string, ConversionHistoryEntry>;

type ConvertFile = (inputPath: string, outputPath: string) => Promise<void>;

export function isSupportedHeifFile(filename: string): boolean {
  const extension = extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.some((supported) => supported === extension);
}

export function getPngFilenameForSource(sourcePath: string): string {
  const sourceFilename = basename(sourcePath);
  const sourceExtension = extname(sourceFilename);
  return `${basename(sourceFilename, sourceExtension)}${PNG_EXTENSION}`;
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

export function getTargetOutputFilename(
  sourcePath: string,
  reservedNames: ReadonlySet<string>,
  overwrite: boolean
): string {
  const pngFilename = getPngFilenameForSource(sourcePath);
  if (overwrite) {
    return pngFilename;
  }

  return getUniqueFilename(basename(pngFilename, PNG_EXTENSION), PNG_EXTENSION, reservedNames);
}

export function formatSummary(summary: ConversionSummary, dryRun: boolean): string {
  const convertedLabel = dryRun ? "would convert" : "converted";
  return `Summary: found ${summary.found} / ${convertedLabel} ${summary.converted} / skipped ${summary.skipped} / failed ${summary.failed}`;
}

export function shouldSkipAlreadyConverted(
  historyEntry: ConversionHistoryEntry | undefined,
  outputStillExists: boolean
): boolean {
  return historyEntry !== undefined && outputStillExists;
}

export function expandHomeDirectory(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

function showHelp() {
  print(`
HEIF to PNG v${VERSION} - Batch-convert HEIF images to PNG with macOS sips

Usage: heif-to-png [options]

Options:
  --input <dir>    Input directory to scan (default: ${DEFAULT_INPUT_DIRECTORY})
  --output <dir>   Output directory for PNGs (default: ${DEFAULT_OUTPUT_DIRECTORY})
  --dry-run        Show what would happen without converting
  --overwrite      Overwrite existing PNGs instead of adding -1, -2 suffixes
  --version        Show version number
  --help           Show this help message

Notes:
  - macOS only
  - Non-recursive: only files directly inside the input directory are processed
  - Uses a global history at ~/.config/heif-to-png/history.json to skip already converted files while their previous PNG still exists

Examples:
  heif-to-png
  heif-to-png --input ~/Downloads --output ./outputs
  heif-to-png --dry-run
  heif-to-png --overwrite
`);
}

function parseCliArguments(args: Array<string>): CliOptions {
  let inputDirectory = DEFAULT_INPUT_DIRECTORY;
  let outputDirectory = DEFAULT_OUTPUT_DIRECTORY;
  let dryRun = false;
  let overwrite = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;

    switch (arg) {
      case "--input": {
        const value = args[index + 1];
        if (!value || value.startsWith("-")) {
          throw new Error("--input requires a directory path");
        }
        inputDirectory = value;
        index++;
        break;
      }
      case "--output": {
        const value = args[index + 1];
        if (!value || value.startsWith("-")) {
          throw new Error("--output requires a directory path");
        }
        outputDirectory = value;
        index++;
        break;
      }
      case "--dry-run": {
        dryRun = true;
        break;
      }
      case "--overwrite": {
        overwrite = true;
        break;
      }
      default: {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  return {
    dryRun,
    inputDirectory: resolve(expandHomeDirectory(inputDirectory)),
    outputDirectory: resolve(expandHomeDirectory(outputDirectory)),
    overwrite,
  };
}

function formatErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("heif-to-png is macOS-only and requires the built-in `sips` command");
  }
}

async function assertDirectoryExists(directoryPath: string, label: string): Promise<void> {
  const directoryStats = await stat(directoryPath);
  if (!directoryStats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }
}

async function readDirectoryNames(directoryPath: string): Promise<Array<string>> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    const cause: unknown = error;
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function loadHistory(): Promise<ConversionHistory> {
  const historyFile = Bun.file(HISTORY_FILE);
  if (!(await historyFile.exists())) {
    return {};
  }

  const historyText = await historyFile.text();
  if (!historyText.trim()) {
    return {};
  }

  const parsed = conversionHistorySchema.safeParse(JSON.parse(historyText));
  if (!parsed.success) {
    throw new Error(`Invalid history file: ${HISTORY_FILE}`);
  }

  return parsed.data;
}

async function saveHistory(history: ConversionHistory): Promise<void> {
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await Bun.write(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`);
}

async function getFileHash(filePath: string): Promise<string> {
  const fileBuffer = await Bun.file(filePath).arrayBuffer();
  return createHash("sha256").update(Buffer.from(fileBuffer)).digest("hex");
}

export async function convertHeifToPngWithSips(
  inputPath: string,
  outputPath: string
): Promise<void> {
  assertMacOS();

  const processResult = Bun.spawn(["sips", "-s", "format", "png", inputPath, "--out", outputPath], {
    stderr: "pipe",
    stdout: "pipe",
  });

  const exitCode = await processResult.exited;
  if (exitCode === 0) {
    return;
  }

  const stdout = await new Response(processResult.stdout).text();
  const stderr = await new Response(processResult.stderr).text();
  const details = stderr.trim() || stdout.trim();
  throw new Error(details || `sips exited with status ${exitCode}`);
}

async function processDirectory(
  options: CliOptions,
  convertFile: ConvertFile = convertHeifToPngWithSips
): Promise<ConversionSummary> {
  await assertDirectoryExists(options.inputDirectory, "Input path");

  const directoryEntries = await readdir(options.inputDirectory, { withFileTypes: true });
  const sourceFiles = directoryEntries
    .filter((entry) => entry.isFile() && isSupportedHeifFile(entry.name))
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));

  const summary: ConversionSummary = {
    converted: 0,
    failed: 0,
    found: sourceFiles.length,
    skipped: 0,
  };

  if (sourceFiles.length === 0) {
    print(formatSummary(summary, options.dryRun));
    return summary;
  }

  const history = await loadHistory();
  const reservedNames = new Set(await readDirectoryNames(options.outputDirectory));

  if (!options.dryRun) {
    await mkdir(options.outputDirectory, { recursive: true });
  }

  for (const sourceFile of sourceFiles) {
    const inputPath = join(options.inputDirectory, sourceFile);
    const sourceHash = await getFileHash(inputPath);
    const historyEntry = history[sourceHash];
    const outputStillExists = historyEntry
      ? await Bun.file(historyEntry.outputPath).exists()
      : false;

    if (historyEntry && shouldSkipAlreadyConverted(historyEntry, outputStillExists)) {
      summary.skipped++;
      print(`Skipping ${sourceFile} -> already converted to ${historyEntry.outputPath}`);
      continue;
    }

    const outputFilename = getTargetOutputFilename(sourceFile, reservedNames, options.overwrite);
    const outputPath = join(options.outputDirectory, outputFilename);

    try {
      if (options.dryRun) {
        print(`Would convert ${sourceFile} -> ${outputFilename}`);
      } else {
        print(`Converting ${sourceFile} -> ${outputFilename}`);
        await convertFile(inputPath, outputPath);
        history[sourceHash] = {
          convertedAt: new Date().toISOString(),
          outputPath,
          sourceFilename: sourceFile,
        };
        await saveHistory(history);
      }

      summary.converted++;
      if (!options.overwrite) {
        reservedNames.add(outputFilename);
      }
    } catch (error) {
      summary.failed++;
      printError(`❌ Failed ${sourceFile}: ${formatErrorMessage(error)}`);
    }
  }

  print(formatSummary(summary, options.dryRun));
  return summary;
}

// CLI - only run when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    print(`heif-to-png ${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help")) {
    showHelp();
    process.exit(0);
  }

  try {
    assertMacOS();
    const options = parseCliArguments(args);

    print(
      options.dryRun
        ? `🔍 DRY RUN MODE v${VERSION} - no files will be converted\n`
        : `🚀 Starting heif-to-png v${VERSION}...\n`
    );
    print(`📁 Input directory: ${options.inputDirectory}`);
    print(`📁 Output directory: ${options.outputDirectory}`);
    print(`✍️  Overwrite mode: ${options.overwrite ? "on" : "off"}\n`);

    await processDirectory(options);
  } catch (error) {
    printError(`❌ ${formatErrorMessage(error)}`);
    process.exit(1);
  }
}
