"""Rig + animate the Tripo megalodon and export a web-ready GLB.

blender -b --factory-startup --python tools/blender/rig_megalodon.py -- <in.glb> <out.glb> [preview_dir]

Input (Tripo, Blender Z-up): nose along +X, back +Z, length ~0.98.
Output: nose along glTF +Z (Blender -Y), bones Body/Head/Jaw/Tail1..4, clips "Swim" (48f loop @24fps)
and "JawOpen" (frame 0 closed -> 20 wide open = the modelled pose), empty "MouthPoint" on the Head bone.
All measurements below are in the ORIGINAL frame: f = forward (+X), z = up.
"""
import sys
import math
import os
import bpy
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, DST = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None

# --- anatomy (original frame) ---
NOSE_F = 0.49
NECK_F = 0.16          # Body -> Head joint (behind the gills)
SPINE = [0.0, -0.14, -0.26, -0.36, -0.49]  # Body->Tail1, Tail1->Tail2, ... , tail tip
HINGE = (0.229, -0.123)
JAW_TIP = (0.2836, -0.2286)
MOUTH = (0.29, -0.16)
BLEND = 0.035          # half-width of the weight blend at each spine joint
JAW_CLOSE_DEG = 66.0   # rotation that brings the modelled (open) jaw shut
TEX_SIZE = 2048
FPS = 24
SWIM_FRAMES = 48
JAW_FRAMES = 20


def P(f, z, lat=0.0):
    """original (f, lat, z) -> rotated Blender coords (nose along -Y)."""
    return Vector((lat, -f, z))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)
mesh_obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
mesh_obj.name = "Megalodon"
me = mesh_obj.data
# bake object transform into the data, then read original-frame coords
me.transform(mesh_obj.matrix_world)
mesh_obj.matrix_world = Matrix.Identity(4)
orig = [(v.co.x, v.co.y, v.co.z) for v in me.vertices]
me.transform(Matrix.Rotation(-math.pi / 2, 4, "Z"))  # nose +X -> -Y (glTF +Z)
me.update()

