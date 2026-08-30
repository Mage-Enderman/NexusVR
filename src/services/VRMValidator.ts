/**
 * VRMValidator — validates VRM avatars on import with performance limits.
 * Inspired by BasisVR's BasisAvatarPerformanceLimits which enforces
 * poly/bone/material/light/particle/collider limits before allowing
 * an avatar to load.
 *
 * Validates:
 * - Polygon/triangle count
 * - Bone count
 * - Material count
 * - Texture resolution (warns on very large textures)
 * - File size
 * - Required bones (head, hips, spine)
 */

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export interface VRMValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  stats: VRMStats;
}

export interface VRMStats {
  triangleCount: number;
  vertexCount: number;
  boneCount: number;
  materialCount: number;
  textureCount: number;
  maxTextureResolution: number;
  fileSize: number;
}

// Performance limits (inspired by BasisVR's BasisAvatarPerformanceLimits)
const LIMITS = {
  maxTriangles: 70_000,
  maxVertices: 100_000,
  maxBones: 256,
  maxMaterials: 16,
  maxTextureResolution: 2048,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  // Warnings (softer limits)
  warnTriangles: 50_000,
  warnVertices: 70_000,
  warnBones: 128,
  warnMaterials: 8,
  warnTextureResolution: 1024,
  warnFileSize: 5 * 1024 * 1024, // 5 MB
};

// Required bones for a valid humanoid VRM
const REQUIRED_BONES = ['hips', 'spine', 'head', 'leftUpperArm', 'rightUpperArm'];

export class VRMValidator {
  /**
   * Validate a loaded VRM instance.
   */
  static validate(vrm: VRM, fileSize: number = 0): VRMValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const stats = this.collectStats(vrm, fileSize);

    // Check triangle count
    if (stats.triangleCount > LIMITS.maxTriangles) {
      errors.push(`Triangle count ${stats.triangleCount.toLocaleString()} exceeds limit of ${LIMITS.maxTriangles.toLocaleString()}`);
    } else if (stats.triangleCount > LIMITS.warnTriangles) {
      warnings.push(`Triangle count ${stats.triangleCount.toLocaleString()} is high (recommended: ${LIMITS.warnTriangles.toLocaleString()})`);
    }

    // Check vertex count
    if (stats.vertexCount > LIMITS.maxVertices) {
      errors.push(`Vertex count ${stats.vertexCount.toLocaleString()} exceeds limit of ${LIMITS.maxVertices.toLocaleString()}`);
    } else if (stats.vertexCount > LIMITS.warnVertices) {
      warnings.push(`Vertex count ${stats.vertexCount.toLocaleString()} is high (recommended: ${LIMITS.warnVertices.toLocaleString()})`);
    }

    // Check bone count
    if (stats.boneCount > LIMITS.maxBones) {
      errors.push(`Bone count ${stats.boneCount} exceeds limit of ${LIMITS.maxBones}`);
    } else if (stats.boneCount > LIMITS.warnBones) {
      warnings.push(`Bone count ${stats.boneCount} is high (recommended: ${LIMITS.warnBones})`);
    }

    // Check material count
    if (stats.materialCount > LIMITS.maxMaterials) {
      errors.push(`Material count ${stats.materialCount} exceeds limit of ${LIMITS.maxMaterials}`);
    } else if (stats.materialCount > LIMITS.warnMaterials) {
      warnings.push(`Material count ${stats.materialCount} is high (recommended: ${LIMITS.warnMaterials})`);
    }

    // Check texture resolution
    if (stats.maxTextureResolution > LIMITS.maxTextureResolution) {
      errors.push(`Max texture resolution ${stats.maxTextureResolution}px exceeds limit of ${LIMITS.maxTextureResolution}px`);
    } else if (stats.maxTextureResolution > LIMITS.warnTextureResolution) {
      warnings.push(`Max texture resolution ${stats.maxTextureResolution}px is high (recommended: ${LIMITS.warnTextureResolution}px)`);
    }

