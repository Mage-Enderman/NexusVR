/**
 * SpatialPanelManager
 *
 * Manages 3D world-space HTML panels using:
 *  - CSS3DRenderer on desktop  — real HTML DOM elements placed in Three.js
 *    scene graph via CSS3DObject. Fully interactive, zero rasterisation cost,
 *    correct perspective foreshortening. Cannot be occluded by WebGL geometry
 *    (CSS3D always renders on top) — accepted limitation.
 *  - HTMLMesh + InteractiveGroup in VR — rasterises the same DOM subtree to a
 *    CanvasTexture and forwards XR controller raycasts as synthetic pointer
 *    events so buttons, inputs, and scrolling all work at feature parity with
 *    desktop mouse interaction.
 *
 * Usage (from SceneEngine / App.tsx):
 *
 *   const mgr = new SpatialPanelManager(rendererDomElement.parentElement!);
 *   const anchor = mgr.createPanel('import', domDiv, scene, camera);
 *
 *   // each frame after renderer.render():
 *   mgr.render(scene, camera);
 *
 *   // entering / leaving WebXR:
 *   mgr.enterVR(controller1, controller2);
 *   mgr.exitVR();
 *
 *   // on React component close:
 *   mgr.destroyPanel('import');
 *
 *   // cleanup:
 *   mgr.dispose();
 */

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { HTMLMesh } from 'three/examples/jsm/interactive/HTMLMesh.js';
import { InteractiveGroup } from 'three/examples/jsm/interactive/InteractiveGroup.js';



// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpatialPanelEntry {
  /** Detached div that React renders into via createPortal */
  domContainer: HTMLDivElement;
  /** CSS3DObject wrapping domContainer — lives in the scene */
  css3dObject: CSS3DObject;
  /** Three.js Group containing the CSS3DObject and the holographic frame */
  group: THREE.Group;
  /** Holographic wireframe box drawn by WebGL (always visible) */
  frameGroup: THREE.Group;
  /** HTMLMesh used during an active XR session */
  htmlMesh: HTMLMesh | null;
  /** InteractiveGroup wrapping the HTMLMesh for controller raycasting */
  interactiveGroup: InteractiveGroup | null;
  /** Whether this panel is currently visible */
  visible: boolean;
  /** Logical width of the DOM content in pixels (used to size CSS3DObject) */
  cssWidth: number;
  /** Logical height of the DOM content in pixels */
  cssHeight: number;
  /** Scale applied to convert CSS pixels → Three.js units (1 unit ≈ 1 metre) */
  cssScale: number;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SpatialPanelManager {
  // Identity PerspectiveCamera used as a defensive fallback when
  // _buildHTMLMesh runs without enterVR having populated vrCamera.
  // Reused across invocations to avoid per-call allocation.
  // `static readonly` keeps the same instance forever, so the
  // matrix-identity camera is never GC’d mid-session.
  public static readonly DEFAULT_VR_CAMERA: THREE.Camera = new THREE.PerspectiveCamera();

  private css3dRenderer: CSS3DRenderer;
  private panels = new Map<string, SpatialPanelEntry>();
  private isVRMode = false;
  private vrRenderer: THREE.WebGLRenderer | null = null;
  private vrController1: THREE.XRTargetRaySpace | null = null;
  private vrController2: THREE.XRTargetRaySpace | null = null;
  // Cached camera for VR HTMLMesh panels. Populated by enterVR
  // so InteractiveGroup.listenToPointerEvents can take it as an
  // argument in this version of three.js (whose signature required
  // a Camera, not the optional `camera?: Camera` we initially
  // assumed). Cleaned up in exitVR.
  private vrCamera: THREE.Camera | null = null;
  // Cached scene reference populated by enterVR (via controller1.parent)
  // so _buildHTMLMesh can attach the InteractiveGroup to the scene root
  // without threading the parameter through. Kept null in non-VR mode.
  private sceneRef: THREE.Scene | null = null;
  private sharedInteractiveGroup: InteractiveGroup | null = null;
  // Per-frame scratch Vector3 reused across panels in render()'s
  // htmlMesh scale sync. Allocated once at construction to avoid
  // per-frame per-panel GC churn — earlier this was a local
  // allocation in render()'s loop body.
  private _htmlMeshScaleBuf: THREE.Vector3 = new THREE.Vector3();

  /** Element currently under the locked crosshair, or null */
  private hoveredElement: Element | null = null;
  /** Callback fired when hover-over-panel state changes */
  private onHoverChangeCallback: ((isOver: boolean) => void) | null = null;

  constructor(container: HTMLElement) {
    this.css3dRenderer = new CSS3DRenderer();
    this.css3dRenderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight
    );
    const cssEl = this.css3dRenderer.domElement;
    cssEl.style.position = 'absolute';
    cssEl.style.top = '0';
    cssEl.style.left = '0';
    cssEl.style.width = '100%';
    cssEl.style.height = '100%';
    cssEl.style.zIndex = '10'; // Ensure CSS3D panels sit above WebGL canvas
    cssEl.style.pointerEvents = 'none'; // let pointer events fall through to WebGL canvas by default
    container.style.position = 'relative'; // ensure stacking context
    container.appendChild(cssEl);

    // Resize handling
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.css3dRenderer.setSize(w, h);
    });
    ro.observe(container);
  }

  // -------------------------------------------------------------------------
  // Panel lifecycle
  // -------------------------------------------------------------------------

  /**
   * Register a panel. The caller is responsible for mounting React content
   * into `domContainer` via ReactDOM.createPortal.
   *
   * @param id             Unique string key (e.g. 'import', 'inspector')
   * @param domContainer   Detached <div> that React renders the panel UI into
   * @param scene          Three.js scene to attach the group to
   * @param camera         Three.js camera (used for initial placement when
   *                       `parent` is omitted)
   * @param cssWidth       Logical pixel width of the panel content (default 520)
   * @param cssHeight      Logical pixel height of the panel content (default 640)
   * @param parent         Optional THREE.Object3D to parent the panel group to.
   *                       When provided, `placeInFrontOfCamera` is skipped and
   *                       `anchorOffset` (or a default `(0, -h/2 - 0.05, +0.06)`
   *                       local-space anchor) is applied. Use this for in-world
   *                       panels that need to ride along with another object's
   *                       transform (e.g. video-controls HUD docked under a
   *                       video asset so it follows when the video is dragged).
   * @param anchorOffset   Optional local-space offset relative to `parent`.
   *                       Ignored when `parent` is not provided.
   * @returns The THREE.Group anchor — callers can read/write .position / .rotation / .scale
   */
  public createPanel(
    id: string,
    domContainer: HTMLDivElement,
    scene: THREE.Scene,
    camera: THREE.Camera,
    cssWidth = 520,
    cssHeight = 640,
    parent?: THREE.Object3D,
    anchorOffset?: THREE.Vector3,
    dockToParent = false
  ): THREE.Group {
    // Destroy any existing entry with the same id
    if (this.panels.has(id)) this.destroyPanel(id);

    // Scale: 1 CSS pixel = cssScale Three.js units.
    // At cssScale=0.003, a 520px-wide panel is 1.56m wide — comfortable VR scale.
    const cssScale = 0.003;

    // ---- CSS3DObject --------------------------------------------------------
    // Apply the inverse scale on the DOM element so the CSS3DObject's world
    // size is cssWidth*cssScale × cssHeight*cssScale (in metres).
    domContainer.style.width = `${cssWidth}px`;
    domContainer.style.height = `${cssHeight}px`;
    domContainer.style.background = 'transparent';
    domContainer.style.borderRadius = '16px';
    domContainer.style.overflow = 'hidden';
    // CRITICAL: enable pointer-events on the panel's DOM content. The
    // CSS3DRenderer overlay (cssEl) is intentionally `pointer-events:
    // none` so that clicks on EMPTY space over the panel area fall
    // through to the WebGL canvas underneath (which is what power-users
    // expect — the 3D world is the canvas, panels are floats on top).
    // But `pointer-events: none` CASCADES to all descendants unless a
    // descendant explicitly sets `pointer-events: auto`. Without this
    // override the click target for a panel-button press becomes the
    // WebGL canvas BELOW the panel DOM, which fires the canvas's
    // `click` listener and triggers `requestPointerLock()` in
    // `SceneEngine.onCanvasClickForLock`. Result: every panel-button
    // click silently re-acquires the crosshair, and the user is
    // trapped in the same "click UI → lock cursor → click crosshair →
    // nothing happens" loop they reported.
    //
    // Setting `pointer-events: auto` on domContainer restores correct
    // hit-testing: empty overlay space falls through to canvas (good
    // — raycasts the 3D world), panel CONTENT receives clicks normally
    // (good — React handlers fire, button onClicks run, inputs focus).
    // The same fix also unblocks `updateLockedHover`'s
    // `document.elementFromPoint(cx, cy)` raycast when the crosshair
    // is over the panel — `elementFromPoint` honours explicit `auto`
    // descendants even when the overlay ancestor has `none`, so
    // `spm.isOverPanel` flips to true and the synthetic mousedown/
    // mouseup/click `handleLockedClick` dispatches reach React.
    domContainer.style.pointerEvents = 'auto';

    const css3dObject = new CSS3DObject(domContainer);
    css3dObject.scale.setScalar(cssScale);

    // ---- Holographic frame mesh (WebGL) -------------------------------------
    const frameGroup = this._buildFrame(cssWidth * cssScale, cssHeight * cssScale);

    // ---- Top-level group ----------------------------------------------------
    const group = new THREE.Group();
    group.name = `SpatialPanel_${id}`;
    group.userData.isSpatialWindow = true;
    group.userData.spatialPanelId = id;
    group.add(css3dObject);
    group.add(frameGroup);

    // Stash whether this panel rides along with another object. Read by
    // `render()` so it always uses world coordinates for the VR Mesh
    // sync (a nested group's local transform != its world transform).
    group.userData.spatialPanelParent = parent ?? null;

    // ---- Initial placement --------------------------------------------------
    if (dockToParent && parent) {
      // Direct child of the target object — rotates, scales, and moves as part of the asset
      parent.add(group);
      group.position.copy(anchorOffset ?? new THREE.Vector3(0, 0, 0.048));
      group.rotation.set(0, 0, 0);
    } else {
      scene.add(group);
      if (parent) {
        // Separate though linked object: placed near the inspected object in world space,
        // never parented to it so transformations/scaling don't affect the inspector.
        const parentPos = new THREE.Vector3();
        parent.getWorldPosition(parentPos);
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);

        const dirToCam = new THREE.Vector3().subVectors(camPos, parentPos);
        dirToCam.y = 0;
        if (dirToCam.lengthSq() > 0.0001) dirToCam.normalize();
        else dirToCam.set(0, 0, 1);

        group.position.copy(parentPos).addScaledVector(dirToCam, 0.95);
        group.position.y = Math.max(1.0, parentPos.y);

        // Orient to face camera horizontally
        const yaw = Math.atan2(dirToCam.x, dirToCam.z);
        group.rotation.set(0, yaw, 0);
      } else {
        // Floating case — use camera-relative placement as before.
        this._placeInFrontOfCamera(group, camera);
      }

      if (anchorOffset) {
        group.position.add(anchorOffset);
      }
    }

    const entry: SpatialPanelEntry = {
      domContainer,
      css3dObject,
      group,
      frameGroup,
      htmlMesh: null,
      interactiveGroup: null,
      visible: true,
      cssWidth,
      cssHeight,
      cssScale,
    };
    this.panels.set(id, entry);

    // In VR mode, immediately build the HTMLMesh for this new panel
    if (this.isVRMode) {
      this._buildHTMLMesh(id, entry);
    }

    return group;
  }

  /**
   * Remove and fully dispose a panel.
   */
  public destroyPanel(id: string): void {
    const entry = this.panels.get(id);
    if (!entry) return;

    this._destroyHTMLMesh(entry);

    const parentScene = entry.group.parent;
    if (parentScene) parentScene.remove(entry.group);

    // Dispose frame geometries/materials
    entry.frameGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
        else m.material?.dispose();
        m.geometry?.dispose();
      }
    });

    this.panels.delete(id);
  }

  /**
   * Returns the group for a given panel id (for position/rotation access).
   */
  public getGroup(id: string): THREE.Group | null {
    return this.panels.get(id)?.group ?? null;
  }

  /**
   * Show or hide a panel (CSS3DObject + frame + HTMLMesh).
   */
  public setVisible(id: string, visible: boolean): void {
    const entry = this.panels.get(id);
    if (!entry) return;
    entry.visible = visible;
    entry.group.visible = visible;
    if (entry.interactiveGroup) entry.interactiveGroup.visible = visible;
  }

  /**
   * Snap the panel in front of the camera, facing the camera.
   */
  public bringToCamera(id: string, camera: THREE.Camera): void {
    const entry = this.panels.get(id);
    if (!entry) return;
    this._placeInFrontOfCamera(entry.group, camera);
  }

  /**
   * Place a panel at an arbitrary world position, optionally facing a direction.
   * If `facingDir` is omitted the panel keeps its current rotation.
   *
   * @param id        Panel id
   * @param worldPos  Where to place the panel centre in world space
   * @param facingDir Unit vector the panel's FRONT face will point toward
   *                  (the panel faces away from the viewer, so pass the
   *                  direction from the panel toward the viewer / camera)
   */
  public placeAtWorldPos(
    id: string,
    worldPos: THREE.Vector3,
    facingDir?: THREE.Vector3
  ): void {
    const entry = this.panels.get(id);
    if (!entry) return;
    entry.group.position.copy(worldPos);
    if (facingDir && facingDir.lengthSq() > 1e-6) {
      // CSS3DObject front face points in -Z by default, so we rotate to
      // align -Z with the direction from the panel toward the viewer.
      const yaw = Math.atan2(facingDir.x, facingDir.z);
      entry.group.rotation.set(0, yaw, 0);
    }
  }

  /**
   * Set world-space scale on the panel group.
   */
  public setScale(id: string, scale: number): void {
    const entry = this.panels.get(id);
    if (!entry) return;
    entry.group.scale.setScalar(scale);
  }

  // -------------------------------------------------------------------------
  // Locked-cursor (crosshair) interaction
  // -------------------------------------------------------------------------

  /**
   * Register a callback that fires whenever the "is crosshair over a panel"
   * state changes. App.tsx uses this to update the crosshair visual.
   */
  public setOnHoverChange(cb: (isOver: boolean) => void): void {
    this.onHoverChangeCallback = cb;
  }

  /** True when the locked crosshair is currently over an interactive panel. */
  public get isOverPanel(): boolean {
    return this.hoveredElement !== null;
  }

  /**
   * Call each frame while the pointer is locked. Temporarily enables
   * pointer-events on the CSS3D overlay so `elementFromPoint` can find the
   * element under (cx, cy) through the 3D CSS perspective transform, then
   * immediately restores pointer-events: none so nothing leaks to normal
   * mouse interaction.
   *
   * @param cx Screen X of the crosshair (usually window.innerWidth / 2)
   * @param cy Screen Y of the crosshair (usually window.innerHeight / 2)
   * @returns true if the crosshair is over a panel element
   */
  public updateLockedHover(cx: number, cy: number): boolean {
    if (this.isVRMode) return false;

    const overlay = this.css3dRenderer.domElement;
    // Temporarily enable hit-testing through 3D CSS transforms
    overlay.style.pointerEvents = 'auto';
    const el = document.elementFromPoint(cx, cy);
    overlay.style.pointerEvents = 'none';

    const found: Element | null = (el && this._isInAnyPanel(el)) ? el : null;
    const wasOver = this.hoveredElement !== null;
    const isNowOver = found !== null;

    // Fire leave/enter events when hover target changes
    if (found !== this.hoveredElement) {
      if (this.hoveredElement) {
        this.hoveredElement.dispatchEvent(
          new MouseEvent('mouseleave', { bubbles: false, cancelable: false })
        );
        this.hoveredElement.dispatchEvent(
          new PointerEvent('pointerleave', { bubbles: false, cancelable: false })
        );
      }
      if (found) {
        found.dispatchEvent(
          new MouseEvent('mouseenter', { bubbles: false, cancelable: false })
        );
        found.dispatchEvent(
          new PointerEvent('pointerenter', { bubbles: false, cancelable: false })
        );
      }
      this.hoveredElement = found;

      // Notify App.tsx when over-panel state changes
      if (wasOver !== isNowOver && this.onHoverChangeCallback) {
        this.onHoverChangeCallback(isNowOver);
      }
    }

    // Always fire mousemove/pointermove so hover CSS states (e.g. :hover) update
    // Always fire mousemove/pointermove so hover CSS states (e.g. :hover) and sliders update
    if (found) {
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true };
      found.dispatchEvent(new PointerEvent('pointermove', opts));
      found.dispatchEvent(new MouseEvent('mousemove', opts));
    }

    return isNowOver;
  }

  /**
   * Dispatch a click to the currently hovered panel element.
   * Call from App.tsx when the user left-clicks while pointer-locked and
   * `isOverPanel` is true.
   */
  public handleLockedClick(): boolean {
    const rawEl = this.hoveredElement;
    if (!rawEl) return false;
    const el = rawEl.closest('button, a, input, select, textarea, [role="button"]') || rawEl;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const opts = { bubbles: true, cancelable: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true };
    const isButtonOrInput = el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT';
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    if (isButtonOrInput && el instanceof HTMLElement && typeof el.click === 'function') {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent('click', opts));
    }
    // Focus text inputs / selects so keyboard events flow into them
    if (el instanceof HTMLElement && typeof el.focus === 'function') {
      el.focus();
    }
    return true;
  }

  /**
   * Scroll the panel under the locked crosshair by `deltaY`.
   * Call from App.tsx / SceneEngine scroll handler when pointer-locked
   * and over a panel.
   *
   * Implementation note: the previous version dispatched a synthetic
   * `WheelEvent` via `el.dispatchEvent(...)` and relied on bubbling to
   * a scrollable ancestor. That LOOKED correct but failed silently
   * because Chromium and Firefox both ignore untrusted wheel events
   * for the actual scroll-position code path — they fire the listener
   * but do NOT update `scrollTop`. Only user-generated (trusted) wheel
   * events drive scrolling.
   *
   * Pointer-lock also routes wheel events to the locked element — the
   * panel DOM never sees a real wheel from the user while locked —
   * so the only reliable path here is to walk up from `hoveredElement`
   * to the closest scrollable ancestor and mutate `scrollTop` directly.
   * That mirrors what a trusted wheel would have done.
   */
  public handleLockedScroll(deltaY: number): boolean {
    const el = this.hoveredElement;
    if (!el) return false;
    let scrollable = this._findScrollableAncestor(el);
    if (!scrollable) {
      for (const [, entry] of this.panels) {
        if (entry.domContainer.contains(el)) {
          const all = entry.domContainer.querySelectorAll('*');
          for (let i = 0; i < all.length; i++) {
            const candidate = all[i] as HTMLElement;
            const cs = window.getComputedStyle(candidate);
            const oy = cs.overflowY;
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && candidate.clientHeight > 0 && candidate.scrollHeight > candidate.clientHeight) {
              scrollable = candidate;
              break;
            }
          }
          break;
        }
      }
    }
    if (!scrollable) return false;
    scrollable.scrollTop += deltaY;
    return true;
  }

  /**
   * Walk up the DOM from `el` to find the nearest scrollable ancestor
   * (`overflow-y: auto|scroll` + actual content overflow). Used by
   * `handleLockedScroll` so the synthetic wheel dispatch — which the
   * browser refuses to use for actual scrolling — can be replaced by a
   * direct `scrollTop` mutation. Stops at `document` (the panel's
   * domContainer sits inside the CSS3D overlay which sits inside the
   * scene container — walking past the container would hit the document
   * and try to scroll the whole page, which is rarely what the user
   * wants inside a spatial panel).
   */
  private _findScrollableAncestor(el: Element | null): HTMLElement | null {
    let cur: HTMLElement | null = el as HTMLElement | null;
    while (cur && cur !== document.documentElement) {
      const cs = window.getComputedStyle(cur);
      const overflowY = cs.overflowY;
      const isScrollableY = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      // `scrollHeight > clientHeight` distinguishes a scrollable that
      // ACTUALLY needs scrolling (e.g. our `overflow-y-auto` body) from
      // an outer panel chrome (header / grip rail / footer) that has
      // the same CSS but never overflows in practice. `clientHeight > 0`
      // filters out zero-height measurement quirks right after a panel
      // mounts before its flex children have laid out.
      if (isScrollableY && cur.clientHeight > 0 && cur.scrollHeight > cur.clientHeight) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /** Clear hover state (call on pointer unlock so stale hover doesn't persist). */
  public clearLockedHover(): void {
    if (this.hoveredElement) {
      this.hoveredElement.dispatchEvent(
        new MouseEvent('mouseleave', { bubbles: false })
      );
      this.hoveredElement.dispatchEvent(
        new PointerEvent('pointerleave', { bubbles: false })
      );
      this.hoveredElement = null;
      this.onHoverChangeCallback?.(false);
    }
  }

  // -------------------------------------------------------------------------
  // VR mode
  // -------------------------------------------------------------------------

  /**
   * Call when entering a WebXR session. Hides CSS3D overlay, builds HTMLMesh
   * planes in scene for each open panel, wires up controller raycasting.
   */
  public enterVR(
    controller1: THREE.XRTargetRaySpace,
    controller2: THREE.XRTargetRaySpace,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera
  ): void {
    this.isVRMode = true;
    this.vrController1 = controller1;
    this.vrController2 = controller2;
    this.vrRenderer = renderer;
    this.vrCamera = camera;
    // Hide the CSS3D overlay (invisible in XR compositor anyway)
    this.css3dRenderer.domElement.style.display = 'none';

    const scene = controller1.parent as THREE.Scene | null;
    if (!scene) return;
    // Cache the scene reference so _buildHTMLMesh can attach the
    // InteractiveGroup to it without threading the scene parameter
    // through. Populated here because createPanel is normally called
    // BEFORE enterVR (App.tsx opens panels on button press), and
    // _buildHTMLMesh needs a known scene root to attach to.
    this.sceneRef = scene;

    for (const [id, entry] of this.panels) {
      this._buildHTMLMesh(id, entry);
    }
  }

  /**
   * Call when leaving a WebXR session. Disposes HTMLMesh, restores CSS3D.
   * IMPORTANT: destroy HTMLMeshes BEFORE nulling the controllers — the
   * destroy path re-attaches the controllers back to the scene root
   * (see _destroyHTMLMesh).
   */
  public exitVR(): void {
    this.isVRMode = false;
    this.css3dRenderer.domElement.style.display = '';

    for (const [, entry] of this.panels) {
      this._destroyHTMLMesh(entry);
    }
    if (this.sharedInteractiveGroup) {
      const ig = this.sharedInteractiveGroup;
      if (this.sceneRef) {
        if (this.vrController1 && this.vrController1.parent === ig) {
          ig.remove(this.vrController1 as unknown as THREE.Object3D);
          this.sceneRef.add(this.vrController1 as unknown as THREE.Object3D);
        }
        if (this.vrController2 && this.vrController2.parent === ig) {
          ig.remove(this.vrController2 as unknown as THREE.Object3D);
          this.sceneRef.add(this.vrController2 as unknown as THREE.Object3D);
        }
        this.sceneRef.remove(ig);
      } else if (ig.parent) {
        ig.parent.remove(ig);
      }
      this.sharedInteractiveGroup = null;
    }
    this.vrController1 = null;
    this.vrController2 = null;
    this.vrCamera = null;
    this.sceneRef = null;
  }

  private ensureSharedInteractiveGroup(): InteractiveGroup | null {
    if (this.sharedInteractiveGroup) return this.sharedInteractiveGroup;
    if (!this.vrRenderer) return null;
    const ig = new InteractiveGroup();
    const cam = this.vrCamera ?? SpatialPanelManager.DEFAULT_VR_CAMERA;
    ig.listenToPointerEvents(this.vrRenderer, cam);
    if (this.vrController1) ig.add(this.vrController1 as unknown as THREE.Object3D);
    if (this.vrController2) ig.add(this.vrController2 as unknown as THREE.Object3D);
    if (this.sceneRef) {
      this.sceneRef.add(ig);
    }
    this.sharedInteractiveGroup = ig;
    return ig;
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  /**
   * Must be called AFTER renderer.render(scene, camera) each frame.
   *
   * Desktop mode: render the CSS3DRenderer overlay (CSS3DObject handles
   *   world-matrix updates internally via Object3D.updateMatrixWorld()).
   * VR mode: each frame, sync each htmlMesh's LOCAL transform to its
   *   panel group's WORLD transform. The InteractiveGroup we attach the
   *   htmlMesh to sits in the scene at identity (see _buildHTMLMesh) so
   *   the htmlMesh's LOCAL transform needs to be set to the GROUP's
   *   WORLD transform — the InteractiveGroup itself isn't moved.
   *
   *   This used to copy local transforms unconditionally, which only
   *   happened to produce the right answer for scene-root panels (where
   *   local transform == world transform). Nested panels (e.g. video-
   *   controls parked under a video group in the scene graph) silently
   *   drifted into the wrong place because their GROUP.position holds
   *   LOCAL coordinates relative to the video object. Now we always
   *   sample world transform — works for both scene-root and nested
   *   panels without extra bookkeeping.
   */
  public render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.isVRMode) {
      this.css3dRenderer.render(scene, camera);
      return;
    }
    for (const [, entry] of this.panels) {
      if (!entry.htmlMesh) continue;
      // Sync visibility to the panel group's visibility so a closed / hidden
      // panel doesn't keep its htmlMesh visible.
      if (entry.group.visible) {
        entry.htmlMesh.visible = true;
        // Always use world transform on the group → local on the htmlMesh,
        // because the InteractiveGroup is anchored to scene root.
        entry.group.updateMatrixWorld();
        entry.group.getWorldPosition(entry.htmlMesh.position);
        entry.group.getWorldQuaternion(entry.htmlMesh.quaternion);
        // Scale: MULTIPLY the baseline cssSize (set in _buildHTMLMesh
        // as `cssWidth*cssScale × cssHeight*cssScale`) by the group's
        // compounded parent worldScale. Just COPYING
        // `entry.group.getWorldScale(htmlMesh.scale)` would clobber
        // the initial sizing — entries where the panel group has unit
        // localScale (which is every entry, since createPanel never
        // sets group.scale) have worldScale ≈ (1,1,1), so htmlMesh
        // would shrink to a unit-size plane on the first frame instead
        // of the (cssWidth*cssScale)x(cssHeight*cssScale) panel size
        // _buildHTMLMesh configured. The multiply-by-worldScale
        // preserves cssSize while matching the parent chain's
        // accumulated scale (a video asset uniformly scaled 0.5x
        // produces a 0.5x-scaled HUD strip — same behaviour as the
        // CSS3DRenderer path, where css3dObject.scale=cssScale
        // compounds through the chain via Object3D.updateMatrixWorld().
        const __panel_gws = this._htmlMeshScaleBuf;
        entry.group.getWorldScale(__panel_gws);
        entry.htmlMesh.scale.set(
          entry.cssWidth * entry.cssScale * __panel_gws.x,
          entry.cssHeight * entry.cssScale * __panel_gws.y,
          __panel_gws.z
        );
      } else {
        entry.htmlMesh.visible = false;
      }
    }
  }

  /**
   * Handle window resize (called from SceneEngine.onWindowResize).
   */
  public onResize(width: number, height: number): void {
    this.css3dRenderer.setSize(width, height);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  public dispose(): void {
    for (const id of [...this.panels.keys()]) {
      this.destroyPanel(id);
    }
    if (this.css3dRenderer.domElement.parentNode) {
      this.css3dRenderer.domElement.parentNode.removeChild(this.css3dRenderer.domElement);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _placeInFrontOfCamera(group: THREE.Group, camera: THREE.Camera): void {
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    // Keep placement horizontal — don't tilt up/down with pitch
    camDir.y = 0;
    if (camDir.lengthSq() < 0.0001) camDir.set(0, 0, -1);
    camDir.normalize();

    group.position.copy(camPos).addScaledVector(camDir, 1.8);
    group.position.y = Math.max(1.0, camPos.y);

    // Face toward camera (rotate 180° because the CSS3DObject's front face
    // points in -Z by default in CSS3DRenderer)
    const yaw = Math.atan2(-camDir.x, -camDir.z);
    group.rotation.set(0, yaw, 0);
    group.scale.set(1, 1, 1);
  }

  private _buildFrame(worldW: number, worldH: number): THREE.Group {
    const g = new THREE.Group();
    g.name = 'holographic_frame';

    const depth = 0.025;
    const boxGeo = new THREE.BoxGeometry(worldW + 0.06, worldH + 0.06, depth);
    const boxMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.2,
      metalness: 0.85,
      transparent: true,
      opacity: 0.45,
      emissive: new THREE.Color('#003344'),
      emissiveIntensity: 0.4,
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.z = -depth / 2 - 0.001;
    g.add(box);

    // Cyan edge lines
    g.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: '#00f0ff' })
    ));

    // Glow halo
    const glowGeo = new THREE.PlaneGeometry(worldW + 0.5, worldH + 0.5);
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#00f0ff',
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.z = -depth - 0.05;
    g.add(glow);

    return g;
  }

  private _buildHTMLMesh(
    id: string,
    entry: SpatialPanelEntry,
  ): void {
    const renderer = this.vrRenderer;
    if (!renderer) return;
    let htmlMesh: HTMLMesh;
    try {
      htmlMesh = new HTMLMesh(entry.domContainer);
    } catch (err) {
      console.warn(`[SpatialPanelManager] HTMLMesh failed for panel "${id}":`, err);
      return;
    }

    const w = entry.cssWidth * entry.cssScale;
    const h = entry.cssHeight * entry.cssScale;
    htmlMesh.scale.set(w, h, 1);
    htmlMesh.position.z = 0.02;

    const ig = this.ensureSharedInteractiveGroup();
    if (ig) {
      ig.add(htmlMesh);
    } else if (this.sceneRef) {
      this.sceneRef.add(htmlMesh);
    } else {
      entry.group.add(htmlMesh);
    }

    entry.htmlMesh = htmlMesh;
    entry.interactiveGroup = ig;
    entry.css3dObject.visible = false;
  }

  private _destroyHTMLMesh(entry: SpatialPanelEntry): void {
    if (entry.htmlMesh) {
      const ig = entry.interactiveGroup || this.sharedInteractiveGroup;
      if (ig) {
        ig.remove(entry.htmlMesh);
      } else if (entry.htmlMesh.parent) {
        entry.htmlMesh.parent.remove(entry.htmlMesh);
      }
      const m = entry.htmlMesh;
      if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
      else m.material?.dispose();
      m.geometry?.dispose();
      entry.htmlMesh = null;
      entry.interactiveGroup = null;
      entry.css3dObject.visible = true;
    }
  }

  /** Returns true if `el` is a descendant of any registered panel's domContainer. */
  private _isInAnyPanel(el: Element): boolean {
    for (const [, entry] of this.panels) {
      if (entry.domContainer.contains(el)) return true;
    }
    return false;
  }
}
