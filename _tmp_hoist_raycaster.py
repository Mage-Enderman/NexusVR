#!/usr/bin/env python3
# Hoist the per-frame `new THREE.Raycaster()` allocation in updateAim to a
# private field. Same GC-neutral pattern as the existing _scratchPos /
# _scratchToUser hoists. The caller mutates raycaster.ray each frame;
# raycaster.intersectObjects does not mutate internal state that callers
# depend on (only `near`/`far`/`layers`/`params` — all default values are
# fine for our use). Saving ~90 vec3-allocations/sec at 90 Hz matches
# the per-frame placeNearController hoist already applied.
import re
path = 'src/engine/VRRadialMenuMesh.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# ----- (1) Add the private hoisted raycaster field next to existing scratch refs -----
old_field_block = """  // Hoisted scratch refs so placeNearController is allocation-free
  // when called from a per-frame aim loop. Without these, every
  // reposition would `origin.clone()` + `clone().sub()` twice per
  // call — ~180 allocations/second at 90 Hz — and the GC pressure
  // would cause micro-stutter right when the user is trying to
  // aim/select. Both helpers are private and only ever written to
  // inside the same synchronous call chain, so share-mutation is
  // safe.
  private _scratchPos = new THREE.Vector3();
  private _scratchToUser = new THREE.Vector3();"""

new_field_block = """  // Hoisted scratch refs so placeNearController is allocation-free
  // when called from a per-frame aim loop. Without these, every
  // reposition would `origin.clone()` + `clone().sub()` twice per
  // call — ~180 allocations/second at 90 Hz — and the GC pressure
  // would cause micro-stutter right when the user is trying to
  // aim/select. Both helpers are private and only ever written to
  // inside the same synchronous call chain, so share-mutation is
  // safe.
  private _scratchPos = new THREE.Vector3();
  private _scratchToUser = new THREE.Vector3();
  // Hoisted Raycaster so updateAim's per-frame intersection test
  // doesn't allocate one. Mirrors the _scratchPos GC-neutral pattern:
  // callers mutate `raycaster.ray` each frame and call intersectObject;
  // `intersectObject` itself does NOT mutate fields the consumer depends
  // on (intersection result is returned), so share-mutation across
  // frames is safe. ~90 allocations/sec saved at 90 Hz.
  private _scratchRaycaster = new THREE.Raycaster();"""

if old_field_block not in c:
    raise SystemExit('field block not found verbatim — aborting.')
c = c.replace(old_field_block, new_field_block, 1)

# ----- (2) Replace per-call allocation in updateAim with the hoisted ref -----
old_aim_block = """    // Intersect the ray with the mesh
    const hits: THREE.Intersection[] = [];
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(ray);
    raycaster.intersectObject(this.mesh, false, hits);"""

new_aim_block = """    // Intersect the ray with the mesh
    const hits: THREE.Intersection[] = [];
    const raycaster = this._scratchRaycaster;
    raycaster.ray.copy(ray);
    raycaster.intersectObject(this.mesh, false, hits);"""

if old_aim_block not in c:
    raise SystemExit('updateAim block not found verbatim — aborting.')
c = c.replace(old_aim_block, new_aim_block, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('OK: hoisted Raycaster allocation in VRRadialMenuMesh.')
