# Screenshot & Image Renamer

[![Certified Shovelware](https://justin.searls.co/img/shovelware.svg)](https://justin.searls.co/shovelware/)

This repo contains Bun/TypeScript CLI tools for renaming images and converting HEIF files.
The AI-powered renamers use the published `@earendil-works/pi-ai` package and default to GPT-5.4 mini for filename suggestions when Pi auth or OpenRouter auth is available.

## Tools

### screenshot-renamer

Batch-renames macOS screenshots in a directory.

Transforms `Screenshot 2024-12-10 at 14.32.45.png` into `2024-12-10-14-32-slack-conversation-about-deployment.png`.

### image-renamer

Renames a single image file (any source, not just screenshots).

Transforms `signal-2025-11-19-14-23-47-588.jpg` into `cat-sleeping-on-keyboard.jpg`.

### heif-to-png

Batch-converts `.heic` and `.heif` images from a directory into PNGs.

Transforms `IMG_1234.HEIC` into `outputs/IMG_1234.png`.
Keeps a global history in `~/.config/heif-to-png/history.json` so reruns can skip files that were already converted while their previous PNG still exists.

## Features

- Analyzes image content using GPT vision models
- Generates descriptive, kebab-case filenames
- `screenshot-renamer`: preserves date/time prefix, batch processes directories, analyzes up to 3 screenshots concurrently, and renames each screenshot as soon as its suggestion returns
- `image-renamer`: single file mode, outputs copy-pasteable `mv` command in dry-run
- `heif-to-png`: macOS-only batch conversion using the built-in `sips` command, with dry-run, collision handling, and global duplicate detection via history
- Keeps history logs at `~/.config/{screenshot,image}-renamer/history.txt`

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
- For `heif-to-png`: macOS with the built-in `sips` command
- For the AI renamers:
  - Override: `--claude-api` uses `ANTHROPIC_API_KEY` for Anthropic Claude Haiku 4.5
  - Preferred: existing Pi `openai-codex` auth in `~/.pi/agent/auth.json`
  - Or: `OPENROUTER_API_KEY` for exact GPT-5.4 mini API-key access
  - Or: `OPENAI_API_KEY` for GPT-5 mini fallback

### Install

```bash
git clone https://github.com/LarsEckart/screenshot-renamer.git ~/GitHub/screenshot-renamer
cd ~/GitHub/screenshot-renamer
./install.sh
```

This builds native binaries and installs them to `~/.local/bin/`.

### Uninstall

```bash
./install.sh --uninstall
```

### Authentication

Preferred: reuse the same Pi auth you already use interactively. If `~/.pi/agent/auth.json` contains an `openai-codex` login, the tool will use that automatically.

If you pass `--claude-api`, the tool uses `ANTHROPIC_API_KEY` with Anthropic Haiku 4.5.

API-key fallbacks:

```bash
# Exact GPT-5.4 mini via API key
export OPENROUTER_API_KEY="your-api-key-here"

# Fallback if you only have a standard OpenAI API key
export OPENAI_API_KEY="your-api-key-here"
```

## Usage

### screenshot-renamer

```bash
# Rename screenshots in current directory (last 7 days)
screenshot-renamer

# Rename screenshots in a specific folder
screenshot-renamer ~/Desktop

# Use Anthropic Haiku 4.5 via ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=sk-ant-... screenshot-renamer --claude-api ~/Desktop

# Only process last 30 days
screenshot-renamer --days 30 ~/Desktop

# Preview changes without renaming (dry run)
screenshot-renamer --dry-run ~/Desktop
```

| Option                 | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `--days <n>`, `-d <n>` | Only process screenshots from last n days (default: 7) |
| `--dry-run`, `-n`      | Show what would be renamed without making changes      |
| `--help`, `-h`         | Show help message                                      |
| `--version`, `-v`      | Show version                                           |

### image-renamer

```bash
# Rename a single image
image-renamer ~/Downloads/signal-2025-11-19-14-23-47-588.jpg

# Preview (outputs a mv command you can copy-paste)
image-renamer --dry-run ~/Downloads/IMG_20231015_123456.jpg
```

| Option            | Description                                 |
| ----------------- | ------------------------------------------- |
| `--dry-run`, `-n` | Show suggested name and output `mv` command |
| `--help`, `-h`    | Show help message                           |
| `--version`, `-v` | Show version                                |

Supported formats: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`

### heif-to-png

> macOS only

```bash
# Convert HEIF images from ~/Downloads into ./outputs
heif-to-png

# Use explicit directories
heif-to-png --input ~/Downloads --output ./outputs

# Preview without converting
heif-to-png --dry-run

# Overwrite existing PNGs instead of creating suffixed names
heif-to-png --overwrite
```

| Option           | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `--input <dir>`  | Input directory to scan (default: `~/Downloads`)                            |
| `--output <dir>` | Output directory for PNGs (default: `./outputs`)                            |
| `--dry-run`      | Show what would happen without converting                                   |
| `--overwrite`    | Overwrite existing target PNGs instead of creating `-1`, `-2`, ... suffixes |
| `--help`         | Show help message                                                           |
| `--version`      | Show version                                                                |

`heif-to-png` keeps a global conversion history in `~/.config/heif-to-png/history.json`. If the same source image is seen again and its previously generated PNG still exists, it is skipped. If that old PNG is gone, the image is converted again.

## Development

### Setup

```bash
git clone https://github.com/LarsEckart/screenshot-renamer.git ~/GitHub/screenshot-renamer
cd ~/GitHub/screenshot-renamer
bun install
```

### Run directly

```bash
# Run without building
bun rename-screenshots.ts ~/Desktop
bun image-renamer.ts ~/Downloads/some-image.jpg
bun heif-to-png.ts --input ~/Downloads --output ./outputs

# Dry run
bun rename-screenshots.ts --dry-run ~/Desktop
bun image-renamer.ts --dry-run ~/Downloads/some-image.jpg
bun heif-to-png.ts --dry-run
```

### Test

```bash
bun test
```

### Lint & Format

```bash
bunx oxlint .
bunx oxfmt --check .
bunx oxfmt --write .
```

## How it works

1. **screenshot-renamer**: Scans directory for PNGs matching macOS screenshot pattern (last N days)
2. **image-renamer**: Takes a single image file as input
3. **heif-to-png**: Scans one directory level for `.heic` / `.heif` files and converts each one with `sips`
4. The AI renamers send images to GPT-5.4 mini via Pi auth or API-key fallback using `@earendil-works/pi-ai`
5. `screenshot-renamer` analyzes up to 3 screenshots at a time and renames each screenshot as soon as its suggestion is ready
6. The renamers rename files in place (screenshot-renamer preserves date/time prefix)
7. `heif-to-png` writes PNG copies to the output directory and leaves source files untouched
8. The renamers log all renames to history files

## License

MIT
