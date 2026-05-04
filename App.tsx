
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import exifr from 'exifr';
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
import SharedPetView from './components/SharedPetView';

const PAGE_SIZE = 25;
const DEFAULT_OWNER_PERMISSIONS: CollaboratorPermissions = { can_create: true, can_edit: 'all', can_delete: 'all', visible_types: [] };

const FALLBACK_URL = "https://nvnmlausdsexvmcrnzxc.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bm1sYXVzZHNleHZtY3JuenhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTE5MjAsImV4cCI6MjA3OTIyNzkyMH0.i2ddyT9GvT70bkIHqSW_whf9UMqqkNnAWawC4k91W0c";

const ensureApiKey = async () => {
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

const DB_FIX_SCRIPT = `
-- 🛠️ SOLUCIÓN DEFINITIVA PARA BUCLE INFINITO (RLS) 🛠️
-- Ejecuta TODO este bloque en el SQL Editor de Supabase.

-- 1. Función de Seguridad para romper el bucle
-- Permite verificar el dueño sin activar las políticas de la tabla 'pets' recursivamente.
CREATE OR REPLACE FUNCTION public.is_pet_owner(_pet_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Limpieza TOTAL de políticas antiguas (Borrador Inteligente)
DO $$ 
DECLARE 
  pol record; 
BEGIN 
  -- Busca y borra CUALQUIER política en estas tablas para asegurar limpieza
  FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('pets', 'pet_collaborators') 
  LOOP 
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename); 
  END LOOP; 
END $$;

-- 3. Políticas para MASCOTAS (pets)
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;

-- El dueño tiene acceso total
CREATE POLICY "Owner All Access" ON pets
FOR ALL USING (auth.uid() = owner_id);

-- Los colaboradores pueden VER (esto consulta pet_collaborators)
CREATE POLICY "Collaborator View" ON pets
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pet_collaborators
    WHERE pet_id = pets.id AND user_id = auth.uid()
  )
);

-- 4. Políticas para COLABORADORES (pet_collaborators)
ALTER TABLE pet_collaborators ENABLE ROW LEVEL SECURITY;

-- Un usuario puede ver las filas donde él es el colaborador
CREATE POLICY "Self View Permissions" ON pet_collaborators
FOR SELECT USING (user_id = auth.uid());

-- El dueño puede GESTIONAR colaboradores
-- IMPORTANTE: Usa la función is_pet_owner() para evitar el bucle infinito
CREATE POLICY "Owner Manage Collaborators" ON pet_collaborators
FOR ALL USING (public.is_pet_owner(pet_id));

-- ✅ FIN DEL SCRIPT
`;

const App: React.FC = () => {
  const [settings] = useState<SupabaseSettings>({ supabaseUrl: FALLBACK_URL, supabaseKey: FALLBACK_KEY });
  const [session, setSession] = useState<any>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [currentPet, setCurrentPet] = useState<Pet | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [permissions, setPermissions] = useState<CollaboratorPermissions>(DEFAULT_OWNER_PERMISSIONS);
  
  // Navigation State
  const [view, setView] = useState<'home' | 'board' | 'add' | 'settings' | 'consult' | 'stats' | 'dashboard'>('home');
  const [previousView, setPreviousView] = useState<'home' | 'board' | 'add' | 'settings' | 'consult' | 'stats' | 'dashboard'>('home');

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

  // Error States
  const [dbError, setDbError] = useState<any>(null);

  // Delete & Create Pet State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'initial' | 'transfer' | 'final'>('initial');
  const [transferTarget, setTransferTarget] = useState('');
  const [petCollabs, setPetCollabs] = useState<any[]>([]);
  const [newPetName, setNewPetName] = useState('');

  // Shared Link State
  const [sharedToken, setSharedToken] = useState<string | null>(null);

  // Batch Processing State
  const [batchProgress, setBatchProgress] = useState<{ total: number, current: number, logs: string[] } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    if (shareToken) {
      setSharedToken(shareToken);
      return; // Skip normal initialization
    }

    const client = createClient(settings.supabaseUrl, settings.supabaseKey);
    client.auth.getSession().then(({ data: { session } }) => { setSession(session); if (!session) setAuthLoading(false); });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { setSession(session); if (!session) { setPets([]); setCurrentPet(null); setEvents([]); } });
    return () => subscription.unsubscribe();
  }, [settings]);

  useEffect(() => {
    if (session && !sharedToken) {
      getUserPets(settings, session.access_token).then(res => { 
        if (res.error) {
            console.error("Critical DB Error:", res.error);
            setDbError(res.error);
            if (res.error.code === "42P17" || res.error.message?.includes("recursion")) {
                setView('settings'); // Force user to settings to see the fix
            }
        }
        setPets(res.pets); 
        if (res.pets.length > 0) {
            if (!currentPet || !res.pets.find(p => p.id === currentPet.id)) {
                setCurrentPet(res.pets[0]);
            }
        }
        setAuthLoading(false); 
      });
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

  // Reload pets function (available in scope)
  const reloadPets = async () => {
      if (!session) return;
      const res = await getUserPets(settings, session.access_token);
      
      if (res.error) {
          setDbError(res.error);
          alert("Error cargando mascotas: " + (res.error.message || res.error.code));
      } else {
          setDbError(null);
      }
      
      setPets(res.pets);
      if (res.pets.length > 0) {
           if(!currentPet || !res.pets.find(p => p.id === currentPet.id)) {
               setCurrentPet(res.pets[0]);
           }
      }
      alert(`Lista recargada. Encontradas: ${res.pets.length}`);
  };

  const fetchEvents = async (reset: boolean = false) => {
    if (!currentPet || !session) return;
    setIsSyncing(true);
    const currentPage = reset ? 0 : page;
    const newBatch = await searchEvents({ petId: currentPet.id, startDate: filterConfig.startDate || undefined, endDate: filterConfig.endDate || undefined, recordType: filterConfig.recordType || undefined, searchTitle: filterConfig.searchTitle || undefined, page: currentPage, pageSize: PAGE_SIZE }, settings, session.access_token);
    if (reset) { setEvents(newBatch); setPage(1); } else { setEvents(prev => [...prev, ...newBatch]); setPage(prev => prev + 1); }
    setHasMore(newBatch.length === PAGE_SIZE);
    setIsSyncing(false);
  };

  const handleCreatePet = async () => {
    if(!newPetName.trim() || !session) return;
    const { pet, error } = await createPet(settings, newPetName.trim(), session.user.id, session.access_token);
    
    if (error) {
        alert(`Error creando mascota: ${error}`);
        return;
    }

    if(pet) {
        setPets(prev => [...prev, pet]);
        setCurrentPet(pet);
        setNewPetName('');
        alert("¡Mascota creada correctamente!");
    }
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
              recordType: result.recordType as RecordType,
              healthStatus: result.healthStatus as HealthStatus,
              description: result.description,
              weight: result.weight,
              date: result.date,
              time: result.time,
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
          // Extraer fecha real de los metadatos EXIF usando exifr
          let formattedDate: string;
          let formattedTime: string;
          
          try {
              const exif = await exifr.parse(file);
              // Usamos métodos locales (no UTC) para evitar que el navegador reste/sume horas según la zona horaria del dispositivo,
              // ya que la cámara suele guardar la hora tal cual aparece en el reloj del dispositivo.
              const d = (exif && exif.DateTimeOriginal) ? new Date(exif.DateTimeOriginal) : new Date(file.lastModified);
              
              const YYYY = d.getFullYear();
              const MM = String(d.getMonth() + 1).padStart(2, '0');
              const DD = String(d.getDate()).padStart(2, '0');
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              
              formattedDate = `${YYYY}-${MM}-${DD}`;
              formattedTime = `${hh}:${mm}`;
          } catch (exifErr) {
              const d = new Date(file.lastModified);
              formattedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              formattedTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }

          const metadataHint = `FECHA=${formattedDate}, HORA=${formattedTime}. ESTA ES LA FECHA REAL DE CAPTURA DE LA FOTO (EXIF). ÚSALA OBLIGATORIAMENTE.`;
          
          const base64 = await resizeImageForAI(file);
          const result = await analyzeImage(base64, settings, metadataHint, session?.access_token);
          
          setDraftEvent({
              title: result.title,
              recordType: result.recordType as RecordType,
              healthStatus: result.healthStatus as HealthStatus,
              description: result.description,
              weight: result.weight,
              date: result.date || formattedDate,
              time: result.time || formattedTime,
              poopScore: result.poopScore,
              photoBase64: base64
          });
          setInputMethod('manual');
      } catch (error: any) { 
          alert("Error analizando imagen: " + error.message); 
      } finally { 
          setAiProcessing(false); 
      }
  };

  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (!files.length || !currentPet || !session) return;
      
      setBatchProgress({ total: files.length, current: 0, logs: [] });
      setAiProcessing(true);
      await ensureApiKey();
      
      let created = 0;
      let skipped = 0;
      
      // We will loop sequentially to respect rate limits
      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setBatchProgress(prev => prev ? { ...prev, current: i + 1, logs: [`Analizando imagen ${i+1}/${files.length}...`, ...prev.logs].slice(0,5) } : null);
          
          try {
              let formattedDate: string;
              let formattedTime: string;
              try {
                  const exif = await exifr.parse(file);
                  const d = (exif && exif.DateTimeOriginal) ? new Date(exif.DateTimeOriginal) : new Date(file.lastModified);
                  const YYYY = d.getFullYear();
                  const MM = String(d.getMonth() + 1).padStart(2, '0');
                  const DD = String(d.getDate()).padStart(2, '0');
                  const hh = String(d.getHours()).padStart(2, '0');
                  const mm = String(d.getMinutes()).padStart(2, '0');
                  formattedDate = `${YYYY}-${MM}-${DD}`;
                  formattedTime = `${hh}:${mm}`;
              } catch (exifErr) {
                  const d = new Date(file.lastModified);
                  formattedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  formattedTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              }
              
              // Verify collision
              const exists = events.some(ev => ev.date === formattedDate && ev.time === formattedTime);
              if (exists) {
                  skipped++;
                  setBatchProgress(prev => prev ? { ...prev, logs: [`⚠️ Omitida: Ya existe registro en ${formattedDate} ${formattedTime}`, ...prev.logs].slice(0,5) } : null);
                  continue; // Skip without calling AI
              }

              const metadataHint = `FECHA=${formattedDate}, HORA=${formattedTime}. ESTA ES LA FECHA REAL DE CAPTURA. ÚSALA OBLIGATORIAMENTE.`;
              const base64 = await resizeImageForAI(file);
              
              const result = await analyzeImage(base64, settings, metadataHint, session?.access_token);
              
              // Generate UUID
              const safeId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                  const r = Math.random() * 16 | 0;
                  const v = c === 'x' ? r : (r & 0x3 | 0x8);
                  return v.toString(16);
              });
              
              const newEvent: DogEvent = {
                  id: safeId,
                  title: result.title,
                  recordType: result.recordType as RecordType,
                  healthStatus: result.healthStatus as HealthStatus,
                  description: result.description,
                  weight: result.weight,
                  date: result.date || formattedDate,
                  time: result.time || formattedTime,
                  poopScore: result.poopScore,
                  photoBase64: base64,
                  needs_review: true,
                  petId: currentPet.id,
                  userId: session.user.id,
                  synced: false
              };
              
              setBatchProgress(prev => prev ? { ...prev, logs: [`✅ Guardando ${newEvent.recordType} de las ${newEvent.time}...`, ...prev.logs].slice(0,5) } : null);
              await saveEventToSupabase(newEvent, settings, session.access_token);
              created++;
              
              // Rate limit pause between calls (unless last one)
              if (i < files.length - 1) {
                  await new Promise(r => setTimeout(r, 2500));
              }
              
          } catch (e: any) {
              setBatchProgress(prev => prev ? { ...prev, logs: [`❌ Error en imagen ${i+1}: ${e.message}`, ...prev.logs].slice(0,5) } : null);
          }
      }
      
      setBatchProgress(null);
      setAiProcessing(false);
      alert(`Proceso finalizado.\n✔️ ${created} creados\n⏭️ ${skipped} omitidos (duplicados)`);
      fetchEvents(true); // reload list
      setView('home'); // Go to home to see them
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

  if (sharedToken) {
      return <SharedPetView token={sharedToken} settings={settings} />;
  }

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
                    
                    {showFilters && (
                        <div className="bg-white px-6 py-4 border-b border-slate-100 shadow-sm animate-fade-in-down z-0">
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Tipo</label>
                                    <select 
                                        value={filterConfig.recordType} 
                                        onChange={(e) => setFilterConfig(prev => ({...prev, recordType: e.target.value as RecordType | ''}))}
                                        className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-slate-50 outline-none focus:border-blue-500 transition-colors"
                                    >
                                        <option value="">Todos</option>
                                        {Object.values(RecordType).map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Búsqueda</label>
                                    <input 
                                        type="text" 
                                        placeholder="Título..." 
                                        value={filterConfig.searchTitle}
                                        onChange={(e) => setFilterConfig(prev => ({...prev, searchTitle: e.target.value}))}
                                        className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-slate-50 outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                     <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Desde</label>
                                     <input 
                                        type="date" 
                                        value={filterConfig.startDate} 
                                        onChange={(e) => setFilterConfig(prev => ({...prev, startDate: e.target.value}))}
                                        className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-slate-50 outline-none focus:border-blue-500 transition-colors"
                                     />
                                </div>
                                <div>
                                     <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Hasta</label>
                                     <input 
                                        type="date" 
                                        value={filterConfig.endDate} 
                                        onChange={(e) => setFilterConfig(prev => ({...prev, endDate: e.target.value}))}
                                        className="w-full p-2 rounded-lg border border-slate-200 text-sm bg-slate-50 outline-none focus:border-blue-500 transition-colors"
                                     />
                                </div>
                            </div>
                            <button 
                                onClick={() => {
                                    setFilterConfig({ startDate: '', endDate: '', recordType: '', searchTitle: '' });
                                }}
                                className="w-full py-2 text-xs text-red-500 hover:text-red-700 font-bold bg-red-50 rounded-lg"
                            >
                                Limpiar Filtros
                            </button>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4 no-scrollbar">
                        {events.map(ev => {
                            const eventPhoto = ev.photoUrl || ev.photoBase64;
                            return (
                                <div 
                                    key={ev.id} 
                                    onClick={() => { 
                                        setDraftEvent(ev); 
                                        setInputMethod('manual'); 
                                        setPreviousView('home'); 
                                        setView('add'); 
                                    }} 
                                    className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 cursor-pointer active:scale-[0.98] transition-transform flex flex-row items-stretch min-h-[140px]"
                                >
                                    <div className="p-4 flex-1 flex flex-col justify-between">
                                        <div>
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex-1 pr-2">
                                                    <h3 className="font-bold text-lg text-slate-800 leading-tight mb-1">{ev.title}</h3>
                                                    <div className="flex flex-wrap gap-2 items-center">
                                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wider">{ev.recordType}</span>
                                                        <span className="text-[10px] text-slate-400">{ev.time}</span>
                                                        {ev.needs_review && (
                                                            <span className="text-[9px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-sm uppercase tracking-wider">Por revisar (IA)</span>
                                                        )}
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
                                    {eventPhoto && (
                                        <div 
                                          className="w-28 shrink-0 overflow-hidden bg-slate-100"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setFullScreenImage(eventPhoto);
                                          }}
                                        >
                                          <img src={eventPhoto} alt={ev.title} className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {events.length === 0 && !isSyncing && (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <Icons.Activity className="w-12 h-12 mb-4 opacity-20" />
                                <p className="text-sm mb-4">
                                  {pets.length === 0 ? "No tienes mascotas registradas." : "No hay eventos visibles."}
                                </p>
                                {pets.length === 0 ? (
                                    <button onClick={() => setView('settings')} className="text-blue-600 text-xs font-bold underline bg-blue-50 px-3 py-2 rounded-lg">
                                        Crear Mascota en Ajustes
                                    </button>
                                ) : (
                                    <button onClick={() => fetchEvents(true)} className="text-blue-600 text-xs font-bold underline bg-blue-50 px-3 py-2 rounded-lg">
                                        Recargar Lista
                                    </button>
                                )}
                            </div>
                        )}
                        {hasMore && events.length > 0 && <button onClick={() => fetchEvents()} disabled={isSyncing} className="w-full py-4 text-sm text-blue-600 font-bold">{isSyncing ? 'Cargando...' : 'Cargar más'}</button>}
                    </div>
                </div>
            )}
            {view === 'board' && currentPet && <BoardView settings={settings} petId={currentPet.id} currentUserId={session.user.id} accessToken={session.access_token}/>}
            {view === 'stats' && currentPet && (
                <StatsView 
                    settings={settings} 
                    petId={currentPet.id} 
                    accessToken={session.access_token} 
                    onEventClick={(ev) => { 
                        setDraftEvent(ev); 
                        setInputMethod('manual'); 
                        setPreviousView('stats');
                        setView('add'); 
                    }}
                />
            )}
            {view === 'dashboard' && currentPet && <DashboardView settings={settings} petId={currentPet.id} accessToken={session.access_token} />}
            {view === 'consult' && (
                <AIQueryView 
                    settings={settings} 
                    onEventClick={(ev) => { 
                        setDraftEvent(ev); 
                        setInputMethod('manual'); 
                        setPreviousView('consult');
                        setView('add'); 
                    }} 
                    currentPetId={currentPet?.id || ''} 
                    accessToken={session.access_token}
                />
            )}
            {view === 'settings' && (
                 <div className="p-6 overflow-y-auto h-full pb-24">
                     <h2 className="text-2xl font-bold mb-6">Ajustes</h2>
                     
                     {/* DB REPAIR SECTION - Visible ONLY on Error */}
                     {(dbError && (dbError.code === "42P17" || dbError.message?.includes("recursion"))) && (
                         <div className="mb-8 p-4 bg-red-50 border-2 border-red-200 rounded-xl animate-fade-in-down">
                             <div className="flex items-start gap-3 mb-3">
                                <Icons.AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
                                <div>
                                    <h3 className="font-bold text-red-700">Error Crítico: Bucle Infinito en BD</h3>
                                    <p className="text-xs text-red-600 mt-1">
                                        Las políticas de seguridad de tu base de datos están mal configuradas (Recursión Infinita). 
                                        Esto impide ver o guardar mascotas.
                                    </p>
                                </div>
                             </div>
                             <p className="text-xs font-bold text-slate-600 mb-2">SOLUCIÓN DEFINITIVA: Copia este código actualizado y ejecútalo en el "SQL Editor" de Supabase.</p>
                             <div className="bg-yellow-50 p-2 rounded mb-2 border border-yellow-200 text-[10px] text-yellow-800 font-bold">
                                ℹ️ Supabase te avisará de que es una "Operación Destructiva". NO TE ASUSTES. Es necesario borrar las políticas antiguas para poner las nuevas. TUS DATOS ESTÁN SEGUROS.
                             </div>
                             <div className="relative">
                                <pre className="text-[10px] bg-slate-800 text-green-400 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono">
                                    {DB_FIX_SCRIPT}
                                </pre>
                                <button 
                                    onClick={() => navigator.clipboard.writeText(DB_FIX_SCRIPT).then(() => alert("Copiado al portapapeles"))}
                                    className="absolute top-2 right-2 px-2 py-1 bg-white text-slate-800 text-[10px] font-bold rounded hover:bg-slate-100"
                                >
                                    COPIAR
                                </button>
                             </div>
                         </div>
                     )}

                     <div className="mb-6">
                        <div className="flex gap-2 items-end mb-2">
                             <label className="block text-sm font-medium text-slate-700 flex-1">Mascota Activa</label>
                             <button onClick={reloadPets} className="text-xs text-blue-600 underline">Refrescar lista</button>
                        </div>
                        <select 
                            value={currentPet?.id || ''} 
                            onChange={(e) => { const s = pets.find(p => p.id === e.target.value); if(s) setCurrentPet(s); }} 
                            className="w-full p-3 rounded-xl border border-slate-200 bg-white text-slate-900"
                        >
                            <option value="" disabled>-- Seleccionar --</option>
                            {pets.length === 0 ? (
                                <option value="" disabled>No hay mascotas encontradas</option>
                            ) : (
                                pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                            )}
                        </select>
                     </div>
                     
                     {/* Manual Pet Creation */}
                     <div className="mb-6 p-4 bg-white rounded-xl border border-slate-200">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Crear Nueva Mascota</label>
                        <div className="flex gap-2">
                            <input 
                                type="text" 
                                value={newPetName} 
                                onChange={(e) => setNewPetName(e.target.value)} 
                                placeholder="Nombre (ej: Toby)"
                                className="flex-1 p-2 rounded-lg border border-slate-200 text-sm"
                            />
                            <button onClick={handleCreatePet} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">Crear</button>
                        </div>
                     </div>

                     <div className="mb-6 p-4 bg-slate-100 rounded-xl border border-slate-200">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tu ID de Usuario</label>
                        <code className="block text-xs bg-white p-2 rounded border border-slate-200 break-all select-all text-slate-600">
                            {session?.user?.id}
                        </code>
                        <p className="text-[10px] text-slate-400 mt-1">Úsalo en scripts SQL si necesitas arreglar permisos.</p>
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
                             <label className="w-full py-6 bg-white border-2 border-orange-100 rounded-3xl shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all cursor-pointer"><div className="p-4 bg-orange-100 text-orange-600 rounded-full"><Icons.Activity className="w-8 h-8" /></div><span className="font-bold text-slate-700">Lote de Fotos (IA)</span><input type="file" multiple accept="image/*" className="hidden" onChange={handleBatchUpload} /></label>
                             <button onClick={() => setInputMethod('manual')} className="w-full py-6 bg-white border-2 border-slate-100 rounded-3xl shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all"><div className="p-4 bg-slate-100 text-slate-600 rounded-full"><Icons.CheckSquare className="w-8 h-8" /></div><span className="font-bold text-slate-700">Manual</span></button>
                             <button onClick={() => setView('home')} className="mt-8 text-slate-400 font-medium">Cancelar</button>
                        </div>
                    )}
                    {inputMethod === 'voice' && <div className="h-full flex flex-col items-center justify-center"><h3 className="text-xl font-bold text-slate-700 mb-8">Grabando...</h3><AudioRecorder onAudioCaptured={handleAudioCaptured} isProcessing={aiProcessing} /><button onClick={() => setInputMethod('menu')} className="mt-12 text-slate-400">Cancelar</button></div>}
                    
                    {/* Event Form: Using previousView for correct back navigation */}
                    {inputMethod === 'manual' && (
                        <EventForm 
                            initialData={draftEvent} 
                            onSubmit={handleEventSubmit} 
                            onCancel={() => setView(previousView)} 
                            onDelete={draftEvent?.id ? () => handleDeleteEvent(draftEvent as DogEvent) : undefined} 
                            canEdit={permissions.can_edit !== 'none'} 
                            canDelete={permissions.can_delete !== 'none'}
                        />
                    )}
                    
                    {aiProcessing && <div className="absolute inset-0 bg-white/80 z-[60] flex flex-col items-center justify-center backdrop-blur-sm px-6 text-center">
                        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="font-bold text-slate-700">{batchProgress ? `Procesando lote: ${batchProgress.current}/${batchProgress.total} comprobando...` : 'Analizando con IA...'}</p>
                        {batchProgress && batchProgress.logs.length > 0 && (
                            <div className="mt-6 w-full max-w-sm bg-slate-100 rounded-xl p-4 text-left max-h-48 overflow-y-auto border border-slate-200">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Progreso</h4>
                                {batchProgress.logs.map((l, i) => <p key={i} className="text-xs text-slate-600 mb-1 leading-snug break-words">{l}</p>)}
                            </div>
                        )}
                    </div>}
                </div>
            )}
            <Navbar currentView={view} setView={setView} hasUnread={hasUnreadMessages} />
            {fullScreenImage && <ImageViewer src={fullScreenImage} onClose={() => setFullScreenImage(null)} />}
            {showDeleteModal && renderDeleteModal()}
         </div>}
    </>
  );

  async function handleEventSubmit(event: DogEvent) {
    if (!session) return;
    if (!currentPet) {
        alert("⚠️ Error: No tienes ninguna mascota seleccionada. Ve a Ajustes y crea o selecciona una mascota para poder guardar eventos.");
        return;
    }
    
    setIsLoading(true);
    event.petId = currentPet.id;
    if (!event.userId) event.userId = session.user.id;
    const res = await saveEventToSupabase(event, settings, session.access_token);
    
    if (res.success) { 
        setView(previousView); // Return to origin (Home, Stats, Consult)
        if (previousView === 'home') fetchEvents(true); // Only refresh main list if needed
    } else { 
        alert("Error guardando: " + res.error); 
    }
    setIsLoading(false);
  }

  async function handleDeleteEvent(event: DogEvent) {
    if (!session) return;
    const res = await deleteEvent(event.id, event.photoUrl, settings, session.access_token);
    if (res.success) { 
        setView(previousView); 
        if (previousView === 'home') fetchEvents(true);
    }
  }
};

export default App;
