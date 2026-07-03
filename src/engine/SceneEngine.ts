import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface GraphicsSettings {
  resolutionScale: number; // 0.5 to 2.0
  shadowQuality: 'off' | 'low' | 'medium' | 'high' | 'ultra';
  antiAliasing: 'none' | 'fxaa' | 'msaa';
  msaaSamples: number;
  postProcessing: boolean;
  lodBias: number;
  progressiveLOD: boolean;
  /** Target triangle density for gltf-progressive LOD (default 200000) */
  lodTargetDensity: number;
  /** Force-override LOD level for all progressive meshes (undefined = auto) */
  lodOverrideLevel: number | undefined;
}

export interface PerformanceStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

export type SceneUpdateCallback = (delta: number, elapsed: number) => void;

export class SceneEngine {
  public container: HTMLElement;
  public renderer!: THREE.WebGLRenderer;
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public controls!: OrbitControls;
  public ambientLight!: THREE.AmbientLight;
  public dirLight!: THREE.DirectionalLight;
  public gridHelper!: THREE.GridHelper;
  public floorMesh!: THREE.Mesh;
  
  // WebXR Controllers
  public controller1!: THREE.XRTargetRaySpace;
  public controller2!: THREE.XRTargetRaySpace;
  public controllerGrip1!: THREE.XRGripSpace;
  public controllerGrip2!: THREE.XRGripSpace;
  public raycaster!: THREE.Raycaster;
  public workingMatrix = new THREE.Matrix4();

  // Settings & Stats
  public settings: GraphicsSettings = {
    resolutionScale: 1.0,
    shadowQuality: 'high',
    antiAliasing: 'msaa',
    msaaSamples: 4,
    postProcessing: false,
    lodBias: 1.0,
    progressiveLOD: false,
    lodTargetDensity: 200_000,
    lodOverrideLevel: undefined
  };
  
  public stats: PerformanceStats = {
    fps: 60,
    drawCalls: 0,
    triangles: 0
  };
  
  private updateCallbacks: Set<SceneUpdateCallback> = new Set();
  private lastTime = performance.now();
  private frameCount = 0;
  private fpsTimer = 0;
  private isVRMode = false;
  private vrButtonElement: HTMLElement | null = null;

