import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { LoadedAsset } from './AssetManager.ts';
import type { VRInputManager } from './VRInputManager.ts';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface TransformUpdate {
  assetId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  isCollidable: boolean;
  // Optional persistent flag — mirrored from
  // `asset.object3d.userData.isPersistent` (which the SceneInspector
  // tree reads for the orange-dot indicator AND the inspector
  // checkbox writes when toggled). Sourcing from userData on both
  // ends keeps the receive-side `applyRemoteTransform` write path
  // consistent with the on-disk convention and lets late-joiners
  // get the right persisting behaviour on first spawn without
  // needing a second 'pers' envelope channel.
  isPersistent?: boolean;
}

interface VRHandGrabState {
  asset: LoadedAsset;
  originalParent: THREE.Object3D;
  targetRaySpace: THREE.Object3D | null;
  holdLocalOffset: THREE.Vector3;
  lockControllerRotation: boolean;
  lockedWorldQuaternion: THREE.Quaternion;
}

export class ManipulationManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  public transformControls!: TransformControls;
  public selectedAsset: LoadedAsset | null = null;

  // Asset map for RMB-grab raycasting (right-click on an object to grab it).
  // Reference is held by App.tsx (assetManager.assets) so asset additions /
  // removals are picked up without re-binding. Optional for tests/legacy
  // construction paths.
  private assetMap: Map<string, LoadedAsset> | null = null;

  private onTransformChangeCallbacks: Set<(update: TransformUpdate) => void> = new Set();
  private onSelectionChangeCallbacks: Set<(asset: LoadedAsset | null) => void> = new Set();
  private onScaleSelfCallbacks: Set<(factor: number) => void> = new Set();
  private onDragCallbacks: Set<(isDragging: boolean) => void> = new Set();
  public isDragging = false;
  private isEKeyPressed = false;
  // Tracks whether OrbitControls was enabled BEFORE a TransformControls drag
  // started, so we can restore the correct state when the drag ends. Without
  // this, the dragging-changed handler blindly sets `orbitControls.enabled = true`
  // when the drag ends, re-enabling orbit even in first-person mode.
  private orbitWasEnabledBeforeDrag = true;
  private orbitControls: any = null;

  // ====== RMB-grab state (Controls-Keybinds.txt: Right Mouse Button - Grab - Move objects) ======
  // The grabbed asset and a flat "we are mid-drag" flag, distinct from
  // `isDragging` (which TransformControls also flips). Public so App.tsx
  // can read it for UI hints; the same `onDragChange` callbacks fire for
  // grab so the undo-snapshot wiring in App.tsx picks up grabs
  // automatically.
  public grabbedAsset: LoadedAsset | null = null;
  public isGrabDragging = false;
  // Callbacks fired at grab begin / end. SUBSCRIBE via `registerOnGrabBegin`
  // and `registerOnGrabEnd` from App.tsx or other consumers. These exist
  // so grab-only listeners (e.g. misc-file auto-inspect in App.tsx, which
  // used to piggy-back on `selectAsset`/`onSelectionChange`) can fire
  // without us having to flip selection state from inside `beginGrab`
  // (which would re-introduce the RMB-mirrors-press-R symptom).
  private onGrabBeginCallbacks: Set<(asset: LoadedAsset, side?: 'left' | 'right') => void> = new Set();
  private onGrabEndCallbacks: Set<(side?: 'left' | 'right') => void> = new Set();
  // Camera-anchored carry-mode state. The only state we capture at
  // grab-time is `_grabDepth` (Euclidean camera-to-anchor distance).
  // Each subsequent mousemove rebuilds the asset's world position from
  // the CURRENT camera and cursor:
  //
  //   asset.position = camera.position
  //                  + cameraForward   · _grabDepth                  (frozen depth)
  //                  + cameraRight     · (cursorNdcX · frustumHalfW) (cursor X)
  //                  + cameraUp        · (cursorNdcY · frustumHalfH) (cursor Y)
  //
  // Effects:
  //   - Camera TRANSLATION (WASD in first-person): `camera.position`
  //     changes → asset.position picks it up automatically.
  //   - Camera ROTATION (mouse-look / orbit-drag): basis vectors rotate
  //     with the camera → asset orbits at fixed radius, like a held
  //     gravity-gun item ("moves with view").
  //   - Cursor POSITION (free-cursor mode): cursorNdcX/Y scaled by the
  //     depth-frozen frustum-half extents → linear 1:1 cursor tracking
  //     on a constant-distance grab plane.
  //
  // Under pointer-lock the cursor conceptually parks at NDC (0,0) and
  // mouse motion drives VIEW rotation, so the cursor offset is forced
  // to (0,0) in onMouseMove. The asset stays centered in view and
  // orbits at fixed radius as the user head-turns — exactly the
  // gravity-gun feel.
  //
  // Why a single depth scalar (not a 3-component local offset): the
  // direct on-cursor-NDC offset for right/up already places the asset
  // at the cursor's screen position, so we only need the depth (the
  // camera-forward distance) to fix how far in front the asset sits.
  // Using Euclidean distance (not the forward-projection of relOffset)
  // also avoids a tiny artifact in free-cursor mode where an off-center
  // grab would otherwise skew depth by `O(ndc^2)`.
  private _grabDepth = 0;
  private _grabNdcX = 0;
  private _grabNdcY = 0;
  // World-frame vector from the grabbed asset's origin to the raycast
  // hit point at grab-time. Preserved through the carry so the cursor
  // stays glued to the same surface point the user targeted, instead of
  // recentering on the model's origin (which would visually jump the
  // model up/down on grab when origin ≠ visual center, e.g. a tower
  // with origin at its base). Stored as a Vector3 — the offset has
  // three world-frame components, not a single camera-forward scalar.
  private _grabOffsetWorld: THREE.Vector3 = new THREE.Vector3();
  // Scratch vectors so the per-frame math is allocation-free.
  private readonly _tmpForward = new THREE.Vector3();
  private readonly _tmpRight = new THREE.Vector3();
  private readonly _tmpUp = new THREE.Vector3();
  private readonly _tmpDesired = new THREE.Vector3();
  // Per-frame scratch fields for the rotation-around-pivot transform.
  // Dedicated (rather than reusing `_tmpForward`/`_tmpRight`) so the
  // E+drag path never collides with `updateGrabbedAssetPosition`'s
  // basis math — keeping both code paths allocation-free means we
  // never allocate a Quaternion or Vector3 in the 60–90 Hz input loop.
  // The pivot itself is derived per-frame as `asset.position +
  // _grabOffsetWorld` (the cursor's current world-frame hit point on
  // the asset, equal to the carry's `_tmpDesired`), so no stored
  // pivot state is needed.
  private readonly _tmpRotAxis: THREE.Vector3 = new THREE.Vector3();
  private readonly _tmpRotQuat: THREE.Quaternion = new THREE.Quaternion();
  private readonly _tmpRotAxisQ: THREE.Quaternion = new THREE.Quaternion();
  private readonly _tmpRotVec: THREE.Vector3 = new THREE.Vector3();
  private readonly _tmpRotNdc: THREE.Vector2 = new THREE.Vector2();
  private readonly _tmpRotRay: THREE.Raycaster = new THREE.Raycaster();
  private readonly _tmpRotPivot: THREE.Vector3 = new THREE.Vector3();
  // ====== DEBUG ======
  // [RMB]-prefixed console.log instrumentation for the grab flow.
  // Reset on every beginGrab; +1 on every onMouseMove RMB-grab tick.
  // Keeps the per-move spam to a sane first-N-events burst per grab so
  // the dev console doesn't melt at 60 Hz. Toggle by changing
  // `RMB_DEBUG_ENABLED` to false (or scoping each call with a guard).
  // Filter the console by `-` prefix or grep for `[RMB]` to mute.
  private static readonly RMB_DEBUG_ENABLED = true;

  // ====== VR Controller grab (WebXR right-grip button) ======
  // Distinct from `isGrabDragging` (desktop RMB-grab). When active,
  // `update()` skips carry math entirely — the asset is a child of
  // the controller's grip space and Three.js' parent.matrixWorld
  // propagation makes it physically follow the user's hand. We still
  // broadcast the resulting world transform every frame so peers see
  // the asset move with the local user's controller.
  private _isVRGrabbing = false;
  // ====== VR dolly (thumbstick push/pull on the holding controller) ======
  // When `_isVRGrabbing === true`, the holding controller's thumbstick
  // Y axis is reinterpreted as a distance dolly: push forward to push
  // the asset further from the grip, pull back to bring it closer. The
  // non-spec Quest browser mapping (VRInputManager already documented)
  // reports stick.y < 0 on forward push, so the math below works as
  // written. Re-introduce a sign flip if a spec-compliant device is
  // ever verified to report the opposite.
  //
  // The local-position write respects the GRIP's local -Z forward axis
  // (the controller's pointing direction, derived from the user's
  // wrist orientation), not the HMD's forward. Rotating the controller
  // mid-carry changes the dolly direction along with the held object,
  // so a sideways-pointing grip dollies the asset sideways — matches
  // the Resonite "you push the held object away from your hand" feel.
  //
  // Capture-at-grab: `gripSpace.attach(asset)` preserves the asset's
  // world transform, so `asset.object3d.position` is the world-space
  // offset from the grip at the moment of grab — typically ~2m of -Z
  // when the user raycasts an object 2m ahead. The dolly path below
  // modifies only Z, so any lateral grab offset (an object 1m to the
  // right of the controller, for example) is preserved through the
  // carry and the asset only changes forward distance.
  private readonly _vrHoldLocalOffset: THREE.Vector3 = new THREE.Vector3();
  // Allocation-free scratch for broadcastCurrentTransform's world-matrix
  // decomposition. Required when the asset is parented to a non-scene
  // object (e.g. controllerGrip during a VR grab): local position /
  // rotation / scale stay at the grab-time values while worldMatrix
  // follows the user's hand. Reading world transform is the only way
  // to broadcast what the user actually sees.
  private readonly _broadcastPos: THREE.Vector3 = new THREE.Vector3();
  private readonly _broadcastQuat: THREE.Quaternion = new THREE.Quaternion();
  private readonly _broadcastScale: THREE.Vector3 = new THREE.Vector3();
  private readonly _broadcastEuler: THREE.Euler = new THREE.Euler();
  private readonly _vrUpVec: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  // Which hand is holding the asset — used to index the correct
  // `vrInput.{left,right}.stick` so the dolly comes from the HOLDING
  // controller, not whichever stick the user happens to deflect.
  // Currently always 'right' (the only grab path wires right-grip),
  // but generalized so a left-hand grab path is a one-liner.
  private _vrHandGrabs: {
    left: VRHandGrabState | null;
    right: VRHandGrabState | null;
  } = { left: null, right: null };
  private _vrHoldingSide: 'left' | 'right' | null = null;
  // Injected from App.tsx after construction via `setVRInput()`. Null
  // is safe — the dolly path early-returns and the held asset just
  // follows the controller without any push/pull affordance (matches
  // the pre-feature behavior, so a null wiring is backwards-compatible).
  private _vrInput: VRInputManager | null = null;
  // Dolly speed in m/s at FULL stick deflection. Picked to match the
  // desktop wheel-dolly feel (Mouse Wheel Move Away/Towards in
  // Controls-Keybinds.txt) — at this rate sustained full deflection
  // reaches MAX_DIST in ~3 seconds, which feels responsive without
  // being twitchy. Partial deflection scales linearly.
  private static readonly VR_HOLD_DOLLY_SPEED = 1.5;
  private static readonly VR_HOLD_ROTATE_SPEED = 2.5;
  // Closest the asset can be dollied to the controller grip origin.
  // Prevents the asset from clipping into the controller model and
  // into the user's hand. 0.2m is the natural "hold it up to inspect"
  // distance without the held object visually merging with the
  // controller's own geometry.
  private static readonly VR_HOLD_MIN_DIST = 0.2;
  // Furthest the asset can be dollied away. Long enough for "throw
  // it across the room" intent, short enough that the asset stays
  // grounded in the workspace rather than vanishing into the horizon.
  // Increase for power users who want long reach.
  private static readonly VR_HOLD_MAX_DIST = 5.0;
  // ====== Two-handed grab (both triggers + both lasers on same asset) ======
  // Resonite-style two-handed scale: with the trigger pulled on each
  // controller and both lasers pointed at the same asset, the user can
  // pull the controllers apart to grow the asset or push them together
  // to shrink it. The scale factor is the current grip-to-grip distance
  // divided by the distance captured at grab-time, so "the same
  // distance as when I started grabbing" is 1.0× scale, "twice as
  // far apart" is 2.0×, etc. Uniform on x/y/z (not the rubber-sheet
  // per-axis stretch) because the user asked for "bigger and smaller",
  // not "squish along the line between my hands". Origin-centered
  // (Three.js scale() has no pivot param, so the asset grows from its
  // local origin) — for meshes whose origin is at the visual center
  // this is intuitive; for off-origin meshes the user can re-grab to
  // recenter. Coexists with the single-handed grip-grab because the
  // inputs are different (trigger vs grip), but if the same asset is
  // currently single-handed-grabbed, `beginTwoHandedGrab` ends the
  // single-handed grab first so we don't have conflicting grab
  // ownership on the same object.
  public get isTwoHandedGrabbing(): boolean { return this._twoHandedAsset !== null; }
  private _lastTriggerPressTime: { left: number; right: number } = { left: 0, right: 0 };
  public isVRHandGrabbing(side: 'left' | 'right'): boolean {
    if (this.isTwoHandedGrabbing) return true;
    return !!this._vrHandGrabs[side];
  }
  public getHandGrabAsset(side: 'left' | 'right'): LoadedAsset | null {
    return this._vrHandGrabs[side]?.asset ?? null;
  }
  private _twoHandedAsset: LoadedAsset | null = null;
  // Distance between the two grip spaces at the moment the two-handed
  // grab began. Reference for the scale factor: ratio of current
  // grip distance to this initial value. Guards below floor it at
  // 1mm in the begin method so a coincident-start (both hands on
  // the same world point) doesn't cause a div-by-zero on the first
  // dolly frame.
  private _twoHandedInitialDistance: number = 0;
  // Asset scale at the moment the two-handed grab began. Multiplied
  // by the per-frame scale factor to get the new scale, so releasing
  // the grab leaves the asset at whatever size the user grew/shrunk
  // it to (no snap-back). Without this, releasing a 2×-grown asset
  // would collapse it back to its pre-grab size — surprising.
  private readonly _twoHandedInitialScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  private readonly _twoHandedInitialMidpoint: THREE.Vector3 = new THREE.Vector3();
  private readonly _twoHandedInitialPosition: THREE.Vector3 = new THREE.Vector3();
  // Floor / ceiling on the per-frame scale factor relative to the
  // captured initial scale.
  private static readonly TWO_HANDED_MIN_SCALE = 0.02;
  private static readonly TWO_HANDED_MAX_SCALE = 50.0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement,
    orbitControls?: any,
    assetMap?: Map<string, LoadedAsset>
  ) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.assetMap = assetMap ?? null;

    this.init(orbitControls);
  }

  /**
   * Refresh the raycast target list used by RMB-grab. The AssetManager
   * mutates its `assets` Map in place, so a single reference held here is
   * always live — this method is only needed if the holder swaps the Map
   * identity (rare; defensive against tests / future refactors).
   */
  public setAssetMap(map: Map<string, LoadedAsset> | null): void {
    this.assetMap = map;
  }

  /**
   * Inject the VR input source so the VR-grab dolly logic in
   * `update()` can read the holding controller's stick Y. App.tsx
   * calls this once after constructing the manager with the
   * SceneEngine's already-initialized `vrInput` reference (the
   * SceneEngine constructs VRInputManager synchronously in its
   * constructor, so the ref is live by the time this setter is
   * called). Passing null disables the dolly entirely — the held
   * asset continues to follow the hand as before, no push/pull.
   */
  public setVRInput(input: VRInputManager | null): void {
    this._vrInput = input;
  }

  private init(orbitControls?: any): void {
    this.orbitControls = orbitControls || null;
    // IMPORTANT: register the RMB-grab pointerdown handler BEFORE
    // constructing TransformControls. DOM listeners on the same element +
    // same event fire in registration order during the bubble phase, so my
    // listener fires first; on RMB hits that begin a grab I call
    // `stopImmediatePropagation` to prevent TC's pointerdown from also
    // starting a gizmo drag on the same event.
    this.domElement.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('mousedown', this.onMouseDownWindow, { capture: true });
    // pointerup on the window — not the canvas — so a release outside the
    // canvas (e.g. cursor dragged off the window) still ends the grab.
    window.addEventListener('pointerup', this.onPointerUpWindow);
    // Window-blur safety net: if the user alt-tabs mid-grab, mouseup never
    // fires; without this the cursor stays "grabbing" and `isGrabDragging`
    // stays true until the next pointerdown.
    window.addEventListener('blur', this.onWindowBlur);

    this.transformControls = new TransformControls(this.camera, this.domElement);
    this.transformControls.size = 0.9;
    this.transformControls.space = 'local';

    // In Three.js TransformControls, either getHelper() is present or cast to Object3D
    const helper = (this.transformControls as any).getHelper ? (this.transformControls as any).getHelper() : (this.transformControls as unknown as THREE.Object3D);
    this.scene.add(helper);

    // Disable orbit controls while dragging gizmo, but restore the
    // previous state when the drag ends instead of blindly enabling them.
    // This prevents re-enabling orbit controls in first-person mode after
    // a TransformControls drag completes.
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.isDragging = !!event.value;
      if (orbitControls) {
        if (event.value) {
          // Drag started: save current enabled state and disable
          this.orbitWasEnabledBeforeDrag = orbitControls.enabled;
          orbitControls.enabled = false;
        } else {
          // Drag ended: restore previous state
          orbitControls.enabled = this.orbitWasEnabledBeforeDrag;
        }
      }
      for (const cb of this.onDragCallbacks) cb(this.isDragging);
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (!this.selectedAsset) return;
      this.broadcastCurrentTransform();
    });

    // Wire up Mouse Wheel Shortcuts (Move Away/Towards, Scale Item, Scale Self)
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onMouseMove);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  // ===========================================================================
  // RMB-grab: pointerdown / pointerup / blur handlers + projection math
  // ===========================================================================
  // Public so it can be reused by tests / future extensions that want to
  // start a grab programmatically.
  public beginGrab(asset: LoadedAsset, anchorWorld: THREE.Vector3): void {
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] beginGrab ENTER  asset.id=${asset.id}  asset.type=${asset.type}  anchorWorld=(${anchorWorld.x.toFixed(3)}, ${anchorWorld.y.toFixed(3)}, ${anchorWorld.z.toFixed(3)})  prev.isGrabDragging=${this.isGrabDragging}`
      );
    }
    this.grabbedAsset = asset;

    // Capture carry-mode state: just the Euclidean camera-to-anchor
    // distance. The per-frame rebuild reads the camera's CURRENT basis
    // (rotated/translated with the camera during the carry) so the asset
    // follows the camera's transform instead of staying at a frozen
    // world anchor. This is the camera-anchored "gravity gun" pattern:
    // WASD translates the camera → asset follows; mouse-look rotates the
    // camera → asset orbits at fixed radius; cursor (free-cursor mode)
    // drives a screen-space offset on top of the depth.
    this._grabDepth = this.camera.position.distanceTo(anchorWorld);
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] beginGrab setup  _grabDepth=${this._grabDepth.toFixed(3)}  cameraPos=(${this.camera.position.x.toFixed(3)}, ${this.camera.position.y.toFixed(3)}, ${this.camera.position.z.toFixed(3)})  isPointerLocked=${document.pointerLockElement === this.domElement}`
      );
    }

    // Selection state is intentionally NOT touched here. The dev tool's
    // secondary action (keybind R) is the canonical way to enter the
    // long-lived "selected" state — calling selectAsset() here made RMB
    // feel identical to press-R: orange selection chip, gizmo flash,
    // onSelectionChange React re-render. Grab is a transient operation
    // that should leave selection state alone.

    // Hide the gizmo during the manual drag — gizmo helper lines would
    // visually overlap with the carried object. endGrab reattaches on
    // release to whatever selectedAsset was before grab (unchanged).
    this.transformControls.detach();
    if (this.orbitControls) {
      this.orbitWasEnabledBeforeDrag = this.orbitControls.enabled;
      this.orbitControls.enabled = false;
    }

    this.isGrabDragging = true;
    // Slice off a separate signal so misc-type auto-inspect in App.tsx
    // (and any future grab-only listeners) can fire without piggy-
    // backing on selectionChange. Fire BEFORE onDragChange(true) so a
    // consumer that wants to know the grabbed asset gets the reference
    // intact (onDragChange has no asset argument).
    for (const cb of this.onGrabBeginCallbacks) cb(asset);
    // Mirror TC's dragging flag so App.tsx's onDragChange listener picks
    // up the grab as a draggable range for undo-snapshot capture, AND
    // applyRemoteTransform suppresses redundant echoes of our own
    // broadcasts back to ourselves.
    this.isDragging = true;
    for (const cb of this.onDragCallbacks) cb(true);

    this.domElement.style.cursor = 'grabbing';
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] beginGrab EXIT   isGrabDragging=true  grabbedAsset.id=${this.grabbedAsset?.id ?? 'null'}  cursor="grabbing"`
      );
    }
  }

  // ===========================================================================
  // VR Controller grab — right-grip edge → `vrGrabWithController`;
  //                    right-grip release → `vrReleaseControllerGrab`.
  // Re-parents the asset to `controllerGrip2` so Three.js makes it follow
  // the user's hand. selection/drag bookkeeping is shared with RMB-grab
  // so undo/log listeners don't need to branch on grab mode.
  // ===========================================================================
  /**
   * Pin the asset to a controller grip space. `gripSpace.attach(asset)`
   * preserves world transform, so the asset visually stays where the
   * raycast hit and then tracks the user's hand as they move. Throws no
   * errors on a re-entrant call (the second call is a no-op).
   *
   * Trade-off: re-parenting makes `asset.quaternion` track the
   * controller grip's quaternion each frame (parent.matrixWorld is the
   * only thing that updates). For Resonite-style "held object" UX this
   * is correct. For tools that should stay world-aligned (magic staff,
   * paintbrush), this would feel "tilted" with the user's wrist — fix
   * later by capturing the asset's local rotation at grab-time and
   * multiplying by `gripSpace.quaternion.invert()` each frame.
   */
  public vrGrabWithController(
    asset: LoadedAsset,
    gripSpace: THREE.Object3D,
    side: 'left' | 'right' = 'right',
    targetRaySpace?: THREE.Object3D
  ): void {
    if (this._vrHandGrabs[side] !== null) return;
    const otherSide = side === 'left' ? 'right' : 'left';
    if (this._vrHandGrabs[otherSide]?.asset === asset) {
      const leftGrip = this._vrInput?.getGrip('left');
      const rightGrip = this._vrInput?.getGrip('right');
      const posL = leftGrip ? leftGrip.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      const posR = rightGrip ? rightGrip.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      this.beginTwoHandedGrab(asset, posL, posR);
      return;
    }

    const lockedWorldQuaternion = new THREE.Quaternion();
    asset.object3d.getWorldQuaternion(lockedWorldQuaternion);

    this._vrHandGrabs[side] = {
      asset,
      originalParent: asset.object3d.parent ?? this.scene,
      targetRaySpace: targetRaySpace ?? null,
      holdLocalOffset: asset.object3d.position.clone(),
      lockControllerRotation: true,
      lockedWorldQuaternion,
    };

    gripSpace.attach(asset.object3d);

    this.grabbedAsset = asset;
    this.isGrabDragging = true;
    this._isVRGrabbing = true;
    this._vrHoldingSide = side;

    this.transformControls.detach();
    if (this.orbitControls && this.orbitControls.enabled) {
      this.orbitWasEnabledBeforeDrag = this.orbitControls.enabled;
      this.orbitControls.enabled = false;
    }
    for (const cb of this.onGrabBeginCallbacks) cb(asset, side);
    this.isDragging = true;
    for (const cb of this.onDragCallbacks) cb(true);
    this._vrHoldLocalOffset.copy(asset.object3d.position);
  }

  public vrReleaseControllerGrab(side?: 'left' | 'right'): void {
    if (!this._isVRGrabbing) return;
    if (side === 'left' || side === 'right') {
      const grab = this._vrHandGrabs[side];
      if (!grab) return;
      const releaseParent = grab.originalParent ?? this.scene;
      releaseParent.attach(grab.asset.object3d);
      this._vrHandGrabs[side] = null;
      for (const cb of this.onGrabEndCallbacks) cb(side);

      const remainingSide = this._vrHandGrabs.left ? 'left' : this._vrHandGrabs.right ? 'right' : null;
      if (remainingSide) {
        const remainingGrab = this._vrHandGrabs[remainingSide]!;
        this.grabbedAsset = remainingGrab.asset;
        this._vrHoldingSide = remainingSide;
      } else {
        this._isVRGrabbing = false;
        this.isGrabDragging = false;
        this.grabbedAsset = null;
        this._vrHoldingSide = null;
        if (this.orbitControls) {
          this.orbitControls.enabled = this.orbitWasEnabledBeforeDrag;
        }
        if (this.selectedAsset) {
          this.transformControls.attach(this.selectedAsset.object3d);
        }
        this.isDragging = false;
        for (const cb of this.onDragCallbacks) cb(false);
      }
      return;
    }
    if (this._vrHandGrabs.left) this.vrReleaseControllerGrab('left');
    if (this._vrHandGrabs.right) this.vrReleaseControllerGrab('right');
    if (this._isVRGrabbing) this.endGrab();
  }

  public handleVRTriggerPress(side: 'left' | 'right'): boolean {
    const grab = this._vrHandGrabs[side];
    if (!grab) return false;
    const now = performance.now();
    const elapsed = now - this._lastTriggerPressTime[side];
    this._lastTriggerPressTime[side] = now;
    if (elapsed < 400) {
      grab.lockControllerRotation = !grab.lockControllerRotation;
      if (grab.lockControllerRotation) {
        grab.asset.object3d.getWorldQuaternion(grab.lockedWorldQuaternion);
      }
      return true;
    }
    return false;
  }

  public endGrab(): void {
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] endGrab   called  was.isGrabDragging=${this.isGrabDragging}  grabbedAsset.id=${this.grabbedAsset?.id ?? 'null'}  (no-op if false)`
      );
    }
    if (!this.isGrabDragging) return;
    if (this._isVRGrabbing) {
      if (this._vrHandGrabs.left) {
        const grabL = this._vrHandGrabs.left;
        (grabL.originalParent ?? this.scene).attach(grabL.asset.object3d);
        this._vrHandGrabs.left = null;
        for (const cb of this.onGrabEndCallbacks) cb('left');
      }
      if (this._vrHandGrabs.right) {
        const grabR = this._vrHandGrabs.right;
        (grabR.originalParent ?? this.scene).attach(grabR.asset.object3d);
        this._vrHandGrabs.right = null;
        for (const cb of this.onGrabEndCallbacks) cb('right');
      }
      this._isVRGrabbing = false;
      this._vrHoldingSide = null;
    }
    if (this.orbitControls) {
      this.orbitControls.enabled = this.orbitWasEnabledBeforeDrag;
    }
    if (this.selectedAsset) {
      this.transformControls.attach(this.selectedAsset.object3d);
    }
    this.isGrabDragging = false;
    this.grabbedAsset = null;
    this.domElement.style.cursor = '';
    this.isDragging = false;
    for (const cb of this.onDragCallbacks) cb(false);
    for (const cb of this.onGrabEndCallbacks) cb(undefined);
  }

  /**
   * Pin an asset into two-handed scale-grab mode. The user pulls
   * the trigger on BOTH controllers and points both lasers at the
   * same asset; App.tsx is responsible for detecting that the
   * trigger on `otherSide` is also currently held (otherwise the
   * single-handed trigger handler — currently the VR HUD click
   — runs instead).
   *
   * Captures the grip-to-grip distance at the moment of grab so
   * the per-frame `update()` path can compute scale = currentDist
   / initialDist. `gripLeftPos` / `gripRightPos` are pre-read by
   the caller from the grip spaces' world matrices because this
   method is on the manager and doesn't have direct scene access.
   *
   * Re-entrant safety: no-op if a two-handed grab is already in
   flight on any asset. If the same asset is currently single-
   handed-grabbed via grip, ends the single-handed grab first so
   the user has a single consistent grab-state machine on the
   object (a mix of grip-held-by-one-hand + trigger-scale-by-both-
   hands would compete for `isDragging` and undo snapshots).
   */
  /**
   * Transfer the active grab from `grabbedAsset` to `newAsset` without
   * requiring the user to release + re-grab. Used by handleDuplicateHeld
   * and (conditionally) handleDuplicateSelected so that "duplicate while
   * holding" lands on the new instance instead of the original.
   *
   * VR path: capture `gripSpace` (the current parent of the grabbed
   * asset) and `_vrHoldingSide` BEFORE calling `endGrab` (which clears
   * both fields), then re-attach `newAsset` to the same gripSpace with
   * `vrGrabWithController`. `Object3D.attach()` preserves the duplicate's
   * world transform so the just-spawned offset position is maintained
   * across the swap.
   *
   * Desktop path: snapshot the duplicate's world position (its spawned
   * offset) before `endGrab`, then `beginGrab` with that anchor so the
   * cursor-to-asset carry distance is deterministic.
   *
   * Re-entrant safety: `endGrab` fires `onGrabEnd` callbacks (undo
   * snapshot, selection state detach); `vrGrabWithController` /
   * `beginGrab` fire `onGrabBegin` immediately after. Downstream
   * listeners see the drop-then-restart sequence and snapshot the
   * duplicate's starting transform correctly.
   *
   * No-op when nothing is currently grabbed. Two-handed grabs do NOT
   * transfer (re-calling `beginTwoHandedGrab(newAsset, ...)` would need
   * the live grip positions, and the user expectation for Ctrl+D during
   * a two-handed scale is to keep scaling the original).
   */
  public swapGrabbedAsset(newAsset: LoadedAsset): void {
    if (!this.isGrabDragging || !this.grabbedAsset) return;
    if (this._isVRGrabbing) {
      const side = this._vrHoldingSide ?? 'right';
      const gripSpace = this.grabbedAsset.object3d.parent as THREE.Object3D | null;
      this.endGrab();
      if (gripSpace) {
        this.vrGrabWithController(newAsset, gripSpace, side);
      }
    } else if (!this.isTwoHandedGrabbing) {
      const anchorWorld = new THREE.Vector3();
      newAsset.object3d.getWorldPosition(anchorWorld);
      this.endGrab();
      this.beginGrab(newAsset, anchorWorld);
    }
  }

  public beginTwoHandedGrab(
    asset: LoadedAsset,
    gripLeftPos: THREE.Vector3,
    gripRightPos: THREE.Vector3
  ): void {
    if (this._twoHandedAsset) return;
    if (this._vrHandGrabs.left?.asset === asset) this.vrReleaseControllerGrab('left');
    if (this._vrHandGrabs.right?.asset === asset) this.vrReleaseControllerGrab('right');
    if (this._isVRGrabbing && this.grabbedAsset === asset) {
      this.endGrab();
    }
    this._twoHandedAsset = asset;
    const dist = gripLeftPos.distanceTo(gripRightPos);
    this._twoHandedInitialDistance = Math.max(0.05, dist);
    this._twoHandedInitialScale.copy(asset.object3d.scale);
    this._twoHandedInitialMidpoint.copy(gripLeftPos).add(gripRightPos).multiplyScalar(0.5);
    this._twoHandedInitialPosition.copy(asset.object3d.position);
    // Hide the gizmo during two-handed scale — the gizmo's
    // scale handles overlap the held object and confuse the
    // read of the actual mesh size.
    this.transformControls.detach();
    // Mirror the bookkeeping that `vrGrabWithController` does so
    // undo-listening code paths (which subscribe to onGrabBegin
    // / onDragChange(true)) fire exactly once per grab regardless
    // of input source.
    for (const cb of this.onGrabBeginCallbacks) cb(asset);
    this.isDragging = true;
    for (const cb of this.onDragCallbacks) cb(true);
  }

  /**
   * Release the two-handed held asset. Safe to call when no
   two-handed grab is in flight — no-op. Does NOT undo any
   scale the user applied: the asset is left at whatever size
   the user grew/shrunk it to, matching the Resonite-style
   "commit on release" behavior. If the user wants the original
   size back, they undo via Ctrl+Z (the onDragChange listener
   in App.tsx snapshots before/after for the undo stack).
   */
  public endTwoHandedGrab(): void {
    if (!this._twoHandedAsset) return;
    this._twoHandedAsset = null;
    this._twoHandedInitialDistance = 0;
    // Re-attach the gizmo to the currently-selected asset (TC.attach
    // is idempotent; safe even if nothing changed). Mirrors the
    // reattach in `endGrab` so the gizmo comes back when the user
    // finishes scaling.
    if (this.selectedAsset) {
      this.transformControls.attach(this.selectedAsset.object3d);
    }
    this.isDragging = false;
    for (const cb of this.onDragCallbacks) cb(false);
    for (const cb of this.onGrabEndCallbacks) cb();
  }

  private onPointerDown = (e: PointerEvent): void => {
    // [RMB] entry log — first thing fired, so if you see NO [RMB] log
    // at all when you press RMB, the listener isn't bound (init() didn't
    // run, or another before-this handler captured the event).
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] onPointerDown ENTER  button=${e.button}  (expected 2)  pointerType=${e.pointerType}  isGrabDragging(before)=${this.isGrabDragging}  assetMap.size=${this.assetMap?.size ?? 'null'}  isPointerLocked=${document.pointerLockElement === this.domElement}`
      );
    }
    if (e.button !== 2) {
      if (ManipulationManager.RMB_DEBUG_ENABLED) {
        console.log(`[RMB] onPointerDown EARLY-RETURN  reason=button_is_not_2  (got ${e.button})`);
      }
      return;       // Right mouse button only
    }
    if (this.isGrabDragging) {
      if (ManipulationManager.RMB_DEBUG_ENABLED) {
        console.log(`[RMB] onPointerDown EARLY-RETURN  reason=already_grabbing  asset=${this.grabbedAsset?.id ?? 'null'}`);
      }
      return;
    }

    // Hoisted to top per review feedback: RMB is unconditionally reserved
    // for grab per Controls-Keybinds.txt, even on empty-space hits.
    //  - preventDefault blocks the browser's native contextmenu (which
    //    fires on RMB release, independently of pointerdown).
    //  - stopImmediatePropagation cancels TransformControls's same-event
    //    pointerdown so the gizmo never interprets an RMB as a gizmo-drag
    //    attempt, even if the cursor happened to be hovering a translated
    //    gizmo handle on empty world space. My listener registered first
    //    in `init()`, so it fires first in bubble and the cancel wins.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!this.assetMap || this.assetMap.size === 0) {
      if (ManipulationManager.RMB_DEBUG_ENABLED) {
        console.log(`[RMB] onPointerDown EARLY-RETURN  reason=assetMap_empty  (assetMap is null or has 0 entries — nothing to grab)`);
      }
      return;
      // Spec: RMB on empty world does nothing further.
    }

    const rect = this.domElement.getBoundingClientRect();

    // Canonical cursor in canvas-relative pixels. Pointer-lock branch
    // returns canvas center because the browser intentionally freezes
    // e.clientX/Y at the last position reported BEFORE lock engaged, not
    // at the user's gaze (which is the lock target). Reading the frozen
    // values would raycast the wrong screen point and miss the object
    // under the crosshair, presenting as "the object is frozen". Mirrors
    // the dev tool's secondary action (R-key) handler in App.tsx, which
    // shoots a center ray via `new Vector2(0, 0)` in first-person. Both
    // the asset raycast NDC below AND the virtualCursor seed at the
    // bottom of this handler consume cx/cy and inherit the lock-aware
    // fix automatically.
    const isPointerLocked = document.pointerLockElement === this.domElement;
    const cx = isPointerLocked ? rect.width / 2 : e.clientX - rect.left;
    const cy = isPointerLocked ? rect.height / 2 : e.clientY - rect.top;

    // Asset raycast always uses the literal RMB-down pointer position so
    // hit-resolution matches the user's click.
    const ndcX = (cx / rect.width) * 2 - 1;
    const ndcY = -(cy / rect.height) * 2 + 1;
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] onPointerDown  rect=(${rect.width.toFixed(0)}x${rect.height.toFixed(0)})  isPointerLocked=${isPointerLocked}  cx=${cx.toFixed(1)} cy=${cy.toFixed(1)}  ndcX=${ndcX.toFixed(3)} ndcY=${ndcY.toFixed(3)}  rawClientXY=(${e.clientX}, ${e.clientY})  pointerType=${e.pointerType}`
      );
    }

    // Local throwaway raycaster — keeps the grab path off the shared
    // SceneEngine raycaster used by click selection / center-ray hover.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const targets: THREE.Object3D[] = [];
    const objMap = new Map<THREE.Object3D, LoadedAsset>();
    this.assetMap.forEach((a) => {
      targets.push(a.object3d);
      objMap.set(a.object3d, a);
    });
    const intersects = ray.intersectObjects(targets, true);
    if (intersects.length === 0) {
      if (ManipulationManager.RMB_DEBUG_ENABLED) {
        console.log(
          `[RMB] onPointerDown EARLY-RETURN  reason=no_raycast_hits  targets=${targets.length}  ndcX=${ndcX.toFixed(3)} ndcY=${ndcY.toFixed(3)}  (raycast saw no asset — empty world at cursor)`,
        );
      }
      return; // RMB on empty world → no grab, no menu (spec).
    }
    let cur: THREE.Object3D | null = intersects[0].object;
    while (cur && !objMap.has(cur)) cur = cur.parent;
    if (!cur) {
      if (ManipulationManager.RMB_DEBUG_ENABLED) {
        console.log(
          `[RMB] onPointerDown EARLY-RETURN  reason=walk_up_no_asset  hit.object=${intersects[0].object?.name ?? '(unnamed)'}  walkedUpTo=(null)  (raycast DID hit something at the cursor but no asset matched in the objMap)`,
        );
      }
      return;
    }
    const hitAsset = objMap.get(cur);
    if (!hitAsset) {
      if (ManipulationManager.RMB_DEBUG_ENABLED) {
        console.log(
          `[RMB] onPointerDown EARLY-RETURN  reason=objMap_lookup_undefined  walkedUpObject.name=${cur.name}  objMap.keys.has=${objMap.has(cur)}`,
        );
      }
      return;
    }
    if (ManipulationManager.RMB_DEBUG_ENABLED) {
      console.log(
        `[RMB] onPointerDown HIT  hitAsset.id=${hitAsset.id}  hitAsset.type=${hitAsset.type}  hitPoint=(${intersects[0].point.x.toFixed(3)}, ${intersects[0].point.y.toFixed(3)}, ${intersects[0].point.z.toFixed(3)})  → calling beginGrab`,
      );
    }

    this._grabNdcX = ndcX;
    this._grabNdcY = ndcY;
    // Preserve the world-frame offset between the asset's origin and
    // the raycast hit point so the carry keeps the cursor glued to the
    // visible surface point (not the model's origin). Without this,
    // models with origin ≠ visual center (e.g. towers with origin at
    // the base) visually jump up/down on grab because the origin
    // recenters under the cursor while the user was targeting the
    // visual center. Captured in WORLD frame because the model doesn't
    // rotate/scale-relative-to-world during the carry — only translate.
    this._grabOffsetWorld.copy(intersects[0].point).sub(hitAsset.object3d.position);
    // No need to separately stamp a rotation pivot here:
    // `applyRotationAroundPivot` derives the pivot per-frame as
    // `asset.position + _grabOffsetWorld` — the cursor's current
    // world-frame hit point on the asset (the same world point the
    // carry already locks under the cursor via `_grabOffsetWorld`).
    this.beginGrab(hitAsset, intersects[0].point.clone());
  };

  private onMouseDownWindow = (e: MouseEvent): void => {
    // BUGFIX: bail out when the radial context menu is open. This
    // listener is attached with { capture: true } at window scope and
    // runs BEFORE the menu's own handler; without this early-return,
    // a left-click on the menu's "Destroy" slice (held tab) while an
    // object is grabbed was hijacked by the snap-rotate branch below
    // — `e.stopImmediatePropagation()` swallowed the event, the held
    // object silently rotated 90\u00b0, and `RadialContextMenu`'s
    // `onClickAction` for `onDestroy?.()` never fired. Mirrors the
    // `(window as any).__isRadialMenuOpen` flag maintained by
    // `RadialContextMenu`'s mount/unmount useEffect.
    if ((window as any).__isRadialMenuOpen) return;
    if (e.button === 0 && this.isGrabDragging && this.grabbedAsset) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const euler = this.grabbedAsset.object3d.rotation;
      const step = Math.PI / 2;
      euler.x = Math.round(euler.x / step) * step;
      euler.y = Math.round(euler.y / step) * step;
      euler.z = Math.round(euler.z / step) * step;
      this.broadcastCurrentTransform(this.grabbedAsset);
    }
  };

  private onPointerUpWindow = (e: PointerEvent): void => {
    if (e.button !== 2) return;
    if (!this.isGrabDragging) return;
    this.endGrab();
  };

  private onWindowBlur = (): void => {
    // Alt-tab / window-switch / dev-tools-open — release any grab in flight.
    if (this.isGrabDragging) this.endGrab();
  };

  private onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      for (const cb of this.onScaleSelfCallbacks) cb(factor);
      return;
    }

    const targetAsset = (this.isGrabDragging && this.grabbedAsset) ? this.grabbedAsset : this.selectedAsset;
    if (!targetAsset) return;

    if (e.shiftKey) {
      // Shift + Wheel: Scale Held Item
      e.preventDefault();
      const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
      targetAsset.object3d.scale.multiplyScalar(scaleFactor);
      this.broadcastCurrentTransform(targetAsset);
    } else {
      // Plain Wheel: Move Held Item Away / Towards.
      // NEW: HELD-ONLY. Previously plain wheel also pushed/pulled a
      // merely-selected asset when the dev tool + click-select was
      // active, which felt unintuitive (the user picked an object with
      // the dev tool and got an unsolicited push/pull on scroll). Now
      // plain wheel push/pull fires ONLY when an asset is currently
      // grab-dragged (VR laser grip OR desktop RMB-grab). Shift+Wheel
      // scale above still applies to both grabbed AND selected since
      // scale-on-selected has its own dev-tool ergonomics.
      e.preventDefault();
      if (!this.isGrabDragging || !this.grabbedAsset) return;
      const distDelta = e.deltaY < 0 ? 0.5 : -0.5;
      this._grabDepth = Math.max(0.5, Math.min(50.0, this._grabDepth + distDelta));
      this.updateGrabbedAssetPosition();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
    if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E') {
      this.isEKeyPressed = true;
    }
    if (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y') {
      const targetAsset = (this.isGrabDragging && this.grabbedAsset) ? this.grabbedAsset : this.selectedAsset;
      if (targetAsset) {
        const euler = targetAsset.object3d.rotation;
        const step = Math.PI / 2;
        euler.x = Math.round(euler.x / step) * step;
        euler.y = Math.round(euler.y / step) * step;
        euler.z = Math.round(euler.z / step) * step;
        this.broadcastCurrentTransform(targetAsset);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E') {
      this.isEKeyPressed = false;
    }
  };

  public update(_delta?: number): void {
    if (this._isVRGrabbing) {
      const delta = _delta ?? 0;
      const updateHandGrab = (side: 'left' | 'right') => {
        const grab = this._vrHandGrabs[side];
        if (!grab) return;
        if (this._vrInput && delta > 0) {
          const stickY = this._vrInput[side].stick.y;
          if (Math.abs(stickY) > 1e-3) {
            const trs = grab.targetRaySpace;
            if (trs) {
              trs.updateWorldMatrix(true, false);
              const laserDir = new THREE.Vector3(0, 0, -1)
                .applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(trs.matrixWorld))
                .normalize();
              const moveAmt = -stickY * ManipulationManager.VR_HOLD_DOLLY_SPEED * delta;
              const assetWorldPos = new THREE.Vector3();
              grab.asset.object3d.getWorldPosition(assetWorldPos);
              const ctrlWorldPos = new THREE.Vector3();
              trs.getWorldPosition(ctrlWorldPos);
              const currentDist = assetWorldPos.distanceTo(ctrlWorldPos);
              const newDist = Math.max(
                ManipulationManager.VR_HOLD_MIN_DIST,
                Math.min(ManipulationManager.VR_HOLD_MAX_DIST, currentDist + moveAmt)
              );
              const distDelta = newDist - currentDist;
              if (Math.abs(distDelta) > 1e-6) {
                assetWorldPos.addScaledVector(laserDir, distDelta);
                const gripParent = grab.asset.object3d.parent;
                if (gripParent) {
                  gripParent.worldToLocal(assetWorldPos);
                  grab.asset.object3d.position.copy(assetWorldPos);
                }
              }
            } else {
              grab.holdLocalOffset.z += stickY * ManipulationManager.VR_HOLD_DOLLY_SPEED * delta;
              grab.holdLocalOffset.z = Math.max(
                -ManipulationManager.VR_HOLD_MAX_DIST,
                Math.min(-ManipulationManager.VR_HOLD_MIN_DIST, grab.holdLocalOffset.z)
              );
              grab.asset.object3d.position.copy(grab.holdLocalOffset);
            }
            const stickX = this._vrInput[side].stick.x;
            if (Math.abs(stickX) > 1e-3) {
              const rotAngle = -stickX * ManipulationManager.VR_HOLD_ROTATE_SPEED * delta;
              grab.asset.object3d.rotateOnWorldAxis(this._vrUpVec, rotAngle);
              grab.asset.object3d.getWorldQuaternion(grab.lockedWorldQuaternion);
            }
          }
        }
        if (grab.lockControllerRotation) {
          const parent = grab.asset.object3d.parent;
          if (parent) {
            parent.getWorldQuaternion(this._broadcastQuat);
            this._broadcastQuat.invert().multiply(grab.lockedWorldQuaternion);
            grab.asset.object3d.quaternion.copy(this._broadcastQuat);
          }
        }
        this.broadcastCurrentTransform(grab.asset);
      };
      updateHandGrab('left');
      updateHandGrab('right');
      return;
    }
    // Two-handed grab: scale the held asset by the current distance
    // between the two controllers' grip spaces. Pull-apart grows
    // (factor > 1), push-together shrinks (factor < 1). The captured
    // initial distance is the 1.0× reference, so the user always
    // starts the scale at whatever the asset's current size is —
    // not at some hardcoded baseline. Clamp to the safety range
    // so a flyaway twitch of the wrists doesn't balloon the asset
    // to room-filling or shrink it to a single pixel.
    if (this._twoHandedAsset) {
      const leftGrip = this._vrInput?.getGrip('left');
      const rightGrip = this._vrInput?.getGrip('right');
      if (leftGrip && rightGrip) {
        leftGrip.getWorldPosition(this._tmpForward);
        rightGrip.getWorldPosition(this._tmpRight);
        const dist = this._tmpForward.distanceTo(this._tmpRight);
        let factor = dist / this._twoHandedInitialDistance;
        factor = Math.max(
          ManipulationManager.TWO_HANDED_MIN_SCALE,
          Math.min(ManipulationManager.TWO_HANDED_MAX_SCALE, factor)
        );
        this._twoHandedAsset.object3d.scale.set(
          this._twoHandedInitialScale.x * factor,
          this._twoHandedInitialScale.y * factor,
          this._twoHandedInitialScale.z * factor
        );
        const curMidpoint = this._tmpForward.clone().add(this._tmpRight).multiplyScalar(0.5);
        const translationDelta = curMidpoint.sub(this._twoHandedInitialMidpoint);
        this._twoHandedAsset.object3d.position.copy(this._twoHandedInitialPosition).add(translationDelta);
        this.broadcastCurrentTransform(this._twoHandedAsset);
      }
      return;
    }
    if (this.isGrabDragging && this.grabbedAsset && !this.isEKeyPressed) {
      this.updateGrabbedAssetPosition();
    }
  }

  private updateGrabbedAssetPosition(): void {
    if (!this.isGrabDragging || !this.grabbedAsset) return;
    const cam = this.camera as THREE.PerspectiveCamera;
    const rect = this.domElement.getBoundingClientRect();
    const isPointerLocked = document.pointerLockElement === this.domElement;
    let offsetNdcX = 0;
    let offsetNdcY = 0;
    if (!isPointerLocked) {
      offsetNdcX = this._grabNdcX;
      offsetNdcY = this._grabNdcY;
    }

    this._tmpForward.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    this._tmpRight.crossVectors(this._tmpForward, cam.up);
    if (this._tmpRight.lengthSq() < 1e-6) {
      this._tmpRight.set(1, 0, 0);
      this._tmpRight.addScaledVector(
        this._tmpForward,
        -this._tmpForward.dot(this._tmpRight)
      );
      if (this._tmpRight.lengthSq() < 1e-6) {
        this._tmpRight.set(0, 0, 1);
        this._tmpRight.addScaledVector(
          this._tmpForward,
          -this._tmpForward.dot(this._tmpRight)
        );
      }
    }
    this._tmpRight.normalize();
    this._tmpUp.crossVectors(this._tmpRight, this._tmpForward).normalize();

    const halfFov = ((cam.fov ?? 65) * 0.5 * Math.PI) / 180;
    const halfFrustumH = this._grabDepth * Math.tan(halfFov);
    const halfFrustumW = halfFrustumH * (cam.aspect ?? rect.width / rect.height);
    const CARRY_SENSITIVITY = 1.0;

    this._tmpDesired
      .copy(cam.position)
      .addScaledVector(this._tmpForward, this._grabDepth)
      .addScaledVector(
        this._tmpRight,
        offsetNdcX * halfFrustumW * CARRY_SENSITIVITY
      )
      .addScaledVector(
        this._tmpUp,
        offsetNdcY * halfFrustumH * CARRY_SENSITIVITY
      );
    // Subtract the world-frame grab offset so the asset's ORIGIN sits
    // at (cursorVirtualWorld - offset), which keeps the visible hit
    // point — not the origin — under the cursor. Identity vec3 for
    // origin-centered models (offset = (0,0,0)) → identical to
    // previous behavior, so primitives like the basic cube/sphere are
    // unaffected.
    this.grabbedAsset.object3d.position.copy(this._tmpDesired).sub(this._grabOffsetWorld);
    this.broadcastCurrentTransform(this.grabbedAsset);
  }

  // ===========================================================================
  // E+drag rotation: rotate AROUND the cursor-anchored pivot so the
  // surface point under the cursor stays glued through the rotation
  // (the rotational mirror of the translation-anchor fix). Without
  // this, holding E and dragging rotates around the asset's local
  // origin (0,0,0) — for assets whose origin isn't the visual center
  // (towers, lopsided meshes) the grab point swings through space
  // during the rotation and the user sees the object "moving" while
  // they were only trying to spin it. Anchoring the rotation at the
  // cursor's world hit point keeps that surface point pixel-stable.
  // ===========================================================================

  /**
   * Apply an incremental yaw-around-camera-up + pitch-around-camera-
   * right rotation to `assetObj3d`, anchored at `pivot` (or the
   * stored `_rotationPivotWorld` for the RMB-grab case) in world
   * frame so the surface point under the cursor stays glued through
   * the rotation.
   *
   * Math (per frame, no smoothing / no integration step):
   *   qYaw  = quat(axisAngle(cameraUp_in_world,  dx·speed))
   *   qPitch= quat(axisAngle(cameraRight_in_world, dy·speed))
   *   Δquat = qYaw · qPitch      (yaw outermost)
   *   newQuat = Δquat · oldQuat   (premultiply)
   *   newPos  = pivot + Δquat · (oldPos − pivot)
   *
   * Shift suppresses pitch (preserves the legacy "yaw-only" intent
   * that horizontal-arcs-only users rely on so they don't tilt up
   * or down while sweeping). Both axes are computed in world frame
   * via the current `camera.quaternion`, so the rotation is
   * independent of the asset's accumulated orientation — meaning
   * the user gets predictable "turn head = spin model left/right"
   * behavior regardless of how the model was previously spun.
   */
  private applyRotationAroundPivot(
    assetObj3d: THREE.Object3D,
    e: MouseEvent | PointerEvent,
    pivot?: THREE.Vector3
  ): void {
    // Resolve pivot per-frame. Caller-supplied wins (cursor-raycast
    // pivot in the no-RMB-grab case). For the RMB-grab case the pivot
    // IS the cursor's current world-frame hit point on the asset,
    // which the carry invariant guarantees: while E is held the asset
    // position is frozen (update() skips updateGrabbedAssetPosition
    // while isEKeyPressed === true), so this stays = the original
    // grab hit point through the drag — no drift. After the user
    // releases E mid-carry (RMB still held), the carry resumes and
    // `asset.position + _grabOffsetWorld` tracks the cursor's new
    // world point; a subsequent RE-press of E then anchors the
    // rotation at the up-to-date cursor position instead of the
    // stale grab-time hit point. Both invariants emerge from one
    // expression with no extra state.
    const pivotTarget = pivot ?? this._tmpRotPivot.copy(assetObj3d.position).add(this._grabOffsetWorld);
    const rotSpeed = 0.01;
    const yawAmount = e.movementX * rotSpeed;
    const pitchAmount = e.shiftKey ? 0 : e.movementY * rotSpeed;
    if (yawAmount === 0 && pitchAmount === 0) return;

    // Build the combined Δ-quaternion. Order matches the user's
    // intent: horizontal mouse → spin around camera-up, vertical
    // mouse → tilt around camera-right. `premultiply` applies each
    // axis rotation in world frame (camera-up/right are world-frame
    // vectors), so the composition yields a single world-frame Δ that
    // we then apply once to position-around-pivot AND to quaternion.
    this._tmpRotQuat.identity();
    if (yawAmount !== 0) {
      this._tmpRotAxis.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this._normalizeAxis(this._tmpRotAxis);
      this._tmpRotAxisQ.setFromAxisAngle(this._tmpRotAxis, yawAmount);
      this._tmpRotQuat.premultiply(this._tmpRotAxisQ);
    }
    if (pitchAmount !== 0) {
      // Camera-right axis (world frame) = cameraForward × worldUp.
      // Using `this.camera.up` (which defaults to (0,1,0) worldUp)
      // keeps the pitch axis horizontal even when the camera is
      // rolled — the user's intended "tilt up" stays aligned with
      // the world horizon rather than the camera's tilted up vector.
      this._tmpRotAxis.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this._tmpRotAxis.crossVectors(this._tmpRotAxis, this.camera.up);
      if (this._tmpRotAxis.lengthSq() < 1e-6) {
        // Camera pitched beyond ±90° → forward parallel to up:
        // degenerate fallback to world-X so the user still gets
        // *some* response rather than a visible stall.
        this._tmpRotAxis.set(1, 0, 0);
      } else {
        this._normalizeAxis(this._tmpRotAxis);
      }
      this._tmpRotAxisQ.setFromAxisAngle(this._tmpRotAxis, pitchAmount);
      this._tmpRotQuat.premultiply(this._tmpRotAxisQ);
    }

    // Apply rotation-around-pivot transform:
    //   relative = oldPos − pivot
    //   newRel   = Δquat · relative
    //   newPos   = pivot + newRel
    this._tmpRotVec.copy(assetObj3d.position).sub(pivotTarget).applyQuaternion(this._tmpRotQuat).add(pivotTarget);
    assetObj3d.position.copy(this._tmpRotVec);
    assetObj3d.quaternion.premultiply(this._tmpRotQuat);
  }

  /**
   * True if the asset is one of the SpatialPopUpWrapper panels
   * (Import dialog or Scene Inspector). These are 3D world-space
   * meshes the user can position via drag and rotate via the gizmo,
   * but the E+drag rotation shortcut (which is meant for grabbed
   * objects) must NOT rotate them — doing so changes the angle the
   * panel faces the camera in an uncontrolled way and makes the UI
   * hard to interact with. Spatial panels are identified by a
   * `userData.isSpatialWindow` flag set in SpatialPopUpWrapper's
   * mesh-creation useEffect. Null-safe (returns false on null).
   */
  private isSpatialWindow(asset: LoadedAsset | null): boolean {
    if (!asset) return false;
    return !!(asset.object3d.userData as Record<string, unknown>)?.isSpatialWindow;
  }

  /**
   * Project the cursor (pointer-lock-aware) into world space, raycast
   * against `target`, write the hit point into `outPivot`, and return
   * `true`. Returns `false` if the cursor misses the model so the
   * caller can fall back to legacy origin-centered rotation.
   *
   * Used by the no-RMB-grab E+LMB+selected rotation path to derive a
   * per-frame pivot (rather than relying on a stored grab-time point,
   * which only exists in the RMB-grab case).
   */
  private cursorRaycastPivot(
    target: THREE.Object3D,
    e: MouseEvent | PointerEvent,
    outPivot: THREE.Vector3
  ): boolean {
    const rect = this.domElement.getBoundingClientRect();
    const isPointerLocked = document.pointerLockElement === this.domElement;
    const cx = isPointerLocked ? rect.width / 2 : e.clientX - rect.left;
    const cy = isPointerLocked ? rect.height / 2 : e.clientY - rect.top;
    const ndcX = (cx / rect.width) * 2 - 1;
    const ndcY = -(cy / rect.height) * 2 + 1;
    this._tmpRotNdc.set(ndcX, ndcY);
    this._tmpRotRay.setFromCamera(this._tmpRotNdc, this.camera);
    // `intersectObject(target, true)` is recursive so grouped assets
    // (e.g. imported .glb with multiple child meshes) hit correctly.
    const hits = this._tmpRotRay.intersectObject(target, true);
    if (hits.length === 0 || !hits[0].point) return false;
    outPivot.copy(hits[0].point);
    return true;
  }

  /** In-place normalize on `_tmpRotAxis`, no-op if length² < ε. */
  private _normalizeAxis(v: THREE.Vector3): void {
    const lenSq = v.lengthSq();
    if (lenSq < 1e-6) return; // Caller's fallback wins on degenerate axis.
    v.multiplyScalar(1 / Math.sqrt(lenSq));
  }

  private onMouseMove = (e: MouseEvent | PointerEvent): void => {
    const rect = this.domElement.getBoundingClientRect();

    if (this.isGrabDragging && this.grabbedAsset) {
      e.preventDefault();
      const isPointerLocked = document.pointerLockElement === this.domElement;
      if (!isPointerLocked) {
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        this._grabNdcX = (cx / rect.width) * 2 - 1;
        this._grabNdcY = -(cy / rect.height) * 2 + 1;
      }

      if (this.isEKeyPressed && !this.isSpatialWindow(this.grabbedAsset)) {
        // Spatial windows (SpatialPopUpWrapper panels) are rotated
        // via the gizmo, NOT via E+drag. The E-key shortcut is
        // meant for grabbed objects; if we let it rotate the panel
        // mesh, the user gets a surprising uncontrolled re-orientation
        // of the menu while just trying to interact with it. The
        // grab itself still tracks the cursor (the
        // `updateGrabbedAssetPosition` else-branch below), so the
        // panel can still be carried around while E is held — we
        // just skip the rotation step.
        // RMB-grab + E + drag: rotate around the world-frame grab
        // point captured in onPointerDown so the surface under the
        // cursor stays locked through the rotation. Old code mutated
        // `object.rotation.y/x` directly which pivoted the rotation on
        // the asset's local origin — visibly the cursor "dragged" the
        // surface away from itself, which read as "the object is
        // moving while I'm just trying to rotate it".
        this.applyRotationAroundPivot(this.grabbedAsset.object3d, e);
        this.broadcastCurrentTransform(this.grabbedAsset);
      } else {
        this.updateGrabbedAssetPosition();
      }
      return;
    }

    // E + drag (no RMB-grab) — rotate the SELECTED asset. Pivots on
    // the cursor's current raycast-hit on the asset each frame (so the
    // pivot follows the cursor along the model's surface, mimicking
    // the "wheel around the point I'm pointing at" feel). When the
    // cursor falls off the model we fall back to the legacy
    // origin-centered increment so behavior is unchanged in that case.
    // Without a pivot this branch had the same "object is moving" bug
    // as the grabbed case — origin-pivot rotation made the cursor's
    // surface point swing through space.
    if (this.isEKeyPressed && (e.buttons & 1) && this.selectedAsset) {
      // Spatial windows (SpatialPopUpWrapper panels) are rotated
      // via the gizmo, NOT via E+drag. Same rationale as the
      // RMB-grab branch above: the E shortcut is for grabbed
      // objects, and rotating the panel via E changes the angle
      // the panel faces the camera in an uncontrolled way. We
      // simply skip the rotation for spatial windows; nothing
      // else replaces it (the panel has no carry-mode when
      // it's just selected, not grabbed).
      if (!this.isSpatialWindow(this.selectedAsset)) {
        if (this.cursorRaycastPivot(this.selectedAsset.object3d, e, this._tmpRotPivot)) {
          this.applyRotationAroundPivot(this.selectedAsset.object3d, e, this._tmpRotPivot);
        } else {
          const rotSpeed = 0.01;
          if (e.shiftKey) {
            this.selectedAsset.object3d.rotation.y += e.movementX * rotSpeed;
          } else {
            this.selectedAsset.object3d.rotation.y += e.movementX * rotSpeed;
            this.selectedAsset.object3d.rotation.x += e.movementY * rotSpeed;
          }
        }
        this.broadcastCurrentTransform();
      }
    }
  };

  public registerOnDragChange(cb: (isDragging: boolean) => void): () => void {
    this.onDragCallbacks.add(cb);
    return () => this.onDragCallbacks.delete(cb);
  }

  public registerOnGrabBegin(cb: (asset: LoadedAsset, side?: 'left' | 'right') => void): () => void {
    this.onGrabBeginCallbacks.add(cb);
    return () => this.onGrabBeginCallbacks.delete(cb);
  }

  public registerOnGrabEnd(cb: (side?: 'left' | 'right') => void): () => void {
    this.onGrabEndCallbacks.add(cb);
    return () => this.onGrabEndCallbacks.delete(cb);
  }

  public registerOnScaleSelf(cb: (factor: number) => void): () => void {
    this.onScaleSelfCallbacks.add(cb);
    return () => this.onScaleSelfCallbacks.delete(cb);
  }

  public registerOnTransformChange(cb: (update: TransformUpdate) => void): () => void {
    this.onTransformChangeCallbacks.add(cb);
    return () => this.onTransformChangeCallbacks.delete(cb);
  }

  public registerOnSelectionChange(cb: (asset: LoadedAsset | null) => void): () => void {
    this.onSelectionChangeCallbacks.add(cb);
    return () => this.onSelectionChangeCallbacks.delete(cb);
  }

  public setMode(mode: TransformMode): void {
    this.transformControls.setMode(mode);
  }

  public setSpace(space: 'local' | 'world'): void {
    this.transformControls.space = space;
  }

  public getSpace(): 'local' | 'world' {
    return this.transformControls.space as 'local' | 'world';
  }

  public selectAsset(asset: LoadedAsset | null): void {
    if (this.selectedAsset === asset) return;

    this.selectedAsset = asset;
    if (asset) {
      this.transformControls.attach(asset.object3d);
    } else {
      this.transformControls.detach();
    }

    for (const cb of this.onSelectionChangeCallbacks) cb(asset);
  }

  public toggleCollision(asset?: LoadedAsset): boolean {
    const target = asset || this.selectedAsset;
    if (!target) return false;

    target.isCollidable = !target.isCollidable;

    target.object3d.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material && !Array.isArray(mesh.material)) {
          mesh.material.transparent = !target.isCollidable;
          mesh.material.opacity = target.isCollidable ? 1.0 : 0.6;
        }
      }
    });

    this.broadcastCurrentTransform(target);
    return target.isCollidable;
  }

  public broadcastCurrentTransform(target?: LoadedAsset): void {
    const asset = target || this.selectedAsset;
    if (!asset) return;

    const obj = asset.object3d;
    // CRITICAL: read WORLD transform, not local. A VR-grabbed asset is
    // parented to the controller's gripSpace (see vrGrabWithController);
    // gripSpace.attach(asset) preserves the world transform but the
    // asset's LOCAL position / rotation / scale stay at the grab-time
    // values while its worldMatrix follows the user's hand pose via
    // parent propagation. Reading local means the broadcast always
    // carried the grab-time rotation, so peers saw a frozen orientation
    // while the VR user rotated the object through their hand. Reading
    // worldMatrix is the only way to broadcast what the user actually
    // sees. For a direct-child-of-scene asset (desktop grab, gizmo
    // drag, two-handed scale) local == world, so the change is a
    // no-op for those paths and the existing behavior is preserved.
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(this._broadcastPos, this._broadcastQuat, this._broadcastScale);
    // Reuse the asset's own rotation.order so the Euler representation
    // matches what the receiver applies (applyRemoteTransform uses
    // obj.rotation.set which respects obj.rotation.order on the
    // receiver side). Decomposed-quat -> Euler through the asset's
    // own order keeps the round-trip lossless for the common case of
    // a non-degenerate orientation.
    this._broadcastEuler.setFromQuaternion(this._broadcastQuat, obj.rotation.order);
    // Read persistent-state from userData (matches the SceneInspector
    // checkbox writer at SceneInspectorWindow.tsx). Undefined falls
    // back to "treat as persistent true" on the receiver — matches
    // every primitive's default in this codebase.
    const isPersistent = (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined;
    const update: TransformUpdate = {
      assetId: asset.id,
      position: [this._broadcastPos.x, this._broadcastPos.y, this._broadcastPos.z],
      rotation: [this._broadcastEuler.x, this._broadcastEuler.y, this._broadcastEuler.z],
      scale: [this._broadcastScale.x, this._broadcastScale.y, this._broadcastScale.z],
      isCollidable: asset.isCollidable,
      isPersistent
    };

    for (const cb of this.onTransformChangeCallbacks) {
      cb(update);
    }
  }

  public applyRemoteTransform(update: TransformUpdate, assetMap: Map<string, LoadedAsset>): void {
    const asset = assetMap.get(update.assetId);
    if (!asset) return;

    if (this.isDragging && this.selectedAsset?.id === update.assetId) {
      return;
    }

    asset.object3d.position.set(...update.position);
    asset.object3d.rotation.set(...update.rotation);
    asset.object3d.scale.set(...update.scale);

    // Mirror userData.isPersistent back to the receiver's mesh so the
    // inspector tree's orange-dot indicator AND the checkbox state
    // both reflect the host's flag after a single transform tick.
    // Guarded with the existence check — undefined means the sender
    // hasn't opted into persistence tracking yet (older clients).
    if (update.isPersistent !== undefined) {
      const ud = asset.object3d.userData as Record<string, unknown>;
      if (ud.isPersistent !== update.isPersistent) {
        ud.isPersistent = update.isPersistent;
      }
    }

    if (asset.isCollidable !== update.isCollidable) {
      asset.isCollidable = update.isCollidable;
      asset.object3d.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.material && !Array.isArray(mesh.material)) {
            mesh.material.transparent = !asset.isCollidable;
            mesh.material.opacity = asset.isCollidable ? 1.0 : 0.6;
          }
        }
      });
    }
  }

  public handleRaycastSelection(raycaster: THREE.Raycaster, assetMap: Map<string, LoadedAsset>): LoadedAsset | null {
    const objectsToTest: THREE.Object3D[] = [];
    const objToAssetMap = new Map<THREE.Object3D, LoadedAsset>();

    assetMap.forEach((asset) => {
      objectsToTest.push(asset.object3d);
      objToAssetMap.set(asset.object3d, asset);
    });

    const intersects = raycaster.intersectObjects(objectsToTest, true);
    if (intersects.length > 0) {
      let current: THREE.Object3D | null = intersects[0].object;
      while (current && !objToAssetMap.has(current)) {
        current = current.parent;
      }
      if (current && objToAssetMap.has(current)) {
        const foundAsset = objToAssetMap.get(current)!;
        this.selectAsset(foundAsset);
        return foundAsset;
      }
    }

    this.selectAsset(null);
    return null;
  }

  public dispose(): void {
    // End any in-flight grab first so onDragChange(true)→(false) fires off
    // for App.tsx undo listeners if they care about cleanup ordering.
    // endGrab() clears `isGrabDragging` and `grabbedAsset` atomically —
    // no separate force-clearing fallback needed (the earlier backup
    // block was unreachable dead code).
    if (this.isGrabDragging) this.endGrab();
    this.domElement.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.removeEventListener('mousedown', this.onMouseDownWindow, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUpWindow);
    window.removeEventListener('blur', this.onWindowBlur);
    this.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onMouseMove);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.transformControls.detach();
    this.transformControls.dispose();
  }
}
