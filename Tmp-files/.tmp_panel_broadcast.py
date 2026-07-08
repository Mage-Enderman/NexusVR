#!/usr/bin/env python3
"""
Patch App.tsx for the panel-broadcast feature.

  Edit A — add originator state, helper useCallbacks, and interactive
           permission derivation directly after the existing
           showSceneInspector declaration.
  Edit B — add the receive handler in the same disposers area where
           other net.on* subscriptions live (anchored on
           `disposers.push(net.onVideoState(` for uniqueness).
  Edit C — wrap setShowSceneInspector / setShowImportDialog calls.
  Edit D — pass new props to <SceneInspectorWindow> and
           <AssetImportDialog> JSX.

The script uses plain triple-quoted strings (NOT f-strings), so
JSX braces `{` / `}` inside the inserted text don't need escaping.
"""
import re
import sys

PICK_PATHS = ('App.tsx', 'src/App.tsx')
path = None
for p in PICK_PATHS:
    try:
        with open(p, 'r', encoding='utf-8') as f: src = f.read()
        path = p
        break
    except FileNotFoundError: continue
if path is None:
    sys.exit('App.tsx not found')

# ============================================================
# Edit A — originator state + helpers + interactive derivation
# ============================================================
A_ANCHOR = "  const [showSceneInspector, setShowSceneInspector] = useState<boolean>(false);"
A_MARKER = 'PANEL_BROADCAST_SETUP'
if A_ANCHOR not in src:
    sys.exit('FATAL: Edit A anchor (showSceneInspector state) not found')
if A_MARKER in src:
    print('Edit A: setup already present (skipped)')
