#!/usr/bin/env python3
"""
Patch App.tsx to wire the new in-world <VideoObjectControls>.

  Edit A — imports: react-dom, VideoObjectControls
  Edit B — state: videoControlPanels entry[] array
  Edit C — extend registerOnAssetAdded so videos get an in-world docked panel
  Edit D — registerOnAssetRemoved closure that destroys the panel + state
  Edit E — JSX portal render at the end of App's return statement

The script uses f-strings for blocks that need variable substitution.
Inside an f-string `{{` and `}}` escape to literal `{` / `}`. Any literal
`{` or `}` in the JSX / TS we want to inject MUST be doubled — otherwise
Python's f-string parser tries to evaluate the brace as code and SyntaxError.
"""
import sys

PICK_PATHS = ('App.tsx', 'src/App.tsx')
path = None
for p in PICK_PATHS:
    try:
        with open(p, 'r', encoding='utf-8') as f:
            f.read(1)
        path = p
        break
    except FileNotFoundError:
        continue
if path is None:
    sys.exit('App.tsx not found')

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ============================================================
# Edit A — imports
# ============================================================
react_anchor = "import React, { useEffect, useRef, useState, useCallback } from 'react';"
if react_anchor not in src:
    react_anchor = next((l for l in src.split('\n') if l.startswith('import React')), None)
if react_anchor is None:
    sys.exit('FATAL: no React import anchor found')

# Add ReactDOM import (only if not already present).
if "from 'react-dom'" in src or 'from "react-dom"' in src:
    print('Edit A1: react-dom import already present (skipped)')
else:
    src = src.replace(
        react_anchor,
        react_anchor + "\nimport ReactDOM from 'react-dom';",
        1
    )
    print('Edit A1: react-dom import added')

# Add VideoObjectControls import after the existing VideoControls import
# (added in the previous turn's persistent-HUD patch).
if "from './components/VideoObjectControls.tsx'" in src:
    print('Edit A2: VideoObjectControls import already present (skipped)')
else:
    vc_anchor = "import { VideoControls } from './components/VideoControls.tsx';"
    if vc_anchor in src:
        src = src.replace(
            vc_anchor,
            vc_anchor + "\nimport { VideoObjectControls } from './components/VideoObjectControls.tsx';",
            1
        )
        print('Edit A2: VideoObjectControls import added')
    else:
        print('WARN: VideoControls import anchor not found — Edit A2 skipped')

# ============================================================
# Edit B — state hook for video-control panels
# ============================================================
# NOTE: triple-quoted string uses NO f-string (no `{`/`}` substitutions), so we don't have to double-escape braces. But also keep the Python COMMENT outside the string, otherwise it leaks into App.tsx.
state_decl_prefix = (
    "\n  // Active in-world video-control panels. Each entry is one spatial\n"
    "  // panel docked under a video asset's object3d — the SpatialPanelManager\n"
    "  // takes care of the THREE.Group + DOM + HTMLMesh; we just need React\n"
    "  // state so the JSX portal render <VideoObjectControls> into the\n"
    "  // detached <div> container.\n"
    "  type VideoControlPanelEntry = {\n"
    "    assetId: string;\n"
    "    panelId: string;\n"
    "    container: HTMLDivElement;\n"
    "  };\n"
    "  const [videoControlPanels, setVideoControlPanels] = useState<VideoControlPanelEntry[]>([]);\n"
)
# Python-only comment (outside the string so it doesn't leak).
if 'VideoControlPanelEntry' in src:
    print('Edit B: video-control panel state already present (skipped)')
else:
    state_anchor = "  const [showImportModal, setShowImportModal] = useState<boolean>(false);"
    if state_anchor in src:
        src = src.replace(state_anchor, state_anchor + state_decl_prefix, 1)
        print('Edit B: video-control panel state inserted')
    else:
        # fallback: use chat/import/showToolsPanel/showSceneInspector
        fallback_anchor = "  const [showChatPanel, setShowChatPanel] = useState<boolean>(false);"
        if fallback_anchor in src:
            src = src.replace(fallback_anchor, fallback_anchor + state_decl_prefix, 1)
            print('Edit B (fallback): state inserted')
        else:
            sys.exit('FATAL: cannot find Edit B state anchor')

