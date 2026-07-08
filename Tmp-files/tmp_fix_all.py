import re

# ============================================================
# FIX 1: VRHUDManager.ts — rename _dataContext to panelDataCtx
# and add isHeld:false to the PanelContext default
# ============================================================
vrhud_path = 'src/engine/VRHUDManager.ts'
with open(vrhud_path, 'r', encoding='utf-8') as f:
    src = f.read()

# The earlier patch referenced a non-existent `this._dataContext`. The
# real field is `panelDataCtx` (per setDataContext L755). Rename.
src = src.replace('this._dataContext?.isHeld', 'this.panelDataCtx?.isHeld')
src = src.replace('this._dataContext?.isHeld', 'this.panelDataCtx?.isHeld')  # idempotent
print('FIX 1a: _dataContext -> panelDataCtx')

# Add isHeld: false to the PanelContext fallback. Find the line that
# adds 'users: []' and add isHeld right after.
# Use a unique anchor: the closing brace of the fallback object is at
# L810 or so. We'll find the `users: [],` line and insert after it.
old_fallback_users = """      users: [],
    };
    // Cache the initial context so getter-style reads (radialTab guard,
    // etc.) work before App.tsx's first setDataContext arrives."""
new_fallback_users = """      users: [],
      isHeld: false,
    };
    // Cache the initial context so getter-style reads (radialTab guard,
    // etc.) work before App.tsx's first setDataContext arrives."""
if old_fallback_users in src:
    src = src.replace(old_fallback_users, new_fallback_users, 1)
    print('FIX 1b: added isHeld:false to PanelContext default')
else:
    print('WARN: PanelContext default users anchor not found; trying simpler match')
    # Try without the comment
    old2 = "      users: [],\n    };"
    new2 = "      users: [],\n      isHeld: false,\n    };"
    if old2 in src:
        src = src.replace(old2, new2, 1)
        print('FIX 1b (alt): added isHeld:false to PanelContext default')

with open(vrhud_path, 'w', encoding='utf-8') as f:
    f.write(src)


# ============================================================
# FIX 2: App.tsx — handleDuplicateHeld + handleDestroyHeld should
# use WORLD position (getWorldPosition) for VR-grip held assets.
# Also fall back to _twoHandedAsset and call endTwoHandedGrab in
# destroy.
# ============================================================
app_path = 'src/App.tsx'
with open(app_path, 'r', encoding='utf-8') as f:
    app = f.read()

# 2a) Update handleDuplicateHeld to use world position via a scratch
# Vector3 and to fall back to the two-handed asset. Also adds a
# scratch at the top of the function for allocation-free use.
old_dup_pos = """  const handleDuplicateHeld = useCallback(async () => {
    const held = manipulationManagerRef.current?.grabbedAsset;
    if (!held) return;
    const asset = held;
    const am = assetManagerRef.current;
    if (!am) return;

    // Offset the duplicate so it doesn't perfectly overlap the held
    // original (the held one stays under the cursor; the duplicate pops
    // out a fraction so the user can see the copy). Same offset as the
    // selected-target version for consistency.
    const offset = new THREE.Vector3(
      0.4 + (Math.random() - 0.5) * 0.3,
      0,
      0.4 + (Math.random() - 0.5) * 0.3
    );
    const pos = new THREE.Vector3(
      asset.object3d.position.x,
      asset.object3d.position.y,
      asset.object3d.position.z
    ).add(offset);"""
new_dup_pos = """  const handleDuplicateHeld = useCallback(async () => {
    // Fall back to the two-handed asset if no single-grip grab is in
    // flight. Two-handed mode doesn't set grabbedAsset but DOES fire
    // onGrabBegin (which we use to set isHeld), so without this
    // fallback the user would see the held tab in two-handed mode but
    // nothing would happen when they click Duplicate / Save / Destroy.
    const mm = manipulationManagerRef.current;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;
    const asset = held;
    const am = assetManagerRef.current;
    if (!am) return;

    // Offset the duplicate so it doesn't perfectly overlap the held
    // original (the held one stays under the cursor; the duplicate pops
    // out a fraction so the user can see the copy). Same offset as the
    // selected-target version for consistency.
    const offset = new THREE.Vector3(
      0.4 + (Math.random() - 0.5) * 0.3,
      0,
      0.4 + (Math.random() - 0.5) * 0.3
    );
    // CRITICAL: read WORLD position, not local. A VR-grip-held asset
    // is parented to controllerGripSpace, so obj.position is the
    // LOCAL offset from the grip (e.g. (0,0,-2)). Reading local as
    // world would spawn the duplicate at the world origin instead of
    // at the user's hand. For RMB-grab (direct child of scene) local
    // == world, so the change is a no-op for that case. getWorldPosition
    // requires matrixWorld to be up to date, which the renderer
    // maintains each frame for visible meshes — held assets ARE
    // rendered, so the call is safe.
    const worldPos = new THREE.Vector3();
    asset.object3d.getWorldPosition(worldPos);
    const pos = worldPos.add(offset);"""
if old_dup_pos in app:
    app = app.replace(old_dup_pos, new_dup_pos, 1)
    print('FIX 2a: handleDuplicateHeld uses world position + two-handed fallback')
else:
    print('WARN: handleDuplicateHeld position anchor not found')

# 2b) Update handleSaveHeldToInventory to fall back to two-handed asset.
old_save = """  const handleSaveHeldToInventory = useCallback(() => {
    const held = manipulationManagerRef.current?.grabbedAsset;
    if (!held) return;"""
new_save = """  const handleSaveHeldToInventory = useCallback(() => {
    const mm = manipulationManagerRef.current;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;"""
