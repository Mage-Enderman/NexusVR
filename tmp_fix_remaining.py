path = 'src/engine/VRHUDManager.ts'

def apply(old, new, label):
    global src
    if old not in src:
        print(f'WARN: {label} not found, skipping')
        return False
    src = src.replace(old, new, 1)
    print(f'OK: {label}')
    return True

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# FIX A: Add isHeld: false to PanelContext fallback. The actual text
# uses `users: []` (no trailing comma + newline + closing brace; it's
# the last field before the closing brace).
apply(
"""      grabMode: 'auto',
      users: []
    };""",
"""      grabMode: 'auto',
      users: [],
      isHeld: false
    };""",
'panel_ctx_fallback')

# FIX B: Add held-branch in drawRadialPanel's decorate. The actual
# decorate function uses `id` (not `slice.id`) and an early-return
# pattern. Insert a new `if (tab === 'held')` block between the
# general branch and the grab fallback.
# Anchor: the unique `label: 'GRAB'` line identifies the grab branch.
apply(
"""        if (id === 'right') return {
          label: 'GRAB',
          sub: data.grabMode.toUpperCase(),
          stroke: '#f59e0b',
        };""",
"""        // 'held' tab — only reachable when data.isHeld === true (set
        // via setDataContext in App.tsx). Save Held / Duplicate /
        // Destroy are routed to App.tsx via onPanelAction where the
        // dispatcher checks the active radialTab and calls
        // handleSaveHeldToInventory / handleDuplicateHeld /
        // handleDestroyHeld. Colors mirror the desktop
        // RadialContextMenu's held tab (amber / cyan / rose).
        if (this._radialTab === 'held') {
          if (id === 'right') return { label: 'SAVE', sub: 'to inventory', stroke: '#f59e0b' };
          if (id === 'bottom') return { label: 'COPY', sub: 'duplicate', stroke: '#06b6d4' };
          if (id === 'left') return { label: 'KILL', sub: 'destroy', stroke: '#ef4444' };
        }
        if (id === 'right') return {
          label: 'GRAB',
          sub: data.grabMode.toUpperCase(),
          stroke: '#f59e0b',
        };""",
'draw_radial_held_v2')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('Remaining fixes written')
