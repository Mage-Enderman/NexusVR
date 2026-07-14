import * as THREE from 'three';

/**
 * Find an Object3D by UUID within a subtree.
 */
export function findObjectByUUID(root: THREE.Object3D, uuid: string | null): THREE.Object3D | null {
  if (!uuid) return null;
  if (root.uuid === uuid) return root;
  for (const child of root.children) {
    const found = findObjectByUUID(child, uuid);
    if (found) return found;
  }
  return null;
}
