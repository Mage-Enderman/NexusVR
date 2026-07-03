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
}

export class PeerAvatar {
  public peerId: string;
  public group: THREE.Group;
  public headMesh: THREE.Mesh | null = null;
  public leftHandMesh: THREE.Mesh | null = null;
  public rightHandMesh: THREE.Mesh | null = null;
  public vrm: VRM | null = null;
  public audioSpeakerMesh: THREE.Mesh | null = null;
  public positionalAudio: THREE.PositionalAudio | null = null;
  public isSpeaking = false;
  public vrmUrl: string | null = null;

  constructor(peerId: string, scene: THREE.Scene) {
    this.peerId = peerId;
    this.group = new THREE.Group();
    this.group.name = `Avatar_${peerId}`;
    scene.add(this.group);
    
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

    // Left hand
    const handGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const handMat = new THREE.MeshStandardMaterial({ color: '#a855f7', roughness: 0.3 });
    this.leftHandMesh = new THREE.Mesh(handGeo, handMat);
    this.leftHandMesh.position.set(-0.3, -0.3, -0.2);
    this.group.add(this.leftHandMesh);

    // Right hand
    this.rightHandMesh = new THREE.Mesh(handGeo.clone(), handMat.clone());
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
    }

    if (this.rightHandMesh && transform.rightHandPosition) {
      this.rightHandMesh.position.set(...transform.rightHandPosition);
      this.rightHandMesh.rotation.set(...(transform.rightHandRotation || [0, 0, 0]));
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
  private audioListener: THREE.AudioListener;
  private gltfLoader: GLTFLoader;
  public peers: Map<string, PeerAvatar> = new Map();
  public localVrmUrl: string | null = null;
  public localVrm: VRM | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
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
      peer = new PeerAvatar(transform.peerId, this.scene);
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
      peer = new PeerAvatar(peerId, this.scene);
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
    return {
      peerId: 'local',
      headPosition: [camera.position.x, camera.position.y, camera.position.z],
      headRotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
      leftHandPosition: controller1 ? [controller1.position.x, controller1.position.y, controller1.position.z] : undefined,
      leftHandRotation: controller1 ? [controller1.rotation.x, controller1.rotation.y, controller1.rotation.z] : undefined,
      rightHandPosition: controller2 ? [controller2.position.x, controller2.position.y, controller2.position.z] : undefined,
      rightHandRotation: controller2 ? [controller2.rotation.x, controller2.rotation.y, controller2.rotation.z] : undefined,
      isSpeaking,
      vrmUrl: this.localVrmUrl || undefined,
      isCompanion
    };
  }
}
