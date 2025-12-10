#!/bin/bash
set -e

BINARY_NAME="screenshot-renamer"
INSTALL_DIR="$HOME/.local/bin"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Uninstall mode
if [[ "$1" == "--uninstall" ]]; then
    if [[ -f "$INSTALL_DIR/$BINARY_NAME" ]]; then
        rm "$INSTALL_DIR/$BINARY_NAME"
        echo -e "${GREEN}✓ Uninstalled $BINARY_NAME from $INSTALL_DIR${NC}"
    else
        echo -e "${YELLOW}$BINARY_NAME is not installed at $INSTALL_DIR${NC}"
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

echo "🔨 Building native binary..."
bun build --compile --minify rename-screenshots.ts --outfile "$BINARY_NAME"

echo "📁 Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
mv "$BINARY_NAME" "$INSTALL_DIR/"

echo -e "${GREEN}✓ Installed $BINARY_NAME to $INSTALL_DIR${NC}"

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
echo "Usage: $BINARY_NAME [--dry-run] [folder]"
echo ""
echo "Don't forget to set your ANTHROPIC_API_KEY environment variable!"
