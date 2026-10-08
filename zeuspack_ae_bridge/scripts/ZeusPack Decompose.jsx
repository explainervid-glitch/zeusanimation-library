// ZeusPack Decompose — standalone launcher
// -----------------------------------------------------------------------------
// Runs the panel's zae_decompose on the selected precomp layer(s), so you can
// trigger Decompose without opening the ZeusPack panel — and bind it to a
// keyboard shortcut (After Effects 2024+: Edit > Keyboard Shortcuts, search for
// this script name, assign a key).
//
// Install: copy this file into After Effects' Scripts folder, e.g.
//   Windows: C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts
//   (or run it any time via File > Scripts > Run Script File…)
// Then it appears under File > Scripts > ZeusPack Decompose.jsx.
//
// It loads the SAME logic the panel uses (jsx/host.jsx from the installed CEP
// extension), so behaviour and updates stay in sync — nothing is duplicated.
// -----------------------------------------------------------------------------

#target aftereffects

(function () {
    // Set to true to also delete the emptied precomp from the Project panel
    // (only when nothing else still uses it), matching the panel's toggle.
    var DELETE_SOURCE = false;
    // Set to true to always show a summary popup; false = only warn on failure.
    var ALWAYS_REPORT = false;

    // Locate the installed panel's host.jsx. The installer drops the extension
    // under the per-user CEP extensions folder.
    function findHost() {
        var roots = [];
        try { roots.push(Folder.userData.fsName); } catch (e) {}      // %APPDATA%\Roaming
        try { roots.push(Folder.commonFiles.fsName + "/.."); } catch (e2) {}
        var rel = "/Adobe/CEP/extensions/zeuspack_ae_bridge/ae_bridge/jsx/host.jsx";
        for (var i = 0; i < roots.length; i++) {
            var f = new File(roots[i] + rel);
            if (f.exists) return f;
        }
        return null;
    }

    var hostFile = findHost();
    if (!hostFile) {
        alert("ZeusPack: host.jsx not found.\nInstall the ZeusPack AE panel first (run install.bat).");
        return;
    }

    try { $.evalFile(hostFile); } catch (eE) {
        alert("ZeusPack: failed to load host.jsx\n" + eE.toString());
        return;
    }
    if (typeof zae_decompose !== "function") {
        alert("ZeusPack: zae_decompose is unavailable in host.jsx.");
        return;
    }

    var raw = String(zae_decompose({ deleteSource: DELETE_SOURCE }));
    var ok = raw.indexOf('"ok":true') !== -1;

    // Pull the human message out of the JSON string without needing JSON.parse
    // (older ExtendScript has none).
    var msg = raw;
    var m = raw.match(/"message":"((?:\\.|[^"\\])*)"/);
    if (m) { msg = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n"); }

    if (!ok) alert("ZeusPack Decompose:\n" + msg);
    else if (ALWAYS_REPORT) alert("ZeusPack Decompose:\n" + msg);
})();
