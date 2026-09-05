import * as THREE from 'three';
import type React from 'react';
import type {
  NetworkService,
  AssetSpawnData,
  PendingSpawnData,
  ChatMessage,
  MaterialUpdate,
  ConnectionMode,
} from '../services/NetworkService.ts';
import type { SceneEngine } from '../engine/SceneEngine.ts';
import { AssetManager } from '../engine/AssetManager.ts';
import type { LoadedAsset } from '../engine/AssetManager.ts';
import type { ManipulationManager } from '../engine/ManipulationManager.ts';
import type { AvatarManager } from '../engine/AvatarManager.ts';
import type { VideoStreamingService, VideoStreamingHint } from '../services/VideoStreamingService.ts';
import type { VRHUDManager } from '../engine/VRHUDManager.ts';
import type { UserRole } from '../types/permissions.ts';
import { findObjectByUUID } from '../utils/findObjectByUUID.ts';
import {
  DEFAULT_LIGHT_CONFIG,
  removeLightComponent,
  syncThreeLightFromConfig,
} from '../engine/ResoniteLightSync.ts';
import { createLoadingPlaceholder } from './assetImportHandlers.ts';

export interface RegisterNetworkEventHandlersOptions {
  net: NetworkService;
  sceneEngine: SceneEngine;
  assetManager: AssetManager;
  manipulationManager: ManipulationManager;
  avatarManager: AvatarManager;
  avatarManagerRef: React.MutableRefObject<AvatarManager | null>;
  videoStreamingServiceRef: React.MutableRefObject<VideoStreamingService>;
  vrHudRef: React.MutableRefObject<VRHUDManager | null>;
  pendingAssetsRef: React.MutableRefObject<
    Map<
      string,
      {
        group: THREE.Group;
        dispose: () => void;
        setProgress?: (pct: number | null) => void;
        oversized?: boolean;
      }
    >
  >;
  streamingSuppressedAssetIdsRef: React.MutableRefObject<Set<string>>;
  pendingVideoStateRef: React.MutableRefObject<
    Map<string, { flipped?: boolean; subtitlesData?: string; subtitlesEnabled?: boolean }>
  >;
  selectedAssetRef: React.MutableRefObject<LoadedAsset | null>;
  showChatPanelRef: React.MutableRefObject<boolean>;

  setPeerCount: (count: number) => void;
  setIsHost: (isHost: boolean) => void;
  setSelectedAsset: (asset: LoadedAsset | null) => void;
  setUnreadChatCount: React.Dispatch<React.SetStateAction<number>>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setLocalRole: (role: UserRole) => void;
  setMode: (mode: ConnectionMode) => void;
  setRoomId: (id: string | null) => void;
}

/**
 * Registers all NetworkService incoming packet/event listeners and remote
 * state synchronization callbacks.
 *
 * Returns an array of teardown disposer functions for clean unmounting.
 */
