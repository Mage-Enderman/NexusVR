import React from 'react';
import { Share2, Smartphone, Glasses, Settings, MessageSquare, ShieldCheck, WifiOff, Users, Globe, Footprints, Orbit, Sparkles, Save } from 'lucide-react';
import type { ConnectionMode } from '../services/NetworkService.ts';

interface NavbarProps {
  mode: ConnectionMode;
  roomId: string | null;
  peerCount: number;
  isHost: boolean;
  cameraMode: 'orbit' | 'first-person';
  onToggleCameraMode: () => void;
  onOpenWorldEnv: () => void;
  onOpenSaveLoad?: () => void;
  onOpenShare: () => void;
  onOpenPairing: () => void;
  onOpenDashMenu: () => void;
  onOpenSettings: () => void;
  onToggleChat: () => void;
  onEnterVR: () => void;
  unreadChatCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  mode,
  roomId,
  peerCount,
  isHost,
  cameraMode,
  onToggleCameraMode,
  onOpenWorldEnv,
  onOpenSaveLoad,
  onOpenShare,
  onOpenPairing,
  onOpenDashMenu,
  onOpenSettings,
  onToggleChat,
  onEnterVR,
  unreadChatCount,
}) => {
  return (
    <header className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
      {/* Brand & Status Badge */}
      <div className="glass-panel px-4 py-2 flex items-center gap-4 pointer-events-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00f0ff] to-[#a855f7] flex items-center justify-center shadow-[0_0_15px_rgba(0,240,255,0.4)]">
            <span className="font-['Outfit'] font-black text-black text-lg">N</span>
          </div>
          <span className="font-['Outfit'] font-bold text-lg tracking-wide bg-gradient-to-r from-white via-slate-200 to-[#00f0ff] bg-clip-text text-transparent">
            Nexus<span className="text-[#a855f7]">VR</span>
          </span>
        </div>

        <div className="h-5 w-[1px] bg-slate-700/50" />

        {/* Mode & Room Info */}
        <div className="flex items-center gap-2">
          {mode === 'offline' && (
            <span className="badge badge-cyan">
              <WifiOff className="w-3.5 h-3.5" /> Offline Sandbox
            </span>
          )}
          {mode === 'online' && (
            <span className="badge badge-purple pulse-glow">
              <Users className="w-3.5 h-3.5" /> Room: {roomId || 'Active'} ({peerCount + 1})
            </span>
          )}
          {mode === 'paired' && (
            <span className="badge badge-green">
              <Smartphone className="w-3.5 h-3.5" /> Companion Paired
            </span>
          )}

          {mode !== 'offline' && isHost && (
            <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldCheck className="w-3.5 h-3.5" /> Host
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="glass-panel p-1.5 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={onToggleCameraMode}
          className={`btn text-xs py-2 px-3 flex items-center gap-1.5 font-semibold ${
            cameraMode === 'first-person' 
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' 
              : 'btn-glass text-slate-300'
          }`}
          title="Toggle between First-Person Walk and Orbit Focus Mode"
        >
          {cameraMode === 'first-person' ? <Footprints className="w-4 h-4" /> : <Orbit className="w-4 h-4 text-cyan-400" />}
          <span>{cameraMode === 'first-person' ? '1st Person Mode' : 'Orbit Mode'}</span>
        </button>

        <button
          onClick={onOpenWorldEnv}
          className="btn-icon btn-glass text-cyan-400 hover:bg-cyan-500/20"
          title="World & Environment Settings (Skybox, Grid, Lighting)"
        >
          <Globe className="w-4 h-4" />
        </button>

        {onOpenSaveLoad && (
          <button
            onClick={onOpenSaveLoad}
            className="btn btn-glass text-xs py-2 px-3 border-purple-500/40 text-purple-300 hover:bg-purple-500/10 flex items-center gap-1.5"
            title="Save or Load World / Room Layouts"
          >
            <Save className="w-4 h-4 text-purple-400" />
            <span className="font-bold">Save/Load Room</span>
          </button>
        )}

        <div className="h-5 w-[1px] bg-slate-700/50 mx-0.5" />

        <button
          onClick={onOpenDashMenu}
          className="btn btn-glass text-xs py-2 px-3 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-1.5"
          title="Open Dash Menu (Press TAB)"
        >
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-bold">Dash (TAB)</span>
        </button>

        <button
          onClick={onOpenShare}
          className="btn btn-primary text-xs py-2 px-3.5"
          title="Share Room / Invite Peers"
        >
          <Share2 className="w-4 h-4" />
          <span>Invite / Share</span>
        </button>

        <button
          onClick={onOpenPairing}
          className="btn btn-secondary text-xs py-2 px-3.5"
          title="Pair Companion Device (Quest / Phone)"
        >
          <Smartphone className="w-4 h-4" />
          <span>Pair Device</span>
        </button>

        <button
          onClick={onEnterVR}
          className="btn btn-glass text-xs py-2 px-3 border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/10"
          title="Enter WebXR VR Immersive Mode"
        >
          <Glasses className="w-4 h-4" />
          <span>Enter VR</span>
        </button>

        <div className="h-5 w-[1px] bg-slate-700/50 mx-1" />

        <button
          onClick={onToggleChat}
          className="btn-glass px-3.5 py-2 rounded-xl flex items-center gap-2 text-sm font-medium relative"
          title="Toggle Text Chat"
        >
          <MessageSquare className="w-4 h-4 text-cyan-400" />
          <span>Chat</span>
          {unreadChatCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#ec4899] text-[10px] font-bold flex items-center justify-center text-white animate-pulse">
              {unreadChatCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenSettings}
          className="btn-icon btn-glass"
          title="Graphical Settings & Performance"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
