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

function zae_unknown(action) {
    return _result(false, "Unknown action: " + String(action));
}
