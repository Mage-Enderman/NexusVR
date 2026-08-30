/**
 * VRMAnimator — Procedural body animation for VRM avatars.
 * Drives humanoid bones mathematically based on locomotion state, mouse look,
 * and natural biomechanical limits.
 */
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

export interface LocomotionState {
  moveSpeed: number;
  moveDirection: [number, number];
  isCrouching: boolean;
  isGrounded: boolean;
  verticalVelocity: number;
  yawVelocity: number;
  locomotionMode: "walk" | "flight" | "noclip";
}

export type BoneName =
  | "hips" | "spine" | "chest" | "upperChest"
  | "neck" | "head"
  | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot"
  | "rightUpperLeg" | "rightLowerLeg" | "rightFoot";

const BLEND_SPEED = 8;
const IDLE_BREATH_HZ = 0.35;
const IDLE_SWAY_HZ = 0.15;
const IDLE_WEIGHT_SHIFT_HZ = 0.08;
const WALK_BASE_CADENCE = 2.4;
const CROUCH_LERP_SPEED = 6;

/**
 * Auto-detects total height and eye height of a VRM avatar using world-space
 * bone positions in rest pose.
 */
export function detectVRMDimensions(vrm: VRM): { height: number; eyeHeight: number } {
  vrm.scene.updateWorldMatrix(true, true);

  const head = vrm.humanoid.getNormalizedBoneNode("head");
  const hips = vrm.humanoid.getNormalizedBoneNode("hips");
  const leftFoot = vrm.humanoid.getNormalizedBoneNode("leftFoot");
  const rightFoot = vrm.humanoid.getNormalizedBoneNode("rightFoot");

  const headPos = new THREE.Vector3();
  const hipsPos = new THREE.Vector3();
  const footPos = new THREE.Vector3();

  if (head && hips) {
    head.getWorldPosition(headPos);
    hips.getWorldPosition(hipsPos);

    // In humanoid anatomy, the hips-to-head vertical span is ~38% of total height
    const span = Math.abs(headPos.y - hipsPos.y);
    if (span > 0.05) {
      const height = span / 0.38;
      let eyeHeight = headPos.y * 0.95;
      if (leftFoot) {
        leftFoot.getWorldPosition(footPos);
        eyeHeight = headPos.y - footPos.y;
      } else if (rightFoot) {
        rightFoot.getWorldPosition(footPos);
        eyeHeight = headPos.y - footPos.y;
      }
      return {
        height: Math.max(height, 0.5),
        eyeHeight: Math.max(eyeHeight, 0.4),
      };
    }
  }

  return { height: 1.6, eyeHeight: 1.5 };
}

export class VRMAnimator {
  private vrm: VRM;
  private estimatedHeight: number;
  private eyeHeight: number;
  private bones: Partial<Record<BoneName, THREE.Object3D>> = {};
  private restHipsPosition = new THREE.Vector3();

  private walkPhase = 0;
  private blendToWalk = 0;
  private blendToCrouch = 0;
  private jumpBlend = 0;

  private blinkTimer = 0;
  private nextBlinkIn = 3;
  private isBlinking = false;
  private blinkProgress = 0;

  public bodyYaw = 0;
  private time = 0;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    const dims = detectVRMDimensions(vrm);
    this.estimatedHeight = dims.height;
    this.eyeHeight = dims.eyeHeight;

    const names: BoneName[] = [
      "hips", "spine", "chest", "upperChest",
      "neck", "head",
      "leftUpperArm", "leftLowerArm", "leftHand",
      "rightUpperArm", "rightLowerArm", "rightHand",
      "leftUpperLeg", "leftLowerLeg", "leftFoot",
      "rightUpperLeg", "rightLowerLeg", "rightFoot",
    ];

