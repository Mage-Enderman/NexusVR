import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Save,
  FolderOpen,
  Download,
  Upload,
  Trash2,
  Clock,
  Sparkles,
  Globe,
  Camera,
  Star
} from 'lucide-react';
import { SceneSerializationService, type SavedScene } from '../services/SceneSerializationService.ts';

interface SceneSaveLoadModalProps {
  sceneService: SceneSerializationService;
  onClose: () => void;
  onSaveCurrentScene: (name: string) => Promise<SavedScene>;
  onLoadScene: (scene: SavedScene) => void;
}

export const SceneSaveLoadModal: React.FC<SceneSaveLoadModalProps> = ({
  sceneService,
  onClose,
  onSaveCurrentScene,
  onLoadScene,
}) => {
  const [scenes, setScenes] = useState<SavedScene[]>([]);
  const [roomName, setRoomName] = useState('My VR World');
  const [isSaving, setIsSaving] = useState(false);
  const [favoriteSceneId, setFavoriteSceneId] = useState<string | null>(() =>
    sceneService.getFavoriteSceneId()
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshScenes = async () => {
    const list = await sceneService.getScenes();
    setScenes(list);
    setFavoriteSceneId(sceneService.getFavoriteSceneId());
  };

  useEffect(() => {
    refreshScenes();
  }, [sceneService]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextId = favoriteSceneId === id ? null : id;
    sceneService.setFavoriteSceneId(nextId);
    setFavoriteSceneId(nextId);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveCurrentScene(roomName.trim());
      setRoomName('My VR World');
      await refreshScenes();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await sceneService.deleteScene(id);
    if (favoriteSceneId === id) {
      sceneService.setFavoriteSceneId(null);
      setFavoriteSceneId(null);
    }
    refreshScenes();
  };

  const handleExport = (scene: SavedScene, e: React.MouseEvent) => {
    e.stopPropagation();
    sceneService.exportSceneToJson(scene);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await sceneService.importSceneFromJson(file);
      await refreshScenes();
    } catch (err) {
      alert(`Failed to import room: ${(err as Error).message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md animate-in fade-in duration-200 p-4">
      <div
        className="glass-panel w-full max-w-5xl max-h-[85vh] flex flex-col rounded-3xl border border-cyan-500/30 overflow-hidden shadow-2xl bg-slate-950/90"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-slate-900 via-slate-900/80 to-purple-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">World & Room Persistence</h2>
              <p className="text-xs text-slate-400">Save complete 3D scene arrangements, lighting, and environments</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.nexus"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 border-purple-500/30 hover:border-purple-400"
            >
              <Upload className="w-3.5 h-3.5 text-purple-300" />
              <span>Import .nexus</span>
            </button>

            <button
              onClick={onClose}
              className="btn btn-glass p-2 rounded-xl text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Save Current Room Action Bar */}
        <div className="px-6 py-4 bg-slate-900/60 border-b border-white/5">
          <form onSubmit={handleSave} className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Save Current Room:</span>
            </div>

            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="text"
                placeholder="Name your room..."
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="text-input text-xs py-2 px-3 flex-1 rounded-xl bg-slate-950/80 border border-white/10 text-white font-semibold"
              />
              <button
                type="submit"
                disabled={isSaving || !roomName.trim()}
                className="btn btn-primary text-xs py-2 px-4 flex items-center gap-1.5 font-bold shadow-lg shadow-cyan-500/20"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Snapshot'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Gallery Grid */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 content-start">
          {scenes.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-500">
              <Globe className="w-14 h-14 mb-3 stroke-1 text-slate-600" />
              <p className="text-base font-semibold text-slate-400">No saved world layouts yet.</p>
              <p className="text-xs text-slate-600 mt-1">
                Enter a name above and click "Save Snapshot" to record the current room!
              </p>
            </div>
          ) : (
            scenes.map((scene) => (
              <div
                key={scene.id}
                className={`glass-card flex flex-col justify-between p-4 rounded-2xl border transition-all duration-200 group bg-slate-900/70 shadow-xl ${
                  favoriteSceneId === scene.id
                    ? 'border-amber-400/60 shadow-amber-500/10'
                    : 'border-white/10 hover:border-cyan-500/40'
                }`}
              >
                {/* 16:9 Scene Preview Banner */}
                <div className="w-full h-36 rounded-xl mb-3 bg-slate-950/90 border border-white/5 overflow-hidden relative flex items-center justify-center">
                  {scene.thumbnailUrl ? (
                    <img
                      src={scene.thumbnailUrl}
                      alt={scene.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center text-slate-600">
                      <Sparkles className="w-8 h-8 mb-1" />
                      <span className="text-[10px] uppercase font-bold">No Preview</span>
                    </div>
                  )}

                  {favoriteSceneId === scene.id && (
                    <div className="absolute top-2 left-2 bg-amber-500/95 backdrop-blur-md px-2.5 py-0.5 rounded-full border border-amber-300/50 text-[10px] text-black font-extrabold flex items-center gap-1 shadow-lg">
                      <Star className="w-3 h-3 fill-black text-black" />
                      <span>STARTUP ROOM</span>
                    </div>
                  )}

                  <div className="absolute top-2 right-2 bg-slate-900/90 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10 text-[10px] text-cyan-300 font-bold">
                    {scene.assets.length} {scene.assets.length === 1 ? 'Asset' : 'Assets'}
                  </div>
                </div>

                {/* Metadata */}
                <div>
                  <h3 className="font-bold text-base text-white truncate leading-snug" title={scene.name}>
                    {scene.name}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>Updated {new Date(scene.updatedAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => onLoadScene(scene)}
                    className="btn btn-primary text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1.5 font-bold"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Load Room</span>
                  </button>

                  <button
                    onClick={(e) => toggleFavorite(scene.id, e)}
                    className={`btn text-xs py-1.5 px-2.5 flex items-center justify-center transition-all ${
                      favoriteSceneId === scene.id
                        ? 'bg-amber-500/20 border border-amber-500 text-amber-300 shadow-amber-500/30'
                        : 'btn-secondary border-white/10 text-slate-400 hover:text-amber-300 hover:border-amber-400/50'
                    }`}
                    title={
                      favoriteSceneId === scene.id
                        ? 'Currently set as Default Startup Room (click to un-favorite)'
                        : 'Favorite as Default Startup Room (auto-loads on launch)'
                    }
                  >
                    <Star className={`w-3.5 h-3.5 ${favoriteSceneId === scene.id ? 'fill-amber-300 text-amber-300' : ''}`} />
                  </button>

                  <button
                    onClick={(e) => handleExport(scene, e)}
                    className="btn btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1 border-white/10 hover:border-cyan-400"
                    title="Export .nexus file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => handleDelete(scene.id, e)}
                    className="btn btn-secondary text-xs py-1.5 px-2.5 text-rose-400 border-white/10 hover:border-rose-500/50 hover:bg-rose-500/10"
                    title="Delete saved room"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
