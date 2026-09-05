import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Upload, Link2, Smartphone, CheckCircle, AlertCircle, 
  RefreshCw, Wifi, WifiOff, ArrowRight, Eye, Image as ImageIcon, Box
} from 'lucide-react';
import { 
  CompanionTunnelService, 
  normalizePairCode, 
  type TunnelStatus, 
  type DeviceInfo 
} from '../services/CompanionTunnelService.ts';

interface CompanionPortalProps {
  initialCode?: string;
  onExitCompanionMode?: () => void;
}

export const CompanionPortal: React.FC<CompanionPortalProps> = ({
  initialCode = '',
  onExitCompanionMode,
}) => {
  const tunnel = CompanionTunnelService.getInstance();

  const [inputCode, setInputCode] = useState(normalizePairCode(initialCode));
  const [status, setStatus] = useState<TunnelStatus>(tunnel.status);
  const [hostInfo, setHostInfo] = useState<DeviceInfo | null>(tunnel.companionDevice);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Transfer state
  const [activeTab, setActiveTab] = useState<'file' | 'url'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [transferProgress, setTransferProgress] = useState<number | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unbind = tunnel.onStatusChange((newStatus, dev) => {
      setStatus(newStatus);
      setHostInfo(dev || null);
      if (newStatus === 'connected') {
        setIsConnecting(false);
        setErrorMessage('');
      } else if (newStatus === 'error') {
        setIsConnecting(false);
      }
    });

    if (initialCode && tunnel.status !== 'connected') {
      handleConnect(initialCode);
    }

    return () => unbind();
  }, [initialCode]);

  const handleConnect = async (codeToConnect?: string) => {
    const code = normalizePairCode(codeToConnect || inputCode);
    if (!code) {
      setErrorMessage('Please enter a 4-character pair code');
      return;
    }
    setIsConnecting(true);
    setErrorMessage('');
    setTransferSuccess(null);
    try {
      await tunnel.connectAsCompanion(code);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to connect. Check the pair code in VR.');
      setIsConnecting(false);
    }
  };

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setTransferSuccess(null);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  };

  const handleSendFile = async () => {
    if (!selectedFile) return;
    setTransferProgress(0);
    setTransferSuccess(null);
    setErrorMessage('');
    try {
      await tunnel.sendFile(selectedFile, (pct) => {
        setTransferProgress(pct);
      });
      setTransferSuccess(`"${selectedFile.name}" sent to device! Look at your screen or headset to run import.`);
      setSelectedFile(null);
      setFilePreview(null);
      setTransferProgress(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Transfer failed. Ensure paired device is still connected.');
      setTransferProgress(null);
    }
  };

  const handleSendUrl = () => {
    if (!urlInput.trim()) return;
    try {
      tunnel.sendUrl(urlInput.trim());
      setTransferSuccess('URL sent to device! Look at your screen or headset.');
      setUrlInput('');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to send URL.');
    }
  };

  return (
    <div className="h-screen max-h-screen overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white flex flex-col items-center justify-between p-4 font-sans select-none">
      {/* Top Bar */}
      <div className="w-full max-w-md flex items-center justify-between py-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-[#00f0ff] flex items-center justify-center border border-cyan-500/30">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-wide">NexusVR Companion</h1>
            <p className="text-[10px] text-slate-400">Direct Asset Feeder Tunnel</p>
          </div>
        </div>

        {status === 'connected' ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
            <Wifi className="w-3.5 h-3.5 animate-pulse" />
            <span>Connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-white/5 text-xs">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Not Paired</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="w-full max-w-md my-auto py-4 space-y-4">
        {/* State A: Not Connected / Pairing Input */}
        {status !== 'connected' && (
          <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="text-center space-y-2">
              <h2 className="text-lg font-bold text-slate-100">Pair With Device</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Enter the pair code displayed on your VR HUD or screen to tunnel photos, videos, and assets directly into your virtual world.
              </p>
            </div>

            <form 
              onSubmit={(e) => { e.preventDefault(); handleConnect(); }} 
              className="space-y-4"
            >
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">
                  Pair Code
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="e.g. 7K9M"
                    value={inputCode}
                    onChange={(e) => setInputCode(normalizePairCode(e.target.value))}
                    className="w-full bg-black/60 border border-purple-500/40 rounded-xl px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest text-[#00f0ff] uppercase focus:outline-none focus:border-cyan-400 shadow-inner"
                    autoFocus
                  />
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isConnecting || !inputCode.trim()}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(168,85,247,0.3)] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] transition-all"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Connecting to Device...</span>
                  </>
                ) : (
                  <>
                    <span>Connect Companion</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* State B: Connected & Ready to Feed Assets */}
        {status === 'connected' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Connection Banner */}
            <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs text-emerald-200 font-medium">
                  Tunneled to {hostInfo?.name || 'Device'}
                </span>
              </div>
              <button
                onClick={() => tunnel.disconnect()}
                className="text-[11px] text-slate-400 hover:text-rose-400 font-mono transition-colors"
              >
                Disconnect
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setActiveTab('file')}
                className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${
                  activeTab === 'file' 
                    ? 'bg-purple-600 text-white shadow-md' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Photo & File</span>
              </button>
              <button
                onClick={() => setActiveTab('url')}
                className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${
                  activeTab === 'url' 
                    ? 'bg-cyan-600 text-white shadow-md' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Web URL</span>
              </button>
            </div>

            {/* Tab 1: File / Photo Feeder */}
            {activeTab === 'file' && (
              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-3">
                {/* Hidden File Inputs */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="hidden"
                  accept="video/mp4,video/webm,video/*,image/*,audio/*,.glb,.gltf,.obj,.splat,.vrm"
                />
                <input
                  type="file"
                  ref={cameraInputRef}
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="hidden"
                  accept="image/*"
                  capture="environment"
                />

                {/* Quick Action Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 active:scale-95 transition-all text-purple-300"
                  >
                    <Camera className="w-5 h-5" />
                    <span className="text-xs font-bold">Snap Photo</span>
                    <span className="text-[10px] text-slate-400">Use phone camera</span>
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 active:scale-95 transition-all text-cyan-300"
                  >
                    <Upload className="w-5 h-5" />
                    <span className="text-xs font-bold">Pick File</span>
                    <span className="text-[10px] text-slate-400">Photos, 3D, Video</span>
                  </button>
                </div>

                {/* Selected File Card */}
                {selectedFile && (
                  <div className="p-3.5 bg-black/50 border border-white/10 rounded-2xl space-y-3 shadow-xl">
                    {/* Primary Action Button at the TOP */}
                    <button
                      onClick={handleSendFile}
                      disabled={transferProgress !== null}
                      className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#0099ff] text-black font-extrabold text-sm tracking-wide flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(0,240,255,0.4)] hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      <span>Send to Device</span>
                      <ArrowRight className="w-5 h-5" />
                    </button>

                    {/* Progress Bar */}
                    {transferProgress !== null && (
                      <div className="space-y-1.5 py-1">
                        <div className="flex justify-between text-xs font-mono text-cyan-300">
                          <span>Tunneling to device...</span>
                          <span className="font-bold">{transferProgress}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-cyan-500/20">
                          <div 
                            className="h-full bg-gradient-to-r from-purple-500 via-cyan-400 to-[#00f0ff] transition-all duration-150"
                            style={{ width: `${transferProgress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* File Meta Info */}
                    <div className="flex items-center justify-between pt-1 border-t border-white/10">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Box className="w-4 h-4 text-purple-400 shrink-0" />
                        <span className="text-xs font-mono font-medium truncate max-w-[190px]">
                          {selectedFile.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400 font-mono">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                        <button
                          onClick={() => { setSelectedFile(null); setFilePreview(null); }}
                          className="w-5 h-5 rounded-full bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 text-xs flex items-center justify-center transition-colors"
                          title="Clear selected file"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {filePreview && (
                      <div className="relative w-full h-20 bg-black/60 rounded-lg overflow-hidden border border-white/5 flex items-center justify-center">
                        <img 
                          src={filePreview} 
                          alt="Preview" 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: URL Sender */}
            {activeTab === 'url' && (
              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Paste a link to any 3D model (.glb, .gltf), image, or video to spawn it directly into your session.
                </p>
                <div className="space-y-2">
                  <input
                    type="url"
                    placeholder="https://example.com/model.glb"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <button
                    onClick={handleSendUrl}
                    disabled={!urlInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-cyan-500 text-black font-bold text-xs flex items-center justify-center gap-2 hover:bg-cyan-400 active:scale-98 transition-all disabled:opacity-40"
                  >
                    <span>Send Link to Device</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Success Notification */}
            {transferSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-emerald-300 text-xs animate-in slide-in-from-bottom-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{transferSuccess}</span>
              </div>
            )}

            {/* Error Notification */}
            {errorMessage && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Switcher */}
      <div className="w-full max-w-md pt-3 border-t border-white/10 text-center">
        {onExitCompanionMode && (
          <button
            onClick={onExitCompanionMode}
            className="text-xs text-slate-400 hover:text-cyan-400 flex items-center justify-center gap-1.5 mx-auto transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Switch to full 3D viewer instead</span>
          </button>
        )}
      </div>
    </div>
  );
};
