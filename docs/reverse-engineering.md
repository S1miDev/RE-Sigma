# Figma — Reverse-Engineering Report (Phase 1)

Research date: 2026-11-10. Target: Figma web editor (www.figma.com, Chrome 157) and Figma Desktop for Windows **126.11.8**.
Purpose: decide what a local, offline Electron app ("the app") has to reproduce, and what it cannot.

## Evidence legend

Every claim is tagged:

| Tag | Meaning |
|-----|---------|
| **[C] Confirmed** | Verified from an authoritative artifact: Figma's official npm type packages, bytes of a shipped binary, or bytes of a `.fig` file Figma produced. |
| **[O] Observed** | Seen in the live logged-in UI during this session (screenshots in `docs/evidence/shots/`). |
| **[I] Inferred** | A conclusion drawn from C/O evidence, not directly seen. |
| **[U] Unknown** | Not investigated or not accessible. |

### Sources

| # | Source | Identity |
|---|--------|----------|
| S1 | `@figma/plugin-typings@1.142.0` (official Plugin API types) | npm |
| S2 | `@figma/rest-api-spec@0.47.0` (official REST OpenAPI spec) | npm |
| S3 | `FigmaSetup.exe` → `Figma-126.11.8-full.nupkg` → `app.asar` | installer sha256 `90b646ef…2f84a3`; REA evidence `ev_81bece35…`, `ev_32e41070…`, fuses `ev_1da4c17a…` |
| S4 | Live editor via Chrome DevTools Protocol, test draft file `VzJl0yIaGSs92jGioZYPzF` | `research/cdp.mjs` |
| S5 | `.fig` produced by **File → Save local copy…** of that draft | sha256 `ac4e49ca…819c31`, decoded with `research/kiwi.mjs`; schema in `docs/evidence/fig-kiwi-schema-v106.txt` |

---

## 1. Main interface and layout

Screenshot: `shots/01-editor.png`, `shots/10-frame-selected.png`.

```
┌────┬──────────────────────┬──────────────────────────────┬──────────────────┐
│Rail│ File name ▾  Drafts  │                              │ Avatar ▶▾ Share  │
│File│──────────────────────│                              │ Design|Prototype │
│Agnt│ Pages        🔍 +    │          CANVAS              │           Zoom ▾ │
│Asst│  Page 1              │   (single <canvas>, WASM)    │──────────────────│
│Tool│  …                   │                              │ Properties panel │
│Vars│ Layers               │                              │ (context-driven) │
│    │  tree…               │    ┌── bottom toolbar ──┐    │                  │
└────┴──────────────────────┴────┴────────────────────┴────┴──────────────────┘
```

- **[O]** Far-left icon rail: Main menu (Figma logo), **File, Agents, Assets, Tools, Variables**.
- **[O]** Left panel: file name with menu, location ("Drafts", plan badge "Free"), **Pages** list (search, add page), **Layers** tree (lock and visibility toggles on hover, expand arrows, type icons).
- **[O]** Centre: infinite canvas. **[O]** It is one `<canvas>` element filling the area between the panels.
- **[O]** Bottom floating toolbar (tool groups, see §3), plus a mode switch: **Draw / Design / Motion (beta) / Dev Mode**.
- **[O]** Right panel, top: multiplayer avatars, **Present** (▶) and prototype view menu, **Share**, tabs **Design | Prototype**, zoom % menu.
- **[O]** Right panel with no selection: **Page** (background colour + opacity + visibility), **Styles** (Text, Color, Effect, Layout guide styles), **Export**, **MCP** connection.
- **[O]** Right panel with a frame selected: type switcher ("Frame ▾"), **Position** (alignment, X/Y, rotation, flip), **Auto layout** (flow: free/vertical/horizontal/grid, wrap, W/H with Hug/Fill/Fixed, alignment 3×3, gap, padding, clip content), **Appearance** (opacity, corner radius), **Fill**, **Stroke**, **Effects**, **Selection colors**.
- **[O]** Floating help "?" button bottom-right.
- **[O]** Dark theme in use; **[O]** Preferences → Theme exists.

## 2. Navigation and application structure

