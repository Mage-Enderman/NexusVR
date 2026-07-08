# -*- coding: utf-8 -*-
# App.tsx wiring for VR Chat Panel.
# Steps:
# (A) Import ChatMessage
# (B) Add chatMessages state
# (C) Update net.onChat subscriber to push to vrHud.appendIncomingChat and
#     the chatMessages state.
# (D) Add 'sys-chat' case to the system cards switch in the engine-init effect.
# (E) Add 'chat.send:<text>' handler inside onPanelAction.
# (F) Include `chatMessages` in setDataContext push and deps.

path = 'src\\App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# --- (A) Import ChatMessage -------------------------------------------
old_imp = ("import type { ConnectionMode, AssetSpawnData, PendingSpawnData } from './services/NetworkService.ts';")
new_imp = ("import type { ConnectionMode, AssetSpawnData, PendingSpawnData, ChatMessage } from './services/NetworkService.ts';")
assert old_imp in c, 'NetworkService type import not found'
c = c.replace(old_imp, new_imp)

# --- (B) Add chatMessages state --------------------------------------
# Place near the other setState calls (after unreadChatCount).
old_unread_state = '  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);'
new_unread_state = (
    "  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);\n"
    "  // Rolling buffer of recent chat messages; mirrors VRHUDManager's\n"
    "  // internal _recentMessages for the React-driven setDataContext push\n"
    "  // (the manager keeps its own copy via appendIncomingChat so the canvas\n"
    "  // redraws on every keystroke without paying the React render cost).\n"
    "  // Capped to 30 -- matched to VRHUDManager.CHAT_MESSAGE_HISTORY.\n"
    "  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);"
)
assert old_unread_state in c, 'unreadChatCount useState not found'
c = c.replace(old_unread_state, new_unread_state)

# --- (C) Update net.onChat subscriber ---------------------------------
old_on_chat = (
    "    disposers.push(net.onChat((_msg) => {\n"
    "      if (!showChatPanel) {\n"
    "        setUnreadChatCount((prev) => prev + 1);\n"
    "      }\n"
    "    }));"
)
new_on_chat = (
    "    disposers.push(net.onChat((msg) => {\n"
    "      // Desktop unread badge: only bump while the user is not looking\n"
    "      // at the desktop ChatPanel.\n"
    "      if (!showChatPanel) {\n"
    "        setUnreadChatCount((prev) => prev + 1);\n"
    "      }\n"
    "      // Push to VRHUDManager so the VR Chat Panel (when open) reflects\n"
    "      // the new message immediately. appendIncomingChat is idempotent\n"
    "      // on duplicate ids and cheap for the closed-panel case (no redraw).\n"
    "      vrHudRef.current?.appendIncomingChat(msg);\n"
    "      // Keep a React-state copy so setDataContext can push it down to\n"
    "      // any panel that wants it. Capped to last 30 to mirror the\n"
    "      // manager's rolling buffer; dedupe by id.\n"
    "      setChatMessages((prev) => {\n"
    "        if (prev.some((m) => m.id === msg.id)) return prev;\n"
    "        const next = [...prev, msg];\n"
    "        return next.length > 30 ? next.slice(next.length - 30) : next;\n"
    "      });\n"
    "    }));"
)
assert old_on_chat in c, 'net.onChat subscriber not found'
c = c.replace(old_on_chat, new_on_chat)

# --- (D) Add 'sys-chat' case after 'sys-radial' in the system cards
#        switch in the engine-init effect -----------------------------
# Anchor: the radial case (which is BEFORE sys-inspector in the switch).
old_radial_case = (
    "                case 'sys-radial':\n"
    "                  setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });\n"
    "                  setShowRadialMenu(true);\n"
    "                  break;\n"
)
new_radial_case = (
    "                case 'sys-radial':\n"
    "                  setRadialMenuPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });\n"
    "                  setShowRadialMenu(true);\n"
    "                  break;\n"
    "                case 'sys-chat':\n"
    "                  // Open the React ChatPanel on desktop (already used by\n"
    "                  // navbar); open the VR 3D chat panel on immersive VR.\n"
    "                  if (sceneEngineRef.current?.renderer.xr.isPresenting) {\n"
    "                    vrHudRef.current?.openPanel('sys-chat');\n"
    "                  } else {\n"
    "                    setUnreadChatCount(0);\n"
    "                    setShowChatPanel(true);\n"
    "                  }\n"
    "                  break;\n"
)
assert old_radial_case in c, 'sys-radial case block not found'
c = c.replace(old_radial_case, new_radial_case)

