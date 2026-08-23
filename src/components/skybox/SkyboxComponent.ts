/**
 * Skybox Components — Resonite-style skybox types for world backgrounds.
 *
 * Maps to Resonite's Component:Skybox + material components:
 *   - SkyboxComponent: references a material, controls whether this skybox is active
 *   - SkyboxMaterialType: which rendering approach to use (color, gradient, procedural, 360° texture)
 *
 * The Skybox object in the scene (starfield Points mesh) can have this component
 * added via the Scene Inspector, enabling real-time skybox customization.
 */

import * as THREE from 'three';

// ─── Skybox Material Types ─────────────────────────────────────────────────

/** Solid color background — maps to Resonite's base scene background. */
export interface SkyboxSolidMaterial {
  type: 'solid';
  color: string; // hex color
}

/** Gradient sky — maps to Resonite's GradientSkyMaterial. */
export interface SkyboxGradientMaterial {
  type: 'gradient';
  topColor: string;    // hex - upper sky
  bottomColor: string; // hex - lower sky / horizon
  offset: number;      // 0-1, where the gradient midpoint sits
  exponent: number;    // sharpness of gradient transition
}

/** Procedural sky — maps to Resonite's ProceduralSkyMaterial (simplified). */
export interface SkyboxProceduralMaterial {
  type: 'procedural';
  sunDirection: { x: number; y: number; z: number }; // normalized direction vector
  sunColor: string;
  sunSize: number;        // 0.0-1.0, radius of sun disc
  hazeColor: string;      // atmosphere tint
  hazeThickness: number;  // 0-1, atmosphere density
  groundColor: string;    // color below horizon
  exposure: number;       // brightness multiplier
}

/** 360° equirectangular texture — maps to Resonite's Projection360Material. */
export interface SkyboxTextureMaterial {
  type: 'texture';
  url: string | null;     // image URL for the panorama
  exposure: number;       // brightness
  rotation: number;       // horizontal rotation in degrees
  tint: string;           // color multiplied over texture
}

/** Union of all skybox material types. */
export type SkyboxMaterial =
  | SkyboxSolidMaterial
  | SkyboxGradientMaterial
  | SkyboxProceduralMaterial
  | SkyboxTextureMaterial;

// ─── Main Skybox Component ──────────────────────────────────────────────────

