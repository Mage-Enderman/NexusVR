#!/usr/bin/env python3
"""Add a VR HUD video controls card to VRHUDManager.drawInspectorPanel.

The card renders ONLY when the selected asset is a video, and when
present pushes the BASIC + TRANSFORM + MESH + MATERIAL sections down
by 110px so the Y layout doesn't overlap the new card.
"""
import io

PATH = "src/engine/VRHUDManager.ts"
with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
original = src

# ============================================================================
# EDIT G: Add a `yShift` declaration + VIDEO CONTROLS card to
# drawInspectorPanel, RIGHT AFTER the SLOT HEADER block (y=190..254)
# closes, BEFORE drawCard(264, 366, 'BASIC ...'). When sel.type is
# not 'video', the card is skipped and yShift stays 0.
#
# Implementation: rename existing literal y-coordinates that need to
# be shifted into vars whose value depends on yShift. The vars are
# pre-declared in Edit H below. Edit G inserts the VIDEO block and
# sets `yShift = 110;` into a guard clause that only runs when
# sel.type === 'video'.
# ============================================================================

G_OLD = '''    drawCard(190, 254, 'SLOT HEADER', '#a855f7');'''
G_NEW = '''    drawCard(190, 254, 'SLOT HEADER', '#a855f7');
    // Video controls card sits BETWEEN slot header and basic when
    // the selected asset is a video. A yShift pushes all later
    // sections down so the layout doesn't overlap. We pre-declare
    // yShift = 0 so the bulk of the renderer can keep using literal
    // y-coords (only the BASIC card origin branches on it).
    let yShift = 0;
    if (sel.type === 'video') {
      yShift = 110;
      const vcTop = 264;
      const vcBot = 264 + yShift;
      drawCard(vcTop, vcBot, 'VIDEO CONTROLS', '#ec4899');
      // Read live videoState from userData so the values always
      // mirror the HTMLVideoElement engine state (no event-bridge).
      const vs = (sel.object3d.userData as {
        videoState?: {
          playing: boolean;
          currentTime: number;
          duration: number;
          globalVolume: number;
          localVolume: number;
          volumeMode: 'global' | 'local';
          muted: boolean;
        }
      }).videoState;

      // Top row: PLAY / PAUSE (single toggle button), SKIP BACK/FR
      const vRowY = vcTop + 30;
      const vBtnH = 36;
      const vBtnGap = 8;
      const colW = (w - 80 - vBtnGap * 4) / 5;
      drawBtn(
        56 + 0 * (colW + vBtnGap), vRowY, colW, vBtnH,
        vs?.playing ? '\u275A\u275A PAUSE' : '\u25B6 PLAY',
        vs?.playing ? 'inspect.video:pause' : 'inspect.video:play',
        vs?.playing ? 'rgba(245,158,11,0.20)' : 'rgba(16,185,129,0.20)',
        vs?.playing ? '#fbbf24' : '#86efac',
        vs?.playing ? '#f59e0b' : '#10b981'
      );
      drawBtn(
        56 + 1 * (colW + vBtnGap), vRowY, colW, vBtnH,
        '\u23EE SKIP -5',
        'inspect.video:seekPrev',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + 2 * (colW + vBtnGap), vRowY, colW, vBtnH,
        'SKIP +5 \u23ED',
        'inspect.video:seekNext',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + 3 * (colW + vBtnGap), vRowY, colW, vBtnH,
        '\u21BA RESTART',
        'inspect.video:restart',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + 4 * (colW + vBtnGap), vRowY, colW, vBtnH,
        vs?.muted ? '\u266B UNMUTE' : '\u266B MUTE',
        'inspect.video:toggleMute',
        vs?.muted ? 'rgba(244,63,94,0.20)' : 'rgba(6,182,212,0.20)',
        vs?.muted ? '#fda4af' : '#67e8f9',
        vs?.muted ? '#f43f5e' : '#06b6d4'
      );

      // Middle row: VOL down / VAL readout / VOL up
      const vRow2Y = vRowY + vBtnH + 10;
      drawBtn(
        56 + 0 * (colW + vBtnGap), vRow2Y, colW, vBtnH,
        'VOL \u2212',
        'inspect.video:volDown',
        'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444'
      );
      // Center: VOL % readout drawn into a non-interactive strip
      const ctrX = 56 + 1 * (colW + vBtnGap);
      const ctrW = colW * 3 + vBtnGap * 2;
      ctx.fillStyle = 'rgba(30,41,59,0.7)';
      ctx.fillRect(ctrX, vRow2Y, ctrW, vBtnH);
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
      ctx.strokeRect(ctrX, vRow2Y, ctrW, vBtnH);
      const activeVol = vs
        ? (vs.volumeMode === 'global' ? vs.globalVolume : vs.localVolume)
        : 0;
      const shownPct = Math.round((vs?.muted ? 0 : activeVol) * 100);
      ctx.fillStyle = vs?.volumeMode === 'global' ? '#67e8f9' : '#f0abfc';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(
        (vs?.volumeMode === 'global' ? 'GLOBAL' : 'LOCAL') + ' ' + shownPct + '%',
        ctrX + ctrW / 2, vRow2Y + vBtnH / 2
      );
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      drawBtn(
        ctrX + ctrW + vBtnGap, vRow2Y, colW, vBtnH,
        'VOL +',
        'inspect.video:volUp',
        'rgba(16,185,129,0.20)', '#86efac', '#10b981'
      );

      // Bottom row: GLOBL mode toggle | LOCAL mode toggle | CLOSE
      const vRow3Y = vRow2Y + vBtnH + 10;
      drawBtn(
        56 + 0 * (colW + vBtnGap), vRow3Y, colW, vBtnH,
        'GLOBL \u25D0',
        'inspect.video:mode:global',
        vs?.volumeMode === 'global'
          ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'global' ? '#67e8f9' : '#cbd5e1',
        vs?.volumeMode === 'global' ? '#06b6d4' : '#475569'
      );
      drawBtn(
        56 + 1 * (colW + vBtnGap), vRow3Y, colW, vBtnH,
        'LOCAL \u25D1',
        'inspect.video:mode:local',
        vs?.volumeMode === 'local'
          ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)',
        vs?.volumeMode === 'local' ? '#f0abfc' : '#cbd5e1',
        vs?.volumeMode === 'local' ? '#f472b6' : '#475569'
      );
      // Close button (right two cols)
      const closeW = colW * 2 + vBtnGap;
      drawBtn(
        56 + 2 * (colW + vBtnGap), vRow3Y, colW, vBtnH,
        'MUTE TGL',
        'inspect.video:toggleMute',
        'rgba(30,41,59,0.7)', '#cbd5e1', '#475569'
      );
      drawBtn(
        56 + (colW + vBtnGap) * 3 + vBtnGap, vRow3Y, colW, vBtnH,
        '\u2715 CLOSE VIDEO',
        'inspect.video:close',
        'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444'
      );
    }
'''
if G_OLD in src and "let yShift = 0;" not in src:
    assert src.count(G_OLD) == 1, "Edit G anchor not unique"
    src = src.replace(G_OLD, G_NEW, 1)
    print("[ok] Edit G: VR HUD video controls card")
