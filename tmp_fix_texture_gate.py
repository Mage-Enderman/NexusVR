"""Fix remaining mirror-keyboard-exploit class gap found by code review:
`handleApplyTextureSlot` (Albedo / Normal / Roughness / Metallic / AO
texture slot dropdown in the inspector's Texture Slots section) calls
`AssetManager.applyMaterialUpdate` + `onBroadcastMaterial?.(update)` +
`onUpdateAsset(...)` with only `if (!selectedAsset) return;` — no
`!interactive` check. This is the same exploit class as the four gates
we just added (Active toggle being the user's #1 priority): CSS
pointer-events:none blocks mouse clicks on the read-only mirror
inspector, but Tab+Space/Enter still fires onChange/onClick on the
focusable elements, so a peer whose role denies edit access could
still switch texture slots and rebroadcast to the world.

The fix mirrors exactly the pattern already used by `handleUpdateMaterial`,
`handleUpdateLightConfig`, etc.
"""
from pathlib import Path

p = Path("src/components/SceneInspectorWindow.tsx")
src = p.read_text(encoding="utf-8")

old = (
    "  const handleApplyTextureSlot = (slotName: string, url: string | null) => {\n"
    "    if (!selectedAsset) return;\n"
    "\n"
    "    const update: MaterialUpdate = {\n"
    "      assetId: selectedAsset.id,\n"
    "      materialIndex: selectedMaterialIndex >= 0 ? selectedMaterialIndex : undefined,\n"
    "      [slotName]: url\n"
    "    };\n"
    "\n"
    "    AssetManager.applyMaterialUpdate(selectedAsset, update);\n"
    "    onBroadcastMaterial?.(update);\n"
    "    onUpdateAsset({ ...selectedAsset });\n"
    "  };"
)
new = (
    "  const handleApplyTextureSlot = (slotName: string, url: string | null) => {\n"
    "    // Mirror-safety: same exploit class as the 4 onChange handlers we\n"
    "    // already gated (Active toggle was the user's #1 priority).\n"
    "    // Texture slot dropdown can be fired via keyboard, since the\n"
    "    // pointer-events:none CSS only blocks mouse clicks.\n"
    "    if (!interactive || !selectedAsset) return;\n"
    "\n"
    "    const update: MaterialUpdate = {\n"
    "      assetId: selectedAsset.id,\n"
    "      materialIndex: selectedMaterialIndex >= 0 ? selectedMaterialIndex : undefined,\n"
    "      [slotName]: url\n"
    "    };\n"
    "\n"
    "    AssetManager.applyMaterialUpdate(selectedAsset, update);\n"
    "    onBroadcastMaterial?.(update);\n"
    "    onUpdateAsset({ ...selectedAsset });\n"
    "  };"
)
count = src.count(old)
assert count == 1, f"handleApplyTextureSlot: expected 1 match, got {count}"
src = src.replace(old, new)
p.write_text(src, encoding="utf-8")
print(f"OK texture slot gate added (file_size_chars={len(src)})")
