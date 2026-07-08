#!/usr/bin/env python3
"""
Add a persistent VideoControls HUD in App.tsx so video playback controls
are accessible WITHOUT opening the scene inspector.

Edit 1: VideoControls import after SceneInspectorWindow import.
Edit 2: HUD JSX block inserted right after toolbar sibling — the script
        finds '<Toolbar' (the unique opening) and walks forward to the
        first standalone '/>' line that closes that JSX expression,
        then inserts the HUD block + a blank line after it. This avoids
        having to know the exact prop list passed to Toolbar.
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
    raise SystemExit('App.tsx not found')

path = pick_path()
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ---- Edit 1: import ----
old_imp = "import { SceneInspectorWindow } from './components/SceneInspectorWindow.tsx';"
new_imp = (
    old_imp + "\n"
    "import { VideoControls } from './components/VideoControls.tsx';\n"
    "import type { VideoPlaybackState } from './engine/AssetManager.ts';"
)
if old_imp not in src:
    sys.exit('FATAL: SceneInspectorWindow import anchor not found')
if 'import { VideoControls }' in src:
    print('Edit 1: VideoControls import already present (skipped)')
else:
    src = src.replace(old_imp, new_imp, 1)
    print('Edit 1: VideoControls import inserted')

# ---- Edit 2: HUD JSX ----
HUD_JSX = '''
      {/* Persistent Video Controls HUD — visible whenever a video is selected,
          regardless of inspector / modal state, so playback controls are
          always one click away. Sits at top-center (top-20) to mirror
          typical media-player chrome. VideoControls compact={true} doesn't
          render its own header so we provide an inline close X. Pressing
          X (and the equivalent non-compact X if user ever flips it) calls
          handleDeleteSelected which removes the asset — selectedAsset
          becomes null and the HUD disappears automatically. */}
      {selectedAsset?.type === 'video' && selectedAsset.videoElement && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 w-[520px] max-w-[92vw] pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-start gap-2">
            <button
              onClick={() => handleDeleteSelected()}
              title="Remove video from world (X)"
              className="mt-2 p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition border border-slate-700 hover:border-rose-500/40 shadow-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
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

# Walk forward from '<Toolbar' to the matching '>' of the self-closing tag.
# Toolbar is the only JSX usage in App.tsx so '<Toolbar' is unique.
if 'Persistent Video Controls HUD' in src:
    print('Edit 2: HUD JSX already present (skipped)')
else:
    OPEN = '<Toolbar'
    CLOSE_TAG = '/>'  # Toolbar is rendered as a self-closing JSX expression
    start = src.find(OPEN)
    if start < 0:
        sys.exit('FATAL: <Toolbar anchor not found')
    close = src.find(CLOSE_TAG, start)
    if close < 0:
        sys.exit('FATAL: closing /> after <Toolbar not found')
    close_end = close + len(CLOSE_TAG)
    # Find the end of the line containing the closing '/>'
    eol = src.find('\n', close_end)
    if eol < 0:
        eol = len(src)
    insertion = eol + 1  # right after the newline that ends the Toolbar JSX line
    src = src[:insertion] + HUD_JSX + src[insertion:]
    print('Edit 2: persistent VideoControls HUD JSX injected after <Toolbar />')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print(f'OK: wrote {path}')
