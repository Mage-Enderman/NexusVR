#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io

path = 'src/App.tsx'
with io.open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Per-frame aim/select for VRRadialMenuMesh. Inserted after the mirror-useEffect block.
anchor_rg = 'useEffect(() => { laserEnabledRef.current = laserEnabled; }, [laserEnabled]);'
idx = content.find(anchor_rg)
assert idx != -1, 'laserEnabled mirror-useEffect anchor not found'
# Find the end of this useEffect block (next \n  pattern at column 2).
block_end = content.find('\n  ', idx + len(anchor_rg))

aim_block = (
    '\n'
    '  // Per-frame aim/select for VRRadialMenuMesh. Reads the active XR\n'
    '  // controller (the one whose B/Y button placed the mesh) for its\n'
    '  // current world pose, builds a Ray, and updates the mesh\'s\n'
    '  // hover state. On trigger-press this frame, fires select() which\n'
    '  // runs the callback for the highlighted slice (or the hub for tab\n'
    '  // swap). Reads `vrRadialActiveSideRef.current` so the aim loop\n'
    '  // always uses the SAME controller that placed the menu (otherwise\n'
    '  // the user could be aiming with the *other* hand and selecting\n'
    '  // slices they can\'t see). The effect runs only while vrRadialOpen\n'
    '  // is true so the cost is one rAF tick while open and zero while closed.\n'
    '  useEffect(() => {\n'
    '    if (!vrRadialOpen) return;\n'
    '    let raf = 0;\n'
    '    const tick = () => {\n'
    '      raf = requestAnimationFrame(tick);\n'
    '      const mesh = vrRadialMenuRef.current;\n'
    '      const se = sceneEngineRef.current;\n'
    '      const side = vrRadialActiveSideRef.current;\n'
    '      if (!mesh || !se || !se.renderer.xr.isPresenting || !mesh.isVisible || !side) return;\n'
    '      const ctr = se.vrInput?.getController(side);\n'
    '      if (!ctr) return;\n'
    '      ctr.updateWorldMatrix(true, false);\n'
    '      const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);\n'
    '      const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);\n'
    '      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();\n'
    '      mesh.updateAim(new THREE.Ray(origin, dir));\n'
    '      const ctrlState = side === \'left\' ? se.vrInput?.left : se.vrInput?.right;\n'
    '      if (ctrlState?.pressedThisFrame?.trigger) mesh.select();\n'
    '    };\n'
    '    raf = requestAnimationFrame(tick);\n'
    '    return () => cancelAnimationFrame(raf);\n'
    '  }, [vrRadialOpen]);\n'
)
content = content[:block_end] + aim_block + content[block_end:]

# After re-inserting aim_block, find the new end of laserEnabled useEffect.
# Now we need to find the end of the aim_block's useEffect and insert state-sync there.
new_end_anchor = '}, [vrRadialOpen]);\n'
new_idx = content.find(new_end_anchor, block_end)
assert new_idx != -1, 'aim-loop end anchor not found'
syn_end = new_idx + len(new_end_anchor)

syn_block = (
    '\n'
    '  // Push React state into the lazy VRRadialMenuMesh so slice labels\n'
    '  // recolour on toggle (e.g. SCALE goes from red to green when\n'
    '  // scalingEnabled flips). The mesh stays the same instance across\n'
    '  // re-renders, so its canvas texture re-rasterises only when the\n'
    '  // tracked inputs actually change. Each tick = one setState call,\n'
    '  // cheap.\n'
    '  useEffect(() => {\n'
    '    vrRadialMenuRef.current?.setState({\n'
    '      locomotionMode,\n'
    '      scalingEnabled,\n'
    '      laserEnabled,\n'
    '      grabMode,\n'
    '      isHeld,\n'
    '      heldAssetType: heldAssetType === null ? null : String(heldAssetType),\n'
    '    });\n'
    '  }, [locomotionMode, scalingEnabled, laserEnabled, grabMode, isHeld, heldAssetType]);\n'
)
content = content[:syn_end] + syn_block + content[syn_end:]

with io.open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: inserted aim-loop useEffect + state-sync useEffect')
print('wrote', len(content), 'bytes')
