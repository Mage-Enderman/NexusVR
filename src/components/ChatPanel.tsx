import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, Minimize2 } from 'lucide-react';
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

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-20 right-4 z-40 w-80 max-h-[380px] glass-panel flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-right duration-200 border border-slate-700/80 bg-slate-900/90 backdrop-blur-xl">
      {/* Header */}
      <div className="p-3.5 border-b border-white/10 bg-slate-900/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#00f0ff]" />
          <span className="font-['Outfit'] font-bold text-sm">Text Chat</span>
        </div>
        <button onClick={onClose} className="btn-icon w-6 h-6 btn-glass text-slate-400 hover:text-white" title="Close Text Chat">
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages Area */}
      <div className="overflow-y-auto max-h-[230px] min-h-[80px] p-3 space-y-3">
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
