"""Apply two correctness fixes flagged by code review of the
inspector→peer sync feature:

FIX A (multiplayer safety): the four onChange handlers below mutate
`selectedAsset` and broadcast on the new inspector channel WITHOUT
first checking `!interactive`. CSS pointer-events:none blocks mouse
clicks on the read-only mirror inspector, but Tab+Space/Enter still
fires onChange on focusable form elements — meaning a peer whose
permission role denies edit access can still toggle the Active,
Persistent, and Light-Trash controls and rebroadcast to the world
(a real multiplayer-safety hole).

FIX B (parentToWorld divergence): sender uses `scene.attach(target)`
but receiver in App.tsx uses `sceneEngine.worldRoot.attach(targetNode)`.
If `sceneEngine.worldRoot !== scene`, viewers see the node attached
to a different parent than the host intended. Fix: thread the
worldRoot reference down through a new `worldRoot?` prop so the
sender uses the same scene-graph node the receiver already uses.

Adds to InspectorUpdateData / receive handler: worldRootUuid is
already implicit (the receiver finds its own worldRoot). We just
need sender+receiver to point at the same Node3D.
"""
from pathlib import Path

inspector = Path("src/components/SceneInspectorWindow.tsx")
app = Path("src/App.tsx")
ins = inspector.read_text(encoding="utf-8")
app_src = app.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# FIX A1 — Name input onChange: gate behind !interactive
# ---------------------------------------------------------------------------
# Before:
#   onChange={(e) => { setAssetName(e.target.value); if (selectedAsset) {
#     selectedAsset.name = e.target.value; onUpdateAsset({ ...selectedAsset });
#     onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, name: e.target.value }); } }}
# After: gate the broadcast/mutation; React state still updates so the
# controlled input continues to feel responsive on the read-only mirror
# (otherwise the keystroke is invisible to the mirror user which would
# be confusingly broken UI).
name_old = (
    "onChange={(e) => { setAssetName(e.target.value); if (selectedAsset) { selectedAsset.name = e.target.value; onUpdateAsset({ ...selectedAsset }); onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, name: e.target.value }); } }}"
)
name_new = (
    "onChange={(e) => { setAssetName(e.target.value); if (!interactive || !selectedAsset) return; selectedAsset.name = e.target.value; onUpdateAsset({ ...selectedAsset }); onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, name: e.target.value }); }}"
)
assert ins.count(name_old) == 1, f"Name input onChange: expected 1 match, got {ins.count(name_old)}"
ins = ins.replace(name_old, name_new)


# ---------------------------------------------------------------------------
# FIX A2 — Active checkbox: gate behind !interactive
# ---------------------------------------------------------------------------
active_old = (
    "onChange={(e) => { setActive(e.target.checked); if (selectedAsset) { selectedAsset.object3d.visible = e.target.checked; onUpdateAsset({ ...selectedAsset }); onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, active: e.target.checked }); } }}"
)
active_new = (
    "onChange={(e) => { setActive(e.target.checked); if (!interactive || !selectedAsset) return; selectedAsset.object3d.visible = e.target.checked; onUpdateAsset({ ...selectedAsset }); onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, active: e.target.checked }); }}"
)
assert ins.count(active_old) == 1, f"Active checkbox onChange: expected 1 match, got {ins.count(active_old)}"
ins = ins.replace(active_old, active_new)


# ---------------------------------------------------------------------------
# FIX A3 — Persistent checkbox: gate behind !interactive
# ---------------------------------------------------------------------------
# Find the persistent onChange block. The pattern uses an if-branch
# inside the onChange arrow, exactly as wired by the prior edit.
persistent_old = (
    "                      if (selectedAsset) {\n"
    "                        selectedAsset.object3d.userData.isPersistent = e.target.checked;\n"
    "                        onUpdateAsset({ ...selectedAsset });\n"
    "                        onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, persistent: e.target.checked });\n"
    "                      }"
)
persistent_new = (
    "                      if (!interactive || !selectedAsset) return;\n"
    "                      selectedAsset.object3d.userData.isPersistent = e.target.checked;\n"
    "                      onUpdateAsset({ ...selectedAsset });\n"
    "                      onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, persistent: e.target.checked });"
)
assert ins.count(persistent_old) == 1, f"Persistent checkbox onChange: expected 1 match, got {ins.count(persistent_old)}"
ins = ins.replace(persistent_old, persistent_new)


# ---------------------------------------------------------------------------
# FIX A4 — Light Source Trash button: gate behind !interactive
# ---------------------------------------------------------------------------
# The Trash button next to the Light Source header calls
# removeLightComponent + broadcasts resoniteLight:null. Currently only
# checks `if (selectedAsset)`, missing the !interactive gate.
light_trash_old = (
    "                    onClick={(e) => {\n"
    "                      e.stopPropagation();\n"
    "                      if (selectedAsset) {\n"
    "                        removeLightComponent(selectedAsset.object3d);\n"
    "                        setAttachedComponents(attachedComponents.filter((c) => c !== 'Light Source'));\n"
    "                        onUpdateAsset({ ...selectedAsset });\n"
    "                        onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, resoniteLight: null });\n"
    "                      }\n"
    "                    }}"
)
light_trash_new = (
    "                    onClick={(e) => {\n"
    "                      e.stopPropagation();\n"
    "                      if (!interactive || !selectedAsset) return;\n"
    "                      removeLightComponent(selectedAsset.object3d);\n"
    "                      setAttachedComponents(attachedComponents.filter((c) => c !== 'Light Source'));\n"
    "                      onUpdateAsset({ ...selectedAsset });\n"
    "                      onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, resoniteLight: null });\n"
    "                    }}"
)
assert ins.count(light_trash_old) == 1, f"Light Trash onClick: expected 1 match, got {ins.count(light_trash_old)}"
ins = ins.replace(light_trash_old, light_trash_new)


