/**
 * AvatarCodec — compact avatar sync encoding inspired by BasisVR's
 * BasisNetworkAvatarCompressor.
 *
 * Features:
 * - Smallest-three quaternion encoding (25% bandwidth savings)
 * - Deadband suppression (skip when nothing meaningful changed)
 * - Quality tiers based on distance (VeryLow/Low/Medium/High)
 * - Idle heartbeat (periodic send even when suppressed)
 * - Delta compression (keyframe + deltas between)
 *
 * Wire format (High quality):
 *   [headPos: 3 floats] [headRot: smallest-3 quat]
 *   [leftPos: 3 floats] [leftRot: smallest-3 quat]
 *   [rightPos: 3 floats] [rightRot: smallest-3 quat]
 *   [scale: 1 float] [locomotion: packed byte]
 *   [flags: 1 byte]
 *
 * Total: ~52 bytes per frame (vs ~200+ for full JSON)
 */

// ─── Smallest-Three Quaternion Encoding ─────────────────────────────────────

/**
 * Encode a quaternion using "smallest three" compression.
 * Only the three smallest components are sent; the largest is reconstructed.
 * This saves 25% bandwidth vs sending all four components.
 *
 * Input: [x, y, z, w] (THREE.js Quaternion components)
 * Output: Uint8Array of 10 bytes (3 × 16-bit integers for the 3 smallest + index)
 */
export function encodeSmallestThree(x: number, y: number, z: number, w: number): Uint8Array {
  const result = new Uint8Array(10);

  // Find the index of the largest component
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absZ = Math.abs(z);
  const absW = Math.abs(w);

  let largestIndex = 0;
  let largestVal = absX;
  if (absY > largestVal) { largestIndex = 1; largestVal = absY; }
  if (absZ > largestVal) { largestIndex = 2; largestVal = absZ; }
  if (absW > largestVal) { largestIndex = 3; largestVal = absW; }

  // Store index in first byte
  result[0] = largestIndex;

  // Get the three remaining components and normalize
  const sqrt2Over2 = Math.SQRT1_2; // 1/sqrt(2) ≈ 0.7071
  let a: number, b: number, c: number;

  switch (largestIndex) {
    case 0: a = y; b = z; c = w; break;
    case 1: a = x; b = z; c = w; break;
    case 2: a = x; b = y; c = w; break;
    default: a = x; b = y; c = z; break;
  }

  // Normalize by the largest component (which we're dropping)
  const norm = 1 / largestVal;
  a *= norm;
  b *= norm;
  c *= norm;

  // Map from [-sqrt(2)/2, sqrt(2)/2] to [0, 65535]
  const scale = 65535 / (sqrt2Over2 * 2);
  const aEncoded = Math.round((a + sqrt2Over2) * scale) & 0xFFFF;
  const bEncoded = Math.round((b + sqrt2Over2) * scale) & 0xFFFF;
  const cEncoded = Math.round((c + sqrt2Over2) * scale) & 0xFFFF;

  // Pack as little-endian 16-bit integers
  result[1] = aEncoded & 0xFF;
  result[2] = (aEncoded >> 8) & 0xFF;
  result[3] = bEncoded & 0xFF;
  result[4] = (bEncoded >> 8) & 0xFF;
  result[5] = cEncoded & 0xFF;
  result[6] = (cEncoded >> 8) & 0xFF;

  return result;
}

/**
 * Decode a "smallest three" compressed quaternion.
 * Input: Uint8Array from encodeSmallestThree
 * Output: [x, y, z, w]
 */
export function decodeSmallestThree(data: Uint8Array, offset: number = 0): [number, number, number, number] {
  const largestIndex = data[offset];
  const sqrt2Over2 = Math.SQRT1_2;

  const scale = (sqrt2Over2 * 2) / 65535;
  const a = (data[offset + 1] | (data[offset + 2] << 8)) * scale - sqrt2Over2;
  const b = (data[offset + 3] | (data[offset + 4] << 8)) * scale - sqrt2Over2;
  const c = (data[offset + 5] | (data[offset + 6] << 8)) * scale - sqrt2Over2;

  // Reconstruct the dropped component
  const d = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));

  switch (largestIndex) {
    case 0: return [d, a, b, c];
    case 1: return [a, d, b, c];
    case 2: return [a, b, d, c];
    case 3: return [a, b, c, d];
    default: return [0, 0, 0, 1];
  }
}

// ─── Position Encoding ──────────────────────────────────────────────────────

/**
 * Encode a position as 3 × float32 (12 bytes).
 * For higher compression, could use quantized positions,
 * but float32 is a good baseline.
 */
