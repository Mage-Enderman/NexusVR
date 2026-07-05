import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import * as THREE from 'three';
import { Pin, PinOff, Magnet, X, GripVertical } from 'lucide-react';
import type { AssetManager } from '../engine/AssetManager.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';

export interface SpatialPopUpWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  assetManager?: AssetManager;
  spatialPanelManager?: SpatialPanelManager;
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  initialPinned?: boolean;
  /** Unique id used as the panel key in SpatialPanelManager */
  panelId?: string;
  /**
   * Optional Object3D parent for the panel. When supplied, the panel
   * group's transform follows the parent's local frame, so 3D-locked
   * inspectors / modals ride along with their target asset through
   * gizmo drags + RMB grab + VR locomotion. The default
   * camera-relative placement still applies when this is undefined
   * (e.g. the import dialog, which has no asset context).
   *
   * Changes to this prop trigger a destroy + recreate of the
   * underlying SpatialPanelManager entry — the wrapper does NOT
   * re-parent in-place because the existing createPanel path does
   * `parent.add(group)` once. A recreate is heavy enough to be
   * acceptable for the user-driven assignment flow (click asset →
   * targetAssetId changes), but try NOT to bind this to a parent
   * that mutates every frame.
   */
  parentObject?: THREE.Object3D;
}

/**
 * SpatialPopUpWrapper — 3D world-space panel using CSS3DRenderer / HTMLMesh.
 *
 * Desktop: React content is portal-mounted into a detached <div> which is
 * placed in the Three.js scene via CSS3DObject (CSS3DRenderer). The panel
 * has a real world-space position, rotation, and scale — it does NOT
 * billboard or track the camera.
 *
 * VR: The same detached <div> is rasterised to a CanvasTexture via HTMLMesh.
 * VR controller raycasts are forwarded as synthetic pointer events so
 * buttons, inputs, and scrolling all work at full feature parity.
 *
 * Grabbing: header drag (fine repositioning) AND RMB grab (carry at arm's
 * length, same as 3D objects) both work.
 *
 * Pinned/unpinned: when unpinned the panel falls back to a centered
 * fixed-position 2D overlay (legacy HUD mode, no CSS3D).
 */
