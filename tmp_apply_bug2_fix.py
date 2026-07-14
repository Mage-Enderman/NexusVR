"""Bug 2 fix: add the missing `panelstate` broadcast to App.tsx.

ROOT CAUSE: the in-place refactor of App.tsx replaced the
`openInspectorFromLocal` / `closeInspectorFromLocal` helpers with a
direct `setShowSceneInspector(true|false)` toggle. The old helpers
called `networkServiceRef.current.broadcastPanelState({action:'open',
panelId:'inspector', targetAssetId:...})` on every transition, and
peers' `onPanelState` handler (still wired) re-targeted their
`selectedAsset` to match. After the refactor:

  - showSceneInspector toggles via setShowSceneInspector at lines
    735, 3448, 4180, 4968, 5069, 5353
  - `broadcastPanelState` is NEVER called in App.tsx anymore
  - peers' inspector open/close state stays in sync with the host
    ONLY via a manual setState that's no longer triggered

So when the host opens the inspector on asset X (or changes
selection while the inspector is already open), peers see nothing.
Their inspector never opens, and even if it were open, they never
follow the host's re-selection.

Fix: add a useEffect at the spot where showSceneInspector is
declared (after the showSceneInspectorRef sync line). The effect
fires whenever `showSceneInspector` OR `selectedAsset?.id` changes,
broadcasting the current open/assetId state to peers. Peers' existing
`net.onPanelState` receive handler (around line 1877 in the
unrefactored file) auto-mirrors: action='open' calls
`setShowSceneInspector(true)` and re-targets `selectedAsset` to
`payload.targetAssetId`. The originator-echo check at the top of
the receive handler drops our own envelope, so the redundant broadcast
on initial mount is harmless.

Deps: [showSceneInspector, selectedAsset?.id]. Selecting a different
asset while the panel is open re-fires this effect, broadcasting
the new targetAssetId. Closing the inspector doesn't broadcast —
peers' mirrors stay open until they manually close, which is a
reasonable UX (peers might want to keep inspecting the same asset
even after the host closes).

We keep this simple by NOT broadcasting 'close' on local close.
The receive handler's close path becomes dead code on the wire but
is preserved for future use.
"""
from pathlib import Path

p = Path("src/App.tsx")
app = p.read_text(encoding="utf-8")

# Anchor: insert just after the showSceneInspectorRef sync line.
# Use the unique 3-line block that ties showSceneInspector to its
# ref. The ref sync is in a useState initial + useRef + ref.current =
# pattern unique to this region of App.tsx.
anchor = (
    "  const [showSceneInspector, setShowSceneInspector] = useState<boolean>(false);\n"
    "  // Ref so the canvas click handler can read the current value without\n"
    "  // being re-created every time showSceneInspector changes.\n"
    "  const showSceneInspectorRef = useRef(false);\n"
    "  showSceneInspectorRef.current = showSceneInspector;\n"
)
assert app.count(anchor) == 1, f"App.tsx showSceneInspectorRef anchor: expected 1 match, got {app.count(anchor)}"

insert_block = (
    "\n"
    "  // Bug fix — host→peer inspector object sync (Issue 2). The previous\n"
    "  // openInspectorFromLocal/closeInspectorFromLocal helpers used to call\n"
    "  // broadcastPanelState on every transition; an in-place refactor of\n"
    "  // App.tsx replaced those helpers with a direct setShowSceneInspector\n"
    "  // toggle and the panelstate broadcast was lost, so peers stopped\n"
    "  // mirroring the host's inspector open/close and selection state.\n"
    "  // This effect re-broadcasts on every showSceneInspector OR\n"
    "  // selectedAsset.id change so the host's inspector state propagates\n"
    "  // live. Receive handler's echo-suppression (drops envelopes whose\n"
    "  // originatorPeerId === localPeerId) makes the redundant broadcast on\n"
    "  // initial mount harmless apart from one envelope byte. We don't\n"
    "  // broadcast 'close' here — peers' mirrors stay open until they\n"
    "  // manually close, which is the gentler UX for the case where the\n"
    "  // host stops inspecting but a peer is still mid-edit.\n"
    "  useEffect(() => {\n"
    "    if (!showSceneInspector) return;\n"
    "    const ns = networkServiceRef.current;\n"
    "    if (!ns || ns.mode === 'offline') return;\n"
    "    ns.broadcastPanelState({\n"
    "      action: 'open',\n"
    "      panelId: 'inspector',\n"
    "      originatorPeerId: ns.localPeerId,\n"
    "      originatorUserName: userName,\n"
    "      originatorRole: localRole,\n"
    "      targetAssetId: selectedAsset?.id ?? null,\n"
    "      ts: Date.now(),\n"
    "    });\n"
    "  }, [showSceneInspector, selectedAsset?.id]);\n"
)

# Insert AFTER the anchor block — that means: anchor + insert.
# We split: keep the anchor exactly, then add the insert block after it.
new = app.replace(anchor, anchor + insert_block, 1)
p.write_text(new, encoding="utf-8")
print(f"OK app panelstate broadcast effect added (file_size_chars={len(new)})")