    for (const name of names) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) this.bones[name] = node;
    }

    const hips = this.bones.hips;
    if (hips) {
      this.restHipsPosition.copy(hips.position);
    }
  }

  public getBlendToCrouch(): number {
    return this.blendToCrouch;
  }

  public getEstimatedHeight(): number {
    return this.estimatedHeight;
  }

  public getEyeHeight(): number {
    return this.eyeHeight;
  }

  private bone(name: BoneName): THREE.Object3D | null {
    return this.bones[name] ?? null;
  }

  update(
    delta: number,
    state: LocomotionState,
    targetHeadEuler?: THREE.Euler,
    leftHandTarget?: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    rightHandTarget?: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    physicalCrouchBlend = 0
  ): void {
    const dt = Math.min(delta, 0.1);
    this.time += dt;

    const isWalking = state.moveSpeed > 0.05
      && state.locomotionMode === "walk"
      && state.isGrounded;

    const targetCrouch = Math.max(state.isCrouching ? 1 : 0, physicalCrouchBlend);
    this.blendToWalk += ((isWalking ? 1 : 0) - this.blendToWalk) * Math.min(1, dt * BLEND_SPEED);
    this.blendToCrouch += (targetCrouch - this.blendToCrouch) * Math.min(1, dt * CROUCH_LERP_SPEED);
    this.jumpBlend += (((!state.isGrounded && state.locomotionMode === "walk") ? 1 : 0) - this.jumpBlend) * Math.min(1, dt * 10);

    if (isWalking) {
      this.walkPhase += state.moveSpeed * WALK_BASE_CADENCE * Math.PI * 2 * dt;
    }

    // 1. Reset all normalized humanoid bones to canonical rest pose
    for (const b of Object.values(this.bones)) {
      if (b) {
        b.rotation.set(0, 0, 0);
      }
    }
    const hips = this.bones.hips;
    if (hips) {
      hips.position.copy(this.restHipsPosition);
    }

    // 2. Head-First Turning & Look Tracking
    this.applyHeadFirstTurning(dt, state, targetHeadEuler, isWalking);

    // 3. Apply arm posing: either VR controller IK or procedural A-pose & locomotion
    const hasVRArms = !!(leftHandTarget || rightHandTarget);
    if (hasVRArms) {
      this.applyVRArmIK(leftHandTarget, rightHandTarget);
    } else {
      // Natural resting A-pose
      const lua = this.bones.leftUpperArm;
      const rua = this.bones.rightUpperArm;
      const lla = this.bones.leftLowerArm;
      const rla = this.bones.rightLowerArm;
      if (lua) {
        lua.rotation.z = 1.25;
        lua.rotation.x = 0.08;
        lua.rotation.y = 0.0;
      }
      if (rua) {
        rua.rotation.z = -1.25;
        rua.rotation.x = 0.08;
        rua.rotation.y = 0.0;
      }
      if (lla) {
        lla.rotation.x = 0.15;
      }
      if (rla) {
        rla.rotation.x = 0.15;
      }

      // Idle Motion (breathing, sway)
      this.applyIdle();

      // Walk Cycle arm swings
      this.applyWalk(state);
    }

    // 4. Idle motion for body when not walking
    if (!hasVRArms) {
      this.applyIdle();
    }

    // 5. Walk legs/hips
    this.applyWalkLegs(state);

    // 6. Crouch (lowered hips, bent knees, forward lean)
    this.applyCrouch();

    // 7. Jump & Airborne
    this.applyJumpLand(state);

    // 8. Auto-blinking
    this.applyBlink(dt);
  }

  private applyVRArmIK(
    leftHandTarget?: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    rightHandTarget?: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  ): void {
    const lua = this.bones.leftUpperArm;
    const lla = this.bones.leftLowerArm;
    const lh = this.bones.leftHand;

    const rua = this.bones.rightUpperArm;
    const rla = this.bones.rightLowerArm;
    const rh = this.bones.rightHand;

    const armL = this.estimatedHeight * 0.18;

    // Left Arm IK
    if (leftHandTarget && lua && lla) {
      this.solveArmIK(lua, lla, lh, leftHandTarget, true, armL);
    }
    // Right Arm IK
    if (rightHandTarget && rua && rla) {
      this.solveArmIK(rua, rla, rh, rightHandTarget, false, armL);
    }
  }

  private solveArmIK(
    upperArm: THREE.Object3D,
    lowerArm: THREE.Object3D,
    hand: THREE.Object3D | undefined,
    target: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    isLeft: boolean,
    armSegmentLen: number
  ): void {
    // Transform target world pos to vrm.scene local coordinate space
    const localTarget = target.position.clone();
    this.vrm.scene.worldToLocal(localTarget);

    const shoulderPos = upperArm.position.clone();
    const reachVec = localTarget.clone().sub(shoulderPos);
    const dist = reachVec.length();

    // Law of cosines for 2-bone arm
    const L1 = armSegmentLen;
    const L2 = armSegmentLen;
    const clampedDist = THREE.MathUtils.clamp(dist, 0.05, (L1 + L2) * 0.98);
    const cosElbow = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - clampedDist * clampedDist) / (2 * L1 * L2), -1, 1);
    const elbowBend = Math.PI - Math.acos(cosElbow);

    // Direction from shoulder to target
    reachVec.normalize();

    // Yaw and pitch toward target
    const pitch = -Math.asin(THREE.MathUtils.clamp(reachVec.y, -0.99, 0.99));
    const yaw = Math.atan2(reachVec.x, reachVec.z);

    upperArm.rotation.reorder("YXZ");
    upperArm.rotation.y = yaw;
    upperArm.rotation.x = pitch;
    upperArm.rotation.z = isLeft ? (1.25 * (1 - dist / (L1 + L2))) : (-1.25 * (1 - dist / (L1 + L2)));

    lowerArm.rotation.x = elbowBend;

    if (hand) {
      hand.quaternion.copy(target.quaternion);
    }
  }

  private applyWalkLegs(state: LocomotionState): void {
    const w = this.blendToWalk * (1 - this.blendToCrouch * 0.5) * (1 - this.jumpBlend);
    if (w < 0.001) return;

    const phase = this.walkPhase;
    const hip = this.bone("hips");
    const spine = this.bone("spine");

    if (hip) {
      hip.position.y += Math.abs(Math.sin(phase)) * 0.035 * this.estimatedHeight * w;
      hip.rotation.z += Math.sin(phase) * 0.04 * w;
      hip.rotation.y += Math.sin(phase) * 0.05 * w;
    }
    if (spine) {
      spine.rotation.x += 0.06 * state.moveSpeed * w;
      spine.rotation.z -= Math.sin(phase) * 0.03 * w;
    }

    const lul = this.bone("leftUpperLeg");
    const lll = this.bone("leftLowerLeg");
    const rul = this.bone("rightUpperLeg");
    const rll = this.bone("rightLowerLeg");
    const lf = this.bone("leftFoot");
    const rf = this.bone("rightFoot");

    if (lul) lul.rotation.x += Math.sin(phase) * 0.55 * state.moveSpeed * w;
    if (lll) lll.rotation.x -= Math.max(0, -Math.sin(phase - 0.2)) * 0.75 * state.moveSpeed * w;
    if (lf) lf.rotation.x += Math.sin(phase + 0.3) * 0.15 * w;

    if (rul) rul.rotation.x -= Math.sin(phase) * 0.55 * state.moveSpeed * w;
    if (rll) rll.rotation.x -= Math.max(0, Math.sin(phase - 0.2)) * 0.75 * state.moveSpeed * w;
    if (rf) rf.rotation.x -= Math.sin(phase + 0.3) * 0.15 * w;
  }

  private applyHeadFirstTurning(
    delta: number,
    _state: LocomotionState,
    targetHeadEuler: THREE.Euler | undefined,
    _isWalking: boolean
  ): void {
    const targetYaw = targetHeadEuler ? targetHeadEuler.y : 0;
    const targetPitch = targetHeadEuler ? targetHeadEuler.x : 0;
    const targetRoll = targetHeadEuler ? targetHeadEuler.z : 0;

    // Shortest angular difference between target head yaw and body yaw
    let diffYaw = THREE.MathUtils.euclideanModulo(targetYaw - this.bodyYaw + Math.PI, Math.PI * 2) - Math.PI;

    // Responsive body follow lerp so the body smoothly faces the look direction without twisting the neck
    const turnSpeed = 16.0;
    this.bodyYaw += diffYaw * Math.min(1, delta * turnSpeed);

    // Recompute diffYaw after lerping body yaw
    diffYaw = THREE.MathUtils.euclideanModulo(targetYaw - this.bodyYaw + Math.PI, Math.PI * 2) - Math.PI;

    // Rotate VRM root scene so body faces bodyYaw directly
    this.vrm.scene.rotation.y = this.bodyYaw;

    const clampedPitch = THREE.MathUtils.clamp(targetPitch, -1.1, 1.1);

    const neck = this.bone("neck");
    const head = this.bone("head");

    // Clean, direct gaze tracking: neck (30%) + head (70%) = 100% exact alignment with camera crosshair
    if (neck) {
      neck.rotation.reorder("YXZ");
      neck.rotation.y = diffYaw * 0.30;
      neck.rotation.x = clampedPitch * 0.30;
      neck.rotation.z = 0;
    }
    if (head) {
      head.rotation.reorder("YXZ");
      head.rotation.y = diffYaw * 0.70;
      head.rotation.x = clampedPitch * 0.70;
      head.rotation.z = targetRoll * 0.8;
    }
  }

  private applyIdle(): void {
    const idleAmount = (1 - this.blendToWalk) * (1 - this.blendToCrouch) * (1 - this.jumpBlend);
    if (idleAmount < 0.001) return;

    const t = this.time;
    // Rhythmic breathing
    const breathe = Math.sin(t * IDLE_BREATH_HZ * Math.PI * 2) * 0.02 * idleAmount;
    const spine = this.bone("spine");
    const chest = this.bone("chest");
    if (spine) spine.rotation.x += breathe;
    if (chest) chest.rotation.x += breathe * 0.7;

    // Subtle sway & weight shift
    const sway = Math.sin(t * IDLE_SWAY_HZ * Math.PI * 2) * 0.012 * idleAmount;
    const hips = this.bone("hips");
    if (hips) {
      hips.rotation.z += sway;
      hips.position.x += Math.sin(t * IDLE_WEIGHT_SHIFT_HZ * Math.PI * 2) * 0.015 * idleAmount;
    }
    if (spine) spine.rotation.z -= sway * 0.7;

    // Idle arm sway
    const lua = this.bone("leftUpperArm");
    const rua = this.bone("rightUpperArm");
    if (lua) lua.rotation.z += Math.sin(t * IDLE_SWAY_HZ * Math.PI * 2) * 0.02 * idleAmount;
    if (rua) rua.rotation.z -= Math.sin(t * IDLE_SWAY_HZ * Math.PI * 2) * 0.02 * idleAmount;
  }

  private applyWalk(state: LocomotionState): void {
    const w = this.blendToWalk * (1 - this.blendToCrouch * 0.5) * (1 - this.jumpBlend);
    if (w < 0.001) return;

    const phase = this.walkPhase;
    const hip = this.bone("hips");
    const spine = this.bone("spine");

    // Hip bob & sway
    if (hip) {
      hip.position.y += Math.abs(Math.sin(phase)) * 0.035 * this.estimatedHeight * w;
      hip.rotation.z += Math.sin(phase) * 0.04 * w;
      hip.rotation.y += Math.sin(phase) * 0.05 * w;
    }

    // Spine lean
    if (spine) {
      spine.rotation.x += 0.06 * state.moveSpeed * w;
      spine.rotation.z -= Math.sin(phase) * 0.03 * w;
    }

    // Legs: Upper thighs swing forward/back (+X forward, -X back), lower knees bend backward only (-X)
    const lul = this.bone("leftUpperLeg");
    const lll = this.bone("leftLowerLeg");
    const rul = this.bone("rightUpperLeg");
    const rll = this.bone("rightLowerLeg");
    const lf = this.bone("leftFoot");
    const rf = this.bone("rightFoot");

    if (lul) lul.rotation.x += Math.sin(phase) * 0.55 * state.moveSpeed * w;
    if (lll) lll.rotation.x -= Math.max(0, -Math.sin(phase - 0.2)) * 0.75 * state.moveSpeed * w;
    if (lf) lf.rotation.x += Math.sin(phase + 0.3) * 0.15 * w;

    if (rul) rul.rotation.x -= Math.sin(phase) * 0.55 * state.moveSpeed * w;
    if (rll) rll.rotation.x -= Math.max(0, Math.sin(phase - 0.2)) * 0.75 * state.moveSpeed * w;
    if (rf) rf.rotation.x -= Math.sin(phase + 0.3) * 0.15 * w;

    // Counter-swinging arms: Left arm swings forward when right leg swings forward
    const lua = this.bone("leftUpperArm");
    const lla = this.bone("leftLowerArm");
    const rua = this.bone("rightUpperArm");
    const rla = this.bone("rightLowerArm");

    if (lua) {
      lua.rotation.z = THREE.MathUtils.lerp(1.25, 1.15, w);
      lua.rotation.x = 0.08 - Math.sin(phase) * 0.40 * state.moveSpeed * w;
    }
    if (lla) {
      lla.rotation.x = 0.15 + Math.max(0, -Math.sin(phase)) * 0.30 * w;
    }

    if (rua) {
      rua.rotation.z = THREE.MathUtils.lerp(-1.25, -1.15, w);
      rua.rotation.x = 0.08 + Math.sin(phase) * 0.40 * state.moveSpeed * w;
    }
    if (rla) {
      rla.rotation.x = 0.15 + Math.max(0, Math.sin(phase)) * 0.30 * w;
    }
  }

  private applyCrouch(): void {
    const c = this.blendToCrouch;
    if (c < 0.001) return;

    const hip = this.bone("hips");
    const spine = this.bone("spine");
    const chest = this.bone("chest");

    // Lower hips precisely to match leg kinematics so feet remain firmly on the floor surface
    if (hip) hip.position.y = this.restHipsPosition.y - this.estimatedHeight * 0.16 * c;
    if (spine) spine.rotation.x += 0.32 * c;
    if (chest) chest.rotation.x += 0.15 * c;

    const lul = this.bone("leftUpperLeg");
    const lll = this.bone("leftLowerLeg");
    const rul = this.bone("rightUpperLeg");
    const rll = this.bone("rightLowerLeg");
    const lf = this.bone("leftFoot");
    const rf = this.bone("rightFoot");

    // Deep knee bend with proper ankle flexion so soles stay flat on the ground
    if (lul) lul.rotation.x += 1.15 * c;
    if (lll) lll.rotation.x -= 2.10 * c;
    if (lf) lf.rotation.x += 0.95 * c;

    if (rul) rul.rotation.x += 1.15 * c;
    if (rll) rll.rotation.x -= 2.10 * c;
    if (rf) rf.rotation.x += 0.95 * c;

    // Natural crouch arm placement: hands resting forward near knees for balance
    const lua = this.bone("leftUpperArm");
    const rua = this.bone("rightUpperArm");
    const lla = this.bone("leftLowerArm");
    const rla = this.bone("rightLowerArm");

    if (lua) {
      lua.rotation.z = THREE.MathUtils.lerp(1.25, 0.95, c);
      lua.rotation.x = 0.08 + 0.35 * c;
      lua.rotation.y = 0.15 * c;
    }
    if (rua) {
      rua.rotation.z = THREE.MathUtils.lerp(-1.25, -0.95, c);
      rua.rotation.x = 0.08 + 0.35 * c;
      rua.rotation.y = -0.15 * c;
    }
    if (lla) lla.rotation.x = 0.15 + 0.50 * c;
    if (rla) rla.rotation.x = 0.15 + 0.50 * c;
  }

  private applyJumpLand(state: LocomotionState): void {
    const j = this.jumpBlend;
    if (j < 0.001) return;

    const v = state.verticalVelocity;
    const lul = this.bone("leftUpperLeg");
    const rul = this.bone("rightUpperLeg");
    const lll = this.bone("leftLowerLeg");
    const rll = this.bone("rightLowerLeg");
    const lua = this.bone("leftUpperArm");
    const rua = this.bones.rightUpperArm;
    const lla = this.bone("leftLowerArm");
    const rla = this.bone("rightLowerArm");

    if (v > 0.5) {
      // Ascent: Leg tuck, arms brace
      const ascentFactor = Math.min(1, (v - 0.5) / 5) * j;
      if (lul) lul.rotation.x += 0.45 * ascentFactor;
      if (rul) rul.rotation.x += 0.45 * ascentFactor;
      if (lll) lll.rotation.x -= 0.75 * ascentFactor;
      if (rll) rll.rotation.x -= 0.75 * ascentFactor;

      if (lua) {
        lua.rotation.z = THREE.MathUtils.lerp(1.25, 0.95, ascentFactor);
        lua.rotation.x = 0.08 + 0.25 * ascentFactor;
      }
      if (rua) {
        rua.rotation.z = THREE.MathUtils.lerp(-1.25, -0.95, ascentFactor);
        rua.rotation.x = 0.08 + 0.25 * ascentFactor;
      }
      if (lla) lla.rotation.x = 0.15 + 0.30 * ascentFactor;
      if (rla) rla.rotation.x = 0.15 + 0.30 * ascentFactor;
    } else if (v < -1.5) {
      // Fast fall: Arms raise up for balance/wind resistance, legs extend slightly down
      const fallFactor = Math.min(1, Math.abs(v + 1.5) / 10) * j;
      if (lua) {
        lua.rotation.z = THREE.MathUtils.lerp(1.25, 0.60, fallFactor);
        lua.rotation.x = 0.08 + 0.20 * fallFactor;
      }
      if (rua) {
        rua.rotation.z = THREE.MathUtils.lerp(-1.25, -0.60, fallFactor);
        rua.rotation.x = 0.08 + 0.20 * fallFactor;
      }
      if (lul) lul.rotation.x -= 0.15 * fallFactor;
      if (rul) rul.rotation.x -= 0.15 * fallFactor;
      if (lll) lll.rotation.x -= 0.15 * fallFactor;
      if (rll) rll.rotation.x -= 0.15 * fallFactor;
    }
  }

  private applyBlink(delta: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    this.blinkTimer += delta;
    if (this.isBlinking) {
      this.blinkProgress += delta / 0.15;
      if (this.blinkProgress >= 1) {
        this.isBlinking = false;
        this.blinkProgress = 0;
        this.blinkTimer = 0;
        this.nextBlinkIn = 2.0 + Math.random() * 4.0;
        em.setValue("blink", 0);
      } else {
        const t = this.blinkProgress;
        const blinkVal = t < 0.45 ? (t / 0.45) : ((1 - t) / 0.55);
        em.setValue("blink", Math.max(0, Math.min(1, blinkVal)));
      }
    } else if (this.blinkTimer >= this.nextBlinkIn) {
      this.isBlinking = true;
      this.blinkProgress = 0;
    }
  }
}