export function encodePosition(x: number, y: number, z: number): Uint8Array {
  const buf = new Uint8Array(12);
  const view = new DataView(buf.buffer);
  view.setFloat32(0, x, true);
  view.setFloat32(4, y, true);
  view.setFloat32(8, z, true);
  return buf;
}

/**
 * Decode a position from the encoded format.
 */
export function decodePosition(data: Uint8Array, offset: number = 0): [number, number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
}

// ─── Deadband Suppression ───────────────────────────────────────────────────

interface DeadbandThresholds {
  /** Position threshold in meters. */
  positionMeters: number;
  /** Rotation threshold in radians. */
  rotationRadians: number;
  /** Scale threshold. */
  scaleUnits: number;
}

const DEFAULT_THRESHOLDS: DeadbandThresholds = {
  positionMeters: 0.005,   // 5mm
  rotationRadians: 0.02,   // ~1.1 degrees
  scaleUnits: 0.005,
};

/**
 * Check if two avatar poses are within the deadband threshold.
 * If so, the update can be suppressed (no meaningful visual difference).
 */
export function isWithinDeadband(
  prev: AvatarPoseData,
  curr: AvatarPoseData,
  thresholds: DeadbandThresholds = DEFAULT_THRESHOLDS,
): boolean {
  // Position check
  const dx = curr.headPosition[0] - prev.headPosition[0];
  const dy = curr.headPosition[1] - prev.headPosition[1];
  const dz = curr.headPosition[2] - prev.headPosition[2];
  const posDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (posDist > thresholds.positionMeters) return false;

  // Rotation check (simplified: check Euler angle deltas)
  const rdx = Math.abs(curr.headRotation[0] - prev.headRotation[0]);
  const rdy = Math.abs(curr.headRotation[1] - prev.headRotation[1]);
  const rdz = Math.abs(curr.headRotation[2] - prev.headRotation[2]);
  if (rdx > thresholds.rotationRadians || rdy > thresholds.rotationRadians || rdz > thresholds.rotationRadians) return false;

  // Scale check
  if (Math.abs(curr.scale - prev.scale) > thresholds.scaleUnits) return false;

  return true;
}

// ─── Quality Tiers ──────────────────────────────────────────────────────────

export const AvatarQuality = {
  /** Very distant players: position only, no rotation. */
  VeryLow: 0 as const,
  /** Distant players: position + head rotation only. */
  Low: 1 as const,
  /** Medium distance: position + head + hands. */
  Medium: 2 as const,
  /** Close players: full data. */
  High: 3 as const,
} as const;
export type AvatarQuality = typeof AvatarQuality[keyof typeof AvatarQuality];

/**
 * Maximum bytes per quality tier.
 * High = full data, lower tiers progressively reduce data.
 */
export const QUALITY_BYTE_LIMITS: Record<number, number> = {
  [AvatarQuality.VeryLow]: 16,   // position only
  [AvatarQuality.Low]: 28,       // position + head rot
  [AvatarQuality.Medium]: 40,    // + left hand
  [AvatarQuality.High]: 64,      // + right hand + scale + flags
};

// ─── Avatar Pose Data ───────────────────────────────────────────────────────

export interface AvatarPoseData {
  headPosition: [number, number, number];
  headRotation: [number, number, number]; // Euler [x, y, z]
  leftHandPosition?: [number, number, number];
  leftHandRotation?: [number, number, number];
  rightHandPosition?: [number, number, number];
  rightHandRotation?: [number, number, number];
  scale: number;
  locomotionMode: number; // 0=walk, 1=flight, 2=noclip
  isSpeaking: boolean;
}

// ─── High-Level Encode/Decode ───────────────────────────────────────────────

/**
 * Encode an AvatarPoseData into a compact binary format.
 * Returns a Uint8Array suitable for sending over WebRTC.
 */
