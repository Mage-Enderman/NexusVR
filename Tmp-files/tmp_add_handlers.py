path = 'src/App.tsx'
with open(path, 'r', encoding='utf-8') as f:
  src = f.read()

old_end = """  const handleDeleteSelected = () => {
    if (!selectedAsset) return;
    const asset = selectedAsset;
    const obj = asset.object3d;"""

new_end = r"""  // =========================================================================
  // HELD-TARGET HANDLERS (radial menu 'held' tab)
  // Mirror of the three selected-target handlers above (Save / Duplicate /
  // Delete) but operate on manipulationManager.grabbedAsset instead of
  // selectedAsset. RMB-grab explicitly does NOT mutate selection state
  // (per the ManipulationManager comment block in beginGrab), so the
  // SELECTED-target handlers do nothing for a held-but-not-selected asset.
  // These are the missing "act on the held object" entry points.
  // =========================================================================
  const handleSaveHeldToInventory = useCallback(() => {
    const held = manipulationManagerRef.current?.grabbedAsset;
    if (!held) return;
    const asset = held;
    const item: InventoryItem = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      createdAt: Date.now(),
      fileData: asset.fileData,
      url: asset.url,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    inventoryServiceRef.current.saveItem(item).then(() => {
      console.log('[Inventory] Saved held "' + asset.name + '" to inventory');
    });
  }, []);

  const handleDuplicateHeld = useCallback(async () => {
    const held = manipulationManagerRef.current?.grabbedAsset;
    if (!held) return;
    const asset = held;
    const am = assetManagerRef.current;
    if (!am) return;

    // Offset the duplicate so it doesn't perfectly overlap the held
    // original (the held one stays under the cursor; the duplicate pops
    // out a fraction so the user can see the copy). Same offset as the
    // selected-target version for consistency.
    const offset = new THREE.Vector3(
      0.4 + (Math.random() - 0.5) * 0.3,
      0,
      0.4 + (Math.random() - 0.5) * 0.3
    );
    const pos = new THREE.Vector3(
      asset.object3d.position.x,
      asset.object3d.position.y,
      asset.object3d.position.z
    ).add(offset);
    const primType = (asset.object3d.userData as Record<string, unknown>)
      ?.primitiveType as
      | 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
      | undefined;

    const afterImport = (newAsset: LoadedAsset) => {
      newAsset.object3d.rotation.set(
        asset.object3d.rotation.x,
        asset.object3d.rotation.y,
        asset.object3d.rotation.z
      );
      newAsset.object3d.scale.set(
        asset.object3d.scale.x,
        asset.object3d.scale.y,
        asset.object3d.scale.z
      );
      manipulationManagerRef.current?.selectAsset(newAsset);
      recordSpawnUndo(newAsset);
      networkServiceRef.current.broadcastSpawn({
        id: newAsset.id,
        name: newAsset.name,
        type: newAsset.type as AssetSpawnData['type'],
        position: [
          newAsset.object3d.position.x,
          newAsset.object3d.position.y,
          newAsset.object3d.position.z,
        ],
        rotation: [
          newAsset.object3d.rotation.x,
          newAsset.object3d.rotation.y,
          newAsset.object3d.rotation.z,
        ],
        scale: [
          newAsset.object3d.scale.x,
          newAsset.object3d.scale.y,
          newAsset.object3d.scale.z,
        ],
        url: newAsset.url,
        fileData: newAsset.fileData,
        isCollidable: newAsset.isCollidable,
      });
    };

    if (asset.type === 'primitive' && primType) {
      const newAsset = am.spawnPrimitive(primType, pos);
      afterImport(newAsset);
      return;
    }

    if (asset.fileData && asset.name) {
      const blob = new Blob([asset.fileData], {
        type: asset.metadata?.mimeType || 'application/octet-stream',
      });
      const file = new File([blob], asset.name);
      const newAsset = await am.importFile(file, pos);
      if (newAsset) afterImport(newAsset);
      return;
    }

    if (asset.url) {
      try {
        const newAsset = await am.importFromUrl(asset.url, pos);
        if (newAsset) afterImport(newAsset);
      } catch (err) {
        console.warn('[DuplicateHeld] Failed to re-import from URL ' + asset.url + ':', err);
      }
    }
  }, []);

  const handleDestroyHeld = useCallback(() => {
    const held = manipulationManagerRef.current?.grabbedAsset;
    if (!held) return;
    const asset = held;
    const obj = asset.object3d;
    // CRITICAL: end the grab BEFORE removing the asset. Otherwise the
    // manipulation manager would briefly hold a dangling grabbedAsset
    // reference to a removed Object3D, and the per-frame update() path
    // would either crash or broadcast stale transforms for a non-existent
    // asset. endGrab handles the two-handed case too via
    // manipulationManager's internal _isVRGrabbing check.
    manipulationManagerRef.current?.endGrab();
    const snapshot: AssetSnapshot = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      url: asset.url,
      fileData: asset.fileData,
      primitiveType: (obj.userData as Record<string, unknown>)?.primitiveType as string | undefined,
      isCollidable: asset.isCollidable,
      isPersistent: (obj.userData as Record<string, unknown>)?.isPersistent as boolean | undefined,
    };
    const latestId = { value: asset.id };
    undoRedoManagerRef.current.push({
      label: 'Destroy ' + asset.name,
      undo: () => {
        respawnFromSnapshot(snapshot, latestId);
      },
      redo: () => {
        const am = assetManagerRef.current;
        if (!am) return;
        am.removeAsset(latestId.value);
        networkServiceRef.current.broadcastRemove(latestId.value);
        if (manipulationManagerRef.current?.selectedAsset?.id === latestId.value) {
          manipulationManagerRef.current.selectAsset(null);
          setSelectedAsset(null);
        }
      },
    });
    assetManagerRef.current?.removeAsset(asset.id);
    networkServiceRef.current.broadcastRemove(asset.id);
    // If the destroyed asset happened to be the selected one too, clear
    // the selection so the gizmo detaches. Most holds aren't selected,
    // so this is the uncommon path, but cheap to handle.
    if (manipulationManagerRef.current?.selectedAsset?.id === asset.id) {
      manipulationManagerRef.current.selectAsset(null);
      setSelectedAsset(null);
    }
  }, []);

  const handleDeleteSelected = () => {
    if (!selectedAsset) return;
    const asset = selectedAsset;
    const obj = asset.object3d;"""

if old_end not in src:
  print('HANDLE_OLD_NOT_FOUND')
  raise SystemExit(1)
src = src.replace(old_end, new_end, 1)
with open(path, 'w', encoding='utf-8') as f:
  f.write(src)
print('Added 3 held-target handlers (Save/Duplicate/Destroy)')
