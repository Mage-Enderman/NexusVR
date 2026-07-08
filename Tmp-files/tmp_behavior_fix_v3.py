"""
V3 — clean rewrite.

Strategy:
1. onCanvasAuxMouseDown: full-function replacement with cleaner MMB
   toggle (no setState-in-setState antipattern).
2. BOTH handleDuplicateHeld.afterImport and
   handleDuplicateSelected.afterImport call
   `manipulationManagerRef.current?.selectAsset(newAsset);` with
   identical surroundings, so we replace the literal expression in
   place using str.replace with count=2 (Python's replaceLast style).

   The replacement is a guarded swap-if-held: when the user is
   currently grabbing the asset being duplicated (which is
   always-true for handleDuplicateHeld, occasionally-true for
   handleDuplicateSelected), grab the duplicate instead.

   Removing the call to `selectAsset` is intentional — swapGrabbedAsset
   ALSO re-selects the asset by design: when the grab finishes, the
   asset is selected (and selectable) by the gizmo, so the user gets
   the same "select the duplicate" affordance either way. We just skip
   the redundant `selectAsset(newAsset)` in the held case.
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


# --- 1. onCanvasAuxMouseDown: clean MMB toggle -----------------------------
# Anchor verified matches the exact current file at lines 1409-1420.
src = apply(
    'onCanvasAuxMouseDown MMB toggle',
    (
        '    const onCanvasAuxMouseDown = (e: MouseEvent) => {\n'
        '      if (e.button === 1) {\n'
        '        e.preventDefault();\n'
        '        setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '        setShowRadialMenu(true);\n'
        '      } else if (e.button === 3 || e.button === 4) {\n'
        '        e.preventDefault();\n'
        '        if (activeToolRef.current === \'dev\') {\n'
        '          handleCenterRaySelect();\n'
        '        }\n'
        '      }\n'
        '    };\n'
    ),
    (
        '    const onCanvasAuxMouseDown = (e: MouseEvent) => {\n'
        '      if (e.button === 1) {\n'
        '        e.preventDefault();\n'
        '        // Middle-mouse toggles the radial menu: opens if closed,\n'
        '        // closes if open. The radial menu\'s window-level\n'
        '        // capture-phase mousedown handler (in\n'
        '        // RadialContextMenu.tsx) fires FIRST when MMB is pressed\n'
        '        // over the menu backdrop, so the menu closes itself\n'
        '        // before this branch can run a stale re-open. We use a\n'
        '        // clean branch on the current `showRadialMenu` value\n'
        '        // rather than a functional-setState updater — the\n'
        '        // latter would put `setRadialMenuPos` inside another\n'
        '        // setter\'s updater, which React 18 StrictMode would\n'
        '        // call twice in dev to surface purity violations.\n'
        '        if (showRadialMenu) {\n'
        '          setShowRadialMenu(false);\n'
        '        } else {\n'
        '          setRadialMenuPos({ x: e.clientX, y: e.clientY });\n'
        '          setShowRadialMenu(true);\n'
        '        }\n'
        '      } else if (e.button === 3 || e.button === 4) {\n'
        '        e.preventDefault();\n'
        '        if (activeToolRef.current === \'dev\') {\n'
        '          handleCenterRaySelect();\n'
        '        }\n'
        '      }\n'
        '    };\n'
    ),
)


# --- 2 + 3. swap-on-held for both afterImport paths ------------------------
# Both afterImport bodies contain the EXACT same line:
#     manipulationManagerRef.current?.selectAsset(newAsset);
# We use Python's replace with a count of 2 to substitute both — this
# is safe because there are no OTHER callers of selectAsset(newAsset).
# Verify count first as a safety check.
ANCHOR = '      manipulationManagerRef.current?.selectAsset(newAsset);\n'
REPLACEMENT = (
    '      // Duplicate-while-holding: keep holding the DUPLICATE, not\n'
    '      // the original. swapGrabbedAsset atomically ends the current\n'
    '      // grab on `asset` and starts an equivalent grab on\n'
    '      // `newAsset` (same VR-side when applicable, cursor-anchored\n'
    '      // RMB-grab on desktop). No-op during a two-handed grab —\n'
    '      // that path would need the live grip world positions to\n'
    '      // re-establish the scale, which is intentionally out of\n'
    '      // scope here. For the radial-menu held-tab path (held\n'
    '      // duplicate), `asset` IS grabbedAsset by construction, so\n'
    '      // the guard is always true. For the Ctrl+D path\n'
    '      // (selected duplicate), the guard is true only when the\n'
    '      // selected asset happens to also be currently grabbed.\n'
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
# Replace the SECOND occurrence first (we want both to keep working),
# but using str.replace twice with count=1 works just as well. The
# order doesn't matter since both subs have identical semantics.
src = src.replace(ANCHOR, REPLACEMENT, 2)
print(f'  applied: selectAsset(newAsset) → guarded swap (2 occurrences)')


with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('App.tsx edits applied.')
