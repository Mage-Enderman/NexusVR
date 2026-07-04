# -*- coding: utf-8 -*-
# VRHUDManager.ts VR Chat Panel edits 1-4. Multi-line JSDoc uses
# triple-quoted r-strings so backslashes and \" quotes don't break the script.

path = 'src\\engine\\VRHUDManager.ts'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# --- (1) Import ChatMessage -------------------------------------------
old_imp = (
    "import type { GraphicsSettings, PerformanceStats } from './SceneEngine.ts';\n"
    "import type { EnvironmentSettings } from './EnvironmentManager.ts';\n"
    "import type { ConnectionMode } from '../services/NetworkService.ts';\n"
    "import type { LoadedAsset } from './AssetManager.ts';"
)
new_imp = (
    "import type { GraphicsSettings, PerformanceStats } from './SceneEngine.ts';\n"
    "import type { EnvironmentSettings } from './EnvironmentManager.ts';\n"
    "import type { ConnectionMode, ChatMessage } from '../services/NetworkService.ts';\n"
    "import type { LoadedAsset } from './AssetManager.ts';"
)
assert old_imp in c, 'import block not found'
c = c.replace(old_imp, new_imp)

# --- (2) Extend PanelContext with chatMessages ------------------------
old_ctx_tail = '  isHeld: boolean;\n}'

new_ctx_tail = (
    "  isHeld: boolean;\n"
    "  /**\n"
    "   * Recent chat messages relayed from NetworkService (newest at tail).\n"
    "   * The VR Chat Panel renders the tail of this list (not virtual-scrolled)\n"
    "   * so users in pure immersive WebXR can read incoming messages and reply\n"
    "   * via the on-panel alphabet grid. Desktop ChatPanel.tsx uses\n"
    "   * NetworkService.onChat directly but pushes the same buffer so\n"
    "   * setDataContext stays shared.\n"
    "   */\n"
    "  chatMessages: ChatMessage[];\n"
    "}"
)
assert old_ctx_tail in c, 'PanelContext isHeld tail not found'
c = c.replace(old_ctx_tail, new_ctx_tail)

# --- (3a) Refactor systemItems in renderCanvas -------------------------
SYSITEMS_BLOCK = (
    "    const systemItems: InventoryItem[] = [\n"
    "      { id: 'sys-session',   name: 'Session & Roles',   type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-inventory', name: 'Inventory Storage', type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-settings',  name: 'World Settings',    type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-env',       name: 'World Environment', type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-share',     name: 'Invite & Share',    type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-pair',      name: 'Pair Companion',    type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-radial',    name: 'Radial Context',    type: 'system', createdAt: 0 },\n"
    "      { id: 'sys-inspector', name: 'Scene Inspector',   type: 'system', createdAt: 0 }\n"
    "    ];\n"
)
new_sysitems = (
    "    const systemItems = VRHUDManager.SYSTEM_CARDS.map("
    "(c) => ({ ...c, createdAt: 0, type: 'system' as const }));\n"
)
assert c.count(SYSITEMS_BLOCK) == 2, f'expected sysitems block 2x, got {c.count(SYSITEMS_BLOCK)}'
c = c.replace(SYSITEMS_BLOCK, new_sysitems)

