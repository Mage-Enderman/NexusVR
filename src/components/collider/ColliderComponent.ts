/**
 * Collider Components — Resonite-style collider types that control physical
 * interaction (walking, collision, raycast blocking).
 *
 * Two collider types:
 *   - BoxCollider: axis-aligned box shape, most performant. For floors,
 *     walls, simple geometry.
 *   - MeshCollider: 1:1 triangle mesh shape, for complex terrain or
 *     irregular geometry. More expensive — use sparingly.
 *
 * Objects WITHOUT a collider component are pass-through (no collision).
 * Objects WITH an enabled collider block avatar movement through their volume.
 */

import * as THREE from 'three';

// ─── Shared collider fields ─────────────────────────────────────────────────

export type ColliderType = 'Static' | 'NoCollision';

/** Base fields shared by BoxCollider and MeshCollider. */
export interface BaseCollider {
  enabled: boolean;
  /** Local-space offset of the collider shape from the slot's position. */
  offset: { x: number; y: number; z: number };
  /** Whether this collider is static (immovable) or dynamic (future). */
  colliderType: ColliderType;
  /** Mass in kg (1 KG per cubic meter). Used for future physics. */
  mass: number;
  /** Whether an avatar is prevented from moving into the collider's volume. */
  characterCollider: boolean;
  /** Whether avatar lasers / raycasts are blocked by this collider. */
  ignoreRaycasts: boolean;
}

// ─── BoxCollider ─────────────────────────────────────────────────────────────

export interface BoxColliderComponent extends BaseCollider {
  type: 'box';
  /** Size of the box in local x, y, z (meters). */
  size: { x: number; y: number; z: number };
}

export const DEFAULT_BOX_COLLIDER: BoxColliderComponent = {
  type: 'box',
  enabled: true,
  offset: { x: 0, y: 0, z: 0 },
  colliderType: 'Static',
  mass: 1,
  characterCollider: true,
  ignoreRaycasts: false,
  size: { x: 1, y: 1, z: 1 },
};

// ─── MeshCollider ────────────────────────────────────────────────────────────

export type MeshColliderSidedness = 'Front' | 'Back' | 'Double';

export interface MeshColliderComponent extends BaseCollider {
  type: 'mesh';
  /** Which face(s) of the mesh are solid. */
  sidedness: MeshColliderSidedness;
}

export const DEFAULT_MESH_COLLIDER: MeshColliderComponent = {
  type: 'mesh',
  enabled: true,
  offset: { x: 0, y: 0, z: 0 },
  colliderType: 'Static',
  mass: 1,
  characterCollider: true,
  ignoreRaycasts: false,
  sidedness: 'Front',
};

// ─── Union type ──────────────────────────────────────────────────────────────

export type ColliderComponent = BoxColliderComponent | MeshColliderComponent;

// ─── userData helpers ────────────────────────────────────────────────────────

const COLLIDER_KEY = 'collider';

/**
 * Read the collider component from an Object3D's userData.
 * Returns undefined if no collider is set (object is pass-through).
 */
