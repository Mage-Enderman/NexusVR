const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. In onSpawn, replace the fileDataOversized branch with one that tries P2P first.
const oldOnSpawnOversized = `      if (data.fileDataOversized) {
        // A prior 'pending' broadcast may have already drawn a
        // "Loading" placeholder for this id (the host fires 'pending'
        // BEFORE awaiting the import, so peers can render a loading
        // indicator during the (potentially multi-second) file load).
        // Dispose it before swapping in the permanent red "Too Large"
        // indicator — otherwise the cyan mesh orphans in worldRoot
        // with no registerOnAssetAdded cleanup ever firing for it
        // (no real asset will ever be created for an oversized spawn).
        const prior = pendingAssetsRef.current.get(data.id);
        if (prior) {
          sceneEngine.worldRoot.remove(prior.group);
          prior.dispose();
          pendingAssetsRef.current.delete(data.id);
        }
        const { group, dispose } = createLoadingPlaceholder(
          data.name || 'Asset',
          'Network',
          pos,
          true  // isOversized — red palette, "Too Large" label
        );
        sceneEngine.worldRoot.add(group);
        pendingAssetsRef.current.set(data.id, { group, dispose, oversized: true });
        return;
      }`;

const newOnSpawnOversized = `      if (data.fileDataOversized) {
        // A prior 'pending' broadcast may have already drawn a
        // "Loading" placeholder for this id (the host fires 'pending'
        // BEFORE awaiting the import, so peers can render a loading
        // indicator during the (potentially multi-second) file load).
        // Dispose it before swapping in the permanent red "Too Large"
        // indicator — otherwise the cyan mesh orphans in worldRoot
        // with no registerOnAssetAdded cleanup ever firing for it
        // (no real asset will ever be created for an oversized spawn).
        //
        // Phase 3B: if the sender included a p2pTransferHint, try to pull
        // the bytes over the raw-binary asset channel instead of giving up.
        if (startP2PAssetTransfer(data, pos)) {
          return;
        }
        const prior = pendingAssetsRef.current.get(data.id);
        if (prior) {
          sceneEngine.worldRoot.remove(prior.group);
          prior.dispose();
          pendingAssetsRef.current.delete(data.id);
        }
        const { group, dispose } = createLoadingPlaceholder(
          data.name || 'Asset',
          'Network',
          pos,
          true  // isOversized — red palette, "Too Large" label
        );
        sceneEngine.worldRoot.add(group);
        pendingAssetsRef.current.set(data.id, { group, dispose, oversized: true });
        return;
      }`;

if (!content.includes(oldOnSpawnOversized)) {
  console.error('Could not find onSpawn oversized branch');
  process.exit(1);
}
content = content.replace(oldOnSpawnOversized, newOnSpawnOversized);

// 2. In onSyncResp, replace the fileDataOversized branch similarly.
const oldSyncRespOversized = `          if (data.fileDataOversized) {
            // Mirror the onSpawn handler's dispose-prior-entry
            // pattern above: a 'pending' broadcast may have already
            // drawn a "Loading" placeholder for this id (the host
            // fires 'pending' before the import resolves), so we
            // must dispose it before swapping in the permanent red
            // "Too Large" indicator. Without this the cyan mesh
            // orphans in worldRoot with no registerOnAssetAdded
            // cleanup ever firing.
            const prior = pendingAssetsRef.current.get(data.id);
            if (prior) {
              sceneEngine.worldRoot.remove(prior.group);
              prior.dispose();
              pendingAssetsRef.current.delete(data.id);
            }
            const { group, dispose } = createLoadingPlaceholder(
              data.name || 'Asset',
              'Network',
              pos,
              true  // isOversized — red palette, "Too Large" label
            );
            sceneEngine.worldRoot.add(group);
            pendingAssetsRef.current.set(data.id, { group, dispose, oversized: true });
            return;
          }`;

const newSyncRespOversized = `          if (data.fileDataOversized) {
            // Mirror the onSpawn handler's dispose-prior-entry
            // pattern above: a 'pending' broadcast may have already
            // drawn a "Loading" placeholder for this id (the host
            // fires 'pending' before the import resolves), so we
            // must dispose it before swapping in the permanent red
            // "Too Large" indicator. Without this the cyan mesh
            // orphans in worldRoot with no registerOnAssetAdded
            // cleanup ever firing.
            //
            // Phase 3B: if the sender included a p2pTransferHint, try to pull
            // the bytes over the raw-binary asset channel instead of giving up.
            if (startP2PAssetTransfer(data, pos)) {
              return;
            }
            const prior = pendingAssetsRef.current.get(data.id);
            if (prior) {
              sceneEngine.worldRoot.remove(prior.group);
              prior.dispose();
              pendingAssetsRef.current.delete(data.id);
            }
            const { group, dispose } = createLoadingPlaceholder(
              data.name || 'Asset',
              'Network',
              pos,
              true  // isOversized — red palette, "Too Large" label
            );
            sceneEngine.worldRoot.add(group);
            pendingAssetsRef.current.set(data.id, { group, dispose, oversized: true });
            return;
          }`;

if (!content.includes(oldSyncRespOversized)) {
  console.error('Could not find onSyncResp oversized branch');
  process.exit(1);
}
content = content.replace(oldSyncRespOversized, newSyncRespOversized);

fs.writeFileSync(file, content);
console.log('Wired startP2PAssetTransfer into onSpawn and onSyncResp');
