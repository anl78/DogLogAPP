import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { DogEvent, SupabaseSettings, HealthStatus, AIAnalysisResult, RecordType, Pet, CollaboratorPermissions, NotionSettings } from './types';
import { saveEventToSupabase, testSupabaseConnection, searchEvents, deleteEvent, getUserPets, createPet, getCollaboratorPermissions, checkUnreadMessages, deleteUserAccount, transferPetOwnership, deletePetCompletely, getCollaborators } from './services/supabaseService';
import { sendToNotion } from './services/notionService';
import { analyzeAudio, analyzeInput, analyzeImage, analyzeFile } from './services/geminiService';
import { HEALTH_STATUS_COLORS, Icons, getPoopScoreColor } from './constants';
import Navbar from './components/Navbar';
import EventForm from './components/EventForm';
import AudioRecorder from './components/AudioRecorder';
import AIQueryView from './components/AIQueryView';
import MigrationPanel from './components/MigrationPanel';
import TeamManager from './components/TeamManager';
import BoardView from './components/BoardView';
import StatsView from './components/StatsView';
import DashboardView from './components/DashboardView';
import Auth from './components/Auth';
import ImageViewer from './components/ImageViewer';

const PAGE_SIZE = 25;
const DEFAULT_OWNER_PERMISSIONS: CollaboratorPermissions = { can_create: true, can_edit: 'all', can_delete: 'all', visible_types: [] };

const FALLBACK_URL = "https://nvnmlausdsexvmcrnzxc.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bm1sYXVzZHNleHZtY3JuenhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTE5MjAsImV4cCI6MjA3OTIyNzkyMH0.i2ddyT9GvT70bkIHqSW_whf9UMqqkNnAWawC4k91W0c";

// Helper para asegurar que hay una API Key disponible
const ensureApiKey = async () => {
  // Si process.env.API_KEY ya tiene valor (inyectado por Vercel), no hacemos nada
  if (process.env.API_KEY && process.env.API_KEY.length > 5) {
    return;
  }

  const win = window as any;
  if (win.aistudio && typeof win.aistudio.hasSelectedApiKey === 'function') {
    const hasKey = await win.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await win.aistudio.openSelectKey();
    }
  }
};

