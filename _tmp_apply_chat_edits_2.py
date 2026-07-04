# -*- coding: utf-8 -*-
# VRHUDManager.ts VR Chat Panel edits 5-7:
# (5) Register sys-chat in registerBuiltinDrawers
# (6) Add chat handlers in runPanelAction
# (7) Append chatMessages to fallback PanelContext

path = 'src\\engine\\VRHUDManager.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# --- (5) Register sys-chat drawer -------------------------------------
old_builtin_tail = (
    "    this.panelDrawers.set('sys-inspector', this.drawInspectorPanel.bind(this));\n"
    "    // The radial context menu is a 3D panel in VR (the React DOM version\n"
    "    // is invisible in pure immersive WebXR). 5 slices + center hub,\n"
    "    // tab swap on hub click. Polar hit-test in handleRayIntersection\n"
    "    // dispatches the click to the matching slice action.\n"
    "    this.panelDrawers.set('sys-radial',    this.drawRadialPanel.bind(this));\n"
    "  }"
)
new_builtin_tail = (
    "    this.panelDrawers.set('sys-inspector', this.drawInspectorPanel.bind(this));\n"
    "    this.panelDrawers.set('sys-chat',      this.drawChatPanel.bind(this));\n"
    "    // The radial context menu is a 3D panel in VR (the React DOM version\n"
    "    // is invisible in pure immersive WebXR). 5 slices + center hub,\n"
    "    // tab swap on hub click. Polar hit-test in handleRayIntersection\n"
    "    // dispatches the click to the matching slice action.\n"
    "    this.panelDrawers.set('sys-radial',    this.drawRadialPanel.bind(this));\n"
    "  }"
)
assert old_builtin_tail in c, 'registerBuiltinDrawers tail not found'
c = c.replace(old_builtin_tail, new_builtin_tail)

# --- (6) Extend runPanelAction with chat handlers ---------------------
old_run_tail = (
    "    // No other built-ins for v1 \\u2014 everything else routes up to App.tsx.\n"
    "    return false;\n"
    "  }"
)
new_run_tail = (
    "    // Chat alphabet button: append single char to the typing buffer.\n"
    "    // Each letter / number dispatches 'chat.append:<c>' from the panel\n"
    "    // canvas; we mutate the buffer in-place and redraw so the\n"
    "    // intermediate buffers never round-trip through App.tsx.\n"
    "    // Limited to single ASCII printable chars so the buffer stays\n"
    "    // sanitised (no newlines, no control codes).\n"
    "    if (action.startsWith('chat.append:')) {\n"
    "      const ch = action.substring('chat.append:'.length);\n"
    "      if (ch.length === 1 && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e) {\n"
    "        if (this._chatInputBuffer.length < 200) {\n"
    "          this._chatInputBuffer += ch;\n"
    "        }\n"
    "        this.redrawPanel();\n"
    "      }\n"
    "      return true;\n"
    "    }\n"
    "    if (action === 'chat.backspace') {\n"
    "      this._chatInputBuffer = this._chatInputBuffer.slice(0, -1);\n"
    "      this.redrawPanel();\n"
    "      return true;\n"
    "    }\n"
    "    if (action === 'chat.clear') {\n"
    "      this._chatInputBuffer = '';\n"
    "      this.redrawPanel();\n"
    "      return true;\n"
    "    }\n"
    "    if (action === 'chat.send') {\n"
    "      const text = this._chatInputBuffer.trim();\n"
    "      if (text.length > 0) {\n"
    "        // Bubble up via the colon-separated convention used by every\n"
    "        // other panel action; App.tsx's onPanelAction strips the\n"
    "        // 'chat.send:' prefix and forwards to networkService.\n"
    "        this._chatInputBuffer = '';\n"
    "        this.onPanelAction?.('chat.send:' + text);\n"
    "      }\n"
    "      this.redrawPanel();\n"
    "      return true;\n"
    "    }\n"
    "    // No other built-ins for v1; everything else routes up to App.tsx.\n"
    "    return false;\n"
    "  }"
)
assert old_run_tail in c, 'runPanelAction tail not found'
c = c.replace(old_run_tail, new_run_tail)

# --- (7) Add chatMessages: [] to fallback context ---------------------
old_fallback_inventory = "      inventoryItems: [],"
new_fallback_inventory = (
    "      inventoryItems: [],\n"
    "      chatMessages: [],"
)
assert old_fallback_inventory in c, 'fallback inventoryItems line not found'
c = c.replace(old_fallback_inventory, new_fallback_inventory)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('VRHUDManager.ts edits 5-7 applied: OK')
print('New line count:', c.count(chr(10)) + 1)
