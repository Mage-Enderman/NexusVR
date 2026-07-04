path = 'src/App.tsx'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ============================================================
# FIX 1: Change the left-grip handler to do a left-hand grab
# (mirror the right-grip logic) instead of opening the dash.
# The right-grip block is large and the cleanest fix is to
# extract the raycast+grab into a helper closure that takes a
# side, then call it from BOTH left and right grip branches.
# ============================================================

# The existing left-grip block is uniquely identified by its
# `getItems().then` + `vrHudRef.current?.toggle()` call. Replace it
# with a comment + the shared helper invocation.
old_left_grip = """            if (side === 'left') {
              inventoryServiceRef.current.getItems().then((items) => {
                vrHudRef.current?.setItems(items);
                vrHudRef.current?.toggle();
              });
              return;
            }
            if (side === 'right') {
              if (!mm || !am) return;
              // Resolve the physical right-hand controller via the
              // device-reported handedness (NOT controller2 \u2014 that's a
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
              // Include the VR HUD grab bars (dash + open panel) in the
              // same raycast pass so the user can physically carry them
              // with the right grip. The grab bar has an invisible proxy
              // child (1.4m wide) for off-axis aim forgiveness; the
              // parent-walk below resolves a proxy hit up to the grab
              // bar mesh itself so the parent check is exact. HUD grab
              // is prioritized over asset grab because reaching for a
              // floating panel is the more common reflex than reaching
              // through the panel to grab an asset behind it.
              const hudForGrip = vrHudRef.current;
              if (hudForGrip && hudForGrip.isVisible) targets.push(hudForGrip.grabBarMesh);
              if (hudForGrip && hudForGrip.activePanel) targets.push(hudForGrip.panelGrabBarMesh);
              const hits = se.raycaster.intersectObjects(targets, true);
              if (hits.length > 0) {
                // Walk the parent chain of the closest hit looking for a
                // grab bar mesh. If found, attach and skip the asset-grab
                // branch \u2014 prevents a HUD-covered asset from being
                // accidentally grabbed when the user aims at the HUD.
                let hudCur: THREE.Object3D | null = hits[0].object;
                while (hudCur) {
                  if (hudForGrip && hudCur === hudForGrip.grabBarMesh) {
                    hudForGrip.attachToGrip(grip);
                    return;
                  }
                  if (hudForGrip && hudCur === hudForGrip.panelGrabBarMesh) {
                    hudForGrip.attachPanelToGrip(grip);
                    return;
                  }
                  hudCur = hudCur.parent;
                }
                // Otherwise, fall through to the existing world-asset grab.
                let cur: THREE.Object3D | null = hits[0].object;
                while (cur && !objToAsset.has(cur)) cur = cur.parent;
                if (cur) {
                  const found = objToAsset.get(cur);
                  if (found) mm.vrGrabWithController(found, grip, side);
                }
              }
              return;
            }"""

new_left_grip = """            // Per VRControls.txt: BOTH grips grab. The dash is opened
            // by the X button (left controller) further down. Shared
            // raycast+grab helper used by both left and right grips
            // \u2014 keeps HUD-priority + parent-chain walk logic single-
            // sourced so the two sides can't drift.
            const tryVrGrab = (grabSide: 'left' | 'right') => {
              if (!mm || !am) return false;
              const ctr = se.vrInput?.getController(grabSide);
              const grip = se.vrInput?.getGrip(grabSide);
              if (!ctr || !grip) return false;
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
              // Include the VR HUD grab bars (dash + open panel) in the
              // same raycast pass so the user can physically carry them
              // with either grip. The grab bar has an invisible proxy
              // child (1.4m wide) for off-axis aim forgiveness; the
              // parent-walk below resolves a proxy hit up to the grab
              // bar mesh itself so the parent check is exact. HUD grab
              // is prioritized over asset grab because reaching for a
              // floating panel is the more common reflex than reaching
              // through the panel to grab an asset behind it.
              const hudForGrip = vrHudRef.current;
              if (hudForGrip && hudForGrip.isVisible) targets.push(hudForGrip.grabBarMesh);
              if (hudForGrip && hudForGrip.activePanel) targets.push(hudForGrip.panelGrabBarMesh);
              const hits = se.raycaster.intersectObjects(targets, true);
              if (hits.length === 0) return false;
              let hudCur: THREE.Object3D | null = hits[0].object;
              while (hudCur) {
                if (hudForGrip && hudCur === hudForGrip.grabBarMesh) {
                  hudForGrip.attachToGrip(grip);
                  return true;
                }
                if (hudForGrip && hudCur === hudForGrip.panelGrabBarMesh) {
                  hudForGrip.attachPanelToGrip(grip);
                  return true;
                }
                hudCur = hudCur.parent;
              }
              let cur: THREE.Object3D | null = hits[0].object;
              while (cur && !objToAsset.has(cur)) cur = cur.parent;
              if (cur) {
                const found = objToAsset.get(cur);
                if (found) {
                  mm.vrGrabWithController(found, grip, grabSide);
                  return true;
                }
              }
              return false;
            };
            if (side === 'left' || side === 'right') {
              tryVrGrab(side);
              return;
            }"""

