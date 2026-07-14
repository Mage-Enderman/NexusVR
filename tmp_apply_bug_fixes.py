"""Apply two bug fixes to the inspector multiplayer sync.

ROOT CAUSES (verified by reading NetworkService.ts + SceneInspectorWindow.tsx
+ App.tsx and tracing the receive site end-to-end):
- Receive chain in NetworkService.ts is correct: 'inspector' envelope
  fires `onInspectorUpdateCallbacks(env.payload as InspectorUpdateData)`.
- App.tsx's receive handler at the `// Apply generic inspector updates`
  block correctly does `targetNode.visible = update.active`.
- BUT: SceneInspectorWindow's `useState(active|persistent|meshEnabled)`
  initial values are set ONCE in a useEffect keyed on `[selectedAsset?.id]`.
  The receive site does `setSelectedAsset({...asset})` (spread — same id,
  new ref), so React's dep diff sees no change → the inspector's
  useEffect never re-runs → the checkbox state stays stale even though
  the THREE.js scene DID update (asset visually disappears).
  Peers see the asset hide/show but their UI checkbox stays wrong,
  which they perceive as "Active doesn't sync."

Fix: add a new useEffect with no deps that runs after every render
and reconciles active|persistent|meshEnabled with the Three.js source
of truth (object3d.visible, userData.isPersistent, mesh-vis child
traverse). Cheap (~5 lines + traverse), runs at most a few times per
second on inspector open. setState to same value is a React no-op so
no render thrash.

Bug 2: When the host CHANGES the inspected asset while the inspector
is already open, panelstate is never re-broadcast — peers keep their
inspector pinned to the originally-opened asset. openInspectorFromLocal
broadcasts once on initial open; there's no follow-on broadcast on
in-flight selection changes.

Fix: add a useEffect that fires whenever `selectedAsset?.id` transitions
AND the inspector is open. The receive handler's existing echo guard
drops our own broadcast, so the duplicate broadcast on initial open is
harmless apart from one wasted envelope.
"""
from pathlib import Path

ins = Path("src/components/SceneInspectorWindow.tsx").read_text(encoding="utf-8")
app = Path("src/App.tsx").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# FIX 1 — SceneInspectorWindow: mirror Three.js → React state on every render
# ---------------------------------------------------------------------------
# Anchor on the existing initial-mount useEffect's last lines — after the
# setMeshEnabled(hasVisibleMesh) call and before the closing }, [selectedAsset?.id]).
# We insert a NEW useEffect (no deps) just after the existing one. The new
# effect reads object3d.visible, userData.isPersistent, and child-mesh
# visibility every render so changes from peer-side broadcasts (which
# trigger parent setSelectedAsset({...asset}) → re-render → dep diff sees
# the new spread ref) flow back into the checkbox state.

