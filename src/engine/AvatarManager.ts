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
  public isSpeaking = false;
  public vrmUrl: string | null = null;

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

    if (this.headMesh) {
      this.headMesh.position.set(...transform.headPosition);
      this.headMesh.rotation.set(...transform.headRotation);
    }

    if (this.leftHandMesh && transform.leftHandPosition) {
      this.leftHandMesh.position.set(...transform.leftHandPosition);
      this.leftHandMesh.rotation.set(...(transform.leftHandRotation || [0, 0, 0]));
      const ring = this.leftHandMesh.getObjectByName('ring');
      if (ring) {
        ring.visible = transform.controllerType !== 'quest3';
      }
    }

    if (this.rightHandMesh && transform.rightHandPosition) {
      this.rightHandMesh.position.set(...transform.rightHandPosition);
      this.rightHandMesh.rotation.set(...(transform.rightHandRotation || [0, 0, 0]));
      const ring = this.rightHandMesh.getObjectByName('ring');
      if (ring) {
        ring.visible = transform.controllerType !== 'quest3';
      }
    }

    if (this.vrm) {
      this.vrm.scene.position.set(...transform.headPosition);
      this.vrm.scene.position.y -= 1.5; // Offset to feet
      this.vrm.update(0.016);
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

  public attachAudioStream(stream: MediaStream, listener: THREE.AudioListener): void {
    if (!this.headMesh) return;
    
    if (this.positionalAudio) {
      if (this.positionalAudio.isPlaying) this.positionalAudio.stop();
      this.headMesh.remove(this.positionalAudio);
    }

    const audio = new THREE.PositionalAudio(listener);
    const audioNode = audio.context.createMediaStreamSource(stream);
    audio.setNodeSource(audioNode as any);
    audio.setRefDistance(2);
    audio.setMaxDistance(20);
    audio.setRolloffFactor(1.5);

    this.positionalAudio = audio;
    this.headMesh.add(audio);
  }

  public dispose(scene: THREE.Scene): void {
    if (this.positionalAudio && this.positionalAudio.isPlaying) {
      this.positionalAudio.stop();
    }
    scene.remove(this.group);
  }
}

export class AvatarManager {
  private scene: THREE.Scene;
  private worldRoot: THREE.Object3D;
  private audioListener: THREE.AudioListener;
  private gltfLoader: GLTFLoader;
  public peers: Map<string, PeerAvatar> = new Map();
  public localVrmUrl: string | null = null;
  public localVrm: VRM | null = null;

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

  public attachPeerAudio(peerId: string, stream: MediaStream): void {
    let peer = this.peers.get(peerId);
    if (!peer) {
      peer = new PeerAvatar(peerId, this.scene, this.worldRoot);
      this.peers.set(peerId, peer);
    }
    peer.attachAudioStream(stream, this.audioListener);
  }

  public removePeerAvatar(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.dispose(this.scene);
      this.peers.delete(peerId);
    }
  }

  public getLocalTransform(camera: THREE.Camera, controller1?: THREE.Object3D, controller2?: THREE.Object3D, isSpeaking = false, isCompanion = false): AvatarTransform {
    // VR joystick movement uses the inverse-treadmill: SceneEngine's
    // updateVRLocomotion() translates worldRoot in the OPPOSITE direction
    // of intended motion, so the HMD-tracked camera.position never changes
    // when the user pushes the stick. If we broadcast camera.position
    // directly, other clients see the VR user's avatar frozen at the HMD
    // real-world position — only physical HMD movement (which writes to
    // camera.position) syncs. The fix: subtract worldRoot.position so the
    // broadcast reflects the VR user's SIMULATED world position, i.e.
    // "where they would be if they'd walked physically". Similarly for
    // smooth-turn: worldRoot.rotation.y is incremented by the turn angle,
    // so the avatar's head Y rotation needs the inverse to face the
    // right direction in the world frame.
    //
    // Desktop mode leaves worldRoot at identity (position 0,0,0,
    // rotation 0,0,0), so the subtraction is a no-op for desktop users —
    // the broadcast is unchanged. Only VR mode sees the correction.
    //
    // Y-only rotation correction because updateVRSmoothTurn only rotates
    // around Y; worldRoot.rotation.x/z are always 0. A general quaternion
    // correction (worldRoot.quaternion.inverse() * camera.quaternion) would
    // be equivalent here but is overkill for the current Y-only case.
    const wx = this.worldRoot.position.x;
    const wy = this.worldRoot.position.y;
    const wz = this.worldRoot.position.z;
    const wyaw = this.worldRoot.rotation.y;

    const ua = navigator.userAgent.toLowerCase();
    const isQuest3 = ua.includes('quest 3') || ua.includes('quest 3s');
    const controllerType = (controller1 || controller2) ? (isQuest3 ? 'quest3' : 'quest2') : undefined;

    return {
      peerId: 'local',
      headPosition: [camera.position.x - wx, camera.position.y - wy, camera.position.z - wz],
      headRotation: [camera.rotation.x, camera.rotation.y - wyaw, camera.rotation.z],
      leftHandPosition: controller1 ? [controller1.position.x - wx, controller1.position.y - wy, controller1.position.z - wz] : undefined,
      leftHandRotation: controller1 ? [controller1.rotation.x, controller1.rotation.y - wyaw, controller1.rotation.z] : undefined,
      rightHandPosition: controller2 ? [controller2.position.x - wx, controller2.position.y - wy, controller2.position.z - wz] : undefined,
      rightHandRotation: controller2 ? [controller2.rotation.x, controller2.rotation.y - wyaw, controller2.rotation.z] : undefined,
      isSpeaking,
      vrmUrl: this.localVrmUrl || undefined,
      isCompanion,
      controllerType
    };
  }
}
