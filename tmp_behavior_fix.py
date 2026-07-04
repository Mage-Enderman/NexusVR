"""
Apply three UX edits to src/App.tsx in one pass:
1. handleDuplicateHeld.afterImport: replace selectAsset(newAsset) with
   swapGrabbedAsset(newAsset) so the duplicate is grabbed instead of
   the original (held-tab Duplicate verb).
2. handleDuplicateSelected.afterImport: guard — if the user hit Ctrl+D
   while the selected asset is also being grabbed, swap the grab too.
   Otherwise the Ctrl+D path keeps its current selectAsset(newAsset).
3. onCanvasAuxMouseDown: middle-mouse now toggles the radial menu
   (open if closed, close if open) instead of only opening.
"""
import sys

path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()


def apply(name, old, new):
    if old not in src:
        print(f'ERROR: anchor for "{name}" not found', file=sys.stderr)
        print(f'  starts with: {old[:80]!r}', file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)


# --- 3. onCanvasAuxMouseDown: MMB toggle ----------------------------------
# Original (always opens):
#   if (e.button === 1) {
#     e.preventDefault();
#     setRadialMenuPos({ x: e.clientX, y: e.clientY });
#     setShowRadialMenu(true);
#   } else if (e.button === 3 || e.button === 4) {
#
# Updated (toggle):
src = apply(
    'onCanvasAuxMouseDown MMB toggle',
    (
        '    if (e.button === 1) {\n'
        '      e.preventDefault();\n'
        '      setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '      setShowRadialMenu(true);\n'
        '    } else if (e.button === 3 || e.button === 4) {\n'
    ),
    (
        '    if (e.button === 1) {\n'
        '      e.preventDefault();\n'
        '      // Middle-mouse toggles the radial menu: opens if closed,\n'
        '      // closes if open. The radial menu\'s own global mousedown\n'
        '      // handler (in RadialContextMenu.tsx) also closes on MMB\n'
        '      // within the menu backdrop, so behavior is symmetric\n'
        '      // whether the user hits MMB on the canvas or over the\n'
        '      // menu itself.\n'
        '      setShowRadialMenu((prev) => {\n'
        '        if (prev) return false;\n'
        '        setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '        return true;\n'
        '      });\n'
        '    } else if (e.button === 3 || e.button === 4) {\n'
    ),
)

# --- 1. handleDuplicateHeld.afterImport: swap grab ------------------------
# Original afterImport ends with selectAsset then recordSpawnUndo +
# broadcastSpawn. We swap selectAsset(newAsset) for swapGrabbedAsset(newAsset).
# We anchor on the full afterImport signature so the replacement is
# unambiguous across both handleDuplicateHeld and handleDuplicateSelected.
# handleDuplicateHeld's afterImport does NOT have a "\n    }}:" for the
# primitive branch — it closes via `pos` arg flow instead. We anchor on
# the unique rotation+scale copy that opens afterImport.
src = apply(
    'handleDuplicateHeld afterImport swap',
    (
        '    const afterImport = (newAsset: LoadedAsset) => {\n'
        '      newAsset.object3d.rotation.set(\n'
        '        asset.object3d.rotation.x,\n'
        '        asset.object3d.rotation.y,\n'
        '        asset.object3d.rotation.z\n'
        '      );\n'
        '      newAsset.object3d.scale.set(\n'
        '        asset.object3d.scale.x,\n'
        '        asset.object3d.scale.y,\n'
        '        asset.object3d.scale.z\n'
        '      );\n'
        '      manipulationManagerRef.current?.selectAsset(newAsset);\n'
        '      recordSpawnUndo(newAsset);\n'
        '      networkServiceRef.current.broadcastSpawn({\n'
    ),
    (
        '    const afterImport = (newAsset: LoadedAsset) => {\n'
        '      newAsset.object3d.rotation.set(\n'
        '        asset.object3d.rotation.x,\n'
        '        asset.object3d.rotation.y,\n'
        '        asset.object3d.rotation.z\n'
        '      );\n'
        '      newAsset.object3d.scale.set(\n'
        '        asset.object3d.scale.x,\n'
        '        asset.object3d.scale.y,\n'
        '        asset.object3d.scale.z\n'
        '      );\n'
        '      // Duplicate-while-holding: keep holding the DUPLICATE,\n'
        '      // not the original. swapGrabbedAsset atomically ends the\n'
        '      // current grab on `asset` and starts an equivalent grab on\n'
        '      // `newAsset` (same VR-side when applicable, same cursor-\n'
        '      // anchored RMB-grab on desktop). The user can then drag\n'
        '      // the two apart, exactly like in physical VR worlds.\n'
        '      manipulationManagerRef.current?.swapGrabbedAsset(newAsset);\n'
        '      recordSpawnUndo(newAsset);\n'
        '      networkServiceRef.current.broadcastSpawn({\n'
    ),
)

# --- 2. handleDuplicateSelected.afterImport: guard -------------------------
# handleDuplicateSelected's afterImport is structurally identical to
# handleDuplicateHeld's EXCEPT it does NOT block access for
# two-handed-only fallback. The broadcastSpawn shape is also identical.
# We anchor on the unique afterImport body and add a guard *inside* it
# that swaps the grab *only* if the asset being duplicated is also the
# one currently grabbed (i.e. Ctrl+D during a single-handed RMB-grab or
# VR-grip on the selected asset — rare but possible).
src = apply(
    'handleDuplicateSelected afterImport guard',
    (
        '    const afterImport = (newAsset: LoadedAsset) => {\n'
        '      newAsset.object3d.rotation.set(\n'
        '        asset.object3d.rotation.x,\n'
        '        asset.object3d.rotation.y,\n'
        '        asset.object3d.rotation.z\n'
        '      );\n'
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
        '    const afterImport = (newAsset: LoadedAsset) => {\n'
        '      newAsset.object3d.rotation.set(\n'
        '        asset.object3d.rotation.x,\n'
        '        asset.object3d.rotation.y,\n'
        '        asset.object3d.rotation.z\n'
        '      );\n'
        '      newAsset.object3d.scale.set(\n'
        '        asset.object3d.scale.x,\n'
        '        asset.object3d.scale.y,\n'
        '        asset.object3d.scale.z\n'
        '      );\n'
        '      // Ctrl+D path: by default we just select the duplicate so\n'
        '      // the user can place it with the gizmo. The one exception\n'
        '      // is when the selected asset is also currently grabbed\n'
        '      // (RMB-grab in flight or VR grip held). In that case we\n'
        '      // swap the grab onto the duplicate so the user feels they\n'
        '      // are carrying the new copy — same UX as the radial-menu\n'
        '      // held-tab Duplicate verb.\n'
        '      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {\n'
        '        manipulationManagerRef.current?.swapGrabbedAsset(newAsset);\n'
        '      } else {\n'
        '        manipulationManagerRef.current?.selectAsset(newAsset);\n'
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
print('App.tsx edits applied.')
