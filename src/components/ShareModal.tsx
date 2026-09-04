import React, { useState, useEffect } from 'react';
import { 
  X, Share2, Smartphone, Copy, Check, Users, WifiOff, ArrowRight, 
  RefreshCw, CheckCircle, Wifi
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import type { ConnectionMode } from '../services/NetworkService.ts';
import { CompanionTunnelService, type TunnelStatus, type DeviceInfo } from '../services/CompanionTunnelService.ts';

interface ShareModalProps {
  currentMode: ConnectionMode;
  currentRoomId: string | null;
  onClose: () => void;
  onJoinRoom: (roomId: string, mode: ConnectionMode) => void;
  onDisconnect: () => void;
  initialTab?: 'multiplayer' | 'pairing';
}

export const ShareModal: React.FC<ShareModalProps> = ({
  currentMode,
  currentRoomId,
  onClose,
  onJoinRoom,
  onDisconnect,
  initialTab = 'multiplayer',
}) => {
  const [activeTab, setActiveTab] = useState<'multiplayer' | 'pairing'>(initialTab);
  const [customRoomName, setCustomRoomName] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Companion tunnel service state
  const tunnel = CompanionTunnelService.getInstance();
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>(tunnel.status);
  const [pairCode, setPairCode] = useState<string>(tunnel.pairCode);
  const [companionDevice, setCompanionDevice] = useState<DeviceInfo | null>(tunnel.companionDevice);

  useEffect(() => {
    // Ensure host is listening when the pairing tab is active
    if (activeTab === 'pairing' && tunnel.status === 'idle') {
      tunnel.startHost().then((code) => {
        setPairCode(code);
      }).catch(console.warn);
    }

    const unbind = tunnel.onStatusChange((status, dev) => {
      setTunnelStatus(status);
      setPairCode(tunnel.pairCode);
      setCompanionDevice(dev || null);
    });

    return () => unbind();
  }, [activeTab]);

  const shareUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}${window.location.pathname}?room=${currentRoomId || ''}`
    : '';

  const companionBridgeUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?bridge=${pairCode}`
    : '';

  const handleCreateRandomRoom = () => {
    const randomId = `nexus-${Math.random().toString(36).substring(2, 7)}`;
    onJoinRoom(randomId, 'online');
    onClose();
  };

  const handleCreateCustomRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRoomName.trim()) return;
    const cleanId = customRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    onJoinRoom(cleanId, 'online');
    onClose();
  };

  const handleRegenerateCode = async () => {
    try {
      const nextCode = await tunnel.startHost();
      setPairCode(nextCode);
    } catch (e) {
      console.warn('Failed to regenerate pair code:', e);
    }
  };

  const copyToClipboard = (text: string, type: 'link' | 'code') => {
    navigator.clipboard.writeText(text);
    if (type === 'link') {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-panel max-w-lg w-[90vw] p-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-[#00f0ff] flex items-center justify-center border border-cyan-500/30">
              <Share2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-['Outfit'] tracking-wide">Share & Collaborate</h2>
              <p className="text-xs text-slate-400">Invite peers to your world or pair your mobile/laptop companion.</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-glass hover:text-rose-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-1.5 rounded-xl border border-white/5 mb-6">
          <button
            onClick={() => setActiveTab('multiplayer')}
            className={`btn btn-glass text-xs py-2 ${activeTab === 'multiplayer' ? 'active bg-cyan-500/20 text-cyan-300 font-bold' : ''}`}
          >
            <Users className="w-4 h-4" />
            <span>Multiplayer Room</span>
          </button>
          <button
            onClick={() => setActiveTab('pairing')}
            className={`btn btn-glass text-xs py-2 ${activeTab === 'pairing' ? 'active bg-purple-500/20 text-purple-300 font-bold' : ''}`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Pair Companion</span>
          </button>
        </div>

        {/* Multiplayer Tab */}
        {activeTab === 'multiplayer' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {currentMode === 'online' ? (
              <div className="glass-card bg-cyan-500/10 border-cyan-500/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Connected to Room</span>
                  <span className="badge badge-cyan">{currentRoomId}</span>
                </div>
                <p className="text-xs text-slate-300">Share this link with friends so they can join your virtual space instantly:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="text-input text-xs py-2 px-3 flex-1 font-mono bg-black/40 text-cyan-200 select-all"
                  />
                  <button
                    onClick={() => copyToClipboard(shareUrl, 'link')}
                    className="btn btn-primary text-xs py-2 px-3 shrink-0"
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                </div>
                <div className="pt-2 border-t border-white/10 flex justify-end">
                  <button
                    onClick={() => { onDisconnect(); onClose(); }}
                    className="btn btn-glass text-xs py-1.5 px-3 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
                  >
                    <WifiOff className="w-4 h-4" />
                    <span>Disconnect to Offline Solo</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200">Quick Start</h3>
                  <button
                    onClick={handleCreateRandomRoom}
                    className="btn btn-primary w-full py-3 text-sm bg-gradient-to-r from-[#00f0ff] to-[#0099ff] text-black font-bold shadow-[0_0_20px_rgba(0,240,255,0.3)]"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Create Random Shareable Room</span>
                  </button>
                </div>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-slate-800"></div>
                  <span className="flex-shrink mx-4 text-xs font-semibold text-slate-500 uppercase tracking-widest">or create custom</span>
                  <div className="flex-grow border-t border-slate-800"></div>
                </div>

                <form onSubmit={handleCreateCustomRoom} className="space-y-3">
                  <label className="input-label block">Custom Room Name</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. cyber-lounge-01"
                      value={customRoomName}
                      onChange={(e) => setCustomRoomName(e.target.value)}
                      className="text-input text-sm flex-1 font-mono"
                    />
                    <button type="submit" className="btn btn-secondary text-sm py-2 px-4 shrink-0">
                      <span>Join Room</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}

        {/* Pairing Tab */}
        {activeTab === 'pairing' && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="glass-card bg-purple-500/10 border-purple-500/30 p-3.5">
              <h3 className="text-xs font-bold text-purple-300 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <span>Companion Asset Import Tunnel</span>
              </h3>
              <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                Pair your phone or laptop to feed photos, videos, and 3D models directly into your VR session without singleplayer restrictions!
              </p>
            </div>

            {/* Connection Status Banner */}
            {tunnelStatus === 'connected' ? (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-emerald-300 block">
                      Connected: {companionDevice?.name || 'External Device'}
                    </span>
                    <span className="text-[10px] text-emerald-400/80">
                      Ready to feed photos & assets into VR
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => tunnel.disconnect()}
                  className="btn btn-glass text-[10px] py-1 px-2.5 text-slate-300 hover:text-rose-400"
                >
                  Unpair
                </button>
              </div>
            ) : (
              <div className="p-2.5 bg-slate-900/60 border border-white/5 rounded-xl flex items-center gap-2 text-xs text-slate-300">
                <Wifi className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
                <span>Waiting for companion device to connect...</span>
              </div>
            )}

            {/* Big Pair Code & QR Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center bg-slate-900/80 p-4 rounded-2xl border border-white/5">
              {/* QR Code */}
              <div className="flex flex-col items-center justify-center space-y-2 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                  Scan QR with Camera
                </span>
                <div className="p-2.5 bg-white rounded-xl shadow-lg">
                  <QRCodeCanvas value={companionBridgeUrl} size={120} />
                </div>
              </div>

              {/* Manual Entry Code (Extra Large & Easy to Read in VR) */}
              <div className="flex flex-col items-center sm:items-start space-y-2.5 text-center sm:text-left">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                  Or Enter Code Manually
                </span>
                <div className="font-mono text-3xl font-extrabold tracking-widest text-[#00f0ff] bg-black/60 px-4 py-2 rounded-xl border border-cyan-500/40 select-all shadow-inner">
                  {pairCode || '----'}
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  On your phone, open your browser and enter code <strong className="text-cyan-300">{pairCode}</strong>.
                </p>
                <div className="flex gap-2 w-full pt-1">
                  <button
                    onClick={() => copyToClipboard(pairCode, 'code')}
                    className="btn btn-glass text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1.5 text-cyan-300"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                  <button
                    onClick={handleRegenerateCode}
                    title="Generate New Code"
                    className="btn btn-glass text-xs py-1.5 px-2 text-slate-400 hover:text-white"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Direct Link Share */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400">Direct Companion Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={companionBridgeUrl}
                  className="text-input text-xs py-2 px-3 flex-1 font-mono bg-black/40 text-purple-200 select-all"
                />
                <button
                  onClick={() => copyToClipboard(companionBridgeUrl, 'link')}
                  className="btn btn-secondary text-xs py-2 px-3 shrink-0"
                >
                  {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
