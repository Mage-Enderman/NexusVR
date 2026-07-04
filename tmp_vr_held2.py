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

# 1) Update radial:tab hub-click to 3-way cycle when isHeld.
apply(
"""    if (action === 'radial:tab') {
      this.setRadialTab(this._radialTab === 'general' ? 'grab' : 'general');
      return true;
    }""",
"""    if (action === 'radial:tab') {
      // 3-way cycle when carrying an object: general → grab → held → general.
      // 2-way cycle when not carrying: general → grab → general. Mirrors
      // the desktop RadialContextMenu's hub click so both UIs behave the
      // same way. setRadialTab also guards against landing on 'held' when
      // isHeld has flipped to false since the last click.
      if (this._dataContext?.isHeld) {
        const next: 'general' | 'grab' | 'held' =
          this._radialTab === 'general' ? 'grab' :
          this._radialTab === 'grab' ? 'held' : 'general';
        this.setRadialTab(next);
      } else {
        this.setRadialTab(this._radialTab === 'general' ? 'grab' : 'general');
      }
      return true;
    }""",
'radial_tab_cycle')

# 2) Add held branch to the decorate function. The actual decorate uses
# `label` / `sub` / `stroke` (not `color`). Find a unique anchor: the
# grab tab's 'GRAB' label is uniquely identifying for the grab branch.
apply(
"""          if (slice.id === 'right') {
            return { label: 'GRAB', sub: data.grabMode.toUpperCase(), stroke: '#f59e0b' };
          }
          if (slice.id === 'bottom') {
            return { label: 'GRID', sub: 'Toggle', stroke: '#06b6d4' };
          }
          if (slice.id === 'left') {
            return { label: 'COLLIDE', sub: 'Toggle', stroke: '#a855f7' };
          }""",
"""          if (slice.id === 'right') {
            return { label: 'GRAB', sub: data.grabMode.toUpperCase(), stroke: '#f59e0b' };
          }
          if (slice.id === 'bottom') {
            return { label: 'GRID', sub: 'Toggle', stroke: '#06b6d4' };
          }
          if (slice.id === 'left') {
            return { label: 'COLLIDE', sub: 'Toggle', stroke: '#a855f7' };
          }
        }
        if (this._radialTab === 'held') {
          // 'held' tab — only reachable when data.isHeld === true (set
          // via setDataContext in App.tsx). Save Held / Duplicate /
          // Destroy are routed to App.tsx via onPanelAction where the
          // dispatcher checks the active radialTab and calls
          // handleSaveHeldToInventory / handleDuplicateHeld /
          // handleDestroyHeld. Slice colors mirror the desktop
          // RadialContextMenu's held tab (amber / cyan / rose).
          if (slice.id === 'right') {
            return { label: 'SAVE', sub: 'to inventory', stroke: '#f59e0b' };
          }
          if (slice.id === 'bottom') {
            return { label: 'COPY', sub: 'duplicate', stroke: '#06b6d4' };
          }
          if (slice.id === 'left') {
            return { label: 'KILL', sub: 'destroy', stroke: '#ef4444' };
          }""",
'draw_radial_held')

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('VRHUDManager.ts updated with held tab')