export function registerNetworkEventHandlers(
  options: RegisterNetworkEventHandlersOptions
): (() => void)[] {
  const {
    net,
    sceneEngine,
    assetManager,
    manipulationManager,
    avatarManager,
    avatarManagerRef,
    videoStreamingServiceRef,
    vrHudRef,
    pendingAssetsRef,
    streamingSuppressedAssetIdsRef,
    pendingVideoStateRef,
    selectedAssetRef,
    showChatPanelRef,
    setPeerCount,
    setIsHost,
    setSelectedAsset,
    setUnreadChatCount,
    setChatMessages,
    setLocalRole,
    setMode,
    setRoomId,
  } = options;

  const disposers: (() => void)[] = [];

  // Network listeners
  disposers.push(
    net.onPeerJoin((peerId) => {
      setPeerCount(net.peers.size);
      if (avatarManagerRef.current?.localVrmBuffer) {
        net.sendAvatarVRMToPeer(peerId, avatarManagerRef.current.localVrmBuffer);
      }
    })
  );

  disposers.push(
    net.onPeerLeave((peerId) => {
      setPeerCount(net.peers.size);
      avatarManager.removePeerAvatar(peerId);
    })
  );

  disposers.push(
    net.onHostChange((_newHostId, selfHost) => {
      setIsHost(selfHost);
    })
  );

  disposers.push(
    net.onAvatarVRM((peerId, fileData) => {
      const blobUrl = URL.createObjectURL(new Blob([fileData], { type: 'model/gltf-binary' }));
      avatarManager.updatePeerVrmUrl(peerId, blobUrl);
    })
  );

  disposers.push(
    net.onTransform((update) => {
      manipulationManager.applyRemoteTransform(update, assetManager.assets);
    })
  );

  disposers.push(
    net.onMaterialUpdate((update) => {
      const asset = assetManager.assets.get(update.assetId);
      if (asset) {
        AssetManager.applyMaterialUpdate(asset, update);
        const sel = selectedAssetRef.current;
        if (sel && sel.id === update.assetId) {
          setSelectedAsset({ ...asset });
        }
      }
    })
  );

  // Apply generic inspector updates from peers (active, persistent, name,
  // light config, component attach/detach, mesh enabled, hierarchy).
  disposers.push(
    net.onInspectorUpdate((update) => {
      if (update.senderPeerId === net.localPeerId) return;
      const asset = assetManager.assets.get(update.assetId);
      if (!asset) return;
      const targetNode = update.nodeUuid
        ? findObjectByUUID(asset.object3d, update.nodeUuid)
        : asset.object3d;
      if (!targetNode) return;

      if (update.name !== undefined) {
        asset.name = update.name;
        targetNode.name = update.name;
      }
      if (update.active !== undefined) {
        targetNode.visible = update.active;
      }
      if (update.persistent !== undefined) {
        targetNode.userData.isPersistent = update.persistent;
      }
      if (update.meshEnabled !== undefined) {
        targetNode.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.visible = update.meshEnabled!;
          }
        });
      }
      if (update.resoniteLight !== undefined) {
        if (update.resoniteLight === null) {
          removeLightComponent(targetNode);
        } else {
          syncThreeLightFromConfig(targetNode, { ...DEFAULT_LIGHT_CONFIG, ...update.resoniteLight });
        }
      }
      if (update.rotatorSpeed !== undefined) {
        targetNode.userData.rotatorSpeed = update.rotatorSpeed;
      }
      if (update.bobbingSpeed !== undefined) {
        targetNode.userData.bobbingSpeed = update.bobbingSpeed;
      }
      if (update.grabbable !== undefined) {
        if (update.grabbable === null) {
          delete (targetNode.userData as Record<string, unknown>).grabbable;
        } else {
          targetNode.userData.grabbable = update.grabbable;
        }
      }
      if (update.collider !== undefined) {
        if (update.collider === null) {
          delete (targetNode.userData as Record<string, unknown>).collider;
        } else {
          targetNode.userData.collider = update.collider;
        }
        // Rebuild collision registry after collider changes
        sceneEngine?.rebuildCollisionRegistry();
      }
      if (update.hierarchyAction) {
        const ha = update.hierarchyAction;
        if (ha.type === 'insertParent') {
          const newParent = new THREE.Group();
          newParent.name = `Parent_of_${targetNode.name || 'Slot'}`;
          if (ha.newNodeUuid) newParent.uuid = ha.newNodeUuid;
          newParent.attach(targetNode);
        } else if (ha.type === 'addChild') {
          const newChild = new THREE.Group();
          newChild.name = `Child_of_${targetNode.name || 'Slot'}`;
          if (ha.newNodeUuid) newChild.uuid = ha.newNodeUuid;
          newChild.position.set(0, 0.5, 0);
          targetNode.add(newChild);
        } else if (ha.type === 'parentToWorld') {
          if (!sceneEngine?.worldRoot) return;
          sceneEngine.worldRoot.attach(targetNode);
        }
      }

      const sel = selectedAssetRef.current;
      if (sel && sel.id === update.assetId) {
        setSelectedAsset({ ...asset });
      }
    })
  );

  disposers.push(
    net.onAvatar((update) => {
      avatarManager.updatePeerAvatar(update);
    })
  );

  // Apply remote video-state envelopes. AssetManager.applyVideoState
  // is a no-op when every applicable field already matches local
  // state, so we apply unconditionally rather than threading peerId
  // plumbing through. After apply, bump selectedAsset if it matches
  // and force-redraw the VR HUD panel so visible values sync without
  // waiting for the next setDataContext round-trip.
  disposers.push(
    net.onVideoState((data) => {
      const am = assetManager;
      if (!am) return;
      // Stash orientation / subtitle state for assets that haven't landed
      // yet (mid P2P transfer). applyVideoState no-ops on missing assets,
      // so without this a flip during the transfer window is lost and the
      // video arrives at the wrong orientation. Applied by the import
      // completion paths (finishIfDone / URL branch) once the asset exists.
      if (!am.assets.get(data.assetId)) {
        pendingVideoStateRef.current.set(data.assetId, {
          flipped: data.flipped,
          subtitlesData: data.subtitlesData,
          subtitlesEnabled: data.subtitlesEnabled,
        });
      }
      am.applyVideoState(data.assetId, {
        playing: data.playing,
        currentTime: data.currentTime,
        globalVolume: data.globalVolume,
        subtitlesData: data.subtitlesData,
        subtitlesEnabled: data.subtitlesEnabled,
        flipped: data.flipped,
      });
      const sel = selectedAssetRef.current;
      if (sel && sel.id === data.assetId) {
        setSelectedAsset({ ...sel });
      }
      vrHudRef.current?.redrawPanel();
    })
  );

  // When a video's HTMLVideoElement fires 'ended', the play/pause
  // button icon goes stale because the React tree isn't aware of
  // the state change. This callback bumps selectedAsset so the
  // play/pause icon refreshes to show 'Play' after the video ends.
  disposers.push(
    net.onAudioState((data) => {
      const am = assetManager;
      if (!am) return;
      am.applyAudioState(data.assetId, {
        playing: data.playing,
        currentTime: data.currentTime,
        globalVolume: data.globalVolume,
        muted: data.muted,
        loop: data.loop,
        playbackRate: data.playbackRate,
      });
      const sel = selectedAssetRef.current;
      if (sel && sel.id === data.assetId) {
        setSelectedAsset({ ...sel });
      }
      vrHudRef.current?.redrawPanel();
    })
  );

  disposers.push(
    assetManager.registerOnVideoPlaybackChanged((id) => {
      const sel = selectedAssetRef.current;
      if (sel && sel.id === id) {
        setSelectedAsset({ ...sel });
      }
    })
  );

  disposers.push(
    assetManager.registerOnAudioPlaybackChanged((id) => {
      const sel = selectedAssetRef.current;
      if (sel && sel.id === id) {
        setSelectedAsset({ ...sel });
      }
    })
  );

  // Phase 3B: pull an oversized asset from the sender peer via the
  // raw-binary asset channel. Replaces the old "Too Large" red
  // placeholder with a live progress indicator and imports the file
  // once all chunks arrive.
  const startP2PAssetTransfer = (data: AssetSpawnData, pos: THREE.Vector3) => {
    const hint = data.p2pTransferHint;
    const senderPeerId = data.senderPeerId || net.hostId;
    const size = hint && hint.size > 0 ? hint.size : data.fileSize || 10000000;
    if (!senderPeerId) return false;

    // Dispose any existing placeholder for this id.
    const prior = pendingAssetsRef.current.get(data.id);
    if (prior) {
      sceneEngine.worldRoot.remove(prior.group);
      prior.dispose();
      pendingAssetsRef.current.delete(data.id);
    }

    const { group, dispose, setProgress } = createLoadingPlaceholder(
      data.name || 'Asset',
      'Network',
      pos,
      false // in-flight download, not a permanent failure
    );
    sceneEngine.worldRoot.add(group);
    pendingAssetsRef.current.set(data.id, { group, dispose, setProgress, oversized: false });

    const assetId = data.id;
    const CHUNK_SIZE = 256 * 1024;
    const chunks: ArrayBuffer[] = [];
    chunks.length = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    let receivedBytes = 0;
    let completed = false;

    const finishIfDone = () => {
      if (completed) return;
      // Verify every slot is filled.
      for (let i = 0; i < chunks.length; i++) {
        if (!chunks[i]) return;
      }
      completed = true;
      netUnsub();
      // Concatenate chunks in order.
      const ext = (data.name || '').split('.').pop()?.toLowerCase() || '';
      let mime = 'application/octet-stream';
      if (data.type === 'video' || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) {
        if (ext === 'webm') mime = 'video/webm';
        else if (ext === 'mov') mime = 'video/quicktime';
        else if (ext === 'ogv') mime = 'video/ogg';
        else mime = 'video/mp4';
      } else if (data.type === 'audio' || ['mp3', 'ogg', 'wav', 'aac', 'm4a', 'flac'].includes(ext)) {
        if (ext === 'wav') mime = 'audio/wav';
        else if (ext === 'ogg') mime = 'audio/ogg';
        else if (ext === 'aac') mime = 'audio/aac';
        else if (ext === 'flac') mime = 'audio/flac';
        else mime = 'audio/mpeg';
      } else if (data.type === 'image' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) {
        if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
        else if (ext === 'svg') mime = 'image/svg+xml';
        else mime = `image/${ext || 'png'}`;
      }
      const fullBlob = new Blob(chunks as ArrayBuffer[], { type: mime });
      const file = new File([fullBlob], data.name || 'Asset', { type: mime });
      net.registerHostedFile(data.id, file);
      // Pass subtitleText through to importFile so loadVideo takes the
      // subtitle CanvasTexture path from the first frame — identical to
      // how the original importing client rendered it. Previously the
      // P2P re-import dropped subtitle data entirely, so late joiners
      // never saw captions on videos imported with them.
      assetManager
        .importFile(
          file,
          pos,
          {
            videoAspectRatio: data.videoAspectRatio || 'auto',
            subtitleText: data.subtitlesData,
            imageDisplayMode: data.imageDisplayMode || '2d-plane',
            importAsRawFile: Boolean(data.importAsRawFile || data.type === 'misc'),
          },
          data.id
        )
        .then((asset) => {
          if (asset) {
            asset.object3d.rotation.set(...data.rotation);
            asset.object3d.scale.set(...data.scale);
            if (data.isPersistent !== undefined) {
              asset.object3d.userData.isPersistent = data.isPersistent;
            }
            if (data.materialState) {
              // @ts-ignore
              AssetManager.applyMaterialUpdate(asset, data.materialState);
            }
            // Mirror the sender's CC toggle. When a video was imported
            // WITHOUT subtitles and captions were attached afterwards,
            // this is the only path that restores them for late joiners.
            if (asset.type === 'video' && data.subtitlesEnabled !== undefined) {
              assetManager.applyVideoState(data.id, { subtitlesEnabled: data.subtitlesEnabled });
            }
            if (asset.videoElement) {
              const vs = data.videoState;
              if (vs) {
                const incomingVs = vs as any;
                asset.object3d.userData.videoState = {
                  ...asset.object3d.userData.videoState,
                  ...incomingVs,
                  duration: (incomingVs.duration && incomingVs.duration > 0)
                    ? incomingVs.duration
                    : (asset.object3d.userData.videoState?.duration || 0),
                };
                // Restore the sender's manual Y-orientation so late
                // joiners don't see a mirrored/upside-down picture.
                if (typeof vs.flipped === 'boolean') {
                  assetManager.applyVideoState(data.id, { flipped: vs.flipped });
                }
                if (typeof vs.currentTime === 'number') {
                  try {
                    asset.videoElement.currentTime = vs.currentTime > 0 ? vs.currentTime : 0.001;
                  } catch {
                    /* ignore */
                  }
                }
                if (vs.playing) {
                  asset.videoElement.play().catch(() => {});
                }
              }
            }
            // Apply any orientation / subtitle state that arrived while the
            // video was still transferring (vidstate is a no-op until the
            // asset exists — see onVideoState's stash). Without this, a
            // flip during the P2P window leaves the video upside down for
            // this peer even after the transfer completes.
            const pendingVs = pendingVideoStateRef.current.get(data.id);
            if (pendingVs) {
              pendingVideoStateRef.current.delete(data.id);
              assetManager.applyVideoState(data.id, {
                flipped: pendingVs.flipped,
                subtitlesData: pendingVs.subtitlesData,
                subtitlesEnabled: pendingVs.subtitlesEnabled,
              });
            }
            // Apply audio-specific state for late joiners
            if (asset.type === 'audio' && asset.audioElement) {
              if (data.audioLoop !== undefined) {
                assetManager.applyAudioState(data.id, { loop: data.audioLoop });
              }
              if (data.audioPlaybackRate !== undefined) {
                assetManager.applyAudioState(data.id, { playbackRate: data.audioPlaybackRate });
              }
            }
          }
        });
    };

    // Stall watchdog: after host migration or a sender rejoin the
    // designated senderPeerId may no longer host the file (its
    // snapshot entry can point at a departed peer). If no bytes land
    // for a while, fall back to broadcasting chunk requests to every
    // connected peer — whoever still hosts the asset replies, and
    // duplicate chunks are already deduped by slot above.
    let lastProgressAt = Date.now();
    let fallbackActive = false;

    const onData = (chunkData: { id: string; start: number; end: number; data: ArrayBuffer }) => {
      if (chunkData.id !== assetId) return;
      const index = Math.floor(chunkData.start / CHUNK_SIZE);
      if (chunks[index]) return; // duplicate
      lastProgressAt = Date.now();
      chunks[index] = chunkData.data;
      receivedBytes += chunkData.data.byteLength;
      setProgress(Math.min(100, (receivedBytes / size) * 100));

      // Request the next chunk if there are still bytes to fetch.
      if (chunkData.end < size) {
        const nextEnd = Math.min(chunkData.end + CHUNK_SIZE, size);
        if (fallbackActive) {
          net.requestAssetChunkFromAny(assetId, chunkData.end, nextEnd);
        } else {
          net.requestAssetChunk(assetId, senderPeerId, chunkData.end, nextEnd);
        }
      }
      finishIfDone();
    };
    const netUnsub = net.onP2PChunkData(onData);

    // Kick off the first chunk.
    const firstEnd = Math.min(CHUNK_SIZE, size);
    net.requestAssetChunk(assetId, senderPeerId, 0, firstEnd);

    const stallWatchdog = setInterval(() => {
      if (completed) {
        clearInterval(stallWatchdog);
        return;
      }
      if (Date.now() - lastProgressAt < 5000) return;
      if (!fallbackActive) {
        fallbackActive = true;
        console.warn(
          '[VideoStreaming] chunk source',
          senderPeerId,
          'stalled for',
          assetId,
          '— broadcasting requests to all peers'
        );
      }
      // Chunks arrive strictly sequentially, so re-chase the first
      // missing slot from everyone.
      for (let i = 0; i < chunks.length; i++) {
        if (!chunks[i]) {
          const missStart = i * CHUNK_SIZE;
          net.requestAssetChunkFromAny(assetId, missStart, Math.min(missStart + CHUNK_SIZE, size));
          break;
        }
      }
    }, 4000);
    return true;
  };

  disposers.push(
    net.onSpawn((data) => {
      // If asset is already loaded, skip
      if (assetManager.assets.has(data.id)) return;

      const pos = new THREE.Vector3(...data.position);
      // Oversized file broadcast: buildEnvelope's MAX_INLINED_FILE_BYTES
      // cap stripped the binary payload so the Quest doesn't OOM on a
      // 100MB+ base64 round-trip. Render a red "Too Large" placeholder
      // instead of trying to import - no fileData will ever land, so
      // this entry stays in pendingAssetsRef indefinitely. The
      // animation loop's `oversized` skip below keeps it static (no
      // pulse) so it reads as a permanent failure indicator rather
      // than a still-loading asset.
      if (
        data.type === 'video' ||
        data.type === 'audio' ||
        data.fileDataOversized ||
        data.p2pTransferHint
      ) {
        const senderPeerId = data.senderPeerId || net.hostId;
        const hintData = data.p2pTransferHint || { id: data.id, size: data.fileSize || 10000000 };
        const dataWithHint = { ...data, senderPeerId, p2pTransferHint: hintData };
        startP2PAssetTransfer(dataWithHint, pos);
        return;
      }

      if (data.type === 'primitive' && data.primitiveType) {
        streamingSuppressedAssetIdsRef.current.add(data.id);
        const prim = assetManager.spawnPrimitive(data.primitiveType, pos, data.id);
        prim.object3d.rotation.set(...data.rotation);
        prim.object3d.scale.set(...data.scale);
        // Restore the sender's persistent flag onto userData so the
        // inspector tree's orange-dot indicator and the checkbox state
        // both reflect what the host had. Skipped when undefined for
        // backward compat with older senders.
        if (data.isPersistent !== undefined) {
          prim.object3d.userData.isPersistent = data.isPersistent;
        }
        if (data.materialState) {
          AssetManager.applyMaterialUpdate(prim, data.materialState);
        }
        if (data.grabbable) {
          prim.object3d.userData.grabbable = data.grabbable;
        }
        if (data.collider) {
          prim.object3d.userData.collider = data.collider;
          sceneEngine.rebuildCollisionRegistry();
        }
      } else if (data.fileData && data.name) {
        const blob = new Blob([data.fileData]);
        // Pass `data.id` as the AssetManager's customId so the local
        // placeholder (already drawn from this asset's 'pending'
        // broadcast via onPendingSpawn above) and the actual asset
        // share the SAME id. registerOnAssetAdded's id-match cleanup
        // removes the placeholder the moment this asset resolves - clean
        // handoff, no separate tempId → assetId mapping required.
        const file = new File([blob], data.name);
        assetManager
          .importFile(
            file,
            pos,
            {
              videoAspectRatio: data.videoAspectRatio || 'auto',
              imageDisplayMode: data.imageDisplayMode || '2d-plane',
              importAsRawFile: Boolean(data.importAsRawFile || data.type === 'misc'),
            },
            data.id
          )
          .then((asset) => {
            if (asset) {
              asset.object3d.rotation.set(...data.rotation);
              asset.object3d.scale.set(...data.scale);
              // Mirror the persistent flag onto the just-imported mesh's
              // userData so the inspector tree + checkbox reflect the
              // host's intent from the first frame (same write block as
              // the primitive branch above; only the import vs spawn
              // timing differs).
              if (data.isPersistent !== undefined) {
                asset.object3d.userData.isPersistent = data.isPersistent;
              }
              if (data.materialState) {
                AssetManager.applyMaterialUpdate(asset, data.materialState);
              }
              if (data.grabbable) {
                asset.object3d.userData.grabbable = data.grabbable;
              }
              if (data.collider) {
                asset.object3d.userData.collider = data.collider;
                sceneEngine.rebuildCollisionRegistry();
              }
            }
          });
      } else if (data.url) {
        assetManager.importFromUrl(data.url, pos, undefined, data.id).then((asset) => {
          if (asset) {
            asset.object3d.rotation.set(...data.rotation);
            asset.object3d.scale.set(...data.scale);
            if (data.isPersistent !== undefined) {
              asset.object3d.userData.isPersistent = data.isPersistent;
            }
            if (data.materialState) {
              AssetManager.applyMaterialUpdate(asset, data.materialState);
            }
            if (data.grabbable) {
              asset.object3d.userData.grabbable = data.grabbable;
            }
            if (data.collider) {
              asset.object3d.userData.collider = data.collider;
              sceneEngine.rebuildCollisionRegistry();
            }
            // Apply stashed orientation / subtitle state (flips broadcast
            // while this URL video was still downloading were no-ops — see
            // onVideoState's stash).
            const pendingVs = pendingVideoStateRef.current.get(data.id);
            if (pendingVs) {
              pendingVideoStateRef.current.delete(data.id);
              assetManager.applyVideoState(data.id, {
                flipped: pendingVs.flipped,
                subtitlesData: pendingVs.subtitlesData,
                subtitlesEnabled: pendingVs.subtitlesEnabled,
              });
            }
          }
        });
      }
    })
  );

  disposers.push(
    net.onRemove((id) => {
      assetManager.removeAsset(id);
      if (manipulationManager.selectedAsset?.id === id) {
        manipulationManager.selectAsset(null);
      }
      // If a placeholder was registered for this id (e.g. an in-flight
      // import was cancelled before completion AND its 'pendingcancel'
      // didn't arrive because the host dropped), dispose it cleanly.
      const pending = pendingAssetsRef.current.get(id);
      if (pending) {
        sceneEngine.worldRoot.remove(pending.group);
        pending.dispose();
        pendingAssetsRef.current.delete(id);
      }
    })
  );

  // Loading-indicator placeholder subscriptions. A host announces
  // an in-flight import before awaiting the async load by
  // broadcasting 'pending'; we render a pulsing 3D mesh at the
  // import's future position so users have visual feedback while
  // waiting for the asset to sync across peers. The matching
  // 'spawn' (with the same id) triggers cleanup via registerOnAssetAdded's
  // id-match; a failed import's 'pendingcancel' triggers
  // cleanup here on the cancel side.
  disposers.push(
    net.onPendingSpawn((data: PendingSpawnData) => {
      if (pendingAssetsRef.current.has(data.id)) return;
      const pos = new THREE.Vector3(...data.position);
      const { group, dispose } = createLoadingPlaceholder(data.name, data.requesterName, pos);
      sceneEngine.worldRoot.add(group);
      pendingAssetsRef.current.set(data.id, { group, dispose });
    })
  );

  disposers.push(
    net.onPendingCancel((id: string) => {
      const entry = pendingAssetsRef.current.get(id);
      if (!entry) return;
      sceneEngine.worldRoot.remove(entry.group);
      entry.dispose();
      pendingAssetsRef.current.delete(id);
    })
  );

  disposers.push(
    net.onChat((msg) => {
      // Desktop unread badge: only bump while the user is not looking
      // at the desktop ChatPanel. Read the ref for the LIVE value
      // instead of the stale closure-captured state.
      if (!showChatPanelRef.current) {
        setUnreadChatCount((prev) => prev + 1);
      }
      // Push to VRHUDManager so the VR Chat Panel (when open) reflects
      // the new message immediately. appendIncomingChat is idempotent
      // on duplicate ids and cheap for the closed-panel case (no redraw).
      vrHudRef.current?.appendIncomingChat(msg);
      // Keep a React-state copy so setDataContext can push it down to
      // any panel that wants it. Capped to last 30 to mirror the
      // manager's rolling buffer; dedupe by id.
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > 30 ? next.slice(next.length - 30) : next;
      });
    })
  );

  disposers.push(
    net.onStream((stream, peerId) => {
      avatarManager.attachPeerAudio(peerId, stream);
    })
  );

  disposers.push(
    net.onVideoLiveStream((assetId, stream) => {
      assetManager.attachLiveStreamToVideo(assetId, stream);
    })
  );

  disposers.push(
    net.onRoleUpdate((data) => {
      if (data.targetPeerId === net.localPeerId) {
        setLocalRole(data.newRole);
      }
    })
  );

  disposers.push(
    net.onModerationAction((data) => {
      if (data.targetPeerId === net.localPeerId) {
        if (data.action === 'kick') {
          alert(`You have been temporarily kicked from the room: ${data.reason || 'No reason provided.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'ban') {
          alert(`You have been permanently banned from this session: ${data.reason || 'Banned by Admin.'}`);
          net.disconnect();
          setMode('offline');
          setRoomId(null);
        } else if (data.action === 'respawn') {
          sceneEngine.respawn();
        }
      }
    })
  );

  disposers.push(
    net.onSyncReq((fromPeerId) => {
      if (assetManager.assets.size > 0 || net.isHost) {
        const assetsList: AssetSpawnData[] = [];
        assetManager.assets.forEach((a) => {
          const primitiveType = (a.object3d.userData as Record<string, unknown>)?.primitiveType as
            | 'cube'
            | 'sphere'
            | 'cylinder'
            | 'cone'
            | 'torus'
            | 'plane'
            | undefined;
          let hint = (a.object3d.userData as Record<string, unknown>)?.streamingHint as
            | VideoStreamingHint
            | undefined;
          // Compact playback + subtitle snapshot for videos. Without this
          // the scene snapshot strips subtitlesData / subtitlesEnabled /
          // playback position, so late joiners get the video bytes but
          // never the captions or the host's playhead.
          const vsSnap = (a.object3d.userData as { videoState?: Record<string, unknown> }).videoState;

          // If this is a video asset and the host possesses the file, ensure the host
          // has registered a streaming session in VideoStreamingService so beginStreamingToPeer
          // pumps bytes to the rejoining client without failing.
          if (a.type === 'video') {
            const hosted = net.getHostedFile(a.id);
            if (hosted) {
              const fileObj =
                hosted instanceof File
                  ? hosted
                  : new File([hosted instanceof Blob ? hosted : new Blob([hosted])], a.name);
              hint = videoStreamingServiceRef.current.registerHostFile(
                fileObj,
                a.id,
                fileObj.type || 'video/mp4'
              );
              (a.object3d.userData as Record<string, unknown>).streamingHint = hint;
            }
          }

          assetsList.push({
            id: a.id,
            name: a.name,
            type: a.type,
            position: [a.object3d.position.x, a.object3d.position.y, a.object3d.position.z],
            rotation: [a.object3d.rotation.x, a.object3d.rotation.y, a.object3d.rotation.z],
            scale: [a.object3d.scale.x, a.object3d.scale.y, a.object3d.scale.z],
            url: a.url,
            primitiveType,
            fileData: a.fileData,
            isCollidable: a.isCollidable,
            isPersistent: (a.object3d.userData as Record<string, unknown>)?.isPersistent as
              | boolean
              | undefined,
            materialState: (a.object3d.userData as Record<string, unknown>)?.materialState as
              | MaterialUpdate
              | undefined,
            videoAspectRatio: (a.object3d.userData as Record<string, unknown>)?.videoAspectRatio as
              | '16:9'
              | '9:16'
              | '1:1'
              | 'auto'
              | undefined,
            streamingHint: hint,
            grabbable: (a.object3d.userData as Record<string, unknown>)?.grabbable as
              | Record<string, unknown>
              | undefined,
            collider: (a.object3d.userData as Record<string, unknown>)?.collider as
              | Record<string, unknown>
              | undefined,
            subtitlesData: vsSnap?.subtitlesData as string | undefined,
            subtitlesEnabled: vsSnap?.subtitlesEnabled as boolean | undefined,
            videoState: vsSnap
              ? {
                  playing: Boolean(vsSnap.playing),
                  currentTime: typeof vsSnap.currentTime === 'number' ? vsSnap.currentTime : 0,
                  globalVolume: typeof vsSnap.globalVolume === 'number' ? vsSnap.globalVolume : 0.8,
                  flipped: vsSnap.flipped !== false,
                }
              : undefined,
            // Audio-specific state for late joiners
            audioLoop: (a.object3d.userData as { audioState?: { loop?: boolean } }).audioState?.loop,
            audioPlaybackRate: (a.object3d.userData as { audioState?: { playbackRate?: number } })
              .audioState?.playbackRate,
          });
          if (hint && net.isHost) {
            const syncMode = (a.object3d.userData as { videoState?: { syncMode?: string } })
              .videoState?.syncMode;
            if (syncMode === 'watch-party' && a.videoElement) {
              videoStreamingServiceRef.current.startLiveStreamToPeer(a.id, a.videoElement, fromPeerId);
            } else {
              videoStreamingServiceRef.current
                .beginStreamingToPeer(hint, fromPeerId)
                .catch((err) => {
                  console.warn('[VideoStreaming] late-join pump failed for', fromPeerId, err);
                });
            }
          }
        });
        net.sendSceneSnapshot(fromPeerId, assetsList);
      }
    })
  );

  disposers.push(
    net.onSyncResp((snapshot) => {
      snapshot.assets.forEach((data) => {
        if (assetManager.isImporting(data.id)) return; // skip to next asset
        if (!assetManager.assets.has(data.id)) {
          const pos = new THREE.Vector3(...data.position);

          // For video/audio assets or oversized assets, pull via reliable P2P transfer channel
          if (
            data.type === 'video' ||
            data.type === 'audio' ||
            data.fileDataOversized ||
            data.p2pTransferHint
          ) {
            const senderPeerId = data.senderPeerId || net.hostId;
            const hintData = data.p2pTransferHint || { id: data.id, size: data.fileSize || 10000000 };
            const dataWithHint = { ...data, senderPeerId, p2pTransferHint: hintData };
            startP2PAssetTransfer(dataWithHint, pos);
            return;
          }
          if (data.type === 'primitive' && data.primitiveType) {
            streamingSuppressedAssetIdsRef.current.add(data.id);
            const prim = assetManager.spawnPrimitive(data.primitiveType, pos, data.id);
            prim.object3d.rotation.set(...data.rotation);
            prim.object3d.scale.set(...data.scale);
            // Mirror the late-join snapshot's userData.isPersistent so
            // the guest's inspector reflects the host's persist bit
            // from the first render after sync.
            if (data.isPersistent !== undefined) {
              prim.object3d.userData.isPersistent = data.isPersistent;
            }
            if (data.materialState) {
              AssetManager.applyMaterialUpdate(prim, data.materialState);
            }
            if (data.grabbable) {
              prim.object3d.userData.grabbable = data.grabbable;
            }
          } else if (data.fileData && data.name) {
            const ext = (data.name || '').split('.').pop()?.toLowerCase() || '';
            const mime = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
              ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
              : 'application/octet-stream';
            const blob = new Blob([data.fileData], { type: mime });
            const file = new File([blob], data.name, { type: mime });
            assetManager
              .importFile(file, pos, { videoAspectRatio: data.videoAspectRatio || 'auto' }, data.id)
              .then((asset) => {
                if (asset) {
                  asset.object3d.rotation.set(...data.rotation);
                  asset.object3d.scale.set(...data.scale);
                  if (data.isPersistent !== undefined) {
                    asset.object3d.userData.isPersistent = data.isPersistent;
                  }
                  if (data.materialState) {
                    AssetManager.applyMaterialUpdate(asset, data.materialState);
                  }
                  if (data.grabbable) {
                    asset.object3d.userData.grabbable = data.grabbable;
                  }
                  // Apply audio-specific state for late joiners
                  if (asset.type === 'audio') {
                    if (data.audioLoop !== undefined) {
                      assetManager.applyAudioState(data.id, { loop: data.audioLoop });
                    }
                    if (data.audioPlaybackRate !== undefined) {
                      assetManager.applyAudioState(data.id, { playbackRate: data.audioPlaybackRate });
                    }
                  }
                }
              });
          } else if (data.url) {
            assetManager.importFromUrl(data.url, pos, undefined, data.id).then((asset) => {
              if (asset) {
                asset.object3d.rotation.set(...data.rotation);
                asset.object3d.scale.set(...data.scale);
                if (data.isPersistent !== undefined) {
                  asset.object3d.userData.isPersistent = data.isPersistent;
                }
                if (data.materialState) {
                  AssetManager.applyMaterialUpdate(asset, data.materialState);
                }
                if (data.grabbable) {
                  asset.object3d.userData.grabbable = data.grabbable;
                }
                // Apply audio-specific state for late joiners
                if (asset.type === 'audio') {
                  if (data.audioLoop !== undefined) {
                    assetManager.applyAudioState(data.id, { loop: data.audioLoop });
                  }
                  if (data.audioPlaybackRate !== undefined) {
                    assetManager.applyAudioState(data.id, { playbackRate: data.audioPlaybackRate });
                  }
                }
              }
            });
          }
        }
      });
    })
  );

  return disposers;
}
