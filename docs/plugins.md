# Plugins

A plugin is a folder in the plugins folder (Main menu → Plugins → Open plugins folder; `%APPDATA%/<app>/plugins`, or `REFIG_PLUGINS`). Folder names are lowercase `[a-z0-9._-]`. A working example is in `docs/examples/plugin-hello/`.

```
my-plugin/
  manifest.json   { "name": "My plugin", "main": "code.js", "ui": "ui.html" (optional),
                    "commands": [{ "id": "a", "label": "Do A" }] (optional; default: one command "run") }
  code.js         runs in a Worker
  ui.html         optional, runs in a sandboxed iframe
```

Plugins appear in the command palette (Ctrl+K) and in Main menu → Plugins. Files are flat (no sub-folders), `.js .html .css .json`, up to 5 MB each. The list is rescanned when an editor opens.

## code.js

`importScripts('refig.js')` defines `refig` (the editor serves this file under a reserved name). Every method returns a promise.

| Method | Does |
|---|---|
| `onRun(fn(commandId))`, `onUIMessage(fn(msg))` | handlers (not promises) |
| `getSelection()`, `getNode(id)`, `getChildren(id)` | read nodes (plain JSON copies) |
| `setSelection(ids)` | select live nodes |
| `createNode(type, props, parentId?)` | `type`: RECTANGLE, ELLIPSE, FRAME, TEXT; returns the id. Max 1000 per run. Parent defaults to the current page |
| `updateNode(id, props)`, `removeNodes(ids)` | edit / delete |
| `notify(text)` | toast |
| `showUI({width, height})`, `postToUI(msg)`, `closePlugin()` | UI control (size clamped to 120–800 px) |

`props` may only contain: `name, characters, fontFamily, fontSize, fontWeight, visible, locked, x, y, width, height, rotation, opacity, strokeWeight, cornerRadius`, and `fills` / `strokes` as `[{r, g, b, a?}]` (0–1, solid colours only). Anything else is rejected with an error.

One run is one undo step. A plugin stops on `closePlugin()`, on Esc (when it has a UI), after 30 s without a request, or when the editor closes.

## ui.html

Send with `parent.postMessage(msg, '*')`; receive with `window.addEventListener('message', …)` (what code.js sends with `postToUI`). The editor relays only between the iframe and the worker.

## Security

Plugin files are served from `refig-plugin://<id>/` with their own CSP (`default-src 'none'`): no network, no `eval`, no access to the editor, the document or `window.refig`. The iframe has `sandbox="allow-scripts"` (opaque origin). All document changes go through the validated methods above.

This is isolation from the app, not a trust system: plugins are plain local folders you install yourself, and there is no signing or marketplace. A plugin can still create junk or delete layers (undoable) and burn CPU until it is stopped.

## Proposal: scripting for bulk edits and agents (not built)

**How it works today.** The main process scans the plugins folder when an editor opens (`src/main/plugins.ts` `listPlugins`, which validates `manifest.json`). It serves each plugin's files from `refig-plugin://<id>/`. Main menu → Plugins and the command palette list one entry per plugin command. Running one starts `code.js` in a Worker (`src/renderer/editor/plugins/host.ts`). Every call goes through `dispatch`, which checks its arguments and changes the document only with `store.update`, as one undo step per run. The table above already covers reading nodes, creating frames and text, and setting fills, strokes and characters. What is missing is a place to start from, a way to search, and a way to run without a person clicking.

**Proposed additions, smallest first:**

| Method | Does | Why |
|---|---|---|
| `getPages()`, `getCurrentPage()` | `[{ id, name }]` / the page shown now | Today the only entry point is the selection, so a script cannot walk a page that has nothing selected. |
| `findAll(rootId, { type?, name? })` | Ids of nodes under `rootId` whose type matches and whose name contains `name` (case-insensitive). Capped at 10 000. | One call instead of a recursive `getChildren` walk with one message per node. |
| `replaceColor(rootIds, fromHex, { r, g, b })` | Recolours every solid paint and text run fill of that colour under the roots. This is `model/colors.ts` `replaceColor`, the same code as the Selection colors panel. | A full recolour becomes one call and one undo step. |
| `group(ids, 'GROUP' \| 'FRAME')`, `moveTo(ids, parentId)` | Wrap `model/ops.ts` `group` / `moveTo` | Lets a script restructure the tree, not only create and edit nodes. |

Each method is an entry in `methods` in `host.ts`, with argument checks as strict as `FIELDS`. Gradient paints stay out until someone needs them.

**Running without a click (for agents).** Add a `--run-plugin <id>[:<command>]` command-line switch. Refig already holds a single-instance lock (`src/main/index.ts`), so a second launch with the switch is forwarded to the open window through `second-instance`. The editor then runs that plugin on the open project as if it had been chosen from the menu. A plugin can log what it did with `notify` (shown as a toast), and optionally to stdout through a new `log(text)`. This keeps all the existing checks: nothing reaches the document except through `dispatch`.

**Alternative with no app changes.** An agent can edit a closed project file directly, following `docs/project-format.md`. That suits large batch jobs, but it has no undo, no live view, and no checks.