# --- armature ---
arm_data = bpy.data.armatures.new("SharkRig")
arm = bpy.data.objects.new("SharkRig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head = head
    b.tail = tail
    b.align_roll(Vector((0, 0, 1)))
    if parent:
        b.parent = eb[parent]
        b.use_connect = False
    return b


bone("Body", P(NECK_F, 0), P(SPINE[0], 0))
bone("Head", P(NECK_F, 0), P(NOSE_F, 0), "Body")
bone("Jaw", P(*HINGE), P(*JAW_TIP), "Head")
tails = ["Tail1", "Tail2", "Tail3", "Tail4"]
prev = "Body"
for i, name in enumerate(tails):
    bone(name, P(SPINE[i], 0), P(SPINE[i + 1], 0), prev)
    prev = name
bpy.ops.object.mode_set(mode="OBJECT")

# --- weights (procedural, along the body axis + a lower-jaw region) ---
# spine segments front->back: Head | Body | Tail1 | Tail2 | Tail3 | Tail4, joints between them
chain = ["Head", "Body"] + tails
joints = [NECK_F] + SPINE[:-1]
groups = {n: mesh_obj.vertex_groups.new(name=n) for n in chain + ["Jaw"]}
hx, hz = HINGE
dl = Vector((JAW_TIP[0] - hx, JAW_TIP[1] - hz)).normalized()
du = Vector((0.14, 0.031)).normalized()          # upper jaw line from the hinge
bis = (dl + du).normalized()                      # separation line through the gape
jaw_count = 0
for vi, (x, y, z) in enumerate(orig):
    w = {}
    # which segment / blend with the neighbour across the nearest joint
    seg = len(joints)
    for j, jf in enumerate(joints):
        if x > jf:
            seg = j
            break
    w[chain[seg]] = 1.0
    for j, jf in enumerate(joints):
        if abs(x - jf) < BLEND:
            t = smooth(jf + BLEND, jf - BLEND, x)  # 0 in front, 1 behind
            w = {chain[j]: 1 - t, chain[j + 1]: t}
            break
    # lower jaw: below the gape bisector, fading out behind the hinge
    rx, rz = x - hx, z - hz
    side = bis.x * rz - bis.y * rx                # >0 above the line
    wj = smooth(0.004, -0.004, side) * smooth(hx - 0.06, hx - 0.005, x)
    if wj > 0:
        jaw_count += 1
        w = {k: v * (1 - wj) for k, v in w.items()}
        w["Jaw"] = wj
    for k, v in w.items():
        if v > 1e-4:
            groups[k].add([vi], v, "REPLACE")
print("jaw vertices", jaw_count, "of", len(orig))

mesh_obj.parent = arm
mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
mod.object = arm

# --- MouthPoint on the Head bone ---
mouth = bpy.data.objects.new("MouthPoint", None)
mouth.empty_display_size = 0.03
bpy.context.scene.collection.objects.link(mouth)
mouth.parent = arm
mouth.parent_type = "BONE"
mouth.parent_bone = "Head"
bpy.context.view_layer.update()
mouth.matrix_world = Matrix.Translation(P(*MOUTH))

# --- animation ---
arm.animation_data_create()
pb = arm.pose.bones
for p in pb:
    p.rotation_mode = "QUATERNION"


def world_axis_rot(pbone, axis, angle):
    """Rotation about a world axis expressed in the bone's rest-local frame."""
    rest = pbone.bone.matrix_local.to_3x3()
    local_axis = (rest.inverted() @ axis).normalized()
    return Quaternion(local_axis, angle)


UP = Vector((0, 0, 1))
LAT = Vector((1, 0, 0))

swim = bpy.data.actions.new("Swim")
swim.use_fake_user = True
arm.animation_data.action = swim
amp = {"Head": 0.05, "Body": 0.0, "Tail1": 0.07, "Tail2": 0.11, "Tail3": 0.15, "Tail4": 0.21}
phase = {"Head": math.pi + 0.3, "Body": 0.0, "Tail1": -0.7, "Tail2": -1.4, "Tail3": -2.1, "Tail4": -2.8}
for f in range(0, SWIM_FRAMES + 1, 2):
    ph = 2 * math.pi * f / SWIM_FRAMES
    for n in chain:
        p = pb[n]
        p.rotation_quaternion = world_axis_rot(p, UP, amp[n] * math.sin(ph + phase[n]))
        p.keyframe_insert("rotation_quaternion", frame=f)

jaw = bpy.data.actions.new("JawOpen")
jaw.use_fake_user = True
for n in chain:
    pb[n].rotation_quaternion = Quaternion()
arm.animation_data.action = jaw
# lifting the lower jaw toward the snout = rotation about the lateral axis
close = world_axis_rot(pb["Jaw"], LAT, -math.radians(JAW_CLOSE_DEG))
pb["Jaw"].rotation_quaternion = close
pb["Jaw"].keyframe_insert("rotation_quaternion", frame=0)
pb["Jaw"].rotation_quaternion = Quaternion()
pb["Jaw"].keyframe_insert("rotation_quaternion", frame=JAW_FRAMES)


def set_linear(action):
    for fc in getattr(action, "fcurves", []):
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for k in fc.keyframe_points:
                        k.interpolation = "LINEAR"


set_linear(jaw)

# --- textures: 4096 -> TEX_SIZE ---
for img in bpy.data.images:
    if img.size[0] > TEX_SIZE:
        img.scale(TEX_SIZE, TEX_SIZE)
        img.pack()

# --- previews ---
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.world = bpy.data.worlds.new("w")
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def shot(name, loc, rot, scale):
        cam.location = loc
        cam.rotation_euler = rot
        cam_data.ortho_scale = scale
        scene.render.filepath = os.path.join(PREVIEW, name + ".png")
        bpy.ops.render.render(write_still=True)

    side_head = (P(0.27, -0.12) + Vector((5, 0, 0)), (math.pi / 2, 0, math.pi / 2), 0.45)
    front = (P(3, -0.05), (math.pi / 2, 0, 0), 0.7)
    for fr in (0, 8, JAW_FRAMES):
        arm.animation_data.action = jaw
        scene.frame_set(fr)
        shot(f"jaw_side_{fr}", *side_head)
        shot(f"jaw_front_{fr}", *front)
    arm.animation_data.action = swim
    for fr in (0, 12, 24, 36):
        scene.frame_set(fr)
        shot(f"swim_top_{fr}", Vector((0, 0, 5)), (0, 0, 0), 1.1)
    arm.animation_data.action = None
    scene.frame_set(0)

# --- export ---
arm.animation_data.action = None
for p in pb:
    p.rotation_quaternion = Quaternion()
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
opts = dict(
    filepath=DST,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_image_format="WEBP",
    export_image_quality=86,
    export_optimize_animation_keep_anim_armature=False,
    export_def_bones=False,
    export_yup=True,
    export_apply=False,
)
opts = {k: v for k, v in opts.items() if k == "filepath" or k in props}
print("export opts", sorted(opts.keys()))
bpy.ops.export_scene.gltf(**opts)
print("EXPORTED", DST)
