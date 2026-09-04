import React from 'react';
import * as THREE from 'three';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import { VideoObjectControls } from './VideoObjectControls.tsx';
import type { AssetManager, LoadedAsset } from '../engine/AssetManager.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';
import type { ManipulationManager } from '../engine/ManipulationManager.ts';
import type { NetworkService } from '../services/NetworkService.ts';

export interface VideoControlsPopupProps {
  activeVideoAssetId: string | null;
  assetManager: AssetManager | null;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  spatialPanelManager?: SpatialPanelManager;
  networkService: NetworkService;
  manipulationManager: ManipulationManager | null;
  onClose: () => void;
  resetVideoInactivityTimer: () => void;
  handleVideoAction: (
    assetId: string,
    kind: 'play' | 'pause' | 'seek' | 'step' | 'volume' | 'volumeMode' | 'mute' | 'subtitlesToggle' | 'syncMode',
    payload?: any
  ) => void;
  setSelectedAsset: (asset: LoadedAsset | null) => void;
}

/**
 * 3D Spatial Video Controls Popup.
 * Attaches directly in front of the video plane mesh in world space.
 */
export const VideoControlsPopup: React.FC<VideoControlsPopupProps> = React.memo(({
  activeVideoAssetId,
  assetManager,
  scene,
  camera,
  spatialPanelManager,
  networkService,
  manipulationManager,
  onClose,
  resetVideoInactivityTimer,
  handleVideoAction,
  setSelectedAsset,
}) => {
  if (!activeVideoAssetId || !assetManager) return null;

  const activeVideoAsset = assetManager.assets.get(activeVideoAssetId);
  const activeVideoState = activeVideoAsset?.type === 'video'
    ? assetManager.getVideoState(activeVideoAssetId)
    : null;

  if (!activeVideoAsset || !activeVideoState) return null;

  const isFlipped = (() => {
    const sm = activeVideoAsset.object3d.children.find(
      (c): c is THREE.Mesh => c.type === 'Mesh' && !(c as THREE.Mesh).material?.constructor?.name?.includes('Standard')
    );
    return sm ? sm.scale.y === -1 : false;
  })();

  return (
    <SpatialPopUpWrapper
      key={`video-inworld-${activeVideoAsset.id}`}
      isOpen={true}
      onClose={onClose}
      title={activeVideoAsset.name || 'VideoPlayer'}
      scene={scene}
      camera={camera}
      assetManager={assetManager || undefined}
      spatialPanelManager={spatialPanelManager}
      defaultWidth={1000}
      defaultHeight={900}
      parentObject={activeVideoAsset.object3d}
      anchorOffset={new THREE.Vector3(0, 0, 0.048)}
      frameless={true}
      dockToParent={true}
      panelId={`video-controls-${activeVideoAsset.id}`}
    >
      <div
        onPointerMove={resetVideoInactivityTimer}
        onPointerDown={resetVideoInactivityTimer}
        className="w-full h-full"
      >
        <VideoObjectControls
          state={activeVideoState}
          assetId={activeVideoAsset.id}
          assetManager={assetManager}
          assetName={activeVideoAsset.name}
          onPlay={() => {
            handleVideoAction(activeVideoAsset.id, 'play');
            resetVideoInactivityTimer();
          }}
          onPause={() => {
            handleVideoAction(activeVideoAsset.id, 'pause');
            resetVideoInactivityTimer();
          }}
          onSeek={(time) => {
            handleVideoAction(activeVideoAsset.id, 'seek', time);
            resetVideoInactivityTimer();
          }}
          onStep={(delta) => {
            handleVideoAction(activeVideoAsset.id, 'step', delta);
            resetVideoInactivityTimer();
          }}
          onVolumeChange={(vol) => {
            handleVideoAction(activeVideoAsset.id, 'volume', vol);
            resetVideoInactivityTimer();
          }}
          onVolumeModeToggle={(mode) => {
            handleVideoAction(activeVideoAsset.id, 'volumeMode', mode);
            resetVideoInactivityTimer();
          }}
          onMuteToggle={() => {
            handleVideoAction(activeVideoAsset.id, 'mute');
            resetVideoInactivityTimer();
          }}
          onSubtitlesToggle={() => {
            handleVideoAction(activeVideoAsset.id, 'subtitlesToggle');
            resetVideoInactivityTimer();
          }}
          onAddSubtitles={async (file: File) => {
            try {
              const text = await file.text();
              const am = assetManager;
              const net = networkService;
              if (am) {
                am.applyVideoState(activeVideoAsset.id, {
                  subtitlesData: text,
                  subtitlesEnabled: true,
                });
                const state = am.getVideoState(activeVideoAsset.id);
                net?.broadcastVideoState({
                  assetId: activeVideoAsset.id,
                  playing: state?.playing ?? false,
                  currentTime: state?.currentTime ?? 0,
                  globalVolume: state?.globalVolume ?? 0.8,
                  subtitlesData: text,
                  subtitlesEnabled: true,
                });
              }
              resetVideoInactivityTimer();
            } catch (err) {
              console.warn('[VideoControls] Failed to read subtitle file:', err);
            }
          }}
          syncMode={activeVideoState.syncMode || activeVideoAsset.metadata?.videoSyncMode || 'persistent'}
          canToggleSyncMode={!!(activeVideoAsset.fileData || networkService.isHost)}
          onSyncModeToggle={(mode) => {
            handleVideoAction(activeVideoAsset.id, 'syncMode', mode);
            resetVideoInactivityTimer();
          }}
          onClose={onClose}
          onRemoveVideo={() => {
            assetManager?.removeAsset(activeVideoAsset.id);
            networkService.broadcastRemove(activeVideoAsset.id);
            if (manipulationManager?.selectedAsset?.id === activeVideoAsset.id) {
              manipulationManager.selectAsset(null);
              setSelectedAsset(null);
            }
            onClose();
          }}
          isFlipped={isFlipped}
          onFlip={() => {
            const asset = activeVideoAsset;
            const am = assetManager;
            if (!asset || !am) return;
            const next = !(am.getVideoState(asset.id)?.flipped ?? true);
            am.applyVideoState(asset.id, { flipped: next });
            const state = am.getVideoState(asset.id);
            networkService.broadcastVideoState({
              assetId: asset.id,
              playing: state?.playing ?? false,
              currentTime: state?.currentTime ?? 0,
              globalVolume: state?.globalVolume ?? 0.8,
              flipped: next,
            });
          }}
        />
      </div>
    </SpatialPopUpWrapper>
  );
});
