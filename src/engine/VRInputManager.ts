import * as THREE from 'three';

/**
 * VR controller button identifiers exposed to consumers. Indexed loosely
 * after the OpenXR gamepad mapping (Quest, Touch, Index, Vive all expose
 * a similar subset on indices 0-5).
 */
export type VRButtonId = 'trigger' | 'grip' | 'thumbstick' | 'a' | 'b' | 'x' | 'y';

export type ControllerSide = 'left' | 'right';

export interface ControllerState {
  /** Side label so edge callbacks know which hand fired. */
  side: ControllerSide;
  /** Thumbstick x/y in [-1,1] with a small deadzone already applied. */
  stick: THREE.Vector2;
  /** Continuous trigger pressure in [0,1]. */
  trigger: number;
  /** Continuous grip pressure in [0,1]. */
  grip: number;
  /** Discrete pressed-state per known button. */
  buttons: Record<VRButtonId, boolean>;
  /** True on the frame the button transitioned; cleared after `consumeEdges()`. */
  pressedThisFrame: Record<VRButtonId, boolean>;
  releasedThisFrame: Record<VRButtonId, boolean>;
}

export interface VRInputHandlers {
  onPressed?: (button: VRButtonId, side: ControllerSide) => void;
  onReleased?: (button: VRButtonId, side: ControllerSide) => void;
}

/**
 * Polls `controller.gamepad` every frame inside an active XR session and
 * keeps stable per-frame state plus edge-transition records so consumers
 * can subscribe to button-down / button-up without polling themselves.
 *
 * Disabled state (default): returns zeroed state on every poll, so the
 * `SceneEngine.animate` branch can run unifying math even before the user
 * enters VR.
 */
export class VRInputManager {
  public readonly left: ControllerState;
  public readonly right: ControllerState;
  public enabled = false;

  /**
   * (targetRaySpace, gripSpace) pairs. Three.js binds controller N to
   * controllerGrip N by render-index; we hand BOTH back from
   * `getController` / `getGrip` so consumers don't have to derive the
   * matching grip from a controller number themselves (and we can
   * remap correctly when a left-handed user swaps sides).
   */
  private readonly slots: ControllerSlot[];
  private handlers: VRInputHandlers = {};
  /**
   * Per-side `prev` button map — held on the SIDE not on the slot so
   * handedness remapping mid-session (rare but possible if a user
   * switches dominant-hand preference) doesn't accidentally inherit
   * the WRONG side's edge history into a freshly-assigned controller.
   */
  private prevButtons = { left: emptyPressMap(), right: emptyPressMap() };

  constructor(
    controller1: THREE.Object3D, controllerGrip1: THREE.Object3D,
    controller2: THREE.Object3D, controllerGrip2: THREE.Object3D
  ) {
    this.slots = [
      { space: controller1, grip: controllerGrip1 },
      { space: controller2, grip: controllerGrip2 }
    ];
    this.left  = freshState('left');
    this.right = freshState('right');
  }

  /**
   * Resolve the TargetRaySpace Object3D currently mapped to `side`
   * via the `connected` listener's `e.data.handedness` (stashed into
   * `userData.handedness` in SceneEngine.setupXR). Returns null if
   * that side isn't currently connected (one-handed session,
   * controller dropped, never connected yet). App.tsx's right-grip
   * grab raycast and VR HUD hover both consume this so a left-handed
   * Quest user doesn't get A/B rebound to the wrong physical hand.
   */
  public getController(side: ControllerSide): THREE.Object3D | null {
    return this.findSlotBySide(side)?.space ?? null;
  }

  /**
   * Mirror of `getController` for the grip-space. Three.js binds
   * controller N to controllerGrip N at render time, so we pair them
   * inside each slot at construction so consumers don't need to
   * re-derive the matching grip from a controller number.
   */
  public getGrip(side: ControllerSide): THREE.Object3D | null {
    return this.findSlotBySide(side)?.grip ?? null;
  }

