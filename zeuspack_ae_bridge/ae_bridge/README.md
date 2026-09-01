# ZeusPack

A CEP panel for Adobe After Effects. It does three separate jobs:

1. **Bridge** — connects After Effects to the ZeusPack desktop app so the app can
   drive AE (import an `.aep`, list its comps, and so on).
2. **Preset browser** — browses, previews, applies, authors and exports `.ffx`
   presets, `.zfx` presets and `.aep` compositions, with video thumbnails in a
   grid.
3. **Layer tools** — grouping without a pre-comp, and Decompose.

The bridge half runs whether or not you ever open the browser. The browser and
the tools work with After Effects alone and do not need ZeusPack running.

---

## Install

Run the installer one level up:

```bat
..\install.bat
```

It copies this folder to `%APPDATA%\Adobe\CEP\extensions\zeuspack_ae_bridge` and
enables unsigned extensions (`PlayerDebugMode`). Restart After Effects, then open:

**Window ▸ Extensions ▸ ZeusPack**

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

Precedence is **`.zfx` › `.ffx` › `.aep`** — see [The .zfx format](#the-zfx-format).

**An `.aep` with no matching `.ffx` is its own asset**, a *composition*. It can
have a preview too:

```
Intro Scene.aep  the composition               ← the asset
Intro Scene.mp4  its preview
```

Cards are badged by kind: amber **`FX`** for a plain `.ffx` preset, green
**`FX+`** for a [`.zfx`](#the-zfx-format), blue **`Comp`** for a composition,
plus **`no preview`** when the preview file is missing.

Preview files may be `.mp4`, `.webm`, `.png`, `.jpg`, `.jpeg` or `.gif`. Video
previews loop in the grid.

### Bundle folders

A composition that needs external footage is usually kept as a folder — run
**File → Dependencies → Collect Files** and After Effects writes:

```
Zoom Blur folder/            ← the asset
  Zoom Blur.aep                the composition
  (Footage)/                   everything it links to
  Zoom Blur Report.txt
  Zoom Blur.mp4                its preview
```

That folder is read as **one `Comp` asset in the category it sits in** — it does
not become a row in the rail. A folder qualifies when it holds **exactly one
`.aep`, no `.ffx`**, and at least one corroborating sign: a `(Footage)` folder, a
`… Report.txt`, or the `<name> folder` naming. A category that simply holds
several projects has more than one `.aep`, so it never matches.

The preview is whatever preview file is inside the bundle — one named after the
project wins, anything else is a fallback, so exporting a preview works exactly
as it does for a loose asset.

Moving and renaming understand bundles: dragging one to another category moves
the **whole folder** (so the footage travels with it), and renaming also renames
the folder when it was named after the project.

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
  visible and ready to fill. The flip side: **deleting a category folder in
  Explorer leaves its row behind**, because the manifest still names it. Click
  **Refresh** to reconcile — see below.
- Creating your first category in a folder that already has subfolders **seeds
  the manifest with all of them**, so switching to declared mode can't silently
  hide presets you already had.
- **A top-level folder missing from the manifest is not scanned at all**, even if
  it holds presets — that gating is the whole point of the manifest, and it is
  what keeps `Auto-Save` out. Add it with *New Folder…* on the rail, or put the
  name in `categories.json` by hand. (Subfolders *inside* a declared category are
  discovered normally.)

### Refresh reconciles the manifest

**Refresh is the only action that prunes `categories.json`.** It drops every
declared category whose folder is no longer on disk, rewrites the file, and names
what it removed in the log:

```
categories.json → removed Text (folder no longer on disk)
```

This is why folders deleted outside the panel need one Refresh to disappear from
the rail.

**Refresh keeps the category you had selected**, as does every rescan that
follows a rename, move, delete or export — only a genuine root change clears it.
The one exception is a category that has since gone from disk: leaving that
selected would filter the grid to nothing with no highlighted row to explain
why, so it falls back to *All presets*.

It is deliberately *not* automatic. Every other reload — after a rename, move,
delete or root switch — leaves the manifest untouched. On a shared network root a
category that is momentarily unreachable would otherwise be silently dropped from
a file the whole team reads, and a write like that should be something someone
chose to do. Nothing is written when nothing is missing.

### Subcategories

Folders inside a category become subcategories, shown indented in the rail:

```
Backgrounds      0
Text             5
  Kinetic        3
    Bold         1
Transitions      1
(Uncategorize)   1
```

- **Subcategories are discovered, not declared.** `categories.json` only gates
  the top level — that is what keeps `Auto-Save` out — so anything inside a
  declared category is already scanned. Only top-level categories go in the
  manifest.
- **Counts roll up.** `Text` shows 5 because that is what selecting it displays:
  its own presets plus everything beneath it. Selecting `Text/Kinetic` narrows
  to that subtree.
- **`(Uncategorize)` means loose files only**, not everything — assets sitting
  in the preset root that were never filed into a category. It is pinned below
  the real categories and dimmed, because it is a leftovers bucket rather than a
  folder you chose to make.
- **Clicking the rail's empty space clears the filter**, the same as clicking
  *All presets* — the background belongs to no folder, so nothing stays
  highlighted there.
- **A row with children gets a ▾/▸ toggle** before its name; rows without get an
  invisible spacer so the labels still line up. The toggle owns its own click,
  so collapsing a folder never changes which category is selected. Collapsing
  hides everything nested under it at any depth, and the count still rolls up,
  so you can see something is in there without expanding.
- Dropping a card on any row, at any depth, moves the asset there.

### Right-click the category rail

| Item | Notes |
|---|---|
| New Folder… | Creates inside the row you clicked; at top level from empty rail space or *(root)* |
| Rename… | Renames the folder on disk — only on a real folder, not *All presets* or *(root)* |
| Delete Folder | Removes the folder — **empty ones only** |
| Reveal in Explorer | Opens that folder |

Right-clicking a row selects it first, so the menu's wording matches what is
highlighted. Renaming a top-level category also updates `categories.json`, and
the current selection follows the folder — including when a subcategory of it
was selected.

**Delete Folder refuses a folder that still holds anything**, and says what is in
the way. There is no confirmation step and no undo, so the guard is the point:
deleting a category full of work is a job for Explorer, which is one item further
down the same menu. Dotfiles and `desktop.ini` don't count as contents. Deleting
a top-level category removes it from `categories.json` too.

---

## Panel reference

### Status bar

| Control | What it does |
|---|---|
| ● dot | ZeusPack connection (polls `127.0.0.1:8771`). **Click to toggle the status text** |
| ▶ | Test: read the active AE project |
| ✦ Presets | Show/hide the preset browser |
| ⧉ Tools | Show/hide the [layer tools](#layer-tools) |
| ☰ Log | Show/hide the log |

The status text is **hidden by default** — the dot's colour already carries the
connection state, and its tooltip carries the words, so the last message is
readable on hover without opening the log. Clicking the dot reveals the text;
the choice persists.

Hiding the text does not move the buttons. The row uses `visibility` rather than
`display`, so the text still acts as the flex spacer and the toolbar stays put
either way.

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
| Export Image Preview | Writes `<name>.png` at 480×270, from the frame under the playhead in the **active comp** |
| Apply to selected layer | `.ffx` assets — applies the preset to the selected layer(s) |
| Add to Comp | `.aep` assets — imports the main comp into the active comp |
| Rename… | Renames the `.ffx`/`.aep` and its preview together, and a bundle folder named after it |
| Reveal in Explorer | Opens the containing folder |
| **Delete Asset…** | Removes the `.ffx`/`.aep` and its preview — or the whole collected folder for a bundle |

Both exports are disabled until the preview comp exists. *Apply* and *Add to
Comp* are mutually exclusive — only the one meaningful for that asset is shown.

### Deleting an asset

*Delete Asset…* never deletes on the click. It opens a **confirmation bar** in
place of the name prompt, naming the asset:

```
Delete "Zoom Blur" and its whole folder? No undo.     [ Cancel ] [ Delete ]
```

- **Focus lands on Cancel**, so a reflexive Enter backs out instead of deleting.
  Escape closes it too.
- The **target is captured when the bar opens**, not read back from the grid when
  you click Delete — a rescan in between can't repoint it at a different asset.
- The message **wraps rather than truncating**. At the 240px docked width it only
  gets ~119px, and a clipped `Delete "Kinetic Ty…?` would hide the one thing
  being confirmed; the row grows a line instead.
- Only the known extensions are removed, so an unrelated file sharing the base
  name survives. A **bundle deletes its whole folder**, footage included.
- There is **no undo and no recycle bin** — ExtendScript's `remove()` is a hard
  delete. If a preview is still held open the panel reports how many files it
  actually managed to remove rather than claiming a clean delete.

If an asset has both an `.mp4` and a `.png` preview, the grid shows the **mp4** —
motion beats a still, and the precedence is fixed so the choice can't vary with
directory ordering.

### Right-click empty grid space

| Item | Notes |
|---|---|
| Save Animation+ (.zfx) | The AE selection as a [`.zfx`](#the-zfx-format) — embeds AE’s own preset data and captures expressions on top |
| Save Animation (.ffx) | The AE selection as a plain AE preset. No expression capture, but it opens in anyone’s After Effects |
| Save Animation Comp (.aep) | Runs Collect Files on the open project and files the result as a bundle |
| Add Asset (New Project) | New `<name>.aep` at 1920×1080 @ 30fps in the selected category |
| Reveal in Explorer | Opens the current preset folder |

Folder creation and renaming live on the rail's own right-click menu.

### Save Comp as Preset

For a composition that needs external footage. It runs **File ▸ Dependencies ▸
Collect Files** and files the collected folder as a [bundle](#bundle-folders),
so it lands in the grid as one `Comp` card.

**Two steps belong to AE's dialog and cannot be scripted** — `Collect Files` is a
menu command with no arguments, exactly like `Save Animation Preset`:

1. **Collect Source Files: `All`** — a dropdown in the dialog. AE remembers the
   last choice, so this is one-time setup rather than a per-run chore.
2. **The destination** — a folder chooser. The panel logs the exact path to aim
   at before the dialog opens.

Everything either side of it is automated:

- The category folder is created if it doesn't exist.
- The collected folder is found afterwards by diffing the category, the preset
  root, and the project's own folder — so **if you point the dialog somewhere
  else, the panel moves the result into the category for you** (see the move-cost
  note under Known limitations).
- AE always names its output `<project> folder`. The panel **renames it to plain
  `<project>`** — unless the folder has neither a `(Footage)` subfolder nor a
  report, in which case that suffix is the only thing marking it as a bundle and
  removing it would hide the asset from the grid. Then AE's name is kept and the
  panel says so.

Notes:

- **The project must be saved first.** Collect Files works from the project on
  disk and names its output after the project file.
- **It collects the whole project, not just the active comp.** The asset is named
  after the project file, so one project = one preset.
- If the category already holds a folder of that name, the panel refuses before
  opening the dialog rather than guessing which folder is the new one.

---

## Layer tools

A vertical strip to the right of the browser, toggled by **Tools** in the status
bar. Drag its left edge to resize it; the width persists. These act on After
Effects' own selection, so there is nothing to pick in the panel.

| Button | What it does |
|---|---|
| **Parent** | Parents the selected layers to a null placed at their centre |
| **Clear** | Releases a group's layers and deletes its null |
| **Recenter** | Moves a group's null back to the centre of its layers, without moving them |
| **Decompose** | Lifts a precomp's layers back into the comp around it |

### Group without a pre-comp

*Parent* is grouping that does not nest anything into another timeline: a null
at the centre of the selection, with the selection parented to it. Scaling or
rotating the null moves the whole set.

The null is **tagged through `Layer.comment`**, which is a plain settable string
that survives save/load and stays invisible unless the Comment column is shown.
Membership is deliberately *not* stored — "who is parented to this null" **is**
the membership, so it cannot drift out of sync the way a saved index list would.

**Only the roots of the selection are reparented.** If A is parented to B and
both are selected, only B moves under the null; otherwise grouping would flatten
the hierarchy you already had.

The centre comes from the **union bounding box**, not the average of the layers'
origins — two layers of very different sizes centre on what you can see, not
midway between their anchor points. `sourceRectAtTime()` gives each layer's rect
in its own space, and every corner is walked through that layer's transform and
all its parents to reach comp space. (`toComp()` is expression-language only;
there is no ExtendScript equivalent, so the matrix walk is done by hand.)

When nothing has a measurable rect — all-3D, cameras, lights — it falls back to
averaging the layers' positions rather than failing, and the log says which
route it used. 3D layers are still grouped; they just do not contribute to the
box, and they are named in the log.

*Recenter* exists because the null is placed **at group time**: move the children
afterwards and the handle is left off to one side of what it controls. It
detaches the children, moves the null, and reattaches — parenting preserves the
world transform in both directions, so nothing of theirs moves.

### Decompose

Lifts a precomp's layers back into the comp around it, keeping them exactly where
they looked. **The precomp layer is always deleted**, and normally nothing
replaces it.

Two After Effects APIs carry this, and both are load-bearing:

- **`copyToComp()`** moves a layer to another comp *with* its keyframes, effects,
  masks and expressions. There is no fallback — a layer rebuilt by hand cannot
  reproduce shape or text data.
- **`setParentWithJump()`** parents *without* the compensation `layer.parent = x`
  applies. Normal parenting keeps a layer visually still, which is exactly
  backwards here: the inner layers hold precomp-space values that need
  reinterpreting through the precomp layer's transform.

#### Where the transform goes

| Precomp layer transform | Result |
|---|---|
| Identity + static | Nothing to do — the layers land where they were |
| Any other static transform | **Baked** into the extracted layers' own values. Timeline left clean |
| Cannot be baked exactly | A null carries it instead, and the log says which of three reasons applied |

Baking works because nesting composes to a single layer transform:

```
v → Pp + L_P·(Cp − Pa) + L_P·L_C·(v − Ca)          L = R(rotation)·S(scale)

anchor   = Ca  (unchanged)      rotation = Cr + Pr
position = Pp + L_P·(Cp − Pa)   scale    = Cs × Ps / 100
```

Only **roots** are baked — a layer parented to another extracted layer already
inherits the correction through its parent. Keyframes are mapped individually,
keeping their times, easing and interpolation; spatial tangents go through the
linear part only, being directions rather than points.

That identity holds only while `L_P·L_C` stays a rotation-and-scale. Three cases
break it and fall back to a null rather than silently producing something wrong:

- an **animated** precomp transform (the composition is time-varying),
- a **3D** precomp layer (needs the camera),
- a **shear** — non-uniform precomp scale on a *rotated* layer. Non-uniform scale
  on an *unrotated* layer bakes fine.

#### What survives, and what cannot

Stacking order, track mattes and parenting between the extracted layers are all
rebuilt. Copies are located by a temporary `Layer.comment` marker rather than by
index — `copyToComp()` does not document where it drops the copy, and assuming a
position scrambles the order and leaves layers unparented.

Track mattes need both eras of the API: AE 23+ stores the matte as an explicit
layer reference that must be re-pointed at the copy, while older versions infer
it from the layer directly above, which the reordering reproduces. The video
switch is restored in a final pass, because AE flips it as mattes are assigned.

**Effects and masks on the layers inside travel intact.** What cannot follow is
anything applied **to the precomp layer itself** — effects, masks, layer styles,
blend mode, track matte, opacity, time remap, stretch, a shifted start time,
collapse transformations, or a differing frame rate.

Those act on the **flattened result** of everything inside, which has no
per-layer equivalent: blurring the composite and blurring each layer before
compositing are different images. That is a compositing fact rather than a
scripting limit — it is the reason precomps exist — so they are named in the log
instead of being dropped quietly. When the precomp layer has none of them, the
log says that too.

> If the precomp layer *does* carry an effect, Decompose will change the render.
> It runs in a single undo group, so Ctrl+Z backs the whole thing out.

---

## The .zfx format

`.zfx` is a **superset of `.ffx`, not a replacement**. It is a JSON file that
embeds After Effects' own animation-preset bytes verbatim (base64) and adds a
structured layer on top:

```
Glow Pop.zfx     ← the asset (embedded .ffx + expressions + provenance)
Glow Pop.mp4       its preview
```

Cards are badged green **`FX+`**, against amber `FX` for a plain `.ffx`.

### Why embed rather than reimplement

`applyPreset()` does an enormous amount that cannot be reproduced from script:
effect instances and their parameters — including `PropertyValueType
.CUSTOM_VALUE` blobs (Gradient Ramp's ramp data, Curves, most custom-UI effect
params) that ExtendScript can neither read nor write — plus keyframe
interpolation types, temporal ease (speed + influence, per dimension), spatial
tangents, roving and hold keys, masks, text documents and layer styles.

A hand-rolled format would silently drop exactly those. By carrying AE's own
payload, `.zfx` **cannot be worse than the `.ffx` inside it** — worst case it
behaves identically.

### What it adds

| Field | Purpose |
|---|---|
| `expressions[]` | Captured per property, addressed by **matchName chain** (`ADBE Transform Group` › `ADBE Position`) with a numeric index chain as fallback |
| `expressions[].refs` | External things each expression reaches for, so apply can name what's missing |
| `app.expressionEngine` | What it was authored against, so an engine mismatch is reported rather than left as a silent error |
| `source` | Comp, layer names, and how many properties were selected at save time |

Expressions are captured **from the live layer before AE's dialog runs**, so
they are recorded whether or not AE's own format keeps them.

### Dropdown Menu Control items

A Dropdown Menu Control keeps its item list as part of the *effect*, not as a
property value. AE's own preset format carries it, so the embedded `.ffx`
restores it correctly and **there is nothing for the panel to put back**.

The item list *is* recorded in the `.zfx`, but as metadata only — it is never
replayed on apply.

> **Never call `setPropertyParameters()` on a restored dropdown.** It does not
> edit the dropdown in place; it rebuilds the effect, and the rebuilt effect
> loses the name the user gave it.
>
> Two dropdowns named `Cursor Default` and `Cursor Hover` came back as
> `Cursor Hover` and `Cursor Hover 2` — AE uniquing a name that had been
> dropped — which broke every expression referencing them by name. Two `Glow`
> effects survived the identical round trip untouched, because no dropdown code
> ran on them. That contrast is what identified the cause.

Reading the list is kept only because it costs nothing and makes the saved file
self-describing. It is a probe: `setPropertyParameters()` writes the list
(AE 17.0.1+) but no getter has ever been documented, so when nothing answers
only the item count is recorded.

### Saving

*Save Animation+ (.zfx)* is on the grid's right-click menu. It opens AE's
dialog — the only way to get preset bytes — and the panel folds the resulting
`.ffx` into the `.zfx` afterwards, removing the intermediate file. Pass
`keepFfx: true` to keep both.

**Property selection still matters for the embedded payload.** AE saves only the
selected properties when any are selected; click the *layer name* to capture the
whole layer. The expression capture is not subject to this — it always reads the
full layer — and the panel says so when the two disagree.

**One layer at a time.** A multi-layer selection is refused. Expressions are
addressed by matchName chain, which records *which property* but not *which
layer*, so two selected layers produce indistinguishable records for the same
property — on apply they would be written over each other and the last one would
win, silently. Disambiguating at apply time is not an option either: broadcasting
one layer's records onto a whole selection is the wanted behaviour, and there is
no sensible reading of "apply a 2-layer preset to 3 layers". So the constraint
sits at capture: **one layer in, any number out.** `.ffx` has no expression
replay and is unaffected — use it, or save each layer separately.

A `.zfx` written before this rule applies its first source layer's expressions
only, and says so in the log.

### Applying

Decode payload → `applyPreset()` → restore expressions on top. Expressions are
re-applied unconditionally rather than only where missing: if the embedded
`.ffx` kept them, it is a harmless rewrite of identical text; where it did not,
that is the whole point.

The apply message reports what could not be resolved:

```
Applied Glow Pop to 1 layer, 3 expressions, restored 3 expressions
 — expects layer not in this comp: Null 1
 — authored for expression engine extendscript, this project uses
   javascript-1.0 (File ▸ Project Settings ▸ Expressions)
```

That last class of failure is the one **no storage format can fix on its own** —
the reference has to resolve against the destination comp. Naming it is the most
the format can do.

### Compatibility

*Save Animation (.ffx)* is unchanged and stays — a `.ffx` opens in anyone's After
Effects, ZeusPack or not, and supports drag-and-drop from AE's own Effects &
Presets panel. `.zfx` does neither; it is the richer option for a shared library,
not a replacement for interop.

A `.ffx` sitting beside a `.zfx` of the same name is treated as that preset's
legacy sibling (one card, not two), the same way an `.aep` is treated as its
preview project.

---

## Authoring workflow

1. **Add Asset (New Project)** — creates a 1080p project in the chosen category
   and opens it.
2. Build the animation.
3. Select the layer — click the **layer name**, not individual properties, unless
   you deliberately want to narrow what is saved — then
   **Save Animation+ (.zfx)**.
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
| `TOOLS_MIN/MAX/DEFAULT` | `92 / 200 / 92` | Tool strip width range — the floor is where the "Null Parent" heading and its gear stop clipping |
| `PRESETS_MIN` | `120` | The browser is never squeezed below this by the tool strip |
| `AUTOPLAY_KEY` | `zae.autoplay` | Stores the Loop/Hover choice |

Host constants in `jsx/host.jsx`:

| Constant | Default | Meaning |
|---|---|---|
| `_ZEUS_ROOT` | `W:\AE PACK ZEUSANIMATION` | The "Zeus Presets" root |
| `_PREFERRED_TEMPLATE` | `ZeusPack Preview` | Output module template preferred on export |
| `_MAX_PRESETS` | `600` | Scan cap |
| `_MAX_DEPTH` | `4` | Scan recursion depth |
| `_ZFX_EXT` / `_ZFX_VERSION` | `zfx` / `1` | Preset format extension and version |
| `_GROUP_TAG` | `zeusgroup` | `Layer.comment` prefix marking a group null |
| `_CEP_SYSTEM_DIR` | `C:\Program Files (x86)\…\CEP\extensions` | Where updates install |

Persisted in `localStorage`: card size, rail width, tool strip width, the chosen
root, Loop/Hover, which panels are open, and the status-text toggle.

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

### Which comp gets rendered

**Export Image Preview renders the active comp.** The composition inside the
project does *not* have to be named after the file — rename it to anything and
the export still works. It resolves in this order:

1. **The active comp.** When the asset's project is already open, this is simply
   the comp you're looking at.
2. **A comp matching the asset name** — the old rule, kept as a fallback.
3. **The only comp**, when the project has just one.
4. **The main comp** — the one top-level comp not used as a layer inside another.
   Precomps are nested, so this finds what the project is actually about.

If several unrelated top-level comps remain and none is open, the panel lists
them and asks you to open the one you want rather than guessing. When the comp
rendered isn't the file's own name, the message says which one it used:

```
Exported Zoom Blur.png at 480×270 from "Final Render v3" — frame at 1.2s
```

Note that `activeItem` can come back null when the CEP panel has focus — which is
exactly when this runs — so rules 2–4 are doing real work, not just covering
edge cases.

**Export mp4 Preview still requires the name match** (rule 2 only). Both exports
sharing a resolver would mean the mp4 quietly rendering whatever comp happened to
be open, which is a bigger change than a thumbnail.

---

## Updates

**No releases and no tags.** The version of record is `ExtensionBundleVersion`
in this repo's own `CSXS/manifest.xml`. Shipping an update is one commit:

```xml
<ExtensionManifest ... ExtensionBundleVersion="1.0.6"
```

On launch the panel reads that file raw from GitHub and compares it with the
running extension. When they differ it shows an **Update** badge in the status
bar; clicking it installs.

### What the check compares

**Inequality, not "newer".** A working copy *ahead* of the branch is as much a
mismatch as one behind it, and both are worth knowing about — the tooltip names
both versions, so which way round it is stays obvious:

```
Repo has 1.0.6, this panel is 1.0.5 — click to install (needs administrator rights)
```

### What clicking it does

1. Downloads `https://github.com/<repo>/archive/refs/heads/main.zip`.
   GitHub has no API for fetching a single folder, so the whole archive comes
   down and only `zeuspack_ae_bridge/ae_bridge` is copied out.
2. Copies that folder into
   **`C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\zeuspack_ae_bridge`**.
3. Reports the version now on disk, and asks you to restart After Effects.

That destination is not writable by a normal user, so the copy runs in an
**elevated PowerShell child process** and Windows raises the UAC prompt.
Declining it is reported as *"Nothing was installed"* rather than passing
silently.

Notes:

- **After Effects is blocked while it runs.** The elevated process is waited on
  so the result can be verified against the disk rather than trusted from an
  exit code — `callSystem` reports those unreliably, and a cancelled UAC prompt
  surfaces no error at all.
- The script travels as **`-EncodedCommand`** (base64 UTF-16LE), which sidesteps
  quoting at all three levels — `callSystem` → `powershell` → `Start-Process`.
  Paths with spaces, `&` or quotes need no escaping.
- Failures are appended to `%TEMP%\zeuspack_update.log`, and the panel echoes
  the last error into its own log.
- **Windows only.** Elsewhere it refuses and tells you to copy `ae_bridge/` by
  hand.

| Constant | Where | Meaning |
|---|---|---|
| `UPDATE_REPO` / `_UPDATE_REPO` | both | `explainervid-glitch/zeusanimation-library` |
| `UPDATE_BRANCH` / `_UPDATE_BRANCH` | both | `main` |
| `UPDATE_EVERY_MS` | `panel.js` | 6h between checks |
| `PANEL_VERSION` | `panel.js` | Fallback if CEP won't report the installed version |
| `_CEP_SYSTEM_DIR` | `host.jsx` | System-wide CEP extensions folder |

The check itself stays best-effort — no network, a CDN hiccup or a moved
manifest all end in silence rather than an error nobody can act on. The install
is the opposite: it always reports what happened.

> The raw manifest URL is fetched with a `?t=<timestamp>` cache buster.
> `raw.githubusercontent.com` sits behind a CDN, and without it a just-pushed
> version bump can take minutes to appear.

## Known limitations

**Saving a preset can't be silent, and its start folder can't be set.**
`Save Animation Preset` is an AE menu command with no path argument —
ExtendScript cannot choose the destination, and cannot tell the dialog where to
open either. AE picks that from its own last-used-directory memory, which every
other file dialog in the app (import, save project, Collect Files) also writes
to, which is why it appears to wander.

So both *Save Animation+ (.zfx)* and *Save Animation (.ffx)* snapshot every
`.ffx` they can see, fire the command, wait on AE's modal, then find the new file
and file it into the selected category. **Wherever you point the dialog, the file
lands correctly** — the start folder is cosmetic.

Two things soften the wandering:

* `Folder.current` is set to the category folder before the modal opens. Some
  native dialogs inherit the process working directory as their default; whether
  AE's does varies by version and platform, so this is a nudge, never a
  guarantee.
* If the watched folders (category, preset root, every `User Presets`) come up
  empty, a **rescue sweep** looks for any `.ffx` written since the modal opened,
  two levels deep in the Desktop, the open project's folder and Documents. A
  file found there is still filed into the category, and the log names where it
  came from. Only if that also misses does the panel report failure — and it
  then lists every folder it looked in.

A rescued `.ffx` is never deleted by the `.zfx` path. Those folders were not
snapshotted, so "AE created this file" cannot be told from "AE overwrote this
file", and the panel only removes an `.ffx` it knows it made.

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

**ExtendScript `File` objects cache their filesystem state.** A file written by
AE *through* an object — `saveFrameToPng`, the render queue — does not reliably
refresh it, and `remove()` returns `false` for a file that is already gone. Both
lie in the direction of a false alarm: a successful export reported as *"no file
was written"*, or a completed delete reported as *"open somewhere else"*. Every
such check goes through `_fileAppeared()` / `_removedFile()`, which re-stat with
a fresh object and fall back to reading the directory — a listing cannot be
answered from a stale per-file cache.

**A dropdown's item list cannot be read from script.** After Effects exposes
`setPropertyParameters()` for writing a Dropdown Menu Control's items but has
never documented a getter. It does not matter in practice — AE's own preset
format carries the list, so `applyPreset()` restores it — but it does mean the
panel must never try to write one back. See
[Dropdown Menu Control items](#dropdown-menu-control-items).

**Moving a bundle can be slow.** ExtendScript has no cross-folder move, so the
panel asks the OS first (`move` / `mv`), which is instant on the same volume.
Only when that fails does it fall back to copying the tree and deleting the
original — and a collected `(Footage)` folder can be large, with AE frozen
throughout. A part-finished copy is rolled back rather than left behind.

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
*New Folder…* once, which seeds one from the folders already present.

**A collected project shows as a category instead of a card** — the folder is
missing every bundle signal. Give it a `(Footage)` subfolder, keep the Collect
Files report next to the `.aep`, or name the folder `<project> folder`. Two
`.aep` files in one folder also disqualify it, by design.

**"… is not empty" when deleting a folder** — that is the guard, not a bug. Move
or delete the contents first; *Reveal in Explorer* is in the same menu.

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

**A `.zfx` says it "was written by Quick Save"** — that command was removed. It
rebuilt presets from JSON with no embedded `.ffx`, so it could not carry a
dropdown's item list or anything else script cannot read. Re-save the preset with
*Save Animation+*.

**Dropdown Menu Control items come back wrong after applying a preset** — should
no longer happen. `applyPreset()` restores them from AE's own preset data, and
the panel no longer writes the list back on top;
`setPropertyParameters()` rebuilds the effect rather than editing it, which drops
the name you gave it and breaks expressions that reference it.

**Decompose left a null behind** — the precomp layer's transform could not be
baked exactly. The log names which of the three reasons applied: an animated
transform, a 3D precomp layer, or a shear. See [Decompose](#decompose).

**Layers moved or resized after Decompose** — check the log for what was *not*
carried. Anything applied **to** the precomp layer (effects, masks, blend mode,
opacity) acts on the flattened result and has no per-layer equivalent. Ctrl+Z
backs the whole operation out in one step.

**The status row shows only a dot** — that is the default. Click the dot to show
the text; hovering it shows the last message either way.