else:
    A_BLOCK = (
        "\n\n  " + A_MARKER + " \u2014 shared panel state + helpers for the Inspector"
        "\n  // and AssetImportDialog panels. WE open \u2192 broadcast panelstate"
        "\n  // 'open' to peers. WE close \u2192 broadcast 'close' ONLY when we are"
        "\n  // the originator (peers that hide their mirror locally must NOT"
        "\n  // echo a close, that would race-condition with the originator's"
        "\n  // intent and could prematurely close the originator's panel from"
        "\n  // a peer's POV). Receive handlers live in the disposers area"
        "\n  // below so they're wired alongside the other network subscriptions."
        "\n  type PanelOriginator = { peerId: string; userName?: string; role?: 'admin' | 'builder' | 'moderator' | 'guest' | 'spectator' };"
        "\n  const [inspectorPanelOriginator, setInspectorPanelOriginator] = useState<PanelOriginator | null>(null);"
        "\n  const [importPanelOriginator, setImportPanelOriginator] = useState<PanelOriginator | null>(null);"
        "\n"
        "\n  const openInspectorFromLocal = (opts?: { targetAssetId?: string | null }) => {"
        "\n    setShowSceneInspector(true);"
        "\n    const ns = networkServiceRef.current;"
        "\n    const originatorId = ns?.localPeerId ?? '__local__';"
        "\n    setInspectorPanelOriginator({ peerId: originatorId, userName: localUserName, role: localRole });"
        "\n    if (ns && ns.mode !== 'offline' && originatorId !== '__local__') {"
        "\n      ns.broadcastPanelState({"
        "\n        action: 'open',"
        "\n        panelId: 'inspector',"
        "\n        originatorPeerId: originatorId,"
        "\n        originatorUserName: localUserName,"
        "\n        originatorRole: localRole,"
        "\n        targetAssetId: opts?.targetAssetId ?? selectedAsset?.id ?? null,"
        "\n        ts: Date.now(),"
        "\n      });"
        "\n    }"
        "\n  };"
        "\n  const closeInspectorFromLocal = () => {"
        "\n    setShowSceneInspector(false);"
        "\n    const ns = networkServiceRef.current;"
        "\n    if (inspectorPanelOriginator?.peerId === ns?.localPeerId && ns && ns.mode !== 'offline') {"
        "\n      ns.broadcastPanelState({"
        "\n        action: 'close',"
        "\n        panelId: 'inspector',"
        "\n        originatorPeerId: ns.localPeerId,"
        "\n        ts: Date.now(),"
        "\n      });"
        "\n    }"
        "\n    setInspectorPanelOriginator(null);"
        "\n  };"
        "\n  const openImportFromLocal = () => {"
        "\n    setShowImportDialog(true);"
        "\n    const ns = networkServiceRef.current;"
        "\n    const originatorId = ns?.localPeerId ?? '__local__';"
        "\n    setImportPanelOriginator({ peerId: originatorId, userName: localUserName, role: localRole });"
        "\n    if (ns && ns.mode !== 'offline' && originatorId !== '__local__') {"
        "\n      ns.broadcastPanelState({"
        "\n        action: 'open',"
        "\n        panelId: 'import',"
        "\n        originatorPeerId: originatorId,"
        "\n        originatorUserName: localUserName,"
        "\n        originatorRole: localRole,"
        "\n        ts: Date.now(),"
        "\n      });"
        "\n    }"
        "\n  };"
        "\n  const closeImportFromLocal = () => {"
        "\n    setShowImportDialog(false);"
        "\n    const ns = networkServiceRef.current;"
        "\n    if (importPanelOriginator?.peerId === ns?.localPeerId && ns && ns.mode !== 'offline') {"
        "\n      ns.broadcastPanelState({"
        "\n        action: 'close',"
        "\n        panelId: 'import',"
        "\n        originatorPeerId: ns.localPeerId,"
        "\n        ts: Date.now(),"
        "\n      });"
        "\n    }"
        "\n    setImportPanelOriginator(null);"
        "\n  };"
        "\n"
        "\n  // Permission gates for shared-panel interactivity. Per the design"
        "\n  // analysis recommendation E: gate entirely on the LOCAL role (via"
        "\n  // ROLE_PERMISSIONS); the originator's role does NOT augment peer"
        "\n  // permissions \u2014 peers don't get admin powers just because an admin"
        "\n  // opened a panel. The originator themselves also passes the gate"
        "\n  // because they intentionally opened the panel."
        "\n  // 'admin' / 'builder' gate on canEditWorld for inspector edits;"
        "\n  // 'admin' / 'builder' / 'guest' gate on canSpawnItems for import."
        "\n  const localPerms = ROLE_PERMISSIONS[localRole] || ROLE_PERMISSIONS.guest;"
        "\n  const inspectorInteractiveEnabled = !!localPerms?.canEditWorld;"
        "\n  const importInteractiveEnabled = !!localPerms?.canSpawnItems;"
        "\n  // Originator-header JSX (only rendered when the panel is a peer's"
        "\n  // mirror). On the originator's own view this collapses to \u201Cnull\u201D so"
        "\n  // the panel-body banner doesn't show a confusing 'shared by me' line."
        "\n  const myPeerId = networkServiceRef.current?.localPeerId;"
        "\n  const inspectorPanelOriginatorHeader = (inspectorPanelOriginator && inspectorPanelOriginator.peerId !== myPeerId)"
        "\n    ? (<>Inspector: shared by <span className='text-cyan-200 font-bold'>{inspectorPanelOriginator.userName || 'peer'}</span></>)"
        "\n    : null;"
        "\n  const importPanelOriginatorHeader = (importPanelOriginator && importPanelOriginator.peerId !== myPeerId)"
        "\n    ? (<>Import: shared by <span className='text-cyan-200 font-bold'>{importPanelOriginator.userName || 'peer'}</span></>)"
        "\n    : null;\n"
    )
    src = src.replace(A_ANCHOR, A_ANCHOR + A_BLOCK, 1)
    print('Edit A: originator state + helpers + derivation added')

# ============================================================
# Edit B — receive handler in the disposers area
# ============================================================
B_ANCHOR = "disposers.push(net.onRoleUpdate("
B_MARKER = 'PANEL_BROADCAST_RECEIVE'
if B_MARKER in src:
    print('Edit B: receiver already present (skipped)')
elif B_ANCHOR not in src:
    sys.exit('FATAL: Edit B anchor (net.onRoleUpdate) not found')
else:
    B_BLOCK = (
        "    " + B_MARKER + " \u2014 receive a peer's 'panelstate' envelope and mirror the\n"
        "    // panel-open state locally. Echo guard first: every browser\n"
        "    // receives its OWN broadcasts back through the DataConnection\n"
        "    // round-trip; if originPeerId === localPeerId we drop the\n"
        "    // envelope so the local openInspectorFromLocal/initializer is\n"
        "    // the single source of truth.\n"
        "    disposers.push(net.onPanelState((payload) => {\n"
        "      if (payload.originatorPeerId === networkServiceRef.current?.localPeerId) return;\n"
        "      if (payload.panelId === 'inspector') {\n"
        "        if (payload.action === 'open') {\n"
        "          if (payload.targetAssetId) {\n"
        "            const am = assetManagerRef.current;\n"
        "            const asset = am?.assets.get(payload.targetAssetId);\n"
        "            if (asset) {\n"
        "              setSelectedAsset(asset);\n"
        "            }\n"
        "          }\n"
        "          setInspectorPanelOriginator({ peerId: payload.originatorPeerId, userName: payload.originatorUserName, role: payload.originatorRole });\n"
        "          setShowSceneInspector(true);\n"
        "        } else {\n"
        "          setShowSceneInspector(false);\n"
        "          setInspectorPanelOriginator(null);\n"
        "        }\n"
        "      } else if (payload.panelId === 'import') {\n"
        "        if (payload.action === 'open') {\n"
        "          setImportPanelOriginator({ peerId: payload.originatorPeerId, userName: payload.originatorUserName, role: payload.originatorRole });\n"
        "          setShowImportDialog(true);\n"
        "        } else {\n"
        "          setShowImportDialog(false);\n"
        "          setImportPanelOriginator(null);\n"
        "        }\n"
        "      }\n"
        "    }));\n"
        "    "
    )
    src = src.replace(B_ANCHOR, B_BLOCK + B_ANCHOR, 1)
    print('Edit B: receiver inserted')

