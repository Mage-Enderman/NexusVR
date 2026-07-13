import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SpatialPopUpWrapper } from './SpatialPopUpWrapper.tsx';
import type { AssetManager } from '../engine/AssetManager.ts';
import type { SpatialPanelManager } from '../engine/SpatialPanelManager.ts';
import {
  Upload,
  FileBox,
  Image as ImageIcon,
  Video,
  User,
  Link2,
  Sliders,
  ArrowRight,
  Eye,
  Lock,
  CheckCircle2,
} from 'lucide-react';

export interface ImportConfig {
  file?: File;
  url?: string;
  // General
  saveToInventory: boolean;
  placement: 'in-front' | 'origin' | 'floor';
  /**
   * When true, bypasses the per-extension router (loadGLB / loadImage /
   * loadVideo / /VRM loader) and treats the file/url as a generic
   * "raw" binary.
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
  /** Flip standard 3D model (GLB/GLTF/OBJ/FBX) 180° around X axis (fixes upside-down OpenCV +Y down export format). Defaults to false. */
  flipModel180?: boolean;
  /**
   * Flip 3D Gaussian Splat (PLY/SPZ/SPLAT/KSPLAT/SOG/SOGS) 180° around X
   * axis. Defaults to TRUE — most exported splats are upside-down because
   * the canonical capture coordinate frame is +Y down (OpenCV), the opposite
   * of Three.js' +Y up. Applying a 180° X-axis rotation brings them upright
   * and matches what Blender / Resonite / Polycam importers do by default.
   * Stored on the WRAPPER Group's rotation (not the inner SplatMesh) so the
   * AssetSpawnData envelope's `rotation: [x, y, z]` already in flight on
   * peer's onSpawn (App.tsx ~2110-2182) carries the flip transitionally —
   * peers inherit the same rotation without any new envelope field.
   */
  splatFlip180?: boolean;
  /**
   * Per-import override for Spark's hierarchical LOD generation on a splat.
   * Defaults to true inside the dialog (the "Autogenerate LODs (Spark RAD)"
   * checkbox starts ticked). App.tsx injects
   * `config.splatEnableLod ?? sceneEngineRef.current?.settings.splatLodEnabled ?? true`
   * at the per-import callsites so the dialog's per-import override beats
   * the global GraphicsSettings default but the global default fills in when
   * the dialog never toggled it (e.g. inventory spawn, scene-save restore).
   */
  splatEnableLod?: boolean;
  /**
   * Forwarded as a global LOD selection-tilt. App.tsx injects
   * `sceneEngineRef.current?.settings.splatLodScale ?? 1.0` at the
   * per-import callsites — the dialog has no UI for it because it's a
   * global perf knob, not a per-import choice.
   */
  splatLodScale?: number;
  /**
   * Hard cap on the number of splats imported for this single asset.
   * Read from `GraphicsSettings.splatMaxCount` and supplied by App.tsx,
   * forwarded as `SplatMeshOptions.maxSplats` to the Spark library
   * constructor (which only honors this value at construction time —
   * existing splats in the scene are unaffected by later settings
   * changes).
   */
  splatMaxCount?: number;
}

interface AssetImportDialogProps {
  initialFile?: File | null;
  onImport: (config: ImportConfig) => Promise<void>;
  onClose: () => void;
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  assetManager?: AssetManager;
  spatialPanelManager?: SpatialPanelManager;
  interactivePermissionGranted?: boolean;
  originatorHeader?: React.ReactNode;
}

export type ImportPage =
  | 'select-source'
  | 'what-are-you-importing'
  | 'model-type'
  | 'model-scale'
  | 'model-custom-scale'
  | 'image-360-type'
  | 'all-set'
  | 'advanced-settings';

/**
 * Splat container extensions recognized by the dialog UI and the engine's
 * per-extension router. Defined at module scope so both `getFileCategory`
 * (inside the component, reading `selectedFile`/`urlInput` state) and the
 * `useEffect([initialFile])` resync (running before React has committed
 * the staged `selectedFile` update) can call `isSplatFilename` without
 * re-allocating the array per render. Mirrors AssetManager._loadFile's
 * `.includes(ext)` check so the two can never drift.
 */
const SPLAT_EXTENSIONS = ['.ply', '.spz', '.splat', '.ksplat', '.sog', '.sogs', '.rad'];

/**
 * Returns true when the supplied filename's lowercase ending matches
 * any of the splat container extensions. Callers are responsible for
 * lowercasing their input once (matches the rest of the codebase's
 * convention where helpers don't normalize inputs).
 */
const isSplatFilename = (fileName: string): boolean =>
  SPLAT_EXTENSIONS.some((ext) => fileName.endsWith(ext));

interface ResoniteOptionProps {
  title: string;
  subtitle?: string;
  onClick: () => void;
  icon?: React.ReactNode;
  active?: boolean;
}

