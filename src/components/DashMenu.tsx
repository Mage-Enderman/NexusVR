import React, { useState } from 'react';
import type { UserRole, DefaultPermissionsConfig } from '../types/permissions.ts';
import { ROLE_PERMISSIONS } from '../types/permissions.ts';
import type { NetworkService } from '../services/NetworkService.ts';
import type { InventoryItem } from '../services/InventoryService.ts';
import type { GraphicsSettings, PerformanceStats } from '../engine/SceneEngine.ts';
import { 
  Shield, Users, Key, Settings as SettingsIcon, Package, HelpCircle, 
  X, Volume2, VolumeX, RefreshCw, Navigation, UserX, AlertTriangle, 
  Check, Sparkles, Trash2, Edit2, FolderPlus, Folder, FolderInput, ChevronDown,
  Mic, MicOff, Monitor, Eye, Sliders, Cpu, User
} from 'lucide-react';

export interface DashMenuProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  onUpdateUserName?: (name: string) => void;
  networkService: NetworkService;
  localRole: UserRole;
  onUpdateRole: (targetPeerId: string, newRole: UserRole) => void;
  onModerateUser: (action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn' | 'jump', targetPeerId: string) => void;
  defaultConfig: DefaultPermissionsConfig;
  onUpdateDefaultConfig: (config: DefaultPermissionsConfig) => void;
  inventoryItems: InventoryItem[];
  inventoryFolders?: string[];
  onSpawnItem: (item: InventoryItem) => void;
  onEquipVrm: (item: InventoryItem) => void;
  onDeleteInventoryItem?: (id: string) => void;
  onRenameInventoryItem?: (id: string, newName: string) => void;
  onCreateInventoryFolder?: (folderName: string) => void;
  onMoveInventoryItem?: (id: string, folder?: string) => void;
  onRenameInventoryFolder?: (oldName: string, newName: string) => void;
  onDeleteInventoryFolder?: (folderName: string) => void;
  onMoveInventoryFolder?: (folderName: string, targetParent?: string) => void;
  onOpenFullSettings?: () => void;
  graphicsSettings?: GraphicsSettings;
  performanceStats?: PerformanceStats;
  onUpdateGraphicsSettings?: (newSettings: Partial<GraphicsSettings>) => void;
  audioDevices?: MediaDeviceInfo[];
  selectedAudioDeviceId?: string;
  onSelectAudioDevice?: (deviceId: string) => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
}

