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
  // 3D Models
  modelScaleMode: 'auto' | 'meters' | 'cm' | 'inches' | 'custom';
  customScaleMultiplier: number;
  shading: 'smooth' | 'flat';
  // Images
  imageDisplayMode: '2d-plane' | 'billboard' | 'panel' | 'panorama-360' | 'skybox';
  textureFiltering: 'smooth' | 'pixel-art';
  maxResolution: 'original' | '1024' | '512' | '2048';
  // Videos
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
      modelScaleMode,
      customScaleMultiplier,
      shading,
      imageDisplayMode,
      textureFiltering,
      maxResolution,
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
      defaultWidth={620}
      defaultHeight={740}
      initialPinned={true}
    >
      <div
        className={`w-full flex flex-col p-3 bg-slate-950/95 text-white overflow-hidden font-sans text-xs select-none ${
          !interactive ? 'opacity-90' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        style={{ height: 'auto', minHeight: '520px', maxHeight: '90vh' }}
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

        {/* Scrollable body — wraps the existing inner content (tabs, input
            area, category options, footer). The outer modal-content stays
            a HUD-like dialog with a fixed header; the body scrolls and the
            footer lives inside it (keeps the diff small). The pointer-
            events-none wrapper below blocks all click-and-drag inside the
            body when the panel is read-only, so even though inputs are
            technically keyboard-navigable, the user can't accidentally fire
            changes that wouldn't broadcast anyway. */}
        <div className={`flex-1 overflow-visible space-y-3 font-sans text-xs select-none ${
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
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-slate-300 block mb-1.5 font-semibold">Aspect Ratio</span>
                    <div className="grid grid-cols-2 gap-1 bg-black/40 p-1 rounded-xl">
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

                  <div className="flex flex-col justify-center space-y-2 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input type="checkbox" checked={videoLoop} onChange={(e) => setVideoLoop(e.target.checked)} className="w-4 h-4 rounded accent-cyan-400" />
                      <span>Loop Video Playback</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input type="checkbox" checked={videoAutoplay} onChange={(e) => setVideoAutoplay(e.target.checked)} className="w-4 h-4 rounded accent-cyan-400" />
                      <span>Autoplay Video & Audio</span>
                    </label>
                  </div>
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
            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
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
          </div>
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
