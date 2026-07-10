import React, { useState, useRef } from 'react';
import { X, Upload, Box, Image as ImageIcon, Video, FileText, UserCheck, HardDriveDownload } from 'lucide-react';

interface FileImportModalProps {
  onImportFile: (file: File, saveToInventory: boolean, equipVrm: boolean, videoSyncMode?: 'persistent' | 'watch-party') => Promise<void>;
  onClose: () => void;
}

export const FileImportModal: React.FC<FileImportModalProps> = ({
  onImportFile,
  onClose,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [saveToInventory, setSaveToInventory] = useState(true);
  const [equipVrmIfAvatar, setEquipVrmIfAvatar] = useState(true);
  const [videoSyncMode, setVideoSyncMode] = useState<'persistent' | 'watch-party'>('persistent');
  const [isUploading, setIsUploading] = useState(false);
  const [statusText, setStatusText] = useState('');
  
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (uploadingRef.current || isUploading) return;
    uploadingRef.current = true;
    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatusText(`Importing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);
      try {
        await onImportFile(file, saveToInventory, equipVrmIfAvatar, videoSyncMode);
      } catch (err) {
        console.error('File import error:', err);
      }
    }

    setIsUploading(false);
    setStatusText('');
    onClose();
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel max-w-lg w-[90vw] p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-[#00f0ff] flex items-center justify-center border border-cyan-500/30">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-['Outfit'] tracking-wide">Import Assets & Files</h2>
              <p className="text-xs text-slate-400">Bring 3D models, media, avatars, and data into your world.</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-glass hover:text-rose-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drag and Drop Box */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
            isDragging
              ? 'border-[#00f0ff] bg-[#00f0ff]/10 scale-[1.02]'
              : 'border-white/15 bg-slate-900/40 hover:border-white/30 hover:bg-slate-900/60'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#00f0ff]/20 to-[#a855f7]/20 flex items-center justify-center mb-3 border border-white/10">
            <Upload className="w-7 h-7 text-[#00f0ff]" />
          </div>

          <h3 className="text-sm font-bold text-slate-200">
            {isDragging ? 'Drop Files Here Now!' : 'Click to Browse or Drag & Drop Files'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
            Supports 3D Models (GLB, OBJ, FBX), Images (JPG, PNG), Videos (MP4), VRM Avatars, and any Miscellaneous files.
          </p>
        </div>

        {/* Supported Categories Badge Row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="glass-card p-2.5 flex flex-col items-center text-center">
            <Box className="w-4 h-4 text-cyan-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-300">3D Models</span>
            <span className="text-[9px] text-slate-500">GLB, OBJ, FBX</span>
          </div>
          <div className="glass-card p-2.5 flex flex-col items-center text-center">
            <ImageIcon className="w-4 h-4 text-purple-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-300">Images</span>
            <span className="text-[9px] text-slate-500">JPG, PNG</span>
          </div>
          <div className="glass-card p-2.5 flex flex-col items-center text-center">
            <Video className="w-4 h-4 text-pink-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-300">Videos</span>
            <span className="text-[9px] text-slate-500">MP4 Synced Screen</span>
          </div>
          <div className="glass-card p-2.5 flex flex-col items-center text-center">
            <FileText className="w-4 h-4 text-emerald-400 mb-1" />
            <span className="text-[10px] font-bold text-slate-300">Misc Files</span>
            <span className="text-[9px] text-slate-500">Holo File Icon</span>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-white/5">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={saveToInventory}
              onChange={(e) => setSaveToInventory(e.target.checked)}
              className="w-4 h-4 rounded accent-[#00f0ff]"
            />
            <span className="text-xs text-slate-200 flex items-center gap-1.5">
              <HardDriveDownload className="w-4 h-4 text-cyan-400" />
              <span>Save imported files locally to Offline Inventory</span>
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={equipVrmIfAvatar}
              onChange={(e) => setEquipVrmIfAvatar(e.target.checked)}
              className="w-4 h-4 rounded accent-[#a855f7]"
            />
            <span className="text-xs text-slate-200 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-purple-400" />
              <span>Automatically equip imported .VRM files as my Custom Avatar</span>
            </span>
          </label>

          <div className="pt-2 border-t border-white/10">
            <span className="text-[11px] text-slate-300 block mb-1.5 font-semibold">Video Import Mode</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVideoSyncMode('persistent')}
                className={`btn btn-glass text-left p-2 rounded-xl transition-all ${
                  videoSyncMode === 'persistent'
                    ? 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200 font-bold'
                    : 'text-slate-400 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="text-xs">Persistent Chunk Stream</div>
                <div className="text-[10px] text-slate-400 font-normal">P2P File Transfer (Peers can scrub independently)</div>
              </button>
              <button
                type="button"
                onClick={() => setVideoSyncMode('watch-party')}
                className={`btn btn-glass text-left p-2 rounded-xl transition-all ${
                  videoSyncMode === 'watch-party'
                    ? 'border-purple-400/80 bg-purple-500/20 text-purple-200 font-bold'
                    : 'text-slate-400 opacity-80 hover:opacity-100'
                }`}
              >
                <div className="text-xs flex items-center gap-1">📡 Watch Party Stream</div>
                <div className="text-[10px] text-slate-400 font-normal">Live WebRTC Track (Zero Quest RAM, Instant Play)</div>
              </button>
            </div>
          </div>
        </div>

        {/* Uploading Status Overlay */}
        {isUploading && (
          <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl flex items-center gap-3 animate-pulse">
            <div className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin shrink-0" />
            <span className="text-xs font-semibold text-cyan-300">{statusText}</span>
          </div>
        )}
      </div>
    </div>
  );
};
