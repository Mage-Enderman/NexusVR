import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ImportConfig } from '../components/AssetImportDialog.tsx';

export type AssetType = '3d-model' | 'image' | 'video' | 'vrm' | 'misc' | 'primitive';

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
}

export interface LoadedAsset {
  id: string;
  name: string;
  type: AssetType;
  object3d: THREE.Object3D;
  url?: string;
  fileData?: ArrayBuffer;
  isCollidable: boolean;
  videoElement?: HTMLVideoElement;
  metadata?: {
    fileSize?: number;
    mimeType?: string;
    extension?: string;
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
  
  public assets: Map<string, LoadedAsset> = new Map();
  private onAssetAddedCallbacks: Set<(asset: LoadedAsset) => void> = new Set();
  private onAssetRemovedCallbacks: Set<(id: string) => void> = new Set();
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

  constructor(scene: THREE.Scene, worldRoot: THREE.Object3D) {
    this.scene = scene;
    this.worldRoot = worldRoot;
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

  public async importFile(file: File, position = new THREE.Vector3(0, 1.5, 0), config?: ImportConfig, customId?: string): Promise<LoadedAsset | null> {
    // Resolve the id BEFORE any async work so two near-simultaneous
    // calls with the same customId hit the dedup short-circuit
    // immediately — otherwise both would each reach
    // `await file.arrayBuffer()` before either registers an
    // in-progress Promise, and each would proceed into its own
    // loadGLB + worldRoot.add + onAssetAdded → broadcastSpawn chain.
    // `customId` lets callers reserve a stable id BEFORE awaiting so a
    // pending-spawn placeholder mesh (drawn from a 'pending' network
    // broadcast) and the eventual asset share the same id. Without
    // this, the placeholder would have to be reconciled via a
    // separate tempId → assetId mapping at network-sync time. Falls
    // back to the existing random id scheme when unspecified.
    const id = customId ?? `asset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const inFlight = this.inProgressImports.get(id);
    if (inFlight) return inFlight;
    const promise = this._loadFile(file, position, config, id);
    this.inProgressImports.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inProgressImports.delete(id);
    }
  }

  private async _loadFile(file: File, position: THREE.Vector3, config: ImportConfig | undefined, id: string): Promise<LoadedAsset | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const arrayBuffer = await file.arrayBuffer();
    const blobUrl = URL.createObjectURL(file);

    let asset: LoadedAsset | null = null;

    if (['glb', 'gltf'].includes(ext)) {
      asset = await this.loadGLB(id, file.name, blobUrl, arrayBuffer, position, config);
    } else if (['obj'].includes(ext)) {
      asset = await this.loadOBJ(id, file.name, blobUrl, arrayBuffer, position, config);
    } else if (['fbx'].includes(ext)) {
      asset = await this.loadFBX(id, file.name, blobUrl, arrayBuffer, position, config);
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      asset = await this.loadImage(id, file.name, blobUrl, arrayBuffer, position, config);
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      asset = await this.loadVideo(id, file.name, blobUrl, arrayBuffer, position, config);
    } else if (ext === 'vrm') {
      asset = await this.loadGLB(id, file.name, blobUrl, arrayBuffer, position, config);
      if (asset) asset.type = 'vrm';
    } else {
      asset = this.createMiscFileObject(id, file.name, arrayBuffer, file.type, file.size, position);
    }

    if (asset) {
      this.worldRoot.add(asset.object3d);
      this.assets.set(asset.id, asset);
      for (const cb of this.onAssetAddedCallbacks) cb(asset);
    }

    return asset;
  }

  public async importFromUrl(url: string, position = new THREE.Vector3(0, 1.5, 0), config?: ImportConfig, customId?: string): Promise<LoadedAsset | null> {
    // Mirror of `importFile`'s pre-await id + dedup. Same race
    // description applies: two `'spawn'` envelopes for the same id
    // would otherwise each start an independent fetch + GLB parse +
    // worldRoot.add.
    const id = customId ?? `remote-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const inFlight = this.inProgressImports.get(id);
    if (inFlight) return inFlight;
    const promise = this._loadFromUrl(url, position, config, id);
    this.inProgressImports.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inProgressImports.delete(id);
    }
  }

  private async _loadFromUrl(url: string, position: THREE.Vector3, config: ImportConfig | undefined, id: string): Promise<LoadedAsset | null> {
    const ext = url.split('.').pop()?.split('?')[0].toLowerCase() || 'png';
    const name = url.split('/').pop()?.split('?')[0] || `remote-${Date.now()}.${ext}`;

    try {
      const resp = await fetch(url);
      const arrayBuffer = await resp.arrayBuffer();
      const blob = new Blob([arrayBuffer]);
      const blobUrl = URL.createObjectURL(blob);

      let asset: LoadedAsset | null = null;
      if (['glb', 'gltf', 'vrm'].includes(ext)) {
        asset = await this.loadGLB(id, name, blobUrl, arrayBuffer, position, config);
        if (ext === 'vrm' && asset) asset.type = 'vrm';
      } else if (['obj'].includes(ext)) {
        asset = await this.loadOBJ(id, name, blobUrl, arrayBuffer, position, config);
      } else if (['fbx'].includes(ext)) {
        asset = await this.loadFBX(id, name, blobUrl, arrayBuffer, position, config);
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        asset = await this.loadImage(id, name, blobUrl, arrayBuffer, position, config);
      } else if (['mp4', 'webm', 'mov'].includes(ext)) {
        asset = await this.loadVideo(id, name, blobUrl, arrayBuffer, position, config);
      } else {
        asset = this.createMiscFileObject(id, name, arrayBuffer, 'application/octet-stream', arrayBuffer.byteLength, position);
      }

      if (asset) {
        this.worldRoot.add(asset.object3d);
        this.assets.set(asset.id, asset);
        for (const cb of this.onAssetAddedCallbacks) cb(asset);
      }
      return asset;
    } catch (err) {
      console.warn('Failed to import from URL:', url, err);
      return null;
    }
  }

  private applyModelScaling(root: THREE.Object3D, config?: ImportConfig): void {
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

  private async loadGLB(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: ImportConfig): Promise<LoadedAsset> {
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

  private async loadOBJ(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: ImportConfig): Promise<LoadedAsset> {
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

  private async loadFBX(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: ImportConfig): Promise<LoadedAsset> {
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


  private async loadImage(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: ImportConfig): Promise<LoadedAsset> {
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
          const aspect = texture.image.width / texture.image.height || 1;
          const width = Math.min(2.5, aspect * 2);
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

        // Default: 3D Panel
        const aspect = texture.image.width / texture.image.height || 1;
        const width = Math.min(2.5, aspect * 2);
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
        group.add(imgMesh);

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

  private async loadVideo(id: string, name: string, url: string, buffer: ArrayBuffer, pos: THREE.Vector3, config?: ImportConfig): Promise<LoadedAsset> {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.loop = config ? config.videoLoop : true;
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

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;

    let width = 3.0;
    let height = 1.6875; // 16:9
    if (config?.videoAspectRatio === '9:16') {
      width = 1.6875;
      height = 3.0;
    } else if (config?.videoAspectRatio === '1:1') {
      width = 2.2;
      height = 2.2;
    }

    const group = new THREE.Group();
    group.position.copy(pos);

    const frameGeo = new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.08);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#07090e', roughness: 0.2, metalness: 0.8 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    group.add(frame);

    const screenGeo = new THREE.PlaneGeometry(width, height);
    const screenMat = new THREE.MeshBasicMaterial({ map: texture });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.z = 0.042;
    group.add(screenMesh);

    // Source-of-truth playback state lives on userData. UI components
    // read from it directly (no events), so the React inspector /
    // VR HUD both see consistent values without us needing a
    // subscribe/notify bridge that fires on every play / timeupdate.
    // Mirrors the `isPersistent` userData pattern used elsewhere in
    // this codebase — keeps networked + local state colocated on the
    // same Three.js node.
    const videoState: VideoPlaybackState = {
      playing: false,
      currentTime: 0,
      duration: 0,
      globalVolume: 0.8,
      localVolume: 0.8,
      volumeMode: 'global',
      muted: true,
    };
    group.userData.videoState = videoState;

    // Mirror the HTMLVideoElement lifecycle into the state object so
    // the React UI's progress bar / play-button copy stays in sync
    // without a polling rAF. timeupdate fires roughly 4x/sec on
    // most browsers — fine for visible progress updates without
    // thrashing React re-renders.
    // `loadedmetadata` also drives the `'auto'` aspect-ratio path:
    // once the browser knows the source codec dimensions we resize the
    // frame box + screen plane so vertical / cinematic / squarish
    // videos display at their true aspect ratio rather than the
    // 16:9 placeholder geometry this method bakes in synchronously
    // for the other three fixed ratio options.
    video.addEventListener('loadedmetadata', () => {
      videoState.duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (
        config?.videoAspectRatio === 'auto' &&
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
      }
    });
    video.addEventListener('timeupdate', () => {
      videoState.currentTime = video.currentTime;
    });
    video.addEventListener('play', () => {
      videoState.playing = true;
    });
    video.addEventListener('pause', () => {
      videoState.playing = false;
    });
    video.addEventListener('volumechange', () => {
      // Keep state.muted / volumeMode-derived value coherent with the
      // element so re-mounting the UI after a network-snap reads
      // consistent data. Mute is authoritative (user-driven), the
      // mirrors handle element-driven changes like browser autoplay
      // stripping audio.
      videoState.muted = video.muted;
    });
    video.addEventListener('ended', () => {
      videoState.playing = false;
    });

    return {
      id,
      name,
      type: 'video',
      object3d: group,
      url,
      fileData: buffer,
      isCollidable: true,
      videoElement: video
    };
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
   */
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
        // userData.mirror. The .catch is silent because browser
        // autoplay policy rejections just mean the element stays
        // paused; the user can retry by clicking play again.
        v.play().catch(() => { /* autoplay rejected; user must retry */ });
      } else {
        v.pause();
      }
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
    return changed;
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

  public spawnPrimitive(type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane', pos = new THREE.Vector3(0, 1.5, 0)): LoadedAsset {
    const id = `prim-${type}-${Date.now()}`;
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
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Persist the primitive type string on the mesh's userData so it
    // round-trips through every downstream consumer that reads it back:
    //   - App.tsx's `registerOnAssetAdded` broadcasts a spawn envelope
    //     to peers and includes it in scene snapshots
    //   - `handleDuplicateSelected` re-spawns the primitive
    //   - `handleDeleteSelected`, `recordSpawnUndo`, and
    //     `respawnFromSnapshot` all hit `obj.userData.primitiveType`
    //     to reconstruct the asset after undo/redo
    //   - `handleSpawnFromInventory` likewise reads it for re-import
    // Without this, all four of those paths silently degraded to
    // fall-through no-ops on primitives — the most visible symptom
    // being that host-spawned cube/torus never appeared on guests in
    // the network sync flow.
    mesh.userData.primitiveType = type;
    // Default every freshly-spawned primitive to persistent=true so
    // the network broadcast's read-from-userData sources always has a
    // defined value. Without this, a host that never opened the
    // Scene Inspector for a given primitive would broadcast
    // `isPersistent: undefined`, every receiver guard would skip, and
    // the guest's checkbox would silently default-to-true via the
    // inspector's `?? true` fallback — visible by coincidence, not by
    // design. This makes the userData byte well-defined from asset
    // birth so every downstream consumer reads consistent bytes.
    mesh.userData.isPersistent = true;

    this.worldRoot.add(mesh);

    const asset: LoadedAsset = {
      id,
      name: `Primitive ${type.toUpperCase()}`,
      type: 'primitive',
      object3d: mesh,
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

    if (asset.url) {
      URL.revokeObjectURL(asset.url);
    }
    if (asset.videoElement) {
      asset.videoElement.pause();
      asset.videoElement.src = '';
    }

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
}
