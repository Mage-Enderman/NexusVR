#!/usr/bin/env python3
# Fix VRRadialMenuMesh.placeNearController for two issues found by user reports:
#
# (a) Same-frame raycast misses:
#     placeNearController writes this.group.position / this.group.rotation,
#     but updateMatrixWorld only runs inside renderer.render(). The same-frame
#     updateAim() raycaster therefore intersects against the STALE matrixWorld
#     from the previous render frame. On the very first frame after B/Y press
#     the mesh has never been rendered so matrixWorld is still identity-equivalent
#     (mesh "at world (0,0,0)") and the aim ray hits nothing. On later frames
#     the matrix is one render-frame behind the just-placed pose.
#     => Force this.group.updateMatrixWorld(true) after writing position/rotation
#        so the immediate same-frame raycast tests against the correct world pose.
#
# (b) "Too far away" after the world-size halving:
#     The previous 0.55 m reach + 0.15 m vertical offset was tuned for a 0.6 m
#     panel. With WORLD_SIZE halved to 0.30 m the same reach made the panel feel
#     small AND distant. Pull the placement in to 0.35 m so the panel reads
#     closer to the wrist, and drop the vertical offset to 0.05 m so the panel
#     sits at roughly wrist height instead of face height (matches typical
#     Resonite VR workflow where the radial hovers just under your hand).
import re
path = 'src/engine/VRRadialMenuMesh.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# ----- (1) Replace the existing placeNearController implementation and JSDoc -----
old_block = """  /**
   * Place the menu panel 0.55 m along `laserDir` from `origin`,
   * then +0.15 m up, facing back toward `origin`.
   *
   * Allocation-free: uses internal hoisted scratch refs so it is
   * safe to call from a per-frame aim loop (App.tsx's tick now
   * re-positions every frame so the menu follows the active
   * controller — otherwise wrist motion drifts the aim ray off
   * the panel and the buttons feel "non-interactive" despite the
   * action plumbing being correct). Reads `origin` and `laserDir`
   * but does NOT mutate them; the previous `.clone()`-based
   * implementation allocated ~180 vec3s/sec at 90 Hz.
   */
  public placeNearController(origin: THREE.Vector3, laserDir: THREE.Vector3): void {
    const pos = this._scratchPos.copy(origin).addScaledVector(laserDir, 0.55);
    pos.y += 0.15;
    this.group.position.copy(pos);

    // Face the panel's -Z toward the user (origin) so it's readable
    const toUser = this._scratchToUser.copy(origin).sub(pos);
    toUser.y = 0;
    if (toUser.lengthSq() > 1e-6) {
      toUser.normalize();
      const yaw = Math.atan2(toUser.x, toUser.z);
      this.group.rotation.set(0, yaw, 0);
    }
  }"""

new_block = """  /**
   * Place the menu panel 0.35 m along `laserDir` from `origin`,
   * then +0.05 m up (slight bust so the panel sits at wrist
   * height instead of face height — matches typical Resonite VR
   * workflow), facing back toward `origin`.
   *
   * Allocation-free: uses internal hoisted scratch refs so it is
   * safe to call from a per-frame aim loop (App.tsx's tick now
   * re-positions every frame so the menu follows the active
   * controller — otherwise wrist motion drifts the aim ray off
   * the panel and the buttons feel "non-interactive" despite the
   * action plumbing being correct). Reads `origin` and `laserDir`
   * but does NOT mutate them; the previous `.clone()`-based
   * implementation allocated ~180 vec3s/sec at 90 Hz.
   *
   * Also forces `this.group.updateMatrixWorld(true)` after writing
   * position/rotation. Without this the same-frame `updateAim()`
   * raycaster intersects the STALE matrixWorld from the previous
   * render frame — and on the very first frame after B/Y press the
   * mesh has never been rendered, so matrixWorld is still the
   * identity-equivalent (mesh "at world (0, 0, 0)") and the user's
   * aim ray never hits anything despite the menu being visually
   * drawn. updateMatrixWorld(true) recurses into the child mesh so
   * the raycaster (which reads mesh.matrixWorld) sees the same pose
   * that the renderer is about to draw.
   */
  public placeNearController(origin: THREE.Vector3, laserDir: THREE.Vector3): void {
    const pos = this._scratchPos.copy(origin).addScaledVector(laserDir, 0.35);
    pos.y += 0.05;
    this.group.position.copy(pos);

    // Face the panel's -Z toward the user (origin) so it's readable
    const toUser = this._scratchToUser.copy(origin).sub(pos);
    toUser.y = 0;
    if (toUser.lengthSq() > 1e-6) {
      toUser.normalize();
      const yaw = Math.atan2(toUser.x, toUser.z);
      this.group.rotation.set(0, yaw, 0);
    }

    // CRITICAL: force the world-matrix update NOW, in the same JS
    // tick, so the same-frame aim raycast in updateAim() intersects
    // the freshly-placed pose. The vanilla Three.js render path only
    // updates matrixWorld during renderer.render(); if we don't force
    // it here we'd be testing the raycast against the PREVIOUS frame's
    // mesh location (and on the first frame after B/Y press, against
    // the never-rendered default identity-equivalent).
    this.group.updateMatrixWorld(true);
  }"""

if old_block not in c:
    raise SystemExit('placeNearController block not found verbatim — aborting.')
c2 = c.replace(old_block, new_block, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(c2)
print(f'OK: patched placeNearController; placeholder count: 0.35m, vertical +0.05m, with updateMatrixWorld(true).')