const App: React.FC = () => {
  const [settings] = useState<SupabaseSettings>({ supabaseUrl: FALLBACK_URL, supabaseKey: FALLBACK_KEY });
  const [notionSettings, setNotionSettings] = useState<NotionSettings>({ apiKey: localStorage.getItem('NOTION_API_KEY') || '', databaseId: localStorage.getItem('NOTION_DB_ID') || '' });
  const [session, setSession] = useState<any>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [currentPet, setCurrentPet] = useState<Pet | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [permissions, setPermissions] = useState<CollaboratorPermissions>(DEFAULT_OWNER_PERMISSIONS);
  const [newPetName, setNewPetName] = useState('');
  const [creatingPet, setCreatingPet] = useState(false);
  const [view, setView] = useState<'home' | 'board' | 'add' | 'settings' | 'consult' | 'stats' | 'dashboard'>('home');
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [events, setEvents] = useState<DogEvent[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterConfig, setFilterConfig] = useState({ startDate: '', endDate: '', recordType: '' as RecordType | '', searchTitle: '' });
  const [aiProcessing, setAiProcessing] = useState(false);
  const [draftEvent, setDraftEvent] = useState<Partial<DogEvent> | undefined>(undefined);
  const [inputMethod, setInputMethod] = useState<'menu' | 'voice' | 'chat' | 'manual'>('menu');

  // Delete Account States
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'initial' | 'transfer' | 'final'>('initial');
  const [transferTarget, setTransferTarget] = useState('');
  const [petCollabs, setPetCollabs] = useState<any[]>([]);

  useEffect(() => {
    const client = createClient(settings.supabaseUrl, settings.supabaseKey);
    client.auth.getSession().then(({ data: { session } }) => { setSession(session); if (!session) setAuthLoading(false); });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { setSession(session); if (!session) { setPets([]); setCurrentPet(null); setEvents([]); } });
    return () => subscription.unsubscribe();
  }, [settings]);

  useEffect(() => {
    if (session) {
      getUserPets(settings, session.access_token).then(userPets => { setPets(userPets); if (userPets.length > 0 && !currentPet) setCurrentPet(userPets[0]); setAuthLoading(false); });
    }
  }, [session, settings]);

  useEffect(() => {
      const loadPerms = async () => {
          if (!currentPet || !session?.user) return;
          if (currentPet.owner_id === session.user.id) { setPermissions(DEFAULT_OWNER_PERMISSIONS); return; }
          const perms = await getCollaboratorPermissions(settings, currentPet.id, session.user.id, session.access_token);
          if (perms) setPermissions(perms);
      };
      loadPerms();
  }, [currentPet, session]);

  useEffect(() => {
    if (session && currentPet) fetchEvents(true);
  }, [filterConfig, currentPet, session]);

  useEffect(() => {
    if (view === 'add' && !draftEvent) setInputMethod('menu');
    if (view !== 'add') setDraftEvent(undefined);
  }, [view]);

  const fetchEvents = async (reset: boolean = false) => {
    if (!currentPet || !session) return;
    setIsSyncing(true);
    const currentPage = reset ? 0 : page;
    const newBatch = await searchEvents({ petId: currentPet.id, startDate: filterConfig.startDate || undefined, endDate: filterConfig.endDate || undefined, recordType: filterConfig.recordType || undefined, searchTitle: filterConfig.searchTitle || undefined, page: currentPage, pageSize: PAGE_SIZE }, settings, session.access_token);
    if (reset) { setEvents(newBatch); setPage(1); } else { setEvents(prev => [...prev, ...newBatch]); setPage(prev => prev + 1); }
    setHasMore(newBatch.length === PAGE_SIZE);
    setIsSyncing(false);
  };

  const resizeImageForAI = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const scaleSize = MAX_WIDTH / img.width;
          const finalWidth = scaleSize < 1 ? MAX_WIDTH : img.width;
          const finalHeight = scaleSize < 1 ? img.height * scaleSize : img.height;
          canvas.width = finalWidth;
          canvas.height = finalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
             ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
             resolve(canvas.toDataURL('image/jpeg', 0.7));
          } else resolve(event.target?.result as string);
        };
      };
      reader.onerror = reject;
    });
  };

  const handleAudioCaptured = async (base64Audio: string) => {
      setAiProcessing(true);
      await ensureApiKey();
      try {
          const result = await analyzeAudio(base64Audio, settings, session?.access_token);
          setDraftEvent({
              title: result.title,
              recordType: result.recordType,
              healthStatus: result.healthStatus,
              description: result.description,
              weight: result.weight,
              date: result.date || new Date().toISOString().split('T')[0],
              time: result.time || new Date().toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'}),
              poopScore: result.poopScore
          });
          setInputMethod('manual');
      } catch (error: any) { alert("Error analizando audio: " + error.message); } finally { setAiProcessing(false); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setAiProcessing(true);
      await ensureApiKey();
      try {
          // Extraer fecha de los metadatos del archivo (Capture time hint)
          const fileDate = new Date(file.lastModified);
          const metadataHint = `FECHA METADATOS ARCHIVO: ${fileDate.toLocaleString('es-ES')}. Si esta fecha parece la de captura de la foto, úsala prioritariamente.`;
          
          const base64 = await resizeImageForAI(file);
          const result = await analyzeImage(base64, settings, metadataHint, session?.access_token);
          
          setDraftEvent({
              title: result.title,
              recordType: result.recordType,
              healthStatus: result.healthStatus,
              description: result.description,
              weight: result.weight,
              date: result.date || fileDate.toISOString().split('T')[0],
              time: result.time || fileDate.toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'}),
              poopScore: result.recordType === RecordType.POOP ? result.poopScore : undefined,
              photoBase64: base64
          });
          setInputMethod('manual');
      } catch (error: any) { alert("Error analizando imagen: " + error.message); } finally { setAiProcessing(false); }
  };

  const handleLogout = async () => { const client = createClient(settings.supabaseUrl, settings.supabaseKey); await client.auth.signOut(); };

  const handleAccountDeletion = async () => {
    if (!session) return;
    const ownerPets = pets.filter(p => p.owner_id === session.user.id);
    if (ownerPets.length > 0 && deleteStep === 'initial') {
        const collabs = await getCollaborators(settings, ownerPets[0].id, session.access_token);
        const others = collabs.filter(c => c.user_id !== session.user.id);
        setPetCollabs(others);
        setDeleteStep(others.length > 0 ? 'transfer' : 'final');
        setShowDeleteModal(true);
        return;
    }
    if (deleteStep === 'transfer' && !transferTarget && petCollabs.length > 0) { alert("Selecciona un nuevo dueño."); return; }
    setIsLoading(true);
    try {
        if (deleteStep === 'transfer') await transferPetOwnership(settings, ownerPets[0].id, transferTarget, session.access_token);
        else if (deleteStep === 'final' && ownerPets.length > 0) await deletePetCompletely(settings, ownerPets[0].id, session.access_token);
        const res = await deleteUserAccount(settings, session.access_token);
        if (res.success) window.location.reload(); else alert(res.error);
    } catch (e: any) { alert(e.message); } finally { setIsLoading(false); }
  };

  const renderDeleteModal = () => (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-6 animate-fade-in">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Eliminar Cuenta</h3>
            {deleteStep === 'transfer' ? (
                <>
                    <p className="text-sm text-slate-600 mb-6">Debes traspasar la propiedad de <b>{pets[0]?.name}</b>.</p>
                    <select value={transferTarget} onChange={e => setTransferTarget(e.target.value)} className="w-full p-3 rounded-xl border border-slate-200 mb-6">
                        <option value="">-- Seleccionar --</option>
                        {petCollabs.map(c => <option key={c.user_id} value={c.user_id}>{c.profiles?.full_name || c.profiles?.email}</option>)}
                    </select>
                    <button onClick={() => setDeleteStep('final')} className="text-xs text-red-500 underline mb-4 block w-full text-center">Borrar mascota y datos</button>
                </>
            ) : <p className="text-sm text-slate-600 mb-6">Acción irreversible. ¿Seguro?</p>}
            <div className="flex gap-3">
                <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl">Cancelar</button>
                <button onClick={handleAccountDeletion} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-200">Confirmar</button>
            </div>
        </div>
    </div>
  );

  return (
    <>
      {authLoading ? <div className="h-full flex items-center justify-center bg-slate-50"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
      : !session ? <Auth settings={settings} onLoginSuccess={() => fetchEvents(true)} />
      : <div className="h-full w-full relative bg-slate-50">
            {view === 'home' && (
                <div className="flex flex-col h-full bg-slate-50">
                    <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10 flex justify-between items-center">
                        <h1 className="text-2xl font-bold text-slate-800">{currentPet?.name || 'DogLog 🐾'}</h1>
                        <button onClick={() => setShowFilters(!showFilters)} className={`p-2 rounded-full ${showFilters ? 'bg-blue-100 text-blue-600' : 'bg-slate-100'}`}><Icons.Filter className="w-5 h-5"/></button>
                    </header>
                    <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4 no-scrollbar">
                        {events.map(ev => {
                            const eventPhoto = ev.photoUrl || ev.photoBase64;
                            return (
                                <div key={ev.id} onClick={() => { setDraftEvent(ev); setInputMethod('manual'); setView('add'); }} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer active:scale-[0.98] transition-transform flex flex-row items-stretch min-h-[140px]">
                                    <div className="p-4 flex-1 flex flex-col justify-between">
                                        <div>
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex-1 pr-2">
                                                    <h3 className="font-bold text-lg text-slate-800 leading-tight mb-1">{ev.title}</h3>
                                                    <div className="flex flex-wrap gap-2 items-center">
                                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wider">{ev.recordType}</span>
                                                        <span className="text-[10px] text-slate-400">{ev.time}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {ev.description && <p className="text-sm text-slate-600 line-clamp-2 mb-3 leading-snug">{ev.description}</p>}
                                        </div>
                                        <div className="flex items-center justify-between mt-auto">
                                            <div className="flex gap-2">
                                                {ev.healthStatus && <span className={`text-[10px] px-2 py-0.5 rounded-md border ${HEALTH_STATUS_COLORS[ev.healthStatus]}`}>{ev.healthStatus}</span>}
                                                {ev.recordType === RecordType.POOP && ev.poopScore && <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${getPoopScoreColor(ev.poopScore)}`}>Score: {ev.poopScore}</span>}
                                            </div>
                                            <span className="text-[10px] text-slate-400">{ev.date}</span>
                                        </div>
                                    </div>
                                    {eventPhoto && <div className="w-28 shrink-0 overflow-hidden bg-slate-100"><img src={eventPhoto} alt={ev.title} className="w-full h-full object-cover" /></div>}
                                </div>
                            );
                        })}
                        {events.length === 0 && !isSyncing && <div className="flex flex-col items-center justify-center py-20 text-slate-400"><Icons.Activity className="w-12 h-12 mb-4 opacity-20" /><p className="text-sm">No hay eventos.</p></div>}
                        {hasMore && <button onClick={() => fetchEvents()} disabled={isSyncing} className="w-full py-4 text-sm text-blue-600 font-bold">{isSyncing ? 'Cargando...' : 'Cargar más'}</button>}
                    </div>
                </div>
            )}
            {view === 'board' && currentPet && <BoardView settings={settings} petId={currentPet.id} currentUserId={session.user.id} accessToken={session.access_token}/>}
            {view === 'stats' && currentPet && <StatsView settings={settings} petId={currentPet.id} accessToken={session.access_token} />}
            {view === 'dashboard' && currentPet && <DashboardView settings={settings} petId={currentPet.id} accessToken={session.access_token} />}
            {view === 'consult' && <AIQueryView settings={settings} onEventClick={(ev) => { setDraftEvent(ev); setInputMethod('manual'); setView('add'); }} currentPetId={currentPet?.id || ''} accessToken={session.access_token}/>}
            {view === 'settings' && (
                 <div className="p-6 overflow-y-auto h-full pb-24">
                     <h2 className="text-2xl font-bold mb-6">Ajustes</h2>
                     <div className="mb-6"><label className="block text-sm font-medium text-slate-700 mb-2">Mascota Activa</label>
                        <select value={currentPet?.id || ''} onChange={(e) => { const s = pets.find(p => p.id === e.target.value); if(s) setCurrentPet(s); }} className="w-full p-3 rounded-xl border border-slate-200 bg-white">
                            {pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                     </div>
                     {currentPet && session?.user && <TeamManager settings={settings} currentPet={currentPet} currentUserId={session.user.id} accessToken={session.access_token}/>}
                     {currentPet?.owner_id === session?.user?.id && <MigrationPanel supabaseSettings={settings} currentPet={currentPet} currentUser={session?.user} accessToken={session.access_token}/>}
                     <div className="mt-10 border-t pt-6">
                        <button onClick={handleLogout} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold mb-3">Cerrar Sesión</button>
                        <button onClick={() => { setDeleteStep('initial'); setShowDeleteModal(true); }} className="w-full py-2 bg-red-600 text-white rounded-lg font-bold text-xs">Eliminar Cuenta</button>
                     </div>
                 </div>
            )}
            {view === 'add' && (
                <div className="flex-1 overflow-y-auto p-4 bg-slate-50 h-full relative">
                    {inputMethod === 'menu' && (
                        <div className="flex flex-col items-center justify-center h-full space-y-6 animate-fade-in-up">
                             <h2 className="text-2xl font-bold text-slate-800 mb-4">Nuevo Registro</h2>
                             <button onClick={() => setInputMethod('voice')} className="w-full py-6 bg-white border-2 border-blue-100 rounded-3xl shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all"><div className="p-4 bg-blue-100 text-blue-600 rounded-full"><Icons.Mic className="w-8 h-8" /></div><span className="font-bold text-slate-700">Nota de Voz (IA)</span></button>
                             <label className="w-full py-6 bg-white border-2 border-purple-100 rounded-3xl shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all cursor-pointer"><div className="p-4 bg-purple-100 text-purple-600 rounded-full"><Icons.Camera className="w-8 h-8" /></div><span className="font-bold text-slate-700">Analizar Foto (IA)</span><input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} /></label>
                             <button onClick={() => setInputMethod('manual')} className="w-full py-6 bg-white border-2 border-slate-100 rounded-3xl shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all"><div className="p-4 bg-slate-100 text-slate-600 rounded-full"><Icons.CheckSquare className="w-8 h-8" /></div><span className="font-bold text-slate-700">Manual</span></button>
                             <button onClick={() => setView('home')} className="mt-8 text-slate-400 font-medium">Cancelar</button>
                        </div>
                    )}
                    {inputMethod === 'voice' && <div className="h-full flex flex-col items-center justify-center"><h3 className="text-xl font-bold text-slate-700 mb-8">Grabando...</h3><AudioRecorder onAudioCaptured={handleAudioCaptured} isProcessing={aiProcessing} /><button onClick={() => setInputMethod('menu')} className="mt-12 text-slate-400">Cancelar</button></div>}
                    {inputMethod === 'manual' && <EventForm initialData={draftEvent} onSubmit={handleEventSubmit} onCancel={()=>setView('home')} onDelete={draftEvent?.id?()=>handleDeleteEvent(draftEvent as DogEvent):undefined} canEdit={permissions.can_edit !== 'none'} canDelete={permissions.can_delete !== 'none'}/>}
                    {aiProcessing && <div className="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div><p className="font-bold text-slate-700">Analizando con IA...</p></div>}
                </div>
            )}
            <Navbar currentView={view} setView={setView} hasUnread={hasUnreadMessages} />
            {fullScreenImage && <ImageViewer src={fullScreenImage} onClose={() => setFullScreenImage(null)} />}
            {showDeleteModal && renderDeleteModal()}
         </div>}
    </>
  );

  async function handleEventSubmit(event: DogEvent) {
    if (!currentPet || !session) return;
    setIsLoading(true);
    event.petId = currentPet.id;
    if (!event.userId) event.userId = session.user.id;
    const res = await saveEventToSupabase(event, settings, session.access_token);
    if (res.success) { setView('home'); fetchEvents(true); }
    setIsLoading(false);
  }

  async function handleDeleteEvent(event: DogEvent) {
    if (!session) return;
    const res = await deleteEvent(event.id, event.photoUrl, settings, session.access_token);
    if (res.success) { setView('home'); fetchEvents(true); }
  }
};

export default App;