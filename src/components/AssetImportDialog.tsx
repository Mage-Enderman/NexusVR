import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import type { AssetManager } from '../engine/AssetManager.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';
import { Upload, FileBox, Image as ImageIcon, Video, User, Link2, Sliders, ArrowRight } from 'lucide-react';

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
}

export const AssetImportDialog: React.FC<AssetImportDialogProps> = ({
  initialFile,
  onImport,
  onClose,
  scene,
  camera,
  assetManager,
  spatialPanelManager,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'file' | 'url'>(initialFile ? 'file' : 'file');

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
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16' | '1:1' | 'auto'>('16:9');
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
    if (!selectedFile && !urlInput.trim()) return;
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
      defaultWidth={500}
      defaultHeight={560}
      initialPinned={true}
    >
      <div
        className="w-full flex flex-col p-3 bg-slate-950/95 text-white overflow-hidden font-sans text-xs select-none"
        onClick={(e) => e.stopPropagation()}
        style={{ height: '440px', maxHeight: '72vh' }}
      >

        {/* Scrollable body — wraps the existing inner content (tabs, input
            area, category options, footer). The outer modal-content stays
            a HUD-like dialog with a fixed header; the body scrolls and the
            footer lives inside it (keeps the diff small). */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4 font-sans text-xs select-none">
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
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all ${
              dragOver ? 'border-[#00f0ff] bg-[#00f0ff]/10 scale-[1.01]' : selectedFile ? 'border-purple-500/50 bg-purple-500/5' : 'border-slate-700 hover:border-slate-500 bg-slate-900/40'
            }`}
          >
            {selectedFile ? (
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 text-purple-300 flex items-center justify-center mx-auto">
                  {category === 'model' && <FileBox className="w-6 h-6" />}
                  {category === 'image' && <ImageIcon className="w-6 h-6" />}
                  {category === 'video' && <Video className="w-6 h-6" />}
                  {category === 'vrm' && <User className="w-6 h-6" />}
                  {category === 'misc' && <Upload className="w-6 h-6" />}
                </div>
                <h4 className="font-bold text-sm text-white max-w-sm truncate">{selectedFile.name}</h4>
                <p className="text-xs text-slate-400">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type || 'Binary'}</p>
                <label className="btn btn-glass text-xs py-1.5 px-4 cursor-pointer inline-block mt-2">
                  <span>Change File</span>
                  <input type="file" className="hidden" onChange={handleFileChange} />
                </label>
              </div>
            ) : (
              <label className="cursor-pointer space-y-3 py-4 block w-full">
                <Upload className="w-10 h-10 text-slate-500 mx-auto animate-bounce" />
                <div>
                  <span className="text-sm font-semibold text-slate-200 block">Drag & drop your file here, or click to browse</span>
                  <span className="text-xs text-slate-500 mt-1 block">Supports GLB, OBJ, FBX, PNG, JPG, MP4, VRM, ZIP, PDF</span>
                </div>
                <input type="file" className="hidden" onChange={handleFileChange} />
              </label>
            )}
          </div>
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
          <div className="space-y-4 max-h-[35vh] overflow-y-auto pr-2 bg-slate-900/40 p-4 rounded-2xl border border-white/5 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" /> {category.toUpperCase()} Customization Options
              </span>
            </div>

            {/* 3D Model Options */}
            {category === 'model' && (
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-slate-300 block mb-1.5 font-semibold">Model Scale / Unit Normalization</span>
                  <div className="grid grid-cols-3 gap-1.5 bg-black/40 p-1 rounded-xl">
                    {(['auto', 'meters', 'cm', 'inches', 'custom'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModelScaleMode(m)}
                        className={`btn btn-glass text-xs py-1.5 capitalize ${modelScaleMode === m ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''}`}
                      >
                        {m === 'auto' ? 'Auto (~2m Box)' : m === 'meters' ? 'Meters (1:1)' : m === 'cm' ? 'cm (0.01x)' : m === 'inches' ? 'Inches (0.025x)' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                {modelScaleMode === 'custom' && (
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-xs text-slate-400">Scale Multiplier:</span>
                    <input
                      type="number"
                      step="0.1"
                      value={customScaleMultiplier}
                      onChange={(e) => setCustomScaleMultiplier(parseFloat(e.target.value) || 1)}
                      className="text-input w-24 text-xs py-1 px-2 rounded-lg bg-slate-950 text-cyan-300 font-mono"
                    />
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800">
                  <span className="text-xs text-slate-300 block mb-1.5 font-semibold">Surface Normal Shading (Resonite-style)</span>
                  <div className="grid grid-cols-2 gap-2 bg-black/40 p-1 rounded-xl">
                    {(['smooth', 'flat'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setShading(s)}
                        className={`btn btn-glass text-xs py-1.5 capitalize ${shading === s ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''}`}
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
            <div className="pt-3 border-t border-white/5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 font-semibold">Spawn Position:</span>
                {(['in-front', 'origin', 'floor'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlacement(p)}
                    className={`btn btn-glass text-xs py-1 px-2.5 capitalize ${placement === p ? 'active bg-slate-700 text-white font-bold' : 'text-slate-400'}`}
                  >
                    {p === 'in-front' ? 'In Front of Camera' : p === 'origin' ? 'Origin (0,0,0)' : 'Floor Grid'}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-purple-300 font-semibold">
                <input type="checkbox" checked={saveToInventory} onChange={(e) => setSaveToInventory(e.target.checked)} className="w-4 h-4 rounded accent-purple-500" />
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
            disabled={(!selectedFile && !urlInput.trim()) || isSubmitting}
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
