import React from 'react';
import { Share2, Smartphone, Glasses, Settings, MessageSquare, ShieldCheck, WifiOff, Users, Globe, Footprints, Orbit, Sparkles, Save } from 'lucide-react';
import type { ConnectionMode } from '../services/NetworkService.ts';
import { Tooltip } from './Tooltip.tsx';

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
    <header className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center justify-center gap-2 pointer-events-none max-w-[95vw]">
      {/* Brand & Status Badge */}
      <div className="glass-panel px-4 py-2 flex items-center gap-4 pointer-events-auto max-w-full">
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
      <div className="glass-panel p-1.5 flex flex-wrap items-center gap-2 pointer-events-auto max-w-full">
        <Tooltip text="Toggle between First-Person Walk and Orbit Focus Mode">
          <button
            onClick={onToggleCameraMode}
            className={`btn text-xs py-2 px-3 flex items-center gap-1.5 font-semibold ${
              cameraMode === 'first-person' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' 
                : 'btn-glass text-slate-300'
            }`}
          >
            {cameraMode === 'first-person' ? <Footprints className="w-4 h-4" /> : <Orbit className="w-4 h-4 text-cyan-400" />}
            <span className="hidden md:inline">{cameraMode === 'first-person' ? '1st Person Mode' : 'Orbit Mode'}</span>
          </button>
        </Tooltip>

        <Tooltip text="World & Environment Settings">
          <button
            onClick={onOpenWorldEnv}
            className="btn-icon btn-glass text-cyan-400 hover:bg-cyan-500/20"
          >
            <Globe className="w-4 h-4" />
          </button>
        </Tooltip>

        {onOpenSaveLoad && (
          <Tooltip text="Save or Load Room">
            <button
              onClick={onOpenSaveLoad}
              className="hidden lg:flex btn btn-glass text-xs py-2 px-3 border-purple-500/40 text-purple-300 hover:bg-purple-500/10 items-center gap-1.5"
            >
              <Save className="w-4 h-4 text-purple-400" />
              <span className="font-bold">Save/Load Room</span>
            </button>
          </Tooltip>
        )}

        <div className="hidden lg:block h-5 w-[1px] bg-slate-700/50 mx-0.5" />

        <Tooltip text="Dash Menu">
          <button
            onClick={onOpenDashMenu}
            className="btn btn-glass text-xs py-2 px-3 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="hidden md:inline font-bold">Dash (TAB)</span>
          </button>
        </Tooltip>

        <Tooltip text="Invite / Share">
          <button
            onClick={onOpenShare}
            className="btn btn-primary text-xs py-2 px-3.5"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden md:inline">Invite / Share</span>
          </button>
        </Tooltip>

        <Tooltip text="Pair Device">
          <button
            onClick={onOpenPairing}
            className="hidden lg:flex btn btn-secondary text-xs py-2 px-3.5 items-center gap-1.5"
          >
            <Smartphone className="w-4 h-4" />
            <span>Pair Device</span>
          </button>
        </Tooltip>

        <Tooltip text="Enter VR">
          <button
            onClick={onEnterVR}
            className="hidden lg:flex btn btn-glass text-xs py-2 px-3 border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/10 items-center gap-1.5"
          >
            <Glasses className="w-4 h-4" />
            <span>Enter VR</span>
          </button>
        </Tooltip>

        <div className="h-5 w-[1px] bg-slate-700/50 mx-1" />

        <Tooltip text="Text Chat">
          <button
            onClick={onToggleChat}
            className="btn-glass px-3.5 py-2 rounded-xl flex items-center gap-2 text-sm font-medium relative"
          >
            <MessageSquare className="w-4 h-4 text-cyan-400" />
            <span className="hidden md:inline">Chat</span>
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#ec4899] text-[10px] font-bold flex items-center justify-center text-white animate-pulse">
                {unreadChatCount}
              </span>
            )}
          </button>
        </Tooltip>

        <Tooltip text="Settings">
          <button
            onClick={onOpenSettings}
            className="btn-icon btn-glass"
          >
            <Settings className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
};