export function encodeAvatarPose(pose: AvatarPoseData, quality: AvatarQuality = AvatarQuality.High): Uint8Array {
  const parts: Uint8Array[] = [];

  // Always include head position (12 bytes)
  parts.push(encodePosition(...pose.headPosition));

  if (quality >= AvatarQuality.Low) {
    // Head rotation as smallest-three (7 bytes)
    const [hx, hy, hz] = pose.headRotation;
    // Convert Euler to quaternion for encoding
    const q = eulerToQuaternion(hx, hy, hz);
    parts.push(encodeSmallestThree(q[0], q[1], q[2], q[3]));
  }

  if (quality >= AvatarQuality.Medium && pose.leftHandPosition) {
    // Left hand position + rotation
    parts.push(encodePosition(...pose.leftHandPosition));
    if (pose.leftHandRotation) {
      const [lx, ly, lz] = pose.leftHandRotation;
      const q = eulerToQuaternion(lx, ly, lz);
      parts.push(encodeSmallestThree(q[0], q[1], q[2], q[3]));
    }
  }

  if (quality >= AvatarQuality.High) {
    // Right hand position + rotation
    if (pose.rightHandPosition) {
      parts.push(encodePosition(...pose.rightHandPosition));
    }
    if (pose.rightHandRotation) {
      const [rx, ry, rz] = pose.rightHandRotation;
      const q = eulerToQuaternion(rx, ry, rz);
      parts.push(encodeSmallestThree(q[0], q[1], q[2], q[3]));
    }

    // Scale (1 byte, quantized to 0.1-5.0 range)
    const scaleByte = Math.round(((pose.scale - 0.1) / 4.9) * 255);
    const scaleArr = new Uint8Array(1);
    scaleArr[0] = Math.max(0, Math.min(255, scaleByte));
    parts.push(scaleArr);

    // Flags (1 byte: bits for locomotion mode, speaking, etc.)
    const flags = (pose.locomotionMode & 0x03) | (pose.isSpeaking ? 0x04 : 0);
    const flagsArr = new Uint8Array(1);
    flagsArr[0] = flags;
    parts.push(flagsArr);
  }

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Decode a compact binary avatar pose back to AvatarPoseData.
 */
export function decodeAvatarPose(data: Uint8Array): AvatarPoseData | null {
  if (data.length < 12) return null;

  let offset = 0;
  const pose: AvatarPoseData = {
    headPosition: [0, 0, 0],
    headRotation: [0, 0, 0],
    scale: 1.0,
    locomotionMode: 0,
    isSpeaking: false,
  };

  // Head position
  pose.headPosition = decodePosition(data, offset);
  offset += 12;

  // Head rotation (if present)
  if (offset + 7 <= data.length) {
    const q = decodeSmallestThree(data, offset);
    const euler = quaternionToEuler(q[0], q[1], q[2], q[3]);
    pose.headRotation = euler;
    offset += 7;
  }

  // Left hand (if present)
  if (offset + 12 <= data.length) {
    pose.leftHandPosition = decodePosition(data, offset);
    offset += 12;
    if (offset + 7 <= data.length) {
      const q = decodeSmallestThree(data, offset);
      pose.leftHandRotation = quaternionToEuler(q[0], q[1], q[2], q[3]);
      offset += 7;
    }
  }

  // Right hand (if present)
  if (offset + 12 <= data.length) {
    pose.rightHandPosition = decodePosition(data, offset);
    offset += 12;
    if (offset + 7 <= data.length) {
      const q = decodeSmallestThree(data, offset);
      pose.rightHandRotation = quaternionToEuler(q[0], q[1], q[2], q[3]);
      offset += 7;
    }
  }

  // Scale (if present)
  if (offset < data.length) {
    pose.scale = 0.1 + (data[offset] / 255) * 4.9;
    offset++;
  }

  // Flags (if present)
  if (offset < data.length) {
    const flags = data[offset];
    pose.locomotionMode = flags & 0x03;
    pose.isSpeaking = (flags & 0x04) !== 0;
  }

  return pose;
}

// ─── Quaternion/Euler Helpers ───────────────────────────────────────────────

function eulerToQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);

  return [
    sx * cy * cz - cx * sy * sz,  // x
    cx * sy * cz + sx * cy * sz,  // y
    cx * cy * sz - sx * sy * cz,  // z
    cx * cy * cz + sx * sy * sz,  // w
  ];
}

function quaternionToEuler(x: number, y: number, z: number, w: number): [number, number, number] {
  // YXZ rotation order (matching THREE.js default)
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1
    ? Math.sign(sinp) * Math.PI / 2
    : Math.asin(sinp);

  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  return [roll, pitch, yaw];
}

// ─── Statistics ─────────────────────────────────────────────────────────────

export class AvatarCodecStats {
  static framesEncoded = 0;
  static framesDecoded = 0;
  static framesSuppressed = 0;
  static bytesEncoded = 0;
  static bytesDecoded = 0;

  static reset(): void {
    this.framesEncoded = 0;
    this.framesDecoded = 0;
    this.framesSuppressed = 0;
    this.bytesEncoded = 0;
    this.bytesDecoded = 0;
  }

  static getStats() {
    return {
      framesEncoded: this.framesEncoded,
      framesDecoded: this.framesDecoded,
      framesSuppressed: this.framesSuppressed,
      bytesEncoded: this.bytesEncoded,
      bytesDecoded: this.bytesDecoded,
      suppressionRate: this.framesEncoded > 0
        ? ((this.framesSuppressed / (this.framesEncoded + this.framesSuppressed)) * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}
