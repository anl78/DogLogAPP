
import React, { useEffect, useState, useRef } from 'react';
import { PetCollaborator, PetNote, SupabaseSettings } from '../types';
import { createPetNote, deletePetNote, getCollaborators, getPetNotes, togglePinNote, updateLastSeenBoard } from '../services/supabaseService';
import { createClient } from '@supabase/supabase-js';
import { Icons } from '../constants';

interface BoardViewProps {
    settings: SupabaseSettings;
    petId: string;
    currentUserId: string;
    accessToken?: string;
}

const BoardView: React.FC<BoardViewProps> = ({ settings, petId, currentUserId, accessToken }) => {
    const [notes, setNotes] = useState<PetNote[]>([]);
    const [inputText, setInputText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [loading, setLoading] = useState(true);
    
    // Mention Logic
    const [members, setMembers] = useState<PetCollaborator[]>([]);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [selectedMentions, setSelectedMentions] = useState<string[]>([]); // Array of User IDs to send

    // Delete UI State
    const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // --- 1. Initial Load (Notes & Members) ---
    useEffect(() => {
        const initData = async () => {
            setLoading(true);
            const [notesData, membersData] = await Promise.all([
                getPetNotes(settings, petId, accessToken),
                getCollaborators(settings, petId, accessToken)
            ]);
            setNotes(notesData);
            setMembers(membersData);
            setLoading(false);
            
            // Update "Seen" status
            updateLastSeenBoard(settings, petId, currentUserId, accessToken);
        };
        initData();
    }, [petId]);

    // --- 2. Setup Realtime Subscription ---
    useEffect(() => {
        if (!settings.supabaseUrl || !settings.supabaseKey) return;

        const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
            global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
        });

        const channel = client
            .channel(`notes_${petId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pet_notes', filter: `pet_id=eq.${petId}` }, async () => {
                const data = await getPetNotes(settings, petId, accessToken);
                setNotes(data);
            })
            .subscribe();

        return () => { client.removeChannel(channel); };
    }, [petId, settings, accessToken]);

    // --- Mention Detection ---
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setInputText(text);

        // Simple detection: check if last word starts with @
        const match = text.match(/@(\w*)$/);
        if (match) {
            setMentionQuery(match[1].toLowerCase());
        } else {
            setMentionQuery(null);
        }
    };

    const addMention = (user: PetCollaborator) => {
        if (!mentionQuery && mentionQuery !== '') return;
        
        const name = user.profiles?.full_name || user.profiles?.email.split('@')[0] || 'Usuario';
        const newText = inputText.replace(/@(\w*)$/, `@${name} `);
        
        setInputText(newText);
        setSelectedMentions(prev => [...prev, user.user_id]);
        setMentionQuery(null);
        
        if (inputRef.current) inputRef.current.focus();
    };

    const handleSend = async () => {
        const textToSend = inputText.trim();
        if (!textToSend) return;
        
        // Filter mentions: ensure the ID is still relevant (the name is still in text)
        // This is a basic check. Ideally we track offsets, but for now just checking if we collected the ID is enough.
        // We send all collected IDs.
        
        setIsSending(true);
        try {
            const newNote = await createPetNote(settings, petId, currentUserId, textToSend, selectedMentions, accessToken);
            
            if (newNote) {
                setNotes(prev => [newNote, ...prev]);
                setInputText('');
                setSelectedMentions([]);
                if (listRef.current) listRef.current.scrollTop = 0;
            }
        } catch (error) {
            console.error("Error sending note", error);
        } finally {
            setIsSending(false);
        }
    };

    // ... (Pin/Delete handlers same as before)
    const handlePin = async (note: PetNote) => {
        const original = [...notes];
        setNotes(prev => prev.map(n => n.id === note.id ? { ...n, is_pinned: !n.is_pinned } : n));
        try { await togglePinNote(settings, note.id, note.is_pinned, accessToken); } 
        catch (e: any) { alert(e.message); setNotes(original); }
    };

    const executeDelete = async (noteId: string) => {
        setDeletingNoteId(null); setIsDeleting(true);
        const prev = [...notes];
        setNotes(prev => prev.filter(n => n.id !== noteId));
        try { await deletePetNote(settings, noteId, accessToken); }
        catch (e: any) { console.error(e); setNotes(prev); alert(`Error: ${e.message}`); }
        finally { setIsDeleting(false); }
    };

    const formatDate = (iso: string) => {
        return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const sortedNotes = [...notes].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const filteredMembers = mentionQuery !== null 
        ? members.filter(m => {
            const name = m.profiles?.full_name || m.profiles?.email || '';
            return name.toLowerCase().includes(mentionQuery);
        }) 
        : [];

    return (
        <div className="flex flex-col h-full bg-slate-50 relative">
            <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10 flex items-center gap-2">
                <Icons.Board className="w-5 h-5 text-slate-500" />
                <h2 className="font-bold text-slate-800">Tablón de Notas</h2>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={listRef}>
                {loading && <p className="text-center text-slate-400 text-sm mt-10">Cargando...</p>}
                {!loading && sortedNotes.length === 0 && (
                    <div className="text-center mt-20 opacity-50">
                        <p className="text-slate-500 text-sm">No hay notas.</p>
                    </div>
                )}
                
                {sortedNotes.map(note => {
                    const isMe = note.user_id === currentUserId;
                    const isMentioned = note.mentions?.includes(currentUserId);
                    const isConfirming = deletingNoteId === note.id;

                    return (
                        <div key={note.id} className={`p-4 rounded-2xl shadow-sm border relative transition-all ${
                            note.is_pinned ? 'bg-yellow-50 border-yellow-200' : 
                            isMentioned ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-300' : 
                            'bg-white border-slate-100'
                        }`}>
                            {note.is_pinned && <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 rounded-full p-1 z-10"><Icons.Pin className="w-3 h-3"/></div>}
                            
                            <div className="flex justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${isMe ? 'bg-blue-500' : 'bg-slate-400'}`}>
                                        {(note.profiles?.full_name || note.profiles?.email || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-xs font-bold text-slate-700">{note.profiles?.full_name || 'Usuario'}</span>
                                </div>
                                <span className="text-[10px] text-slate-400">{formatDate(note.created_at)}</span>
                            </div>
                            
                            <p className="text-sm text-slate-800 whitespace-pre-wrap">
                                {note.content.split(/(@\w+)/g).map((part, i) => 
                                    part.startsWith('@') ? <span key={i} className="text-blue-600 font-bold">{part}</span> : part
                                )}
                            </p>

                            <div className="absolute bottom-2 right-2 flex gap-1">
                                {isConfirming ? (
                                    <div className="flex items-center gap-2 bg-white shadow p-1 rounded border z-20">
                                        <button onClick={() => setDeletingNoteId(null)} className="text-xs px-2 py-1 bg-slate-100 rounded">Cancelar</button>
                                        <button onClick={() => executeDelete(note.id)} className="text-xs px-2 py-1 bg-red-500 text-white rounded">Borrar</button>
                                    </div>
                                ) : (
                                    <>
                                        <button onClick={() => handlePin(note)} className={`p-1 hover:bg-slate-100 rounded ${note.is_pinned ? 'text-yellow-500' : 'text-slate-300'}`}><Icons.Pin className="w-3.5 h-3.5"/></button>
                                        {isMe && <button onClick={() => setDeletingNoteId(note.id)} className="p-1 hover:bg-slate-100 rounded text-slate-300 hover:text-red-400"><Icons.Trash className="w-3.5 h-3.5"/></button>}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Mention Popup */}
            {mentionQuery !== null && filteredMembers.length > 0 && (
                <div className="absolute bottom-24 left-4 bg-white border border-slate-200 shadow-xl rounded-xl p-2 w-64 z-50">
                    <p className="text-[10px] font-bold text-slate-400 px-2 mb-1">MENCIONAR A:</p>
                    {filteredMembers.map(m => (
                        <button 
                            key={m.user_id} 
                            onClick={() => addMention(m)}
                            className="w-full text-left p-2 hover:bg-blue-50 rounded-lg flex items-center gap-2"
                        >
                            <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                {(m.profiles?.full_name || m.profiles?.email).charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm text-slate-700">{m.profiles?.full_name || m.profiles?.email}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="p-3 bg-white border-t border-slate-100 pb-24">
                <div className="flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        value={inputText}
                        onChange={handleInputChange}
                        placeholder="Escribe una nota... usa @ para mencionar"
                        className="flex-1 p-3 bg-slate-50 rounded-xl text-sm outline-none resize-none h-12 focus:h-24 transition-all border border-slate-200"
                    />
                    <button 
                        onClick={handleSend}
                        disabled={!inputText.trim() || isSending}
                        className="h-12 w-12 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow active:scale-95 disabled:opacity-50"
                    >
                        {isSending ? <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin"/> : <Icons.Send className="w-5 h-5"/>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BoardView;