ins_old = (
    "    const hasVisibleMesh = selectedAsset.object3d.children.some((c) => (c as THREE.Mesh).isMesh && c.visible);\n"
    "    setMeshEnabled(hasVisibleMesh);\n"
    "\n"
    "    const p = selectedAsset.object3d.position;\n"
    "    const r = selectedAsset.object3d.rotation;\n"
    "    const s = selectedAsset.object3d.scale;\n"
    "    setPos({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)), z: Number(p.z.toFixed(4)) });\n"
    "    setRot({\n"
    "      x: Number(THREE.MathUtils.radToDeg(r.x).toFixed(2)),\n"
    "      y: Number(THREE.MathUtils.radToDeg(r.y).toFixed(2)),\n"
    "      z: Number(THREE.MathUtils.radToDeg(r.z).toFixed(2))\n"
    "    });\n"
    "    setScale({ x: Number(s.x.toFixed(4)), y: Number(s.y.toFixed(4)), z: Number(s.z.toFixed(4)) });\n"
    "    // eslint-disable-next-line react-hooks/exhaustive-deps\n"
    "  }, [selectedAsset?.id]);\n"
)
ins_new = (
    "    const hasVisibleMesh = selectedAsset.object3d.children.some((c) => (c as THREE.Mesh).isMesh && c.visible);\n"
    "    setMeshEnabled(hasVisibleMesh);\n"
    "\n"
    "    const p = selectedAsset.object3d.position;\n"
    "    const r = selectedAsset.object3d.rotation;\n"
    "    const s = selectedAsset.object3d.scale;\n"
    "    setPos({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)), z: Number(p.z.toFixed(4)) });\n"
    "    setRot({\n"
    "      x: Number(THREE.MathUtils.radToDeg(r.x).toFixed(2)),\n"
    "      y: Number(THREE.MathUtils.radToDeg(r.y).toFixed(2)),\n"
    "      z: Number(THREE.MathUtils.radToDeg(r.z).toFixed(2))\n"
    "    });\n"
    "    setScale({ x: Number(s.x.toFixed(4)), y: Number(s.y.toFixed(4)), z: Number(s.z.toFixed(4)) });\n"
    "    // eslint-disable-next-line react-hooks/exhaustive-deps\n"
    "  }, [selectedAsset?.id]);\n"
    "\n"
    '  // External-state reconcile (Bug fix - "active toggle doesn\'t sync to peers").\n'
    "  // The receive site in App.tsx sets `selectedAsset = {...asset}` on every\n"
    "  // peer-side inspector envelope, which IS the right side-effect for\n"
    "  // re-rendering this inspector with the new asset ref. But the existing\n"
    "  // useState initial-sync above is keyed on `[selectedAsset?.id]`, which\n"
    "  // DOESN'T change after a spread — so a remote broadcast that toggles\n"
    "  // active toggles the Three.js scene correctly, but never refreshes our\n"
    "  // checkbox state. This effect (with no deps, so it runs after every\n"
    "  // render) reads the Three.js source of truth and reconciles the three\n"
    "  // externally-mutated UI flags. setState to the same value is a React\n"
    "  // no-op so we don't trigger render thrash.\n"
    "  useEffect(() => {\n"
    "    if (!selectedAsset) return;\n"
    "    setActive(selectedAsset.object3d.visible);\n"
    "    const ud = selectedAsset.object3d.userData as Record<string, unknown>;\n"
    "    setPersistent((ud?.isPersistent as boolean | undefined) ?? true);\n"
    "    let visibleMesh = false;\n"
    "    selectedAsset.object3d.traverse((c) => {\n"
    "      if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).visible) visibleMesh = true;\n"
    "    });\n"
    "    setMeshEnabled(visibleMesh);\n"
    "  });\n"
)
assert ins.count(ins_old) == 1, f"SceneInspectorWindow anchor: expected 1 match, got {ins.count(ins_old)}"
ins = ins.replace(ins_old, ins_new)
Path("src/components/SceneInspectorWindow.tsx").write_text(ins, encoding="utf-8")
print(f"OK inspector external-state reconcile added (file_size_chars={len(ins)})")


# ---------------------------------------------------------------------------
# FIX 2 — App.tsx: broadcast panelstate on host selection-change while open
# ---------------------------------------------------------------------------
# Anchor: insert just AFTER `openInspectorFromLocal`'s closing brace and
# BEFORE `closeInspectorFromLocal`'s opening (line ~287 in the file). Add
# a useEffect that broadcasts panelstate 'open' whenever selectedAsset.id
# transitions AND the inspector is open. Receive handler in App.tsx is
# already id-aware (re-targets selectedAsset to payload.targetAssetId),
# so peers' inspectors will follow the host's selections live.
app_old = (
    "  const closeInspectorFromLocal = () => {\n"
)
app_new = (
    "  // Bug fix — selection sync to peers. openInspectorFromLocal above\n"
    "  // broadcasts panelstate 'open' once on the initial open, but if the\n"
    "  // host clicks a DIFFERENT asset while the inspector is already open\n"
    "  // nothing re-broadcasts — peers' inspectors stay pinned to the\n"
    "  // originally-opened asset. This effect fires on every selectedAsset\n"
    "  // transition while the inspector is open, so peers' inspectors\n"
    "  // follow live. Receive handler's echo-suppression (drops envelopes\n"
    "  // whose originatorPeerId === localPeerId) makes the redundant open\n"
    "  // broadcast on initial mount harmless apart from one envelope byte.\n"
    "  useEffect(() => {\n"
    "    if (!showSceneInspector) return;\n"
    "    if (!selectedAsset) return;\n"
    "    const ns = networkServiceRef.current;\n"
    "    if (!ns || ns.mode === 'offline') return;\n"
    "    ns.broadcastPanelState({\n"
    "      action: 'open',\n"
    "      panelId: 'inspector',\n"
    "      originatorPeerId: ns.localPeerId,\n"
    "      originatorUserName: localUserName,\n"
    "      originatorRole: localRole,\n"
    "      targetAssetId: selectedAsset.id,\n"
    "      ts: Date.now(),\n"
    "    });\n"
    "  }, [selectedAsset?.id, showSceneInspector]);\n"
    "\n"
    "  const closeInspectorFromLocal = () => {\n"
)
# Match must check for showSceneInspector declared at module scope (it
# is, from earlier grep). We use the anchor "closeInspectorFromLocal"
# which is unique to ONE occurrence.
assert app.count(app_old) == 1, f"App.tsx closeInspectorFromLocal anchor: expected 1 match, got {app.count(app_old)}"
app = app.replace(app_old, app_new, 1)
Path("src/App.tsx").write_text(app, encoding="utf-8")
print(f"OK app selection-sync effect added (file_size_chars={len(app)})")
