"""
Apply targeted in-place edits to src/components/SceneInspectorWindow.tsx to
broadcast transform-only updates (typed-in position/rotation/scale values,
the per-axis reset buttons, Reset All, and Center Pivot) through the
existing realtime transform channel that the gizmo already uses.

Edits (after each edit, re-read the file to find the next target):
  1. Add `onBroadcastAssetUpdate?: (asset: LoadedAsset) => void;` to the props
     interface (after `onBroadcastInspectorUpdate`).
  2. Add `onBroadcastAssetUpdate,` to the destructure list (after
     `onBroadcastInspectorUpdate,`).
  3. In `applyTransform`, after `onUpdateAsset(...)`, add
     `onBroadcastAssetUpdate?.(selectedAsset);` so all callers of
     applyTransform (numeric inputs + each Reset button + Reset All)
     broadcast their edit.
  4. In the Center Pivot button's onClick, after the onUpdateAsset call,
     add `onBroadcastAssetUpdate?.(selectedAsset);`.
  5. In `handleDeleteMeshGizmo`, after `setMeshEnabled(false)`, add
     `onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, meshEnabled: false });`
     so peers hide the meshes via the existing receive path
     (`if (update.meshEnabled !== undefined) child.visible = update.meshEnabled`).
"""

import io
import re
import sys
from pathlib import Path

FILE = Path("src/components/SceneInspectorWindow.tsx")
src = FILE.read_text(encoding="utf-8")

original_len = len(src)
summary = []

def replace_once(label: str, pattern: str, replacement: str) -> bool:
    global src
    new_src, count = re.subn(pattern, replacement, src, count=1, flags=re.MULTILINE)
    if count != 1:
        summary.append(f"[SKIP] {label}: matched {count} times (expected exactly 1)")
        return False
    src = new_src
    summary.append(f"[OK]   {label}: replaced (count=1, bytes before={len(src)})")
    return True


# Edit 1: add onBroadcastAssetUpdate? to props interface (after onBroadcastInspectorUpdate?)
replace_once(
    label="props interface",
    pattern=(
        r"(\s+onBroadcastInspectorUpdate\?:\s*\(update:\s*InspectorUpdateData\)\s*=>\s*void;\n)"
    ),
    replacement=(
        r"\1"
        r"  /**\n"
        r"   * Broadcast a transform-only update via the realtime `trans`\n"
        r"   * channel. Wired by App.tsx to NetworkService.broadcastAssetUpdate,\n"
        r"   * which encodes the asset's CURRENT transform (object3d.position\n"
        r"   * / .rotation / .scale) into a TransformUpdate envelope that\n"
        r"   * peers apply via ManipulationManager.applyRemoteTransform.\n"
        r"   * Same channel the gizmo uses, so inspector-driven edits feel\n"
        r"   * identical to drag-driven edits on the wire (no JSON\n"
        r"   * overhead, no head-of-line blocking on the reliable channel).\n"
        r"   *\n"
        r"   * Used by:\n"
        r"   *   - applyTransform (keyboard-typed position/rotation/scale\n"
        r"   *     inputs + per-axis Reset Pos/Rot/Scale + Reset All)\n"
        r"   *   - the Center Pivot button\n"
        r"   * Gizmo drags do NOT need this — manipulationManager already\n"
        r"   * broadcasts every transformChange directly via its own listener.\n"
        r"   */\n"
        r"  onBroadcastAssetUpdate?: (asset: LoadedAsset) => void;\n"
    ),
)


# Edit 2: add to destructure list (after `onBroadcastInspectorUpdate,`)
replace_once(
    label="destructure list",
    pattern=(
        r"(\s+onBroadcastInspectorUpdate,\n)"
    ),
    replacement=(
        r"\1"
        r"  onBroadcastAssetUpdate,\n"
    ),
)


# Edit 3: broadcast at end of applyTransform
# applyTransform ends with `onUpdateAsset({ ...selectedAsset });\n  };`
replace_once(
    label="applyTransform broadcast",
    pattern=(
        r"(selectedAsset\.object3d\.scale\.set\(newScale\.x,\s*newScale\.y,\s*newScale\.z\);\n"
        r"\s*onUpdateAsset\(\{\s*\.\.\.selectedAsset\s*\}\);\n\s*\};)"
    ),
    replacement=(
        r"\1.prefix_broadcast"
    ),
)
# The previous regex deliberately fails; do a simpler edit instead:
replace_once(
    label="applyTransform broadcast (direct)",
    pattern=(
        r"(\s+selectedAsset\.object3d\.scale\.set\(newScale\.x, newScale\.y, newScale\.z\);\n)"
        r"(\s+onUpdateAsset\(\{ \.\.\.selectedAsset \}\);\n)"
        r"(\s+\};)"
    ),
    replacement=(
        r"\1\2  onBroadcastAssetUpdate?.(selectedAsset);\n\3"
    ),
)


# Edit 4: broadcast in Center Pivot button onClick
# Pattern matches the specific inline onClick of the Center Pivot button.
replace_once(
    label="Center Pivot broadcast",
    pattern=(
        r"(<button onClick=\{\(\)\s*=>\s*\{\s*if\s*\(selectedAsset\)\s*\{\s*selectedAsset\.object3d\.position\.set\(0,\s*1\.5,\s*0\);\s*onUpdateAsset\(\{\s*\.\.\.selectedAsset\s*\}\);\s*\}\s*\}\})"
    ),
    replacement=(
        r"<button onClick={() => { if (selectedAsset) { selectedAsset.object3d.position.set(0, 1.5, 0); onUpdateAsset({ ...selectedAsset }); onBroadcastAssetUpdate?.(selectedAsset); } }}"
    ),
)


# Edit 5: broadcast meshEnabled:false in handleDeleteMeshGizmo
replace_once(
    label="handleDeleteMeshGizmo broadcast",
    pattern=(
        r"(const handleDeleteMeshGizmo\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n)"
        r"(\s+setMeshEnabled\(false\);\n)"
        r"(\s+onUpdateAsset\(\{ \.\.\.selectedAsset \}\);\n\s*\};)"
    ),
    replacement=(
        r"\1\2"
        r"    // Sync mesh-renderer toggle to peers — same `meshEnabled` field\n"
        r"    // already wired on the receive side (`if (update.meshEnabled\n"
        r"    // !== undefined) child.visible = update.meshEnabled!`), so the\n"
        r"    // peer's hide-mesh-on-disable path runs identically for both\n"
        r"    // the Enabled checkbox and the Del Mesh button.\n"
        r"    onBroadcastInspectorUpdate?.({ assetId: selectedAsset.id, nodeUuid: undefined, meshEnabled: false });\n"
        r"\3"
    ),
)


new_len = len(src)
FILE.write_text(src, encoding="utf-8")

print(f"file size: {original_len} -> {new_len} bytes ({(new_len-original_len):+d})")
print("summary:")
for line in summary:
    print("  " + line)
