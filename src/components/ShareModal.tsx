import React, { useState } from 'react';
import { X, Share2, Smartphone, QrCode, Copy, Check, Users, WifiOff, ArrowRight } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import type { ConnectionMode } from '../services/NetworkService.ts';

interface ShareModalProps {
  currentMode: ConnectionMode;
  currentRoomId: string | null;
  onClose: () => void;
  onJoinRoom: (roomId: string, mode: ConnectionMode, isCompanion?: boolean) => void;
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
  const [pairingInputCode, setPairingInputCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Generate a random pairing code for PC host
  const [generatedPairCode] = useState(() => `PAIR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);

  const shareUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}${window.location.pathname}?room=${currentRoomId || ''}`
    : '';

  const pairUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?pair=${generatedPairCode}`
    : '';

  const handleCreateRandomRoom = () => {
    const randomId = `nexus-${Math.random().toString(36).substring(2, 7)}`;
    onJoinRoom(randomId, 'online', false);
    onClose();
  };

  const handleCreateCustomRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRoomName.trim()) return;
    const cleanId = customRoomName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    onJoinRoom(cleanId, 'online', false);
    onClose();
  };

  const handleStartPairingHost = () => {
    onJoinRoom(generatedPairCode, 'paired', false);
    onClose();
  };

  const handleConnectCompanion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingInputCode.trim()) return;
    const code = pairingInputCode.trim().toUpperCase();
    onJoinRoom(code.startsWith('PAIR-') ? code : `PAIR-${code}`, 'paired', true);
    onClose();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              <p className="text-xs text-slate-400">Invite peers to your world or pair your mobile/Quest companion.</p>
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
                    onClick={() => copyToClipboard(shareUrl)}
                    className="btn btn-primary text-xs py-2 px-3 shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Copied!' : 'Copy Link'}</span>
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
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="glass-card bg-purple-500/10 border-purple-500/30 p-4">
              <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <span>Companion Device Pairing</span>
              </h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Pair your Oculus Quest or smartphone to your PC session! Assets and models uploaded on your PC will instantly sync to your VR headset without spawning duplicate user avatars.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Host PC Option */}
              <div className="flex flex-col items-center justify-center p-4 bg-slate-900/80 rounded-2xl border border-white/5 space-y-3 text-center">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Scan on Quest / Mobile</span>
                <div className="p-3 bg-white rounded-xl shadow-lg">
                  <QRCodeCanvas value={pairUrl} size={130} />
                </div>
                <div className="font-mono text-base font-bold text-cyan-300 bg-black/50 px-3 py-1 rounded border border-cyan-500/30 select-all">
                  {generatedPairCode}
                </div>
                <button
                  onClick={handleStartPairingHost}
                  className="btn btn-secondary w-full text-xs py-2 bg-gradient-to-r from-purple-600 to-indigo-600"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Start Hosting Pairing</span>
                </button>
              </div>

              {/* Client Companion Option */}
              <form onSubmit={handleConnectCompanion} className="space-y-3 flex flex-col justify-center">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Enter Code on Companion</h4>
                <p className="text-xs text-slate-400">If you are on your Quest or smartphone right now, enter the pairing code displayed on your PC screen:</p>
                <input
                  type="text"
                  placeholder="PAIR-XXXX"
                  value={pairingInputCode}
                  onChange={(e) => setPairingInputCode(e.target.value)}
                  className="text-input text-center text-lg font-mono tracking-widest uppercase py-2.5"
                />
                <button
                  type="submit"
                  className="btn btn-primary w-full py-2.5 text-xs bg-gradient-to-r from-[#00f0ff] to-[#00a8ff] text-black font-bold"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Connect Companion</span>
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
