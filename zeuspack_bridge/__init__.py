# Blender reads bl_info by statically parsing THIS file, so it must be a
# literal here (not re-exported). The actual logic lives in zeuspack_bridge.py.
bl_info = {
    "name":        "ZeusPack Bridge",
    "author":      "ZeusDev - Tegar",
    "version":     (0, 9, 3),
    "blender":     (4, 0, 0),
    "location":    "View3D > Sidebar > Bridge - ZeusPack",
    "description": "Bridge between ZeusPack and Blender (append, temp scene tools)",
    "category":    "Import-Export",
}

from . import zeuspack_bridge


def register():
    zeuspack_bridge.register()


def unregister():
    zeuspack_bridge.unregister()
