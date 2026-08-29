import { useRef, useState, useCallback, useEffect } from 'react';
import { InventoryService } from '../services/InventoryService.ts';
import type { InventoryItem } from '../services/InventoryService.ts';
import type { LoadedAsset } from '../engine/AssetManager.ts';
import type { MaterialUpdate } from '../services/NetworkService.ts';

export interface UseInventoryHandlersOptions {
  showDashMenu?: boolean;
  getHeldAssetForSide?: (side?: 'left' | 'right') => LoadedAsset | null;
}

export interface UseInventoryHandlersReturn {
  inventoryServiceRef: React.MutableRefObject<InventoryService>;
  inventoryItems: InventoryItem[];
  inventoryFolders: string[];
  inventoryItemsRef: React.MutableRefObject<InventoryItem[]>;
  showInventoryModal: boolean;
  setShowInventoryModal: React.Dispatch<React.SetStateAction<boolean>>;
  setInventoryItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  refreshInventoryData: () => void;
  handleDeleteInventoryItem: (id: string) => Promise<void>;
  handleRenameInventoryItem: (id: string, newName: string) => Promise<void>;
  handleCreateInventoryFolder: (folderName: string) => Promise<void>;
  handleMoveInventoryItem: (id: string, folder?: string) => Promise<void>;
  handleRenameInventoryFolder: (oldName: string, newName: string) => Promise<void>;
  handleDeleteInventoryFolder: (folderName: string) => Promise<void>;
  handleMoveInventoryFolder: (folderName: string, targetParent?: string) => Promise<void>;
  handleSaveHeldToInventory: (side?: 'left' | 'right') => Promise<void>;
  handleSaveSelectedToInventory: (asset: LoadedAsset | null) => Promise<void>;
}

export function useInventoryHandlers({
  showDashMenu = false,
  getHeldAssetForSide,
}: UseInventoryHandlersOptions = {}): UseInventoryHandlersReturn {
  const inventoryServiceRef = useRef<InventoryService>(new InventoryService());
  const [showInventoryModal, setShowInventoryModal] = useState<boolean>(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryFolders, setInventoryFolders] = useState<string[]>([]);
  const inventoryItemsRef = useRef<InventoryItem[]>([]);

  // Refresh inventory items & folders from InventoryService
  const refreshInventoryData = useCallback(() => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    inv.getItems().then((items) => {
      inventoryItemsRef.current = items.slice();
      setInventoryItems(items);
    }).catch(() => {});
    inv.getFolders().then((folders) => {
      setInventoryFolders(folders);
    }).catch(() => {});
  }, []);

  // Initial load on mount
  useEffect(() => {
    refreshInventoryData();
  }, [refreshInventoryData]);

  // Refresh whenever Dash menu or Inventory modal opens
  useEffect(() => {
    if (showDashMenu || showInventoryModal) {
      refreshInventoryData();
    }
  }, [showDashMenu, showInventoryModal, refreshInventoryData]);

  // CRUD Handlers
  const handleDeleteInventoryItem = useCallback(async (id: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.removeItem(id);
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleRenameInventoryItem = useCallback(async (id: string, newName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv || !newName.trim()) return;
    await inv.renameItem(id, newName.trim());
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleCreateInventoryFolder = useCallback(async (folderName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv || !folderName.trim()) return;
    await inv.createFolder(folderName.trim());
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleMoveInventoryItem = useCallback(async (id: string, folder?: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.moveItemToFolder(id, folder);
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleRenameInventoryFolder = useCallback(async (oldName: string, newName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv || !newName.trim()) return;
    await inv.renameFolder(oldName, newName.trim());
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleDeleteInventoryFolder = useCallback(async (folderName: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.deleteFolder(folderName);
    refreshInventoryData();
  }, [refreshInventoryData]);

  const handleMoveInventoryFolder = useCallback(async (folderName: string, targetParent?: string) => {
    const inv = inventoryServiceRef.current;
    if (!inv) return;
    await inv.moveFolder(folderName, targetParent);
    refreshInventoryData();
  }, [refreshInventoryData]);

  // Save held asset (VR or Desktop) to inventory
  const handleSaveHeldToInventory = useCallback(async (side?: 'left' | 'right') => {
    if (!getHeldAssetForSide) return;
    const held = getHeldAssetForSide(side);
    if (!held) return;
    const asset = held;
    const item: InventoryItem = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      createdAt: Date.now(),
      fileData: asset.fileData,
      url: asset.url,
      primitiveType: (asset.object3d.userData as Record<string, unknown>)?.primitiveType as any,
      materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    await inventoryServiceRef.current.saveItem(item);
    console.log('[Inventory] Saved held "' + asset.name + '" to inventory');
    refreshInventoryData();
  }, [getHeldAssetForSide, refreshInventoryData]);

  // Save selected asset to inventory
  const handleSaveSelectedToInventory = useCallback(async (asset: LoadedAsset | null) => {
    if (!asset) return;
    const item: InventoryItem = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      createdAt: Date.now(),
      fileData: asset.fileData,
      url: asset.url,
      primitiveType: (asset.object3d.userData as Record<string, unknown>)?.primitiveType as any,
      materialState: (asset.object3d.userData as Record<string, unknown>)?.materialState as MaterialUpdate | undefined,
      metadata:
        asset.metadata ||
        (asset.fileData ? { fileSize: asset.fileData.byteLength } : undefined),
    };
    await inventoryServiceRef.current.saveItem(item);
    console.log(`[Inventory] Saved "${asset.name}" to inventory`);
    refreshInventoryData();
  }, [refreshInventoryData]);

  return {
    inventoryServiceRef,
    inventoryItems,
    inventoryFolders,
    inventoryItemsRef,
    showInventoryModal,
    setShowInventoryModal,
    setInventoryItems,
    refreshInventoryData,
    handleDeleteInventoryItem,
    handleRenameInventoryItem,
    handleCreateInventoryFolder,
    handleMoveInventoryItem,
    handleRenameInventoryFolder,
    handleDeleteInventoryFolder,
    handleMoveInventoryFolder,
    handleSaveHeldToInventory,
    handleSaveSelectedToInventory,
  };
}
