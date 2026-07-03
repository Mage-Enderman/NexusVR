import * as THREE from 'three';
import type { InventoryItem } from '../services/InventoryService.ts';

export class VRHUDManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  public group: THREE.Group;
  public curvedScreenMesh: THREE.Mesh;
  public grabBarMesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  public isVisible = false;
  private items: InventoryItem[] = [];
  private onSpawnCallback: (item: InventoryItem) => void;
  private onCloseCallback: () => void;

  // For dragging/moving the screen
  public isBeingGrabbed = false;
  private grabOffset = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: THREE.Camera, onSpawn: (item: InventoryItem) => void, onClose: () => void) {
    this.scene = scene;
    this.camera = camera;
    this.onSpawnCallback = onSpawn;
    this.onCloseCallback = onClose;

    this.group = new THREE.Group();
    this.group.name = 'VRDashMenuGroup';
    this.group.visible = false;
    this.scene.add(this.group);

    // Create high-res offscreen canvas for UI
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Failed to get 2D context for VR HUD');
    this.ctx = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Create Curved Screen Geometry (Plane curved along a cylinder)
    const width = 1.6;
    const height = 1.0;
    const radius = 1.8;
    const planeGeo = new THREE.PlaneGeometry(width, height, 32, 16);
    const posAttr = planeGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      // Calculate angle around cylinder
      const angle = x / radius;
      const newX = Math.sin(angle) * radius;
      const newZ = (1 - Math.cos(angle)) * radius;
      posAttr.setXYZ(i, newX, y, -newZ);
    }
    planeGeo.computeVertexNormals();

    const screenMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });

    this.curvedScreenMesh = new THREE.Mesh(planeGeo, screenMat);
    this.curvedScreenMesh.name = 'VRCurvedScreen';
    this.group.add(this.curvedScreenMesh);

    // Create Grab Bar at the bottom for repositioning
    const barGeo = new THREE.BoxGeometry(0.6, 0.06, 0.04);
    const barMat = new THREE.MeshStandardMaterial({
      color: '#00f0ff',
      emissive: '#0088aa',
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8
    });
    this.grabBarMesh = new THREE.Mesh(barGeo, barMat);
    this.grabBarMesh.position.set(0, -height / 2 - 0.06, 0);
    this.grabBarMesh.name = 'VRDashMenuGrabBar';
    this.group.add(this.grabBarMesh);
  }

  public setItems(items: InventoryItem[]): void {
    this.items = items;
    if (this.isVisible) {
      this.renderCanvas();
    }
  }

  public show(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    this.group.visible = true;

    // Position in front of player camera
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.camera.getWorldDirection(camDir);
    camDir.y = 0; // Keep horizontal
    camDir.normalize();

    this.group.position.copy(camPos).add(camDir.clone().multiplyScalar(1.5));
    this.group.position.y = camPos.y; // Eye level
    this.group.lookAt(camPos.x, this.group.position.y, camPos.z);

    this.renderCanvas();
  }

  public hide(): void {
    this.isVisible = false;
    this.group.visible = false;
    this.onCloseCallback();
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public renderCanvas(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background glass effect
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(0, 0, w, h);

    // Border
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Header
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 32px Outfit, sans-serif';
    ctx.fillText('NEXUS VR - CURVED DASH MENU', 30, 50);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px Outfit, sans-serif';
    ctx.fillText('Aim controller at cards to Spawn or Equip. Grab bottom cyan bar to reposition screen.', 30, 80);

    // Close Button Top Right
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.fillRect(w - 100, 20, 80, 40);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(w - 100, 20, 80, 40);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.fillText('CLOSE', w - 85, 47);

    // Draw grid of inventory items
    const cols = 5;
    const cardW = 170;
    const cardH = 140;
    const startX = 35;
    const startY = 110;
    const gapX = 20;
    const gapY = 20;

    // Combine default primitives and stored tools/items
    const defaultPrims: InventoryItem[] = [
      { id: 'prim-cube', name: 'Cube Shape', type: 'primitive', primitiveType: 'cube', createdAt: Date.now() },
      { id: 'prim-sphere', name: 'Sphere Shape', type: 'primitive', primitiveType: 'sphere', createdAt: Date.now() },
      { id: 'prim-cylinder', name: 'Cylinder Shape', type: 'primitive', primitiveType: 'cylinder', createdAt: Date.now() },
      { id: 'prim-torus', name: 'Torus Shape', type: 'primitive', primitiveType: 'torus', createdAt: Date.now() },
      { id: 'prim-cone', name: 'Cone Shape', type: 'primitive', primitiveType: 'cone', createdAt: Date.now() }
    ];

    const displayItems = [...defaultPrims, ...this.items].slice(0, 15); // Show top 15 in VR grid

    displayItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);

      // Card Box
      ctx.fillStyle = item.type === 'tool' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(30, 41, 59, 0.8)';
      ctx.fillRect(x, y, cardW, cardH);

      ctx.strokeStyle = item.type === 'tool' ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cardW, cardH);

      // Badge
      ctx.fillStyle = item.type === 'tool' ? '#f59e0b' : '#38bdf8';
      ctx.font = 'bold 12px monospace';
      const badgeText = item.type === 'tool' ? `TOOL: ${item.toolType || 'DEV'}` : item.type === 'primitive' ? `SHAPE: ${item.primitiveType || 'CUBE'}` : item.type.toUpperCase();
      ctx.fillText(badgeText.toUpperCase(), x + 12, y + 25);

      // Item Name
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Outfit, sans-serif';
      const name = item.name.length > 15 ? item.name.slice(0, 14) + '...' : item.name;
      ctx.fillText(name, x + 12, y + 60);

      // Action Button inside card
      ctx.fillStyle = item.type === 'tool' ? '#f59e0b' : '#00f0ff';
      ctx.fillRect(x + 12, y + 90, cardW - 24, 34);

      ctx.fillStyle = '#000000';
      ctx.font = 'bold 14px Outfit, sans-serif';
      const btnText = item.type === 'tool' ? 'EQUIP TOOL' : item.type === 'vrm' ? 'EQUIP AVATAR' : 'SPAWN';
      ctx.fillText(btnText, x + 35, y + 112);
    });

    this.texture.needsUpdate = true;
  }

  // Handle VR Raycast interactions (Trigger pull / Click)
  public handleRayIntersection(uv: THREE.Vector2): void {
    if (!this.isVisible) return;

    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height; // Flip Y for canvas coords

    // Check Close Button
    if (x >= this.canvas.width - 100 && x <= this.canvas.width - 20 && y >= 20 && y <= 60) {
      this.hide();
      return;
    }

    // Check Cards
    const cols = 5;
    const cardW = 170;
    const cardH = 140;
    const startX = 35;
    const startY = 110;
    const gapX = 20;
    const gapY = 20;

    const defaultPrims: InventoryItem[] = [
      { id: 'prim-cube', name: 'Cube Shape', type: 'primitive', primitiveType: 'cube', createdAt: Date.now() },
      { id: 'prim-sphere', name: 'Sphere Shape', type: 'primitive', primitiveType: 'sphere', createdAt: Date.now() },
      { id: 'prim-cylinder', name: 'Cylinder Shape', type: 'primitive', primitiveType: 'cylinder', createdAt: Date.now() },
      { id: 'prim-torus', name: 'Torus Shape', type: 'primitive', primitiveType: 'torus', createdAt: Date.now() },
      { id: 'prim-cone', name: 'Cone Shape', type: 'primitive', primitiveType: 'cone', createdAt: Date.now() }
    ];

    const displayItems = [...defaultPrims, ...this.items].slice(0, 15);

    displayItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const cardX = startX + col * (cardW + gapX);
      const cardY = startY + row * (cardH + gapY);

      if (x >= cardX && x <= cardX + cardW && y >= cardY && y <= cardY + cardH) {
        this.onSpawnCallback(item);
        this.hide();
      }
    });
  }

  public dispose(): void {
    this.scene.remove(this.group);
    this.curvedScreenMesh.geometry.dispose();
    if (Array.isArray(this.curvedScreenMesh.material)) {
      this.curvedScreenMesh.material.forEach(m => m.dispose());
    } else {
      this.curvedScreenMesh.material.dispose();
    }
    this.texture.dispose();
  }
}
