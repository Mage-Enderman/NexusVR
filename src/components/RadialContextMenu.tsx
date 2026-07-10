import React, { useState, useEffect } from 'react';
import {
  Undo2,
  Redo2,
  Footprints,
  Plane,
  Ghost,
  Maximize,
  Minimize,
  Compass,
  Hand,
  Crosshair,
  Sparkles,
  Grid,
  Shield,
  X,
  Trash2,
  Copy,
  BookmarkPlus,
  Download,
  Mic,
  MicOff
} from 'lucide-react';
import type { AssetType } from '../engine/AssetManager.ts';

export interface RadialContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  locomotionMode: 'walk' | 'flight' | 'noclip';
  onSetLocomotionMode: (mode: 'walk' | 'flight' | 'noclip') => void;
  scalingEnabled: boolean;
  onToggleScaling: () => void;
  laserEnabled: boolean;
  onToggleLaser: () => void;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  onSetGrabMode: (mode: 'auto' | 'precision' | 'palm' | 'laser') => void;
  onUndo?: () => void;
  onRedo?: () => void;
  isHeld?: boolean;
  heldAssetType?: AssetType | null;
  onDestroy?: () => void;
  onDuplicate?: () => void;
  onSaveHeld?: () => void;
  onDownloadHeld?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
}

/**
 * Calculates an SVG arc path for an annular sector with rounded corners.
 */
