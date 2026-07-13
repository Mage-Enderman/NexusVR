import React, { useEffect, useState } from 'react';
import {
  X,
  Box,
  UserCheck,
  Download,
  Trash2,
  PlusCircle,
  Search,
  Folder,
  FolderPlus,
  Edit3,
  Check,
  FolderOpen,
  Camera
} from 'lucide-react';
import { InventoryService } from '../services/InventoryService.ts';
import type { InventoryItem } from '../services/InventoryService.ts';

interface InventoryModalProps {
  inventoryService: InventoryService;
  onClose: () => void;
  onSpawnItem: (item: InventoryItem) => void;
  onEquipVrm: (item: InventoryItem) => void;
  onGenerateThumbnail?: (item: InventoryItem) => Promise<void>;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  inventoryService,
  onClose,
  onSpawnItem,
  onEquipVrm,
  onGenerateThumbnail,
}) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | 'ALL' | 'UNSORTED'>('ALL');
  const [filter, setFilter] = useState<'all' | 'tool' | '3d-model' | 'vrm' | 'primitive' | 'misc'>('all');
  const [search, setSearch] = useState('');

  // New folder creation state
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);

  // Item Rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Item Move folder state
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>('');
  const [generatingThumbnailId, setGeneratingThumbnailId] = useState<string | null>(null);

  const loadData = async () => {
    const data = await inventoryService.getItems();
    // Exclude internal system metadata rows
    const visible = data.filter((item) => item.type !== 'system' && item.id !== 'sys-folders');
    setItems(visible);
    const folderList = await inventoryService.getFolders();
    setFolders(folderList);
  };

  useEffect(() => {
    loadData();
  }, [inventoryService]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await inventoryService.removeItem(id);
    loadData();
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await inventoryService.createFolder(newFolderName.trim());
    setNewFolderName('');
    setShowNewFolderInput(false);
    loadData();
  };

  const handleDeleteFolder = async (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await inventoryService.deleteFolder(folderName);
    if (selectedFolder === folderName) setSelectedFolder('ALL');
    loadData();
  };

  const handleStartRename = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditingName(item.name);
    setMovingId(null);
  };

  const handleSaveRename = async (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingName.trim()) {
      await inventoryService.renameItem(id, editingName.trim());
      loadData();
    }
    setEditingId(null);
  };

  const handleStartMove = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setMovingId(item.id);
    setMoveTargetFolder(item.folder || '');
    setEditingId(null);
  };

  const handleSaveMove = async (id: string, folderName: string) => {
    await inventoryService.moveItemToFolder(id, folderName || undefined);
    setMovingId(null);
    loadData();
  };

  const handleDownload = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.fileData && !item.url) return;
    const blob = item.fileData
      ? new Blob([item.fileData], { type: item.metadata?.mimeType || 'application/octet-stream' })
      : null;
    const url = blob ? URL.createObjectURL(blob) : item.url!;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (blob) URL.revokeObjectURL(url);
  };

  const filteredItems = items.filter((item) => {
    if (selectedFolder === 'UNSORTED' && item.folder) return false;
    if (selectedFolder !== 'ALL' && selectedFolder !== 'UNSORTED' && item.folder !== selectedFolder) return false;
    if (filter !== 'all' && item.type !== filter) return false;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content glass-panel max-w-6xl w-[96vw] h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-[#a855f7] flex items-center justify-center border border-purple-500/30">
              <Box className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-['Outfit'] tracking-wide text-white">Inventory &amp; Folder Management</h2>
              <p className="text-xs text-slate-400">
                Organize, rename, move to folders, and spawn your 3D models, tools, and assets.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-glass hover:text-rose-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Layout: Sidebar + Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Folder Sidebar */}
          <div className="w-64 border-r border-white/10 bg-slate-950/40 flex flex-col p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Folders</span>
              <button
                onClick={() => setShowNewFolderInput(!showNewFolderInput)}
                className="text-xs flex items-center gap-1 text-purple-400 hover:text-purple-300 font-semibold"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>

            {showNewFolderInput && (
              <form onSubmit={handleCreateFolder} className="mb-3 flex gap-1">
                <input
                  type="text"
                  placeholder="Folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="text-input text-xs py-1.5 px-2 flex-1 rounded-lg bg-slate-900"
                  autoFocus
                />
                <button type="submit" className="btn btn-primary text-xs py-1 px-2.5 rounded-lg font-bold">
                  Add
                </button>
              </form>
            )}

            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              <button
                onClick={() => setSelectedFolder('ALL')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  selectedFolder === 'ALL'
                    ? 'bg-purple-500/25 text-purple-200 border border-purple-500/40'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-purple-400" />
                  <span>All Items</span>
                </div>
                <span className="text-[10px] bg-slate-800/80 px-2 py-0.5 rounded-full text-slate-400">
                  {items.length}
                </span>
              </button>

              <button
                onClick={() => setSelectedFolder('UNSORTED')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  selectedFolder === 'UNSORTED'
                    ? 'bg-purple-500/25 text-purple-200 border border-purple-500/40'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-slate-400" />
                  <span>Unsorted</span>
                </div>
                <span className="text-[10px] bg-slate-800/80 px-2 py-0.5 rounded-full text-slate-400">
                  {items.filter((i) => !i.folder).length}
                </span>
              </button>

              {folders.map((fName) => {
                const count = items.filter((i) => i.folder === fName).length;
                return (
                  <div
                    key={fName}
                    className={`group flex items-center justify-between rounded-xl transition-all ${
                      selectedFolder === fName
                        ? 'bg-purple-500/25 text-purple-200 border border-purple-500/40'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedFolder(fName)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-left truncate"
                    >
                      <Folder className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <span className="truncate">{fName}</span>
                    </button>
                    <div className="flex items-center gap-1 pr-2">
                      <span className="text-[10px] bg-slate-800/80 px-1.5 py-0.5 rounded-full text-slate-400">
                        {count}
                      </span>
                      <button
                        onClick={(e) => handleDeleteFolder(fName, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition-opacity"
                        title="Delete Folder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Main Grid Area */}
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            {/* Toolbar: Category Filters & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-1.5 bg-slate-900/60 p-1.5 rounded-xl border border-white/5 overflow-x-auto">
                {(['all', 'tool', '3d-model', 'vrm', 'primitive', 'misc'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`btn btn-glass text-xs py-1.5 px-3 capitalize font-semibold transition-all ${
                      filter === tab
                        ? 'active bg-purple-500/30 text-purple-200 border-purple-500/50 shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab === 'all' ? 'All Types' : tab === 'tool' ? 'Tools' : tab.replace('-', ' ')}
                  </button>
                ))}
              </div>

              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3" />
                <input
                  type="text"
                  placeholder="Search inventory..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="text-input text-xs py-2 pl-9 pr-4 w-56 rounded-xl bg-slate-900/80 border border-white/10"
                />
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 content-start">
              {filteredItems.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-500">
                  <Box className="w-14 h-14 mb-3 stroke-1" />
                  <p className="text-base font-semibold text-slate-400">No items match your filter.</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Try switching folders, importing new assets, or clearing the search box.
                  </p>
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="group glass-card flex flex-col justify-between p-4 rounded-2xl border border-white/10 hover:border-purple-500/40 relative overflow-hidden transition-all duration-200 bg-slate-900/60 shadow-lg"
                  >
                    {/* Item Card Visual Preview Thumbnail */}
                    {item.previewUrl ? (
                      <div className="w-full h-36 rounded-xl mb-3 bg-slate-950/80 border border-white/5 overflow-hidden relative group-hover:border-purple-500/30 transition-all flex items-center justify-center">
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          className="w-full h-full object-contain p-2 filter drop-shadow-md group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    ) : onGenerateThumbnail && (item.type === '3d-model' || item.type === 'primitive' || item.type === 'vrm' || item.fileData || item.url) ? (
                      <div className="w-full h-28 rounded-xl mb-3 bg-slate-950/70 border border-white/10 flex flex-col items-center justify-center gap-2 p-3 text-center">
                        <button
                          type="button"
                          disabled={generatingThumbnailId === item.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setGeneratingThumbnailId(item.id);
                            try {
                              await onGenerateThumbnail(item);
                              await loadData();
                            } finally {
                              setGeneratingThumbnailId(null);
                            }
                          }}
                          className="btn btn-secondary text-xs py-1.5 px-3 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20 flex items-center gap-1.5 font-bold transition shadow-md"
                        >
                          <Camera className="w-3.5 h-3.5 text-cyan-400" />
                          <span>
                            {generatingThumbnailId === item.id
                              ? 'Generating...'
                              : 'Generate Thumbnail'}
                          </span>
                        </button>
                      </div>
                    ) : null}

                    {/* Item Card Header */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className={`text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded border ${
                            item.type === 'tool'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                              : item.type === 'primitive'
                              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                              : item.type === 'vrm'
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          }`}
                        >
                          {item.type === 'primitive'
                            ? `Primitive: ${item.primitiveType || item.name.replace(/Primitive\s*/i, '')}`
                            : item.type === 'tool'
                            ? `Tool: ${item.toolType || item.name.split(' ')[0]}`
                            : item.type}
                        </span>

                        {item.folder && (
                          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30 flex items-center gap-1">
                            <Folder className="w-3 h-3" />
                            {item.folder}
                          </span>
                        )}
                      </div>

                      {/* Title OR Rename Editor */}
                      {editingId === item.id ? (
                        <form onSubmit={(e) => handleSaveRename(item.id, e)} className="flex items-center gap-1.5 my-2">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="text-input text-xs py-1 px-2 flex-1 rounded-lg bg-slate-950 font-bold"
                            autoFocus
                          />
                          <button type="submit" className="btn btn-primary text-xs p-1.5 rounded-lg" title="Save Rename">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="btn btn-secondary text-xs p-1.5 rounded-lg"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : (
                        <h3 className="font-bold text-base text-white mt-1 leading-snug truncate" title={item.name}>
                          {item.name}
                        </h3>
                      )}

                      <p className="text-xs text-slate-400 line-clamp-2 mt-1">
                        {item.metadata?.description ||
                          `Created ${new Date(item.createdAt).toLocaleDateString()}`}
                      </p>
                    </div>

                    {/* Move to Folder menu if movingId === item.id */}
                    {movingId === item.id && (
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-950/80 border border-purple-500/30 space-y-2">
                        <div className="text-[11px] font-bold text-purple-300">Move to Folder:</div>
                        <select
                          value={moveTargetFolder}
                          onChange={(e) => setMoveTargetFolder(e.target.value)}
                          className="text-input text-xs py-1.5 px-2 w-full rounded-lg bg-slate-900 text-white"
                        >
                          <option value="">(No Folder / Unsorted)</option>
                          {folders.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            onClick={() => setMovingId(null)}
                            className="btn btn-secondary text-xs py-1 px-2 rounded-lg"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveMove(item.id, moveTargetFolder)}
                            className="btn btn-primary text-xs py-1 px-2.5 rounded-lg font-bold"
                          >
                            Save Move
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action Row: Primary Action + Management Buttons */}
                    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                      {/* Main Spawn / Equip Button */}
                      <button
                        onClick={() => onSpawnItem(item)}
                        className={`btn text-xs py-2 px-3.5 flex-1 font-bold flex items-center justify-center gap-1.5 ${
                          item.type === 'tool'
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-amber-500/20'
                            : 'btn-primary bg-gradient-to-r from-[#00f0ff] to-[#0099ff] text-black'
                        }`}
                        title={item.type === 'tool' ? 'Equip tool' : 'Spawn item into the 3D world'}
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span>
                          {item.type === 'tool'
                            ? 'Equip Tool'
                            : item.type === 'primitive'
                            ? 'Spawn Shape'
                            : 'Spawn'}
                        </span>
                      </button>

                      {item.type === 'vrm' && (
                        <button
                          onClick={() => onEquipVrm(item)}
                          className="btn btn-secondary text-xs py-2 px-3 bg-gradient-to-r from-purple-500 to-indigo-600 font-bold flex items-center gap-1.5"
                          title="Equip as your custom VRM avatar"
                        >
                          <UserCheck className="w-4 h-4" />
                          <span>Equip Avatar</span>
                        </button>
                      )}

                      {/* Management Buttons (Rename, Move, Download, Delete) */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleStartRename(item, e)}
                          className="btn btn-glass text-xs py-1.5 px-2.5 rounded-lg text-slate-300 hover:text-white flex items-center gap-1"
                          title="Rename Item"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Rename</span>
                        </button>

                        <button
                          onClick={(e) => handleStartMove(item, e)}
                          className="btn btn-glass text-xs py-1.5 px-2.5 rounded-lg text-slate-300 hover:text-white flex items-center gap-1"
                          title="Move to Folder"
                        >
                          <Folder className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Move</span>
                        </button>

                        {(item.fileData || item.url) && (
                          <button
                            onClick={(e) => handleDownload(item, e)}
                            className="btn-icon btn-glass w-8 h-8 rounded-lg text-slate-300 hover:text-cyan-400"
                            title="Download File"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}

                        {!item.id.startsWith('prim-default-') && !item.id.startsWith('tool-default-') && (
                          <button
                            onClick={(e) => handleDelete(item.id, e)}
                            className="btn-icon btn-glass w-8 h-8 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15"
                            title="Delete Item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
