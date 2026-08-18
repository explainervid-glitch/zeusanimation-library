// host.jsx — ExtendScript (ES3) for Adobe After Effects
// Functions the ZeusPack panel calls via CSInterface.evalScript.
// Every function returns a JSON STRING: { ok, message, data }.
//
// The AE asset unit is a COMPOSITION inside an .aep project file — the direct
// analog of a Blender collection (.blend) or an Animate symbol (.fla). Because
// an .aep is a binary project we cannot read off disk, importing/enumerating
// its comps must go through AE itself: app.project.importFile() on an .aep
// pulls the whole project in as a folder (comps + their footage/precomps).

// ── Minimal ES3 JSON.stringify (older ExtendScript has no JSON) ──
if (typeof JSON === "undefined") { JSON = {}; }
if (typeof JSON.stringify !== "function") {
    JSON.stringify = function (obj) {
        var t = typeof obj;
        if (t !== "object" || obj === null) {
            if (t === "string") obj = '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
            return String(obj);
        } else {
            var json = [];
            var isArray = (obj && obj.constructor === Array);
            for (var k in obj) {
                if (!obj.hasOwnProperty(k)) continue;
                var v = obj[k]; t = typeof v;
                if (t === "string") { v = '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
                else if (t === "object" && v !== null) { v = JSON.stringify(v); }
                json.push((isArray ? "" : '"' + k + '":') + String(v));
            }
            return (isArray ? "[" : "{") + String(json) + (isArray ? "]" : "}");
        }
    };
}

function _result(ok, message, data) {
    return JSON.stringify({ ok: !!ok, message: message || "", data: (data === undefined ? null : data) });
}

// Snapshot the ids of every CompItem currently in the project.
function _compIdSet(proj) {
    var set = {};
    for (var i = 1; i <= proj.numItems; i++) {
        var it = proj.item(i);
        if (it instanceof CompItem) set[it.id] = true;
    }
    return set;
}


// Simple round-trip check.
function zae_ping(params) {
    return _result(true, "pong from After Effects", { version: (app.version || "") });
}

// Read the active project — proves ZeusPack <-> panel <-> AE works.
function zae_getActiveProjectInfo(params) {
    try {
        var proj = app.project;
        if (!proj) return _result(false, "No project open in After Effects.");
        var comps = [], footage = 0;
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i);
            if (it instanceof CompItem) comps.push(it.name);
            else if (it instanceof FootageItem) footage++;
        }
        var data = {
            file:     (proj.file ? proj.file.fsName : ""),
            numItems: proj.numItems,
            comps:    comps,
            footage:  footage
        };
        return _result(true, "Project: " + (proj.file ? proj.file.displayName : "(unsaved)") +
                       " — " + comps.length + " comp(s).", data);
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Import a source .aep and report the compositions it brought in, WITHOUT
// touching the active comp. Use this to populate a picker: the app can then
// call import-aep again with a chosen comp to place it, or just keep these.
//
// AE has no API to list comps in an .aep without importing, so this DOES import
// the project (into a folder). If `cleanup` is true and nothing was requested to
// stay, the imported items are removed again after enumeration — but note that
// re-importing per pick is wasteful, so the app should cache this list.
function zae_listAepComps(params) {
    try {
        params = params || {};
        if (!params.aepPath) return _result(false, "No .aep path provided.");
        var f = new File(params.aepPath);
        if (!f.exists) return _result(false, "File not found: " + params.aepPath);

        var proj = app.project;
        if (!proj) return _result(false, "No project open in After Effects.");

        var before = _compIdSet(proj);
        app.beginUndoGroup("ZeusPack: list .aep comps");
        var imported = proj.importFile(new ImportOptions(f));   // whole project as a folder
        var newComps = [];
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i);
            if (it instanceof CompItem && !before[it.id]) {
                newComps.push({ name: it.name, id: it.id, width: it.width, height: it.height, duration: it.duration });
            }
        }
        // Optional cleanup — remove what we just imported (enumeration only).
        if (params.cleanup && imported && imported.remove) {
            try { imported.remove(); } catch (e2) {}
        }
        app.endUndoGroup();

        return _result(true, newComps.length + " composition(s) in " + f.name + ".",
                       { file: f.fsName, comps: newComps });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Import a composition from a source .aep into the running project.
// AE imports the .aep as a folder (the comp + its dependencies). If a specific
// `comp` name is given, we locate it among the newly-imported comps and:
//   - open it (params.open !== false), and
//   - optionally add it as a layer to the active comp (params.addToActive).
function zae_importAep(params) {
    try {
        params = params || {};
        if (!params.aepPath) return _result(false, "No .aep path provided.");
        var f = new File(params.aepPath);
        if (!f.exists) return _result(false, "File not found: " + params.aepPath);

        var proj = app.project;
        if (!proj) return _result(false, "No project open in After Effects.");

        // Resolve the destination composition (the one we drop the import into
        // as a layer). Prefer the active comp — but clicking the CEP panel can
        // steal focus so proj.activeItem may be null. Fall back to the only
        // pre-existing comp when there's exactly one, so a single working comp
        // is always a valid target.
        var activeBefore = proj.activeItem;
        var destComp = (activeBefore && (activeBefore instanceof CompItem)) ? activeBefore : null;

        var preComps = [];
        for (var pi = 1; pi <= proj.numItems; pi++) {
            var pit = proj.item(pi);
            if (pit instanceof CompItem) preComps.push(pit);
        }
        if (!destComp && preComps.length === 1) destComp = preComps[0];

        var before = _compIdSet(proj);
        app.beginUndoGroup("ZeusPack: import .aep");
        proj.importFile(new ImportOptions(f));

        // Collect the newly-imported comps (CompItem refs, not just names).
        var newComps = [], newRefs = [], target = null;
        var want = params.comp ? String(params.comp) : null;
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i);
            if (it instanceof CompItem && !before[it.id]) {
                newComps.push(it.name);
                newRefs.push(it);
                if (want && it.name === want) target = it;
            }
        }

        // No explicit comp asked for → pick the "main" one automatically: the
        // top-level comp that ISN'T used as a layer inside any other imported
        // comp. (Precomps are nested, so they get filtered out.)
        if (!target && newRefs.length) {
            var nested = {};
            for (var a = 0; a < newRefs.length; a++) {
                var comp = newRefs[a];
                for (var L = 1; L <= comp.numLayers; L++) {
                    var src = comp.layer(L).source;
                    if (src && (src instanceof CompItem)) nested[src.id] = true;
                }
            }
            var topLevel = [];
            for (var b = 0; b < newRefs.length; b++) {
                if (!nested[newRefs[b].id]) topLevel.push(newRefs[b]);
            }
            // Prefer the single top-level comp; fall back to the first import.
            target = topLevel.length ? topLevel[0] : newRefs[0];
        }

        // Add the chosen comp directly into the destination composition as a
        // layer. Default ON — pass addToActive:false to only import + open.
        var placed = false, opened = false;
        if (target) {
            if (params.addToActive !== false && destComp && destComp.id !== target.id) {
                var newLayer = destComp.layers.add(target);
                try { newLayer.selected = true; } catch (eSel) {}
                // Bring the destination comp to the front so the placement is
                // visible even if the panel had stolen focus.
                try { destComp.openInViewer(); } catch (eView) {}
                placed = true;
            }
            if (!placed && params.open !== false) { target.openInViewer(); opened = true; }
        }
        app.endUndoGroup();

        var msg = "Imported '" + f.name + "' (" + newComps.length + " comp(s))";
        if (want && !target) msg += " — comp '" + want + "' not found in project.";
        else if (target) {
            msg += " — '" + target.name + "'" +
                   (placed ? " added to '" + destComp.name + "'"
                           : (opened ? " opened"
                                     : (destComp ? " ready in project"
                                                 : " ready in project (no active comp to drop into)")));
        }
        return _result(true, msg, {
            file: f.fsName, comps: newComps, target: (target ? target.name : null),
            targetFound: !!target, opened: opened, placed: placed,
            dest: (destComp ? destComp.name : null)
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e3) {}
        return _result(false, "Exception: " + e.toString());
    }
}