if old_save in app:
    app = app.replace(old_save, new_save, 1)
    print('FIX 2b: handleSaveHeldToInventory falls back to two-handed asset')
else:
    print('WARN: handleSaveHeldToInventory anchor not found')

# 2c) Update handleDestroyHeld: world position snapshot + two-handed
# fallback + endTwoHandedGrab call.
old_destroy = """  const handleDestroyHeld = useCallback(() => {
    const held = manipulationManagerRef.current?.grabbedAsset;
    if (!held) return;
    const asset = held;
    const obj = asset.object3d;
    // CRITICAL: end the grab BEFORE removing the asset. Otherwise the
    // manipulation manager would briefly hold a dangling grabbedAsset
    // reference to a removed Object3D, and the per-frame update() path
    // would either crash or broadcast stale transforms for a non-existent
    // asset. endGrab handles the two-handed case too via
    // manipulationManager's internal _isVRGrabbing check.
    manipulationManagerRef.current?.endGrab();
    const snapshot: AssetSnapshot = {"""
new_destroy = """  const handleDestroyHeld = useCallback(() => {
    // Fall back to the two-handed asset (see handleDuplicateHeld for
    // the same pattern + reason). Two-handed mode doesn't set
    // grabbedAsset, so without this fallback the user would see the
    // held tab in two-handed mode but Destroy would be a no-op.
    const mm = manipulationManagerRef.current;
    const held = mm?.grabbedAsset ?? (mm as any)?._twoHandedAsset ?? null;
    if (!held) return;
    const asset = held;
    const obj = asset.object3d;
    // CRITICAL: end the grab BEFORE removing the asset. Otherwise the
    // manipulation manager would briefly hold a dangling grabbedAsset
    // reference to a removed Object3D, and the per-frame update() path
    // would either crash or broadcast stale transforms for a non-existent
    // asset. endGrab handles single-grip (RMB + VR grip); endTwoHandedGrab
    // handles the two-handed case. We always call both — each is a
    // no-op when the corresponding state is inactive, so it's safe.
    mm?.endGrab();
    mm?.endTwoHandedGrab();
    // Use WORLD position for the undo snapshot. A VR-grip-held asset's
    // obj.position is the local grip offset, NOT the world position;
    // on undo the respawn would teleport to a wrong world spot. For
    // direct-child-of-scene (RMB-grab) local == world, no-op. For
    // two-handed mode the asset is still in the scene (not reparented),
    // so obj.position IS world.
    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    const snapshot: AssetSnapshot = {"""
if old_destroy in app:
    app = app.replace(old_destroy, new_destroy, 1)
    print('FIX 2c: handleDestroyHeld uses world pos + two-handed fallback + endTwoHandedGrab')
else:
    print('WARN: handleDestroyHeld anchor not found')

# 2d) Update handleDestroyHeld's snapshot position to use worldPos.
old_snap_pos = """    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],"""
new_snap_pos = """    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [worldPos.x, worldPos.y, worldPos.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],"""
# Only replace if we just inserted the worldPos block (guard against
# double-apply). Check for the worldPos variant that was inserted.
if old_snap_pos in app:
    app = app.replace(old_snap_pos, new_snap_pos, 1)
    print('FIX 2d: handleDestroyHeld snapshot position uses world')
else:
    print('NOTE: snapshot position anchor not found (may have been replaced already)')

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(app)


# ============================================================
# FIX 3: VRHUDManager.ts — apply the held-branch in drawRadialPanel.
# Find the actual decorate function and add the held branch.
# ============================================================
with open(vrhud_path, 'r', encoding='utf-8') as f:
    vrhud = f.read()

# The decorate function uses `sub` (not `subLabel`) and `stroke` (not
# `color`). The grab branch sets `label: 'GRAB'`, `sub: data.grabMode.toUpperCase()`,
# `stroke: '#f59e0b'`. Find the exact grab-branch and add a held
# branch before it.
old_grab_branch = """          if (slice.id === 'right') {
            return { label: 'GRAB', sub: data.grabMode.toUpperCase(), stroke: '#f59e0b' };
          }"""
new_grab_branch = """        }
        if (this._radialTab === 'held') {
          // 'held' tab — only reachable when data.isHeld === true (set
          // via setDataContext in App.tsx). Save Held / Duplicate /
          // Destroy are routed to App.tsx via onPanelAction where the
          // dispatcher checks the active radialTab and calls
          // handleSaveHeldToInventory / handleDuplicateHeld /
          // handleDestroyHeld. Colors mirror the desktop
          // RadialContextMenu's held tab (amber / cyan / rose).
          if (slice.id === 'right') {
            return { label: 'SAVE', sub: 'to inventory', stroke: '#f59e0b' };
          }
          if (slice.id === 'bottom') {
            return { label: 'COPY', sub: 'duplicate', stroke: '#06b6d4' };
          }
          if (slice.id === 'left') {
            return { label: 'KILL', sub: 'destroy', stroke: '#ef4444' };
          }
        }
        // grab tab (or held fallback if decorate above didn't match)
        if (slice.id === 'right') {
          if (this._radialTab === 'held') {
            return { label: 'SAVE', sub: 'to inventory', stroke: '#f59e0b' };
          }
          return { label: 'GRAB', sub: data.grabMode.toUpperCase(), stroke: '#f59e0b' };
        }"""
if old_grab_branch in vrhud:
    vrhud = vrhud.replace(old_grab_branch, new_grab_branch, 1)
    print('FIX 3: drawRadialPanel held-branch applied (with double-guard for slice.right)')
else:
    print('WARN: drawRadialPanel grab-branch anchor not found')

with open(vrhud_path, 'w', encoding='utf-8') as f:
    f.write(vrhud)

print('All fixes written')
