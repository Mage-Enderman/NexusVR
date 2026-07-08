"""
V2 — corrected anchors from a fresh basher read of the current file.

Three edits:
1. onCanvasAuxMouseDown: middle-mouse toggles the radial menu (cleaner
   branch, no functional-setter side-effect anti-pattern).
2. handleDuplicateHeld.afterImport: selectAsset(newAsset) →
   swapGrabbedAsset(newAsset) so duplicate-while-holding lands on the
   duplicate.
3. handleDuplicateSelected.afterImport: guard — if the duplicated asset
   is also currently grabbed, swap the grab. Otherwise keep the
   existing selectAsset flow.
"""
import sys

path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()


def apply(name, old, new):
    if old not in src:
        print(f'ERROR: anchor for "{name}" not found', file=sys.stderr)
        print(f'  starts with: {old[:120]!r}', file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)


# --- 1. onCanvasAuxMouseDown: clean branch toggle (no setState-in-setState) -
# Exact anchor verified by `python3 tmp_show.py` of lines 1408-1425.
src = apply(
    'onCanvasAuxMouseDown MMB toggle',
    (
        '    const onCanvasAuxMouseDown = (e: MouseEvent) => {\n'
        '      if (e.button === 1) {\n'
        '        e.preventDefault();\n'
        '        setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '        setShowRadialMenu(true);\n'
        '      } else if (e.button === 3 || e.button === 4) {\n'
        '        e.preventDefault();\n'
        '        if (activeToolRef.current === \'dev\') {\n'
        '          handleCenterRaySelect();\n'
        '        }\n'
        '      }\n'
        '    };\n'
    ),
    (
        '    const onCanvasAuxMouseDown = (e: MouseEvent) => {\n'
        '      if (e.button === 1) {\n'
        '        e.preventDefault();\n'
        '        // Middle-mouse toggles the radial menu: opens if closed,\n'
        '        // closes if open. The radial menu\'s own window-level\n'
        '        // capture-phase mousedown handler (in\n'
        '        // RadialContextMenu.tsx) fires FIRST when MMB is pressed\n'
        '        // over the menu backdrop, so the menu closes itself\n'
        '        // before this branch can run a stale re-open. We use a\n'
        '        // clean branch on the *current* `showRadialMenu` value\n'
        '        // rather than a functional-setState updater — the latter\n'
        '        // would put `setRadialMenuPos` inside another setter\'s\n'
        '        // updater, which React 18 StrictMode would call twice\n'
        '        // in dev to surface purity violations.\n'
        '        if (showRadialMenu) {\n'
        '          setShowRadialMenu(false);\n'
        '        } else {\n'
        '          setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '          setShowRadialMenu(true);\n'
        '        }\n'
        '      } else if (e.button === 3 || e.button === 4) {\n'
        '        e.preventDefault();\n'
        '        if (activeToolRef.current === \'dev\') {\n'
        '          handleCenterRaySelect();\n'
        '        }\n'
        '      }\n'
        '    };\n'
    ),
)


