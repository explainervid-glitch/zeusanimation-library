/* ZeusPack Bridge — CEP panel client for Adobe Animate 2024
 *
 * The CEP host has `fetch` but no Node.js, so this panel can't listen — it
 * POLLS the ZeusPack app's loopback server (127.0.0.1:8770):
 *   GET  /poll    → heartbeat + next job to run
 *   POST /result  → return a finished job's result
 * Each job maps to a JSFL function in jsx/host.jsx, run via evalScript.
 *
 * UI is deliberately minimal (one status row) so it doesn't cover Animate's
 * own panels. The log is collapsed unless the user opens it.
 */
(function () {
  "use strict";

  var BASE = "http://127.0.0.1:8770";
  var POLL_MS = 800;

  var csInterface = new CSInterface();
  var hostVersion = "";
  try { hostVersion = csInterface.getHostEnvironment().appVersion || ""; } catch (e) {}

  var dot     = document.getElementById("dot");
  var stateEl = document.getElementById("state");
  var logEl   = document.getElementById("log");
  var testBtn = document.getElementById("testBtn");
  var logBtn  = document.getElementById("logBtn");

  var connected = null;   // tri-state so the first result always renders

  function setConnected(isUp) {
    if (connected === isUp) return;
    connected = isUp;
    dot.className = "dot " + (isUp ? "ok" : "err");
    stateEl.innerHTML = isUp
      ? "<b>Connected</b>"
      : "<b>ZeusPack not running</b>";
    stateEl.title = isUp
      ? "Listening for jobs on 127.0.0.1:8770"
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

  // ── JSFL dispatch: action name → host function call ──
  function hostCallFor(job) {
    var p = JSON.stringify(job.params || {});
    switch (job.action) {
      case "ping":            return "zb_ping(" + p + ")";
      case "active-doc":      return "zb_getActiveDocInfo(" + p + ")";
      case "import-fla":      return "zb_importFla(" + p + ")";
      case "get-library":     return "zb_getLibrary(" + p + ")";   // active doc (no UI button, bridge-callable)
      case "get-fla-library": return "zb_getFlaLibrary(" + p + ")";
      case "open-fla":        return "zb_openFla(" + p + ")";
      case "import-symbol":   return "zb_importSymbol(" + p + ")";
      case "compile-2d":      return "zb_compile2d(" + p + ")";
      default:                return "zb_unknown(" + JSON.stringify(job.action) + ")";
    }
  }

  function parseResult(result) {
    try { return JSON.parse(result); }
    catch (e) { return { ok: false, message: "Bad host result: " + String(result) }; }
  }

  // ── zeploy usage ──
  // The team's deployment tool, zeploy, counts which features get used
  // (js/zeploy-usage.js writes the counts to a local file its agent reads).
  // A job counts once Animate finishes it; a refusal such as "No active
  // Animate document." counts as nothing. No names, paths or other project
  // data are recorded.

  // ExtensionBundleVersion from CSXS/manifest.xml, so it never needs a second edit.
  function panelVersion() {
    try {
      var file = window.cep.fs.readFile(csInterface.getSystemPath(SystemPath.EXTENSION) + "/CSXS/manifest.xml");
      var m = file.err === 0 && /ExtensionBundleVersion="([^"]+)"/.exec(file.data);
      return m ? m[1] : "";
    } catch (e) {
      return "";
    }
  }

  var usage = zeployUsageV1("com.zeus.zeuspackbridge", panelVersion());
  usage.open();

  // ZeusPack app jobs that are features (the rest are status reads and pre-loading).
  var USAGE_JOBS = {
    "import-fla":    "import fla",
    "import-symbol": "import symbol",
    "compile-2d":    "compile 2d"
  };

  // The host's catch-all ("Exception: ...") or a script that returned no JSON
  // at all ("EvalScript error.").
  function hostFailed(r) {
    return /^(Exception|Bad host result): /.test(r.message || "");
  }

  function countUsage(name, started, r) {
    if (!name) return;
    if (r.ok) usage.action(name, Date.now() - started);
    else if (hostFailed(r)) usage.error(name);
  }

  function runJob(job) {
    log("Job: " + job.action);
    var started = Date.now();
    csInterface.evalScript(hostCallFor(job), function (result) {
      var parsed = parseResult(result);
      postResult(job.id, parsed);
      countUsage(USAGE_JOBS[job.action], started, parsed);
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
    fetch(BASE + "/poll?app=animate&v=" + encodeURIComponent(hostVersion), { cache: "no-store" })
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
    csInterface.evalScript("zb_getActiveDocInfo({})", function (result) {
      var parsed = parseResult(result);
      var msg = parsed.message || (parsed.ok ? "ok" : "error");
      log("Test → " + msg, parsed.ok ? "ok" : "err");
      flash(msg, !parsed.ok);
    });
  });

  // Collapsed = one status row only. Ask the host to shrink/grow the panel to
  // match, so a closed log costs no screen space next to Animate's own panels.
  var COLLAPSED_H = 40, EXPANDED_H = 190;

  function setPanelHeight(h) {
    try { csInterface.resizeContent(window.innerWidth || 240, h); } catch (e) { /* docked: host owns size */ }
  }

  logBtn.addEventListener("click", function () {
    var open = logEl.className.indexOf("open") === -1;
    logEl.className = open ? "log open" : "log";
    logBtn.className = open ? "ico on" : "ico";
    logBtn.title = open ? "Hide log" : "Show log";
    setPanelHeight(open ? EXPANDED_H : COLLAPSED_H);
  });

  if (typeof fetch !== "function") {
    setConnected(false);
    stateEl.innerHTML = "<b>No fetch() in this CEP host</b>";
    return;
  }

  log("Panel started. Polling ZeusPack…");
  poll();
})();
