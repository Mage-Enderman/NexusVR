/**
 * Grabbable Component — Resonite-style component that controls whether
 * an object can be grabbed (RMB desktop grab, VR grip grab, E+drag rotate).
 *
 * Modeled after Resonite's Component:Grabbable. An object MUST have an
 * enabled Grabbable component to be grabbable. Without it (or if disabled),
 * the grab raycasts will pass through the object.
 *
 * Key fields:
 *   - enabled: master switch; false = object is not grabbable at all
 *   - scalable: whether two-handed grab scaling is allowed
 *   - allowSteal: whether other users can grab the slot
 *   - grabPriority: higher = grabbed first when overlapping
 *   - editModeOnly: only grabbable in edit mode (future)
 *   - destroyOnRelease: slot destroyed when dropped (future)
 *   - reparentOnRelease: reparent to last parent vs world root (future)
 */

import type * as THREE from 'three';

export interface GrabbableComponent {
  /** Master switch — false disables all grab interaction on this object. */
  enabled: boolean;

  /** Whether two-handed scale is allowed when grabbing with both VR grips. */
  scalable: boolean;

  /** Whether other users can steal-grab this object. */
  allowSteal: boolean;

  /** Higher priority wins when multiple grabbable objects overlap. */
  grabPriority: number;

  /** Only grabbable when the app is in edit mode (future). */
  editModeOnly: boolean;

  /** Slot destroyed when dropped (future). */
  destroyOnRelease: boolean;

  /** Reparent to last parent vs world root on drop (future). */
  reparentOnRelease: boolean;

  /** Preserve user-space parenting on release (future). */
  preserveUserSpace: boolean;

  /** Drop when the component is disabled (future). */
  dropOnDisable: boolean;

  /**
   * List of user IDs allowed to grab this object.
   * Empty = anyone can grab. (Future: per-user restriction.)
   */
  allowedUsers: string[];
}

/** Default Grabbable component — all objects are grabbable by default. */
export const DEFAULT_GRABBABLE: GrabbableComponent = {
  enabled: true,
  scalable: true,
  allowSteal: true,
  grabPriority: 0,
  editModeOnly: false,
  destroyOnRelease: false,
  reparentOnRelease: false,
  preserveUserSpace: false,
  dropOnDisable: false,
  allowedUsers: [],
};

/**
 * Read the Grabbable component from an Object3D's userData.
 *
 * Backward-compatible with the legacy boolean `userData.grabbable`:
 *   - `undefined` → default (grabbable)
 *   - `true`      → enabled GrabbableComponent
 *   - `false`     → disabled GrabbableComponent
 *   - object      → returned as-is (with defaults merged)
 */
export function getGrabbable(obj: THREE.Object3D): GrabbableComponent {
  const raw = (obj.userData as Record<string, unknown>).grabbable;

  if (raw === undefined || raw === null) {
    // No component set → default (grabbable)
    return { ...DEFAULT_GRABBABLE };
  }

  if (typeof raw === 'boolean') {
    // Legacy boolean → convert to component
    return { ...DEFAULT_GRABBABLE, enabled: raw };
  }

  if (typeof raw === 'object' && raw !== null) {
    // Already a component — merge with defaults for any missing fields
    return { ...DEFAULT_GRABBABLE, ...(raw as Partial<GrabbableComponent>) };
  }

  return { ...DEFAULT_GRABBABLE };
}

/**
 * Check if an object3d is grabbable (has an enabled Grabbable component).
 * This is the gate function — call it before initiating any grab.
 */
export function isGrabbable(obj: THREE.Object3D): boolean {
  return getGrabbable(obj).enabled === true;
}

/**
 * Check if two-handed scaling is allowed for this grabbable object.
 */
export function isScalable(obj: THREE.Object3D): boolean {
  const grabbable = getGrabbable(obj);
  return grabbable.enabled && grabbable.scalable;
}

/**
 * Store a Grabbable component on an Object3D's userData.
 */
export function setGrabbable(obj: THREE.Object3D, component: GrabbableComponent): void {
  (obj.userData as Record<string, unknown>).grabbable = component;
}

/**
 * Serialize a Grabbable component for scene save / network broadcast.
 * Omits default values to keep the save file compact.
 */
export function serializeGrabbable(component: GrabbableComponent): Record<string, unknown> | null {
  if (!component.enabled) {
    return { enabled: false };
  }

  const data: Record<string, unknown> = {};
  let hasNonDefault = false;

  // Only serialize non-default values
  if (!component.scalable) { data.scalable = false; hasNonDefault = true; }
  if (!component.allowSteal) { data.allowSteal = false; hasNonDefault = true; }
  if (component.grabPriority !== 0) { data.grabPriority = component.grabPriority; hasNonDefault = true; }
  if (component.editModeOnly) { data.editModeOnly = true; hasNonDefault = true; }
  if (component.destroyOnRelease) { data.destroyOnRelease = true; hasNonDefault = true; }
  if (component.reparentOnRelease) { data.reparentOnRelease = true; hasNonDefault = true; }
  if (component.preserveUserSpace) { data.preserveUserSpace = true; hasNonDefault = true; }
  if (component.dropOnDisable) { data.dropOnDisable = true; hasNonDefault = true; }
  if (component.allowedUsers.length > 0) { data.allowedUsers = component.allowedUsers; hasNonDefault = true; }

  // If all fields are defaults (except enabled=true), don't serialize at all
  return hasNonDefault ? data : null;
}

/**
 * Deserialize a Grabbable component from scene save / network data.
 */
export function deserializeGrabbable(data: Record<string, unknown> | null | undefined): GrabbableComponent {
  if (!data) return { ...DEFAULT_GRABBABLE };
  return { ...DEFAULT_GRABBABLE, ...data } as GrabbableComponent;
}
