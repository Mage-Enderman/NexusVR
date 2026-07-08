#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io

path = 'src/App.tsx'
with io.open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1) Add allocation-free refs near the existing per-frame pattern (alongside
#    vrHudRaycasterRef and the existing per-frame scratch state). Anchored
#    to the existing declaration block so we know the existing pattern.
old_rg = '  const vrHudRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());'
new_rg = old_rg + (
    '\n  // Per-frame scratch for the VR radial menu aim/select loop. Hoisted\n'
    '  // out of the loop body to avoid ~270 Vec3/Quat/Ray allocations\n'
    '  // per second at 90 Hz; mirrors the existing vrHudRaycasterRef\n'
    '  // pattern. Reads/writes happen every frame, so the captured\n'
    '  // references are safe to mutate in place.'
    '\n  const vrRadialAimOriginRef = useRef<THREE.Vector3>(new THREE.Vector3());'
    '\n  const vrRadialAimDirQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion());'
    '\n  const vrRadialAimDirRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, -1));'
    '\n  const vrRadialAimRayRef = useRef<THREE.Ray>(new THREE.Ray());'
)
assert old_rg in content, 'vrHudRaycasterRef anchor not found'
content = content.replace(old_rg, new_rg, 1)

# 2) Replace the aim-loop body to use the hoisted refs (no per-frame
#    allocations). The .copy / .setFromQuaternion / .copy semantics
#    are preserved. .set copies origin + direction into the Ray.
old_loop_body = '''    const tick = () => {
      raf = requestAnimationFrame(tick);
      const mesh = vrRadialMenuRef.current;
      const se = sceneEngineRef.current;
      const side = vrRadialActiveSideRef.current;
      if (!mesh || !se || !se.renderer.xr.isPresenting || !mesh.isVisible || !side) return;
      const ctr = se.vrInput?.getController(side);
      if (!ctr) return;
      ctr.updateWorldMatrix(true, false);
      const origin = new THREE.Vector3().setFromMatrixPosition(ctr.matrixWorld);
      const dirQuat = new THREE.Quaternion().setFromRotationMatrix(ctr.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(dirQuat).normalize();
      mesh.updateAim(new THREE.Ray(origin, dir));
      const ctrlState = side === 'left' ? se.vrInput?.left : se.vrInput?.right;
      if (ctrlState?.pressedThisFrame?.trigger) mesh.select();
    };'''
new_loop_body = '''    const tick = () => {
      raf = requestAnimationFrame(tick);
      const mesh = vrRadialMenuRef.current;
      const se = sceneEngineRef.current;
      const side = vrRadialActiveSideRef.current;
      if (!mesh || !se || !se.renderer.xr.isPresenting || !mesh.isVisible || !side) return;
      const ctr = se.vrInput?.getController(side);
      if (!ctr) return;
      ctr.updateWorldMatrix(true, false);
      // Allocation-free: hoisted scratch refs (vrRadialAim*Ref) reused
      // across frames. .copy / .setFrom* mutate in place.
      vrRadialAimOriginRef.current.setFromMatrixPosition(ctr.matrixWorld);
      vrRadialAimDirQuatRef.current.setFromRotationMatrix(ctr.matrixWorld);
      vrRadialAimDirRef.current
        .set(0, 0, -1)
        .applyQuaternion(vrRadialAimDirQuatRef.current)
        .normalize();
      vrRadialAimRayRef.current.set(vrRadialAimOriginRef.current, vrRadialAimDirRef.current);
      mesh.updateAim(vrRadialAimRayRef.current);
      const ctrlState = side === 'left' ? se.vrInput?.left : se.vrInput?.right;
      if (ctrlState?.pressedThisFrame?.trigger) mesh.select();
    };'''
assert old_loop_body in content, 'aim-loop tick body not found'
content = content.replace(old_loop_body, new_loop_body, 1)

# 3) Add unmount cleanup useEffect for VRRadialMenuMesh. Releases the
#    CanvasTexture, geometry, material, and detaches the group from
#    the scene. Without this the App unmount leaves an orphaned mesh
#    in the (still-existing) scene for the rest of the page lifetime
#    AND leaks GPU backing for the canvas texture.
old_cleanup_anchor = "  useEffect(() => {\n    if (!vrRadialOpen) return;"
new_cleanup_anchor = '''  // Cleanup the lazily-constructed VRRadialMenuMesh on unmount.
  // Without this, a renderer's CanvasTexture + PlaneGeometry + BasicMaterial
  // stay referenced after the App has unmounted (they're not owned by
  // React state, so React's cleanup doesn't reach them). The empty-deps
  // effect runs the returned cleanup exactly once when the App unmounts.
  useEffect(() => {
    return () => {
      const m = vrRadialMenuRef.current;
      if (m) {
        if (m.group.parent) m.group.parent.remove(m.group);
        m.dispose();
        vrRadialMenuRef.current = null;
      }
    };
  }, []);

  ''' + old_cleanup_anchor
assert old_cleanup_anchor in content, 'cleanup useEffect anchor (aim-loop start) not found'
content = content.replace(old_cleanup_anchor, new_cleanup_anchor, 1)

with io.open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: applied cleanup useEffect + hoisted per-frame allocations')
print('wrote', len(content), 'bytes')