  private findSlotBySide(side: ControllerSide): ControllerSlot | null {
    for (const slot of this.slots) {
      const h = (slot.space.userData as { handedness?: XRHandedness }).handedness;
      if (h === side) return slot;
    }
    return null;
  }

  public setHandlers(handlers: VRInputHandlers): void {
    this.handlers = handlers;
  }

  public setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    if (!v) {
      resetState(this.left);
      resetState(this.right);
      this.prevButtons.left  = emptyPressMap();
      this.prevButtons.right = emptyPressMap();
    }
  }

  /** Per-frame poll — call from `SceneEngine.animate` before locomotion. */
  public update(): void {
    if (!this.enabled) {
      resetState(this.left);
      resetState(this.right);
      return;
    }
    // Map controller -> side via `userData.handedness` (stashed by the
    // `connected` listener). Three.js's `getController(0)`/`(1)` is
    // an internal render-index, NOT a side — only the device knows,
    // which is what `e.data.handedness` reports. Polling positionally
    // was a real bug for left-handed Quest users.
    const leftSlot  = this.findSlotBySide('left');
    const rightSlot = this.findSlotBySide('right');
    this.pollInto(this.left,  leftSlot?.space  ?? null, this.prevButtons.left);
    this.pollInto(this.right, rightSlot?.space ?? null, this.prevButtons.right);
  }

  private pollInto(state: ControllerState, controller: THREE.Object3D | null, prev: Record<VRButtonId, boolean>): void {
    // Read the gamepad via the live XRInputSource.stash rather than
    // once-cached userData.gamepad. Some browser / WebXR runtimes
    // vend a static snapshot for `gamepad`; caching its reference
    // would lock axes at [0,0] for the entire session and break
    // locomotion / turn. Re-reading `.gamepad` off the inputSource
    // each frame keeps the values current. `inputSource` itself was
    // stashed by SceneEngine.setupXR's 'connected' listener; null
    // means we never received a connection (or it dropped before
    // 'disconnected' fired) so we synthesize releases for held
    // buttons to keep the user from being stranded mid-grab.
    const inputSource = controller
      ? (controller.userData as { inputSource?: { gamepad?: XRGamepadLike } | null }).inputSource
      : null;
    const gamepad = inputSource && typeof inputSource === 'object'
      ? inputSource.gamepad ?? null
      : null;

    if (!gamepad) {
      // No gamepad right now — release anything that was down last frame
      // so a button-down that lost its gamepad mid-session doesn't get stuck.
      for (const k of BUTTON_IDS) {
        if (prev[k]) {
          state.buttons[k] = false;
          state.releasedThisFrame[k] = true;
          state.pressedThisFrame[k] = false;
          prev[k] = false;
          this.handlers.onReleased?.(k, state.side);
        } else {
          state.pressedThisFrame[k] = false;
          state.releasedThisFrame[k] = false;
        }
      }
      if (state.trigger > 0) state.trigger = 0;
      if (state.grip > 0) state.grip = 0;
      state.stick.set(0, 0);
      return;
    }

    // Thumbstick axes — Quest 3 / Touch place the thumbstick at axes[2,3]
    // under the standard OpenXR mapping; axes[0,1] are reserved for the
    // touchpad (which Quest lacks, so they report zero and the stick
    // reads as dead-zone-locked zero — locomotion never started).
    // Fall back to [0,1] for controllers that only expose indices 0,1
    // (Vive wand, Index, etc. without a separate thumbstick tuple).
    // `?? 0` guard at each read defends against a freshly-delivered
    // gamepad whose `axes.length >= N` is true but whose slot is still
    // undefined — leaking NaN into `state.stick.x` would break every
    // downstream deadzone + locomotion consumer.
    const ax = gamepad.axes.length >= 3 ? (gamepad.axes[2] ?? 0) : (gamepad.axes[0] ?? 0);
    const ay = gamepad.axes.length >= 4 ? (gamepad.axes[3] ?? 0) : (gamepad.axes[1] ?? 0);
    const dz = 0.15;
    state.stick.set(
      Math.abs(ax) < dz ? 0 : ax,
      Math.abs(ay) < dz ? 0 : ay
    );

    // Trigger (index 0) + grip (index 1) report a continuous value; we
    // expose the analog value *and* a discrete pressed-state with a
    // threshold so the consumer can pick either form.
    const triggerPressed = readPressed(gamepad.buttons[0]);
    state.trigger = readValue(gamepad.buttons[0]);
    state.buttons.trigger = triggerPressed;

    const gripPressed = readPressed(gamepad.buttons[1]);
    state.grip = readValue(gamepad.buttons[1]);
    state.buttons.grip = gripPressed;

    // A/B/X/Y and thumbstick-click are pure booleans (no analog on Quest/Touch).
    // OpenXR Quest mapping: right gamepad has buttons[4]=A / [5]=B;
    // left gamepad has buttons[4]=X / [5]=Y. Read the controller's
    // handedness (stashed by SceneEngine.setupXR on userData.handedness
    // per the getController docblock above) and branch so the LEFT
    // controller's X/Y are reported as 'x'/'y' and the RIGHT's A/B
    // as 'a'/'b' — matching VRControls.txt where X is the left dash
    // button and Y is the left context-menu button.
    state.buttons.thumbstick = readPressed(gamepad.buttons[3]);
    const handedness = controller ? (controller.userData as { handedness?: XRHandedness })?.handedness : undefined;
    if (handedness === 'left') {
      state.buttons.x = readPressed(gamepad.buttons[4]);
      state.buttons.y = readPressed(gamepad.buttons[5]);
    } else {
      state.buttons.a = readPressed(gamepad.buttons[4]);
      state.buttons.b = readPressed(gamepad.buttons[5]);
    }

    // Compute edges & fire callbacks against the *previous* frame's state.
    for (const k of BUTTON_IDS) {
      const now = state.buttons[k];
      const was = prev[k];
      state.pressedThisFrame[k]   = now && !was;
      state.releasedThisFrame[k]  = !now && was;
      prev[k] = now;
      if (state.pressedThisFrame[k])  this.handlers.onPressed?.(k, state.side);
      if (state.releasedThisFrame[k]) this.handlers.onReleased?.(k, state.side);
    }
  }
}

