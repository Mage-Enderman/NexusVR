#!/usr/bin/env python3
# Fix typecheck errors:
#   - Material base class lacks wireframe/flatShading/roughness/metalness.
#     Cast to THREE.MeshStandardMaterial where accessed.
#   - Material.color IS on base Material (no cast needed) but TS is confused
#     in some call sites; cast there too for consistency.
#   - Drop unused `three` and `mat0` locals in App.tsx.
#   - Drop dead `op === true` branch (string/boolean mismatch).
#
# Strategy: change the material reads to typed accesses via a small
# cast. Where MESH stands for "any material whose material type carries
# these props" -- MeshStandardMaterial is the right base in this app
# (most edits are on GLTF/OBJ imports which use Standard).
import re, sys

# ===== VRHUDManager.ts =====
vrhud_path = 'src/engine/VRHUDManager.ts'
with open(vrhud_path, 'r', encoding='utf-8') as f:
    c = f.read()

# The toggle status read block in MESH STATS + DISPLAY reads
#   mat0?.wireframe / mat0?.flatShading / o3d.visible, etc.
# Replace mat0?.<prop> with ((mat0 as THREE.MeshStandardMaterial|null))?.<prop>
# so the type system sees the properties.

# Replace mat0?.wireframe in the read paths
def fix_mat0(text: str) -> str:
    # Read-only display checks
    text = text.replace(
        "mat0?.wireframe ? 'ON' : 'OFF'",
        "(mat0 as THREE.MeshStandardMaterial | null)?.wireframe ? 'ON' : 'OFF'"
    )
    text = text.replace(
        "mat0?.wireframe ? '#06b6d4' : '#475569'",
        "(mat0 as THREE.MeshStandardMaterial | null)?.wireframe ? '#06b6d4' : '#475569'"
    )
    text = text.replace(
        "mat0?.wireframe ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)'",
        "(mat0 as THREE.MeshStandardMaterial | null)?.wireframe ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)'"
    )
    text = text.replace(
        "mat0?.flatShading ? 'ON' : 'OFF'",
        "(mat0 as THREE.MeshStandardMaterial | null)?.flatShading ? 'ON' : 'OFF'"
    )
    return text

c = fix_mat0(c)

# The material section's OLD line `mat0?.flatShading ? ...` and similar
# after rewrite could remain -- ensure all 3 color/path branches covered.
needle = "mat0?.flatShading ? '#f472b6' : '#475569'"
if needle in c:
    c = c.replace(needle,
        "(mat0 as THREE.MeshStandardMaterial | null)?.flatShading ? '#f472b6' : '#475569'")
needle = "mat0?.flatShading ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)'"
if needle in c:
    c = c.replace(needle,
        "(mat0 as THREE.MeshStandardMaterial | null)?.flatShading ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)'")

# The MATERIAL section reads mat0 for color, roughness, metalness, etc.
# mat0.color / mat0.roughness / mat0.metalness / mat0.opacity / mat0.emissiveIntensity
# - color IS on base Material (no cast needed for reads), but we still
#   cast for write-back consistency.
# - roughness/metalness/opacity/emissiveIntensity are on MeshStandardMaterial.
# The simple safe rewrite: cast mat0 everywhere it's accessed in
# the MATERIAL section.

# mat0?.roughness
c = c.replace("mat0?.roughness ?? 0.5", "(mat0 as THREE.MeshStandardMaterial | null)?.roughness ?? 0.5")
c = c.replace("mat0?.metalness ?? 0",  "(mat0 as THREE.MeshStandardMaterial | null)?.metalness ?? 0")
c = c.replace("mat0?.opacity ?? 1",     "(mat0 as THREE.MeshStandardMaterial | null)?.opacity ?? 1")
c = c.replace(
    "(mat0 as any)?.emissiveIntensity ?? 1",
    "((mat0 as THREE.MeshStandardMaterial | null) as any)?.emissiveIntensity ?? 1"
)
# Note: mat0?.color reads on line 1844 type-errored because mat0 inside
# `Math.round(((mat0.color as THREE.Color)[chan.key]) * 255)` -- mat0
# was narrowed. Cast it.

