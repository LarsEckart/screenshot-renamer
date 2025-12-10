# Screenshot Renamer

Uses Claude Vision to automatically rename macOS screenshots with descriptive names.

Transforms `Screenshot 2024-12-10 at 14.32.45.png` into `2024-12-10-14-32-slack-conversation-about-deployment.png`.

## Features

- Analyzes screenshot content using Claude Haiku
- Generates descriptive, kebab-case filenames
- Preserves date/time prefix from original filename
- Only processes screenshots from the last 7 days
- Keeps a history log at `~/.config/screenshot-renamer/history.txt`

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

This builds a native binary and installs it to `~/.local/bin/screenshot-renamer`.

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

```bash
# Rename screenshots in current directory
screenshot-renamer .

# Rename screenshots in a specific folder
screenshot-renamer ~/Desktop

# Preview changes without renaming (dry run)
screenshot-renamer --dry-run ~/Desktop
screenshot-renamer -n ~/Desktop
```

### Options

| Option | Description |
|--------|-------------|
| `--dry-run`, `-n` | Show what would be renamed without making changes |
| `--help`, `-h` | Show help message |

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
bun rename-screenshots.ts [folder]

# Dry run
bun rename-screenshots.ts --dry-run ~/Desktop
```

### Lint & Format

```bash
bun run biome check .
bun run biome format --write .
```

## How it works

1. Scans the target directory for PNG files matching macOS screenshot naming pattern
2. Filters to only screenshots created in the last 7 days
3. Sends each image to Claude Haiku for analysis
4. Claude suggests a descriptive filename based on the content
5. Renames the file, preserving the original date/time as a prefix
6. Logs all renames to `~/.config/screenshot-renamer/history.txt`

## License

MIT
