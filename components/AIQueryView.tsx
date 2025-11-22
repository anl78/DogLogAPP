import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, DogEvent, SupabaseSettings } from '../types';
import { consultAssistant } from '../services/geminiService';
import { HEALTH_STATUS_COLORS, Icons } from '../constants';

interface AIQueryViewProps {
  settings: SupabaseSettings;
  onEventClick: (event: DogEvent) => void;
}

const INITIAL_MESSAGE: ChatMessage = { 
    id: 'intro', 
    role: 'assistant', 
    text: '¡Hola! Soy tu asistente veterinario. Pregúntame sobre el historial de salud, últimas cacas, visitas al veterinario o tendencias. ¿En qué puedo ayudarte hoy?' 
};

const AIQueryView: React.FC<AIQueryViewProps> = ({ settings, onEventClick }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleClearChat = () => {
      if (window.confirm("¿Quieres borrar la conversación y empezar de nuevo?")) {
          setMessages([INITIAL_MESSAGE]);
      }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    if (!settings.supabaseUrl || !settings.supabaseKey) {
        alert("Por favor, configura Supabase en Ajustes para usar el asistente.");
        return;
    }

    const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        text: input
    };

    // Optimistic update
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
        // Pass the full history (excluding the intro if needed, but here we include it as context 
        // though the service usually maps roles. 'intro' will be treated as model role).
        const response = await consultAssistant(newHistory, settings);
        
        const aiMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            text: response.text,
            relatedEvents: response.events
        };
        setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
        console.error(error);
        const errorMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            text: `Error: ${error.message || "Problema de conexión"}`,
            isError: true
        };
        setMessages(prev => [...prev, errorMsg]);
    } finally {
        setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
        {/* Header */}
        <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white shadow-md">
                    <Icons.Sparkles className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Asistente IA</h2>
                    <p className="text-xs text-slate-500">Consulta tu historial médico</p>
                </div>
            </div>
            <button 
                onClick={handleClearChat}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                title="Borrar conversación"
            >
                <Icons.Trash className="w-5 h-5" />
            </button>
        </header>

        {/* Chat Area - Increased padding-bottom (pb-40) to allow space for input box */}
        <div className="flex-1 overflow-y-auto p-4 pb-40 space-y-6" ref={scrollRef}>
            {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div 
                        className={`
                            max-w-[85%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap shadow-sm
                            ${msg.role === 'user' 
                                ? 'bg-blue-600 text-white rounded-br-none' 
                                : msg.isError 
                                    ? 'bg-red-100 text-red-800 rounded-bl-none border border-red-200'
                                    : 'bg-white text-slate-800 rounded-bl-none border border-slate-100'
                            }
                        `}
                    >
                        {msg.text}
                    </div>

                    {/* Render Related Cards if Available */}
                    {msg.relatedEvents && msg.relatedEvents.length > 0 && (
                        <div className="mt-3 w-full max-w-[95%] space-y-2 animate-fade-in-up">
                            <p className="text-xs font-bold text-slate-400 ml-1 mb-1 uppercase tracking-wider">
                                {msg.relatedEvents.length} Registros Encontrados:
                            </p>
                            {msg.relatedEvents.map(event => (
                                <button 
                                    key={event.id} 
                                    onClick={() => onEventClick(event)}
                                    className="w-full bg-white rounded-xl p-3 shadow-sm border border-slate-200 flex flex-col gap-2 text-left active:scale-[0.98] transition-transform hover:border-blue-300"
                                >
                                    <div className="flex justify-between items-start w-full">
                                        <h4 className="font-bold text-slate-800 text-sm line-clamp-1">{event.title}</h4>
                                        <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-600 shrink-0 ml-2">{event.recordType}</span>
                                    </div>
                                    
                                    {/* Photo display logic */}
                                    {(event.photoUrl || event.photoBase64) && (
                                        <div className="w-full h-32 rounded-lg overflow-hidden bg-slate-100 my-1">
                                            <img 
                                                src={event.photoUrl || event.photoBase64} 
                                                alt="Evidencia" 
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    )}

                                    <p className="text-xs text-slate-500 line-clamp-2">{event.description}</p>
                                    <div className="flex gap-2 items-center mt-1 w-full">
                                        {event.healthStatus && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${HEALTH_STATUS_COLORS[event.healthStatus]}`}>
                                                {event.healthStatus}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-slate-400 ml-auto">{event.date} {event.time}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ))}
            {isLoading && (
                 <div className="flex items-start">
                    <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-none border border-slate-100 shadow-sm flex items-center gap-2">
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-75"></div>
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-150"></div>
                    </div>
                 </div>
            )}
        </div>

        {/* Input Area - Positioned above Navbar */}
        <div className="absolute bottom-[80px] left-0 w-full p-3 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent z-20">
            <div className="flex items-center gap-2 bg-white p-2 rounded-full shadow-lg border border-slate-200">
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ej: ¿Cómo han sido las cacas de la semana?"
                    className="flex-1 pl-4 py-2 text-sm outline-none text-slate-700 bg-transparent"
                    disabled={isLoading}
                />
                <button 
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${!input.trim() || isLoading ? 'bg-slate-200 text-slate-400' : 'bg-blue-600 text-white shadow-md active:scale-95'}`}
                >
                    <Icons.Send className="w-5 h-5 ml-0.5" />
                </button>
            </div>
        </div>
    </div>
  );
};

export default AIQueryView;