// ═══════════════════════════════════════════════════════════════
//  PRESET BROWSER (.ffx)
// ═══════════════════════════════════════════════════════════════
// Animation presets are plain files on disk, so unlike comps they can be
// enumerated without going through the project. The panel lists them and shows
// a preview taken from a sibling media file of the same base name:
//
//   Glow Pop.ffx
//   Glow Pop.mp4     ← preview, picked up automatically
//
// NOTE: saving a preset cannot be scripted — "Save Animation Preset" is a menu
// command with no path argument. Presets are authored in AE the normal way;
// this browser only reads, previews and applies them.

var _PREVIEW_EXTS = ["mp4", "webm", "png", "jpg", "jpeg", "gif"];
var _MAX_PRESETS  = 600;    // guard: a deep preset tree shouldn't hang the panel
var _MAX_DEPTH    = 4;

// Preset roots offered in the panel's dropdown. Zeus first and default; the
// User Presets entry has no fixed path because the folder is named after the
// AE version ("After Effects 2026") and is resolved at runtime.
var _ZEUS_ROOT = "W:\\AE PACK ZEUSANIMATION";

// After Effects drops "Adobe After Effects Auto-Save" next to whatever project
// it is working on, and it would otherwise show up as a category. categories.json
// is the real fix; this is the safety net for folders with no manifest yet.
var _IGNORED_FOLDER = /auto[\- ]?save/i;

var _CATEGORIES_FILE = "categories.json";

// ExtendScript's JSON support is inconsistent across AE versions — parse when
// it exists, otherwise fall back to eval. The file is a local, team-owned
// manifest, not untrusted input.
function _parseJson(txt) {
    try { if (typeof JSON !== "undefined" && typeof JSON.parse === "function") return JSON.parse(txt); }
    catch (e) {}
    try { return eval("(" + txt + ")"); } catch (e2) { return null; }
}

// Declared categories, or null when there is no manifest (caller then falls
// back to discovering folders).
// Accepts ["A","B"] or { "categories": ["A","B"] } — same shape ZeusPack's
// categories*.json files use.
function _readCategories(rootFolder) {
    var f = new File(rootFolder.fsName + "/" + _CATEGORIES_FILE);
    if (!f.exists) return null;
    var txt = "";
    try { f.open("r"); txt = f.read(); f.close(); } catch (e) { try { f.close(); } catch (e9) {} return null; }

    var data = _parseJson(txt);
    if (!data) return null;
    var arr = (data.length === undefined && data.categories) ? data.categories : data;
    if (!arr || arr.length === undefined) return null;

    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var s = String(arr[i]).replace(/^\s+|\s+$/g, "");
        if (s) out.push(s);
    }
    return out;
}

// Written by hand as pretty JSON: this file is meant to be readable and
// editable on the shared drive, and the ES3 stringify shim emits one long line.
function _writeCategories(rootFolder, list) {
    var f = new File(rootFolder.fsName + "/" + _CATEGORIES_FILE);
    var s = "[\n";
    for (var i = 0; i < list.length; i++) {
        s += '  "' + String(list[i]).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
           + (i < list.length - 1 ? "," : "") + "\n";
    }
    s += "]\n";
    f.encoding = "UTF-8";
    f.open("w");
    f.write(s);
    f.close();
    return true;
}

function _inList(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i] === name) return true;
    return false;
}

// The roots the panel's path dropdown offers.
function zae_presetRoots(params) {
    var roots = [];

    var zeus = new Folder(_ZEUS_ROOT);
    roots.push({ id: "zeus", label: "Zeus Presets", path: _ZEUS_ROOT, exists: zeus.exists });

    var found = _findUserPresetFolders();
    roots.push({
        id: "user", label: "User Presets",
        path: found.length ? found[0].path : "",
        exists: found.length > 0
    });

    return _result(true, "ok", { roots: roots, defaultId: "zeus" });
}