export function getCollider(obj: THREE.Object3D): ColliderComponent | undefined {
  const raw = (obj.userData as Record<string, unknown>)[COLLIDER_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as ColliderComponent;
}

/** Check if an object has an enabled collider component. */
export function hasCollider(obj: THREE.Object3D): boolean {
  const c = getCollider(obj);
  return c !== undefined && c.enabled === true;
}

/** Check if the collider blocks avatar movement. */
export function isCharacterCollider(obj: THREE.Object3D): boolean {
  const c = getCollider(obj);
  return c !== undefined && c.enabled === true && c.characterCollider === true;
}

/** Check if the collider blocks raycasts. */
export function isRaycastBlocker(obj: THREE.Object3D): boolean {
  const c = getCollider(obj);
  return c !== undefined && c.enabled === true && c.ignoreRaycasts === true;
}

/** Store a collider component on an Object3D's userData. */
export function setCollider(obj: THREE.Object3D, component: ColliderComponent | undefined): void {
  if (component === undefined) {
    delete (obj.userData as Record<string, unknown>)[COLLIDER_KEY];
  } else {
    (obj.userData as Record<string, unknown>)[COLLIDER_KEY] = component;
  }
}

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Serialize a collider component for scene save / network broadcast.
 * Omits default values to keep the save file compact.
 */
export function serializeCollider(component: ColliderComponent | undefined): Record<string, unknown> | null {
  if (!component) return null;
  if (!component.enabled) return { enabled: false };

  const data: Record<string, unknown> = { type: component.type };
  let hasNonDefault = false;

  // Base fields — only serialize non-defaults
  const def = component.type === 'box' ? DEFAULT_BOX_COLLIDER : DEFAULT_MESH_COLLIDER;
  if (component.offset.x !== def.offset.x || component.offset.y !== def.offset.y || component.offset.z !== def.offset.z) {
    data.offset = { ...component.offset }; hasNonDefault = true;
  }
  if (component.colliderType !== def.colliderType) { data.colliderType = component.colliderType; hasNonDefault = true; }
  if (component.mass !== def.mass) { data.mass = component.mass; hasNonDefault = true; }
  if (!component.characterCollider) { data.characterCollider = false; hasNonDefault = true; }
  if (component.ignoreRaycasts) { data.ignoreRaycasts = true; hasNonDefault = true; }

  if (component.type === 'box') {
    if (component.size.x !== 1 || component.size.y !== 1 || component.size.z !== 1) {
      data.size = { ...component.size }; hasNonDefault = true;
    }
  }
  if (component.type === 'mesh') {
    if ((component as MeshColliderComponent).sidedness !== 'Front') {
      data.sidedness = (component as MeshColliderComponent).sidedness; hasNonDefault = true;
    }
  }

  return hasNonDefault ? data : { type: component.type };
}

/** Deserialize a collider component from scene save / network data. */
export function deserializeCollider(data: Record<string, unknown> | null | undefined): ColliderComponent | undefined {
  if (!data) return undefined;

  if (data.enabled === false) return undefined;

  const type = data.type as string;
  if (type === 'box') {
    return { ...DEFAULT_BOX_COLLIDER, ...data, type: 'box' } as BoxColliderComponent;
  }
  if (type === 'mesh') {
    return { ...DEFAULT_MESH_COLLIDER, ...data, type: 'mesh' } as MeshColliderComponent;
  }

  return undefined;
}

// ─── Three.js geometry helpers ───────────────────────────────────────────────

/**
 * Build a THREE.Box3 for a BoxCollider in world space.
 * Takes the object's world transform and applies the collider's offset + size.
 */
export function buildBoxColliderWorldBox(obj: THREE.Object3D, collider: BoxColliderComponent): THREE.Box3 {
  const worldPos = new THREE.Vector3();
  obj.getWorldPosition(worldPos);
  const worldQuat = new THREE.Quaternion();
  obj.getWorldQuaternion(worldQuat);
  const worldScale = new THREE.Vector3();
  obj.getWorldScale(worldScale);

  const halfSize = new THREE.Vector3(
    collider.size.x * 0.5 * worldScale.x,
    collider.size.y * 0.5 * worldScale.y,
    collider.size.z * 0.5 * worldScale.z,
  );

  // Apply offset in local space, then transform to world
  const offset = new THREE.Vector3(collider.offset.x, collider.offset.y, collider.offset.z);
  offset.applyQuaternion(worldQuat);
  offset.multiply(worldScale);
  worldPos.add(offset);

  return new THREE.Box3().setFromCenterAndSize(worldPos, halfSize.multiplyScalar(2));
}

/**
 * Build a THREE.Mesh for a MeshCollider's collision shape.
 * For BoxCollider this returns a BoxGeometry mesh.
 * For MeshCollider this returns the object's own geometry (if it has one).
 *
 * The returned mesh is suitable for raycasting / intersection tests.
 */
export function buildColliderMesh(obj: THREE.Object3D, collider: ColliderComponent): THREE.Mesh | null {
  if (collider.type === 'box') {
    const box = collider as BoxColliderComponent;
    const geo = new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geo, mat);

    // Position the collider mesh to match the object + offset
    mesh.position.copy(obj.position);
    mesh.quaternion.copy(obj.quaternion);
    mesh.scale.copy(obj.scale);
    mesh.position.add(
      new THREE.Vector3(box.offset.x, box.offset.y, box.offset.z).applyQuaternion(mesh.quaternion).multiply(mesh.scale)
    );

    return mesh;
  }

  if (collider.type === 'mesh') {
    // Use the object's own geometry for a 1:1 collision shape
    const geom = findMeshGeometry(obj);
    if (!geom) return null;

    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(obj.position);
    mesh.quaternion.copy(obj.quaternion);
    mesh.scale.copy(obj.scale);
    mesh.updateMatrixWorld(true);

    return mesh;
  }

  return null;
}

/**
 * Recursively search an Object3D subtree for a geometry we can use
 * for mesh collision. Returns the first BufferGeometry found.
 */
function findMeshGeometry(obj: THREE.Object3D): THREE.BufferGeometry | null {
  if (obj instanceof THREE.Mesh && obj.geometry) {
    return obj.geometry;
  }
  for (const child of obj.children) {
    const found = findMeshGeometry(child);
    if (found) return found;
  }
  return null;
}

/**
 * Create a visible wireframe helper mesh for a collider.
 * Useful for debugging — shows the collision volume in the scene.
 */
export function createColliderHelper(obj: THREE.Object3D, collider: ColliderComponent): THREE.Object3D | null {
  if (!collider.enabled) return null;

  if (collider.type === 'box') {
    const box = collider as BoxColliderComponent;
    const geo = new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 1, transparent: true, opacity: 0.6 });
    const helper = new THREE.LineSegments(edges, mat);
    helper.name = 'ColliderHelper';

    // Apply offset
    helper.position.set(collider.offset.x, collider.offset.y, collider.offset.z);

    return helper;
  }

  if (collider.type === 'mesh') {
    // For mesh colliders, show a wireframe of the geometry
    const geom = findMeshGeometry(obj);
    if (!geom) return null;

    const edges = new THREE.EdgesGeometry(geom, 30);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 1, transparent: true, opacity: 0.6 });
    const helper = new THREE.LineSegments(edges, mat);
    helper.name = 'ColliderHelper';

    return helper;
  }

  return null;
}
