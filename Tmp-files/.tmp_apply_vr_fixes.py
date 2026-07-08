#!/usr/bin/env python3
"""Two App.tsx edits via Python (bypasses str_replace 100K limit):
   (1) Pass `worldRoot` to `new EnvironmentManager(...)`
   (2) Insert HUD raycast BEFORE asset raycast in the right-grip handler,
       plus detach HUD on right-grip release.
"""
import sys
from pathlib import Path

SRC = Path("src/App.tsx")
text = SRC.read_text(encoding="utf-8")  # universal newlines -> LF in memory

EDITS: list[tuple[str, str, str]] = []

# ---------------------------------------------------------------------------
# Edit 1: EnvironmentManager constructor call site.
# ---------------------------------------------------------------------------
EDITS.append((
    "EnvironmentManager constructor call",
    """    const environmentManager = new EnvironmentManager(sceneEngine.scene, sceneEngine.ambientLight, sceneEngine.dirLight);""",
    """    const environmentManager = new EnvironmentManager(
      sceneEngine.scene,
      sceneEngine.worldRoot,  // <- NEW: grid lives under worldRoot so VR
                              //         inverse-treadmill translates it
                              //         together with the floor
                              //         (was previously parented to scene
                              //          which made the grid appear to
                              //          "rise with the player" on jump).
      sceneEngine.ambientLight,
      sceneEngine.dirLight
    );"""
))

# ---------------------------------------------------------------------------
# Edit 2: Right-grip press handler should raycast the HUD's curved screen /
# grab bar BEFORE scanning assetManager.assets so the user can grab and
# reposition the dashboard in VR. Uses HUD's existing grabBarMesh + the
# curved screen mesh as targets, then attachToGrip via THREE attach.
# ---------------------------------------------------------------------------
OLD_GRIP_PRESS = """            // Grip buttons. Left grip opens the VR dash menu (curved HUD);
            // right grip grabs the asset under the right controller's aim.
            if (button === 'grip') {
              if (side === 'left') {
                inventoryServiceRef.current.getItems().then((items) => {
                  vrHudRef.current?.setItems(items);
                  vrHudRef.current?.toggle();
                });
                return;
              }
              if (side === 'right') {
                if (!mm || !am) return;
                // Resolve the physical right-hand controller via the
                // device-reported handedness (NOT controller2 — that's a
                // render index that swaps for left-handed Quest users).
                const ctr = se.vrInput?.getController('right');
                const grip = se.vrInput?.getGrip('right');
                if (!ctr || !grip) return;
                ctr.updateWorldMatrix(true, false);
                const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
                const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                se.raycaster.set(origin, dir);
                const targets: THREE.Object3D[] = [];
                const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
                am.assets.forEach((a) => {
                  targets.push(a.object3d);
                  objToAsset.set(a.object3d, a);
                });
                const hits = se.raycaster.intersectObjects(targets, true);"""

NEW_GRIP_PRESS = """            // Grip buttons. Left grip opens the VR dash menu (curved HUD);
            // right grip grabs the asset under the right controller's aim —
            // OR the HUD itself if its grab bar / curved screen is in the
            // ray path (HUD takes priority while it's visible).
            if (button === 'grip') {
              if (side === 'left') {
                inventoryServiceRef.current.getItems().then((items) => {
                  vrHudRef.current?.setItems(items);
                  vrHudRef.current?.toggle();
                });
                return;
              }
              if (side === 'right') {
                const ctr = se.vrInput?.getController('right');
                const grip = se.vrInput?.getGrip('right');
                const hud = vrHudRef.current;
                if (!ctr || !grip) return;
                ctr.updateWorldMatrix(true, false);
                const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
                const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
                se.raycaster.set(origin, dir);

                // HUD grab takes priority when visible. THREE.attach(...)
                // preserves world transform during the reparent so the
                // HUD doesn't snap to the grip's local origin.
                if (hud && hud.isVisible) {
                  const hudHits = se.raycaster.intersectObjects(
                    [hud.curvedScreenMesh, hud.grabBarMesh],
                    true
                  );
                  if (hudHits.length > 0) {
                    hud.attachToGrip(grip);
                    return;
                  }
                }

                if (!mm || !am) return;
                const targets: THREE.Object3D[] = [];
                const objToAsset = new Map<THREE.Object3D, LoadedAsset>();
                am.assets.forEach((a) => {
                  targets.push(a.object3d);
                  objToAsset.set(a.object3d, a);
                });
                const hits = se.raycaster.intersectObjects(targets, true);"""

EDITS.append(("Right-grip press HUD priority", OLD_GRIP_PRESS, NEW_GRIP_PRESS))

# ---------------------------------------------------------------------------
# Edit 3: Right-grip release should also detach the HUD if currently held.
# ---------------------------------------------------------------------------
OLD_RELEASE = """        onReleased: (button, side) => {
          const mm = manipulationManagerRef.current;
          if (!mm) return;
          // Distinguish sides so a brief left-grip tap doesn't drop a
          // right-grip-held object. vrReleaseControllerGrab itself
          // no-ops when not mid-grab (`_isVRGrabbing === false`), so
          // double-routing both sides would be safe; doing it
          // side-aware also avoids spurious log lines in unknown grab
          // states.
          if (button === 'grip' && side === 'right') {
            mm.vrReleaseControllerGrab();
          }
        }"""

NEW_RELEASE = """        onReleased: (button, side) => {
          const mm = manipulationManagerRef.current;
          if (!mm) return;
          // Distinguish sides so a brief left-grip tap doesn't drop a
          // right-grip-held object. vrReleaseControllerGrab itself
          // no-ops when not mid-grab (`_isVRGrabbing === false`), so
          // double-routing both sides would be safe; doing it
          // side-aware also avoids spurious log lines in unknown grab
          // states.
          if (button === 'grip' && side === 'right') {
            mm.vrReleaseControllerGrab();
            // Drop the HUD too if it was carried by the right grip.
            // VRHUDManager.detach() re-parents to scene preserving
            // world transform via THREE.attach semantics.
            const hud = vrHudRef.current;
            if (hud && hud.currentGrip) hud.detach();
          }
        }"""

EDITS.append(("Right-grip release HUD detach", OLD_RELEASE, NEW_RELEASE))

# ---------------------------------------------------------------------------
# Apply.
# ---------------------------------------------------------------------------
applied = skipped = 0
for label, old, new in EDITS:
    count = text.count(old)
    if count == 1:
        text = text.replace(old, new, 1)
        print(f"[OK]   {label}: applied.")
        applied += 1
    elif count == 0:
        print(f"[SKIP] {label}: anchor missing.")
        skipped += 1
    else:
        print(f"[ERR]  {label}: matched {count} times (expected 0/1). Aborting.")
        sys.exit(1)

SRC.write_text(text, encoding="utf-8")
print(f"\n[DONE] Applied={applied}, skipped={skipped}. Wrote {SRC} ({len(text)} chars).")