# --- 2. handleDuplicateHeld.afterImport: swap grab -------------------------
# We anchor on the unique afterImport body that ends with selectAsset →
# recordSpawnUndo → broadcastSpawn. handleDuplicateHeld's afterImport
# does NOT have its own `id: asset.id` inside the broadcast (it uses
# newAsset.id directly), AND it's preceded by `pos.add(offset)` for the
# worldPos computation. Use the unique trailing `}\n    };\n\n    if (asset.type === \'primitive\'`
# pattern to disambiguate from handleDuplicateSelected.
# But actually the simpler approach is to anchor on the unique
# manipulationManagerRef.current?.selectAsset call that comes BEFORE
# `recordSpawnUndo` in handleDuplicateHeld (it follows worldPos-based
# pos computation). Let me anchor on the exact string right before
# selectAsset so we replace it cleanly.
src = apply(
    'handleDuplicateHeld afterImport swap',
    (
        '      newAsset.object3d.scale.set(\n'
        '        asset.object3d.scale.x,\n'
        '        asset.object3d.scale.y,\n'
        '        asset.object3d.scale.z\n'
        '      );\n'
        '      manipulationManagerRef.current?.selectAsset(newAsset);\n'
        '      recordSpawnUndo(newAsset);\n'
        '      networkServiceRef.current.broadcastSpawn({\n'
        '        id: newAsset.id,\n'
        '        name: newAsset.name,\n'
        '        type: newAsset.type as AssetSpawnData[\'type\'],\n'
        '        position: [\n'
        '          newAsset.object3d.position.x,\n'
        '          newAsset.object3d.position.y,\n'
        '          newAsset.object3d.position.z,\n'
        '        ],\n'
        '        rotation: [\n'
        '          newAsset.object3d.rotation.x,\n'
        '          newAsset.object3d.rotation.y,\n'
        '          newAsset.object3d.rotation.z,\n'
        '        ],\n'
        '        scale: [\n'
        '          newAsset.object3d.scale.x,\n'
        '          newAsset.object3d.scale.y,\n'
        '          newAsset.object3d.scale.z,\n'
        '        ],\n'
        '        url: newAsset.url,\n'
        '        fileData: newAsset.fileData,\n'
        '        isCollidable: newAsset.isCollidable,\n'
        '      });\n'
        '    };\n'
        '\n'
        '    if (asset.type === \'primitive\' && primType) {\n'
    ),
    (
        '      newAsset.object3d.scale.set(\n'
        '        asset.object3d.scale.x,\n'
        '        asset.object3d.scale.y,\n'
        '        asset.object3d.scale.z\n'
        '      );\n'
        '      // Duplicate-while-holding: keep holding the DUPLICATE,\n'
        '        not the original. swapGrabbedAsset atomically ends the\n'
        '        current grab on `asset` and starts an equivalent grab on\n'
        '        `newAsset` (same VR-side when applicable, cursor-\n'
        '        anchored RMB-grab on desktop). The user can then drag\n'
        '        the two apart, exactly like in physical VR worlds. No-op\n'
        '        during a two-handed grab — that path would need the\n'
        '        live grip world positions to re-establish the scale,\n'
        '        which is intentionally out of scope here.\n'
        '      manipulationManagerRef.current?.swapGrabbedAsset(newAsset);\n'
        '      recordSpawnUndo(newAsset);\n'
        '      networkServiceRef.current.broadcastSpawn({\n'
        '        id: newAsset.id,\n'
        '        name: newAsset.name,\n'
        '        type: newAsset.type as AssetSpawnData[\'type\'],\n'
        '        position: [\n'
        '          newAsset.object3d.position.x,\n'
        '          newAsset.object3d.position.y,\n'
        '          newAsset.object3d.position.z,\n'
        '        ],\n'
        '        rotation: [\n'
        '          newAsset.object3d.rotation.x,\n'
        '          newAsset.object3d.rotation.y,\n'
        '          newAsset.object3d.rotation.z,\n'
        '        ],\n'
        '        scale: [\n'
        '          newAsset.object3d.scale.x,\n'
        '          newAsset.object3d.scale.y,\n'
        '          newAsset.object3d.scale.z,\n'
        '        ],\n'
        '        url: newAsset.url,\n'
        '        fileData: newAsset.fileData,\n'
        '        isCollidable: newAsset.isCollidable,\n'
        '      });\n'
        '      } else {\n'
        '      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {\n'
        '        // Same RR-D-while-holding semantics: if the user is\n'
        '        currently grabbing the SELECTED asset (RMB-grab or VR\n'
        '        grip in flight), swap the grab onto the duplicate so\n'
        '        the user feels they\'re carrying the new copy. Otherwise\n'
        '        fall through to the default selectAsset(newAsset).\n'
        '        manipulationManagerRef.current?.swapGrabbedAsset(newAsset);\n'
        '      } else {\n'
        '      manipulationManagerRef.current?.selectAsset(newAsset);\n'
        '      }\n'
        '      recordSpawnUndo(newAsset);\n'
        '      networkServiceRef.current.broadcastSpawn({\n'
        '        id: newAsset.id,\n'
        '        name: newAsset.name,\n'
        '        type: newAsset.type as AssetSpawnData[\'type\'],\n'
        '        position: [\n'
        '          newAsset.object3d.position.x,\n'
        '          newAsset.object3d.position.y,\n'
        '          newAsset.object3d.position.z,\n'
        '        ],\n'
        '        rotation: [\n'
        '          newAsset.object3d.rotation.x,\n'
        '          newAsset.object3d.rotation.y,\n'
        '          newAsset.object3d.rotation.z,\n'
        '        ],\n'
        '        scale: [\n'
        '          newAsset.object3d.scale.x,\n'
        '          newAsset.object3d.scale.y,\n'
        '          newAsset.object3d.scale.z,\n'
        '        ],\n'
        '        url: newAsset.url,\n'
        '        fileData: newAsset.fileData,\n'
        '        isCollidable: newAsset.isCollidable,\n'
        '      });\n'
        '    };\n'
        '\n'
        '    if (asset.type === \'primitive\' && primType) {\n'
    ),
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('App.tsx edits applied successfully.')
