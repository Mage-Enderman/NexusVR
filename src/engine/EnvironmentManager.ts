import * as THREE from 'three';

export type AtmospherePreset = 'cyber-nebula' | 'sunset-horizon' | 'studio-neutral' | 'starfield-space' | 'custom-pano';
export type GridSizePreset = 'studio-20' | 'standard-60' | 'arena-200';
export type GridColorPreset = 'cyan' | 'purple' | 'monochrome';

export interface EnvironmentSettings {
  atmosphere: AtmospherePreset;
  gridVisible: boolean;
  gridSize: GridSizePreset;
  gridColor: GridColorPreset;
  ambientIntensity: number;
  dirLightIntensity: number;
}

export class EnvironmentManager {
  private scene: THREE.Scene;
  /**
   * World-parent for the floor / grid. The grid lives here (not in
   * `scene`) so VR inverse-treadmill locomotion translates it together
   * with the floor — without this, the user sees TWO floor grids during
   * a jump: the worldRoot one drops with the inverse-treadmill while
   * the scene-attached EnvironmentManager grid stays anchored to the
   * physical play area, reading as a "copy" of the grid rising with the
   * player. Mirrors SceneEngine.createFloor()'s choice so behaviour is
   * identical regardless of which manager rebuilt the grid last.
   */
  private worldRoot: THREE.Object3D;
  private ambientLight: THREE.AmbientLight;
  private dirLight: THREE.DirectionalLight;

  private floorMesh: THREE.Mesh | null = null;
  private gridHelper: THREE.GridHelper | null = null;
  private starfieldMesh: THREE.Points | null = null;
  private customSkyboxTexture: THREE.Texture | null = null;

  public settings: EnvironmentSettings = {
    atmosphere: 'cyber-nebula',
    gridVisible: true,
    gridSize: 'standard-60',
    gridColor: 'cyan',
    ambientIntensity: 0.4,
    dirLightIntensity: 1.5,
  };

  constructor(scene: THREE.Scene, worldRoot: THREE.Object3D, ambientLight: THREE.AmbientLight, dirLight: THREE.DirectionalLight) {
    this.scene = scene;
    this.worldRoot = worldRoot;
    this.ambientLight = ambientLight;
    this.dirLight = dirLight;

    this.init();
  }

  private init(): void {
    // Find existing floor and grid from SceneEngine if present
    this.scene.traverse((child) => {
      if (child.name === 'WorldFloor' && (child as THREE.Mesh).isMesh) {
        this.floorMesh = child as THREE.Mesh;
      }
      if (child.name === 'WorldGrid' && child instanceof THREE.GridHelper) {
        this.gridHelper = child;
      }
    });

    this.createStarfield();
    this.applySettings(this.settings);
  }

  private createStarfield(): void {
    const starCount = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      // Random position on a sphere of radius 300 to 500
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 300 + Math.random() * 200;

      positions[i] = r * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i + 2] = r * Math.cos(phi);

