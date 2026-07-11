import * as THREE from 'three';

export interface ResoniteLightConfig {
  persistent: boolean;
  UpdateOrder: number;
  Enabled: boolean;
  LightType: 'Point' | 'Directional' | 'Spot';
  Intensity: number;
  Color: string;
  ColorProfile: 'sRGB' | 'Linear';
  ShadowType: 'None' | 'Hard' | 'Soft';
  ShadowStrength: number;
  ShadowNearPlane: number;
  ShadowMapResolution: number;
  ShadowBias: number;
  ShadowNormalBias: number;
  Range: number;
  SpotAngle: number;
  Cookie: string | null;
}

export const DEFAULT_LIGHT_CONFIG: ResoniteLightConfig = {
  persistent: true,
  UpdateOrder: 0,
  Enabled: true,
  LightType: 'Point',
  Intensity: 1.0,
  Color: '#ffffff',
  ColorProfile: 'sRGB',
  ShadowType: 'None',
  ShadowStrength: 1.0,
  ShadowNearPlane: 0.20,
  ShadowMapResolution: 0,
  ShadowBias: 0.13,
  ShadowNormalBias: 0.60,
  Range: 10,
  SpotAngle: 60,
  Cookie: null,
};

const LIGHT_CHILD_NAME = 'ResoniteLight_Child';

export function syncThreeLightFromConfig(
  parentObj: THREE.Object3D,
  config: ResoniteLightConfig
): THREE.Light {
  parentObj.userData.resoniteLight = { ...config };

  let existingLight = parentObj.children.find(
    (c) => c.name === LIGHT_CHILD_NAME || (c as THREE.Light).isLight
  ) as THREE.Light | undefined;

  const matchesType =
    (config.LightType === 'Point' && existingLight instanceof THREE.PointLight) ||
    (config.LightType === 'Directional' && existingLight instanceof THREE.DirectionalLight) ||
    (config.LightType === 'Spot' && existingLight instanceof THREE.SpotLight);

  if (!existingLight || !matchesType) {
    const prevPos = existingLight ? existingLight.position.clone() : new THREE.Vector3(0, 1.2, 0);
    if (existingLight) {
      parentObj.remove(existingLight);
    }
    if (config.LightType === 'Directional') {
      existingLight = new THREE.DirectionalLight(config.Color, config.Intensity);
    } else if (config.LightType === 'Spot') {
      existingLight = new THREE.SpotLight(
        config.Color,
        config.Intensity,
        config.Range,
        THREE.MathUtils.degToRad(config.SpotAngle / 2),
        0.3,
        2
      );
    } else {
      existingLight = new THREE.PointLight(config.Color, config.Intensity, config.Range, 2);
    }
    existingLight.name = LIGHT_CHILD_NAME;
    existingLight.position.copy(prevPos);
    parentObj.add(existingLight);
  }

  existingLight.visible = config.Enabled;
  existingLight.intensity = config.Intensity;
  existingLight.color.set(config.Color);

  if (existingLight instanceof THREE.PointLight || existingLight instanceof THREE.SpotLight) {
    existingLight.distance = config.Range;
    existingLight.decay = 2;
  }

  if (existingLight instanceof THREE.SpotLight) {
    existingLight.angle = THREE.MathUtils.degToRad(Math.max(1, Math.min(180, config.SpotAngle)) / 2);
    if (config.Cookie) {
      const loader = new THREE.TextureLoader();
      loader.load(config.Cookie, (tex) => {
        if (existingLight instanceof THREE.SpotLight) {
          existingLight.map = tex;
          existingLight.map.needsUpdate = true;
        }
      });
    } else {
      existingLight.map = null;
    }
  }

  if (config.ShadowType === 'None') {
    existingLight.castShadow = false;
  } else {
    existingLight.castShadow = true;
    if (
      existingLight instanceof THREE.PointLight ||
      existingLight instanceof THREE.DirectionalLight ||
      existingLight instanceof THREE.SpotLight
    ) {
      existingLight.shadow.camera.near = Math.max(0.01, config.ShadowNearPlane);
      existingLight.shadow.bias = -config.ShadowBias * 0.0005;
      existingLight.shadow.normalBias = config.ShadowNormalBias * 0.05;

      const res = config.ShadowMapResolution > 0 ? config.ShadowMapResolution : 1024;
      existingLight.shadow.mapSize.set(res, res);
      existingLight.shadow.radius = config.ShadowType === 'Soft' ? 4 : 1;
    }
  }

  existingLight.userData.resoniteLight = { ...config };
  return existingLight;
}

export function removeLightComponent(parentObj: THREE.Object3D): void {
  delete parentObj.userData.resoniteLight;
  const toRemove = parentObj.children.filter(
    (c) => c.name === LIGHT_CHILD_NAME || (c as THREE.Light).isLight
  );
  for (const child of toRemove) {
    parentObj.remove(child);
  }
}
