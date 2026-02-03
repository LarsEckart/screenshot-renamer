# Screenshot & Image Renamer

[![Certified Shovelware](https://justin.searls.co/img/shovelware.svg)](https://justin.searls.co/shovelware/)

Uses Claude Vision to automatically rename images with descriptive names.

## Tools

### screenshot-renamer

Batch-renames macOS screenshots in a directory.

Transforms `Screenshot 2024-12-10 at 14.32.45.png` into `2024-12-10-14-32-slack-conversation-about-deployment.png`.

### image-renamer

Renames a single image file (any source, not just screenshots).

Transforms `signal-2025-11-19-14-23-47-588.jpg` into `cat-sleeping-on-keyboard.jpg`.

## Features

- Analyzes image content using Claude Haiku (fast & cheap)
- Generates descriptive, kebab-case filenames
- `screenshot-renamer`: preserves date/time prefix, batch processes directories
- `image-renamer`: single file mode, outputs copy-pasteable `mv` command in dry-run
- Keeps history logs at `~/.config/{screenshot,image}-renamer/history.txt`

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Anthropic API key](https://console.anthropic.com/)

### Install

```bash
git clone https://github.com/user/screenshot-renamer.git
cd screenshot-renamer
./install.sh
```

This builds native binaries and installs them to `~/.local/bin/`.

### Uninstall

```bash
./install.sh --uninstall
```

### Set up your API key

Add to your shell config (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
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
git clone https://github.com/user/screenshot-renamer.git
cd screenshot-renamer
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
bun run biome check .
bun run biome format --write .
```

## How it works

1. **screenshot-renamer**: Scans directory for PNGs matching macOS screenshot pattern (last N days)
2. **image-renamer**: Takes a single image file as input
3. Sends image to Claude Haiku for analysis
4. Claude suggests a descriptive filename based on content
5. Renames the file (screenshot-renamer preserves date/time prefix)
6. Logs all renames to history file

## License

MIT
