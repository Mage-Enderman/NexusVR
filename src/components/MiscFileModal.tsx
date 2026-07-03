import React from 'react';
import { X, FileText, Download, PackagePlus } from 'lucide-react';
import type { LoadedAsset } from '../engine/AssetManager.ts';

interface MiscFileModalProps {
  asset: LoadedAsset;
  onClose: () => void;
  onDownload: (asset: LoadedAsset) => void;
  onSaveToInventory: (asset: LoadedAsset) => Promise<void>;
}

export const MiscFileModal: React.FC<MiscFileModalProps> = ({
  asset,
  onClose,
  onDownload,
  onSaveToInventory,
}) => {
  const meta = asset.metadata || {};
  const sizeMB = meta.fileSize ? (meta.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown Size';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel max-w-md w-[90vw] p-6 space-y-5 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end">
          <button onClick={onClose} className="btn-icon w-7 h-7 btn-glass hover:text-rose-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#00f0ff]/20 to-[#a855f7]/20 flex items-center justify-center mx-auto border border-cyan-500/30 shadow-[0_0_20px_rgba(0,240,255,0.2)]">
          <FileText className="w-8 h-8 text-[#00f0ff]" />
        </div>

        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-full border border-purple-500/20">
            {meta.extension || 'Generic File'}
          </span>
          <h3 className="text-lg font-bold font-['Outfit'] text-white mt-3 break-all px-2">
            {asset.name}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Size: {sizeMB} • Type: {meta.mimeType || 'binary/data'}
          </p>
        </div>

        <div className="flex flex-col gap-2.5 pt-3">
          <button
            onClick={() => {
              onDownload(asset);
              onClose();
            }}
            className="btn btn-primary w-full py-3 text-sm bg-gradient-to-r from-[#00f0ff] to-[#0099ff] text-black font-bold shadow-lg"
          >
            <Download className="w-4 h-4" />
            <span>Download File to Device</span>
          </button>

          <button
            onClick={async () => {
              await onSaveToInventory(asset);
              onClose();
            }}
            className="btn btn-secondary w-full py-3 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 font-bold"
          >
            <PackagePlus className="w-4 h-4" />
            <span>Save to Inventory Storage</span>
          </button>
        </div>
      </div>
    </div>
  );
};
