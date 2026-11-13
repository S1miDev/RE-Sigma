# The `.refig` project format (version 1)

A Refig project is one file, `<name>.refig`, in the workspace folder (`Documents/Refig Projects` by default). The file name without the extension is the project's name.

The file is a ZIP archive with these entries and nothing else:

| Entry | Required | Content |
|---|---|---|
| `meta.json` | yes | Project identity and timestamps |
| `document.json` | yes | The design document |
| `thumbnail.png` | no | Preview shown in the project list, at most 400×300 |
| `images/<sha256>` | no | Raw bytes of each image used by an image fill; the entry name is the lowercase hex SHA-256 of the bytes |

A reader rejects an archive that contains any other entry, more than 10 000 entries, or more than 1 GB of unpacked data.

## `meta.json`

```json
{
  "format": "refig",
  "formatVersion": 1,
  "id": "3f2c1c0e-8a57-4c56-9d0b-2f4a4b0c9e11",
  "name": "Landing page",
  "createdAt": "2026-11-11T08:00:00.000Z",
  "modifiedAt": "2026-11-11T09:30:00.000Z",
  "appVersion": "0.1.0"
}
```

- `id` is a lowercase UUID. It identifies the project across renames. Two files with the same id (a file copied by hand) are both listed; the later one by file name gets a new id the first time it is opened.
- `name` records the name at the last save. The file name is what the app shows.

## `document.json`

```json
{ "formatVersion": 1, "pages": ["<page id>", "…"], "nodes": { "<node id>": { "…": "…" } } }
```

- `nodes` is a flat map from id to node. The tree is expressed by each node's `parentId` and `order`.
- `pages` lists the ids of the `PAGE` nodes in display order. It has at least one entry.
- Node ids are 1–64 characters from `A–Z a–z 0–9 : -`. The app writes UUIDs.

### Node fields

Every node has all of these fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Same as its key in `nodes` |
| `type` | `PAGE` `FRAME` `GROUP` `RECTANGLE` `ELLIPSE` `LINE` `TEXT` `VECTOR` | |
| `name` | string | Layer name |
| `parentId` | string or `null` | `null` for a `PAGE`; otherwise the id of a `PAGE`, `FRAME` or `GROUP` |
| `order` | string | Fractional z-order key among siblings. Compared as plain strings; a greater key is drawn on top |
| `visible`, `locked` | boolean | |
| `x`, `y` | number | Top-left corner of the unrotated box, in the parent's coordinates |
| `width`, `height` | number ≥ 0 | A `LINE` has `height` 0 and runs along its width |
| `rotation` | number | Degrees, clockwise, about the centre of the box |
| `opacity` | number 0–1 | |
| `fills`, `strokes` | Paint[] | Drawn in array order; at most 32 each |
| `strokeWeight` | number ≥ 0 | |
| `strokeAlign` | `INSIDE` `CENTER` `OUTSIDE` | |
| `effects` | DropShadow[] | |
| `cornerRadius` | number ≥ 0 | Used by `RECTANGLE` and `FRAME` |
| `clipsContent` | boolean | Used by `FRAME` |

A `PAGE` uses `fills[0]` as its background colour. A `GROUP`'s box always wraps its children.

`TEXT` nodes also have:

| Field | Type | Meaning |
|---|---|---|
| `characters` | string | The text; `\n` separates paragraphs |
| `fontFamily` | string | |
| `fontWeight` | number | 100–900 |
| `fontSize` | number | px |
| `lineHeight` | number | px; `0` means automatic (1.2 × font size) |
| `letterSpacing` | number | px |
| `textAlign` | `LEFT` `CENTER` `RIGHT` | |
| `textAutoWidth` | boolean | `true`: the box is as wide as the text. `false`: text wraps at `width` |

`VECTOR` nodes also have `vector`:

| Field | Type | Meaning |
|---|---|---|
| `w`, `h` | number ≥ 0 | Size the paths were drawn at; they are scaled to the node's `width` × `height` (no scaling on a 0 axis) |
| `fill` | VectorPath[] | Filled with `fills`; at most 32 |
| `stroke` | VectorPath[] | The stroke already outlined, filled with `strokes`. When empty, `fill` paths are stroked with `strokeWeight`, centred |

A VectorPath is `{ d, rule }`: `d` is SVG path data using only `M L Q C Z`, numbers, spaces, `.`, `+`, `-`, `e`/`E`; `rule` is `nonzero` or `evenodd`.

### Paint

```json
{ "type": "SOLID", "visible": true, "color": { "r": 1, "g": 0.5, "b": 0, "a": 1 } }
{ "type": "IMAGE", "visible": true, "hash": "<sha256 of an entry in images/>" }
{ "type": "GRADIENT", "kind": "LINEAR", "visible": true, "from": { "x": 0.5, "y": 0 }, "to": { "x": 0.5, "y": 1 }, "w": { "x": 0, "y": 0 },
  "stops": [{ "pos": 0, "color": { "r": 0, "g": 0, "b": 0, "a": 1 } }, { "pos": 1, "color": { "r": 0, "g": 0, "b": 0, "a": 0 } }] }
```

Colour channels are floats from 0 to 1. An image fill covers the box (scaled to fill, centred, cropped).

A gradient (version 2) has a `kind` of `LINEAR`, `RADIAL`, `ANGULAR` or `DIAMOND` and 2–32 `stops` with `pos` from 0 to 1. Its handles are in the node's normalized box (0–1 on each axis), like Figma's. Linear runs `from` → `to`. The other kinds are centred on `from`, with `to` on the edge, which gives the radius and start angle. `w` is optional: it is the end of the second axis, Figma's width handle. For linear it is the point half a length "below" `from`; for the others it is the edge along the second radius. Without `w` the gradient is undistorted in the normalized box.

### DropShadow

```json
{ "visible": true, "x": 0, "y": 4, "blur": 4, "spread": 0, "color": { "r": 0, "g": 0, "b": 0, "a": 0.25 } }
```

## Validation

The app validates a document when it opens, saves or imports one. A document is rejected when:

- a field is missing or has the wrong type, or a number is not finite or is out of range;
- a node's `parentId` names a node that does not exist or is not a `PAGE`, `FRAME` or `GROUP`;
- following `parentId` from a node never reaches a page (a cycle);
- a `PAGE` is not listed in `pages`, or `pages` names something that is not a `PAGE`.

Unknown fields are dropped.

## Versions

`formatVersion` is an integer in both JSON files. A reader accepts any version up to its own and migrates older ones forward. It refuses a higher version with "This project was made by a newer version of Refig". The current version is 2.

- **1:** the first version.
- **2:** adds `GRADIENT` paints. Version 1 files read unchanged, so there is no migration. Apps that only know version 1 refuse version 2 files with the message above, not with "Invalid document".

## Saving

The app writes `<name>.refig.tmp`, flushes it to disk, then renames it over `<name>.refig`. A crash leaves either the old file or the new one.
