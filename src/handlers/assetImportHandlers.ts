/**
 * Asset Import / Spawn Handlers
 *
 * Extracted from App.tsx to reduce that file's ~4900-line footprint.
 * Follows the same "deps object" pattern as createPanelActionHandler:
 * all React refs / state-setters are passed in once, so handler
 * closures always read fresh values without stale-closure bugs.
 */

import * as THREE from 'three';
import { AssetManager } from '../engine/AssetManager.ts';
import type { AssetType, LoadedAsset } from '../engine/AssetManager.ts';
import type { SceneEngine } from '../engine/SceneEngine.ts';
import type { ManipulationManager } from '../engine/ManipulationManager.ts';
import type { AvatarManager } from '../engine/AvatarManager.ts';
import type { NetworkService, AssetSpawnData, PendingSpawnData, MaterialUpdate } from '../services/NetworkService.ts';
import type { VideoStreamingService } from '../services/VideoStreamingService.ts';
import type { InventoryService, InventoryItem } from '../services/InventoryService.ts';
import { ROLE_PERMISSIONS } from '../types/permissions.ts';
import type { UserRole } from '../types/permissions.ts';
import type { ToolType } from '../components/WorldToolsPanel.tsx';
import type { ImportConfig } from '../components/AssetImportDialog.tsx';
import { toast } from '../services/ToastService.ts';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Streaming threshold mirrors NetworkService.MAX_INLINED_FILE_BYTES (15 MB). */
const VIDEO_STREAMING_THRESHOLD = 15 * 1024 * 1024;

// ─── Pure helpers (no refs) ─────────────────────────────────────────────────

/**
 * Build a small 3D loading placeholder at the given world position.
 * Returns the THREE.Group (already positioned, NOT yet parented) plus
 * a `dispose()` cleanup callback that releases all GPU resources.
 */
export function createLoadingPlaceholder(
  name: string,
  requesterName: string,
  position: THREE.Vector3,
  isOversized: boolean = false
): { group: THREE.Group; dispose: () => void; setProgress: (pct: number | null) => void } {
  const group = new THREE.Group();
  group.name = `Loading Placeholder (${name})`;
  group.position.copy(position);

  const primaryColor = isOversized ? 0xff3344 : 0x00f0ff;
  const secondaryColor = isOversized ? 0xff5566 : 0xa855f7;
  const primaryHex = isOversized ? '#ff3344' : '#00f0ff';
  const nameHex = isOversized ? '#ff8899' : '#e2e8f0';
  const titleText = isOversized ? 'Too Large' : 'Loading';

  const icoGeo = new THREE.IcosahedronGeometry(0.4, 0);
  const icoMat = new THREE.MeshBasicMaterial({
    color: primaryColor,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
  });
  group.add(new THREE.Mesh(icoGeo, icoMat));

  const ringGeo = new THREE.TorusGeometry(0.55, 0.02, 16, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: secondaryColor,
    transparent: true,
    opacity: 0.5,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { group, dispose: () => { group.traverse((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); } }); }, setProgress: () => {} };

  let lastDrawnPct = -1;
  let spriteTexture: THREE.CanvasTexture | null = null;
  const redraw = () => {
    if (!ctx) return;
    const now = (performance.now && performance.now()) || Date.now();
    ctx.clearRect(0, 0, 512, 128);

    // Ellipsis that cycles … → . → (blank) every 500ms
    const dots = ['...', '..', '.', ''];
    const dotIdx = Math.floor(now / 500) % dots.length;
    const titleWithPct = lastDrawnPct >= 0
      ? `${titleText} (${lastDrawnPct}%)`
      : `${titleText}${dots[dotIdx]}`;

    const maxLen = 26;
    const displayName = name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;

    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = primaryHex;
    ctx.textAlign = 'center';
    ctx.fillText(titleWithPct, 256, 40);

    ctx.font = '20px sans-serif';
    ctx.fillStyle = nameHex;
    ctx.fillText(displayName, 256, 72);

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`by ${requesterName}`, 256, 100);

    if (spriteTexture) spriteTexture.needsUpdate = true;
  };

  spriteTexture = new THREE.CanvasTexture(canvas);
  spriteTexture.minFilter = THREE.LinearFilter;
  spriteTexture.magFilter = THREE.LinearFilter;
  redraw();

  const spriteMat = new THREE.SpriteMaterial({ map: spriteTexture, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.set(0, 0.9, 0);
  group.add(sprite);

  // Start the pulsing animation — ice‑blue ring breathes in and out
  let disposed = false;
  let pulseFrame = 0;
  const pulse = () => {
    if (disposed) return;
    pulseFrame++;
    const s = 1 + 0.12 * Math.sin(pulseFrame * 0.06);
    ring.scale.set(s, s, s);
    // Redraw the sprite texture every ~200ms so the animated
    // ellipsis cycles even while no progress events arrive.
    if (pulseFrame % 12 === 0) redraw();
    requestAnimationFrame(pulse);
  };
  pulseFrame = requestAnimationFrame(pulse);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(pulseFrame);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mat = child.material as THREE.Material;
        mat.dispose();
      } else if (child instanceof THREE.Sprite) {
        const mat = child.material as THREE.SpriteMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  };

  const setProgress = (pct: number | null) => {
    const clamped = pct === null ? -1 : Math.max(0, Math.min(100, Math.round(pct)));
    lastDrawnPct = clamped;
    redraw();
  };

  return { group, dispose, setProgress };
}