- **[O]** Two top-level surfaces: the **file browser** (`/files/...`) and the **editor** (`/design/<fileKey>/<name>?node-id=<a>-<b>`). The URL `node-id` mirrors the selected node GUID `1:176` → `1-176`.
- **[O]** File browser sidebar: team switcher, Notifications, **Recents**, **Drafts**, All folders, Resources, **Trash**, **Starred**, team **projects**; content tabs Recently viewed / Shared files / Shared folders. Screenshot `shots/07-file-browser.png`.
- **[O]** Main menu (editor): Back to files, Actions… (Ctrl+K), **File, Edit, View, Object, Text, Arrange, Vector**, Plugins, Widgets, Preferences, Libraries, Open in desktop app, AI balance, Help and account.
- **[C]** Figma Desktop is an **Electron shell around the website**. It loads `https://www.figma.com` (S3 `main.js` URL strings) and adds tabs, windows, native menus, a tray icon, local fonts and native file writes. Its `package.json` declares a single dependency (`chokidar`). No editor logic is shipped in the asar.
- **[C]** Desktop shell structure (S3, REA): 4 `BrowserWindow`s, all with `contextIsolation: true` and `nodeIntegration: false`; preloads such as `web_app_binding_renderer.js` and `shell_app_binding_renderer.js`; one context-bridge API with 55 members for tab management (`openNewTab`, `closeTab`, `reorderTabs`, `setTabGroupName`, …), windows (`minimizeWindow`, `toggleWindowMaximize`), updates (`installUpdateNow`), and the file browser (`showFileBrowser`).
- **[C]** Desktop native menu IDs (S3): `new_file, new_tab, new_window, import, import_from_csv, export, export_as, export_frames_to_pdf, export_slides_to, save_local_copy, save_to_version_history, open_file_browser, preferences, interface_scale_*, color_space_*, graphics_backend, plugins_menu, widgets_menu, troubleshooting_menu`, plus standard edit/view/window menus.

## 3. Important UI components

### 3.1 Toolbar tools [O]

| Group | Tools (shortcut) |
|-------|------------------|
| Move | Move (V), Hand (H), Scale (K) |
| Region | Frame (F), Section (Shift+S), Slice (S) |
| Shape | Rectangle (R), Line (L), Arrow (Shift+L), Ellipse (O), Polygon, Star, Image/video… (Ctrl+Shift+K) |
| Creation | Pen (P), Pencil (Shift+P) |
| Type | Text (T), Text on path |
| Code | Code (B), Spec (D) |
| — | Comment (C), Actions (command palette) |

### 3.2 Menus [O]

- **File:** New, Place image… (Ctrl+Shift+K), Duplicate, **Save local copy…**, Save to version history… (Ctrl+Alt+S), Show version history, **Export…** (Ctrl+Shift+E), **Export frames to PDF…**, Create branch…
- **Edit:** Undo (Ctrl+Z), Redo (Ctrl+Y), Copy as, Paste over selection, Paste to replace, Duplicate (Ctrl+D), Delete, Find/Find next/previous, Find and replace…, Set default properties, Copy/Paste properties, Pick color (I), Select all/matching/none/inverse, Select all with.
- **View:** Pixel grid, Layout guides, Rulers, Show slices, Comments, Annotations, Outlines, Pixel preview, Mask/Frame outlines, Memory usage, Minimize UI, Show/Hide UI (Ctrl+\\), Multiplayer cursors, Switch to Draw/Dev Mode, Panels, Zoom in/out/100%/fit/selection, Previous/next page and frame.
- **Object:** Frame selection (Ctrl+Alt+G), Group/Ungroup (Ctrl+G), Wrap in/Convert to section, Use as mask, Add auto layout (Shift+A), Create component (Ctrl+Alt+K), Slots, Reset/Detach instance, Bring to front/forward, Send backward/to back, Flip H/V, Rotate 180/90, Flatten, Outline stroke, Boolean groups, Show/Hide, Lock/Unlock, Remove fill/stroke, Swap fill and stroke, Remove interactions.
- **Text:** Bold, Italic, Underline, Strikethrough, Create link, Bulleted/Numbered list, Alignment, Adjust, Case, Text direction, Spell check.
- **Arrange:** Round to pixel, Align ×6, Tidy up, Pack H/V, Distribute spacing/edges/centres.
- **Vector:** Join, Smooth join, Delete and heal, Split, Simplify, Offset.
- **Preferences:** snapping (geometry, objects, pixel grid), keep tool selected, zoom behaviour, nudge amount, theme, colour profile, keyboard layout, accessibility.
- **Zoom menu:** Zoom in/out/fit/50/100/200%, Pixel preview, Pixel grid, Snap to pixel grid, Layout guides, Rulers, Outlines, Multiplayer cursors, Comments.
- **Actions (Ctrl+K):** searchable command palette with tabs All / Assets / Plugins & widgets.

