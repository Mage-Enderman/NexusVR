import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ImportConfig } from '../components/AssetImportDialog.tsx';

export type AssetType = '3d-model' | 'image' | 'video' | 'vrm' | 'misc' | 'primitive';

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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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

  public async importFile(file: File, position = new THREE.Vector3(0, 1.5, 0), config?: ImportConfig): Promise<LoadedAsset | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const arrayBuffer = await file.arrayBuffer();
    const blobUrl = URL.createObjectURL(file);
    const id = `asset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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
      this.scene.add(asset.object3d);
      this.assets.set(asset.id, asset);
      for (const cb of this.onAssetAddedCallbacks) cb(asset);
    }

    return asset;
  }

  public async importFromUrl(url: string, position = new THREE.Vector3(0, 1.5, 0), config?: ImportConfig): Promise<LoadedAsset | null> {
    const ext = url.split('.').pop()?.split('?')[0].toLowerCase() || 'png';
    const name = url.split('/').pop()?.split('?')[0] || `remote-${Date.now()}.${ext}`;
    const id = `remote-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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
        this.scene.add(asset.object3d);
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
    video.muted = false;
    video.volume = 0.8;
    
    if (!config || config.videoAutoplay) {
      video.play().catch(() => {
        video.muted = true;
        video.play();
      });
    }

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


  private createMiscFileObject(id: string, name: string, buffer: ArrayBuffer, mimeType: string, size: number, pos: THREE.Vector3): LoadedAsset {
    const group = new THREE.Group();
    group.position.copy(pos);

    // Holographic File Icon Cube
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: '#00f0ff',
      roughness: 0.2,
      metalness: 0.9,
      wireframe: false,
      emissive: '#004466',
      emissiveIntensity: 0.5
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    // Outer glow ring
    const ringGeo = new THREE.TorusGeometry(0.7, 0.02, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#a855f7' });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Store custom user data on Object3D so raycaster/UI can read it
    group.userData = {
      isMiscFile: true,
      fileName: name,
      fileSize: size,
      mimeType,
      fileData: buffer
    };

    return {
      id,
      name,
      type: 'misc',
      object3d: group,
      fileData: buffer,
      isCollidable: false,
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

    this.scene.add(mesh);

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

    this.scene.remove(asset.object3d);
    
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
