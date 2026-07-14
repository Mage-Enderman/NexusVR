"""Wire the new onBroadcastAssetUpdate prop on the SceneInspectorWindow
usage in App.tsx so keyboard-driven inspector transform changes
(position/rotation/scale inputs + per-axis Reset buttons + Reset All
+ Center Pivot) broadcast transforms to peers over the existing 'trans'
channel instead of being a silent local-only mutation.

The new prop matches the existing `transformChange` payload contract:
the handler simply calls `broadcastAssetUpdate` with the asset the
inspector hands us, which encodes object3d.{position,rotation,scale}
into a TransformUpdate envelope that peers apply via
ManipulationManager.applyRemoteTransform. This is the same channel the
gizmo drag listener (manipulationManager.registerOnTransformChange)
already uses, so the wire path is identical — no JSON overhead, no
head-of-line blocking on the reliable channel.

Editor gates (`if (!interactive) return;`) are already in the inspector
handlers themselves, so read-only mirror clients never invoke this
handler.
"""
from pathlib import Path

p = Path("src/App.tsx")
src = p.read_text(encoding="utf-8")

# Add the prop right after the existing onBroadcastInspectorUpdate
# arrow so the wiring reads as a coherent block of network plumbing
# (Material → Inspector → Asset transforms).
old = (
    "        onBroadcastInspectorUpdate={(update: InspectorUpdateData) => {\n"
    "          networkServiceRef.current.broadcastInspectorUpdate(update);\n"
    "        }}\n"
)
new = (
    "        onBroadcastInspectorUpdate={(update: InspectorUpdateData) => {\n"
    "          networkServiceRef.current.broadcastInspectorUpdate(update);\n"
    "        }}\n"
    "        onBroadcastAssetUpdate={(asset) => {\n"
    "          networkServiceRef.current.broadcastAssetUpdate(asset);\n"
    "        }}\n"
)
count = src.count(old)
assert count == 1, f"Expected exactly 1 match, got {count}"
src = src.replace(old, new)
p.write_text(src, encoding="utf-8")
print(f"OK -- wired onBroadcastAssetUpdate (file_size_chars={len(src)})")