## 4. User interactions and workflows

- **[O]** Select via the Layers tree updates canvas selection, URL `node-id` and the properties panel.
- **[O]** Selecting via the Plugin API (`figma.currentPage.selection = …`) does *not* refresh the properties panel; only UI input does.
- **[O]** Selection shows a size label on canvas ("250 Hug × 81").
- **[O]** Changing pages from the Pages list re-renders the canvas and auto-zooms (29%).
- **[O]** Save local copy: toast "Downloading contents… / Cancel / Save partial file". Then the browser downloads `Untitled.fig` (blob, `application/zip`, 41 589 bytes).
- **[O]** The work stalls while the tab is hidden (`visibilityState: hidden`) and continues when it is focused.
- **[I]** The app needs these canvas interactions: create by tool and drag, select, multi-select, move, resize handles, nudge, zoom and pan, undo/redo. The tools and shortcuts are confirmed in §3. The pointer-level behaviour (snapping thresholds, handle hit areas) was **not measured** **[U]**.

## 5. Project creation and management

- **[O]** File browser "New file" menu: **Design, FigJam, Slides, Make, Spec, Buzz, Site, Import**.
- **[O]** Files belong to Drafts or team Projects; the browser offers Starred, Recents, Trash and Shared views.
- **[C]** Cloud hierarchy in the REST API (S2): `teams → projects → files`, `/v2/folders/{id}/folders|files`, plus `/v1/files/{key}/versions`, `/comments`, `/components`, `/styles`, `/variables`.
- **[C]** File metadata in the REST `GetFileResponse` includes `name, role, lastModified, editorType ('figma'|'figjam'), thumbnailUrl, version, document, components, componentSets, styles`.
- **[I]** For a local app: "project" = a folder or library of `.fig`-like files, and "file" = one document with pages. Teams, sharing, roles and branches are cloud concepts with no local equivalent.

## 6. Data structures and persistence

### 6.1 Document tree (logical model) [C]

- Tree: `DOCUMENT → CANVAS (page) → scene nodes` (S1, S2, S5).
- Scene node types in the Plugin API (S1): Slice, Frame, Group, ComponentSet, Component, Instance, BooleanOperation, Vector, Star, Line, Ellipse, Polygon, Rectangle, Text, TextPath, TransformGroup, Section, Table, plus FigJam/Slides types (Sticky, Connector, ShapeWithText, CodeBlock, Stamp, Widget, Embed, LinkUnfurl, Media, Highlight, WashiTape, Slide…).
- Paints: `Solid | Gradient | Image | Video | Pattern | Shader` (S1). File enum `PaintType`: SOLID, GRADIENT_LINEAR/RADIAL/ANGULAR/DIAMOND, IMAGE, EMOJI, VIDEO, PATTERN, NOISE, CUSTOM (S5).
- Effects (S5): INNER_SHADOW, DROP_SHADOW, FOREGROUND_BLUR, BACKGROUND_BLUR, REPEAT, SYMMETRY, GRAIN, NOISE, GLASS, CUSTOM.
- Blend modes (S5): PASS_THROUGH, NORMAL, DARKEN, MULTIPLY … LUMINOSITY (19 values).
- Auto layout `StackMode` (S5): NONE, HORIZONTAL, VERTICAL, GRID. Constraints: MIN, CENTER, MAX, STRETCH, SCALE.
- Styles: PAINT, TEXT, EFFECT, GRID (S1). Variables and variable collections exist as first-class data (S1, S5).

### 6.2 The `.fig` file format [C] (from S5)

```
Untitled.fig  = ZIP
 ├─ canvas.fig      binary document
 ├─ meta.json       {client_meta:{background_color, thumbnail_size, render_coordinates}, file_name, developer_related_links, exported_at}
 ├─ thumbnail.png   400×400 preview
 └─ images/         image blobs (empty in sample)

canvas.fig = "fig-kiwi" (8 bytes) + uint32 LE version (106)
           + [uint32 LE length + chunk] ×2
   chunk 0: Kiwi *binary schema*, raw-DEFLATE   (672 definitions)
   chunk 1: Kiwi *Message*, Zstandard           (the document)
```

