import React, { useState } from 'react';
import { Undo2, Redo2, Footprints, Plane, Ghost, Maximize, Minimize, Compass, Hand, Crosshair, Sparkles, X, Layers } from 'lucide-react';

export interface RadialContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  // State handlers
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
}

/**
 * Resonite-style radial context menu.
 *
 * Layout: a 380×380 outer ring holding five slices (Undead, Redo,
 * Locomotion, Scaling, Laser) plus a center hub. Each slice is 120×80 with
 * a single ≤20px icon and one short scaled label so nearby slices don't
 * visually crowd each other. The Locomotion slice is pushed further out
 * (translate(70%, 0%)) so its icon doesn't sit on top of the Redo slice.
 */
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
  onRedo
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'grab'>('general');

  if (!isOpen) return null;

  const handleNextLocomotion = () => {
    const next: typeof locomotionMode =
      locomotionMode === 'walk' ? 'flight' :
      locomotionMode === 'flight' ? 'noclip' : 'walk';
    onSetLocomotionMode(next);
  };

  // Common slice styling — kept in one place so all slices feel uniform.
  // Icon (w-5/h-5) + single-line label is the minimum legible interior.
  const sliceBase =
    'absolute flex flex-col items-center justify-center gap-1.5 ' +
    'p-2 bg-slate-900/85 hover:bg-slate-800 ' +
    'border-2 border-slate-600 hover:border-cyan-400 ' +
    'text-slate-200 hover:text-cyan-300 ' +
    'transition-all duration-200 shadow-xl group select-none';
  const sliceLabel = 'text-[11px] font-semibold font-[\'Outfit\'] whitespace-nowrap leading-tight';

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-auto select-none flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <div
        className="relative w-[380px] h-[380px] flex items-center justify-center"
        style={{
          left: Math.min(Math.max(position.x - window.innerWidth / 2, -window.innerWidth / 2 + 200), window.innerWidth / 2 - 200),
          top: Math.min(Math.max(position.y - window.innerHeight / 2, -window.innerHeight / 2 + 200), window.innerHeight / 2 - 200),
        }}
        onClickCapture={(e) => {
          // Blur focused <button> after a slice click so a follow-up Space
          // doesn't re-fire the same slice (browsers fire click on the
          // focused <button> when Space is pressed). Without this, clicking
          // Locomotion and then tapping Space silently cycles the mode.
          if (e.target instanceof HTMLButtonElement) {
            e.target.blur();
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow backdrop */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-500/10 via-purple-500/10 to-emerald-500/10 blur-3xl pointer-events-none animate-pulse" />

        {activeTab === 'general' ? (
          <>
            {/* Slice 1: Undo (top-left) */}
            <button
              onClick={() => { onUndo?.(); onClose(); }}
              className={`${sliceBase} w-[120px] h-[80px] -top-1 -left-1 rounded-tl-[72px] rounded-br-[26px]`}
              style={{ transform: 'translate(-50%, -45%)' }}
            >
              <Undo2 className="w-5 h-5 group-hover:scale-110 transition-transform shrink-0" />
              <span className={sliceLabel}>Undo</span>
            </button>

            {/* Slice 2: Redo (top-right) */}
            <button
              onClick={() => { onRedo?.(); onClose(); }}
              className={`${sliceBase} w-[120px] h-[80px] -top-1 -right-1 rounded-tr-[72px] rounded-bl-[26px]`}
              style={{ transform: 'translate(50%, -45%)' }}
            >
              <Redo2 className="w-5 h-5 group-hover:scale-110 transition-transform shrink-0" />
              <span className={sliceLabel}>Redo</span>
            </button>

            {/* Slice 3: Locomotion (right-middle).
                Sized like the other slices (no sub-label) and pushed further
                right (translate(70%, 0%)) so it never overlaps Redo. */}
            <button
              onClick={handleNextLocomotion}
              title={
                locomotionMode === 'walk'  ? 'Walk / Jump mode' :
                locomotionMode === 'flight' ? 'Flight mode (free-fly)' :
                                             'Noclip (no collision)'
              }
              className={`${sliceBase} w-[120px] h-[80px] -right-2 rounded-r-[60px] rounded-l-[24px] border-amber-400 hover:border-amber-300 text-amber-300 hover:text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.25)]`}
              style={{ transform: 'translate(70%, 0%)' }}
            >
              {locomotionMode === 'walk'  && <Footprints className="w-5 h-5 group-hover:scale-110 transition-transform text-amber-400 shrink-0" />}
              {locomotionMode === 'flight' && <Plane     className="w-5 h-5 group-hover:scale-110 transition-transform text-cyan-400 shrink-0" />}
              {locomotionMode === 'noclip' && <Ghost    className="w-5 h-5 group-hover:scale-110 transition-transform text-purple-400 shrink-0" />}
              <span className={sliceLabel}>Locomotion</span>
            </button>

            {/* Slice 4: Scaling (bottom-right) */}
            <button
              onClick={onToggleScaling}
              className={`${sliceBase} w-[120px] h-[80px] -bottom-1 -right-1 rounded-br-[72px] rounded-tl-[26px] ${
                scalingEnabled
                  ? 'border-emerald-400 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.25)] hover:border-emerald-300 hover:text-emerald-200'
                  : 'border-rose-500 text-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.25)] hover:border-rose-400 hover:text-rose-300'
              }`}
              style={{ transform: 'translate(50%, 45%)' }}
            >
              {scalingEnabled
                ? <Maximize className="w-5 h-5 group-hover:scale-110 transition-transform text-emerald-400 shrink-0" />
                : <Minimize className="w-5 h-5 group-hover:scale-110 transition-transform text-rose-400 shrink-0" />}
              <span className={sliceLabel}>{scalingEnabled ? 'Scale On' : 'Scale Off'}</span>
            </button>

            {/* Slice 5: Laser Pointer (bottom-left) */}
            <button
              onClick={onToggleLaser}
              className={`${sliceBase} w-[120px] h-[80px] -bottom-1 -left-1 rounded-bl-[72px] rounded-tr-[26px] ${
                laserEnabled
                  ? 'border-cyan-400 text-cyan-300 shadow-[0_0_18px_rgba(6,182,212,0.25)] hover:border-cyan-300 hover:text-cyan-200'
                  : 'border-slate-500 text-slate-400 hover:border-slate-400 hover:text-slate-200'
              }`}
              style={{ transform: 'translate(-50%, 45%)' }}
            >
              <Compass className="w-5 h-5 group-hover:scale-110 transition-transform shrink-0" />
              <span className={sliceLabel}>{laserEnabled ? 'Laser On' : 'Laser Off'}</span>
            </button>
          </>
        ) : (
          <>
            {/* GRAB MODE SLICES — palm / precision / auto / laser only */}
            <button
              onClick={() => { onSetGrabMode('palm'); onClose(); }}
              className={`${sliceBase} w-[120px] h-[80px] -top-1 -left-1 rounded-tl-[72px] rounded-br-[26px] ${
                grabMode === 'palm' ? 'border-amber-400 text-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.35)] hover:border-amber-300 hover:text-amber-200' : ''
              }`}
              style={{ transform: 'translate(-50%, -45%)' }}
            >
              <Hand className="w-5 h-5 group-hover:scale-110 transition-transform shrink-0" />
              <span className={sliceLabel}>Palm</span>
            </button>

            <button
              onClick={() => { onSetGrabMode('precision'); onClose(); }}
              className={`${sliceBase} w-[120px] h-[80px] -top-1 -right-1 rounded-tr-[72px] rounded-bl-[26px] ${
                grabMode === 'precision' ? 'border-amber-400 text-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.35)] hover:border-amber-300 hover:text-amber-200' : ''
              }`}
              style={{ transform: 'translate(50%, -45%)' }}
            >
              <Crosshair className="w-5 h-5 group-hover:scale-110 transition-transform shrink-0" />
              <span className={sliceLabel}>Precision</span>
            </button>

            <button
              onClick={() => { onSetGrabMode('auto'); onClose(); }}
              className={`${sliceBase} w-[120px] h-[80px] -bottom-1 -right-1 rounded-br-[72px] rounded-tl-[26px] ${
                grabMode === 'auto' ? 'border-emerald-400 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.35)] hover:border-emerald-300 hover:text-emerald-200' : ''
              }`}
              style={{ transform: 'translate(50%, 45%)' }}
            >
              <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform text-emerald-400 shrink-0" />
              <span className={sliceLabel}>Auto</span>
            </button>

            <button
              onClick={() => { onSetGrabMode('laser'); onClose(); }}
              className={`${sliceBase} w-[120px] h-[80px] -bottom-1 -left-1 rounded-bl-[72px] rounded-tr-[26px] ${
                grabMode === 'laser' ? 'border-rose-500 text-rose-300 shadow-[0_0_18px_rgba(244,63,94,0.35)] hover:border-rose-400 hover:text-rose-200' : ''
              }`}
              style={{ transform: 'translate(-50%, 45%)' }}
            >
              <Compass className="w-5 h-5 group-hover:scale-110 transition-transform text-rose-400 shrink-0" />
              <span className={sliceLabel}>Laser</span>
            </button>
          </>
        )}

        {/* CENTER HUB BUTTON — slim 80×80 so surrounding slices keep their space */}
        <button
          onClick={() => setActiveTab(activeTab === 'general' ? 'grab' : 'general')}
          className="relative z-10 w-20 h-20 rounded-full bg-slate-950 hover:bg-slate-900 border-[3px] border-cyan-500 hover:border-cyan-300 text-white flex flex-col items-center justify-center shadow-[0_0_26px_rgba(6,182,212,0.45)] transition-all duration-300 hover:scale-105 group"
          title="Click to switch between General Menu & Grab Modes"
        >
          <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-400 flex items-center justify-center mb-1 group-hover:rotate-180 transition-transform duration-500">
            <Layers className="w-3.5 h-3.5 text-cyan-300" />
          </div>
          <span className="text-[10px] font-black tracking-wider uppercase text-cyan-200 whitespace-nowrap">
            {activeTab === 'general' ? 'General' : 'Grab'}
          </span>
          <span className="text-[8px] text-slate-400 font-bold whitespace-nowrap">Swap</span>
        </button>

        {/* Close X badge */}
        <button
          onClick={onClose}
          className="absolute -top-10 -right-2 bg-rose-500 hover:bg-rose-600 text-white p-1.5 rounded-full shadow-lg border border-rose-300 transition-transform hover:scale-110"
          title="Close Context Menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom helper tip */}
      <div className="absolute bottom-10 bg-slate-950/80 border border-white/10 px-4 py-2 rounded-full text-xs font-mono text-slate-300 shadow-xl flex items-center gap-2">
        <span className="text-cyan-400 font-bold">Resonite Context Menu:</span>
        <span>Right-click canvas or click center hub to switch between General & Grab pages.</span>
      </div>
    </div>
  );
};
