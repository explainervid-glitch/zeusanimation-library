/* ZeusPack AE Bridge — CEP panel client for Adobe After Effects
 *
 * The CEP host has `fetch` but no Node.js, so this panel can't listen — it
 * POLLS the ZeusPack app's loopback server (127.0.0.1:8771):
 *   GET  /poll    → heartbeat + next job to run
 *   POST /result  → return a finished job's result
 * Each job maps to an ExtendScript function in jsx/host.jsx, run via evalScript.
 *
 * UI is deliberately minimal (one status row) so it doesn't cover After
 * Effects' own panels. The log is collapsed unless the user opens it.
 */
(function () {
  "use strict";

  var BASE = "http://127.0.0.1:8771";
  var POLL_MS = 800;

  var csInterface = new CSInterface();
  var hostVersion = "";
  try { hostVersion = csInterface.getHostEnvironment().appVersion || ""; } catch (e) {}

  var dot     = document.getElementById("dot");
  var stateEl = document.getElementById("state");
  var logEl   = document.getElementById("log");
  var testBtn = document.getElementById("testBtn");
  var logBtn  = document.getElementById("logBtn");

  var presetBtn  = document.getElementById("presetBtn");
  var presetsEl  = document.getElementById("presets");
  var pathSelect = document.getElementById("pathSelect");
  var refreshBtn = document.getElementById("refreshBtn");
  var addCatBtn   = document.getElementById("addCatBtn");
  var promptRow   = document.getElementById("promptRow");
  var promptInput = document.getElementById("promptInput");
  var promptOk    = document.getElementById("promptOk");
  var listEl     = document.getElementById("list");
  var applyBtn   = document.getElementById("applyBtn");
  var menuEl     = document.getElementById("menu");
  var sizeSlider = document.getElementById("sizeSlider");
  var catsEl     = document.getElementById("cats");
  var catGrip    = document.getElementById("catGrip");

  var connected = null;   // tri-state so the first result always renders

  function setConnected(isUp) {
    if (connected === isUp) return;
    connected = isUp;
    dot.className = "dot " + (isUp ? "ok" : "err");
    stateEl.innerHTML = isUp
      ? "<b>Connected</b>"
      : "<b>ZeusPack not running</b>";
    stateEl.title = isUp
      ? "Listening for jobs on 127.0.0.1:8771"
      : "Start ZeusPack, then keep this panel open";
  }

  function log(msg, cls) {
    var line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.firstChild);
  }

  // Briefly show the last action in the status row, so the log can stay closed.
  var flashTimer = null;
  function flash(msg, isErr) {
    stateEl.innerHTML = (isErr ? '<b style="color:#f85149">' : "<b>") + msg + "</b>";
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      var was = connected; connected = null; setConnected(was);
    }, 4000);
  }

  // ── ExtendScript dispatch: action name → host function call ──
  function hostCallFor(job) {
    var p = JSON.stringify(job.params || {});
    switch (job.action) {
      case "ping":            return "zae_ping(" + p + ")";
      case "active-project":  return "zae_getActiveProjectInfo(" + p + ")";
      case "list-aep-comps":  return "zae_listAepComps(" + p + ")";
      case "import-aep":      return "zae_importAep(" + p + ")";
      default:                return "zae_unknown(" + JSON.stringify(job.action) + ")";
    }
  }

  function parseResult(result) {
    try { return JSON.parse(result); }
    catch (e) { return { ok: false, message: "Bad host result: " + String(result) }; }
  }

  function runJob(job) {
    log("Job: " + job.action);
    csInterface.evalScript(hostCallFor(job), function (result) {
      var parsed = parseResult(result);
      postResult(job.id, parsed);
      var msg = parsed.message || (parsed.ok ? "ok" : "error");
      log(job.action + " → " + msg, parsed.ok ? "ok" : "err");
      flash(job.action + (parsed.ok ? " ✓" : " ✕"), !parsed.ok);
    });
  }

  function postResult(id, parsed) {
    fetch(BASE + "/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, ok: parsed.ok, message: parsed.message, data: parsed.data })
    }).catch(function () { /* app went away; next poll will show disconnected */ });
  }

  function poll() {
    fetch(BASE + "/poll?app=aftereffects&v=" + encodeURIComponent(hostVersion), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        setConnected(true);
        if (d && d.job) runJob(d.job);
      })
      .catch(function () { setConnected(false); })
      .then(function () { setTimeout(poll, POLL_MS); });
  }

  // ── Buttons ──
  testBtn.addEventListener("click", function () {
    csInterface.evalScript("zae_getActiveProjectInfo({})", function (result) {
      var parsed = parseResult(result);
      var msg = parsed.message || (parsed.ok ? "ok" : "error");
      log("Test → " + msg, parsed.ok ? "ok" : "err");
      flash(msg, !parsed.ok);
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  PRESET BROWSER
  // ═══════════════════════════════════════════════════════════
  var presets     = [];   // everything the scan found
  var view        = [];   // what the grid is showing (presets, filtered by folder)
  var declaredCats = null; // categories.json contents, or null when absent
  var activeFolder = null; // null = all folders
  var selectedIdx = -1;   // index into `view`
  var currentDir  = "";
  var presetsLoaded = false;
  var roots        = [];  // { id, label, path, exists }
  var ROOT_KEY = "zae.presetRoot";

  // ExtendScript hands back platform paths ("C:\Users\…"); <video>/<img> need a
  // file:// URL. encodeURI leaves ':' and '/' alone but '#' would truncate the
  // path, so it's escaped explicitly.
  function fileUrl(p) {
    return "file:///" + encodeURI(String(p).replace(/\\/g, "/")).replace(/#/g, "%23");
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // evalScript's argument is a source string, so paths must survive as a JS
  // literal — JSON.stringify handles the backslashes and quotes.
  function callHost(fn, params, cb) {
    var src = fn + "(" + JSON.stringify(params || {}) + ")";
    csInterface.evalScript(src, function (result) { cb(parseResult(result)); });
  }

  function select(i) {
    selectedIdx = i;
    var nodes = listEl.getElementsByClassName("card");
    for (var n = 0; n < nodes.length; n++) {
      nodes[n].className = (Number(nodes[n].getAttribute("data-i")) === i) ? "card sel" : "card";
    }
    // The button follows the asset kind rather than going dead on compositions.
    var p = (i >= 0) ? view[i] : null;
    applyBtn.textContent = (p && p.kind === "comp") ? "Add to comp" : "Apply to selected layer";
    applyBtn.disabled = !p;
  }

  function showMessage(html, isErr) {
    listEl.className = "list msg";
    listEl.innerHTML = '<div class="empty-list"' + (isErr ? ' style="color:#f85149"' : "") + ">" + html + "</div>";
    applyBtn.disabled = true;
  }

  // PERF TEST: every card plays continuously instead of only on hover.
  // A folder can hold hundreds of presets, and that many simultaneous video
  // decoders is exactly what this flag is for measuring. Set to false to go
  // back to preload="metadata" + play-on-hover (one decoder at a time).
  var AUTOPLAY_ALL = true;

  function thumbHtml(p) {
    var video = AUTOPLAY_ALL
      ? '<video src="' + esc(fileUrl(p.preview)) + '" preload="auto" autoplay loop muted playsinline></video>'
      : '<video src="' + esc(fileUrl(p.preview)) + '" preload="metadata" loop muted playsinline></video>';

    // The badge marks WHAT the asset is, not what sidecars it has: "ffx" is an
    // animation preset, "aep" a composition. A preset's same-named .aep is only
    // the source its preview was rendered from, so it never shows as "aep".
    var isComp = p.kind === "comp";
    var cls    = isComp ? "aep" : "ffx";      // colour class, keyed to file type
    var label  = isComp ? "Comp" : "FX";      // what the user actually reads

    var media = !p.preview
      ? '<span class="ph">' + label + "</span>"
      : (p.previewKind === "video" ? video : '<img src="' + esc(fileUrl(p.preview)) + '" alt="">');

    var tags = '<span class="tag ' + cls + '">' + label + "</span>";
    if (!p.preview) tags += '<span class="tag">no preview</span>';

    return '<div class="thumb">' + media + '<span class="tags">' + tags + "</span></div>";
  }

  // ── Folder categories ────────────────────────────────────────
  // The subfolders of the preset root, listed like the ZeusPack sidebar's
  // categories. Selecting one filters the grid, which is why the folder name no
  // longer needs repeating on every card.
  // A preset in "Text/Kinetic" belongs to the "Text" category — categories are
  // the top level only, matching what categories.json declares.
  function topFolder(p) {
    return String(p.folder || "").split("/")[0];
  }

  function has(list, v) {
    for (var i = 0; i < list.length; i++) if (list[i] === v) return true;
    return false;
  }

  function renderCats() {
    var counts = {}, order = [], i, f;

    // Counts always come from what's on disk…
    for (i = 0; i < presets.length; i++) {
      f = topFolder(presets[i]);
      if (!counts.hasOwnProperty(f)) { counts[f] = 0; order.push(f); }
      counts[f]++;
    }

    // …but the ROWS come from categories.json when it exists, so a category you
    // just created shows up empty and ready to fill.
    if (declaredCats) {
      var declared = [];
      if (counts.hasOwnProperty("")) declared.push("");        // loose root presets
      for (i = 0; i < declaredCats.length; i++) {
        if (!counts.hasOwnProperty(declaredCats[i])) counts[declaredCats[i]] = 0;
        if (!has(declared, declaredCats[i])) declared.push(declaredCats[i]);
      }
      // A folder on disk but missing from the manifest still holds real presets
      // — list it rather than hiding assets the scan already found.
      for (i = 0; i < order.length; i++) {
        if (order[i] && !has(declared, order[i])) declared.push(order[i]);
      }
      order = declared;
    }

    // One bucket and no manifest means there is nothing to filter by — don't
    // spend the space.
    if (order.length <= 1 && !declaredCats) {
      catsEl.className = "cats"; catGrip.className = "catgrip";
      catsEl.innerHTML = "";
      return;
    }

    order.sort(function (a, b) {
      if (a === "") return -1;              // loose presets at the root first
      if (b === "") return 1;
      return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });

    var html = '<div class="cat' + (activeFolder === null ? " sel" : "") + '" data-all="1">'
             +   '<span class="cn">All presets</span>'
             +   '<span class="cc">' + presets.length + "</span>"
             + "</div>";
    for (i = 0; i < order.length; i++) {
      f = order[i];
      html += '<div class="cat' + (activeFolder === f ? " sel" : "") + '" data-f="' + esc(f) + '">'
            +   '<span class="cn">' + esc(f || "(root)") + "</span>"
            +   '<span class="cc">' + counts[f] + "</span>"
            + "</div>";
    }
    catsEl.className = "cats open"; catGrip.className = "catgrip open";
    catsEl.innerHTML = html;

    var rows = catsEl.getElementsByClassName("cat");
    for (i = 0; i < rows.length; i++) {
      rows[i].addEventListener("click", function () {
        activeFolder = this.getAttribute("data-all") ? null : this.getAttribute("data-f");
        closeMenu();
        renderCats();
        applyFilter();
      });
    }
  }

  function applyFilter() {
    view = [];
    for (var i = 0; i < presets.length; i++) {
      if (activeFolder === null || topFolder(presets[i]) === activeFolder) view.push(presets[i]);
    }
    selectedIdx = -1;
    renderList();
    applyBtn.disabled = true;
  }

  function renderList() {
    if (!view.length) {
      showMessage(presets.length ? "No presets in this folder" : "No .ffx files in this folder");
      return;
    }

    listEl.className = "list";
    var html = "";
    for (var i = 0; i < view.length; i++) {
      var p = view[i];
      // Folder is shown by the category list above, not repeated per card.
      html += '<div class="card" data-i="' + i + '" title="' + esc(p.path) + '">'
            +   thumbHtml(p)
            +   '<div class="meta"><span class="nm">' + esc(p.name) + "</span></div>"
            + "</div>";
    }
    listEl.innerHTML = html;

    var cards = listEl.getElementsByClassName("card");
    for (var k = 0; k < cards.length; k++) {
      var card  = cards[k];
      var video = card.getElementsByTagName("video")[0];
      var img   = card.getElementsByTagName("img")[0];

      card.addEventListener("click", function () {
        select(Number(this.getAttribute("data-i")));
      });
      // Double-click = "use this asset", the grid's fast path: apply a preset,
      // import a composition.
      card.addEventListener("dblclick", function () {
        var i = Number(this.getAttribute("data-i"));
        select(i);
        useSelected();
      });
      card.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        var i = Number(this.getAttribute("data-i"));
        select(i);
        openMenu(i, ev.clientX, ev.clientY);
      });

      // Hover playback is redundant while AUTOPLAY_ALL keeps everything running.
      if (video && !AUTOPLAY_ALL) {
        card.addEventListener("mouseenter", function () {
          var v = this.getElementsByTagName("video")[0];
          if (v) { try { v.play(); } catch (e) {} }
        });
        card.addEventListener("mouseleave", function () {
          var v = this.getElementsByTagName("video")[0];
          if (v) { try { v.pause(); v.currentTime = 0; } catch (e) {} }
        });
      }
      // autoplay is ignored by some CEF builds — nudge it explicitly.
      if (video && AUTOPLAY_ALL) { try { video.play(); } catch (e) {} }

      // CEF blocks file:// media unless the manifest grants access; without
      // this the card would just show an empty black box.
      var media = video || img;
      if (media) {
        media.onerror = function () {
          var t = this.parentNode;
          if (t) t.innerHTML = '<span class="ph err">no file access</span>';
        };
      }
    }
  }

  function loadPresets(dir) {
    showMessage("Scanning…");
    callHost("zae_listPresets", { path: dir }, function (r) {
      if (!r.ok) {
        presets = [];
        showMessage(esc(r.message), true);
        log("Presets → " + r.message, "err");
        return;
      }
      currentDir = r.data.path;
      pathSelect.title = currentDir;
      renderRoots(currentRootId());
      presets = r.data.presets || [];
      declaredCats = r.data.categories || null;
      // A folder selected in the previous directory means nothing here.
      activeFolder = null;
      renderCats();
      applyFilter();
      log("Presets → " + r.message + " (" + r.data.withPreview + " with preview)"
          + (r.data.truncated ? " — list truncated" : ""), "ok");
    });
  }

  // ── Preset roots (path dropdown) ─────────────────────────────
  function renderRoots(selectedId) {
    var html = "";
    for (var i = 0; i < roots.length; i++) {
      var r = roots[i];
      html += '<option value="' + esc(r.id) + '"' + (r.exists ? "" : " disabled")
            + (r.id === selectedId ? " selected" : "") + ">"
            + esc(r.label) + (r.exists ? "" : " (offline)") + "</option>";
    }
    // Browse stays available so a one-off folder doesn't need a code change.
    html += '<option value="__browse">Browse…</option>';
    pathSelect.innerHTML = html;
    var sel = rootById(selectedId);
    pathSelect.title = sel ? sel.path : "";
  }

  function rootById(id) {
    for (var i = 0; i < roots.length; i++) if (roots[i].id === id) return roots[i];
    return null;
  }

  function selectRoot(id) {
    var r = rootById(id);
    if (!r || !r.exists || !r.path) return false;
    renderRoots(id);
    try { localStorage.setItem(ROOT_KEY, id); } catch (e) {}
    loadPresets(r.path);
    return true;
  }

  function initPresets() {
    if (presetsLoaded) return;
    presetsLoaded = true;
    callHost("zae_presetRoots", {}, function (r) {
      if (!r.ok) { showMessage(esc(r.message), true); return; }
      roots = r.data.roots || [];

      var saved = null;
      try { saved = localStorage.getItem(ROOT_KEY); } catch (e) {}

      // Preference order: last used → configured default (Zeus) → first that
      // exists. The W: drive is often disconnected, so falling through to the
      // local User Presets beats opening onto an error.
      var pick = null;
      var candidates = [saved, r.data.defaultId];
      for (var i = 0; i < candidates.length && !pick; i++) {
        var c = rootById(candidates[i]);
        if (c && c.exists && c.path) pick = c;
      }
      for (var j = 0; j < roots.length && !pick; j++) {
        if (roots[j].exists && roots[j].path) pick = roots[j];
      }

      if (!pick) {
        renderRoots("");
        showMessage("No preset folder available — pick one with Browse…", true);
        return;
      }
      renderRoots(pick.id);
      if (pick.id !== r.data.defaultId) {
        log("Preset root → " + pick.label + " (" + r.data.defaultId + " unavailable)", "err");
      }
      loadPresets(pick.path);
    });
  }

  pathSelect.addEventListener("change", function () {
    var v = this.value;
    if (v === "__browse") {
      callHost("zae_pickPresetFolder", { path: currentDir }, function (r) {
        if (!r.ok) { renderRoots(currentRootId()); return; }   // cancelled — restore
        loadPresets(r.data.path);
      });
      return;
    }
    selectRoot(v);
  });

  // Which listed root the current directory corresponds to (blank after Browse).
  function currentRootId() {
    for (var i = 0; i < roots.length; i++) {
      if (roots[i].path && roots[i].path === currentDir) return roots[i].id;
    }
    return "";
  }

  refreshBtn.addEventListener("click", function () {
    if (currentDir) loadPresets(currentDir);
    else { presetsLoaded = false; initPresets(); }
  });

  // ── Name prompt (shared by New Category and Add Asset) ───────
  var promptMode = "category";

  // "All presets" (null) and the root row ("") both mean the preset root.
  function targetCategory() {
    return activeFolder ? activeFolder : "";
  }
  function targetLabel() {
    return activeFolder ? activeFolder : "root";
  }

  function closePrompt() {
    promptRow.className = "row addcat";
    addCatBtn.className = "ico";
    syncHeight();
  }

  function openPrompt(mode) {
    if (!currentDir) { flash("Pick a preset folder first", true); return; }
    promptMode = mode;
    promptInput.value = "";
    promptInput.placeholder = mode === "asset"
      ? "Asset name… (into " + targetLabel() + ")"
      : "Category name…";
    promptOk.textContent = mode === "asset" ? "Create" : "Add";
    promptRow.className = "row addcat open";
    addCatBtn.className = mode === "category" ? "ico on" : "ico";
    syncHeight();
    promptInput.focus();
  }

  function submitPrompt() {
    var name = promptInput.value.replace(/^\s+|\s+$/g, "");
    if (!name || !currentDir) return;
    promptOk.disabled = true;

    if (promptMode === "asset") {
      flash("Creating " + name + "…");
      callHost("zae_addAsset", {
        root: currentDir, category: targetCategory(), name: name,
        width: ASSET_W, height: ASSET_H, fps: ASSET_FPS, duration: ASSET_DUR
      }, function (r) {
        promptOk.disabled = false;
        log("Add asset → " + r.message, r.ok ? "ok" : "err");
        flash(r.message, !r.ok);
        if (!r.ok) return;
        closePrompt();
        loadPresets(currentDir);
      });
      return;
    }

    callHost("zae_addCategory", { root: currentDir, name: name }, function (r) {
      promptOk.disabled = false;
      log("Add category → " + r.message, r.ok ? "ok" : "err");
      flash(r.message, !r.ok);
      if (!r.ok) return;
      closePrompt();
      // Reload so the new (empty) category appears and becomes selectable.
      loadPresets(currentDir);
    });
  }

  addCatBtn.addEventListener("click", function () {
    if (promptRow.className.indexOf("open") !== -1 && promptMode === "category") closePrompt();
    else openPrompt("category");
  });
  promptOk.addEventListener("click", submitPrompt);
  promptInput.addEventListener("keydown", function (ev) {
    if (ev.keyCode === 13) { ev.preventDefault(); submitPrompt(); }
    else if (ev.keyCode === 27) { ev.preventDefault(); ev.stopPropagation(); closePrompt(); }
  });

  // ── Save the current AE selection as a preset ────────────────
  function saveAnimationPreset() {
    if (!currentDir) { flash("Pick a preset folder first", true); return; }
    flash("Waiting for AE's save dialog…");
    log("Save preset → opening After Effects' Save Animation Preset dialog…");
    callHost("zae_saveAnimationPreset", {
      root: currentDir, category: targetCategory()
    }, function (r) {
      log("Save preset → " + r.message, r.ok ? "ok" : "err");
      flash(r.message, !r.ok);
      if (r.ok && currentDir) loadPresets(currentDir);
    });
  }

  // ── Preview comp defaults ────────────────────────────────────
  // Small on purpose: previews are shown at ~96px in the grid, so 480x270 is
  // already ~5x the display size and renders in a fraction of the time a
  // full-size comp would. 30fps per spec; 3s is enough to read a motion preset
  // without turning the library into gigabytes of video.
  // Comps are AUTHORED at full size and EXPORTED small. Working at 1080p means
  // the preview project is a usable source in its own right; the preview file
  // itself only ever needs to be thumbnail-sized.
  var ASSET_W = 1920, ASSET_H = 1080, ASSET_FPS = 30, ASSET_DUR = 3;
  var EXPORT_W = 480, EXPORT_H = 270, EXPORT_MBPS = 8;

  // ── Card sizing ──────────────────────────────────────────────
  // Tiles are shaped by the preview comp, not the other way round: derive the
  // ratio from EXPORT_W/EXPORT_H so a rendered .mp4 fills its tile edge to edge
  // with nothing cropped. Change the comp size above and the grid follows.
  var PREVIEW_RATIO = EXPORT_H / EXPORT_W;

  // 100 still gives two columns at the 240px docked minimum once the rail and
  // the grid's 6px scrollbar are subtracted.
  var CARD_MIN = 72, CARD_MAX = 200, CARD_DEFAULT = 100;
  var SIZE_KEY = "zae.cardSize";
  // The size control used to be a Small/Medium/Big dropdown; map those stored
  // values so an existing install doesn't reset to the default.
  var LEGACY_SIZES = { small: 76, medium: 100, big: 140 };

  function applyCardSize(w) {
    if (LEGACY_SIZES.hasOwnProperty(w)) w = LEGACY_SIZES[w];
    w = Math.max(CARD_MIN, Math.min(CARD_MAX, Math.round(Number(w) || CARD_DEFAULT)));
    var s = document.documentElement.style;
    s.setProperty("--card-w", w + "px");
    // Definite px, so grid rows size exactly to content — a percentage-based
    // aspect box would contribute 0 to intrinsic sizing and clip the name.
    s.setProperty("--thumb-h", Math.round(w * PREVIEW_RATIO) + "px");
    if (sizeSlider && Number(sizeSlider.value) !== w) sizeSlider.value = w;
    return w;
  }

  function initCardSize() {
    var saved = null;
    try { saved = localStorage.getItem(SIZE_KEY); } catch (e) {}
    var w = applyCardSize(saved === null ? CARD_DEFAULT : saved);
    if (sizeSlider) {
      sizeSlider.min = CARD_MIN;
      sizeSlider.max = CARD_MAX;
      sizeSlider.value = w;
      sizeSlider.addEventListener("input", function () {
        var v = applyCardSize(this.value);
        // Menu coords are pinned to the viewport; resizing the cards moves them
        // out from under an open menu.
        closeMenu();
        try { localStorage.setItem(SIZE_KEY, String(v)); } catch (e2) {}
      });
    }
  }

  // ── Category rail width (drag handle) ────────────────────────
  var CATS_MIN = 56, CATS_MAX = 240, CATS_DEFAULT = 84;
  var CATS_KEY = "zae.catsWidth";
  var GRID_MIN = 96;      // the grid never gets squeezed below one card + chrome
  var GRIP_W   = 7;       // must match .catgrip's flex-basis

  function applyCatsWidth(w) {
    w = Math.max(CATS_MIN, Math.min(CATS_MAX, Math.round(Number(w) || CATS_DEFAULT)));
    // Also cap against the panel: dragging right must not swallow the grid.
    // The grip sits between them, so its width comes out of the budget too —
    // leaving it out lets the grid be squeezed ~7px under its floor.
    var wrap = catsEl.parentNode;
    var avail = wrap ? wrap.clientWidth : 0;
    if (avail) w = Math.min(w, Math.max(CATS_MIN, avail - GRID_MIN - GRIP_W));
    document.documentElement.style.setProperty("--cats-w", w + "px");
    return w;
  }

  function initCatsWidth() {
    var saved = null;
    try { saved = localStorage.getItem(CATS_KEY); } catch (e) {}
    applyCatsWidth(saved === null ? CATS_DEFAULT : saved);

    catGrip.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      closeMenu();
      var startX = ev.clientX;
      var startW = catsEl.getBoundingClientRect().width;
      catGrip.className = "catgrip open drag";

      function onMove(e) { applyCatsWidth(startW + (e.clientX - startX)); }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        catGrip.className = "catgrip open";
        try {
          localStorage.setItem(CATS_KEY, String(Math.round(catsEl.getBoundingClientRect().width)));
        } catch (e2) {}
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  function makePreviewComp(i) {
    var p = view[i];
    if (!p) return;
    var editing = !!p.project;
    flash(editing ? "Opening " + p.name + "…" : "Creating " + p.name + ".aep…");
    callHost("zae_makePreviewComp", {
      path: p.path, name: p.name,
      width: ASSET_W, height: ASSET_H, fps: ASSET_FPS, duration: ASSET_DUR
    }, function (r) {
      log((editing ? "Edit" : "Make") + " preview comp " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? p.name + " ✓" : r.message, !r.ok);
      // A newly created .aep changes the card's badges — rescan so the grid
      // reflects what's on disk now.
      if (r.ok && r.data && r.data.created && currentDir) loadPresets(currentDir);
    });
  }

  // Import a composition asset's main comp into whatever comp is open in AE.
  // zae_importAep already resolves "main" as the top-level comp that isn't
  // nested inside another, so precomps never get picked by mistake.
  function addToComp(i) {
    var p = view[i];
    if (!p || p.kind !== "comp") return;
    flash("Importing " + p.name + "…");
    callHost("zae_importAep", { aepPath: p.path, addToActive: true }, function (r) {
      log("Add to comp " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? p.name + " ✓" : r.message, !r.ok);
    });
  }

  function exportImagePreview(i) {
    var p = view[i];
    if (!p) return;
    flash("Saving " + p.name + ".png…");
    callHost("zae_exportImagePreview", {
      path: p.path, name: p.name, width: EXPORT_W, height: EXPORT_H
    }, function (r) {
      log("Export image " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? p.name + " ✓" : r.message, !r.ok);
      if (r.ok && currentDir) loadPresets(currentDir);
    });
  }

  function exportPreview(i) {
    var p = view[i];
    if (!p) return;
    // rq.render() blocks After Effects until it finishes, so evalScript's
    // callback only fires at the end — say what's happening up front.
    flash("Rendering " + p.name + "…");
    log("Export " + p.name + " → rendering (AE is busy until this finishes)…");
    callHost("zae_exportPreview", {
      path: p.path, name: p.name,
      width: EXPORT_W, height: EXPORT_H, bitrate: EXPORT_MBPS
    }, function (r) {
      log("Export " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? p.name + " exported ✓" : r.message, !r.ok);
      // The new .mp4 becomes the card's thumbnail on rescan.
      if (r.ok && currentDir) loadPresets(currentDir);
    });
  }

  function revealPreset(i) {
    var p = view[i];
    if (!p) return;
    callHost("zae_revealPreset", { path: p.path }, function (r) {
      log("Reveal " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      if (!r.ok) flash(r.message, true);
    });
  }

  // ── Context menus ────────────────────────────────────────────
  function closeMenu() { menuEl.className = "menu"; }

  // `tip` becomes the button's tooltip. Unavailable items get a class rather
  // than the disabled attribute — a disabled button swallows pointer events, so
  // its tooltip would never appear, and those are the items that most need to
  // explain themselves.
  function item(label, enabled, fn, tip) {
    var b = document.createElement("button");
    b.textContent = label;
    if (tip) b.title = tip;
    if (enabled) b.addEventListener("click", function () { closeMenu(); fn(); });
    else b.className = "off";
    menuEl.appendChild(b);
    return b;
  }

  function sep() {
    var d = document.createElement("div");
    d.className = "sep";
    menuEl.appendChild(d);
  }

  function openMenu(i, x, y) {
    var p = view[i];
    if (!p) return;

    menuEl.innerHTML = "";

    item(p.project ? "Edit Preview Comp" : "Make Preview Comp", true,
      function () { makePreviewComp(i); },
      p.project ? "Opens " + p.name + ".aep"
                : "New " + ASSET_W + "×" + ASSET_H + " @ " + ASSET_FPS + "fps");

    // Nothing to render without the project, so these stay unavailable until
    // the comp exists rather than failing after the click.
    item("Export mp4 Preview", !!p.project,
      function () { exportPreview(i); },
      p.project ? EXPORT_W + "×" + EXPORT_H + ", H.264 " + EXPORT_MBPS + " Mbps"
                : "Make the preview comp first");

    item("Export Image Preview", !!p.project,
      function () { exportImagePreview(i); },
      p.project ? EXPORT_W + "×" + EXPORT_H + " PNG, frame at the playhead"
                : "Make the preview comp first");

    sep();
    // A composition gets imported; a preset gets applied. Only one is meaningful
    // per asset, so show that one rather than an unavailable pair.
    if (p.kind === "comp") {
      item("Add to Comp", true, function () { addToComp(i); }, "Main comp → active comp");
    } else {
      item("Apply to selected layer", true,
        function () { select(i); applySelected(); }, "Applies to the selected layer(s)");
    }
    item("Reveal in Explorer", true, function () { revealPreset(i); }, p.path);

    // Show it before measuring, then clamp so it never runs off the panel.
    menuEl.className = "menu open";
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    menuEl.style.left = Math.max(2, Math.min(x, vw - mw - 2)) + "px";
    menuEl.style.top  = Math.max(2, Math.min(y, vh - mh - 2)) + "px";
  }

  // Right-click on the grid's empty space — actions that create things in the
  // selected category rather than acting on a card.
  function openEmptyMenu(x, y) {
    menuEl.innerHTML = "";

    var into = targetLabel();
    item("Save Animation as Preset…", !!currentDir, saveAnimationPreset,
      "AE selection → " + into);

    item("Add Asset…", !!currentDir, function () { openPrompt("asset"); },
      ASSET_W + "×" + ASSET_H + " @ " + ASSET_FPS + "fps → " + into);

    sep();
    item("New Category…", !!currentDir, function () { openPrompt("category"); },
      "New folder in " + (currentDir || "the preset root"));
    item("Reveal in Explorer", !!currentDir, function () {
      callHost("zae_revealPreset", { path: currentDir }, function (r) {
        if (!r.ok) flash(r.message, true);
      });
    }, currentDir);

    menuEl.className = "menu open";
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    menuEl.style.left = Math.max(2, Math.min(x, vw - mw - 2)) + "px";
    menuEl.style.top  = Math.max(2, Math.min(y, vh - mh - 2)) + "px";
  }

  listEl.addEventListener("contextmenu", function (ev) {
    // Cards handle their own right-click; this is the empty space around them.
    var n = ev.target;
    while (n && n !== listEl) {
      if (n.className && String(n.className).indexOf("card") !== -1) return;
      n = n.parentNode;
    }
    ev.preventDefault();
    openEmptyMenu(ev.clientX, ev.clientY);
  });

  document.addEventListener("click", function (ev) {
    if (menuEl.className.indexOf("open") !== -1 && !menuEl.contains(ev.target)) closeMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.keyCode === 27) closeMenu();
  });
  // A menu pinned to viewport coords would detach from its card on scroll.
  listEl.addEventListener("scroll", closeMenu);
  // Right-clicking the panel chrome shouldn't leave a stale menu open.
  document.addEventListener("contextmenu", function (ev) {
    if (!listEl.contains(ev.target)) closeMenu();
  });

  function applySelected() {
    var p = view[selectedIdx];
    if (!p) return;
    applyBtn.disabled = true;
    callHost("zae_applyPreset", { path: p.path }, function (r) {
      applyBtn.disabled = false;
      log("Apply " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? p.name + " ✓" : r.message, !r.ok);
    });
  }

  // Presets are applied to a layer; compositions are imported into the open comp.
  function useSelected() {
    var p = view[selectedIdx];
    if (!p) return;
    if (p.kind === "comp") addToComp(selectedIdx);
    else applySelected();
  }

  applyBtn.addEventListener("click", useSelected);

  // Collapsed = one status row only. Ask the host to shrink/grow the panel to
  // match, so a closed log costs no screen space next to AE's own panels.
  var COLLAPSED_H = 40, EXPANDED_H = 190, PRESETS_H = 400;

  function setPanelHeight(h) {
    try { csInterface.resizeContent(window.innerWidth || 240, h); } catch (e) { /* docked: host owns size */ }
  }

  // Height is driven by whichever sections are open; the browser is the tall
  // one, so it wins when both are showing.
  function syncHeight() {
    var presetsOpen = presetsEl.className.indexOf("open") !== -1;
    var logOpen     = logEl.className.indexOf("open") !== -1;
    if (presetsOpen) setPanelHeight(PRESETS_H + (logOpen ? 100 : 0));
    else             setPanelHeight(logOpen ? EXPANDED_H : COLLAPSED_H);
  }

  logBtn.addEventListener("click", function () {
    var open = logEl.className.indexOf("open") === -1;
    logEl.className = open ? "log open" : "log";
    logBtn.className = open ? "ico on" : "ico";
    logBtn.title = open ? "Hide log" : "Show log";
    syncHeight();
  });

  presetBtn.addEventListener("click", function () {
    var open = presetsEl.className.indexOf("open") === -1;
    presetsEl.className = open ? "presets open" : "presets";
    presetBtn.className = open ? "ico on" : "ico";
    presetBtn.title = open ? "Hide presets" : "Browse .ffx presets";
    syncHeight();
    // Scan lazily — a panel that's never opened shouldn't walk the disk.
    if (open) initPresets();
  });

  if (typeof fetch !== "function") {
    setConnected(false);
    stateEl.innerHTML = "<b>No fetch() in this CEP host</b>";
    return;
  }

  initCardSize();
  initCatsWidth();
  log("Panel started. Polling ZeusPack…");
  poll();
})();
