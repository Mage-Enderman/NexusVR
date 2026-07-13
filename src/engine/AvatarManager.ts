import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';

export interface AvatarTransform {
  peerId: string;
  headPosition: [number, number, number];
  headRotation: [number, number, number];
  leftHandPosition?: [number, number, number];
  leftHandRotation?: [number, number, number];
  rightHandPosition?: [number, number, number];
  rightHandRotation?: [number, number, number];
  isSpeaking?: boolean;
  vrmUrl?: string;
  isCompanion?: boolean; // If true, do not render duplicate avatar
  controllerType?: 'quest2' | 'quest3';
}

export class PeerAvatar {
  public peerId: string;
  public group: THREE.Group;
  public headMesh: THREE.Mesh | null = null;
  // Typed as Object3D (not Mesh) so the hand node can be a Group holding
  // a stylized controller grip + halo ring, not just a single sphere.
  // The previous purple-sphere representation read as "abstract ball"
  // on a non-VR viewer — a cylinder-grip-with-ring reads unambiguously
  // as "VR controller" even when the viewer has no WebXR session and
  // XRControllerModelFactory cannot resolve the real device model.
  public leftHandMesh: THREE.Object3D | null = null;
  public rightHandMesh: THREE.Object3D | null = null;
  public vrm: VRM | null = null;
  public audioSpeakerMesh: THREE.Mesh | null = null;
  public positionalAudio: THREE.PositionalAudio | null = null;
  public audioElement: HTMLAudioElement | null = null;
  public isSpeaking = false;
  public vrmUrl: string | null = null;

  private hasReceivedFirstUpdate = false;
  private targetHeadPos = new THREE.Vector3();
  private targetHeadQuat = new THREE.Quaternion();
  private targetLeftPos = new THREE.Vector3();
  private targetLeftQuat = new THREE.Quaternion();
  private targetRightPos = new THREE.Vector3();
  private targetRightQuat = new THREE.Quaternion();
  private _scratchEuler = new THREE.Euler();

  constructor(peerId: string, _scene: THREE.Scene, worldRoot: THREE.Object3D) {
    this.peerId = peerId;
    // Peer avatars live on worldRoot (not the raw scene) so they ride
    // along with the local user's simulated motion in VR. Without this
    // a standing peer would stay at fixed scene coordinates while the
    // local user "moves" — the peer would appear to teleport relative
    // to the local viewer on every stick-forward tick.
    this.group = new THREE.Group();
    this.group.name = `Avatar_${peerId}`;
    worldRoot.add(this.group);
    
    this.createDefaultAvatar();
  }