  public cameraMode: 'orbit' | 'first-person' = 'first-person';
  public locomotionMode: 'walk' | 'flight' | 'noclip' = 'walk';
  private verticalVelocity = 0;
  private isGrounded = true;
  private keysPressed: Record<string, boolean> = {};
  private fpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private isPointerLocked = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.raycaster = new THREE.Raycaster();
    this.init();
  }

  private init(): void {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1329');
    this.scene.fog = null;

    // 2. Camera
    const width = Math.max(this.container.clientWidth || window.innerWidth || 1024, 1);
    const height = Math.max(this.container.clientHeight || window.innerHeight || 768, 1);
    const aspect = width / height;
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 1000);
    // Start at average eye height (1.6m) so the user begins in a natural
    // standing position rather than floating at 2m looking down.
    this.camera.position.set(0, 1.6, 3);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * this.settings.resolutionScale, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.xr.enabled = true;
    
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    // Watch container sizing asynchronously
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          this.onWindowResize();
        }
      }
    });
    this.resizeObserver.observe(this.container);

    // 4. Orbit Controls (for Desktop)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Don't go far below floor
    this.controls.target.set(0, 1.6, 0);
    this.controls.update();

    // First-person is the default mode. `setCameraMode` is a no-op when the
    // requested mode is already current, so we initialize the first-person
    // state directly here: disable orbit controls, seed the yaw/pitch euler
    // from the camera's current orientation, and clear any stale key state.
    if (this.cameraMode === 'first-person') {
      this.controls.enabled = false;
      this.fpEuler.setFromQuaternion(this.camera.quaternion);
      this.keysPressed = {};
    }

    // 5. Lighting
    this.ambientLight = new THREE.AmbientLight('#ffffff', 1.2);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight('#00f0ff', 1.5);
    this.dirLight.position.set(10, 20, 10);
    this.dirLight.castShadow = true;
    this.applyShadowSettings();
    this.scene.add(this.dirLight);

    // Secondary rim/accent light
    const purpleLight = new THREE.DirectionalLight('#a855f7', 0.8);
    purpleLight.position.set(-10, 10, -10);
    this.scene.add(purpleLight);

    // 6. Floor & Grid
    this.createFloor();

    // 7. WebXR Setup
    this.setupXR();

    // 8. Event Listeners
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('click', this.onCanvasClickForLock);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMoveForLook);

    // 9. Start Loop
    this.renderer.setAnimationLoop(this.animate);
  }

  private createFloor(): void {
    // Floor collider mesh (invisible or subtle)
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.7,
      metalness: 0.3
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.floorMesh.name = 'WorldFloor';
    this.scene.add(this.floorMesh);

    // Futuristic Neon Grid
    this.gridHelper = new THREE.GridHelper(60, 60, '#00f0ff', '#1e293b');
    this.gridHelper.position.y = 0.01;
    this.gridHelper.name = 'WorldGrid';
    this.scene.add(this.gridHelper);
  }

  private setupXR(): void {
    try {
      this.vrButtonElement = VRButton.createButton(this.renderer);
      this.vrButtonElement.style.display = 'none'; // We can trigger it from our custom React HUD
      document.body.appendChild(this.vrButtonElement);

      const controllerModelFactory = new XRControllerModelFactory();

      // Controller 1
      this.controller1 = this.renderer.xr.getController(0);
      this.scene.add(this.controller1);

      this.controllerGrip1 = this.renderer.xr.getControllerGrip(0);
      this.controllerGrip1.add(controllerModelFactory.createControllerModel(this.controllerGrip1));
      this.scene.add(this.controllerGrip1);

      // Controller 2
      this.controller2 = this.renderer.xr.getController(1);
      this.scene.add(this.controller2);

      this.controllerGrip2 = this.renderer.xr.getControllerGrip(1);
      this.controllerGrip2.add(controllerModelFactory.createControllerModel(this.controllerGrip2));
      this.scene.add(this.controllerGrip2);

      // Add laser rays to controllers
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -5)
      ]);
      const material = new THREE.LineBasicMaterial({ color: '#00f0ff' });
      const line1 = new THREE.Line(geometry, material);
      const line2 = new THREE.Line(geometry.clone(), material.clone());
      line1.name = 'laser';
      line2.name = 'laser';
      line1.scale.z = 5;
      line2.scale.z = 5;
      this.controller1.add(line1);
      this.controller2.add(line2);

      this.renderer.xr.addEventListener('sessionstart', () => {
        this.isVRMode = true;
      });
      this.renderer.xr.addEventListener('sessionend', () => {
        this.isVRMode = false;
      });
    } catch (err) {
      console.warn('WebXR setup failed or unsupported in this browser:', err);
    }
  }

  public enterVR(): void {
    if (this.vrButtonElement) {
      this.vrButtonElement.click();
    }
  }

  public registerUpdateCallback(callback: SceneUpdateCallback): () => void {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  public updateSettings(newSettings: Partial<GraphicsSettings>): void {
    this.settings = { ...this.settings, ...newSettings };

    // Apply resolution scale
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * this.settings.resolutionScale, 2));

    // Apply shadows
    this.applyShadowSettings();
  }

  private applyShadowSettings(): void {
    if (this.settings.shadowQuality === 'off') {
      this.renderer.shadowMap.enabled = false;
      this.dirLight.castShadow = false;
    } else {
      this.renderer.shadowMap.enabled = true;
      this.dirLight.castShadow = true;
      let mapSize = 1024;
      if (this.settings.shadowQuality === 'low') mapSize = 512;
      if (this.settings.shadowQuality === 'medium') mapSize = 1024;
      if (this.settings.shadowQuality === 'high') mapSize = 2048;
      if (this.settings.shadowQuality === 'ultra') mapSize = 4096;

      this.dirLight.shadow.mapSize.width = mapSize;
      this.dirLight.shadow.mapSize.height = mapSize;
      this.dirLight.shadow.camera.near = 0.5;
      this.dirLight.shadow.camera.far = 50;
      const d = 15;
      this.dirLight.shadow.camera.left = -d;
      this.dirLight.shadow.camera.right = d;
      this.dirLight.shadow.camera.top = d;
      this.dirLight.shadow.camera.bottom = -d;
      this.dirLight.shadow.bias = -0.0005;
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null as any;
      }
    }
  }

  private onWindowResize = (): void => {
    if (!this.container) return;
    const width = Math.max(this.container.clientWidth || window.innerWidth || 1024, 1);
    const height = Math.max(this.container.clientHeight || window.innerHeight || 768, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = (time: number): void => {
    const delta = (time - this.lastTime) / 1000;
    this.lastTime = time;

    // FPS calculation
    this.frameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 1.0) {
      this.stats.fps = Math.round(this.frameCount / this.fpsTimer);
      this.stats.drawCalls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    if (!this.isVRMode) {
      if (this.cameraMode === 'orbit') {
        this.controls.update();
      } else if (this.cameraMode === 'first-person') {
        this.updateFirstPersonMovement(delta);
      }
    }

    // Call registered animation listeners
    for (const callback of this.updateCallbacks) {
      callback(delta, time / 1000);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
    if (this.cameraMode === 'first-person') {
      this.keysPressed[e.code] = true;
    } else if (this.cameraMode === 'orbit') {
      if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        this.camera.position.y = Math.max(0.4, this.camera.position.y - 0.3);
        this.controls.target.y = Math.max(0.2, this.controls.target.y - 0.3);
        this.controls.update();
      } else if (e.code === 'Space') {
        this.camera.position.y += 0.3;
        this.controls.target.y += 0.3;
        this.controls.update();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysPressed[e.code] = false;
  };

  private onCanvasClickForLock = (): void => {
    if (this.cameraMode === 'first-person' && !this.isVRMode && !this.isPointerLocked) {
      this.renderer.domElement.requestPointerLock();
    }
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = (document.pointerLockElement === this.renderer.domElement);
  };

  private onMouseMoveForLook = (e: MouseEvent): void => {
    // Only rotate the camera when pointer lock is active (user clicked the
    // canvas to enter mouselook mode). Removing the `e.buttons === 1` fallback
    // prevents left-click-drag from rotating the camera when the user is
    // interacting with the TransformControls gizmo (selecting, translating,
    // rotating, or scaling objects).
    if (this.cameraMode === 'first-person' && !this.isVRMode && this.isPointerLocked) {
      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;
      this.fpEuler.setFromQuaternion(this.camera.quaternion);
      this.fpEuler.y -= movementX * 0.003;
      this.fpEuler.x -= movementY * 0.003;
      // Clamp pitch so we don't do backflips
      this.fpEuler.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.fpEuler.x));
      this.camera.quaternion.setFromEuler(this.fpEuler);
    }
  };

  private updateFirstPersonMovement(delta: number): void {
    let speed = (this.keysPressed['ShiftLeft'] || this.keysPressed['ShiftRight'] ? 8.0 : 4.0) * delta;
    if (this.locomotionMode === 'flight') speed *= 1.5;
    if (this.locomotionMode === 'noclip') speed *= 3.0; // Fast noclip speed

    const moveDir = new THREE.Vector3();
    
    if (this.keysPressed['KeyW'] || this.keysPressed['ArrowUp']) moveDir.z -= 1;
    if (this.keysPressed['KeyS'] || this.keysPressed['ArrowDown']) moveDir.z += 1;
    if (this.keysPressed['KeyA'] || this.keysPressed['ArrowLeft']) moveDir.x -= 1;
    if (this.keysPressed['KeyD'] || this.keysPressed['ArrowRight']) moveDir.x += 1;

    // Handle vertical movement depending on locomotion mode
    if (this.locomotionMode === 'walk') {
      // Jumping
      if (this.keysPressed['Space'] && this.isGrounded) {
        this.verticalVelocity = 6.5; // Jump impulse
        this.isGrounded = false;
      }
      // Gravity
      this.verticalVelocity -= 18.0 * delta;
      this.camera.position.y += this.verticalVelocity * delta;

      // Floor collision
      if (this.camera.position.y <= 1.6) {
        this.camera.position.y = 1.6;
        this.verticalVelocity = 0;
        this.isGrounded = true;
      }
    } else {
      // Flight and Noclip: Space ascends, C / Ctrl descends
      if (this.keysPressed['Space']) moveDir.y += 1;
      if (this.keysPressed['KeyC'] || this.keysPressed['ControlLeft']) moveDir.y -= 1;
    }

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
      if (this.locomotionMode === 'walk') {
        // Yaw only for walk so forward stays parallel to floor
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.fpEuler.y);
        moveDir.applyQuaternion(yawQuat);
      } else {
        // Flight / noclip allows flying towards pitch direction
        moveDir.applyQuaternion(this.camera.quaternion);
      }
      
      const targetPos = this.camera.position.clone().addScaledVector(moveDir, speed);

      // Simple collision prevention for walk and flight (noclip has NO collision!)
      if (this.locomotionMode !== 'noclip') {
        if (targetPos.y < 0.8) targetPos.y = 0.8;
      }
      this.camera.position.copy(targetPos);
    }

    // Floor height boundary for flight mode
    if (this.locomotionMode === 'flight' && this.camera.position.y < 0.8) {
      this.camera.position.y = 0.8;
    }
  }

  public setCameraMode(mode: 'orbit' | 'first-person'): void {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;

    if (mode === 'first-person') {
      this.controls.enabled = false;
      this.fpEuler.setFromQuaternion(this.camera.quaternion);
      this.camera.position.y = 1.6; // Average eye height
      this.keysPressed = {};
    } else {
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock();
      }
      this.controls.enabled = true;
      // Point orbit target 3 units in front of camera
      const forward = new THREE.Vector3(0, 0, -3).applyQuaternion(this.camera.quaternion);
      this.controls.target.copy(this.camera.position).add(forward);
      this.controls.update();
    }
  }

  public focusOnObject(object: THREE.Object3D): void {
    if (this.cameraMode === 'first-person') {
      this.setCameraMode('orbit');
    }
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      this.controls.target.copy(center);
      const maxDim = Math.max(size.x, size.y, size.z, 1.0);
      const dist = Math.max(maxDim * 1.6, 2.5);
      
      // Calculate a smooth camera position slightly elevated and back
      const offset = new THREE.Vector3(0, size.y * 0.3 + 0.5, dist);
      this.camera.position.copy(center).add(offset);
      this.controls.update();
    }
  }

  public dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClickForLock);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMoveForLook);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    if (this.vrButtonElement && this.vrButtonElement.parentNode) {
      this.vrButtonElement.parentNode.removeChild(this.vrButtonElement);
    }
  }
}