# --- (E) chat.send:<text> dispatch in onPanelAction -------------------
# Place right after the radial block -- which currently ends with the
# 'radial:left' handler. Anchor: the radial:left return.
old_radial_left = (
    "            if (actionId === 'radial:left') {\n"
    "              const tab = vrHudRef.current?.radialTab ?? 'general';\n"
    "              if (tab === 'general') {\n"
    "                setLaserEnabled((v) => !v);\n"
    "              } else {\n"
    "                // Collision toggle is owned by ManipulationManager.\n"
    "                manipulationManagerRef.current?.toggleCollision();\n"
    "              }\n"
    "              return;\n"
    "            }\n"
    "          }\n"
    "        }\n"
    "      );"
)
new_radial_left_plus_chat = (
    "            if (actionId === 'radial:left') {\n"
    "              const tab = vrHudRef.current?.radialTab ?? 'general';\n"
    "              if (tab === 'general') {\n"
    "                setLaserEnabled((v) => !v);\n"
    "              } else {\n"
    "                // Collision toggle is owned by ManipulationManager.\n"
    "                manipulationManagerRef.current?.toggleCollision();\n"
    "              }\n"
    "              return;\n"
    "            }\n"
    "            // === VR 3D chat send ===\n"
    "            // The VR chat panel alphabet grid accumulates characters in\n"
    "            // VRHUDManager._chatInputBuffer; the SEND button on that grid\n"
    "            // bubbles 'chat.send:<text>' here. Forward to the network\n"
    "            // and ask the manager to clear its buffer (the clear fires\n"
    "            // a redraw so the buffer strip empties on the next frame).\n"
    "            if (actionId.startsWith('chat.send:')) {\n"
    "              const text = actionId.substring('chat.send:'.length);\n"
    "              if (text.length > 0) {\n"
    "                networkServiceRef.current.sendChatMessage(text);\n"
    "                vrHudRef.current?.clearChatInput();\n"
    "              }\n"
    "              return;\n"
    "            }\n"
    "          }\n"
    "        }\n"
    "      );"
)
assert old_radial_left in c, 'radial:left handler tail not found'
c = c.replace(old_radial_left, new_radial_left_plus_chat)

# --- (F) chatMessages in setDataContext push --------------------------
# Find the setDataContext call and inject chatMessages BEFORE the closing ).
old_sdc_close = (
    "      grabMode,\n"
    "    });\n"
    "  }, [\n"
)
new_sdc_close = (
    "      grabMode,\n"
    "      // Rolling chat-message buffer (mirrors VRHUDManager's own\n"
    "      // _recentMessages). Without this in the context, the VR\n"
    "      // Chat Panel canvas would not redraw with new arrivals.\n"
    "      chatMessages,\n"
    "    });\n"
    "  }, [\n"
)
assert old_sdc_close in c, 'setDataContext closing + deps array start not found'
c = c.replace(old_sdc_close, new_sdc_close)

# Also include chatMessages in the deps array (one of the deps). Will
# add it right after `grabMode,` if `grabMode,` is present there.
old_deps_tail = (
    "    scalingEnabled,\n"
    "    laserEnabled,\n"
    "    grabMode,\n"
    "  ]);"
)
new_deps_tail = (
    "    scalingEnabled,\n"
    "    laserEnabled,\n"
    "    grabMode,\n"
    "    chatMessages,\n"
    "  ]);"
)
assert old_deps_tail in c, 'setDataContext effect deps tail not found'
c = c.replace(old_deps_tail, new_deps_tail)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('App.tsx VR chat wiring applied: OK')
print('New line count:', c.count(chr(10)) + 1)
