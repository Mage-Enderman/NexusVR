path = 'src/components/RadialContextMenu.tsx'

def apply(old, new, label):
    global src
    if old not in src:
        print(f'WARN: {label} not found, skipping')
        return False
    src = src.replace(old, new, 1)
    return True

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# 1) Imports
apply(
"""import {
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
  X
} from 'lucide-react';""",
"""import {
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
  BookmarkPlus
} from 'lucide-react';""",
'imp1')

# 2) Props
apply(
"""  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  onSetGrabMode: (mode: 'auto' | 'precision' | 'palm' | 'laser') => void;
  onUndo?: () => void;
  onRedo?: () => void;
}""",
"""  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  onSetGrabMode: (mode: 'auto' | 'precision' | 'palm' | 'laser') => void;
  onUndo?: () => void;
  onRedo?: () => void;
  // 'held' tab — only reachable when isHeld is true. Mirrors the
  // 'held' radial tab in the VR 3D radial panel so the desktop and
  // VR UIs expose the same act-on-the-held-object verbs.
  isHeld?: boolean;
  onDestroy?: () => void;
  onDuplicate?: () => void;
  onSaveHeld?: () => void;
}""",
'imp2')

# 3) Destructure
apply(
"""  onUndo,
  onRedo
}) => {""",
"""  onUndo,
  onRedo,
  isHeld = false,
  onDestroy,
  onDuplicate,
  onSaveHeld
}) => {""",
'imp3')

# 4) State + auto-switch effect
apply(
"""  const [activeTab, setActiveTab] = useState<'general' | 'grab'>('general');""",
"""  // 'held' is a third tab only reachable when isHeld is true. The hub
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
  }, [isOpen, isHeld]);""",
'imp4')

# 5) Hub onClick (3-way cycle)
apply(
"""          {/* Center Hub Button (Radius 36px) */}
          <g
            className="cursor-pointer group"
            onClick={() => setActiveTab(activeTab === 'general' ? 'grab' : 'general')}
          >""",
"""          {/* Center Hub Button (Radius 36px) */}
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
          >""",
'imp5')

# 6) triggerSliceAction — add 'held' branches
apply(
"""  const triggerSliceAction = (index: number) => {
    const slice = slices[index];
    if (!slice) return;
    if (slice.id === 'undo') { onUndo?.(); onClose(); }
    else if (slice.id === 'redo') { onRedo?.(); onClose(); }
    else if (slice.id === 'right') {
      if (activeTab === 'general') handleNextLocomotion();
      else handleNextGrabMode();
    }
    else if (slice.id === 'bottom') {
      if (activeTab === 'general') onToggleScaling();
      else { onClose(); }
    }
    else if (slice.id === 'left') {
      if (activeTab === 'general') onToggleLaser();
      else { onClose(); }
    }
  };""",
"""  const triggerSliceAction = (index: number) => {
    const slice = slices[index];
    if (!slice) return;
    if (slice.id === 'undo') { onUndo?.(); onClose(); }
    else if (slice.id === 'redo') { onRedo?.(); onClose(); }
    else if (slice.id === 'right') {
      if (activeTab === 'general') handleNextLocomotion();
      else if (activeTab === 'held') { onSaveHeld?.(); onClose(); }
      else handleNextGrabMode();
    }
    else if (slice.id === 'bottom') {
      if (activeTab === 'general') onToggleScaling();
      else if (activeTab === 'held') { onDuplicate?.(); onClose(); }
      else { onClose(); }
    }
    else if (slice.id === 'left') {
      if (activeTab === 'general') onToggleLaser();
      else if (activeTab === 'held') { onDestroy?.(); onClose(); }
      else { onClose(); }
    }
  };""",
'imp6')

# 7) Hub circle stroke + filter (use just the stroke line for precision)
apply(
'              stroke="#00f0ff"',
"""              stroke={isHeld ? '#f59e0b' : '#00f0ff'}""",
'imp7-stroke')

apply(
"              style={{ filter: 'drop-shadow(0 0 12px rgba(0, 240, 255, 0.5))' }}",
"""              style={{ filter: isHeld
                ? 'drop-shadow(0 0 12px rgba(245, 158, 11, 0.55))'
                : 'drop-shadow(0 0 12px rgba(0, 240, 255, 0.5))' }}""",
'imp7-filter')

# 8) Hub text label
apply(
"              {activeTab === 'general' ? 'MENU' : 'GRAB'}",
"""              {activeTab === 'general' ? 'MENU' : activeTab === 'grab' ? 'GRAB' : 'HELD'}""",
'imp8')

