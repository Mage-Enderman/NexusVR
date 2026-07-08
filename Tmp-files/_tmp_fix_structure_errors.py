# -*- coding: utf-8 -*-
# Fix two structural issues introduced by the prior edits:
# (A) The TS2551 error: my anchor replacement dropped the
#     `private drawRadialPanel(` declaration. The radial body lines are
#     still present (around 1704+) but orphan class-body. Restore the
#     `private drawRadialPanel(...)` signature right before the radial body.
# (B) The TS6133 error: drawChatPanel signature declares `h: number` but
#     never uses `h`. Rename to `_h: number` to satisfy strict-mode checks.

path = 'src\\engine\\VRHUDManager.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# --- (A) Restore private drawRadialPanel declaration ------------------
# Anchor: the radial body's first executable line. The original drawRadial body
# starts:
#   const bodyTop = helper.drawStandardChrome('RADIAL CONTEXT',
#
# We prepend the missing `private drawRadialPanel(\n    ctx: ...\n  ): void {\n`
# right before it. The body's trailing `}` already correctly closes the method.
RADIAL_BODY_ANCHOR = (
    "    const bodyTop = helper.drawStandardChrome('RADIAL CONTEXT',"
)
# Find every occurrence -- only drawRadialPanel body uses RADIAL CONTEXT title,
# so the count will be 1. If a duplicate shows up the assertion will catch it.
assert c.count(RADIAL_BODY_ANCHOR) == 1, (
    f'expected exactly 1 RADIAL CONTEXT body anchor, got {c.count(RADIAL_BODY_ANCHOR)}'
)
RADIAL_SIGNATURE = (
    "  private drawRadialPanel(\n"
    "    ctx: CanvasRenderingContext2D,\n"
    "    w: number,\n"
    "    h: number,\n"
    "    helper: PanelDrawHelper,\n"
    "    data: PanelContext\n"
    "  ): void {\n"
)
c = c.replace(RADIAL_BODY_ANCHOR, RADIAL_SIGNATURE + RADIAL_BODY_ANCHOR)

# --- (B) Rename unused `h` to `_h` in drawChatPanel -------------------
# The signature line is unique because only drawChatPanel uses `PanelContext`
# without `h` decode anywhere downstream inside the panel.
old_chat_sig_h = (
    "  private drawChatPanel(\n"
    "    ctx: CanvasRenderingContext2D,\n"
    "    w: number,\n"
    "    h: number,\n"
    "    helper: PanelDrawHelper,\n"
    "    data: PanelContext\n"
    "  ): void {\n"
)
new_chat_sig_h = (
    "  private drawChatPanel(\n"
    "    ctx: CanvasRenderingContext2D,\n"
    "    w: number,\n"
    "    // Suppressed unused-param warning: the chat grid uses simple\n"
    "    // fixed-row math (derived from `w` and the bodyTop returned by\n"
    "    // `drawStandardChrome`); the canvas height is implicitly managed\n"
    "    // by `helper.getCanvasSize()` if a future layout ever needs it.\n"
    "    _h: number,\n"
    "    helper: PanelDrawHelper,\n"
    "    data: PanelContext\n"
    "  ): void {\n"
)
assert old_chat_sig_h in c, 'drawChatPanel signature not found'
c = c.replace(old_chat_sig_h, new_chat_sig_h)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('VRHUDManager.ts structural fixes applied: OK')
print('New line count:', c.count(chr(10)) + 1)
