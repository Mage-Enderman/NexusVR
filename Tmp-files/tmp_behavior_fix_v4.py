"""
V4 — fixed.

v3 unicode-crashed on the `->` arrow character BEFORE writing the file
(no replacements persisted). This v4 uses ASCII-only print() strings
plus the showRadialMenuRef mirror pattern to actually fix the buggy
reviewer-flagged MMB toggle.

Plan (applied in order):

1. Add `showRadialMenuRef` + a syncing useEffect near the existing
   `showRadialMenu` state declaration (line 240 area).

2. Replace onCanvasAuxMouseDown MMB branch with a toggle that reads
   `showRadialMenuRef.current`. This fixes the stale-closure bug:
   `onCanvasAuxMouseDown` is defined inside the engine-init useEffect
   with `[]` deps, so its closure captures the React state value as
   it existed on first render. Reading the ref's `.current` always
   reflects the latest state because the ref's identity is stable.

3. Replace BOTH `manipulationManagerRef.current?.selectAsset(newAsset)`
   occurrences (one in handleDuplicateHeld.afterImport, one in
   handleDuplicateSelected.afterImport) with a guarded swap-if-held
   pattern.

The Python script uses ASCII-only print() to avoid cp1252 unicode
errors that silently abort BEFORE f.write().
"""
import sys

ASCII = '->'  # used in print() statements; replaces arrow chars

path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()


def apply(name, old, new):
    if old not in src:
        print(f'ERROR: anchor for "{name}" not found', file=sys.stderr)
        print(f'  starts with: {old[:120]!r}', file=sys.stderr)
        sys.exit(1)
    return src.replace(old, new, 1)


# --- 1. Add showRadialMenuRef + syncing useEffect -------------------------
# Mirror the existing pattern (activeToolRef, cameraModeRef,
# locomotionModeRef). Insert the ref declaration right BEFORE the
# showRadialMenu state so it stays grouped with the menu state.
src = apply(
    'showRadialMenuRef declaration',
    (
        '  const [showRadialMenu, setShowRadialMenu] = useState<boolean>(false);\n'
    ),
    (
        '  // Ref mirror of showRadialMenu so React-state-reading\n'
        '  // event handlers defined inside `[]`-deps useEffect closures\n'
        '  // (notably the engine-init\'s onCanvasAuxMouseDown and the\n'
        '  // radial menu\'s window-level capture-phase handler) read\n'
        '  // the FRESH value on every fire instead of the value as it\n'
        '  // existed on first render. Without this mirror, an MMB\n'
        '  // toggle inside onCanvasAuxMouseDown would always see the\n'
        '  // captured initial `false` and re-open the menu forever.\n'
        '  const showRadialMenuRef = useRef<boolean>(false);\n'
        '  const [showRadialMenu, setShowRadialMenu] = useState<boolean>(false);\n'
    ),
)

# Then add the syncing useEffect next to the other sync effects.
# Locate the pattern: three useEffect blocks for activeTool/cameraMode/
# locomotionMode are siblings. Append a fourth for showRadialMenu.
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
        '  // CRITICAL: keep the menu-open mirror in lockstep so any\n'
        '  // []-deps-closure handler reading showRadialMenuRef.current\n'
        '  // gets the live value, not a stale snapshot from first\n'
        '  // render. Specifically the engine-init\'s onCanvasAuxMouseDown\n'
        '  // uses this to implement MMB-toggling.\n'
        '  useEffect(() => {\n'
        '    showRadialMenuRef.current = showRadialMenu;\n'
        '  }, [showRadialMenu]);\n'
    ),
)


# --- 2. onCanvasAuxMouseDown: MMB toggle via showRadialMenuRef ------------
# Read the LIVE showRadialMenuRef.current instead of the stale `showRadialMenu`
# closure value. Back to a clean branch (no setState-in-setState).
src = apply(
    'onCanvasAuxMouseDown MMB toggle (ref-based)',
    (
        '        if (showRadialMenu) {\n'
        '          setShowRadialMenu(false);\n'
        '        } else {\n'
        '          setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '          setShowRadialMenu(true);\n'
        '        }\n'
    ),
    (
        '        // Read the LIVE ref-mirror instead of the closed-over\n'
        '        // `showRadialMenu` so we toggle correctly under rapid\n'
        '        // presses. The RadialContextMenu\'s window-capture\n'
        '        // mousedown handler fires FIRST when MMB is pressed\n'
        '        // over the menu backdrop, so the menu closes itself\n'
        '        // before this branch can run a stale re-open.\n'
        '        if (showRadialMenuRef.current) {\n'
        '          setShowRadialMenu(false);\n'
        '        } else {\n'
        '          setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '          setShowRadialMenu(true);\n'
        '        }\n'
    ),
)


# --- 3. Dual selectAsset -> guarded swap (2 occurrences) ------------------
# For both afterImport call sites: if the asset being duplicated is also
# currently grabbed (handleDuplicateHeld: always; handleDuplicateSelected:
# only when selected is also grabbed), swap onto the duplicate.
ANCHOR = '      manipulationManagerRef.current?.selectAsset(newAsset);\n'
REPLACEMENT = (
    '      // Duplicate-while-holding: keep holding the DUPLICATE, not\n'
    '      // the original. swapGrabbedAsset atomically ends the current\n'
    '      // grab on `asset` and starts an equivalent grab on\n'
    '      // `newAsset` (same VR-side when applicable, cursor-anchored\n'
    '      // RMB-grab on desktop). No-op during a two-handed grab --\n'
    '      // that path would need the live grip world positions to\n'
    '      // re-establish the scale, which is intentionally out of\n'
    '      // scope here. The guard is always-true for the held-tab\n'
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
    print(f'ERROR: expected exactly 2 occurrences of selectAsset(newAsset); '
          f'found {count}', file=sys.stderr)
    sys.exit(1)
src = src.replace(ANCHOR, REPLACEMENT, 2)
print(f'  applied: selectAsset(newAsset) {ASCII} guarded swap (2 occurrences)')


with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('All App.tsx edits applied.')
print('ASCII safe (no arrow chars in print() statements).')
