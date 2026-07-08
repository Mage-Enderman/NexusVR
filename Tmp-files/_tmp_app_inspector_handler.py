#!/usr/bin/env python3
# App.tsx edits: add `selectedAssetRef` mirror, sync effect, and a
# `applyInspectorEdit` function that the existing `onPanelAction`
# dispatcher routes 30+ `inspect.*` actions through. Each handler
# mutates the selected THREE object3d + material, sets
# material.needsUpdate where required, updates React state
# (`setSelectedAsset({...sel})` triggers the existing setDataContext
# effect), broadcasts via `networkService.broadcastAssetUpdate`, and
# refreshes the manipulation gizmo so it snaps to the new pose.
#
# Three.js gotchas handled (per thinker verdict):
#   - Wireframe / flatShading toggles need `material.needsUpdate = true`
#   - Color edits use `material.color.set()` semantics via direct
#     clamped channel writes
#   - Rotation step is in RADIANS (THREE.Object3D.rotation is radians);
#     the panel draws DEGREES — both sides agree on step=PI/12 (15deg)
#   - CENTER PIVOT translates each child mesh's geometry AND offsets
#     object3d.position by the inverse to preserve the visible world pose
import re, sys
path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# ---- (1) Inject `selectedAssetRef` useRef right after inventoryItemsRef ----
old_ref = """  const inventoryItemsRef = useRef<InventoryItem[]>([]);"""
new_ref = """  const inventoryItemsRef = useRef<InventoryItem[]>([]);
  // Mirror of `selectedAsset` state held in a ref so App.tsx's
  // inspect.* action dispatcher (a useEffect-closure callback) can
  // read the LIVE currently-selected asset instead of the
  // engine-init-time value. Same pattern as `inventoryItemsRef`,
  // `showRadialMenuRef`, `locomotionModeRef` above. Synced by the
  // mirror useEffect further below.
  const selectedAssetRef = useRef<LoadedAsset | null>(null);"""
if old_ref not in c:
    sys.exit('inventoryItemsRef anchor missing')
c = c.replace(old_ref, new_ref, 1)

# ---- (2) Inject sync effect somewhere reasonable. Use the
#         showRadialMenuRef sync block as the anchor.
old_sync = """  useEffect(() => {
    showRadialMenuRef.current = showRadialMenu;
  }, [showRadialMenu]);"""
new_sync = """  useEffect(() => {
    showRadialMenuRef.current = showRadialMenu;
  }, [showRadialMenu]);
  // Sync selectedAssetRef mirror so closure-bound dispatchers (the
  // engine-init useEffect's onPanelAction that handles inspect.*)
  // see the LIVE selectedAsset rather than the engine-init-time null.
  useEffect(() => {
    selectedAssetRef.current = selectedAsset;
  }, [selectedAsset]);"""
if old_sync not in c:
    sys.exit('showRadialMenuRef sync anchor missing')
c = c.replace(old_sync, new_sync, 1)

# ---- (3) Insert applyInspectorEdit dispatcher + helpers INSIDE the
#         engine-init useEffect's onPanelAction callback, right at
#         the closing of the inner arrow body.
#
# Anchor: the closing of the chat.send handler (we IMMEDIATELY follow
# the chat.send branch). Insertion point = right after `            }`
# that closes chat.send's `if`, and before the inner arrow function
# closes (`          }`).
old_chat_anchor = """            if (actionId.startsWith('chat.send:')) {
              const text = actionId.substring('chat.send:'.length);
              if (text.length > 0) {
                networkServiceRef.current.sendChatMessage(text);
                vrHudRef.current?.clearChatInput();
              }
              return;
            }
          }
        }
      );"""