function getArcPath(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  startDeg: number,
  endDeg: number
): string {
  const startRad = (startDeg - 90) * (Math.PI / 180);
  const endRad = (endDeg - 90) * (Math.PI / 180);

  const x1 = cx + rOut * Math.cos(startRad);
  const y1 = cy + rOut * Math.sin(startRad);
  const x2 = cx + rOut * Math.cos(endRad);
  const y2 = cy + rOut * Math.sin(endRad);

  const x3 = cx + rIn * Math.cos(endRad);
  const y3 = cy + rIn * Math.sin(endRad);
  const x4 = cx + rIn * Math.cos(startRad);
  const y4 = cy + rIn * Math.sin(startRad);

  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

/**
 * Calculates the center Cartesian coordinates for placing icons inside an arc slice.
 */
function getSliceCenter(cx: number, cy: number, rIn: number, rOut: number, startDeg: number, endDeg: number) {
  const midDeg = (startDeg + endDeg) / 2;
  const midRad = (midDeg - 90) * (Math.PI / 180);
  const rMid = (rIn + rOut) / 2;
  return {
    x: cx + rMid * Math.cos(midRad),
    y: cy + rMid * Math.sin(midRad),
  };
}

export const RadialContextMenu: React.FC<RadialContextMenuProps> = ({
  isOpen,
  position,
  onClose,
  locomotionMode,
  onSetLocomotionMode,
  scalingEnabled,
  onToggleScaling,
  laserEnabled,
  onToggleLaser,
  grabMode,
  onSetGrabMode,
  onUndo,
  onRedo,
  isHeld = false,
  heldAssetType = null,
  onDestroy,
  onDuplicate,
  onSaveHeld,
  onDownloadHeld,
  isMuted = false,
  onToggleMute
}) => {
  // 'held' is a third tab only reachable when isHeld is true. The hub
  // click handler filters it out of the cycle when isHeld is false.
  const [activeTab, setActiveTab] = useState<'general' | 'grab' | 'held'>('general');
  // Auto-switch to 'held' on open when carrying an object. Resets to
  // 'general' on close so the next open (without a held object) lands
  // on the default tab. Also re-checks when isHeld flips while the
  // menu is open so a grab-during-open jumps the user to held.
  useEffect(() => {
    if (!isOpen) return;
    if (isHeld) {
      setActiveTab('held');
    } else {
      // Don't clobber the user's explicit 'grab' selection if they
      // already navigated there before releasing the held object.
      setActiveTab((prev) => (prev === 'held' ? 'general' : prev));
    }
  }, [isOpen, isHeld]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [virtualCursor, setVirtualCursor] = useState<{ x: number; y: number }>({ x: 180, y: 180 });
  const [isLocked, setIsLocked] = useState(document.pointerLockElement !== null);

  useEffect(() => {
    (window as any).__isRadialMenuOpen = isOpen;
    const checkLock = () => setIsLocked(document.pointerLockElement !== null);
    checkLock();
    document.addEventListener('pointerlockchange', checkLock);
    if (isOpen) {
      setVirtualCursor({ x: 180, y: 180 });
      setHoveredIndex(null);
    }
    return () => {
      (window as any).__isRadialMenuOpen = false;
      document.removeEventListener('pointerlockchange', checkLock);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== null) {
        setVirtualCursor(prev => {
          let nx = prev.x + e.movementX;
          let ny = prev.y + e.movementY;
          const dx = nx - 180;
          const dy = ny - 180;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxRadius = 140;
          if (dist > maxRadius && dist > 0) {
            nx = 180 + (dx / dist) * maxRadius;
            ny = 180 + (dy / dist) * maxRadius;
          }
          return { x: nx, y: ny };
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isOpen, position]);

  const handleNextLocomotion = () => {
    const next: typeof locomotionMode =
      locomotionMode === 'walk' ? 'flight' :
      locomotionMode === 'flight' ? 'noclip' : 'walk';
    onSetLocomotionMode(next);
  };

  const handleNextGrabMode = () => {
    const next: typeof grabMode =
      grabMode === 'auto' ? 'precision' :
      grabMode === 'precision' ? 'palm' :
      grabMode === 'palm' ? 'laser' : 'auto';
    onSetGrabMode(next);
  };

  // Dimensions for SVG Pie Menu
  const cx = 180;
  const cy = 180;
  const rIn = 45;
  const rOut = 115;

  // Symmetrical 6 slices with 10 degree gap around 360 degrees
  const slices = [
    { id: 'top', start: -25, end: 25, label: 'Mute' },
    { id: 'redo', start: 35, end: 85, label: 'Redo' },
    { id: 'right', start: 95, end: 145, label: 'Right' },
    { id: 'bottom', start: 155, end: 205, label: 'Bottom' },
    { id: 'left', start: 215, end: 265, label: 'Left' },
    { id: 'undo', start: 275, end: 325, label: 'Undo' },
  ];

  const dx = virtualCursor.x - 180;
  const dy = virtualCursor.y - 180;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let computedHover: number | null = null;

  if (dist >= 36 && dist <= 160) {
    let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angleDeg > 335) angleDeg -= 360;
    else if (angleDeg < -35) angleDeg += 360;

    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (s.start <= s.end) {
        if (angleDeg >= s.start && angleDeg <= s.end) computedHover = i;
      } else {
        if (angleDeg >= s.start || angleDeg <= s.end) computedHover = i;
      }
    }
  } else if (dist < 36) {
    computedHover = -1;
  }

  const activeIndex = hoveredIndex !== null ? hoveredIndex : (isLocked ? computedHover : null);

  const triggerSliceAction = (index: number) => {
    const slice = slices[index];
    if (!slice) return;
    if (slice.id === 'top') { onToggleMute?.(); onClose(); }
    else if (slice.id === 'undo') { onUndo?.(); onClose(); }
    else if (slice.id === 'redo') { onRedo?.(); onClose(); }
    else if (slice.id === 'right') {
      if (activeTab === 'general') handleNextLocomotion();
      else if (activeTab === 'held') { onSaveHeld?.(); onClose(); }
      else handleNextGrabMode();
    }
    else if (slice.id === 'bottom') {
      if (activeTab === 'general') onToggleScaling();
      else if (activeTab === 'held') {
        // Bottom slice in the held tab is conditionally Download (for
        // misc files) or Duplicate (for everything else). Misc files
        // are the only type that meaningfully downloads — the rest are
        // already in the world as renderable assets. Mirrors the icon
        // swap in the slice render block below.
        if (heldAssetType === 'misc') { onDownloadHeld?.(); onClose(); }
        else { onDuplicate?.(); onClose(); }
      }
      else { onClose(); }
    }
    else if (slice.id === 'left') {
      if (activeTab === 'general') onToggleLaser();
      else if (activeTab === 'held') { onDestroy?.(); onClose(); }
      else { onClose(); }
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (!isLocked) {
        // MMB (button 1) AND RMB (button 2) close the menu when it's
        // open. Mirrors the canvas-side `onCanvasAuxMouseDown` toggle so
        // the user can dismiss the menu with whichever button is handy
        // — without it, MMB only opened it, and pressing MMB again over
        // the menu (with no cursor) was a dead-weight input.
        if (e.button === 1 || e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
      }

      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        if (activeIndex === -1) {
          setActiveTab(prev => (prev === 'general' ? 'grab' : 'general'));
        } else if (activeIndex !== null && activeIndex >= 0) {
          triggerSliceAction(activeIndex);
        } else {
          onClose();
        }
      } else if (e.button === 1 || e.button === 2) {
        // MMB + RMB both close — MMB symmetry with the canvas handler
        // means the user can toggle the menu from the menu itself when
        // pointer-locked (the virtual cursor lives inside the SVG).
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('mousedown', handleGlobalMouseDown, { capture: true });
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown, { capture: true });
    // The held-tab callbacks + heldAssetType are intentionally included
    // here: triggerSliceAction is rebuilt every render and references
    // them, so without these in the dep array a user opening the menu
    // while holding a misc file and then dropping the file would still
    // see the (now-stale) "Download" bottom slice — clicking it would
    // no-op. Cheap to add (each is a stable useCallback ref or a
    // state read that only mutates on grab-begin / grab-end).
  }, [isOpen, isLocked, activeIndex, activeTab, onClose, locomotionMode, grabMode, scalingEnabled, laserEnabled, onSetLocomotionMode, onSetGrabMode, onToggleScaling, onToggleLaser, onUndo, onRedo, onSaveHeld, onDuplicate, onDestroy, onDownloadHeld, heldAssetType]);

  if (!isOpen) return null;

  // Keep menu on screen
  const menuLeft = Math.min(Math.max(position.x - 180, 20), window.innerWidth - 380);
  const menuTop = Math.min(Math.max(position.y - 180, 20), window.innerHeight - 380);

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-auto select-none flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in font-['Outfit',sans-serif]"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <div
        style={{ position: 'absolute', width: '360px', height: '360px', left: `${menuLeft}px`, top: `${menuTop}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow backdrop behind the ring */}
        <div className="absolute inset-4 rounded-full bg-gradient-to-tr from-cyan-500/10 via-amber-500/10 to-rose-500/10 blur-2xl pointer-events-none animate-pulse" />

        <svg width="360" height="360" viewBox="0 0 360 360" className="overflow-visible">
          {slices.map((slice, i) => {
            const pathD = getArcPath(cx, cy, rIn, rOut, slice.start, slice.end);
            const center = getSliceCenter(cx, cy, rIn, rOut, slice.start, slice.end);
            const isHovered = activeIndex === i;

            // Determine colors and actions per slice and tab
            let strokeColor = '#525252'; // default gray
            let filterStyle = '';
            let iconElement: React.ReactNode = null;
            let onClickAction = () => {};

            if (slice.id === 'top') {
              strokeColor = isMuted ? '#ef4444' : '#10b981';
              filterStyle = isMuted ? 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.45))' : 'drop-shadow(0 0 10px rgba(16, 185, 129, 0.45))';
              iconElement = isMuted ? <MicOff className="w-6 h-6 text-rose-400" /> : <Mic className="w-6 h-6 text-emerald-400" />;
              onClickAction = () => { onToggleMute?.(); onClose(); };
            } else if (slice.id === 'undo') {
              strokeColor = isHovered ? '#a3a3a3' : '#525252';
              iconElement = <Undo2 className="w-6 h-6 text-slate-300" />;
              onClickAction = () => { onUndo?.(); onClose(); };
            } else if (slice.id === 'redo') {
              strokeColor = isHovered ? '#a3a3a3' : '#525252';
              iconElement = <Redo2 className="w-6 h-6 text-slate-300" />;
              onClickAction = () => { onRedo?.(); onClose(); };
            } else if (activeTab === 'general') {
              if (slice.id === 'right') {
                // Locomotion (Yellow in Resonite)
                strokeColor = '#facc15';
                filterStyle = 'drop-shadow(0 0 10px rgba(250, 204, 21, 0.45))';
                iconElement =
                  locomotionMode === 'walk' ? <Footprints className="w-6 h-6 text-amber-400" /> :
                  locomotionMode === 'flight' ? <Plane className="w-6 h-6 text-amber-400" /> :
                  <Ghost className="w-6 h-6 text-amber-400" />;
                onClickAction = handleNextLocomotion;
              } else if (slice.id === 'bottom') {
                // Scaling (Red when disabled, Green when enabled)
                strokeColor = scalingEnabled ? '#10b981' : '#ef4444';
                filterStyle = scalingEnabled
                  ? 'drop-shadow(0 0 10px rgba(16, 185, 129, 0.45))'
                  : 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.45))';
                iconElement = scalingEnabled ? (
                  <Maximize className="w-6 h-6 text-emerald-400" />
                ) : (
                  <Minimize className="w-6 h-6 text-rose-400" />
                );
                onClickAction = onToggleScaling;
              } else if (slice.id === 'left') {
                // Laser (White in Resonite)
                strokeColor = laserEnabled ? '#ffffff' : '#94a3b8';
                filterStyle = laserEnabled ? 'drop-shadow(0 0 10px rgba(255, 255, 255, 0.45))' : '';
                iconElement = <Compass className={`w-6 h-6 ${laserEnabled ? 'text-white' : 'text-slate-400'}`} />;
                onClickAction = onToggleLaser;
              }
            } else if (activeTab === 'held') {
              // Held Tab Slices (only reachable when isHeld === true).
              // Save Held / Duplicate-or-Download / Destroy. Undo/Redo
              // slices above keep their action — they apply to any state.
              // The middle slice is type-conditional: for misc files it
              // becomes "Download" (the only type that meaningfully
              // exports raw bytes to disk), for everything else it keeps
              // the original "Duplicate" verb. Cyan for both so the
              // visual hierarchy is preserved — only the icon + tooltip
              // flip.
              if (slice.id === 'right') {
                // Save Held (BookmarkPlus, amber = "save / store")
                strokeColor = '#f59e0b';
                filterStyle = 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.45))';
                iconElement = <BookmarkPlus className="w-6 h-6 text-amber-400" />;
                onClickAction = () => { onSaveHeld?.(); onClose(); };
              } else if (slice.id === 'bottom') {
                strokeColor = '#06b6d4';
                filterStyle = 'drop-shadow(0 0 10px rgba(6, 182, 212, 0.45))';
                if (heldAssetType === 'misc') {
                  // Download (Download, cyan = "export to device")
                  iconElement = <Download className="w-6 h-6 text-cyan-400" />;
                  onClickAction = () => { onDownloadHeld?.(); onClose(); };
                } else {
                  // Duplicate (Copy, cyan = "create another")
                  iconElement = <Copy className="w-6 h-6 text-cyan-400" />;
                  onClickAction = () => { onDuplicate?.(); onClose(); };
                }
              } else if (slice.id === 'left') {
                // Destroy (Trash2, rose = "destructive")
                strokeColor = '#ef4444';
                filterStyle = 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.45))';
                iconElement = <Trash2 className="w-6 h-6 text-rose-400" />;
                onClickAction = () => { onDestroy?.(); onClose(); };
              }
            } else {
              // Grab Tab Slices
              if (slice.id === 'right') {
                strokeColor = '#f59e0b';
                filterStyle = 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.45))';
                iconElement =
                  grabMode === 'auto' ? <Sparkles className="w-6 h-6 text-amber-400" /> :
                  grabMode === 'precision' ? <Crosshair className="w-6 h-6 text-amber-400" /> :
                  grabMode === 'palm' ? <Hand className="w-6 h-6 text-amber-400" /> :
                  <Compass className="w-6 h-6 text-rose-400" />;
                onClickAction = handleNextGrabMode;
              } else if (slice.id === 'bottom') {
                strokeColor = '#06b6d4';
                filterStyle = 'drop-shadow(0 0 10px rgba(6, 182, 212, 0.45))';
                iconElement = <Grid className="w-6 h-6 text-cyan-400" />;
                onClickAction = () => { /* grid toggle */ onClose(); };
              } else if (slice.id === 'left') {
                strokeColor = '#a855f7';
                filterStyle = 'drop-shadow(0 0 10px rgba(168, 85, 247, 0.45))';
                iconElement = <Shield className="w-6 h-6 text-purple-400" />;
                onClickAction = () => { /* collision toggle */ onClose(); };
              }
            }

            if (!isHovered) filterStyle = '';

            return (
              <g
                key={slice.id}
                className="cursor-pointer group"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={onClickAction}
              >
                {/* Sector Background & Border */}
                <path
                  d={pathD}
                  fill={isHovered ? '#404040' : '#262626'}
                  stroke={strokeColor}
                  strokeWidth={isHovered ? '5' : '3'}
                  strokeLinejoin="round"
                  style={{ filter: filterStyle, transition: 'all 0.15s ease' }}
                />
                {/* Centered Icon inside slice */}
                <g transform={`translate(${center.x}, ${center.y})`} className="pointer-events-none">
                  <g transform="translate(-12, -12)">
                    {iconElement}
                  </g>
                </g>
              </g>
            );
          })}

          {/* Center Hub Button (Radius 36px) */}
          <g
            className="cursor-pointer group"
            onClick={() => {
              setActiveTab((prev) => {
                if (isHeld) {
                  if (prev === 'general') return 'grab';
                  if (prev === 'grab') return 'held';
                  return 'general';
                }
                return prev === 'general' ? 'grab' : 'general';
              });
            }}
          >
            <circle
              cx={cx}
              cy={cy}
              r="36"
              fill={activeIndex === -1 ? '#262626' : '#171717'}
              stroke={isHeld ? '#f59e0b' : '#00f0ff'}
              strokeWidth={activeIndex === -1 ? '3.5' : '2.5'}
              className="transition-colors"
              style={{ filter: isHeld
                ? 'drop-shadow(0 0 12px rgba(245, 158, 11, 0.55))'
                : 'drop-shadow(0 0 12px rgba(0, 240, 255, 0.5))' }}
            />
            {/* Center Logo / Icon */}
            <g transform={`translate(${cx - 10}, ${cy - 14})`} className="pointer-events-none">
              <Sparkles className="w-5 h-5 text-cyan-400 group-hover:rotate-45 transition-transform duration-300" />
            </g>
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              fill="#00f0ff"
              className="text-[9px] font-black tracking-widest uppercase pointer-events-none"
            >
              {activeTab === 'general' ? 'MENU' : activeTab === 'grab' ? 'GRAB' : 'HELD'}
            </text>
          </g>

          {/* Virtual Cursor Dot for locked / first-person mode */}
          {isLocked && (
            <g transform={`translate(${virtualCursor.x}, ${virtualCursor.y})`} className="pointer-events-none">
              <circle
                r="6"
                fill="#00f0ff"
                stroke="#ffffff"
                strokeWidth="2"
                style={{ filter: 'drop-shadow(0 0 6px rgba(0, 240, 255, 0.9))' }}
              />
              <circle r="2" fill="#ffffff" />
            </g>
          )}
        </svg>

        {/* OUTSIDE LABELS — positioned pointing outward from each sector like Resonite */}
        {/* Top-Left: Undo */}
        <div style={{ position: 'absolute', top: '35px', left: '10px', textAlign: 'right', pointerEvents: 'none' }}>
          <span className="text-sm font-bold text-slate-200 tracking-wide drop-shadow-md">Undo</span>
        </div>

        {/* Top-Right: Redo */}
        <div style={{ position: 'absolute', top: '35px', right: '10px', textAlign: 'left', pointerEvents: 'none' }}>
          <span className="text-sm font-bold text-slate-200 tracking-wide drop-shadow-md">Redo</span>
        </div>

        {/* Right Slice Label */}
        <div style={{ position: 'absolute', top: '135px', left: '295px', textAlign: 'left', pointerEvents: 'none', lineHeight: '1.3', whiteSpace: 'pre-line' }}>
          {activeTab === 'general' ? (
            <span className="text-xs font-bold text-white drop-shadow-md">
              {"Locomotion\n"}
              <span className="text-[11px] font-normal text-slate-300">
                {locomotionMode === 'walk' ? 'Walk/Run (with\nclimbing)' :
                 locomotionMode === 'flight' ? 'Flight mode\n(free-fly)' :
                 'Noclip mode\n(no collision)'}
              </span>
            </span>
          ) : activeTab === 'held' ? (
            <span className="text-xs font-bold text-amber-400 drop-shadow-md">
              {"Save Held\n"}
              <span className="text-[11px] font-normal text-slate-200">
                Add to your inventory
              </span>
            </span>
          ) : (
            <span className="text-xs font-bold text-amber-400 drop-shadow-md">
              {"Grab Mode\n"}
              <span className="text-[11px] font-normal text-slate-200 uppercase">
                {grabMode}
              </span>
            </span>
          )}
        </div>

        {/* Bottom Slice Label */}
        <div style={{ position: 'absolute', top: '295px', left: '180px', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none', lineHeight: '1.3' }}>
          {activeTab === 'general' ? (
            <span className="text-xs font-bold text-white drop-shadow-md">
              {"Scaling\n"}
              <span className={`text-[11px] font-semibold ${scalingEnabled ? 'text-emerald-400' : 'text-rose-400'}`}>
                {scalingEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </span>
          ) : activeTab === 'held' ? (
            heldAssetType === 'misc' ? (
              <span className="text-xs font-bold text-cyan-400 drop-shadow-md">
                {"Download\n"}
                <span className="text-[11px] font-normal text-slate-200">
                  Save to your device
                </span>
              </span>
            ) : (
              <span className="text-xs font-bold text-cyan-400 drop-shadow-md">
                {"Duplicate\n"}
                <span className="text-[11px] font-normal text-slate-200">
                  Make a copy
                </span>
              </span>
            )
          ) : (
            <span className="text-xs font-bold text-cyan-400 drop-shadow-md">
              {"Snap Grid\n"}
              <span className="text-[11px] font-normal text-slate-300">Toggle</span>
            </span>
          )}
        </div>

        {/* Bottom-Left Slice Label */}
        <div style={{ position: 'absolute', top: '215px', right: '295px', textAlign: 'right', pointerEvents: 'none', lineHeight: '1.3', whiteSpace: 'pre-line' }}>
          {activeTab === 'general' ? (
            <span className="text-xs font-bold text-white drop-shadow-md">
              {"Laser\n"}
              <span className={`text-[11px] font-semibold ${laserEnabled ? 'text-cyan-400' : 'text-slate-400'}`}>
                {laserEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </span>
          ) : activeTab === 'held' ? (
            <span className="text-xs font-bold text-rose-400 drop-shadow-md">
              {"Destroy\n"}
              <span className="text-[11px] font-normal text-slate-200">
                Remove from world
              </span>
            </span>
          ) : (
            <span className="text-xs font-bold text-purple-400 drop-shadow-md">
              {"Collision\n"}
              <span className="text-[11px] font-normal text-slate-300">Toggle</span>
            </span>
          )}
        </div>

        {/* Close Button at top right corner */}
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '-24px', right: '-24px', backgroundColor: '#1e293b', color: '#cbd5e1', padding: '8px', borderRadius: '9999px', border: '1px solid #475569', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}
          title="Close Menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom helper pill */}
      <div style={{ position: 'absolute', bottom: '24px', backgroundColor: 'rgba(2, 6, 23, 0.85)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '6px 16px', borderRadius: '9999px', fontSize: '11px', color: '#cbd5e1', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="text-cyan-400 font-bold">Resonite Menu:</span>
        <span>Click center circle to switch between General & Grab options.</span>
      </div>
    </div>
  );
};