export const DashMenu: React.FC<DashMenuProps> = ({
  isOpen,
  onClose,
  userName = 'Traveler',
  onUpdateUserName,
  networkService,
  localRole,
  onUpdateRole,
  onModerateUser,
  defaultConfig,
  onUpdateDefaultConfig,
  inventoryItems,
  inventoryFolders = [],
  onSpawnItem,
  onEquipVrm,
  onDeleteInventoryItem,
  onRenameInventoryItem,
  onCreateInventoryFolder,
  onMoveInventoryItem,
  onRenameInventoryFolder,
  onDeleteInventoryFolder,
  onMoveInventoryFolder,
  graphicsSettings,
  performanceStats,
  onUpdateGraphicsSettings,
  audioDevices = [],
  selectedAudioDeviceId,
  onSelectAudioDevice,
  isMuted,
  onToggleMute
}) => {
  const [activeTab, setActiveTab] = useState<'session' | 'inventory' | 'settings' | 'controls'>('session');
  const [sessionSubTab, setSessionSubTab] = useState<'users' | 'permissions'>('users');
  const [dashNameInput, setDashNameInput] = useState<string>(userName);

  React.useEffect(() => {
    setDashNameInput(userName);
  }, [userName]);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeFolderFilter, setActiveFolderFilter] = useState<string>('all');
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [renameInput, setRenameInput] = useState<string>('');
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [folderNameInput, setFolderNameInput] = useState<string>('');
  const [showMoveDropdown, setShowMoveDropdown] = useState<boolean>(false);

  const [isRenamingFolder, setIsRenamingFolder] = useState<boolean>(false);
  const [folderRenameInput, setFolderRenameInput] = useState<string>('');
  const [showFolderMoveDropdown, setShowFolderMoveDropdown] = useState<boolean>(false);

  if (!isOpen) return null;

  const permissions = ROLE_PERMISSIONS[localRole] || ROLE_PERMISSIONS.guest;
  const canModerate = permissions.canModerate || permissions.canAdmin;
  const canAdmin = permissions.canAdmin;

  // Build user list
  const allUsers = [
    {
      id: networkService.localPeerId,
      name: `${networkService.localUserName} (You)`,
      role: localRole,
      isSelf: true,
      isHost: networkService.isHost,
      isMuted: networkService.isMuted
    },
    ...Array.from(networkService.peers).map(peerId => ({
      id: peerId,
      name: networkService.peerNames.get(peerId) || `Peer (${peerId.slice(0, 6)})`,
      role: networkService.peerRoles.get(peerId) || defaultConfig.anonymousDefaultRole,
      isSelf: false,
      isHost: peerId === networkService.hostId,
      isMuted: networkService.mutedPeers.has(peerId)
    }))
  ];

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin': return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'builder': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'moderator': return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'guest': return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'spectator': return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[80vh] flex flex-col bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
        
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                NexusVR Dash Menu
              </h2>
              <p className="text-xs text-slate-400">
                Room: <span className="text-cyan-400 font-mono">{networkService.roomId || 'Offline Sandbox'}</span> &bull; Role: <span className={`uppercase px-1.5 py-0.5 rounded text-[10px] border font-bold ${getRoleBadgeColor(localRole)}`}>{localRole}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-dash-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Body with Tabs */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Navigation Tabs */}
          <div className="w-60 border-r border-slate-800 bg-slate-950/40 p-3 flex flex-col gap-1.5">
            <button
              onClick={() => setActiveTab('session')}
              className={`flex items-center gap-3 px-4 py-3 text-left ${activeTab === 'session' ? 'dash-tab-active-cyan' : 'dash-tab'}`}
            >
              <Users className="w-5 h-5 text-cyan-400" />
              <div className="flex-1">
                <div>Session & Roles</div>
                <div className="text-[10px] text-slate-500 font-normal">{allUsers.length} active players</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-3 px-4 py-3 text-left ${activeTab === 'inventory' ? 'dash-tab-active-emerald' : 'dash-tab'}`}
            >
              <Package className="w-5 h-5 text-emerald-400" />
              <div className="flex-1">
                <div>Quick Inventory</div>
                <div className="text-[10px] text-slate-500 font-normal">Spawn & Equip assets</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('controls')}
              className={`flex items-center gap-3 px-4 py-3 text-left ${activeTab === 'controls' ? 'dash-tab-active-purple' : 'dash-tab'}`}
            >
              <HelpCircle className="w-5 h-5 text-purple-400" />
              <div className="flex-1">
                <div>Controls Guide</div>
                <div className="text-[10px] text-slate-500 font-normal">Shortcuts & VR mapping</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-3 px-4 py-3 text-left ${activeTab === 'settings' ? 'dash-tab-active-amber' : 'dash-tab'}`}
            >
              <SettingsIcon className="w-5 h-5 text-amber-400" />
              <div className="flex-1">
                <div>Settings & Audio</div>
                <div className="text-[10px] text-slate-500 font-normal">Graphics, Mic & Environment</div>
              </div>
            </button>

            <div className="mt-auto p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400">
              <div className="flex items-center gap-2 font-semibold text-slate-300 mb-1">
                <Shield className="w-4 h-4 text-cyan-400" />
                <span>Your Role Capability</span>
              </div>
              <ul className="space-y-1 text-[11px] text-slate-400">
                <li className="flex items-center gap-1.5"><Check className={`w-3 h-3 ${permissions.canSpawnItems ? 'text-emerald-400' : 'text-slate-600'}`} /> Spawn & Interact</li>
                <li className="flex items-center gap-1.5"><Check className={`w-3 h-3 ${permissions.canEditWorld ? 'text-emerald-400' : 'text-slate-600'}`} /> Edit World & Assets</li>
                <li className="flex items-center gap-1.5"><Check className={`w-3 h-3 ${permissions.canModerate ? 'text-emerald-400' : 'text-slate-600'}`} /> Moderate Users</li>
              </ul>
            </div>
          </div>

          {/* Right Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            
            {/* SESSION TAB */}
            {activeTab === 'session' && (
              <div className="space-y-6">
                
                {/* Sub-tab pills */}
                <div className="flex gap-2 p-1 bg-slate-950/60 rounded-xl border border-slate-800 w-fit">
                  <button
                    onClick={() => setSessionSubTab('users')}
                    className={sessionSubTab === 'users' ? 'dash-pill-active' : 'dash-pill'}
                  >
                    Active Users ({allUsers.length})
                  </button>
                  <button
                    onClick={() => setSessionSubTab('permissions')}
                    className={sessionSubTab === 'permissions' ? 'dash-pill-active' : 'dash-pill'}
                  >
                    Default Permissions
                  </button>
                </div>

                {/* USERS LIST */}
                {sessionSubTab === 'users' && (
                  <div className="space-y-3">
                    {allUsers.map((user) => (
                      <div
                        key={user.id}
                        className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex flex-col gap-3 transition hover:border-slate-600"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-base shadow-md">
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white">{user.name}</span>
                                {user.isHost && (
                                  <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                    HOST
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400 font-mono">{user.id}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            {/* Role Badge or Selector */}
                            {canModerate && !user.isSelf ? (
                              <select
                                value={user.role}
                                onChange={(e) => onUpdateRole(user.id, e.target.value as UserRole)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase border bg-slate-900 cursor-pointer transition ${getRoleBadgeColor(user.role)}`}
                              >
                                <option value="admin">Admin</option>
                                <option value="builder">Builder</option>
                                <option value="moderator">Moderator</option>
                                <option value="guest">Guest</option>
                                <option value="spectator">Spectator</option>
                              </select>
                            ) : (
                              <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase border ${getRoleBadgeColor(user.role)}`}>
                                {user.role}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Moderation Action Buttons underneath */}
                        {!user.isSelf && (
                          <div className="pt-3 border-t border-slate-700/60 flex items-center flex-wrap gap-2">
                            <button
                              onClick={() => { onModerateUser('jump', user.id); onClose(); }}
                              className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-medium flex items-center gap-1.5 transition"
                            >
                              <Navigation className="w-3.5 h-3.5" /> Jump to Player
                            </button>

                            {canModerate && (
                              <>
                                <button
                                  onClick={() => onModerateUser('respawn', user.id)}
                                  className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center gap-1.5 transition"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" /> Respawn
                                </button>

                                <button
                                  onClick={() => onModerateUser(user.isMuted ? 'unsilence' : 'silence', user.id)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition ${
                                    user.isMuted 
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' 
                                      : 'bg-slate-700/60 hover:bg-slate-700 text-slate-300 border-slate-600'
                                  }`}
                                >
                                  {user.isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                                  {user.isMuted ? 'Unsilence' : 'Silence'}
                                </button>

                                <button
                                  onClick={() => onModerateUser('kick', user.id)}
                                  className="px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border border-orange-500/30 text-xs font-medium flex items-center gap-1.5 transition"
                                >
                                  <UserX className="w-3.5 h-3.5" /> Kick
                                </button>

                                {canAdmin && (
                                  <button
                                    onClick={() => onModerateUser('ban', user.id)}
                                    className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center gap-1.5 transition ml-auto"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5" /> Ban Forever
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* PERMISSIONS CONFIG SUB-TAB */}
                {sessionSubTab === 'permissions' && (
                  <div className="p-6 rounded-xl bg-slate-800/40 border border-slate-700/60 space-y-6">
                    <div className="flex items-center gap-3 pb-4 border-b border-slate-700/60">
                      <Key className="w-6 h-6 text-cyan-400" />
                      <div>
                        <h3 className="font-bold text-white text-base">Default Room Roles</h3>
                        <p className="text-xs text-slate-400">Configure what permission role new players receive automatically when joining this room.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-300 block">Anonymous / New Players</label>
                        <select
                          disabled={!canAdmin}
                          value={defaultConfig.anonymousDefaultRole}
                          onChange={(e) => onUpdateDefaultConfig({ ...defaultConfig, anonymousDefaultRole: e.target.value as UserRole })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                        >
                          <option value="builder">Builder (Full Editing)</option>
                          <option value="moderator">Moderator (Moderation rights)</option>
                          <option value="guest">Guest (Spawn items only)</option>
                          <option value="spectator">Spectator (Move & Chat only)</option>
                        </select>
                        <p className="text-[11px] text-slate-500">Recommended: Guest or Spectator for public links.</p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-300 block">Registered / Verified Players</label>
                        <select
                          disabled={!canAdmin}
                          value={defaultConfig.registeredDefaultRole}
                          onChange={(e) => onUpdateDefaultConfig({ ...defaultConfig, registeredDefaultRole: e.target.value as UserRole })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                        >
                          <option value="admin">Admin</option>
                          <option value="builder">Builder (Full Editing)</option>
                          <option value="moderator">Moderator</option>
                          <option value="guest">Guest</option>
                          <option value="spectator">Spectator</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-300 block">Host's Friends / Contacts</label>
                        <select
                          disabled={!canAdmin}
                          value={defaultConfig.contactsDefaultRole}
                          onChange={(e) => onUpdateDefaultConfig({ ...defaultConfig, contactsDefaultRole: e.target.value as UserRole })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                        >
                          <option value="admin">Admin</option>
                          <option value="builder">Builder (Full Editing)</option>
                          <option value="moderator">Moderator</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-slate-300 block">Host Role</label>
                        <input
                          type="text"
                          disabled
                          value="ADMIN (Authoritative)"
                          className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-amber-400 font-bold cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* INVENTORY TAB */}
            {activeTab === 'inventory' && (() => {
              const primitiveItems: InventoryItem[] = ['cube', 'sphere', 'cylinder', 'torus', 'cone'].map((prim) => ({
                id: `prim-${prim}`,
                name: `Primitive (${prim.toUpperCase()})`,
                type: 'primitive',
                primitiveType: prim as any,
                createdAt: 0
              }));

              const allDisplayItems: InventoryItem[] = [...primitiveItems, ...inventoryItems];
              const availableFolders = Array.from(
                new Set([
                  ...inventoryFolders,
                  ...(inventoryItems.map((i) => i.folder).filter(Boolean) as string[])
                ])
              ).sort();

              const selectedItem = allDisplayItems.find((i) => i.id === selectedItemId) || null;
              const selectedFolder = selectedItemId?.startsWith('folder:') ? selectedItemId.slice(7) : null;
              const isSelectedPrimitive = selectedItem?.id.startsWith('prim-') ?? false;
              const isCustomFolderActive = activeFolderFilter !== 'all' && activeFolderFilter !== 'primitives' && activeFolderFilter !== 'root';

              const filteredDisplayItems = allDisplayItems.filter((item) => {
                if (activeFolderFilter === 'all') return true;
                if (activeFolderFilter === 'primitives') return item.id.startsWith('prim-');
                if (activeFolderFilter === 'root') return !item.id.startsWith('prim-') && !item.folder;
                return item.folder === activeFolderFilter;
              });

              const handleTriggerSpawn = (item: InventoryItem) => {
                if (item.type === 'vrm') {
                  onEquipVrm(item);
                  onClose();
                } else if (permissions.canSpawnItems) {
                  onSpawnItem(item);
                  onClose();
                }
              };

              return (
                <div className="space-y-4">
                  {/* Header & Main Action Toolbar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <h3 className="font-bold text-white text-base">Quick Inventory & Asset Spawn</h3>
                      <p className="text-xs text-slate-400">Select an item or folder to manage it, or double-click to spawn/open.</p>
                    </div>

                    {/* Action Buttons Toolbar */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => selectedItem && handleTriggerSpawn(selectedItem)}
                        disabled={!selectedItem || !permissions.canSpawnItems}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-md ${
                          selectedItem && permissions.canSpawnItems
                            ? 'bg-gradient-to-r from-cyan-500 to-emerald-600 hover:from-cyan-400 hover:to-emerald-500 text-white shadow-cyan-500/20'
                            : 'bg-slate-800/60 text-slate-500 border border-slate-700/60 cursor-not-allowed'
                        }`}
                        title="Spawn selected asset into the scene"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Spawn
                      </button>

                      <button
                        onClick={() => {
                          if (selectedFolder) {
                            setIsRenamingFolder(true);
                            setFolderRenameInput(selectedFolder);
                            setIsRenaming(false);
                          } else if (selectedItem && !isSelectedPrimitive) {
                            setIsRenaming(true);
                            setRenameInput(selectedItem.name);
                            setIsRenamingFolder(false);
                          }
                        }}
                        disabled={(!selectedItem || isSelectedPrimitive) && !selectedFolder}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                          selectedFolder || (selectedItem && !isSelectedPrimitive)
                            ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border-slate-700 hover:border-slate-500'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                        }`}
                        title="Rename selected asset or folder"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Rename
                      </button>

                      <div className="relative">
                        <button
                          onClick={() => {
                            if (selectedFolder) {
                              setShowFolderMoveDropdown(!showFolderMoveDropdown);
                            } else if (selectedItem && !isSelectedPrimitive) {
                              setShowMoveDropdown(!showMoveDropdown);
                            }
                          }}
                          disabled={(!selectedItem || isSelectedPrimitive) && !selectedFolder}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                            selectedFolder || (selectedItem && !isSelectedPrimitive)
                              ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border-slate-700 hover:border-slate-500'
                              : 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                          }`}
                          title="Move selected asset or folder"
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                          Move
                          <ChevronDown className="w-3 h-3 ml-0.5" />
                        </button>

                        {showMoveDropdown && selectedItem && !isSelectedPrimitive && (
                          <div className="absolute right-0 mt-1.5 w-44 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-30 animate-in fade-in duration-150">
                            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Move to folder</div>
                            <button
                              onClick={() => {
                                onMoveInventoryItem?.(selectedItem.id, undefined);
                                setShowMoveDropdown(false);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"
                            >
                              <Folder className="w-3.5 h-3.5 text-slate-500" />
                              (Root / No Folder)
                            </button>
                            {availableFolders.map((f) => (
                              <button
                                key={f}
                                onClick={() => {
                                  onMoveInventoryItem?.(selectedItem.id, f);
                                  setShowMoveDropdown(false);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2 truncate"
                              >
                                <Folder className="w-3.5 h-3.5 text-cyan-400" />
                                {f}
                              </button>
                            ))}
                          </div>
                        )}

                        {showFolderMoveDropdown && selectedFolder && (
                          <div className="absolute right-0 mt-1.5 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-30 animate-in fade-in duration-150">
                            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Move folder inside...</div>
                            <button
                              onClick={() => {
                                onMoveInventoryFolder?.(selectedFolder, undefined);
                                setShowFolderMoveDropdown(false);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"
                            >
                              <Folder className="w-3.5 h-3.5 text-slate-500" />
                              (Root Level)
                            </button>
                            {availableFolders.filter(f => f !== selectedFolder && !f.startsWith(`${selectedFolder}/`)).map(f => (
                              <button
                                key={f}
                                onClick={() => {
                                  onMoveInventoryFolder?.(selectedFolder, f);
                                  setShowFolderMoveDropdown(false);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2 truncate"
                              >
                                <Folder className="w-3.5 h-3.5 text-cyan-400" />
                                {f}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setIsCreatingFolder(true);
                          setFolderNameInput('');
                          setIsRenaming(false);
                          setIsRenamingFolder(false);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800/80 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 hover:border-cyan-500 transition"
                        title="Create a new folder for organization"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        New Folder
                      </button>

                      <button
                        onClick={() => {
                          if (selectedFolder) {
                            onDeleteInventoryFolder?.(selectedFolder);
                            setSelectedItemId(null);
                          } else if (selectedItem && !isSelectedPrimitive) {
                            onDeleteInventoryItem?.(selectedItem.id);
                            setSelectedItemId(null);
                          }
                        }}
                        disabled={(!selectedItem || isSelectedPrimitive) && !selectedFolder}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                          selectedFolder || (selectedItem && !isSelectedPrimitive)
                            ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/40 hover:border-rose-400'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                        }`}
                        title="Delete selected asset or folder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Active Folder Navigation Breadcrumb */}
                  {isCustomFolderActive && (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-700">
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-bold text-white">Viewing Folder: <span className="text-cyan-300">{activeFolderFilter}</span></span>
                      </div>
                      <button
                        onClick={() => setActiveFolderFilter('all')}
                        className="px-2.5 py-1 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-xs font-bold text-slate-200"
                      >
                        ← Back to All Items
                      </button>
                    </div>
                  )}

                  {/* Inline Dialogs for Rename Item, Rename Folder & Create Folder */}
                  {isRenaming && selectedItem && (
                    <div className="p-3 rounded-xl bg-slate-800/90 border border-cyan-500/40 flex flex-wrap items-center gap-3 animate-in fade-in duration-150">
                      <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" /> Rename Item:
                      </span>
                      <input
                        type="text"
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && renameInput.trim()) {
                            onRenameInventoryItem?.(selectedItem.id, renameInput.trim());
                            setIsRenaming(false);
                          } else if (e.key === 'Escape') {
                            setIsRenaming(false);
                          }
                        }}
                        className="flex-1 min-w-[180px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                        placeholder="Enter new asset name..."
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (renameInput.trim()) {
                              onRenameInventoryItem?.(selectedItem.id, renameInput.trim());
                              setIsRenaming(false);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setIsRenaming(false)}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {isRenamingFolder && (selectedFolder || isCustomFolderActive) && (
                    <div className="p-3 rounded-xl bg-slate-800/90 border border-cyan-500/40 flex flex-wrap items-center gap-3 animate-in fade-in duration-150">
                      <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" /> Rename Folder:
                      </span>
                      <input
                        type="text"
                        value={folderRenameInput}
                        onChange={(e) => setFolderRenameInput(e.target.value)}
                        onKeyDown={(e) => {
                          const targetFolder = selectedFolder || activeFolderFilter;
                          if (e.key === 'Enter' && folderRenameInput.trim() && targetFolder) {
                            onRenameInventoryFolder?.(targetFolder, folderRenameInput.trim());
                            if (activeFolderFilter === targetFolder) {
                              setActiveFolderFilter(folderRenameInput.trim());
                            }
                            setIsRenamingFolder(false);
                          } else if (e.key === 'Escape') {
                            setIsRenamingFolder(false);
                          }
                        }}
                        className="flex-1 min-w-[180px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                        placeholder="New folder name..."
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const targetFolder = selectedFolder || activeFolderFilter;
                            if (folderRenameInput.trim() && targetFolder) {
                              onRenameInventoryFolder?.(targetFolder, folderRenameInput.trim());
                              if (activeFolderFilter === targetFolder) {
                                setActiveFolderFilter(folderRenameInput.trim());
                              }
                              setIsRenamingFolder(false);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setIsRenamingFolder(false)}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {isCreatingFolder && (
                    <div className="p-3 rounded-xl bg-slate-800/90 border border-cyan-500/40 flex flex-wrap items-center gap-3 animate-in fade-in duration-150">
                      <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                        <FolderPlus className="w-3.5 h-3.5" /> Create Folder:
                      </span>
                      <input
                        type="text"
                        value={folderNameInput}
                        onChange={(e) => setFolderNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && folderNameInput.trim()) {
                            onCreateInventoryFolder?.(folderNameInput.trim());
                            setIsCreatingFolder(false);
                          } else if (e.key === 'Escape') {
                            setIsCreatingFolder(false);
                          }
                        }}
                        className="flex-1 min-w-[180px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                        placeholder="Folder name (e.g. Avatars, Props, Tools)..."
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (folderNameInput.trim()) {
                              onCreateInventoryFolder?.(folderNameInput.trim());
                              setIsCreatingFolder(false);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs"
                        >
                          Create
                        </button>
                        <button
                          onClick={() => setIsCreatingFolder(false)}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Folder Pills Bar */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-2">
                    <button
                      onClick={() => setActiveFolderFilter('all')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        activeFolderFilter === 'all'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : 'bg-slate-800/50 text-slate-400 hover:text-white border border-transparent'
                      }`}
                    >
                      All Items ({allDisplayItems.length})
                    </button>

                    <button
                      onClick={() => setActiveFolderFilter('primitives')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        activeFolderFilter === 'primitives'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : 'bg-slate-800/50 text-slate-400 hover:text-white border border-transparent'
                      }`}
                    >
                      Primitives ({primitiveItems.length})
                    </button>

                    <button
                      onClick={() => setActiveFolderFilter('root')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        activeFolderFilter === 'root'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : 'bg-slate-800/50 text-slate-400 hover:text-white border border-transparent'
                      }`}
                    >
                      Unsorted ({inventoryItems.filter((i) => !i.folder).length})
                    </button>

                    {availableFolders.map((f) => {
                      const count = inventoryItems.filter((i) => i.folder === f).length;
                      return (
                        <button
                          key={f}
                          onClick={() => setActiveFolderFilter(f)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                            activeFolderFilter === f
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'bg-slate-800/50 text-slate-400 hover:text-white border border-transparent'
                          }`}
                        >
                          <Folder className="w-3.5 h-3.5 text-cyan-400" />
                          {f} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* Grid of Folders & Items */}
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2.5 pb-4 max-h-[420px] overflow-y-auto pr-1">
                    {/* Render Folder Cards when viewing All Items or Root */}
                    {(activeFolderFilter === 'all' || activeFolderFilter === 'root') &&
                      availableFolders.map((f) => {
                        const isFolderSelected = selectedItemId === `folder:${f}`;
                        const count = inventoryItems.filter((i) => i.folder === f).length;
                        return (
                          <div
                            key={`folder-card-${f}`}
                            onClick={() => setSelectedItemId(`folder:${f}`)}
                            onDoubleClick={() => setActiveFolderFilter(f)}
                            className={`relative p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-center transition cursor-pointer select-none shadow-sm ${
                              isFolderSelected
                                ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)] scale-[1.03]'
                                : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700/80 hover:border-cyan-500/60'
                            }`}
                          >
                            {isFolderSelected && (
                              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center shadow">
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              </div>
                            )}

                            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                              <Folder className="w-6 h-6" />
                            </div>
                            <span className="text-xs font-bold text-white truncate w-full" title={f}>
                              {f}
                            </span>
                            <span className="text-[9px] text-cyan-400 font-mono font-semibold">
                              FOLDER ({count})
                            </span>
                          </div>
                        );
                      })}

                    {filteredDisplayItems.map((item) => {
                      const isPrim = item.id.startsWith('prim-');
                      const isSelected = selectedItemId === item.id;

                      const displayName =
                        item.name === 'Primitive' && item.primitiveType
                          ? `Shape: ${item.primitiveType}`
                          : item.name === 'Tool' && item.toolType
                          ? `Tool: ${item.toolType}`
                          : item.name || 'Unnamed Asset';

                      const typeLabel =
                        item.type === 'vrm'
                          ? 'Avatar'
                          : item.type === 'tool'
                          ? `${item.toolType || 'Tool'}`
                          : item.type === 'primitive'
                          ? `${item.primitiveType || 'Shape'}`
                          : 'Asset';

                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelectedItemId(item.id)}
                          onDoubleClick={() => handleTriggerSpawn(item)}
                          className={`relative p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-center transition cursor-pointer select-none shadow-sm ${
                            isSelected
                              ? 'bg-cyan-500/15 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)] scale-[1.03]'
                              : 'bg-slate-800/60 hover:bg-slate-700/80 border-slate-700 hover:border-slate-500'
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center shadow">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </div>
                          )}

                          <div
                            className={`w-10 h-10 rounded-lg border flex items-center justify-center font-extrabold uppercase text-[10px] overflow-hidden ${
                              item.type === 'tool'
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                : isPrim
                                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                                : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            }`}
                          >
                            {item.previewUrl ? (
                              <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (item.toolType || item.primitiveType || item.type)?.slice(0, 4)
                            )}
                          </div>
                          <span className="text-xs font-bold text-white truncate w-full" title={displayName}>
                            {displayName}
                          </span>
                          <span className="text-[9px] text-slate-400 uppercase font-mono font-semibold truncate w-full">
                            {typeLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* CONTROLS GUIDE TAB */}
            {activeTab === 'controls' && (
              <div className="space-y-6">
                <div className="pb-4 border-b border-slate-800">
                  <h3 className="font-bold text-white text-base">Interactive Shortcuts & Mapping</h3>
                  <p className="text-xs text-slate-400">Use these keyboard and mouse combinations for rapid 3D manipulation and navigation.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">Move Held Item (Away / Towards)</h4>
                      <p className="text-xs text-slate-400">Push or pull the selected object along the camera depth ray.</p>
                    </div>
                    <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs font-bold">
                      Mouse Wheel Up / Down
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">Scale Held Item</h4>
                      <p className="text-xs text-slate-400">Uniformly scale the currently selected 3D model up or down.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-2 py-1 rounded bg-purple-600/40 border border-purple-500 text-purple-200 font-mono text-xs font-bold">SHIFT</kbd>
                      <span className="text-slate-500">+</span>
                      <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs font-bold">Wheel</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">Scale Self (Avatar Height)</h4>
                      <p className="text-xs text-slate-400">Adjust your personal avatar scale and eye-level view height.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-2 py-1 rounded bg-indigo-600/40 border border-indigo-500 text-indigo-200 font-mono text-xs font-bold">CTRL</kbd>
                      <span className="text-slate-500">+</span>
                      <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs font-bold">Wheel</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">Rotate Held Item</h4>
                      <p className="text-xs text-slate-400">Hold E while moving the mouse to rotate around X and Y axes.</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-2 py-1 rounded bg-emerald-600/40 border border-emerald-500 text-emerald-200 font-mono text-xs font-bold">E</kbd>
                      <span className="text-slate-500">+</span>
                      <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs font-bold">Mouse Move</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">Crouch / Fly Down</h4>
                      <p className="text-xs text-slate-400">Lower your camera position vertically while exploring.</p>
                    </div>
                    <kbd className="px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs font-bold">C</kbd>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">Toggle Dash Menu</h4>
                      <p className="text-xs text-slate-400">Open or close this overlay dashboard at any time.</p>
                    </div>
                    <kbd className="px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs font-bold">TAB</kbd>
                  </div>
                </div>
              </div>
            )}

            {/* SETTINGS & AUDIO TAB */}
            {activeTab === 'settings' && (
              <div className="space-y-6 animate-in fade-in duration-150">
                <div className="pb-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-white text-base">Audio, Voice & Graphical Settings</h3>
                    <p className="text-xs text-slate-400">Configure input microphone, voice state, rendering scale, and graphical quality.</p>
                  </div>
                  {performanceStats && (
                    <div className="flex items-center gap-3 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-700">
                      <div className="flex items-center gap-1.5 text-xs font-mono">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-slate-400">FPS:</span>
                        <span className={`font-bold ${performanceStats.fps >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{performanceStats.fps}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-mono border-l border-slate-700 pl-3">
                        <Sliders className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-slate-400">Draws:</span>
                        <span className="font-bold text-white">{performanceStats.drawCalls}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* DISPLAY NAME SETTINGS */}
                <div className="p-4 rounded-2xl bg-slate-800/40 border border-purple-500/30 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">User Display Name</h4>
                      <p className="text-xs text-slate-400">Change how your name appears to peers in the room</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={dashNameInput}
                      onChange={(e) => setDashNameInput(e.target.value)}
                      onBlur={() => onUpdateUserName?.(dashNameInput)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onUpdateUserName?.(dashNameInput);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      placeholder="Enter display name..."
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-400 font-semibold"
                      maxLength={24}
                    />
                    <button
                      onClick={() => onUpdateUserName?.(dashNameInput)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-500 hover:bg-purple-400 text-slate-950 transition-colors shadow-lg"
                    >
                      Save Name
                    </button>
                  </div>
                </div>

                {/* AUDIO & MICROPHONE SETTINGS */}
                <div className="p-4 rounded-2xl bg-slate-800/40 border border-cyan-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isMuted ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                        {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Microphone & Voice Input</h4>
                        <p className="text-xs text-slate-400">Status: <span className={isMuted ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>{isMuted ? 'Muted' : 'Live & Active'}</span></p>
                      </div>
                    </div>
                    <button
                      onClick={() => onToggleMute?.()}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition shadow-lg ${
                        isMuted
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                      }`}
                    >
                      {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Input Microphone Device
                    </label>
                    <select
                      value={selectedAudioDeviceId || ''}
                      onChange={(e) => onSelectAudioDevice?.(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">System Default Microphone</option>
                      {audioDevices?.map((device, i) => (
                        <option key={device.deviceId || `mic-${i}`} value={device.deviceId}>
                          {device.label || `Microphone Device ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* GRAPHICAL SETTINGS */}
                {graphicsSettings && onUpdateGraphicsSettings && (
                  <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/80 space-y-5">
                    {/* Resolution Scale */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Monitor className="w-3.5 h-3.5 text-cyan-400" /> Resolution Scaling / DPI
                        </label>
                        <span className="text-xs font-mono font-bold text-cyan-300">{graphicsSettings.resolutionScale}x</span>
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((scale) => (
                          <button
                            key={scale}
                            onClick={() => onUpdateGraphicsSettings({ resolutionScale: scale })}
                            className={`py-2 rounded-xl text-xs font-bold border transition ${
                              graphicsSettings.resolutionScale === scale
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                          >
                            {scale}x
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Shadow Quality */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5 text-purple-400" /> Shadow Quality
                        </label>
                        <span className="text-xs font-mono font-bold text-purple-300 capitalize">{graphicsSettings.shadowQuality}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {(['off', 'low', 'medium', 'high', 'ultra'] as const).map((q) => (
                          <button
                            key={q}
                            onClick={() => onUpdateGraphicsSettings({ shadowQuality: q })}
                            className={`py-2 rounded-xl text-xs font-bold capitalize border transition ${
                              graphicsSettings.shadowQuality === q
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Anti-Aliasing */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Anti-Aliasing
                        </label>
                        <span className="text-xs font-mono font-bold text-pink-300 uppercase">{graphicsSettings.antiAliasing}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['none', 'fxaa', 'msaa'] as const).map((aa) => (
                          <button
                            key={aa}
                            onClick={() => onUpdateGraphicsSettings({ antiAliasing: aa })}
                            className={`py-2 rounded-xl text-xs font-bold uppercase border transition ${
                              graphicsSettings.antiAliasing === aa
                                ? 'bg-pink-500/20 text-pink-300 border-pink-500/50'
                                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                          >
                            {aa}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <div>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">TAB</kbd> or <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">ESC</kbd> to close</div>
          <div className="flex items-center gap-2">
            <span>NexusVR P2P Engine v1.5</span>
          </div>
        </div>

      </div>
    </div>
  );
};
