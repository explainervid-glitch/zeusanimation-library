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

## Tools

| Tool | |
|---|---|
| `zeuspack_status` | Running? active pack, all packs, tagger/RAG reachability |
| `switch_pack` | Switch active pack by index |
| `get_asset_tree` | Full styles → types → categories hierarchy |
| `list_categories` / `list_assets` | Drill down |
| `search_assets` | Keyword search (SQLite FTS), scoped to a style type |
| `semantic_search` | Vector search via RAG — **requires `styleId`** |
| `read_asset` / `write_asset` | Asset JSON metadata |
| `auto_tag` | Run the vision tagger on one asset |
| `set_asset_preview` / `delete_asset` | |
| `list_styles` / `rename_style` / `set_style_hints` / `generate_style_guide` | |
| `add_category` / `delete_category` | |
| `rescan` / `reindex_rag` | Maintenance |

`write_asset` and `set_style_hints` **replace** their target wholesale — read
first, merge, then write, or you will drop fields.

## Security

- Bound to `127.0.0.1` only — never reachable off-machine.
- Every request needs a token, regenerated each app start and written to
  `%APPDATA%/zeusanimation-library/mcp-bridge.json`. Loopback alone doesn't
  authenticate; without this, any local process could POST `delete-category`.
- An allowlist in `src/main/bridge/index.js` caps what MCP can reach. Currently
  excluded: project writes (`send-to-project`, `create-project`,
  `delete-project-file`), modal dialogs (`select-folder`/`select-file`, which
  would hang a headless call), `save-settings`, `blender-*` (the Blender MCP
  covers that directly), and `open-path`/`open-asset-file`.

To widen the scope, add the channel to `ALLOWED` and expose a tool here.
