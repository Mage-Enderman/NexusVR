import React from 'react';
import { ChatPanel } from './ChatPanel.tsx';
import { ShareModal } from './ShareModal.tsx';
import { InventoryModal } from './InventoryModal.tsx';
import { FileImportModal } from './FileImportModal.tsx';
import { AssetImportDialog } from './AssetImportDialog.tsx';
import type { ImportConfig } from './AssetImportDialog.tsx';
import { WorldEnvironmentModal } from './WorldEnvironmentModal.tsx';
import type { EnvironmentSettings } from '../engine/EnvironmentManager.ts';
import { SettingsModal } from './SettingsModal.tsx';
import type { GraphicsSettings, PerformanceStats } from '../engine/SceneEngine.ts';
import type { NetworkService, ConnectionMode } from '../services/NetworkService.ts';
import type { InventoryService, InventoryItem } from '../services/InventoryService.ts';
import type { AssetManager } from '../engine/AssetManager.ts';
import type { SceneEngine } from '../engine/SceneEngine.ts';

export interface ModalsHostProps {
  // Chat
  showChatPanel: boolean;
  setShowChatPanel: (show: boolean) => void;
  setUnreadChatCount: (count: number) => void;
  networkService: NetworkService;

  // Share
  showShareModal: boolean;
  setShowShareModal: (show: boolean) => void;
  mode: ConnectionMode;
  roomId: string | null;
  shareModalTab: 'multiplayer' | 'pairing';
  handleJoinRoom: (roomId: string, mode: ConnectionMode, isCompanion?: boolean) => void;
  handleDisconnect: () => void;

  // Inventory
  showInventoryModal: boolean;
  setShowInventoryModal: (show: boolean) => void;
  inventoryService: InventoryService | null;
  handleSpawnFromInventory: (item: InventoryItem) => void;
  handleEquipVrmFromInventory: (item: InventoryItem) => void;

  // File Import (Simple)
  showImportModal: boolean;
  setShowImportModal: (show: boolean) => void;
  handleImportFile: (
    file: File,
    saveToInventory: boolean,
    equipVrm: boolean,
    videoSyncMode?: 'persistent' | 'watch-party'
  ) => Promise<void>;

  // Asset Import Dialog (Customizer)
  showImportDialog: boolean;
  setShowImportDialog: (show: boolean) => void;
  importInitialFile: File | null;
  setImportInitialFile: (file: File | null) => void;
  importInitialUrl: string;
  setImportInitialUrl: (url: string) => void;
  uiRefreshKey: number;
  handleImportAssetFromConfig: (config: ImportConfig) => Promise<void>;
  sceneEngine: SceneEngine | null;
  assetManager: AssetManager | null;

  // World Environment
  showWorldEnvModal: boolean;
  setShowWorldEnvModal: (show: boolean) => void;
  envSettings: EnvironmentSettings;
  handleUpdateEnvSettings: (settings: Partial<EnvironmentSettings>) => void;

  // Settings
  showSettingsModal: boolean;
  setShowSettingsModal: (show: boolean) => void;
  graphicsSettings: GraphicsSettings;
  stats: PerformanceStats;
  userName: string;
  handleUpdateUserName: (name: string) => void;
  handleUpdateGraphicsSettings: (settings: Partial<GraphicsSettings>) => void;
}

/**
 * ModalsHost consolidates top-level overlay modals in NexusVR:
 * - ChatPanel (text and voice chat sidebar)
 * - ShareModal (room sharing & mobile pairing)
 * - InventoryModal (item library & spawning)
 * - FileImportModal (legacy file drag/drop modal)
 * - AssetImportDialog (customization wizard with 3D spatial wrapper)
 * - WorldEnvironmentModal (skybox & environment settings)
 * - SettingsModal (graphics & user configuration)
 */
export const ModalsHost: React.FC<ModalsHostProps> = React.memo(({
  // Chat
  showChatPanel,
  setShowChatPanel,
  setUnreadChatCount,
  networkService,

  // Share
  showShareModal,
  setShowShareModal,
  mode,
  roomId,
  shareModalTab,
  handleJoinRoom,
  handleDisconnect,

  // Inventory
  showInventoryModal,
  setShowInventoryModal,
  inventoryService,
  handleSpawnFromInventory,
  handleEquipVrmFromInventory,

  // File Import (Simple)
  showImportModal,
  setShowImportModal,
  handleImportFile,

  // Asset Import Dialog (Customizer)
  showImportDialog,
  setShowImportDialog,
  importInitialFile,
  setImportInitialFile,
  importInitialUrl,
  setImportInitialUrl,
  uiRefreshKey,
  handleImportAssetFromConfig,
  sceneEngine,
  assetManager,

  // World Environment
  showWorldEnvModal,
  setShowWorldEnvModal,
  envSettings,
  handleUpdateEnvSettings,

  // Settings
  showSettingsModal,
  setShowSettingsModal,
  graphicsSettings,
  stats,
  userName,
  handleUpdateUserName,
  handleUpdateGraphicsSettings,
}) => {
  return (
    <>
      {/* Text & Voice Chat Sidebar */}
      <ChatPanel
        networkService={networkService}
        isOpen={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        onReadMessages={() => setUnreadChatCount(0)}
      />

      {/* Share / Invite & Pairing Modal */}
      {showShareModal && (
        <ShareModal
          currentMode={mode}
          currentRoomId={roomId}
          onClose={() => setShowShareModal(false)}
          onJoinRoom={handleJoinRoom}
          onDisconnect={handleDisconnect}
          initialTab={shareModalTab}
        />
      )}

      {/* Inventory Modal */}
      {showInventoryModal && inventoryService && (
        <InventoryModal
          inventoryService={inventoryService}
          onClose={() => setShowInventoryModal(false)}
          onSpawnItem={handleSpawnFromInventory}
          onEquipVrm={handleEquipVrmFromInventory}
        />
      )}

      {/* File Import Modal (Legacy / Simple) */}
      {showImportModal && (
        <FileImportModal
          onImportFile={handleImportFile}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Interactive Asset Customization Dialog */}
      {showImportDialog && (
        <AssetImportDialog
          key={`import-dialog-${importInitialFile?.name || importInitialUrl || 'custom'}-${uiRefreshKey}`}
          initialFile={importInitialFile}
          initialUrl={importInitialUrl}
          onImport={handleImportAssetFromConfig}
          onClose={() => {
            setShowImportDialog(false);
            setImportInitialFile(null);
            setImportInitialUrl('');
            sceneEngine?.renderer.domElement.focus();
            if (sceneEngine?.cameraMode === 'first-person' && !document.pointerLockElement) {
              sceneEngine?.renderer.domElement.requestPointerLock?.();
            }
          }}
          scene={sceneEngine?.scene}
          camera={sceneEngine?.camera}
          assetManager={assetManager || undefined}
          spatialPanelManager={sceneEngine?.spatialPanelManager}
        />
      )}

      {/* World Environment & Skybox Modal */}
      {showWorldEnvModal && (
        <WorldEnvironmentModal
          settings={envSettings}
          onUpdateSettings={handleUpdateEnvSettings}
          onClose={() => setShowWorldEnvModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          settings={graphicsSettings}
          stats={stats}
          userName={userName}
          onUpdateUserName={handleUpdateUserName}
          onUpdateSettings={handleUpdateGraphicsSettings}
          onClose={() => setShowSettingsModal(false)}
          sceneEngine={sceneEngine}
        />
      )}
    </>
  );
});
