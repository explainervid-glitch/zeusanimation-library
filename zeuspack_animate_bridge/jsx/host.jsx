// host.jsx — ExtendScript (ES3) for Adobe Animate 2024
// JSFL functions the ZeusPack panel calls via CSInterface.evalScript.
// Every function returns a JSON STRING: { ok, message, data }.

// ── Minimal ES3 JSON.stringify (CEP ExtendScript has no JSON) ──
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
    return JSON.stringify({ ok: !!ok, message: message || "", data: data || null });
}

// Windows/Unix path -> file:// URI (Animate's importFile/openDocument need it).
if (typeof encodeURI !== "function") {
    encodeURI = function (s) {
        return s.replace(/[^A-Za-z0-9\-_.!~*'()/:]/g, function (ch) {
            var hex = ch.charCodeAt(0).toString(16).toUpperCase();
            return "%" + (hex.length === 1 ? "0" + hex : hex);
        });
    };
}
function _toFileURI(p) {
    var fs = String(p).replace(/\\/g, "/");
    if (fs.indexOf("file://") === 0) return fs;
    if (/^[A-Za-z]:\//.test(fs))     return "file:///" + encodeURI(fs);
    if (fs.indexOf("/") === 0)       return "file://" + encodeURI(fs);
    return "file:///" + encodeURI(fs);
}

// Normalize a path/URI for comparison (decode %XX, lowercase, strip file://).
function _normURI(u) {
    var s = String(u).replace(/%([0-9A-Fa-f]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
    return s.toLowerCase().replace(/\\/g, "/").replace(/^file:\/+/, "");
}

// Find an already-open document by file path (so we don't reload from disk).
function _findOpenDoc(path) {
    var want = _normURI(path);
    var docs = fl.documents || [];
    for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        if (d && d.pathURI && _normURI(d.pathURI) === want) return d;
    }
    return null;
}

// Reuse the movement .fla if it's already open; otherwise open it once and
// leave it open (kept warm for fast repeat operations — like your manual flow
// where both files stay open). Returns { doc, reused }.
function _getSourceDoc(path) {
    var d = _findOpenDoc(path);
    if (d) return { doc: d, reused: true };
    return { doc: fl.openDocument(_toFileURI(path)), reused: false };
}

// Simple round-trip check.
function zb_ping(params) {
    return _result(true, "pong from Adobe Animate", { version: fl.version });
}

// Read the active document — proves ZeusPack <-> panel <-> Animate works.
function zb_getActiveDocInfo(params) {
    try {
        var doc = fl.getDocumentDOM();
        if (!doc) return _result(false, "No document open in Animate.");
        var data = {
            name:      doc.name,
            path:      doc.pathURI || doc.path || "",
            width:     doc.width,
            height:    doc.height,
            frameRate: doc.frameRate,
            libraryItems: (doc.library && doc.library.items) ? doc.library.items.length : 0
        };
        return _result(true, "Active document: " + doc.name, data);
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Pre-warm: open the movement .fla (or reuse if already open) and keep it
// warm, WITHOUT stealing focus from the user's document. The panel fires this
// as soon as the picker opens, so the later import reuses an already-loaded
// doc instead of waiting for the C++ file load.
function zb_openFla(params) {
    try {
        params = params || {};
        if (!params.flaPath) return _result(false, "No .fla path provided.");
        var prev = fl.getDocumentDOM();
        var g = _getSourceDoc(params.flaPath);
        if (!g.doc) return _result(false, "Could not open: " + params.flaPath);
        if (prev) { try { fl.setActiveWindow(prev); } catch (e) {} }
        return _result(true, (g.reused ? "Already open: " : "Warmed: ") + g.doc.name,
                       { reused: g.reused, doc: g.doc.name });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Import a movement .fla's symbol(s) into the ACTIVE document.
// FIRST CUT (to be refined after live testing): opens the source, reports its
// symbols, selects everything on the source stage, copies it, and pastes into
// the active doc — which carries the used symbols + their nested library items
// across. If library names collide, Animate shows the native "Resolve Library
// Conflict" dialog (JSFL can't dismiss it — strategy TBD after we see it).
function zb_importFla(params) {
    var srcDoc = null;
    try {
        params = params || {};
        var srcPath = params.flaPath;
        if (!srcPath) return _result(false, "No .fla path provided.");

        var targetDoc = fl.getDocumentDOM();
        if (!targetDoc) return _result(false, "Open a character .fla in Animate first (no active document).");
        var targetName = targetDoc.name;

        srcDoc = fl.openDocument(_toFileURI(srcPath));
        if (!srcDoc) return _result(false, "Could not open source .fla: " + srcPath);

        // Enumerate source symbols (diagnostic — tells us the file's structure).
        var items = srcDoc.library.items, symbols = [];
        for (var i = 0; i < items.length; i++) {
            var t = items[i].itemType;
            if (t === "graphic" || t === "movie clip" || t === "button") {
                symbols.push(items[i].name + " (" + t + ")");
            }
        }

        // Copy the source stage selection, paste into the target.
        srcDoc.selectAll();
        var copied = srcDoc.clipCopy();

        fl.setActiveWindow(targetDoc);
        var pasted = false;
        if (copied) { targetDoc.clipPaste(true); pasted = true; }

        fl.closeDocument(srcDoc, false);   // discard source, don't prompt
        srcDoc = null;

        var fileName = String(srcPath).replace(/^.*[\\\/]/, "");
        var msg = pasted
            ? "Imported '" + fileName + "' into '" + targetName + "' (" + symbols.length + " symbol(s))."
            : "Opened '" + fileName + "' but its stage was empty — " + symbols.length + " symbol(s) in library, nothing pasted.";
        return _result(true, msg, { symbols: symbols, pasted: pasted, target: targetName });

    } catch (e) {
        if (srcDoc) { try { fl.closeDocument(srcDoc, false); } catch (e2) {} }
        return _result(false, "Exception: " + e.toString());
    }
}

// Read the active document's Library as a flat, path-aware list. Each item's
// `name` in Animate already encodes its folder path ("Folder/Sub/Symbol"), and
// folders are items too — so this list fully describes the hierarchy. The
// consumer (app or panel) can build a tree by splitting `path` on "/".
function zb_getLibrary(params) {
    try {
        var doc = fl.getDocumentDOM();
        if (!doc) return _result(false, "No active Animate document.");
        var items = doc.library.items, out = [];
        for (var i = 0; i < items.length; i++) {
            var full  = items[i].name;
            var parts = full.split("/");
            out.push({
                path:  full,
                name:  parts[parts.length - 1],
                type:  items[i].itemType,           // folder | movie clip | graphic | bitmap | sound | ...
                depth: parts.length - 1
            });
        }
        return _result(true, doc.name + " — " + out.length + " library item(s).",
                       { doc: doc.name, count: out.length, items: out });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// Read a specific .fla's library WITHOUT disturbing the user's active doc:
// open it, enumerate, close it, restore the previously-active document.
function zb_getFlaLibrary(params) {
    try {
        params = params || {};
        if (!params.flaPath) return _result(false, "No .fla path provided.");
        var prev = fl.getDocumentDOM();

        var g = _getSourceDoc(params.flaPath);   // reuse if open, else open + keep
        if (!g.doc) return _result(false, "Could not open: " + params.flaPath);

        var items = g.doc.library.items, out = [];
        for (var i = 0; i < items.length; i++) {
            var full = items[i].name, parts = full.split("/");
            out.push({ path: full, name: parts[parts.length - 1], type: items[i].itemType, depth: parts.length - 1 });
        }
        var docName = g.doc.name;
        // Keep the source open (warm) but return the user to their doc.
        if (prev) { try { fl.setActiveWindow(prev); } catch (e) {} }
        return _result(true, docName + " — " + out.length + " item(s)" + (g.reused ? " (already open)" : "") + ".",
                       { doc: docName, count: out.length, items: out, reused: g.reused });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// ── Shared: load the clipboard with ONE symbol from `src` ─────
// To match a MANUAL Ctrl+C exactly, prefer an instance of the symbol already
// placed on the source's stage — keeping the author's transform (scale/
// rotation/position). A fresh addItemToDocument instance lands at 100% scale
// (pastes bigger). Falls back to a temporary fresh instance (cleaned up) only
// when the symbol is nowhere on the source stage.
// Assumes `src` is (or will be made) the active document. Returns
// { ok, message, how, from }.
function _clipCopySymbol(src, symbol) {
    var leaf = String(symbol).split("/").pop();
    fl.setActiveWindow(src);

    // Find an existing stage instance (any timeline, first matching keyframe).
    var tls = src.timelines;
    var fTl = -1, fLayer = -1, fFrame = -1, foundEl = null;
    for (var ti = 0; ti < tls.length && !foundEl; ti++) {
        var layers = tls[ti].layers;
        for (var li = 0; li < layers.length && !foundEl; li++) {
            var frames = layers[li].frames;
            for (var fi = 0; fi < frames.length && !foundEl; fi++) {
                var fr = frames[fi];
                if (!fr || fr.startFrame !== fi) continue;   // keyframes only
                var els = fr.elements || [];
                for (var ei = 0; ei < els.length; ei++) {
                    var el = els[ei];
                    if (el.elementType === "instance" && el.libraryItem &&
                        el.libraryItem.name === symbol) {
                        fTl = ti; fLayer = li; fFrame = fi; foundEl = el;
                        break;
                    }
                }
            }
        }
    }

    if (foundEl) {
        // Select the real stage instance — same thing you'd Ctrl+C by hand.
        src.currentTimeline = fTl;
        var tl = src.getTimeline();
        tl.currentFrame = fFrame;
        var lay = tl.layers[fLayer];
        var wasLocked = lay.locked, wasVisible = lay.visible;
        lay.locked = false; lay.visible = true;
        src.selectNone();
        src.selection = [foundEl];
        var okSel = src.selection && src.selection.length > 0;
        if (!okSel) {
            lay.locked = wasLocked; lay.visible = wasVisible;
            return { ok: false, message: "Found '" + leaf + "' on stage but could not select it." };
        }
        src.clipCopy();
        lay.locked = wasLocked; lay.visible = wasVisible;
        return { ok: true, how: "stage instance (original transform)", from: "stage" };
    }

    // Fallback: fresh temp instance at default scale, then clean up.
    var placed = src.library.addItemToDocument({ x: 0, y: 0 }, symbol);
    var selCount = src.selection ? src.selection.length : 0;
    if (!placed || selCount === 0) {
        return { ok: false, message: "Could not place '" + leaf + "' on the source stage (placed=" +
            placed + ", selection=" + selCount + ")." };
    }
    src.clipCopy();
    src.deleteSelection();
    return { ok: true, how: "fresh instance (symbol not on source stage)", from: "fresh" };
}

// Import ONE chosen symbol (by library path) from a source .fla into the
// active document. Copy mechanics live in _clipCopySymbol (manual-equivalent).
// (A name collision still triggers Animate's native conflict dialog for now.)
function zb_importSymbol(params) {
    try {
        params = params || {};
        if (!params.flaPath) return _result(false, "No .fla path provided.");
        if (!params.symbol)  return _result(false, "No symbol selected.");

        var target = fl.getDocumentDOM();
        if (!target) return _result(false, "Open a character .fla in Animate first (no active document).");
        var targetName = target.name;
        var leaf = String(params.symbol).split("/").pop();

        var g = _getSourceDoc(params.flaPath);   // reuse if already open (fast)
        var src = g.doc;
        if (!src) return _result(false, "Could not open source: " + params.flaPath);
        if (!src.library.itemExists(params.symbol)) {
            return _result(false, "Symbol not found in source: " + params.symbol);
        }

        var cp = _clipCopySymbol(src, params.symbol);
        if (!cp.ok) return _result(false, cp.message);
        var how = cp.how;

        // Paste in place into the active target; measure the library delta so we
        // can tell what landed (a name collision pops Animate's native conflict
        // dialog, which blocks here until the user chooses).
        fl.setActiveWindow(target);
        var before = target.library.items.length;
        target.clipPaste(true);
        var after = target.library.items.length;

        var added = after - before;
        return _result(true,
            "Pasted '" + leaf + "' into '" + targetName + "' via " + how +
            " — library " + before + " → " + after +
            " (" + (added >= 0 ? "+" + added : added) + " items)" + (g.reused ? " · source already open" : "") + ".",
            { symbol: params.symbol, target: targetName, before: before, after: after,
              added: added, reusedSource: g.reused, copiedFrom: cp.from });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

// ── 2D COMPILE ────────────────────────────────────────────────
// The whole Character+Movement flow in one job:
//   1. Open the character .fla ALREADY COPIED into the project (app did the copy)
//   2. Copy the chosen movement symbol (manual-equivalent) and paste it in —
//      the native "Resolve Library Conflict" dialog pops here; the user picks
//      "Don't replace existing items" so the dummy takes the character's skin
//   3. Re-copy the freshly pasted (now character-skinned) instance, so the
//      clipboard is loaded and the user just Ctrl+V's into their working file
//   4. Close BOTH working docs without saving (params.closeAfter !== false),
//      leaving the user back on their own file with the clipboard ready
function zb_compile2d(params) {
    try {
        params = params || {};
        if (!params.charPath)     return _result(false, "No character project path.");
        if (!params.movementPath) return _result(false, "No movement path.");
        if (!params.symbol)       return _result(false, "No symbol selected.");
        var leaf = String(params.symbol).split("/").pop();

        // 1) Open the copied character project.
        var gc = _getSourceDoc(params.charPath);
        var charDoc = gc.doc;
        if (!charDoc) return _result(false, "Could not open character project: " + params.charPath);

        // 2) Load the clipboard with the movement symbol.
        var gm = _getSourceDoc(params.movementPath);
        var src = gm.doc;
        if (!src) return _result(false, "Could not open movement: " + params.movementPath);
        if (!src.library.itemExists(params.symbol)) {
            return _result(false, "Symbol not found in movement: " + params.symbol);
        }
        var cp = _clipCopySymbol(src, params.symbol);
        if (!cp.ok) return _result(false, cp.message);

        // Paste into the character project (conflict dialog may block here
        // until the user answers — that's expected, pick "Don't replace").
        fl.setActiveWindow(charDoc);
        var before = charDoc.library.items.length;
        charDoc.clipPaste(true);
        var after = charDoc.library.items.length;

        // 3) The paste leaves the new instance selected — copy it again so the
        //    clipboard now holds the CHARACTER-SKINNED symbol.
        var selN = charDoc.selection ? charDoc.selection.length : 0;
        var recopied = false;
        if (selN > 0) { charDoc.clipCopy(); recopied = true; }

        var added = after - before;
        var charName = charDoc.name;

        // 4) Close both working docs WITHOUT saving (false = don't prompt), so
        //    the user lands back on their own file. Done after the re-copy so
        //    the clipboard is already loaded.
        var closed = [];
        if (params.closeAfter !== false) {
            try { fl.closeDocument(src, false);     closed.push("movement"); } catch (e1) {}
            try { fl.closeDocument(charDoc, false); closed.push("character"); } catch (e2) {}
        }

        return _result(true,
            "Compiled '" + leaf + "' into '" + charName + "' via " + cp.how +
            " — library " + before + " → " + after + " (" + (added >= 0 ? "+" + added : added) + ")" +
            (closed.length ? ". Closed " + closed.join(" + ") + " (no save)" : "") +
            (recopied ? ". Clipboard loaded — Ctrl+V in your file." : ". Note: nothing selected after paste, clipboard NOT reloaded."),
            { charDoc: charName, symbol: params.symbol, before: before, after: after,
              added: added, recopied: recopied, copiedFrom: cp.from, closed: closed });
    } catch (e) {
        return _result(false, "Exception: " + e.toString());
    }
}

function zb_unknown(action) {
    return _result(false, "Unknown action: " + String(action));
}
