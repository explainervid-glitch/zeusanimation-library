// ─── AUTO-ANSWER ANIMATE'S "Resolve Library Conflict" DIALOG ───
//
// WHY THIS EXISTS: the conflict dialog is a NATIVE MODAL. When clipPaste()
// raises it, the JSFL interpreter is blocked inside that call — it cannot run
// code to dismiss the dialog it is stuck behind. And we must NOT avoid the
// collision (pre-renaming would defeat the feature: "Don't replace" is what
// makes the movement dummy adopt the character's art). So the only way to
// answer it automatically is from OUTSIDE Animate, via Win32.
//
// Detection: enumerate visible top-level windows and match the title loosely
// ("resolve library conflict"). EnumWindows + substring beats FindWindow's
// exact match, which breaks on any wording/pluralization difference.
//
// NOTE (hard-won): in PowerShell you must pass [NullString]::Value — not $null
// — for a P/Invoke string parameter. $null marshals as "" and every Win32 call
// then fails with ERROR_INVALID_NAME (123).
//
// Windows-only and best-effort: any failure is swallowed and the user simply
// answers the dialog by hand, exactly as before.
import { spawn } from 'child_process'

const TITLE_MATCH = 'conflict'          // loose: "Resolve Library Conflict(s)"
const POLL_MS = 400

// One pass. Detection is layered, because Adobe dialogs don't reliably carry a
// descriptive title:
//   1. any visible window whose title contains "conflict"
//   2. else a visible window of the standard Win32 dialog class (#32770)
//      owned by the Animate process — i.e. a modal Animate just raised
// On a hit: focus that window and press Enter (accepts the default,
// "Don't replace existing items").
// Always prints a CANDIDATES line listing Animate-owned windows, so a miss
// tells us exactly what the dialog really is instead of failing silently.
const SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ZPWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<object[]> Visible() {
    var found = new List<object[]>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var tb = new StringBuilder(512); GetWindowTextW(h, tb, tb.Capacity);
      var cb = new StringBuilder(256); GetClassNameW(h, cb, cb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      found.Add(new object[]{ h, tb.ToString(), cb.ToString(), pid });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$animatePids = @(Get-Process -Name 'Animate' | Select-Object -ExpandProperty Id)
$all = [ZPWin]::Visible()

function Answer($h, $t) {
  [ZPWin]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output ('FOUND ' + $t)
}

# 1) title match
foreach ($w in $all) {
  $t = [string]$w[1]
  if ($t -and $t.ToLower().Contains('${TITLE_MATCH}')) { Answer ([IntPtr]$w[0]) $t; exit }
}
# 2) standard dialog class owned by Animate
foreach ($w in $all) {
  $cls = [string]$w[2]; $pid2 = [uint32]$w[3]
  if ($cls -eq '#32770' -and $animatePids -contains [int]$pid2) {
    Answer ([IntPtr]$w[0]) ('[#32770] ' + [string]$w[1]); exit
  }
}
# diagnostics: what DOES Animate have on screen right now?
$cand = @()
foreach ($w in $all) {
  $pid3 = [uint32]$w[3]
  if ($animatePids -contains [int]$pid3) { $cand += ('"' + [string]$w[1] + '" cls=' + [string]$w[2]) }
}
Write-Output ('CANDIDATES ' + ($cand -join ' | '))
`.trim()

function runOnce() {
  return new Promise((resolve) => {
    let out = ''
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true }
    )
    ps.stdout.on('data', (d) => { out += d.toString() })
    ps.on('error', () => resolve({ found: null, candidates: '' }))
    ps.on('close', () => {
      const f = out.match(/FOUND (.+)/)
      const c = out.match(/CANDIDATES (.*)/)
      resolve({ found: f ? f[1].trim() : null, candidates: c ? c[1].trim() : '' })
    })
    setTimeout(() => { try { ps.kill() } catch { /* already gone */ } }, 5000)
  })
}

// Poll until stopped. Returns stop() → { answered, lastCandidates }.
export function startDialogAutoAnswer() {
  if (process.platform !== 'win32') return { stop: () => ({ answered: 0, lastCandidates: '' }) }

  let stopped = false
  let answered = 0
  let lastCandidates = ''
  let loggedCandidates = false

  const loop = async () => {
    while (!stopped) {
      try {
        const r = await runOnce()
        if (r.found) {
          answered++
          console.log(`[AnimateBridge] Auto-answered dialog: "${r.found}" (Enter → Don't replace)`)
        } else if (r.candidates) {
          lastCandidates = r.candidates
          // Log Animate's on-screen windows once per run — if auto-answer never
          // fires, this line identifies the real dialog.
          if (!loggedCandidates) {
            loggedCandidates = true
            console.log(`[AnimateBridge] Animate windows seen: ${r.candidates}`)
          }
        }
      } catch { /* best-effort */ }
      if (stopped) break
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }
  loop()

  return { stop: () => { stopped = true; return { answered, lastCandidates } } }
}
