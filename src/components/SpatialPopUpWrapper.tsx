import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { Pin, PinOff, Magnet, X, GripVertical } from 'lucide-react';

export interface SpatialPopUpWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  children: React.ReactNode;
  defaultWidth?: string;
  defaultHeight?: string;
  initialPinned?: boolean;
}

interface DragState {
  pointerId: number;
  originX: number;
  originY: number;
  baseOffsetX: number;
  baseOffsetY: number;
  lastX: number;
  lastY: number;
}

/**
 * SpatialPopUpWrapper renders a panel that lives in 3D world space.
 *
 * Position lives entirely in one per-frame `transform` write on a single
 * sized element (the panelRef). The transform composition is:
 *   translate3d(targetX, targetY) translate(-50%, -50%)
 *     scale(s) rotateX(rotX) rotateY(rotY) rotateZ(rotZ) translateZ(liftZ)
 * — this centers the panel on the target anchor point and applies 3D
 * perspective transforms around the panel's own center.
 *
 * Multiple z-layered planes (backplate glow, bezel, scanlines, raised
 * header & grip rail, content) create genuine perceived depth that also
 * reads as parallax in WebXR DOM overlays. Drag uses pointer events with
 * setPointerCapture so the underlying canvas (OrbitControls) cannot hijack
 * the gesture.
 */