# 9) Add 'held' branch in the slice map (before the grab tab's else)
apply(
"""            } else {
              // Grab Tab Slices
              if (slice.id === 'right') {""",
"""            } else if (activeTab === 'held') {
              // Held Tab Slices (only reachable when isHeld === true).
              // Save Held / Duplicate / Destroy. Undo/Redo slices
              // above keep their action — they apply to any state.
              if (slice.id === 'right') {
                // Save Held (BookmarkPlus, amber = "save / store")
                strokeColor = '#f59e0b';
                filterStyle = 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.45))';
                iconElement = <BookmarkPlus className="w-6 h-6 text-amber-400" />;
                onClickAction = () => { onSaveHeld?.(); onClose(); };
              } else if (slice.id === 'bottom') {
                // Duplicate (Copy, cyan = "create another")
                strokeColor = '#06b6d4';
                filterStyle = 'drop-shadow(0 0 10px rgba(6, 182, 212, 0.45))';
                iconElement = <Copy className="w-6 h-6 text-cyan-400" />;
                onClickAction = () => { onDuplicate?.(); onClose(); };
              } else if (slice.id === 'left') {
                // Destroy (Trash2, rose = "destructive")
                strokeColor = '#ef4444';
                filterStyle = 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.45))';
                iconElement = <Trash2 className="w-6 h-6 text-rose-400" />;
                onClickAction = () => { onDestroy?.(); onClose(); };
              }
            } else {
              // Grab Tab Slices
              if (slice.id === 'right') {""",
'imp9')

# 10) Bottom pill text
apply(
"""        <span>Click center circle to switch between General &amp; Grab options.</span>""",
"""        <span>Click center circle to switch between General, Grab, and Held{isHeld ? ' (auto-shown when carrying)' : ''} options.</span>""",
'imp10')

# 11) Right outside label
apply(
"""          ) : (
            <span className="text-xs font-bold text-amber-400 drop-shadow-md">
              {\"Grab Mode\\n\"}
              <span className="text-[11px] font-normal text-slate-200 uppercase">
                {grabMode}
              </span>
            </span>
          )}""",
"""          ) : activeTab === 'held' ? (
            <span className="text-xs font-bold text-amber-400 drop-shadow-md">
              {\"Save Held\\n\"}
              <span className="text-[11px] font-normal text-slate-200">
                Add to your inventory
              </span>
            </span>
          ) : (
            <span className="text-xs font-bold text-amber-400 drop-shadow-md">
              {\"Grab Mode\\n\"}
              <span className="text-[11px] font-normal text-slate-200 uppercase">
                {grabMode}
              </span>
            </span>
          )}""",
'imp11')

# 12) Bottom outside label
apply(
"""          ) : (
            <span className="text-xs font-bold text-cyan-400 drop-shadow-md">
              {\"Snap Grid\\n\"}
              <span className=\"text-[11px] font-normal text-slate-300\">Toggle</span>
            </span>
          )}""",
"""          ) : activeTab === 'held' ? (
            <span className="text-xs font-bold text-cyan-400 drop-shadow-md">
              {\"Duplicate\\n\"}
              <span className=\"text-[11px] font-normal text-slate-200\">
                Make a copy
              </span>
            </span>
          ) : (
            <span className="text-xs font-bold text-cyan-400 drop-shadow-md">
              {\"Snap Grid\\n\"}
              <span className=\"text-[11px] font-normal text-slate-300\">Toggle</span>
            </span>
          )}""",
'imp12')

# 13) Left outside label
apply(
"""          ) : (
            <span className="text-xs font-bold text-purple-400 drop-shadow-md">
              {\"Collision\\n\"}
              <span className=\"text-[11px] font-normal text-slate-300\">Toggle</span>
            </span>
          )}""",
"""          ) : activeTab === 'held' ? (
            <span className="text-xs font-bold text-rose-400 drop-shadow-md">
              {\"Destroy\\n\"}
              <span className=\"text-[11px] font-normal text-slate-200\">
                Remove from world
              </span>
            </span>
          ) : (
            <span className="text-xs font-bold text-purple-400 drop-shadow-md">
              {\"Collision\\n\"}
              <span className=\"text-[11px] font-normal text-slate-300\">Toggle</span>
            </span>
          )}""",
'imp13')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('All patches written to RadialContextMenu.tsx')
