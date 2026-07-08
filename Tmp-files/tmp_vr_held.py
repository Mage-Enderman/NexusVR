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

# 1) Add isHeld to PanelContext (right after the closing brace of the
# existing fields, before the `users: PanelUser[]` line).
apply(
"""  scalingEnabled: boolean;
  laserEnabled: boolean;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  /** Connected users with roles, for the Session & Roles panel. */
  users: PanelUser[];
}""",
"""  scalingEnabled: boolean;
  laserEnabled: boolean;
  grabMode: 'auto' | 'precision' | 'palm' | 'laser';
  /** Connected users with roles, for the Session & Roles panel. */
  users: PanelUser[];
  /**
   * True when the local user is currently carrying an object (RMB-grab,
   * VR grip, or two-handed scale). Drives the VR 3D radial's 'held'
   * tab — when true, the hub cycles general → grab → held → general
   * and the right/bottom/left slices re-bind to Save Held / Duplicate
   * / Destroy respectively. Mirrors the desktop RadialContextMenu's
   * isHeld prop so both UIs expose the same held-object verbs.
   */
  isHeld: boolean;
}""",
'panel_context')

# 2) Extend radialTab getter type + _radialTab init to include 'held'.
apply(
"  private _radialTab: 'general' | 'grab' = 'general';",
"  private _radialTab: 'general' | 'grab' | 'held' = 'general';",
'radial_tab_init')

apply(
"  public get radialTab(): 'general' | 'grab' { return this._radialTab; }",
"  public get radialTab(): 'general' | 'grab' | 'held' { return this._radialTab; }",
'radial_tab_getter')

# 3) Extend setRadialTab signature.
apply(
"""  public setRadialTab(tab: 'general' | 'grab'): void {
    if (this._radialTab === tab) return;
    this._radialTab = tab;
    if (this.activePanel === 'sys-radial') this.redrawPanel();
  }""",
"""  public setRadialTab(tab: 'general' | 'grab' | 'held'): void {
    if (this._radialTab === tab) return;
    // Don't let a 'held' tab persist once the user releases the object
    // — fall back to 'general' so the next open doesn't show held slices
    // with no asset to act on. App.tsx's auto-switch useEffect already
    // resets on open, but defend here too in case setDataContext
    // arrives between opens.
    if (tab === 'held' && !(this._dataContext?.isHeld)) {
      tab = 'general';
    }
    this._radialTab = tab;
    if (this.activePanel === 'sys-radial') this.redrawPanel();
  }""",
'set_radial_tab')

# 4) Update the 'radial:tab' hub-click cycle to be 3-way when isHeld.
apply(
"""      if (action === 'radial:tab') {
        this.setRadialTab(this._radialTab === 'general' ? 'grab' : 'general');
      }""",
"""      if (action === 'radial:tab') {
        // 3-way cycle when carrying an object: general → grab → held → general.
        // 2-way cycle when not carrying: general → grab → general. Mirrors
        // the desktop RadialContextMenu's hub click so both UIs behave the
        // same way. The setRadialTab setter also guards against landing on
        // 'held' when isHeld has flipped to false since the last click.
        if (this._dataContext?.isHeld) {
          const next: 'general' | 'grab' | 'held' =
            this._radialTab === 'general' ? 'grab' :
            this._radialTab === 'grab' ? 'held' : 'general';
          this.setRadialTab(next);
        } else {
          this.setRadialTab(this._radialTab === 'general' ? 'grab' : 'general');
        }
      }""",
'radial_tab_cycle')

# 5) Add the 'held' tab slice rendering to drawRadialPanel's decorate
# function. The existing decorate handles general + grab; add a third
# branch for held.
# Find the existing decorate that handles non-general tabs and add held.
# Anchor: the unique "else" branch in the slice.right case after general.
# The right slice's general branch sets label to 'Locomotion'; the
# grab branch sets it to 'Grab Mode'. We add a held branch before grab.
apply(
"""          if (slice.id === 'right') {
            return { label: 'Locomotion', subLabel: ...subLocomotion(data.cameraState.locomotionMode), color: '#facc15' };
          }
          if (slice.id === 'bottom') {
            return { label: 'Scaling', subLabel: data.scalingEnabled ? 'Enabled' : 'Disabled', color: data.scalingEnabled ? '#10b981' : '#ef4444' };
          }
          if (slice.id === 'left') {
            return { label: 'Laser', subLabel: data.laserEnabled ? 'Enabled' : 'Disabled', color: data.laserEnabled ? '#ffffff' : '#94a3b8' };
          }""",
"""          if (slice.id === 'right') {
            return { label: 'Locomotion', subLabel: ...subLocomotion(data.cameraState.locomotionMode), color: '#facc15' };
          }
          if (slice.id === 'bottom') {
            return { label: 'Scaling', subLabel: data.scalingEnabled ? 'Enabled' : 'Disabled', color: data.scalingEnabled ? '#10b981' : '#ef4444' };
          }
          if (slice.id === 'left') {
            return { label: 'Laser', subLabel: data.laserEnabled ? 'Enabled' : 'Disabled', color: data.laserEnabled ? '#ffffff' : '#94a3b8' };
          }
        }
        if (this._radialTab === 'held') {
          // 'held' tab — only reachable when isHeld === true (set via
          // setDataContext in App.tsx). Save Held / Duplicate / Destroy
          // are routed to App.tsx via onPanelAction(actionId) where the
          // dispatcher checks _radialTab and calls handleSaveHeldToInventory
          // / handleDuplicateHeld / handleDestroyHeld. Simple canvas
          // shape glyphs mirror the desktop's BookmarkPlus / Copy / Trash2
          // icons (no need for a full icon font in the 3D panel).
          if (slice.id === 'right') {
            return { label: 'Save Held', subLabel: 'To inventory', color: '#f59e0b' };
          }
          if (slice.id === 'bottom') {
            return { label: 'Duplicate', subLabel: 'Make a copy', color: '#06b6d4' };
          }
          if (slice.id === 'left') {
            return { label: 'Destroy', subLabel: 'Remove from world', color: '#ef4444' };
          }""",
'draw_radial_held')

# 6) Update the polar hit-test in handleClick to ALSO support the 'held'
# tab. The existing code already dispatches 'radial:right' / 'bottom' /
# 'left' to onPanelAction (and App.tsx routes based on _radialTab), so
# no changes are needed to handleClick itself. The drawSlice rendering
# and the setRadialTab gating are sufficient.

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print('VRHUDManager.ts updated')
