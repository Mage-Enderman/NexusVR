"""Add __vrRadialDebug-gated diagnostic log to VRRadialMenuMesh.select().

Once enabled via `window.__vrRadialDebug = true` in the browser console,
every slice press prints ONE line tagged `[vr-radial]` with:

  - the resolved hoveredSlice (or sentinel)
  - which branch fired (hub / slice / silent-bail)
  - the dispatched slice.id when a slice fires

Why: this is the third VR radial fix shipped and the user is still
reporting symptom — without an inside-select diagnostic the next round
will be more guessing. The log costs ~1 line per press (only while
enabled) and gives a binary signal of "did we even enter select()" +
"which dispatched".

Idempotent: re-runs cleanly if the patched block is already present.
"""

from pathlib import Path

PATH = Path("src/engine/VRRadialMenuMesh.ts")
src = PATH.read_text(encoding="utf-8")

# Caveat: Three.js' Raycaster doesn't expose whether the controller's
# ray-build came from the aim rAF loop or the synchronous PRIORITY 1
# re-aim (both happen just before select() can read this.hoveredSlice).
# We only log the post-aim state — that's exactly what select() reads.
# The diagnostic is "ran the dispatch", not "which path set hoveredSlice".
A_OLD = (
    "  /**\n"
    "   * Fire the action for the currently hovered slice.\n"
    "   * Call when the controller trigger is pressed.\n"
    "   */\n"
    "  public select(): void {\n"
    "    const cb = this._callbacks;\n"
    "    if (this.hoveredSlice === -1) {\n"
    "      // Hub: cycle tab\n"
    "      cb.onNextTab();\n"
    "      return;\n"
    "    }\n"
    "    if (this.hoveredSlice < 0 || this.hoveredSlice >= this._slices.length) return;\n"
)

A_NEW = (
    "  /**\n"
    "   * Fire the action for the currently hovered slice.\n"
    "   * Call when the controller trigger is pressed.\n"
    "   *\n"
    "   * Diag: when (window as any).__vrRadialDebug === true, every press\n"
    "   * logs ONE `[vr-radial]` line with the resolved hoveredSlice and\n"
    "   * which branch dispatched. Enable in the browser console with:\n"
    "   *     window.__vrRadialDebug = true\n"
    "   * to break the guess-and-fix loop if a press fails to fire.\n"
    "   */\n"
    "  public select(): void {\n"
    "    const cb = this._callbacks;\n"
    "    const debug = (window as any).__vrRadialDebug === true;\n"
    "    if (this.hoveredSlice === -1) {\n"
    "      if (debug) console.log('[vr-radial] select fired (hub => onNextTab)');\n"
    "      // Hub: cycle tab\n"
    "      cb.onNextTab();\n"
    "      return;\n"
    "    }\n"
    "    if (this.hoveredSlice < 0 || this.hoveredSlice >= this._slices.length) {\n"
    "      if (debug) console.log('[vr-radial] select fired (silent bail; hoveredSlice=' + this.hoveredSlice + ')');\n"
    "      return;\n"
    "    }\n"
    "    if (debug) console.log('[vr-radial] select fired (slice=' + this._slices[this.hoveredSlice].id + ')');\n"
)

n_a = src.count(A_OLD)
if n_a == 0:
    print("already patched, no-op")
    raise SystemExit(0)
if n_a != 1:
    raise SystemExit(f"expected exactly one match for A block, found {n_a}")

new = src.replace(A_OLD, A_NEW)
PATH.write_text(new, encoding="utf-8")
print(f"applied: A={n_a} replaced; size grew {len(new) - len(src)} chars")
