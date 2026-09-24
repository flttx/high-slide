"""Inspect a GLB and render orthographic reference views.

blender -b --factory-startup --python tools/blender/inspect_glb.py -- <in.glb> <out_prefix>
"""
import sys
import math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, prefix = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in bpy.context.scene.objects:
    print("OBJ", o.name, o.type, "parent", o.parent.name if o.parent else None,
          "loc", tuple(round(v, 3) for v in o.location),
          "rot", tuple(round(v, 3) for v in o.rotation_euler),
          "scale", tuple(round(v, 3) for v in o.scale))
for o in meshes:
    me = o.data
    print("MESH", o.name, "verts", len(me.vertices), "faces", len(me.polygons), "mats", [m.name for m in me.materials])
    for v in me.vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
print("BBOX min", tuple(round(v, 3) for v in lo), "max", tuple(round(v, 3) for v in hi))
for img in bpy.data.images:
    print("IMG", img.name, tuple(img.size))

# ortho renders: side (look along -X), top (look down -Z), front (look along -Y) in Blender Z-up
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.film_transparent = False
world = bpy.data.worlds.new("w")
scene.world = world
centre = (lo + hi) / 2
size = max(hi - lo) * 1.1
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
views = {
    "px": (Vector((1, 0, 0)), (math.pi / 2, 0, math.pi / 2)),
    "nx": (Vector((-1, 0, 0)), (math.pi / 2, 0, -math.pi / 2)),
    "top": (Vector((0, 0, 1)), (0, 0, 0)),
    "py": (Vector((0, 1, 0)), (math.pi / 2, 0, math.pi)),
    "ny": (Vector((0, -1, 0)), (math.pi / 2, 0, 0)),
}
for name, (d, rot) in views.items():
    cam.location = centre + d * size * 2
    cam.rotation_euler = rot
    scene.render.filepath = f"{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)
print("DONE")
