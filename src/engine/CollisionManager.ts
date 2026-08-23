/**
 * CollisionManager — Manages collider components in the scene and provides
 * movement validation for avatar locomotion.
 *
 * Two collider types are supported:
 *   - BoxCollider: sphere-vs-OBB (oriented bounding box) test. The box
 *     rotates with its parent object because we test in the box's local space.
 *   - MeshCollider: sphere-vs-triangle test against the object's own geometry.
 *     Triangles are extracted once at registry build time, cached in world
 *     space, and updated every frame.
 *
 * Grounding (can the player stand here / jump?):
 *   Uses the sphere-vs-shape contact normal to determine if the surface
 *   faces upward enough to stand on (normal.y > 0.3 ≈ 72° slope).
 *   This supports slopes, ramps, and irregular mesh terrain — not just
 *   horizontal top-faces.
 *
 * There is NO hardcoded infinite floor. The floor is just another object
 * with a BoxCollider. If no collider is present, the player falls.
 */

import * as THREE from 'three';
import {
  getCollider,
  type ColliderComponent,
  type BoxColliderComponent,
  type MeshColliderComponent,
} from '../components/collider/ColliderComponent.ts';

/** Player collision parameters. */
const PLAYER_HEIGHT = 1.6;   // Eye height above floor (meters)
const PLAYER_RADIUS = 0.3;   // Collision sphere radius (meters)

/** Max slope angle (in dot-product terms) the player can stand on. normal.y must exceed this. */
const STANDABLE_NORMAL_Y = 0.3;

/** Cached world transform for a collider. */
interface CachedTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  invMatrix: THREE.Matrix4;
}

/** A single triangle in world space, used for MeshCollider collision. */
interface WorldTriangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
}

/** A cached collision entry — either a box or a set of triangles. */
interface ColliderEntry {
  obj: THREE.Object3D;
  collider: ColliderComponent;
  cache: CachedTransform;
  /** Pre-extracted triangles for MeshCollider (empty for BoxCollider). */
  triangles: WorldTriangle[];
}

export class CollisionManager {
  /** When false, all collider checks are skipped (global toggle). */
  public enabled = true;

  /** Reference to the worldRoot so we can access child objects. */
  private worldRoot: THREE.Object3D;

  /** Flat list of colliders with their cached transforms. */
  private colliders: ColliderEntry[] = [];

  /** Object3Ds that have an enabled collider with ignoreRaycasts=true. */
  public raycastBlockers: THREE.Object3D[] = [];

