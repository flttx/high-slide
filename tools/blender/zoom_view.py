"""Zoomed orthographic side render (camera on -Y looking +Y) for measuring features.

blender -b --factory-startup --python tools/blender/zoom_view.py -- <in.glb> <out.png> <cx> <cz> <scale>
Pixel (px, py) of the 1024^2 output maps to x = cx + (px/1024 - .5)*scale, z = cz + (.5 - py/1024)*scale.
"""
import sys
import math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
cx, cz, scale = float(argv[2]), float(argv[3]), float(argv[4])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.world = bpy.data.worlds.new("w")
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = scale
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = Vector((cx, -5, cz))
cam.rotation_euler = (math.pi / 2, 0, 0)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
