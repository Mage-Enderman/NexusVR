import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Mic, MicOff, Volume2, VolumeX, Send, Minimize2, Radio } from 'lucide-react';
import { NetworkService } from '../services/NetworkService.ts';
import type { ChatMessage } from '../services/NetworkService.ts';

interface ChatPanelProps {
  networkService: NetworkService;
  isOpen: boolean;
  onClose: () => void;
  onReadMessages: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  networkService,
  isOpen,
  onClose,
  onReadMessages,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unbind = networkService.onChat((msg) => {
      setMessages((prev) => [...prev.slice(-99), msg]);
    });
    return () => unbind();
  }, [networkService]);

  useEffect(() => {
    if (isOpen) {
      onReadMessages();
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages, onReadMessages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    networkService.sendChatMessage(input.trim());
    setInput('');
  };

  const toggleVoice = async () => {
    if (!isVoiceActive) {
      const success = await networkService.enableVoiceChat();
      if (success) {
        setIsVoiceActive(true);
        setIsMuted(false);
      }
    } else {
      const muted = networkService.toggleMute();
      setIsMuted(muted);
    }
  };

  const toggleDeaf = () => {
    const deaf = networkService.toggleDeafen();
    setIsDeafened(deaf);
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-16 right-4 z-20 w-80 h-[calc(100vh-6rem)] glass-panel flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header & Voice Controls */}
      <div className="p-3.5 border-b border-white/10 bg-slate-900/60 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#00f0ff]" />
            <span className="font-['Outfit'] font-bold text-sm">Text & Voice Chat</span>
          </div>
          <button onClick={onClose} className="btn-icon w-6 h-6 btn-glass text-slate-400 hover:text-white">
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Voice Bar */}
        <div className="flex items-center justify-between bg-black/40 p-2 rounded-xl border border-white/5">
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${isVoiceActive ? (isMuted ? 'text-amber-400' : 'text-emerald-400 animate-pulse') : 'text-slate-500'}`} />
            <span className="text-xs font-medium text-slate-300">
              {!isVoiceActive ? 'Voice Inactive' : (isMuted ? 'Mic Muted' : 'Voice Active')}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleVoice}
              className={`btn-icon w-7 h-7 rounded-lg text-xs ${
                isVoiceActive
                  ? (isMuted ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40')
                  : 'btn-glass text-slate-300 hover:text-[#00f0ff]'
              }`}
              title={!isVoiceActive ? 'Connect Microphone' : (isMuted ? 'Unmute Mic' : 'Mute Mic')}
            >
              {isVoiceActive && !isMuted ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            </button>

            {isVoiceActive && (
              <button
                onClick={toggleDeaf}
                className={`btn-icon w-7 h-7 rounded-lg text-xs ${
                  isDeafened ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'btn-glass text-slate-300'
                }`}
                title={isDeafened ? 'Undeafen Audio' : 'Deafen Incoming Audio'}
              >
                {isDeafened ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            <p>No messages yet.</p>
            <p className="mt-1 text-slate-600">Type below to chat with peers in the room!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.isSystem ? 'items-center my-2' : (msg.senderId === networkService.localPeerId ? 'items-end' : 'items-start')}`}
            >
              {msg.isSystem ? (
                <span className="text-[10px] font-semibold text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-full border border-white/5">
                  {msg.text}
                </span>
              ) : (
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs ${
                  msg.senderId === networkService.localPeerId
                    ? 'bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border border-cyan-500/40 text-cyan-50 rounded-br-none'
                    : 'bg-slate-800/80 border border-white/10 text-slate-200 rounded-bl-none'
                }`}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${msg.senderId === networkService.localPeerId ? 'text-cyan-300' : 'text-purple-300'}`}>
                      {msg.senderName}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="leading-relaxed break-words">{msg.text}</p>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-slate-900/60 flex items-center gap-2">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="text-input text-xs py-2 px-3 flex-1 rounded-xl bg-black/40"
        />
        <button
          type="submit"
          className="btn-icon w-8 h-8 rounded-xl bg-[#00f0ff] text-black hover:bg-[#33f4ff] shrink-0"
          title="Send Message"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