# ============================================================
# Edit C — extend registerOnAssetAdded
# ============================================================
edit_c_marker = 'PERSISTENT_VIDEO_CONTROLS_HOOK'
if edit_c_marker in src:
    print('Edit C: video-controls asset-add hook already present (skipped)')
else:
    c_anchor_marker = '// Loading-placeholder consumption: if a placeholder with this'
    if c_anchor_marker not in src:
        sys.exit('FATAL: cannot find Edit C anchor (placeholder consumption comment)')
    c_split_marker = "if (net.mode !== 'offline') {"
    if c_split_marker not in src:
        sys.exit('FATAL: cannot find Edit C net-mode anchor')
    # Plain triple-quoted string (no f-string), braces are literal.
    hook_c = (
        "\n      // PERSISTENT_VIDEO_CONTROLS_HOOK: dock an in-world video-controls panel\n"
        "      // under the freshly-added video asset. The panel's anchor is computed\n"
        "      // from the video's screen-plane height so it sits just below the frame\n"
        "      // regardless of aspect ratio (16:9 / 9:16 / 1:1 / 'auto' post-loadedmetadata).\n"
        "      // We add a new entry to React state so the JSX portal renders\n"
        "      // <VideoObjectControls> into the detached container on the next render.\n"
        "      if (asset.type === 'video' && asset.object3d && asset.videoElement && spatialPanelManagerRef.current) {\n"
        "        const domContainer = document.createElement('div');\n"
        "        domContainer.style.pointerEvents = 'auto';\n"
        "        const screenPlane = asset.object3d.children.find(c => c.geometry instanceof THREE.PlaneGeometry) as THREE.Object3D | undefined;\n"
        "        const screenH = (screenPlane?.geometry as THREE.PlaneGeometry | undefined)?.parameters?.height ?? 1.6875;\n"
        "        const panelId = `video-controls-${asset.id}`;\n"
        "        const se = sceneEngineRef.current;\n"
        "        if (!se) return;\n"
        "        const anchorOffset = new THREE.Vector3(0, -screenH / 2 - 0.05, 0.06);\n"
        "        spatialPanelManagerRef.current.createPanel(\n"
        "          panelId,\n"
        "          domContainer,\n"
        "          se.scene,\n"
        "          se.camera,\n"
        "          600, // cssWidth — wide enough to match HD-ish video widths\n"
        "          90,  // cssHeight — small bar; vertical layout keeps it tight\n"
        "          asset.object3d,\n"
        "          anchorOffset\n"
        "        );\n"
        "        setVideoControlPanels(prev => [...prev, { assetId: asset.id, panelId, container: domContainer }]);\n"
        "      }\n"
    )
    src = src.replace(c_split_marker, hook_c + "\n      " + c_split_marker, 1)
    print('Edit C: video-controls asset-add hook inserted')

# ============================================================
# Edit D — registerOnAssetRemoved handler
# ============================================================
d_marker = 'PERSISTENT_VIDEO_CONTROLS_REMOVE'
if d_marker in src:
    print('Edit D: registerOnAssetRemoved hook already present (skipped)')
else:
    d_anchor = "    disposers.push(net.onRemove((id) => {"
    if d_anchor not in src:
        sys.exit('FATAL: cannot find Edit D anchor')
    hook_d = (
        "\n    // PERSISTENT_VIDEO_CONTROLS_REMOVE: Asset-removed callback — clean up the\n"
        "    // docked video-controls panel (if any) so a peer who deletes a video\n"
        "    // triggers a clean local teardown. The panel's destroyPanel tears down\n"
        "    // the CSS3D / HTMLMesh / THREE.Group; the React state update drops the\n"
        "    // JSX portal entry on the next render.\n"
        "    disposers.push(assetManager.registerOnAssetRemoved((id) => {\n"
        "      const panelId = `video-controls-${id}`;\n"
        "      const spm = spatialPanelManagerRef.current;\n"
        "      if (spm && spm.getGroup(panelId)) {\n"
        "        spm.destroyPanel(panelId);\n"
        "      }\n"
        "      setVideoControlPanels(prev => prev.filter(p => p.assetId !== id));\n"
        "    }));\n"
    )
    src = src.replace(d_anchor, hook_d + d_anchor, 1)
    print('Edit D: registerOnAssetRemoved hook inserted')

