import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import type { AssetManager } from '../engine/AssetManager.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';
import { Upload, FileBox, Image as ImageIcon, Video, User, Link2, Sliders, ArrowRight, Eye, Lock } from 'lucide-react';

export interface ImportConfig {
  file?: File;
  url?: string;
  // General
  saveToInventory: boolean;
  placement: 'in-front' | 'origin' | 'floor';
  /**
   * When true, bypasses the per-extension router (loadGLB / loadImage /
   * loadVideo / /VRM loader) and treats the file/url as a generic
   * "raw" binary — the same path that unrecognized extensions already
   * hit. Lands as a `misc` asset (document-card icon, download +
   * inventory actions). Always available regardless of file category
   * so users can force any file into the raw path even when its
   * extension would otherwise route through a type-specific loader
   * (e.g. a video clip they want as a downloadable blob instead of a
   * streaming texture, or a PNG that should ride across the
   * fileData socket for sharing rather than load as a texture).
   */
  importAsRawFile: boolean;
  // 3D Models
  modelScaleMode: 'auto' | 'meters' | 'cm' | 'inches' | 'custom';
  customScaleMultiplier: number;
  shading: 'smooth' | 'flat';
  // Images
  imageDisplayMode: '2d-plane' | 'billboard' | 'panel' | 'panorama-360' | 'skybox';
  textureFiltering: 'smooth' | 'pixel-art';
  maxResolution: 'original' | '1024' | '512' | '2048';
  // Videos
  videoSyncMode: 'persistent' | 'watch-party';
  videoAspectRatio: '16:9' | '9:16' | '1:1' | 'auto';
  videoLoop: boolean;
  videoAutoplay: boolean;
  // VRM
  vrmAction: 'equip-avatar' | 'spawn-npc';
}

interface AssetImportDialogProps {
  initialFile?: File | null;
  onImport: (config: ImportConfig) => Promise<void>;
  onClose: () => void;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  assetManager?: AssetManager;
  spatialPanelManager?: SpatialPanelManager;
  /**
   * Multiplayer panel-broadcast (panel-broadcast feature):
   *  - interactivePermissionGranted: when false, render a banner that
   *    explains this is a read-only mirror of someone else's import
   *    panel, and disable the file/url inputs + the submit button
   *    so edits don't accidentally fire onImport (which would create
   *    an asset from a peer's configuration, not the local user's).
   *  - originatorHeader: optional ReactNode rendered above the title
   *    when the panel was opened from a peer's panelstate broadcast
   *    (so the mirror shows "X is choosing…" instead of just the
   *    vanilla "Import & Customize Asset" title).
   *
   * Defaults to true so existing callers don't need to change.
   */
  interactivePermissionGranted?: boolean;
  originatorHeader?: React.ReactNode;
}

