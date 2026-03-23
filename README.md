# Screenshot & Image Renamer

[![Certified Shovelware](https://justin.searls.co/img/shovelware.svg)](https://justin.searls.co/shovelware/)

Uses the published `@mariozechner/pi-ai` package to automatically rename images with descriptive names.
Defaults to GPT-5.4 mini for filename suggestions when Pi auth or OpenRouter auth is available.

## Tools

### screenshot-renamer

Batch-renames macOS screenshots in a directory.

Transforms `Screenshot 2024-12-10 at 14.32.45.png` into `2024-12-10-14-32-slack-conversation-about-deployment.png`.

### image-renamer

Renames a single image file (any source, not just screenshots).

Transforms `signal-2025-11-19-14-23-47-588.jpg` into `cat-sleeping-on-keyboard.jpg`.

## Features

- Analyzes image content using GPT vision models
- Generates descriptive, kebab-case filenames
- `screenshot-renamer`: preserves date/time prefix, batch processes directories, analyzes up to 3 screenshots concurrently
- `image-renamer`: single file mode, outputs copy-pasteable `mv` command in dry-run
- Keeps history logs at `~/.config/{screenshot,image}-renamer/history.txt`

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
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

# Dry run
bun rename-screenshots.ts --dry-run ~/Desktop
bun image-renamer.ts --dry-run ~/Downloads/some-image.jpg
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
3. Sends image to GPT-5.4 mini via Pi auth or API-key fallback using `@mariozechner/pi-ai`
4. `screenshot-renamer` analyzes up to 3 screenshots at a time, then applies renames deterministically
5. Renames the file (screenshot-renamer preserves date/time prefix)
6. Logs all renames to history file

## License

MIT
