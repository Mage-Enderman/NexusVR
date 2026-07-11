import React, { useState, useEffect } from 'react';
import {
  Undo2,
  Redo2,
  Footprints,
  Plane,
  Ghost,
  Maximize,
  Minimize,
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
  MicOff,
  Sun,
  Zap,
  Lightbulb,
  Palette,
  EyeOff,
  PlusSquare,
  FileText,
  Move3d,
  Move,
  Target,
  BoxSelect,
  Box,
  CircleDot,
  Cylinder,
  Square
} from 'lucide-react';
import type { AssetType } from '../engine/AssetManager.ts';
import {
  buildActiveMenuItems,
  computeArcSlices,
  type ContextMenuItemDef,
  type ComputedArcSlice,
  type ContextMenuContext,
} from '../engine/ContextMenuManager.ts';

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
  heldAssetCustomItems?: ContextMenuItemDef[];
  onDestroy?: () => void;
  onDuplicate?: () => void;
  onSaveHeld?: () => void;
  onDownloadHeld?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  activeTool?: string | null;
  onSpawnPointLight?: () => void;
  onSpawnSpotLight?: () => void;
  onSpawnSunLight?: () => void;
  noShadows?: boolean;
  onToggleNoShadows?: () => void;
  lightColor?: string;
  onUnequipTool?: () => void;
  selectionMode?: 'single' | 'multi';
  onToggleSelectionMode?: () => void;
  onDeselectAll?: () => void;
  onOpenInspector?: () => void;
  gizmoMode?: 'translate' | 'rotate' | 'scale';
  onSetGizmoMode?: (mode: 'translate' | 'rotate' | 'scale') => void;
  gizmoSpace?: 'local' | 'world';
  onToggleGizmoSpace?: () => void;
  onSpawnPrimitive?: (type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane') => void;
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

function getSliceIcon(
  slice: ComputedArcSlice,
  locomotionMode: string,
  scalingEnabled: boolean,
  laserEnabled: boolean,
  _grabMode: string,
  isMuted: boolean,
  noShadows: boolean,
  _lightColor: string
): React.ReactNode {
  switch (slice.icon) {
    case 'mic':
      return isMuted ? <MicOff className="w-5 h-5 text-rose-400" /> : <Mic className="w-5 h-5 text-emerald-400" />;
    case 'undo':
    case 'back':
      return <Undo2 className="w-5 h-5 text-slate-300" />;
    case 'redo':
      return <Redo2 className="w-5 h-5 text-slate-300" />;
    case 'locomotion':
      return locomotionMode === 'walk' ? <Footprints className="w-5 h-5 text-amber-400" /> :
             locomotionMode === 'flight' ? <Plane className="w-5 h-5 text-amber-400" /> :
             <Ghost className="w-5 h-5 text-amber-400" />;
    case 'scaling':
      return scalingEnabled ? <Maximize className="w-5 h-5 text-emerald-400" /> : <Minimize className="w-5 h-5 text-rose-400" />;
    case 'laser':
      return <Crosshair className={`w-5 h-5 ${laserEnabled ? 'text-cyan-400' : 'text-slate-400'}`} />;
    case 'grab':
      return <Hand className="w-5 h-5 text-amber-400" />;
    case 'grid':
      return <Grid className="w-5 h-5 text-cyan-400" />;
    case 'shield':
      return <Shield className="w-5 h-5 text-purple-400" />;
    case 'bookmark':
      return <BookmarkPlus className="w-5 h-5 text-amber-400" />;
    case 'copy':
      return <Copy className="w-5 h-5 text-cyan-400" />;
    case 'download':
      return <Download className="w-5 h-5 text-cyan-400" />;
    case 'trash':
      return <Trash2 className="w-5 h-5 text-rose-400" />;
    case 'lightbulb':
      return <Lightbulb className="w-5 h-5 text-amber-400" />;
    case 'zap':
      return <Zap className="w-5 h-5 text-cyan-400" />;
    case 'sun':
      return <Sun className="w-5 h-5 text-white" />;
    case 'eyeoff':
      return <EyeOff className={`w-5 h-5 ${noShadows ? 'text-amber-400' : 'text-slate-400'}`} />;
    case 'palette':
      return <Palette className="w-5 h-5 text-cyan-400" />;
    case 'x':
      return <X className="w-5 h-5 text-slate-400" />;
    case 'create':
      return <PlusSquare className="w-5 h-5 text-emerald-400" />;
    case 'inspector':
      return <FileText className="w-5 h-5 text-white" />;
    case 'gizmo':
      return <Move3d className="w-5 h-5 text-emerald-400" />;
    case 'move':
      return <Move className="w-5 h-5 text-emerald-400" />;
    case 'selectionMode':
      return <Target className="w-5 h-5 text-fuchsia-400" />;
    case 'deselectAll':
      return <BoxSelect className="w-5 h-5 text-orange-400" />;
    case 'unequip':
      return <Hand className="w-5 h-5 text-white" />;
    case 'cube':
      return <Box className="w-5 h-5 text-cyan-400" />;
    case 'sphere':
      return <CircleDot className="w-5 h-5 text-cyan-400" />;
    case 'cylinder':
      return <Cylinder className="w-5 h-5 text-cyan-400" />;
    case 'plane':
      return <Square className="w-5 h-5 text-cyan-400" />;
    default:
      return <Sparkles className="w-5 h-5 text-cyan-400" />;
  }
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
  heldAssetCustomItems,
  onDestroy,
  onDuplicate,
  onSaveHeld,
  onDownloadHeld,
  isMuted = false,
  onToggleMute,
  activeTool = null,
  onSpawnPointLight,
  onSpawnSpotLight,
  onSpawnSunLight,
  noShadows = false,
  onToggleNoShadows,
  lightColor = '#00f0ff',
  onUnequipTool,
  selectionMode,
  onToggleSelectionMode,
  onDeselectAll,
  onOpenInspector,
  gizmoMode,
  onSetGizmoMode,
  gizmoSpace,
  onToggleGizmoSpace,
  onSpawnPrimitive,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'grab' | 'held' | 'light' | 'dev'>('general');
  const [menuStack, setMenuStack] = useState<ContextMenuItemDef[][]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setMenuStack([]);
    if (activeTool === 'dev') {
      setActiveTab('dev');
    } else if (activeTool === 'light') {
      setActiveTab('light');
    } else if (isHeld) {
      setActiveTab('held');
    } else {
      setActiveTab((prev) => (prev === 'held' || prev === 'light' || prev === 'dev' ? 'general' : prev));
    }
  }, [isOpen, isHeld, activeTool]);
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

  const context: ContextMenuContext = {
    locomotionMode,
    scalingEnabled,
    laserEnabled,
    grabMode,
    isHeld,
    heldAssetType: heldAssetType ? String(heldAssetType) : null,
    heldAssetCustomItems,
    isMuted,
    activeTool,
    noShadows,
    lightColor,
    onUndo,
    onRedo,
    onToggleMute,
    onNextLocomotion: handleNextLocomotion,
    onToggleScaling,
    onToggleLaser,
    onNextGrabMode: handleNextGrabMode,
    onSaveHeld,
    onDuplicate,
    onDownloadHeld,
    onDestroy,
    onSpawnPointLight,
    onSpawnSpotLight,
    onSpawnSunLight,
    onToggleNoShadows,
    onUnequipTool,
    selectionMode,
    onToggleSelectionMode,
    onDeselectAll,
    onOpenInspector,
    gizmoMode,
    onSetGizmoMode,
    gizmoSpace,
    onToggleGizmoSpace,
    onSpawnPrimitive,
  };

  const currentItems = menuStack.length > 0
    ? menuStack[menuStack.length - 1]
    : buildActiveMenuItems(context, activeTab);

  const slices = computeArcSlices(currentItems);
  const isLightMenu = activeTab === 'light' || activeTool === 'light';
  const isDevMenu = activeTab === 'dev' || activeTool === 'dev';

  const dx = virtualCursor.x - 180;
  const dy = virtualCursor.y - 180;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let computedHover: number | null = null;

  if (dist >= 36 && dist <= 160) {
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (
        (angleDeg >= s.startDeg && angleDeg <= s.endDeg) ||
        (angleDeg - 360 >= s.startDeg && angleDeg - 360 <= s.endDeg) ||
        (angleDeg + 360 >= s.startDeg && angleDeg + 360 <= s.endDeg)
      ) {
        computedHover = i;
        break;
      }
    }
  } else if (dist < 36) {
    computedHover = -1;
  }

  const activeIndex = hoveredIndex !== null ? hoveredIndex : (isLocked ? computedHover : null);

  const triggerSliceAction = (index: number) => {
    if (index === -1) {
      if (menuStack.length > 0) {
        setMenuStack(prev => prev.slice(0, -1));
        return;
      }
      setActiveTab(prev => (prev === 'general' ? 'grab' : 'general'));
      return;
    }
    const slice = slices[index];
    if (!slice) return;

    if (slice.id === '__back') {
      setMenuStack(prev => prev.slice(0, -1));
      return;
    }

    if (slice.submenu && slice.submenu.length > 0) {
      const submenuItems = [...slice.submenu];
      if (!submenuItems.some(i => i.id === '__back')) {
        submenuItems.push({
          id: '__back',
          label: 'Back',
          subLabel: 'Up one level',
          color: '#64748b',
          icon: 'back',
          closeOnClick: false,
        });
      }
      setMenuStack(prev => [...prev, submenuItems]);
      return;
    }

    if (slice.action) {
      slice.action();
    } else {
      switch (slice.id) {
        case 'mute':       onToggleMute?.(); break;
        case 'undo':       onUndo?.(); break;
        case 'redo':       onRedo?.(); break;
        case 'point':      onSpawnPointLight?.(); break;
        case 'spot':       onSpawnSpotLight?.(); break;
        case 'sun':        onSpawnSunLight?.(); break;
        case 'noshadows':  onToggleNoShadows?.(); break;
        case 'unequip':    onUnequipTool?.(); break;
        case 'locomotion': handleNextLocomotion(); break;
        case 'scaling':    onToggleScaling(); break;
        case 'laser':      onToggleLaser(); break;
        case 'save':       onSaveHeld?.(); break;
        case 'copy':
          if (heldAssetType === 'misc') onDownloadHeld?.();
          else onDuplicate?.();
          break;
        case 'destroy':    onDestroy?.(); break;
      }
    }

    if (slice.closeOnClick !== false) {
      onClose();
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
            const pathD = getArcPath(cx, cy, rIn, rOut, slice.startDeg, slice.endDeg);
            const center = getSliceCenter(cx, cy, rIn, rOut, slice.startDeg, slice.endDeg);
            const isHovered = activeIndex === i;
            const strokeColor = isHovered ? slice.color : `${slice.color}aa`;
            const filterStyle = isHovered ? `drop-shadow(0 0 10px ${slice.color}77)` : '';
            const iconElement = getSliceIcon(
              slice,
              locomotionMode,
              scalingEnabled,
              laserEnabled,
              grabMode,
              isMuted,
              noShadows,
              lightColor
            );

            return (
              <g
                key={slice.id}
                className="cursor-pointer group"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => triggerSliceAction(i)}
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
              {menuStack.length > 0 ? 'BACK' : isDevMenu ? 'DEV' : isLightMenu ? 'LIGHT' : activeTab === 'general' ? 'MENU' : activeTab === 'grab' ? 'GRAB' : 'HELD'}
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
        {slices.map((slice) => {
          const midDeg = (slice.startDeg + slice.endDeg) / 2;
          const midRad = (midDeg - 90) * (Math.PI / 180);
          const rLabel = 155;
          const labelX = 180 + rLabel * Math.cos(midRad);
          const labelY = 180 + rLabel * Math.sin(midRad);
          const textAlign = labelX < 150 ? 'right' : labelX > 210 ? 'left' : 'center';

          return (
            <div
              key={`label-${slice.id}`}
              style={{
                position: 'absolute',
                top: `${labelY - 14}px`,
                left: textAlign === 'center' ? `${labelX}px` : textAlign === 'right' ? undefined : `${labelX}px`,
                right: textAlign === 'right' ? `${360 - labelX}px` : undefined,
                transform: textAlign === 'center' ? 'translateX(-50%)' : undefined,
                textAlign,
                pointerEvents: 'none',
                lineHeight: '1.25',
              }}
            >
              <div className="text-xs font-bold tracking-wide drop-shadow-md" style={{ color: slice.color || '#e2e8f0' }}>
                {slice.label}
              </div>
              {(slice.subLabel || (slice.submenu && slice.submenu.length > 0)) && (
                <div className="text-[11px] font-normal text-slate-300 drop-shadow-md">
                  {slice.subLabel || '▸ Submenu'}
                </div>
              )}
            </div>
          );
        })}

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