const ResoniteOptionButton: React.FC<ResoniteOptionProps> = ({
  title,
  subtitle,
  onClick,
  icon,
  active,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-150 flex items-center justify-between group shadow-sm ${
      active
        ? 'bg-purple-900/50 border-purple-400/80 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
        : 'bg-slate-900/90 hover:bg-slate-800/95 border-white/10 hover:border-purple-400/50 hover:shadow-[0_0_12px_rgba(168,85,247,0.18)]'
    }`}
  >
    <div className="flex flex-col justify-center min-w-0 pr-2">
      <span className="text-xs sm:text-sm font-bold text-white group-hover:text-purple-200 transition-colors truncate">
        {title}
      </span>
      {subtitle && (
        <span className="text-[10px] sm:text-[11px] text-slate-400 group-hover:text-slate-300 mt-0.5 block leading-tight">
          {subtitle}
        </span>
      )}
    </div>
    {icon && <div className="shrink-0 text-slate-400 group-hover:text-purple-300">{icon}</div>}
  </button>
);

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
  const interactive = interactivePermissionGranted ?? true;
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'file' | 'url'>(initialFile ? 'file' : 'file');
  const submittingRef = useRef(false);

  // Resonite-style page navigation wizard state
  const [page, setPage] = useState<ImportPage>(initialFile ? 'what-are-you-importing' : 'select-source');
  const [history, setHistory] = useState<ImportPage[]>(initialFile ? ['select-source'] : []);

  // General settings
  const [saveToInventory, setSaveToInventory] = useState<boolean>(false);
  const [placement, setPlacement] = useState<'in-front' | 'origin' | 'floor'>('in-front');
  const [importAsRawFile, setImportAsRawFile] = useState<boolean>(false);

  // 3D Model settings
  const [modelScaleMode, setModelScaleMode] = useState<'auto' | 'meters' | 'cm' | 'inches' | 'custom'>('auto');
  const [customScaleMultiplier, setCustomScaleMultiplier] = useState<number>(1.0);
  const [shading, setShading] = useState<'smooth' | 'flat'>('smooth');
  const [flipModel180, setFlipModel180] = useState<boolean>(false);
  // splatFlip180 is the splice-180 toggle for the splat category. Splitting
  // it from flipModel180 (which stays false by default and is the
  // GLB/OBJ/FBX path) keeps the two semantics distinct: a freshly-picked
  // splat file lands with the flip ALREADY ON, so the user sees it the way
  // Resonite / Blender / Polycam present it, without having to discover and
  // tick a checkbox. The bar at the model-scale page still exposes the
  // toggle bound to this state so users can flip a splat back if their
  // particular capture is already upright.
  const [splatFlip180, setSplatFlip180] = useState<boolean>(true);
  const [splatEnableLod, setSplatEnableLod] = useState<boolean>(true);

  // Image settings
  const [imageDisplayMode, setImageDisplayMode] = useState<'2d-plane' | 'billboard' | 'panel' | 'panorama-360' | 'skybox'>('2d-plane');
  const [textureFiltering, setTextureFiltering] = useState<'smooth' | 'pixel-art'>('smooth');
  const [maxResolution, setMaxResolution] = useState<'original' | '1024' | '512' | '2048'>('original');

  // Video settings
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
      setPage('what-are-you-importing');
      setHistory(['select-source']);
      // When the user lands a splat file directly (drag-drop into world
      // from an OS file manager, or a programmatic open with initialFile),
      // ensure the flip is ON by default. For non-splat files we leave
      // flipModel180 at its existing default (false). The flip is only
      // applied if the user advances through the wizard without un-ticking
      // the toggle, which is the path we want for splats because almost
      // every captured splat is upside-down and the manual un-flip for
      // upright captures is intentional rather than the default. Reuses
      // isSplatFilename (module-scope helper shared with getFileCategory
      // at top of file) so the two detection sites never drift out of
      // sync if a new splat container is added.
      if (isSplatFilename(initialFile.name.toLowerCase())) setSplatFlip180(true);
      else setFlipModel180(false);
    }
  }, [initialFile]);

  const getFileCategory = (): 'model' | 'splat' | 'image' | 'video' | 'vrm' | 'misc' => {
    const name = selectedFile ? selectedFile.name.toLowerCase() : urlInput.toLowerCase();
    if (name.endsWith('.vrm')) return 'vrm';
    if (isSplatFilename(name)) return 'splat';
    if (name.endsWith('.glb') || name.endsWith('.gltf') || name.endsWith('.obj') || name.endsWith('.fbx')) return 'model';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.gif')) return 'image';
    if (name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov')) return 'video';
    return 'misc';
  };

  const goToPage = (nextPage: ImportPage) => {
    setHistory((prev) => [...prev, page]);
    setPage(nextPage);
  };

  const handleBack = () => {
    if (history.length > 0) {
      const prevPage = history[history.length - 1];
      setHistory((prev) => prev.slice(0, -1));
      setPage(prevPage);
    } else {
      if (page !== 'select-source') {
        setPage('what-are-you-importing');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      if (page === 'select-source') {
        goToPage('what-are-you-importing');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setActiveTab('file');
      if (page === 'select-source') {
        goToPage('what-are-you-importing');
      }
    }
  };

  const VIDEO_WARN_BYTES = 50 * 1024 * 1024;
  const showVideoTooLargeWarning =
    !!selectedFile &&
    (selectedFile.name.toLowerCase().endsWith('.mp4') ||
      selectedFile.name.toLowerCase().endsWith('.webm') ||
      selectedFile.name.toLowerCase().endsWith('.mov')) &&
    selectedFile.size > VIDEO_WARN_BYTES;

  const handleSubmit = async () => {
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
      flipModel180,
      // splatFlip180 is the user-facing toggle bound to the "Flip Model
      // 180° (Upright Fix)" checkbox on the splat path. We always pass
      // the live state so AssetManager.loadSplat can default to true
      // when the dialog DOESN'T track splatFlip180 explicitly (e.g. a
      // future consumer wiring a config object without the wizard). The
      // asset-manager default `splatFlip180 !== false` already means
      // "true unless explicitly disabled", so it's safe to round-trip the
      // exact boolean the user toggled.
      splatFlip180,
      splatEnableLod,
    };

    await onImport(config);
    setIsSubmitting(false);
    onClose();
  };

  const category = getFileCategory();

  const getWindowTitle = () => {
    if (category === 'image') return 'Import Image';
    if (category === 'model') return 'Import Model';
    if (category === 'splat') return 'Import 3D Gaussian Splat';
    if (category === 'video') return 'Import Video';
    if (category === 'vrm') return 'Import Avatar';
    return 'Import Asset';
  };

  const getSubheading = () => {
    switch (page) {
      case 'select-source':
        return 'Select or Paste Asset';
      case 'what-are-you-importing':
        return 'What are you importing?';
      case 'model-type':
        return 'What kind of 3D model?';
      case 'model-scale':
        return 'What scale is this model?';
      case 'model-custom-scale':
        return 'Set Custom Scale Multiplier';
      case 'image-360-type':
        return 'What kind of 360° image?';
      case 'all-set':
        return 'All set?';
      case 'advanced-settings':
        return 'Advanced Settings';
      default:
        return 'What are you importing?';
    }
  };

  // Helper summary description for All set page
  const getSummaryDescription = () => {
    if (importAsRawFile) return 'Raw Binary File • Save as Miscellaneous Asset';
    switch (category) {
      case 'model':
        return `3D Model • Scale: ${modelScaleMode.toUpperCase()} ${
          modelScaleMode === 'custom' ? `(${customScaleMultiplier}x)` : ''
        } • ${shading === 'smooth' ? 'Smooth Shading' : 'Flat Shading'}`;
      case 'splat':
        return `3D Gaussian Splat • Scale: ${modelScaleMode.toUpperCase()} ${
          modelScaleMode === 'custom' ? `(${customScaleMultiplier}x)` : ''
        }`;
      case 'image':
        return `Image • Mode: ${imageDisplayMode} • ${textureFiltering === 'smooth' ? 'Smooth (HD)' : 'Pixel Art'}`;
      case 'video':
        return `Video • Sync: ${videoSyncMode === 'persistent' ? 'Persistent Stream' : 'Watch Party'}`;
      case 'vrm':
        return `VRM Avatar • Action: ${vrmAction === 'equip-avatar' ? 'Equip as Custom Avatar' : 'Spawn as 3D NPC'}`;
      default:
        return 'Miscellaneous Asset File';
    }
  };

  return (
    <SpatialPopUpWrapper
      isOpen={true}
      onClose={onClose}
      title={getWindowTitle()}
      icon={<FileBox className="w-4 h-4 text-purple-400" />}
      scene={scene}
      camera={camera}
      assetManager={assetManager}
      spatialPanelManager={spatialPanelManager}
      panelId="import"
      defaultWidth={440}
      defaultHeight={500}
      initialPinned={true}
    >
      <div
        className={`w-full flex flex-col p-3 bg-slate-950/95 text-white overflow-hidden font-sans text-xs select-none pointer-events-auto ${
          !interactive ? 'opacity-90' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        style={{ height: 'auto', maxHeight: '84vh' }}
      >
        {/* Read-only banner / Originator Header */}
        {(originatorHeader || !interactive) && (
          <div className="mb-2 space-y-1.5 shrink-0">
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
                  Read-only mirror — your role does not include spawn permission.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Compact File Header Bar (shown on all pages after source selection) */}
        {page !== 'select-source' && (selectedFile || urlInput.trim()) && (
          <div className="flex items-center justify-between w-full bg-slate-900/90 border border-purple-500/40 rounded-xl p-2.5 mb-2 shadow-sm shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0">
                {category === 'model' && <FileBox className="w-4 h-4" />}
                {category === 'image' && <ImageIcon className="w-4 h-4" />}
                {category === 'video' && <Video className="w-4 h-4" />}
                {category === 'vrm' && <User className="w-4 h-4" />}
                {category === 'misc' && <Upload className="w-4 h-4" />}
              </div>
              <div className="min-w-0 text-left">
                <h4 className="font-bold text-xs text-white truncate">
                  {selectedFile ? selectedFile.name : urlInput}
                </h4>
                {selectedFile && (
                  <p className="text-[10px] text-slate-400">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type || 'Binary'}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPage('select-source');
                setHistory([]);
              }}
              className="btn btn-glass text-[10px] py-1 px-2.5 cursor-pointer shrink-0 hover:text-cyan-300"
            >
              Change File
            </button>
          </div>
        )}

        {/* Phase 1 video size warning banner */}
        {showVideoTooLargeWarning && page !== 'select-source' && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-lg px-2.5 py-1.5 mb-2 shrink-0">
            <Sliders className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <div className="text-[11px] text-amber-100 truncate">
              <strong className="font-bold">Large video ({(selectedFile!.size / 1024 / 1024).toFixed(0)} MB):</strong>{' '}
              Local playback only.
            </div>
          </div>
        )}

        {/* Resonite-style vibrant purple subheading */}
        <h3 className="text-sm sm:text-base font-bold text-[#d884ff] text-center my-1.5 tracking-wide shrink-0">
          {getSubheading()}
        </h3>

        {/* PAGE CONTENT */}
        <div
          className={`flex-1 overflow-y-auto max-h-[380px] pr-1 space-y-2 font-sans text-xs select-none ${
            !interactive ? 'pointer-events-none' : ''
          }`}
        >
          {/* Page 0: Select / Paste Source */}
          {page === 'select-source' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-slate-900/60 p-1.5 rounded-2xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setActiveTab('file')}
                  className={`btn flex-1 text-xs py-2 flex items-center justify-center gap-2 font-semibold ${
                    activeTab === 'file'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      : 'btn-glass text-slate-400'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload File / Drag & Drop</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('url')}
                  className={`btn flex-1 text-xs py-2 flex items-center justify-center gap-2 font-semibold ${
                    activeTab === 'url'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'btn-glass text-slate-400'
                  }`}
                >
                  <Link2 className="w-4 h-4" />
                  <span>Paste Web URL</span>
                </button>
              </div>

              {activeTab === 'file' ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all ${
                    dragOver
                      ? 'border-[#00f0ff] bg-[#00f0ff]/10 scale-[1.01]'
                      : 'border-slate-700 hover:border-slate-500 bg-slate-900/40'
                  }`}
                >
                  <label className="cursor-pointer space-y-2.5 py-3 block w-full">
                    <Upload className="w-8 h-8 text-slate-500 mx-auto animate-bounce" />
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">
                        Drag & drop your file here, or click to browse
                      </span>
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Supports GLB, OBJ, FBX, PNG, JPG, MP4, VRM, ZIP
                      </span>
                    </div>
                    <input type="file" className="hidden" onChange={handleFileChange} />
                  </label>
                </div>
              ) : (
                <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-white/5">
                  <label className="text-xs font-bold text-slate-300 uppercase block">
                    Direct Asset URL / Image Link
                  </label>
                  <input
                    type="text"
                    placeholder="https://example.com/model.glb or image link..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="text-input w-full text-xs py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-cyan-300"
                  />
                  <p className="text-[11px] text-slate-500">
                    Paste any public URL or data URI with CORS enabled.
                  </p>
                  <button
                    type="button"
                    onClick={() => goToPage('what-are-you-importing')}
                    disabled={!urlInput.trim()}
                    className="btn btn-primary w-full py-2.5 text-xs font-bold bg-gradient-to-r from-cyan-500 to-purple-500 disabled:opacity-40"
                  >
                    Continue to Import Settings
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Page 1: What are you importing? (Resonite Category / Mode selection) */}
          {page === 'what-are-you-importing' && (
            <div className="space-y-2 animate-in fade-in">
              {category === 'model' && (
                <>
                  <ResoniteOptionButton
                    title="3D Model"
                    subtitle="Standard 3D mesh, character, or object"
                    onClick={() => {
                      setShading('smooth');
                      setImportAsRawFile(false);
                      goToPage('model-type');
                    }}
                  />
                  <ResoniteOptionButton
                    title="3D Scan / Photogrammetry"
                    subtitle="Preserves unlit / flat scan shading defaults"
                    onClick={() => {
                      setShading('flat');
                      setImportAsRawFile(false);
                      goToPage('model-scale');
                    }}
                  />
                  <ResoniteOptionButton
                    title="CAD Model"
                    subtitle="Precision CAD or engineering geometry"
                    onClick={() => {
                      setShading('smooth');
                      setImportAsRawFile(false);
                      goToPage('model-scale');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Point Cloud / Vertex Colored Model"
                    subtitle="Vertex colored mesh data"
                    onClick={() => {
                      setShading('smooth');
                      setImportAsRawFile(false);
                      goToPage('model-scale');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Advanced Settings"
                    subtitle="Customize scale, shading, normals & placement"
                    onClick={() => goToPage('advanced-settings')}
                  />
                  <ResoniteOptionButton
                    title="Raw File"
                    subtitle="Import as raw binary file"
                    onClick={() => {
                      setImportAsRawFile(true);
                      goToPage('all-set');
                    }}
                  />
                </>
              )}

              {category === 'splat' && (
                <>
                  <ResoniteOptionButton
                    title="3D Gaussian Splatting Scene (Spark)"
                    subtitle="Fast high-fidelity 3D Gaussian Splat object (PLY, SPZ, SPLAT, KSPLAT)"
                    onClick={() => {
                      setShading('smooth');
                      setImportAsRawFile(false);
                      goToPage('model-scale');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Point Cloud / Vertex Colored Model"
                    subtitle="Standard unlit point cloud or polygon mesh"
                    onClick={() => {
                      setShading('flat');
                      setImportAsRawFile(false);
                      goToPage('model-scale');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Advanced Settings"
                    subtitle="Customize scale, placement & inventory options"
                    onClick={() => goToPage('advanced-settings')}
                  />
                  <ResoniteOptionButton
                    title="Raw File"
                    subtitle="Import as raw binary file"
                    onClick={() => {
                      setImportAsRawFile(true);
                      goToPage('all-set');
                    }}
                  />
                </>
              )}

              {category === 'image' && (
                <>
                  <ResoniteOptionButton
                    title="Image / Texture"
                    subtitle="Clean 2D flat texture plane"
                    onClick={() => {
                      setImageDisplayMode('2d-plane');
                      setTextureFiltering('smooth');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Screenshot (captured here)"
                    subtitle="3D framed canvas poster panel in scene"
                    onClick={() => {
                      setImageDisplayMode('panel');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Pixel Art"
                    subtitle="Crisp nearest-neighbor filtering"
                    onClick={() => {
                      setImageDisplayMode('2d-plane');
                      setTextureFiltering('pixel-art');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Sprite"
                    subtitle="Always turns to face camera (Billboard)"
                    onClick={() => {
                      setImageDisplayMode('billboard');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="360° photo / skybox"
                    subtitle="Equirectangular panorama sphere or world skybox"
                    onClick={() => {
                      setImportAsRawFile(false);
                      goToPage('image-360-type');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Advanced Settings"
                    subtitle="Customize display mode, filtering, resolution & placement"
                    onClick={() => goToPage('advanced-settings')}
                  />
                  <ResoniteOptionButton
                    title="Raw File"
                    subtitle="Import as raw binary file"
                    onClick={() => {
                      setImportAsRawFile(true);
                      goToPage('all-set');
                    }}
                  />
                </>
              )}

              {category === 'video' && (
                <>
                  <ResoniteOptionButton
                    title="Persistent Video Stream"
                    subtitle="Independent scrub & peer cache (Recommended)"
                    onClick={() => {
                      setVideoSyncMode('persistent');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Watch Party Live Stream"
                    subtitle="Live WebRTC stream (Zero Quest RAM)"
                    onClick={() => {
                      setVideoSyncMode('watch-party');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Advanced Settings"
                    subtitle="Customize aspect ratio, loop, autoplay & placement"
                    onClick={() => goToPage('advanced-settings')}
                  />
                  <ResoniteOptionButton
                    title="Raw File"
                    subtitle="Import as raw binary file"
                    onClick={() => {
                      setImportAsRawFile(true);
                      goToPage('all-set');
                    }}
                  />
                </>
              )}

              {category === 'vrm' && (
                <>
                  <ResoniteOptionButton
                    title="Equip as Custom Avatar"
                    subtitle="Control this character in 3D & VR immediately"
                    onClick={() => {
                      setVrmAction('equip-avatar');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Spawn as 3D NPC / Character"
                    subtitle="Place in scene as static statue / character model"
                    onClick={() => {
                      setVrmAction('spawn-npc');
                      setImportAsRawFile(false);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Advanced Settings"
                    subtitle="Customize placement & inventory options"
                    onClick={() => goToPage('advanced-settings')}
                  />
                  <ResoniteOptionButton
                    title="Raw File"
                    subtitle="Import as raw binary file"
                    onClick={() => {
                      setImportAsRawFile(true);
                      goToPage('all-set');
                    }}
                  />
                </>
              )}

              {category === 'misc' && (
                <>
                  <ResoniteOptionButton
                    title="Import File Document / Asset"
                    subtitle="Load into scene inventory as downloadable asset"
                    onClick={() => {
                      setImportAsRawFile(true);
                      goToPage('all-set');
                    }}
                  />
                  <ResoniteOptionButton
                    title="Advanced Settings"
                    subtitle="Customize placement & inventory options"
                    onClick={() => goToPage('advanced-settings')}
                  />
                </>
              )}
            </div>
          )}

          {/* Page 2: What kind of 3D model? (Screenshot 3) */}
          {page === 'model-type' && (
            <div className="space-y-2 animate-in fade-in">
              <ResoniteOptionButton
                title="Regular / Avatar"
                subtitle="Separable with snappable pieces / standard mesh"
                onClick={() => goToPage('model-scale')}
              />
              <ResoniteOptionButton
                title="Environment / World Scene"
                subtitle="Static architectural scene or level geometry"
                onClick={() => goToPage('model-scale')}
              />
            </div>
          )}

          {/* Page 3: What scale is this model? (Screenshot 3 Auto Scale) */}
          {page === 'model-scale' && (
            <div className="space-y-2 animate-in fade-in">
              {(category === 'splat' || category === 'model') && (
                <div className="p-3 rounded-xl bg-slate-900/80 border border-emerald-500/30 flex flex-col gap-2.5 mb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">
                        {category === 'splat' ? 'Flip Splat 180° (Upright Fix)' : 'Flip Model 180° (Upright Fix)'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {category === 'splat'
                          ? 'Default ON for splats — most captured splats are +Y down (OpenCV). Untick if your capture is already upright.'
                          : 'Fixes models exported upside down 180°'}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      // Bind to splatFlip180 for the splat category (default
                      // ON), flipModel180 for everything else (default OFF).
                      // For non-splat the toggle is unchanged from prior
                      // releases; for splat the user explicitly opts INTO a
                      // 180° rotation, mirroring Resonite's splat importer
                      // default. The flip is applied at the WRAPPER Group's
                      // rotation in AssetManager.loadSplat, so peers see the
                      // same orientation via the existing `rotation`
                      // envelope (App.tsx onSpawn does `asset.object3d
                      // .rotation.set(...data.rotation)` post-import).
                      checked={category === 'splat' ? splatFlip180 : flipModel180}
                      onChange={(e) =>
                        category === 'splat'
                          ? setSplatFlip180(e.target.checked)
                          : setFlipModel180(e.target.checked)
                      }
                      className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                    />
                  </div>
                  {category === 'splat' && (
                    <div className="flex items-center justify-between border-t border-slate-800/80 pt-2">
                      <div>
                        <span className="text-xs font-bold text-slate-200 block">Autogenerate LODs (Spark RAD)</span>
                        <span className="text-[10px] text-slate-400">Enabled by default for fast hierarchical rendering</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={splatEnableLod}
                        onChange={(e) => setSplatEnableLod(e.target.checked)}
                        className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              )}
              <ResoniteOptionButton
                title="Auto Scale (Unknown Scale)"
                subtitle="Automatically scale model to fit ~2 meters height"
                active={modelScaleMode === 'auto'}
                onClick={() => {
                  setModelScaleMode('auto');
                  goToPage('all-set');
                }}
              />
              <ResoniteOptionButton
                title="Meters (1:1 As Exported)"
                subtitle="1 unit = 1 meter in world space"
                active={modelScaleMode === 'meters'}
                onClick={() => {
                  setModelScaleMode('meters');
                  goToPage('all-set');
                }}
              />
              <ResoniteOptionButton
                title="Centimeters (0.01x)"
                subtitle="1 unit = 1 centimeter (scaled down 100x)"
                active={modelScaleMode === 'cm'}
                onClick={() => {
                  setModelScaleMode('cm');
                  goToPage('all-set');
                }}
              />
              <ResoniteOptionButton
                title="Inches (0.0254x)"
                subtitle="1 unit = 1 inch"
                active={modelScaleMode === 'inches'}
                onClick={() => {
                  setModelScaleMode('inches');
                  goToPage('all-set');
                }}
              />
              <ResoniteOptionButton
                title="Custom Multiplier..."
                subtitle="Specify a custom scale factor"
                active={modelScaleMode === 'custom'}
                onClick={() => goToPage('model-custom-scale')}
              />
            </div>
          )}

          {/* Page 3b: Set Custom Scale Multiplier */}
          {page === 'model-custom-scale' && (
            <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-white/10 animate-in fade-in">
              <div>
                <label className="text-xs text-slate-300 block mb-1.5 font-semibold">
                  Scale Multiplier Value
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={customScaleMultiplier}
                  onChange={(e) => {
                    setModelScaleMode('custom');
                    setCustomScaleMultiplier(parseFloat(e.target.value) || 1);
                  }}
                  className="text-input w-full text-sm py-2 px-3 rounded-xl bg-slate-950 border border-purple-500/50 text-cyan-300 font-mono"
                />
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">Quick Presets:</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0.1, 0.5, 1.0, 2.0, 10.0].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setModelScaleMode('custom');
                        setCustomScaleMultiplier(preset);
                      }}
                      className={`btn btn-glass py-1.5 text-xs font-mono ${
                        customScaleMultiplier === preset ? 'bg-purple-500/30 text-purple-200 border-purple-400' : ''
                      }`}
                    >
                      {preset}x
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => goToPage('all-set')}
                className="btn btn-primary w-full py-2.5 text-xs font-bold bg-gradient-to-r from-cyan-500 to-purple-500"
              >
                Continue to All Set?
              </button>
            </div>
          )}

          {/* Page 3c: 360 Image Type */}
          {page === 'image-360-type' && (
            <div className="space-y-2 animate-in fade-in">
              <ResoniteOptionButton
                title="360° Panorama Sphere"
                subtitle="Inverted sphere you step inside"
                onClick={() => {
                  setImageDisplayMode('panorama-360');
                  goToPage('all-set');
                }}
              />
              <ResoniteOptionButton
                title="World Skybox Background"
                subtitle="Set as world environment skybox background"
                onClick={() => {
                  setImageDisplayMode('skybox');
                  goToPage('all-set');
                }}
              />
            </div>
          )}

          {/* Page 4: All set? (Resonite Screenshot 4) */}
          {page === 'all-set' && (
            <div className="space-y-2.5 animate-in fade-in">
              {/* Summary card */}
              <div className="bg-slate-900/80 border border-purple-500/30 rounded-xl p-3 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white">Configuration Ready</div>
                  <div className="text-[11px] text-slate-300 truncate mt-0.5">
                    {getSummaryDescription()}
                  </div>
                </div>
              </div>

              {/* Primary Run Import! Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={(!selectedFile && !urlInput.trim()) || isSubmitting || !interactive}
                className="w-full bg-gradient-to-r from-[#00f0ff]/25 via-[#a855f7]/30 to-[#00f0ff]/25 hover:from-[#00f0ff]/35 hover:via-[#a855f7]/40 hover:to-[#00f0ff]/35 border border-[#00f0ff]/70 hover:border-[#00f0ff] rounded-xl px-4 py-3.5 text-center transition-all duration-150 shadow-[0_0_15px_rgba(0,240,255,0.2)] hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="text-sm sm:text-base font-extrabold text-white tracking-wide flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <span>Running Import...</span>
                  ) : (
                    <>
                      <span>Run Import!</span>
                      <ArrowRight className="w-4 h-4 text-cyan-300 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </div>
              </button>

              {/* Advanced Settings button */}
              <ResoniteOptionButton
                title="Advanced Settings"
                subtitle="Fine-tune shading, placement, filtering, & raw file options"
                onClick={() => goToPage('advanced-settings')}
              />
            </div>
          )}

          {/* Page 5: Advanced Settings (Resonite Screenshot 5) */}
          {page === 'advanced-settings' && (
            <div className="space-y-3 bg-slate-900/60 p-3 rounded-2xl border border-white/5 animate-in fade-in">
              {/* 3D Model Advanced Options */}
              {category === 'model' && (
                <div className="space-y-2.5">
                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1 font-semibold">
                      Model Scale / Unit Normalization
                    </span>
                    <div className="grid grid-cols-5 gap-1 bg-black/40 p-1 rounded-xl">
                      {(['auto', 'meters', 'cm', 'inches', 'custom'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setModelScaleMode(m)}
                          className={`btn btn-glass text-[10px] py-1 capitalize truncate ${
                            modelScaleMode === m ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''
                          }`}
                        >
                          {m === 'auto'
                            ? 'Auto (~2m)'
                            : m === 'meters'
                            ? 'Meters'
                            : m === 'cm'
                            ? 'cm'
                            : m === 'inches'
                            ? 'Inches'
                            : 'Custom'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {modelScaleMode === 'custom' && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-[11px] text-slate-400">Multiplier:</span>
                      <input
                        type="number"
                        step="0.1"
                        value={customScaleMultiplier}
                        onChange={(e) => setCustomScaleMultiplier(parseFloat(e.target.value) || 1)}
                        className="text-input w-24 text-xs py-1 px-2 rounded-lg bg-slate-950 text-cyan-300 font-mono"
                      />
                    </div>
                  )}

                  <div className="pt-1.5 border-t border-slate-800/80">
                    <span className="text-[11px] text-slate-300 block mb-1 font-semibold">
                      Surface Normal Shading (Resonite-style)
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 bg-black/40 p-1 rounded-xl">
                      {(['smooth', 'flat'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setShading(s)}
                          className={`btn btn-glass text-[11px] py-1.5 capitalize ${
                            shading === s ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''
                          }`}
                        >
                          {s === 'smooth' ? 'Smooth Shading (Default)' : 'Flat Shading (Faceted)'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Image Advanced Options */}
              {category === 'image' && (
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-slate-300 block mb-1 font-semibold">
                      Image Display Mode
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: '2d-plane', label: '2D Flat Plane' },
                        { id: 'panel', label: '3D Canvas Panel' },
                        { id: 'billboard', label: '2D Sprite Billboard' },
                        { id: 'panorama-360', label: '360° Panorama Sphere' },
                        { id: 'skybox', label: 'World Skybox' },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setImageDisplayMode(mode.id as any)}
                          className={`glass-card p-2 text-left transition-all ${
                            imageDisplayMode === mode.id
                              ? 'border-[#00f0ff] bg-[#00f0ff]/10 font-semibold text-white'
                              : 'text-slate-400'
                          }`}
                        >
                          <div className="text-xs">{mode.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/5">
                    <div>
                      <span className="text-[11px] text-slate-300 block mb-1 font-semibold">
                        Texture Filtering
                      </span>
                      <div className="grid grid-cols-2 gap-1 bg-black/40 p-1 rounded-xl">
                        {(['smooth', 'pixel-art'] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setTextureFiltering(f)}
                            className={`btn btn-glass text-[11px] py-1 capitalize ${
                              textureFiltering === f ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''
                            }`}
                          >
                            {f === 'smooth' ? 'Smooth' : 'Pixel Art'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] text-slate-300 block mb-1 font-semibold">
                        Max Resolution
                      </span>
                      <div className="grid grid-cols-2 gap-1 bg-black/40 p-1 rounded-xl">
                        {(['original', '1024', '512', '2048'] as const).map((res) => (
                          <button
                            key={res}
                            type="button"
                            onClick={() => setMaxResolution(res)}
                            className={`btn btn-glass text-[11px] py-1 ${
                              maxResolution === res ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''
                            }`}
                          >
                            {res === 'original' ? 'Original' : `${res}px`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Video Advanced Options */}
              {category === 'video' && (
                <div className="space-y-2.5">
                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1 font-semibold">
                      Sync Mode
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setVideoSyncMode('persistent')}
                        className={`btn btn-glass text-left p-1.5 rounded-xl transition-all ${
                          videoSyncMode === 'persistent'
                            ? 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200 font-bold'
                            : 'text-slate-400 opacity-80'
                        }`}
                      >
                        <div className="text-[11px]">Persistent Chunk Stream</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideoSyncMode('watch-party')}
                        className={`btn btn-glass text-left p-1.5 rounded-xl transition-all ${
                          videoSyncMode === 'watch-party'
                            ? 'border-purple-400/80 bg-purple-500/20 text-purple-200 font-bold'
                            : 'text-slate-400 opacity-80'
                        }`}
                      >
                        <div className="text-[11px]">📡 Watch Party Stream</div>
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1 font-semibold">
                      Aspect Ratio
                    </span>
                    <div className="grid grid-cols-4 gap-1 bg-black/40 p-1 rounded-xl">
                      {(['16:9', '9:16', '1:1', 'auto'] as const).map((ratio) => (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() => setVideoAspectRatio(ratio)}
                          className={`btn btn-glass text-xs py-1 ${
                            videoAspectRatio === ratio ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''
                          }`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={videoLoop}
                        onChange={(e) => setVideoLoop(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-cyan-400"
                      />
                      <span>Loop Playback</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={videoAutoplay}
                        onChange={(e) => setVideoAutoplay(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-cyan-400"
                      />
                      <span>Autoplay Video & Audio</span>
                    </label>
                  </div>
                </div>
              )}

              {/* VRM Advanced Options */}
              {category === 'vrm' && (
                <div className="space-y-2">
                  <span className="text-xs text-slate-300 block mb-1 font-semibold">
                    VRM Character Action
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVrmAction('equip-avatar')}
                      className={`glass-card p-3 text-left transition-all ${
                        vrmAction === 'equip-avatar'
                          ? 'border-purple-500 bg-purple-500/10 font-bold text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      <div className="text-xs">Equip as Custom Avatar</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVrmAction('spawn-npc')}
                      className={`glass-card p-3 text-left transition-all ${
                        vrmAction === 'spawn-npc'
                          ? 'border-cyan-500 bg-cyan-500/10 font-bold text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      <div className="text-xs">Spawn as 3D NPC</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Common Placement & Raw File settings */}
              <div className="pt-2 border-t border-white/10 space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-slate-400 font-semibold">Spawn Position:</span>
                    {(['in-front', 'origin', 'floor'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPlacement(p)}
                        className={`btn btn-glass text-[10px] py-1 px-2 capitalize ${
                          placement === p ? 'active bg-slate-700 text-white font-bold' : 'text-slate-400'
                        }`}
                      >
                        {p === 'in-front'
                          ? 'In Front of Camera'
                          : p === 'origin'
                          ? 'Origin (0,0,0)'
                          : 'Floor Grid'}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer text-purple-300 font-semibold text-[11px]">
                    <input
                      type="checkbox"
                      checked={saveToInventory}
                      onChange={(e) => setSaveToInventory(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-purple-500"
                    />
                    <span>Save to Inventory</span>
                  </label>
                </div>

                <div
                  className={`flex items-center justify-between p-2 rounded-xl border transition-colors ${
                    importAsRawFile
                      ? 'bg-cyan-500/10 border-cyan-500/40'
                      : 'bg-slate-900/40 border-white/5 hover:border-white/10'
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={importAsRawFile}
                      onChange={(e) => setImportAsRawFile(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-cyan-500 shrink-0"
                    />
                    <span
                      className={`font-semibold text-[11px] truncate ${
                        importAsRawFile ? 'text-cyan-300' : 'text-slate-200'
                      }`}
                    >
                      Import as Raw File (Local IndexedDB stash, no type-specific loader)
                    </span>
                  </label>
                </div>
              </div>

              {/* Run Import inside Advanced Settings */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={(!selectedFile && !urlInput.trim()) || isSubmitting || !interactive}
                className="w-full bg-gradient-to-r from-[#00f0ff]/25 via-[#a855f7]/30 to-[#00f0ff]/25 hover:from-[#00f0ff]/35 hover:via-[#a855f7]/40 hover:to-[#00f0ff]/35 border border-[#00f0ff]/70 hover:border-[#00f0ff] rounded-xl px-4 py-3 text-center font-bold text-white shadow-sm mt-2 flex items-center justify-center gap-2"
              >
                <span>Run Import!</span>
                <ArrowRight className="w-4 h-4 text-cyan-300" />
              </button>
            </div>
          )}
        </div>

        {/* BOTTOM BACK BUTTON (Resonite Maroon pill style on any page after select-source) */}
        {page !== 'select-source' ? (
          <button
            type="button"
            onClick={handleBack}
            className="w-full bg-[#5c242e]/90 hover:bg-[#7a2e3b] border border-rose-500/30 hover:border-rose-400/50 rounded-xl px-4 py-2.5 text-center transition-all duration-150 shadow-sm mt-2.5 shrink-0 font-bold text-xs sm:text-sm text-rose-100"
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-slate-900/80 hover:bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-center transition-all duration-150 shadow-sm mt-2.5 shrink-0 font-semibold text-xs sm:text-sm text-slate-300"
          >
            Cancel
          </button>
        )}
      </div>
    </SpatialPopUpWrapper>
  );
};