  constructor(worldRoot: THREE.Object3D) {
    this.worldRoot = worldRoot;
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  public rebuildRegistry(): void {
    this.colliders = [];
    this.raycastBlockers = [];

    this.worldRoot.traverse((obj) => {
      const collider = getCollider(obj);
      if (!collider || !collider.enabled) return;

      const triangles = collider.type === 'mesh'
        ? this.extractMeshTriangles(obj, collider as MeshColliderComponent)
        : [];

      this.colliders.push({
        obj,
        collider,
        cache: this.buildCache(obj),
        triangles,
      });

      if (collider.ignoreRaycasts) {
        this.raycastBlockers.push(obj);
      }
    });
  }

  public updateWorldBoxes(): void {
    for (const entry of this.colliders) {
      entry.cache = this.buildCache(entry.obj);
      // Update mesh triangles to current world positions
      if (entry.collider.type === 'mesh' && entry.triangles.length > 0) {
        this.updateMeshTriangles(entry);
      }
    }
  }

  private buildCache(obj: THREE.Object3D): CachedTransform {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    obj.matrixWorld.decompose(position, quaternion, scale);

    const invMatrix = new THREE.Matrix4();
    invMatrix.copy(obj.matrixWorld).invert();

    return { position, quaternion, scale, invMatrix };
  }

  // ─── MeshCollider triangle extraction ──────────────────────────────────────

  /**
   * Extract triangles from the object's geometry and store them with
   * local-space vertices. We'll transform to world space each frame.
   */
  private extractMeshTriangles(
    obj: THREE.Object3D,
    _collider: MeshColliderComponent,
  ): WorldTriangle[] {
    const geom = this.findMeshGeometry(obj);
    if (!geom) return [];

    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr) return [];

    const index = geom.getIndex();
    const triangles: WorldTriangle[] = [];

    const addTriangle = (i0: number, i1: number, i2: number) => {
      const a = new THREE.Vector3().fromBufferAttribute(posAttr, i0);
      const b = new THREE.Vector3().fromBufferAttribute(posAttr, i1);
      const c = new THREE.Vector3().fromBufferAttribute(posAttr, i2);
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();
      triangles.push({ a, b, c, normal });
    };

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        addTriangle(i, i + 1, i + 2);
      }
    }

    return triangles;
  }

  /**
   * Update cached triangles to current world positions.
   * Transforms local-space vertices by the object's world matrix.
   */
  private updateMeshTriangles(entry: ColliderEntry): void {
    const mat = entry.obj.matrixWorld;
    const temp = new THREE.Vector3();

    for (const tri of entry.triangles) {
      // These are local-space copies; transform to world
      // We need the original local positions, so we store them
      // and re-transform each frame. To avoid extra storage,
      // we store the local positions in a/b/c and overwrite with world.
      // This means we need to store local copies separately.
      // For now, we re-extract from geometry (slower but correct).
    }

    // Actually, we need local copies. Let me restructure:
    // Store local triangles in the entry, and produce world triangles on demand.
    // For simplicity, we'll just re-extract and transform each frame.
    // This is called at most ~10 times per frame (number of mesh colliders).
    // The extraction itself is done once in rebuildRegistry; we only transform here.

    // We need to store local triangles separately. Let me use a different approach:
    // store local a/b/c in the WorldTriangle and overwrite with world coords.
    // But we lose the local coords. Instead, store local coords in separate arrays.

    // Simplest correct approach: re-extract geometry positions each frame.
    // This is wasteful but mesh colliders are rare. Optimize later if needed.
    const geom = this.findMeshGeometry(entry.obj);
    if (!geom) return;

    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr) return;

    const index = geom.getIndex();
    let triIdx = 0;

    const transformVertex = (vi: number): THREE.Vector3 => {
      temp.fromBufferAttribute(posAttr, vi);
      temp.applyMatrix4(mat);
      return temp.clone();
    };

    if (index) {
      for (let i = 0; i < index.count && triIdx < entry.triangles.length; i += 3) {
        const tri = entry.triangles[triIdx++];
        tri.a = transformVertex(index.getX(i));
        tri.b = transformVertex(index.getX(i + 1));
        tri.c = transformVertex(index.getX(i + 2));
        const ab = new THREE.Vector3().subVectors(tri.b, tri.a);
        const ac = new THREE.Vector3().subVectors(tri.c, tri.a);
        tri.normal.crossVectors(ab, ac).normalize();
      }
    } else {
      for (let i = 0; i < posAttr.count && triIdx < entry.triangles.length; i += 3) {
        const tri = entry.triangles[triIdx++];
        tri.a = transformVertex(i);
        tri.b = transformVertex(i + 1);
        tri.c = transformVertex(i + 2);
        const ab = new THREE.Vector3().subVectors(tri.b, tri.a);
        const ac = new THREE.Vector3().subVectors(tri.c, tri.a);
        tri.normal.crossVectors(ab, ac).normalize();
      }
    }
  }

  private findMeshGeometry(obj: THREE.Object3D): THREE.BufferGeometry | null {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      return obj.geometry;
    }
    for (const child of obj.children) {
      const found = this.findMeshGeometry(child);
      if (found) return found;
    }
    return null;
  }

  // ─── Sphere-vs-OBB (BoxCollider) ──────────────────────────────────────────

  /**
   * Test a sphere against a BoxCollider's OBB and return the push-out
   * vector in WORLD space, along with the surface normal.
   */
  private sphereBoxTest(
    sphereCenter: THREE.Vector3,
    sphereRadius: number,
    box: BoxColliderComponent,
    cache: CachedTransform,
  ): { push: THREE.Vector3; normal: THREE.Vector3 } | null {
    // Transform sphere center to collider local space
    const localSphere = sphereCenter.clone();
    localSphere.applyMatrix4(cache.invMatrix);

    const halfExtents = new THREE.Vector3(
      box.size.x * 0.5,
      box.size.y * 0.5,
      box.size.z * 0.5,
    );
    const offset = new THREE.Vector3(box.offset.x, box.offset.y, box.offset.z);
    const localRelative = localSphere.clone().sub(offset);

    // Closest point on box to sphere center
    const closest = new THREE.Vector3(
      Math.max(-halfExtents.x, Math.min(localRelative.x, halfExtents.x)),
      Math.max(-halfExtents.y, Math.min(localRelative.y, halfExtents.y)),
      Math.max(-halfExtents.z, Math.min(localRelative.z, halfExtents.z)),
    );

    const diff = localRelative.clone().sub(closest);
    const distSq = diff.lengthSq();

    if (distSq >= sphereRadius * sphereRadius) return null;

    let localPush: THREE.Vector3;
    let localNormal: THREE.Vector3;

    if (distSq < 1e-10) {
      // Sphere center is inside the box — push along axis of least penetration
      const penX = halfExtents.x - Math.abs(localRelative.x);
      const penY = halfExtents.y - Math.abs(localRelative.y);
      const penZ = halfExtents.z - Math.abs(localRelative.z);

      localNormal = new THREE.Vector3(0, 0, 0);
      if (penX <= penY && penX <= penZ) {
        localNormal.x = localRelative.x >= 0 ? 1 : -1;
        localPush = localNormal.clone().multiplyScalar(penX + sphereRadius);
      } else if (penY <= penZ) {
        localNormal.y = localRelative.y >= 0 ? 1 : -1;
        localPush = localNormal.clone().multiplyScalar(penY + sphereRadius);
      } else {
        localNormal.z = localRelative.z >= 0 ? 1 : -1;
        localPush = localNormal.clone().multiplyScalar(penZ + sphereRadius);
      }
    } else {
      const dist = Math.sqrt(distSq);
      const penetration = sphereRadius - dist;
      localNormal = diff.clone().multiplyScalar(1 / dist);
      localPush = localNormal.clone().multiplyScalar(penetration);
    }

    // Transform push and normal from local to world space
    const worldPush = localPush.applyQuaternion(cache.quaternion);
    const worldNormal = localNormal.applyQuaternion(cache.quaternion).normalize();

    return { push: worldPush, normal: worldNormal };
  }

  // ─── Sphere-vs-Triangle (MeshCollider) ────────────────────────────────────

  /**
   * Test a sphere against a single triangle and return the push-out
   * vector and surface normal, or null if no intersection.
   */
  private sphereTriangleTest(
    sphereCenter: THREE.Vector3,
    sphereRadius: number,
    tri: WorldTriangle,
  ): { push: THREE.Vector3; normal: THREE.Vector3 } | null {
    // Find closest point on triangle to sphere center
    const ab = new THREE.Vector3().subVectors(tri.b, tri.a);
    const ac = new THREE.Vector3().subVectors(tri.c, tri.a);
    const ap = new THREE.Vector3().subVectors(sphereCenter, tri.a);

    const d1 = ab.dot(ap);
    const d2 = ac.dot(ap);
    const d3 = ab.dot(ab);
    const d4 = ab.dot(ac);
    const d5 = ac.dot(ac);

    const denom = d3 * d5 - d4 * d4;
    if (Math.abs(denom) < 1e-10) return null; // Degenerate triangle

    const s = (d5 * d1 - d4 * d2) / denom;
    const t = (d3 * d2 - d4 * d1) / denom;

    let closest: THREE.Vector3;

    if (s >= 0 && t >= 0 && s + t <= 1) {
      // Closest point is inside the triangle
      closest = new THREE.Vector3()
        .copy(tri.a)
        .addScaledVector(ab, s)
        .addScaledVector(ac, t);
    } else {
      // Closest point is on an edge or vertex — check all three
      const candidates: THREE.Vector3[] = [];

      // Edge AB
      const p = this.closestPointOnSegment(sphereCenter, tri.a, tri.b);
      candidates.push(p);
      // Edge BC
      const q = this.closestPointOnSegment(sphereCenter, tri.b, tri.c);
      candidates.push(q);
      // Edge CA
      const r = this.closestPointOnSegment(sphereCenter, tri.c, tri.a);
      candidates.push(r);

      let bestDistSq = Infinity;
      closest = candidates[0];
      for (const c of candidates) {
        const d = sphereCenter.distanceToSquared(c);
        if (d < bestDistSq) {
          bestDistSq = d;
          closest = c;
        }
      }
    }

    const diff = new THREE.Vector3().subVectors(sphereCenter, closest);
    const distSq = diff.lengthSq();

    if (distSq >= sphereRadius * sphereRadius) return null;

    let push: THREE.Vector3;
    let normal: THREE.Vector3;

    if (distSq < 1e-10) {
      // Sphere center is on the triangle surface — push along triangle normal
      push = tri.normal.clone().multiplyScalar(sphereRadius);
      normal = tri.normal.clone();
    } else {
      const dist = Math.sqrt(distSq);
      push = diff.multiplyScalar((sphereRadius - dist) / dist);
      normal = diff.clone().normalize();
    }

    return { push, normal };
  }

  private closestPointOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.dot(ab)));
    return a.clone().addScaledVector(ab, t);
  }

  // ─── Combined collision test ───────────────────────────────────────────────

  /**
   * Test a sphere against all colliders and return the combined push-out
   * and the "best" surface normal (the one with the highest Y component,
   * used for grounding checks).
   */
  private testAllColliders(
    sphereCenter: THREE.Vector3,
    sphereRadius: number,
  ): { push: THREE.Vector3; normal: THREE.Vector3 } | null {
    let bestPush: THREE.Vector3 | null = null;
    let bestNormal: THREE.Vector3 | null = null;
    let bestNormalY = -1;

    for (const entry of this.colliders) {
      if (!entry.collider.characterCollider) continue;

      if (entry.collider.type === 'box') {
        const result = this.sphereBoxTest(
          sphereCenter,
          sphereRadius,
          entry.collider as BoxColliderComponent,
          entry.cache,
        );
        if (result) {
          if (!bestPush || result.push.lengthSq() > bestPush.lengthSq()) {
            bestPush = result.push;
            bestNormal = result.normal;
            bestNormalY = result.normal.y;
          }
        }
      } else if (entry.collider.type === 'mesh') {
        for (const tri of entry.triangles) {
          const result = this.sphereTriangleTest(sphereCenter, sphereRadius, tri);
          if (result) {
            if (!bestPush || result.push.lengthSq() > bestPush.lengthSq()) {
              bestPush = result.push;
              bestNormal = result.normal;
              bestNormalY = result.normal.y;
            }
          }
        }
      }
    }

    if (!bestPush) return null;
    return { push: bestPush, normal: bestNormal! };
  }

  // ─── Movement validation ───────────────────────────────────────────────────

  /**
   * Resolve horizontal (XZ) collision for desktop locomotion.
   * Y axis is NOT resolved here — the caller handles gravity + floor separately.
   */
  public resolvePosition(proposedPosition: THREE.Vector3): THREE.Vector3 {
    if (!this.enabled || this.colliders.length === 0) {
      return proposedPosition.clone();
    }

    const resolved = proposedPosition.clone();
    const bodyCenter = new THREE.Vector3(
      resolved.x,
      resolved.y - PLAYER_HEIGHT * 0.5,
      resolved.z,
    );

    const result = this.testAllColliders(bodyCenter, PLAYER_RADIUS);
    if (result) {
      resolved.x += result.push.x;
      resolved.z += result.push.z;
    }

    return resolved;
  }

  /**
   * Check if the player is grounded on any collider surface and return
   * the floor Y.
   *
   * Uses sphere-vs-shape testing at the FEET level (not eye level) to
   * detect contact with any surface that faces upward enough to stand on.
   * This supports slopes, ramps, and irregular mesh terrain.
   *
   * @returns The Y of the highest standable surface, or -Infinity if not grounded.
   */
  public getGroundedFloorY(
    cameraY: number,
    cameraX: number,
    cameraZ: number,
    verticalVelocity: number,
    delta: number,
  ): number {
    if (!this.enabled) return -Infinity;

    // Test a sphere at the feet level
    const feetY = cameraY - PLAYER_HEIGHT;
    const feetSphere = new THREE.Vector3(cameraX, feetY + PLAYER_RADIUS, cameraZ);

    let highestFloor = -Infinity;

    for (const entry of this.colliders) {
      if (!entry.collider.characterCollider) continue;

      if (entry.collider.type === 'box') {
        const result = this.sphereBoxTest(
          feetSphere,
          PLAYER_RADIUS,
          entry.collider as BoxColliderComponent,
          entry.cache,
        );
        if (result && result.normal.y > STANDABLE_NORMAL_Y) {
          // This surface is standable. Compute where the feet would rest.
          // The push moves the sphere out of the surface. The floor Y is
          // where the sphere center ends up minus the radius.
          const contactY = feetSphere.y + result.push.y - PLAYER_RADIUS;
          if (contactY > highestFloor) {
            highestFloor = contactY;
          }
        }
      } else if (entry.collider.type === 'mesh') {
        for (const tri of entry.triangles) {
          const result = this.sphereTriangleTest(feetSphere, PLAYER_RADIUS, tri);
          if (result && result.normal.y > STANDABLE_NORMAL_Y) {
            const contactY = feetSphere.y + result.push.y - PLAYER_RADIUS;
            if (contactY > highestFloor) {
              highestFloor = contactY;
            }
          }
        }
      }
    }

    return highestFloor;
  }

  // ─── World-space collision (for VR inverse-treadmill) ────────────────────

  public resolveWorldPosition(
    hmdWorldPos: THREE.Vector3,
    proposedWorldRootPos: THREE.Vector3,
  ): THREE.Vector3 {
    if (!this.enabled || this.colliders.length === 0) {
      return proposedWorldRootPos.clone();
    }

    const bodyCenter = new THREE.Vector3(
      hmdWorldPos.x,
      hmdWorldPos.y - PLAYER_HEIGHT * 0.5,
      hmdWorldPos.z,
    );

    const resolved = proposedWorldRootPos.clone();
    const result = this.testAllColliders(bodyCenter, PLAYER_RADIUS);
    if (result) {
      resolved.x += result.push.x;
      resolved.z += result.push.z;
    }

    return resolved;
  }

  // ─── Raycast helpers ───────────────────────────────────────────────────────

  public filterRaycastTargets(targets: THREE.Object3D[]): THREE.Object3D[] {
    if (this.raycastBlockers.length === 0) return targets;
    const blockerSet = new Set(this.raycastBlockers);
    return targets.filter((t) => {
      let current: THREE.Object3D | null = t;
      while (current) {
        if (blockerSet.has(current)) return false;
        current = current.parent;
      }
      return true;
    });
  }

  // ─── Debug ─────────────────────────────────────────────────────────────────

  public get colliderCount(): number {
    return this.colliders.length;
  }
}
