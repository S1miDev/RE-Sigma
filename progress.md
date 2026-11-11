# Progress — Refig (local Figma-style editor)

Design: `docs/superpowers/specs/2026-11-10-refig-design.md` · Plan: `docs/superpowers/plans/2026-11-11-refig.md` · Research: `docs/reverse-engineering.md` · Format: `docs/project-format.md`

## Phases

| # | Phase | Status |
|---|-------|--------|
| 0 | Research Figma (reverse engineering) | ✔ done 2026-11-10 |
| 1 | Architecture + design doc | ✔ approved by the user 2026-11-11 |
| 2 | Implementation plan | ✔ 2026-11-11 |
| 3 | Scaffold (electron-vite, React, Tailwind) + secure window/preload | ✔ 2026-11-11 |
| 4 | Project store + `.refig` format + validation | ✔ 2026-11-11 |
| 5 | Home screen (project list, CRUD, states) | ✔ 2026-11-11 |
| 6 | Editor model (document ops, undo) + canvas renderer | ✔ 2026-11-11 |
| 7 | Tools, Layers, Design panel, menus | ✔ 2026-11-11 |
| 8 | Import (`.refig`, `.fig`) + export (project, PNG/SVG/PDF) | ✔ 2026-11-11 |
| 9 | App tests (Playwright/Electron) + packaging | ✔ 2026-11-11 |

## Commands

- `npm run dev` — run with hot reload (F12 opens DevTools in dev).
- `npm test` — logic + component tests (Vitest).
- `npm run typecheck` — TypeScript.
- `npm run test:e2e` — build, package unpacked, run Playwright against `dist/win-unpacked/Refig.exe`.
- `npm run dist` — Windows NSIS installer in `dist/`.

## Verification

Run on 2026-11-11:

- `npm test`: 59 tests pass (main-process store and formats, editor model, tools, store, components).
- `npm run typecheck`: clean.
- `npm run test:e2e`: 6 tests pass against `dist/win-unpacked/Refig.exe` (persistence across relaunch, save on window close, `.fig` import, `.refig` export and re-import with conflict, PNG/SVG/PDF export, renderer isolation).
- `npm run dist` step: `dist/Refig Setup 0.1.0.exe` built (122 MB, unsigned). The installer itself was not run.

Not verified by a person: the look and feel of drawing, text editing, rotation, layer drag-and-drop, image fills and clipboard image paste in the real window. They are covered by logic tests or by reading only.

The Electron binary had to be fetched by hand on this machine (slow network); `node_modules/electron/dist` must exist before `test:e2e` or `dist`.

## Deviations from the design (builder's calls)

- `shared/` holds two small runtime helpers besides types (`makeNode`/`emptyDocument`, `orderBetween`), because main (create, `.fig` import) and renderer both need them.
- The project name shown is the file name; `meta.name` records it at save time. A hand-renamed file therefore shows its new name.
- `.fig` order keys are regenerated on import (Figma's keys can end in the lowest character, which leaves no room to insert before them).
- Resize and rotate handles appear for a single selected layer. A multi-selection can be moved, nudged, grouped and edited in the panel, but not resized by handle.
- A new page's background is light (#F5F5F5) so the default black text and grey shapes are visible.
- Extra dev dependency `@fontsource-variable/inter` supplies the bundled Inter font.
- No file association for `.refig` (the app does not open a file passed on the command line).

## Known limits (marked `shortcut:` in code)

- Opacity multiplies per node; overlapping children of a translucent parent show through each other.
- Resizing a group scales rotated children along the group's axes (exact only for unrotated children).
- A rotated auto-width text drifts slightly as its box grows.
- SVG/PDF export references fonts by name; they are not embedded.
- PNG export crops to the layer's box, so a drop shadow outside the box is cut off.
- The project list reads every file fully on each refresh.
- `.fig` vector geometry is not decoded (vectors, boolean operations, components and instances are omitted and counted on import).

## Discovered issues

- Project folder is not a git repository.
- `out/` also holds research output (`message.json`, `schema.txt`) next to the build output; the packager only takes `out/main`, `out/preload`, `out/renderer`.
- Research Chrome profile (`%TEMP%\rea-chrome-profile`) is still signed in to Figma.
- The installer is unsigned: Windows SmartScreen warns on first run.