// Create a category folder and record it in categories.json.
function zae_addCategory(params) {
    try {
        var root   = params && params.root   ? String(params.root)   : "";
        var name   = params && params.name   ? String(params.name)   : "";
        var parent = params && params.parent ? String(params.parent) : "";
        name = name.replace(/^\s+|\s+$/g, "");

        if (!root) return _result(false, "No folder given.");
        if (!name) return _result(false, "Enter a category name.");
        // Keep it a single folder name — no traversal, no reserved characters.
        if (/[\\\/:\*\?"<>\|]/.test(name)) return _result(false, 'Name cannot contain \\ / : * ? " < > |');
        if (name === "." || name === "..") return _result(false, "Invalid name.");

        var rootFolder = new Folder(root);
        if (!rootFolder.exists) return _result(false, "Folder not found: " + root);

        // A parent means this is a SUBcategory. Those are discovered by the
        // scan rather than declared, so only top-level ones touch the manifest.
        var parentFolder = _ensureFolder(root, parent);
        if (!parentFolder) return _result(false, "Could not open " + (parent || "the preset root"));

        var dir = new Folder(parentFolder.fsName + "/" + name);
        var createdFolder = false;
        if (!dir.exists) {
            if (!dir.create()) return _result(false, "Could not create folder: " + name);
            createdFolder = true;
        }

        if (parent) {
            return _result(true,
                createdFolder ? 'Added "' + parent + "/" + name + '"'
                              : '"' + parent + "/" + name + '" already exists',
                { categories: null, created: createdFolder, parent: parent });
        }

        var cats = _readCategories(rootFolder);
        // No manifest yet: seed it from the folders already there, so switching
        // to declared categories doesn't silently hide existing presets.
        if (cats === null) {
            cats = [];
            var entries = rootFolder.getFiles();
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                if (!(e instanceof Folder)) continue;
                var n = _baseName(e);
                if (n.charAt(0) === "." || _IGNORED_FOLDER.test(n)) continue;
                if (!_inList(cats, n)) cats.push(n);
            }
        }
        var already = _inList(cats, name);
        if (!already) cats.push(name);

        cats.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
        _writeCategories(rootFolder, cats);

        return _result(true,
            already && !createdFolder ? '"' + name + '" already exists' : 'Added "' + name + '"',
            { categories: cats, created: createdFolder });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// ExtendScript's File.name is URI-encoded; displayName is not always present on
// older hosts, so fall back through both.
function _baseName(f) {
    var n = "";
    try { n = f.displayName; } catch (e) {}
    if (!n) { try { n = decodeURI(f.name); } catch (e2) { n = String(f.name); } }
    return n;
}

function _extOf(name) {
    var i = String(name).lastIndexOf(".");
    return i === -1 ? "" : String(name).substring(i + 1).toLowerCase();
}

function _stripExt(name) {
    var i = String(name).lastIndexOf(".");
    return i === -1 ? String(name) : String(name).substring(0, i);
}

function _isPreviewExt(ext) {
    for (var i = 0; i < _PREVIEW_EXTS.length; i++) if (_PREVIEW_EXTS[i] === ext) return true;
    return false;
}

// Both an .mp4 and a .png preview can exist for the same asset now that each
// can be exported separately. Rank them so the grid's choice is deterministic
// rather than "whichever the directory listing returned last" — motion beats a
// still.
function _previewRank(ext) {
    for (var i = 0; i < _PREVIEW_EXTS.length; i++) if (_PREVIEW_EXTS[i] === ext) return i;
    return 99;
}

// Every "…/Documents/Adobe/After Effects */User Presets" on this machine.
// Scanning beats deriving the folder from app.version: the directory is named
// "After Effects CC 2018" on old builds and "After Effects 2024" on new ones,
// and a user may have several installed.
function _findUserPresetFolders() {
    var out = [];
    try {
        var adobe = new Folder(Folder.myDocuments.fsName + "/Adobe");
        if (!adobe.exists) return out;
        var dirs = adobe.getFiles();
        for (var i = 0; i < dirs.length; i++) {
            var d = dirs[i];
            if (!(d instanceof Folder)) continue;
            if (String(_baseName(d)).indexOf("After Effects") !== 0) continue;
            var up = new Folder(d.fsName + "/User Presets");
            if (up.exists) out.push({ path: up.fsName, label: _baseName(d), modified: (up.modified ? up.modified.getTime() : 0) });
        }
    } catch (e) {}
    out.sort(function (a, b) { return b.modified - a.modified; });   // newest install first
    return out;
}

function zae_userPresetsPath(params) {
    var found = _findUserPresetFolders();
    if (!found.length) {
        return _result(false, "No User Presets folder found under Documents/Adobe.", { folders: [] });
    }
    return _result(true, found[0].path, { path: found[0].path, folders: found });
}

// Native folder picker, so the user can point at a shared preset library
// instead of their local User Presets.
function zae_pickPresetFolder(params) {
    try {
        var start = (params && params.path) ? new Folder(params.path) : Folder.myDocuments;
        var picked = start.selectDlg("Choose a folder containing .ffx presets");
        if (!picked) return _result(false, "Cancelled.");
        return _result(true, picked.fsName, { path: picked.fsName });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Recursive .ffx walk. Collects previews per directory so a folder is only
// listed once no matter how many presets it holds.
// `allowed` (an array, or null) gates which TOP-LEVEL folders are entered.
// Non-null means categories.json declared the list, so anything else — most
// importantly After Effects' Auto-Save folder — is skipped entirely.
function _walkPresets(folder, depth, relPrefix, acc, allowed) {
    if (depth > _MAX_DEPTH || acc.presets.length >= _MAX_PRESETS) return;

    var entries;
    try { entries = folder.getFiles(); } catch (e) { return; }
    if (!entries) return;

    var subFolders = [];
    var ffx = [];             // [{ file, base }] — animation presets
    var aep = [];             // [{ file, base }] — projects
    var previews = {};        // base name (lowercased) → { path, ext }
    var projects = {};        // base name (lowercased) → .aep path

    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e instanceof Folder) { subFolders.push(e); continue; }
        var name = _baseName(e);
        var ext  = _extOf(name);
        var base = _stripExt(name);
        if (ext === "ffx") ffx.push({ file: e, base: base });
        else if (ext === "aep") {
            aep.push({ file: e, base: base });
            projects[base.toLowerCase()] = e.fsName;
        } else if (_isPreviewExt(ext)) {
            var pk = base.toLowerCase();
            var prev = previews[pk];
            if (!prev || _previewRank(ext) < _previewRank(prev.ext)) {
                // mtime rides along so the panel can cache-bust the file:// URL
                // after a re-render — see fileUrl() in panel.js.
                var mt = 0;
                try { mt = e.modified ? e.modified.getTime() : 0; } catch (eM) {}
                previews[pk] = { path: e.fsName, ext: ext, mtime: mt };
            }
        }
    }

    // .ffx wins. An .aep sharing a preset's name is that preset's preview
    // project, not an asset of its own — so it must not produce a second card.
    var claimed = {};
    var j, key, pv;

    for (j = 0; j < ffx.length; j++) {
        if (acc.presets.length >= _MAX_PRESETS) { acc.truncated = true; return; }
        key = ffx[j].base.toLowerCase();
        claimed[key] = true;
        pv = previews[key] || null;
        acc.presets.push({
            kind:        "preset",              // animation preset (.ffx)
            name:        ffx[j].base,
            path:        ffx[j].file.fsName,
            folder:      relPrefix || "",
            preview:     pv ? pv.path : "",
            previewKind: pv ? (pv.ext === "mp4" || pv.ext === "webm" ? "video" : "image") : "",
            previewMtime: pv ? pv.mtime : 0,
            // The .aep the preview was rendered from, when one exists.
            project:     projects[key] || ""
        });
    }

    // Fallback: a project with no preset of the same name is a composition asset.
    for (j = 0; j < aep.length; j++) {
        if (acc.presets.length >= _MAX_PRESETS) { acc.truncated = true; return; }
        key = aep[j].base.toLowerCase();
        if (claimed[key]) continue;
        pv = previews[key] || null;
        acc.presets.push({
            kind:        "comp",                // composition (.aep)
            name:        aep[j].base,
            path:        aep[j].file.fsName,
            folder:      relPrefix || "",
            preview:     pv ? pv.path : "",
            previewKind: pv ? (pv.ext === "mp4" || pv.ext === "webm" ? "video" : "image") : "",
            previewMtime: pv ? pv.mtime : 0,
            project:     aep[j].file.fsName     // it IS the project
        });
    }

    for (var k = 0; k < subFolders.length; k++) {
        var sub = subFolders[k];
        var nm  = _baseName(sub);
        if (nm.charAt(0) === ".") continue;
        if (_IGNORED_FOLDER.test(nm)) continue;
        // Only the top level is gated — once inside a declared category, its
        // own subfolders are walked normally.
        if (depth === 0 && allowed && !_inList(allowed, nm)) continue;
        _walkPresets(sub, depth + 1, relPrefix ? (relPrefix + "/" + nm) : nm, acc, allowed);
    }
}

function zae_listPresets(params) {
    try {
        var dir = params && params.path ? String(params.path) : "";
        if (!dir) return _result(false, "No folder given.");
        var folder = new Folder(dir);
        if (!folder.exists) return _result(false, "Folder not found: " + dir);

        var declared = _readCategories(folder);   // null when there is no manifest
        var acc = { presets: [], truncated: false };
        _walkPresets(folder, 0, "", acc, declared);

        acc.presets.sort(function (a, b) {
            if (a.folder !== b.folder) return a.folder < b.folder ? -1 : 1;
            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
        });

        var withPreview = 0;
        for (var i = 0; i < acc.presets.length; i++) if (acc.presets[i].preview) withPreview++;

        return _result(true, acc.presets.length + " preset" + (acc.presets.length === 1 ? "" : "s"), {
            path: folder.fsName,
            presets: acc.presets,
            withPreview: withPreview,
            truncated: acc.truncated,
            // Declared categories drive the sidebar list, so an empty category
            // still shows and can be filled. null = no manifest yet.
            categories: declared,
            hasManifest: declared !== null
        });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Apply a .ffx to whatever is selected in the active comp.
// Depth-first walk of a layer's property tree, visiting only leaf properties.
// The key is an index+matchName path, which is stable enough to tell "this
// property existed before" from "the preset created it".
function _walkProps(group, path, visit, depth) {
    if (!group || depth > 8) return;
    var n = 0;
    try { n = group.numProperties; } catch (e) { return; }

    for (var i = 1; i <= n; i++) {
        var p = null;
        try { p = group.property(i); } catch (e2) { continue; }
        if (!p) continue;

        var key = path + "/" + i + ":" + (p.matchName || p.name || "");
        var t = null;
        try { t = p.propertyType; } catch (e3) {}

        if (t === PropertyType.PROPERTY) visit(p, key);
        else _walkProps(p, key, visit, depth + 1);
    }
}

// Keyframe values are numbers or arrays depending on the property.
function _sameKeyValue(a, b) {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;

    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;

    if (a.length !== undefined && b.length !== undefined) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) {
            if (Math.abs(a[i] - b[i]) > 1e-6) return false;
        }
        return true;
    }
    return false;   // Shape / TextDocument etc. — not comparable, treat as different
}

// Keep only the ENTRANCE segment of the keyframes a preset created.
//
// Many presets animate in AND out; "Apply In" should leave just the entrance so
// the exit can be timed separately (or added with Apply Out).
//
// Finding the split by value rather than by count:
//   1. An in/out preset SETTLES — two consecutive keyframes hold the same value
//      — and the exit starts after that hold. Cut at the start of the hold.
//   2. Otherwise, a preset that ends exactly where it started is symmetric, so
//      the first half is the entrance.
//   3. Neither pattern means there is no evidence of an exit, so nothing is
//      removed. Two keyframes is a single move and is always left alone.
function _trimToIn(p) {
    var n = 0;
    try { n = p.numKeys; } catch (e) { return 0; }
    if (n < 3) return 0;

    var cut = 0, i;
    for (i = 1; i < n; i++) {
        if (_sameKeyValue(p.keyValue(i), p.keyValue(i + 1))) { cut = i; break; }
    }
    if (!cut && _sameKeyValue(p.keyValue(1), p.keyValue(n))) cut = Math.ceil(n / 2);
    if (!cut || cut >= n) return 0;

    // Back to front, so the indices of the keys still to remove don't shift.
    var removed = 0;
    for (i = n; i > cut; i--) {
        try { p.removeKey(i); removed++; } catch (e2) {}
    }
    return removed;
}

// Time-Reverse Keyframes acts on the comp's SELECTED keyframes, so anything
// already selected elsewhere would be reversed too.
function _deselectAllKeys(comp) {
    for (var L = 1; L <= comp.numLayers; L++) {
        _walkProps(comp.layer(L), "L" + L, function (p) {
            var sel;
            try { sel = p.selectedKeys; } catch (e) { return; }
            for (var s = 0; s < sel.length; s++) {
                try { p.setSelectedAtKey(sel[s], false); } catch (e2) {}
            }
        }, 0);
    }
}

// Apply an animation preset to the selected layer(s).
//
// params.reverse — "Apply Out": run the preset, then time-reverse the keyframes
// it created, turning an in-animation into its out-animation.
//
// The reversal uses AE's own Keyframe Assistant rather than rewriting keys by
// hand: doing it manually means reconstructing temporal easing, spatial
// tangents and hold keys, and getting any of that subtly wrong is worse than
// not offering the feature.
//
// Only properties the preset itself animated are reversed. Properties that
// already had keyframes are left alone — reversing a layer's pre-existing
// animation because a preset happened to be dropped on it would be surprising.
function zae_applyPreset(params) {
    try {
        var path = params && params.path ? String(params.path) : "";
        if (!path) return _result(false, "No preset path given.");
        var f = new File(path);
        if (!f.exists) return _result(false, "Preset not found: " + path);

        var reverse = !!(params && params.reverse);

        var comp = app.project ? app.project.activeItem : null;
        if (!(comp instanceof CompItem)) return _result(false, "Open a composition first.");

        var layers = comp.selectedLayers;
        if (!layers || !layers.length) return _result(false, "Select at least one layer.");

        var i, L;
        app.beginUndoGroup(reverse ? "ZeusPack: Apply Preset (out)" : "ZeusPack: Apply Preset (in)");

        // Snapshot key counts so the newly-animated properties can be told apart
        // from animation the layer already had.
        var before = {};
        for (i = 0; i < layers.length; i++) {
            _walkProps(layers[i], "L" + i, function (p, key) {
                var n = 0;
                try { n = p.numKeys; } catch (e) {}
                before[key] = n;
            }, 0);
        }

        var applied = 0;
        for (i = 0; i < layers.length; i++) {
            try { layers[i].applyPreset(f); applied++; } catch (e2) {}
        }

        if (!applied) {
            app.endUndoGroup();
            return _result(false, "Could not apply to the selected layer(s).");
        }

        var fresh = [];
        for (i = 0; i < layers.length; i++) {
            _walkProps(layers[i], "L" + i, function (p, key) {
                var had = before.hasOwnProperty(key) ? before[key] : -1;
                var now = 0;
                try { now = p.numKeys; } catch (e) {}
                // had <= 0 covers both "property is new" and "existed but was
                // static". Two keys minimum — one has nothing to trim or reverse.
                if (had <= 0 && now > 1) fresh.push(p);
            }, 0);
        }

        // Drop the exit half BEFORE any reversal, so Apply Out reverses the
        // entrance rather than flipping an in+out pair back on itself.
        var trimmedKeys = 0, trimmedProps = 0;
        if (params.trim !== false) {
            for (i = 0; i < fresh.length; i++) {
                var t = _trimToIn(fresh[i]);
                if (t) { trimmedKeys += t; trimmedProps++; }
            }
        }

        var reversedProps = 0, cmdId = 0;
        if (reverse) {
            if (fresh.length) {
                _deselectAllKeys(comp);
                for (i = 0; i < fresh.length; i++) {
                    var p = fresh[i];
                    for (var k = 1; k <= p.numKeys; k++) {
                        try { p.setSelectedAtKey(k, true); } catch (e3) {}
                    }
                    reversedProps++;
                }

                // Keyframe Assistant commands read the front-most comp viewer.
                try { comp.openInViewer(); } catch (e4) {}

                var names = ["Time-Reverse Keyframes", "Time Reverse Keyframes"];
                for (i = 0; i < names.length && !cmdId; i++) {
                    try { cmdId = app.findMenuCommandId(names[i]); } catch (e5) {}
                }
                if (cmdId) { try { app.executeCommand(cmdId); } catch (e6) { cmdId = 0; } }
            }
        }

        app.endUndoGroup();

        var msg = "Applied to " + applied + " layer" + (applied === 1 ? "" : "s");
        if (trimmedProps) {
            msg += ", dropped the exit from " + trimmedProps + " propert"
                 + (trimmedProps === 1 ? "y" : "ies")
                 + " (" + trimmedKeys + " keyframe" + (trimmedKeys === 1 ? "" : "s") + ")";
        }
        if (reverse) {
            if (!reversedProps)   msg += " — no keyframes to reverse (static preset)";
            else if (!cmdId)      msg += " — but Time-Reverse Keyframes was not found on this AE version";
            else                  msg += ", reversed " + reversedProps + " animated propert"
                                       + (reversedProps === 1 ? "y" : "ies");
        }

        return _result(reverse ? (!reversedProps || !!cmdId) : true, msg, {
            applied: applied, comp: comp.name,
            trimmedProps: trimmedProps, trimmedKeys: trimmedKeys,
            reversed: reversedProps, reverseApplied: !!cmdId
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e7) {}
        return _result(false, "Exception: " + e.toString());
    }
}

// Make or edit the preview project that sits beside a preset.
//
// A finished preset is three files sharing one base name:
//   Glow Pop.ffx   the preset itself
//   Glow Pop.aep   the project the preview was built in  ← this function
//   Glow Pop.mp4   the rendered preview the grid shows
//
// After Effects holds ONE project at a time, so both branches replace whatever
// is currently open. AE puts up its own save prompt when the current project is
// dirty; if the user cancels that, app.newProject()/app.open() return null and
// we report it rather than pressing on.
function zae_makePreviewComp(params) {
    try {
        var ffxPath = params && params.path ? String(params.path) : "";
        if (!ffxPath) return _result(false, "No preset path given.");

        var ffx = new File(ffxPath);
        if (!ffx.exists) return _result(false, "Asset not found: " + ffxPath);

        var name = params.name ? String(params.name) : _stripExt(_baseName(ffx));
        var aep  = new File(ffx.parent.fsName + "/" + name + ".aep");

        // ── Exists → just open it ──
        if (aep.exists) {
            var openedProj = app.open(aep);
            if (!openedProj) return _result(false, "Cancelled — current project kept.");
            return _result(true, "Opened " + name + ".aep", {
                path: aep.fsName, created: false
            });
        }

        // ── Missing → new project + comp, saved next to the .ffx ──
        var w   = params.width    ? Number(params.width)    : 480;
        var h   = params.height   ? Number(params.height)   : 270;
        var fps = params.fps      ? Number(params.fps)      : 30;
        var dur = params.duration ? Number(params.duration) : 3;

        var proj = app.newProject();
        if (!proj) return _result(false, "Cancelled — current project kept.");

        var comp = proj.items.addComp(name, w, h, 1, dur, fps);
        comp.openInViewer();

        // Save immediately so the .aep exists on disk and the grid can see it
        // on the next rescan, even if the user closes AE without saving again.
        proj.save(aep);

        return _result(true, "Created " + name + ".aep (" + w + "x" + h + " @ " + fps + "fps)", {
            path: aep.fsName, created: true, width: w, height: h, fps: fps, duration: dur
        });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Pick the best available H.264 output module template.
//
// AE's render queue lost H.264 after CC 2014 and only got it back in 23.0
// (2023), and template names differ between versions — so rather than hardcode
// one, search what this install actually offers. A user-made template wins:
// create one called "ZeusPack Preview" with the exact settings you want and it
// is used verbatim, which is also the reliable way to pin the bitrate on
// versions where the codec options aren't scriptable.
var _PREFERRED_TEMPLATE = "ZeusPack Preview";

function _pickH264Template(om) {
    var list;
    try { list = om.templates; } catch (e) { return ""; }
    if (!list || !list.length) return "";

    var i;
    for (i = 0; i < list.length; i++) if (list[i] === _PREFERRED_TEMPLATE) return list[i];
    // Built-in names look like "H.264 - Match Render Settings - 15 Mbps".
    for (i = 0; i < list.length; i++) if (String(list[i]).indexOf("H.264") !== -1) return list[i];
    for (i = 0; i < list.length; i++) if (String(list[i]).toLowerCase().indexOf("h264") !== -1) return list[i];
    return "";
}

// Best-effort bitrate. The H.264 "Format Options" dialog is not exposed to
// scripting on most versions; getSettings/setSettings arrived in AE 22.0 and
// even then the settable keys vary. So: probe for a bitrate-ish key, set it,
// and report truthfully whether it took — never claim 8 Mbps we did not apply.
function _trySetBitrate(om, mbps) {
    var info = { supported: false, applied: false, key: "" };
    try {
        if (typeof om.getSettings !== "function" || typeof om.setSettings !== "function") return info;
        if (typeof GetSettingsFormat === "undefined") return info;
        info.supported = true;

        var s = om.getSettings(GetSettingsFormat.STRING_SETTABLE);
        for (var k in s) {
            if (!s.hasOwnProperty(k)) continue;
            if (String(k).toLowerCase().indexOf("bitrate") === -1) continue;
            var patch = {};
            patch[k] = String(mbps);
            try {
                om.setSettings(patch);
                info.applied = true;
                info.key = String(k);
            } catch (e2) { /* key exists but is not writable on this version */ }
        }
    } catch (e) { /* pre-22.0: no settings API at all */ }
    return info;
}

// Preview comps are authored at full size but exported small. AE's render
// settings express downscale as Full/Half/Third/Quarter, so an exact integer
// factor is required — 1920x1080 → 480x270 is exactly Quarter.
function _resolutionForScale(comp, targetW) {
    var r = comp.width / targetW;
    if (Math.abs(r - 1) < 0.01) return "Full";
    if (Math.abs(r - 2) < 0.01) return "Half";
    if (Math.abs(r - 3) < 0.01) return "Third";
    if (Math.abs(r - 4) < 0.01) return "Quarter";
    return "";                     // not a clean factor — render at comp size
}

// Same probe-and-report approach as the bitrate: RenderQueueItem settings only
// became scriptable in AE 22.0, so try and be honest about the outcome.
function _trySetResolution(rqItem, value) {
    var info = { supported: false, applied: false, key: "" };
    try {
        if (typeof rqItem.getSettings !== "function" || typeof rqItem.setSettings !== "function") return info;
        if (typeof GetSettingsFormat === "undefined") return info;
        info.supported = true;

        var s = rqItem.getSettings(GetSettingsFormat.STRING_SETTABLE);
        for (var k in s) {
            if (!s.hasOwnProperty(k)) continue;
            if (String(k).toLowerCase().indexOf("resolution") === -1) continue;
            var patch = {};
            patch[k] = value;
            try { rqItem.setSettings(patch); info.applied = true; info.key = String(k); } catch (e2) {}
        }
    } catch (e) {}
    return info;
}

// Render <name>.aep's comp straight to <name>.mp4 beside the preset.
function zae_exportPreview(params) {
    try {
        var ffxPath = params && params.path ? String(params.path) : "";
        if (!ffxPath) return _result(false, "No preset path given.");

        var ffx = new File(ffxPath);
        if (!ffx.exists) return _result(false, "Asset not found: " + ffxPath);

        var name = params.name ? String(params.name) : _stripExt(_baseName(ffx));
        var dir  = ffx.parent;
        var aep  = new File(dir.fsName + "/" + name + ".aep");
        if (!aep.exists) return _result(false, 'No "' + name + '.aep" — run Make Preview Comp first.');

        // Make sure the right project is open before touching the render queue.
        var cur = (app.project && app.project.file) ? app.project.file.fsName : "";
        if (cur !== aep.fsName) {
            if (!app.open(aep)) return _result(false, "Cancelled — current project kept.");
        }
        var proj = app.project;

        // The comp shares the preset's name; fall back to the only comp there is.
        var comp = null, compCount = 0, firstComp = null;
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i);
            if (!(it instanceof CompItem)) continue;
            compCount++;
            if (!firstComp) firstComp = it;
            if (it.name === name) comp = it;
        }
        if (!comp) comp = (compCount === 1 ? firstComp : null);
        if (!comp) return _result(false, 'No composition named "' + name + '" in the project.');

        // AE refuses to render onto an existing file, so clear the previous
        // preview. Deterministic target: <name>.mp4 in the preset's own folder.
        var out = new File(dir.fsName + "/" + name + ".mp4");
        var replaced = false;
        if (out.exists) { try { out.remove(); replaced = true; } catch (e1) {} }

        var rq = proj.renderQueue;
        // Leave anything already queued alone, but don't render it with us.
        for (var q = 1; q <= rq.numItems; q++) {
            try { if (rq.item(q).status === RQItemStatus.QUEUED) rq.item(q).render = false; } catch (e2) {}
        }

        var rqItem = rq.items.add(comp);
        rqItem.render = true;

        var targetW = params.width  ? Number(params.width)  : 480;
        var targetH = params.height ? Number(params.height) : 270;
        var resName = _resolutionForScale(comp, targetW);
        var bitrate = params.bitrate ? Number(params.bitrate) : 8;

        var res = { name: resName, applied: false, supported: false };
        var br  = { supported: false, applied: false, key: "" };
        var tpl = "";

        // ── Configure the queue item ─────────────────────────────
        // applyTemplate leaves the output module NAMED after the template.
        // setSettings then reads as "modify that template", and AE stops with
        // "The name of the selected output module is already in use." — a modal
        // ExtendScript cannot dismiss, so the export just hangs there.
        //
        // Renaming the module to something unique first breaks the collision:
        // the settings then apply to this queue item alone and the saved
        // template is left untouched. Dialogs are suppressed across the whole
        // block as a second line of defence, since exactly which calls prompt
        // varies between AE versions.
        var suppressed = false;
        try { app.beginSuppressDialogs(); suppressed = true; } catch (eSup) {}

        var configErr = "";
        try {
            // Downscale the 1080p authoring comp to the preview size.
            if (resName && resName !== "Full") {
                res = _trySetResolution(rqItem, resName);
                res.name = resName;
            }

            var om = rqItem.outputModule(1);
            tpl = _pickH264Template(om);
            if (!tpl) {
                configErr = "No H.264 output module on this AE version. Create an output module "
                          + 'template named "' + _PREFERRED_TEMPLATE + '" (H.264, ' + bitrate
                          + " Mbps), or render via Media Encoder.";
            } else {
                om.applyTemplate(tpl);
                try { om.name = "ZeusPack Export " + (new Date()).getTime(); } catch (eNm) {}
                br = _trySetBitrate(om, bitrate);
                om.file = out;
            }
        } catch (eCfg) {
            configErr = "Could not configure the render: " + eCfg.toString();
        } finally {
            if (suppressed) { try { app.endSuppressDialogs(false); } catch (eSup2) {} }
        }

        if (configErr) {
            try { rqItem.remove(); } catch (e3) {}
            return _result(false, configErr);
        }

        // Render OUTSIDE the suppression — a genuine render failure should be
        // visible rather than swallowed.
        rq.render();

        var ok = out.exists;
        if (!ok) return _result(false, "Render finished but no file was written.");

        // Say what actually happened rather than what was requested — the size
        // and bitrate both depend on APIs older AE versions do not expose.
        var sizeNote;
        if (!resName)          sizeNote = "at comp size " + comp.width + "x" + comp.height + " (no clean downscale)";
        else if (resName === "Full") sizeNote = "at " + comp.width + "x" + comp.height;
        else if (res.applied)  sizeNote = "at " + targetW + "x" + targetH + " (" + resName + ")";
        else                   sizeNote = "at comp size " + comp.width + "x" + comp.height + " — could not set " + resName + " on this AE version";

        var msg = "Exported " + name + ".mp4"
                + (replaced ? " (replaced)" : "")
                + " " + sizeNote
                + " — template: " + tpl
                + (br.applied ? ", bitrate set to " + bitrate + " Mbps"
                              : ", bitrate from template");
        return _result(true, msg, {
            path: out.fsName, template: tpl, replaced: replaced,
            bitrateApplied: br.applied, bitrateKey: br.key,
            bitrateSupported: br.supported, comp: comp.name,
            resolution: resName, resolutionApplied: res.applied,
            targetWidth: targetW, targetHeight: targetH
        });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Single-frame PNG preview, as an alternative to the mp4.
//
// CompItem.saveFrameToPng writes at COMP size, and the authoring comps are
// 1080p — a 2MB still per asset would be absurd for a thumbnail. So the frame is
// sampled through a temporary comp at the target size, which is removed again
// straight afterwards.
//
// The frame taken is the one under the playhead, so moving the time indicator in
// After Effects picks which frame becomes the preview.
function zae_exportImagePreview(params) {
    try {
        var assetPath = params && params.path ? String(params.path) : "";
        if (!assetPath) return _result(false, "No asset path given.");

        var f = new File(assetPath);
        if (!f.exists) return _result(false, "Asset not found: " + assetPath);

        var name = params.name ? String(params.name) : _stripExt(_baseName(f));
        var dir  = f.parent;
        var aep  = new File(dir.fsName + "/" + name + ".aep");
        if (!aep.exists) return _result(false, 'No "' + name + '.aep" — run Make Preview Comp first.');

        var cur = (app.project && app.project.file) ? app.project.file.fsName : "";
        if (cur !== aep.fsName) {
            if (!app.open(aep)) return _result(false, "Cancelled — current project kept.");
        }
        var proj = app.project;

        var comp = null, compCount = 0, firstComp = null;
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i);
            if (!(it instanceof CompItem)) continue;
            compCount++;
            if (!firstComp) firstComp = it;
            if (it.name === name) comp = it;
        }
        if (!comp) comp = (compCount === 1 ? firstComp : null);
        if (!comp) return _result(false, 'No composition named "' + name + '" in the project.');

        var targetW = params.width  ? Number(params.width)  : 480;
        var targetH = params.height ? Number(params.height) : 270;

        var out = new File(dir.fsName + "/" + name + ".png");
        var replaced = false;
        if (out.exists) { try { out.remove(); replaced = true; } catch (e1) {} }

        var t = 0;
        try { t = comp.time || 0; } catch (e2) {}

        app.beginUndoGroup("ZeusPack: Export Image Preview");
        var tmp = null;
        try {
            tmp = proj.items.addComp("__zp_preview", targetW, targetH, 1,
                                     Math.max(comp.duration, comp.frameDuration), comp.frameRate);
            var layer = tmp.layers.add(comp);
            var s = Math.min(targetW / comp.width, targetH / comp.height) * 100;
            layer.property("Transform").property("Scale").setValue([s, s]);
            tmp.saveFrameToPng(t, out);
        } finally {
            // Always clean up the scratch comp, even if the save threw.
            if (tmp) { try { tmp.remove(); } catch (e3) {} }
            app.endUndoGroup();
        }

        if (!out.exists) return _result(false, "Render finished but no file was written.");

        return _result(true, "Exported " + name + ".png at " + targetW + "x" + targetH
                     + (replaced ? " (replaced)" : "")
                     + " — frame at " + (Math.round(t * 100) / 100) + "s", {
            path: out.fsName, width: targetW, height: targetH, time: t, replaced: replaced
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e9) {}
        return _result(false, "Exception: " + e.toString());
    }
}

// Move an asset — every file sharing its base name — into another category.
//
// "The asset" is the .ffx/.aep plus its preview, so all of them travel
// together; leaving the preview behind would orphan it and blank the card.
// Only known extensions move, so unrelated files that happen to share the name
// are left alone.
function zae_moveAsset(params) {
    try {
        var root = params && params.root ? String(params.root) : "";
        var name = params && params.name ? String(params.name) : "";
        var from = params && params.from ? String(params.from) : "";
        var to   = params && params.to   ? String(params.to)   : "";

        if (!root || !name) return _result(false, "Nothing to move.");
        if (from === to) return _result(true, name + " is already in " + (to || "root"), { moved: 0 });

        var rootFolder = new Folder(root);
        if (!rootFolder.exists) return _result(false, "Folder not found: " + root);

        var src = from ? new Folder(rootFolder.fsName + "/" + from) : rootFolder;
        if (!src.exists) return _result(false, "Source folder not found: " + from);

        var dst = _targetFolder(root, to);
        if (!dst) return _result(false, "Could not open the target category.");

        var i;
        var wanted = ["ffx", "aep"];
        for (i = 0; i < _PREVIEW_EXTS.length; i++) wanted.push(_PREVIEW_EXTS[i]);

        var entries = src.getFiles() || [];
        var moves = [], lower = name.toLowerCase();
        for (i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e instanceof Folder) continue;
            var n = _baseName(e);
            if (_stripExt(n).toLowerCase() !== lower) continue;
            if (!_inList(wanted, _extOf(n))) continue;
            moves.push({ file: e, name: n });
        }
        if (!moves.length) return _result(false, "No files found for " + name + ".");

        // Refuse up front rather than half-moving: check every destination.
        var clash = [];
        for (i = 0; i < moves.length; i++) {
            if (new File(dst.fsName + "/" + moves[i].name).exists) clash.push(moves[i].name);
        }
        if (clash.length) {
            return _result(false, '"' + (to || "root") + '" already has ' + clash.join(", "));
        }

        // Two-phase — copy everything, then delete the originals. ExtendScript
        // has no cross-folder move, and a failure part-way through would
        // otherwise split an asset across two categories. Copies made before a
        // failure are rolled back.
        var copied = [];
        for (i = 0; i < moves.length; i++) {
            var target = dst.fsName + "/" + moves[i].name;
            var ok = false;
            try { ok = moves[i].file.copy(target); } catch (e2) { ok = false; }
            if (!ok) {
                for (var c = 0; c < copied.length; c++) {
                    try { new File(copied[c]).remove(); } catch (e3) {}
                }
                return _result(false, "Could not copy " + moves[i].name + " — nothing was moved.");
            }
            copied.push(target);
        }

        var removed = 0;
        for (i = 0; i < moves.length; i++) {
            try { if (moves[i].file.remove()) removed++; } catch (e4) {}
        }

        var msg = "Moved " + name + " → " + (to || "root");
        if (removed !== moves.length) {
            msg += " (copied, but " + (moves.length - removed) + " original file(s) could not be deleted)";
        }
        return _result(true, msg, { moved: moves.length, removed: removed, to: to, files: copied.length });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Rename a category folder. The files inside travel with it, so this is a plain
// folder rename — only the manifest needs patching, and only for a top-level
// category, since subcategories are never declared.
function zae_renameCategory(params) {
    try {
        var root = params && params.root ? String(params.root) : "";
        var path = params && params.path ? String(params.path) : "";
        var to   = params && params.to   ? String(params.to)   : "";
        to = to.replace(/^\s+|\s+$/g, "");

        if (!root || !path) return _result(false, "No folder to rename.");
        if (!to) return _result(false, "Enter a new name.");
        if (/[\\\/:\*\?"<>\|]/.test(to)) return _result(false, 'Name cannot contain \\ / : * ? " < > |');
        if (to === "." || to === "..") return _result(false, "Invalid name.");

        var rootFolder = new Folder(root);
        if (!rootFolder.exists) return _result(false, "Folder not found: " + root);

        var dir = new Folder(rootFolder.fsName + "/" + path.split("/").join("/"));
        if (!dir.exists) return _result(false, "Folder not found: " + path);

        var parts     = path.split("/");
        var oldName   = parts[parts.length - 1];
        var parentRel = parts.slice(0, parts.length - 1).join("/");
        if (to === oldName) return _result(true, "Name unchanged.", { path: path });

        var parentFolder = parentRel
            ? new Folder(rootFolder.fsName + "/" + parentRel)
            : rootFolder;

        var dest = new Folder(parentFolder.fsName + "/" + to);
        if (dest.exists && dest.fsName !== dir.fsName) {
            return _result(false, '"' + to + '" already exists there.');
        }

        var ok = false;
        try { ok = dir.rename(to); } catch (e2) { ok = false; }
        if (!ok) return _result(false, "Could not rename " + oldName + ".");

        // Top-level categories are declared; keep the manifest in step.
        var patched = false;
        if (!parentRel) {
            var cats = _readCategories(rootFolder);
            if (cats) {
                for (var i = 0; i < cats.length; i++) {
                    if (cats[i] === oldName) { cats[i] = to; patched = true; }
                }
                if (patched) _writeCategories(rootFolder, cats);
            }
        }

        var newPath = parentRel ? parentRel + "/" + to : to;
        return _result(true, "Renamed " + oldName + " → " + to, {
            path: newPath, from: path, manifestUpdated: patched
        });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Rename an asset — every file sharing its base name, so the .ffx/.aep/preview
// stay a set. Renaming only the .ffx would orphan the others.
function zae_renameAsset(params) {
    try {
        var root   = params && params.root   ? String(params.root)   : "";
        var folder = params && params.folder ? String(params.folder) : "";
        var from   = params && params.from   ? String(params.from)   : "";
        var to     = params && params.to     ? String(params.to)     : "";
        to = to.replace(/^\s+|\s+$/g, "");

        if (!root || !from) return _result(false, "Nothing to rename.");
        if (!to) return _result(false, "Enter a new name.");
        if (/[\\\/:\*\?"<>\|]/.test(to)) return _result(false, 'Name cannot contain \\ / : * ? " < > |');
        if (to === from) return _result(true, "Name unchanged.", { renamed: 0, name: from });

        var rootFolder = new Folder(root);
        if (!rootFolder.exists) return _result(false, "Folder not found: " + root);
        var dir = folder ? new Folder(rootFolder.fsName + "/" + folder) : rootFolder;
        if (!dir.exists) return _result(false, "Folder not found: " + folder);

        var i, wanted = ["ffx", "aep"];
        for (i = 0; i < _PREVIEW_EXTS.length; i++) wanted.push(_PREVIEW_EXTS[i]);

        var entries = dir.getFiles() || [], targets = [], lower = from.toLowerCase();
        for (i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e instanceof Folder) continue;
            var n = _baseName(e), ext = _extOf(n);
            if (_stripExt(n).toLowerCase() !== lower) continue;
            if (!_inList(wanted, ext)) continue;
            targets.push({ file: e, newName: to + "." + ext });
        }
        if (!targets.length) return _result(false, "No files found for " + from + ".");

        // Check every destination first, so a clash can't leave the set split
        // between two names. A file colliding with itself (case-only change) is
        // not a clash.
        var clash = [];
        for (i = 0; i < targets.length; i++) {
            var t = new File(dir.fsName + "/" + targets[i].newName);
            if (t.exists && t.fsName !== targets[i].file.fsName) clash.push(targets[i].newName);
        }
        if (clash.length) return _result(false, "Already exists: " + clash.join(", "));

        var done = [];
        for (i = 0; i < targets.length; i++) {
            var oldName = _baseName(targets[i].file);
            var ok = false;
            try { ok = targets[i].file.rename(targets[i].newName); } catch (e2) { ok = false; }
            if (!ok) {
                // rename() leaves the File pointing at its new name, so undoing
                // is just renaming it back.
                for (var r = 0; r < done.length; r++) {
                    try { done[r].file.rename(done[r].old); } catch (e3) {}
                }
                return _result(false, "Could not rename " + oldName + " — nothing was changed.");
            }
            done.push({ file: targets[i].file, old: oldName });
        }

        return _result(true, "Renamed " + from + " → " + to, { renamed: done.length, name: to });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Open the containing folder in Explorer/Finder — the quickest way to drop a
// rendered preview next to the preset.
function zae_revealPreset(params) {
    try {
        var p = params && params.path ? String(params.path) : "";
        if (!p) return _result(false, "No path given.");
        var f = new File(p);
        var dir = f.exists ? f.parent : new Folder(p);
        if (!dir || !dir.exists) return _result(false, "Folder not found.");
        dir.execute();
        return _result(true, "Opened " + dir.fsName, { path: dir.fsName });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Every .ffx under a folder, keyed by path → mtime. Used to spot what AE's
// Save Animation Preset dialog just wrote.
function _collectFfx(folder, depth, map) {
    if (!folder || !folder.exists || depth > _MAX_DEPTH) return;
    var entries;
    try { entries = folder.getFiles(); } catch (e) { return; }
    if (!entries) return;
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e instanceof Folder) {
            var n = _baseName(e);
            if (n.charAt(0) === "." || _IGNORED_FOLDER.test(n)) continue;
            _collectFfx(e, depth + 1, map);
            continue;
        }
        if (_extOf(_baseName(e)) !== "ffx") continue;
        try { map[e.fsName] = e.modified ? e.modified.getTime() : 0; } catch (e2) {}
    }
}

// `relative` may be nested ("Text/Kinetic"). Folder.create() does not reliably
// make intermediate directories, so each segment is created in turn.
function _ensureFolder(root, relative) {
    var cur = new Folder(root);
    if (!cur.exists) return null;
    if (!relative) return cur;

    var parts = String(relative).split("/");
    for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        cur = new Folder(cur.fsName + "/" + parts[i]);
        if (!cur.exists && !cur.create()) return null;
    }
    return cur;
}

function _targetFolder(root, category) {
    return _ensureFolder(root, category);
}

// Save the current selection as a preset, into the chosen category.
//
// ExtendScript CANNOT save a preset to a path — "Save Animation Preset" is a
// menu command with no arguments, and AE's own dialog decides the destination.
// So: snapshot every .ffx we can see, fire the command (executeCommand blocks
// on the modal dialog), then find what appeared and move it into the category.
// Wherever the user points the dialog, the file ends up in the right place.
function zae_saveAnimationPreset(params) {
    try {
        var root     = params && params.root ? String(params.root) : "";
        var category = params && params.category ? String(params.category) : "";
        if (!root) return _result(false, "No preset folder selected.");

        var target = _targetFolder(root, category);
        if (!target) return _result(false, "Could not open the target folder.");

        var comp = app.project ? app.project.activeItem : null;
        if (!(comp instanceof CompItem)) return _result(false, "Open a composition first.");
        var layers = comp.selectedLayers;
        if (!layers || !layers.length) {
            return _result(false, "Select a layer — or just the properties/effects you want saved.");
        }

        // Menu strings differ by build and locale; try the likely spellings.
        var cmdId = 0;
        var names = ["Save Animation Preset...", "Save Animation Preset…", "Save Animation Preset"];
        for (var i = 0; i < names.length && !cmdId; i++) {
            try { cmdId = app.findMenuCommandId(names[i]); } catch (e) {}
        }
        if (!cmdId) {
            return _result(false, "Could not find the Save Animation Preset menu command on this AE version.");
        }

        // Watch the target root and the user's own presets folder — between them
        // they cover where the dialog is likely to be pointing.
        var watched = [target, new Folder(root)];
        var userRoots = _findUserPresetFolders();
        for (var u = 0; u < userRoots.length; u++) watched.push(new Folder(userRoots[u].path));

        var before = {}, after = {}, w;
        for (w = 0; w < watched.length; w++) _collectFfx(watched[w], 0, before);

        app.executeCommand(cmdId);        // modal — returns once saved or cancelled

        for (w = 0; w < watched.length; w++) _collectFfx(watched[w], 0, after);

        var newest = null, newestTime = -1;
        for (var k in after) {
            if (!after.hasOwnProperty(k)) continue;
            var changed = !before.hasOwnProperty(k) || after[k] !== before[k];
            if (changed && after[k] > newestTime) { newestTime = after[k]; newest = k; }
        }
        if (!newest) {
            return _result(false, "No new preset found — cancelled, or saved outside the watched folders.");
        }

        var src = new File(newest);
        var fileName = _baseName(src);
        var destPath = target.fsName + "/" + fileName;

        // Dialog already pointed at the category — nothing to move.
        if (src.fsName === destPath) {
            return _result(true, "Saved " + _stripExt(fileName), { path: destPath, moved: false });
        }

        var dest = new File(destPath);
        if (dest.exists) {
            return _result(false, '"' + fileName + '" already exists in that category. Saved to ' + src.fsName);
        }
        if (!src.copy(destPath)) {
            return _result(false, "Saved, but could not move it. It is at: " + src.fsName);
        }
        try { src.remove(); } catch (e3) {}

        return _result(true, "Saved " + _stripExt(fileName) + " → " + (category || "root"), {
            path: destPath, moved: true, from: src.fsName
        });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// New asset: a full-size project + comp in the chosen category, ready to build
// a preset in. Unlike the small preview comp, this one is 1080p by default.
function zae_addAsset(params) {
    try {
        var root     = params && params.root ? String(params.root) : "";
        var category = params && params.category ? String(params.category) : "";
        var name     = params && params.name ? String(params.name) : "";
        name = name.replace(/^\s+|\s+$/g, "");

        if (!root) return _result(false, "No preset folder selected.");
        if (!name) return _result(false, "Enter a name.");
        if (/[\\\/:\*\?"<>\|]/.test(name)) return _result(false, 'Name cannot contain \\ / : * ? " < > |');

        var target = _targetFolder(root, category);
        if (!target) return _result(false, "Could not open the target folder.");

        var aep = new File(target.fsName + "/" + name + ".aep");
        if (aep.exists) return _result(false, '"' + name + '.aep" already exists there.');

        var w   = params.width    ? Number(params.width)    : 1920;
        var h   = params.height   ? Number(params.height)   : 1080;
        var fps = params.fps      ? Number(params.fps)      : 30;
        var dur = params.duration ? Number(params.duration) : 3;

        var proj = app.newProject();
        if (!proj) return _result(false, "Cancelled — current project kept.");

        var comp = proj.items.addComp(name, w, h, 1, dur, fps);
        comp.openInViewer();
        proj.save(aep);

        return _result(true, "Created " + name + ".aep (" + w + "x" + h + " @ " + fps + "fps)", {
            path: aep.fsName, width: w, height: h, fps: fps, category: category
        });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

function zae_unknown(action) {
    return _result(false, "Unknown action: " + String(action));
}
