#!/usr/bin/env python3
"""
Add a persistent VideoControls HUD in App.tsx so video playback controls
are accessible WITHOUT opening the inspector. Renders at top-center of the
canvas whenever `selectedAsset?.type === 'video'` regardless of inspector
state. Reuses the existing VideoControls component (compact={true}) and
the existing handleVideoAction / handleDeleteSelected wiring.

Edit 1: import statement — add `VideoControls` import after SceneInspectorWindow.
Edit 2: JSX injection — insert the persistent HUD block right after `<Toolbar />`
         so it sits with the other absolute-positioned overlays.
"""
import sys

PATH = 'App.tsx'
ALT = 'src/App.tsx'

def pick_path():
    for p in (PATH, ALT):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                f.read(1)
            return p
        except FileNotFoundError:
            continue
    raise SystemExit('App.tsx not found in either location')

path = pick_path()
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ---------- Edit 1: import ----------
old_imp = "import { SceneInspectorWindow } from './components/SceneInspectorWindow.tsx';"
new_imp = (
    old_imp + "\n"
    "import { VideoControls } from './components/VideoControls.tsx';\n"
    "import type { VideoPlaybackState } from './engine/AssetManager.ts';"
)
if old_imp not in src:
    print(f'FATAL: import anchor not found in {path}', file=sys.stderr)
    sys.exit(1)
if 'import { VideoControls }' in src:
    print('VideoControls import already present; skipping Edit 1')
else:
    src = src.replace(old_imp, new_imp, 1)

# ---------- Edit 2: persistent HUD JSX ----------
# Inject right after the standalone <Toolbar /> JSX expression. This
# keeps the new overlay grouped with the other absolute-positioned
# UI overlays (Toolbar, locomotion banners, scene inspector window, etc.)
# rather than buried inside another modal's JSX block.
HUD_JSX = '''
      {/* Persistent Video Controls HUD — visible whenever a video is selected,
          regardless of inspector / modal state, so playback controls are
          always one click away. Sits at top-center to mirror typical
          media-player chrome position. Uses VideoControls with
          compact={true} so the panel chrome matches the inspector's
          video-card style. The X (icon inside VideoControls non-compact,
          plus our inline header X for compact) calls handleDeleteSelected
          which removes the asset — selectedAsset becomes null and the
          HUD disappears. */}
      {selectedAsset?.type === 'video' && selectedAsset.videoElement && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 w-[520px] max-w-[92vw] pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-start gap-2">
            {/* Inline compact header with a close button — VideoControls
                compact mode hides its own header so the caller is
                expected to provide one. */}
            <div className="flex flex-col gap-1.5 mt-2">
              <button
                onClick={() => handleDeleteSelected()}
                title="Remove video from world (X)"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition border border-slate-700 hover:border-rose-500/40 shadow-md"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <span className="text-[9px] font-mono font-bold text-fuchsia-300 uppercase tracking-wider text-center">V</span>
            </div>
            <div className="flex-1 min-w-0">
              <VideoControls
                compact={true}
                state={((selectedAsset.object3d.userData as { videoState?: VideoPlaybackState })?.videoState) ?? {
                  playing: false,
                  currentTime: 0,
                  duration: 0,
                  globalVolume: 0.8,
                  localVolume: 0.8,
                  volumeMode: 'global',
                  muted: true,
                }}
                onPlay={() => handleVideoAction(selectedAsset.id, 'play')}
                onPause={() => handleVideoAction(selectedAsset.id, 'pause')}
                onSeek={(t) => handleVideoAction(selectedAsset.id, 'seek', t)}
                onStep={(d) => handleVideoAction(selectedAsset.id, 'step', d)}
                onVolumeChange={(v) => handleVideoAction(selectedAsset.id, 'volume', v)}
                onVolumeModeToggle={(m) => handleVideoAction(selectedAsset.id, 'volumeMode', m)}
                onMuteToggle={() => handleVideoAction(selectedAsset.id, 'mute')}
                onClose={() => handleDeleteSelected()}
              />
            </div>
          </div>
        </div>
      )}
'''

# Anchor: standalone `<Toolbar />` JSX expression. The codebase uses
# this pattern (no children, props passed inline) for the Toolbar so
# this exact string appears verbatim in JSX.
ANCHOR = '<Toolbar />'
if ANCHOR not in src:
    print(f'FATAL: anchor {ANCHOR!r} not found; cannot insert HUD', file=sys.stderr)
    sys.exit(1)
if 'Persistent Video Controls HUD' in src:
    print('HUD JSX already present; skipping Edit 2')
else:
    src = src.replace(ANCHOR + '\n', ANCHOR + '\n' + HUD_JSX, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print(f'OK: wrote {path}')