export interface SkyboxComponent {
  enabled: boolean;
  /** Which skybox in the scene is currently active (only one at a time). */
  isActive: boolean;
  /** The material configuration for this skybox. */
  material: SkyboxMaterial;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULT_SKYBOX_SOLID: SkyboxSolidMaterial = {
  type: 'solid',
  color: '#1a1a2e',
};

export const DEFAULT_SKYBOX_GRADIENT: SkyboxGradientMaterial = {
  type: 'gradient',
  topColor: '#0b1329',
  bottomColor: '#1e293b',
  offset: 0.5,
  exponent: 2.0,
};

export const DEFAULT_SKYBOX_PROCEDURAL: SkyboxProceduralMaterial = {
  type: 'procedural',
  sunDirection: { x: 0.5, y: 0.3, z: 0.8 },
  sunColor: '#ffffff',
  sunSize: 0.04,
  hazeColor: '#87ceeb',
  hazeThickness: 0.5,
  groundColor: '#3d5c3d',
  exposure: 1.3,
};

export const DEFAULT_SKYBOX_TEXTURE: SkyboxTextureMaterial = {
  type: 'texture',
  url: null,
  exposure: 1.0,
  rotation: 0,
  tint: '#ffffff',
};

export const DEFAULT_SKYBOX_GRADIENT_COMPONENT: SkyboxComponent = {
  enabled: true,
  isActive: true,
  material: { ...DEFAULT_SKYBOX_GRADIENT },
};

export const DEFAULT_SKYBOX_SOLID_COMPONENT: SkyboxComponent = {
  enabled: true,
  isActive: true,
  material: { ...DEFAULT_SKYBOX_SOLID },
};

export const DEFAULT_SKYBOX_PROCEDURAL_COMPONENT: SkyboxComponent = {
  enabled: true,
  isActive: true,
  material: { ...DEFAULT_SKYBOX_PROCEDURAL },
};

export const DEFAULT_SKYBOX_TEXTURE_COMPONENT: SkyboxComponent = {
  enabled: true,
  isActive: true,
  material: { ...DEFAULT_SKYBOX_TEXTURE },
};

// ─── userData helpers ──────────────────────────────────────────────────────

const SKYBOX_KEY = 'skybox';

/**
 * Read the skybox component from an Object3D's userData.
 * Returns undefined if no skybox component is set.
 */
export function getSkybox(obj: THREE.Object3D): SkyboxComponent | undefined {
  const raw = (obj.userData as Record<string, unknown>)[SKYBOX_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as SkyboxComponent;
}

/** Check if an object has an enabled skybox component. */
export function hasSkybox(obj: THREE.Object3D): boolean {
  const c = getSkybox(obj);
  return c !== undefined && c.enabled === true;
}

/** Store a skybox component on an Object3D's userData. */
export function setSkybox(obj: THREE.Object3D, component: SkyboxComponent | undefined): void {
  if (component === undefined) {
    delete (obj.userData as Record<string, unknown>)[SKYBOX_KEY];
  } else {
    (obj.userData as Record<string, unknown>)[SKYBOX_KEY] = component;
  }
}

// ─── Serialization ───────────────────────────────────────────────────────────

/** Serialize a skybox component for scene save / network broadcast. */
export function serializeSkybox(component: SkyboxComponent | undefined): Record<string, unknown> | null {
  if (!component) return null;
  if (!component.enabled) return { enabled: false };

  const data: Record<string, unknown> = {
    type: 'skybox',
    enabled: component.enabled,
    isActive: component.isActive,
    material: { ...component.material },
  };

  return data;
}

/** Deserialize a skybox component from scene save / network data. */
export function deserializeSkybox(data: Record<string, unknown> | null | undefined): SkyboxComponent | undefined {
  if (!data) return undefined;
  if (data.enabled === false) return undefined;

  const materialType = (data.material as Record<string, unknown>)?.type as string;
  let material: SkyboxMaterial;

  switch (materialType) {
    case 'solid':
      material = { ...DEFAULT_SKYBOX_SOLID, ...(data.material as Partial<SkyboxSolidMaterial>) };
      break;
    case 'gradient':
      material = { ...DEFAULT_SKYBOX_GRADIENT, ...(data.material as Partial<SkyboxGradientMaterial>) };
      break;
    case 'procedural':
      material = { ...DEFAULT_SKYBOX_PROCEDURAL, ...(data.material as Partial<SkyboxProceduralMaterial>) };
      break;
    case 'texture':
      material = { ...DEFAULT_SKYBOX_TEXTURE, ...(data.material as Partial<SkyboxTextureMaterial>) };
      break;
    default:
      material = { ...DEFAULT_SKYBOX_GRADIENT };
  }

  return {
    enabled: data.enabled !== false,
    isActive: data.isActive !== false,
    material,
  };
}

// ─── Three.js Scene Application ────────────────────────────────────────────

/**
 * Apply a SkyboxComponent to a Three.js Scene.
 * This updates scene.background and scene.environment based on the material type.
 */
export function applySkyboxToScene(
  scene: THREE.Scene,
  component: SkyboxComponent,
): void {
  if (!component.enabled || !component.isActive) {
    // Default: dark space background
    scene.background = new THREE.Color('#1a1a2e');
    scene.environment = null;
    return;
  }

  const mat = component.material;

  switch (mat.type) {
    case 'solid': {
      scene.background = new THREE.Color(mat.color);
      scene.environment = null;
      break;
    }

    case 'gradient': {
      // Create a gradient texture using a canvas
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, mat.topColor);
      gradient.addColorStop(mat.offset, mat.topColor);
      gradient.addColorStop(1, mat.bottomColor);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 2, 256);

      const texture = new THREE.CanvasTexture(canvas);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.environment = texture;
      break;
    }

    case 'procedural': {
      // Approximate procedural sky with a color + fog-like effect
      const color = new THREE.Color(mat.hazeColor);
      color.multiplyScalar(mat.exposure);
      scene.background = color;
      scene.environment = null;
      break;
    }

    case 'texture': {
      if (mat.url) {
        const loader = new THREE.TextureLoader();
        loader.load(mat.url, (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          scene.background = texture;
          scene.environment = texture;
        });
      } else {
        scene.background = new THREE.Color('#1a1a2e');
        scene.environment = null;
      }
      break;
    }
  }
}