else:
    print("[skip] Edit G already applied or anchor missing")

# ============================================================================
# EDIT H: Push the BASIC + TRANSFORM + MESH + MATERIAL cards down by
# yShift. We have 4 cards to shift; we rewrite the literal y-coords
# so they add `+ yShift` at compile time of the JS expression.
# ============================================================================

# H01: BASIC (264..366) - rewrite y bounds
H01_OLD = "    drawCard(264, 366, 'BASIC PROPS + HIERARCHY', '#10b981');"
H01_NEW = "    drawCard(264 + yShift, 366 + yShift, 'BASIC PROPS + HIERARCHY', '#10b981');"
# Also push the inner basicY and label/read-outs
H01A_OLD = "    const basicY = 290;"
H01A_NEW = "    const basicY = 290 + yShift;"
H01B_OLD = "    const hierY = 332;"
H01B_NEW = "    const hierY = 332 + yShift;"
H01C_OLD = "    ctx.fillText('Current parent: ' + (parentName.length > 30 ? parentName.slice(0,29) + '\\u2026' : parentName), 56, 378);"
H01C_NEW = "    ctx.fillText('Current parent: ' + (parentName.length > 30 ? parentName.slice(0,29) + '\\u2026' : parentName), 56, 378 + yShift);"

# H02: TRANSFORM (378..564)
H02_OLD = "    drawCard(378, 564, 'TRANSFORM', '#06b6d4');"
H02_NEW = "    drawCard(378 + yShift, 564 + yShift, 'TRANSFORM', '#06b6d4');"

# H03: MESH STATS + DISPLAY (576..686)
H03_OLD = "    drawCard(576, 686, 'MESH STATS + DISPLAY', '#f59e0b');"
H03_NEW = "    drawCard(576 + yShift, 686 + yShift, 'MESH STATS + DISPLAY', '#f59e0b');"
# Also push inner coords (stats row at +yShift)
H03A_OLD = "    const statsX = 56, statsY = 600, statsRowH = 22, statsW = 240;"
H03A_NEW = "    const statsX = 56, statsY = 600 + yShift, statsRowH = 22, statsW = 240;"
H03B_OLD = "    const displayX = 320, displayY = 600, displayW = (w - 80) - 264;"
H03B_NEW = "    const displayX = 320, displayY = 600 + yShift, displayW = (w - 80) - 264;"

# H04: MATERIAL (696..758)
H04_OLD = "    drawCard(696, 758, 'MATERIAL', '#06b6d4');"
H04_NEW = "    drawCard(696 + yShift, 758 + yShift, 'MATERIAL', '#06b6d4');"
H04A_OLD = "    const matY = 720;"
H04A_NEW = "    const matY = 720 + yShift;"
H04B_OLD = "    const scalarStartY = 720 + 42;"
H04B_NEW = "    const scalarStartY = 720 + yShift + 42;"

for label, old, new in [
    ("H01", H01_OLD, H01_NEW),
    ("H01A", H01A_OLD, H01A_NEW),
    ("H01B", H01B_OLD, H01B_NEW),
    ("H01C", H01C_OLD, H01C_NEW),
    ("H02", H02_OLD, H02_NEW),
    ("H03", H03_OLD, H03_NEW),
    ("H03A", H03A_OLD, H03A_NEW),
    ("H03B", H03B_OLD, H03B_NEW),
    ("H04", H04_OLD, H04_NEW),
    ("H04A", H04A_OLD, H04A_NEW),
    ("H04B", H04B_OLD, H04B_NEW),
]:
    if old in src and new not in src:
        assert src.count(old) >= 1, f"{label} anchor missing"
        src = src.replace(old, new, 1)
        print(f"[ok] {label}: yShift applied")
    else:
        print(f"[skip] {label} already applied or anchor missing")

# ============================================================================
# SAVE
# ============================================================================
if src != original:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[ok] saved ({len(src) - len(original):+d} bytes)")
else:
    print("[noop] no changes")
