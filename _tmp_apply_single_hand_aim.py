"""Apply the single-hand-aim patch in src/App.tsx.

Replaces the aim rAF loop block that hardcoded 'right' controller with
one that follows vrRadialActiveSideRef.current so opening-with-Y aims
with the left hand and opening-with-B aims with the right hand. Also
rewrites the misleading "Resonite convention" comment.

Idempotent: re-running is a no-op if the new strings are already present.
"""

from pathlib import Path

PATH = Path("src/App.tsx")
src = PATH.read_text(encoding="utf-8")

# Two distinct replacements; each is unique enough in the file that a
# naive string replace won't false-positive elsewhere.
A_OLD = (
    "      // Always aim with the right controller (Resonite convention: the menu\n"
    "      // floats near the left wrist, the right laser aims and selects).\n"
    "      // vrRadialActiveSideRef records which controller OPENED the menu so\n"
    "      // the initial placement is correct; once open, aiming is always right.\n"
    "      const ctr = se.vrInput?.getController('right');\n"
)

A_NEW = (
    "      // Aim with the opening controller (single-hand / wrist-remote UX).\n"
    "      // vrRadialActiveSideRef.current is set by the B/Y press handler\n"
    "      // to 'right' on B-press or 'left' on Y-press when the menu was\n"
    "      // opened. The panel is placed near that hand's wrist once at\n"
    "      // open time, so reading the ray from the SAME controller gives\n"
    "      // the user a natural cross-axis hover + select: opening with Y\n"
    "      // -> placed at left wrist -> aiming with the left hand; opening\n"
    "      // with B -> placed at right wrist -> aiming with the right hand.\n"
    "      // The previous always-right behavior produced a panel whose\n"
    "      // placement was unreachable by the aiming ray in the Y case\n"
    "      // (panel at left wrist, ray from right side of body), so the\n"
    "      // ray never intersected the mesh and hoveredSlice stayed at\n"
    "      // -999, which made select() silently bail without firing any\n"
    "      // slice callbacks. Single-hand aim keeps the two aligned.\n"
    "      // Fall back to 'right' only in the edge case where the menu is\n"
    "      // visible but activeSide hasn't been written yet (shouldn't\n"
    "      // happen in normal flow -- isVisible is only true while\n"
    "      // activeSide is non-null because both are flipped together\n"
    "      // in the B/Y handlers).\n"
    "      const aimSide = vrRadialActiveSideRef.current ?? 'right';\n"
    "      const ctr = se.vrInput?.getController(aimSide);\n"
)

# B: the loop's "we do NOT re-place every frame" comment refers to the
#    old (always-right) behavior and is now misleading because aim follows
#    the opening side. Rewrite to describe the actual constraint.
B_OLD = (
    "      // The panel is placed near the OPENING controller once (on B/Y press),\n"
    "      // then stays world-anchored. We do NOT re-place every frame because the\n"
    "      // aim ray now comes from the RIGHT hand while the panel lives near the\n"
    "      // LEFT wrist \u2014 re-placing would chase the right controller and make it\n"
    "      // impossible to aim at the menu. Leave position static after open.\n"
)

B_NEW = (
    "      // The panel is placed near the OPENING controller once (on B/Y press),\n"
    "      // then stays world-anchored. We do NOT re-place every frame because\n"
    "      // re-placing would chase whichever controller the user is currently\n"
    "      // waving around and make consistent aim impossible. Leave position\n"
    "      // static after open so the panel sits where the user's wrist was at\n"
    "      // the moment of opening -- the natural anchor for single-hand aim.\n"
)

n_a = src.count(A_OLD)
n_b = src.count(B_OLD)

if n_a == 0 and n_b == 0:
    # Already patched -- idempotent exit.
    print("already patched, no-op")
    raise SystemExit(0)

if n_a != 1:
    raise SystemExit(f"expected exactly one match for A block, found {n_a}")
if n_b != 1:
    raise SystemExit(f"expected exactly one match for B block, found {n_b}")

new = src.replace(A_OLD, A_NEW).replace(B_OLD, B_NEW)
PATH.write_text(new, encoding="utf-8")
print(f"applied: A={n_a} B={n_b} replaced")
