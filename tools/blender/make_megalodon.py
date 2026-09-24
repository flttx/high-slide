"""
Procedurally build, rig, animate and export a menacing megalodon (giant shark)
for a Three.js game, as public/models/megalodon.glb.

Run headless:
  blender -b --factory-startup --python tools/blender/make_megalodon.py

Coordinate convention used throughout this script (Blender, Z-up):
  - Y axis  = body long axis. Nose tip at Y = -8, tail tip at Y = +8 (16 m).
  - Z axis  = dorso-ventral. Back/dorsal fin = +Z, belly = -Z.
  - X axis  = left/right.
On glTF export (+Y up) this becomes: nose -> +Z, back -> +Y, matching the
game's requirement (three.js / Y-up).
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

LENGTH = 16.0
NOSE_Y = -LENGTH / 2.0     # -8.0
TAIL_Y = LENGTH / 2.0      # +8.0
N_SEG = 32                 # ring segments
FPS = 30

BLEND_ROOT = os.path.dirname(os.path.abspath(bpy.data.filepath)) if bpy.data.filepath else None
REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(REPO_ROOT, "public", "models")
OUT_GLB = os.path.join(OUT_DIR, "megalodon.glb")
PREVIEW_DIR = os.path.join(REPO_ROOT, "tools", "blender")

# Body cross-section profile control points: (distance_from_nose_m, half_top, half_bottom, half_width)
BODY_CONTROL = [
    (0.00, 0.03, 0.03, 0.03),
    (0.30, 0.22, 0.18, 0.24),
    (0.70, 0.38, 0.24, 0.40),
    (1.20, 0.60, 0.35, 0.95),
    (2.00, 0.85, 0.40, 1.30),
    (3.00, 1.05, 0.50, 1.55),
    (3.80, 1.20, 0.70, 1.65),
    (4.60, 1.35, 0.95, 1.60),
    (5.60, 1.65, 1.25, 1.50),
    (6.30, 1.90, 1.50, 1.50),
    (7.20, 1.80, 1.40, 1.35),
    (8.00, 1.55, 1.15, 1.20),
    (9.50, 1.30, 0.95, 1.00),
    (11.00, 1.00, 0.75, 0.78),
    (12.50, 0.65, 0.50, 0.52),
    (13.80, 0.38, 0.30, 0.30),
    (14.60, 0.26, 0.20, 0.20),
    (15.30, 0.12, 0.10, 0.09),
    (16.00, 0.03, 0.03, 0.02),
]

MOUTH_FRONT_D = 1.05   # distance from nose to front of mouth opening
HINGE_D = 3.85         # distance from nose to jaw hinge
HINGE_Y = NOSE_Y + HINGE_D
MOUTH_FRONT_Y = NOSE_Y + MOUTH_FRONT_D

# Spine bone "stations" used for smooth position based skinning of the main body mesh.
# (bone_name, absolute Y position of representative point)
STATIONS = [
    ("Head", -4.2),
    ("Spine1", 0.665),
    ("Spine2", 2.00),
    ("Spine3", 3.33),
    ("Spine4", 4.665),
    ("Spine5", 6.00),
    ("Tail", 7.50),
]

SKIN_DARK = (0.227, 0.271, 0.314)      # #3a4550
SKIN_LIGHT = (0.910, 0.902, 0.875)     # #e8e6df
GUM_DARK = (0.353, 0.063, 0.082)       # #5a1015
GUM_PINK = (0.627, 0.251, 0.290)       # #a0404a
TOOTH_COLOR = (0.949, 0.925, 0.847)    # #f2ecd8


# ---------------------------------------------------------------------------
# small math helpers
# ---------------------------------------------------------------------------

def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def lerp(a, b, t):
    return a + (b - a) * t


def catmull_rom(keys_x, keys_y, x):
    """Catmull-Rom spline through sorted (keys_x[i], keys_y[i])."""
    n = len(keys_x)
    if x <= keys_x[0]:
        return keys_y[0]
    if x >= keys_x[-1]:
        return keys_y[-1]
    i = 0
    while i < n - 2 and x > keys_x[i + 1]:
        i += 1
    x0, x1, x2, x3 = (keys_x[max(i - 1, 0)], keys_x[i], keys_x[i + 1], keys_x[min(i + 2, n - 1)])
    y0, y1, y2, y3 = (keys_y[max(i - 1, 0)], keys_y[i], keys_y[i + 1], keys_y[min(i + 2, n - 1)])
    seg = x1_ = keys_x[i + 1] - keys_x[i]
    t = (x - keys_x[i]) / seg if seg > 1e-9 else 0.0
    t2 = t * t
    t3 = t2 * t
    m1 = (y2 - y0) / 2.0
    m2 = (y3 - y1) / 2.0
    h00 = 2 * t3 - 3 * t2 + 1
    h10 = t3 - 2 * t2 + t
    h01 = -2 * t3 + 3 * t2
    h11 = t3 - t2
    return h00 * y1 + h10 * m1 + h01 * y2 + h11 * m2


def iter_action_fcurves(action):
    """Blender 5.x layered/slotted actions: fcurves live under
    action.layers[*].strips[*].channelbags[*].fcurves."""
    for layer in action.layers:
        for strip in layer.strips:
            if strip.type != 'KEYFRAME':
                continue
            for cbag in strip.channelbags:
                for fc in cbag.fcurves:
                    yield fc


def hash01(x, y, z):
    v = math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
    return v - math.floor(v)


def body_profile(y_abs):
    """Return (half_top, half_bottom, half_width) at absolute Y position."""
    d = y_abs - NOSE_Y
    xs = [c[0] for c in BODY_CONTROL]
    ht = catmull_rom(xs, [c[1] for c in BODY_CONTROL], d)
    hb = catmull_rom(xs, [c[2] for c in BODY_CONTROL], d)
    w = catmull_rom(xs, [c[3] for c in BODY_CONTROL], d)
    return max(ht, 0.01), max(hb, 0.01), max(w, 0.01)


def surf_point(y, theta_deg, side=1):
    """A point ON the main body surface at absolute Y and angle theta_deg
    (0=equator/rightmost, 90=dorsal/top, -90=ventral/bottom). Used so fins
    always attach exactly to the actual hull, regardless of profile tuning."""
    ht, hb, w = body_profile(y)
    theta = math.radians(theta_deg)
    ct, st = math.cos(theta), math.sin(theta)
    r = ht if st >= 0 else hb
    return Vector((side * w * ct, y, r * st))


def egg_ring(center, ht, hb, w, nseg=N_SEG, theta0=0.0, theta1=2 * math.pi):
    """Ring of points around an 'egg' cross-section (different top/bottom radius)."""
    pts = []
    n = nseg if theta1 - theta0 >= 2 * math.pi - 1e-6 else nseg
    count = nseg + 1 if theta1 - theta0 < 2 * math.pi - 1e-6 else nseg
    for i in range(count):
        theta = theta0 + (theta1 - theta0) * i / nseg
        ct = math.cos(theta)
        st = math.sin(theta)
        r = ht if st >= 0 else hb
        pts.append(Vector((w * ct, center.y, center.z + r * st)))
    return pts


# ---------------------------------------------------------------------------
# scene cleanup
# ---------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                 bpy.data.actions, bpy.data.images):
        for block in list(coll):
            block.user_clear()
    bpy.ops.outliner.orphans_purge(do_recursive=True)


# ---------------------------------------------------------------------------
# generic geometry builders (appended straight into a shared bmesh)
# ---------------------------------------------------------------------------

def add_solid_from_outline(bm, outline, normal_axis, thickness):
    """Solidify a flat (possibly non-convex/star-shaped) polygon outline into a
    thin closed manifold prism. Caps are triangle fans from the centroid
    (robust for star-shaped outlines, unlike a single n-gon)."""
    n = len(outline)
    off = normal_axis.normalized() * (thickness / 2.0)
    centroid = sum(outline, Vector((0, 0, 0))) / n
    fv = [bm.verts.new(p + off) for p in outline]
    bv = [bm.verts.new(p - off) for p in outline]
    fc = bm.verts.new(centroid + off)
    bc = bm.verts.new(centroid - off)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([fv[i], fv[j], fc])
        bm.faces.new([bc, bv[j], bv[i]])
        bm.faces.new([fv[i], fv[j], bv[j], bv[i]])
    return fv + bv + [fc, bc]


def add_cone_tooth(bm, base_center, direction, base_radius, height, segs=6):
    """A simple cone (tooth) with its apex pointing along `direction`."""
    direction = direction.normalized()
    up_hint = Vector((0, 0, 1)) if abs(direction.z) < 0.9 else Vector((1, 0, 0))
    tangent = up_hint.cross(direction).normalized()
    bitangent = direction.cross(tangent).normalized()
    base_verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        p = base_center + tangent * (base_radius * math.cos(a)) + bitangent * (base_radius * math.sin(a))
        base_verts.append(bm.verts.new(p))
    apex = bm.verts.new(base_center + direction * height)
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new([base_verts[i], base_verts[j], apex])
    bm.faces.new(list(reversed(base_verts)))
    return base_verts + [apex]


def build_body_loft(bm, y0, y1, n_rings, profile_fn, extra_cap_start=True, extra_cap_end=True):
    """Loft rings of egg cross-sections from y0 to y1 using profile_fn(y)->(ht,hb,w).
    Returns the list of ring-vert-rows (each a list of N_SEG verts)."""
    rows = []
    ys = [lerp(y0, y1, i / (n_rings - 1)) for i in range(n_rings)]
    for y in ys:
        ht, hb, w = profile_fn(y)
        pts = egg_ring(Vector((0, y, 0)), ht, hb, w)
        rows.append([bm.verts.new(p) for p in pts])
    # side faces
    for r in range(len(rows) - 1):
        a, b = rows[r], rows[r + 1]
        for i in range(N_SEG):
            j = (i + 1) % N_SEG
            bm.faces.new([a[i], a[j], b[j], b[i]])
    # end caps (pole fan)
    if extra_cap_start:
        pole = bm.verts.new(Vector((0, y0, 0)))
        first = rows[0]
        for i in range(N_SEG):
            j = (i + 1) % N_SEG
            bm.faces.new([pole, first[j], first[i]])
    if extra_cap_end:
        pole = bm.verts.new(Vector((0, y1, 0)))
        last = rows[-1]
        for i in range(N_SEG):
            j = (i + 1) % N_SEG
            bm.faces.new([pole, last[i], last[j]])
    return rows


# ---------------------------------------------------------------------------
# fins
# ---------------------------------------------------------------------------

def build_fins(bm):
    # First (tall triangular) dorsal fin, mid-back
    outline = [
        Vector((0, -0.3, 1.55)),
        Vector((0, 0.55, 1.55)),
        Vector((0, 1.35, 3.35)),
        Vector((0, 0.1, 1.62)),
    ]
    add_solid_from_outline(bm, outline, Vector((1, 0, 0)), 0.14)

    # Second dorsal fin (small), near tail
    outline = [
        Vector((0, 5.6, 1.15)),
        Vector((0, 6.05, 1.15)),
        Vector((0, 6.25, 1.55)),
        Vector((0, 5.75, 1.20)),
    ]
    add_solid_from_outline(bm, outline, Vector((1, 0, 0)), 0.08)

    # Anal fin (small), mirrors 2nd dorsal on belly
    outline = [
        Vector((0, 5.7, -1.05)),
        Vector((0, 6.1, -1.05)),
        Vector((0, 6.3, -1.42)),
        Vector((0, 5.85, -1.10)),
    ]
    add_solid_from_outline(bm, outline, Vector((1, 0, 0)), 0.08)

    # Pelvic fins (small pair)
    for side in (-1, 1):
        outline = [
            Vector((side * 0.9, 3.6, -1.1)),
            Vector((side * 1.55, 4.2, -1.35)),
            Vector((side * 1.55, 4.75, -1.15)),
            Vector((side * 0.95, 4.35, -0.95)),
        ]
        add_solid_from_outline(bm, outline, Vector((0, 0, 1)), 0.10)

    # Pectoral fins (large, swept back)
    for side in (-1, 1):
        outline = [
            Vector((side * 1.3, -1.3, -0.6)),
            Vector((side * 3.1, 0.3, -1.7)),
            Vector((side * 3.35, 1.7, -1.9)),
            Vector((side * 1.5, 1.5, -1.0)),
            Vector((side * 1.15, 0.1, -0.5)),
        ]
        add_solid_from_outline(bm, outline, Vector((0, 0, 1)), 0.16)

    # Caudal (lunate tail) fin - two lobes, upper larger, from peduncle
    root_top = Vector((0, 7.1, 0.35))
    root_bot = Vector((0, 7.1, -0.30))
    upper = [
        root_top,
        Vector((0, 7.3, 1.1)),
        Vector((0, 7.85, 3.3)),
        Vector((0, 7.55, 1.9)),
        Vector((0, 7.35, 0.55)),
    ]
    add_solid_from_outline(bm, upper, Vector((1, 0, 0)), 0.12)
    lower = [
        root_bot,
        Vector((0, 7.55, -0.55)),
        Vector((0, 7.95, -1.75)),
        Vector((0, 7.65, -0.95)),
        Vector((0, 7.35, -0.30)),
    ]
    add_solid_from_outline(bm, lower, Vector((1, 0, 0)), 0.12)


# ---------------------------------------------------------------------------
# mouth: lower jaw tube + upper palate/throat tube (+teeth appended into each)
# ---------------------------------------------------------------------------

def tube_profile(u, control):
    xs = [c[0] for c in control]
    ht = catmull_rom(xs, [c[1] for c in control], u)
    hb = catmull_rom(xs, [c[2] for c in control], u)
    w = catmull_rom(xs, [c[3] for c in control], u)
    return max(ht, 0.01), max(hb, 0.01), max(w, 0.01)


LOWERJAW_CONTROL = [
    (0.00, 0.04, 0.04, 0.04),
    (0.15, 0.18, 0.26, 0.55),
    (0.45, 0.32, 0.48, 0.95),
    (0.75, 0.36, 0.58, 1.00),
    (1.00, 0.32, 0.50, 0.85),
]
CAVITY_CONTROL = [
    (0.00, 0.04, 0.04, 0.04),
    (0.15, 0.20, 0.16, 0.50),
    (0.45, 0.36, 0.30, 0.95),
    (0.75, 0.42, 0.34, 1.00),
    (1.00, 0.36, 0.30, 0.85),
]


def lowerjaw_center_z(u):
    return lerp(-0.55, -0.85, u)


def cavity_center_z(u):
    return lerp(-0.10, -0.30, u)


def build_tube(bm, y0, y1, n_rings, control, center_z_fn):
    rows = []
    ys = [lerp(y0, y1, i / (n_rings - 1)) for i in range(n_rings)]
    for i, y in enumerate(ys):
        u = i / (n_rings - 1)
        ht, hb, w = tube_profile(u, control)
        cz = center_z_fn(u)
        pts = egg_ring(Vector((0, y, cz)), ht, hb, w)
        rows.append([bm.verts.new(p) for p in pts])
    for r in range(len(rows) - 1):
        a, b = rows[r], rows[r + 1]
        for i in range(N_SEG):
            j = (i + 1) % N_SEG
            bm.faces.new([a[i], a[j], b[j], b[i]])
    pole0 = bm.verts.new(Vector((0, y0, center_z_fn(0.0))))
    first = rows[0]
    for i in range(N_SEG):
        j = (i + 1) % N_SEG
        bm.faces.new([pole0, first[j], first[i]])
    pole1 = bm.verts.new(Vector((0, y1, center_z_fn(1.0))))
    last = rows[-1]
    for i in range(N_SEG):
        j = (i + 1) % N_SEG
        bm.faces.new([pole1, last[i], last[j]])
    return rows


def rim_point(u_base, u_spread, theta_center, theta_spread, t, control, center_z_fn):
    """t in [-1,1] across the tooth row -> horseshoe path point + local frame."""
    u = clamp(u_base + u_spread * (1.0 - abs(t)), 0.0, 1.0)
    theta = theta_center + theta_spread * t
    ht, hb, w = tube_profile(u, control)
    cz = center_z_fn(u)
    ct, st = math.cos(theta), math.sin(theta)
    r = ht if st >= 0 else hb
    y = lerp(MOUTH_FRONT_Y, HINGE_Y, u)
    p = Vector((w * ct, y, cz + r * st))
    return p, u


def add_teeth_row(bm, control, center_z_fn, theta_center, point_dir_sign, n_main=18, n_second=10):
    """point_dir_sign: +1 for lower jaw (teeth point up), -1 for palate (teeth point down)."""
    for i in range(n_main):
        t = -1.0 + 2.0 * i / (n_main - 1)
        p, u = rim_point(0.20, 0.30, theta_center, 1.15, t, control, center_z_fn)
        size = lerp(0.30, 0.16, abs(t))
        rad = lerp(0.09, 0.05, abs(t))
        x_lean = -0.35 * (p.x / 1.0)
        direction = Vector((x_lean, 0.22, point_dir_sign * 1.0)).normalized()
        add_cone_tooth(bm, p, direction, rad, size)
    for i in range(n_second):
        t = -1.0 + 2.0 * i / (n_second - 1)
        p, u = rim_point(0.28, 0.30, theta_center, 1.0, t, control, center_z_fn)
        p = p + Vector((0, 0.10, 0)) * point_dir_sign * 0  # slight inward offset along mouth axis
        size = lerp(0.20, 0.11, abs(t)) * 0.65
        rad = lerp(0.09, 0.05, abs(t)) * 0.65
        x_lean = -0.30 * (p.x / 1.0)
        direction = Vector((x_lean, 0.20, point_dir_sign * 1.0)).normalized()
        add_cone_tooth(bm, p, direction, rad, size)


def build_lower_jaw_mesh():
    bm = bmesh.new()
    build_tube(bm, MOUTH_FRONT_Y, HINGE_Y, 14, LOWERJAW_CONTROL, lowerjaw_center_z)
    tooth_start_face = len(bm.faces)
    add_teeth_row(bm, LOWERJAW_CONTROL, lowerjaw_center_z, theta_center=math.pi / 2.0, point_dir_sign=+1)
    return finalize_mesh_object(bm, "LowerJaw", tooth_start_face)


def build_mouth_cavity_mesh():
    bm = bmesh.new()
    build_tube(bm, MOUTH_FRONT_Y, HINGE_Y, 14, CAVITY_CONTROL, cavity_center_z)
    tooth_start_face = len(bm.faces)
    add_teeth_row(bm, CAVITY_CONTROL, cavity_center_z, theta_center=-math.pi / 2.0, point_dir_sign=-1)
    return finalize_mesh_object(bm, "MouthCavity", tooth_start_face)


# ---------------------------------------------------------------------------
# mesh finalize: to-object, materials, vertex colors, smooth shading
# ---------------------------------------------------------------------------

def get_or_make_material_skin():
    if "SharkSkin" in bpy.data.materials:
        return bpy.data.materials["SharkSkin"]
    mat = bpy.data.materials.new("SharkSkin")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Col"
    bsdf.inputs["Roughness"].default_value = 0.5
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    out.location = (300, 0)
    bsdf.location = (0, 0)
    vcol.location = (-300, 0)
    return mat


def get_or_make_material_teeth():
    if "Teeth" in bpy.data.materials:
        return bpy.data.materials["Teeth"]
    mat = bpy.data.materials.new("Teeth")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*TOOTH_COLOR, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.3
    return mat


def get_or_make_material_eye():
    if "Eye" in bpy.data.materials:
        return bpy.data.materials["Eye"]
    mat = bpy.data.materials.new("Eye")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    return mat


def countershading_color(z, ht_ref=1.9, hb_ref=1.5):
    t = clamp((z + hb_ref * 0.3) / (ht_ref + hb_ref * 0.3), 0.0, 1.0)
    r = lerp(SKIN_LIGHT[0], SKIN_DARK[0], t)
    g = lerp(SKIN_LIGHT[1], SKIN_DARK[1], t)
    b = lerp(SKIN_LIGHT[2], SKIN_DARK[2], t)
    return r, g, b


def finalize_mesh_object(bm, name, tooth_start_face=None):
    mesh = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, tooth_start_face


def paint_body_colors(obj):
    mesh = obj.data
    col = mesh.color_attributes.new(name="Col", type='BYTE_COLOR', domain='CORNER')
    gill_y0, gill_y1 = HINGE_Y + 1.4, HINGE_Y + 3.2
    period = (gill_y1 - gill_y0) / 5.0
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            v = mesh.vertices[mesh.loops[li].vertex_index]
            x, y, z = v.co.x, v.co.y, v.co.z
            r, g, b = countershading_color(z)
            n = hash01(x * 3.1, y * 3.1, z * 3.1)
            speck = hash01(x * 9.7 + 4.0, y * 9.7, z * 9.7)
            shade = 1.0 - 0.10 * n
            if speck > 0.93:
                shade *= 0.55
            r, g, b = r * shade, g * shade, b * shade
            if gill_y0 <= y <= gill_y1 and abs(x) > 0.35:
                phase = ((y - gill_y0) / period) % 1.0
                if phase < 0.32:
                    r, g, b = 0.04, 0.04, 0.04
            col.data[li].color = (r, g, b, 1.0)
    mesh.color_attributes.active_color = col


def paint_jaw_colors(obj, tooth_start_face, mode):
    """mode='lower': outward faces = skin, inward(up) faces = gum.
       mode='cavity': all faces = gum/throat gradient by Y (front pink, back dark red)."""
    mesh = obj.data
    col = mesh.color_attributes.new(name="Col", type='BYTE_COLOR', domain='CORNER')
    skin_mat = get_or_make_material_skin()
    teeth_mat = get_or_make_material_teeth()
    obj.data.materials.append(skin_mat)
    obj.data.materials.append(teeth_mat)
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    for poly in mesh.polygons:
        is_tooth = tooth_start_face is not None and poly.index >= tooth_start_face
        if is_tooth:
            poly.material_index = 1
            for li in poly.loop_indices:
                col.data[li].color = (*TOOTH_COLOR, 1.0)
            continue
        poly.material_index = 0
        nz = poly.normal.z
        for li in poly.loop_indices:
            v = mesh.vertices[mesh.loops[li].vertex_index]
            y = v.co.y
            t = clamp((y - MOUTH_FRONT_Y) / (HINGE_Y - MOUTH_FRONT_Y), 0.0, 1.0)
            gum_r = lerp(GUM_PINK[0], GUM_DARK[0], t)
            gum_g = lerp(GUM_PINK[1], GUM_DARK[1], t)
            gum_b = lerp(GUM_PINK[2], GUM_DARK[2], t)
            if mode == 'cavity':
                r, g, b = gum_r, gum_g, gum_b
            else:
                if nz > 0.15:
                    r, g, b = gum_r, gum_g, gum_b
                else:
                    r, g, b = countershading_color(v.co.z - 0.4)
            col.data[li].color = (r, g, b, 1.0)
    mesh.color_attributes.active_color = col


# ---------------------------------------------------------------------------
# armature
# ---------------------------------------------------------------------------

def build_armature():
    arm_data = bpy.data.armatures.new("SharkRigData")
    arm_obj = bpy.data.objects.new("SharkRig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones

    root = eb.new("Root")
    root.head = Vector((0, -0.3, 0))
    root.tail = Vector((0, 0.3, 0))

    spine_ys = [0.0, 1.33, 2.66, 4.0, 5.33, 6.66, 8.0]
    names = ["Spine1", "Spine2", "Spine3", "Spine4", "Spine5", "Tail"]
    parent = root
    for i, name in enumerate(names):
        b = eb.new(name)
        b.head = Vector((0, spine_ys[i], 0))
        b.tail = Vector((0, spine_ys[i + 1], 0))
        b.parent = parent
        b.use_connect = True
        parent = b

    head = eb.new("Head")
    head.head = Vector((0, 0, 0))
    head.tail = Vector((0, NOSE_Y + 0.5, 0))
    head.parent = root

    jaw = eb.new("Jaw")
    jaw.head = Vector((0, HINGE_Y, -0.75))
    jaw.tail = Vector((0, MOUTH_FRONT_Y + 0.2, -1.30))
    jaw.parent = head

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj


def weights_for_y(y):
    if y <= STATIONS[0][1]:
        return {STATIONS[0][0]: 1.0}
    if y >= STATIONS[-1][1]:
        return {STATIONS[-1][0]: 1.0}
    for i in range(len(STATIONS) - 1):
        y0, b0 = STATIONS[i][1], STATIONS[i][0]
        y1, b1 = STATIONS[i + 1][1], STATIONS[i + 1][0]
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            return {b0: 1.0 - t, b1: t}
    return {STATIONS[-1][0]: 1.0}


def skin_body(obj, arm_obj):
    all_bones = ["Root"] + [s[0] for s in STATIONS]
    vgs = {name: obj.vertex_groups.new(name=name) for name in set(all_bones)}
    for v in obj.data.vertices:
        for bone, w in weights_for_y(v.co.y).items():
            vgs[bone].add([v.index], w, 'REPLACE')
    mod = obj.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm_obj
    obj.parent = arm_obj


def skin_rigid(obj, arm_obj, bone_name):
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
    mod = obj.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm_obj
    obj.parent = arm_obj


# ---------------------------------------------------------------------------
# eyes + mouth point
# ---------------------------------------------------------------------------

def build_eye(name, x, y, z, arm_obj):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, segments=12, ring_count=8, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(get_or_make_material_eye())
    bpy.ops.object.shade_smooth()
    obj.parent = arm_obj
    obj.parent_type = 'BONE'
    obj.parent_bone = 'Head'
    bpy.context.view_layer.update()
    obj.matrix_world = Matrix.Translation((x, y, z))
    return obj


def build_mouth_point(arm_obj):
    empty = bpy.data.objects.new("MouthPoint", None)
    empty.empty_display_type = 'PLAIN_AXES'
    empty.empty_display_size = 0.3
    bpy.context.collection.objects.link(empty)
    empty.parent = arm_obj
    empty.parent_type = 'BONE'
    empty.parent_bone = 'Head'
    bpy.context.view_layer.update()
    mouth_mid_y = lerp(MOUTH_FRONT_Y, HINGE_Y, 0.28)
    empty.matrix_world = Matrix.Translation((0.0, mouth_mid_y, -0.55))
    return empty


# ---------------------------------------------------------------------------
# animation
# ---------------------------------------------------------------------------

def build_swim_action(arm_obj):
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    action = bpy.data.actions.new("Swim")
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action

    chain = [("Head", 0.0, 3.0), ("Spine1", 1 / 6, 6.0), ("Spine2", 2 / 6, 9.0),
             ("Spine3", 3 / 6, 13.0), ("Spine4", 4 / 6, 18.0), ("Spine5", 5 / 6, 21.0),
             ("Tail", 1.0, 25.0)]
    period_frames = round(1.6 * FPS)  # 48
    lag_fraction = 0.6

    for bone_name, p, amp_deg in chain:
        pb = arm_obj.pose.bones[bone_name]
        pb.rotation_mode = 'XYZ'
        amp = math.radians(amp_deg)
        phase = lag_fraction * 2 * math.pi * p
        for f in range(period_frames + 1):
            t = f / period_frames
            ang = amp * math.sin(2 * math.pi * t - phase)
            pb.rotation_euler = (0.0, 0.0, ang)
            pb.keyframe_insert(data_path="rotation_euler", index=2, frame=f, group=bone_name)

    for fc in iter_action_fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'

    bpy.ops.object.mode_set(mode='OBJECT')
    return action, period_frames


def build_jaw_open_action(arm_obj, open_deg=60.0):
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    action = bpy.data.actions.new("JawOpen")
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = action

    pb = arm_obj.pose.bones["Jaw"]
    pb.rotation_mode = 'XYZ'
    n_frames = round(0.5 * FPS)  # 15

    pb.rotation_euler = (0.0, 0.0, 0.0)
    pb.keyframe_insert(data_path="rotation_euler", index=0, frame=0, group="Jaw")
    pb.rotation_euler = (math.radians(-open_deg), 0.0, 0.0)
    pb.keyframe_insert(data_path="rotation_euler", index=0, frame=n_frames, group="Jaw")

    for fc in iter_action_fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'

    bpy.ops.object.mode_set(mode='OBJECT')
    return action, n_frames


def push_to_nla(arm_obj, action, track_name):
    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = track_name
    track.strips.new(track_name, int(action.frame_range[0]), action)
    arm_obj.animation_data.action = None


# ---------------------------------------------------------------------------
# render preview helper
# ---------------------------------------------------------------------------

def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("World") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.05, 0.08, 0.12, 1.0)
        bg.inputs[1].default_value = 1.0

    sun = bpy.data.lights.new("Sun", type='SUN')
    sun.energy = 3.0
    sun_obj = bpy.data.objects.new("Sun", sun)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(55), 0, math.radians(35))

    fill = bpy.data.lights.new("Fill", type='SUN')
    fill.energy = 1.2
    fill_obj = bpy.data.objects.new("Fill", fill)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-40), 0, math.radians(-100))

    cam_data = bpy.data.cameras.new("Cam")
    cam_obj = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    return cam_obj


def point_camera(cam, location, target):
    cam.location = location
    direction = target - location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = FPS

    # ---- main body + fins ----
    bm = bmesh.new()
    build_body_loft(bm, NOSE_Y, TAIL_Y, 40, body_profile)
    build_fins(bm)
    body_obj, _ = finalize_mesh_object(bm, "SharkBody")
    bpy.context.view_layer.objects.active = body_obj
    bpy.context.view_layer.objects.active = body_obj
    body_obj.select_set(True)
    bpy.ops.object.shade_smooth()
    body_obj.select_set(False)
    paint_body_colors(body_obj)
    body_obj.data.materials.append(get_or_make_material_skin())

    # ---- mouth parts ----
    lower_jaw_obj, lj_tooth_start = build_lower_jaw_mesh()
    paint_jaw_colors(lower_jaw_obj, lj_tooth_start, mode='lower')

    cavity_obj, cav_tooth_start = build_mouth_cavity_mesh()
    paint_jaw_colors(cavity_obj, cav_tooth_start, mode='cavity')

    # ---- armature ----
    arm_obj = build_armature()
    skin_body(body_obj, arm_obj)
    skin_rigid(lower_jaw_obj, arm_obj, "Jaw")
    skin_rigid(cavity_obj, arm_obj, "Head")

    # ---- eyes ----
    eye_l = build_eye("Eye_L", -1.05, -6.2, 0.55, arm_obj)
    eye_r = build_eye("Eye_R", 1.05, -6.2, 0.55, arm_obj)

    # ---- mouth point ----
    mouth_point = build_mouth_point(arm_obj)

    # ---- previews (rest pose) ----
    cam = setup_render()
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    point_camera(cam, Vector((0, 0, 3.0)), Vector((0, 0, 0.5)))
    cam.location = Vector((22, -2, 2.0))
    point_camera(cam, cam.location, Vector((0, -1, 0.3)))
    cam.data.lens = 35
    render_to(os.path.join(PREVIEW_DIR, "preview_side.png"))

    cam.location = Vector((0, -2, 22))
    point_camera(cam, cam.location, Vector((0, -1, 0)))
    render_to(os.path.join(PREVIEW_DIR, "preview_top.png"))

    # pose jaw open (direct, temporary, no keyframes) for the mouth preview
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    jaw_pb = arm_obj.pose.bones["Jaw"]
    jaw_pb.rotation_mode = 'XYZ'
    jaw_pb.rotation_euler = (math.radians(-60.0), 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')

    cam.location = Vector((0, -9.5, -2.6))
    point_camera(cam, cam.location, Vector((0, -6.0, -0.6)))
    cam.data.lens = 30
    render_to(os.path.join(PREVIEW_DIR, "preview_front_open.png"))

    # reset jaw to closed before baking animations
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    jaw_pb.rotation_euler = (0.0, 0.0, 0.0)
    bpy.ops.object.mode_set(mode='OBJECT')

    # ---- animations ----
    swim_action, swim_frames = build_swim_action(arm_obj)
    push_to_nla(arm_obj, swim_action, "Swim")
    jaw_action, jaw_frames = build_jaw_open_action(arm_obj)
    push_to_nla(arm_obj, jaw_action, "JawOpen")

    scene.frame_start = 0
    scene.frame_end = max(swim_frames, jaw_frames)

    # ---- export ----
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        use_selection=False,
        export_yup=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_nla_strips_merged_animation_name='Animation',
        export_skins=True,
        export_all_influences=False,
        export_vertex_color='MATERIAL',
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    print("EXPORTED:", OUT_GLB)


main()
