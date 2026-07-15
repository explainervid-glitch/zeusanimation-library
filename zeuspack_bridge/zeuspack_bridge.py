# ============================================================
# ZeusPack Bridge — Blender Addon
# Install: Edit > Preferences > Add-ons > Install > pilih file ini
# ============================================================

bl_info = {
    "name":        "ZeusPack Bridge",
    "author":      "ZeusDev - Tegar",
    "version":     (0, 9, 6),
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
                        # Optionally land the append in the Temporary scene — used
                        # by the character "Append to project" flow so it mirrors
                        # /link. Omitted by the animation append (current scene).
                        if data.get('temp_scene', False):
                            ensure_temp_scene(bpy.context)
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


def _find_collection_parent(col):
    """Search every scene's collection tree for the direct parent of `col`.
    Returns (parent_collection, owning_scene) or (None, None) if not found."""
    for scene in bpy.data.scenes:
        def search(c):
            if col.name in c.children.keys():
                return c
            for child in c.children:
                found = search(child)
                if found is not None:
                    return found
            return None
        parent = search(scene.collection)
        if parent is not None:
            return parent, scene
    return None, None


def _collect_all_objects(col, seen=None):
    """Recursively gather every object in `col` and its nested sub-collections."""
    if seen is None:
        seen = set()
    objs = []
    for o in col.objects:
        if o.name not in seen:
            seen.add(o.name)
            objs.append(o)
    for child in col.children:
        objs.extend(_collect_all_objects(child, seen))
    return objs


def _snap_collection_to_cursor(col, target_scene):
    """Move the top-level (parentless) object(s) inside `col` so the
    collection lands at the *target scene's* 3D cursor (each Scene keeps
    its own independent cursor — we deliberately do NOT use context.scene,
    since that may still be the scene the user is switching FROM),
    preserving relative offsets if there's more than one root object."""
    all_objs = _collect_all_objects(col)
    roots = [o for o in all_objs if o.parent is None]
    if not roots:
        return False

    cursor_loc = target_scene.cursor.location
    anchor = roots[0]
    delta = cursor_loc - anchor.location.copy()
    for o in roots:
        o.location = o.location + delta
    return True


class ZEUS_OT_move_to_main_scene(bpy.types.Operator):
    """Move the currently selected/active Outliner collection into the
    main 'Scene', unlinking it from wherever it currently lives (works for
    plain collections and library-override collections alike)"""
    bl_idname  = "zeus.move_to_main_scene"
    bl_label   = "Move to Main Scene"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        col = context.collection

        main_scene = bpy.data.scenes.get(MAIN_SCENE_NAME)
        if main_scene is None:
            self.report({'ERROR'}, f"Scene '{MAIN_SCENE_NAME}' not found")
            return {'CANCELLED'}

        if col is None or col == main_scene.collection:
            self.report({'ERROR'}, "Select a collection in the Outliner first")
            return {'CANCELLED'}

        parent, parent_scene = _find_collection_parent(col)
        if parent is None:
            self.report({'WARNING'}, f"Could not find current parent of '{col.name}'")
            return {'CANCELLED'}

        if parent == main_scene.collection and parent_scene == main_scene:
            self.report({'INFO'}, f"'{col.name}' is already in '{MAIN_SCENE_NAME}'")
            return {'CANCELLED'}

        main_scene.collection.children.link(col)
        parent.children.unlink(col)

        snapped = _snap_collection_to_cursor(col, main_scene)

        # Switch the active scene to the target now that the collection has
        # actually landed there — lets you see the result immediately instead
        # of staying on the (now empty, for this collection) source scene.
        context.window.scene = main_scene

        if snapped:
            self.report({'INFO'}, f"Moved '{col.name}' to '{MAIN_SCENE_NAME}' at 3D cursor, switched scene")
        else:
            self.report({'INFO'}, f"Moved '{col.name}' to '{MAIN_SCENE_NAME}' (no root object found to snap), switched scene")
        return {'FINISHED'}


class ZEUS_OT_delete_temp_scene(bpy.types.Operator):
    """Delete the 'Temporary' scene, switch back to 'Scene', and purge all
    unused (orphan) data left behind"""
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

        # Purge orphan data left behind. Multiple passes because purging can
        # cascade (e.g. freeing a collection frees meshes, which frees images).
        for _ in range(3):
            bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

        self.report({'INFO'}, f"Deleted '{TEMP_SCENE_NAME}', purged unused data, switched to '{target.name}'")
        return {'FINISHED'}


class ZEUS_OT_localize(bpy.types.Operator):
    """Make the selection local — breaks the library link so it can be edited
    here. Works on the selected object(s) + their child hierarchy, OR on the
    active Outliner collection + everything inside it (objects, sub-collections,
    and their data-blocks)."""
    bl_idname  = "zeus.localize"
    bl_label   = "Localize Selected"
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        if context.selected_objects:
            return True
        # Also enable when a real (non-master) collection is active/selected.
        col = context.collection
        return col is not None and col != context.scene.collection

    @staticmethod
    def _make_objects_local(context, objs):
        """Select the objects that are in the view layer, then make them + their
        data + materials local (the operator handles collection housekeeping)."""
        selected = []
        for o in objs:
            try:
                o.select_set(True)
                selected.append(o)
            except RuntimeError:
                pass  # not in the active view layer — skip it
        if not selected:
            return 0
        if context.view_layer.objects.active not in selected:
            context.view_layer.objects.active = selected[0]
        try:
            bpy.ops.object.make_local(type='SELECT_OBDATA_MATERIAL')
        except RuntimeError:
            pass
        return len(selected)

    def execute(self, context):
        active_col    = context.collection
        is_collection = active_col is not None and active_col != context.scene.collection

        if is_collection:
            # ── Collection mode: the collection + its whole tree ──
            cols, objs = [], []
            seen_c, seen_o = set(), set()

            def walk(c):
                if c.name in seen_c:
                    return
                seen_c.add(c.name)
                cols.append(c)
                for o in c.objects:
                    if o.name not in seen_o:
                        seen_o.add(o.name)
                        objs.append(o)
                for ch in c.children:
                    walk(ch)

            walk(active_col)

            # 1) Make the collection data-blocks themselves local first, so the
            #    containers are local before their contents get localized.
            for c in cols:
                if c.library is not None:
                    try:
                        c.make_local()
                    except Exception:
                        pass

            # 2) Make the objects (+ data + materials) inside them local.
            n = self._make_objects_local(context, objs)
            self.report({'INFO'}, f"Localized collection '{active_col.name}' ({n} object(s))")
            return {'FINISHED'}

        # ── Object mode: selected objects + their full child hierarchy ──
        roots = list(context.selected_objects)
        if not roots:
            self.report({'WARNING'}, "Select an object or a collection first")
            return {'CANCELLED'}

        objs, seen, stack = [], set(), list(roots)
        while stack:
            o = stack.pop()
            if o.name in seen:
                continue
            seen.add(o.name)
            objs.append(o)
            for child in o.children:
                stack.append(child)

        n = self._make_objects_local(context, objs)
        self.report({'INFO'}, f"Localized {n} object(s) + data")
        return {'FINISHED'}


# ─── PANEL ────────────────────────────────────────────────────
class ZEUS_PT_status(bpy.types.Panel):
    bl_label       = "Bridge"
    bl_idname      = "ZEUS_PT_status"
    bl_space_type  = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category    = 'ZeusPack - Bridge'

    def draw(self, context):
        layout = self.layout
        if _server is not None:
            layout.label(text=f"Bridge: Port {_active_port}", icon='CHECKMARK')
        else:
            layout.label(text="Bridge: Off", icon='X')

        layout.separator()
        layout.label(text="Temp Scene:")
        col = layout.column(align=True)
        col.operator("zeus.create_temp_scene", text="Temporary Scene", icon='ADD')
        col.operator("zeus.move_to_main_scene", text="Move to Scene", icon='FORWARD')
        col.operator("zeus.delete_temp_scene", text="Delete Temporary Scene", icon='TRASH')

        layout.separator()
        layout.label(text="Selection:")
        layout.operator("zeus.localize", text="Localize", icon='UNLINKED')


# ─── OUTLINER CONTEXT MENU ─────────────────────────────────────
def draw_move_to_main_in_collection_menu(self, context):
    self.layout.separator()
    self.layout.operator("zeus.move_to_main_scene", text="Move to Main Scene", icon='FORWARD')
    self.layout.operator("zeus.delete_temp_scene", text="Delete Temporary Scene", icon='TRASH')


def draw_temp_scene_in_outliner_menu(self, context):
    # General Outliner right-click (no collection/object needed).
    self.layout.separator()
    self.layout.operator("zeus.create_temp_scene", text="Temporary Scene", icon='ADD')
    self.layout.operator("zeus.delete_temp_scene", text="Delete Temporary Scene", icon='TRASH')


# ─── REGISTER ─────────────────────────────────────────────────
_classes = (
    ZEUS_OT_create_temp_scene,
    ZEUS_OT_move_to_main_scene,
    ZEUS_OT_delete_temp_scene,
    ZEUS_OT_localize,
    ZEUS_PT_status,
)

def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    bpy.types.OUTLINER_MT_collection.append(draw_move_to_main_in_collection_menu)
    # General Outliner right-click menu (guarded — name may vary by version).
    if hasattr(bpy.types, "OUTLINER_MT_context_menu"):
        bpy.types.OUTLINER_MT_context_menu.append(draw_temp_scene_in_outliner_menu)
    start_server()

def unregister():
    if hasattr(bpy.types, "OUTLINER_MT_context_menu"):
        bpy.types.OUTLINER_MT_context_menu.remove(draw_temp_scene_in_outliner_menu)
    bpy.types.OUTLINER_MT_collection.remove(draw_move_to_main_in_collection_menu)
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
    stop_server()

if __name__ == "__main__":
    register()
