import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRInputManager } from './VRInputManager.ts';
import { SpatialPanelManager } from './SpatialPanelManager.ts';

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

  /**
   * CameraRig: parent of `camera`. In active VR, we move + yaw this rig
   * so the HMD-tracked camera follows — Three.js rewrites the camera's
   * own matrix each frame from the headset pose, so we cannot simply
   * write `camera.position`/`camera.rotation` for locomotion. Before VR
   * presents, the rig sits at identity so existing desktop fpMovement
   * keeps treating `camera.position` as world coordinates (the unchanged
   * sessionend cleanup below also collapses the rig back to identity).
   */
  public cameraRig: THREE.Group = new THREE.Group();

  /**
   * WorldRoot: parent for every object the user perceives as "the world"
   * (floor, grid, spawned assets, peer avatars). Three.js's WebXRManager
   * writes the HMD pose directly to the camera's WORLD matrix, bypassing
   * any rig parenting — so `cameraRig.position += …` has zero effect on
   * what the user sees in VR. The canonical pattern (used by Resonite,
   * NeosVR, and most three.js WebVR demos) is the inverse-treadmill:
   * contents live under `worldRoot`, and we move `worldRoot` in the
   * OPPOSITE direction of intended camera motion. From the user's POV
   * their view stays HMD-tracked while the world slides beneath them,
   * which perceptually is identical to "I moved forward" / "I jumped".
   * Desktop mode leaves `worldRoot` at identity so the scene graph
   * stays exactly where `scene.add(...)` previously put things.
   */
  public worldRoot: THREE.Group = new THREE.Group();

  /**
   * Per-frame gamepad poller. `enabled` flips via the XR sessionstart /
   * sessionend listeners; while disabled it returns zeroed state every
   * poll so the locomotion branch can unify even pre-VR.
   */
  public vrInput: VRInputManager | null = null;

  /** Manages CSS3DRenderer (desktop) and HTMLMesh (VR) for spatial panels. */
  public spatialPanelManager!: SpatialPanelManager;

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
  // Toggled by the Z key (per Controls-Keybinds.txt). When true, walking
  // movement in any locomotion mode slows to ~30% of base speed. Persists
  // across orbit <-> first-person mode switches until pressed again.
  public slowMovement = false;
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

    // Reparent the camera under `cameraRig` so VR locomotion can later
    // translate/rotate the rig without the HMD-tracked camera matrices
    // (rewritten by `renderer.xr` every frame in an active session)
    // overwriting our changes. Before VR presents, the rig is parked at
    // identity so existing desktop fpMovement that writes camera.position
    // keeps working unchanged (camera.position local == world with rig=id).
    this.scene.add(this.cameraRig);
    this.cameraRig.add(this.camera);
    // WorldRoot stays a sibling of the cameraRig under `scene` — see the
    // field-level docstring for why we route VR locomotion through world
    // translations instead of camera translations.
    this.scene.add(this.worldRoot);

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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.xr.enabled = true;
    
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    // Spatial panel manager — must be created after the WebGL canvas is in the DOM
    this.spatialPanelManager = new SpatialPanelManager(this.container);

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
    // Parented to worldRoot (not scene) so the lights rotate with the
    // world when the VR player smooth-turns (right thumbstick). Without
    // this, the world appears to rotate around the player via
    // worldRoot.rotation but the lights stay anchored to the player's
    // view — shadows on the floor don't shift and the sun direction
    // looks "stuck" relative to the spinning avatar. In IRL, the sun's
    // apparent position changes as you turn in place, so the shadow
    // direction must follow the world frame. The dirLight + its default
    // target at origin both live in worldRoot, so the relative geometry
    // (light 10m from origin in X, 20m in Y) is preserved through any
    // inverse-treadmill translation or smooth-turn rotation — the 15-unit
    // shadow ortho frustum (applyShadowSettings) continues to cover the
    // floor at worldRoot local origin.
    this.ambientLight = new THREE.AmbientLight('#ffffff', 1.2);
    this.worldRoot.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight('#00f0ff', 1.5);
    this.dirLight.position.set(10, 20, 10);
    this.dirLight.castShadow = true;
    this.applyShadowSettings();
    this.worldRoot.add(this.dirLight);

    // Secondary rim/accent light
    const purpleLight = new THREE.DirectionalLight('#a855f7', 0.8);
    purpleLight.position.set(-10, 10, -10);
    this.worldRoot.add(purpleLight);

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
    // Parented to worldRoot so VR locomotion (which translates worldRoot
    // inversely) carries the floor with the simulated motion. Desktop
    // modes leave worldRoot at identity so this is effectively the
    // same as the original `scene.add`.
    this.worldRoot.add(this.floorMesh);

    // Futuristic Neon Grid
    this.gridHelper = new THREE.GridHelper(60, 60, '#00f0ff', '#1e293b');
    this.gridHelper.position.y = 0.01;
    this.gridHelper.name = 'WorldGrid';
    this.worldRoot.add(this.gridHelper);
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

      // Wire the WebXR gamepad onto each controller's userData so
      // VRInputManager.update() can poll it. Three.js fires 'connected'
      // once the session discovers the device and 'disconnected' when it
      // drops (controller powered off, headset dozes, etc.) — when the
      // gamepad goes away mid-grab, VRInputManager will synthesize a
      // press-release so subscribers don't get stuck in a down state.
      this.controller1.addEventListener('connected', (e: any) => {
        const ud = this.controller1.userData as {
          inputSource?: { gamepad?: unknown; handedness?: XRHandedness } | null;
          handedness?: XRHandedness;
        };
        // Cache the XRInputSource itself, not its `gamepad` snapshot.
        // Under the WebXR spec the underlying gamepad object can be a
        // static snapshot — caching its reference and reading it later
        // would lock axes at [0,0] forever, breaking locomotion. Re-
        // reading `.gamepad` off the live inputSource each frame
        // (VRInputManager.update does this) keeps the values fresh.
        ud.inputSource = e.data ?? null;
        // The XRInputSource's `handedness` string is the device's
        // reported dominant-hand assignment — we stash it so
        // VRInputManager.update() can resolve which side maps to which
        // render index. Without this, a left-handed Quest user would
        // have A/B/grip rebound to the wrong physical hand.
        ud.handedness = e.data?.handedness ?? 'unknown';
      });
      this.controller1.addEventListener('disconnected', () => {
        const ud = this.controller1.userData as {
          inputSource?: { gamepad?: unknown; handedness?: XRHandedness } | null;
          handedness?: XRHandedness;
        };
        ud.inputSource = null;
        ud.handedness = undefined;
      });
      this.controller2.addEventListener('connected', (e: any) => {
        const ud = this.controller2.userData as {
          inputSource?: { gamepad?: unknown; handedness?: XRHandedness } | null;
          handedness?: XRHandedness;
        };
        ud.inputSource = e.data ?? null;
        ud.handedness = e.data?.handedness ?? 'unknown';
      });
      this.controller2.addEventListener('disconnected', () => {
        const ud = this.controller2.userData as {
          inputSource?: { gamepad?: unknown; handedness?: XRHandedness } | null;
          handedness?: XRHandedness;
        };
        ud.inputSource = null;
        ud.handedness = undefined;
      });

      // Construct the input manager now so handlers can subscribe via
      // `vrInput.setHandlers(...)` BEFORE the user enters VR. It's
      // marked disabled until sessionstart, during which time every
      // poll returns zeroed state.
      this.vrInput = new VRInputManager(
        this.controller1, this.controllerGrip1,
        this.controller2, this.controllerGrip2
      );

      this.renderer.xr.addEventListener('sessionstart', () => {
        this.isVRMode = true;
        this.vrInput?.setEnabled(true);
        this.spatialPanelManager?.enterVR(this.controller1, this.controller2, this.renderer, this.camera);
      });
      this.renderer.xr.addEventListener('sessionend', () => {
        this.isVRMode = false;
        this.vrInput?.setEnabled(false);
        // Collapse the rig back to identity in world space so desktop
        // fpMovement can keep treating `camera.position` as world
        // coordinates (matching what it did before this rig was added).
        // Without this, leaving VR while standing 3m from origin leaves
        // the desktop camera floating 3m above the floor.
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        this.camera.getWorldPosition(worldPos);
        this.camera.getWorldQuaternion(worldQuat);
        this.cameraRig.position.set(0, 0, 0);
        this.cameraRig.quaternion.identity();
        this.camera.position.copy(worldPos);
        this.camera.quaternion.copy(worldQuat);
        this.fpEuler.setFromQuaternion(this.camera.quaternion);
        // Also collapse worldRoot back to identity. worldRoot was drifted
        // during VR locomotion (inverse-treadmill translation + smooth-
        // turn rotation); leaving it offset would leave the desktop user
        // seeing the floor in a translated/rotated frame, which would
        // look like they got arbitrarily teleported on leaving VR.
        this.worldRoot.position.set(0, 0, 0);
        this.worldRoot.rotation.set(0, 0, 0);
        this.spatialPanelManager?.exitVR();
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
    this.spatialPanelManager?.onResize(width, height);
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

    if (this.isVRMode) {
      // VR locomotion reads from `vrInput.left.stick` / `right.stick`
      // and writes to `cameraRig` (the HMD-tracked camera's own matrix
      // is overwritten by `renderer.xr` each frame from the headset
      // pose, so we cannot write to it directly). The non-VR branches
      // below stay exactly as before — desktop fpMovement continues to
      // drive `camera.position` and OrbitControls remains authoritative
      // for orbit mode.
      this.vrInput?.update();
      this.updateVRLocomotion(delta);
      this.updateVRSmoothTurn(delta);
      // Walk-mode gravity (VR mirror of desktop's Space-jump branch).
      // Desktop `updateFirstPersonMovement` owns the integration but is
      // gated by `!this.isVRMode`, so VR needs its own copy or the user
      // floats forever after pressing A (triggerVRJump sets vv=6.5 but
      // nothing applies it). Implementation: the inertial treadmill — vv
      // positive = user rises = worldRoot Y drops, vv negative = user
      // sinks = worldRoot Y rises back. Clamp on `worldRoot.y > 0` keeps
      // the floor at-or-below origin so the HMD-tracked eye height
      // (~1.6m) means the user is always at least eye-height above the
      // floor — matches desktop fpMovement's standing-height grounding.
      // Note: rig.position.y is intentionally left alone here — three.js
      // bypasses rig parenting during an active XR session so writing
      // to it would have no effect on what the user sees.
      if (this.locomotionMode === 'walk') {
        this.verticalVelocity -= 18.0 * delta;
        this.worldRoot.position.y -= this.verticalVelocity * delta;
        if (this.worldRoot.position.y > 0) {
          this.worldRoot.position.y = 0;
          this.verticalVelocity = 0;
          this.isGrounded = true;
        }
      }
    } else {
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
    // CSS3DRenderer overlay — renders after WebGL so panels appear in front
    this.spatialPanelManager?.render(this.scene, this.camera);
    // Crosshair hover: find panel element under screen center while locked
    if (this.isPointerLocked && this.spatialPanelManager) {
      const cx = (this.container.clientWidth  || window.innerWidth)  / 2;
      const cy = (this.container.clientHeight || window.innerHeight) / 2;
      this.spatialPanelManager.updateLockedHover(cx, cy);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

    // Z key — toggle slow movement (per Controls-Keybinds.txt). Read by
    // updateFirstPersonMovement independently of keysPressed, so toggling
    // works in both first-person and orbit camera modes.
    if (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') {
      this.slowMovement = !this.slowMovement;
      return;
    }

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
    const wasLocked = this.isPointerLocked;
    this.isPointerLocked = (document.pointerLockElement === this.renderer.domElement);
    // Clear any stale panel hover state when the user unlocks the cursor
    if (wasLocked && !this.isPointerLocked) {
      this.spatialPanelManager?.clearLockedHover();
    }
  };

  private onMouseMoveForLook = (e: MouseEvent): void => {
    // Only rotate the camera when pointer lock is active (user clicked the
    // canvas to enter mouselook mode). Removing the `e.buttons === 1` fallback
    // prevents left-click-drag from rotating the camera when the user is
    // interacting with the TransformControls gizmo (selecting, translating,
    // rotating, or scaling objects).
    //
    // Also suppress look if the focused element is inside a spatial panel
    // (the user is typing in an input). CSS3DObject elements live inside the
    // spatialPanelManager overlay which is outside the WebGL canvas, so
    // checking tagName is sufficient.
    const focusedTag = (document.activeElement as HTMLElement)?.tagName ?? '';
    const focusInPanel = ['INPUT', 'TEXTAREA', 'SELECT'].includes(focusedTag);
    if (this.cameraMode === 'first-person' && !this.isVRMode && this.isPointerLocked && !(window as any).__isRadialMenuOpen && !focusInPanel) {
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
    if (this.slowMovement) speed *= 0.3; // Z-key slow-movement toggle

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

  // ===========================================================================
  // VR locomotion (left thumbstick) + smooth-turn (right thumbstick X)
  // ===========================================================================
  // These run ONLY while `isVRMode === true` (gated by `animate`). Both
  // write to `cameraRig`, never to `camera` itself: Three.js' XR manager
  // resets `camera.matrixWorld` from the headset pose every frame, so
  // direct writes to `camera.position`/`camera.rotation` would be lost.
  private updateVRLocomotion(delta: number): void {
    if (!this.vrInput) return;
    const ls = this.vrInput.left.stick;
    if (Math.abs(ls.x) < 1e-4 && Math.abs(ls.y) < 1e-4) return;

    // Mirror desktop keyboard normalization so the same per-mode speed
    // scale (walk/flight/noclip/slow/Z) carries over to sticks without
    // users having to relearn "how fast does pushing forward feel".
    let speed = (this.keysPressed['ShiftLeft'] || this.keysPressed['ShiftRight'] ? 8.0 : 4.0) * delta;
    if (this.locomotionMode === 'flight') speed *= 1.5;
    if (this.locomotionMode === 'noclip') speed *= 3.0;
    if (this.slowMovement) speed *= 0.3;

    // Gamepad convention: stick pushed away (positive y) = forward.
    // Camera local forward is -Z, so a forward push should map move.z
    // to -1. The Quest browser inverts axes[3] (reports ls.y < 0 on
    // forward push), so we drop the negation here and instead flip
    // the flight-vertical sign below. For a W3C-spec device ls.y > 0
    // on forward push, the move would be inverted relative to this
    // change — re-introduce the negation if you ever verify a spec
    // device is reporting the opposite.
    const move = this._vrMoveTmp.set(ls.x, 0, ls.y);
    if (move.lengthSq() < 1e-6) return;
    move.normalize();

    // Yaw-only rotation so forward stays parallel to floor in walk mode
    // — flying/noclip also use yaw here so the avatar doesn't tilt when
    // the user pitches their head up to look at something.
    const yaw = this.getCameraWorldYaw();
    const yawQuat = this._vrYawTmp.setFromAxisAngle(this._vrUpVec, yaw);
    move.applyQuaternion(yawQuat);

    // Vertical stick-based movement for flight/noclip: hold stick up to
    // rise, stick down to fall. Walk mode ignores vertical; jumping is
    // handled by `triggerVRJump()` via the A-button edge callback.
    if (this.locomotionMode !== 'walk') {
      // Flight/noclip: hold stick forward to rise, back to fall. Sign
      // flipped alongside the move.z change above to keep the in-Quest
      // convention consistent: a forward stick push (ls.y < 0 on the
      // browser's reversed mapping) now translates +Y in flight mode.
      move.y = ls.y > 0 ? -1 : (ls.y < 0 ? 1 : 0);
    }

    // Treadmill locomotion: move worldRoot in the OPPOSITE direction of
    // intended camera motion. Negated speed so stick-forward pushes the
    // world BACK, which perceptually reads as "I'm walking forward". The
    // rig path that previously sat here was a no-op in VR (three.js
    // writes the HMD pose straight to camera.matrixWorld, ignoring any
    // scene-graph ancestors), so the user saw zero motion regardless of
    // the stick input.
    this.worldRoot.position.addScaledVector(move, -speed);

    // Flight-mode floor clamp (walk handled separately by gravity in
    // `animate()`; noclip has no clamp). World camera height is purely
    // the HMD-tracked pose (≈1.6m), so to enforce eye ≥ 0.8m above the
    // floor we need floor world.y ≤ eye − 0.8 = 0.8. The floor is at
    // worldRoot's local origin, so its world Y equals worldRoot.y;
    // clamp `worldRoot.y > 0.8` to 0.8. Old rig-based attempt with
    // `<= -0.8` had a sign error — would have let users grow to
    // ~3.3 m tall in flight mode (caught by code review pre-merge).
    if (this.locomotionMode === 'flight' && this.worldRoot.position.y > 0.8) {
      this.worldRoot.position.y = 0.8;
    }
  }

  private updateVRSmoothTurn(delta: number): void {
    if (!this.vrInput) return;
    const ts = this.vrInput.right.stick.x;
    if (Math.abs(ts) < 1e-4) return;
    // ~90 °/s — fast enough to feel responsive, slow enough to keep
    // sensitive users from getting motion-sick. Negative ts is "left"
    // (user pushes stick left), so we yield a right-handed yaw on
    // worldRoot in the same direction the head would turn — perceptually
    // the world's horizon rotates opposite-to-ts and the user feels
    // they're turning their body in the +ts direction.
    //
    // Pivot fix: the previous implementation wrote `worldRoot.rotation.y`
    // directly, which rotates worldRoot around its LOCAL origin. Since
    // worldRoot.position is at scene (0,0,0) for a freshly-spawned user
    // (and drifts via inverse-treadmill to (-camX, 0, -camZ) once the
    // user has walked), the rotation pivot is at the world origin OR
    // worldRoot's drifted position — neither tracks the user. The user
    // visibly sees the world swing in a wide arc past them instead of
    // "I'm turning in place". Read the HMD-tracked camera's world
    // position and rotate worldRoot around THAT point.
    //
    // Math: rotation by `angle` around point P produces new worldRoot
    // position R(angle) * (oldPos - P) + P. worldRoot.rotation.y is
    // incremented by `angle` so the matrix decomposition stays
    // consistent. Y-only because the world only yaws; floor stays flat.
    const turnRate = 1.6;
    const angle = ts * turnRate * delta;
    this.camera.getWorldPosition(this._vrUserPosTmp);
    this._vrSmoothOffsetTmp.copy(this.worldRoot.position).sub(this._vrUserPosTmp);
    this._vrSmoothOffsetTmp.applyAxisAngle(this._vrUpVec, angle);
    this.worldRoot.position.copy(this._vrSmoothOffsetTmp).add(this._vrUserPosTmp);
    this.worldRoot.rotation.y += angle;
  }

  /**
   * Caller (App.tsx) presses the A button → this fires the same code
   * path that `Space` triggers in desktop fpMovement, sharing the
   * `verticalVelocity`+`isGrounded`+gravity state for clean integration.
   * Flight/noclip ignore jump (vertical movement is driven by the left
   * thumbstick's Y axis in `updateVRLocomotion`, so a single button
   * press doesn't need to lift the user by a synthetic constant).
   */
  public triggerVRJump(): void {
    if (this.locomotionMode !== 'walk') return;
    if (!this.isGrounded) return;
    this.verticalVelocity = 6.5;
    this.isGrounded = false;
  }

  /**
   * Read the camera's world-rotation YAW (ignoring pitch/roll). Used by
   * VR locomotion so the avatar walks "where they're facing" — mirrors
   * desktop fpMovement's `fpEuler.y` derivation but reads world space
   * directly because the rig may have rotated the user base.
   */
  private getCameraWorldYaw(): number {
    const wq = this._vrWorldQuatTmp;
    this.camera.getWorldQuaternion(wq);
    return new THREE.Euler().setFromQuaternion(wq, 'YXZ').y;
  }

  private readonly _vrMoveTmp = new THREE.Vector3();
  private readonly _vrYawTmp = new THREE.Quaternion();
  private readonly _vrWorldQuatTmp = new THREE.Quaternion();
  // Constant unit vector reused via field rather than allocated per frame
  // so we never trigger GC inside the 60-90 Hz render loop.
  private readonly _vrUpVec = new THREE.Vector3(0, 1, 0);
  // Scratch fields for the smooth-turn rotate-around-user math. HMD
  // pose goes into `_vrUserPosTmp`; `_vrSmoothOffsetTmp` holds the
  // worldRoot→user offset rotated by the per-frame turn angle.
  private readonly _vrUserPosTmp = new THREE.Vector3();
  private readonly _vrSmoothOffsetTmp = new THREE.Vector3();

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
    this.spatialPanelManager?.dispose();
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