      // Star color tint (blue-ish white or warm yellow)
      const tint = Math.random();
      if (tint > 0.8) {
        colors[i] = 0.5; colors[i + 1] = 0.8; colors[i + 2] = 1.0; // Cyan star
      } else if (tint > 0.6) {
        colors[i] = 1.0; colors[i + 1] = 0.7; colors[i + 2] = 0.9; // Magenta star
      } else {
        colors[i] = 1.0; colors[i + 1] = 1.0; colors[i + 2] = 1.0; // White star
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: false,
      fog: false
    });

    this.starfieldMesh = new THREE.Points(geometry, material);
    this.starfieldMesh.name = 'WorldStarfield';
    this.starfieldMesh.visible = false;
    // Parented to worldRoot (not scene) so the starfield rotates with
    // the world when the VR player smooth-turns. Without this, the
    // stars stay anchored to the player's view while the floor/grid/
    // assets rotate around them, producing the "skybox stuck to my
    // face" effect. The starfield is at radius 300-500m, so when the
    // user walks (inverse-treadmill translates worldRoot) the stars
    // translate with it — a mild parallax that is negligible in
    // practice (user typically walks < 100m, stars at 300-500m). The
    // proper long-term fix for walking would be a real skybox
    // (CubeTexture on scene.background, always at infinity) but
    // that's a separate change from the spin fix.
    this.worldRoot.add(this.starfieldMesh);
  }

  public applySettings(newSettings: Partial<EnvironmentSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    const { atmosphere, gridVisible, gridSize, gridColor, ambientIntensity, dirLightIntensity } = this.settings;

    // 1. Lighting intensities
    this.ambientLight.intensity = ambientIntensity;
    this.dirLight.intensity = dirLightIntensity;

    // 2. Atmosphere & Fog
    if (this.starfieldMesh) this.starfieldMesh.visible = false;
    
    if (atmosphere === 'cyber-nebula') {
      this.scene.background = new THREE.Color('#0b1329');
      this.scene.fog = null;
      this.ambientLight.color.set('#ffffff');
      this.dirLight.color.set('#00f0ff');
      if (this.starfieldMesh) this.starfieldMesh.visible = true;
    } else if (atmosphere === 'sunset-horizon') {
      this.scene.background = new THREE.Color('#1a0f2e');
      this.scene.fog = null;
      this.ambientLight.color.set('#ffd166');
      this.dirLight.color.set('#ef476f');
      if (this.starfieldMesh) this.starfieldMesh.visible = true;
    } else if (atmosphere === 'studio-neutral') {
      this.scene.background = new THREE.Color('#263238');
      this.scene.fog = null; // No fog in studio
      this.ambientLight.color.set('#eceff1');
      this.dirLight.color.set('#ffffff');
    } else if (atmosphere === 'starfield-space') {
      this.scene.background = new THREE.Color('#020408');
      this.scene.fog = null;
      this.ambientLight.color.set('#90caf9');
      this.dirLight.color.set('#ffffff');
      if (this.starfieldMesh) this.starfieldMesh.visible = true;
    } else if (atmosphere === 'custom-pano' && this.customSkyboxTexture) {
      this.scene.background = this.customSkyboxTexture;
      this.scene.environment = this.customSkyboxTexture;
      this.scene.fog = null;
    }

    // 3. Grid rebuild if changed.
    // IMPORTANT: grid is parented to worldRoot (NOT scene) so VR inverse-
    // treadmill locomotion translates it together with the floor. Adding
    // directly to scene here was the duplicate-grid bug: worldRoot's grid
    // (from SceneEngine.createFloor) dropped on jump while this grid stayed
    // fixed to scene, looking like a "copy" rising with the player.
    if (this.gridHelper) {
      this.worldRoot.remove(this.gridHelper);
      this.disposeGridResources();
      this.gridHelper = null;
    }

    if (gridVisible) {
      let size = 60;
      let divisions = 60;
      if (gridSize === 'studio-20') { size = 20; divisions = 20; }
      else if (gridSize === 'arena-200') { size = 200; divisions = 100; }

      let color1 = '#00f0ff';
      let color2 = '#1e293b';
      if (gridColor === 'purple') { color1 = '#a855f7'; color2 = '#311042'; }
      else if (gridColor === 'monochrome') { color1 = '#94a3b8'; color2 = '#334155'; }

      this.gridHelper = new THREE.GridHelper(size, divisions, color1, color2);
      this.gridHelper.position.y = 0.01;
      this.gridHelper.name = 'WorldGrid';
      this.worldRoot.add(this.gridHelper);
    }

    // 4. Floor mesh scale matching
    if (this.floorMesh) {
      let size = 100;
      if (gridSize === 'studio-20') size = 40;
      else if (gridSize === 'arena-200') size = 400;

      this.floorMesh.scale.set(size / 100, size / 100, 1);
      if (atmosphere === 'starfield-space') {
        (this.floorMesh.material as THREE.MeshStandardMaterial).opacity = 0.3;
        (this.floorMesh.material as THREE.MeshStandardMaterial).transparent = true;
      } else {
        (this.floorMesh.material as THREE.MeshStandardMaterial).opacity = 1.0;
        (this.floorMesh.material as THREE.MeshStandardMaterial).transparent = false;
      }
    }
  }

  public setCustomSkybox(texture: THREE.Texture): void {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    this.customSkyboxTexture = texture;
    this.applySettings({ atmosphere: 'custom-pano' });
  }

  public dispose(): void {
    if (this.gridHelper) {
      this.worldRoot.remove(this.gridHelper);
      this.disposeGridResources();
      this.gridHelper = null;
    }
    if (this.starfieldMesh) {
      this.worldRoot.remove(this.starfieldMesh);
      this.starfieldMesh.geometry.dispose();
      (this.starfieldMesh.material as THREE.Material).dispose();
      this.starfieldMesh = null;
    }
  }

  /**
   * Release the GPU resources owned by the current gridHelper. Called
   * from BOTH `applySettings()`'s rebuild branch (every grid size / color
   * change) and `dispose()` (full teardown). GridHelper.dispose() alone
   * only frees the geometry — its two LineBasicMaterials (centre-line
   * + off-line) would otherwise leak each rebuild.
   */
  private disposeGridResources(): void {
    if (!this.gridHelper) return;
    const mats = Array.isArray(this.gridHelper.material)
      ? this.gridHelper.material
      : [this.gridHelper.material];
    mats.forEach((m) => m.dispose());
    this.gridHelper.dispose();
  }
}
