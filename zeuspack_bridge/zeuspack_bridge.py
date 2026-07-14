# ============================================================
# ZeusPack Bridge — Blender Addon
# Install: Edit > Preferences > Add-ons > Install > pilih file ini
# ============================================================

bl_info = {
    "name":        "ZeusPack Bridge",
    "author":      "ZeusDev - Tegar",
    "version":     (0, 8, 0),
    "blender":     (3, 0, 0),
    "location":    "View3D > Sidebar > ZeusPack",
    "description": "Bridge between ZeusPack and Blender for appending collections",
    "category":    "Import-Export",
}

import bpy
import threading
import json
import os
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT_RANGE_START = 7334
PORT_RANGE_END   = 7344  # scan 10 port (7334–7343)

# Port yang berhasil digunakan instance ini
_active_port = None

# ─── TEMP SCENE HELPER ────────────────────────────────────────
# Shared by the "Create Scene" button AND the /link endpoint, so linking a
# character always lands in the same Temporary scene the button manages.
TEMP_SCENE_NAME = "Temporary"
MAIN_SCENE_NAME = "Scene"


def ensure_temp_scene(context):
    """Create the 'Temporary' scene if it doesn't exist yet, then make it the
    active scene. If it already exists, just switches to it (idempotent)."""
    scene = bpy.data.scenes.get(TEMP_SCENE_NAME)
    if scene is None:
        scene = bpy.data.scenes.new(TEMP_SCENE_NAME)
    context.window.scene = scene
    return scene

# ─── CARI PORT KOSONG ─────────────────────────────────────────
def find_free_port():
    for port in range(PORT_RANGE_START, PORT_RANGE_END):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('localhost', port))
                return port  # port ini kosong, pakai ini
            except OSError:
                continue    # port terpakai, coba berikutnya
    return None