export const AssetImportDialog: React.FC<AssetImportDialogProps> = ({
  initialFile,
  onImport,
  onClose,
  scene,
  camera,
  assetManager,
  spatialPanelManager,
  interactivePermissionGranted,
  originatorHeader,
}) => {
  // Mirror to a default so the rest of the JSX can use `interactive`
  // without sprinkling `?? true` everywhere. The default preserves the
  // pre-broadcast behaviour: full interactivity, default title.
  const interactive = interactivePermissionGranted ?? true;
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'file' | 'url'>(initialFile ? 'file' : 'file');
  const submittingRef = useRef(false);

  // General settings
  const [saveToInventory, setSaveToInventory] = useState<boolean>(false);
  const [placement, setPlacement] = useState<'in-front' | 'origin' | 'floor'>('in-front');
  // Raw-file import: opt-in per-import override that forces the file/url
  // to be treated as an opaque binary blob and routed through the misc
  // file pipeline (document-card icon + Download / Save-to-Inventory
  // actions). Defaults to false so existing imports keep their
  // type-specific behavior — a fresh checkbox in the common footer of
  // the dialog flips it on for the current selection.
  const [importAsRawFile, setImportAsRawFile] = useState<boolean>(false);

  // 3D Model settings
  const [modelScaleMode, setModelScaleMode] = useState<'auto' | 'meters' | 'cm' | 'inches' | 'custom'>('auto');
  const [customScaleMultiplier, setCustomScaleMultiplier] = useState<number>(1.0);
  const [shading, setShading] = useState<'smooth' | 'flat'>('smooth');

  // Image settings
  const [imageDisplayMode, setImageDisplayMode] = useState<'2d-plane' | 'billboard' | 'panel' | 'panorama-360' | 'skybox'>('2d-plane');
  const [textureFiltering, setTextureFiltering] = useState<'smooth' | 'pixel-art'>('smooth');
  const [maxResolution, setMaxResolution] = useState<'original' | '1024' | '512' | '2048'>('original');

  // Video settings
  // Default 'auto' — read the actual videoWidth/videoHeight off the
  // <video> element once metadata loads and resize the imported plane
  // to match. Users importing vertical / cinematic / squarish videos no
  // longer have to flip a dropdown to avoid a stretched preview. They
  // can still pin a fixed ratio via the buttons (which set state to
  // '1:1' / '9:16' / '16:9' on click).
  const [videoSyncMode, setVideoSyncMode] = useState<'persistent' | 'watch-party'>('persistent');
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16' | '1:1' | 'auto'>('auto');
  const [videoLoop, setVideoLoop] = useState<boolean>(true);
  const [videoAutoplay, setVideoAutoplay] = useState<boolean>(true);

  // VRM settings
  const [vrmAction, setVrmAction] = useState<'equip-avatar' | 'spawn-npc'>('equip-avatar');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [dragOver, setDragOver] = useState<boolean>(false);

  useEffect(() => {
    if (initialFile) {
      setSelectedFile(initialFile);
      setActiveTab('file');
    }
  }, [initialFile]);

  const getFileCategory = (): 'model' | 'image' | 'video' | 'vrm' | 'misc' => {
    const name = selectedFile ? selectedFile.name.toLowerCase() : urlInput.toLowerCase();
    if (name.endsWith('.vrm')) return 'vrm';
    if (name.endsWith('.glb') || name.endsWith('.gltf') || name.endsWith('.obj') || name.endsWith('.fbx')) return 'model';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.gif')) return 'image';
    if (name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov')) return 'video';
    return 'misc';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  // Phase 1 user-warning: surface a bannered notice when a video file
  // exceeds the local playback-friendly threshold (~50 MB). Above this,
  // the network sync channel will refuse to ship the binary to peers
  // (NetworkService.MAX_INLINED_FILE_BYTES), so the host imports a
  // file that guests can't see unless the host also pastes a URL.
  // Quest local playback continues to work past 50 MB thanks to
  // Phase 2 work in AssetManager (File is no longer slurped into a
  // heap ArrayBuffer); only the P2P sync is gated.
  const VIDEO_WARN_BYTES = 50 * 1024 * 1024;
  const showVideoTooLargeWarning =
    !!selectedFile &&
    (selectedFile.name.toLowerCase().endsWith('.mp4') ||
      selectedFile.name.toLowerCase().endsWith('.webm') ||
      selectedFile.name.toLowerCase().endsWith('.mov')) &&
    selectedFile.size > VIDEO_WARN_BYTES;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setActiveTab('file');
    }
  };

  const handleSubmit = async () => {
    // Guard against submitting from a read-only mirror. Without this, a
    // peer's accidental click on the "Import & Spawn" button of someone
    // else's import dialog would call onImport with the originator's
    // settings + the peer's file picker result, creating a confusing
    // hybrid config that would then broadcastSpawn a malformed asset.
    // Originator themselves always has interactive=true so the check
    // is a no-op for them.
    if (!interactive) return;
    if (!selectedFile && !urlInput.trim()) return;
    if (submittingRef.current || isSubmitting) return;
    submittingRef.current = true;
    setIsSubmitting(true);

    const config: ImportConfig = {
      file: activeTab === 'file' && selectedFile ? selectedFile : undefined,
      url: activeTab === 'url' ? urlInput.trim() : undefined,
      saveToInventory,
      placement,
      importAsRawFile,
      modelScaleMode,
      customScaleMultiplier,
      shading,
      imageDisplayMode,
      textureFiltering,
      maxResolution,
      videoSyncMode,
      videoAspectRatio,
      videoLoop,
      videoAutoplay,
      vrmAction,
    };

    await onImport(config);
    setIsSubmitting(false);
    onClose();
  };

  const category = getFileCategory();

  return (
    <SpatialPopUpWrapper
      isOpen={true}
      onClose={onClose}
      title="Import & Customize Asset"
      icon={<FileBox className="w-4 h-4 text-purple-400" />}
      scene={scene}
      camera={camera}
      assetManager={assetManager}
      spatialPanelManager={spatialPanelManager}
      panelId="import"
      defaultWidth={480}
      defaultHeight={480}
      initialPinned={true}
    >
      <div
        className={`w-full flex flex-col p-2.5 bg-slate-950/95 text-white overflow-hidden font-sans text-xs select-none pointer-events-auto ${
          !interactive ? 'opacity-90' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        style={{ height: 'auto', maxHeight: '82vh' }}
      >

        {/* Read-only banner + originator header (panel-broadcast feature).
            Both render conditionally above the form so a peer's mirror view
            shows clear context about WHO opened the panel and WHAT their
            permission level allows. */}
        {(originatorHeader || !interactive) && (
          <div className="mb-2 space-y-1.5">
            {originatorHeader && (
              <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/40 rounded-lg px-3 py-2">
                <Eye className="w-4 h-4 text-purple-300 shrink-0" />
                <div className="flex-1 text-[11px] text-purple-200 font-semibold">
                  {originatorHeader}
                </div>
              </div>
            )}
            {!interactive && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                <Lock className="w-4 h-4 text-amber-300 shrink-0" />
                <div className="flex-1 text-[11px] text-amber-200 font-semibold">
                  Read-only mirror — your role does not include spawn permission. To import your own file, close this dialog and open import locally.
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto max-h-[430px] pr-1.5 space-y-2 font-sans text-xs select-none ${
          !interactive ? 'pointer-events-none' : ''
        }`}>
        {/* Source Tabs: Local File vs Direct URL */}
        <div className="flex items-center gap-2 bg-slate-900/60 p-1.5 rounded-2xl border border-white/5">
          <button
            onClick={() => setActiveTab('file')}
            className={`btn flex-1 text-xs py-2 flex items-center justify-center gap-2 font-semibold ${
              activeTab === 'file' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'btn-glass text-slate-400'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Upload File / Drag & Drop</span>
          </button>

          <button
            onClick={() => setActiveTab('url')}
            className={`btn flex-1 text-xs py-2 flex items-center justify-center gap-2 font-semibold ${
              activeTab === 'url' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'btn-glass text-slate-400'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>Paste Web URL / Link</span>
          </button>
        </div>

        {/* Input Area */}
        {activeTab === 'file' ? (
          selectedFile ? (
            <div className="flex items-center justify-between w-full bg-slate-900/90 border border-purple-500/40 rounded-xl p-2.5 shadow-sm">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0">
                  {category === 'model' && <FileBox className="w-4 h-4" />}
                  {category === 'image' && <ImageIcon className="w-4 h-4" />}
                  {category === 'video' && <Video className="w-4 h-4" />}
                  {category === 'vrm' && <User className="w-4 h-4" />}
                  {category === 'misc' && <Upload className="w-4 h-4" />}
                </div>
                <div className="min-w-0 text-left">
                  <h4 className="font-bold text-xs text-white truncate">{selectedFile.name}</h4>
                  <p className="text-[10px] text-slate-400">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type || 'Binary'}</p>
                </div>
              </div>
              <label className="btn btn-glass text-[10px] py-1 px-3 cursor-pointer shrink-0">
                <span>Change File</span>
                <input type="file" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center text-center transition-all ${
                dragOver ? 'border-[#00f0ff] bg-[#00f0ff]/10 scale-[1.01]' : 'border-slate-700 hover:border-slate-500 bg-slate-900/40'
              }`}
            >
              <label className="cursor-pointer space-y-2 py-2 block w-full">
                <Upload className="w-8 h-8 text-slate-500 mx-auto animate-bounce" />
                <div>
                  <span className="text-xs font-semibold text-slate-200 block">Drag & drop your file here, or click to browse</span>
                  <span className="text-[10px] text-slate-500 mt-0.5 block">Supports GLB, OBJ, FBX, PNG, JPG, MP4, VRM, ZIP, PDF</span>
                </div>
                <input type="file" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
          )
        ) : (
          <div className="space-y-2 bg-slate-900/60 p-4 rounded-2xl border border-white/5">
            <label className="text-xs font-bold text-slate-300 uppercase block">Direct Asset URL / Image Link</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://example.com/model.glb or image link..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="text-input flex-1 text-xs py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-cyan-300"
              />
            </div>
            <p className="text-[11px] text-slate-500">Paste any public URL or data URI. Make sure CORS is enabled on the target host.</p>
          </div>
        )}

        {/* Dynamic Category Options */}
        {(selectedFile || urlInput.trim()) && (
          <>
          {/* Phase 1 banner: warn the host when a selected video file is
              too big for the network sync envelope. Hosts may still spawn
              the video locally (Phase 2 keeps that working via Blob
              references rather than slurped ArrayBuffers), but peers
              won't receive the binary unless the host also broadcasts an
              HTTP URL. The tooltip / banner copy mirrors the App-level
              system chat the peer side sees on `fileDataOversized`. */}
          {showVideoTooLargeWarning && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-lg px-2.5 py-1.5 mb-1.5">
              <Sliders className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <div className="text-[11px] text-amber-100 truncate">
                <strong className="font-bold">Large video ({(selectedFile!.size / 1024 / 1024).toFixed(0)} MB):</strong>{' '}
                Local playback only. Use <em>Paste Web URL</em> tab for cross-device sync.
              </div>
            </div>
          )}
          <div className="space-y-3 bg-slate-900/40 p-3 rounded-2xl border border-white/5 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" /> {category.toUpperCase()} Customization Options
              </span>
            </div>

            {/* 3D Model Options */}
            {category === 'model' && (
              <div className="space-y-2">
                <div>
                  <span className="text-[11px] text-slate-300 block mb-1 font-semibold">Model Scale / Unit Normalization</span>
                  <div className="grid grid-cols-5 gap-1 bg-black/40 p-1 rounded-xl">
                    {(['auto', 'meters', 'cm', 'inches', 'custom'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModelScaleMode(m)}
                        className={`btn btn-glass text-[10px] py-1 capitalize truncate ${modelScaleMode === m ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''}`}
                      >
                        {m === 'auto' ? 'Auto (~2m)' : m === 'meters' ? 'Meters (1:1)' : m === 'cm' ? 'cm (0.01x)' : m === 'inches' ? 'Inches' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                {modelScaleMode === 'custom' && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-[11px] text-slate-400">Scale Multiplier:</span>
                    <input
                      type="number"
                      step="0.1"
                      value={customScaleMultiplier}
                      onChange={(e) => setCustomScaleMultiplier(parseFloat(e.target.value) || 1)}
                      className="text-input w-20 text-xs py-1 px-2 rounded-lg bg-slate-950 text-cyan-300 font-mono"
                    />
                  </div>
                )}

                <div className="pt-1.5 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-300 block mb-1 font-semibold">Surface Normal Shading (Resonite-style)</span>
                  <div className="grid grid-cols-2 gap-1.5 bg-black/40 p-1 rounded-xl">
                    {(['smooth', 'flat'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setShading(s)}
                        className={`btn btn-glass text-[11px] py-1 capitalize ${shading === s ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''}`}
                      >
                        {s === 'smooth' ? 'Smooth Shading (Default)' : 'Flat Shading (Faceted)'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Image & 360 Panorama / Skybox Options */}
            {category === 'image' && (
              <div className="space-y-4">
                <div>
                  <span className="text-xs text-slate-300 block mb-1.5 font-semibold">Image Display Mode</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: '2d-plane', label: '2D Flat Plane', desc: 'Clean flat texture plane (No frame, no auto-turn)' },
                      { id: 'panel', label: '3D Canvas Panel', desc: 'Static flat framed poster in scene' },
                      { id: 'billboard', label: '2D Sprite Billboard', desc: 'Always turns to face camera' },
                      { id: 'panorama-360', label: '360° Panorama Sphere', desc: 'Inverted sphere you step inside' },
                      { id: 'skybox', label: 'World Skybox Background', desc: 'Set as world environment background' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setImageDisplayMode(mode.id as any)}
                        className={`glass-card p-2.5 text-left transition-all ${
                          imageDisplayMode === mode.id ? 'border-[#00f0ff] bg-[#00f0ff]/10 shadow-[0_0_10px_rgba(0,240,255,0.2)] font-semibold' : 'hover:border-white/20'
                        }`}
                      >
                        <div className="text-xs text-white">{mode.label}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{mode.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                  <div>
                    <span className="text-xs text-slate-300 block mb-1.5 font-semibold">Texture Filtering</span>
                    <div className="grid grid-cols-2 gap-1 bg-black/40 p-1 rounded-xl">
                      {(['smooth', 'pixel-art'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setTextureFiltering(f)}
                          className={`btn btn-glass text-xs py-1.5 capitalize ${textureFiltering === f ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''}`}
                        >
                          {f === 'smooth' ? 'Smooth (HD)' : 'Pixel Art (Crisp)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs text-slate-300 block mb-1.5 font-semibold">Max Resolution</span>
                    <div className="grid grid-cols-2 gap-1 bg-black/40 p-1 rounded-xl">
                      {(['original', '1024', '512', '2048'] as const).map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => setMaxResolution(res)}
                          className={`btn btn-glass text-xs py-1.5 ${maxResolution === res ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''}`}
                        >
                          {res === 'original' ? 'Original' : `${res}px`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Video Options */}
            {category === 'video' && (
              <div className="space-y-2">
                <div>
                  <span className="text-[11px] text-slate-300 block mb-1 font-semibold">Sync Mode (Quest 2/3 Friendly)</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setVideoSyncMode('persistent')}
                      className={`btn btn-glass text-left p-1.5 rounded-xl transition-all ${
                        videoSyncMode === 'persistent'
                          ? 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200 font-bold'
                          : 'text-slate-400 opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div className="text-[11px]">Persistent Chunk Stream</div>
                      <div className="text-[9px] text-slate-400 font-normal">Independent scrub & peer cache</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoSyncMode('watch-party')}
                      className={`btn btn-glass text-left p-1.5 rounded-xl transition-all ${
                        videoSyncMode === 'watch-party'
                          ? 'border-purple-400/80 bg-purple-500/20 text-purple-200 font-bold'
                          : 'text-slate-400 opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div className="text-[11px] flex items-center gap-1">📡 Watch Party Stream</div>
                      <div className="text-[9px] text-slate-400 font-normal">Live WebRTC track (Zero Quest RAM)</div>
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-slate-300 block mb-1 font-semibold">Aspect Ratio</span>
                  <div className="grid grid-cols-4 gap-1 bg-black/40 p-1 rounded-xl">
                    {(['16:9', '9:16', '1:1', 'auto'] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setVideoAspectRatio(ratio)}
                        className={`btn btn-glass text-xs py-1 ${videoAspectRatio === ratio ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''}`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-200">
                    <input type="checkbox" checked={videoLoop} onChange={(e) => setVideoLoop(e.target.checked)} className="w-3.5 h-3.5 rounded accent-cyan-400" />
                    <span>Loop Playback</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-200">
                    <input type="checkbox" checked={videoAutoplay} onChange={(e) => setVideoAutoplay(e.target.checked)} className="w-3.5 h-3.5 rounded accent-cyan-400" />
                    <span>Autoplay Video & Audio</span>
                  </label>
                </div>
              </div>
            )}

            {/* VRM Avatar Options */}
            {category === 'vrm' && (
              <div className="space-y-2">
                <span className="text-xs text-slate-300 block mb-1 font-semibold">VRM Character Action</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVrmAction('equip-avatar')}
                    className={`glass-card p-3 text-left transition-all ${vrmAction === 'equip-avatar' ? 'border-purple-500 bg-purple-500/10 font-bold text-white' : 'text-slate-400'}`}
                  >
                    <div className="text-xs">Equip as Custom Avatar</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Control this character in 3D & VR</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVrmAction('spawn-npc')}
                    className={`glass-card p-3 text-left transition-all ${vrmAction === 'spawn-npc' ? 'border-cyan-500 bg-cyan-500/10 font-bold text-white' : 'text-slate-400'}`}
                  >
                    <div className="text-xs">Spawn as 3D Character Model</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Place in scene as static statue / NPC</div>
                  </button>
                </div>
              </div>
            )}

            {/* Common Placement & Storage Options */}
            <div className="pt-2 border-t border-white/5 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400 font-semibold">Spawn Position:</span>
                  {(['in-front', 'origin', 'floor'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlacement(p)}
                      className={`btn btn-glass text-[10px] py-1 px-2 capitalize ${placement === p ? 'active bg-slate-700 text-white font-bold' : 'text-slate-400'}`}
                    >
                      {p === 'in-front' ? 'In Front of Camera' : p === 'origin' ? 'Origin (0,0,0)' : 'Floor Grid'}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 cursor-pointer text-purple-300 font-semibold text-[11px]">
                  <input type="checkbox" checked={saveToInventory} onChange={(e) => setSaveToInventory(e.target.checked)} className="w-3.5 h-3.5 rounded accent-purple-500" />
                  <span>Save to Inventory</span>
                </label>
              </div>

              {/* Import-as-raw toggle */}
              {/* Universal: shown for every supported category (model, image,
                  video, vrm) AND for unrecognized extensions so the user can
                  always opt-in to the misc-file pipeline regardless of what
                  AssetManager's auto-detect would otherwise do. When ON,
                  AssetManager._loadFile / _loadFromUrl short-circuit straight
                  to createMiscFileObject and ignore any category-specific
                  options above — the category sections stay visible (so the
                  user sees what they're forgoing) but dim slightly to make
                  the override visually obvious. */}
              <div className={`flex items-center justify-between p-2 rounded-xl border transition-colors ${
                importAsRawFile
                  ? 'bg-cyan-500/10 border-cyan-500/40'
                  : 'bg-slate-900/40 border-white/5 hover:border-white/10'
              }`}>
                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={importAsRawFile}
                    onChange={(e) => setImportAsRawFile(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-cyan-500 shrink-0"
                  />
                  <span className={`font-semibold text-[11px] truncate ${importAsRawFile ? 'text-cyan-300' : 'text-slate-200'}`}>
                    Import as Raw File (Local-only stash in IndexedDB, no broadcast)
                  </span>
                </label>
              </div>
            </div>
          </div>
          </>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-glass text-xs py-2 px-5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={(!selectedFile && !urlInput.trim()) || isSubmitting || !interactive}
            title={!interactive ? 'Read-only mirror: spawn disabled while viewing a peer panel' : undefined}
            className="btn btn-primary text-xs py-2 px-6 bg-gradient-to-r from-[#00f0ff] to-[#0088ff] text-black font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <span>Importing Asset...</span>
            ) : (
              <>
                <span>Import & Spawn</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
        </div>
      </div>
    </SpatialPopUpWrapper>
  );
};