- **[C]** The file carries its own schema, so a reader decodes it without knowing Figma's version in advance. `research/kiwi.mjs` (≈80 lines, no dependencies) decodes it fully.
- **[C]** The root `Message` has `type = NODE_CHANGES`, `nodeChanges[]` (a **flat list**, 92 in the sample) and `blobs[]` (51 in the sample; binary geometry such as `fillGeometry.commandsBlob` points into this array by index).
- **[C]** Each `NodeChange` has: `guid {sessionID, localID}`, `phase` (CREATED/REMOVED), `parentIndex {guid, position}`, `type`, `name`, `visible`, `opacity`, `size {x,y}`, `transform {m00..m12}` (2×3 affine), `fillPaints[]`, `strokeWeight/Align/Join`, `fillGeometry[]` and many more. The schema lists 622 possible fields.
- **[C]** **Tree order** uses `parentIndex.position`, a fractional-index string compared lexicographically (`"!"`, `"\""`, `"6O"`, `"~!"`). Inserting between siblings never renumbers them.
- **[C]** Internal type names differ from the public API: `ROUNDED_RECTANGLE` = Rectangle, `SYMBOL` = Component, `REGULAR_POLYGON` = Polygon. Groups and component sets are stored as `FRAME` with flags.
- **[C]** Styles and variables live as nodes (`VARIABLE_SET`, `VARIABLE`, style-carrying `ROUNDED_RECTANGLE`/`TEXT`/`FRAME`) on a hidden page **"Internal Only Canvas"**.
- **[C]** Colours are stored as floats 0–1 (`{r,g,b,a}`) plus `authoredColor` with a colour space.
- **[C]** The same `Message` schema also defines multiplayer messages (`MessageType`: JOIN_START, NODE_CHANGES, USER_CHANGES, SIGNAL, DIFF, …). **[I]** A `.fig` file is therefore a snapshot of the multiplayer sync stream.
- **[I]** The schema is versioned (v106 here) and changes over time. An importer must read the embedded schema and tolerate unknown fields, which `kiwi.mjs` already does.

### 6.3 Persistence [C/O]

- **[C/O]** The canonical store is Figma's cloud. The web app has no local document storage path. A local file exists only through **Save local copy** (`.fig`) or Export.
- **[C]** Desktop keeps shell state locally (`desktop_state.json`: windows, tabs) (S3).
- **[O]** Saving a local copy is logged server-side (`/api/file_download_log` request seen).

## 7. Import and export

| Direction | What | Evidence |
|-----------|------|----------|
| Export | `.fig` via Save local copy | **[C]** S5 |
| Export | Node export formats **PNG, JPG, SVG, PDF** with settings (scale/constraint, SVG outline text and ids, PDF), plus `JSON_REST_V1` from plugins | **[C]** S1 `ExportSettings` |
| Export | File → Export… (Ctrl+Shift+E), Export frames to PDF…; panel "Export +" per node | **[O]** |
| Export (desktop) | Native file writes restricted to extensions `.fig .jam .deck .jpg .pdf .png .svg .json .lottie`, path-traversal checked, overwrite confirmation | **[C]** S3 `main.js` `web:writeFiles` |
| Import | File browser → New file → **Import**: "Import images, Sketch files, PowerPoints, and PDFs", *Import from computer*; file input `accept=""` (any), `multiple=true` | **[O]** `shots/09-import.png` |
| Import | `.fig` import | **[I]** Figma's own format is expected to be importable (desktop menu has `import`). **Not exercised [U]** |
| Import | Place image… (Ctrl+Shift+K) in the editor | **[O]** |
| Import | Import from CSV (desktop menu `import_from_csv`) | **[C]** menu ID exists; behaviour **[U]** |

## 8. Required APIs, services and dependencies

