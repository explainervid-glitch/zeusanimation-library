# zeuspack-mcp

MCP server that lets Claude drive a running ZeusPack instance — browse the
library, search it (keyword + semantic), and read/write asset metadata.

## How it works

```
Claude ──stdio──> zeuspack-mcp ──HTTP 127.0.0.1:8765──> Electron main ──> sql.js DB
                                                                     ──> scanner
                                                                     ──> tagger :8000
                                                                     ──> RAG :8001
```

This is the same shape as `zeuspack_bridge.py` on the Blender side, inverted:
there Blender hosts the HTTP server and ZeusPack calls in; here ZeusPack hosts
and the MCP server calls in.

The bridge (`src/main/bridge/index.js`) dispatches to the app's **existing IPC
handlers**. It captures them by wrapping `ipcMain.handle` rather than
restructuring `ipc/assets.js`, so the renderer path is untouched and both
transports always run the same function — they cannot drift.

**ZeusPack must be running.** There is no direct-DB fallback on purpose: the
library DB is sql.js and lives in the main process's memory, only reaching disk
on `saveDb()`. Reading `_zeuspack.db` externally while the app is open would
serve stale data.

## Setup

```bash
npm install --prefix mcp/zeuspack-mcp
```

`.mcp.json` in the repo root registers the server for Claude Code. For Claude
Desktop, add to its config:

```json
{
  "mcpServers": {
    "zeuspack": {
      "command": "node",
      "args": ["C:/01 Development/RAG Experiment/zeusanimation-library/mcp/zeuspack-mcp/index.js"]
    }
  }
}
```

## Team setup (deployed builds)

`npm run build` bundles this server into one file (`scripts/build-mcp.mjs`),
which ships in every build at `resources/mcp/zeuspack-mcp.mjs`. `npm run
release` also copies `zeuspack-mcp.cmd` to `W:\00 - ZEUSPACK\`. That launcher
reads `latest.txt` and runs the server with `zeuspack.exe` itself as the Node
runtime (`ELECTRON_RUN_AS_NODE=1`), so team PCs need no Node and no npm install.

**Claude Desktop needs no setup.** On every start ZeusPack writes its entry
into Claude Desktop's config (`src/main/mcpClaude.js`) — classic and Microsoft
Store installs both — touching only the `zeuspack` key and keeping a
`.zeuspack.bak` of the previous file. Teammates just restart Claude Desktop
once. Preferences → General → Claude Desktop shows the status and is the
opt-out: switching it off removes the entry and stops it being re-added.

Other clients (Cursor, VS Code, Gemini CLI…) take the same entry by hand:

```json
{
  "mcpServers": {
    "zeuspack": {
      "command": "cmd",
      "args": ["/c", "W:\\00 - ZEUSPACK\\zeuspack-mcp.cmd"]
    }
  }
}
```

The path never changes between releases. A running client keeps the version it
started with until it is restarted. Each PC drives its own running ZeusPack —
the bridge is loopback-only.

## Tools

| | Tool | |
|---|---|---|
| **Read** | `zeuspack_status` | Running? active pack, packs, template ids, tagger/RAG reachability |
| | `get_asset_tree` | styles → types → categories, with the ids other tools take |
| | `list_categories` / `list_assets` | Drill down |
| | `search_assets` | Keyword search (SQLite FTS), scoped to a style type |
| | `semantic_search` | Vector search via RAG — **requires `styleId`** |
| | `read_asset` / `list_styles` | Asset JSON, style names + tagger hints |
| | `view_preview` | The preview itself as an image — videos as a frame contact sheet |
| **Manage** | `write_asset` | Replace an asset's JSON and sync the keyword index |
| | `set_asset_preview` / `switch_pack` | |
| | `rename_style` / `set_style_hints` / `generate_style_guide` | |
| | `rescan` / `reindex_rag` | Maintenance |
| **Tag** | `auto_tag` | Image or video tagger by type, then syncs the index |
| **Create** | `create_style` | New style folders, optionally cloning categories |
| | `add_category` | New category in a style + type |
| | `create_asset` | New asset from the pack template + starter JSON |

**Delete is disabled.** No tool removes an asset, category or style, and the
bridge refuses `delete-asset` / `delete-category` / `rag-index-delete` even if
called directly. To re-enable, add them to `ALLOWED` and add tools here.

Tools take asset types as the tree shows them — `background | character |
animation | inspiration`. The app's folders call two of these `image` and
`movement`; tools translate, so callers never use the folder names.

`view_preview` lets any vision-capable client (Claude Desktop included) look
at an asset and tag it by hand, without the tagger server — listings only carry
paths, which most clients cannot open. It reads only files inside a configured
pack. Videos need ffmpeg: on PATH, or set `ZEUSPACK_FFMPEG` (and optionally
`ZEUSPACK_FFPROBE`) in the client's `env` block for this server.

Restarting ZeusPack rotates the bridge token; the server re-reads it and
retries once on its own, so no client restart is needed.

`write_asset` and `set_style_hints` **replace** their target wholesale — read
first, merge, then write, or you will drop fields. `semantic_search` sees new
tags only after `reindex_rag`, same as in the app.

## Security

- Bound to `127.0.0.1` only — never reachable off-machine.
- Every request needs a token, regenerated each app start and written to
  `%APPDATA%/zeusanimation-library/mcp-bridge.json`. Loopback alone doesn't
  authenticate; without this, any local process could POST `delete-category`.
- An allowlist in `src/main/bridge/index.js` caps what MCP can reach. Currently
  excluded: every delete, writes outside the library (`copy-asset-to`,
  `delete-project-file`), modal dialogs (`import-asset`, `select-folder`,
  `select-file` — they would hang a headless call), `save-settings`, the DCC
  bridges (`blender-*`, `ae-*`, `animate-*`), and anything that launches an
  external program (`add-asset`, `open-path`, `open-asset-file`).

To widen the scope, add the channel to `ALLOWED` and expose a tool here.