/** File-extension → AssetType mapping. */
export function guessAssetType(filename: string): AssetType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.vrm')) return 'vrm';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.endsWith('.obj') || lower.endsWith('.fbx')) return '3d-model';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return 'image';
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) return 'video';
  if (lower.endsWith('.mp3') || lower.endsWith('.ogg') || lower.endsWith('.wav')) return 'audio';
  return 'misc';
}

// ─── Dependency interface ───────────────────────────────────────────────────

export interface AssetImportHandlerDeps {
  // Engine refs
  sceneEngineRef: React.MutableRefObject<SceneEngine | null>;
  assetManagerRef: React.MutableRefObject<AssetManager | null>;
  manipulationManagerRef: React.MutableRefObject<ManipulationManager | null>;
  avatarManagerRef: React.MutableRefObject<AvatarManager | null>;
  networkServiceRef: React.MutableRefObject<NetworkService>;
  videoStreamingServiceRef: React.MutableRefObject<VideoStreamingService>;
  inventoryServiceRef: React.MutableRefObject<InventoryService>;

  // Placeholder tracking
  pendingAssetsRef: React.MutableRefObject<Map<string, { group: THREE.Group; dispose: () => void; setProgress?: (pct: number | null) => void; oversized?: boolean }>>;
  streamingSuppressedAssetIdsRef: React.MutableRefObject<Set<string>>;

  // React state setters
  setActiveVideoAssetId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveTool: React.Dispatch<React.SetStateAction<ToolType | null>>;
  setShowToolsPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInventoryModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDashMenu: React.Dispatch<React.SetStateAction<boolean>>;

  // Callbacks
  resetVideoInactivityTimer: () => void;
  recordSpawnUndo: (asset: LoadedAsset) => void;
  localRole: UserRole;
}

// ─── Handler factory ────────────────────────────────────────────────────────