    // Check file size
    if (fileSize > LIMITS.maxFileSize) {
      errors.push(`File size ${(fileSize / 1024 / 1024).toFixed(1)} MB exceeds limit of ${(LIMITS.maxFileSize / 1024 / 1024).toFixed(0)} MB`);
    } else if (fileSize > LIMITS.warnFileSize) {
      warnings.push(`File size ${(fileSize / 1024 / 1024).toFixed(1)} MB is large (recommended: <${(LIMITS.warnFileSize / 1024 / 1024).toFixed(0)} MB)`);
    }

    // Check required bones
    if (vrm.humanoid) {
      for (const boneName of REQUIRED_BONES) {
        const bone = vrm.humanoid.getNormalizedBoneNode(boneName as any);
        if (!bone) {
          errors.push(`Missing required bone: ${boneName}`);
        }
      }
    } else {
      errors.push('VRM has no humanoid rig');
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      stats,
    };
  }

  /**
   * Collect statistics from a VRM model.
   */
  private static collectStats(vrm: VRM, fileSize: number): VRMStats {
    let triangleCount = 0;
    let vertexCount = 0;
    let materialCount = 0;
    let textureCount = 0;
    let maxTextureResolution = 0;
    let boneCount = 0;

    // Traverse scene to count geometry
    vrm.scene.traverse((obj) => {
      // Count bones (check constructor name or type property)
      if ((obj as any).isBone || obj.type === 'Bone') boneCount++;

      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        const geo = mesh.geometry;

        // Count triangles
        if (geo.index) {
          triangleCount += geo.index.count / 3;
        } else if (geo.attributes.position) {
          triangleCount += geo.attributes.position.count / 3;
        }

        // Count vertices
        if (geo.attributes.position) {
          vertexCount += geo.attributes.position.count;
        }

        // Count materials
        if (Array.isArray(mesh.material)) {
          materialCount += mesh.material.length;
          for (const mat of mesh.material) {
            const tex = (mat as THREE.MeshStandardMaterial).map;
            if (tex?.image) {
              textureCount++;
              const img = tex.image as any;
              const res = Math.max(img.width || 0, img.height || 0);
              if (res > maxTextureResolution) maxTextureResolution = res;
            }
          }
        } else if (mesh.material) {
          materialCount++;
          const tex = (mesh.material as THREE.MeshStandardMaterial).map;
          if (tex?.image) {
            textureCount++;
            const img = tex.image as any;
            const res = Math.max(img.width || 0, img.height || 0);
            if (res > maxTextureResolution) maxTextureResolution = res;
          }
        }
      }
    });

    // Count humanoid bones if available
    if (vrm.humanoid) {
      const humanoidBoneCount = Object.keys(vrm.humanoid.humanBones).length;
      if (humanoidBoneCount > boneCount) boneCount = humanoidBoneCount;
    }

    return {
      triangleCount: Math.round(triangleCount),
      vertexCount,
      boneCount,
      materialCount,
      textureCount,
      maxTextureResolution,
      fileSize,
    };
  }

  /**
   * Format validation result as a human-readable string.
   */
  static formatResult(result: VRMValidationResult): string {
    const lines: string[] = [];

    if (result.errors.length > 0) {
      lines.push('❌ Errors:');
      for (const e of result.errors) lines.push(`  • ${e}`);
    }

    if (result.warnings.length > 0) {
      lines.push('⚠️ Warnings:');
      for (const w of result.warnings) lines.push(`  • ${w}`);
    }

    lines.push('');
    lines.push('📊 Stats:');
    lines.push(`  Triangles: ${result.stats.triangleCount.toLocaleString()}`);
    lines.push(`  Vertices: ${result.stats.vertexCount.toLocaleString()}`);
    lines.push(`  Bones: ${result.stats.boneCount}`);
    lines.push(`  Materials: ${result.stats.materialCount}`);
    lines.push(`  Textures: ${result.stats.textureCount}`);
    if (result.stats.maxTextureResolution > 0) {
      lines.push(`  Max texture: ${result.stats.maxTextureResolution}px`);
    }
    if (result.stats.fileSize > 0) {
      lines.push(`  File size: ${(result.stats.fileSize / 1024 / 1024).toFixed(1)} MB`);
    }

    return lines.join('\n');
  }
}
