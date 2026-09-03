import * as THREE from 'three';
import { GifReader } from 'omggif';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ImportConfig } from '../components/AssetImportDialog.tsx';
export type { ImportConfig };
import type { MaterialUpdate } from '../services/NetworkService.ts';
import { RawFilesStore } from '../services/RawFilesStore.ts';
import { VideoStreamingService } from '../services/VideoStreamingService.ts';
import {
  classifyDevice,
  getMaxCanvasResolution,
  shouldAlwaysDownscaleVideo,
} from '../utils/deviceTier.ts';
import { SplatMesh, SplatFileType, PagedSplats } from '@sparkjsdev/spark';

import { parseSubtitles, type SubtitleCue } from '../utils/subtitleParser.ts';
import { loadSubtitleSettings, type SubtitleSettings } from '../utils/subtitleSettings.ts';

export type AssetType = '3d-model' | 'image' | 'video' | 'audio' | 'vrm' | 'misc' | 'primitive' | 'splat';

/** Supported audio file extensions. */
export const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav'];

/**
 * Per-video playback state. Stored on `asset.object3d.userData.videoState`
 * so it's intrinsically tied to the Three.js node (mirroring how
 * `isPersistent` is stored on the same userData object). Consumers (the
 * React inspector, the VR HUD inspector, and any other UI) read this
 * synchronously without subscribing to a separate event stream.
 *
 * Split into broadcast-relevant and local-only fields:
 *   - `playing`, `currentTime`, `globalVolume` are shared with peers
 *     (act on the room's "shared reality": everyone should see the same
 *     content at the same time and same loudness).
 *   - `localVolume`, `volumeMode`, `muted` are local-only. Each user
 *     picks whether they're listening at the room's global volume or at
 *     their own overridden level; the mute flag is a personal safety
 *     override that doesn't clobber either remembered volume.
 *
 * The applied `video.volume` is always derived:
 *   `video.volume = (muted ? 0 : (volumeMode === 'global' ? globalVolume : localVolume))`
 * So switching the toggle live updates the playback volume and the play /
 * pause decisions remain global.
 */
export interface VideoPlaybackState {
  /** Is the video currently playing. Updated via HTMLVideoElement events. */
  playing: boolean;
  /** Current playback position in seconds. Mirrored from `video.currentTime`. */
  currentTime: number;
  /** Total duration in seconds. Mirrored from `video.duration` after metadata loads. */
  duration: number;
  /** Volume level applied to all users when in 'global' mode (0..1). */
  globalVolume: number;
  /** Per-user volume override (0..1). Never broadcast. */
  localVolume: number;
  /** Which volume slider is "active" — controls whether slider changes broadcast. */
  volumeMode: 'global' | 'local';
  /** Local-only mute toggle. Stored separately from volume so it survives scroll/swap. */
  muted: boolean;
  /** Video synchronization mode */
  syncMode?: 'persistent' | 'watch-party';
  subtitlesEnabled?: boolean;
  subtitlesData?: string;
  /** Screen-mesh Y flip. true = scale.y -1 (the default that corrects
   *  the browser's compositing flip); synced so peers and late joiners
   *  match a manually-toggled orientation. */
  flipped?: boolean;
}

/**
 * Per-audio playback state. Stored on `asset.object3d.userData.audioState`
 * so it's intrinsically tied to the Three.js node (mirroring how
 * `VideoPlaybackState` lives on `userData.videoState`).
 */
export interface AudioPlaybackState {
  /** Is the audio currently playing. */
  playing: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds. Mirrored from `audio.duration` after metadata loads. */
  duration: number;
  /** Volume level applied to all users when in 'global' mode (0..1). */
  globalVolume: number;
  /** Per-user volume override (0..1). Never broadcast. */
  localVolume: number;
  /** Which volume slider is "active". */
  volumeMode: 'global' | 'local';
  /** Local-only mute toggle. */
  muted: boolean;
  /** Whether to loop playback. */
  loop: boolean;
  /** Playback speed (0.5 – 2.0). */
  playbackRate: number;
}

import type { ContextMenuItemDef } from './ContextMenuManager.ts';

export interface LoadedAsset {
  id: string;
  name: string;
  type: AssetType;
  object3d: THREE.Object3D;
  url?: string;
  fileData?: ArrayBuffer;
  isCollidable: boolean;
  videoElement?: HTMLVideoElement;
  audioElement?: HTMLAudioElement;
  subtitleCues?: SubtitleCue[];
  subtitlesData?: string;
  contextMenuItems?: ContextMenuItemDef[];
  metadata?: {
    fileSize?: number;
    mimeType?: string;
    extension?: string;
    videoSyncMode?: 'persistent' | 'watch-party';
  };
}

export class AssetManager {
  private scene: THREE.Scene;
  /**
   * Parent for spawned objects. In the SceneEngine VR-locomotion
   * pattern every world-bound asset lives under `worldRoot` so the
   * engine's inverse-treadmill translation carries the asset along
   * with the simulation. Desktop modes leave worldRoot at identity,
   * so this is visually equivalent to the previous `scene.add(obj)`.
   * Kept separate from `scene` because some operations (skybox BG,
   * scene environment) target the actual THREE.Scene, not the
   * worldRoot group.
   */
  private worldRoot: THREE.Object3D;
  private gltfLoader: GLTFLoader;
  private objLoader: OBJLoader;
  private fbxLoader: FBXLoader;
  private textureLoader: THREE.TextureLoader;
  private progressiveEnabled = false;
  private progressiveRenderer: THREE.WebGLRenderer | null = null;
  // Tracks whether the plugin has ever been registered on the GLTFLoader.
  // Once registered it can't be removed, so we avoid double-registration
  // when the user toggles the setting off and on again.
  private progressivePluginRegistered = false;
  
  /**
   * Splat container formats for which Spark's SplatPager has built-in support via a
   * pre-tiled spatial index (KSPLAT octree, PlayCanvas SOG octree, RAD tile
   * manifest). For these formats AND these formats only does `paged: true` do
   * anything useful — Spark would no-op it on a raw PLY/SPZ because there's no
   * tile manifest to page against.
   *
   * Returns the explicit `SplatFileType` to pass to BOTH SplatMesh and a
   * manually-constructed PagedSplats instance, or `undefined`
   * for non-tileable formats (where the field is omitted so Spark's filename
   * auto-detect decides). Note Spark's loader already maps `.sog` and `.sogs`
   * to PCSOGS via its own filename extension table; we mirror that here so the
   * explicit fileType matches what Spark would have inferred anyway. PCSOGSZIP
   * (zip-wrapped PCSOGS) is not enumerated because it's vanishingly rare and
   * Spark's auto-detect covers it; if it becomes common add the case.
   */
  private static tileableSplatFileType(name: string): SplatFileType | undefined {
    const lower = name.toLowerCase();
    if (lower.endsWith('.ksplat')) return SplatFileType.KSPLAT;
    if (lower.endsWith('.sog') || lower.endsWith('.sogs')) return SplatFileType.PCSOGS;
    if (lower.endsWith('.rad')) return SplatFileType.RAD;
    return undefined;
  }

  public assets: Map<string, LoadedAsset> = new Map();
  public subtitleSettings: SubtitleSettings = loadSubtitleSettings();