- **[O]** Editor engine: `static.figma.com/fullscreen/<hash>/fullscreen-wasm/compiled_wasm.js` (a WebAssembly build of the core engine) rendering into a single canvas. **[O]** WASM-backed types are exposed on `window` (`WasmTileStackTile`). **[O]** `navigator.gpu` (WebGPU) is available. Which graphics backend is active is **[U]** (desktop menu `graphics_backend` exists **[C]**).
- **[O]** UI chrome: Webpack bundles (`webpack-artifacts/assets/vendor-core-*.js`, `runtime~figma_app-*.js`). **[I]** It is React.
- **[O]** HTTP APIs used by the editor (partial; the browser's resource buffer was full): `/api/session`, `/api/files`, `/api/folders`, `/api/plans`, `/api/design_systems`, `/api/plugins`, `/api/widgets`, `/api/community`, `/api/ai_chat`, `/api/custom_skills`, `/api/figment-proxy` (analytics), `/api/web_logger`, `/api/file_download_log`.
- **[O]** Third parties: LaunchDarkly (feature flags), Gravatar (avatars), `prodregistryv2.org` (telemetry); **[C]** Sentry (crash minidumps, S3).
- **[C]** Desktop: local **FigmaAgent** (`figma_agent.exe`) on port **44950**, endpoint `/figma/font-files`, which serves locally installed fonts to the web app (S3).
- **[C]** Desktop: auto-update through Squirrel (`desktop.figma.com`), and an MCP server endpoint `mcp.figma.com/mcp` (S3).
- **[C]** Public REST API (S2): about 50 endpoints for files, images, comments, versions, components, styles, variables, webhooks, dev resources, analytics, activity logs.
- **[U]** Multiplayer transport details (WebSocket URL, auth handshake): not captured. Only the message schema is known.

## 9. Features that require authentication or external services

All of these are cloud-only and need a Figma account **[C/O]**, so a local app cannot reproduce them. They should be left out or replaced by local equivalents:

- Accounts, teams, plans, billing ("Free" badge, "Upgrade", "AI balance").
- Multiplayer editing, cursors, Share, permissions, comments, notifications.
- Version history and branching (server-side; a local app can use its own snapshots).
- Team libraries and published components/styles/variables.
- Community files, plugins and widgets (code downloaded from Figma).
- AI features: Agents, AI chat, Make, Buzz, Sites, MCP.
- Dev Mode (paid seat), Prototype presentation sharing.
- Local fonts in Figma (needs FigmaAgent). A local Electron app can enumerate fonts directly.

## 10. Unknown or not investigated [U]

- Exact rendering pipeline (WebGL or WebGPU) and the text layout engine.
- Pointer/snapping maths, handle hit areas, nudge defaults (the nudge preference exists **[O]**).
- Prototype tab contents and interactions; Dev Mode; Draw and Motion modes.
- The Export dialog UI (formats are confirmed from S1, but the dialog was not opened).
- `.fig` import end-to-end; Sketch/PPTX/PDF import conversion (server-side or client-side **[U]**).
- Multiplayer WebSocket protocol beyond the message schema.
- Image blob storage in `.fig` `images/` (empty in the sample; **[I]** hash-named files referenced from `IMAGE` paints).
- The `blobs[]` binary geometry encoding (vector path commands) is not decoded yet.

---

## 11. Implications for the local app (stack decision)

| Choice | Decision | Why |
|--------|----------|-----|
| Electron | **Use** | Figma Desktop itself is Electron with a sandboxed renderer (contextIsolation on, nodeIntegration off, preload bridge); copy that security model. Native dialogs and file writes go through IPC, as in `web:writeFiles`. |
| React | **Use** (only UI framework) | The panels, menus and toolbar are standard component UI. Figma's own chrome is also React-style Webpack bundles. |
| Tailwind | **Use** | Plain panel styling; no evidence requires anything else. |
| Angular | **Do not use** | Nothing in the research needs it, and it would duplicate React. |
| Next.js | **Do not use** | Everything runs locally; no server, SSR or routing is needed. Cloud features are out of scope (§9). |
| Node.js | Electron main process only | File I/O, `.fig` zip read/write, font listing. |
| Testing Library (+ Vitest) | **Use** | Component and interaction tests. `research/kiwi.mjs` should get a test against the sample `.fig`. |
| Canvas | Own renderer (Canvas 2D first) | Figma's WASM engine is proprietary and cannot be reused. |

**Native project format:** a zip containing `document.json` (our own node tree, shaped like the REST `GetFileResponse`), `meta.json`, `thumbnail.png` and `images/`. It mirrors the `.fig` layout, but uses JSON so it stays readable and stable.
**Import:** our own format, plus best-effort `.fig` (decode with `kiwi.mjs`, map `NodeChange` → our nodes; frames, shapes, text, fills, strokes, transforms first). Also SVG and images.
**Export:** our own format, plus PNG/JPG/SVG/PDF of frames. Writing `.fig` back is **not recommended**: the schema is proprietary and versioned, and Figma may reject or mis-read files we produce.
