import React, { useState } from 'react';
import type { UserRole, DefaultPermissionsConfig } from '../types/permissions.ts';
import { ROLE_PERMISSIONS } from '../types/permissions.ts';
import type { NetworkService } from '../services/NetworkService.ts';
import type { InventoryItem } from '../services/InventoryService.ts';
import { 
  Shield, Users, Key, Settings as SettingsIcon, Package, HelpCircle, 
  X, Volume2, VolumeX, RefreshCw, Navigation, UserX, AlertTriangle, 
  Check, Sparkles
} from 'lucide-react';

export interface DashMenuProps {
  isOpen: boolean;
  onClose: () => void;
  networkService: NetworkService;
  localRole: UserRole;
  onUpdateRole: (targetPeerId: string, newRole: UserRole) => void;
  onModerateUser: (action: 'kick' | 'ban' | 'silence' | 'unsilence' | 'respawn' | 'jump', targetPeerId: string) => void;
  defaultConfig: DefaultPermissionsConfig;
  onUpdateDefaultConfig: (config: DefaultPermissionsConfig) => void;
  inventoryItems: InventoryItem[];
  onSpawnItem: (item: InventoryItem) => void;
  onEquipVrm: (item: InventoryItem) => void;
  onOpenFullSettings: () => void;
}

export const DashMenu: React.FC<DashMenuProps> = ({
  isOpen,
  onClose,
  networkService,
  localRole,
  onUpdateRole,
  onModerateUser,
  defaultConfig,
  onUpdateDefaultConfig,
  inventoryItems,
  onSpawnItem,
  onEquipVrm,
  onOpenFullSettings
}) => {
  const [activeTab, setActiveTab] = useState<'session' | 'inventory' | 'settings' | 'controls'>('session');
  const [sessionSubTab, setSessionSubTab] = useState<'users' | 'permissions'>('users');

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
      <div className="w-full max-w-6xl h-[90vh] sm:h-[85vh] flex flex-col bg-slate-900/90 border border-slate-700/80 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
        
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
            className="p-2 rounded-xl bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition"
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
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition text-left ${
                activeTab === 'session' 
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/10 text-cyan-300 border border-cyan-500/30 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Users className="w-5 h-5 text-cyan-400" />
              <div className="flex-1">
                <div>Session & Roles</div>
                <div className="text-[10px] text-slate-500 font-normal">{allUsers.length} active players</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition text-left ${
                activeTab === 'inventory' 
                  ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/10 text-emerald-300 border border-emerald-500/30 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Package className="w-5 h-5 text-emerald-400" />
              <div className="flex-1">
                <div>Quick Inventory</div>
                <div className="text-[10px] text-slate-500 font-normal">Spawn & Equip assets</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('controls')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition text-left ${
                activeTab === 'controls' 
                  ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/10 text-purple-300 border border-purple-500/30 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <HelpCircle className="w-5 h-5 text-purple-400" />
              <div className="flex-1">
                <div>Controls Guide</div>
                <div className="text-[10px] text-slate-500 font-normal">Shortcuts & VR mapping</div>
              </div>
            </button>

            <button
              onClick={() => { setActiveTab('settings'); onOpenFullSettings(); }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition text-left ${
                activeTab === 'settings' 
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-300 border border-amber-500/30 shadow-md' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <SettingsIcon className="w-5 h-5 text-amber-400" />
              <div className="flex-1">
                <div>World Settings</div>
                <div className="text-[10px] text-slate-500 font-normal">Graphics & Environment</div>
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
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                      sessionSubTab === 'users' ? 'bg-cyan-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Active Users ({allUsers.length})
                  </button>
                  <button
                    onClick={() => setSessionSubTab('permissions')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                      sessionSubTab === 'permissions' ? 'bg-cyan-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
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
            {activeTab === 'inventory' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div>
                    <h3 className="font-bold text-white text-base">Quick Asset Spawn</h3>
                    <p className="text-xs text-slate-400">Select an item from your inventory or primitives to spawn directly into the scene.</p>
                  </div>
                  {!permissions.canSpawnItems && (
                    <span className="px-3 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> Spawning Disabled by Role
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 pb-6 overflow-y-auto max-h-[calc(85vh-210px)] pr-2">
                  {/* Default primitives */}
                  {['cube', 'sphere', 'cylinder', 'torus', 'cone'].map((prim) => (
                    <div
                      key={prim}
                      onClick={() => {
                        if (permissions.canSpawnItems) {
                          onSpawnItem({
                            id: `prim-${prim}`,
                            name: `Primitive ${prim.toUpperCase()}`,
                            type: 'primitive',
                            primitiveType: prim as any,
                            createdAt: Date.now()
                          });
                          onClose();
                        }
                      }}
                      className={`p-4 rounded-xl border flex flex-col items-center justify-center gap-2 text-center transition ${
                        permissions.canSpawnItems
                          ? 'bg-slate-800/60 hover:bg-slate-700/80 border-slate-700 hover:border-cyan-500/60 cursor-pointer'
                          : 'bg-slate-900/40 border-slate-800 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-extrabold uppercase text-xs">
                        {prim}
                      </div>
                      <span className="text-sm font-bold text-white capitalize">{prim}</span>
                      <span className="text-[10px] text-cyan-400 font-mono">SHAPE</span>
                    </div >
                  ))}

                  {/* Stored inventory items & tools */}
                  {inventoryItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        if (item.type === 'vrm') {
                          onEquipVrm(item);
                          onClose();
                        } else if (item.type === 'tool') {
                          onSpawnItem(item);
                          onClose();
                        } else if (permissions.canSpawnItems) {
                          onSpawnItem(item);
                          onClose();
                        }
                      }}
                      className="p-4 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700 hover:border-emerald-500/60 cursor-pointer flex flex-col items-center justify-center gap-2 text-center transition"
                    >
                      <div className={`w-12 h-12 rounded-xl border flex items-center justify-center font-extrabold uppercase text-xs overflow-hidden ${
                        item.type === 'tool' ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' :
                        item.type === 'primitive' ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' :
                        'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      }`}>
                        {item.previewUrl ? <img src={item.previewUrl} alt="" className="w-full h-full object-cover" /> : (item.toolType || item.primitiveType || item.type)}
                      </div>
                      <span className="text-sm font-bold text-white truncate w-full" title={item.name}>{item.name}</span>
                      <span className="text-[10px] text-slate-400 uppercase font-mono font-semibold">
                        {item.type === 'vrm' ? 'Equip Avatar' : item.type === 'tool' ? `Tool: ${item.toolType || 'dev'}` : item.type === 'primitive' ? `Shape: ${item.primitiveType || 'cube'}` : 'Spawn Item'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