export const SpatialPopUpWrapper: React.FC<SpatialPopUpWrapperProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  scene,
  camera,
  assetManager,
  spatialPanelManager,
  children,
  defaultWidth = 520,
  defaultHeight = 640,
  initialPinned = true,
  panelId,
  parentObject,
}) => {
  const id = panelId ?? `spatial_${title.replace(/\s+/g, '_').toLowerCase()}`;
  const [isPinned, setIsPinned] = useState<boolean>(initialPinned);
  const [isDragging, setIsDragging] = useState(false);
  const [customScale, setCustomScale] = useState(1.0);

  // Detached DOM container that CSS3DObject / HTMLMesh renders from
  const domContainerRef = useRef<HTMLDivElement | null>(null);
  if (!domContainerRef.current) {
    domContainerRef.current = document.createElement('div');
  }

  // 2D HUD drag state (unpinned mode fallback)
  const hudOffsetRef = useRef({ x: 0, y: 0 });
  const hudDragRef = useRef<{
    startX: number; startY: number;
    baseX: number; baseY: number;
    pointerId: number;
  } | null>(null);
  const hudPanelRef = useRef<HTMLDivElement | null>(null);

  // ---- 3D panel lifecycle --------------------------------------------------

  useEffect(() => {
    if (!isOpen || !isPinned || !scene || !camera || !spatialPanelManager) return;

    const domContainer = domContainerRef.current!;
    domContainer.style.width = `${defaultWidth}px`;
    domContainer.style.height = `${defaultHeight}px`;

    // Create the CSS3DObject in the scene. Pass `parentObject` so the
    // panel docks at the supplied Object3D's local frame (e.g. an
    // asset's three.Object3d). When undefined, createPanel falls back
    // to its default camera-relative placement (good for the import
    // dialog, which has no asset context).
    const group = spatialPanelManager.createPanel(
      id,
      domContainer,
      scene,
      camera,
      defaultWidth,
      defaultHeight,
      parentObject,        // optional — see SpatialPanelManager.createPanel
      undefined            // anchorOffset — use default for now
    );

    // Register the frame group as a custom asset so ManipulationManager can
    // select/grab it via RMB (same as any 3D object)
    const assetIdKey = `spatial_window_${id}`;
    assetManager?.registerCustomAsset(assetIdKey, title, group, 'primitive');

    return () => {
      assetManager?.unregisterCustomAsset(assetIdKey);
      spatialPanelManager.destroyPanel(id);
    };
    // NB: parentObject is intentionally NOT a dep — re-creating the
    // panel on parent-object identity changes is the heavy recovery
    // path (see `useEffect` target asset change flow). When the parent
    // prop changes App.tsx is expected to remount the wrapper (key=
    // selectedAsset?.id) so we only pay the recreate cost once per
    // asset, not on every render.
  }, [isOpen, isPinned, scene, camera, spatialPanelManager, id, title, assetManager, defaultWidth, defaultHeight]);

  // ---- Scale sync (scale buttons → 3D group) ------------------------------

  const updateGroupScale = (scale: number) => {
    if (isPinned && spatialPanelManager) {
      spatialPanelManager.setScale(id, scale);
    }
  };

  // ---- Bring to me ---------------------------------------------------------

  const handleBringToMe = () => {
    if (camera && isPinned && spatialPanelManager) {
      spatialPanelManager.bringToCamera(id, camera);
    }
    if (!isPinned) {
      hudOffsetRef.current = { x: 0, y: 0 };
      if (hudPanelRef.current) {
        hudPanelRef.current.style.transform =
          `translate(calc(-50% + 0px), calc(-50% + 0px))`;
      }
    }
  };

  // ---- 2D HUD drag (unpinned only) -----------------------------------------

  const beginHudDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPinned) return; // 3D drag handled by header drag on CSS3DObject
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    setIsDragging(true);
    hudDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: hudOffsetRef.current.x,
      baseY: hudOffsetRef.current.y,
      pointerId: e.pointerId,
    };
  };

  const moveHudDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = hudDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const nx = drag.baseX + (e.clientX - drag.startX);
    const ny = drag.baseY + (e.clientY - drag.startY);
    hudOffsetRef.current = { x: nx, y: ny };
    if (hudPanelRef.current) {
      hudPanelRef.current.style.transform =
        `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    }
  };

  const endHudDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = hudDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
    hudDragRef.current = null;
    setIsDragging(false);
  };

  if (!isOpen) return null;

  // ---- Panel UI (rendered into either CSS3DObject or 2D HUD) ---------------

  const panelUI = (
    <div
      className={`flex flex-col rounded-2xl overflow-hidden bg-[#0a0f18] border border-cyan-500/40 shadow-[0_0_30px_rgba(0,240,255,0.2)]`}
      style={{ width: defaultWidth, minHeight: 180, maxHeight: defaultHeight, userSelect: 'none' }}
    >
      {/* Header */}
      <div
        onPointerDown={isPinned ? undefined : beginHudDrag}
        onPointerMove={isPinned ? undefined : moveHudDrag}
        onPointerUp={isPinned ? undefined : endHudDrag}
        onPointerCancel={isPinned ? undefined : endHudDrag}
        className={`relative px-4 py-3 border-b border-cyan-500/40 flex items-center justify-between select-none touch-none ${
          isPinned ? 'cursor-default' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
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
              {isPinned
                ? 'RMB to grab · drag header to reposition'
                : isDragging ? 'Repositioning…' : 'Drag header to reposition'}
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleBringToMe}
            title="Snap window in front of you"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs flex items-center gap-1"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold hidden sm:inline">Bring</span>
          </button>

          <button
            onClick={() => {
              const ns = Math.min(2.0, customScale * 1.15);
              setCustomScale(ns);
              updateGroupScale(ns);
            }}
            title="Increase window size"
            className="p-0 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs font-bold w-7 h-7 flex items-center justify-center"
          >+</button>
          <button
            onClick={() => {
              const ns = Math.max(0.5, customScale * 0.87);
              setCustomScale(ns);
              updateGroupScale(ns);
            }}
            title="Decrease window size"
            className="p-0 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs font-bold w-7 h-7 flex items-center justify-center"
          >−</button>
          <button
            onClick={() => {
              setCustomScale(1.0);
              updateGroupScale(1.0);
            }}
            title="Reset window size"
            className="p-0 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition border border-slate-700 hover:border-cyan-500/40 text-xs font-bold w-7 h-7 flex items-center justify-center"
          >⤾</button>

          <button
            onClick={() => setIsPinned(!isPinned)}
            title={isPinned ? 'Unpin (2D HUD mode)' : 'Pin in 3D world space'}
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

      {/* Grip rail */}
      <div
        aria-hidden
        onPointerDown={isPinned ? undefined : beginHudDrag}
        onPointerMove={isPinned ? undefined : moveHudDrag}
        onPointerUp={isPinned ? undefined : endHudDrag}
        onPointerCancel={isPinned ? undefined : endHudDrag}
        className={`h-1.5 mx-4 mt-1 mb-2 rounded-full touch-none ${
          isPinned ? '' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${
          isDragging
            ? 'bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-pink-400'
            : 'bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-pink-500/40 hover:from-cyan-500 hover:via-purple-500 hover:to-pink-500'
        } transition-all`}
        style={{
          boxShadow: isDragging
            ? '0 0 18px rgba(0,240,255,0.6), 0 0 18px rgba(236,72,153,0.4)'
            : '0 0 10px rgba(0,240,255,0.30)',
        }}
      />

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-4 text-slate-200 custom-scrollbar`}>
        {children}
      </div>
    </div>
  );

  // ---- Pinned: portal into detached div (CSS3DObject) ----------------------

  if (isPinned && spatialPanelManager && scene) {
    return ReactDOM.createPortal(panelUI, domContainerRef.current!);
  }

  // ---- Unpinned: classic fixed-position 2D overlay -------------------------

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        ref={hudPanelRef}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(calc(-50% + ${hudOffsetRef.current.x}px), calc(-50% + ${hudOffsetRef.current.y}px))`,
          pointerEvents: 'auto',
          willChange: 'transform',
        }}
      >
        {panelUI}
      </div>
    </div>
  );
};