# --- (3b) Insert static SYSTEM_CARDS right above fallbackGraphics ----
old_static_fallback = '  private static fallbackGraphics: GraphicsSettings = {'
new_static_fallback = (
    "  /**\n"
    "   * Single source of truth for the dash-menu system cards.\n"
    "   * Read by BOTH renderCanvas (draw cards) and handleRayIntersection\n"
    "   * (hit-test cards). Add a new card by appending one row here.\n"
    "   * Consumers .map at call sites adapt to InventoryItem so the\n"
    "   * existing drawing loop is reused as-is.\n"
    "   */\n"
    "  public static readonly SYSTEM_CARDS: ReadonlyArray<{ id: string; name: string }> = [\n"
    "    { id: 'sys-session',   name: 'Session & Roles'   },\n"
    "    { id: 'sys-inventory', name: 'Inventory Storage' },\n"
    "    { id: 'sys-chat',      name: 'Text Chat'         },\n"
    "    { id: 'sys-settings',  name: 'World Settings'    },\n"
    "    { id: 'sys-env',       name: 'World Environment' },\n"
    "    { id: 'sys-share',     name: 'Invite & Share'    },\n"
    "    { id: 'sys-pair',      name: 'Pair Companion'    },\n"
    "    { id: 'sys-radial',    name: 'Radial Context'    },\n"
    "    { id: 'sys-inspector', name: 'Scene Inspector'   },\n"
    "  ];\n"
    "\n"
    "  private static fallbackGraphics: GraphicsSettings = {"
)
assert old_static_fallback in c, 'fallbackGraphics anchor not found'
c = c.replace(old_static_fallback, new_static_fallback)

# --- (4) Add chat state fields + appendIncomingChat() -----------------
old_radial_tab_getter = (
    "  public get radialTab(): 'general' | 'grab' | 'held' { return this._radialTab; }"
)
new_radial_tab_getter = (
    "  public get radialTab(): 'general' | 'grab' | 'held' { return this._radialTab; }\n"
    "\n"
    "  // =================================================================\n"
    "  // VR Chat Panel state + plumbing\n"
    "  // =================================================================\n"
    "  /**\n"
    "   * Buffer the user is typing in the VR chat alphabet grid.\n"
    "   * Empty string means no characters typed yet. Send pushes the buffer\n"
    "   * up via onPanelAction('chat.send:<text>') and clears it.\n"
    "   */\n"
    "  private _chatInputBuffer: string = '';\n"
    "  /**\n"
    "   * Recent chat messages received via NetworkService (newest at tail,\n"
    "   * deduped by id). Capped at CHAT_MESSAGE_HISTORY so the panel canvas\n"
    "   * render stays bounded across long sessions. App.tsx pushes\n"
    "   * incoming messages through appendIncomingChat.\n"
    "   */\n"
    "  private _recentMessages: ChatMessage[] = [];\n"
    "  private static readonly CHAT_MESSAGE_HISTORY = 30;\n"
    "  /**\n"
    "   * Push a chat message that just arrived over the network into the\n"
    "   * manager rolling buffer. Idempotent on duplicate ids. Triggers a\n"
    "   * redraw only when the chat panel is currently active so non-active\n"
    "   * panels do not churn.\n"
    "   */\n"
    "  public appendIncomingChat(msg: ChatMessage): void {\n"
    "    if (this._recentMessages.some((m) => m.id === msg.id)) return;\n"
    "    this._recentMessages.push(msg);\n"
    "    if (this._recentMessages.length > VRHUDManager.CHAT_MESSAGE_HISTORY) {\n"
    "      this._recentMessages.splice(\n"
    "        0,\n"
    "        this._recentMessages.length - VRHUDManager.CHAT_MESSAGE_HISTORY\n"
    "      );\n"
    "    }\n"
    "    if (this.activePanel === 'sys-chat') this.redrawPanel();\n"
    "  }\n"
    "  /**\n"
    "   * Clear the VR chat input buffer. Called from App.tsx after a send\n"
    "   * completes (or on error) so the panel reflects that the message\n"
    "   * has been dispatched regardless of dispatcher outcome.\n"
    "   */\n"
    "  public clearChatInput(): void {\n"
    "    this._chatInputBuffer = '';\n"
    "    if (this.activePanel === 'sys-chat') this.redrawPanel();\n"
    "  }"
)
assert old_radial_tab_getter in c, 'radialTab getter anchor not found'
c = c.replace(old_radial_tab_getter, new_radial_tab_getter)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('VRHUDManager.ts edits 1-4 applied: OK')
print('New line count:', c.count(chr(10)) + 1)
