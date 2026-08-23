/**
 * CommonSpawnArea Component — Resonite-style user spawner with point generator.
 *
 * Maps to Resonite's Component:CommonSpawnArea which defines where and how
 * users spawn into a world. When multiple CommonSpawnArea components exist,
 * one is chosen based on BaseWeight.
 *
 * Key fields:
 *   - SpawnPointGenerator: position source (currently simplified to fixed offset)
 *   - FloorPointRay: ray direction to detect floor below spawn point
 *   - OtherUserCheckRadius: minimum distance from other users for valid spawn
 *   - OrientUser: face the spawn area's forward direction
 *   - Capacity: max users (-1 = unlimited)
 *   - BaseWeight: selection weight when multiple spawn areas exist
 */

import * as THREE from 'three';

// ─── CommonSpawnArea Component ──────────────────────────────────────────────

export interface CommonSpawnAreaComponent {
  enabled: boolean;
  persistent: boolean;
  updateOrder: number;

  /** Local-space offset from the slot's position for the spawn point. */
  spawnOffset: { x: number; y: number; z: number };

  /** Ray direction to detect floor below the spawn point (normalized). */
  floorPointRay: { x: number; y: number; z: number };

  /** Minimum distance (meters) from other users for a spawn point to be valid. */
  otherUserCheckRadius: number;

  /** If true, newly-spawned users face the spawn area's forward (-Z) direction. */
  orientUser: boolean;

  /** Maximum users this spawn area can hold. -1 = unlimited. */
  capacity: number;

  /** Selection weight when multiple CommonSpawnArea components exist. Higher = more likely. */
  baseWeight: number;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULT_COMMON_SPAWN_AREA: CommonSpawnAreaComponent = {
  enabled: true,
  persistent: true,
  updateOrder: 0,
  spawnOffset: { x: 0, y: 0, z: 0 },
  floorPointRay: { x: 0, y: -1, z: 0 },
  otherUserCheckRadius: 0.5,
  orientUser: false,
  capacity: -1,
  baseWeight: 1,
};

// ─── userData Helpers ──────────────────────────────────────────────────────

/**
 * Read the CommonSpawnArea component from an Object3D's userData.
 * Returns the component data if present, or undefined.
 */
export function getCommonSpawnArea(obj: THREE.Object3D): CommonSpawnAreaComponent | undefined {
  return (obj.userData as Record<string, unknown>)?.commonSpawnArea as CommonSpawnAreaComponent | undefined;
}

/**
 * Write a CommonSpawnArea component to an Object3D's userData.
 */
export function setCommonSpawnArea(
  obj: THREE.Object3D,
  component: CommonSpawnAreaComponent,
): void {
  (obj.userData as Record<string, unknown>).commonSpawnArea = component;
}

/**
 * Compute the world-space spawn position from a CommonSpawnArea component,
 * accounting for the parent slot's world transform.
 */
export function computeSpawnPosition(obj: THREE.Object3D): THREE.Vector3 {
  const component = getCommonSpawnArea(obj);
  const offset = component?.spawnOffset ?? DEFAULT_COMMON_SPAWN_AREA.spawnOffset;
  const localPos = new THREE.Vector3(offset.x, offset.y, offset.z);
  // Convert local offset to world space using the object's world matrix
  localPos.applyMatrix4(obj.matrixWorld);
  return localPos;
}
