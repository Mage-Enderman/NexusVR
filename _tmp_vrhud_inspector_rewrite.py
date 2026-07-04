#!/usr/bin/env python3
# Replace VRHUDManager.drawInspectorPanel with a desktop-parity editor.
# The NEW implementation mirrors the layout in SceneInspectorWindow.tsx:
#   - Slot Header: name + JUMP / BRING / DESTROY
#   - Basic + Hierarchy + Parent: VISIBLE toggle, ACTIVE toggle, Cycle
#     Name, PARENT TO WORLD / WRAP IN GROUP / ADD CHILD GROUP,
#     Current parent (read-only)
#   - Transform: POS / ROT / SCL (X/Y/Z) with [-] [+] [reset] per axis,
#     RESET ALL, CENTER PIVOT
#   - Mesh Stats + Display: vertex/triangle/submesh/bone counts
#     (read-only), Wireframe toggle, FlatShading toggle, Visible toggle
#     (also lives here as a redundant convenience)
#   - Material: Color R/G/B [-] [+] [reset], Roughness / Metalness /
#     Opacity / Emissive [-] [+] [reset], Reset to white button
#
# All actions route through the existing onPanelAction dispatcher
# (which App.tsx's NEW `applyInspectorEdit` helper handles) using
# `inspect.<verb>:<target>:<op>`-style IDs that match the rest of
# the panel architecture (settings.resScale:1.5, env.atmosphere:...).
import sys
path = 'src/engine/VRHUDManager.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# ---- Locate the existing drawInspectorPanel block ----
# Match the entire method from declaration through the closing brace
# before the next sibling method (drawChatPanel). We anchor on the
# method header + the JSDoc-like comment footer to ensure we don't
# truncate mid-method.
start_anchor = """  /** Inspector panel: read-only scroll of mesh names in the scene. */
  private drawInspectorPanel("""
end_anchor = "  /**\n   * VR text chat panel. Pure-immersive-WebXR counterpart of the desktop"

start_idx = content.find(start_anchor)
end_idx = content.find(end_anchor)
if start_idx == -1:
    sys.exit('start anchor not found - aborting')
if end_idx == -1:
    sys.exit('end anchor not found - aborting')

# Remove the OLD block. The previous block ends with a newline followed
# by the chat-panel JSDoc anchor; preserve that boundary so the file
# remounts cleanly. Trim to end-of-method-closing-brace on its own line.
old_block = content[start_idx:end_idx]
# Inside the OLD block, find the last `}` that closes drawInspectorPanel.
# Strip everything from that point onward in the OLD block (and remove
# the leading NewLine so we get a clean `}`).
# Search for the LAST closing-brace that is at column-2 (method-scoped
# braces are indented 2 spaces in this file).
last_method_close = old_block.rfind('\n  }')
if last_method_close == -1:
    sys.exit('closing brace of drawInspectorPanel not found - aborting')
old_method = old_block[:last_method_close + len('\n  }')]

