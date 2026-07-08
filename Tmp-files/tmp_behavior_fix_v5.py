"""
V5 — clean rewrite anchored on the ORIGINAL App.tsx code (v4 had
anchors for v3 replacements that never wrote).

Plan (4 sequential edits):
1. Add `showRadialMenuRef` declaration near the existing
   `showRadialMenu` state (line 240 area).
2. Add a syncing useEffect for the ref mirror (sits alongside the
   other activeToolRef/cameraModeRef/locomotionModeRef syncers).
3. Replace the ORIGINAL `setShowRadialMenu(true)` MMB path with a
   toggle that reads the LIVE `showRadialMenuRef.current` (fixes the
   stale-closure stale-state-by-first-render-only bug the code review
   caught).
4. Replace BOTH `manipulationManagerRef.current?.selectAsset(newAsset)`
   occurrences with a guarded swap-if-held.

ASCII-only print() statements so cp1252 can't crash before f.write().
"""
import sys

path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()


def apply(name, old, new):
    if old not in src:
        print(f'ERROR: anchor for "{name}" not found', file=sys.stderr)
        print(f'  starts with: {old[:120]!r}', file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)


# --- 1. showRadialMenuRef declaration (with explanatory comment) ----------
src = apply(
    'showRadialMenuRef declaration',
    (
        '  const [showRadialMenu, setShowRadialMenu] = useState<boolean>(false);\n'
    ),
    (
        '  // Ref mirror of showRadialMenu. React-state-reading event\n'
        '  // handlers defined inside `[]`-deps useEffect closures\n'
        '  // (notably the engine-init\'s onCanvasAuxMouseDown and the\n'
        '  // radial menu\'s window-level capture-phase handler) would\n'
        '  // otherwise read the value as it existed on first render\n'
        '  // forever. Use this ref for any such reader to get the LIVE\n'
        '  // state. (See handleKeyDown\'s `plainPasteModeRef` and\n'
        '  // activeToolRef for the same pattern.)\n'
        '  const showRadialMenuRef = useRef<boolean>(false);\n'
        '  const [showRadialMenu, setShowRadialMenu] = useState<boolean>(false);\n'
    ),
)


# --- 2. Syncing useEffect placed next to the other sync effects ------------
src = apply(
    'showRadialMenuRef sync useEffect',
    (
        '  useEffect(() => {\n'
        '    locomotionModeRef.current = locomotionMode;\n'
        '  }, [locomotionMode]);\n'
    ),
    (
        '  useEffect(() => {\n'
        '    locomotionModeRef.current = locomotionMode;\n'
        '  }, [locomotionMode]);\n'
        '  // Sync the menu-open ref mirror so []-deps-closure handlers\n'
        '  // (onCanvasAuxMouseDown in particular) see the LIVE value\n'
        '  // when toggling via MMB.\n'
        '  useEffect(() => {\n'
        '    showRadialMenuRef.current = showRadialMenu;\n'
        '  }, [showRadialMenu]);\n'
    ),
)


# --- 3. onCanvasAuxMouseDown: MMB toggle via showRadialMenuRef ------------
# Anchor directly on the ORIGINAL code so v5 works regardless of any
# earlier failed-edit state of App.tsx (v3 / v4 had no incremental
# persistence).
src = apply(
    'onCanvasAuxMouseDown MMB toggle (ref-based)',
    (
        '      if (e.button === 1) {\n'
        '        e.preventDefault();\n'
        '        setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '        setShowRadialMenu(true);\n'
        '      } else if (e.button === 3 || e.button === 4) {\n'
    ),
    (
        '      if (e.button === 1) {\n'
        '        e.preventDefault();\n'
        '        // MMB toggles the radial menu (was always-open-only).\n'
        '        // Read the LIVE `showRadialMenuRef` mirror instead of\n'
        '        // the closed-over React state -- this handler is\n'
        '        // registered once inside the `[]`-deps engine-init\n'
        '        // effect, so the directly-read `showRadialMenu`\n'
        '        // would always see the initial `false`. The\n'
        '        // RadialContextMenu\'s window-capture mousedown\n'
        '        // handler fires FIRST when MMB is pressed over the\n'
        '        // menu backdrop, so the menu closes itself before\n'
        '        // this branch sees the click -- consistent UX.\n'
        '        if (showRadialMenuRef.current) {\n'
        '          setShowRadialMenu(false);\n'
        '        } else {\n'
        '          setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '          setShowRadialMenu(true);\n'
        '        }\n'
        '      } else if (e.button === 3 || e.button === 4) {\n'
    ),
)


# --- 4. Dual selectAsset -> guarded swap (2 occurrences) ------------------
ANCHOR = '      manipulationManagerRef.current?.selectAsset(newAsset);\n'
REPLACEMENT = (
    '      // Duplicate-while-holding: keep holding the DUPLICATE, not\n'
    '      // the original. swapGrabbedAsset atomically ends the current\n'
    '      // grab on `asset` and starts an equivalent grab on\n'
    '      // `newAsset` (same VR-side when applicable, cursor-anchored\n'
    '      // RMB-grab on desktop). No-op during a two-handed grab --\n'
    '      // that path would need the live grip world positions to\n'
    '      // re-establish the scale, which is intentionally out of\n'
    '      // scope here. Guard is always-true for the held-tab\n'
    '      // Duplicate verb (handleDuplicateHeld sets asset =\n'
    '      // grabbedAsset by construction) and only fires for\n'
    '      // handleDuplicateSelected when the selected asset happens\n'
    '      // to also be currently grabbed.\n'
    '      if (manipulationManagerRef.current?.grabbedAsset?.id === asset.id) {\n'
    '        manipulationManagerRef.current?.swapGrabbedAsset(newAsset);\n'
    '      } else {\n'
    '        manipulationManagerRef.current?.selectAsset(newAsset);\n'
    '      }\n'
)
count = src.count(ANCHOR)
if count != 2:
    print(f'ERROR: expected exactly 2 selectAsset(newAsset); occurrences; '
          f'found {count}', file=sys.stderr)
    sys.exit(1)
src = src.replace(ANCHOR, REPLACEMENT, 2)
print(f'  applied: selectAsset(newAsset) -> guarded swap (2 occurrences)')


with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('All App.tsx edits applied.')
