const fs = require('fs');
const path = 'src/App.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Move the early pointerdown listener block to after `const disposers: Array<() => void> = [];`
const earlyPointerBlock = `    // Resume the WebAudio context on the first user gesture; browsers
    // suspend it until a user interaction, which would silence peer voice.
    const resumeAudioContext = () => {
      avatarManager.audioListener.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    disposers.push(() => window.removeEventListener('pointerdown', resumeAudioContext));
`;

if (content.includes(earlyPointerBlock)) {
  content = content.replace(earlyPointerBlock, '');
  const disposersDecl = `    const disposers: Array<() => void> = [];\n`;
  const insertAfter = disposersDecl + `\n    // Resume the WebAudio context on the first user gesture; browsers
    // suspend it until a user interaction, which would silence peer voice.
    const resumeAudioContext = () => {
      avatarManager.audioListener.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resumeAudioContext, { once: true });
    disposers.push(() => window.removeEventListener('pointerdown', resumeAudioContext));
`;
  content = content.replace(disposersDecl, insertAfter);
}

// 2. Replace undefined onProgress references in importFromUrl calls.
// The calls currently have an extra duplicate id argument; fix both the id and the progress callback.
content = content.replace(
  /assetManager\.importFromUrl\(data\.url, pos, undefined, data\.id, data\.id, onProgress\)/g,
  'assetManager.importFromUrl(data.url, pos, undefined, data.id, makeProgressFn(data.id))'
);
content = content.replace(
  /am\.importFromUrl\(sa\.url, pos, undefined, sa\.id, sa\.id, onProgress\)/g,
  'am.importFromUrl(sa.url, pos, undefined, sa.id, makeProgressFn(sa.id))'
);
content = content.replace(
  /assetManager\.importFile\(file, pos, \{ videoSyncMode \}, placeholderId, onProgress\)/g,
  'assetManager.importFile(file, pos, { videoSyncMode }, placeholderId, makeProgressFn(placeholderId))'
);

// 3. Fix the duplicated / corrupted importFromUrl block inside handleImportAssetFromConfig.
const duplicateBlockStart = `} else if (config.url) {
        asset = await assetManager.importFromUrl(
          config.url,
          pos,
          { ...config,
            splatMaxCount: sceneEngineRef.current?.settings.splatMaxCount,`;
const duplicateBlockEnd = `        );
      }

      if (asset) {`;
const duplicateStartIdx = content.indexOf(duplicateBlockStart);
const duplicateEndIdx = content.indexOf(duplicateBlockEnd, duplicateStartIdx);
if (duplicateStartIdx !== -1 && duplicateEndIdx !== -1) {
  const replacement = `} else if (config.url) {
        asset = await assetManager.importFromUrl(
          config.url,
          pos,
          {
            ...config,
            splatMaxCount: sceneEngineRef.current?.settings.splatMaxCount,
            splatEnableLod: config.splatEnableLod ?? sceneEngineRef.current?.settings?.splatLodEnabled ?? true,
            splatLodScale: sceneEngineRef.current?.settings?.splatLodScale ?? 1.0,
          },
          placeholderId,
          makeProgressFn(placeholderId)
        );
      }

      if (asset) {`;
  content = content.slice(0, duplicateStartIdx) + replacement + content.slice(duplicateEndIdx + duplicateBlockEnd.length);
}

// 4. Remove the stray inventory-spawn code that leaked into the JSX comment at the end of the file.
const strayStart = `      {/* First-Person HUD stack — a single flex column anchors the
          locomotion banner AND the equipped-tool chip so they stack
          with a guaranteed \`gap-2\` clearance regardless of banner
          height (the banner's content can wrap on narrow viewports, placeholderId, onProgress)asset = await assetManager.importFile(file, pos);`;
const strayEnd = `      }
    }
    setShowInventoryModal(false);
  };`;
const strayStartIdx = content.indexOf(strayStart);
const strayEndIdx = content.indexOf(strayEnd, strayStartIdx);
if (strayStartIdx !== -1 && strayEndIdx !== -1) {
  const replacement = `      {/* First-Person HUD stack — a single flex column anchors the
          locomotion banner AND the equipped-tool chip so they stack
          with a guaranteed \`gap-2\` clearance regardless of banner
          height (the banner's content can wrap on narrow viewports). */}
      <div className="absolute bottom-4 left-4 right-4 z-[5] pointer-events-none flex flex-col items-center gap-2">`;
  content = content.slice(0, strayStartIdx) + replacement + content.slice(strayEndIdx + strayEnd.length);
}

fs.writeFileSync(path, content);
console.log('Applied fixes to src/App.tsx');
