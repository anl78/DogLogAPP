
import React, { useEffect, useState, useRef } from 'react';
import { PetCollaborator, PetNote, PetTask, SupabaseSettings } from '../types';
import { createPetNote, deletePetNote, getCollaborators, getPetNotes, togglePinNote, updateLastSeenBoard, getPetTasks, createPetTask, toggleTaskCompletion } from '../services/supabaseService';
import { detectTaskFromNote } from '../services/geminiService';
import { createClient } from '@supabase/supabase-js';
import { Icons } from '../constants';

interface BoardViewProps {
    settings: SupabaseSettings;
    petId: string;
    currentUserId: string;
    accessToken?: string;
}

type Tab = 'notes' | 'tasks';

const BoardView: React.FC<BoardViewProps> = ({ settings, petId, currentUserId, accessToken }) => {
    const [activeTab, setActiveTab] = useState<Tab>('notes');
    const [loading, setLoading] = useState(true);
    
    // NOTES STATE
    const [notes, setNotes] = useState<PetNote[]>([]);
    const [inputText, setInputText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [members, setMembers] = useState<PetCollaborator[]>([]);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
    const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
    
    // TASKS STATE
    const [tasks, setTasks] = useState<PetTask[]>([]);

    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // --- 1. Initial Load ---
    useEffect(() => {
        const initData = async () => {
            setLoading(true);
            const [notesData, tasksData, membersData] = await Promise.all([
                getPetNotes(settings, petId, accessToken),
                getPetTasks(settings, petId, accessToken),
                getCollaborators(settings, petId, accessToken)
            ]);
            setNotes(notesData);
            setTasks(tasksData);
            setMembers(membersData);
            setLoading(false);
            updateLastSeenBoard(settings, petId, currentUserId, accessToken);
        };
        initData();
    }, [petId]);

    // --- 2. Realtime ---
    useEffect(() => {
        if (!settings.supabaseUrl || !settings.supabaseKey) return;
        const client = createClient(settings.supabaseUrl, settings.supabaseKey, { global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined } });
        
        const channel = client.channel(`board_${petId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pet_notes', filter: `pet_id=eq.${petId}` }, async () => {
                setNotes(await getPetNotes(settings, petId, accessToken));
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pet_tasks', filter: `pet_id=eq.${petId}` }, async () => {
                setTasks(await getPetTasks(settings, petId, accessToken));
            })
            .subscribe();

        return () => { client.removeChannel(channel); };
    }, [petId]);

    // --- NOTES LOGIC ---
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setInputText(text);
        const match = text.match(/@(\w*)$/);
        setMentionQuery(match ? match[1].toLowerCase() : null);
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
        const text = inputText.trim();
        if (!text) return;
        setIsSending(true);
        try {
            // 1. Create Note
            const newNote = await createPetNote(settings, petId, currentUserId, text, selectedMentions, accessToken);
            if (newNote) {
                setNotes(prev => [newNote, ...prev]);
                setInputText('');
                
                // 2. INTELLIGENT TASK DETECTION (Background)
                if (selectedMentions.length > 0) {
                    const mentionedUsersData = members
                        .filter(m => selectedMentions.includes(m.user_id))
                        .map(m => ({ id: m.user_id, name: m.profiles?.full_name || m.profiles?.email || 'User' }));
                    
                    detectTaskFromNote(text, mentionedUsersData, settings, accessToken).then(async (taskData) => {
                        if (taskData) {
                            console.log("Task detected!", taskData);
                            const newTask = await createPetTask(settings, petId, taskData.title, taskData.assignedToId, currentUserId, accessToken);
                            if (newTask) {
                                setTasks(prev => [newTask, ...prev]);
                                // Optional: Show toast "Task created"
                            }
                        }
                    });
                }
                setSelectedMentions([]);
                if (listRef.current) listRef.current.scrollTop = 0;
            }
        } catch (error: any) {
            alert(error.message);
        } finally {
            setIsSending(false);
        }
    };

    const handlePin = async (note: PetNote) => {
        const original = [...notes];
        setNotes(prev => prev.map(n => n.id === note.id ? { ...n, is_pinned: !n.is_pinned } : n));
        try { await togglePinNote(settings, note.id, note.is_pinned, accessToken); } catch (e) { setNotes(original); }
    };

    const executeDelete = async (noteId: string) => {
        setDeletingNoteId(null);
        const prev = [...notes];
        setNotes(prev => prev.filter(n => n.id !== noteId));
        try { await deletePetNote(settings, noteId, accessToken); } 
        catch (e: any) { setNotes(prev); alert(e.message); }
    };

    // --- TASKS LOGIC ---
    const handleToggleTask = async (task: PetTask) => {
        const original = [...tasks];
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
        try { await toggleTaskCompletion(settings, task.id, task.is_completed, accessToken); } catch (e) { setTasks(original); }
    };

    const sortedNotes = [...notes].sort((a, b) => (a.is_pinned === b.is_pinned) ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime() : a.is_pinned ? -1 : 1);
    const filteredMembers = mentionQuery !== null ? members.filter(m => (m.profiles?.full_name || m.profiles?.email || '').toLowerCase().includes(mentionQuery)) : [];

    return (
        <div className="flex flex-col h-full bg-slate-50 relative">
            {/* Header with Tabs */}
            <header className="bg-white border-b border-slate-100 sticky top-0 z-10">
                <div className="px-6 py-4 flex items-center gap-2">
                    <Icons.Board className="w-5 h-5 text-slate-500" />
                    <h2 className="font-bold text-slate-800">Tablón de Equipo</h2>
                </div>
                <div className="flex px-2">
                    <button 
                        onClick={() => setActiveTab('notes')} 
                        className={`flex-1 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'notes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}
                    >
                        Notas ({notes.length})
                    </button>
                    <button 
                        onClick={() => setActiveTab('tasks')} 
                        className={`flex-1 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'tasks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}
                    >
                        Tareas ({tasks.filter(t => !t.is_completed).length})
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={listRef}>
                {loading && <p className="text-center text-slate-400 text-sm mt-10">Cargando...</p>}
                
                {/* NOTES VIEW */}
                {activeTab === 'notes' && (
                    <>
                        {sortedNotes.map(note => (
                            <div key={note.id} className={`p-4 rounded-2xl shadow-sm border relative ${note.is_pinned ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-slate-100'}`}>
                                {note.is_pinned && <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 rounded-full p-1 z-10"><Icons.Pin className="w-3 h-3"/></div>}
                                <div className="flex justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-blue-500`}>
                                            {(note.profiles?.full_name || '?').charAt(0)}
                                        </div>
                                        <span className="text-xs font-bold text-slate-700">{note.profiles?.full_name}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400">{new Date(note.created_at).toLocaleDateString()}</span>
                                </div>
                                <p className="text-sm text-slate-800 whitespace-pre-wrap">
                                    {note.content.split(/(@\w+)/g).map((part, i) => part.startsWith('@') ? <span key={i} className="text-blue-600 font-bold">{part}</span> : part)}
                                </p>
                                <div className="absolute bottom-2 right-2 flex gap-1">
                                    {deletingNoteId === note.id ? (
                                        <div className="flex gap-2 bg-white shadow p-1 rounded"><button onClick={()=>setDeletingNoteId(null)} className="text-xs bg-slate-100 px-2 rounded">No</button><button onClick={()=>executeDelete(note.id)} className="text-xs bg-red-500 text-white px-2 rounded">Sí</button></div>
                                    ) : (
                                        <>
                                            <button onClick={() => handlePin(note)} className="p-1 hover:bg-slate-100 rounded text-slate-300"><Icons.Pin className="w-3.5 h-3.5"/></button>
                                            {note.user_id === currentUserId && <button onClick={() => setDeletingNoteId(note.id)} className="p-1 hover:bg-slate-100 rounded text-slate-300 hover:text-red-400"><Icons.Trash className="w-3.5 h-3.5"/></button>}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </>
                )}

                {/* TASKS VIEW */}
                {activeTab === 'tasks' && (
                    <div className="space-y-2">
                        {tasks.length === 0 && <p className="text-center text-slate-400 text-sm mt-10">No hay tareas pendientes. ¡Buen trabajo!</p>}
                        {tasks.map(task => (
                            <div key={task.id} className={`p-3 rounded-xl border flex items-center gap-3 ${task.is_completed ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 shadow-sm'}`}>
                                <button 
                                    onClick={() => handleToggleTask(task)}
                                    className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${task.is_completed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 bg-white'}`}
                                >
                                    {task.is_completed && <Icons.Check className="w-4 h-4" />}
                                </button>
                                <div className="flex-1">
                                    <p className={`text-sm font-medium ${task.is_completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>{task.title}</p>
                                    <div className="flex justify-between mt-1">
                                        <span className="text-[10px] text-slate-400">Asignado a: <span className="font-bold text-blue-500">{task.assignee?.full_name || 'Cualquiera'}</span></span>
                                        <span className="text-[10px] text-slate-300">Por: {task.creator?.full_name}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* INPUT AREA (Only visible on Notes tab) */}
            {activeTab === 'notes' && (
                <>
                    {mentionQuery !== null && filteredMembers.length > 0 && (
                        <div className="absolute bottom-24 left-4 bg-white border border-slate-200 shadow-xl rounded-xl p-2 w-64 z-50">
                            {filteredMembers.map(m => (
                                <button key={m.user_id} onClick={() => addMention(m)} className="w-full text-left p-2 hover:bg-blue-50 rounded-lg flex items-center gap-2">
                                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">{(m.profiles?.full_name || '?').charAt(0)}</div>
                                    <span className="text-sm text-slate-700">{m.profiles?.full_name || m.profiles?.email}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="p-3 bg-white border-t border-slate-100 pb-24">
                        <div className="flex items-end gap-2">
                            <textarea ref={inputRef} value={inputText} onChange={handleInputChange} placeholder="Escribe una nota... @nombre para asignar tarea" className="flex-1 p-3 bg-slate-50 rounded-xl text-sm outline-none resize-none h-12 focus:h-24 transition-all border border-slate-200"/>
                            <button onClick={handleSend} disabled={!inputText.trim() || isSending} className="h-12 w-12 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow active:scale-95 disabled:opacity-50">
                                {isSending ? <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin"/> : <Icons.Send className="w-5 h-5"/>}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default BoardView;
