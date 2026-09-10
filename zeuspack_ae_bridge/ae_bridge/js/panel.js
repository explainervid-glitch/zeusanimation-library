/* ZeusPack — CEP panel client for Adobe After Effects
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
  var logEl   = document.getElementById("log");        // wrapper: open/closed
  var logLines = document.getElementById("logLines");  // the scrolling lines
  var testBtn = document.getElementById("testBtn");
  var logBtn  = document.getElementById("logBtn");

  var controlBtn = document.getElementById("controlBtn");
  var controlEl  = document.getElementById("control");
  var ctlBody    = document.getElementById("ctlBody");
  var ctlTitle   = document.getElementById("ctlTitle");
  var ctlRefresh = document.getElementById("ctlRefresh");
  var ctlUndo    = document.getElementById("ctlUndo");
  var ctlBind    = document.getElementById("ctlBind");

  var presetBtn  = document.getElementById("presetBtn");
  var presetsEl  = document.getElementById("presets");
  var pathSelect = document.getElementById("pathSelect");
  var refreshBtn = document.getElementById("refreshBtn");
  var promptRow    = document.getElementById("promptRow");
  var promptInput  = document.getElementById("promptInput");
  var promptOk     = document.getElementById("promptOk");
  var promptMsg    = document.getElementById("promptMsg");
  var promptCancel = document.getElementById("promptCancel");
  var listEl     = document.getElementById("list");
  // Watches which preview cards are on screen so only those hold a live video
  // player. Rebuilt on every renderList; see there.
  var previewObserver = null;
  var findInput  = document.getElementById("findInput");
  var findCount  = document.getElementById("findCount");
  var applyBtn    = document.getElementById("applyBtn");     // primary: full apply
  var applyInBtn  = document.getElementById("applyInBtn");   // entrance-only (trim)
  var applyOutBtn = document.getElementById("applyOutBtn");  // entrance, reversed
  var menuEl     = document.getElementById("menu");
  var sizeSlider = document.getElementById("sizeSlider");
  var catsEl     = document.getElementById("cats");
  var catGrip    = document.getElementById("catGrip");
  var loopBtn    = document.getElementById("loopBtn");
  var loopLbl    = document.getElementById("loopLbl");

  var toolsBtn    = document.getElementById("toolsBtn");
  var toolsEl     = document.getElementById("tools");
  var groupBtn    = document.getElementById("groupBtn");
  var ungroupBtn  = document.getElementById("ungroupBtn");
  var recenterBtn = document.getElementById("recenterBtn");
  var decomposeBtn = document.getElementById("decomposeBtn");
  var toolGrip    = document.getElementById("toolGrip");
  var mainEl      = document.getElementById("main");

  var connected = null;   // tri-state so the first result always renders

  // ── Status text visibility ───────────────────────────────────
  // Collapsed to just the dot by default. The dot's colour already carries the
  // connection state and its tooltip carries the words, so the row only needs
  // to spell things out when asked — clicking the dot toggles it.
  var dotBtn     = document.getElementById("dotBtn");
  var STATUS_KEY = "zae.statusText";
  var statusShown = false;
  try { statusShown = localStorage.getItem(STATUS_KEY) === "1"; } catch (e) {}

  var stateCls = "";   // "msg" | "err" — kept so the toggle can repaint it

  function paintState() {
    stateEl.className = "state " + stateCls + (statusShown ? "" : " off");
  }

  // The dot is the only thing left when the text is hidden, so the message has
  // to reach its tooltip or it would be unreachable without opening the log.
  function syncDotTitle() {
    var msg = stateEl.textContent || "";
    dotBtn.title = msg + (statusShown ? " (click to hide status text)"
                                      : " (click to show status text)");
  }

  function setStatusShown(on) {
    statusShown = !!on;
    paintState();
    syncDotTitle();
    try { localStorage.setItem(STATUS_KEY, statusShown ? "1" : "0"); } catch (e2) {}
  }

  // The status row carries asset names, folder names and host messages, any of
  // which can contain "<". Written as TEXT, never markup — a card named
  // "<img src=x onerror=…>" would otherwise run as script in a panel that holds
  // local file access. Emphasis is a class instead of a <b>.
  function setStatus(text, isErr) {
    stateEl.textContent = String(text);
    stateCls = isErr ? "err" : "msg";
    paintState();
    syncDotTitle();
  }

  function setConnected(isUp) {
    if (connected === isUp) return;
    connected = isUp;
    dot.className = "dot " + (isUp ? "ok" : "err");
    // Disconnected is not an error state — the red dot says it, and the panel's
    // preset browser works regardless.
    setStatus(isUp ? "Connected" : "ZeusPack not running", false);
    stateEl.title = isUp
      ? "Listening for jobs on 127.0.0.1:8771"
      : "Start ZeusPack, then keep this panel open";
    syncDotTitle();
  }

  dotBtn.addEventListener("click", function () { setStatusShown(!statusShown); });

  function log(msg, cls) {
    var line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
    // Appended to the LINES container, never to the wrapper: the trim below
    // deletes firstChild, and the wrapper's first child is the header row.
    logLines.appendChild(line);
    logLines.scrollTop = logLines.scrollHeight;
    while (logLines.childNodes.length > 200) logLines.removeChild(logLines.firstChild);
  }

  // Briefly show the last action in the status row, so the log can stay closed.
  var flashTimer = null;
  function flash(msg, isErr) {
    setStatus(msg, isErr);
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

  // ═══════════════════════════════════════════════════════════
  //  UPDATE CHECK
  // ═══════════════════════════════════════════════════════════
  // There are no releases and no tags to publish. The version of record is
  // Updates come from component-scoped GitHub Releases. The repo is a monorepo
  // (AE bridge, Animate plugin, Blender addon), so the AE panel only considers
  // releases whose tag starts with "ae-v" (e.g. "ae-v1.0.14") and ignores every
  // other component's releases.
  //
  // We LIST releases and filter by prefix — never /releases/latest, which is the
  // newest release repo-wide by date and could be a Blender one. The highest
  // ae-v* version wins; the update shows only when it is NEWER than what is
  // installed. Best-effort: no network or a bad response ends in silence.
  var UPDATE_REPO   = "explainervid-glitch/zeusanimation-library";
  var UPDATE_API    = "https://api.github.com/repos/" + UPDATE_REPO + "/releases?per_page=30";
  var UPDATE_TAG_RE = /^ae-v?(\d+\.\d+\.\d+)/i;   // "ae-v1.0.14" -> 1.0.14
  var UPDATE_TS_KEY   = "zae.updateCheckedAt";
  var UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
  // Fallback when CEP won't report the installed version. MUST track
  // ExtensionBundleVersion in CSXS/manifest.xml: the update check tests
  // INEQUALITY against the repo's manifest, so a stale value here reports a
  // phantom "update available" against a repo that has not moved.
  var PANEL_VERSION   = "1.0.18";

  var updateBtn = document.getElementById("updateBtn");

  function installedVersion() {
    try {
      var list = csInterface.getExtensions([csInterface.getExtensionID()]);
      if (list && list.length && list[0].version) return String(list[0].version);
    } catch (e) {}
    return PANEL_VERSION;
  }

  // Numeric compare on major.minor.patch; a leading "v" is ignored.
  function cmpVersion(a, b) {
    var pa = String(a).replace(/^v/i, "").split(".");
    var pb = String(b).replace(/^v/i, "").split(".");
    for (var i = 0; i < 3; i++) {
      var x = parseInt(pa[i], 10) || 0;
      var y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  // The button DOWNLOADS the new version into the user's Downloads folder and
  // opens it — it does not install. install.bat inside that folder is the one
  // installer (it handles the CEP folder and PlayerDebugMode). So the badge is
  // left showing: nothing is installed until the user runs install.bat and
  // restarts AE, after which the version check clears it on next launch.
  // `url`  — the release's attached .zip asset (mode "asset"), or the tag source
  //          zipball as a fallback (mode "source", the host pulls ae_bridge out).
  // Open the release download in the user's default browser — the .zip downloads
  // automatically. Browser download sidesteps AE's script network/file-write
  // permissions (which blocked the old in-panel downloader) and lets the user
  // grab the file the normal way. `url` is the direct asset (or source zip);
  // `pageUrl` is the release page, used only if there is no direct file.
  function runUpdate(remote, url, pageUrl) {
    var target = url || pageUrl;
    log("Update → clicked; opening the ae-v" + remote + " release in your browser…", "ok");
    if (!target) {
      flash("No download link found for this release", true);
      log("Update → the release has no asset, source zip, or page URL.", "err");
      return;
    }
    try {
      csInterface.openURLInDefaultBrowser(target);
      flash("Opened your browser — the zip is downloading");
      log("  Downloading: " + target);
      log("  When it finishes: unzip it, run install.bat, and restart After Effects.");
    } catch (e) {
      flash("Could not open the browser. Copy this link: " + target, true);
      log("Update → openURLInDefaultBrowser failed: " + e + " — link: " + target, "err");
    }
  }

  function showUpdate(remote, url, pageUrl) {
    var mine = installedVersion();
    updateBtn.style.display = "";
    updateBtn.title = "New AE release " + remote + " (you have " + mine
                    + ") — click to download in your browser";
    updateBtn.onclick = function () { runUpdate(remote, url, pageUrl); };
    log("Update available: ae-v" + remote + " (running " + mine + ")", "ok");
  }

  // Pick a release's download: prefer a .zip asset (an AE-named one if present),
  // else fall back to the tag's source zipball.
  function pickDownload(rel) {
    var assets = rel.assets || [], anyZip = null, pref = null;
    for (var i = 0; i < assets.length; i++) {
      var nm = String(assets[i].name || "").toLowerCase();
      if (nm.substring(nm.length - 4) !== ".zip") continue;
      if (!anyZip) anyZip = assets[i];
      if (/ae|zeuspack|bridge/.test(nm)) { pref = assets[i]; break; }
    }
    var pick = pref || anyZip;
    if (pick) return { url: pick.browser_download_url, mode: "asset" };
    return { url: rel.zipball_url, mode: "source" };
  }

  // `force` = a manual check from Settings: it bypasses the 6-hour throttle and
  // reports the outcome (found / up to date / error). The automatic launch check
  // stays silent unless it finds something.
  function checkForUpdate(force) {
    if (typeof fetch !== "function") {
      if (force) { flash("This host has no network access", true); }
      return;
    }

    if (!force) {
      var last = 0;
      try { last = Number(localStorage.getItem(UPDATE_TS_KEY)) || 0; } catch (e) {}
      if (Date.now() - last < UPDATE_EVERY_MS) return;
    }
    try { localStorage.setItem(UPDATE_TS_KEY, String(Date.now())); } catch (e2) {}

    if (force) { flash("Checking for updates…"); log("Update → manual check…", "ok"); }

    // List releases and keep the highest ae-v* version. The timestamp is a cache
    // buster; the Accept header asks for the stable API media type.
    fetch(UPDATE_API + "&t=" + Date.now(),
          { cache: "no-store", headers: { "Accept": "application/vnd.github+json" } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt) {
          if (force) { flash("Update check failed — GitHub did not respond", true); }
          return;
        }
        var list;
        try { list = JSON.parse(txt); } catch (e) {
          if (force) { flash("Update check failed — bad response", true); }
          return;
        }
        if (!list || !list.length) {
          if (force) { flash("No releases found in the repo", true); }
          return;
        }

        var best = null, bestVer = "";
        for (var i = 0; i < list.length; i++) {
          var rel = list[i];
          if (!rel || rel.draft || rel.prerelease) continue;   // stable releases only
          var m = UPDATE_TAG_RE.exec(String(rel.tag_name || ""));
          if (!m) continue;                                    // not an AE release
          var v = m[1];
          if (!best || cmpVersion(v, bestVer) > 0) { best = rel; bestVer = v; }
        }
        if (!best) {
          if (force) { flash("No AE release (ae-v*) published yet", true); }
          return;
        }
        // Only offer a NEWER release than what is installed.
        if (cmpVersion(installedVersion(), bestVer) >= 0) {
          if (force) {
            flash("You're up to date (" + installedVersion() + ")");
            log("Update → up to date; latest AE release is " + bestVer, "ok");
          }
          return;
        }

        var dl = pickDownload(best);
        // The direct download (asset or source zip); the release page is the
        // fallback the browser opens if there is no direct file.
        showUpdate(bestVer, dl.url, best.html_url);
        if (force) { flash("Update available: " + bestVer + " — see the green button"); }
      })
      .catch(function () {
        if (force) { flash("Update check failed — you may be offline", true); }
      });
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
  var knownFolders = [];  // every subfolder the scan visited, even empty ones
  var collapsedCats = {}; // folder path -> true while its children are hidden
  // Lucide chevron-right (collapsed) / chevron-down (expanded) for category rows
  // that have subcategories. Same inline-SVG style as the toolbar icons.
  var CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  var CHEVRON_DOWN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  // Lucide sticky-notes (lucide.dev/icons/sticky-notes) — two stacked notes,
  // marks a bundle card (a comp with attached .zfx presets).
  var STICKY_NOTE   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 16 14v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z"/><path d="M10 8v5a1 1 0 0 0 1 1h5"/><path d="M8 4a2 2 0 0 1 2-2h6a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 22 8v6a2 2 0 0 1-2 2"/><path d="M16 2v5a1 1 0 0 0 1 1h5"/></svg>';
  var activeFolder = null; // null = all folders
  var searchTerm   = "";   // exactly what was typed, for echoing back
  var searchTerms  = [];   // lowercased words, all of which must match
  var selectedIdx = -1;   // index into `view`
  var dragIndex   = -1;   // card being dragged onto a category, or -1
  var currentDir  = "";
  var presetsLoaded = false;
  var roots        = [];  // { id, label, path, exists }
  var ROOT_KEY = "zae.presetRoot";

  // ExtendScript hands back platform paths ("C:\Users\…"); <video>/<img> need a
  // file:// URL. encodeURI leaves ':' and '/' alone but '#' would truncate the
  // path, so it's escaped explicitly.
  //
  // `version` (the preview file's mtime) is appended as a query string.
  // Chromium caches file:// media by URL, so re-exporting a preview to the same
  // path kept serving the old frames until the panel was reopened. Chromium's
  // file loader ignores the query when resolving the path, so it is a safe
  // cache key rather than part of the filename.
  function fileUrl(p, version) {
    var u = "file:///" + encodeURI(String(p).replace(/\\/g, "/")).replace(/#/g, "%23");
    return version ? u + "?v=" + version : u;
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
    var isComp = !!(p && p.kind === "comp");
    applyBtn.textContent = isComp ? "Add to comp" : "Apply";
    applyBtn.disabled = !p;
    // In (entrance-only) and Out (reversed) only mean anything for a preset.
    applyInBtn.style.display = isComp ? "none" : "";
    applyInBtn.disabled = !p;
    applyOutBtn.style.display = isComp ? "none" : "";
    applyOutBtn.disabled = !p;
    // The Control panel binds to the selected Text card, so it follows selection.
    if (typeof refreshControlForSelection === "function") refreshControlForSelection();
  }

  function showMessage(html, isErr) {
    listEl.className = "list msg";
    listEl.innerHTML = '<div class="empty-list"' + (isErr ? ' style="color:#f85149"' : "") + ">" + html + "</div>";
    // ALL apply buttons. One left live over an empty grid would still have a
    // stale `view` behind it.
    applyBtn.disabled = true;
    applyInBtn.disabled = true;
    applyOutBtn.disabled = true;
  }

  // Preview playback mode, toggled from the toolbar.
  //   Loop  — every card plays continuously. Reads best, but a folder of a few
  //           hundred previews means that many simultaneous video decoders.
  //   Hover — preload="metadata" paints the first frame and only the card under
  //           the pointer plays, so one decoder runs at a time.
  // Decoder count follows the cards in the DOM, not the visible ones, so the
  // difference shows up on big folders and wide panels.
  var AUTOPLAY_KEY = "zae.autoplay";
  var autoplayAll  = true;
  try {
    var savedAutoplay = localStorage.getItem(AUTOPLAY_KEY);
    if (savedAutoplay !== null) autoplayAll = (savedAutoplay === "1");
  } catch (e) {}

  // `rerender` rebuilds the cards: the mode changes the <video> attributes and
  // which listeners are attached, so existing elements can't just be retuned.
  function setAutoplay(on, rerender) {
    autoplayAll = !!on;
    loopBtn.className = autoplayAll ? "ico lbl on" : "ico lbl";
    loopLbl.textContent = autoplayAll ? "Loop" : "Hover";
    loopBtn.title = autoplayAll
      ? "All previews loop (click for hover-only playback)"
      : "Previews play on hover (click to loop them all)";
    try { localStorage.setItem(AUTOPLAY_KEY, autoplayAll ? "1" : "0"); } catch (e2) {}

    if (rerender && view.length) {
      renderList();
      select(selectedIdx);      // renderList rebuilds the DOM, losing the highlight
    }
  }

  // The type/status badge spans for a card, shared by the thumbnail's corner
  // overlay (card view) and the inline badges beside the name (list view).
  function tagsHtml(p) {
    var isComp = p.kind === "comp";
    var isPlus = p.kind === "presetplus";
    var isText = isPlus && p.textType;
    var cls    = isComp ? "aep" : isText ? "text" : isPlus ? "zfx" : "ffx";
    var label  = isComp ? "Comp" : isText ? "Text" : isPlus ? "FX+" : "FX";
    var t = '<span class="tag ' + cls + '">' + label + "</span>";
    var own = (p.presets && p.presets.length) ? p.presets.length : 0;
    if (own && isComp) t += '<span class="tag zfx">FX+' + (own > 1 ? " " + own : "") + "</span>";
    if (!p.preview) t += '<span class="tag">no preview</span>';
    return t;
  }

  function thumbHtml(p) {
    // draggable="false" on the media: images and videos are natively draggable
    // and would hijack the card's own drag, so the drop would carry a file URL
    // instead of the asset.
    // Lazy: the URL is withheld in data-src until the card scrolls into view,
    // so an off-screen preview holds no video decoder. renderList's observer
    // attaches the src (and plays it, in Loop mode) on entry and releases it on
    // exit. One markup for both modes now — Loop vs Hover only changes whether
    // the observer calls play().
    var video = '<video draggable="false" data-src="' + esc(fileUrl(p.preview, p.previewMtime))
              + '" preload="metadata" loop muted playsinline></video>';

    // The badge marks WHAT the asset is, not what sidecars it has: "ffx" is an
    // animation preset, "aep" a composition, "zfx" a ZeusPack preset (which
    // carries expressions on top of the .ffx payload it embeds). A preset's
    // same-named .aep is only the source its preview was rendered from, so it
    // never shows as "aep".
    var isComp = p.kind === "comp";
    var isPlus = p.kind === "presetplus";
    // A Text preset is a .zfx tagged "text" at save time (a text-layer
    // animation). It applies exactly like FX+, but reads as its own type so it
    // is easy to spot and pairs with the Control panel.
    var isText = isPlus && p.textType;
    var cls    = isComp ? "aep" : isText ? "text" : isPlus ? "zfx" : "ffx";   // colour class
    var label  = isComp ? "Comp" : isText ? "Text" : isPlus ? "FX+" : "FX";  // what the user reads

    var media = !p.preview
      ? '<span class="ph">' + label + "</span>"
      : (p.previewKind === "video" ? video
          : '<img draggable="false" loading="lazy" src="' + esc(fileUrl(p.preview, p.previewMtime)) + '" alt="">');

    var tags = tagsHtml(p);   // corner badges over the thumbnail (card view)
    var own = (p.presets && p.presets.length) ? p.presets.length : 0;

    // A bundle — a comp that carries attached "<name>__<label>.zfx" presets — is
    // more than one asset in a single card. Flag it with a sticky-note in the
    // top-left corner; clicking it opens the "which to apply" menu.
    var bundleMark = own
      ? '<span class="stickynote" title="Bundle: ' + own + ' attached preset'
        + (own === 1 ? "" : "s") + ' — click to choose what to apply">' + STICKY_NOTE + "</span>"
      : "";

    return '<div class="thumb">' + media + bundleMark
         + '<span class="tags">' + tags + "</span></div>";
  }

  // ── Folder categories ────────────────────────────────────────
  // A tree: top-level categories from categories.json, and any subfolders found
  // beneath them. Subcategories are DISCOVERED rather than declared — the
  // manifest only gates the top level (that's what keeps Auto-Save out), so
  // anything inside a declared category was already scanned.
  //
  // Selecting a row shows that folder AND everything under it, so picking
  // "Text" still includes "Text/Kinetic".
  function inFolder(p, sel) {
    var f = String(p.folder || "");
    if (sel === "") return f === "";              // root = loose files only
    return f === sel || f.indexOf(sel + "/") === 0;
  }

  function renderCats() {
    var counts = {}, nodes = {}, i, f;

    // Direct count per exact folder path.
    for (i = 0; i < presets.length; i++) {
      f = String(presets[i].folder || "");
      counts[f] = (counts[f] || 0) + 1;
    }

    // Every row to draw = each path seen on disk, each declared category, and
    // all their ancestors (a preset in "A/B/C" implies rows for A and A/B).
    function addPath(path) {
      if (!path) { nodes[""] = true; return; }
      var parts = String(path).split("/"), acc = "";
      for (var k = 0; k < parts.length; k++) {
        if (!parts[k]) continue;
        acc = acc ? acc + "/" + parts[k] : parts[k];
        nodes[acc] = true;
      }
    }
    nodes[""] = true;                              // root is always a drop target
    for (f in counts) if (counts.hasOwnProperty(f)) addPath(f);
    if (declaredCats) for (i = 0; i < declaredCats.length; i++) addPath(declaredCats[i]);
    // Subcategories are discovered, not declared, so an empty one (freshly made
    // with New Folder…, nothing dropped into it yet) has no entry in `counts`
    // and would otherwise never get a row — knownFolders is every subfolder the
    // scan actually visited, empty or not.
    for (i = 0; i < knownFolders.length; i++) addPath(knownFolders[i]);

    var order = [];
    for (f in nodes) if (nodes.hasOwnProperty(f)) order.push(f);

    // Only the root row and no manifest means there is nothing to filter by.
    if (order.length <= 1 && !declaredCats) {
      catsEl.className = "cats"; catGrip.className = "catgrip";
      catsEl.innerHTML = "";
      return;
    }

    // Rolled up, so a parent reports everything beneath it — matching what
    // clicking it actually shows.
    function total(path) {
      if (path === "") return counts[""] || 0;
      var sum = 0;
      for (var k in counts) {
        if (!counts.hasOwnProperty(k)) continue;
        if (k === path || k.indexOf(path + "/") === 0) sum += counts[k];
      }
      return sum;
    }

    // Plain path sort puts children directly under their parent, because a
    // parent string is a prefix of its children. The root row sorts LAST: it
    // is the leftovers bucket, not a category, so it belongs under the real
    // ones rather than above them.
    order.sort(function (a, b) {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });

    // Only a row with at least one other row nested under it gets a live
    // toggle; everything else gets an invisible spacer so labels still align.
    var hasKids = {};
    for (i = 0; i < order.length; i++) {
      f = order[i];
      if (!f) continue;
      for (var j = 0; j < order.length; j++) {
        if (j !== i && order[j].indexOf(f + "/") === 0) { hasKids[f] = true; break; }
      }
    }

    // Hidden when any ANCESTOR (never the row itself) is collapsed, so
    // collapsing a folder hides everything nested under it at any depth.
    function hiddenByCollapse(path) {
      if (!path) return false;
      var parts = path.split("/"), acc = "";
      for (var k = 0; k < parts.length - 1; k++) {
        acc = acc ? acc + "/" + parts[k] : parts[k];
        if (collapsedCats[acc]) return true;
      }
      return false;
    }

    var html = '<div class="cat' + (activeFolder === null ? " sel" : "") + '" data-all="1">'
             +   '<span class="cn">All presets</span>'
             +   '<span class="cc">' + presets.length + "</span>"
             + "</div>";
    for (i = 0; i < order.length; i++) {
      f = order[i];
      if (hiddenByCollapse(f)) continue;
      var parts = f ? f.split("/") : [];
      var depth = parts.length ? parts.length - 1 : 0;
      // The root row holds whatever was never filed into a category, so it is
      // labelled for what it contains rather than for where it sits.
      var label = parts.length ? parts[parts.length - 1] : "(Uncategorize)";
      var toggle = hasKids[f]
        ? '<span class="catToggle" data-toggle="' + esc(f) + '" title="'
          + (collapsedCats[f] ? "Expand" : "Collapse") + '">'
          + (collapsedCats[f] ? CHEVRON_RIGHT : CHEVRON_DOWN) + "</span>"
        : '<span class="catToggle spacer"></span>';
      html += '<div class="cat' + (f === "" ? " root" : "")
            +   (activeFolder === f ? " sel" : "") + '" data-f="' + esc(f) + '"'
            +   ' title="' + esc(f || "Assets loose in the preset root") + '"'
            +   ' style="padding-left:' + (6 + depth * 10) + 'px">'
            +   toggle
            +   '<span class="cn">' + esc(label) + "</span>"
            +   '<span class="cc">' + total(f) + "</span>"
            + "</div>";
    }
    catsEl.className = "cats open"; catGrip.className = "catgrip open";
    catsEl.innerHTML = html;

    var rows = catsEl.getElementsByClassName("cat");
    for (i = 0; i < rows.length; i++) {
      // The toggle owns its own click: expand/collapse only, never the active
      // filter — stopPropagation keeps it from also selecting the row.
      var tgl = rows[i].getElementsByClassName("catToggle")[0];
      if (tgl && tgl.getAttribute("data-toggle") !== null) {
        tgl.addEventListener("click", function (ev) {
          ev.stopPropagation();
          var path = this.getAttribute("data-toggle");
          collapsedCats[path] = !collapsedCats[path];
          renderCats();
        });
      }

      rows[i].addEventListener("click", function () {
        activeFolder = this.getAttribute("data-all") ? null : this.getAttribute("data-f");
        closeMenu();
        renderCats();
        applyFilter();
      });

      // Right-click targets the row you clicked, and selects it first so the
      // menu's wording matches what you can see is highlighted.
      rows[i].addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var isAll = !!this.getAttribute("data-all");
        var path  = isAll ? "" : (this.getAttribute("data-f") || "");
        if (!isAll) {
          activeFolder = path;
          renderCats();
          applyFilter();
        }
        openCatMenu(path, ev.clientX, ev.clientY);
      });

      // ── Drop target: move the dragged asset into this category ──
      // "All presets" is a filter, not a folder, so it never accepts a drop.
      rows[i].addEventListener("dragover", function (ev) {
        if (dragIndex < 0 || this.getAttribute("data-all")) return;
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = "move"; } catch (e) {}
        setDropTarget(this, true);
      });
      rows[i].addEventListener("dragleave", function () { setDropTarget(this, false); });
      rows[i].addEventListener("drop", function (ev) {
        if (dragIndex < 0 || this.getAttribute("data-all")) return;
        ev.preventDefault();
        setDropTarget(this, false);
        var to = this.getAttribute("data-f") || "";
        var i2 = dragIndex;
        dragIndex = -1;
        moveAsset(i2, to);
      });
    }
  }

  // The rows are rebuilt on every render, so the highlight is a class toggle
  // rather than stored state.
  function setDropTarget(row, on) {
    var base = row.getAttribute("data-basecls") || row.className.replace(/\s*drop\b/, "");
    row.setAttribute("data-basecls", base);
    row.className = on ? base + " drop" : base;
  }

  function clearDropTargets() {
    var rows = catsEl.getElementsByClassName("cat");
    for (var i = 0; i < rows.length; i++) setDropTarget(rows[i], false);
  }

  function moveAsset(i, to) {
    var p = view[i];
    if (!p) return;
    if ((p.folder || "") === to) { flash(p.name + " is already there"); return; }

    flash("Moving " + p.name + "…");
    callHost("zae_moveAsset", {
      root: currentDir, name: p.name, from: p.folder || "", to: to,
      // A collected project moves as a folder, not as loose files.
      bundle: p.bundle || ""
    }, function (r) {
      log("Move " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? p.name + " ✓" : r.message, !r.ok);
      if (r.ok && currentDir) loadPresets(currentDir);
    });
  }

  // ── Search ───────────────────────────────────────────────────
  // Every typed word has to appear somewhere in the name or its category path.
  // AND rather than OR, so a second word narrows instead of widening, and
  // order-independent, so "pop glow" still finds "Glow Pop".
  function matchesSearch(p) {
    if (!searchTerms.length) return true;
    var hay = (String(p.name || "") + " " + String(p.folder || "")).toLowerCase();
    for (var i = 0; i < searchTerms.length; i++) {
      if (hay.indexOf(searchTerms[i]) === -1) return false;
    }
    return true;
  }

  function setSearch(raw) {
    searchTerm = String(raw === undefined || raw === null ? "" : raw);
    var t = searchTerm.toLowerCase().replace(/^\s+|\s+$/g, "");
    searchTerms = t ? t.split(/\s+/) : [];
    // Only write back when it differs, so setting it programmatically does not
    // fight the caret while someone is typing.
    if (findInput.value !== searchTerm) findInput.value = searchTerm;
    applyFilter();
  }

  // Deliberately NOT persisted. A search restored on launch would hide most of
  // the library with no obvious cause.
  function syncFindCount() {
    findCount.textContent = searchTerms.length ? String(view.length) : "";
  }

  // Why the grid is empty, specifically.
  //
  // "No match" inside a filtered category is a dead end: the preset may well
  // exist one row up in the rail. Counting what the category filter is hiding
  // turns that into a next step.
  function emptyMessage() {
    if (!presets.length) return "Nothing in this preset folder";
    if (!searchTerms.length) return "No presets in this category";

    var hidden = 0, i;
    for (i = 0; i < presets.length; i++) {
      if (!matchesSearch(presets[i])) continue;
      if (activeFolder === null || inFolder(presets[i], activeFolder)) continue;
      hidden++;
    }
    // esc() before it reaches innerHTML: this is whatever the user typed.
    var m = "No match for “" + esc(searchTerm) + "”";
    if (hidden) {
      m += "<br>" + hidden + " match" + (hidden === 1 ? "" : "es")
         + " in other categories (pick All presets)";
    }
    return m;
  }

  function applyFilter() {
    view = [];
    for (var i = 0; i < presets.length; i++) {
      var p = presets[i];
      if (activeFolder !== null && !inFolder(p, activeFolder)) continue;
      if (!matchesSearch(p)) continue;
      view.push(p);
    }
    syncFindCount();
    renderList();
    select(-1);          // clears the selection AND both buttons, in one place
  }

  // ── .zfx card tooltips ───────────────────────────────────────
  // What a preset actually contains is the question a shared library raises
  // constantly, and for a .zfx the file itself can answer it. Read lazily on
  // hover, never during the scan: one evalScript per .zfx would make opening a
  // large folder crawl, and most cards are never pointed at.
  //
  // path -> tooltip text. A cached "" means the read failed, so it is not
  // retried on every hover; the card keeps its plain path tooltip.
  var zfxInfo = {};

  // A short list of what the preset actually holds. Deliberately not the
  // provenance (source comp, save date, AE version, expression engine): that
  // is metadata about the file, and the question in front of the grid is what
  // the preset will DO.
  function listLine(label, count, names) {
    if (!count) return label + ": none";
    var line = label + ": " + count;
    if (names && names.length) {
      line += "  (" + names.join(", ") + (names.length < count ? ", …" : "") + ")";
    }
    return line;
  }

  function describeZfx(p, d) {
    var lines = [p.name], src = d.source || {}, c = d.contents || null;

    if (d.assetType === "text" || p.textType) {
      lines.push("Text preset — tweak its character/word/line range in the Control panel.");
    }

    // Written by the removed Quick Save. Saying so on hover beats finding out
    // from an error after clicking Apply.
    if (String(d.kind) === "native") {
      lines.push("Written by Quick Save, which was removed. Re-save it with "
               + "Save Animation+ before it can be applied.");
    }

    if (c) {
      lines.push(listLine("Effects", c.effectCount || 0, c.effects));
      lines.push(listLine("Animated properties", c.animatedCount || 0, c.animated));
    } else {
      // Contents were not recorded until they were added to the save path, and
      // they cannot be recovered from the payload. Better to say that than to
      // print "Effects: none" about a preset that is full of them.
      lines.push("Effects and properties were not recorded when this was saved."
               + " Re-save it to see them.");
    }
    lines.push("Expressions: " + d.expressions);

    // Saved from several layers by a build before the one-layer rule. Those
    // restore only the first layer's expressions, so it is worth knowing
    // before you rely on the preset rather than after.
    if (src.layers && src.layers.length > 1) {
      lines.push("Saved from " + src.layers.length + " layers by an older build; "
               + "only the first layer's expressions restore.");
    }
    if (src.selectedProperties) {
      lines.push("AE saved " + src.selectedProperties + " selected propert"
               + (src.selectedProperties === 1 ? "y" : "ies") + ", not the whole layer.");
    }

    lines.push(p.path);
    // A title attribute renders newlines, so the tooltip is a small block
    // rather than one long line.
    return lines.join("\n");
  }

  function requestZfxInfo(p, card) {
    if (zfxInfo.hasOwnProperty(p.path)) {
      if (zfxInfo[p.path]) card.title = zfxInfo[p.path];
      return;                       // already read, or already failed
    }
    zfxInfo[p.path] = "";           // claim it up front, so re-hovering while
                                    // the read is in flight does not stack up
    callHost("zae_readPresetPlus", { path: p.path }, function (r) {
      if (!r.ok || !r.data) return; // leaves the "" marker: do not retry
      var t = describeZfx(p, r.data);
      zfxInfo[p.path] = t;
      // The grid may have been rebuilt since the hover, so re-check that this
      // card still shows this asset before writing to it.
      if (card.parentNode && view[Number(card.getAttribute("data-i"))] &&
          view[Number(card.getAttribute("data-i"))].path === p.path) {
        card.title = t;
      }
    });
  }

  function renderList() {
    if (!view.length) {
      showMessage(emptyMessage());
      return;
    }

    listEl.className = listBaseClass();   // "list" or "list rows" per the view toggle
    var html = "";
    for (var i = 0; i < view.length; i++) {
      var p = view[i];
      // Folder is shown by the category list above, not repeated per card.
      // Falls back to the path until the .zfx has been read on hover.
      var tip = zfxInfo[p.path] || p.path;
      html += '<div class="card" draggable="true" data-i="' + i + '" title="' + esc(tip) + '">'
            +   thumbHtml(p)
            +   '<div class="meta"><span class="nm">' + esc(p.name) + "</span>"
            +     '<span class="rowtags">' + tagsHtml(p) + "</span></div>"
            + "</div>";
    }
    listEl.innerHTML = html;

    // ── Preview players: only what's on screen holds a decoder ──
    // 100+ autoplaying <video>s at once stutter, and past Chromium's media
    // element ceiling (~75) the extra ones silently stop playing. So each
    // preview keeps its URL in data-src and only becomes a live player while
    // its card is in (or near) the viewport; leaving view releases it again.
    if (previewObserver) { previewObserver.disconnect(); previewObserver = null; }

    function attachSrc(v) {
      if (!v || v.getAttribute("src")) return;
      var s = v.getAttribute("data-src");
      if (s) v.src = s;
    }
    function detachSrc(v) {
      if (!v) return;
      try { v.pause(); } catch (e) {}
      if (v.getAttribute("src")) {
        v.removeAttribute("src");
        try { v.load(); } catch (e2) {}   // drop the WebMediaPlayer
      }
    }

    if (typeof IntersectionObserver === "function") {
      // rootMargin preloads a screen's-worth ahead so a preview is already
      // playing by the time it is scrolled to, rather than popping in.
      previewObserver = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          var v = entries[e].target.getElementsByTagName("video")[0];
          if (!v) continue;
          if (entries[e].isIntersecting) {
            attachSrc(v);
            if (autoplayAll) { try { v.play(); } catch (err) {} }
          } else {
            detachSrc(v);
          }
        }
      }, { root: listEl, rootMargin: "200px 0px", threshold: 0.01 });
    }

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
      card.addEventListener("dblclick", function (ev) {
        var i = Number(this.getAttribute("data-i"));
        select(i);
        var a = view[i];
        // Any card that OWNS attached presets ("<name>__<label>.zfx") has more
        // than one "use me" — a comp to import or an FX+ owner to apply — so ask
        // instead of guessing. Everything else keeps the straight-through path.
        if (a && a.presets && a.presets.length) {
          openUseMenu(i, ev.clientX, ev.clientY);
          return;
        }
        useSelected();
      });
      // Drag a card onto a category row to move the asset there.
      card.addEventListener("dragstart", function (ev) {
        dragIndex = Number(this.getAttribute("data-i"));
        closeMenu();
        try {
          ev.dataTransfer.effectAllowed = "move";
          // Some payload is required or the drag never starts in Chromium.
          ev.dataTransfer.setData("text/plain", String(dragIndex));
        } catch (e) {}
      });
      card.addEventListener("dragend", function () {
        dragIndex = -1;
        clearDropTargets();
      });

      card.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        var i = Number(this.getAttribute("data-i"));
        select(i);
        openMenu(i, ev.clientX, ev.clientY);
      });

      // The bundle sticky-note opens the same "which to apply" menu as a
      // double-click, without applying anything by itself. stopPropagation so it
      // doesn't also fall through to the card's own click (plain select).
      (function (cardEl) {
        var sticky = cardEl.getElementsByClassName("stickynote")[0];
        if (!sticky) return;
        sticky.addEventListener("click", function (ev) {
          ev.stopPropagation();
          var i = Number(cardEl.getAttribute("data-i"));
          select(i);
          openUseMenu(i, ev.clientX, ev.clientY);
        });
        // Clicking the icon should never start a card drag.
        sticky.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
      })(card);

      // A .zfx can describe itself; ask the file the first time it is hovered.
      //
      // view[k], NOT p: this loop is separate from the one that built the
      // html, so `p` here is still whatever the LAST iteration of that loop
      // left behind (var is function-scoped). Cards render in view order, so
      // k indexes the asset this card is showing.
      var asset = view[k];
      if (asset && asset.kind === "presetplus") {
        (function (a, el) {
          el.addEventListener("mouseenter", function () { requestZfxInfo(a, el); });
        })(asset, card);
      }

      // Playback is driven by visibility. With an observer, a card plays only
      // while on screen (Loop mode) or attaches its first frame ready for hover
      // (Hover mode). Without one (very old CEF), fall back to loading every
      // preview up front, the previous behaviour.
      if (video) {
        if (previewObserver) previewObserver.observe(card);
        else { attachSrc(video); if (autoplayAll) { try { video.play(); } catch (e) {} } }

        // Hover playback is redundant while every card is already looping, so it
        // is wired only in Hover mode. attachSrc first: a card can be hovered
        // before the observer has attached its src.
        if (!autoplayAll) {
          card.addEventListener("mouseenter", function () {
            var v = this.getElementsByTagName("video")[0];
            if (v) { attachSrc(v); try { v.play(); } catch (e) {} }
          });
          card.addEventListener("mouseleave", function () {
            var v = this.getElementsByTagName("video")[0];
            if (v) { try { v.pause(); v.currentTime = 0; } catch (e) {} }
          });
        }
      }

      // CEF blocks file:// media unless the manifest grants access; without
      // this the card would just show an empty black box.
      var media = video || img;
      if (media) {
        media.onerror = function () {
          // Releasing an off-screen video (removeAttribute src + load) also
          // fires 'error' with an empty source; that is not a failure. Only a
          // still-set source that errored is a real "can't read the file".
          if (this.tagName === "VIDEO" && !this.getAttribute("src")) return;
          var t = this.parentNode;
          if (t) t.innerHTML = '<span class="ph err">no file access</span>';
        };
      }
    }

    // How many cards there are decides whether the grid has a scrollbar, which
    // is 6px off the width one card per row can take. Re-settle against what
    // was just rendered.
    applyCardSize();
  }

  // Is this folder path still one the rail will draw a row for? Guards the
  // selection kept across a reload: a category deleted (or renamed) since the
  // last scan would otherwise stay "selected" and filter the grid to nothing,
  // with no highlighted row to explain why.
  //
  // null = "All presets" and "" = the root row; both always exist.
  function folderStillListed(path) {
    if (path === null || path === "") return true;
    var i;
    for (i = 0; i < knownFolders.length; i++) if (knownFolders[i] === path) return true;
    if (declaredCats) {
      for (i = 0; i < declaredCats.length; i++) if (declaredCats[i] === path) return true;
    }
    // A folder holding assets is drawn even if the scan didn't list it directly.
    for (i = 0; i < presets.length; i++) {
      var f = String(presets[i].folder || "");
      if (f === path || f.indexOf(path + "/") === 0) return true;
    }
    return false;
  }

  // `prune` drops declared categories whose folder is gone. Passed only by the
  // Refresh button: it rewrites categories.json, which everyone on the shared
  // root reads, so it stays an explicit user action rather than a side effect
  // of every rename/move/delete reload.
  function loadPresets(dir, prune) {
    showMessage("Scanning…");
    callHost("zae_listPresets", { path: dir, prune: !!prune }, function (r) {
      if (!r.ok) {
        // Drop the whole view, not just `presets`. Leaving `view` and
        // `selectedIdx` behind meant a failed scan (an unplugged network root,
        // say) showed an error while still holding the previous folder's
        // presets, and Apply Out would happily apply one of them.
        presets = [];
        view = [];
        selectedIdx = -1;
        showMessage(esc(r.message), true);
        log("Presets → " + r.message, "err");
        return;
      }
      var prevDir = currentDir;
      currentDir = r.data.path;
      pathSelect.title = currentDir;
      renderRoots(currentRootId());
      // A rescan means the files may have been re-saved, so the tooltips read
      // from them are no longer trustworthy. Cheap to drop: they are re-read
      // lazily, and only for cards someone actually points at.
      zfxInfo = {};
      presets = r.data.presets || [];
      declaredCats = r.data.categories || null;
      knownFolders = r.data.folders || [];

      // Keep the selected category across a reload of the SAME root — Refresh,
      // and the rescans that follow a rename/move/delete/export, should leave
      // you where you were rather than throwing you back to "All presets".
      // Only a genuine root change (or a folder that has since gone) clears it,
      // because a path from the previous directory means nothing here.
      if (prevDir !== currentDir || !folderStillListed(activeFolder)) activeFolder = null;
      renderCats();
      applyFilter();
      log("Presets → " + r.message + " (" + r.data.withPreview + " with preview)"
          + (r.data.truncated ? " (list truncated)" : ""), "ok");

      // Say what was removed by name — this edited a shared file.
      var dropped = r.data.removedCategories || [];
      if (dropped.length) {
        log("categories.json → removed " + dropped.join(", ") + " (folder no longer on disk)", "ok");
        flash("Dropped " + dropped.length + " missing categor" + (dropped.length === 1 ? "y" : "ies"));
      }

      // A manifest that exists but won't parse used to fall back to scanning
      // every top-level folder — including Auto-Save — with nothing said about
      // it. Flag it loudly instead of letting it ride along in the "ok" line.
      if (r.data.manifestBroken) {
        log("categories.json is present but could not be parsed. Check it for a syntax error. "
            + "Showing all folders (including Auto-Save) until it's fixed.", "err");
        flash("categories.json is broken (see log)", true);
      }
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
        showMessage("No preset folder available. Pick one with Browse…", true);
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

  loopBtn.addEventListener("click", function () { setAutoplay(!autoplayAll, true); });

  refreshBtn.addEventListener("click", function () {
    // The one path that prunes categories.json — see loadPresets.
    if (currentDir) loadPresets(currentDir, true);
    else { presetsLoaded = false; initPresets(); }
  });

  // Copy text to the clipboard. execCommand rather than navigator.clipboard:
  // the latter needs a secure origin, which the panel's file:// page is not, so
  // it silently fails in CEF. Must run inside a user gesture (a click).
  function copyToClipboard(text) {
    var ok = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = String(text);
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    return ok;
  }

  // The on-disk folder a save should land in: the preset root plus the selected
  // category, as a Windows path — what AE's Save dialog expects pasted in.
  function saveDestPath(cat) {
    return currentDir + (cat ? "\\" + cat.split("/").join("\\") : "");
  }

  var copyPathBtn = document.getElementById("copyPathBtn");
  copyPathBtn.addEventListener("click", function () {
    if (!currentDir) { flash("No folder to copy", true); return; }
    var ok = copyToClipboard(currentDir);
    flash(ok ? "Path copied ✓" : "Could not copy the path", !ok);
    if (ok) log("Copied path → " + currentDir, "ok");
  });

  // ── Name prompt (shared by New Category and Add Asset) ───────
  var promptMode = "category";
  var promptIdx  = -1;          // asset being renamed, for mode "rename"
  var promptPath = "";          // folder path, for modes "category" / "catrename"

  // "All presets" (null) and the root row ("") both mean the preset root.
  function targetCategory() {
    return activeFolder ? activeFolder : "";
  }
  function targetLabel() {
    return activeFolder ? activeFolder : "root";
  }

  function closePrompt() {
    promptRow.className = "row addcat";
    promptOk.className = "btn";
    promptOk.disabled = false;
    // Cleared so a stale mode can't make a later Escape or Enter act on a
    // confirmation that is no longer on screen.
    promptMode = "";
    promptTarget = null;
    syncHeight();
  }

  // The asset a prompt is acting on, captured when the prompt OPENS.
  //
  // Never read back from view[] when the prompt is accepted. Every rescan
  // rebuilds the grid (a finished export, a move, a delete), and the panel
  // keeps responding while After Effects is busy rendering, so the list really
  // can shift while a prompt sits open. An index captured before that shift
  // points at a DIFFERENT asset after it.
  //
  // Delete and Rename both write to disk, so both capture. Delete had this
  // from the start; Rename was still reading view[promptIdx] at submit time
  // and could rename a file the user never picked.
  var promptTarget = null;

  function captureAsset(i) {
    var d = view[i];
    if (!d) return null;
    return { idx: i, name: d.name, folder: d.folder || "",
             bundle: d.bundle || "", path: d.path };
  }

  // opts: { idx } for an asset rename or delete, { path } for folder
  // create/rename.
  function openPrompt(mode, opts) {
    if (!currentDir) { flash("Pick a preset folder first", true); return; }
    opts = opts || {};
    promptMode = mode;
    promptIdx  = (opts.idx === undefined) ? -1 : opts.idx;
    promptPath = (opts.path === undefined) ? "" : opts.path;
    promptTarget = null;

    // Confirmation, not input: the message replaces the field, and focus lands
    // on Cancel so a reflexive Enter backs out instead of deleting.
    if (mode === "confirmdelete") {
      promptTarget = captureAsset(promptIdx);
      var d = promptTarget;
      if (!d) return;
      promptMsg.textContent = 'Delete "' + d.name + '"'
        + (d.bundle ? " and its whole folder" : "") + "? No undo.";
      promptMsg.title = d.bundle ? d.path + "  (the whole folder)" : d.path;
      promptOk.textContent = "Delete";
      promptOk.className = "btn danger";
      promptRow.className = "row addcat open ask";
      syncHeight();
      try { promptCancel.focus(); } catch (eF) {}
      return;
    }

    promptOk.className = "btn";
    var lastSegment = promptPath ? promptPath.split("/").pop() : "";
    var current = "";
    if (mode === "rename") {
      promptTarget = captureAsset(promptIdx);
      if (!promptTarget) return;
      current = promptTarget.name;
    } else if (mode === "catrename") current = lastSegment;

    promptInput.value = current;
    promptInput.placeholder =
        mode === "asset"     ? "Asset name… (into " + targetLabel() + ")"
      : mode === "rename"    ? "New name…"
      : mode === "catrename" ? "Rename folder…"
      : promptPath           ? "Folder inside " + lastSegment + "…"
      :                        "Folder name…";
    promptOk.textContent =
        mode === "asset" ? "Create"
      : (mode === "rename" || mode === "catrename") ? "Rename"
      : "Add";

    promptRow.className = "row addcat open";
    syncHeight();
    promptInput.focus();
    // Pre-select the old name so typing replaces it, but Tab/End keeps it.
    if (current) { try { promptInput.select(); } catch (e) {} }
  }

  function submitPrompt() {
    // Confirm mode has no input to read — check it before the name guard.
    if (promptMode === "confirmdelete") {
      var target = promptTarget;
      closePrompt();                 // clears promptTarget
      if (target) deleteAsset(target);
      return;
    }

    var name = promptInput.value.replace(/^\s+|\s+$/g, "");
    if (!name || !currentDir) return;
    promptOk.disabled = true;

    if (promptMode === "rename") {
      // The asset captured when the prompt opened, not whatever card now sits
      // at that index.
      var p = promptTarget;
      if (!p) { promptOk.disabled = false; closePrompt(); return; }
      callHost("zae_renameAsset", {
        root: currentDir, folder: p.folder, from: p.name, to: name,
        bundle: p.bundle
      }, function (r) {
        promptOk.disabled = false;
        log("Rename " + p.name + " → " + r.message, r.ok ? "ok" : "err");
        flash(r.message, !r.ok);
        if (!r.ok) return;
        closePrompt();
        loadPresets(currentDir);
      });
      return;
    }

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

    if (promptMode === "catrename") {
      var oldPath = promptPath;
      callHost("zae_renameCategory", { root: currentDir, path: oldPath, to: name }, function (r) {
        promptOk.disabled = false;
        log("Rename folder " + oldPath + " → " + r.message, r.ok ? "ok" : "err");
        flash(r.message, !r.ok);
        if (!r.ok) return;
        closePrompt();
        // Follow the folder: a selection pointing at the old path would filter
        // to nothing after the reload.
        if (activeFolder === oldPath || (activeFolder && activeFolder.indexOf(oldPath + "/") === 0)) {
          activeFolder = r.data && r.data.path
            ? (activeFolder === oldPath ? r.data.path
                                        : r.data.path + activeFolder.substring(oldPath.length))
            : null;
        }
        loadPresets(currentDir);
      });
      return;
    }

    // promptPath is the parent chosen by the rail's right-click; empty = root.
    callHost("zae_addCategory", { root: currentDir, parent: promptPath, name: name }, function (r) {
      promptOk.disabled = false;
      log("Add category → " + r.message, r.ok ? "ok" : "err");
      flash(r.message, !r.ok);
      if (!r.ok) return;
      closePrompt();
      // Reload so the new (empty) category appears and becomes selectable.
      loadPresets(currentDir);
    });
  }

  promptOk.addEventListener("click", submitPrompt);
  promptCancel.addEventListener("click", closePrompt);
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

  // ── Save the AE selection as a .zfx ──────────────────────────
  // Same modal as the legacy command — AE's Save Animation Preset is the only
  // way to get animation-preset bytes, and those bytes are what keeps the
  // format lossless. The difference is on either side of it: expressions are
  // read off the live layer first, and the .ffx is folded into the .zfx after.
  function savePresetPlus(assetType) {
    if (!currentDir) { flash("Pick a preset folder first", true); return; }
    var isText = assetType === "text";
    // Copy the destination folder to the clipboard while we still have the
    // click's user gesture, so it can be pasted straight into AE's save dialog.
    var dest = saveDestPath(targetCategory());
    var copied = copyToClipboard(dest);
    flash(copied ? "Path copied — paste it into AE's dialog" : "Waiting for AE's save dialog…");
    log("Save " + (isText ? "Text " : "") + ".zfx → opening After Effects' Save Animation Preset dialog…");
    if (copied) log("  Folder path copied to clipboard — paste into the dialog:  " + dest);
    log("  Name it and save anywhere. The panel files it into " + targetLabel() + " afterwards.");
    callHost("zae_savePresetPlus", {
      root: currentDir, category: targetCategory(),
      assetType: isText ? "text" : "fx"
    }, function (r) {
      log("Save .zfx → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? (r.data && r.data.name ? r.data.name + " ✓" : "Saved ✓") : r.message, !r.ok);
      if (r.ok && currentDir) loadPresets(currentDir);
    });
  }

  // ── Save the whole open project as a collected asset ─────────
  // Collect Files is a menu command with no arguments, so its two settings —
  // "Collect Source Files" and the destination — belong to AE's dialog and
  // cannot be scripted. Spell out both in the log BEFORE the modal opens,
  // because once it is up the panel can't say anything.
  function saveCompAsPreset() {
    if (!currentDir) { flash("Pick a preset folder first", true); return; }
    var cat = targetCategory();
    var dest = saveDestPath(cat);
    var copied = copyToClipboard(dest);
    flash(copied ? "Path copied — paste it into AE's dialog" : "Waiting for AE's Collect Files dialog…");
    log("Save comp → opening After Effects' Collect Files dialog…");
    log('  1. Set "Collect Source Files: All"  (AE remembers this)');
    log("  2. Point it at:  " + dest + (copied ? "   (copied to clipboard — paste it)" : ""));
    log("  If you save it somewhere else, the panel will move it here afterwards.");
    callHost("zae_saveCompAsPreset", { root: currentDir, category: cat }, function (r) {
      log("Save comp → " + r.message, r.ok ? "ok" : "err");
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
  var CARD_MIN = 72, CARD_DEFAULT = 100;
  // The top of the slider is not a fixed width: it is "one card per row", i.e.
  // whatever the grid happens to be wide. That ceiling moves with the panel,
  // the category rail and the tool strip, so it is measured rather than stored
  // — and the preference is remembered as this sentinel, not as the px width
  // it resolved to, so widening the panel keeps giving one card per row.
  var CARD_FIT = "fit";
  var SIZE_KEY = "zae.cardSize";
  // The size control used to be a Small/Medium/Big dropdown; map those stored
  // values so an existing install doesn't reset to the default.
  var LEGACY_SIZES = { small: 76, medium: 100, big: 140 };
  var LIST_PAD = 4;   // must match .list's padding

  // Same split as toolsWant: the REQUEST is kept apart from the width it was
  // clamped to, so a narrow panel does not quietly become the new preference.
  var cardWant = CARD_DEFAULT;   // a number, or CARD_FIT
  var cardMax  = 200;            // last measured ceiling

  // What one card gets when it has the row to itself. clientWidth already
  // excludes a scrollbar that is currently showing.
  function fitCardWidth() {
    if (!listEl) return CARD_MIN;
    return Math.max(CARD_MIN, listEl.clientWidth - LIST_PAD * 2);
  }

  function setCardVars(w) {
    var s = document.documentElement.style;
    s.setProperty("--card-w", w + "px");
    // Definite px, so grid rows size exactly to content — a percentage-based
    // aspect box would contribute 0 to intrinsic sizing and clip the name.
    s.setProperty("--thumb-h", Math.round(w * PREVIEW_RATIO) + "px");
  }

  // `w` omitted = re-apply the remembered request. Callers use that after a
  // layout change, when the ceiling has moved but the request has not.
  function applyCardSize(w) {
    if (w !== undefined) {
      if (LEGACY_SIZES.hasOwnProperty(w)) w = LEGACY_SIZES[w];
      cardWant = (w === CARD_FIT) ? CARD_FIT
               : Math.max(CARD_MIN, Math.round(Number(w) || CARD_DEFAULT));
    }
    cardMax = fitCardWidth();
    var out = (cardWant === CARD_FIT) ? cardMax : Math.min(cardWant, cardMax);
    setCardVars(out);
    // Going full width can summon a scrollbar (or dismiss one), which moves the
    // ceiling by the scrollbar's 6px. Reading clientWidth flushes layout, so
    // the second answer is the settled one; without this the card overflows and
    // is silently clipped by the grid's overflow-x:hidden.
    if (cardWant === CARD_FIT) {
      var again = fitCardWidth();
      if (again !== cardMax) { cardMax = again; out = again; setCardVars(out); }
    }
    if (sizeSlider) {
      sizeSlider.max = cardMax;
      if (Number(sizeSlider.value) !== out) sizeSlider.value = out;
    }
    return out;
  }

  function initCardSize() {
    var saved = null;
    try { saved = localStorage.getItem(SIZE_KEY); } catch (e) {}
    if (sizeSlider) { sizeSlider.min = CARD_MIN; sizeSlider.step = 1; }
    applyCardSize(saved === null ? CARD_DEFAULT : saved);
    if (sizeSlider) {
      sizeSlider.addEventListener("input", function () {
        // Dragged to the far end = one card per row, remembered as such: the
        // px value there is only true for the panel's current width.
        var atTop = Number(this.value) >= Number(this.max);
        applyCardSize(atTop ? CARD_FIT : this.value);
        // Menu coords are pinned to the viewport; resizing the cards moves them
        // out from under an open menu.
        closeMenu();
        try { localStorage.setItem(SIZE_KEY, String(cardWant)); } catch (e2) {}
      });
    }
    // The ceiling is the grid's width, so every layout change moves it. Panel
    // resizes reach us only through this event; the grips and the section
    // toggles call applyCardSize() themselves.
    window.addEventListener("resize", function () { applyControlWidth(); applyCardSize(); });
  }

  // ── Card / List view toggle ──────────────────────────────────
  // Both views render the SAME card markup; List view is a CSS variant
  // (.list.rows) that lays the cards out as compact rows. So switching is just a
  // class swap — no re-render — and the size slider only matters in Card view.
  var VIEW_KEY  = "zae.viewMode";
  var viewMode  = "card";
  var viewCardBtn = document.getElementById("viewCardBtn");
  var viewListBtn = document.getElementById("viewListBtn");

  function listBaseClass() { return viewMode === "list" ? "list rows" : "list"; }

  function setViewMode(mode) {
    viewMode = (mode === "list") ? "list" : "card";
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) {}
    if (viewCardBtn) viewCardBtn.className = (viewMode === "card") ? "ico on" : "ico";
    if (viewListBtn) viewListBtn.className = (viewMode === "list") ? "ico on" : "ico";
    if (sizeSlider) sizeSlider.disabled = (viewMode === "list");  // size is card-only
    // Repaint the grid's class in place; a "…" message keeps its own class.
    if (listEl.className.indexOf("msg") === -1) listEl.className = listBaseClass();
  }

  if (viewCardBtn) viewCardBtn.addEventListener("click", function () { setViewMode("card"); });
  if (viewListBtn) viewListBtn.addEventListener("click", function () { setViewMode("list"); });

  function initViewMode() {
    var saved = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch (e) {}
    setViewMode(saved === "list" ? "list" : "card");
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

      function onMove(e) {
        applyCatsWidth(startW + (e.clientX - startX));
        applyCardSize();   // the rail took width from the grid; the ceiling moved
      }
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

  // Drop CEF's handle on a card's preview file before overwriting it. Every
  // card holds its .mp4 open while Loop mode is on, and the export deletes
  // the previous file first — on Windows that delete can fail against a live
  // handle. The card is re-rendered from the rescan afterwards either way.
  function releasePreview(path) {
    if (!path) return;
    // Found by PATH, not by card number: the grid may have been rebuilt since
    // the action was started, and then card N is a different asset. Compared
    // against `view` rather than a DOM attribute so no new escaping surface is
    // introduced. See promptTarget.
    var i = -1, k;
    for (k = 0; k < view.length; k++) { if (view[k].path === path) { i = k; break; } }
    if (i < 0) return;

    var cards = listEl.getElementsByClassName("card");
    for (var n = 0; n < cards.length; n++) {
      if (Number(cards[n].getAttribute("data-i")) !== i) continue;
      var v = cards[n].getElementsByTagName("video")[0];
      if (v) {
        try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
      }
      var img = cards[n].getElementsByTagName("img")[0];
      if (img) { try { img.removeAttribute("src"); } catch (e2) {} }
      return;
    }
  }

  function exportImagePreview(i) {
    var p = view[i];
    if (!p) return;
    releasePreview(p.path);
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
    releasePreview(p.path);
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

  // `t` is the target captured by the confirmation, not a live index — see
  // promptTarget.
  function deleteAsset(t) {
    if (!t || !currentDir) return;
    // Loop mode keeps every .mp4 open; on Windows the delete fails against a
    // live handle, so let go of this card's preview first.
    releasePreview(t.path);
    flash("Deleting " + t.name + "…");
    callHost("zae_deleteAsset", {
      root: currentDir, folder: t.folder, name: t.name, bundle: t.bundle
    }, function (r) {
      log("Delete " + t.name + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.message, !r.ok);
      // Rescan either way: a partial delete still changed what is on disk.
      loadPresets(currentDir);
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
  // html: the label is already markup (used to bold an asset name inside an
  // otherwise plain sentence). Callers passing true must esc() anything that
  // came from a filename.
  function item(label, enabled, fn, tip, html) {
    var b = document.createElement("button");
    if (html) b.innerHTML = label;
    else b.textContent = label;
    if (tip) b.title = tip;
    if (enabled) b.addEventListener("click", function () { closeMenu(); fn(); });
    else b.className = "off";
    menuEl.appendChild(b);
    return b;
  }

  // Red menu entry for a destructive action. It never acts on click — it only
  // opens the confirmation bar. ExtendScript's remove() is a hard delete with no
  // recycle bin and no undo, on files that usually live on a shared drive, so
  // the action needs a second, explicit yes.
  function dangerItem(label, fn, tip) {
    var b = document.createElement("button");
    b.className = "danger";
    b.textContent = label;
    if (tip) b.title = tip;
    b.addEventListener("click", function () { closeMenu(); fn(); });
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
      item("Apply", true,
        function () { select(i); applySelected(false, true); },
        "Applies the whole preset — every keyframe, no trimming");
      item("Apply In", true,
        function () { select(i); applySelected(false, false); },
        "Applies the preset, keeping only its entrance keyframes");
      item("Apply Out", true,
        function () { select(i); applySelected(true, false); },
        "Applies the entrance keyframes, then time-reverses them");
    }
    sep();
    item("Rename…", true, function () { openPrompt("rename", { idx: i }); },
      "Renames the .ffx/.aep and its preview together");
    item("Reveal in Explorer", true, function () { revealPreset(i); }, p.path);

    sep();
    dangerItem("Delete Asset…",
      function () { openPrompt("confirmdelete", { idx: i }); },
      p.bundle ? "Deletes the whole collected folder, footage included (no undo)"
               : "Deletes the .ffx/.aep and its preview (no undo)");

    // Show it before measuring, then clamp so it never runs off the panel.
    menuEl.className = "menu open";
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    menuEl.style.left = Math.max(2, Math.min(x, vw - mw - 2)) + "px";
    menuEl.style.top  = Math.max(2, Math.min(y, vh - mh - 2)) + "px";
  }

  // Double-click on a composition that owns presets: import the comp, or apply
  // one of the presets that belong to it. The asset name is bold inside each
  // otherwise-plain sentence (item()'s html flag), so it has to be esc()'d.
  function openUseMenu(i, x, y) {
    var p = view[i];
    if (!p) return;
    menuEl.innerHTML = "";

    // First row = the owner card itself. A comp is imported; a preset owner is
    // applied. The name is coloured to its card badge: comp blue, FX+ green,
    // Text pink — so the menu reads at a glance like the grid does.
    if (p.kind === "comp") {
      item('Add <b class="mtag-comp">' + esc(p.name) + "</b> to Comp", true,
        function () { addToComp(i); },
        "Imports the composition into the open comp", true);
    } else {
      var ownerCls = p.textType ? "mtag-text" : "mtag-fx";
      item('Apply <b class="' + ownerCls + '">' + esc(p.name) + "</b>", true,
        function () { select(i); applySelected(false, true); },   // whole preset, no trim
        "Applies this preset to the selected layer(s)", true);
    }

    sep();
    for (var n = 0; n < p.presets.length; n++) {
      // Captured per iteration: the loop variable would have moved on by the
      // time anything is clicked.
      (function (preset) {
        var cls = preset.textType ? "mtag-text" : "mtag-fx";
        item('Apply <b class="' + cls + '">' + esc(preset.name) + "</b>", true, function () {
          applyOwnedPreset(p, preset, false, true);   // whole preset, no trim
        }, preset.path, true);
      })(p.presets[n]);
    }

    menuEl.className = "menu open";
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    menuEl.style.left = Math.max(2, Math.min(x, vw - mw - 2)) + "px";
    menuEl.style.top  = Math.max(2, Math.min(y, vh - mh - 2)) + "px";
  }

  // Attached presets are always .zfx, so they always take the richer path.
  function applyOwnedPreset(comp, preset, reverse, noTrim) {
    var label = (reverse ? "Apply Out " : "Apply ") + preset.name;
    applyBtn.disabled = true; applyInBtn.disabled = true; applyOutBtn.disabled = true;
    var params = { path: preset.path, reverse: !!reverse };
    if (noTrim) params.trim = false;
    callHost("zae_applyPresetPlus", params, function (r) {
      applyBtn.disabled = false; applyInBtn.disabled = false; applyOutBtn.disabled = false;
      log(label + " (from " + comp.name + ") → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? preset.name + " ✓" : r.message, !r.ok);
    });
  }

  // The host refuses a folder that still holds anything, so the failure path
  // here is a message rather than lost work — no confirmation step needed.
  function deleteCategory(path) {
    if (!currentDir || !path) return;
    var label = path.split("/").pop();
    flash("Deleting " + label + "…");
    callHost("zae_deleteCategory", { root: currentDir, path: path }, function (r) {
      log("Delete folder " + path + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.message, !r.ok);
      // loadPresets clears the selection, which pointed at a folder that is
      // now gone.
      if (r.ok) loadPresets(currentDir);
    });
  }

  // Right-click in the category rail. `path` is the row that was clicked, or ""
  // for the root (empty rail space, or the (root) row itself).
  function openCatMenu(path, x, y) {
    menuEl.innerHTML = "";

    var isRoot = !path;
    var label  = isRoot ? "the preset root" : path.split("/").pop();

    item("New Folder…", !!currentDir,
      function () { openPrompt("category", { path: isRoot ? "" : path }); },
      isRoot ? "New top-level folder" : "New folder inside " + label);

    // Only a real folder can be renamed — "All presets" is a filter and the
    // root is the preset folder itself.
    if (!isRoot) {
      item("Rename…", true,
        function () { openPrompt("catrename", { path: path }); },
        "Renames the folder on disk");
      item("Delete Folder", true,
        function () { deleteCategory(path); },
        "Deletes " + label + " (empty folders only, there is no undo)");
    }

    sep();
    item("Reveal in Explorer", !!currentDir, function () {
      var full = currentDir + (isRoot ? "" : "\\" + path.split("/").join("\\"));
      callHost("zae_revealPreset", { path: full }, function (r) {
        if (!r.ok) flash(r.message, true);
      });
    }, isRoot ? currentDir : path);

    menuEl.className = "menu open";
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    menuEl.style.left = Math.max(2, Math.min(x, vw - mw - 2)) + "px";
    menuEl.style.top  = Math.max(2, Math.min(y, vh - mh - 2)) + "px";
  }

  // Walks up from an event's target to the .cat row that owns it, or null when
  // the event landed on the rail's empty space below the last row.
  function rowFromEvent(ev) {
    var n = ev.target;
    while (n && n !== catsEl) {
      if (n.className && String(n.className).indexOf("cat") !== -1) return n;
      n = n.parentNode;
    }
    return null;
  }

  // Clicking the empty space clears the category filter, the same way clicking
  // "All presets" does — the rail's background is not part of any folder, so
  // leaving a row highlighted there would contradict what the grid is showing.
  catsEl.addEventListener("click", function (ev) {
    if (rowFromEvent(ev)) return;        // a row's own handler deals with it
    if (activeFolder === null) return;   // already unfiltered — nothing to redraw
    activeFolder = null;
    closeMenu();
    renderCats();
    applyFilter();
  });

  // Empty space in the rail targets the root.
  //
  // stopPropagation matters: the document-level contextmenu handler below
  // closes any menu opened outside the grid, and it runs AFTER this one on the
  // way up. Without it the menu opened here was shut again in the same event,
  // so right-clicking the rail's empty space appeared to do nothing. The row
  // handler has always stopped propagation, which is why rows worked and the
  // background did not.
  catsEl.addEventListener("contextmenu", function (ev) {
    if (rowFromEvent(ev)) return;        // a row handles it
    ev.preventDefault();
    ev.stopPropagation();
    openCatMenu("", ev.clientX, ev.clientY);
  });

  // Right-click on the grid's empty space — actions that create things in the
  // selected category rather than acting on a card.
  function openEmptyMenu(x, y) {
    menuEl.innerHTML = "";

    var into = targetLabel();

    item("Add Asset (New Project)", !!currentDir, function () { openPrompt("asset"); },
      ASSET_W + "×" + ASSET_H + " @ " + ASSET_FPS + "fps → " + into);

    sep();
    // The richer format first — it embeds the .ffx, so it keeps everything the
    // legacy command does and adds expressions on top.
    // The coloured word in each label matches that asset's card badge:
    // FX+ green (.zfx), Text pink (.text), Comp blue (.aep). Classes (not inline
    // colour) so the word turns white on hover and dims when the item is off.
    item('Save <span class="mtag-fx">Animation+</span>', !!currentDir, function () { savePresetPlus("fx"); },
      "ONE selected layer → " + into + ". Embeds AE's own preset data, so nothing is "
      + "lost, and captures expressions on top. Select a single layer (or just the "
      + "properties/effects on it); expressions are stored by property path, which "
      + "cannot tell two layers apart.", true);

    item('Save <span class="mtag-text">Text Animation+</span>', !!currentDir, function () { savePresetPlus("text"); },
      "Same as Save Animation+, but tags the preset as Text. Use it for a text "
      + "layer's animation — it gets the Text badge and pairs with the Control panel.", true);

    // Hidden for now (not needed) — kept so it can be restored later. To bring
    // it back, uncomment this item(). saveAnimationPreset() is left in place.
    // item("Save Animation (.ffx) ", !!currentDir, saveAnimationPreset,
    //   "AE selection → " + into + " (plain AE preset, no expression capture)");

    item('Save <span class="mtag-comp">Comp Asset</span>', !!currentDir, saveCompAsPreset,
      "Collect Files: the whole open project → " + into, true);

    sep();
    // Folder creation/renaming lives on the rail's own right-click menu.
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
  // Typing in a field owns its own keys; a shortcut must never eat a character
  // someone is trying to put into a name.
  function inTextField(t) {
    if (!t || !t.tagName) return false;
    var tag = String(t.tagName).toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  document.addEventListener("keydown", function (ev) {
    // "/" jumps to search, the way it does in a browser. Opens the browser
    // first if it is closed, since searching a hidden grid would look broken.
    var slash = (ev.key === "/") || (!ev.key && ev.keyCode === 191);
    if (slash && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !inTextField(ev.target)) {
      ev.preventDefault();
      if (presetsEl.className.indexOf("open") === -1) setPresetsOpen(true, false);
      try { findInput.focus(); findInput.select(); } catch (e) {}
      return;
    }

    if (ev.keyCode !== 27) return;
    closeMenu();
    if (typeof settingsOpen === "function" && settingsOpen()) closeSettings();
    // The confirmation bar hides the input, so there is no focused field to
    // catch Escape the way the other prompt modes do.
    if (promptMode === "confirmdelete") closePrompt();
  });

  findInput.addEventListener("input", function () { setSearch(this.value); });
  findInput.addEventListener("keydown", function (ev) {
    if (ev.keyCode !== 27) return;                 // Escape
    ev.preventDefault();
    // Stop the document handler running too: the first Escape should clear the
    // search, not also act on whatever else is open.
    ev.stopPropagation();
    if (this.value) setSearch("");                 // first Escape clears
    else this.blur();                              // a second one lets go
  });
  // A menu pinned to viewport coords would detach from its card on scroll.
  listEl.addEventListener("scroll", closeMenu);
  // Right-clicking the panel chrome shouldn't leave a stale menu open.
  document.addEventListener("contextmenu", function (ev) {
    if (!listEl.contains(ev.target)) closeMenu();
  });

  // Three ways to apply a preset:
  //   full (noTrim)  — the whole preset, every keyframe (the primary "Apply").
  //   In             — keep only the entrance keyframes (host trims in/out).
  //   Out (reverse)  — entrance keyframes, then time-reversed.
  function applySelected(reverse, noTrim) {
    var p = view[selectedIdx];
    if (!p) return;
    var label = noTrim ? "Apply" : reverse ? "Apply Out" : "Apply In";
    applyBtn.disabled = true; applyInBtn.disabled = true; applyOutBtn.disabled = true;
    // A .zfx goes through the richer path: it decodes its embedded .ffx and
    // then restores the expressions it captured on top.
    var fn = (p.kind === "presetplus") ? "zae_applyPresetPlus" : "zae_applyPreset";
    var params = { path: p.path, reverse: !!reverse };
    if (noTrim) params.trim = false;   // host trims by default; full apply opts out
    callHost(fn, params, function (r) {
      applyBtn.disabled = false; applyInBtn.disabled = false; applyOutBtn.disabled = false;
      log(label + " " + p.name + " → " + r.message, r.ok ? "ok" : "err");
      var tick = noTrim ? " ✓" : reverse ? " out ✓" : " in ✓";
      flash(r.ok ? p.name + tick : r.message, !r.ok);
    });
  }

  // Presets are applied to a layer; compositions are imported into the open comp.
  // The primary button applies the preset WHOLE (no trim).
  function useSelected() {
    var p = view[selectedIdx];
    if (!p) return;
    if (p.kind === "comp") addToComp(selectedIdx);
    else applySelected(false, true);
  }

  applyBtn.addEventListener("click", useSelected);
  applyInBtn.addEventListener("click", function () { applySelected(false, false); });
  applyOutBtn.addEventListener("click", function () { applySelected(true, false); });

  // ═══════════════════════════════════════════════════════════
  //  LAYER TOOLS
  // ═══════════════════════════════════════════════════════════
  // Grouping without a pre-comp: a control layer sized to the selection's
  // bounding box, with the selection parented to it.
  //
  // These act on After Effects' own selection, so there is nothing to pick in
  // the panel — the buttons just fire and report.
  var TOOLS_KEY    = "zae.toolsOpen";

  var toolButtons = [groupBtn, ungroupBtn, recenterBtn, decomposeBtn];

  function runTool(fn, label, params) {
    var i;
    for (i = 0; i < toolButtons.length; i++) toolButtons[i].disabled = true;
    flash(label + "…");
    callHost(fn, params || {}, function (r) {
      for (i = 0; i < toolButtons.length; i++) toolButtons[i].disabled = false;
      log(label + " → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? (r.message || label + " ✓") : r.message, !r.ok);
    });
  }

  // ── Where the null goes ──────────────────────────────────────
  // "bounds"  the middle of the selection's bounding box, so the handle lands
  //           in the visual middle of what it controls.
  // "anchor"  the average of the layers' own anchor points, which ignores how
  //           big anything is: a wide background no longer drags the handle
  //           away from the thing you meant to move.
  //
  // Group and Recenter BOTH read it. They run the same centring, so letting
  // them disagree would mean recentring a group moved its null somewhere the
  // grouping would never have put it.
  var CENTER_KEY = "zae.groupCenter";
  var groupCenter = "bounds";
  try {
    if (localStorage.getItem(CENTER_KEY) === "anchor") groupCenter = "anchor";
  } catch (e) {}

  var CENTER_LABEL = { bounds: "Bounding box", anchor: "Anchor point" };

  // Null placement now lives in the Settings modal; the group's inline gear is
  // gone. setGroupCenter stays: Group and Recenter read groupCenter, and the
  // modal writes it through here.
  function setGroupCenter(mode) {
    groupCenter = (mode === "anchor") ? "anchor" : "bounds";
    try { localStorage.setItem(CENTER_KEY, groupCenter); } catch (e2) {}
    log("Null placement: " + CENTER_LABEL[groupCenter], "ok");
    flash("Null placement: " + CENTER_LABEL[groupCenter]);
  }

  groupBtn.addEventListener("click", function () {
    runTool("zae_groupLayers", "Group", { center: groupCenter });
  });
  ungroupBtn.addEventListener("click", function () {
    runTool("zae_ungroupLayers", "Ungroup", {});
  });
  recenterBtn.addEventListener("click", function () {
    runTool("zae_recenterGroup", "Recenter", { center: groupCenter });
  });
  decomposeBtn.addEventListener("click", function () {
    runTool("zae_decompose", "Decompose", {});
  });

  // ── Tool strip width (drag handle) ───────────────────────────
  // Mirrors the category rail, but the strip is on the RIGHT, so dragging left
  // has to widen it — hence the inverted delta.
  // Buttons fill the strip's width, so this is purely how much room the labels
  // and group headings get.
  //
  // The floor is set by the widest HEADING ROW, not by the widest button label:
  // "NULL PARENT" is uppercase with letter-spacing and now shares its row with
  // the gear, which costs it 17px. That row needs 92px where the longest button
  // label ("Decompose", 52px) only needs 76. Measured, not guessed. Below 92
  // the heading ellipsizes to "NULL PAREN..." at the default width, which is
  // exactly where people leave it.
  var TOOLS_MIN = 92, TOOLS_MAX = 200, TOOLS_DEFAULT = 92;
  var TOOLS_W_KEY = "zae.toolsWidth";
  var PRESETS_MIN = 120;   // the browser never gets squeezed below this

  // What the user actually dragged to, independent of whether the panel is
  // currently wide enough to honour it.
  //
  // Keeping this separate from the measured width fixes two things. The strip
  // is display:none when closed, so measuring it returned 0 and the `|| DEFAULT`
  // fallback silently rewrote a dragged width back to one column every time the
  // strip was hidden or the browser toggled. And a drag made while the panel was
  // too narrow used to persist the CLAMPED width as the new preference, so the
  // strip never came back to its old size once the panel was widened again.
  var toolsWant = TOOLS_DEFAULT;

  // `w` omitted = re-apply the remembered request. Callers use that after a
  // layout change, when the ceiling has moved but the request has not.
  function applyToolsWidth(w) {
    if (w !== undefined) {
      toolsWant = Math.max(TOOLS_MIN, Math.min(TOOLS_MAX, Math.round(Number(w) || TOOLS_DEFAULT)));
    }
    // Cap against the panel so dragging can't swallow the browser. The grip
    // sits between them, so its width comes out of the budget too.
    var out = toolsWant;
    var avail = mainEl ? mainEl.clientWidth : 0;
    var presetsOpen = presetsEl.className.indexOf("open") !== -1;
    if (avail && presetsOpen) {
      out = Math.min(out, Math.max(TOOLS_MIN, avail - PRESETS_MIN - GRIP_W));
    }
    document.documentElement.style.setProperty("--tools-w", out + "px");
    return out;
  }

  function initToolsWidth() {
    var saved = null;
    try { saved = localStorage.getItem(TOOLS_W_KEY); } catch (e) {}
    applyToolsWidth(saved === null ? TOOLS_DEFAULT : saved);

    toolGrip.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      closeMenu();
      var startX = ev.clientX;
      var startW = toolsEl.getBoundingClientRect().width;
      toolGrip.className = "toolgrip open drag";

      function onMove(e) {
        applyToolsWidth(startW - (e.clientX - startX));
        applyCardSize();   // the strip took width from the grid; the ceiling moved
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        toolGrip.className = "toolgrip open";
        // Persist the REQUEST, not the measured width: on a narrow panel the
        // two differ, and saving the clamped value would make the squeeze
        // permanent once the panel was widened again.
        try { localStorage.setItem(TOOLS_W_KEY, String(toolsWant)); } catch (e2) {}
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  // ── Control panel width (drag handle) ────────────────────────
  // Mirrors the tool strip: a remembered request width, clamped against the
  // room the browser needs. When the control panel is solo (nothing else open)
  // it ignores this and fills the row via .main.cwide.
  var ctrlGrip = document.getElementById("ctrlGrip");
  var CONTROL_MIN = 150, CONTROL_DEFAULT = 240;
  var CONTROL_W_KEY = "zae.controlWidth";
  var controlWant = CONTROL_DEFAULT;

  function applyControlWidth(w) {
    if (w !== undefined) {
      controlWant = Math.max(CONTROL_MIN, Math.round(Number(w) || CONTROL_DEFAULT));
    }
    var out = controlWant;
    var avail = mainEl ? mainEl.clientWidth : 0;
    var presetsOpen = presetsEl.className.indexOf("open") !== -1;
    if (avail && presetsOpen) {
      out = Math.min(out, Math.max(CONTROL_MIN, avail - PRESETS_MIN - GRIP_W));
    }
    document.documentElement.style.setProperty("--control-w", out + "px");
    return out;
  }

  function initControlWidth() {
    var saved = null;
    try { saved = localStorage.getItem(CONTROL_W_KEY); } catch (e) {}
    applyControlWidth(saved === null ? CONTROL_DEFAULT : saved);

    ctrlGrip.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      closeMenu();
      var startX = ev.clientX;
      var startW = controlEl.getBoundingClientRect().width;
      ctrlGrip.className = "ctrlgrip open drag";

      function onMove(e) {
        applyControlWidth(startW + (e.clientX - startX));  // drag right = wider
        applyCardSize();   // control took width from the grid; the ceiling moved
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        ctrlGrip.className = "ctrlgrip open";
        try { localStorage.setItem(CONTROL_W_KEY, String(controlWant)); } catch (e2) {}
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  // The wrapper is shown only while something inside it is open — an empty
  // flex:1 row would otherwise hold the panel open at full height.
  function syncMain() {
    var presetsOpen = presetsEl.className.indexOf("open") !== -1;
    var toolsOpen   = toolsEl.className.indexOf("open") !== -1;
    var controlOpen = controlEl.className.indexOf("open") !== -1;
    var cls = (presetsOpen || toolsOpen || controlOpen) ? "main open" : "main";
    // Solo: the strip has the row to itself, so it takes the whole width and
    // the drag grip goes away — there is nothing left to resize against. Only
    // when neither the browser NOR the control panel shares the row.
    if (toolsOpen && !presetsOpen && !controlOpen) cls += " solo";
    // cwide: the control panel fills the row when the browser is closed.
    if (controlOpen && !presetsOpen) cls += " cwide";
    mainEl.className = cls;
    // The control grip only matters when the control panel and the browser
    // share the row (something to resize against).
    ctrlGrip.className = (controlOpen && presetsOpen) ? "ctrlgrip open" : "ctrlgrip";
  }

  function setToolsOpen(open) {
    toolsEl.className = open ? "tools open" : "tools";
    toolGrip.className = open ? "toolgrip open" : "toolgrip";
    toolsBtn.className = open ? "ico lbl on" : "ico lbl";
    toolsBtn.title = open ? "Hide layer tools" : "Layer tools (group, ungroup, recenter)";
    try { localStorage.setItem(TOOLS_KEY, open ? "1" : "0"); } catch (e) {}
    syncMain();
    syncHeight();
    // Re-clamp from the remembered request: the space available to the strip
    // changed with the layout, but what the user asked for did not.
    applyToolsWidth();
    applyCardSize();
  }

  toolsBtn.addEventListener("click", function () {
    setToolsOpen(toolsEl.className.indexOf("open") === -1);
  });

  // Collapsed = one status row only. Ask the host to shrink/grow the panel to
  // match, so a closed log costs no screen space next to AE's own panels.
  var COLLAPSED_H = 40, EXPANDED_H = 190, PRESETS_H = 400;

  function setPanelHeight(h) {
    try { csInterface.resizeContent(window.innerWidth || 240, h); } catch (e) { /* docked: host owns size */ }
  }

  // Height is driven by whichever sections are open; the browser is the tall
  // one, so it sets the baseline and the fixed-height rows add to it.
  // The tool strip sits BESIDE the browser now, so it costs no height when the
  // browser is open — it only sets the floor when it is the only thing showing.
  //
  // Tall enough that the tools-only view does not open onto a scrollbar: two
  // group headings and four buttons at the solo layout's 30px, plus the status
  // row and the strip's own padding.
  var TOOLS_ONLY_H = 230;

  function syncHeight() {
    var presetsOpen = presetsEl.className.indexOf("open") !== -1;
    var toolsOpen   = toolsEl.className.indexOf("open") !== -1;
    var logOpen     = logEl.className.indexOf("open") !== -1;
    var controlOpen = controlEl.className.indexOf("open") !== -1;

    // Control lives IN the main row now (left of the browser), so it makes the
    // row tall like the browser rather than adding a band of its own.
    var tall = presetsOpen || controlOpen;
    var h = tall        ? PRESETS_H
          : toolsOpen   ? TOOLS_ONLY_H
          :               COLLAPSED_H;
    if (logOpen) h += tall ? 100 : (EXPANDED_H - COLLAPSED_H);
    setPanelHeight(h);
  }

  logBtn.addEventListener("click", function () {
    var open = logEl.className.indexOf("open") === -1;
    logEl.className = open ? "log open" : "log";
    logBtn.className = open ? "ico on" : "ico";
    logBtn.title = open ? "Hide log" : "Show log";
    syncHeight();
  });

  // ── Text Control panel ───────────────────────────────────────
  // Shows the properties BOUND to the selected Text preset (.zfx), read live
  // from the active layer. Bind saves the AE-selected properties into that .zfx;
  // each edit is pushed to AE via zae_setBoundControl. CEP can't watch AE, so
  // the panel reads on open, on selection change, and on Refresh.
  var CONTROL_KEY = "zae.controlOpen";
  // Enum labels for known Range-Selector matchNames (see TX_ENUM_BY_MN below).
  var BASED_ON = [
    { v: 1, label: "Characters" },
    { v: 2, label: "Characters excl. spaces" },
    { v: 3, label: "Words" },
    { v: 4, label: "Lines" }
  ];
  var TX_UNITS = [ { v: 1, label: "Percentage" }, { v: 2, label: "Index" } ];
  var TX_MODE  = [
    { v: 1, label: "Add" }, { v: 2, label: "Subtract" }, { v: 3, label: "Intersect" },
    { v: 4, label: "Min" }, { v: 5, label: "Max" }, { v: 6, label: "Difference" }
  ];
  var TX_SHAPE = [
    { v: 1, label: "Square" }, { v: 2, label: "Ramp Up" }, { v: 3, label: "Ramp Down" },
    { v: 4, label: "Triangle" }, { v: 5, label: "Round" }, { v: 6, label: "Smooth" }
  ];
  // The Control panel binds to the selected Text card. controlZfxPath is that
  // card's .zfx; the panel shows only the properties bound in it.
  var controlZfxPath = "";
  // Known enum / checkbox properties get a dropdown / checkbox instead of a
  // plain number, keyed by matchName.
  var TX_ENUM_BY_MN = {
    "ADBE Text Range Type2":   BASED_ON,
    "ADBE Text Range Units":   TX_UNITS,
    "ADBE Text Selector Mode": TX_MODE,
    "ADBE Text Range Shape":   TX_SHAPE
  };
  var TX_CHECKBOX_MN = { "ADBE Text Randomize Order": true };

  // Control now sits in the main row (left of the browser), so opening it no
  // longer closes anything — both can be open — but it does reshape the row.
  function setControlOpen(open) {
    controlEl.className = open ? "control open" : "control";
    controlBtn.className = open ? "ico lbl on" : "ico lbl";
    controlBtn.title = open ? "Hide controls" : "Bound controls for the selected Text preset";
    syncMain();
    syncHeight();
    applyControlWidth();  // re-clamp from the remembered request
    applyToolsWidth();    // control took a slice of the row, so the ceilings moved
    applyCardSize();
    try { localStorage.setItem(CONTROL_KEY, open ? "1" : "0"); } catch (e) {}
    if (open) { readControlPanel(); startSelPoll(); }
    else stopSelPoll();
  }

  controlBtn.addEventListener("click", function () {
    setControlOpen(controlEl.className.indexOf("open") === -1);
  });
  ctlRefresh.addEventListener("click", readControlPanel);

  // Auto-follow the AE selection: CEP has no "layer selected" event, so (like
  // Animation Composer) we poll a cheap signature while the panel is open and
  // only do the full re-read when the active comp / selected layer / applied
  // preset actually changes — so picking a different layer refreshes the panel
  // without hitting Refresh.
  var SEL_POLL_MS = 600;
  var selPollTimer = null, lastSelSig = null, selPollBusy = false;

  function pollSelection() {
    if (selPollBusy) return;
    try { if (document.hidden) return; } catch (eH) {}
    // Don't yank a field the user is editing or scrubbing (mousedown focuses it).
    var ae = document.activeElement;
    if (ae && controlEl.contains(ae) && ae !== controlEl) return;
    selPollBusy = true;
    callHost("zae_selectionSig", {}, function (r) {
      selPollBusy = false;
      if (!r || !r.ok) return;
      var sig = (r.data && r.data.sig) || "";
      if (lastSelSig === null) { lastSelSig = sig; return; }  // baseline (open already read)
      if (sig !== lastSelSig) { lastSelSig = sig; readControlPanel(); }
    });
  }
  function startSelPoll() {
    if (selPollTimer) return;
    lastSelSig = null;                       // rebaseline on the next tick
    selPollTimer = setInterval(pollSelection, SEL_POLL_MS);
  }
  function stopSelPoll() {
    if (selPollTimer) { clearInterval(selPollTimer); selPollTimer = null; }
    lastSelSig = null;
  }

  // The Control panel targets the selected Text (.zfx) card, or null.
  function activeTextCard() {
    var p = (selectedIdx >= 0) ? view[selectedIdx] : null;
    return (p && p.kind === "presetplus" && p.textType) ? p : null;
  }

  // Called from select(): keep the panel in step with the grid selection.
  function refreshControlForSelection() {
    if (controlEl.className.indexOf("open") !== -1) readControlPanel();
  }

  // Bind: save the properties selected in AE's timeline into this Text preset.
  ctlBind.addEventListener("click", function () {
    if (!controlZfxPath) { flash("Select a Text preset card first", true); return; }
    ctlBind.disabled = true;
    callHost("zae_bindProperties", { path: controlZfxPath }, function (r) {
      ctlBind.disabled = false;
      log("Bind → " + r.message, r.ok ? "ok" : "err");
      flash(r.ok ? r.message : r.message, !r.ok);
      if (r.ok) { zfxInfo = {}; readControlPanel(); }   // .zfx changed
    });
  });

  // AE keeps its own undo stack; our edits are wrapped in undo groups, but the
  // keyboard shortcut goes to whichever app has focus — so from the panel we
  // trigger AE's Undo directly, then re-read so the values reflect the revert.
  ctlUndo.addEventListener("click", function () {
    callHost("zae_undo", {}, function (r) {
      log("Undo → " + r.message, r.ok ? "ok" : "err");
      if (!r.ok) { flash(r.message, true); return; }
      readControlPanel();
    });
  });

  function ctlMessage(msg) {
    ctlBody.innerHTML = '<div class="ctlempty">' + esc(msg) + "</div>";
  }

  function readControlPanel() {
    // The host resolves the target .zfx: the applied preset on the active layer
    // (its marker) wins; the selected Text card is the fallback. So this works
    // straight from a stamped layer with no card selected.
    var card = activeTextCard();
    ctlMessage("Reading…");
    callHost("zae_readBoundControls", { path: card ? card.path : "" }, function (r) {
      if (!r.ok) { ctlBind.disabled = true; ctlMessage(r.message || "Could not read the preset."); return; }
      var d = r.data || {};
      controlZfxPath = d.zfxPath || "";
      ctlBind.disabled = !controlZfxPath;
      ctlTitle.textContent = d.presetName || (card ? card.name : "Text controls");
      if (!controlZfxPath) {
        ctlMessage("Apply a Text preset to a layer and select the layer — or select a Text card — then bind properties.");
        return;
      }
      renderBoundControls(d);
    });
  }

  function ctlRow(labelText, control) {
    var row = document.createElement("div"); row.className = "ctlrow";
    var lab = document.createElement("span"); lab.className = "ctllabel";
    lab.textContent = labelText;
    row.appendChild(lab); row.appendChild(control);
    return row;
  }

  function ctlKeyedTag(row, cur) {
    if (cur && cur.keyed) {
      var kk = document.createElement("span");
      kk.className = "ctlkeyed"; kk.textContent = "keyed";
      row.appendChild(kk);
    }
    return row;
  }

  // A dropdown for an enum selector control. `onset(value)` does the push.
  function ctlDropdown(labelText, opts, cur, onset) {
    var sel = document.createElement("select");
    for (var i = 0; i < opts.length; i++) {
      var o = document.createElement("option");
      o.value = String(opts[i].v); o.textContent = opts[i].label;
      if (Number(cur.value) === opts[i].v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", function () { onset(Number(this.value)); });
    return ctlKeyedTag(ctlRow(labelText, sel), cur);
  }

  // Scrub a number input by dragging it left/right, like AE's Effect Controls.
  // A plain click still focuses it for typing — a drag only starts once the
  // pointer has actually moved. `commit` reads the input and pushes the value;
  // it fires live (rAF-throttled) during the drag and once more on release.
  function attachScrub(input, commit) {
    input.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      var startX = e.clientX, startVal = Number(input.value) || 0, moved = false;
      function move(ev) {
        var dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 3) return;   // let a click stay a click
        moved = true;
        ev.preventDefault();                       // no text-selection while dragging
        document.body.style.cursor = "ew-resize";
        // Shift = coarse (x10), Ctrl/Alt = fine (x0.1), otherwise 1 unit / pixel.
        var f = ev.shiftKey ? 10 : (ev.ctrlKey || ev.altKey) ? 0.1 : 1;
        // Update the field live for feedback, but DON'T push mid-drag: one push
        // on release = one AE undo step for the whole drag (and no evalScript
        // round-trip lag while dragging).
        input.value = String(Math.round((startVal + dx * f) * 1000) / 1000);
      }
      function up() {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        input._scrubbed = moved;                   // tell the click handler
        if (moved) commit();                       // push the final value once
      }
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });

    // AE-style click editing: a single click selects the whole value (type to
    // overwrite); a double-click collapses to a caret (insert). Skipped right
    // after a scrub-drag, which is not a click.
    input.addEventListener("click", function (e) {
      if (input._scrubbed) { input._scrubbed = false; return; }
      if (e.detail >= 2) return;                   // the dblclick handler takes over
      try { input.select(); } catch (_s) {}
    });
    input.addEventListener("dblclick", function () {
      try { var p = input.selectionEnd; input.setSelectionRange(p, p); } catch (_d) {}
    });
  }

  // Size a scrub field to its content so multi-axis values read tight, the way
  // AE shows them: "0,-48,0".
  function ctlFit(input) {
    // Count "-" as roughly half a digit so "-48" doesn't leave a gap; a small
    // buffer keeps the caret from clipping the last digit.
    var s = String(input.value);
    var w = s.replace(/-/g, "").length + (s.indexOf("-") >= 0 ? 0.5 : 0);
    input.style.width = (Math.max(1, w) + 0.15) + "ch";
  }

  // A scrub value field. type=text (not number) so the selection API works for
  // click-to-select-all and double-click-to-caret; inputmode keeps a numeric
  // keypad on touch.
  function ctlInput(value) {
    var inp = document.createElement("input");
    inp.type = "text"; inp.className = "ctlnum";
    inp.setAttribute("inputmode", "decimal");
    inp.value = String(Math.round(Number(value) * 1000) / 1000);
    return inp;
  }

  // A single number input (scrubbable + typeable). Bad text is ignored rather
  // than pushed as NaN.
  function ctlNumber(labelText, cur, onset) {
    var inp = ctlInput(cur.value);
    function fmt(x) { return String(Math.round(Number(x) * 1000) / 1000); }
    function commit() {
      var v = Number(inp.value);
      if (isFinite(v)) onset(v, function (stored) {
        var s = Number(stored);
        if (isFinite(s)) inp.value = fmt(s);   // show what AE clamped it to
      });
    }
    inp.addEventListener("change", commit);
    attachScrub(inp, commit);
    return ctlKeyedTag(ctlRow(labelText, inp), cur);
  }

  // A checkbox (AE checkbox properties store 0/1).
  function ctlCheckbox(labelText, cur, onset) {
    var inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = !!(cur.value === true || Number(cur.value) === 1);
    inp.addEventListener("change", function () { onset(this.checked ? 1 : 0); });
    return ctlKeyedTag(ctlRow(labelText, inp), cur);
  }

  // A multi-dimensional property (Position [x,y], Scale [x,y], colour [r,g,b,a]):
  // one number input per component, laid out in a single row. Any edit gathers
  // all components and pushes the whole array.
  function ctlVector(labelText, values, cur, onset) {
    var row = document.createElement("div"); row.className = "ctlrow";
    var lab = document.createElement("span"); lab.className = "ctllabel";
    lab.textContent = labelText; row.appendChild(lab);
    var wrap = document.createElement("span"); wrap.className = "ctlvec";
    var inputs = [];
    for (var i = 0; i < values.length; i++) {
      if (i > 0) {
        var comma = document.createElement("span");
        comma.className = "ctlcomma"; comma.textContent = ",";
        wrap.appendChild(comma);
      }
      var inp = ctlInput(values[i]);
      ctlFit(inp);
      inp.addEventListener("input", function () { ctlFit(this); });   // grow while typing
      wrap.appendChild(inp); inputs.push(inp);
    }
    function gather() {
      var out = [], ok = true;
      for (var k = 0; k < inputs.length; k++) {
        var v = Number(inputs[k].value);
        if (!isFinite(v)) { ok = false; break; }   // don't push a half-typed axis
        out.push(v);
      }
      if (ok) onset(out, function (stored) {
        // Reflect AE's clamped array back into each axis field.
        if (stored && typeof stored.length === "number") {
          for (var m = 0; m < inputs.length && m < stored.length; m++) {
            var s = Number(stored[m]);
            if (isFinite(s)) { inputs[m].value = String(Math.round(s * 1000) / 1000); ctlFit(inputs[m]); }
          }
        }
      });
    }
    for (var j = 0; j < inputs.length; j++) {
      (function (inp) {
        inp.addEventListener("change", gather);
        attachScrub(inp, function () { ctlFit(inp); gather(); });   // resize as the scrub changes it
      })(inputs[j]);
    }
    row.appendChild(wrap);
    return ctlKeyedTag(row, cur);
  }

  // Remove one binding from the .zfx (reached by right-clicking its row).
  function unbindControl(sig) {
    callHost("zae_unbindProperty", { path: controlZfxPath, sig: sig }, function (r) {
      log("Unbind → " + r.message, r.ok ? "ok" : "err");
      if (r.ok) { zfxInfo = {}; readControlPanel(); }
      else flash(r.message, true);
    });
  }

  // Right-click menu on a bound-property row: remove it.
  function openControlRowMenu(sig, label, x, y) {
    menuEl.innerHTML = "";
    dangerItem("Remove “" + label + "”", function () { unbindControl(sig); },
      "Removes this control from the Text preset");
    menuEl.className = "menu open";
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    menuEl.style.left = Math.max(2, Math.min(x, vw - mw - 2)) + "px";
    menuEl.style.top  = Math.max(2, Math.min(y, vh - mh - 2)) + "px";
  }

  function renderBoundControls(d) {
    ctlBody.innerHTML = "";
    var controls = d.controls || [];
    if (!controls.length) {
      ctlMessage("No properties bound yet. In AE, select the properties you want, then click Bind selected properties.");
      return;
    }
    if (!d.hasLayer) {
      var note = document.createElement("div");
      note.className = "ctlempty";
      note.textContent = "Select the text layer in AE to read and edit these.";
      ctlBody.appendChild(note);
    }

    for (var i = 0; i < controls.length; i++) {
      (function (c) {
        var row;
        if (c.missing || c.value === null || c.value === undefined) {
          // Bound, but not resolvable on the active layer right now.
          row = ctlRow(c.label, (function () {
            var s = document.createElement("span");
            s.className = "ctlmissing"; s.textContent = d.hasLayer ? "not on this layer" : "—";
            return s;
          })());
        } else {
          var onset = function (v, applyBack) { pushBound(c.sig, v, applyBack); };
          var enumOpts = TX_ENUM_BY_MN[c.mn];
          if (enumOpts && c.dims === 1) {
            row = ctlDropdown(c.label, enumOpts, c, onset);
          } else if (TX_CHECKBOX_MN[c.mn] && c.dims === 1) {
            row = ctlCheckbox(c.label, c, onset);
          } else if (c.dims > 1 && c.value && c.value.length) {
            row = ctlVector(c.label, c.value, c, onset);
          } else {
            row = ctlNumber(c.label, c, onset);
          }
        }
        // Right-click the row to remove the binding (no visible × button).
        row.addEventListener("contextmenu", function (ev) {
          ev.preventDefault();
          openControlRowMenu(c.sig, c.label, ev.clientX, ev.clientY);
        });
        ctlBody.appendChild(row);
      })(controls[i]);
    }
  }

  // applyBack (optional) receives the value AE actually stored (post-clamp) so
  // the field can correct itself to the real value.
  function pushBound(sig, value, applyBack) {
    callHost("zae_setBoundControl",
      { path: controlZfxPath, sig: sig, value: value },
      function (r) {
        log("Control → " + r.message, r.ok ? "ok" : "err");
        if (!r.ok) { flash(r.message, true); return; }
        if (applyBack && r.data && r.data.value !== undefined && r.data.value !== null) {
          try { applyBack(r.data.value); } catch (e) {}
        }
      });
  }

  var PRESETS_KEY = "zae.presetsOpen";

  // `deferScan` is for the startup call only: CEP loads the panel HTML and the
  // JSX independently, so evalScript fired synchronously on load can land
  // before host.jsx is in place. A click is always well after that.
  function setPresetsOpen(open, deferScan) {
    presetsEl.className = open ? "presets open" : "presets";
    presetBtn.className = open ? "ico lbl on" : "ico lbl";
    presetBtn.title = open ? "Hide presets" : "Browse .ffx presets and .aep compositions";
    syncMain();
    syncHeight();
    // The strip and the control panel share the row with the browser, so their
    // ceilings moved.
    applyToolsWidth();
    applyControlWidth();
    applyCardSize();
    try { localStorage.setItem(PRESETS_KEY, open ? "1" : "0"); } catch (e) {}
    if (!open) return;
    if (deferScan) setTimeout(initPresets, 200);
    else initPresets();
  }

  presetBtn.addEventListener("click", function () {
    setPresetsOpen(presetsEl.className.indexOf("open") === -1, false);
  });

  // ── Settings modal (gear button in the top bar) ─────────────
  // Gathers the persistent preferences that otherwise live on scattered
  // quick-toggles (the Loop button, the tools gear, the status dot). Each
  // control drives the SAME setter and localStorage key as its quick-toggle,
  // so the two never drift apart.
  var settingsBtn     = document.getElementById("settingsBtn");
  var settingsModal   = document.getElementById("settingsModal");
  var settingsClose   = document.getElementById("settingsClose");
  var settingsVersion = document.getElementById("settingsVersion");
  var setPlayback     = document.getElementById("setPlayback");
  var setCenterGrp    = document.getElementById("setCenter");
  var setStatusGrp    = document.getElementById("setStatus");
  var setCheckUpdate  = document.getElementById("setCheckUpdate");

  // Paint each two-option group so the active choice is highlighted. Called on
  // open and after any change, so a setting flipped elsewhere shows correctly.
  function markSeg(group, value) {
    if (!group) return;
    var opts = group.getElementsByClassName("segopt");
    for (var i = 0; i < opts.length; i++) {
      var on = opts[i].getAttribute("data-v") === value;
      opts[i].className = on ? "segopt on" : "segopt";
    }
  }
  function syncSettings() {
    markSeg(setPlayback, autoplayAll ? "loop" : "hover");
    markSeg(setCenterGrp, groupCenter);
    markSeg(setStatusGrp, statusShown ? "on" : "off");
  }

  function openSettings() {
    closeMenu();
    if (settingsVersion) {
      settingsVersion.textContent = "ZeusPack " + PANEL_VERSION
        + (hostVersion ? "  ·  AE " + hostVersion : "");
    }
    syncSettings();
    settingsModal.className = "modal open";
    if (settingsBtn) settingsBtn.className = "ico on";
  }
  function closeSettings() {
    settingsModal.className = "modal";
    if (settingsBtn) settingsBtn.className = "ico";
  }
  function settingsOpen() { return settingsModal.className.indexOf("open") !== -1; }

  if (settingsBtn) settingsBtn.addEventListener("click", function () {
    if (settingsOpen()) closeSettings();
    else openSettings();
  });

  if (setPlayback) setPlayback.addEventListener("click", function (ev) {
    var v = ev.target.getAttribute && ev.target.getAttribute("data-v");
    if (!v) return;
    setAutoplay(v === "loop", true);
    syncSettings();
  });
  if (setCenterGrp) setCenterGrp.addEventListener("click", function (ev) {
    var v = ev.target.getAttribute && ev.target.getAttribute("data-v");
    if (!v) return;
    setGroupCenter(v);
    syncSettings();
  });
  if (setStatusGrp) setStatusGrp.addEventListener("click", function (ev) {
    var v = ev.target.getAttribute && ev.target.getAttribute("data-v");
    if (!v) return;
    setStatusShown(v === "on");
    syncSettings();
  });

  // Manual update check — the fallback for the throttled/silent auto-check.
  if (setCheckUpdate) setCheckUpdate.addEventListener("click", function () {
    checkForUpdate(true);
  });

  if (settingsClose) settingsClose.addEventListener("click", closeSettings);
  // Click on the dimmed backdrop (the overlay itself, never the card) closes.
  settingsModal.addEventListener("click", function (ev) {
    if (ev.target === settingsModal) closeSettings();
  });

  if (typeof fetch !== "function") {
    setConnected(false);
    setStatus("No fetch() in this CEP host", true);
    return;
  }

  initCardSize();
  initViewMode();
  initCatsWidth();
  initToolsWidth();
  initControlWidth();
  setStatusShown(statusShown);   // paints the saved choice onto the row
  setAutoplay(autoplayAll, false);

  // Tools start closed — the browser is the panel's main job. Set before the
  // browser so syncHeight only runs once with both states settled.
  var savedTools = null;
  try { savedTools = localStorage.getItem(TOOLS_KEY); } catch (e) {}
  setToolsOpen(savedTools === "1");

  // Control panel starts closed; restore if it was left open.
  var savedControl = null;
  try { savedControl = localStorage.getItem(CONTROL_KEY); } catch (e) {}
  if (savedControl === "1") setControlOpen(true);

  // Browser is open by default; after that the panel remembers whether it was
  // left open. Control can be open at the same time (it sits beside it).
  var savedOpen = null;
  try { savedOpen = localStorage.getItem(PRESETS_KEY); } catch (e) {}
  setPresetsOpen(savedOpen === null ? true : savedOpen === "1", true);

  checkForUpdate();
  log("Panel started. Polling ZeusPack…");
  poll();
})();