export const SpatialPopUpWrapper: React.FC<SpatialPopUpWrapperProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  scene,
  camera,
  children,
  defaultWidth = 'w-[420px]',
  defaultHeight = 'max-h-[600px]',
  initialPinned = true
}) => {
  const [isPinned, setIsPinned] = useState<boolean>(initialPinned);
  const [manualOffset, setManualOffset] = useState({ x: 0, y: 0 });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const tabletMeshRef = useRef<THREE.Group | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const animFrameRef = useRef<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  // 3D drag helpers: the plane the pointer raycasts onto, where on that
  // plane the drag started, and the current world-space offset that should
  // be applied to the group during the drag (baked into group.position on
  // release).
  const dragPlaneRef = useRef<THREE.Plane | null>(null);
  const dragOriginWorldRef = useRef<THREE.Vector3 | null>(null);
  const dragOffsetRef = useRef<THREE.Vector3 | null>(null);

  // Reset 2D HUD offset each time the inspector opens so the panel starts
  // centered. The 3D group's initial position/rotation is set in the mesh-
  // creation useEffect below (one-time lookAt so it doesn't spawn edge-on).
  useEffect(() => {
    if (!isOpen) return;
    setManualOffset({ x: 0, y: 0 });
    if (dragStateRef.current) {
      dragStateRef.current.baseOffsetX = 0;
      dragStateRef.current.baseOffsetY = 0;
    }
    dragOffsetRef.current = null;
    dragOriginWorldRef.current = null;
    dragPlaneRef.current = null;
  }, [isOpen]);

  // Create / dispose the 3D holographic frame in the scene so other VR
  // players can SEE where this window lives. Resources are disposed on
  // cleanup so repeated open/close doesn't leak GPU memory.
  useEffect(() => {
    if (!isOpen || !scene || !isPinned) {
      if (tabletMeshRef.current && scene) {
        scene.remove(tabletMeshRef.current);
        tabletMeshRef.current = null;
      }
      return;
    }

    const group = new THREE.Group();
    group.name = `SpatialWindow_${title.replace(/\s+/g, '_')}`;
    // Initial pose: place 1.8m forward of camera, oriented to face back
    // toward the camera with a fixed rotation (NOT a billboard — the group
    // keeps this world-space orientation as the camera moves). Uses a
    // one-time Y-axis yaw so the panel reads as a stationary tablet in
    // the scene rather than a camera-tracking billboard.
    if (camera) {
      const initPos = new THREE.Vector3();
      const initDir = new THREE.Vector3();
      camera.getWorldPosition(initPos);
      camera.getWorldDirection(initDir);
      initDir.y = 0;
      if (initDir.lengthSq() === 0) initDir.set(0, 0, -1);
      initDir.normalize();
      const initialPos = initPos.clone().add(initDir.clone().multiplyScalar(1.8));
      initialPos.y = Math.max(1.0, initPos.y);
      group.position.copy(initialPos);
      // Fixed rotation: yaw only, so the panel faces back toward the camera
      // without tracking it per-frame. Negate initDir so the panel's front
      // (local -Z) points at the camera, matching lookAt semantics.
      const angle = Math.atan2(-initDir.x, -initDir.z);
      group.rotation.set(0, angle, 0);
    } else {
      group.position.set(0, 1.5, -1.6);
    }
    // Tag the group so future raycaster / gizmo integration can find it.
    group.userData.isSceneInspectable = true;
    group.userData.inspectorId = 'sceneinspector';
    group.userData.panelTitle = title;

    // Landscape tablet proportions: wider than tall
    const frameW = 1.4;
    const frameH = 0.85;
    const frameGeo = new THREE.BoxGeometry(frameW, frameH, 0.04);
    const frameMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.2,
      metalness: 0.85,
      transparent: true,
      opacity: 0.55
    });
    frameMat.emissive = new THREE.Color('#003344');
    frameMat.emissiveIntensity = 0.4;
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    group.add(frameMesh);

    const borderGeo = new THREE.EdgesGeometry(frameGeo);
    const borderMat = new THREE.LineBasicMaterial({ color: '#00f0ff' });
    group.add(new THREE.LineSegments(borderGeo, borderMat));

    const glowGeo = new THREE.PlaneGeometry(frameW + 0.6, frameH + 0.6);
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#00f0ff',
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.z = -0.05;
    group.add(glowMesh);

    scene.add(group);
    tabletMeshRef.current = group;

    return () => {
      if (tabletMeshRef.current && scene) {
        scene.remove(tabletMeshRef.current);
        tabletMeshRef.current = null;
      }
      frameGeo.dispose();
      frameMat.dispose();
      borderGeo.dispose();
      borderMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
    };
  }, [isOpen, scene, isPinned, camera, title]);

  // Per-frame: read live Group pose from `tabletMeshRef.current.matrixWorld`
  // and project to a screen-space HTML panel. The Group is the source of
  // truth for position/scale. The HTML overlay does NOT mirror the 3D
  // group's rotation — that caused severe distortion/skewing when the
  // camera viewed the panel from an angle. Instead the HTML always renders
  // flat (identity rotation) while its screen position and scale follow
  // the 3D group's world-space anchor point.
  useEffect(() => {
    if (!isOpen) return;

    const ndc = new THREE.Vector3();
    const projectedPos = new THREE.Vector3();
    const groupScale = new THREE.Vector3();
    const tmpViewPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpCamQuatInv = new THREE.Quaternion();

    const writeTransform = (
      targetX: number,
      targetY: number,
      scale: number,
      rotMatrixCss: string,
      liftZ: number,
      visible: boolean
    ) => {
      const el = panelRef.current;
      if (!el) return;
      el.style.transform =
        `translate3d(${targetX}px, ${targetY}px, 0) ` +
        `translate(-50%, -50%) ` +
        `scale(${scale.toFixed(3)}) ` +
        `${rotMatrixCss} ` +
        `translateZ(${liftZ.toFixed(0)}px)`;
      el.style.opacity = visible ? '1' : '0';
      el.style.pointerEvents = visible ? 'auto' : 'none';
    };

    const updateProjection = () => {
      const drag = dragStateRef.current;
      const offset = drag
        ? {
            x: drag.baseOffsetX + (drag.lastX - drag.originX),
            y: drag.baseOffsetY + (drag.lastY - drag.originY)
          }
        : manualOffset;

      // ----- Unpinned (2D HUD) branch -----
      if (!isPinned || !camera) {
        const dragPitch = drag
          ? THREE.MathUtils.clamp((drag.lastY - drag.originY) * -0.04, -10, 10)
          : 0;
        const dragYaw = drag
          ? THREE.MathUtils.clamp((drag.lastX - drag.originX) * 0.04, -10, 10)
          : 0;
        writeTransform(
          window.innerWidth / 2 + offset.x,
          window.innerHeight / 2 + offset.y,
          1,
          `rotateX(${dragPitch.toFixed(2)}deg) rotateY(${dragYaw.toFixed(2)}deg)`,
          0,
          true
        );
        animFrameRef.current = requestAnimationFrame(updateProjection);
        return;
      }

      // ----- Pinned (3D) branch — true 3D object in scene space -----
      const group = tabletMeshRef.current;
      if (!group) {
        animFrameRef.current = requestAnimationFrame(updateProjection);
        return;
      }

      // Read current pose (the gizmo or drag may have moved/rotated/scaled
      // the Group). During an active drag, add the temporary drag offset
      // so the panel follows the pointer before the offset is baked in.
      group.updateMatrixWorld(true);
      group.getWorldPosition(projectedPos);
      group.getWorldScale(groupScale);
      if (dragOffsetRef.current) {
        projectedPos.add(dragOffsetRef.current);
      }

      // Project the effective world position to NDC for screen placement.
      ndc.copy(projectedPos).project(camera);
      const isBehind = ndc.z > 1.0;

      const sx = (ndc.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-(ndc.y * 0.5 - 0.5)) * window.innerHeight;

      // Use view-space depth (distance along the camera's forward axis)
      // instead of radial distance. Radial distance grows when moving
      // sideways, which caused the panel to shrink when the camera
      // panned left/right. View-space depth stays constant for lateral
      // movement, giving correct perspective scaling.
      const viewPos = projectedPos.clone().applyMatrix4(camera.matrixWorldInverse);
      const depth = Math.max(0.01, -viewPos.z);

      // Scale inversely proportional to depth (1.8 is baseline interaction distance)
      const groupPanelScale = (groupScale.x + groupScale.y) / 2;
      const finalScale = groupPanelScale * (1.8 / depth);

      // Extract camera-relative rotation for CSS. The group's world
      // quaternion is transformed into camera space so the CSS rotation
      // matches how the 3D object appears from the camera's viewpoint.
      // CSS and Three.js have opposite rotation conventions for X and Z.
      const camQuatInverse = new THREE.Quaternion().copy(camera.quaternion).invert();
      const groupQuat = new THREE.Quaternion();
      group.getWorldQuaternion(groupQuat);
      const localQuat = camQuatInverse.multiply(groupQuat);
      const euler = new THREE.Euler().setFromQuaternion(localQuat, 'YXZ');

      const rotMatrixCss = `rotateX(${-euler.x}rad) rotateY(${euler.y}rad) rotateZ(${-euler.z}rad)`;

      writeTransform(
        sx + offset.x, sy + offset.y,
        finalScale,
        rotMatrixCss,
        isDragging ? 70 : 0,
        !isBehind && depth < 18
      );

      animFrameRef.current = requestAnimationFrame(updateProjection);
    };

    animFrameRef.current = requestAnimationFrame(updateProjection);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isOpen, isPinned, camera, manualOffset, isDragging]);

  const handleBringToMe = () => {
    if (!camera) return;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() === 0) camDir.set(0, 0, -1);
    camDir.normalize();

    const newPos = camPos.clone().add(camDir.multiplyScalar(1.8));
    newPos.y = Math.max(1.0, camPos.y);

    // Operate directly on the 3D Group: reset position, re-orient the
    // panel toward the camera (one-time lookAt, not a billboard), reset
    // scale, and tear down any in-flight drag.
    if (tabletMeshRef.current) {
      tabletMeshRef.current.position.copy(newPos);
      // Fixed yaw rotation toward camera (not a per-frame billboard).
      // Negate direction so front face points at the camera.
      const dir = newPos.clone().sub(camPos);
      dir.y = 0;
      if (dir.lengthSq() > 0) {
        const yaw = Math.atan2(-dir.x, -dir.z);
        tabletMeshRef.current.rotation.set(0, yaw, 0);
      }
      tabletMeshRef.current.scale.set(1, 1, 1);
    }
    dragOffsetRef.current = null;
    dragOriginWorldRef.current = null;
    dragPlaneRef.current = null;
    setManualOffset({ x: 0, y: 0 });
    if (dragStateRef.current) {
      dragStateRef.current.baseOffsetX = 0;
      dragStateRef.current.baseOffsetY = 0;
      dragStateRef.current.originX = dragStateRef.current.lastX;
      dragStateRef.current.originY = dragStateRef.current.lastY;
    }
  };

  // ---------------- Drag (pointer events) -----------------
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setIsDragging(true);
    dragStateRef.current = {
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      baseOffsetX: manualOffset.x,
      baseOffsetY: manualOffset.y,
      lastX: e.clientX,
      lastY: e.clientY
    };
    // 3D: build a drag plane that runs along the tablet's own surface so
    // dragging a tilted tablet slides it in its own plane (instead of
    // fighting the camera direction). The plane passes through the
    // group's current world position so the raycast intersection gives
    // the new world point.
    if (camera && tabletMeshRef.current && isPinned) {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      tabletMeshRef.current.getWorldPosition(worldPos);
      tabletMeshRef.current.getWorldQuaternion(worldQuat);
      // Tablet's local +Z direction transformed to world space. lookAt
      // // in this branch worked against the camera, so using the
      // group's own normal is more honest about where the user can
      // // drag the panel.
      const tabletNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat).normalize();
      dragPlaneRef.current = new THREE.Plane().setFromNormalAndCoplanarPoint(
        tabletNormal,
        worldPos
      );
      dragOriginWorldRef.current = worldPos.clone();
      dragOffsetRef.current = new THREE.Vector3(0, 0, 0);
    }
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    // 3D translation: raycast the pointer onto the drag plane and update
    // the world-space offset that the per-frame loop adds to
    // group.position during the drag.
    if (camera && dragPlaneRef.current && dragOriginWorldRef.current) {
      const ndc = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(dragPlaneRef.current, hit)) {
        dragOffsetRef.current = hit.sub(dragOriginWorldRef.current);
      }
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = drag.lastX - drag.originX;
    const dy = drag.lastY - drag.originY;
    setManualOffset({
      x: drag.baseOffsetX + dx,
      y: drag.baseOffsetY + dy
    });
    // 3D: bake the world offset into the Group's position so it persists
    // after the pointer releases. Then tear down drag-plane refs.
    if (tabletMeshRef.current && dragOffsetRef.current) {
      tabletMeshRef.current.position.add(dragOffsetRef.current);
    }
    dragOffsetRef.current = null;
    dragOriginWorldRef.current = null;
    dragPlaneRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        perspective: '1000px',
        perspectiveOrigin: '50% 50%',
        pointerEvents: 'none',
        overflow: 'hidden'
      }}
    >
      <div
        ref={panelRef}
        className={`${defaultWidth} ${defaultHeight} relative flex flex-col`}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformStyle: 'preserve-3d',
          transformOrigin: 'center center',
          willChange: 'transform',
          // Avoid one-frame flash at viewport (0,0) before the first rAF
          // mutation lands a real position.
          transform: 'translate3d(50vw, 50vh, 0) translate(-50%, -50%)'
        }}
      >
        {/* LAYER 1: deep holographic glow halo (translateZ = -80px) */}
        <div
          aria-hidden
          className="absolute -inset-6 rounded-[28px] pointer-events-none"
          style={{
            transform: 'translateZ(-80px)',
            background:
              'radial-gradient(ellipse at 50% 30%, rgba(0,240,255,0.45), rgba(168,85,247,0.22) 55%, rgba(0,0,0,0) 78%)',
            filter: 'blur(28px)'
          }}
        />

        {/* LAYER 2: outer bezel (translateZ = -25px) */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            transform: 'translateZ(-25px)',
            border: '1px solid rgba(0,240,255,0.40)',
            boxShadow:
              '0 0 38px rgba(0,240,255,0.35), inset 0 0 32px rgba(168,85,247,0.18)'
          }}
        />

        {/* LAYER 2b: scanlines to read as physical surface */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden"
          style={{
            transform: 'translateZ(-12px)',
            opacity: 0.10,
            background:
              'repeating-linear-gradient(0deg, rgba(0,240,255,0.55) 0, rgba(0,240,255,0.55) 1px, transparent 1px, transparent 4px)'
          }}
        />

        {/* LAYER 3: shadow plate to give the window physical weight */}
        <div
          aria-hidden
          className="absolute inset-x-0 -bottom-6 h-8 rounded-2xl pointer-events-none"
          style={{
            transform: 'translateZ(-40px)',
            background: 'radial-gradient(ellipse at 50% 0%, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)',
            filter: 'blur(14px)'
          }}
        />

        {/* LAYER 4: actual content panel (z = 0). Layers above sit behind it. */}
        <div
          className="relative flex flex-col overflow-hidden rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-cyan-500/40 shadow-[0_0_45px_rgba(0,240,255,0.25)]"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* Header / Title bar — pops +25px forward in Z */}
          <div
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ transform: 'translateZ(25px)' }}
            className={`relative px-4 py-3 border-b border-cyan-500/40 flex items-center justify-between select-none touch-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            } bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950`}
          >
            <div className="flex items-center gap-2.5 pointer-events-none">
              <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[inset_0_0_10px_rgba(0,240,255,0.25)]">
                {icon || <GripVertical className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="text-sm font-bold bg-gradient-to-r from-white via-slate-200 to-cyan-200 bg-clip-text text-transparent flex items-center gap-2">
                  <span>{title}</span>
                  {isPinned && (
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/40 font-bold tracking-wider">
                      3D Spatial
                    </span>
                  )}
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                  {isDragging ? 'Repositioning...' : 'Drag header to reposition · sticks in 3D world space'}
                </p>
              </div>
            </div>

            <div
              className="flex items-center gap-1.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleBringToMe}
                title="Snap window back in front of you"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs flex items-center gap-1"
              >
                <Magnet className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold hidden sm:inline">Bring</span>
              </button>

              {/* Scale affordance: modify group.scale directly so the
                  tablet can be resized in-3D without the gizmo. */}
              <button
                onClick={() => { if (tabletMeshRef.current) tabletMeshRef.current.scale.multiplyScalar(1.15); }}
                title="Increase tablet size"
                className="p-0 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs font-bold w-7 h-7 flex items-center justify-center"
              >+</button>
              <button
                onClick={() => { if (tabletMeshRef.current) tabletMeshRef.current.scale.multiplyScalar(0.87); }}
                title="Decrease tablet size"
                className="p-0 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs font-bold w-7 h-7 flex items-center justify-center"
              >−</button>
              <button
                onClick={() => { if (tabletMeshRef.current) tabletMeshRef.current.scale.set(1, 1, 1); }}
                title="Reset tablet size"
                className="p-0 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs font-bold w-7 h-7 flex items-center justify-center"
              >⤾</button>

              <button
                onClick={() => setIsPinned(!isPinned)}
                title={isPinned ? 'Unpin (switch to 2D HUD mode)' : 'Pin in 3D world space'}
                className={`p-1.5 rounded-lg transition border text-xs flex items-center gap-1 ${
                  isPinned
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                <span className="text-[10px] font-bold hidden sm:inline">{isPinned ? '3D' : '2D'}</span>
              </button>

              <button
                onClick={onClose}
                title="Close window"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition border border-slate-700 hover:border-red-500/40 ml-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bottom grip rail (lift-here affordance, z=+45) */}
          <div
            aria-hidden
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`h-1.5 mx-4 mt-1 mb-2 rounded-full touch-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            } ${
              isDragging
                ? 'bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-pink-400'
                : 'bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-pink-500/40 hover:from-cyan-500 hover:via-purple-500 hover:to-pink-500'
            } transition-all`}
            style={{
              transform: 'translateZ(45px)',
              boxShadow: isDragging
                ? '0 0 18px rgba(0,240,255,0.6), 0 0 18px rgba(236,72,153,0.4)'
                : '0 0 10px rgba(0,240,255,0.30)'
            }}
          />

          {/* Window body */}
          <div
            className={`flex-1 overflow-y-auto ${defaultHeight} p-4 text-slate-200 custom-scrollbar`}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