  private createDefaultAvatar(): void {
    // Stylized futuristic head visor
    const headGeo = new THREE.BoxGeometry(0.3, 0.35, 0.3);
    const headMat = new THREE.MeshStandardMaterial({ color: '#00f0ff', roughness: 0.2, metalness: 0.8 });
    this.headMesh = new THREE.Mesh(headGeo, headMat);
    this.headMesh.castShadow = true;
    
    // Glowing eyes visor
    const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.05);
    const visorMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.05, -0.16);
    this.headMesh.add(visor);

    this.group.add(this.headMesh);

    // Stylized VR controller (replaces the previous purple sphere).
    // A short cylindrical grip + a purple torus ring at the thumbstick
    // position reads as a generic controller from any viewing angle, and
    // uses the same purple as the old sphere so the avatar's color
    // language stays consistent. No external assets / no async loading
    // — important because peer avatars are spawned synchronously on
    // every 'av' envelope arrival and shouldn't block on a fetch.
    const createControllerMesh = (): THREE.Group => {
      const group = new THREE.Group();
      // Grip body — slightly tapered cylinder, rotated to point
      // forward (the controller's "business end"). Sized to ~12cm to
      // match a real Quest Touch controller's length.
      const gripGeo = new THREE.CylinderGeometry(0.022, 0.025, 0.12, 16);
      const gripMat = new THREE.MeshStandardMaterial({ color: '#2a2a35', roughness: 0.6, metalness: 0.3 });
      const grip = new THREE.Mesh(gripGeo, gripMat);
      grip.rotation.x = Math.PI / 2 + 0.25;
      group.add(grip);
      // Thumbstick ring — a thin purple torus on top of the grip.
      // Same #a855f7 as the old sphere, so the avatar still has a
      // purple accent that pairs with the cyan head.
      const ringGeo = new THREE.TorusGeometry(0.028, 0.006, 12, 24);
      const ringMat = new THREE.MeshStandardMaterial({ color: '#a855f7', roughness: 0.3, emissive: '#3b1d6e', emissiveIntensity: 0.4 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.name = 'ring';
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.025, 0.02);
      group.add(ring);
      return group;
    };

    // Left hand
    this.leftHandMesh = createControllerMesh();
    this.leftHandMesh.position.set(-0.3, -0.3, -0.2);
    this.group.add(this.leftHandMesh);

    // Right hand
    this.rightHandMesh = createControllerMesh();
    this.rightHandMesh.position.set(0.3, -0.3, -0.2);
    this.group.add(this.rightHandMesh);

    // Speaking indicator halo ring
    const ringGeo = new THREE.TorusGeometry(0.25, 0.015, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#00f0ff', transparent: true, opacity: 0 });
    this.audioSpeakerMesh = new THREE.Mesh(ringGeo, ringMat);
    this.audioSpeakerMesh.rotation.x = Math.PI / 2;
    this.audioSpeakerMesh.position.y = -0.25;
    this.headMesh.add(this.audioSpeakerMesh);
  }

  public async loadVRM(url: string, loader: GLTFLoader): Promise<void> {
    if (this.vrmUrl === url) return;
    this.vrmUrl = url;

    try {
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM;
      if (vrm) {
        // Remove default stylized meshes
        if (this.headMesh) this.group.remove(this.headMesh);
        if (this.leftHandMesh) this.group.remove(this.leftHandMesh);
        if (this.rightHandMesh) this.group.remove(this.rightHandMesh);

        this.vrm = vrm;
        vrm.scene.rotation.y = Math.PI; // Face forward
        this.group.add(vrm.scene);
      }
    } catch (err) {
      console.warn(`Failed to load VRM for peer ${this.peerId}:`, err);
    }
  }

  public updateTransform(transform: AvatarTransform): void {
    if (transform.isCompanion) {
      this.group.visible = false;
      return;
    } else {
      this.group.visible = true;
    }

    this.targetHeadPos.set(...transform.headPosition);
    this._scratchEuler.set(...transform.headRotation);
    this.targetHeadQuat.setFromEuler(this._scratchEuler);

    if (transform.leftHandPosition) {
      this.targetLeftPos.set(...transform.leftHandPosition);
      this._scratchEuler.set(...(transform.leftHandRotation || [0, 0, 0]));
      this.targetLeftQuat.setFromEuler(this._scratchEuler);
    }
    if (transform.rightHandPosition) {
      this.targetRightPos.set(...transform.rightHandPosition);
      this._scratchEuler.set(...(transform.rightHandRotation || [0, 0, 0]));
      this.targetRightQuat.setFromEuler(this._scratchEuler);
    }

    if (!this.hasReceivedFirstUpdate) {
      this.hasReceivedFirstUpdate = true;
      if (this.headMesh) {
        this.headMesh.position.copy(this.targetHeadPos);
        this.headMesh.quaternion.copy(this.targetHeadQuat);
      }
      if (this.leftHandMesh && transform.leftHandPosition) {
        this.leftHandMesh.position.copy(this.targetLeftPos);
        this.leftHandMesh.quaternion.copy(this.targetLeftQuat);
      }
      if (this.rightHandMesh && transform.rightHandPosition) {
        this.rightHandMesh.position.copy(this.targetRightPos);
        this.rightHandMesh.quaternion.copy(this.targetRightQuat);
      }
    }

    if (this.leftHandMesh) {
      const ring = this.leftHandMesh.getObjectByName('ring');
      if (ring) ring.visible = transform.controllerType !== 'quest3';
    }
    if (this.rightHandMesh) {
      const ring = this.rightHandMesh.getObjectByName('ring');
      if (ring) ring.visible = transform.controllerType !== 'quest3';
    }

    // Speaking indicator halo pulse
    this.isSpeaking = !!transform.isSpeaking;
    if (this.audioSpeakerMesh && this.audioSpeakerMesh.material) {
      const mat = this.audioSpeakerMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = this.isSpeaking ? 0.9 : 0;
      if (this.isSpeaking) {
        this.audioSpeakerMesh.scale.setScalar(1 + Math.sin(performance.now() * 0.01) * 0.15);
      }
    }
  }

  public update(delta: number): void {
    if (!this.hasReceivedFirstUpdate) return;
    const alpha = 1 - Math.exp(-22 * Math.min(delta, 0.1));

    if (this.headMesh) {
      this.headMesh.position.lerp(this.targetHeadPos, alpha);
      this.headMesh.quaternion.slerp(this.targetHeadQuat, alpha);
    }
    if (this.leftHandMesh) {
      this.leftHandMesh.position.lerp(this.targetLeftPos, alpha);
      this.leftHandMesh.quaternion.slerp(this.targetLeftQuat, alpha);
    }
    if (this.rightHandMesh) {
      this.rightHandMesh.position.lerp(this.targetRightPos, alpha);
      this.rightHandMesh.quaternion.slerp(this.targetRightQuat, alpha);
    }
    if (this.vrm) {
      this.vrm.scene.position.lerp(this.targetHeadPos, alpha);
      this.vrm.scene.position.y = this.targetHeadPos.y - 1.5;
      this.vrm.update(delta);
    }
  }

  public attachAudioStream(stream: MediaStream, listener: THREE.AudioListener): void {
    if (!this.headMesh) return;

    // Browsers suspend the AudioContext until a user gesture. Resume it
    // as soon as we have a remote stream so positional audio actually plays.
    listener.context.resume().catch(() => {});

    if (this.positionalAudio) {
      if (this.positionalAudio.isPlaying) this.positionalAudio.stop();
      this.headMesh.remove(this.positionalAudio);
    }

    // Keep a hidden <audio> element attached to the stream so the browser
    // doesn't garbage-collect / suspend the WebRTC audio track.
    if (this.audioElement) {
      try { this.audioElement.pause(); } catch { /* noop */ }
      this.audioElement = null;
    }
    const audioEl = document.createElement('audio');
    audioEl.srcObject = stream;
    audioEl.muted = true;
    audioEl.setAttribute('playsinline', 'true');
    audioEl.play().catch(() => {});
    this.audioElement = audioEl;

    const audio = new THREE.PositionalAudio(listener);
    const audioNode = audio.context.createMediaStreamSource(stream);
    audio.setNodeSource(audioNode as any);
    // Tighter distance attenuation so voices get noticeably quieter with
    // distance and directional cues are perceptible at conversational range.
    audio.setRefDistance(0.8);
    audio.setMaxDistance(40);
    audio.setRolloffFactor(1.2);
    audio.setDistanceModel('inverse');
    // Slight directionality: a peer facing away is a little quieter, which
    // reinforces the "voice comes from the head" illusion without muting
    // anyone when they turn around.
    audio.setDirectionalCone(180, 230, 0.15);

    this.positionalAudio = audio;
    this.headMesh.add(audio);
  }

  public dispose(_scene?: THREE.Scene): void {
    if (this.positionalAudio && this.positionalAudio.isPlaying) {
      try { this.positionalAudio.stop(); } catch { /* noop */ }
    }
    if (this.audioElement) {
      try { this.audioElement.pause(); this.audioElement.srcObject = null; } catch { /* noop */ }
      this.audioElement = null;
    }
    this.group.traverse((child) => {
      if ((child as THREE.Mesh).geometry) {
        (child as THREE.Mesh).geometry.dispose();
      }
      if ((child as THREE.Mesh).material) {
        const m = (child as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach(mat => mat.dispose());
        else m.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

export class AvatarManager {
  private scene: THREE.Scene;
  private worldRoot: THREE.Object3D;
  public audioListener: THREE.AudioListener;
  private gltfLoader: GLTFLoader;
  public peers: Map<string, PeerAvatar> = new Map();
  public localVrmUrl: string | null = null;
  public localVrm: VRM | null = null;
  private _scratchPos = new THREE.Vector3();
  private _scratchQuat = new THREE.Quaternion();
  private _scratchRootInvQuat = new THREE.Quaternion();
  private _scratchEuler = new THREE.Euler();

  constructor(scene: THREE.Scene, camera: THREE.Camera, worldRoot: THREE.Object3D) {
    this.scene = scene;
    this.worldRoot = worldRoot;
    this.audioListener = new THREE.AudioListener();
    camera.add(this.audioListener);

    this.gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader.setDRACOLoader(dracoLoader);
    this.gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
  }

  public getAudioListener(): THREE.AudioListener {
    return this.audioListener;
  }

  public async loadLocalVRM(file: File): Promise<VRM | null> {
    try {
      const url = URL.createObjectURL(file);
      this.localVrmUrl = url;
      const gltf = await this.gltfLoader.loadAsync(url);
      this.localVrm = gltf.userData.vrm as VRM;
      return this.localVrm;
    } catch (err) {
      console.error('Failed to load local VRM:', err);
      return null;
    }
  }

  public updatePeerAvatar(transform: AvatarTransform): void {
    let peer = this.peers.get(transform.peerId);
    if (!peer) {
      peer = new PeerAvatar(transform.peerId, this.scene, this.worldRoot);
      this.peers.set(transform.peerId, peer);
    }

    if (transform.vrmUrl && transform.vrmUrl !== peer.vrmUrl) {
      peer.loadVRM(transform.vrmUrl, this.gltfLoader);
    }

    peer.updateTransform(transform);
  }

  public update(delta: number): void {
    for (const peer of this.peers.values()) {
      peer.update(delta);
    }
  }

  public attachPeerAudio(peerId: string, stream: MediaStream): void {
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = new PeerAvatar(peerId, this.scene, this.worldRoot);
      this.peers.set(peerId, peer);
    }
    peer.attachAudioStream(stream, this.audioListener);
  }

  /**
   * Update the AudioListener's world matrix so it tracks the camera/HMD
   * pose each frame. Three.js updates the camera matrix during
   * `renderer.render()`, but the AudioListener (a child of the camera)
   * needs its own `updateMatrixWorld()` call to push the new transform
   * into the Web Audio PannerNode listener. Without this, spatial voice
   * uses a stale listener position and peers' voices don't pan/attentuate
   * correctly as the local user moves or turns.
   */
  public updateAudioListener(): void {
    this.audioListener.updateMatrixWorld();
  }

  public removePeerAvatar(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.dispose(this.scene);
      this.peers.delete(peerId);
    }
  }

  private toLocalPose(obj: THREE.Object3D): { position: [number, number, number]; rotation: [number, number, number] } {
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(this._scratchPos);
    this.worldRoot.worldToLocal(this._scratchPos);

    obj.getWorldQuaternion(this._scratchQuat);
    this.worldRoot.getWorldQuaternion(this._scratchRootInvQuat).invert();
    this._scratchRootInvQuat.multiply(this._scratchQuat);
    this._scratchEuler.setFromQuaternion(this._scratchRootInvQuat, obj.rotation.order || 'YXZ');

    return {
      position: [this._scratchPos.x, this._scratchPos.y, this._scratchPos.z],
      rotation: [this._scratchEuler.x, this._scratchEuler.y, this._scratchEuler.z]
    };
  }

  public getLocalTransform(camera: THREE.Camera, controller1?: THREE.Object3D, controller2?: THREE.Object3D, isSpeaking = false, isCompanion = false): AvatarTransform {
    // VR joystick movement & smooth turn rotate and translate `worldRoot`.
    // Remote peer avatars live parented to `worldRoot`, so broadcasting
    // raw scene subtraction (camera.position - worldRoot.position) without
    // accounting for worldRoot's rotation caused the VR player to swing in
    // an orbit around the origin when spinning with the right joystick.
    // Converting each tracked object's exact world position/quaternion into
    // `worldRoot`'s local coordinate space ensures turning rotates the player
    // cleanly in place relative to all peers and world objects.
    this.worldRoot.updateWorldMatrix(true, false);

    const head = this.toLocalPose(camera);
    const leftHand = controller1 ? this.toLocalPose(controller1) : undefined;
    const rightHand = controller2 ? this.toLocalPose(controller2) : undefined;

    const ua = navigator.userAgent.toLowerCase();
    const isQuest3 = ua.includes('quest 3') || ua.includes('quest 3s');
    const controllerType = (controller1 || controller2) ? (isQuest3 ? 'quest3' : 'quest2') : undefined;

    return {
      peerId: 'local',
      headPosition: head.position,
      headRotation: head.rotation,
      leftHandPosition: leftHand?.position,
      leftHandRotation: leftHand?.rotation,
      rightHandPosition: rightHand?.position,
      rightHandRotation: rightHand?.rotation,
      isSpeaking,
      vrmUrl: this.localVrmUrl || undefined,
      isCompanion,
      controllerType
    };
  }
}
