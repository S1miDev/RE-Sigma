# Refig — Design (local Figma-style desktop editor)

Status: draft for approval · 2026-11-10 · Inputs: the user's spec sections 1–8, `docs/reverse-engineering.md`.

## 1. Intent

Build a desktop design editor that runs entirely on the user's PC. It reproduces the core of Figma's design workflow: a project list, and an editor with pages, layers, canvas, tools and properties panel. Projects are local files. There is no account, no network and no server. The research phase (`docs/reverse-engineering.md`) defines what "Figma behaviour" means here; this document defines how we build it.

### Goals
- Create, open, autosave, rename, delete, import and export local projects, persisted across restarts.
- An editor whose visible controls all work (no decorative buttons).
- A documented, versioned project format.
- Best-effort import of Figma `.fig` files.
- Tested at three levels (logic, components, launched app), with a buildable and launchable package.

### Non-goals (v1)
- Cloud features: accounts, sharing, multiplayer, comments, version history, team libraries, community, plugins/widgets, AI, Dev Mode. The research tags all of them as server-dependent (§9).
- Writing `.fig` files: the format is proprietary and versioned.
- Feature parity with Figma.

### Anti-goals (a failure even if it "works")
- The renderer can reach Node, the filesystem or arbitrary IPC.
- Any path where an edit can be lost: a crash mid-save, a silent overwrite, or an import that replaces a project without asking.
- Controls that look clickable but do nothing.
- Dependencies or layers that duplicate each other (Angular + React, or Next.js inside Electron).

## 2. Constraints

- Stack from the spec: Electron, React, Tailwind CSS, Testing Library, Node.js. Angular and Next.js are evaluated and rejected (§9).
- Windows is the user's platform. Nothing in the code is Windows-only.
- Electron 45 (Node 24, Chrome 156). Node 24's `zlib` provides zstd and raw-deflate, both needed to read `.fig`.
- Work is tracked in `progress.md` (spec §8).

## 3. Approaches considered

**Where projects live** (decided):

| Option | Trade-off |
|---|---|
| A. Loose files anywhere plus a "recent files" list (Sketch model) | Simplest, but the spec needs "display available local projects" and import; a recents list forgets files. |
| B. Hidden library in the app's data folder | Closest to Figma's file browser, but the user can't see, back up or move their files without export. |
| **C. Visible workspace folder; one `.refig` file per project** | **Chosen.** Persistent, transparent, backup-friendly and needs no database. The list is a folder scan, so files copied in by hand appear too. |

The spec defines a project as one design document (operations are per project: create, open, rename, delete, import, export). Figma's "projects as folders of files" is therefore not reproduced; that was our call.

**Renderer** (our call): Canvas 2D drawn by our own code, versus SVG DOM, versus a library such as Konva or Pixi.
- Canvas 2D matches Figma's single-canvas model (research §1), scales to many layers and needs no dependency.
- SVG DOM is easier to hit-test, but gets slow with many nodes and blurs the line between editor UI and document.
- A canvas library adds a dependency and its own scene graph, which would duplicate our document model.

**Build tooling** (our call): `electron-vite` (one config for main, preload and renderer, with Vite HMR), versus Electron Forge + Webpack (heavier and slower), versus hand-rolled Vite + tsc (more configuration to maintain).

## 4. Architecture

```
src/
  shared/            types only, imported by all three processes
    document.ts      node model (§5)
    api.ts           the RefigApi interface = the complete IPC contract
  main/              Electron main process (Node). Only place that touches disk/dialogs.
    index.ts         app lifecycle, BrowserWindow with locked-down webPreferences, CSP, menu
    ipc.ts           one ipcMain.handle per RefigApi method; validates every argument
    workspace.ts     resolves workspace dir (REFIG_WORKSPACE env > default Documents/Refig Projects)
    projects.ts      list/create/open/save/rename/delete/duplicate; atomic writes; id→path map
    format/refig.ts  read/write .refig zip + validate()
    format/fig.ts    .fig → Refig document (uses kiwi decoder, moved from research/kiwi.mjs)
    format/kiwi.ts   Kiwi schema+message decoder
    export.ts        PNG/SVG/PDF file writing (bytes come from renderer)
  preload/
    index.ts         contextBridge.exposeInMainWorld('refig', {...}) — named functions only
  renderer/          React app (no Node). Talks to main only via window.refig.
    main.tsx, App.tsx          routes: Home ⇄ Editor (in-memory router, no library)
    ui/                        reusable components (Button, IconButton, Input, NumberField,
                               ColorField, Menu, Dialog, PanelSection, Toast, EmptyState, Spinner)
    home/                      project grid, toolbar, rename/delete/import/export flows
    editor/
      model/                   pure TS: document ops, undo/redo, selection, fractional order keys
      canvas/                  Canvas2D renderer, viewport (zoom/pan), hit-test, snapping, handles
      tools/                   Move, Hand, Frame, Rectangle, Ellipse, Line, Text
      panels/                  LeftPanel (Pages, Layers), DesignPanel, Toolbar, MainMenu
      export/                  render node → PNG (canvas) / SVG (serializer) / PDF (via main)
      store.ts                 document store (useSyncExternalStore; no state library)
```