# ============================================================
# Edit E — JSX render block for the portals
# ============================================================
e_marker = 'VIDEO_CONTROL_PORTAL_RENDER'
if e_marker in src:
    print('Edit E: JSX portal block already present (skipped)')
else:
    # Plain triple-quoted string with NO f-string substitution. Literal
    # `{` / `}` characters are kept verbatim inside the string. The JSX
    # braces in JS code are written as-is; Python leaves them alone
    # because the string isn't an f-string.
    portal_jsx = (
        "\n      <>\n"
        "        VIDEO_CONTROL_PORTAL_RENDER — render the React-side controls\n"
        "        into each spatial-panel container we created in the asset-added\n"
        "        hook. Mounting happens once per panel; callbacks route to the\n"
        "        existing handleVideoAction pipeline. The auto-AR resize in\n"
        "        AssetManager.loadVideo already updated the parent video's screen\n"
        "        height; we don't resize the dock-panel here.\n"
        "        {videoControlPanels.flatMap((p) => {\n"
        "          const asset = assetManagerRef.current?.assets.get(p.assetId);\n"
        "          if (!asset || asset.type !== 'video' || !asset.videoElement) return [];\n"
        "          return [ReactDOM.createPortal(\n"
        "            <VideoObjectControls\n"
        "              key={p.assetId}\n"
        "              state={((asset.object3d.userData as { videoState?: VideoPlaybackState }).videoState) ?? {\n"
        "                playing: false,\n"
        "                currentTime: 0,\n"
        "                duration: 0,\n"
        "                globalVolume: 0.8,\n"
        "                localVolume: 0.8,\n"
        "                volumeMode: 'global',\n"
        "                muted: true,\n"
        "              }}\n"
        "              onPlay={() => handleVideoAction(asset.id, 'play')}\n"
        "              onPause={() => handleVideoAction(asset.id, 'pause')}\n"
        "              onSeek={(t) => handleVideoAction(asset.id, 'seek', t)}\n"
        "              onStep={(d) => handleVideoAction(asset.id, 'step', d)}\n"
        "              onVolumeChange={(v) => handleVideoAction(asset.id, 'volume', v)}\n"
        "              onVolumeModeToggle={(m) => handleVideoAction(asset.id, 'volumeMode', m)}\n"
        "              onMuteToggle={() => handleVideoAction(asset.id, 'mute')}\n"
        "            />,\n"
        "            p.container\n"
        "          )];\n"
        "        })}\n"
        "      </>\n"
    )
    # Anchor: insert just before the closing of App's outer wrapper <div>.
    # The unique tail pattern `</div>` followed by the closing of the
    # return (`);`) then the closing of the arrow function body (`};`)
    # occurs EXACTLY once at the end of App.tsx. The portal block lands
    # INSIDE the outer <div> (so React renders it as a sibling of the
    # other UI elements) and BEFORE the closing fragment-closing div.
    e_anchor = "</div>\n  );\n};"
    if e_anchor in src:
        src = src.replace(e_anchor, portal_jsx + e_anchor, 1)
        print('Edit E: JSX portal block inserted inside App\'s outer div (tail anchor)')
    else:
        # Fallbacks for slightly different indentation:
        for alt in ("</div>\n  );\n};", "</div>\n );\n};", "</div>\n);\n};"):
            if alt in src:
                src = src.replace(alt, portal_jsx + alt, 1)
                print(f'Edit E (alt indent): JSX portal block inserted (anchor={alt!r})')
                break
        else:
            sys.exit('FATAL: cannot find Edit E anchor (App tail)')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print(f'OK: wrote {path}')
