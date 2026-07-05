#!/usr/bin/env python3
"""UX bug fix: "Duplicate" while holding should leave the duplicate in
place and KEEP the original held so the user can drag the original
away. Previously swapGrabbedAsset() transferred the grab onto the
duplicate, dropping the original so the user was stuck holding the
new copy right in front of them.

Two locations:
  - handleDuplicateHeld (held tab Duplicate verb)
  - handleDuplicateSelected (shortcut-key Duplicate path, which only
    swaps when the duplicated asset is also the currently-grabbed one)
"""
import io
PATH = "App.tsx"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
original = src

OLD = """      // Duplicate-while-holding: keep holding the DUPLICATE, not
      // the original. swapGrabbedAsset atomically ends the current
      // grab on `asset` and starts an equivalent grab on
      // `newAsset` (same VR-side when applicable, cursor-anchored
      // RMB-grab on desktop). No-op during a two-handed grab --
      // that path would need the live grip world positions to
      // re-establish the scale, which is intentionally out of
      // scope here. Guard is always-true for the held-tab
      // Duplicate verb (handleDuplicateHeld sets asset =
      // grabbedAsset by construction) and only fires for
      // handleDuplicateSelected when the selected asset happens
      // to also be currently grabbed.
      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {
        manipulationManagerRef.current?.swapGrabbedAsset(newAsset);
      } else {
        manipulationManagerRef.current?.selectAsset(newAsset);
      }"""

NEW = """      // Duplicate-while-holding: leave the DUPLICATE in place and
      // select it (so the inspector + gizmo follow the new instance),
      // while KEEPING the original under the user's grab. The user
      // can then drag the original away from the duplicate that's
      // now floating in front of them, which is the natural Resonite
      // "duplicate-then-tug" workflow. The previous behaviour called
      // swapGrabbedAsset(), which atomically transferred the grab to
      // the duplicate and dropped the original — making the
      // duplicate held and the original free-floating instead of the
      // reverse. Guard matches the original: the held-tab Duplicate
      // verb (handleDuplicateHeld) and handleDuplicateSelected when
      // the selected asset happens to also be currently grabbed both
      // reach this branch. For all other entry points (RMB-grab not
      // selected, neither grabbed nor selected) the existing select
      // fallback fires.
      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {
        // Original stays held — DO NOT touch the grab. Just retarget
        // the inspector + gizmo to the duplicate. The ManipulationManager
        // continues to apply its carry math (update()/updateGrabbedAssetPosition
        // for RMB-grab; vrGrabWithController-attached parent for
        // VR-grip; two-handed scale-factor multiplier) to the original.
        manipulationManagerRef.current?.selectAsset(newAsset);
      } else {
        manipulationManagerRef.current?.selectAsset(newAsset);
      }"""

# Replace ALL occurrences (both handleDuplicateHeld and handleDuplicateSelected)
# by counting occurrences and replacing iteratively until empty.
count = 0
while OLD in src:
    src = src.replace(OLD, NEW, 1)
    count += 1
print(f"[ok] replaced {count} grab-block occurrences")

if src != original:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] App.tsx saved ({len(src) - len(original):+d} bytes)")
else:
    print("[noop] unchanged")
