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
