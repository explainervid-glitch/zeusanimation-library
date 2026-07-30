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

  // Collapsed = one status row only. Ask the host to shrink/grow the panel to
  // match, so a closed log costs no screen space next to AE's own panels.
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