### 4.1 Process boundary and security
- `BrowserWindow` webPreferences: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`. This mirrors Figma Desktop (research §2).
- CSP: `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'`.
- Navigation and `window.open` are denied (`will-navigate`, `setWindowOpenHandler`). The app loads no remote content.
- Preload exposes one object, `window.refig`, typed by `RefigApi`. Each method calls `ipcRenderer.invoke` on a fixed channel name. Nothing generic is exposed (no `send(channel, …)`).
- **The renderer never handles file paths for projects.** Projects are addressed by id. `main/projects.ts` maps ids to paths inside the workspace and rejects anything else. Paths appear only as the *result* of a native dialog that main itself opened.
- `ipc.ts` validates every argument (types, lengths, id format, document shape) before acting. A bad call rejects with a typed error.

### 4.2 The IPC contract (`RefigApi`)
```
listProjects(): ProjectSummary[]                      // id, name, modifiedAt, thumbnail (data URL)
createProject(name): ProjectSummary
openProject(id): { summary, document, images: Record<hash, Uint8Array> }
saveProject(id, document, thumbnailPng?): ProjectSummary
addImage(id, bytes): hash                             // stored in main's open-project session
renameProject(id, newName): ProjectSummary
deleteProject(id): void                               // moves file to OS trash
duplicateProject(id): ProjectSummary
importProjects(): ImportResult[]                      // main opens the file dialog
resolveImportConflict(token, 'replace'|'keepBoth'|'cancel'): ImportResult
exportProject(id): { path } | null                    // main opens the save dialog
exportImage(bytes, suggestedName, kind): { path } | null
```

## 5. Data model and project format

### 5.1 Document (`shared/document.ts`)
- `Document { formatVersion: 1, pages: PageId[], nodes: Record<NodeId, Node> }`. The node map is flat, with `parentId` and a fractional `order` string, as in Figma's `NodeChange` + `parentIndex.position` (research §6.2). Reordering never rewrites siblings.
- `Node` common fields: `id, type, name, parentId, order, visible, locked, x, y, width, height, rotation, opacity`.
  - Types: `PAGE`, `FRAME`, `GROUP`, `RECTANGLE`, `ELLIPSE`, `LINE`, `TEXT`.
  - Visual fields: `fills: Paint[]` (SOLID, IMAGE), `strokes: Paint[] + strokeWeight + strokeAlign`, `effects: DropShadow[]`, `cornerRadius`, `clipsContent` (frames).
  - Text fields: `characters, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, textAlign`.
- `x, y` are relative to the parent frame or group, matching Figma's parent-relative transform. Colours are floats 0–1, as in Figma.
- Ids are random strings (`crypto.randomUUID`). Order keys are generated by a small fractional-indexing function (with tests).

### 5.2 `.refig` file
```
<name>.refig  (ZIP, via fflate)
  meta.json       { format: "refig", formatVersion: 1, id, name, createdAt, modifiedAt, appVersion }
  document.json   Document (§5.1)
  thumbnail.png   optional, ≤ 400×400
  images/<sha256> raw image bytes referenced by IMAGE paints
```
- This layout mirrors `.fig` (zip + meta + thumbnail + images, research §6.2), but uses JSON for readability and stability.
- The format is documented in `docs/project-format.md`, which is part of the deliverable.
- **Version rule:** a reader accepts `formatVersion ≤ current` and runs migrations; a higher version is refused with "made by a newer Refig".

