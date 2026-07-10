import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { AssetManager, LoadedAsset } from '../engine/AssetManager.ts';
import type { InventoryService } from '../services/InventoryService.ts';
import type { ManipulationManager } from '../engine/ManipulationManager.ts';
import type { InventoryItem } from '../services/InventoryService.ts';
import { RawFilesStore } from '../services/RawFilesStore.ts';

/**
 * Lazy-share raw-mode hook. Encapsulates every piece of state and
 * behaviour the App.tsx main component needs so the parent stays a
 * simple consumer: pass the engine refs once via
 * `useRawMode(assetManager, inventoryService, manipulationManager)`,
 * and the returned object gives you:
 *
 *   - `rawFilesStore` — pass to `new AssetManager(scene, worldRoot,
 *     rawFilesStore)` so the raw-mode import short-circuit can
 *     `await store()` before the misc asset lands in the world.
 *   - `selectedRawAsset` / `setSelectedRawAsset` — drive a
 *     conditional `<MiscFileModal />` mount.
 *   - `isRawAsset(asset)` predicate — App.tsx's `net.onSyncReq`
 *     snapshot push loop uses it to skip raw lazy-share assets so
 *     late-joiners don't see a doc-card-with-no-body.
 *   - `handleRawImport`, `handleRawDownload`,
 *     `handleRawSaveToInventory` — three verb handlers that
 *     MiscFileModal's `onImport` / `onDownload` / `onSaveToInventory`
 *     props consume directly. Grab-begin / grab-end auto-detection
 *     is registered internally so App.tsx doesn't need to call any
 *     setup function explicitly.
 *
 * Three correctness requirements (raised in code review) live here:
 *
 *   1. Snapshot-skip (`isRawAsset`) lets the App.tsx snapshot-push
 *      loop filter out raw-mode assets.
 *   2. Re-import sequence: `handleRawImport` calls
 *      `assetManager.removeAsset(oldId)` BEFORE
 *      `assetManager.importFile(...)` so the old misc mesh is
 *      gone when the new mesh lands in `worldRoot` and the sync
 *      Map.replace under the same id can't collide.
 *   3. Orphan-IndexedDB cleanup: `handleRawImport` fires
 *      `rawFilesStore.delete(oldId)` after the import resolves so
 *      re-promoted bytes don't leak in IndexedDB indefinitely.
 */