# ─── HTTP HANDLER ─────────────────────────────────────────────
class ZeusHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # suppress log

    def send_json(self, code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type',   'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        # GET /ping
        if parsed.path == '/ping':
            self.send_json(200, {
                "status":  "ok",
                "port":    _active_port,
                "blender": bpy.app.version_string,
                "file":    bpy.data.filepath or None,
            })
            return

        # GET /collections?file=<path>
        if parsed.path == '/collections':
            params   = parse_qs(parsed.query)
            filepath = params.get('file', [None])[0]

            if not filepath or not os.path.exists(filepath):
                self.send_json(404, {"error": f"File tidak ditemukan: {filepath}"})
                return
            try:
                with bpy.data.libraries.load(filepath, link=False) as (src, _):
                    collections = list(src.collections)
                self.send_json(200, {"file": filepath, "collections": collections})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/append':
            length = int(self.headers.get('Content-Length', 0))
            body   = self.rfile.read(length)
            try:
                data       = json.loads(body)
                filepath   = data.get('file')
                collection = data.get('collection')

                if not filepath or not os.path.exists(filepath):
                    self.send_json(404, {"error": f"File tidak ditemukan: {filepath}"})
                    return
                if not collection:
                    self.send_json(400, {"error": "collection wajib diisi"})
                    return

                result = {"success": False, "error": "Timeout"}
                done   = threading.Event()

                def run_in_main():
                    try:
                        directory = os.path.join(filepath, "Collection") + os.sep
                        bpy.ops.wm.append(
                            filepath             = os.path.join(filepath, "Collection", collection),
                            directory            = directory,
                            filename             = collection,
                            link                 = False,
                            instance_collections = False,
                        )
                        result["success"] = True
                        result.pop("error", None)
                        print(f"[ZeusPack] Appended '{collection}' from {filepath}")
                    except Exception as e:
                        result["error"] = str(e)
                    finally:
                        done.set()
                    return None

                bpy.app.timers.register(run_in_main, first_interval=0.0)
                done.wait(timeout=10)

                if result["success"]:
                    self.send_json(200, {"success": True, "collection": collection, "file": filepath})
                else:
                    self.send_json(500, {"error": result.get("error", "Unknown error")})

            except json.JSONDecodeError:
                self.send_json(400, {"error": "Invalid JSON"})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if parsed.path == '/link':
            length = int(self.headers.get('Content-Length', 0))
            body   = self.rfile.read(length)
            try:
                data       = json.loads(body)
                filepath   = data.get('file')
                collection = data.get('collection')

                if not filepath or not os.path.exists(filepath):
                    self.send_json(404, {"error": f"File tidak ditemukan: {filepath}"})
                    return
                if not collection:
                    self.send_json(400, {"error": "collection wajib diisi"})
                    return

                result = {"success": False, "error": "Timeout"}
                done   = threading.Event()

                def run_in_main():
                    try:
                        # Land the link in the Temporary scene — create it if it
                        # doesn't exist yet, otherwise just switch to it.
                        ensure_temp_scene(bpy.context)

                        with bpy.data.libraries.load(filepath, link=True) as (data_from, data_to):
                            if collection not in data_from.collections:
                                raise ValueError(f"Collection '{collection}' not found in {filepath}")
                            data_to.collections = [collection]

                        linked = data_to.collections[0]
                        if linked is None:
                            raise RuntimeError("Blender did not return the linked collection")

                        # Link into the (now-active Temporary) scene's root
                        # collection. Skip if already linked (idempotent on retry).
                        scene_root = bpy.context.scene.collection
                        if linked.name not in scene_root.children.keys():
                            scene_root.children.link(linked)

                        result["success"] = True
                        result.pop("error", None)
                        print(f"[ZeusPack] Linked '{collection}' from {filepath} into '{TEMP_SCENE_NAME}'")
                    except Exception as e:
                        result["error"] = str(e)
                    finally:
                        done.set()
                    return None

                bpy.app.timers.register(run_in_main, first_interval=0.0)
                done.wait(timeout=10)

                if result["success"]:
                    self.send_json(200, {"success": True, "collection": collection, "file": filepath})
                else:
                    self.send_json(500, {"error": result.get("error", "Unknown error")})

            except json.JSONDecodeError:
                self.send_json(400, {"error": "Invalid JSON"})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        self.send_json(404, {"error": "Not found"})


# ─── SERVER MANAGEMENT ────────────────────────────────────────
_server        = None
_server_thread = None

def start_server():
    global _server, _server_thread, _active_port

    if _server is not None:
        return

    port = find_free_port()
    if port is None:
        print(f"[ZeusPack] Tidak ada port kosong di range {PORT_RANGE_START}–{PORT_RANGE_END}")
        return

    try:
        _server      = HTTPServer(('localhost', port), ZeusHandler)
        _active_port = port
        _server_thread = threading.Thread(target=_server.serve_forever, daemon=True)
        _server_thread.start()
        print(f"[ZeusPack] Bridge running on port {port}")
    except OSError as e:
        print(f"[ZeusPack] Gagal start server: {e}")
        _server = None

def stop_server():
    global _server, _server_thread, _active_port
    if _server:
        _server.shutdown()
        _server        = None
        _server_thread = None
        _active_port   = None
        print("[ZeusPack] Bridge stopped")


# ─── SCENE OPERATORS ──────────────────────────────────────────
class ZEUS_OT_create_temp_scene(bpy.types.Operator):
    """Create (or switch to) a scene named 'Temporary'"""
    bl_idname  = "zeus.create_temp_scene"
    bl_label   = "Create Temporary Scene"
    bl_options = {'REGISTER'}

    def execute(self, context):
        ensure_temp_scene(context)
        self.report({'INFO'}, f"Switched to '{TEMP_SCENE_NAME}' scene")
        return {'FINISHED'}


class ZEUS_OT_delete_temp_scene(bpy.types.Operator):
    """Delete the 'Temporary' scene and switch back to 'Scene'"""
    bl_idname  = "zeus.delete_temp_scene"
    bl_label   = "Delete Temporary Scene"
    bl_options = {'REGISTER'}

    def execute(self, context):
        temp = bpy.data.scenes.get(TEMP_SCENE_NAME)
        if temp is None:
            self.report({'WARNING'}, f"No '{TEMP_SCENE_NAME}' scene to delete")
            return {'CANCELLED'}

        # Prefer switching to the scene literally named "Scene"; otherwise any
        # remaining scene — Blender cannot delete the last/active scene.
        target = bpy.data.scenes.get(MAIN_SCENE_NAME)
        if target is None or target == temp:
            others = [s for s in bpy.data.scenes if s != temp]
            if not others:
                self.report({'ERROR'}, "Cannot delete the only remaining scene")
                return {'CANCELLED'}
            target = others[0]

        context.window.scene = target          # leave Temporary before removing it
        bpy.data.scenes.remove(temp)
        self.report({'INFO'}, f"Deleted '{TEMP_SCENE_NAME}', switched to '{target.name}'")
        return {'FINISHED'}


# ─── PANEL ────────────────────────────────────────────────────
class ZEUS_PT_status(bpy.types.Panel):
    bl_label       = "Bridge Status"
    bl_idname      = "ZEUS_PT_status"
    bl_space_type  = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category    = 'Bridge - ZeusPack'

    def draw(self, context):
        layout = self.layout
        if _server is not None:
            layout.label(text=f"Bridge: Port {_active_port}", icon='CHECKMARK')
        else:
            layout.label(text="Bridge: Off", icon='X')

        layout.separator()
        layout.label(text="Temp Scene:")
        col = layout.column(align=True)
        col.operator("zeus.create_temp_scene", text="Create Scene", icon='ADD')
        col.operator("zeus.delete_temp_scene", text="Delete Scene", icon='TRASH')


# ─── REGISTER ─────────────────────────────────────────────────
_classes = (
    ZEUS_OT_create_temp_scene,
    ZEUS_OT_delete_temp_scene,
    ZEUS_PT_status, 
)

def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    start_server()

def unregister():
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
    stop_server()

if __name__ == "__main__":
    register()
