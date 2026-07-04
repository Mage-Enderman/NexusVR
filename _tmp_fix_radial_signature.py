# -*- coding: utf-8 -*-
# Final cleanup: replace the malformed section between drawChatPanel's `}`
# and the radial body's first statement with a clean `private drawRadialPanel`
# method declaration. The earlier anchor-replace accidentally consumed most
# of the doc-comment block, leaving free-floating signature lines that TS
# tried to parse as class-body and gave up on. My prior fix then prepended
# yet another declaration inline. The result is a duplicate / corrupt section.
# This script rewrites the whole corrupt region cleanly.

path = 'src\\engine\\VRHUDManager.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# The corrupt boundary: begins right after drawChatPanel's closing `}` (which
# sits at the end of the previous DRAW_CHAT_PANEL block), runs through the
# truncated doc comment + orphan signature + my inserted duplicate declaration,
# and ends right before the radial body's first helper.drawStandardChrome call.
CORRUPT = (
    "  /**\n"
    "   * Radial context menu rendered to the VR panel canvas. Mirrors the\n"
    "\n"
    "    ctx: CanvasRenderingContext2D,\n"
    "    w: number,\n"
    "    h: number,\n"
    "    helper: PanelDrawHelper,\n"
    "    data: PanelContext\n"
    "  ): void {\n"
    "  private drawRadialPanel(\n"
    "    ctx: CanvasRenderingContext2D,\n"
    "    w: number,\n"
    "    h: number,\n"
    "    helper: PanelDrawHelper,\n"
    "    data: PanelContext\n"
    "  ): void {\n"
)

CLEAN_REPLACEMENT = (
    "  /**\n"
    "   * Radial context menu rendered to the VR panel canvas. Mirrors the\n"
    "   * desktop RadialContextMenu component: 5 slices around a center hub,\n"
    "   * with the hub as a tab swap between 'general' (undo/redo + locomotion,\n"
    "   * scaling, laser) and 'grab' (undo/redo + grab mode, snap grid,\n"
    "   * collision toggle). On every draw, publishes the radial center +\n"
    "   * radii to `_radialCenter` so handleRayIntersection's polar hit-test\n"
    "   * resolves clicks against the EXACT geometry the user sees.\n"
    "   */\n"
    "  private drawRadialPanel(\n"
    "    ctx: CanvasRenderingContext2D,\n"
    "    w: number,\n"
    "    h: number,\n"
    "    helper: PanelDrawHelper,\n"
    "    data: PanelContext\n"
    "  ): void {\n"
)

assert CORRUPT in c, 'corrupt boundary block not found'
assert c.count(CORRUPT) == 1, 'corrupt boundary appears more/less than once'
c = c.replace(CORRUPT, CLEAN_REPLACEMENT)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('VRHUDManager.ts radial-method cleanup: OK')
print('New line count:', c.count(chr(10)) + 1)
