import React, { useState } from 'react';
import { X, FileText, Download, PackagePlus, Sparkles, Link2 } from 'lucide-react';
import type { LoadedAsset } from '../engine/AssetManager.ts';

interface MiscFileModalProps {
  asset: LoadedAsset;
  onClose: () => void;
  onDownload: (asset: LoadedAsset) => void;
  onSaveToInventory: (asset: LoadedAsset) => Promise<void>;
  /**
   * When true, render the raw-mode 3-button UX:
   *   - Import as Asset (cyan, primary — promotes to native type, broadcasts)
   *   - Download File to Device
   *   - Save to Inventory Storage
   * The default 2-button UX (Download + Save) is preserved for
   * non-raw misc files so the radial-context-menu held tab's
   * existing path keeps working without churn. The new "Import"
   * button is the third verb that makes raw-mode "lazy share"
   * finalize — clicking it removes the misc placeholder and emits
   * a proper 'spawn' envelope through AssetManager.importFile.
   */
  isRaw?: boolean;
  /**
   * Required when `isRaw === true`. Called when the user clicks the
   * cyan "Import as Asset" button. Wire to App.tsx's
   * handleRawAssetAction('import', asset). Returns a Promise so the
   * button can disable itself during the re-import; resolve once the
   * spawned asset has replaced the misc placeholder in the world.
   */
  onImport?: (asset: LoadedAsset) => Promise<void>;
}

export const MiscFileModal: React.FC<MiscFileModalProps> = ({
  asset,
  onClose,
  onDownload,
  onSaveToInventory,
  isRaw = false,
  onImport,
}) => {
  const meta = asset.metadata || {};
  const sizeMB = meta.fileSize ? (meta.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown Size';
  // Per-button busy flags so concurrent clicks on Download / Save /
  // Import don't fire twice while the previous one's Promise is
  // still resolving (e.g. a slow IndexedDB transaction or the
  // importFile re-import that has to drop the misc + add the
  // processed asset). Cheap — single useState per button, no
  // portal/ref composition.
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleImportClick = async () => {
    if (!onImport || importing) return;
    setImporting(true);
    try {
      await onImport(asset);
      // App.tsx closes the modal once the spawn lands (or the
      // user re-grabs the new asset), so the explicit onClose()
      // is a defensive fall-through for synchronous-resolve cases.
      onClose();
    } catch (err) {
      console.warn('[MiscFileModal] onImport failed:', err);
    } finally {
      setImporting(false);
    }
  };

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
          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/20">
            {isRaw ? 'RAW FILE (Local Only)' : (meta.extension || 'Generic File')}
          </span>
          <h3 className="text-lg font-bold font-['Outfit'] text-white mt-3 break-all px-2">
            {asset.name}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Size: {sizeMB} • Type: {meta.mimeType || 'binary/data'}
          </p>
        </div>

        {/* Lazy-share explainer (raw mode only). Keeps the user
            oriented about WHY the file isn't already in the world
            for peers, and lists the three actions as opt-in rather
            than implicit. Without this, raw mode is a confusing
            "imported but nothing happened" experience for users who
            expected peers to see the file immediately. */}
        {isRaw && (
          <div className="flex items-start gap-2 bg-cyan-500/10 border border-cyan-500/40 rounded-lg px-3 py-2 text-left">
            <Link2 className="w-4 h-4 text-cyan-300 mt-0.5 shrink-0" />
            <div className="text-[11px] text-cyan-100 leading-snug">
              <strong className="font-bold">Local-only.</strong>{' '}
              This file is stored on your device via IndexedDB but not
              broadcast to other users. Click <em>Import as Asset</em> to
              promote it to a normal scene asset (which broadcasts),
              <em> Download</em> to save the raw bytes, or
              <em> Save to Inventory</em> for later re-use.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5 pt-2">
          {isRaw && onImport && (
            <button
              onClick={handleImportClick}
              disabled={importing}
              className="btn btn-primary w-full py-3 text-sm bg-gradient-to-r from-[#00f0ff] to-[#0088ff] text-black font-bold shadow-lg disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              <span>{importing ? 'Importing…' : 'Import as Asset'}</span>
            </button>
          )}

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
              if (saving) return;
              setSaving(true);
              try {
                await onSaveToInventory(asset);
                onClose();
              } catch (err) {
                console.warn('[MiscFileModal] onSaveToInventory failed:', err);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="btn btn-secondary w-full py-3 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 font-bold disabled:opacity-60"
          >
            <PackagePlus className="w-4 h-4" />
            <span>{saving ? 'Saving…' : 'Save to Inventory Storage'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
