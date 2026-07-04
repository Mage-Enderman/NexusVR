# -*- coding: utf-8 -*-
# VRHUDManager.ts: insert drawChatPanel method body immediately before drawRadialPanel.

path = 'src\\engine\\VRHUDManager.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# Anchor: the doc-block-comment head of drawRadialPanel.
ANCHOR = (
    "  /**\n"
    "   * Radial context menu rendered to the VR panel canvas. Mirrors the\n"
    "   * desktop RadialContextMenu component: 5 slices around a center hub,\n"
    "   * with the hub as a tab swap between 'general' (undo/redo + locomotion,\n"
    "   * scaling, laser) and 'grab' (undo/redo + grab mode, snap grid,\n"
    "   * collision toggle). On every draw, publishes the radial center +\n"
    "   * radii to `_radialCenter` so handleRayIntersection's polar hit-test\n"
    "   * resolves clicks against the EXACT geometry the user sees.\n"
    "   */\n"
    "  private drawRadialPanel("
)

DRAW_CHAT_PANEL = """  /**
   * VR text chat panel. Pure-immersive-WebXR counterpart of the desktop
   * ChatPanel.tsx (which keeps working on desktop and is opened via the
   * navbar) -- brings social text chat to VR users who couldn't reach it
   * before.
   *
   * Layout (1024x768 panel canvas):
   *   - drawStandardChrome (BACK + CLOSE)         0..180
   *   - Current-input buffer strip                180..220
   *   - Last 6 messages (sender, time, text)      220..420
   *   - 6-col x 5-row alphabet grid (a-z +        420..690
   *     SPACE / BACK / CLEAR / SEND)
   *
   * Buffer state lives on the manager (`_chatInputBuffer`); per-key
   * presses mutate it via runPanelAction ("chat.append:<c>" /
   * chat.backspace / chat.clear). Send strategy: pressed SEND runs
   * runPanelAction('chat.send') which bubbles the trimmed buffer up via
   * onPanelAction('chat.send:<text>') and clears the local buffer. This
   * keeps every intermediate keystroke off the React render path.
   *
   * Self-vs-other styling is left for v2 (current build renders all
   * messages uniformly); distinguishing would need `_localPeerIdHint`
   * synced from App.tsx via setDataContext.
   */
  private drawChatPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome(
      'TEXT CHAT',
      'Type with the on-panel grid. Pull trigger on SEND to broadcast.',
      '#a855f7'
    );

    // Merge local rolling buffer with whatever setDataContext last
    // pushed (covers the rare case where the React state update lands
    // BEFORE appendIncomingChat fires -- dedup by id).
    const allMsgs: ChatMessage[] = [];
    const seen = new Set<string>();
    for (const m of [...this._recentMessages, ...data.chatMessages]) {
      if (!seen.has(m.id)) { seen.add(m.id); allMsgs.push(m); }
    }
    allMsgs.sort((a, b) => a.timestamp - b.timestamp);

    // === Current-input buffer strip ===
    const bufY = bodyTop + 12;
    const bufH = 38;
    ctx.fillStyle = this._chatInputBuffer.length > 0
      ? 'rgba(168,85,247,0.18)'
      : 'rgba(30,41,59,0.55)';
    ctx.fillRect(40, bufY, w - 80, bufH);
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1;
    ctx.strokeRect(40, bufY, w - 80, bufH);
    ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('SEND:', 60, bufY + bufH / 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 18px monospace';
    const bufText = this._chatInputBuffer.length === 0 ? '_' : this._chatInputBuffer;
    ctx.fillText(bufText, 130, bufY + bufH / 2);

    // === Messages list (last 6) ===
    const msgStartY = bufY + bufH + 12;
    const msgHeight = 36;
    const maxVisible = 6;
    const visible = allMsgs.slice(-maxVisible);
    visible.forEach((m, idx) => {
      const y = msgStartY + idx * msgHeight;
      if (m.isSystem) {
        ctx.fillStyle = 'rgba(148,163,184,0.15)';
        ctx.fillRect(40, y, w - 80, msgHeight - 4);
        ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(m.text, w / 2, y + 18);
        ctx.textAlign = 'left';
        return;
      }
      ctx.fillStyle = 'rgba(30,41,59,0.65)';
      ctx.fillRect(40, y, w - 80, msgHeight - 4);
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
      ctx.strokeRect(40, y, w - 80, msgHeight - 4);
      ctx.fillStyle = '#c084fc';
      ctx.font = 'bold 13px sans-serif';
      const truncatedSender = (m.senderName ?? 'anon').slice(0, 14);
      ctx.fillText(truncatedSender, 52, y + 14);
      const timeStr = new Date(m.timestamp).toLocaleTimeString(
        [], { hour: '2-digit', minute: '2-digit' }
      );
      ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(timeStr, w - 50, y + 14);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0'; ctx.font = '14px sans-serif';
      const txtMaxLen = 80;
      const txt = m.text.length > txtMaxLen
        ? m.text.slice(0, txtMaxLen - 1) + '...'
        : m.text;
      ctx.fillText(txt, 52, y + 30);
    });
    if (allMsgs.length === 0) {
      ctx.fillStyle = '#64748b'; ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'No messages yet. Pull the trigger on a letter to start typing.',
        w / 2, msgStartY + maxVisible * msgHeight / 2
      );
      ctx.textAlign = 'left';
    } else if (allMsgs.length > maxVisible) {
      ctx.fillStyle = '#475569'; ctx.font = 'italic 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        '+' + (allMsgs.length - maxVisible) + ' older not shown',
        w - 50, msgStartY + maxVisible * msgHeight + 4
      );
      ctx.textAlign = 'left';
    }

    // === Alphabet + special keys grid (6 cols x 5 rows = 30 cells) ===
    const gridStartY = msgStartY + maxVisible * msgHeight + 14;
    const gap = 8;
    const cellW = (w - 80 - 5 * gap) / 6;
    const cellH = 50;
    const cells: string[][] = [
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['g', 'h', 'i', 'j', 'k', 'l'],
      ['m', 'n', 'o', 'p', 'q', 'r'],
      ['s', 't', 'u', 'v', 'w', 'x'],
      ['y', 'z', 'SPACE', 'BACK', 'CLEAR', 'SEND'],
    ];
    cells.forEach((row, rIdx) => {
      const y = gridStartY + rIdx * (cellH + gap / 2);
      row.forEach((label, cIdx) => {
        const x = 40 + cIdx * (cellW + gap);
        let action: string;
        let accent: string;
        let labelText: string;
        let fontPx = 18;
        if (label === 'SPACE') {
          action = 'chat.append: ';
          accent = '#06b6d4';
          labelText = 'SPACE';
          fontPx = 14;
        } else if (label === 'BACK') {
          action = 'chat.backspace';
          accent = '#ef4444';
          labelText = 'BACK';
          fontPx = 14;
        } else if (label === 'CLEAR') {
          action = 'chat.clear';
          accent = '#fbbf24';
          labelText = 'CLR';
          fontPx = 14;
        } else if (label === 'SEND') {
          action = 'chat.send';
          accent = '#10b981';
          labelText = 'SEND';
          fontPx = 14;
        } else {
          action = 'chat.append:' + label;
          accent = '#a855f7';
          labelText = label.toUpperCase();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeStyle = accent + 'aa';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.fillStyle = accent;
        ctx.font = `bold ${fontPx}px "Outfit", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, x + cellW / 2, y + cellH / 2);
        helper.registerButton({ x, y, w: cellW, h: cellH }, action);
      });
    });
    // Reset baseline
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

"""

# Place the new method immediately before the radial one.
# We prepend DRAW_CHAT_PANEL to ANCHOR.
assert ANCHOR in c, 'drawRadialPanel doc-comment anchor not found'
c = c.replace(ANCHOR, DRAW_CHAT_PANEL + "  /**\n   * Radial context menu rendered to the VR panel canvas. Mirrors the\n")

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('VRHUDManager.ts drawChatPanel inserted: OK')
print('New line count:', c.count(chr(10)) + 1)