if old_left_grip in src:
    src = src.replace(old_left_grip, new_left_grip, 1)
    print('FIX 1: extracted tryVrGrab helper, both grips now grab')
else:
    print('WARN: left/right grip block anchor not found')

# ============================================================
# FIX 2: Add X button (left) handler to toggle the dash, and
# Y button handler for context menu (spec compliance per
# VRControls.txt). Place these BEFORE the grip block so a
# simultaneous X+grip press routes X to the dash, not the grip.
# Anchor: the `// B button` comment block is uniquely identifying.
# ============================================================
old_b_button = """          // B button (either hand): toggle the Resonite radial context
          // menu \u2014 mirrors the desktop T-key handler.
          if (button === 'b') {
            setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            setShowRadialMenu((prev) => !prev);
            return;
          }"""
new_b_button = """          // B button (right hand): toggle the Resonite radial context
          // menu \u2014 mirrors the desktop T-key handler. Right controller
          // only per VRControls.txt; Y (left controller) below is a
          // second context-menu entry point for left-handed users.
          if (button === 'b') {
            setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            setShowRadialMenu((prev) => !prev);
            return;
          }
          // Y button (left hand): context menu \u2014 mirrors B on the
          // right controller, gives left-handed users a symmetric
          // binding (Y is the left's analog of B in the OpenXR Quest
          // mapping). VRControls.txt lists Y as the context-menu
          // button, so this is the spec-compliant entry point.
          if (button === 'y') {
            setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            setShowRadialMenu((prev) => !prev);
            return;
          }
          // X button (left hand): toggle the VR dash menu (curved HUD).
          // Per VRControls.txt: "X button - Open/Close Dash (Left
          // controller)". Previously the LEFT GRIP opened the dash,
          // but the spec says BOTH grips should grab and X opens the
          // dash \u2014 see FIX 1 above. Same toggle pattern as the desktop
          // Tab key handler.
          if (button === 'x') {
            inventoryServiceRef.current.getItems().then((items) => {
              vrHudRef.current?.setItems(items);
              vrHudRef.current?.toggle();
            });
            return;
          }"""
if old_b_button in src:
    src = src.replace(old_b_button, new_b_button, 1)
    print('FIX 2: added X (dash) + Y (context menu) button handlers')
else:
    print('WARN: B button anchor not found')

# ============================================================
# FIX 3: Update the release handler to drop on EITHER grip
# release. The current code only releases on 'right' \u2014 with the
# left grip now also grabbing, a left-grip release would leave
# the manipulation manager in a stuck-grab state. vrReleaseControllerGrab
# itself is side-agnostic (it checks _isVRGrabbing and calls
# endGrab), so calling it on either side release is safe.
# ============================================================
old_release = """          if (button === 'grip' && side === 'right') {
            mm.vrReleaseControllerGrab();
            // Drop the HUD too if it was carried by the right grip.
            // VRHUDManager.detach() re-parents to scene preserving
            // world transform via THREE.attach semantics.
            const hud = vrHudRef.current;
            if (hud && hud.currentGrip) hud.detach();
            // Drop the active system panel too if it was being
            // carried. Same THREE.attach semantics as the dash detach
            // above: re-parent to scene preserving world transform.
            if (hud && hud.panelCurrentGrip) hud.detachPanel();
          }"""
new_release = """          if (button === 'grip' && (side === 'left' || side === 'right')) {
            // Release the held asset on EITHER grip release \u2014 both
            // grips can now grab per VRControls.txt. vrReleaseControllerGrab
            // is side-agnostic (checks _isVRGrabbing), so calling it
            // on either side release is safe even if the other side
            // never grabbed. HUD detach below also covers both sides
            // because it checks currentGrip / panelCurrentGrip
            // regardless of which controller was carrying.
            mm.vrReleaseControllerGrab();
            const hud = vrHudRef.current;
            if (hud && hud.currentGrip) hud.detach();
            if (hud && hud.panelCurrentGrip) hud.detachPanel();
          }"""
if old_release in src:
    src = src.replace(old_release, new_release, 1)
    print('FIX 3: release handler covers both grip sides')
else:
    print('WARN: release handler anchor not found')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('All VR control fixes written')
