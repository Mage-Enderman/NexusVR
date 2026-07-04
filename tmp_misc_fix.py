"""
Apply all misc-file UI changes to src/App.tsx in one pass with corrected anchors.
The file is too large for the str_replace tool's inline patch buffer, so
we do targeted text replacements with Python's str.replace (exact match,
single replacement each). The previous version of this script had a wrong
anchor for the MiscFileModal JSX block (it had `url: a.url,` and a
fallback metadata expression that don't exist in the real code).
"""
import sys

path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

edits = []

# 1. Add heldAssetType state next to isHeld.
edits.append((
    'isHeld state',
    '  const [isHeld, setIsHeld] = useState<boolean>(false);',
    (
        '  const [isHeld, setIsHeld] = useState<boolean>(false);\n'
        '  // Mirrors the type of the currently held asset so the radial context\n'
        '  // menu can swap its held-tab slice labels (e.g. show "Download"\n'
        '  // instead of "Duplicate" when the held item is a misc file). Cleared\n'
        '  // on grab-end; null while nothing is held.\n'
        '  const [heldAssetType, setHeldAssetType] = useState<AssetType | null>(null);'
    ),
))

# 2. Remove MiscFileModal import.
edits.append((
    'MiscFileModal import',
    "import { MiscFileModal } from './components/MiscFileModal.tsx';\n",
    '',
))

# 3. Remove inspectedMiscAsset state declaration (plus the
#    preceding comment + trailing blank line, so we don't leave
#    an orphan comment block).
edits.append((
    'inspectedMiscAsset state',
    (
        '  // Misc File inspection modal\n'
        '  const [inspectedMiscAsset, setInspectedMiscAsset] = useState<LoadedAsset | null>(null);\n\n'
    ),
    '',
))

# 4. Remove setInspectedMiscAsset from selection-change callback.
edits.append((
    'selection-change',
    (
        '    disposers.push(manipulationManager.registerOnSelectionChange((asset) => {\n'
        '      setSelectedAsset(asset);\n'
        '      if (asset && asset.type === \'misc\') {\n'
        '        setInspectedMiscAsset(asset);\n'
        '      }\n'
        '    }));\n'
    ),
    (
        '    disposers.push(manipulationManager.registerOnSelectionChange((asset) => {\n'
        '      setSelectedAsset(asset);\n'
        '    }));\n'
    ),
))

# 5. Remove setInspectedMiscAsset from grab-begin; add setHeldAssetType.
edits.append((
    'grab-begin',
    (
        '    disposers.push(manipulationManager.registerOnGrabBegin((asset) => {\n'
        '      if (asset && asset.type === \'misc\') {\n'
        '        setInspectedMiscAsset(asset);\n'
        '      }\n'
        '      // isHeld is true the moment any grab begins (RMB-grab, VR grip, or\n'
        '      // two-handed scale). Drives the radial menu\'s \'held\' tab.\n'
        '      setIsHeld(true);\n'
        '    }));\n'
    ),
    (
        '    disposers.push(manipulationManager.registerOnGrabBegin((asset) => {\n'
        '      // isHeld is true the moment any grab begins (RMB-grab, VR grip, or\n'
        '      // two-handed scale). Drives the radial menu\'s \'held\' tab.\n'
        '      setIsHeld(true);\n'
        '      setHeldAssetType(asset?.type ?? null);\n'
        '    }));\n'
    ),
))

# 6. Add setHeldAssetType(null) to grab-end callback.
edits.append((
    'grab-end',
    (
        '    disposers.push(manipulationManager.registerOnGrabEnd(() => {\n'
        '      setIsHeld(false);\n'
        '    }));\n'
    ),
    (
        '    disposers.push(manipulationManager.registerOnGrabEnd(() => {\n'
        '      setIsHeld(false);\n'
        '      setHeldAssetType(null);\n'
        '    }));\n'
    ),
))

# 7. Remove setInspectedMiscAsset from onCanvasClick (replace with a
#    short comment explaining why we don't auto-open a modal anymore).
edits.append((
    'onCanvasClick misc',
    (
        '        if (cur && objToAsset.has(cur)) {\n'
        '          const found = objToAsset.get(cur)!;\n'
        '          if (found.type === \'misc\') {\n'
        '            setInspectedMiscAsset(found);\n'
        '          }\n'
        '        }\n'
    ),
    (
        '        if (cur && objToAsset.has(cur)) {\n'
        '          // Misc files no longer auto-open an inspection modal on\n'
        '          // canvas click; their context-menu entry points (Download /\n'
        '          // Save to Inventory) are reachable from the radial menu when\n'
        '          // the asset is held. Visual file info is baked into the\n'
        '          // misc-file canvas texture in AssetManager.createMiscFileObject.\n'
        '        }\n'
    ),
))

