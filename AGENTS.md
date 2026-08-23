## Bun

- Run files and tests with `bun <file>` / `bun test`
- Tests import from `bun:test`
- Manage packages with `bun add` / `bun remove` / `bun install`
- Run package.json scripts with `bun run <script>`
- Execute one-off packages with `bunx <package> <command>`
- Build with `bun build <file>`
- `.env` loads automatically — no dotenv

## APIs

- Default to `Bun.file` for file I/O and `Bun.$` for shell commands

Bun API docs: `node_modules/bun-types/docs/**.mdx`.

## Versioning

Each script declares its own version: `const VERSION = "X.Y.Z"` at the top of `rename-screenshots.ts`, `heif-to-png.ts`, and `image-renamer.ts`. A bump applies only to the script you changed.

- **Patch (0.0.X)**: Bug fixes, minor tweaks
- **Minor (0.X.0)**: New features, non-breaking changes
- **Major (X.0.0)**: Breaking changes

Always ask or suggest a version bump when adding features or fixing bugs.
