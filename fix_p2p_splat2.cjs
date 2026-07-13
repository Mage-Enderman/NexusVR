const fs = require('fs');

const file = 'src/App.tsx';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

// 1. Replace createLoadingPlaceholder return type
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('): { group: THREE.Group; dispose: () => void } {')) {
    lines[i] = lines[i].replace('): { group: THREE.Group; dispose: () => void } {', '): { group: THREE.Group; dispose: () => void; setProgress: (pct: number | null) => void } {');
    break;
  }
}

// 2. Replace the canvas drawing block.
// Find the line with "Floating canvas-textured sprite label" and the line with "return { group, dispose };"
let canvasStart = -1;
let canvasEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Floating canvas-textured sprite label')) canvasStart = i;
  if (canvasStart !== -1 && lines[i].trim() === 'return { group, dispose };') {
    canvasEnd = i;
    break;
  }
}

if (canvasStart === -1 || canvasEnd === -1) {
  console.error('Could not find canvas block boundaries', canvasStart, canvasEnd);
  process.exit(1);
}

const newCanvasBlock = `  // Floating canvas-textured sprite label: "Loading / <name> / by <>".
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  // Live progress percentage (null = indeterminate). Held on a stable
  // closure-captured cell so setProgress can mutate it without
  // triggering React re-renders.
  let currentPct: number | null = null;
  let disposed = false;
  let lastRedrawAt = 0;

  const redraw = (force = false) => {
    if (!ctx || disposed) return;
    const now = (performance.now && performance.now()) || Date.now();
    // ~10 Hz throttle; force=true bypasses (used on the first call,
    // and on the final 100% so the Settled state lands immediately).
    if (!force && now - lastRedrawAt < 100) return;
    lastRedrawAt = now;
    ctx.fillStyle = 'rgba(7, 9, 14, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = primaryHex;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = primaryHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Append " 45%" only when progress is a real number; omit for null
    // (indeterminate) and the "Too Large" failure case.
    const titleWithPct =
      isOversized || currentPct === null
        ? titleText
        : \`\${titleText}… \${currentPct}%\`;
    ctx.fillText(titleWithPct, canvas.width / 2, canvas.height / 2 - 28);
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = nameHex;
    const maxLen = 26;
    const displayName = name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
    ctx.fillText(displayName, canvas.width / 2, canvas.height / 2 + 8);
    // For oversized the requester line is suppressed — the user already
    // knows why they can't see it, and dropping the line keeps the
    // label visually focused on the failure mode.
    if (!isOversized) {
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#a855f7';
      ctx.fillText(\`by \${requesterName}\`, canvas.width / 2, canvas.height / 2 + 44);
    }
    spriteTexture.needsUpdate = true;
  };

  const spriteTexture = new THREE.CanvasTexture(canvas);
  spriteTexture.colorSpace = THREE.SRGBColorSpace;
  // First paint happens synchronously so the placeholder looks correct
  // before any progress ticks arrive.
  redraw(true);

  const spriteMat = new THREE.SpriteMaterial({ map: spriteTexture, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 0.9;
  group.add(sprite);

  const dispose = () => {
    disposed = true;
    icoGeo.dispose();
    icoMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    // CRITICAL: explicit texture dispose to release GPU backing.
    spriteTexture.dispose();
    spriteMat.dispose();
  };

  // setProgress is the public hook callers use to push new percentages.
  // null resets to indeterminate. We round to integer percentage to avoid
  // the throttled redraw chewing CPU when the loader emits sub-frame deltas.
  const setProgress = (pct: number | null) => {
    if (disposed) return;
    if (pct === null) {
      if (currentPct !== null) { currentPct = null; redraw(true); }
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (currentPct === clamped) return;
    currentPct = clamped;
    redraw(clamped === 100);
  };

  return { group, dispose, setProgress };
}`;

lines.splice(canvasStart, canvasEnd - canvasStart + 1, ...newCanvasBlock.split('\n'));

// 3. Update pendingAssetsRef type
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const pendingAssetsRef = useRef<Map<string, { group: THREE.Group; dispose: () => void; oversized?: boolean }>>(new Map());')) {
    lines[i] = lines[i].replace(
      'const pendingAssetsRef = useRef<Map<string, { group: THREE.Group; dispose: () => void; oversized?: boolean }>>(new Map());',
      'const pendingAssetsRef = useRef<Map<string, { group: THREE.Group; dispose: () => void; setProgress?: (pct: number | null) => void; oversized?: boolean }>>(new Map());'
    );
    break;
  }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Patched createLoadingPlaceholder and pendingAssetsRef');