# 8. Remove the MiscFileModal JSX block. The actual code in App.tsx
#    uses the simpler `metadata: a.metadata` form (no `url` field, no
#    fallback expression), which is what tripped the previous script.
edits.append((
    'MiscFileModal JSX',
    (
        '      {inspectedMiscAsset && (\n'
        '        <MiscFileModal\n'
        '          asset={inspectedMiscAsset}\n'
        '          onClose={() => setInspectedMiscAsset(null)}\n'
        '          onDownload={(a) => assetManagerRef.current?.downloadAsset(a)}\n'
        '          onSaveToInventory={async (a) => {\n'
        '            const item: InventoryItem = {\n'
        '              id: a.id,\n'
        '              name: a.name,\n'
        '              type: a.type,\n'
        '              createdAt: Date.now(),\n'
        '              fileData: a.fileData,\n'
        '              metadata: a.metadata\n'
        '            };\n'
        '            await inventoryServiceRef.current.saveItem(item);\n'
        '          }}\n'
        '        />\n'
        '      )}\n\n'
    ),
    '',
))

# 9. Add onDownloadHeld + heldAssetType props to RadialContextMenu.
edits.append((
    'RadialContextMenu props',
    (
        '        isHeld={isHeld}\n'
        '        onDestroy={handleDestroyHeld}\n'
        '        onDuplicate={handleDuplicateHeld}\n'
        '        onSaveHeld={handleSaveHeldToInventory}\n'
    ),
    (
        '        isHeld={isHeld}\n'
        '        heldAssetType={heldAssetType}\n'
        '        onDestroy={handleDestroyHeld}\n'
        '        onDuplicate={handleDuplicateHeld}\n'
        '        onSaveHeld={handleSaveHeldToInventory}\n'
        '        onDownloadHeld={handleDownloadHeld}\n'
    ),
))

# 10. Add handleDownloadHeld useCallback right after handleSaveHeldToInventory.
edits.append((
    'handleDownloadHeld',
    (
        '  const handleSaveHeldToInventory = useCallback(() => {\n'
        '    const mm = manipulationManagerRef.current;\n'
        '    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;\n'
        '    if (!held) return;\n'
        '    const asset = held;\n'
        '    const item: InventoryItem = {\n'
        '      id: asset.id,\n'
        '      name: asset.name,\n'
        '      type: asset.type,\n'
        '      createdAt: Date.now(),\n'
        '      fileData: asset.fileData,\n'
        '      url: asset.url,\n'
        '      metadata:\n'
        '        asset.metadata ||\n'
        '        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),\n'
        '    };\n'
        '    inventoryServiceRef.current.saveItem(item).then(() => {\n'
        '      console.log(\'[Inventory] Saved held "\' + asset.name + \'" to inventory\');\n'
        '    });\n'
        '  }, []);\n'
    ),
    (
        '  const handleSaveHeldToInventory = useCallback(() => {\n'
        '    const mm = manipulationManagerRef.current;\n'
        '    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;\n'
        '    if (!held) return;\n'
        '    const asset = held;\n'
        '    const item: InventoryItem = {\n'
        '      id: asset.id,\n'
        '      name: asset.name,\n'
        '      type: asset.type,\n'
        '      createdAt: Date.now(),\n'
        '      fileData: asset.fileData,\n'
        '      url: asset.url,\n'
        '      metadata:\n'
        '        asset.metadata ||\n'
        '        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),\n'
        '    };\n'
        '    inventoryServiceRef.current.saveItem(item).then(() => {\n'
        '      console.log(\'[Inventory] Saved held "\' + asset.name + \'" to inventory\');\n'
        '    });\n'
        '  }, []);\n'
        '\n'
        '  // Download the held asset to the user\'s device. Currently only\n'
        '  // meaningful for misc files (which carry raw fileData) — the radial\n'
        '  // menu shows this action only when the held asset\'s type is\n'
        '  // \'misc\', so for other types this callback is never wired to a\n'
        '  // slice. AssetManager.downloadAsset already no-ops on assets that\n'
        '  // lack fileData / url, so this is safe to call defensively.\n'
        '  const handleDownloadHeld = useCallback(() => {\n'
        '    const mm = manipulationManagerRef.current;\n'
        '    const am = assetManagerRef.current;\n'
        '    if (!am) return;\n'
        '    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;\n'
        '    if (!held) return;\n'
        '    am.downloadAsset(held);\n'
        '  }, []);\n'
    ),
))

# Apply edits in order. Bail out on the first missing anchor so we
# don't silently half-apply the script (the previous failure mode).
for name, old, new in edits:
    if old == '':
        # Special case: empty old string with empty new is a no-op
        # (only valid when the caller intends to delete nothing).
        continue
    if old not in src:
        print(f'ERROR: anchor for "{name}" not found', file=sys.stderr)
        # Print the first 80 chars of `old` to help diagnose
        print(f'  anchor starts with: {old[:80]!r}', file=sys.stderr)
        sys.exit(1)
    src = src.replace(old, new, 1)
    print(f'  applied: {name}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('All App.tsx edits applied successfully.')