export function createAssetImportHandlers(deps: AssetImportHandlerDeps) {
  const {
    sceneEngineRef,
    assetManagerRef,
    manipulationManagerRef,
    avatarManagerRef,
    networkServiceRef,
    videoStreamingServiceRef,
    inventoryServiceRef,
    pendingAssetsRef,
    streamingSuppressedAssetIdsRef,
    setActiveVideoAssetId,
    setActiveTool,
    setShowToolsPanel,
    setShowInventoryModal,
    setShowDashMenu,
    resetVideoInactivityTimer,
    recordSpawnUndo,
    localRole,
  } = deps;

  // ─── Helpers ────────────────────────────────────────────────────────────

  const getSpawnPositionInFrontOfUser = (distance = 2.0): THREE.Vector3 => {
    const se = sceneEngineRef.current;
    if (!se?.camera) return new THREE.Vector3(0, 1.5, -distance);
    const cam = se.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize().multiplyScalar(distance);
    const pos = cam.position.clone().add(forward);
    pos.y = Math.max(0.6, cam.position.y - 0.15);
    return pos;
  };

  // ─── handleSpawnPrimitive ───────────────────────────────────────────────

  const handleSpawnPrimitive = (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => {
    if (!ROLE_PERMISSIONS[localRole]?.canSpawnItems && !ROLE_PERMISSIONS[localRole]?.canEditWorld) {
      alert('Your current role does not have permission to spawn items.');
      return;
    }
    const pos = getSpawnPositionInFrontOfUser(2.0);
    const prim = assetManagerRef.current?.spawnPrimitive(type, pos);
    if (prim) {
      manipulationManagerRef.current?.selectAsset(prim);
      recordSpawnUndo(prim);
    }
  };

  // ─── handleImportFile ───────────────────────────────────────────────────

  const handleImportFile = async (
    file: File,
    saveToInventory: boolean,
    equipVrm: boolean,
    videoSyncMode: 'persistent' | 'watch-party' = 'persistent'
  ) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    if (file.name.toLowerCase().endsWith('.vrm') && equipVrm) {
      const vrm = await avatarManagerRef.current?.loadLocalVRM(file);
      if (vrm) {
        const net = networkServiceRef.current;
        if (avatarManagerRef.current?.localVrmBuffer && net && net.mode !== 'offline') {
          net.broadcastAvatarVRM(avatarManagerRef.current.localVrmBuffer);
        }
        if (saveToInventory) {
          const buffer = avatarManagerRef.current?.localVrmBuffer || (await file.arrayBuffer());
          const item: InventoryItem = {
            id: `vrm-${Date.now()}`,
            name: file.name,
            type: 'vrm',
            createdAt: Date.now(),
            fileData: buffer,
            metadata: { fileSize: file.size, mimeType: file.type }
          };
          await inventoryServiceRef.current.saveItem(item);
        }
      }
      return;
    }

    const pos = getSpawnPositionInFrontOfUser(2.0);
    const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const net = networkServiceRef.current;
    const displayName = file.name.length > 26 ? file.name.slice(0, 25) + '…' : file.name;
    if (net.mode !== 'offline') {
      net.broadcastPendingSpawn({
        id: placeholderId,
        type: guessAssetType(file.name),
        name: displayName,
        requesterId: net.localPeerId,
        requesterName: net.localUserName,
        position: [pos.x, pos.y, pos.z],
        fileSize: file.size,
      });
    }

    const localEntry = createLoadingPlaceholder(displayName, net.localUserName, pos);
    sceneEngineRef.current?.worldRoot.add(localEntry.group);
    pendingAssetsRef.current.set(placeholderId, localEntry);

    streamingSuppressedAssetIdsRef.current.add(placeholderId);
    if (file) net.registerHostedFile(placeholderId, file);
    try {
      const asset = await assetManager.importFile(file, pos, { videoSyncMode }, placeholderId);
      if (asset) {
        if (asset.type === 'video') {
          setActiveVideoAssetId(asset.id);
          resetVideoInactivityTimer();
        } else if (asset.type !== 'audio') {
          manipulationManagerRef.current?.selectAsset(asset);
        }
        recordSpawnUndo(asset);
        if (asset) {
          asset.object3d.userData.fileSize = file.size;
          asset.object3d.userData.importerPeerId = net.localPeerId;
          if (file) {
            net.registerHostedFile(asset.id, file);
          }
        }
        const isP2PTransferNeeded = !asset.fileData && file;
        const p2pTransferHint = isP2PTransferNeeded ? { id: asset.id, size: file.size } : undefined;
        if (asset.type === 'video') {
          const vss = videoStreamingServiceRef.current;
          const hint = file ? vss.registerHostFile(file, asset.id, file.type) : undefined;
          if (hint) {
            (asset.object3d.userData as Record<string, unknown>).streamingHint = hint;
          }
          if (net.mode !== 'offline') {
            net.broadcastSpawn({
              id: asset.id,
              name: asset.name,
              type: asset.type as AssetSpawnData['type'],
              position: [asset.object3d.position.x, asset.object3d.position.y, asset.object3d.position.z],
              rotation: [asset.object3d.rotation.x, asset.object3d.rotation.y, asset.object3d.rotation.z],
              scale: [asset.object3d.scale.x, asset.object3d.scale.y, asset.object3d.scale.z],
              url: asset.url,
              primitiveType: (asset.object3d.userData as Record<string, unknown>)?.primitiveType as AssetSpawnData['primitiveType'],
              fileData: (videoSyncMode !== 'watch-party' && file.size <= VIDEO_STREAMING_THRESHOLD) ? asset.fileData : undefined,
              fileDataOversized: isP2PTransferNeeded ? true : undefined,
              p2pTransferHint,
              fileSize: file.size,
              importerPeerId: net.localPeerId,
              isCollidable: asset.isCollidable,
              isPersistent: (asset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
              materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
              videoAspectRatio: (asset.object3d.userData as Record<string, unknown>)?.videoAspectRatio as '16:9' | '9:16' | '1:1' | 'auto' | undefined,
              streamingHint: hint,
              grabbable: (asset.object3d.userData as Record<string, unknown>)?.grabbable as Record<string, unknown> | undefined
            });
            for (const peerId of net.peers) {
              if (videoSyncMode === 'watch-party' && asset.videoElement) {
                vss.startLiveStreamToPeer(asset.id, asset.videoElement, peerId);
              } else if (hint) {
                vss.beginStreamingToPeer(hint, peerId).catch((err) => {
                  console.warn('[VideoStreaming] pump failed for', peerId, err);
                });
              }
            }
          }
        }
        if (asset.type === 'audio' && net.mode !== 'offline') {
          const audioState = (asset.object3d.userData as Record<string, unknown>)?.audioState as Record<string, unknown> | undefined;
          net.broadcastSpawn({
            id: asset.id,
            name: asset.name,
            type: asset.type as AssetSpawnData['type'],
            position: [asset.object3d.position.x, asset.object3d.position.y, asset.object3d.position.z],
            rotation: [asset.object3d.rotation.x, asset.object3d.rotation.y, asset.object3d.rotation.z],
            scale: [asset.object3d.scale.x, asset.object3d.scale.y, asset.object3d.scale.z],
            url: asset.url,
            fileData: asset.fileData,
            fileDataOversized: isP2PTransferNeeded ? true : undefined,
            p2pTransferHint,
            fileSize: file.size,
            importerPeerId: net.localPeerId,
            isCollidable: asset.isCollidable,
            isPersistent: (asset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
            materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
            audioLoop: audioState?.loop as boolean | undefined,
            audioPlaybackRate: audioState?.playbackRate as number | undefined,
            grabbable: (asset.object3d.userData as Record<string, unknown>)?.grabbable as Record<string, unknown> | undefined
          });
        }
        if (saveToInventory) {
          const item: InventoryItem = {
            id: asset.id,
            name: asset.name,
            type: asset.type,
            createdAt: Date.now(),
            fileData: asset.fileData,
            url: asset.url,
            metadata: asset.metadata || { fileSize: file.size, mimeType: file.type }
          };
          await inventoryServiceRef.current.saveItem(item);
        }
        toast.success(`Imported "${displayName}"`);
      } else {
        throw new Error('AssetManager returned null');
      }
    } catch (err) {
      sceneEngineRef.current?.worldRoot.remove(localEntry.group);
      localEntry.dispose();
      pendingAssetsRef.current.delete(placeholderId);
      if (net.mode !== 'offline') {
        net.broadcastPendingCancel(placeholderId);
      }
      console.warn('[Import] Failed:', err);
      // Surface the failure to the user — previously this was console-only,
      // so a bad GLB/URL just looked like the import silently vanished.
      toast.error(`Import failed for "${displayName}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      streamingSuppressedAssetIdsRef.current.delete(placeholderId);
    }
  };

  // ─── handleImportAssetFromConfig ────────────────────────────────────────

  const handleImportAssetFromConfig = async (config: ImportConfig) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    if (config.file && config.file.name.toLowerCase().endsWith('.vrm') && config.vrmAction === 'equip-avatar' && !config.importAsRawFile) {
      await avatarManagerRef.current?.loadLocalVRM(config.file);
      toast.success(`Avatar "${config.file.name}" equipped`);
      if (config.saveToInventory && inventoryServiceRef.current) {
        const buffer = await config.file.arrayBuffer();
        await inventoryServiceRef.current.saveItem({
          id: `vrm-${Date.now()}`,
          name: config.file.name,
          type: 'vrm',
          createdAt: Date.now(),
          fileData: buffer,
          metadata: { fileSize: config.file.size, mimeType: config.file.type }
        });
      }
      return;
    }

    const pos = getSpawnPositionInFrontOfUser(2.2);
    const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const net = networkServiceRef.current;
    const rawName = (config.file?.name ?? config.url?.split('/').pop() ?? 'Asset').split(/[/?]/).pop() ?? 'Asset';
    const displayName = rawName.length > 26 ? rawName.slice(0, 25) + '…' : rawName;
    const assetType: AssetType = guessAssetType((config.file?.name ?? config.url ?? ''));

    if (net.mode !== 'offline') {
      const pendingData: PendingSpawnData = {
        id: placeholderId,
        type: assetType,
        name: displayName,
        requesterId: net.localPeerId,
        requesterName: net.localUserName,
        position: [pos.x, pos.y, pos.z],
        fileSize: config.file?.size,
        url: config.url,
      };
      net.broadcastPendingSpawn(pendingData);
    }
    const localEntry = createLoadingPlaceholder(displayName, net.localUserName, pos);
    sceneEngineRef.current?.worldRoot.add(localEntry.group);
    pendingAssetsRef.current.set(placeholderId, localEntry);

    let asset: LoadedAsset | null = null;
    streamingSuppressedAssetIdsRef.current.add(placeholderId);
    if (config.file && (assetType === 'video' || assetType === 'audio')) {
      net.registerHostedFile(placeholderId, config.file);
      const vss = videoStreamingServiceRef.current;
      if (vss) {
        vss.registerHostFile(config.file, placeholderId, config.file.type);
      }
    }
    try {
      if (config.file) {
        asset = await assetManager.importFile(config.file, pos, config, placeholderId);
      } else if (config.url) {
        asset = await assetManager.importFromUrl(config.url, pos, config, placeholderId);
      }

      if (asset) {
        if (asset.type === 'video') {
          setActiveVideoAssetId(asset.id);
          resetVideoInactivityTimer();
        } else if (asset.type !== 'audio') {
          manipulationManagerRef.current?.selectAsset(asset);
        }
        recordSpawnUndo(asset);

        if (config.file) {
          net.registerHostedFile(asset.id, config.file);
          if (asset.type === 'video' || asset.type === 'audio') {
            const vss = videoStreamingServiceRef.current;
            if (vss) {
              vss.registerHostFile(config.file, asset.id, config.file.type);
            }
          }
        }

        if (net.mode !== 'offline') {
          const isP2PNeeded = !asset.fileData && Boolean(config.file);
          const p2pTransferHint = isP2PNeeded ? { id: asset.id, size: config.file!.size } : undefined;
          const vs = asset.object3d.userData?.videoState as Record<string, unknown> | undefined;
          net.broadcastSpawn({
            id: asset.id,
            name: asset.name,
            type: asset.type as AssetSpawnData['type'],
            position: [asset.object3d.position.x, asset.object3d.position.y, asset.object3d.position.z],
            rotation: [asset.object3d.rotation.x, asset.object3d.rotation.y, asset.object3d.rotation.z],
            scale: [asset.object3d.scale.x, asset.object3d.scale.y, asset.object3d.scale.z],
            url: asset.url,
            fileData: asset.fileData,
            fileDataOversized: isP2PNeeded ? true : undefined,
            p2pTransferHint,
            isCollidable: asset.isCollidable,
            isPersistent: (asset.object3d.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
            videoAspectRatio: config.videoAspectRatio,
            subtitlesData: vs?.subtitlesData as string | undefined,
            subtitlesEnabled: vs?.subtitlesEnabled as boolean | undefined,
            // Compact playback/orientation snapshot so spawn receivers
            // (and their late joiners) match the importer's flip state.
            videoState: vs ? {
              playing: Boolean(vs.playing),
              currentTime: typeof vs.currentTime === 'number' ? vs.currentTime : 0,
              globalVolume: typeof vs.globalVolume === 'number' ? vs.globalVolume : 0.8,
              flipped: vs.flipped !== false,
            } : undefined,
            audioLoop: config.audioLoop,
            audioPlaybackRate: config.audioPlaybackRate,
            importAsRawFile: Boolean(config.importAsRawFile || asset.object3d.userData?.isRaw || asset.type === 'misc'),
          });
        }

        if (config.saveToInventory && inventoryServiceRef.current) {
          await inventoryServiceRef.current.saveItem({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            createdAt: Date.now(),
            fileData: asset.fileData,
            url: asset.url,
            metadata: asset.metadata
          });
        }
        toast.success(`Imported "${displayName}"`);
      } else {
        throw new Error('AssetManager returned null');
      }
    } catch (err) {
      sceneEngineRef.current?.worldRoot.remove(localEntry.group);
      localEntry.dispose();
      pendingAssetsRef.current.delete(placeholderId);
      if (net.mode !== 'offline') {
        net.broadcastPendingCancel(placeholderId);
      }
      console.warn('[Import] Failed:', err);
      // Surface to user AND rethrow so callers (AssetImportDialog) can keep
      // their UI open and let the user adjust settings instead of closing
      // as if everything had succeeded.
      toast.error(`Import failed for "${displayName}": ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };

  // ─── handleSpawnFromInventory ───────────────────────────────────────────

  const handleSpawnFromInventory = async (item: InventoryItem) => {
    const assetManager = assetManagerRef.current;
    if (!assetManager) return;

    if (item.type === 'tool') {
      setActiveTool((item.toolType as ToolType) || 'dev');
      setShowToolsPanel(true);
      setShowInventoryModal(false);
      setShowDashMenu(false);
      return;
    }

    const pos = getSpawnPositionInFrontOfUser(2.0);

    const broadcastInventoryMaterialState = (targetId: string, matState: any) => {
      if (!matState) return;
      const mats = Array.isArray(matState)
        ? matState
        : typeof matState === 'object' && !('materialIndex' in matState) && !('color' in matState) && !('map' in matState) && !('roughness' in matState) && !('metalness' in matState) && !('emissive' in matState)
        ? Object.values(matState)
        : [matState];
      mats.forEach((m: any) => {
        networkServiceRef.current.broadcastMaterialUpdate({ ...m, assetId: targetId });
      });
    };

    if (item.type === 'primitive' && item.primitiveType) {
      const prim = assetManager.spawnPrimitive(item.primitiveType, pos);
      if (prim && item.materialState) {
        AssetManager.applyMaterialUpdate(prim, item.materialState);
        broadcastInventoryMaterialState(prim.id, item.materialState);
      }
      manipulationManagerRef.current?.selectAsset(prim);
      if (prim) recordSpawnUndo(prim);
    } else if (item.fileData) {
      const blob = new Blob([item.fileData], { type: item.metadata?.mimeType || 'application/octet-stream' });
      const file = new File([blob], item.name);
      const asset = await assetManager.importFile(file, pos);
      if (asset) {
        if (item.materialState) {
          AssetManager.applyMaterialUpdate(asset, item.materialState);
          broadcastInventoryMaterialState(asset.id, item.materialState);
        }
        if (asset.type === 'video') {
          setActiveVideoAssetId(asset.id);
          resetVideoInactivityTimer();
        } else if (asset.type !== 'audio') {
          manipulationManagerRef.current?.selectAsset(asset);
        }
        recordSpawnUndo(asset);
      }
    } else if (item.url) {
      try {
        const response = await fetch(item.url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const blob = await response.blob();
        const file = new File([blob], item.name);
        const asset = await assetManager.importFile(file, pos);
        if (asset) {
          if (item.materialState) {
            AssetManager.applyMaterialUpdate(asset, item.materialState);
            broadcastInventoryMaterialState(asset.id, item.materialState);
          }
          if (asset.type === 'video') {
            setActiveVideoAssetId(asset.id);
            resetVideoInactivityTimer();
          } else if (asset.type !== 'audio') {
            manipulationManagerRef.current?.selectAsset(asset);
          }
          recordSpawnUndo(asset);
        }
      } catch (err) {
        console.warn('[Inventory] Failed to load from URL:', item.url, err);
        alert('Failed to load "' + item.name + '" from URL');
      }
    }
    setShowInventoryModal(false);
  };

  // ─── handleEquipVrmFromInventory ────────────────────────────────────────

  const handleEquipVrmFromInventory = async (item: InventoryItem) => {
    if (!item.fileData && !item.url) return;
    const blob = item.fileData ? new Blob([item.fileData]) : await (await fetch(item.url!)).blob();
    const file = new File([blob], item.name);
    await avatarManagerRef.current?.loadLocalVRM(file);
    setShowInventoryModal(false);
  };

  return {
    handleSpawnPrimitive,
    handleImportFile,
    handleImportAssetFromConfig,
    handleSpawnFromInventory,
    handleEquipVrmFromInventory,
  };
}