# mat0.color --> mat0.color but on a typed mat0
# (color is on base Material so this should be fine on SOME paths and not
# others -- the original error was on a different line, fix it by
# narrowing fix below.)
# Find the contextual block:
needle_block = """    const cv = mat0 ? Math.round(((mat0.color as THREE.Color)[chan.key]) * 255) : 0;"""
if needle_block in c:
    c = c.replace(needle_block,
        "    const cv = mat0 ? Math.round((((mat0 as THREE.MeshStandardMaterial).color as THREE.Color)[chan.key]) * 255) : 0;")

with open(vrhud_path, 'w', encoding='utf-8') as f:
    f.write(c)
print('OK: VRHUDManager material-property reads cast to MeshStandardMaterial.')

# ===== App.tsx =====
app_path = 'src/App.tsx'
with open(app_path, 'r', encoding='utf-8') as f:
    c = f.read()

# Drop unused `three` local (TS6133)
c = c.replace(
    "                const three = (window as any).THREE ?? THREE;\n",
    "",
    1
)

# Drop unused `mat0` local (TS6133)
# We computed `mat0` for nothing in App.tsx -- the actual material
# manipulation iterates the `mats` array directly which already gives
# us THREE.Material[].
c = c.replace(
    "                const mats: THREE.Material[] = [];\n"
    "                o3d.traverse((c: THREE.Object3D) => {\n"
    "                  const m = (c as THREE.Mesh).material;\n"
    "                  if (m) {\n"
    "                    if (Array.isArray(m)) mats.push(...m);\n"
    "                    else mats.push(m as THREE.Material);\n"
    "                  }\n"
    "                });\n"
    "                const mat0 = mats[0] ?? null;\n",
    "                const mats: THREE.Material[] = [];\n"
    "                o3d.traverse((c: THREE.Object3D) => {\n"
    "                  const m = (c as THREE.Mesh).material;\n"
    "                  if (m) {\n"
    "                    if (Array.isArray(m)) mats.push(...m);\n"
    "                    else mats.push(m as THREE.Material);\n"
    "                  }\n"
    "                });\n",
    1
)

# Cast material writes to MeshStandardMaterial (where wireframe/flatShading
# live). For App.tsx the writes iterate `mats`, so cast each `m` when
# setting these properties. Multiple sites:
#  - m.wireframe = !m.wireframe
#  - m.flatShading = !m.flatShading
#  - m.color reads are fine (color is on base Material)
#  - m.roughness/metalness/opacity on MeshStandardMaterial only
#  - m.emissiveIntensity on MeshStandardMaterial only
#  - m.needsUpdate is on base Material -- keep as-is.

c = c.replace("    m.wireframe = !m.wireframe;",
              "    (m as THREE.MeshStandardMaterial).wireframe = !(m as THREE.MeshStandardMaterial).wireframe;")
c = c.replace("    m.flatShading = !m.flatShading;",
              "    (m as THREE.MeshStandardMaterial).flatShading = !(m as THREE.MeshStandardMaterial).flatShading;")
c = c.replace("(m as any)[p] as number ?? (p === 'opacity' ? 1 : 0)",
              "(m as any)[p] as number ?? (p === 'opacity' ? 1 : 0)")
# Safer pattern for scalar props -- keep casting as any and m.needsUpdate:
# The existing (m as any)[p] = ... pattern works at runtime but assignment
# to `any` typed lvalue should fine for TS too -- but `m.needsUpdate = true`
# is OK (base Material).

# Drop dead op === true branch (string/boolean mismatch). The regex
#   const op = m[4] ?? m[5];
# collapses to NEVER m[5] -- m[5] is from a different capture group
# that wouldn't be matched by tail.split. Simplify by removing it.
c = c.replace(
    "                    const op = m[4] ?? m[5];",
    "                    const op = m[4];",
    1
)

# Verify the post-condition. The op===true case was in the body of:
#   if (op === '.reset' || op === true) { ... }
# That becomes:
#   if (op === '.reset') { ... }
# which works because we drop the always-false `|| op === true`.
c = c.replace(
    "                    if (op === '.reset' || op === true) {",
    "                    if (op === '.reset') {",
    1
)

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(c)
print('OK: App.tsx fixes applied (drop unused three/mat0, cast material writes, drop dead op===true).')