### 5.3 Storage
- Workspace: `REFIG_WORKSPACE` if set (tests), else `<Documents>/Refig Projects/`, created on first launch.
- Listing scans `*.refig`, reading only `meta.json` and `thumbnail.png` from each. Unreadable files are listed as "damaged" with a reason; they are never deleted automatically.
- Two files with the same `meta.id` (for example, copied by hand): the later one gets a fresh id on first open.
- **Atomic save:** write `<name>.refig.tmp`, fsync, then rename over the original. A crash leaves either the old or the new file, never half of one.
- **Autosave:** the editor saves 1 s after the last change, when leaving the editor, and on window close (`before-unload` waits for the save). Ctrl+S saves immediately. The title shows "Saving…/Saved/Save failed". A failed save keeps the document in memory and retries; the user sees the error.
- Rename = rename file + update `meta.name`. Name rules: trimmed, 1–100 chars, Windows-illegal characters replaced. A name clash is an error shown inline.
- Delete = `shell.trashItem` (recoverable), after a confirmation dialog.

## 6. Import and export

**Import** (`importProjects`): main opens a dialog filtered to `.refig` and `.fig`, with multi-select.
1. Size caps: file ≤ 500 MB; total unzipped ≤ 1 GB; entry count ≤ 10 000. Exceeding a cap rejects the file (zip-bomb guard).
2. Zip entries are allow-listed by name pattern. Any `..`, absolute path or unexpected entry is rejected.
3. `.refig`: validate `meta.json` and `document.json` (hand-written validator: types, references, parents exist, no cycles, version rule). `.fig`: check the `fig-kiwi` magic, decode, and map `NodeChange` → Node. Unsupported types and fields are counted and reported ("imported with 12 layers omitted: VECTOR ×8, INSTANCE ×4"). The import never fails because of one unsupported layer.
4. Nothing is written until validation passes. Invalid files produce a per-file error result; other files in the same batch continue.
5. Conflict (same id or same name exists): the result carries a conflict token. The UI asks **Replace** (old file to trash) / **Keep both** (new id, "Name (2)") / **Cancel**.

`.fig` mapping (v1): CANVAS→PAGE; FRAME→FRAME, or GROUP when flagged as a group; ROUNDED_RECTANGLE/RECTANGLE→RECTANGLE; ELLIPSE; LINE; TEXT (characters, font, size); fills (SOLID; IMAGE when the blob exists in `images/`); strokes; opacity; transform → x, y, rotation. The hidden "Internal Only Canvas" is skipped. Everything else is omitted and reported.

**Export:**
- Project: `exportProject(id)` opens a save dialog (default `<name>.refig`) and copies the file byte for byte.
- Design export (editor, File → Export…, and the Export section of the Design panel): the selected node is exported as PNG (1×/2×/3×, rendered by our canvas renderer offscreen), SVG (our serializer) or PDF (an SVG page printed via `webContents.printToPDF` in a hidden window). This matches Figma's formats (research §7). JPG is cut from v1.

## 7. UI (v1 scope — our call; the user may move items in or out)

- **Home:** grid of project cards (thumbnail, name, modified time). Toolbar: New, Import. Card menu: Open, Rename, Duplicate, Export, Delete. States: loading (skeleton), empty ("No projects yet" + New/Import), error (workspace unreadable, with Retry), damaged-file card.
- **Editor layout** (from research §1): top bar (main menu, file name with rename, back to Home, save status, zoom menu); left panel (Pages: add, rename, delete, reorder; Layers tree: select, rename, hide, lock, drag to reorder or reparent); centre canvas; right Design panel; bottom toolbar.
- **Tools and shortcuts** (identical to Figma, research §3.1): Move V, Hand H (and Space-drag), Frame F, Rectangle R, Ellipse O, Line L, Text T.
- **Canvas behaviour:**
  - Click and marquee select; Shift adds to the selection; Ctrl+A; Esc.
  - Drag to move, arrow-key nudge (1 px, Shift 10 px).
  - 8 resize handles (Shift keeps aspect ratio, Alt resizes from the centre) and a rotate handle.
  - Snapping to sibling and parent edges and centres.
  - Zoom: Ctrl+wheel, pinch, Ctrl+±, Shift+1 fit, Shift+2 selection, Ctrl+0 for 100%.
  - Pan: wheel or Space-drag.
  - Dropping a shape inside a frame parents it to the frame.
