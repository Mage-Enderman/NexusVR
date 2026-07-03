import React, { useEffect, useState } from 'react';
import { X, Box, UserCheck, Download, Trash2, PlusCircle, Search } from 'lucide-react';
import { InventoryService } from '../services/InventoryService.ts';
import type { InventoryItem } from '../services/InventoryService.ts';

interface InventoryModalProps {
  inventoryService: InventoryService;
  onClose: () => void;
  onSpawnItem: (item: InventoryItem) => void;
  onEquipVrm: (item: InventoryItem) => void;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  inventoryService,
  onClose,
  onSpawnItem,
  onEquipVrm,
}) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filter, setFilter] = useState<'all' | '3d-model' | 'vrm' | 'primitive' | 'misc'>('all');
  const [search, setSearch] = useState('');

  const loadItems = async () => {
    const data = await inventoryService.getItems();
    setItems(data);
  };

  useEffect(() => {
    loadItems();
  }, [inventoryService]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await inventoryService.removeItem(id);
    loadItems();
  };

  const handleDownload = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.fileData && !item.url) return;
    const blob = item.fileData ? new Blob([item.fileData], { type: item.metadata?.mimeType || 'application/octet-stream' }) : null;
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
    if (filter !== 'all' && item.type !== filter) return false;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel max-w-4xl w-[90vw] h-[80vh] flex flex-col p-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-[#a855f7] flex items-center justify-center border border-purple-500/30">
              <Box className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-['Outfit'] tracking-wide">Inventory Storage</h2>
              <p className="text-xs text-slate-400">Manage saved 3D models, building primitives, avatars, and offline creations.</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-glass hover:text-rose-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-white/5 overflow-x-auto">
            {(['all', 'tool', '3d-model', 'vrm', 'primitive', 'misc'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab as any)}
                className={`btn btn-glass text-xs py-1.5 px-3 capitalize ${
                  filter === tab ? 'active bg-purple-500/20 text-purple-300 border-purple-500/40 font-semibold' : 'text-slate-400'
                }`}
              >
                {tab === 'all' ? 'All Assets' : tab === 'tool' ? 'Tools' : tab.replace('-', ' ')}
              </button>
            ))}
          </div>

          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3" />
            <input
              type="text"
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-input text-xs py-1.5 pl-9 pr-3 w-48 rounded-xl bg-slate-900/80"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-slate-500">
              <Box className="w-12 h-12 mb-3 stroke-1" />
              <p className="text-sm">No items found in this category.</p>
              <p className="text-xs text-slate-600 mt-1">Import files or spawn primitives to store them here.</p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className="glass-card flex flex-col justify-between group hover:border-purple-500/40 relative overflow-hidden transition-all duration-200"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className={`text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded border ${
                      item.type === 'tool' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' :
                      item.type === 'primitive' ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' :
                      item.type === 'vrm' ? 'bg-purple-500/10 text-purple-300 border-purple-500/30' :
                      'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    }`}>
                      {item.type === 'primitive'
                        ? `Primitive: ${item.primitiveType || item.name.replace(/Primitive\s*/i, '')}`
                        : item.type === 'tool'
                        ? `Tool: ${item.toolType || item.name.split(' ')[0]}`
                        : item.type}
                    </span>
                    <h3 className="font-bold text-sm text-white mt-2 leading-tight" title={item.name}>
                      {item.name}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mt-1">
                      {item.metadata?.description || `Stored on ${new Date(item.createdAt).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/5">
                  <button
                    onClick={() => onSpawnItem(item)}
                    className={`btn text-xs py-1.5 px-3 flex-1 font-bold ${
                      item.type === 'tool'
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-amber-500/20'
                        : 'btn-primary bg-gradient-to-r from-[#00f0ff] to-[#0099ff] text-black'
                    }`}
                    title={item.type === 'tool' ? 'Equip tool' : 'Spawn item into the 3D world'}
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>{item.type === 'tool' ? 'Equip Tool' : item.type === 'primitive' ? 'Spawn Shape' : 'Spawn'}</span>
                  </button>

                  {item.type === 'vrm' && (
                    <button
                      onClick={() => onEquipVrm(item)}
                      className="btn btn-secondary text-xs py-1.5 px-3 bg-gradient-to-r from-purple-500 to-indigo-600"
                      title="Equip as your custom VRM avatar"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Equip</span>
                    </button>
                  )}

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
                      className="btn-icon btn-glass w-8 h-8 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                      title="Delete from inventory"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