export function useRawMode(
  assetManager: AssetManager | null,
  inventoryService: InventoryService | null,
  manipulationManager: ManipulationManager | null
) {
  // Per-asset local byte-storage. Lazily constructed once per App
  // lifetime — used both as the AssetManager constructor argument
  // (so the raw short-circuit AWAITS its store() call) AND for the
  // verb-rehydration / cleanup paths in this hook.
  const rawFilesStoreRef = useRef<RawFilesStore | null>(null);
  if (rawFilesStoreRef.current === null) {
    rawFilesStoreRef.current = new RawFilesStore();
  }
  const rawFilesStore = rawFilesStoreRef.current;

  // Hold the currently-grabbed raw-mode misc asset so MiscFileModal
  // can render its 3-button UX (Import / Download / Save to
  // Inventory) when the user grabs one.
  const [selectedRawAsset, setSelectedRawAsset] = useState<LoadedAsset | null>(null);

  // Public predicate App.tsx's `net.onSyncReq` snapshot loop uses to
  // skip raw lazy-share assets. Centralised here so the engine's
  // definition of "is raw" (userData.isRaw) lives in one file.
  const isRawAsset = useCallback(
    (asset: LoadedAsset): boolean => {
      return (asset.object3d.userData as { isRaw?: boolean } | undefined)?.isRaw === true;
    },
    []
  );

  // Grab-begin / grab-end auto-detection. The grab-begin listener
  // opens the modal when the user picks up a raw-mode misc asset;
  // the grab-end listener closes it on release. Listeners are
  // registered ONCE automatically on mount (and unregistered on
  // unmount) so App.tsx callers don't have to remember to wire a
  // setup function explicitly — the previous version exposed
  // register/unregister helpers but never auto-called them, which
  // left the auto-detection dead code. Registering inside an
  // effect-with-deps means the listeners re-bind cleanly when the
  // manipulationManager ref stabilises (typically once, after the
  // engine-init useEffect constructs it).
  useEffect(() => {
    if (!manipulationManager) return;
    const offBegin = manipulationManager.registerOnGrabBegin((asset) => {
      if (asset && isRawAsset(asset)) {
        setSelectedRawAsset(asset);
      }
    });
    const offEnd = manipulationManager.registerOnGrabEnd(() => {
      // Close on full release; the modal's own onClose handler
      // covers user-driven close (Cancel / backdrop click).
      setSelectedRawAsset(null);
    });
    return () => {
      try { offBegin(); } catch { /* noop */ }
      try { offEnd(); } catch { /* noop */ }
    };
  }, [manipulationManager, isRawAsset]);

  // Verb: re-import the raw bytes through the natural AssetManager
  // pipeline. The result is a properly-typed asset (image / video /
  // 3D-model / etc.) that auto-broadcasts to peers via the
  // existing registerOnAssetAdded callback. Implements:
  //   - FIX 2 (sequence): removeAsset(oldId) BEFORE importFile so the
  //     old misc mesh is gone when the new mesh lands in worldRoot
  //     (no two-mesh flicker, no Map collision).
  //   - FIX 3 (orphan IDB): await rawFilesStore.delete(oldId) after
  //     importFile resolves so the IndexedDB record under oldId
  //     is cleaned up (the new asset's lifecycle has no isRaw flag
  //     so its removeAsset wouldn't drop the orphan).
  const handleRawImport = useCallback(
    async (asset: LoadedAsset): Promise<void> => {
      if (!assetManager) {
        console.warn('[useRawMode] handleRawImport: assetManager unavailable');
        return;
      }
      const oldId = asset.id;
      const position = asset.object3d.position.clone();
      // Close the modal FIRST so the user sees the promote happen
      // cleanly — the misc asset is about to be replaced and a
      // lingering modal would feel stuck.
      setSelectedRawAsset(null);
      const freshFile = await assetManager.rehydrateRawFile(oldId);
      if (!freshFile) {
        console.warn('[useRawMode] handleRawImport: bytes missing in IndexedDB for', oldId);
        return;
      }
      // Sequence matters: remove first, then importFile will
      // re-fire onAssetAdded under the SAME id (no Map collision
      // since the Map isn't populated for the old misc until
      // importFile resolves — but we cleared via removeAsset which
      // deletes from the Map and worldRoot synchronously, so
      // importFile under the same id starts from a clean slate).
      assetManager.removeAsset(oldId);
      await assetManager.importFile(freshFile, position, {}, oldId);
      // Drop the orphaned byte record. Even if the new asset's
      // removeAsset fires later, the new asset has no `isRaw`
      // userData flag and its customDispose is the misc-texture
      // cleanup — neither hits rawFilesStore.delete, so without
      // this explicit call the IDB copy would live forever.
      try {
        await rawFilesStore.delete(oldId);
      } catch (err) {
        console.warn('[useRawMode] IDB cleanup after import failed', err);
      }
    },
    [assetManager, rawFilesStore]
  );

  // Verb: download the raw bytes to the user's device. freshFile is
  // already a Blob (File extends Blob) so we wrap it directly in
  // `new Blob([freshFile], ...)` — no need to re-allocate via
  // freshFile.arrayBuffer() and re-wrap. BlobParts accept any Blob /
  // ArrayBuffer / typed-array / string.
  const handleRawDownload = useCallback(
    async (asset: LoadedAsset): Promise<void> => {
      if (!assetManager) return;
      const freshFile = await assetManager.rehydrateRawFile(asset.id);
      if (!freshFile) {
        console.warn('[useRawMode] handleRawDownload: bytes missing in IndexedDB for', asset.id);
        return;
      }
      const blob = new Blob([freshFile], {
        type: freshFile.type || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = asset.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [assetManager]
  );

  // Verb: save to InventoryService. Constructs an InventoryItem with
  // the rehydrated bytes so the user can re-import later from the
  // inventory modal. No network broadcast — save-to-inventory is
  // local-only by user intent ("keep my own copy for later").
  // Note: InventoryItem.metadata's known fields are fileSize /
  // mimeType / description / folders — `extension` is stored
  // implicitly via the file extension encoded in the file name, so
  // we don't try to write a non-type-checker-known `extension`
  // field. (Earlier draft included it but failed TS2353.)
  const handleRawSaveToInventory = useCallback(
    async (asset: LoadedAsset): Promise<void> => {
      if (!assetManager || !inventoryService) {
        console.warn('[useRawMode] handleRawSaveToInventory: missing services');
        return;
      }
      const freshFile = await assetManager.rehydrateRawFile(asset.id);
      if (!freshFile) {
        console.warn('[useRawMode] handleRawSaveToInventory: bytes missing in IndexedDB for', asset.id);
        return;
      }
      const bytes = await freshFile.arrayBuffer();
      const item: InventoryItem = {
        id: `inv-raw-${asset.id}`,
        name: asset.name,
        type: 'misc',
        createdAt: Date.now(),
        fileData: bytes,
        metadata: {
          fileSize: bytes.byteLength,
          mimeType: freshFile.type || 'application/octet-stream',
        },
      };
      await inventoryService.saveItem(item);
    },
    [assetManager, inventoryService]
  );

  return useMemo(
    () => ({
      rawFilesStore,
      selectedRawAsset,
      setSelectedRawAsset,
      isRawAsset,
      handleRawImport,
      handleRawDownload,
      handleRawSaveToInventory,
    }),
    [
      rawFilesStore,
      selectedRawAsset,
      isRawAsset,
      handleRawImport,
      handleRawDownload,
      handleRawSaveToInventory,
    ]
  );
}
