import * as THREE from 'three';
import type { LoadedAsset } from './AssetManager.ts';

/**
 * Singleton offscreen renderer used exclusively for generating PNG thumbnails
 * of inventory assets and saved room layouts without leaking WebGL contexts.
 */
let offscreenRenderer: THREE.WebGLRenderer | null = null;

function getOffscreenRenderer(width = 256, height = 256): THREE.WebGLRenderer {
  if (!offscreenRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    offscreenRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    offscreenRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  offscreenRenderer.setSize(width, height, false);
  return offscreenRenderer;
}

/**
 * Generates a clean 256x256 studio-lit isometric PNG thumbnail data URL
 * for any LoadedAsset or THREE.Object3D.
 */
export async function generateAssetThumbnail(asset: LoadedAsset): Promise<string | undefined> {
  try {
    const renderer = getOffscreenRenderer(256, 256);
    const scene = new THREE.Scene();

    // Studio 3-point lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(3, 5, 4);
    const fillLight = new THREE.DirectionalLight(0x88ccff, 1.0);
    fillLight.position.set(-3, -2, -3);

    scene.add(ambientLight, keyLight, fillLight);

    // Deep clone so we don't mutate world transformations
    const clone = asset.object3d.clone(true);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);

    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    if (box.isEmpty()) {
      return undefined;
    }

    // Center clone at origin
    const center = box.getCenter(new THREE.Vector3());
    clone.position.sub(center);
    scene.add(clone);

    // Calculate bounding sphere and place camera
    clone.updateMatrixWorld(true);
    const updatedBox = new THREE.Box3().setFromObject(clone);
    const sphere = updatedBox.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.25, sphere.radius);

    const camera = new THREE.PerspectiveCamera(40, 1, Math.max(0.01, radius * 0.05), radius * 30);
    camera.position.set(radius * 1.6, radius * 1.15, radius * 1.85);
    camera.lookAt(0, 0, 0);

    renderer.clear();
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL('image/png');
    return dataUrl;
  } catch (err) {
    console.warn('[ThumbnailGenerator] Failed to generate asset thumbnail:', err);
    return undefined;
  }
}

/**
 * Generates a wide 320x180 PNG thumbnail data URL representing an entire room scene layout.
 */
export async function generateSceneThumbnail(worldRoot: THREE.Object3D): Promise<string | undefined> {
  try {
    const renderer = getOffscreenRenderer(320, 180);
    const scene = new THREE.Scene();

    // Soft dark gradient background for scene previews
    scene.background = new THREE.Color('#0a0e17');

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    const dirLight = new THREE.DirectionalLight(0x00f0ff, 1.8);
    dirLight.position.set(10, 15, 10);
    const fillLight = new THREE.DirectionalLight(0xa855f7, 1.0);
    fillLight.position.set(-10, 5, -10);

    scene.add(ambientLight, dirLight, fillLight);

    const rootClone = new THREE.Group();

    // Clone visible meshes excluding skybox
    worldRoot.children.forEach((child) => {
      if (child.name === 'Skybox' || child.name === 'VRHUDGroup') return;
      const c = child.clone(true);
      rootClone.add(c);
    });

    rootClone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rootClone);
    if (box.isEmpty()) {
      return undefined;
    }

    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(2.0, sphere.radius);

    scene.add(rootClone);

    const camera = new THREE.PerspectiveCamera(45, 320 / 180, 0.1, radius * 20);
    camera.position.set(center.x + radius * 1.2, center.y + Math.max(2, radius * 0.7), center.z + radius * 1.3);
    camera.lookAt(center.x, center.y, center.z);

    renderer.clear();
    renderer.render(scene, camera);

    return renderer.domElement.toDataURL('image/png');
  } catch (err) {
    console.warn('[ThumbnailGenerator] Failed to generate scene thumbnail:', err);
    return undefined;
  }
}
