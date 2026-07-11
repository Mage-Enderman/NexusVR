import * as THREE from 'three';

export interface BrushStroke {
  id: string;
  points: THREE.Vector3[];
  color: string;
  width: number;
  mesh: THREE.Mesh;
}

export class BrushManager {
  private scene: THREE.Scene;
  public group: THREE.Group;
  public strokes: BrushStroke[] = [];
  private currentStroke: BrushStroke | null = null;
  public isActive = false;
  public currentColor = '#ff007f';
  public currentWidth = 0.05;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = '3D Brush Strokes';
    this.scene.add(this.group);
  }

  public startStroke(color?: string, width?: number): void {
    if (!this.isActive) return;
    const strokeColor = color || this.currentColor;
    const strokeWidth = width || this.currentWidth;
    
    this.currentStroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      points: [],
      color: strokeColor,
      width: strokeWidth,
      mesh: new THREE.Mesh()
    };
  }

  public addPoint(point: THREE.Vector3): void {
    if (!this.isActive || !this.currentStroke) return;

    // Avoid adding duplicate or extremely close points
    const pts = this.currentStroke.points;
    if (pts.length > 0 && pts[pts.length - 1].distanceTo(point) < 0.03) {
      return;
    }

    pts.push(point.clone());

    if (pts.length >= 2) {
      this.updateCurrentStrokeMesh();
    }
  }

  public endStroke(): BrushStroke | null {
    if (!this.currentStroke) return null;
    
    const finishedStroke = this.currentStroke;
    if (finishedStroke.points.length >= 2) {
      this.strokes.push(finishedStroke);
    } else if (finishedStroke.mesh.parent) {
      this.group.remove(finishedStroke.mesh);
    }
    
    this.currentStroke = null;
    return finishedStroke;
  }

  private updateCurrentStrokeMesh(): void {
    if (!this.currentStroke || this.currentStroke.points.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(this.currentStroke.points);
    const tubularSegments = Math.max(8, this.currentStroke.points.length * 4);
    const radialSegments = 6;
    
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, this.currentStroke.width / 2, radialSegments, false);
    
    if (!this.currentStroke.mesh.geometry || this.currentStroke.mesh.geometry.type !== 'TubeGeometry') {
      const material = new THREE.MeshStandardMaterial({
        color: this.currentStroke.color,
        emissive: this.currentStroke.color,
        emissiveIntensity: 0.6,
        roughness: 0.2,
        metalness: 0.1,
        side: THREE.DoubleSide
      });
      
      this.currentStroke.mesh = new THREE.Mesh(geometry, material);
      this.currentStroke.mesh.name = this.currentStroke.id;
      this.currentStroke.mesh.castShadow = true;
      this.group.add(this.currentStroke.mesh);
    } else {
      this.currentStroke.mesh.geometry.dispose();
      this.currentStroke.mesh.geometry = geometry;
    }
  }

  public clearAll(): void {
    this.strokes.forEach(stroke => {
      if (stroke.mesh.geometry) stroke.mesh.geometry.dispose();
      if (stroke.mesh.material) {
        if (Array.isArray(stroke.mesh.material)) {
          stroke.mesh.material.forEach(m => m.dispose());
        } else {
          stroke.mesh.material.dispose();
        }
      }
      this.group.remove(stroke.mesh);
    });
    this.strokes = [];
    this.currentStroke = null;
  }

  public dispose(): void {
    this.clearAll();
    this.scene.remove(this.group);
  }
}
