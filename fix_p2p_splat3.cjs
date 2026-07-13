const fs = require('fs');

const file = 'src/App.tsx';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

// Find the line "net.onSpawn((data) => {" inside the engine-init useEffect
let onSpawnLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === "net.onSpawn((data) => {" || lines[i].trim().startsWith('net.onSpawn((data)')) {
    onSpawnLine = i;
    break;
  }
}

if (onSpawnLine === -1) {
  console.error('Could not find net.onSpawn line');
  process.exit(1);
}

const helperFunction = `    // Phase 3B: pull an oversized asset from the sender peer via the
    // raw-binary asset channel. Replaces the old "Too Large" red
    // placeholder with a live progress indicator and imports the file
    // once all chunks arrive.
    const startP2PAssetTransfer = (data: AssetSpawnData, pos: THREE.Vector3) => {
      const hint = data.p2pTransferHint;
      const senderPeerId = data.senderPeerId;
      if (!hint || !senderPeerId) return false;

      // Dispose any existing placeholder for this id.
      const prior = pendingAssetsRef.current.get(data.id);
      if (prior) {
        sceneEngine.worldRoot.remove(prior.group);
        prior.dispose();
        pendingAssetsRef.current.delete(data.id);
      }


      const { group, dispose, setProgress } = createLoadingPlaceholder(
        data.name || 'Asset',
        'Network',
        pos,
        false // in-flight download, not a permanent failure
      );
      sceneEngine.worldRoot.add(group);
      pendingAssetsRef.current.set(data.id, { group, dispose, setProgress, oversized: false });

      const assetId = hint.id;
      const size = hint.size;
      const CHUNK_SIZE = 256 * 1024;
      const chunks: ArrayBuffer[] = [];
      // Pre-size the array so we can place out-of-order chunks by index.
      chunks.length = Math.ceil(size / CHUNK_SIZE);
      let receivedBytes = 0;
      let nextRequestEnd = 0;
      let completed = false;

      const finishIfDone = () => {
        if (completed) return;
        // Verify every slot is filled.
        for (let i = 0; i < chunks.length; i++) {
          if (!chunks[i]) return;
        }
        completed = true;
        netUnsub();
        // Concatenate chunks in order.
        const fullBlob = new Blob(chunks as ArrayBuffer[]);
        const file = new File([fullBlob], data.name || 'Asset');
        assetManager.importFile(file, pos, { videoAspectRatio: data.videoAspectRatio || 'auto' }, data.id).then((asset) => {
          if (asset) {
            asset.object3d.rotation.set(...data.rotation);
            asset.object3d.scale.set(...data.scale);
            if (data.isPersistent !== undefined) {
              asset.object3d.userData.isPersistent = data.isPersistent;
            }
            if (data.materialState) {
              // @ts-ignore
              AssetManager.applyMaterialUpdate(asset, data.materialState);
            }
          }
        });
      };

      const onData = (chunkData: { id: string; start: number; end: number; data: ArrayBuffer }) => {
        if (chunkData.id !== assetId) return;
        const index = Math.floor(chunkData.start / CHUNK_SIZE);
        if (chunks[index]) return; // duplicate
        chunks[index] = chunkData.data;
        receivedBytes += chunkData.data.byteLength;
        setProgress(Math.min(100, (receivedBytes / size) * 100));

        // Request the next chunk if there are still bytes to fetch.
        if (chunkData.end < size) {
          const nextEnd = Math.min(chunkData.end + CHUNK_SIZE, size);
          net.requestAssetChunk(assetId, senderPeerId, chunkData.end, nextEnd);
        }
        finishIfDone();
      };
      const netUnsub = net.onP2PChunkData(onData);

      // Kick off the first chunk.
      const firstEnd = Math.min(CHUNK_SIZE, size);
      net.requestAssetChunk(assetId, senderPeerId, 0, firstEnd);
      return true;
    };

`;

lines.splice(onSpawnLine, 0, helperFunction);

fs.writeFileSync(file, lines.join('\n'));
console.log('Inserted startP2PAssetTransfer helper before net.onSpawn');
