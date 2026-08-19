# ZeusPack AE Bridge

A CEP panel for Adobe After Effects. It does two separate jobs:

1. **Bridge** — connects After Effects to the ZeusPack desktop app so the app can
   drive AE (import an `.aep`, list its comps, and so on).
2. **Preset browser** — browses, previews, applies, authors and exports `.ffx`
   animation presets and `.aep` compositions, with video thumbnails in a grid.

The bridge half runs whether or not you ever open the browser. The browser half
works with After Effects alone and does not need ZeusPack running.

---

## Install

Run the installer one level up:

```bat
..\install.bat
```

It copies this folder to `%APPDATA%\Adobe\CEP\extensions\zeuspack_ae_bridge` and
enables unsigned extensions (`PlayerDebugMode`). Restart After Effects, then open:

**Window ▸ Extensions ▸ ZeusPack AE Bridge**

Re-run the installer after any change to `CSXS/manifest.xml` — its
`CEFCommandLine` flags are read once at panel launch.

**Requirements:** After Effects CC 2018 (15.0) or newer, CEP 9+. Some features
need a newer AE than that — see [Version constraints](#version-constraints).

---

## The asset model

An asset is a group of files sharing one base name:

```
Glow Pop.ffx     the animation preset          ← the asset
Glow Pop.aep     the project its preview was built in
Glow Pop.mp4     the rendered preview the grid shows
```

**`.ffx` claims the name.** An `.aep` that matches a preset's name is treated as
that preset's preview project, not as a separate asset — so the pair above is one
card, not two.

**An `.aep` with no matching `.ffx` is its own asset**, a *composition*. It can
have a preview too:

```
Intro Scene.aep  the composition               ← the asset
Intro Scene.mp4  its preview
```

Cards are badged by kind: amber **`FX`** for a preset, blue **`Comp`** for a
composition, plus **`no preview`** when the preview file is missing.

Preview files may be `.mp4`, `.webm`, `.png`, `.jpg`, `.jpeg` or `.gif`. Video
previews loop in the grid.

---

## Categories

Subfolders of the preset root are the categories, listed in the left rail.

Declare them in **`categories.json`** at the root:

```json
[
  "Backgrounds",
  "Text",
  "Transitions"
]
```

`{ "categories": [...] }` is accepted too — the same shape ZeusPack's own
`categories*.json` files use.

**When the manifest exists, only the folders it lists are scanned.** This is the
point of it: After Effects drops `Adobe After Effects Auto-Save` folders next to
whatever it's working on, and without a manifest those turn up as categories.
(Folders matching `auto-save` are skipped by name regardless, as a fallback for
roots with no manifest yet.)

Notes:

- Declared categories appear **even when empty**, so a category you just made is
  visible and ready to fill.
- Creating your first category in a folder that already has subfolders **seeds
  the manifest with all of them**, so switching to declared mode can't silently
  hide presets you already had.
- A folder on disk but missing from the manifest still gets listed if it holds
  presets — hiding found assets would be worse than an unexpected row.
### Subcategories

Folders inside a category become subcategories, shown indented in the rail:

```
(root)         1
Backgrounds    0
Text           5
  Kinetic      3
    Bold       1
Transitions    1
```

- **Subcategories are discovered, not declared.** `categories.json` only gates
  the top level — that is what keeps `Auto-Save` out — so anything inside a
  declared category is already scanned. Only top-level categories go in the
  manifest.
- **Counts roll up.** `Text` shows 5 because that is what selecting it displays:
  its own presets plus everything beneath it. Selecting `Text/Kinetic` narrows
  to that subtree.
- **`(root)` means loose files only**, not everything.
- Dropping a card on any row, at any depth, moves the asset there.

### Right-click the category rail

| Item | Notes |
|---|---|
| New Folder… | Creates inside the row you clicked; at top level from empty rail space or *(root)* |
| Rename… | Renames the folder on disk — only on a real folder, not *All presets* or *(root)* |
| Reveal in Explorer | Opens that folder |

Right-clicking a row selects it first, so the menu's wording matches what is
highlighted. Renaming a top-level category also updates `categories.json`, and
the current selection follows the folder — including when a subcategory of it
was selected.

---

## Panel reference

### Status bar

| Control | What it does |
|---|---|
| ● dot + label | ZeusPack connection (polls `127.0.0.1:8771`) |
| ▶ | Test: read the active AE project |
| ✦ | Show/hide the preset browser |
| ☰ | Show/hide the log |

### Browser

| Control | What it does |
|---|---|
| Path dropdown | `Zeus Presets` / `User Presets` / `Browse…` |
| Loop / Hover | Preview playback mode — see below |
| ↻ | Rescan the current folder |
| Size slider | Thumbnail size, 72–200px |
| Apply to selected layer | Applies the selected preset (or *Add to comp*) |

**Drag a card onto a category row to move the asset there** — the `.ffx`/`.aep`
and its preview all travel together. The `(root)` row is always listed, so an
asset can be dragged back out of a category. *All presets* is a filter rather
than a folder and never accepts a drop.

Drag the **right edge of the category rail** to resize it. The grid is never
squeezed below 96px, so dragging fully right stops rather than hiding it.

**Loop / Hover** switches how video previews play:

- **Loop** — every card plays continuously. Reads best, but a folder of a few
  hundred previews means that many simultaneous video decoders.
- **Hover** — the first frame is painted and only the card under the pointer
  plays, so one decoder runs at a time.

Decoder count follows the cards in the DOM rather than the visible ones, so the
difference shows up on large folders and wide panels. If the grid ever feels
sluggish, this is the first thing to try.

Rail width, thumbnail size, playback mode and the chosen root all persist in
`localStorage`.

Click a card to select. **Double-click uses the asset** — applies a preset, or
imports a composition into the open comp. The bottom button follows suit,
reading *Apply to selected layer* or *Add to comp*.

### Right-click a card

| Item | Notes |
|---|---|
| Make / Edit Preview Comp | Creates `<name>.aep` at 1920×1080 @ 30fps, or opens the existing one |
| Export mp4 Preview | Renders `<name>.mp4` at 480×270, H.264, 8 Mbps |
| Export Image Preview | Writes `<name>.png` at 480×270, from the frame under the playhead |
| Apply to selected layer | `.ffx` assets — applies the preset to the selected layer(s) |
| Add to Comp | `.aep` assets — imports the main comp into the active comp |
| Rename… | Renames the `.ffx`/`.aep` and its preview together |
| Reveal in Explorer | Opens the containing folder |
| Kontol | Opens the containing folder |

Both exports are disabled until the preview comp exists. *Apply* and *Add to
Comp* are mutually exclusive — only the one meaningful for that asset is shown.

If an asset has both an `.mp4` and a `.png` preview, the grid shows the **mp4** —
motion beats a still, and the precedence is fixed so the choice can't vary with
directory ordering.

### Right-click empty grid space

| Item | Notes |
|---|---|
| Save Animation as Preset… | Saves the current AE selection into the selected category |
| Add Asset… | New `<name>.aep` at 1920×1080 @ 30fps in the selected category |
| Reveal in Explorer | Opens the current preset folder |

Folder creation and renaming live on the rail's own right-click menu.

---

## Authoring workflow

1. **Add Asset…** — creates a 1080p project in the chosen category and opens it.
2. Build the animation.
3. Select the layer (or just the properties you want) and
   **Save Animation as Preset…**.
4. Right-click the new card ▸ **Export mp4 Preview** — renders the thumbnail.
   (Or **Export Image Preview** for a still, which is far cheaper and doesn't
   need H.264 at all — see below.)

Comps are authored at **1080p** and exported at **480×270**. Working full size
keeps the project useful as a source; the preview only ever needs to be
thumbnail-sized. 1920/480 = 4 exactly, so the export is a clean *Quarter*
resolution render rather than an arbitrary rescale.

---

## Configuration

Panel constants, top of the relevant block in `js/panel.js`:

| Constant | Default | Meaning |
|---|---|---|
| `BASE` | `http://127.0.0.1:8771` | ZeusPack bridge endpoint |
| `POLL_MS` | `800` | Bridge poll interval |
| `ASSET_W/H/FPS/DUR` | `1920 1080 30 3` | New comps (Add Asset, Make Preview Comp) |
| `EXPORT_W/H` | `480 270` | Preview render size |
| `EXPORT_MBPS` | `8` | Target H.264 bitrate |
| `CARD_MIN/MAX/DEFAULT` | `72 / 200 / 100` | Thumbnail size slider range |
| `CATS_MIN/MAX/DEFAULT` | `56 / 240 / 84` | Category rail width range |
| `AUTOPLAY_KEY` | `zae.autoplay` | Stores the Loop/Hover choice |

Host constants in `jsx/host.jsx`:

| Constant | Default | Meaning |
|---|---|---|
| `_ZEUS_ROOT` | `W:\AE PACK ZEUSANIMATION` | The "Zeus Presets" root |
| `_PREFERRED_TEMPLATE` | `ZeusPack Preview` | Output module template preferred on export |
| `_MAX_PRESETS` | `600` | Scan cap |
| `_MAX_DEPTH` | `4` | Scan recursion depth |

Card size, rail width and the chosen root persist in `localStorage`.

---

## Version constraints

Three features depend on APIs that arrived in specific AE versions. All three
**degrade and report honestly** rather than failing silently — check the log for
what actually happened.

| Feature | Needs | If unavailable |
|---|---|---|
| H.264 in the render queue | **AE 23.0 (2023)** | Export is refused with a message naming the template to create. H.264 was absent from the render queue between CC 2014 and 22.x. |
| Export bitrate | **AE 22.0** (`OutputModule.setSettings`) | Falls back to the template's bitrate; the log says `bitrate from template` instead of `bitrate set to 8 Mbps`. |
| Export downscale | **AE 22.0** (`RenderQueueItem.setSettings`) | Renders at comp size; the log says so explicitly. |

**Reliable workaround for all three:** create an output module template named
**`ZeusPack Preview`** (H.264, 8 Mbps) once. It's checked first and used
verbatim, so the settings hold on any version.

**Export Image Preview has none of these constraints.** It uses
`CompItem.saveFrameToPng` through a temporary comp at the target size, so it
works on every supported AE version, needs no template, and is exact about its
output size. On an older AE it's the dependable option.

---

## Updates

The panel checks GitHub for a newer release on launch and shows an **Update**
badge in the status bar when the newest tag is above the installed extension
version. Clicking it opens the releases page and hides the badge until an even
newer version appears.

| Constant (`js/panel.js`) | Meaning |
|---|---|
| `UPDATE_REPO` | `explainervid-glitch/zeusanimation-library` |
| `UPDATE_EVERY_MS` | 6h — unauthenticated GitHub allows 60 requests/hour |
| `PANEL_VERSION` | Fallback if CEP won't report the installed version |

For this to fire, a release must be **tagged with a version above
`ExtensionBundleVersion` in `CSXS/manifest.xml`** (currently `1.0.0`). Tags may
be written `1.2.0` or `v1.2.0`; only major.minor.patch is compared.

The check is best-effort by design — no network, a rate-limited API, or a repo
with no releases all end in silence rather than an error nobody can act on.

## Known limitations

**Saving a preset can't be silent.** `Save Animation Preset` is an AE menu
command with no path argument — ExtendScript cannot choose the destination. So
*Save Animation as Preset…* snapshots every `.ffx` it can see, fires the command,
waits on AE's modal dialog, then finds the new file and moves it into the
selected category. Wherever you point the dialog, the file lands correctly. If
you save somewhere unwatched (the Desktop, say), the panel says it couldn't
locate it rather than claiming success.

**No drag-and-drop into the timeline.** CEP panels are Chromium views; HTML5 drag
events don't cross into AE's native UI and CEP exposes no panel→host drag API.
Use double-click or Apply. AE's *own* Effects & Presets panel does support drag
for anything under `User Presets`.

**Opening a project replaces the current one.** AE holds one project at a time.
Make/Edit Preview Comp and Export Preview both switch projects, and AE will
prompt to save first if the current one is dirty — cancel that and the panel
reports `Cancelled — current project kept` without doing anything.

**Rendering blocks After Effects.** `renderQueue.render()` is synchronous, so AE
is frozen until the export finishes. At 480×270 × 3s that's a second or two.

**Existing previews are overwritten.** AE won't render onto an existing file, so
Export Preview deletes the previous `<name>.mp4` first.

---

## File layout

```
ae_bridge/
├─ CSXS/manifest.xml   extension id, AE version range, CEFCommandLine flags
├─ index.html          markup + all styles
├─ js/
│  ├─ CSInterface.js   Adobe's CEP library
│  └─ panel.js         UI, bridge polling, host dispatch
├─ jsx/host.jsx        ExtendScript (ES3) — everything that touches AE
└─ .debug              remote-debug ports for development
```

`panel.js` never touches After Effects directly. Every AE operation is a
`zae_*` function in `host.jsx`, called through `csInterface.evalScript`, and each
returns a JSON string `{ ok, message, data }`.

`host.jsx` targets **ExtendScript (ES3)** — no `let`/`const`, arrow functions,
`Array.prototype.map`, or template literals. It ships its own `JSON.stringify`
shim because older hosts lack one.

---

## Troubleshooting

**"ZeusPack not running"** — the bridge can't reach `127.0.0.1:8771`. Only
affects app-driven jobs; the preset browser works regardless.

**Previews are blank, or cards say "no file access"** — CEF is blocking `file://`
media. The manifest grants `--allow-file-access` and
`--allow-file-access-from-files`; re-run `install.bat` and restart AE.

**"Zeus Presets (offline)"** — `W:` isn't reachable. The option is disabled and
the panel falls back to User Presets, with a note in the log.

**Auto-Save folders showing as categories** — add a `categories.json`, or use
*New Category…* once, which seeds one from the folders already present.

**No categories at all** — the rail hides itself when there's nothing to filter
by: a single bucket and no manifest. Add a subfolder or a category and it appears.

**"The name of the selected output module is already in use"** — should no
longer happen. `applyTemplate` leaves the output module named after the template,
so changing its settings looked to AE like editing that saved template. The
module is now renamed to something unique first, and dialogs are suppressed while
the queue item is configured. Your saved template is never modified — the
settings apply to that one queue item.

**"Could not find the Save Animation Preset menu command"** — the menu string
differs on this build or locale. Three spellings are tried; save the preset
manually via **Animation ▸ Save Animation Preset** into the category folder.