# ---- Build the NEW method ----
new_method = """  /**
   * Inspector panel: desktop-parity editor for the currently selected
   * asset. Layout (1024x768 canvas, top-down mirroring the right pane
   * of `SceneInspectorWindow.tsx`):
   *
   *   y=0..180   Standard chrome (BACK + CLOSE)
   *   y=190..254 SLOT HEADER  (name + JUMP / BRING / DESTROY)
   *   y=264..366 BASIC + HIERARCHY + PARENT
   *                 VISIBLE | ACTIVE | CYCLE RENAME
   *                 WRAP IN GROUP | ADD CHILD | PARENT TO WORLD
   *                 Current parent (read-only text)
   *   y=378..564 TRANSFORM    POS / ROT / SCL with [-] [+] [RESET] per
   *                           axis (3x3 grid of stepper cards), plus
   *                           a RESET ALL TRANSFORM and CENTER PIVOT
   *                           button at the bottom
   *   y=576..686 MESH STATS + DISPLAY
   *                           Counts (read-only) + Wireframe/FlatShading
   *                           toggles + Visible toggle (redundant with
   *                           Basic card, but matches desktop's
   *                           combined "Mesh Renderer" section)
   *   y=696..758 MATERIAL     R/G/B steppers + Roughness / Metalness /
   *                           Opacity / Emissive steppers + Reset All
   *
   * All field values are read-only display + stepper buttons;
   * direct text input isn't feasible in a 2D canvas at VR scale, so
   * the RENAME action cycles through a small preset list
   * (A,B,C,D,E,F,9) instead of opening an alphabet grid (the desktop
   * uses an actual input box; the desktop modal still works for power
   * users). Hierarchy uses 3 buttons (wrap/addChild/parentToWorld)
   * instead of a clickable recursive tree (the canvas hit-test would
   * be inconsistent and the desktop has a full tree on its LEFT pane).
   *
   * Action IDs follow the panel convention: `inspect.<verb>:<arg>`,
   * consumed by `applyInspectorEdit` in App.tsx. Most mutations
   * re-call `vrHud.redrawPanel()` synchronously so the next frame
   * already reflects the new value (the existing setDataContext
   * pipeline is too slow -- between the dispatcher's setSelectedAsset
   * and the next panel-context push the user can drift through 2-3
   * controllers of motion before the panel updates).
   */
  private drawInspectorPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    helper: PanelDrawHelper,
    data: PanelContext
  ): void {
    const bodyTop = helper.drawStandardChrome(
      'SCENE INSPECTOR',
      'Edit the currently selected asset (synced to peers)',
      '#06b6d4'
    );

    // No scene at all -> strong fallback so we never silently draw
    // broken rects over a missing render context.
    if (!data.sceneRoot) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '14px sans-serif';
      ctx.fillText(
        'Scene root not available. Open inspector on desktop for full tree.',
        40, bodyTop + 60
      );
      return;
    }

    const sel = data.selectedAsset;
    if (!sel) {
      // No selection: show an object browser (read-only) so the user
      // can still reach this panel usefully. Mirrors the desktop's
      // right-pane empty state which shows a "pick an object" hint.
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText('NO ASSET SELECTED', 40, bodyTop + 24);
      ctx.fillStyle = '#64748b'; ctx.font = '13px sans-serif';
      ctx.fillText(
        'Left grip + trigger on a 3D object to select it, then reopen this panel.',
        40, bodyTop + 50
      );
      // Mini object list so the panel still feels useful
      const meshes: Array<{ name: string; type: string }> = [];
      data.sceneRoot.traverse((c) => {
        const o = c as THREE.Object3D;
        const t =
          (c as THREE.Mesh).isMesh ? 'Mesh' :
          (c as THREE.PointLight).isLight ? 'Light' :
          (c as THREE.Line).isLine ? 'Line' :
          null;
        if (t && o.name) meshes.push({ name: o.name, type: t });
      });
      if (meshes.length === 0) {
        ctx.fillStyle = '#64748b'; ctx.font = '13px sans-serif';
        ctx.fillText('No named objects in scene.', 40, bodyTop + 90);
        return;
      }
      meshes.slice(0, 22).forEach((m, i) => {
        const y = bodyTop + 90 + i * 22;
        ctx.fillStyle = 'rgba(30,41,59,0.6)'; ctx.fillRect(40, y, w - 80, 20);
        ctx.fillStyle = '#94a3b8'; ctx.font = '12px monospace';
        ctx.fillText(`${m.name}  [${m.type}]`, 50, y + 14);
      });
      return;
    }

    // We have a selected asset -- render the editor. Pre-compute
    // commonly reused values for the layout below.
    const o3d = sel.object3d;
    const pos = o3d.position;
    const rot = o3d.rotation;
    const scl = o3d.scale;
    // Pick the FIRST material that has the requested property so color
    // edits apply to a visible material even if some children lack one.
    const mats: THREE.Material[] = [];
    o3d.traverse((c) => {
      const m = (c as THREE.Mesh).material;
      if (m) {
        if (Array.isArray(m)) mats.push(...m);
        else mats.push(m);
      }
    });
    const mat0 = mats[0] ?? null;
    const mesh0 =
      mats.length > 0
        ? (o3d.getObjectByProperty('isMesh', true) as THREE.Mesh | null)
        : null;
    const vertCount = mesh0?.geometry?.attributes?.position?.count ?? 0;
    const triCount = mesh0?.geometry?.index
      ? (mesh0.geometry.index.count / 3) | 0
      : (vertCount / 3) | 0;
    const submeshCount = mesh0?.geometry?.groups?.length ?? 1;
    // SkinnedMesh bone heuristic: count children whose userData.role === 'bone'
    // OR whose name starts with 'bone_'. Most GLTF importers expose bones via
    // the SkinnedMesh.skeleton.bones array if applicable.
    let boneCount = 0;
    const skinned = mesh0 as any;
    if (skinned?.isSkinnedMesh && skinned.skeleton?.bones) {
      boneCount = skinned.skeleton.bones.length;
    }

    // Small helper used by every section to draw a card backdrop.
    const drawCard = (top: number, bottom: number, title: string, accent: string) => {
      const cardH = bottom - top;
      ctx.fillStyle = 'rgba(8,10,18,0.55)';
      ctx.fillRect(40, top, w - 80, cardH);
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.strokeRect(40, top, w - 80, cardH);
      ctx.fillStyle = accent; ctx.font = 'bold 14px sans-serif';
      ctx.fillText(title.toUpperCase(), 50, top + 22);
    };

    // Smaller button helper used by every stepper in the panel.
    // label is centered; registers a clickable rect via helper.
    const drawBtn = (
      x: number, y: number, bw: number, bh: number,
      label: string, action: string,
      bg: string, fill: string, stroke: string
    ): void => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = stroke; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = fill;
      ctx.font = `bold ${Math.min(14, bh * 0.55) | 0}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + bw / 2, y + bh / 2);
      helper.registerButton({ x, y, w: bw, h: bh }, action);
    };

    // ===== SLOT HEADER (y 190..254) =====
    drawCard(190, 254, 'SLOT HEADER', '#a855f7');
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif';
    const headerName = (sel.name?.length ? sel.name : o3d.name || 'Unnamed').slice(0, 32);
    ctx.fillText(headerName, 56, 252);
    // 3 small action buttons stacked to the right of the header
    const headerBtnY = 208;
    const headerBtnH = 32;
    const headerBtnW = 100;
    let bx = w - 60 - headerBtnW;
    drawBtn(bx, headerBtnY,    headerBtnW, headerBtnH, 'JUMP TO',  'inspect.jumpTo:selected',  'rgba(0,240,255,0.18)', '#06b6d4', '#00f0ff');
    bx -= headerBtnW + 8;
    drawBtn(bx, headerBtnY,    headerBtnW, headerBtnH, 'BRING TO', 'inspect.bringTo:camera',  'rgba(168,85,247,0.18)', '#c084fc', '#a855f7');
    bx -= headerBtnW + 8;
    drawBtn(bx, headerBtnY,    headerBtnW, headerBtnH, 'DESTROY',  'inspect.destroy:selected','rgba(239,68,68,0.20)',  '#fca5a5', '#ef4444');

    // ===== BASIC + HIERARCHY + PARENT (y 264..366) =====
    drawCard(264, 366, 'BASIC PROPS + HIERARCHY', '#10b981');
    // Three toggle/cycle buttons across the top row
    const basicY = 290;
    const basicH = 36;
    const basicW = 220;
    let bsx = 56;
    // VISIBLE (toggle)
    const isVisibleVal = o3d.visible;
    drawBtn(
      bsx, basicY, basicW, basicH,
      isVisibleVal ? 'VISIBLE: ON' : 'VISIBLE: OFF',
      'inspect.toggle:visible',
      isVisibleVal ? 'rgba(16,185,129,0.20)' : 'rgba(30,41,59,0.7)',
      isVisibleVal ? '#34d399' : '#cbd5e1',
      isVisibleVal ? '#10b981' : '#475569'
    );
    bsx += basicW + 12;
    // ACTIVE (Three.js default active is `true`; userData.active is the
    // app's extension flag for "logs/spawn logic treats as alive")
    const isActiveVal = (o3d.userData as { active?: boolean }).active ?? true;
    drawBtn(
      bsx, basicY, basicW, basicH,
      isActiveVal ? 'ACTIVE: ON' : 'ACTIVE: OFF',
      'inspect.toggle:active',
      isActiveVal ? 'rgba(0,240,255,0.20)' : 'rgba(30,41,59,0.7)',
      isActiveVal ? '#06b6d4' : '#cbd5e1',
      isActiveVal ? '#00f0ff' : '#475569'
    );
    bsx += basicW + 12;
    // CYCLE RENAME  (steps  Asset -> Asset (A) -> ... -> Asset (F) -> Asset (9))
    drawBtn(
      bsx, basicY, basicW, basicH, 'CYCLE RENAME' + '\\u00a0' + '\\u21bb',
      'inspect.rename:cycle',
      'rgba(245,158,11,0.20)', '#fbbf24', '#f59e0b'
    );

    // Three hierarchy buttons across the bottom row + a read-only parent
    // line so the user knows what they're reparenting from.
    const hierY = 332;
    const hierH = 28;
    const hierW = 220;
    let hsx = 56;
    drawBtn(hsx, hierY, hierW, hierH, 'WRAP IN GROUP',    'inspect.hierarchy:wrap',       'rgba(168,85,247,0.20)', '#c084fc', '#a855f7');
    hsx += hierW + 12;
    drawBtn(hsx, hierY, hierW, hierH, 'ADD CHILD GROUP',  'inspect.hierarchy:addChild',   'rgba(168,85,247,0.20)', '#c084fc', '#a855f7');
    hsx += hierW + 12;
    drawBtn(hsx, hierY, hierW, hierH, 'PARENT TO WORLD',  'inspect.hierarchy:parentToWorld','rgba(168,85,247,0.20)', '#c084fc', '#a855f7');
    // Parent-name read-out (sits beneath the row, smaller font)
    const parentName = o3d.parent?.name || o3d.parent?.type || '\\u2014';
    ctx.fillStyle = '#64748b'; ctx.font = '12px sans-serif';
    ctx.fillText('Current parent: ' + (parentName.length > 30 ? parentName.slice(0,29) + '\\u2026' : parentName), 56, 378);

    // ===== TRANSFORM (y 378..564) =====
    drawCard(378, 564, 'TRANSFORM', '#06b6d4');
    // 3 rows x 3 cols grid. Each cell shows axis label + current value
    // + [-] [+] [reset] buttons at the right.
    const trStartY = 408;
    const trCellH = 38;
    const trGapY  = 4;
    const trGapX  = 12;
    const trColsW = (w - 80 - trGapX * 2) / 3;
    // rot is in radians for THREE.Object3D.rotation, but we DISPLAY degrees
    // (matches desktop SceneInspectorWindow).
    const fmtVal = (v: number, isRot: boolean): string =>
      isRot ? ((v * 180 / Math.PI).toFixed(0) + '\\u00b0') :
             v.toFixed(2);
    const rows = [
      {
        label: 'POS', prefix: 'pos', axis: 'x', get: () => pos.x, set: (v: number) => { pos.x = v; },
        alt: [
          { label: 'POS Y', prefix: 'pos', axis: 'y', get: () => pos.y, set: (v: number) => { pos.y = v; } },
          { label: 'POS Z', prefix: 'pos', axis: 'z', get: () => pos.z, set: (v: number) => { pos.z = v; } },
        ]
      },
      {
        label: 'ROT X', prefix: 'rot', axis: 'x', get: () => rot.x, set: (v: number) => { rot.x = v; },
        alt: [
          { label: 'ROT Y', prefix: 'rot', axis: 'y', get: () => rot.y, set: (v: number) => { rot.y = v; } },
          { label: 'ROT Z', prefix: 'rot', axis: 'z', get: () => rot.z, set: (v: number) => { rot.z = v; } },
        ]
      },
      {
        label: 'SCL X', prefix: 'scl', axis: 'x', get: () => scl.x, set: (v: number) => { scl.x = v; },
        alt: [
          { label: 'SCL Y', prefix: 'scl', axis: 'y', get: () => scl.y, set: (v: number) => { scl.y = v; } },
          { label: 'SCL Z', prefix: 'scl', axis: 'z', get: () => scl.z, set: (v: number) => { scl.z = v; } },
        ]
      },
    ];
    rows.forEach((row, r) => {
      const cells = [row, ...row.alt];
      cells.forEach((cell, c) => {
        const cx = 50 + c * (trColsW + trGapX);
        const cy = trStartY + r * (trCellH + trGapY);
        // card backdrop
        ctx.fillStyle = 'rgba(30,41,59,0.6)';
        ctx.fillRect(cx, cy, trColsW, trCellH);
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, trColsW, trCellH);
        // axis label
        ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px sans-serif';
        ctx.fillText(cell.label, cx + 8, cy + 14);
        // value
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 16px monospace';
        ctx.fillText(fmtVal(cell.get(), cell.prefix === 'rot'), cx + 8, cy + 30);
        // 3 small buttons at the right: [-] [+] [reset]
        const btnW = 32, btnH = 22;
        const btnY = cy + (trCellH - btnH) / 2;
        const btnsTotalW = btnW * 3 + 4;
        const buttonsX0 = cx + trColsW - btnsTotalW - 6;
        drawBtn(
          buttonsX0, btnY, btnW, btnH, '\\u2212',
          `inspect.transform:${cell.prefix}.${cell.axis}-`,
          'rgba(239,68,68,0.25)', '#fca5a5', '#ef4444'
        );
        drawBtn(
          buttonsX0 + btnW + 2, btnY, btnW, btnH, '+',
          `inspect.transform:${cell.prefix}.${cell.axis}+`,
          'rgba(16,185,129,0.25)', '#86efac', '#10b981'
        );
        drawBtn(
          buttonsX0 + btnW * 2 + 4, btnY, btnW, btnH, '\\u21ba',
          `inspect.transform:${cell.prefix}.${cell.axis}.reset`,
          'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8'
        );
      });
    });
    // Bottom row: RESET ALL TRANSFORM + CENTER PIVOT
    const trBottomY = trStartY + 3 * (trCellH + trGapY) + 6;
    const trBottomH = 32;
    const trBottomBtnW = (w - 80 - 12) / 2;
    drawBtn(
      56, trBottomY, trBottomBtnW, trBottomH, 'RESET ALL TRANSFORM',
      'inspect.transform:resetAll',
      'rgba(148,163,184,0.20)', '#e2e8f0', '#94a3b8'
    );
    drawBtn(
      56 + trBottomBtnW + 12, trBottomY, trBottomBtnW, trBottomH, 'CENTER PIVOT',
      'inspect.transform:centerPivot',
      'rgba(99,102,241,0.20)', '#a5b4fc', '#6366f1'
    );

    // ===== MESH STATS + DISPLAY (y 576..686) =====
    drawCard(576, 686, 'MESH STATS + DISPLAY', '#f59e0b');
    // Stats block (read-only) on the left half
    const statsX = 56, statsY = 600, statsRowH = 22, statsW = 240;
    ctx.fillStyle = 'rgba(15,23,42,0.65)';
    ctx.fillRect(statsX, statsY, statsW, 80);
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
    ctx.strokeRect(statsX, statsY, statsW, 80);
    const statRows: Array<[string, string]> = [
      ['Vertices',   vertCount.toLocaleString()],
      ['Triangles',  triCount.toLocaleString()],
      ['Submeshes',  String(submeshCount)],
      ['Bones',      boneCount ? boneCount.toLocaleString() : '—'],
    ];
    statRows.forEach(([k, v], i) => {
      const y = statsY + 14 + i * statsRowH;
      ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif';
      ctx.fillText(k, statsX + 10, y);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px monospace';
      ctx.fillText(v, statsX + 110, y);
    });
    // Display toggles on the right half
    const displayX = 320, displayY = 600, displayW = (w - 80) - 264;
    const toggleH = 26;
    const toggleRows: Array<{ label: string; action: string; on: boolean; accent: string; bg: string; }> = [
      {
        label: 'VISIBLE: ' + (o3d.visible ? 'ON' : 'OFF'),
        action: 'inspect.toggle:visible',
        on: o3d.visible,
        accent: o3d.visible ? '#10b981' : '#475569',
        bg: o3d.visible ? 'rgba(16,185,129,0.20)' : 'rgba(30,41,59,0.7)',
      },
      {
        label: 'WIREFRAME: ' + (mat0?.wireframe ? 'ON' : 'OFF'),
        action: 'inspect.toggle:wireframe',
        on: !!mat0?.wireframe,
        accent: mat0?.wireframe ? '#06b6d4' : '#475569',
        bg: mat0?.wireframe ? 'rgba(6,182,212,0.20)' : 'rgba(30,41,59,0.7)',
      },
      {
        label: 'FLAT SHADING: ' + (mat0?.flatShading ? 'ON' : 'OFF'),
        action: 'inspect.toggle:flatShading',
        on: !!mat0?.flatShading,
        accent: mat0?.flatShading ? '#f472b6' : '#475569',
        bg: mat0?.flatShading ? 'rgba(244,114,182,0.20)' : 'rgba(30,41,59,0.7)',
      },
    ];
    toggleRows.forEach((t, i) => {
      const y = displayY + i * (toggleH + 4);
      drawBtn(
        displayX, y, displayW, toggleH, t.label, t.action,
        t.bg, t.accent, t.accent
      );
    });

    // ===== MATERIAL (y 696..758) =====
    drawCard(696, 758, 'MATERIAL', '#06b6d4');
    const matY = 720;
    // Color R/G/B row
    const colorChans: Array<{ label: string; key: 'r'|'g'|'b' }> = [
      { label: 'R', key: 'r' }, { label: 'G', key: 'g' }, { label: 'B', key: 'b' },
    ];
    const colorStep = 32; // px per cell
    const cellGap = 8;
    const colorStartX = 56;
    colorChans.forEach((chan, i) => {
      const cx = colorStartX + i * (colorStep * 3 + cellGap);
      const cv = mat0 ? Math.round(((mat0.color as THREE.Color)[chan.key]) * 255) : 0;
      // header
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(chan.label, cx, matY + 8);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px monospace';
      ctx.fillText(String(cv).padStart(3, ' '), cx + colorStep, matY + 8 - 0);
      // buttons
      drawBtn(cx,                matY + 14, colorStep, 22, '\\u2212', `inspect.material.color.${chan.key}-`, 'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444');
      drawBtn(cx + colorStep,    matY + 14, colorStep, 22, '+',       `inspect.material.color.${chan.key}+`, 'rgba(16,185,129,0.20)', '#86efac', '#10b981');
      drawBtn(cx + colorStep*2,  matY + 14, colorStep, 22, '\\u21ba', `inspect.material.color.${chan.key}.reset`, 'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8');
    });
    // Scalar sliders (Roughness / Metalness / Opacity / Emissive)
    const scalarProps: Array<{ label: string; prop: string; fmt: (n:number)=>string; get: () => number; }> = [
      { label: 'ROUGH',  prop: 'roughness',  fmt: n => n.toFixed(2), get: () => mat0?.roughness ?? 0.5 },
      { label: 'METAL',  prop: 'metalness',  fmt: n => n.toFixed(2), get: () => mat0?.metalness ?? 0 },
      { label: 'OPACITY',prop: 'opacity',    fmt: n => n.toFixed(2), get: () => mat0?.opacity ?? 1 },
      { label: 'EMISS',  prop: 'emissive',   fmt: n => n.toFixed(2), get: () => (mat0 as any)?.emissiveIntensity ?? 1 },
    ];
    const scalarStartY = 720 + 42;
    const scalarCellW = (w - 80 - cellGap * 3) / 4;
    scalarProps.forEach((p, i) => {
      const cx = 50 + i * (scalarCellW + cellGap);
      const cy = scalarStartY;
      ctx.fillStyle = 'rgba(30,41,59,0.65)';
      ctx.fillRect(cx, cy, scalarCellW, 30);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, scalarCellW, 30);
      ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 10px sans-serif';
      ctx.fillText(p.label, cx + 6, cy + 12);
      ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px monospace';
      ctx.fillText(p.fmt(p.get()), cx + 6, cy + 27);
      const btnW = 22;
      drawBtn(cx + scalarCellW - btnW * 3 - 4, cy + 4, btnW, 22, '\\u2212', `inspect.material.props:${p.prop}-`, 'rgba(239,68,68,0.20)', '#fca5a5', '#ef4444');
      drawBtn(cx + scalarCellW - btnW * 2 - 2, cy + 4, btnW, 22, '+',       `inspect.material.props:${p.prop}+`, 'rgba(16,185,129,0.20)', '#86efac', '#10b981');
      drawBtn(cx + scalarCellW - btnW,        cy + 4, btnW, 22, '\\u21ba', `inspect.material.props:${p.prop}.reset`, 'rgba(148,163,184,0.20)', '#cbd5e1', '#94a3b8');
    });

    // Reset baseline
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

"""

# Now insert the new method in place of the old block. We re-attach the
# chat-panel anchor that was originally at end_idx.
replacement = new_method + '\n' + end_anchor + content[end_idx:]
# Reattach the OLD block content that we stripped above (anything past the
# method close to end_idx): wait, we already replaced up to end_idx which
# points to the start of end_anchor, so things past end_idx are unchanged.
new_content = content[:start_idx] + new_method[:] + '\n' + content[end_idx:]

# The above `new_method[:]` looks redundant; simplify:
new_content = content[:start_idx] + new_method + content[end_idx:]

# Sanity check: we should have exactly one occurrence of the new method
# signature after the rewrite.
if new_content.count('private drawInspectorPanel(') != 1:
    sys.exit('post-write: drawInspectorPanel signature count != 1')

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)
print(f'OK: drawInspectorPanel replaced; new length {len(new_method)} chars')