const BUTTON_IDS: VRButtonId[] = ['trigger', 'grip', 'thumbstick', 'a', 'b', 'x', 'y'];
const PRESS_THRESHOLD = 0.5;

interface ControllerSlot {
  space: THREE.Object3D;
  grip: THREE.Object3D;
}

/** Spec-typed handedness (`XRInputSource.handedness` is one of these). */
type XRHandedness = 'left' | 'right' | 'none' | 'unknown';

interface XRGamepadLike {
  buttons: { pressed: boolean; value: number; touched?: boolean }[];
  axes: number[];
}

function emptyPressMap(): Record<VRButtonId, boolean> {
  return { trigger: false, grip: false, thumbstick: false, a: false, b: false, x: false, y: false };
}

function freshState(side: ControllerSide): ControllerState {
  return {
    side,
    stick: new THREE.Vector2(0, 0),
    trigger: 0,
    grip: 0,
    buttons: emptyPressMap(),
    pressedThisFrame: emptyPressMap(),
    releasedThisFrame: emptyPressMap(),
  };
}

function resetState(state: ControllerState): void {
  for (const k of BUTTON_IDS) {
    if (state.buttons[k]) {
      state.buttons[k] = false;
      state.releasedThisFrame[k] = true;
    } else {
      state.releasedThisFrame[k] = false;
    }
    state.pressedThisFrame[k] = false;
  }
  state.trigger = 0;
  state.grip = 0;
  state.stick.set(0, 0);
}

function readValue(b: { pressed: boolean; value: number } | undefined): number {
  if (!b) return 0;
  // Some controllers report a constant `value` of 0 even when `pressed`.
  // Trust the boolean first if the value looks stale.
  return b.pressed ? Math.max(b.value, 1) : b.value;
}

function readPressed(b: { pressed: boolean; value: number } | undefined): boolean {
  if (!b) return false;
  return b.pressed || b.value > PRESS_THRESHOLD;
}