  public setSubtitleSettings(settings: SubtitleSettings): void {
    this.subtitleSettings = settings;
  }

  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }
  private pendingLiveStreams: Map<string, MediaStream> = new Map();
  private videoTickCallbacks: Map<string, () => void> = new Map();
  private audioTickCallbacks: Map<string, () => void> = new Map();
  private animatedImageTickCallbacks: Map<string, (delta: number) => void> = new Map();
  private onAssetAddedCallbacks: Set<(asset: LoadedAsset) => void> = new Set();
  private onAssetRemovedCallbacks: Set<(id: string) => void> = new Set();
  private onVideoPlaybackChangedCallbacks: Set<(id: string) => void> = new Set();
  private onAudioPlaybackChangedCallbacks: Set<(id: string) => void> = new Set();
  // In-progress import dedup. Concurrent calls to `importFile` /
  // `importFromUrl` with the same customId return the same Promise
  // instead of each starting their own async work, so we never end up
  // calling `worldRoot.add(asset.object3d)` twice for the same id.
  // Without this, two near-simultaneous `'spawn'` envelopes for the
  // same id race past the Map-based `assets.has(id)` short-circuit
  // (the Map isn't populated until either import's promise resolves)
  // and each one independently does `worldRoot.add(...)` plus its own
  // `onAssetAdded` callback fire, which then broadcasts ANOTHER
  // `'spawn'` envelope — a visible duplicate mesh + a fan-out loop.
  private inProgressImports: Map<string, Promise<LoadedAsset | null>> = new Map();

  // Raw-mode (lazy-share) byte storage. When the user toggles
  // "Import as Raw File" in the dialog, the bytes are kept here in
  // IndexedDB instead of being broadcast to peers, and the in-world
  // misc asset stays local until the user takes an Import / Download /
  // Save-to-Inventory action. App.tsx supplies an instance via the
  // optional constructor param so AssetManager stays minimally
  // coupled — without it, raw-mode imports silently no-op the
  // IndexedDB store step (the misc asset still lands, just without
  // the rehydration handle).
  private rawFilesStore: RawFilesStore | null = null;
  // Local MSE pipeline for large MP4 imports. Optional (mirrors
  // rawFilesStore) so test/headless init sites without a
  // VideoStreamingService still work — the route through
  // attachLocalReceiver is just an optimization for
  // file.size >= LOCAL_MSE_BYTES; the plain blob: URL loadVideo
  // path is the always-available fallback.
  private videoStreamingService: VideoStreamingService | null = null;

  /**
   * Files at-or-above this size route through
   * VideoStreamingService.attachLocalReceiver (MP4Box + MediaSource
   * chunked pipeline) instead of the plain blob: URL pre-roll.
   * Empirically:
   *  - sub-50 MB: blob URL pre-rolls metadata + first keyframe in
   *    ~200-500 ms on Quest; MSE pipeline adds setup overhead.
   *  - 50 MB+: pre-roll time scales with file size; a 300 MB file
   *    waits 5-10 s for the first frame via plain blob: URL.
   *    MP4Box reads only the moov atom needed for the first
   *    fragment and SourceBuffer.appendBuffer fires as soon as
   *    that fragment is parsed — bringing first-frame latency
   *    back to ~500-800 ms.
   * MP4-only at the moment: WebM's container structure means
   * we'd need a separate shim (e.g. shaka-packager), and the
   * existing blob: URL path already handles WebM fast enough
   * to be usable.
   */
  private static readonly LOCAL_MSE_BYTES = 50 * 1024 * 1024; // 50 MB

  private camera: THREE.Camera | null = null;

  constructor(scene: THREE.Scene, worldRoot: THREE.Object3D, rawFilesStore?: RawFilesStore, videoStreamingService?: VideoStreamingService, camera?: THREE.Camera) {
    this.scene = scene;
    this.worldRoot = worldRoot;
    if (camera) this.camera = camera;
    this.gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader.setDRACOLoader(dracoLoader);
    try {
      if (MeshoptDecoder) {
        this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
      }
    } catch (e) {
      console.warn('MeshoptDecoder setup warning:', e);
    }
    this.objLoader = new OBJLoader();
    this.fbxLoader = new FBXLoader();
    this.textureLoader = new THREE.TextureLoader();
    // Wire raw-mode byte store. Optional so existing engine-init sites
    // without a store (e.g. tests, headless) keep working — the raw
    // short-circuit degrades to "misc asset with empty bytes + isRaw
    // flag" if the store is missing, which App.tsx can detect via
    // rehydrateRawFile returning null and gracefully no-op.
    this.rawFilesStore = rawFilesStore ?? null;
    // Same optional-degrade pattern for the local MSE pipeline. If
    // App.tsx hasn't wired VideoStreamingService yet (e.g. the
    // 228K-char edit is blocked by the tool's response buffer) the
    // blob: URL fallback path stays in effect — large videos still
    // play, just with the slower first-frame latency.
    this.videoStreamingService = videoStreamingService ?? null;
    void this.videoStreamingService;
    void AssetManager.LOCAL_MSE_BYTES;
  }

  /**
   * Per-frame update called by SceneEngine loop.
   * Ensures VideoTexture and CanvasTexture draw/upload callbacks execute
   * during WebXR immersive VR sessions where window.requestAnimationFrame
   * and requestVideoFrameCallback are suspended by the browser.
   */
  public update(_delta: number, _elapsed: number): void {
    if (this.videoTickCallbacks.size > 0) {
      for (const cb of this.videoTickCallbacks.values()) {
        try { cb(); } catch { /* ignore */ }
      }
    }
    if (this.animatedImageTickCallbacks.size > 0) {
      for (const cb of this.animatedImageTickCallbacks.values()) {
        try { cb(_delta); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Pull the original bytes for a raw-mode misc asset out of
   * IndexedDB and wrap them in a fresh `File` so a re-import
   * (via AssetManager.importFile) or an InventoryService.saveItem
   * call can use them. Returns null when the asset isn't registered
   * in the store — distinguish from "bytes are zero-length" by
   * checking the record's `bytes.byteLength` upstream.
   */
  public async rehydrateRawFile(id: string): Promise<File | null> {
    if (!this.rawFilesStore) return null;
    const rec = await this.rawFilesStore.load(id);
    if (!rec) return null;
    // Reconstruct a File with the original name + mime so
    // AssetManager.importFile sees the same shape the user originally
    // uploaded — its per-extension router will then decode the bytes
    // and emit a normal-type `spawn` envelope with broadcast bytes
    // (≤ 15 MB inline; > 15 MB triggers the existing
    // fileDataOversized / VideoStreaming fallback paths the host
    // already has).
    return new File([rec.bytes], rec.name, { type: rec.type });
  }

  /**
   * Enable @needle-tools/gltf-progressive for automatic LOD streaming.
   * For models that contain progressive LOD data (processed via Needle tools),
   * this enables instant low-poly display while high-detail geometry streams in.
   * For regular models it's a no-op. Safe to call multiple times.
   */
  public async enableProgressiveLoading(renderer: THREE.WebGLRenderer): Promise<void> {
    this.progressiveEnabled = true;
    if (this.progressivePluginRegistered) return;
    try {
      const { useNeedleProgressive, useRaycastMeshes } = await import('@needle-tools/gltf-progressive');
      useNeedleProgressive(this.gltfLoader, renderer);
      useRaycastMeshes(true);
      this.progressivePluginRegistered = true;
      this.progressiveRenderer = renderer;
      console.log('[AssetManager] gltf-progressive enabled — LOD streaming active for progressive assets');
    } catch (err) {
      console.warn('[AssetManager] Failed to enable gltf-progressive:', err);
    }
  }

  /**
   * Disable progressive loading flag. The underlying GLTFLoader plugin
   * cannot be un-registered, but it is a no-op for non-progressive assets
   * so this is safe. Re-enabling will skip the dynamic import since the
   * plugin is already registered on the loader.
   */
  public disableProgressiveLoading(): void {
    this.progressiveEnabled = false;
    console.log('[AssetManager] gltf-progressive disabled');
  }

  public isProgressiveEnabled(): boolean {
    return this.progressiveEnabled;
  }

  /**
   * Returns the LODsManager instance if progressive loading has been
   * enabled, or null otherwise. Callers can use this to tweak
   * `targetTriangleDensity` and `overrideLodLevel` at runtime.
   */
  public async getLODsManager(): Promise<import('@needle-tools/gltf-progressive').LODsManager | null> {
    if (!this.progressiveRenderer) return null;
    try {
      const { LODsManager } = await import('@needle-tools/gltf-progressive');
      return LODsManager.get(this.progressiveRenderer);
    } catch (err) {
      console.warn('[AssetManager] Failed to get LODsManager:', err);
      return null;
    }
  }

  public registerOnAssetAdded(cb: (asset: LoadedAsset) => void): () => void {
    this.onAssetAddedCallbacks.add(cb);
    return () => this.onAssetAddedCallbacks.delete(cb);
  }

  public registerOnAssetRemoved(cb: (id: string) => void): () => void {
    this.onAssetRemovedCallbacks.add(cb);
    return () => this.onAssetRemovedCallbacks.delete(cb);
  }

  /**
   * Subscribe to video playback state changes that happen outside
   * the normal applyVideoState path — specifically the HTMLVideoElement
   * 'ended' event. App.tsx uses this to trigger a React re-render so
   * the play/pause button icon stays in sync when a video finishes.
   */
  public registerOnVideoPlaybackChanged(cb: (id: string) => void): () => void {
    this.onVideoPlaybackChangedCallbacks.add(cb);
    return () => this.onVideoPlaybackChangedCallbacks.delete(cb);
  }

  /**
   * Subscribe to audio playback state changes. Mirrors video pattern.
   */
  public registerOnAudioPlaybackChanged(cb: (id: string) => void): () => void {
    this.onAudioPlaybackChangedCallbacks.add(cb);
    return () => this.onAudioPlaybackChangedCallbacks.delete(cb);
  }

  /**
   * Returns true if there's an in-flight `importFile` / `importFromUrl`
   * for the given id that hasn't yet populated `assets` or fired its
   * `onAssetAdded` callbacks. App.tsx's `net.onSpawn` and
   * `net.onSyncResp` consult this alongside `assets.has(id)` to
   * short-circuit BOTH the already-loaded case AND the mid-import
   * case, which closes the race window where two duplicate listeners
   * see the Map empty before either's importFile promise resolves.
   */
  public isImporting(id: string): boolean {
    return this.inProgressImports.has(id);
  }

  public async importFile(
    file: File,
    position = new THREE.Vector3(0, 1.5, 0),
    config?: Partial<ImportConfig>,
    customId?: string,
    onProgress?: (pct: number | null) => void
  ): Promise<LoadedAsset | null> {
    const id = customId ?? `asset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const inFlight = this.inProgressImports.get(id);
    if (inFlight) return inFlight;
    const promise = this._loadFile(file, position, config, id, onProgress);
    this.inProgressImports.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inProgressImports.delete(id);
    }
  }

  private async _loadFile(
    file: File,
    position: THREE.Vector3,
    config: Partial<ImportConfig> | undefined,
    id: string,
    onProgress?: (pct: number | null) => void
  ): Promise<LoadedAsset | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    // Phase 2: VIDEO FILES DO NOT call file.arrayBuffer(). The original
    // code allocated the entire video bytes into a single JS-heap
    // ArrayBuffer, which:
    //   - allocated bytes equal to the file size (1 GB video = 1 GB heap)
    //   - was then assigned to `LoadedAsset.fileData` and pinned for the
    //     lifetime of the asset, multiplying heap pressure by ~2x once
    //     the peer-side import also calls arrayBuffer() on the same bytes.
    //   - was uploaded verbatim into THREE.VideoTexture's GPU upload
    //     path, generating full-resolution frames every rAF tick.
    // On a 6–8 GB Quest, that path OOMs the tab within seconds of any
    // 200 MB+ import. The new path keeps the raw `File` (which is a
    // Blob) and lets the browser stream it into the <video> element
    // through its blob URL. LoadedAsset.fileData is `undefined` for
    // videos so the bytes never materialize in our heap.
    const isVideoExt = ['mp4', 'webm', 'mov'].includes(ext);
    // Phase 2 safe path: only hoist the bytes into a heap-resident
    // ArrayBuffer for videos small enough to also fit through the
    // network layer's inlined-envelope budget (see
    // NetworkService.MAX_INLINED_FILE_BYTES = 15 MB). For larger
    // videos we keep Phase 2's behavior — let the <video> element
    // stream directly off the browser-managed Blob/File reference —
    // because the spawn envelope would be stripped and tagged with
    // fileDataOversized anyway, so allocating 100+MB in heap just
    // for a doomed broadcast would re-create the original OOM.
    // Threshold matches NetworkService.MAX_INLINED_FILE_BYTES so the
    // bytes can actually round-trip through the wire without being
    // stripped at buildEnvelope time.
    //
    // Raw-file override: when the caller asks for `importAsRawFile`,
    // we ALWAYS need the bytes regardless of video size, because
    // the misc-file renderer relies on `LoadedAsset.fileData` for
    // download + inventory-save. Skipping the heap allocation here
    // would leave the misc asset unable to be saved/inventoried.
    // The user has explicitly opted in to raw mode so they're aware
    // a large video will pin a large ArrayBuffer; we trade that
    // for the ability to ship the bytes intact through the spawn
    // envelope. Quest 8GB RAM still applies.
    // Bytes-phase progress (simplified). We deliberately DON'T stream
    // through FileReader.readAsArrayBuffer.onprogress here even though it
    // would give a more granular 0..50% readout, because:
    //   (a) FileReader.onprogress fires at roughly 10 Hz per spec, so the
    //       UI smoothness is the same as a single 50% post-bytes tick on
    //       any modern browser.
    //   (b) The bulk of import latency lives in the GLTF/Texture decode
    //       phase (50 -> 95%) which runs UNOBSERVED for blob: URLs anyway
    //       (GLTFLoader's XHRLoader onProgress does not fire when loading
    //       from blob: URLs).
    //   (c) Adding a streaming helper here would also need a matching
    //       helper for URL imports, doubling the surface area.
    // Therefore: one 50% tick after the bytes resolve, then the loader
    // resolves at 100%. The placeholder shows a smooth 0 -> 50 -> 100
    // sweep with no visible percentage jitter.
    const isAudioExt = AUDIO_EXTENSIONS.includes(ext);
    const isMediaExt = isVideoExt || isAudioExt;
    const arrayBuffer = (isMediaExt && !config?.importAsRawFile)
      ? null
      : await file.arrayBuffer();
    if (onProgress) {
      try { onProgress(50); } catch { /* ignore listener errors */ }
    }
    const blobUrl = URL.createObjectURL(file);

    let asset: LoadedAsset | null = null;

    // Raw-file short-circuit (LAZY SHARE). When the import dialog's
    // `Import as Raw File` toggle is on, route ANY extension through
    // createMiscFileObject and skip the type-specific loaders entirely.
    //
    // CRITICAL: the misc asset created for raw mode MUST NOT carry its
    // bytes inline (`asset.fileData`/`userData.fileData`) — those are
    // what buildEnvelope would base64-encode into a 'spawn' envelope
    // for peers, which is exactly the broadcast we want to SUPPRESS.
    // Passing `new ArrayBuffer(0)` to createMiscFileObject (canvas
    // icon only reads name/mime/size, never the bytes) and explicitly
    // nulling fileData + stamping `userData.isRaw = true` together
    // ensures:
    //   1. App.tsx's registerOnAssetAdded callback short-circuits
    //      its broadcastSpawn branch on `userData.isRaw === true`.
    //   2. NetworkService.buildEnvelope has nothing to base64-encode
    //      even if a future code path tries to broadcast.
    //   3. Peers don't get a 'spawn' envelope for this asset — it
    //      lives only on the importer until they take a verb action.
    //
    // The bytes are AWAITED into RawFilesStore (NOT fire-and-forget)
    // so the misc asset is only added to the world once the store
    // resolves. A user who grabs the asset between misc-asset-in-world
    // and bytes-in-IndexedDB would otherwise see download/save/import
    // silently fail. The await closes that TOCTOU window.
    if (config?.importAsRawFile) {
      asset = this.createMiscFileObject(
        id,
        file.name,
        new ArrayBuffer(0),
        file.type || 'application/octet-stream',
        file.size,
        position
      );
      if (asset) {
        // Lazy-share: clear any inline bytes that createMiscFileObject
        // put on the misc asset, and tag the userData so consumers
        // (App.tsx's broadcast gate, MiscFileModal's raw-aware UI,
        // radial context menu) can detect raw mode without
        // round-tripping through the asset type alone.
        asset.fileData = undefined;
        asset.object3d.userData.fileData = undefined;
        asset.object3d.userData.isRaw = true;
        if (this.rawFilesStore && arrayBuffer) {
          await this.rawFilesStore.store(
            asset.id,
            file.name,
            file.type || 'application/octet-stream',
            arrayBuffer
          );
        }
      }
    } else if (['glb', 'gltf'].includes(ext)) {
      asset = await this.loadGLB(id, file.name, blobUrl, arrayBuffer!, position, config, onProgress);
    } else if (['ply', 'spz', 'splat', 'ksplat', 'sog', 'sogs', 'rad'].includes(ext)) {
      // Splat files are decoded by Spark into GPU textures after the
      // bytes are already in memory; the decode phase is synchronous
      // and gives no progress events. Map the bytes-phase completion to
      // ~95% and let the final 5% fly to 100% on resolve — adequate for
      // the long-running Spark case (large .rad / .ksplat files can take
      // 1-3 s to push to GPU even after bytes are in RAM).
      if (onProgress) { try { onProgress(95); } catch { /* ignore */ } }
      asset = await this.loadSplat(id, file.name, blobUrl, arrayBuffer!, position, config);
    } else if (['obj'].includes(ext)) {
      asset = await this.loadOBJ(id, file.name, blobUrl, arrayBuffer!, position, config, onProgress);
    } else if (['fbx'].includes(ext)) {
      asset = await this.loadFBX(id, file.name, blobUrl, arrayBuffer!, position, config, onProgress);
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'jfif'].includes(ext) || file.type.startsWith('image/')) {
      // Optimization phase (canvas resample) gives no progress granularity.
      // Mark the bytes phase done (50% — we already pushed it above for
      // small files) before kicking off the optimize so the loader-driven
      // 50-95% phase has room to grow.
      if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
      const mimeType = file.type || `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`;

      // 1. Check for animated GIF first (full transparency + frame animation via omggif)
      if (ext === 'gif' || mimeType === 'image/gif') {
        const animatedGif = await this.loadAnimatedGif(id, file.name, arrayBuffer!, position, config);
        if (animatedGif) {
          asset = animatedGif;
        }
      }

      // 2. Check for animated WebP / APNG via WebCodecs ImageDecoder
      if (!asset && (ext === 'webp' || ext === 'png' || ext === 'apng') && typeof ImageDecoder !== 'undefined') {
        const animatedImage = await this.loadAnimatedImageDecoder(id, file.name, arrayBuffer!, mimeType, position, config);
        if (animatedImage) {
          asset = animatedImage;
        }
      }

      // 3. Static image fallback
      if (!asset) {
        let optBuf = arrayBuffer!;
        if (!ext.includes('gif') && !ext.includes('svg') && !mimeType.includes('gif') && !mimeType.includes('svg') && arrayBuffer!.byteLength > 2 * 1024 * 1024) {
          try {
            optBuf = await AssetManager.optimizeImageBuffer(arrayBuffer!, mimeType);
          } catch {
            optBuf = arrayBuffer!;
          }
        }
        const isConvertedToWebP = optBuf !== arrayBuffer;
        const optUrl = isConvertedToWebP ? URL.createObjectURL(new Blob([optBuf], { type: 'image/webp' })) : blobUrl;
        asset = await this.loadImage(id, file.name, optUrl, optBuf, position, config, onProgress);
      }
    } else if (isVideoExt) {
      // Phase 2 + tier-aware VRAM cap: blob: URL plumbing. We hand
      // the File/Blob directly to loadVideo, which sets
      // `video.src = URL.createObjectURL(source)` and wraps the
      // element in a THREE.CanvasTexture (Quest/mobile tiers) or
      // VideoTexture (desktop + HW decode) sized at the device's
      // VRAM cap from shouldDownscaleVideoForVRAM. No ArrayBuffer
      // touches the heap, so a 300 MB import never inflates our
      // resident bytes beyond the browser's pre-loaded metadata.
      //
      // NOTE: a previous iteration tried routing large MP4 files
      // (>= 50 MB) through VideoStreamingService.attachLocalReceiver
      // (MP4Box + MediaSource chunked pipeline) for a faster first-
      // frame, but it caused the importer's own video to fail to
      // play on some 300 MB+ MP4 profiles — symptom was a
      // permanently black texture even after the MSE pipeline
      // completed. Disabled here; the blob: URL path above is the
      // known-good video entry and the tier-aware VRAM cap keeps
      // Quest working without the chunked-MSE optimization. The
      // attachLocalReceiver method remains in VideoStreamingService
      // as future infrastructure — to be re-enabled after the
      // pipeline is re-validated with proper first-frame readiness
      // signaling (a Promise that resolves on loadedmetadata /
      // HAVE_METADATA, awaited before loadVideoFromStreamedSource
      // attaches the THREE texture).
      asset = await this.loadVideo(id, file.name, file, position, config);
      if (asset) {
        if (arrayBuffer) {
          asset.fileData = arrayBuffer;
        }
        asset.url = blobUrl;
      }
    } else if (ext === 'vrm') {
      asset = await this.loadGLB(id, file.name, blobUrl, arrayBuffer!, position, config, onProgress);
      if (asset) asset.type = 'vrm';
    } else if (AUDIO_EXTENSIONS.includes(ext)) {
      if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
      asset = await this.loadAudio(id, file.name, file, position, config);
      if (asset) {
        if (arrayBuffer) {
          asset.fileData = arrayBuffer;
        }
        asset.url = blobUrl;
      }
    } else {
      // Misc file objects draw a canvas icon synchronously. No bytes-
      // post-decode phase to report — fire 50% (bytes phase complete)
      // immediately so the UI placeholder knows we own the bytes,
      // then 100% on resolve.
      if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
      asset = this.createMiscFileObject(id, file.name, arrayBuffer!, file.type, file.size, position);
      if (onProgress) { try { onProgress(100); } catch { /* ignore */ } }
    }

    if (asset) {
      this.worldRoot.add(asset.object3d);
      this.assets.set(asset.id, asset);
      for (const cb of this.onAssetAddedCallbacks) cb(asset);
    }
    if (onProgress) { try { onProgress(100); } catch { /* ignore */ } }

    return asset;
  }

  public async importFromUrl(
    url: string,
    position = new THREE.Vector3(0, 1.5, 0),
    config?: Partial<ImportConfig>,
    customId?: string,
    onProgress?: (pct: number | null) => void
  ): Promise<LoadedAsset | null> {
    const id = customId ?? `remote-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const inFlight = this.inProgressImports.get(id);
    if (inFlight) return inFlight;
    const promise = this._loadFromUrl(url, position, config, id, onProgress);
    this.inProgressImports.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inProgressImports.delete(id);
    }
  }

  private async _loadFromUrl(
    url: string,
    position: THREE.Vector3,
    config: Partial<ImportConfig> | undefined,
    id: string,
    onProgress?: (pct: number | null) => void
  ): Promise<LoadedAsset | null> {
    const ext = url.split('.').pop()?.split('?')[0].toLowerCase() || 'png';
    const name = url.split('/').pop()?.split('?')[0] || `remote-${Date.now()}.${ext}`;

    try {
      // Streaming fetch with progress reporting. Content-Length tells us
      // the total bytes; if it's missing (chunked / server-stripped)
      // emit `onProgress(null)` so consumers can switch to indeterminate.
      // The loader-level onProgress (GLTFLoader / TextureLoader) covers
      // the post-bytes decode phase for asset types that have it; the
      // URL fetch covers the bytes phase 0% → 50%.
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${url} (${response.status} ${response.statusText})`);
      }
      const contentType = response.headers.get('content-type') || '';
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
      let arrayBuffer: ArrayBuffer;
      if (response.body && totalBytes !== null && onProgress) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            const pct = Math.min(50, Math.round((received / totalBytes) * 50));
            try { onProgress(pct); } catch { /* ignore */ }
          }
        }
        const combined = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        arrayBuffer = combined.buffer;
      } else {
        if (onProgress) { try { onProgress(null); } catch { /* ignore */ } }
        arrayBuffer = await response.arrayBuffer();
        if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
      }
      const blob = new Blob([arrayBuffer]);
      const blobUrl = URL.createObjectURL(blob);

      let asset: LoadedAsset | null = null;

      // Raw-file short-circuit (URL variant, LAZY SHARE). Same
      // lazy-share semantics as the file-import branch above:
      // suppress broadcast, clear inline bytes, mark userData.isRaw,
      // and await the IndexedDB store call. URL-fetched bytes are
      // already populated by the fetcher above so there's no heap
      // reservation change here. MUST run before the per-extension
      // branches below.
      if (config?.importAsRawFile) {
        asset = this.createMiscFileObject(
          id,
          name,
          new ArrayBuffer(0),
          'application/octet-stream',
          arrayBuffer.byteLength,
          position
        );
        if (asset) {
          asset.fileData = undefined;
          asset.object3d.userData.fileData = undefined;
          asset.object3d.userData.isRaw = true;
          if (this.rawFilesStore) {
            await this.rawFilesStore.store(
              asset.id,
              name,
              'application/octet-stream',
              arrayBuffer
            );
          }
        }
      } else if (['glb', 'gltf', 'vrm'].includes(ext)) {
        asset = await this.loadGLB(id, name, blobUrl, arrayBuffer, position, config, onProgress);
        if (ext === 'vrm' && asset) asset.type = 'vrm';
      } else if (['ply', 'spz', 'splat', 'ksplat', 'sog', 'sogs', 'rad'].includes(ext)) {
        // Splat decode is sync after bytes — push to 95% and let resolve
        // take it to 100%. Mirrors the file-import splat path above.
        if (onProgress) { try { onProgress(95); } catch { /* ignore */ } }
        asset = await this.loadSplat(id, name, blobUrl, arrayBuffer, position, config);
      } else if (['obj'].includes(ext)) {
        asset = await this.loadOBJ(id, name, blobUrl, arrayBuffer, position, config, onProgress);
      } else if (['fbx'].includes(ext)) {
        asset = await this.loadFBX(id, name, blobUrl, arrayBuffer, position, config, onProgress);
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'jfif'].includes(ext) || contentType.startsWith('image/')) {
        // textureLoader.load's onProgress covers the decode phase 50-95%.
        if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
        const mimeType = contentType.split(';')[0].trim() || `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`;

        // 1. Check for animated GIF first
        if (ext === 'gif' || mimeType === 'image/gif') {
          const animatedGif = await this.loadAnimatedGif(id, name, arrayBuffer, position, config);
          if (animatedGif) {
            asset = animatedGif;
          }
        }

        // 2. Check for animated WebP / APNG
        if (!asset && (ext === 'webp' || ext === 'png' || ext === 'apng') && typeof ImageDecoder !== 'undefined') {
          const animatedImage = await this.loadAnimatedImageDecoder(id, name, arrayBuffer, mimeType, position, config);
          if (animatedImage) {
            asset = animatedImage;
          }
        }

        // 3. Static image fallback
        if (!asset) {
          asset = await this.loadImage(id, name, blobUrl, arrayBuffer, position, config, onProgress);
        }
      } else if (['mp4', 'webm', 'mov'].includes(ext)) {
        // Phase 2: blob: URL plumbing — same disabled-MSE note as
        // _loadFile above. Future re-enablement of the chunked-MSE
        // fast path should add proper first-frame readiness signaling
        // before the THREE texture attaches.
        if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
        asset = await this.loadVideo(id, name, blob, position, config);
        if (asset) {
          if (arrayBuffer) {
            asset.fileData = arrayBuffer;
          }
          asset.url = url;
        }
      } else if (AUDIO_EXTENSIONS.includes(ext)) {
        if (onProgress) { try { onProgress(50); } catch { /* ignore */ } }
        asset = await this.loadAudio(id, name, blob, position, config);
        if (asset) {
          if (arrayBuffer) {
            asset.fileData = arrayBuffer;
          }
          asset.url = url;
        }
      } else {
        asset = this.createMiscFileObject(id, name, arrayBuffer, 'application/octet-stream', arrayBuffer.byteLength, position);
      }

      if (asset) {
        this.worldRoot.add(asset.object3d);
        this.assets.set(asset.id, asset);
        for (const cb of this.onAssetAddedCallbacks) cb(asset);
      }
      if (onProgress) { try { onProgress(100); } catch { /* ignore */ } }
      return asset;
    } catch (err) {
      console.warn('Failed to import from URL:', url, err);
      return null;
    }
  }

  private applyModelScaling(root: THREE.Object3D, config?: Partial<ImportConfig>): void {
    if (!config) return;
    const mode = config.modelScaleMode;
    if (mode === 'meters') root.scale.setScalar(1.0);
    else if (mode === 'cm') root.scale.setScalar(0.01);
    else if (mode === 'inches') root.scale.setScalar(0.0254);
    else if (mode === 'custom') root.scale.setScalar(config.customScaleMultiplier || 1.0);
    else if (mode === 'auto') {
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0.01) {
        const scale = 2.0 / maxDim;
        root.scale.setScalar(scale);
      }
    }

    if (config.placement === 'origin') {
      root.position.set(0, 0, 0);
    } else if (config.placement === 'floor') {
      const box = new THREE.Box3().setFromObject(root);
      root.position.y += (root.position.y - box.min.y) + 0.05;
    }
  }

  private async loadGLB(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>, _onProgress?: (pct: number | null) => void): Promise<LoadedAsset> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, (gltf) => {
        const root = gltf.scene;
        root.position.copy(pos);
        this.applyModelScaling(root, config);
        this.optimizeMeshes(root);
        this.applyShading(root, config?.shading || 'smooth');
        this.enableShadows(root);

        resolve({
          id,
          name,
          type: name.endsWith('.vrm') ? 'vrm' : '3d-model',
          object3d: root,
          url,
          fileData: buffer,
          isCollidable: true
        });
      }, undefined, reject);
    });
  }

  private async loadOBJ(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>, _onProgress?: (pct: number | null) => void): Promise<LoadedAsset> {
    return new Promise((resolve, reject) => {
      this.objLoader.load(url, (root) => {
        root.position.copy(pos);
        this.applyModelScaling(root, config);
        this.optimizeMeshes(root);
        this.applyShading(root, config?.shading || 'smooth');
        this.enableShadows(root);
        resolve({
          id,
          name,
          type: '3d-model',
          object3d: root,
          url,
          fileData: buffer,
          isCollidable: true
        });
      }, undefined, reject);
    });
  }

  private async loadFBX(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>, _onProgress?: (pct: number | null) => void): Promise<LoadedAsset> {
    return new Promise((resolve, reject) => {
      this.fbxLoader.load(url, (root) => {
        root.position.copy(pos);
        this.applyModelScaling(root, config);
        this.optimizeMeshes(root);
        this.applyShading(root, config?.shading || 'smooth');
        this.enableShadows(root);
        resolve({
          id,
          name,
          type: '3d-model',
          object3d: root,
          url,
          fileData: buffer,
          isCollidable: true
        });
      }, undefined, reject);
    });
  }

  private async loadSplat(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>): Promise<LoadedAsset> {
    return new Promise((resolve, reject) => {
      try {
        // SplatMeshOptions.maxSplats is honored by Spark only at
        // construction time (see SplatMesh.d.ts). Passing undefined
        // (or 0 from a stale "no limit" preset) means "no cap" —
        // Spark will pick its default texture size based on the
        // splat count in the source file.
        const maxSplats = config?.splatMaxCount && config.splatMaxCount > 0
          ? config.splatMaxCount
          : undefined;
        const tileableFileType = AssetManager.tileableSplatFileType(name);
        const effectiveEnableLod = config?.splatEnableLod ?? true;
        // Memory optimization for tileable splat imports: when a manual
        // PagedSplats will own the file bytes, drop the SplatMesh-level
        // fileBytes argument. Spark's _SplatMesh assigns `this.splats =
        // this.paged` AFTER the paged branch, deferring the data source
        // to PagedSplats; passing fileBytes to both would JS-heap-pin
        // 500MB twice during a .rad / .ksplat import on Quest. For
        // non-tileable formats (PLY/SPZ/SPLAT) we keep the SplatMesh-
        // level fileBytes so SplatLoader's direct path can read them.
        const manualPagedSplats =
          tileableFileType !== undefined && effectiveEnableLod
            ? new PagedSplats({
                rootUrl: url,
                // PagedSplats holds the bytes internally as a property;
                // we hand it the buffer-backed Uint8Array directly so
                // there is exactly one resident copy of splat data on
                // the JS heap at this moment. SplatMesh.fileBytes below
                // is intentionally OMITTED in this branch (above comment).
                fileBytes: new Uint8Array(buffer),
                fileType: tileableFileType,
              })
            : null;
        const splatMesh = new SplatMesh({
          url,
          fileBytes: new Uint8Array(buffer),
          fileName: name,
          raycastable: true,
          // App.tsx injects splatEnableLod = config.splatEnableLod ?? settings.splatLodEnabled ?? true
          // before calling importFile, so by the time we reach loadSplat the value is already
          // resolved. The `?? true` fallback here just protects programmatic / programmatic-spawn
          // paths that bypass the inject (Phase 3A unit tests, future API consumers).
          enableLod: config?.splatEnableLod ?? true,
          // Forward the user's global LOD scale knob. Spark uses this to bias the
          // tier boundary (lower scale == coarser LODs selected sooner == less GPU work).
          // Comes from the per-import inject at App.tsx but defaults to 1.0 here
          // so the field is idempotent for callers that don't plug in settings.
          lodScale: config?.splatLodScale ?? 1.0,
          // Spark uses the `lod` option to decide whether to build the
          // hierarchical LOD tree at import time. Without this flag, .ply
          // and other non-tileable formats never generate LODs, so runtime
          // `lodSplatCount` / `lodSplatScale` changes have no effect.
          lod: config?.splatEnableLod ?? true,
          // Tileable splat container formats — KSPLAT, PlayCanvas SOG variants
          // (.sog / .sogs both map to PCSOGS in Spark's loader), and RAD. These
          // are the only SplatFileType values for which `paged: true` does
          // anything useful; Spark's SplatPager relies on the format's built-in
          // spatial index (octree / tile manifest). PLY and SPZ still get the
          // existing `enableLod: true` treatment (Spark generates LODs in a
          // Web Worker) but paged: true would be a no-op without the pre-tiled
          // container. Explicit fileType also makes Spark's loader picker
          // deterministic when host filenames have weird casing (e.g. Foo.KSPLAT).
          // .pcsogszip / PCSOGSZIP rarities are not explicitly handled — they
          // fall through to Spark's filename auto-detect which already covers them.
          ...(tileableFileType !== undefined ? { fileType: tileableFileType } : {}),
          ...(maxSplats !== undefined ? { maxSplats } : {}),
          // paged: true enables SplatPager's LRU tile policy for memory-bounded
          // rendering on Quest. Gate on tileable format AND effective LOD enabled
          // so the user's negative choice (opt-out of LOD generation) is consistent
          // — no LOD tree AND no paging. Raw .ply / .spz still follow the original
          // LOD-only codepath and don't pay the per-page bookkeeping cost.
          // Pass the manually-constructed PagedSplats (or null for
          // non-tileable paths). The `paged: null` spread collapses to
          // nothing so SplatMesh falls back to its non-paged code path
          // (SplatLoader's direct-load); for tileable paths SplatMesh
          // assigns `this.splats = this.paged` and ignores fileBytes.
          ...(manualPagedSplats ? { paged: manualPagedSplats } : {}),
        });
        // Splat flip-180 default: TRUE for splats. Most captured splats
        // (Polycam / Reality Capture / OpenCV-tooled exports) come out
        // upside-down because their coordinate frame is +Y down, the
        // opposite of Three.js' +Y up. A 180° rotation around the X axis
        // is the canonical fix users have come to expect from Resonite /
        // Blender / Polycam importers. `config?.splatFlip180 !== false`
        // keeps the default ON while still allowing explicit overrides
        // (the dialog exposes the toggle bound to splatFlip180; users
        // can un-tick it for captures that are already upright).
        //
        // The flip is applied to the WRAPPER Group's rotation, NOT the
        // inner SplatMesh's rotation. This is intentional: peer receivers
        // (App.tsx net.onSpawn, lines ~2142-2182) read their rotation
        // straight from the `rotation` field of the incoming AssetSpawnData
        // envelope and apply it via `asset.object3d.rotation.set(...)`.
        // The envelope's `rotation` is built on the host side from
        // `asset.object3d.rotation` (the OUTER group), so applying the
        // flip to the wrapper means peers inherit the same orientation
        // without any new envelope field, additional flag, or special
        // receiver-side branch. The previous "flip inner mesh" pattern
        // silently failed to sync because broadcastAssetUpdate /
        // broadcastSpawn only read the OUTER rotation.
        //
        // `root.userData.flipped180` is also stamped so future
        // consumers (inventory re-spawn via handleSpawnFromInventory,
        // scene-save/load via SceneSerializationService) can recover the
        // explicit boolean if they need to — the rotation itself is
        // always authoritative, but a flag carrying the user's INTENT
        // means we don't have to invert-engineer it from a quaternion
        // when reading back from a saved snapshot. The flag is harmless
        // redundancy (`.rotation.set(...)` is idempotent), it just
        // removes ambiguity when a future code path needs to ask
        // "was this splat imported flipped or un-flipped".
        const shouldFlip = config?.splatFlip180 !== false;
        const root = new THREE.Group();
        root.name = name;
        root.position.copy(pos);
        if (shouldFlip) {
          root.rotation.x = Math.PI;
        }
        root.userData.flipped180 = shouldFlip;
        root.add(splatMesh);

        this.applyModelScaling(root, config);

        resolve({
          id,
          name,
          type: 'splat',
          object3d: root,
          url,
          fileData: buffer,
          isCollidable: true
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public static async optimizeImageBuffer(buffer: ArrayBuffer, mimeType: string): Promise<ArrayBuffer> {
    // If small (< 2 MB) or animated GIF/SVG, keep as-is
    if (buffer.byteLength < 2 * 1024 * 1024) return buffer;
    if (mimeType.includes('gif') || mimeType.includes('svg')) return buffer;
    try {
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Image optimization timed out'));
        }, 1500);
        img.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Failed to load image for optimization'));
        };
        img.src = url;
      });
      URL.revokeObjectURL(url);

      const maxDim = 2048;
      let w = img.width || 1024;
      let h = img.height || 1024;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return buffer;
      ctx.drawImage(img, 0, 0, w, h);
      const outBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
      if (outBlob) {
        return await outBlob.arrayBuffer();
      }
      return buffer;
    } catch {
      return buffer;
    }
  }

  private async loadImage(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>, _onProgress?: (pct: number | null) => void): Promise<LoadedAsset> {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(url, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        
        if (config?.textureFiltering === 'pixel-art') {
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.generateMipmaps = false;
        }

        const group = new THREE.Group();
        group.position.copy(pos);

        if (config?.imageDisplayMode === 'skybox') {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.scene.background = texture;
          this.scene.environment = texture;
          // Return an invisible dummy object so asset tracking stays consistent
          resolve({
            id,
            name: `Skybox: ${name}`,
            type: 'image',
            object3d: group,
            url,
            fileData: buffer,
            isCollidable: false
          });
          return;
        }

        if (config?.imageDisplayMode === 'panorama-360') {
          const sphereGeo = new THREE.SphereGeometry(20, 64, 32);
          const sphereMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
          const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
          sphereMesh.scale.x = -1; // Invert horizontally for correct 360 panorama viewing inside
          group.add(sphereMesh);
          resolve({
            id,
            name: `360 Pano: ${name}`,
            type: 'image',
            object3d: group,
            url,
            fileData: buffer,
            isCollidable: false
          });
          return;
        }

        if (config?.imageDisplayMode === 'billboard') {
          const aspect = texture.image ? (texture.image.width / texture.image.height || 1) : 1;
          const width = Math.min(2.5, Math.max(0.6, aspect * 1.5));
          const height = width / aspect;

          const spriteMat = new THREE.SpriteMaterial({ map: texture });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set(width, height, 1);
          group.add(sprite);

          resolve({
            id,
            name,
            type: 'image',
            object3d: group,
            url,
            fileData: buffer,
            isCollidable: false
          });
          return;
        }

        const displayMode = config?.imageDisplayMode || '2d-plane';
        if (displayMode === '2d-plane') {
          const imgWidth = (texture.image && texture.image.width) ? texture.image.width : 1024;
          const imgHeight = (texture.image && texture.image.height) ? texture.image.height : 1024;
          const aspect = imgWidth / imgHeight || 1;
          const width = Math.min(2.5, Math.max(0.6, aspect * 1.5));
          const height = width / aspect;

          const imgGeo = new THREE.PlaneGeometry(width, height);
          const imgMat = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.01,
          });
          const imgMesh = new THREE.Mesh(imgGeo, imgMat);
          imgMesh.name = `${name} (Mesh)`;
          imgMesh.castShadow = true;
          imgMesh.receiveShadow = true;
          group.name = name;
          group.add(imgMesh);

          if (this.camera) {
            const camPos = this.camera.position;
            const dx = camPos.x - pos.x;
            const dz = camPos.z - pos.z;
            if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
              group.rotation.y = Math.atan2(dx, dz);
            }
          }

          group.userData.grabbable = {
            enabled: true,
            scalable: true,
            allowSteal: true,
            grabPriority: 0,
            editModeOnly: false,
            destroyOnRelease: false,
          };
          group.userData.is2DImage = true;

          resolve({
            id,
            name,
            type: 'image',
            object3d: group,
            url,
            fileData: buffer,
            isCollidable: true
          });
          return;
        }

        // Default / Explicit Panel mode
        const imgWidth = (texture.image && texture.image.width) ? texture.image.width : 1024;
        const imgHeight = (texture.image && texture.image.height) ? texture.image.height : 1024;
        const aspect = imgWidth / imgHeight || 1;
        const width = Math.min(2.5, Math.max(0.6, aspect * 1.5));
        const height = width / aspect;

        const frameGeo = new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.05);
        const frameMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.castShadow = true;
        group.add(frame);

        const imgGeo = new THREE.PlaneGeometry(width, height);
        const imgMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        const imgMesh = new THREE.Mesh(imgGeo, imgMat);
        imgMesh.position.z = 0.028;
        group.name = name;
        group.add(imgMesh);

        if (this.camera) {
          const camPos = this.camera.position;
          const dx = camPos.x - pos.x;
          const dz = camPos.z - pos.z;
          if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
            group.rotation.y = Math.atan2(dx, dz);
          }
        }

        group.userData.grabbable = {
          enabled: true,
          scalable: true,
          allowSteal: true,
          grabPriority: 0,
          editModeOnly: false,
          destroyOnRelease: false,
        };

        resolve({
          id,
          name,
          type: 'image',
          object3d: group,
          url,
          fileData: buffer,
          isCollidable: true
        });
      }, undefined, reject);
    });
  }

  private async loadAnimatedGif(
    id: string,
    name: string,
    buffer: ArrayBuffer,
    pos: THREE.Vector3,
    config?: Partial<ImportConfig>
  ): Promise<LoadedAsset | null> {
    try {
      const u8 = new Uint8Array(buffer);
      const reader = new (GifReader as any)(u8);
      const numFrames = reader.numFrames();
      if (numFrames <= 1) return null;

      const width = reader.width;
      const height = reader.height;
      const frames: { imageData: ImageData; delayMs: number }[] = [];
      const currentPixels = new Uint8ClampedArray(width * height * 4);

      for (let i = 0; i < numFrames; i++) {
        const info = reader.frameInfo(i);
        const snapshot = info.disposal === 3 ? new Uint8ClampedArray(currentPixels) : null;

        reader.decodeAndBlitFrameRGBA(i, currentPixels as unknown as number[]);

        const frameData = new ImageData(new Uint8ClampedArray(currentPixels), width, height);
        const delayMs = Math.max(20, (info.delay && info.delay > 1 ? info.delay : 10) * 10);
        frames.push({ imageData: frameData, delayMs });

        if (info.disposal === 2) {
          for (let row = 0; row < info.height; row++) {
            const start = ((info.y + row) * width + info.x) * 4;
            const end = start + info.width * 4;
            currentPixels.fill(0, start, end);
          }
        } else if (info.disposal === 3 && snapshot) {
          currentPixels.set(snapshot);
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.putImageData(frames[0].imageData, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = config?.textureFiltering === 'pixel-art' ? THREE.NearestFilter : THREE.LinearFilter;
      texture.magFilter = config?.textureFiltering === 'pixel-art' ? THREE.NearestFilter : THREE.LinearFilter;
      texture.generateMipmaps = false;

      let currentFrame = 0;
      let timeAccumulator = 0;

      const tick = (delta: number) => {
        timeAccumulator += delta * 1000;
        const delay = frames[currentFrame].delayMs;
        if (timeAccumulator >= delay) {
          timeAccumulator = timeAccumulator % delay;
          currentFrame = (currentFrame + 1) % frames.length;
          ctx.putImageData(frames[currentFrame].imageData, 0, 0);
          texture.needsUpdate = true;
        }
      };

      this.animatedImageTickCallbacks.set(id, tick);

      const aspect = width / height || 1;
      const quadWidth = Math.min(2.5, Math.max(0.6, aspect * 1.5));
      const quadHeight = quadWidth / aspect;

      const group = new THREE.Group();
      group.name = name;
      group.position.copy(pos);

      const imgGeo = new THREE.PlaneGeometry(quadWidth, quadHeight);
      const imgMat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.001,
      });
      const imgMesh = new THREE.Mesh(imgGeo, imgMat);
      imgMesh.name = `${name} (Mesh)`;
      imgMesh.castShadow = true;
      imgMesh.receiveShadow = true;
      group.add(imgMesh);

      if (this.camera) {
        const camPos = this.camera.position;
        const dx = camPos.x - pos.x;
        const dz = camPos.z - pos.z;
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          group.rotation.y = Math.atan2(dx, dz);
        }
      }

      group.userData.grabbable = {
        enabled: true,
        scalable: true,
        allowSteal: true,
        grabPriority: 0,
        editModeOnly: false,
        destroyOnRelease: false,
      };
      group.userData.is2DImage = true;
      group.userData.isAnimatedImage = true;
      group.userData.dispose = () => {
        this.animatedImageTickCallbacks.delete(id);
        texture.dispose();
      };

      return {
        id,
        name,
        type: 'image',
        object3d: group,
        url: URL.createObjectURL(new Blob([buffer], { type: 'image/gif' })),
        fileData: buffer,
        isCollidable: true,
      };
    } catch (err) {
      console.warn('[AssetManager] Failed to load animated GIF with omggif, fallback to static:', err);
      return null;
    }
  }

  private async loadAnimatedImageDecoder(
    id: string,
    name: string,
    buffer: ArrayBuffer,
    mimeType: string,
    pos: THREE.Vector3,
    config?: Partial<ImportConfig>
  ): Promise<LoadedAsset | null> {
    if (typeof ImageDecoder === 'undefined') return null;
    try {
      // @ts-ignore WebCodecs ImageDecoder API
      const decoder = new ImageDecoder({ data: buffer, type: mimeType });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track || track.frameCount <= 1) return null;

      const numFrames = track.frameCount;
      const width = (track as any).displayWidth || (track as any).width || 512;
      const height = (track as any).displayHeight || (track as any).height || 512;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const frames: { imageBitmap: ImageBitmap; delayMs: number }[] = [];
      for (let i = 0; i < numFrames; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        const delayMs = Math.max(20, (image.duration || 100000) / 1000);
        const bmp = await createImageBitmap(image);
        image.close();
        frames.push({ imageBitmap: bmp, delayMs });
      }

      ctx.drawImage(frames[0].imageBitmap, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = config?.textureFiltering === 'pixel-art' ? THREE.NearestFilter : THREE.LinearFilter;
      texture.magFilter = config?.textureFiltering === 'pixel-art' ? THREE.NearestFilter : THREE.LinearFilter;
      texture.generateMipmaps = false;

      let currentFrame = 0;
      let timeAccumulator = 0;

      const tick = (delta: number) => {
        timeAccumulator += delta * 1000;
        const delay = frames[currentFrame].delayMs;
        if (timeAccumulator >= delay) {
          timeAccumulator = timeAccumulator % delay;
          currentFrame = (currentFrame + 1) % frames.length;
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(frames[currentFrame].imageBitmap, 0, 0);
          texture.needsUpdate = true;
        }
      };

      this.animatedImageTickCallbacks.set(id, tick);

      const aspect = width / height || 1;
      const quadWidth = Math.min(2.5, Math.max(0.6, aspect * 1.5));
      const quadHeight = quadWidth / aspect;

      const group = new THREE.Group();
      group.name = name;
      group.position.copy(pos);

      const imgGeo = new THREE.PlaneGeometry(quadWidth, quadHeight);
      const imgMat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.001,
      });
      const imgMesh = new THREE.Mesh(imgGeo, imgMat);
      imgMesh.name = `${name} (Mesh)`;
      imgMesh.castShadow = true;
      imgMesh.receiveShadow = true;
      group.add(imgMesh);

      if (this.camera) {
        const camPos = this.camera.position;
        const dx = camPos.x - pos.x;
        const dz = camPos.z - pos.z;
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          group.rotation.y = Math.atan2(dx, dz);
        }
      }

      group.userData.grabbable = {
        enabled: true,
        scalable: true,
        allowSteal: true,
        grabPriority: 0,
        editModeOnly: false,
        destroyOnRelease: false,
      };
      group.userData.is2DImage = true;
      group.userData.isAnimatedImage = true;
      group.userData.dispose = () => {
        this.animatedImageTickCallbacks.delete(id);
        texture.dispose();
      };

      return {
        id,
        name,
        type: 'image',
        object3d: group,
        url: URL.createObjectURL(new Blob([buffer], { type: mimeType })),
        fileData: buffer,
        isCollidable: true,
      };
    } catch (err) {
      console.warn('[AssetManager] ImageDecoder animated image path threw, fallback to standard:', err);
      return null;
    }
  }

  /**
   * Draw a video frame to canvas with rotation compensation.
   * The browser's <video> applies tkhd rotation internally, but
   * canvas.drawImage() captures raw unrotated pixels. This helper
   * applies a compensating canvas rotation so the texture and
   * captureStream() output are correctly oriented.
   */


  private async loadVideo(id: string, name: string, source: string | File | Blob | ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>): Promise<LoadedAsset> {
    // Phase 2: source can now be a File/Blob directly — no ArrayBuffer
    // needed in JS heap. URL imports still pass through with a string
    // (the existing fetch + createObjectURL path) and pre-Phase-3A
    // callers can pass an already-allocated blob: URL string. Accept
    // all four so internal/external callers don't have to fork.
    const video = document.createElement('video');
    video.src = typeof source === 'string'
      ? source
      : source instanceof ArrayBuffer
      ? URL.createObjectURL(new Blob([source], { type: 'video/mp4' }))
      : URL.createObjectURL(source);
    // We do NOT set crossOrigin='anonymous' on a blob: URL — it'd fail
    // with a SecurityError since the blob: scheme is opaque-origin and
    // canvas-readback / texture-uniform crossOrigin rules differ. The
    // HTMLVideoElement happily plays blob: URLs without CORS. For URL
    // imports the original crossOrigin='anonymous' still applies via
    // TYPE detection below.
    if (typeof source === 'string' && /^https?:/i.test(source)) {
      video.crossOrigin = 'anonymous';
    }
    video.loop = config?.videoLoop ?? true;
    // Start muted so an importing user isn't blasted with audio. They
    // explicitly unmute via the video controls — keeps video imports
    // courteous in social / VR sessions where a sudden sound blast
    // would be unwelcome. The persistent `muted=true` flag in
    // userData.videoState keeps this fact authoritative even if some
    // browser policy toggles the html element's muted attribute.
    video.muted = true;
    video.volume = 0.8;

    // Do NOT autoplay regardless of `config.videoAutoplay`. The
    // previous behaviour auto-played with sound; users complained
    // that an import landed alongside their camera focus and started
    // screaming before they could mute it. Now they explicitly hit
    // Play. Imports always start PAUSED + MUTED so the importing
    // user has a moment to decide whether they want sound. `config
    // .videoAutoplay` is no longer honored — leave the field in the
    // type for source compatibility but treat it as a documented no-op.

    // First-frame preload hints for the locally-spawned <video>.
    // `preload="auto"` lets Chrome / Firefox / OBC pre-fetch
    // metadata + the first keyframe so the canvas-downscale path's
    // first drawImage call has image data on hand; without it the
    // browser lazy-loads only on `play()`, which on a 300 MB
    // file adds 1-3 s to the import → first-visible-frame window.
    // `playsInline` keeps iOS Safari from forcing native fullscreen
    // when the user hits Play inside a Three.js panel.
    video.preload = 'auto';
    video.playsInline = true;
    const ensureFirstFramePainted = () => {
      if (video.paused && video.currentTime === 0) {
        try {
          video.currentTime = 0.001;
        } catch {
          /* ignore */
        }
      }
    };
    video.addEventListener('loadedmetadata', ensureFirstFramePainted, { once: true });
    video.addEventListener('loadeddata', ensureFirstFramePainted, { once: true });
    video.addEventListener('canplay', ensureFirstFramePainted, { once: true });
    try { video.load(); } catch { /* ignore */ }

    // Phase 2 + tier-aware VRAM cap. Default VideoTexture ships a
    // full-resolution RGBA frame every rAF tick — a 4K video source
    // means ~33 MB of GPU upload bandwidth per frame, which thrashes
    // Quest's mobile Adreno when more than one video is in the scene.
    // shouldDownscaleVideoForVRAM returns BOTH the decision AND the
    // tier-capped resolution so we don't have to re-classify the
    // device here. The CanvasTexture path skips mipmap generation,
    // so VRAM cost is exactly (w×h×4) bytes regardless of source
    // resolution.
    const group = new THREE.Group();
    group.position.copy(pos);

    // Subtitle processing
    let subtitlesText = config?.subtitleText;
    if (!subtitlesText && config?.subtitleFile) {
      try {
        subtitlesText = await config.subtitleFile.text();
      } catch (e) {
        console.warn('[AssetManager] Failed to read config.subtitleFile:', e);
      }
    }

    let subtitleCues: SubtitleCue[] = [];
    if (subtitlesText) {
      subtitleCues = parseSubtitles(subtitlesText);
    }

    const downscalePlan = this.shouldDownscaleVideoForVRAM(video, name);
    // NOTE: subtitles no longer force the composited-canvas path. They
    // render on a lightweight transparent overlay plane instead, so the
    // video itself stays on the GPU-native VideoTexture path — captions
    // used to cost ~30 fps because every frame was CPU-copied into a
    // canvas and re-uploaded as a texture.

    let texture: THREE.VideoTexture | THREE.CanvasTexture;
    let canvasEl: HTMLCanvasElement | null = null;
    let canvasCtx: CanvasRenderingContext2D | null = null;

    if (downscalePlan.downscale) {
      canvasEl = document.createElement('canvas');
      canvasEl.width = downscalePlan.width || 1280;
      canvasEl.height = downscalePlan.height || 720;
      canvasCtx = canvasEl.getContext('2d');
      const canvasTexture = new THREE.CanvasTexture(canvasEl);
      canvasTexture.colorSpace = THREE.SRGBColorSpace;
      canvasTexture.minFilter = THREE.LinearFilter;
      canvasTexture.magFilter = THREE.LinearFilter;
      canvasTexture.generateMipmaps = false;
      texture = canvasTexture;

      // PERF: per-tick dirty tracking. The composited output only
      // changes when the video advances a frame OR the active cue
      // changes — while paused with the same cue showing there is no
      // reason to re-copy the frame and re-upload a full 1280x720
      // texture to the GPU 60 times per second.
      let lastDrawnTime = -1;
      let lastDrawnCue: SubtitleCue | null | undefined = undefined; // undefined = never drawn

      this.videoTickCallbacks.set(id, () => {
        if (!(video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0)) return;
        const curTime = video.currentTime;
        const vs = group.userData?.videoState as VideoPlaybackState | undefined;
        const cues = (group.userData?.subtitleCues || subtitleCues) as SubtitleCue[] | undefined;
        const subEnabled = vs ? vs.subtitlesEnabled !== false : true;
        let activeCue: SubtitleCue | null = null;
        if (subEnabled && cues && cues.length > 0) {
          activeCue = cues.find((c) => c.start <= curTime && curTime <= c.end) ?? null;
        }
        const frameChanged = !video.paused || curTime !== lastDrawnTime;
        if (!frameChanged && lastDrawnCue !== undefined && activeCue === lastDrawnCue) return;

        const vw = video.videoWidth, vh = video.videoHeight;
        if (!downscalePlan.downscale && (canvasEl!.width !== vw || canvasEl!.height !== vh)) {
          canvasEl!.width = vw;
          canvasEl!.height = vh;
        }
        let dw = canvasEl!.width;
        let dh = canvasEl!.height;
        if (downscalePlan.downscale) {
          const canvasAspect = canvasEl!.width / canvasEl!.height;
          const videoAspect = vw / vh;
          if (videoAspect > canvasAspect) {
            dw = canvasEl!.width;
            dh = Math.round(canvasEl!.width / videoAspect);
          } else {
            dh = canvasEl!.height;
            dw = Math.round(canvasEl!.height * videoAspect);
          }
        }
        try {
          canvasCtx?.drawImage(video, 0, 0, dw, dh);
          // NOTE: captions are NOT composited here — they live on the
          // separate SubtitleOverlay plane (see attachSubtitleOverlay).
          // Drawing them here too would render every cue twice.
          canvasTexture.needsUpdate = true;
          lastDrawnTime = curTime;
          lastDrawnCue = activeCue;
        } catch {
          /* ignore */
        }
      });
    } else {
      texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      let lastDrawnTime = -1;
      this.videoTickCallbacks.set(id, () => {
        if (video.readyState >= 2) {
          const curTime = video.currentTime;
          if (!video.paused || curTime !== lastDrawnTime) {
            texture.needsUpdate = true;
            lastDrawnTime = curTime;
          }
        }
      });
    }

    let width = 3.0;
    let height = 1.6875; // 16:9
    if (config?.videoAspectRatio === '9:16') {
      width = 1.6875;
      height = 3.0;
    } else if (config?.videoAspectRatio === '1:1') {
      width = 2.2;
      height = 2.2;
    }

    const frameGeo = new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.08);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#07090e', roughness: 0.2, metalness: 0.8 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    group.add(frame);

    const screenGeo = new THREE.PlaneGeometry(width, height);
    const screenMat = new THREE.MeshBasicMaterial({ map: texture });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = 0.042;
    screenMesh.scale.y = -1; // Flip video — Three.js reads raw unrotated frames
    group.add(screenMesh);

    // Captions ride a separate transparent overlay plane so the video
    // texture itself stays GPU-native. The overlay only redraws when
    // the active cue changes (~once every few seconds) instead of
    // compositing text into the video frame 60 times per second.
    let subtitleOverlay: THREE.Mesh | null = null;
    if (subtitleCues.length > 0) {
      subtitleOverlay = this.attachSubtitleOverlay(id, group, video, width, height);
    }

    const videoState: VideoPlaybackState = {
      playing: false,
      currentTime: 0,
      duration: 0,
      globalVolume: 0.8,
      localVolume: 0.8,
      // Default to LOCAL volume so adjusting the slider is a personal
      // preference by default; 'global' mode is the explicit opt-in for
      // room-wide audio control.
      volumeMode: 'local',
      muted: true,
      syncMode: config?.videoSyncMode ?? 'persistent',
      subtitlesEnabled: this.subtitleSettings.showByDefault && (subtitleCues.length > 0),
      subtitlesData: subtitlesText,
      flipped: true,
    };
    group.userData.videoState = videoState;
    group.userData.subtitleCues = subtitleCues;
    group.userData.videoAspectRatio = config?.videoAspectRatio || 'auto';

    video.addEventListener('loadedmetadata', () => {
      videoState.duration = Number.isFinite(video.duration) ? video.duration : 0;
      const aspectMode = config?.videoAspectRatio || group.userData.videoAspectRatio || 'auto';
      if (
        (aspectMode === 'auto') &&
        Number.isFinite(video.videoWidth) && video.videoWidth > 0 &&
        Number.isFinite(video.videoHeight) && video.videoHeight > 0
      ) {
        const aspect = video.videoWidth / video.videoHeight;
        // Hold the vertical extent at the existing 16:9 placeholder
        // height (`height`, captured in the closure above) and let the
        // horizontal extent stretch / shrink to match the source. This
        // keeps the scene composition familiar for HD videos (where
        // height stays at ~1.69m and width = 1.69 × aspect) while
        // gracefully handling 9:16 / 21:9 / 4:3 / 1:1 etc. Vertical
        // videos therefore render as narrow tall strips, cinematic
        // videos as wide rectangular panels, etc. — the user sees the
        // actual shape of their source instead of a stretched 16:9.
        const newHeight = height;
        const newWidth = newHeight * aspect;
        frame.geometry.dispose();
        frame.geometry = new THREE.BoxGeometry(newWidth + 0.1, newHeight + 0.1, 0.08);
        screenMesh.geometry.dispose();
        screenMesh.geometry = new THREE.PlaneGeometry(newWidth, newHeight);
        // Keep the caption overlay matched to the resized screen.
        if (subtitleOverlay) {
          subtitleOverlay.geometry.dispose();
          subtitleOverlay.geometry = new THREE.PlaneGeometry(newWidth, newHeight);
        }
      }
    });
    video.addEventListener('timeupdate', () => {
      videoState.currentTime = video.currentTime;
    });
    video.addEventListener('play', () => {
      videoState.playing = true;
      for (const cb of this.onVideoPlaybackChangedCallbacks) cb(id);
    });
    video.addEventListener('pause', () => {
      videoState.playing = false;
      for (const cb of this.onVideoPlaybackChangedCallbacks) cb(id);
    });
    video.addEventListener('volumechange', () => {
      videoState.muted = video.muted;
      for (const cb of this.onVideoPlaybackChangedCallbacks) cb(id);
    });
    video.addEventListener('ended', () => {
      videoState.playing = false;
      for (const cb of this.onVideoPlaybackChangedCallbacks) cb(id);
    });
    video.addEventListener('seeked', () => {
      if (texture) (texture as THREE.Texture).needsUpdate = true;
    });

    // Phase 2 fix-up: stash the downscale-mode + cleanup handles on
    // userData so removeAsset's existing customDispose hook can cancel
    // the rVFC / rAF loop and dispose the offscreen canvas. Without
    // this, every removed/duplicated video leaks an rAF + canvas.
    const disposeVideoTexture = () => {
      try { video.pause(); } catch { /* noop */ }
      video.removeAttribute('src');
      video.load();
      if (texture && (texture as THREE.Texture).dispose) (texture as THREE.Texture).dispose();
    };
    group.userData.dispose = disposeVideoTexture;

    const pendingStream = this.pendingLiveStreams.get(id);
    if (pendingStream) {
      this.pendingLiveStreams.delete(id);
      console.log('[AssetManager] Attaching buffered live WebRTC MediaStream to newly loaded video:', id);
      video.srcObject = pendingStream;
      video.play().catch(() => {});
    }

    return {
      id,
      name,
      type: 'video',
      object3d: group,
      fileData: undefined,
      isCollidable: true,
      videoElement: video,
      url: typeof source === 'string' ? source : video.src,
      subtitleCues,
      subtitlesData: subtitlesText,
    };
  }

  private async loadAudio(id: string, name: string, source: string | File | Blob | ArrayBuffer, pos: THREE.Vector3, config?: Partial<ImportConfig>): Promise<LoadedAsset> {
    const audio = document.createElement('audio');
    audio.src = typeof source === 'string'
      ? source
      : source instanceof ArrayBuffer
      ? URL.createObjectURL(new Blob([source], { type: 'audio/mpeg' }))
      : URL.createObjectURL(source);
    if (typeof source === 'string' && /^https?:/i.test(source)) {
      audio.crossOrigin = 'anonymous';
    }
    audio.loop = config?.audioLoop ?? true;
    audio.muted = true;
    audio.volume = 0.8;
    audio.preload = 'auto';
    audio.playbackRate = config?.audioPlaybackRate ?? 1.0;
    try { audio.load(); } catch { /* ignore */ }

    // ── Canvas for waveform visualization ──
    const canvasW = 512;
    const canvasH = 192;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = canvasW;
    canvasEl.height = canvasH;
    const ctx = canvasEl.getContext('2d')!;
    const canvasTexture = new THREE.CanvasTexture(canvasEl);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.magFilter = THREE.LinearFilter;
    canvasTexture.generateMipmaps = false;
    canvasTexture.repeat.set(1, -1);
    canvasTexture.offset.set(0, 1);

    // Pre-computed static waveform from decoded audio buffer
    let staticWaveform: number[] | null = null;
    try {
      const rawSource = source instanceof ArrayBuffer ? source : null;
      if (rawSource) {
        const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuf = await actx.decodeAudioData(rawSource.slice(0));
        const rawData = audioBuf.getChannelData(0);
        const samples = canvasW;
        const blockSize = Math.floor(rawData.length / samples);
        staticWaveform = [];
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          staticWaveform.push(sum / blockSize);
        }
        // Normalize
        const maxVal = Math.max(...staticWaveform, 0.001);
        staticWaveform = staticWaveform.map(v => v / maxVal);
        await actx.close();
      }
    } catch {
      // If decode fails, staticWaveform stays null — we just show empty bars
    }

    // ── Web Audio API for real-time analyser ──
    let analyserNode: AnalyserNode | null = null;
    let audioCtx: AudioContext | null = null;
    let sourceNode: MediaElementAudioSourceNode | null = null;
    const setupAnalyser = () => {
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        sourceNode = audioCtx.createMediaElementSource(audio);
        sourceNode.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
      } catch {
        // CORS or other restriction — waveform stays static
      }
    };
    setupAnalyser();

    // ── Three.js group: compact 2.0m × 0.8m panel ──
    const width = 2.0;
    const height = 0.8;
    const group = new THREE.Group();
    group.position.copy(pos);

    // Frame
    const frameGeo = new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.06);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#07090e', roughness: 0.2, metalness: 0.8 });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    group.add(frameMesh);

    // Screen with canvas texture
    const screenGeo = new THREE.PlaneGeometry(width, height);
    const screenMat = new THREE.MeshBasicMaterial({ map: canvasTexture });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = 0.032;
    group.add(screenMesh);

    if (this.camera) {
      const camPos = this.camera.position;
      const dx = camPos.x - pos.x;
      const dz = camPos.z - pos.z;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        group.rotation.y = Math.atan2(dx, dz);
      }
    }

    // ── Audio playback state ──
    const audioState: AudioPlaybackState = {
      playing: false,
      currentTime: 0,
      duration: 0,
      globalVolume: 0.8,
      localVolume: 0.8,
      volumeMode: 'local',
      muted: true,
      loop: config?.audioLoop ?? true,
      playbackRate: config?.audioPlaybackRate ?? 1.0,
    };
    group.userData.audioState = audioState;

    // ── Waveform render loop ──
    const aNode = analyserNode as AnalyserNode | null;
    const freqData = new Uint8Array(aNode ? aNode.frequencyBinCount : 128);
    let rafHandle: number | null = null;
    let isTicking = false;

    const drawFrame = () => {
      const w = canvasW, h = canvasH;
      // Background
      ctx.fillStyle = '#0a0e17';
      ctx.fillRect(0, 0, w, h);

      // Subtle top/bottom gradient
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(99,102,241,0.06)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(168,85,247,0.04)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const centerY = h * 0.45;
      const barMaxH = h * 0.35;

      if (staticWaveform) {
        // Draw static waveform as filled area
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let i = 0; i < staticWaveform.length; i++) {
          const x = (i / staticWaveform.length) * w;
          const barH = staticWaveform[i] * barMaxH;
          ctx.lineTo(x, centerY - barH);
        }
        ctx.lineTo(w, centerY);
        for (let i = staticWaveform.length - 1; i >= 0; i--) {
          const x = (i / staticWaveform.length) * w;
          const barH = staticWaveform[i] * barMaxH;
          ctx.lineTo(x, centerY + barH);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(99,102,241,0.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(129,140,248,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Real-time frequency bars overlay
      if (analyserNode && audioState.playing) {
        analyserNode.getByteFrequencyData(freqData);
        const barCount = 64;
        const barW = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * freqData.length);
          const val = freqData[idx] / 255;
          const barH = val * barMaxH * 0.8;
          ctx.fillStyle = `rgba(129,140,248,${0.3 + val * 0.5})`;
          ctx.fillRect(i * barW, centerY - barH, barW - 1, barH * 2);
        }
      }

      // Playback head line
      if (audioState.duration > 0) {
        const pct = Math.max(0, Math.min(1, audioState.currentTime / audioState.duration));
        const headX = pct * w;
        ctx.strokeStyle = '#f0abfc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(headX, 4);
        ctx.lineTo(headX, h - 4);
        ctx.stroke();
        // Small triangle at top
        ctx.fillStyle = '#f0abfc';
        ctx.beginPath();
        ctx.moveTo(headX - 4, 2);
        ctx.lineTo(headX + 4, 2);
        ctx.lineTo(headX, 8);
        ctx.closePath();
        ctx.fill();
      }

      // Filename
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const displayName = name.length > 30 ? name.slice(0, 28) + '…' : name;
      ctx.fillText(displayName, 10, 6);

      // Time display
      const elapsed = audioState.currentTime;
      const total = audioState.duration;
      const fmt = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
      };
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${fmt(elapsed)} / ${fmt(total)}`, w - 10, h - 20);

      // Play state indicator
      ctx.textAlign = 'left';
      ctx.fillStyle = audioState.playing ? 'rgba(129,140,248,0.9)' : 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(audioState.playing ? '▶' : '■', 10, h - 20);

      // Loop indicator
      ctx.fillStyle = audioState.loop ? 'rgba(168,85,247,0.8)' : 'rgba(255,255,255,0.3)';
      ctx.fillText(audioState.loop ? '↻' : '⊘', 30, h - 20);

      canvasTexture.needsUpdate = true;
      if (audioState.playing) {
        rafHandle = requestAnimationFrame(drawFrame);
        isTicking = true;
      } else {
        isTicking = false;
        rafHandle = null;
      }
    };

    const requestFrameUpdate = () => {
      if (!isTicking) {
        drawFrame();
      }
    };

    // Initial frame draw
    drawFrame();
    this.audioTickCallbacks.set(id, requestFrameUpdate);

    // ── Audio element event listeners ──
    audio.addEventListener('loadedmetadata', () => {
      audioState.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      requestFrameUpdate();
    });
    audio.addEventListener('timeupdate', () => {
      audioState.currentTime = audio.currentTime;
      requestFrameUpdate();
    });
    audio.addEventListener('play', () => {
      audioState.playing = true;
      if (!isTicking) {
        rafHandle = requestAnimationFrame(drawFrame);
        isTicking = true;
      }
      for (const cb of this.onAudioPlaybackChangedCallbacks) cb(id);
    });
    audio.addEventListener('pause', () => {
      audioState.playing = false;
      requestFrameUpdate();
      for (const cb of this.onAudioPlaybackChangedCallbacks) cb(id);
    });
    audio.addEventListener('volumechange', () => {
      audioState.muted = audio.muted;
      requestFrameUpdate();
      for (const cb of this.onAudioPlaybackChangedCallbacks) cb(id);
    });
    audio.addEventListener('ended', () => {
      audioState.playing = false;
      requestFrameUpdate();
      for (const cb of this.onAudioPlaybackChangedCallbacks) cb(id);
    });

    // Cleanup handler
    group.userData.dispose = () => {
      try { audio.pause(); } catch { /* noop */ }
      audio.removeAttribute('src');
      audio.load();
      if (rafHandle) cancelAnimationFrame(rafHandle);
      try { audioCtx?.close(); } catch { /* noop */ }
      if (canvasTexture) canvasTexture.dispose();
    };

    return {
      id,
      name,
      type: 'audio',
      object3d: group,
      fileData: undefined,
      isCollidable: true,
      audioElement: audio,
      url: typeof source === 'string' ? source : audio.src,
    };
  }

  public async spawnAudio(
    source: string | File | Blob | ArrayBuffer,
    name: string,
    position = new THREE.Vector3(0, 1.5, 0),
    config?: Partial<ImportConfig>,
    customId?: string
  ): Promise<LoadedAsset | null> {
    const id = customId ?? `audio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const inFlight = this.inProgressImports.get(id);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const asset = await this.loadAudio(id, name, source, position, config);
      if (asset) {
        this.worldRoot.add(asset.object3d);
        this.assets.set(asset.id, asset);
        for (const cb of this.onAssetAddedCallbacks) cb(asset);
      }
      return asset;
    })();
    this.inProgressImports.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inProgressImports.delete(id);
    }
  }

  public async spawnVideo(
    source: string | File | Blob | ArrayBuffer,
    name: string,
    position = new THREE.Vector3(0, 1.5, 0),
    config?: Partial<ImportConfig>,
    customId?: string
  ): Promise<LoadedAsset | null> {
    const id = customId ?? `video-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const inFlight = this.inProgressImports.get(id);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const asset = await this.loadVideo(id, name, source, position, config);
      if (asset) {
        this.worldRoot.add(asset.object3d);
        this.assets.set(asset.id, asset);
        for (const cb of this.onAssetAddedCallbacks) cb(asset);
      }
      return asset;
    })();
    this.inProgressImports.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inProgressImports.delete(id);
    }
  }

  /**
   * Decide whether the source video should be downsampled via
   * `<video>` → offscreen `<canvas>` → THREE.CanvasTexture (vs the
   * raw THREE.VideoTexture path), AND at what resolution. The
   * `{downscale, width, height}` shape lets the caller set the
   * canvas dimensions immediately without a second heuristic call.
   *
   * Two-tier decision tree:
   *  1. Device tier (Quest-low / mobile) ALWAYS downscales,
   *     regardless of MediaCapabilities. The Quest's Adreno 650/740
   *     correctly reports HEVC/H.264 as powerEfficient (HW decode IS
   *     power-efficient relative to CPU SW decode), so relying on
   *     that flag alone misses the real VRAM cost: a 4K source
   *     uploads an ~8 MB RGBA frame every rVFC tick regardless of
   *     whether the *decode* is HW or SW. Capping the texture at
   *     the tier's resolution bounds VRAM at exactly
   *     (width × height × 4) bytes per imported video.
   *  2. Desktop trusts the codec probe. The probe catches codecs
   *     the browser can SW-decode (where HW decode isn't
   *     available) and pure SW-fallback codecs (where VRAM is
   *     irrelevant — the bottleneck is CPU).
   *
   * Best-effort: when MediaCapabilities is missing OR returns an
   * error, defer to the HW-decode path (downscale: false). A
   * missing API never breaks playback; the user just gets a
   * (potentially over-budget) native frame rate.
   */
  private shouldDownscaleVideoForVRAM(_video: HTMLVideoElement, _name: string): { downscale: boolean; width: number; height: number } {
    const tier = classifyDevice();
    const cap = getMaxCanvasResolution(tier);
    if (shouldAlwaysDownscaleVideo(tier)) {
      return { downscale: true, width: cap.width, height: cap.height };
    }
    return { downscale: false, width: 0, height: 0 };
  }

  /**
   * Read the live playback state for a video asset. Returns null when
   * the asset isn't a video or has been removed. Callers (React
   * components, VR HUD drawers) read this on every render to mirror
   * the playback engine's state in their UI. Reads are O(1) — the
   * state object is stored on userData with a stable reference, so
   * a property flip is immediately visible to subscribers.
   */
  public getVideoState(assetId: string): VideoPlaybackState | null {
    const asset = this.assets.get(assetId);
    if (!asset || asset.type !== 'video') return null;
    return (asset.object3d.userData as { videoState?: VideoPlaybackState }).videoState ?? null;
  }

  public getAudioState(assetId: string): AudioPlaybackState | null {
    const asset = this.assets.get(assetId);
    if (!asset || asset.type !== 'audio') return null;
    return (asset.object3d.userData as { audioState?: AudioPlaybackState }).audioState ?? null;
  }

  /** Retrieve a loaded asset by its id */
  public getAsset(assetId: string): LoadedAsset | undefined {
    return this.assets.get(assetId);
  }

  /**
   * Phase 3A: hook up an externally-managed HTMLVideoElement (the one
   * the receiver-side VideoStreamingService demuxer/MSE pipeline owns)
   * into a fresh LoadedAsset. The element is ALREADY pointing at a
   * blob: URL backed by a MediaSource, so we just wrap it as the
   * source for a new VideoTexture (with the same MediaCapabilities-
   * driven VRAM cap as the regular import path) and add it to the
   * scene.
   */
  public async loadVideoFromStreamedSource(
    id: string,
    name: string,
    videoElement: HTMLVideoElement,
    pos: THREE.Vector3,
    config?: Partial<ImportConfig>
  ): Promise<LoadedAsset> {
    videoElement.loop = config?.videoLoop ?? true;
    videoElement.muted = true;
    videoElement.volume = 0.8;
    // Same first-frame preload hints as the local-blob loadVideo path.
    // The element here is already a MediaSource-backed <video> from
    // VideoStreamingService.attachReceiver/attachLocalReceiver, but it
    // still benefits from explicit preload + playsInline so the canvas
    // downscale's first drawImage call has frame data available. Without
    // `preload="auto"` some browsers wait until `play()` is called
    // before populating the first decoded frame, which on Quest adds
    // 1-3 s to the first-visible-frame window for a 300 MB media.
    videoElement.preload = 'auto';
    videoElement.playsInline = true;

    

    const downscalePlan = this.shouldDownscaleVideoForVRAM(videoElement, name);
    let texture: THREE.VideoTexture | THREE.CanvasTexture;
    let rVfcHandle: number | null = null;
    let canvasEl: HTMLCanvasElement | null = null;
    if (downscalePlan.downscale) {
      canvasEl = document.createElement('canvas');
      const ctx = canvasEl.getContext('2d');
      if (ctx) {
        canvasEl.width = downscalePlan.width;
        canvasEl.height = downscalePlan.height;
        texture = new THREE.CanvasTexture(canvasEl);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
      } else {
        texture = new THREE.VideoTexture(videoElement);
        texture.colorSpace = THREE.SRGBColorSpace;
      }
    } else {
      texture = new THREE.VideoTexture(videoElement);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
    }

    let width = 3.0, height = 1.6875;
    if (config?.videoAspectRatio === '9:16') { width = 1.6875; height = 3.0; }
    else if (config?.videoAspectRatio === '1:1') { width = 2.2; height = 2.2; }
    const group = new THREE.Group();
    group.position.copy(pos);
    const frameGeo = new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.08);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#07090e', roughness: 0.2, metalness: 0.8 });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    group.add(frameMesh);
    const screenGeo = new THREE.PlaneGeometry(width, height);
    const screenMat = new THREE.MeshBasicMaterial({ map: texture });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = 0.042;
    screenMesh.scale.y = -1; // Flip video — Three.js reads raw unrotated frames

    group.add(screenMesh);
    const videoState: VideoPlaybackState = {
      playing: false, currentTime: 0, duration: 0,
      globalVolume: 0.8, localVolume: 0.8, volumeMode: 'local', muted: true,
      syncMode: config?.videoSyncMode ?? 'persistent',
    };
    group.userData.videoState = videoState;
    group.userData.videoAspectRatio = config?.videoAspectRatio || 'auto';
    const updateGeometryAspect = () => {
      const aspectMode = config?.videoAspectRatio || group.userData.videoAspectRatio || 'auto';
      if (
        aspectMode === 'auto' &&
        Number.isFinite(videoElement.videoWidth) && videoElement.videoWidth > 0 &&
        Number.isFinite(videoElement.videoHeight) && videoElement.videoHeight > 0
      ) {
        const aspect = videoElement.videoWidth / videoElement.videoHeight;
        const newHeight = height;
        const newWidth = newHeight * aspect;
        frameMesh.geometry.dispose();
        frameMesh.geometry = new THREE.BoxGeometry(newWidth + 0.1, newHeight + 0.1, 0.08);
        screenMesh.geometry.dispose();
        screenMesh.geometry = new THREE.PlaneGeometry(newWidth, newHeight);
      }
    };

    let lastVideoWidth = -1;
    let lastVideoHeight = -1;
    const ensureValidTexture = () => {
      if (
        (videoElement.videoWidth !== lastVideoWidth || videoElement.videoHeight !== lastVideoHeight) &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
      ) {
        lastVideoWidth = videoElement.videoWidth;
        lastVideoHeight = videoElement.videoHeight;
        if (screenMesh.material.map) {
          screenMesh.material.map.dispose();
        }
        let newTex: THREE.VideoTexture | THREE.CanvasTexture;
        if (downscalePlan.downscale && canvasEl) {
          canvasEl.width = downscalePlan.width;
          canvasEl.height = downscalePlan.height;
          newTex = new THREE.CanvasTexture(canvasEl);
          newTex.colorSpace = THREE.SRGBColorSpace;
          newTex.minFilter = THREE.LinearFilter;
          newTex.magFilter = THREE.LinearFilter;
          newTex.generateMipmaps = false;
        } else {
          newTex = new THREE.VideoTexture(videoElement);
          newTex.colorSpace = THREE.SRGBColorSpace;
          newTex.minFilter = THREE.LinearFilter;
          newTex.magFilter = THREE.LinearFilter;
          newTex.generateMipmaps = false;
        }
        texture = newTex;
        screenMesh.material.map = newTex;
        screenMesh.material.needsUpdate = true;
        updateGeometryAspect();
      }
    };

    const drawLoop = () => {
      ensureValidTexture();
      if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        if (downscalePlan.downscale && canvasEl) {
          const ctx = canvasEl.getContext('2d');
          if (ctx) {
            const vw = videoElement.videoWidth, vh = videoElement.videoHeight;
            const canvasAspect = canvasEl.width / canvasEl.height;
            const videoAspect = vw / vh;
            let dw: number, dh: number;
            if (videoAspect > canvasAspect) { dw = canvasEl.width; dh = Math.round(canvasEl.width / videoAspect); }
            else { dh = canvasEl.height; dw = Math.round(canvasEl.height * videoAspect); }
            try { ctx.drawImage(videoElement, 0, 0, dw, dh); } catch { /* noop */ }
          }
        }
        texture.needsUpdate = true;
      }
      rVfcHandle = requestAnimationFrame(drawLoop);
    };
    rVfcHandle = requestAnimationFrame(drawLoop);
    this.videoTickCallbacks.set(id, drawLoop);

    videoElement.addEventListener('loadedmetadata', () => {
      videoState.duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
      ensureValidTexture();
    });
    videoElement.addEventListener('timeupdate', () => { videoState.currentTime = videoElement.currentTime; });
    videoElement.addEventListener('play', () => { videoState.playing = true; });
    videoElement.addEventListener('pause', () => { videoState.playing = false; });
    videoElement.addEventListener('volumechange', () => { videoState.muted = videoElement.muted; });
    videoElement.addEventListener('ended', () => {
      videoState.playing = false;
      for (const cb of this.onVideoPlaybackChangedCallbacks) cb(id);
    });
    group.userData.dispose = () => {
      try { videoElement.pause(); } catch { /* noop */ }
      // rVfcHandle holds whichever scheduling primitive the browser
      // supports — an rVFC id (preferred) on rVFC-capable browsers, or
      // an rAF id otherwise. Try BOTH cancels; each is a safe no-op
      // when applied to the wrong handle kind on compliant browsers.
      // Without the rAF branch, browsers without `requestVideoFrameCallback`
      // leak the loop after removeAsset.
      if (typeof rVfcHandle === 'number') {
        try { (videoElement as unknown as { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback?.(rVfcHandle); } catch { /* noop */ }
        try { cancelAnimationFrame(rVfcHandle); } catch { /* noop */ }
      }
      if (texture && (texture as THREE.Texture).dispose) (texture as THREE.Texture).dispose();
    };
    this.worldRoot.add(group);
    const asset: LoadedAsset = { id, name, type: 'video', object3d: group, fileData: undefined, isCollidable: true, videoElement };
    this.assets.set(id, asset);
    const pendingStream = this.pendingLiveStreams.get(id);
    if (pendingStream) {
      this.pendingLiveStreams.delete(id);
      console.log('[AssetManager] Attaching buffered live WebRTC MediaStream to newly loaded streamed video:', id);
      videoElement.srcObject = pendingStream;
      videoElement.play().catch(() => {});
    }
    for (const cb of this.onAssetAddedCallbacks) cb(asset);
    return asset;
  }

  /**
   * Apply a partial playback-state mutation. Drives the
   * HTMLVideoElement directly (so the playback engine sees the
   * change) AND updates the userData mirror (so the UI sees the
   * change). Element trigger fires propagate back via the
   * `play`/`pause`/`volumechange` event listeners above — we
   * intentionally skip re-stamping `playing` / `muted` here so the
   * element event is the single source of truth for those flags.
   *
   * Returns true on successful apply, false if the asset isn't a
   * video / isn't loaded / has no element. Callers can use the
   * boolean to decide whether to broadcast.
  /**
   * Watch Party Live Stream mode: attaches a live WebRTC MediaStream
   * directly to a video asset's HTMLVideoElement for instant real-time playback.
   */
  public attachLiveStreamToVideo(assetId: string, stream: MediaStream): boolean {
    const asset = this.assets.get(assetId);
    if (!asset || !asset.videoElement) {
      console.log('[AssetManager] Video asset not ready yet, buffering pending live WebRTC MediaStream for:', assetId);
      this.pendingLiveStreams.set(assetId, stream);
      return true;
    }
    console.log('[AssetManager] Attaching live WebRTC MediaStream immediately to asset:', assetId);
    const ve = asset.videoElement;
    ve.srcObject = stream;
    ve.muted = true;
    ve.playsInline = true;
    const attemptPlay = () => {
      ve.play().catch(() => {});
    };
    attemptPlay();
    ve.addEventListener('loadedmetadata', attemptPlay, { once: true });
    ve.addEventListener('canplay', attemptPlay, { once: true });
    return true;
  }

  public applyVideoState(assetId: string, partial: Partial<VideoPlaybackState>): boolean {
    const asset = this.assets.get(assetId);
    if (!asset || !asset.videoElement) return false;
    const v = asset.videoElement;
    const state = (asset.object3d.userData as { videoState?: VideoPlaybackState }).videoState;
    if (!state) return false;
    let changed = false;

    if (partial.playing !== undefined && partial.playing !== state.playing) {
      if (partial.playing) {
        // play() returns a Promise — fire-and-forget; the success /
        // failure path emits `play` / `pause` events that update
        // userData.mirror. The catch RE-STAMPS state.playing to false
        // because some browser failure modes (notably autoplay-policy
        // rejection when audio is unmutable cross-origin) keep the
        // element paused AND skip the 'pause' event, so the eager
        // stamp above would lie indefinitely without this fallback.
        v.play().catch(() => { state.playing = false; });
      } else {
        v.pause();
      }
      // CRITICAL: eagerly stamp `state.playing` to match the click
      // synchronously, BEFORE the asynchronous `play`/`pause`
      // listener fires. Otherwise handleVideoAction's
      // setSelectedAsset({...sel}) re-renders the React tree while
      // `userData.videoState.playing` is still on the OLD value
      // (the element event hasn't propagated yet). React then re-reads
      // state.playing=false and keeps the Play icon in place. The
      // eventual event-listener mutation would update the mirror,
      // but with no React setState firing after it, the UI stays
      // stuck on "Play" even though the video is running.
      //
      // This eager stamp intentionally DIVERGES from the deliberate
      // "element event is the source of truth" comment that USED to
      // live here — that contract held when the only consumer of
      // state.playing was the rAF loop inside VideoControls (which
      // reads stateRef every animation frame, so a 1-frame delay was
      // invisible). Now there's an additional React render consumer
      // that reads state synchronously at render-commit time, so
      // pretending the event is authoritative for that path is a lie.
      // The element event will fire moments later and re-stamp the
      // same value; idempotent.
      state.playing = partial.playing;
      changed = true;
    }
    if (
      partial.currentTime !== undefined &&
      state.duration > 0 &&
      Math.abs(partial.currentTime - state.currentTime) > 0.25
    ) {
      // Clamp into [0, duration-0.05] so seeking to exactly the end
      // doesn't double-fire `ended` + the next play attempt. The
      // 0.25-second guard prevents redundant broadcasts from
      // scrubbing-driven micro-updates; the UI syncs back via
      // timeupdate events regardless.
      v.currentTime = Math.max(0, Math.min(state.duration - 0.05, partial.currentTime));
      changed = true;
    }
    if (partial.globalVolume !== undefined && partial.globalVolume !== state.globalVolume) {
      state.globalVolume = Math.max(0, Math.min(1, partial.globalVolume));
      if (state.muted) {
        state.muted = false;
        v.muted = false;
      }
      if (state.volumeMode === 'global') {
        v.volume = state.globalVolume;
      }
      changed = true;
    }
    if (partial.localVolume !== undefined && partial.localVolume !== state.localVolume) {
      state.localVolume = Math.max(0, Math.min(1, partial.localVolume));
      if (state.muted) {
        state.muted = false;
        v.muted = false;
      }
      if (state.volumeMode === 'local') {
        v.volume = state.localVolume;
      }
      changed = true;
    }
    if (partial.volumeMode !== undefined && partial.volumeMode !== state.volumeMode) {
      state.volumeMode = partial.volumeMode;
      // Re-apply whichever volume is now active. Mute override
      // preserved: muted=true forces volume=0 regardless of slider.
      v.volume = state.muted ? 0 : state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
      changed = true;
    }
    if (partial.muted !== undefined && partial.muted !== state.muted) {
      v.muted = partial.muted;
      // Element volumechange event will reflect v.muted ↔ state.muted;
      // we set the derived volume here so the next read is consistent
      // even if the event hasn't fired yet (event loop ordering).
      v.volume = partial.muted ? 0 : state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
      state.muted = partial.muted;
      changed = true;
    }
    if (partial.syncMode !== undefined && partial.syncMode !== state.syncMode) {
      state.syncMode = partial.syncMode;
      if (asset.metadata) asset.metadata.videoSyncMode = partial.syncMode;
      changed = true;
    }
    if (partial.flipped !== undefined) {
      // Synced Y-orientation of the screen mesh; captions mirror it so
      // they stay glued to the picture.
      //
      // IMPORTANT: compare against the MESH, not `state.flipped`.
      // Callers that pre-merge a network payload into userData.videoState
      // (e.g. App.tsx finishIfDone) write partial.flipped into state
      // BEFORE invoking this handler — a state-based comparison would
      // then always see "already applied", skip the transform, and leave
      // remote/rejoining clients stuck on the default orientation while
      // the original importer sees their manual flip.
      const desired = partial.flipped ? -1 : 1;
      state.flipped = partial.flipped;
      const screenMesh = asset.object3d.children.find(
        (c): c is THREE.Mesh =>
          c.type === 'Mesh' &&
          c.name !== 'SubtitleOverlay' &&
          ((c as THREE.Mesh).geometry as THREE.BufferGeometry)?.type === 'PlaneGeometry'
      );
      if (screenMesh && screenMesh.scale.y !== desired) {
        screenMesh.scale.y = desired;
        changed = true;
      }
      // Captions mirror the screen's orientation so they stay glued to
      // the picture (matching the old baked-in-canvas behavior).
      const overlay = asset.object3d.children.find((c) => c.name === 'SubtitleOverlay');
      if (overlay && overlay.scale.y !== desired) {
        overlay.scale.y = desired;
        changed = true;
      }
    }
    if (partial.subtitlesEnabled !== undefined) {
      state.subtitlesEnabled = partial.subtitlesEnabled;
      if (state.subtitlesEnabled && ((asset.subtitleCues && asset.subtitleCues.length > 0) || state.subtitlesData)) {
        this.enableSubtitleCanvasForVideo(assetId);
      }
      changed = true;
    }
    if (partial.subtitlesData !== undefined) {
      state.subtitlesData = partial.subtitlesData;
      const cues = parseSubtitles(partial.subtitlesData);
      asset.subtitleCues = cues;
      asset.subtitlesData = partial.subtitlesData;
      asset.object3d.userData.subtitleCues = cues;
      state.subtitlesEnabled = cues.length > 0;
      if (cues.length > 0) {
        this.enableSubtitleCanvasForVideo(assetId);
      }
      changed = true;
    }
    if (changed) {
      for (const cb of this.onVideoPlaybackChangedCallbacks) cb(assetId);
    }
    return changed;
  }

  public applyAudioState(assetId: string, partial: Partial<AudioPlaybackState>): boolean {
    const asset = this.assets.get(assetId);
    if (!asset || !asset.audioElement) return false;
    const a = asset.audioElement;
    const state = (asset.object3d.userData as { audioState?: AudioPlaybackState }).audioState;
    if (!state) return false;
    let changed = false;

    if (partial.playing !== undefined && partial.playing !== state.playing) {
      if (partial.playing) {
        a.play().catch(() => { state.playing = false; });
      } else {
        a.pause();
      }
      state.playing = partial.playing;
      changed = true;
    }
    if (
      partial.currentTime !== undefined &&
      state.duration > 0 &&
      Math.abs(partial.currentTime - state.currentTime) > 0.25
    ) {
      a.currentTime = Math.max(0, Math.min(state.duration - 0.05, partial.currentTime));
      changed = true;
    }
    if (partial.globalVolume !== undefined && partial.globalVolume !== state.globalVolume) {
      state.globalVolume = Math.max(0, Math.min(1, partial.globalVolume));
      if (state.muted) {
        state.muted = false;
        a.muted = false;
      }
      if (state.volumeMode === 'global') {
        a.volume = state.globalVolume;
      }
      changed = true;
    }
    if (partial.localVolume !== undefined && partial.localVolume !== state.localVolume) {
      state.localVolume = Math.max(0, Math.min(1, partial.localVolume));
      if (state.muted) {
        state.muted = false;
        a.muted = false;
      }
      if (state.volumeMode === 'local') {
        a.volume = state.localVolume;
      }
      changed = true;
    }
    if (partial.volumeMode !== undefined && partial.volumeMode !== state.volumeMode) {
      state.volumeMode = partial.volumeMode;
      a.volume = state.muted ? 0 : state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
      changed = true;
    }
    if (partial.muted !== undefined && partial.muted !== state.muted) {
      a.muted = partial.muted;
      a.volume = partial.muted ? 0 : state.volumeMode === 'global' ? state.globalVolume : state.localVolume;
      state.muted = partial.muted;
      changed = true;
    }
    if (partial.loop !== undefined && partial.loop !== state.loop) {
      a.loop = partial.loop;
      state.loop = partial.loop;
      changed = true;
    }
    if (partial.playbackRate !== undefined && partial.playbackRate !== state.playbackRate) {
      a.playbackRate = Math.max(0.5, Math.min(2.0, partial.playbackRate));
      state.playbackRate = a.playbackRate;
      changed = true;
    }
    if (changed) {
      for (const cb of this.onAudioPlaybackChangedCallbacks) cb(assetId);
    }
    return changed;
  }

  private renderSubtitleToCanvas(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cue: SubtitleCue
  ): void {
    ctx.save();
    // 2D Canvas is drawn in standard orientation; 3D screenMesh.scale.y = -1 handles the frame flip cleanly.
    const fontSize = Math.max(18, Math.round(height * 0.048 * this.subtitleSettings.fontScale));
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Auto-wrap lines to fit within 86% of the video canvas width (leaves 7% margin on left and right)
    const maxLineWidth = width * 0.86;

    // PERF: the wrap layout is identical for every frame a given cue is
    // on screen, but `measureText` is one of the most expensive 2D-canvas
    // calls — re-running the word-wrap loop at 60 fps for each subtitled
    // video was costing multiple milliseconds per frame per video and
    // visibly tanking the render FPS. Cache the wrapped lines ON the cue
    // object; invalidated whenever font size or wrap width changes.
    let wrappedLines = cue._wrappedLines;
    if (!wrappedLines || cue._wrappedWidth !== maxLineWidth || cue._wrapFontPx !== fontSize) {
      wrappedLines = [];
      const rawLines = cue.text.split('\n');

      for (const rawLine of rawLines) {
        const words = rawLine.trim().split(/\s+/);
        if (words.length === 0 || !words[0]) continue;

        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const testLine = `${currentLine} ${word}`;
          if (ctx.measureText(testLine).width <= maxLineWidth) {
            currentLine = testLine;
          } else {
            wrappedLines.push(currentLine);
            currentLine = word;
          }
        }
        wrappedLines.push(currentLine);
      }

      cue._wrappedLines = wrappedLines;
      cue._wrappedWidth = maxLineWidth;
      cue._wrapFontPx = fontSize;
    }

    if (wrappedLines.length === 0) {
      ctx.restore();
      return;
    }

    const lineHeight = fontSize * 1.28;
    const totalHeight = wrappedLines.length * lineHeight;
    const paddingX = fontSize * 0.6;
    const paddingY = fontSize * 0.3;
    const bottomMargin = Math.max(20, Math.round(height * 0.07));

    const y = height - bottomMargin - totalHeight + lineHeight;

    wrappedLines.forEach((lineText, idx) => {
      const lineY = y + idx * lineHeight;
      const metrics = ctx.measureText(lineText);
      const textWidth = metrics.width;

      if (this.subtitleSettings.styleMode === 'background') {
        const bgWidth = textWidth + paddingX * 2;
        const bgHeight = lineHeight + paddingY;
        const bgX = (width - bgWidth) / 2;
        const bgY = lineY - fontSize - paddingY / 2;
        ctx.fillStyle = this.subtitleSettings.bgColor || '#000000';
        ctx.globalAlpha = this.subtitleSettings.bgOpacity ?? 0.84;
        ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
        ctx.globalAlpha = 1.0;
      } else {
        const strokeWidth = this.subtitleSettings.outlineThickness === 'thick' ? 6 : this.subtitleSettings.outlineThickness === 'thin' ? 2 : 4;
        ctx.strokeStyle = this.subtitleSettings.outlineColor || '#000000';
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(lineText, width / 2, lineY);
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillText(lineText, width / 2, lineY);
    });

    ctx.restore();
  }

  /**
   * Create (or return the existing) transparent caption overlay plane
   * for a video asset and register its cheap cue-change tick. The
   * overlay canvas only redraws when the active cue or the enabled
   * flag changes — orders of magnitude cheaper than the old approach
   * of compositing captions into the video frame every rAF.
   */
  private attachSubtitleOverlay(
    id: string,
    group: THREE.Group,
    video: HTMLVideoElement,
    planeW: number,
    planeH: number
  ): THREE.Mesh {
    const existing = group.children.find((c) => c.name === 'SubtitleOverlay');
    if (existing) return existing as THREE.Mesh;

    const canvasEl = document.createElement('canvas');
    const overlayW = Math.max(256, Math.round(planeW * 340)); // ~340 px per world unit, plenty for text
    const aspect = planeH / planeW;
    canvasEl.width = overlayW;
    canvasEl.height = Math.max(64, Math.round(overlayW * aspect));
    const ctx = canvasEl.getContext('2d');

    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material);
    overlay.name = 'SubtitleOverlay';
    // Just in front of the screen mesh (z=0.042). The y-flip must MATCH
    // the screen mesh's CURRENT orientation (scale.y=-1 is this app's
    // default "flipped" convention for video content). Mirroring the live
    // screen scale — instead of hardcoding -1 — keeps captions upright
    // when subtitles are attached to a video that was already unflipped
    // (scale.y=1). The old hardcode rendered captions upside down on any
    // such video: the importer after a manual unflip, and every remote
    // user who received subtitlesData via vidstate while their synced
    // screen sat at scale.y=1. Later flips are handled together by
    // applyVideoState, so only the initial value matters here.
    overlay.position.z = 0.047;
    const screenProbe = group.children.find(
      (c): c is THREE.Mesh =>
        c.type === 'Mesh' &&
        c.name !== 'SubtitleOverlay' &&
        ((c as THREE.Mesh).geometry as THREE.BufferGeometry)?.type === 'PlaneGeometry'
    );
    overlay.scale.y = screenProbe ? screenProbe.scale.y : -1;
    overlay.renderOrder = 1;
    group.add(overlay);

    let lastDrawnCue: SubtitleCue | null | undefined = undefined;
    let lastEnabled: boolean | undefined = undefined;
    let lastCueIdx = 0;

    const findCue = (cues: SubtitleCue[], curTime: number): SubtitleCue | null => {
      if (cues.length === 0) return null;
      // Fast path: check current cached index
      const safeIdx = Math.max(0, Math.min(lastCueIdx, cues.length - 1));
      const current = cues[safeIdx];
      if (current.start <= curTime && curTime <= current.end) {
        return current;
      }
      // Fast path: check next sequential index (most common in playback)
      if (safeIdx + 1 < cues.length) {
        const next = cues[safeIdx + 1];
        if (next.start <= curTime && curTime <= next.end) {
          lastCueIdx = safeIdx + 1;
          return next;
        }
      }
      // Binary search fallback for seeks / jumps
      let low = 0;
      let high = cues.length - 1;
      let bestIdx = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const c = cues[mid];
        if (c.start <= curTime && curTime <= c.end) {
          lastCueIdx = mid;
          return c;
        } else if (c.start > curTime) {
          high = mid - 1;
        } else {
          bestIdx = mid;
          low = mid + 1;
        }
      }
      if (bestIdx >= 0 && cues[bestIdx].start <= curTime && curTime <= cues[bestIdx].end) {
        lastCueIdx = bestIdx;
        return cues[bestIdx];
      }
      return null;
    };

    // CHAIN, don't replace: videoTickCallbacks is keyed by asset id and
    // already holds the video-texture update tick at attach time.
    // Overwriting it used to stop texture updates entirely -> black
    // screen on every subtitled import.
    const prevTick = this.videoTickCallbacks.get(id);
    this.videoTickCallbacks.set(id, () => {
      prevTick?.();
      if (!ctx || video.readyState < 1) return;
      const vs = group.userData.videoState as VideoPlaybackState | undefined;
      const cues = (group.userData.subtitleCues || []) as SubtitleCue[];
      const enabled = vs ? vs.subtitlesEnabled !== false : true;
      let activeCue: SubtitleCue | null = null;
      if (enabled && cues.length > 0) {
        const curTime = video.currentTime;
        activeCue = findCue(cues, curTime);
      }
      if (activeCue === lastDrawnCue && enabled === lastEnabled && lastDrawnCue !== undefined) return;

      if (!enabled || !activeCue) {
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        texture.needsUpdate = true;
        lastDrawnCue = activeCue;
        lastEnabled = enabled;
        return;
      }
      try {
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        this.renderSubtitleToCanvas(ctx, canvasEl.width, canvasEl.height, activeCue);
        texture.needsUpdate = true;
      } catch {
        /* ignore */
      }
      lastDrawnCue = activeCue;
      lastEnabled = enabled;
    });

    return overlay;
  }

  public enableSubtitleCanvasForVideo(assetId: string): void {
    const asset = this.assets.get(assetId);
    if (!asset || asset.type !== 'video' || !asset.videoElement) return;
    // Video assets are always built as a Group wrapper around the screen
    // plane, so this cast is safe and lets us reuse attachSubtitleOverlay.
    const group = asset.object3d as THREE.Group;

    // Already has an overlay (imported with subtitles): the tick handles
    // visibility/cue changes on its own.
    if (group.children.some((c) => c.name === 'SubtitleOverlay')) return;

    // Find the first Mesh child with a PlaneGeometry that isn't the overlay
    // itself. (Object3D has no Array.prototype.find — traverse manually.)
    let screenHit: THREE.Object3D | null = null;
    group.traverse((c) => {
      if (screenHit) return;
      if (
        c.type === 'Mesh' &&
        c.name !== 'SubtitleOverlay' &&
        ((c as THREE.Mesh).geometry as THREE.BufferGeometry)?.type === 'PlaneGeometry'
      ) {
        screenHit = c;
      }
    });
    // Alias defeats TS's closure-blind narrowing (it can't see assignments
    // made inside the traverse callback).
    const screenMesh = screenHit ? (screenHit as THREE.Mesh) : null;
    if (!screenMesh) return;

    const params = (screenMesh.geometry as THREE.PlaneGeometry).parameters;
    this.attachSubtitleOverlay(assetId, group, asset.videoElement, params?.width ?? 3, params?.height ?? 1.6875);
  }


  private createMiscFileObject(id: string, name: string, buffer: ArrayBuffer, mimeType: string, size: number, pos: THREE.Vector3): LoadedAsset {
    const group = new THREE.Group();
    group.position.copy(pos);

    // Draw a generic document icon with the filename + size + extension
    // baked into a CanvasTexture. Portrait aspect so it reads as a
    // "document / sheet of paper" rather than a landscape image. 512x640
    // is high enough that the filename text stays readable when the user
    // dollies the camera close; anything bigger burns VRAM on the Quest
    // for text that's already capped at the ~22px font below.
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 640;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Outer card background (slate-800 with a slate-600 frame).
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(16, 16, canvas.width - 32, canvas.height - 32);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

      // Document silhouette: rectangle with a folded top-right corner.
      // Sized to leave headroom for the filename + size + extension
      // below; the icon occupies the top ~55% of the card.
      const iconX = canvas.width / 2 - 80;
      const iconY = 90;
      const iconW = 160;
      const iconH = 200;
      const foldSize = 28;

      // Document body (trapezoid-with-notch effect via the fold path).
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(iconX, iconY);
      ctx.lineTo(iconX + iconW - foldSize, iconY);
      ctx.lineTo(iconX + iconW, iconY + foldSize);
      ctx.lineTo(iconX + iconW, iconY + iconH);
      ctx.lineTo(iconX, iconY + iconH);
      ctx.closePath();
      ctx.fill();

      // Folded corner — slightly darker so it reads as a separate plane.
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(iconX + iconW - foldSize, iconY);
      ctx.lineTo(iconX + iconW - foldSize, iconY + foldSize);
      ctx.lineTo(iconX + iconW, iconY + foldSize);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(iconX + iconW - foldSize, iconY);
      ctx.lineTo(iconX + iconW - foldSize, iconY + foldSize);
      ctx.lineTo(iconX + iconW, iconY + foldSize);
      ctx.stroke();

      // Filename — truncate the middle (not the end) so the
      // extension stays visible. The full string is still available
      // via the radial context menu / inventory, so truncation is
      // purely a visual readability choice.
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxLen = 24;
      let displayName: string;
      if (name.length > maxLen) {
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
        const stem = name.slice(0, name.length - ext.length);
        const keep = Math.max(4, maxLen - ext.length - 1);
        displayName = stem.slice(0, keep) + '…' + ext;
      } else {
        displayName = name;
      }
      ctx.fillText(displayName, canvas.width / 2, iconY + iconH + 50);

      // Human-readable size.
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#94a3b8';
      const sizeText = size < 1024
        ? `${size} B`
        : size < 1024 * 1024
          ? `${(size / 1024).toFixed(1)} KB`
          : `${(size / 1024 / 1024).toFixed(2)} MB`;
      ctx.fillText(sizeText, canvas.width / 2, iconY + iconH + 90);

      // Extension badge — colored chip, anchors the file-type read.
      const ext = (name.split('.').pop() ?? '').toUpperCase();
      if (ext && ext !== name.toUpperCase()) {
        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = '#00f0ff';
        ctx.fillText(ext, canvas.width / 2, canvas.height - 60);
      } else {
        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('FILE', canvas.width / 2, canvas.height - 60);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    // Mesh: thin frame + flat plane, mirroring the imported-image
    // 'panel' mode so misc files feel like the same family of flat
    // 2D world objects. DoubleSide so the icon stays visible from
    // the back when the user rotates the panel 180° with the gizmo.
    const aspect = canvas.width / canvas.height;
    const width = 0.8;
    const height = width / aspect;

    const frameGeo = new THREE.BoxGeometry(width + 0.04, height + 0.04, 0.02);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.1 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);

    const planeGeo = new THREE.PlaneGeometry(width, height);
    const planeMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.position.z = 0.012;
    group.add(planeMesh);

    if (this.camera) {
      const camPos = this.camera.position;
      const dx = camPos.x - pos.x;
      const dz = camPos.z - pos.z;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        group.rotation.y = Math.atan2(dx, dz);
      }
    }

    // CRITICAL: the CanvasTexture is NOT disposed by Three's
    // material.dispose() path. Stash a dispose() callback in
    // userData so removeAsset can call it; without this, every
    // removed/duplicated misc file leaks a 512x640 RGBA texture on
    // GPU until the GL context is destroyed.
    const dispose = () => {
      frameGeo.dispose();
      frameMat.dispose();
      planeGeo.dispose();
      planeMat.dispose();
      texture.dispose();
    };

    group.userData = {
      isMiscFile: true,
      fileName: name,
      fileSize: size,
      mimeType,
      fileData: buffer,
      dispose,
    };

    return {
      id,
      name,
      type: 'misc',
      object3d: group,
      fileData: buffer,
      // Collidable so RMB-grab / VR-grip / E+drag treat the panel the
      // same as any other selectable world object (was false under
      // the old Octahedron+Torus representation, which made the file
      // invisible to the grab raycaster and forced the auto-modal
      // approach as the only way to interact with it).
      isCollidable: true,
      metadata: { fileSize: size, mimeType, extension: name.split('.').pop() }
    };
  }

  public spawnPrimitive(type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane', pos = new THREE.Vector3(0, 1.5, 0), customId?: string): LoadedAsset {
    const id = customId || `prim-${type}-${Date.now()}`;
    let geo: THREE.BufferGeometry;

    switch (type) {
      case 'cube':
        geo = new THREE.BoxGeometry(1, 1, 1);
        break;
      case 'sphere':
        geo = new THREE.SphereGeometry(0.6, 32, 32);
        break;
      case 'cylinder':
        geo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
        break;
      case 'cone':
        geo = new THREE.ConeGeometry(0.6, 1.2, 32);
        break;
      case 'torus':
        geo = new THREE.TorusGeometry(0.5, 0.2, 16, 32);
        break;
      case 'plane':
        geo = new THREE.PlaneGeometry(2, 2);
        break;
      default:
        geo = new THREE.BoxGeometry(1, 1, 1);
    }

    // Assign a rich random HSL or neon color
    const colors = ['#00f0ff', '#a855f7', '#ec4899', '#3b82f6', '#10b981', '#f59e0b'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.3,
      side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Wrap the mesh in a Group so object3d is a container separate
    // from the mesh child. This lets "Active" (object3d.visible) and
    // "Mesh Renderer" (child mesh visibility) be independent toggles.
    // Previously, primitives were bare Meshes — toggling the Mesh
    // Renderer would also flip object3d.visible, coupling the two.
    const group = new THREE.Group();
    group.name = `Primitive ${type.toUpperCase()}`;
    group.position.copy(pos);
    group.add(mesh);
    // Persist the primitive type string on userData so it round-trips
    // through every downstream consumer that reads it back.
    group.userData.primitiveType = type;
    group.userData.isPersistent = true;

    this.worldRoot.add(group);

    const asset: LoadedAsset = {
      id,
      name: `Primitive ${type.toUpperCase()}`,
      type: 'primitive',
      object3d: group,
      isCollidable: true
    };

    this.assets.set(id, asset);
    for (const cb of this.onAssetAddedCallbacks) cb(asset);

    return asset;
  }

  public registerCustomAsset(id: string, name: string, object3d: THREE.Object3D, type: AssetType = 'primitive'): LoadedAsset {
    const asset: LoadedAsset = {
      id,
      name,
      type,
      object3d,
      isCollidable: false
    };
    this.assets.set(id, asset);
    for (const cb of this.onAssetAddedCallbacks) cb(asset);
    return asset;
  }

  public unregisterCustomAsset(id: string): void {
    const asset = this.assets.get(id);
    if (!asset) return;
    this.assets.delete(id);
    for (const cb of this.onAssetRemovedCallbacks) cb(id);
  }

  private enableShadows(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private optimizeMeshes(obj: THREE.Object3D): void {
    // Implement LOD & vertex buffer optimization for complex geometries
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry && mesh.geometry.attributes.position) {
          // Only recompute vertex normals when the asset's geometry
          // doesn't already carry a normal attribute. Unconditional
          // recompute clobbers authored smooth normals with per-face
          // normals on non-index-shared geometry, making smooth-shaded
          // imports render faceted.
          if (!mesh.geometry.attributes.normal) {
            mesh.geometry.computeVertexNormals();
          }
          mesh.geometry.computeBoundingBox();
          mesh.geometry.computeBoundingSphere();
        }
      }
    });
  }

  /**
   * Honor the user's import-time shading preference by toggling
   * `material.flatShading` on every mesh's material(s). `needsUpdate`
   * forces a shader recompile when flipping between flat / smooth.
   */
  private applyShading(obj: THREE.Object3D, mode: 'smooth' | 'flat'): void {
    const wantFlat = mode === 'flat';
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats: THREE.Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material as THREE.Material]
            : [];
        for (const m of mats) {
          if ('flatShading' in m) (m as { flatShading: boolean }).flatShading = wantFlat;
          m.needsUpdate = true;
        }
      }
    });
  }

  public removeAsset(id: string): void {
    const asset = this.assets.get(id);
    if (!asset) return;

    this.worldRoot.remove(asset.object3d);
    
    // Dispose memory
    asset.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });

    // CRITICAL: run any asset-specific dispose callback the
    // spawner stashed on userData. The traverse above disposes
    // geometry + material(s) but does NOT release textures they
    // reference — Three.js doesn't track material→texture ownership
    // (textures are frequently shared across materials). The misc
    // file CanvasTexture is the current consumer; without this hook
    // every duplicated / removed misc file leaks a 512x640 RGBA
    // backing on the GPU until the GL context is destroyed. Pattern
    // is generic — any future asset that holds a non-mesh GPU
    // resource can opt in by attaching a `dispose` fn to userData.
    const customDispose = (asset.object3d.userData as { dispose?: () => void })?.dispose;
    if (typeof customDispose === 'function') {
      try {
        customDispose();
      } catch (e) {
        console.warn('[AssetManager] Custom dispose() threw for', id, e);
      }
    }

    // Raw-mode byte cleanup. If the asset was imported with
    // `importAsRawFile: true`, its bytes live in RawFilesStore
    // (NOT in the misc asset's inline fileData, which we clear in
    // _loadFile's raw branch). Drop the IndexedDB record so
    // removeAsset on the world object also frees the disk-pinned
    // bytes; otherwise every removed raw asset would leak ~MB
    // each until the user explicitly cleared IndexedDB.
    const isRaw = (asset.object3d.userData as { isRaw?: boolean })?.isRaw === true;
    if (isRaw && this.rawFilesStore) {
      void this.rawFilesStore.delete(asset.id);
    }

    if (asset.url) {
      URL.revokeObjectURL(asset.url);
    }
    if (asset.videoElement) {
      asset.videoElement.pause();
      asset.videoElement.src = '';
    }

    if (asset.audioElement) {
      asset.audioElement.pause();
      asset.audioElement.src = '';
    }

    this.videoTickCallbacks.delete(id);
    this.audioTickCallbacks.delete(id);
    this.assets.delete(id);
    for (const cb of this.onAssetRemovedCallbacks) cb(id);
  }

  public downloadAsset(asset: LoadedAsset): void {
    if (!asset.fileData && !asset.url) return;
    
    const blob = asset.fileData 
      ? new Blob([asset.fileData], { type: asset.metadata?.mimeType || 'application/octet-stream' })
      : null;
      
    const url = blob ? URL.createObjectURL(blob) : asset.url!;
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (blob) URL.revokeObjectURL(url);
  }

  public static applyMaterialUpdate(
    asset: LoadedAsset,
    update: MaterialUpdate | MaterialUpdate[] | Record<string, MaterialUpdate>
  ): void {
    if (!asset || !asset.object3d || !update) return;

    const updatesList: MaterialUpdate[] = [];
    if (Array.isArray(update)) {
      updatesList.push(...update);
    } else if (typeof update === 'object') {
      if (
        'assetId' in update ||
        'materialIndex' in update ||
        'color' in update ||
        'map' in update ||
        'roughness' in update ||
        'metalness' in update ||
        'emissive' in update ||
        'opacity' in update ||
        'normalMap' in update ||
        'roughnessMap' in update ||
        'metalnessMap' in update
      ) {
        updatesList.push(update as MaterialUpdate);
      } else {
        Object.values(update).forEach((v) => {
          if (v && typeof v === 'object') updatesList.push(v as MaterialUpdate);
        });
      }
    }
    if (updatesList.length === 0) return;

    const stateMap: Record<string, MaterialUpdate> = {};
    const existing = asset.object3d.userData.materialState;
    if (existing) {
      if (Array.isArray(existing)) {
        existing.forEach((item) => {
          if (item && typeof item === 'object') {
            const key = item.materialIndex !== undefined ? String(item.materialIndex) : 'all';
            stateMap[key] = { ...(stateMap[key] || {}), ...item };
          }
        });
      } else if (typeof existing === 'object') {
        if (
          'assetId' in existing ||
          'materialIndex' in existing ||
          'color' in existing ||
          'map' in existing ||
          'roughness' in existing ||
          'metalness' in existing ||
          'emissive' in existing ||
          'opacity' in existing
        ) {
          const item = existing as MaterialUpdate;
          const key = item.materialIndex !== undefined ? String(item.materialIndex) : 'all';
          stateMap[key] = { ...(stateMap[key] || {}), ...item };
        } else {
          Object.entries(existing).forEach(([k, v]) => {
            if (v && typeof v === 'object') {
              stateMap[k] = { ...(stateMap[k] || {}), ...(v as MaterialUpdate) };
            }
          });
        }
      }
    }

    updatesList.forEach((upd) => {
      const key = upd.materialIndex !== undefined ? String(upd.materialIndex) : 'all';
      stateMap[key] = {
        ...(stateMap[key] || { assetId: asset.id, materialIndex: upd.materialIndex }),
        ...upd
      };
    });

    asset.object3d.userData.materialState = stateMap;

    const materials: THREE.MeshStandardMaterial[] = [];
    asset.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          materials.push(...(mesh.material as THREE.MeshStandardMaterial[]));
        } else if (mesh.material) {
          materials.push(mesh.material as THREE.MeshStandardMaterial);
        }
      }
    });

    updatesList.forEach((upd) => {
      const targetMats =
        typeof upd.materialIndex === 'number' && upd.materialIndex >= 0 && materials[upd.materialIndex]
          ? [materials[upd.materialIndex]]
          : materials;

      targetMats.forEach((m) => {
        if (upd.color !== undefined) m.color.set(upd.color);
        if (upd.roughness !== undefined) m.roughness = upd.roughness;
        if (upd.metalness !== undefined) m.metalness = upd.metalness;
        if (upd.emissive !== undefined) {
          m.emissive.set(upd.emissive);
          if (upd.emissiveIntensity !== undefined) m.emissiveIntensity = upd.emissiveIntensity;
        }
        if (upd.emissiveIntensity !== undefined) m.emissiveIntensity = upd.emissiveIntensity;
        if (upd.opacity !== undefined) {
          m.opacity = upd.opacity;
          m.transparent = upd.opacity < 1.0;
        }
        if (upd.wireframe !== undefined) m.wireframe = upd.wireframe;
        if (upd.flatShading !== undefined) {
          m.flatShading = upd.flatShading;
          m.needsUpdate = true;
        }
        if (upd.normalScale !== undefined) {
          if (!m.normalScale) m.normalScale = new THREE.Vector2(1, 1);
          m.normalScale.set(upd.normalScale, upd.normalScale);
          m.needsUpdate = true;
        }
        if (upd.aoMapIntensity !== undefined) {
          m.aoMapIntensity = upd.aoMapIntensity;
          m.needsUpdate = true;
        }
      });

      const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;
      slots.forEach((slotName) => {
        const url = upd[slotName];
        if (url === null) {
          targetMats.forEach((m) => {
            (m as any)[slotName] = null;
            m.needsUpdate = true;
          });
        } else if (typeof url === 'string' && url.length > 0) {
          new THREE.TextureLoader().load(url, (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            if (slotName === 'map' || slotName === 'emissiveMap') {
              tex.colorSpace = THREE.SRGBColorSpace;
            }
            targetMats.forEach((m) => {
              (m as any)[slotName] = tex;
              m.needsUpdate = true;
            });
          });
        }
      });
    });
  }
}