# ============================================================
# Edit C — wrap setShow* calls (assignments + toggles)
# ============================================================
C_count = 0
C_count += src.count('setShowSceneInspector(true)')
C_count += src.count('setShowSceneInspector(false)')
src = src.replace('setShowSceneInspector(true)', 'openInspectorFromLocal()')
src = src.replace('setShowSceneInspector(false)', 'closeInspectorFromLocal()')
src = re.sub(r"setShowSceneInspector\(\(prev\) => !prev\)",
             r"showSceneInspector ? closeInspectorFromLocal() : openInspectorFromLocal()",
             src)
src = src.replace('setShowImportDialog(true)', 'openImportFromLocal()')
src = src.replace('setShowImportDialog(false)', 'closeImportFromLocal()')
src = re.sub(r"setShowImportDialog\(\(prev\) => !prev\)",
             r"showImportDialog ? closeImportFromLocal() : openImportFromLocal()",
             src)
# Also broadcast for FileImportModal (separate state var, same logical import flow).
# Both AssetImportDialog and FileImportModal reference importPanelOriginator /
# importInteractiveEnabled + share panelId='import' on the wire.
src = src.replace('setShowImportModal(true)', 'openImportFromLocal()')
src = src.replace('setShowImportModal(false)', 'closeImportFromLocal()')
src = re.sub(r"setShowImportModal\(\(prev\) => !prev\)",
             r"showImportModal ? closeImportFromLocal() : openImportFromLocal()",
             src)
print(f'Edit C: {C_count} setShow* callsites rewired (count before substitution)')

# ============================================================
# Edit D — pass new props to existing JSX blocks
# ============================================================
SIW_ANCHOR = '<SceneInspectorWindow\n'
if SIW_ANCHOR in src and 'targetObject={selectedAsset?.object3d ?? undefined}' not in src:
    SIW_NEW = (
        SIW_ANCHOR +
        # key={selectedAsset?.id ?? 'inspector-empty'} forces a full
        # remount when the inspected asset changes. The
        # SpatialPopUpWrapper.useEffect inside
        # SceneInspectorWindow does NOT include parentObject in its
        # dep list (a parentObject dep would recreate the panel on every
        # render where selectedAsset?.object3d's identity changes,
        # including gizmo drags), so without this key the panel stays
        # parented to the FIRST selected asset even after the user picks
        # a different one. The key reassigns selectedAsset?.id changes
        # to a full unmount, taking the dispose + re-mount cost exactly
        # once per asset change.
        '        key={selectedAsset?.id ?? "inspector-empty"}\n'
        '        targetObject={selectedAsset?.object3d ?? undefined}\n'
        '        interactivePermissionGranted={inspectorInteractiveEnabled}\n'
        '        originatorHeader={inspectorPanelOriginatorHeader}\n'
    )
    src = src.replace(SIW_ANCHOR, SIW_NEW, 1)
    print('Edit D1: SceneInspectorWindow JSX updated (key + 3 new props)')
elif 'targetObject={selectedAsset?.object3d ?? undefined}' in src:
    print('Edit D1: SceneInspectorWindow already updated (skipped)')

AID_ANCHOR = '<AssetImportDialog\n'
if AID_ANCHOR in src and 'interactivePermissionGranted' not in src:
    AID_NEW = (
        AID_ANCHOR +
        '        interactivePermissionGranted={importInteractiveEnabled}\n'
        '        originatorHeader={importPanelOriginatorHeader}\n'
    )
    src = src.replace(AID_ANCHOR, AID_NEW, 1)
    print('Edit D2: AssetImportDialog JSX updated')
else:
    print('Edit D2: AssetImportDialog already updated / not present (skipped)')

with open(path, 'w', encoding='utf-8') as f: f.write(src)
print(f'OK: wrote {path}')