inspect_block = r"""
            // === Inspector edits (sys-inspector panel) ===
            // Mirror of the desktop SceneInspectorWindow's
            // onUpdateAsset + handleUpdateMaterial handlers. Routes
            // 30+ `inspect.*` actions dispatched by the canvas-rendered
            // VR inspector.
            //
            // Each successful edit:
            //   1) Mutates selectedAsset.object3d (and material where
            //      applicable) directly via THREE Object3D / Material
            //      APIs. Three.js requires `material.needsUpdate` to
            //      be set after wireframe / flatShading toggles +
            //      emissiveIntensity changes.
            //   2) Bumps the React state via `setSelectedAsset({...sel})`
            //      so the existing setDataContext effect pushes the
            //      updated asset to VRHUDManager (and the desktop
            //      SceneInspectorWindow re-renders).
            //   3) Broadcasts via `networkService.broadcastAssetUpdate`
            //      so peers see the edit (no-op when offline).
            //   4) Refreshes the manipulation gizmo via
            //      `manipulationManager.selectAsset(sel)` so its
            //      handles snap to the new pose (otherwise the gizmo
            //      drifts away from the edited object).
            //   5) Force-redraws the VRHUDManager panel via
            //      `vrHud.redrawPanel()` so the displayed values
            //      reflect the new state on the immediately-following
            //      frame (instead of waiting for the next setDataContext
            //      round-trip).
            if (actionId.startsWith('inspect.')) {
              const sel = selectedAssetRef.current;
              if (sel?.object3d) {
                const o3d = sel.object3d;
                const three = (window as any).THREE ?? THREE;
                const mats: THREE.Material[] = [];
                o3d.traverse((c: THREE.Object3D) => {
                  const m = (c as THREE.Mesh).material;
                  if (m) {
                    if (Array.isArray(m)) mats.push(...m);
                    else mats.push(m as THREE.Material);
                  }
                });
                const mat0 = mats[0] ?? null;

                // apply post-edit housekeeping. Cheap; runs every time.
                const dirty = () => {
                  setSelectedAsset({ ...sel });
                  networkServiceRef.current?.broadcastAssetUpdate(sel);
                  manipulationManagerRef.current?.selectAsset?.(sel);
                  vrHudRef.current?.redrawPanel();
                };

                // ---- Toggles ----
                if (actionId === 'inspect.toggle:visible') {
                  o3d.visible = !o3d.visible;
                  dirty();
                  return;
                }
                if (actionId === 'inspect.toggle:active') {
                  const ud = o3d.userData as { active?: boolean };
                  ud.active = !(ud.active ?? true);
                  dirty();
                  return;
                }
                if (actionId === 'inspect.toggle:wireframe') {
                  for (const m of mats) {
                    m.wireframe = !m.wireframe;
                    m.needsUpdate = true;
                  }
                  dirty();
                  return;
                }
                if (actionId === 'inspect.toggle:flatShading') {
                  for (const m of mats) {
                    m.flatShading = !m.flatShading;
                    m.needsUpdate = true;
                  }
                  dirty();
                  return;
                }

                // ---- Transform steppers ----
                // IDs: 'inspect.transform:<pos|rot|scl>.<x|y|z><+|->'
                //   or  'inspect.transform:<pos|rot|scl>.<x|y|z>.reset'
                // The 0.1 step is in METRES for position / scale and in
                // RADIANS (pi/12 ≈ 15deg) for rotation, matching the
                // stepper copy in drawInspectorPanel.
                const STEP = 0.1;
                const ROT_STEP = Math.PI / 12;
                if (actionId.startsWith('inspect.transform:')) {
                  const tail = actionId.substring('inspect.transform:'.length);
                  if (tail === 'resetAll') {
                    o3d.position.set(0, 0, 0);
                    o3d.rotation.set(0, 0, 0);
                    o3d.scale.set(1, 1, 1);
                    dirty();
                    return;
                  }
                  if (tail === 'centerPivot') {
                    // Recenters child mesh geometries around 0,0,0 in
                    // o3d-local space and offsets o3d.position so the
                    // visible world pose is preserved.
                    const box = new THREE.Box3().setFromObject(o3d);
                    if (!box.isEmpty()) {
                      const center = new THREE.Vector3();
                      box.getCenter(center);
                      o3d.position.add(center);
                      o3d.children.forEach((c: THREE.Object3D) => {
                        const mesh = c as THREE.Mesh;
                        if (mesh.isMesh && mesh.geometry) {
                          mesh.geometry.translate(-center.x, -center.y, -center.z);
                        }
                      });
                    }
                    dirty();
                    return;
                  }
                  // per-axis pattern: 'pos.x+' | 'rot.y.reset' | ...
                  const m = /^([a-z]{3})\.([xyz])((\+|-)|\.reset)$/.exec(tail);
                  if (m) {
                    const kind = m[1] as 'pos' | 'rot' | 'scl';
                    const axis = m[2] as 'x' | 'y' | 'z';
                    const op = m[4] ?? m[5];
                    const target: any =
                      kind === 'pos' ? o3d.position :
                      kind === 'rot' ? o3d.rotation : o3d.scale;
                    if (op === '.reset' || op === true) {
                      target[axis] = kind === 'scl' ? 1 : 0;
                    } else {
                      const sign = op === '-' ? -1 : 1;
                      const delta = kind === 'rot' ? ROT_STEP : STEP;
                      target[axis] = (target[axis] as number) + sign * delta;
                    }
                    dirty();
                    return;
                  }
                }

                // ---- Material color (R / G / B) ----
                // IDs: inspect.material.color.<r|g|b>(+|-|reset)
                if (actionId.startsWith('inspect.material.color.')) {
                  const tail = actionId.substring('inspect.material.color.'.length);
                  const chan = tail[0] as 'r' | 'g' | 'b';
                  const op = tail.substring(1);
                  const delta = 5 / 255; // ~0.019
                  for (const m of mats) {
                    const c2 = m.color as THREE.Color;
                    if (op === 'reset') {
                      c2.setRGB(1, 1, 1);
                    } else {
                      const sign = op === '-' ? -1 : 1;
                      const cur = (c2 as any)[chan] as number;
                      const nv = Math.max(0, Math.min(1, cur + sign * delta));
                      (c2 as any)[chan] = nv;
                    }
                    m.needsUpdate = true;
                  }
                  dirty();
                  return;
                }

                // ---- Material scalar sliders ----
                // IDs: inspect.material.props:<prop>(+|.reset)
                //   where prop in roughness | metalness | opacity | emissive
                // 'emissive' maps to material.emissiveIntensity (0..5),
                // the others map to direct material properties (0..1).
                if (actionId.startsWith('inspect.material.props:')) {
                  const prop = actionId.substring('inspect.material.props:'.length);
                  const delta = 0.05;
                  // Parse op suffix
                  let p = prop; let op = '+';
                  if (prop.endsWith('.reset')) { p = prop.slice(0, -7); op = 'reset'; }
                  else { op = prop.slice(-1); p = prop.slice(0, -1); }
                  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
                  const clamp05 = (n: number) => Math.max(0, Math.min(5, n));
                  for (const m of mats) {
                    if (p === 'emissive') {
                      const mi = (m as any).emissiveIntensity as number ?? 1;
                      (m as any).emissiveIntensity = op === 'reset' ? 1 : clamp05(mi + (op === '-' ? -delta : delta));
                      m.needsUpdate = true;
                    } else if (p === 'roughness' || p === 'metalness' || p === 'opacity') {
                      const cur = (m as any)[p] as number ?? (p === 'opacity' ? 1 : 0);
                      (m as any)[p] = op === 'reset'
                        ? (p === 'opacity' ? 1 : 0.5)
                        : clamp01(cur + (op === '-' ? -delta : delta));
                      m.needsUpdate = true;
                    }
                  }
                  dirty();
                  return;
                }

                // ---- Slot actions ----
                if (actionId === 'inspect.destroy:selected') {
                  // handleDeleteSelected already does the right thing
                  // for the desktop inspector; reuse it. The inspector
                  // panel's `applyInspectorEdit` for destroy is
                  // routed through handleDeleteSelected so both VR and
                  // desktop pointed at the same selected asset take
                  // the same path (broadcast, undo/redo snapshot,
                  // selection-clear, ref disposal, etc.).
                  handleDeleteSelected();
                  return;
                }
                if (actionId === 'inspect.jumpTo:selected') {
                  // Teleport the camera to the asset's world position.
                  // No asset-state change -- just re-position the
                  // sceneEngine camera. We deliberately skip
                  // setSelectedAsset here because nothing on the
                  // selectedAsset changed (avoids spurious panel redraw).
                  const se = sceneEngineRef.current;
                  if (se) {
                    const worldPos = new THREE.Vector3();
                    o3d.getWorldPosition(worldPos);
                    se.camera.position.copy(worldPos);
                  }
                  return;
                }
                if (actionId === 'inspect.bringTo:camera') {
                  // Move the asset to the camera's world position.
                  // Use camera-local forward offset (-2m in camera Z)
                  // so the asset doesn't appear inside the camera.
                  const se = sceneEngineRef.current;
                  if (se) {
                    const camPos = new THREE.Vector3();
                    se.camera.getWorldPosition(camPos);
                    const camDir = new THREE.Vector3();
                    se.camera.getWorldDirection(camDir);
                    const TARGET_AHEAD = 2.0;
                    o3d.position.copy(camPos).addScaledVector(camDir, TARGET_AHEAD);
                    dirty();
                  }
                  return;
                }

                // ---- Hierarchy actions ----
                if (actionId === 'inspect.hierarchy:wrap') {
                  // Wrap o3d in a fresh empty THREE.Group, preserving
                  // o3d's world transform via Group.attach() (which
                  // copies the world matrix into the new parent).
                  const grp = new THREE.Group();
                  grp.name = o3d.name + ' Group';
                  const parent = o3d.parent;
                  if (parent) {
                    parent.add(grp);
                    grp.attach(o3d);
                  }
                  dirty();
                  return;
                }
                if (actionId === 'inspect.hierarchy:addChild') {
                  // Inject an empty THREE.Group as a direct child, so
                  // the user can drag children into it. The empty
                  // group is created at world origin; subsequent edits
                  // can move it via the transform stepper.
                  const grp = new THREE.Group();
                  grp.name = (o3d.name || 'Asset') + ' Child';
                  o3d.add(grp);
                  dirty();
                  return;
                }
                if (actionId === 'inspect.hierarchy:parentToWorld') {
                  // Reparent o3d to the scene's world root (the
                  // 'worldRoot' group that wraps VR-inverse-treadmill
                  // and locomotion translation). Using attach()
                  // preserves world transform.
                  const se = sceneEngineRef.current;
                  if (se?.worldRoot) {
                    se.worldRoot.attach(o3d);
                    dirty();
                  }
                  return;
                }

                // ---- Rename cycle ----
                if (actionId === 'inspect.rename:cycle') {
                  // Walk through 'A','B','C','D','E','F','9' suffixes
                  // applied to the existing base name. The desktop
                  // uses an actual text input; VR uses cycling because
                  // a 26-key alphabet grid would consume too much of
                  // the canvas panel (the chat grid already eats ~40%
                  // of the panel for the same reason).
                  const cycle = ['A', 'B', 'C', 'D', 'E', 'F', '9'] as const;
                  const baseName = (sel.name ?? o3d.name ?? 'Asset').trim();
                  const m2 = /^(.*?)\s*\(?([A-F9]?)\)?\s*$/.exec(baseName);
                  const base = m2 ? m2[1].trim() : baseName;
                  const curIdx = m2 && m2[2] ? cycle.indexOf(m2[2] as any) : -1;
                  const nextIdx = (curIdx + 1) % cycle.length;
                  const newName = `${base} (${cycle[nextIdx]})`;
                  sel.name = newName;
                  o3d.name = newName;
                  dirty();
                  return;
                }
              }
            }
"""

new_chat_anchor = old_chat_anchor.replace(
    """            if (actionId.startsWith('chat.send:')) {
              const text = actionId.substring('chat.send:'.length);
              if (text.length > 0) {
                networkServiceRef.current.sendChatMessage(text);
                vrHudRef.current?.clearChatInput();
              }
              return;
            }
          }
        }
      );""",
    inspect_block + """
            if (actionId.startsWith('chat.send:')) {
              const text = actionId.substring('chat.send:'.length);
              if (text.length > 0) {
                networkServiceRef.current.sendChatMessage(text);
                vrHudRef.current?.clearChatInput();
              }
              return;
            }
          }
        }
      );"""
)

if old_chat_anchor not in c:
    sys.exit('chat.send anchor missing -- cannot insert inspector block')
c = c.replace(old_chat_anchor, new_chat_anchor, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('OK: selectedAssetRef + sync + applyInspectorEdit block inserted.')
