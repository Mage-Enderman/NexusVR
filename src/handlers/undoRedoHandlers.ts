/**
 * Undo/Redo and Asset Snapshot Handlers
 *
 * Extracted from App.tsx to modularize snapshot recording,
 * transform snapshot capture/restoration, and asset spawn/respawn undo/redo.
 */

import * as THREE from 'three';
import type { AssetManager, LoadedAsset } from '../engine/AssetManager.ts';
import type { ManipulationManager } from '../engine/ManipulationManager.ts';
import type { NetworkService, AssetSpawnData } from '../services/NetworkService.ts';
import type { UndoRedoManager, TransformSnapshot, AssetSnapshot } from '../services/UndoRedoManager.ts';

export interface CreateUndoRedoHandlersOptions {
  undoRedoManagerRef: React.MutableRefObject<UndoRedoManager>;
  assetManagerRef: React.MutableRefObject<AssetManager | null>;
  networkServiceRef: React.MutableRefObject<NetworkService>;
  manipulationManagerRef: React.MutableRefObject<ManipulationManager | null>;
  setSelectedAsset: React.Dispatch<React.SetStateAction<LoadedAsset | null>>;
}

export interface UndoRedoHandlers {
  captureSnapshot: (asset: LoadedAsset) => TransformSnapshot;
  applyTransformSnapshot: (assetId: string, snap: TransformSnapshot) => void;
  recordSpawnUndo: (asset: LoadedAsset) => void;
  respawnFromSnapshot: (snap: AssetSnapshot, latestId?: { value: string }) => void;
}

export function createUndoRedoHandlers({
  undoRedoManagerRef,
  assetManagerRef,
  networkServiceRef,
  manipulationManagerRef,
  setSelectedAsset,
}: CreateUndoRedoHandlersOptions): UndoRedoHandlers {
  const captureSnapshot = (asset: LoadedAsset): TransformSnapshot => {
    const obj = asset.object3d;
    return {
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    };
  };

  const applyTransformSnapshot = (assetId: string, snap: TransformSnapshot) => {
    const am = assetManagerRef.current;
    if (!am) return;
    const asset = am.assets.get(assetId);
    if (!asset) return;
    asset.object3d.position.set(...snap.position);
    asset.object3d.rotation.set(...snap.rotation);
    asset.object3d.scale.set(...snap.scale);
    networkServiceRef.current.broadcastAssetUpdate(asset);
    // If this asset is currently selected, force React re-render
    if (manipulationManagerRef.current?.selectedAsset?.id === assetId) {
      setSelectedAsset({ ...asset });
    }
  };

  const respawnFromSnapshot = (snap: AssetSnapshot, latestId?: { value: string }) => {
    const am = assetManagerRef.current;
    if (!am) return;
    const pos = new THREE.Vector3(...snap.position);
    let asset: LoadedAsset | null = null;
    if (snap.type === 'primitive' && snap.primitiveType) {
      asset = am.spawnPrimitive(snap.primitiveType as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane', pos);
    } else if (snap.fileData && snap.name) {
      const blob = new Blob([snap.fileData]);
      const file = new File([blob], snap.name);
      am.importFile(file, pos).then((a) => {
        if (a) {
          a.object3d.rotation.set(...snap.rotation);
          a.object3d.scale.set(...snap.scale);
          if (snap.isPersistent !== undefined) {
            a.object3d.userData.isPersistent = snap.isPersistent;
          }
          if (latestId) latestId.value = a.id;
          networkServiceRef.current.broadcastSpawn({
            id: a.id,
            name: a.name,
            type: a.type as AssetSpawnData['type'],
            position: snap.position,
            rotation: snap.rotation,
            scale: snap.scale,
            url: a.url,
            fileData: a.fileData,
            isCollidable: a.isCollidable,
            isPersistent: snap.isPersistent,
          });
        }
      });
      return;
    }
    if (asset) {
      asset.object3d.rotation.set(...snap.rotation);
      asset.object3d.scale.set(...snap.scale);
      if (snap.isPersistent !== undefined) {
        asset.object3d.userData.isPersistent = snap.isPersistent;
      }
      if (latestId) latestId.value = asset.id;
      networkServiceRef.current.broadcastSpawn({
        id: asset.id,
        name: asset.name,
        type: asset.type as AssetSpawnData['type'],
        position: snap.position,
        rotation: snap.rotation,
        scale: snap.scale,
        url: asset.url,
        fileData: asset.fileData,
        isCollidable: asset.isCollidable,
        isPersistent: snap.isPersistent,
      });
    } else {
      console.warn(`[UndoRedo] Could not respawn asset "${snap.name}" - no primitiveType, fileData, or url.`);
    }
  };

  const recordSpawnUndo = (asset: LoadedAsset) => {
    const obj = asset.object3d;
    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      url: asset.url,
      fileData: asset.fileData,
      primitiveType: (obj.userData as Record<string, unknown>)?.primitiveType as string | undefined,
      isCollidable: asset.isCollidable,
      isPersistent: (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
    };
    const latestId = { value: asset.id };
    undoRedoManagerRef.current.push({
      label: `Spawn ${asset.name}`,
      undo: () => {
        const am = assetManagerRef.current;
        if (!am) return;
        am.removeAsset(latestId.value);
        networkServiceRef.current.broadcastRemove(latestId.value);
        if (manipulationManagerRef.current?.selectedAsset?.id === latestId.value) {
          manipulationManagerRef.current.selectAsset(null);
          setSelectedAsset(null);
        }
      },
      redo: () => {
        respawnFromSnapshot(snapshot, latestId);
      },
    });
  };

  return {
    captureSnapshot,
    applyTransformSnapshot,
    recordSpawnUndo,
    respawnFromSnapshot,
  };
}
