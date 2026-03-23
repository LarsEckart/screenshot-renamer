#!/bin/bash
set -e

INSTALL_DIR="$HOME/.local/bin"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Uninstall mode
if [[ "$1" == "--uninstall" ]]; then
    removed=0
    for binary in screenshot-renamer image-renamer; do
        if [[ -f "$INSTALL_DIR/$binary" ]]; then
            rm "$INSTALL_DIR/$binary"
            echo -e "${GREEN}✓ Uninstalled $binary from $INSTALL_DIR${NC}"
            removed=1
        fi
    done
    if [[ $removed -eq 0 ]]; then
        echo -e "${YELLOW}No binaries found at $INSTALL_DIR${NC}"
    fi
    exit 0
fi

# Check for bun
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: bun is not installed${NC}"
    echo "Install it from https://bun.sh"
    exit 1
fi

# Get script directory (where the source code is)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📦 Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

echo "🔨 Building native binaries..."
bun build --compile --minify rename-screenshots.ts --outfile screenshot-renamer
bun build --compile --minify image-renamer.ts --outfile image-renamer

echo "📁 Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
mv screenshot-renamer "$INSTALL_DIR/"
mv image-renamer "$INSTALL_DIR/"

echo -e "${GREEN}✓ Installed screenshot-renamer to $INSTALL_DIR${NC}"
echo -e "${GREEN}✓ Installed image-renamer to $INSTALL_DIR${NC}"

# Check if INSTALL_DIR is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo -e "${YELLOW}⚠️  $INSTALL_DIR is not in your PATH${NC}"
    echo ""
    echo "Add it by adding this line to your shell config (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo ""
echo "Usage:"
echo "  screenshot-renamer [--dry-run] [--days N] [folder]"
echo "  image-renamer [--dry-run] <image-file>"
echo ""
echo "Auth options:"
echo "  - Preferred: Pi openai-codex auth in ~/.pi/agent/auth.json"
echo "  - Fallback:  OPENROUTER_API_KEY for GPT-5.4 mini"
echo "  - Fallback:  OPENAI_API_KEY for GPT-5 mini"