- **Edit commands:** Undo Ctrl+Z, Redo Ctrl+Y/Ctrl+Shift+Z, Copy, Paste, Cut, Duplicate Ctrl+D, Delete, Group Ctrl+G, Ungroup Ctrl+Shift+G, Frame selection Ctrl+Alt+G, Bring forward/back `]`/`[`, Show/hide Ctrl+Shift+H, Lock Ctrl+Shift+L.
- **Design panel:** X/Y/W/H, rotation, corner radius, opacity, fills (add/remove/toggle; solid colour picker with hex and alpha; image fill from file), stroke (colour, weight, align), drop shadow (x, y, blur, spread, colour), text (family from a fixed list plus bundled Inter, weight, size, line height, letter spacing, align), clip content (frames), Export section. With nothing selected it shows page background, as in Figma.
- **Main menu:** only implemented commands, grouped like Figma (File, Edit, View, Object, Arrange). Each item shows its shortcut.
- **Out of v1:** Pen/vector editing, boolean ops, auto layout, components and instances, styles and variables, prototyping, comments, plugins, Dev Mode, text on path, sections, slices. None of them appear in the UI.
- Desktop-first layout: minimum window 1024×640; the side panels are resizable and collapsible (Ctrl+\\ hides the UI).

## 8. Testing (spec §7)

| Layer | Tool | Covers |
|---|---|---|
| Logic | Vitest (node) | projects store on a temp workspace (create/save/load/rename/delete/duplicate/import/export, conflicts, damaged files, atomic save under a simulated failure); refig validate + round-trip; `.fig` import from `research/fixtures/Untitled.fig`; kiwi decoder; fractional order; document ops + undo/redo; viewport maths, hit-testing, snapping |
| Components | Vitest + jsdom + Testing Library + user-event | Home states (loading/empty/error/damaged); create/rename/delete/import-conflict dialogs; Home⇄Editor navigation; tool switching by click and shortcut; Layers select/rename/hide; Design panel edits change the node; save-status display. `window.refig` is a typed in-memory fake. |
| App | Playwright `_electron` | build, launch against a temp `REFIG_WORKSPACE`; create → draw rectangle → quit → relaunch → rectangle still there; import the `.fig` fixture; export `.refig` and re-import it; security check (`typeof require`, `typeof process` are `undefined` in the page; `window.refig` has only the contract keys) |

`npm test` runs logic + components; `npm run test:e2e` builds and runs the app tests. "Done" for any task means its tests pass.

**Standalone build (spec §9):** `npm run dist` runs `electron-builder` and produces a Windows NSIS installer (per-user install, Start-menu shortcut, uninstaller) plus the unpacked app in `dist/`. The app tests launch the unpacked build, so the shipped artefact is the one tested. The installer is unsigned: Windows SmartScreen will warn on first run, and code signing needs a certificate the user doesn't have. `npm run dev` runs the app with hot reload for development.

## 9. Backend and framework decisions (spec §6)

- **No backend.** Every v1 feature is local: file I/O and zip in main, editing in the renderer. Nothing needs a server.
- **No Next.js:** no server rendering, routing or API routes are needed inside Electron.
- **No Angular:** React covers the UI; two frameworks would duplicate each other.
- **No cloud infrastructure.**
- **External integrations:** none in v1. The only outward-facing surfaces are the OS file dialogs, the OS trash and the default folder.

## 10. Dependencies

Runtime: `react`, `react-dom`, `fflate`.
Dev: `electron`, `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript`, `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@playwright/test`, `electron-builder`.

No state library, router, UI kit, icon library (we use a small set of inline SVG icons) or colour-picker library.

## 11. Process (spec §8)

- `progress.md` at the repo root: phases, completed work, remaining work, discovered issues. It is updated after each significant task.
- Phases: 0 research ✔ → 1 design (this doc) → 2 plan → 3 scaffold + security shell → 4 projects store + format → 5 Home UI → 6 editor model + canvas → 7 tools + panels → 8 import/export → 9 app tests + packaging.
- Before each phase, check the actual files, not just `progress.md`.

## 12. Settled during review (our calls)

- One editor window; one open project at a time. Opening another project autosaves the current one first.
- Copy and paste use an in-app clipboard for the session, so layers paste across projects within one session. Pasting images from the system clipboard creates an image fill rectangle.
- Text is auto-width when created by a click and fixed-width when created by a drag or resized. Wrapping is greedy by word.

## 13. Left to the builder

- Exact Tailwind palette values. Use the neutral dark greys and blue accent seen in the research screenshots.
- Icon drawings.
- Snapping threshold (start at 5 screen px).
- Debounce timings within ±50%.
- Internal file splits inside each module.