# ---------------------------------------------------------------------------
# FIX B1 — Add `worldRoot?: THREE.Object3D` prop to inspector interface
# ---------------------------------------------------------------------------
# Insert after scene/camera/assetManager/spatialPanelManager and before the
# `videoActions` cluster.
world_root_prop_block = (
    "  scene?: THREE.Scene;\n"
    "  camera?: THREE.Camera;\n"
    "  assetManager?: AssetManager;\n"
    "  spatialPanelManager?: SpatialPanelManager;\n"
    "  /**\n"
    "   * Optional world-root Group3D — pass when there are TWO distinct\n"
    "   * containers in scene (e.g. THREE.Scene itself vs a dedicated\n"
    "   * `worldRoot` Group). When provided, the inspector's\n"
    "   * 'Parent Under World' hierarchy button re-parents under this\n"
    "   * node instead of `scene`, matching the receive-side path\n"
    "   * (`sceneEngine.worldRoot.attach(...)`) so the broadcast is\n"
    "   * symmetric across all peers. When null/missing, the inspector\n"
    "   * falls back to attaching to `scene`.\n"
    "   */\n"
    "  worldRoot?: THREE.Object3D | null;\n"
)
# The exact existing 3-line block we need to anchor against:
anchor = "  scene?: THREE.Scene;\n  camera?: THREE.Camera;\n  assetManager?: AssetManager;\n  spatialPanelManager?: SpatialPanelManager;\n"
if anchor in ins:
    ins = ins.replace(anchor, world_root_prop_block, 1)
else:
    raise SystemExit("FIX B1: prop cluster anchor not found")


# ---------------------------------------------------------------------------
# FIX B2 — Destructure worldRoot from props
# ---------------------------------------------------------------------------
dest_anchor = (
    "  spatialPanelManager,\n"
    "  videoActions,\n"
    "  targetObject,\n"
)
dest_target = (
    "  spatialPanelManager,\n"
    "  videoActions,\n"
    "  targetObject,\n"
    "  worldRoot,\n"
)
if dest_anchor in ins and dest_target not in ins:
    ins = ins.replace(dest_anchor, dest_target, 1)
else:
    raise SystemExit("FIX B2: destructure anchor not in expected state")


# ---------------------------------------------------------------------------
# FIX B3 — Use worldRoot ?? scene in handleParentUnderWorld
# ---------------------------------------------------------------------------
# Current:  scene.attach(target);
# Target:   (worldRoot ?? scene).attach(target);
parent_old = (
    "    if (!selectedAsset || !scene) return;\n"
    "    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;\n"
    "    scene.attach(target);\n"
)
parent_new = (
    "    if (!selectedAsset) return;\n"
    "    const attachRoot = worldRoot ?? scene;\n"
    "    if (!attachRoot) return;\n"
    "    const target = findObjectByUUID(selectedAsset.object3d, selectedNodeUUID) ?? selectedAsset.object3d;\n"
    "    attachRoot.attach(target);\n"
)
assert ins.count(parent_old) == 1, f"handleParentUnderWorld: expected 1 match, got {ins.count(parent_old)}"
ins = ins.replace(parent_old, parent_new)


# ---------------------------------------------------------------------------
# Write the inspector file back
# ---------------------------------------------------------------------------
inspector.write_text(ins, encoding="utf-8")
print(f"OK inspector: file_size_chars={len(ins)}")


# ---------------------------------------------------------------------------
# FIX B4 — App.tsx: pass worldRoot=sceneEngine?.worldRoot to inspector
# ---------------------------------------------------------------------------
# The SceneInspectorWindow JSX usage is around line 5070+. Find a
# stable anchor — the `onClose={() => handleToggleInspector(...)`
# isn't great. Anchor on `onBroadcastAssetUpdate={(asset) => {\n
#           networkServiceRef.current.broadcastAssetUpdate(asset);\n`
# and insert `worldRoot={...}` right after it.
app_anchor = (
    "        onBroadcastAssetUpdate={(asset) => {\n"
    "          networkServiceRef.current.broadcastAssetUpdate(asset);\n"
    "        }}\n"
)
app_target = (
    "        onBroadcastAssetUpdate={(asset) => {\n"
    "          networkServiceRef.current.broadcastAssetUpdate(asset);\n"
    "        }}\n"
    # Pass the shared worldRoot so the sender's `worldRoot ?? scene`
    # fallback picks worldRoot and matches the receive handler's
    # `sceneEngine?.worldRoot.attach(...)` path. Optional + null-safe
    # to keep the call site readable when sceneEngine isn't mounted.
    "        worldRoot={sceneEngineRef.current?.worldRoot ?? null}\n"
)
assert app_src.count(app_anchor) == 1, f"App.tsx anchor: expected 1 match, got {app_src.count(app_anchor)}"
app_src = app_src.replace(app_anchor, app_target, 1)
app.write_text(app_src, encoding="utf-8")
print(f"OK app: file_size_chars={len(app_src)}")
