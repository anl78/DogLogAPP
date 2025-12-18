
import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { DogEvent, SupabaseSettings, HealthStatus, AIAnalysisResult, RecordType, Pet, CollaboratorPermissions, NotionSettings } from './types';
import { saveEventToSupabase, testSupabaseConnection, searchEvents, deleteEvent, getUserPets, createPet, getCollaboratorPermissions, checkUnreadMessages } from './services/supabaseService';
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
import DashboardView from './components/DashboardView'; // Imported
import Auth from './components/Auth';
import ImageViewer from './components/ImageViewer';

const PAGE_SIZE = 25;

const DEFAULT_OWNER_PERMISSIONS: CollaboratorPermissions = {
    can_create: true,
    can_edit: 'all',
    can_delete: 'all',
    visible_types: []
};

// Declare globals injected by Vite define
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

// Fallbacks for dev environment where Vite define might fail
const FALLBACK_URL = "https://nvnmlausdsexvmcrnzxc.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bm1sYXVzZHNleHZtY3JuenhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTE5MjAsImV4cCI6MjA3OTIyNzkyMH0.i2ddyT9GvT70bkIHqSW_whf9UMqqkNnAWawC4k91W0c";

const App: React.FC = () => {
  // --- Environment Variables (Injected Globals) ---
  // @ts-ignore
  let envSupabaseUrl = typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '';
  // @ts-ignore
  let envSupabaseKey = typeof __SUPABASE_KEY__ !== 'undefined' ? __SUPABASE_KEY__ : '';

  // Apply Fallback if variables are missing or empty
  if (!envSupabaseUrl || envSupabaseUrl === '""') envSupabaseUrl = FALLBACK_URL;
  if (!envSupabaseKey || envSupabaseKey === '""') envSupabaseKey = FALLBACK_KEY;
  
  // --- State ---
  const [settings] = useState<SupabaseSettings>({ 
      supabaseUrl: envSupabaseUrl, 
      supabaseKey: envSupabaseKey 
  });

  const [notionSettings, setNotionSettings] = useState<NotionSettings>({
      apiKey: localStorage.getItem('NOTION_API_KEY') || '',
      databaseId: localStorage.getItem('NOTION_DB_ID') || ''
  });

  // Save Notion settings to local storage
  useEffect(() => {
    localStorage.setItem('NOTION_API_KEY', notionSettings.apiKey);
    localStorage.setItem('NOTION_DB_ID', notionSettings.databaseId);
  }, [notionSettings]);

  const [session, setSession] = useState<any>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [currentPet, setCurrentPet] = useState<Pet | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Permissions State
  const [permissions, setPermissions] = useState<CollaboratorPermissions>(DEFAULT_OWNER_PERMISSIONS);

  // State for creating pet inside App (fallback)
  const [newPetName, setNewPetName] = useState('');
  const [creatingPet, setCreatingPet] = useState(false);

  // Added 'dashboard' to the view union type
  const [view, setView] = useState<'home' | 'board' | 'add' | 'settings' | 'consult' | 'stats' | 'dashboard'>('home');
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);

  // --- Auth & Pet Loading Effect ---
  useEffect(() => {
    if (settings.supabaseUrl && settings.supabaseKey) {
        try {
            const client = createClient(settings.supabaseUrl, settings.supabaseKey);
            
            // Initial Session Check
            client.auth.getSession().then(({ data: { session } }) => {
                setSession(session);
                if (!session) {
                    setAuthLoading(false);
                }
            });

            // Listen for changes
            const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
                setSession(session);
                if (!session) {
                    setPets([]);
                    setCurrentPet(null);
                    setEvents([]);
                }
            });

            return () => subscription.unsubscribe();
        } catch (e) {
            console.error("Auth init failed", e);
            setAuthLoading(false);
        }
    } else {
        setAuthLoading(false);
    }
  }, [settings]);

  // Load Pets when Session is active
  useEffect(() => {
    const loadPets = async () => {
        if (session && settings.supabaseUrl) {
            try {
                // PASS ACCESS TOKEN
                const userPets = await getUserPets(settings, session.access_token);
                setPets(userPets);
                if (userPets.length > 0) {
                    setCurrentPet(userPets[0]);
                }
            } catch (e) {
                console.error("Failed to load pets", e);
            } finally {
                setAuthLoading(false);
            }
        }
    };

    if (session) {
        loadPets();
    }
  }, [session, settings]);

  // --- Load Permissions when Pet Changes ---
  useEffect(() => {
      const loadPerms = async () => {
          if (!currentPet || !session?.user) return;
          
          // Check if owner
          if (currentPet.owner_id === session.user.id) {
              setPermissions(DEFAULT_OWNER_PERMISSIONS);
              return;
          }
          
          // If collaborator, fetch perms
          const perms = await getCollaboratorPermissions(settings, currentPet.id, session.user.id, session.access_token);
          if (perms) {
              setPermissions(perms);
          }
      };
      
      loadPerms();
  }, [currentPet, session]);

  // --- Poll for Unread Messages ---
  useEffect(() => {
      if (!currentPet || !session || view === 'board') {
          if (view === 'board') setHasUnreadMessages(false);
          return;
      }

      const check = async () => {
          const unread = await checkUnreadMessages(settings, currentPet.id, session.access_token);
          setHasUnreadMessages(unread);
      };

      check(); // Initial check
      const interval = setInterval(check, 30000); // Poll every 30s
      return () => clearInterval(interval);
  }, [currentPet, session, view]);


  // --- Event & Pagination State ---
  const [events, setEvents] = useState<DogEvent[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(false); 

  // --- Filter State ---
  const [showFilters, setShowFilters] = useState(false);
  const [filterConfig, setFilterConfig] = useState<{
    startDate: string;
    endDate: string;
    recordType: RecordType | '';
    searchTitle: string;
  }>({
    startDate: '',
    endDate: '',
    recordType: '',
    searchTitle: ''
  });

  // Add/Edit State
  const [aiProcessing, setAiProcessing] = useState(false);
  const [draftEvent, setDraftEvent] = useState<Partial<DogEvent> | undefined>(undefined);
  const [inputMethod, setInputMethod] = useState<'menu' | 'voice' | 'chat' | 'manual'>('menu');
  const [chatInput, setChatInput] = useState('');


  // --- CORE FETCH LOGIC (Requires Pet) ---

  const fetchEvents = async (reset: boolean = false) => {
    if (!currentPet) return; // Cannot fetch without context
    if (!settings.supabaseUrl || !settings.supabaseKey) return;

    setIsSyncing(true);
    try {
        const currentPage = reset ? 0 : page;
        
        // PASS ACCESS TOKEN
        const newBatch = await searchEvents({
            startDate: filterConfig.startDate || undefined,
            endDate: filterConfig.endDate || undefined,
            recordType: filterConfig.recordType || undefined,
            searchTitle: filterConfig.searchTitle || undefined,
            page: currentPage,
            pageSize: PAGE_SIZE,
            petId: currentPet.id
        }, settings, session?.access_token);

        if (reset) {
            setEvents(newBatch);
            setPage(1); 
        } else {
            setEvents(prev => [...prev, ...newBatch]);
            setPage(prev => prev + 1);
        }

        setHasMore(newBatch.length === PAGE_SIZE);

    } catch (error) {
        console.error("Fetch failed", error);
    } finally {
        setIsSyncing(false);
    }
  };

  // Trigger Fetch when Pet or Filters change
  useEffect(() => {
      if (session && currentPet) {
        const timeoutId = setTimeout(() => {
            fetchEvents(true); 
        }, 500);
        return () => clearTimeout(timeoutId);
      }
  }, [filterConfig, currentPet, session]);

  const handleLoadMore = () => {
      fetchEvents(false);
  };

  const handleLogout = async () => {
    if (settings.supabaseUrl && settings.supabaseKey) {
        const client = createClient(settings.supabaseUrl, settings.supabaseKey);
        await client.auth.signOut();
    }
  };

  const handleCreatePet = async () => {
      if (!newPetName.trim() || !session?.user?.id) return;
      setCreatingPet(true);
      try {
          // PASS ACCESS TOKEN
          const newPet = await createPet(settings, newPetName, session.user.id, session.access_token);
          if (newPet) {
              setPets([newPet]);
              setCurrentPet(newPet);
          }
      } catch (e: any) {
          alert("Error creando mascota: " + e.message);
      } finally {
          setCreatingPet(false);
      }
  };

  // --- Handlers ---

  const handleEventSubmit = async (event: DogEvent) => {
    if (!currentPet) {
        alert("Error: No hay mascota seleccionada.");
        return;
    }
    
    // Permission Check: Create
    if (!event.id && !permissions.can_create) {
        alert("No tienes permiso para crear eventos.");
        return;
    }
    
    setIsLoading(true);
    try {
        let eventToSave = { ...event };
        
        // Inject Relations
        eventToSave.petId = currentPet.id;
        
        // Logic Fix: ONLY assign userId if it's a NEW event (missing ID).
        // If updating (has ID), we keep existing userId to avoid ownership theft.
        if ((!eventToSave.id || !eventToSave.userId) && session?.user?.id) {
            eventToSave.userId = session.user.id;
        }

        // 1. SAVE TO SUPABASE
        if (settings.supabaseUrl && settings.supabaseKey) {
            // PASS ACCESS TOKEN
            const result = await saveEventToSupabase(eventToSave, settings, session?.access_token);
            if (result.success) {
                eventToSave.synced = true;
                if (result.newId) eventToSave.id = result.newId;
                if (result.photoUrl) eventToSave.photoUrl = result.photoUrl;

                // 2. SAVE TO NOTION (If configured and sync successful)
                if (notionSettings.apiKey && notionSettings.databaseId) {
                    sendToNotion(eventToSave, notionSettings).catch(e => {
                        console.error("Error syncing to Notion:", e);
                        // Optional: Toast error
                    });
                }
            } else {
                throw new Error(result.error);
            }
        }

        // Optimistic UI update
        setEvents(prev => {
            const index = prev.findIndex(e => e.id === eventToSave.id);
            if (index >= 0) {
                const updated = [...prev];
                updated[index] = eventToSave;
                return updated;
            } else {
                return [eventToSave, ...prev];
            }
        });
        
        setDraftEvent(undefined);
        setInputMethod('menu');
        setView('home');
        fetchEvents(true); // Ensure sort
    } catch (error: any) {
        alert(`Error: ${error.message}`);
    } finally {
        setIsLoading(false);
    }
  };

  const handleDeleteEvent = async (event: DogEvent) => {
      setIsLoading(true);
      try {
          if (settings.supabaseUrl && settings.supabaseKey) {
              // PASS ACCESS TOKEN
              const result = await deleteEvent(event.id, event.photoUrl, settings, session?.access_token);
              if (!result.success) throw new Error(result.error);
          }
          setEvents(prev => prev.filter(e => e.id !== event.id));
          setDraftEvent(undefined);
          setInputMethod('menu');
          setView('home');
      } catch (e: any) {
          alert(`Error al eliminar: ${e.message}`);
      } finally {
          setIsLoading(false);
      }
  };

  // --- Helpers ---
  const getCurrentTime = () => {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  const getExifDate = (file: File): Promise<Date | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const view = new DataView(e.target?.result as ArrayBuffer);
          if (view.getUint16(0, false) !== 0xFFD8) return resolve(null); 
          const length = view.byteLength;
          let offset = 2;
          while (offset < length) {
            if (view.getUint16(offset, false) === 0xFFE1) {
               if (view.getUint32(offset + 4, false) !== 0x45786966) return resolve(null);
               const littleEndian = view.getUint16(offset + 10, false) === 0x4949;
               const tiffStart = offset + 10;
               const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
               let dirStart = tiffStart + ifdOffset;
               let entries = view.getUint16(dirStart, littleEndian);
               let dateTime = null;
               let exifSubIfdOffset = 0;
               for (let i = 0; i < entries; i++) {
                   const entryOffset = dirStart + 2 + (i * 12);
                   const tag = view.getUint16(entryOffset, littleEndian);
                   if (tag === 0x0132) dateTime = getTagVal(view, entryOffset, tiffStart, littleEndian);
                   if (tag === 0x8769) exifSubIfdOffset = view.getUint32(entryOffset + 8, littleEndian);
               }
               if (exifSubIfdOffset > 0) {
                   dirStart = tiffStart + exifSubIfdOffset;
                   entries = view.getUint16(dirStart, littleEndian);
                   for (let i = 0; i < entries; i++) {
                       const entryOffset = dirStart + 2 + (i * 12);
                       const tag = view.getUint16(entryOffset, littleEndian);
                       if (tag === 0x9003 || tag === 0x9004) { dateTime = getTagVal(view, entryOffset, tiffStart, littleEndian); break; }
                   }
               }
               if (dateTime) {
                   const [d, t] = dateTime.split(" ");
                   const [y, m, day] = d.split(":");
                   const [h, min, s] = t.split(":");
                   const dt = new Date(parseInt(y), parseInt(m)-1, parseInt(day), parseInt(h), parseInt(min), parseInt(s));
                   if (!isNaN(dt.getTime())) return resolve(dt);
               }
               return resolve(null);
            }
            offset += 2 + view.getUint16(offset + 2, false);
          }
        } catch (e) { resolve(null); }
        resolve(null);
      };
      reader.readAsArrayBuffer(file.slice(0, 128 * 1024)); 
    });
  };
  
  const getTagVal = (view: DataView, offset: number, tiffStart: number, le: boolean) => {
      const type = view.getUint16(offset + 2, le);
      const count = view.getUint32(offset + 4, le);
      if (type === 2) {
          const valOffset = view.getUint32(offset + 8, le) + tiffStart;
          let str = '';
          for(let i=0; i<count-1; i++) str += String.fromCharCode(view.getUint8(valOffset + i));
          return str;
      }
      return null;
  };

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const cvs = document.createElement('canvas');
          const max = 800;
          const scale = max / img.width;
          cvs.width = scale < 1 ? max : img.width;
          cvs.height = scale < 1 ? img.height * scale : img.height;
          const ctx = cvs.getContext('2d');
          if (ctx) {
              ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
              resolve(cvs.toDataURL('image/jpeg', 0.7));
          } else resolve(e.target?.result as string);
        };
      };
    });
  };

  // --- AI HANDLERS (Updated with Settings & Token) ---
  
  const mapAnalysisToDraft = (result: AIAnalysisResult, photo?: string, file?: string, fileName?: string, dateOverride?: Date | null) => {
      let d = result.date || new Date().toISOString().split('T')[0];
      let t = result.time || getCurrentTime();
      if (dateOverride) {
          d = `${dateOverride.getFullYear()}-${String(dateOverride.getMonth()+1).padStart(2,'0')}-${String(dateOverride.getDate()).padStart(2,'0')}`;
          t = `${String(dateOverride.getHours()).padStart(2,'0')}:${String(dateOverride.getMinutes()).padStart(2,'0')}`;
      }
      setDraftEvent({
          title: result.title, recordType: result.recordType, healthStatus: result.healthStatus,
          description: result.description, weight: result.weight, date: d, time: t,
          photoBase64: photo, fileBase64: file, fileName: fileName, poopScore: result.poopScore
      });
  };

  const handleAudioCaptured = async (b64: string) => {
      setAiProcessing(true);
      try { 
          const r = await analyzeAudio(b64, settings, session?.access_token); 
          mapAnalysisToDraft(r); 
          setInputMethod('manual'); 
      } 
      catch (e: any) { alert(`Error audio: ${e.message}`); } 
      finally { setAiProcessing(false); }
  };

  const handleChatSubmit = async () => {
      if(!chatInput.trim()) return; setAiProcessing(true);
      try { 
          const r = await analyzeInput(chatInput, [], settings, session?.access_token); 
          mapAnalysisToDraft(r); 
          setInputMethod('manual'); 
          setChatInput(''); 
      }
      catch (e: any) { alert(`Error texto: ${e.message}`); } 
      finally { setAiProcessing(false); }
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]; if(!f) return; setAiProcessing(true);
      try { 
          const date = await getExifDate(f);
          const b64 = await resizeImage(f); 
          // Pass settings and token
          const r = await analyzeImage(b64, settings, session?.access_token); 
          mapAnalysisToDraft(r, b64, undefined, undefined, date); 
          setInputMethod('manual'); 
      }
      catch (e: any) { alert(`Error imagen: ${e.message}`); } 
      finally { setAiProcessing(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]; if(!f) return; setAiProcessing(true);
      try {
          let b64 = ''; let mime = f.type; let date = null;
          if(f.type.startsWith('image/')) { date = await getExifDate(f); b64 = await resizeImage(f); mime = 'image/jpeg'; }
          else { b64 = await new Promise<string>(r => { const reader=new FileReader(); reader.onload=()=>r(reader.result as string); reader.readAsDataURL(f); }); }
          // Pass settings and token
          const res = await analyzeFile(b64, mime, settings, session?.access_token);
          mapAnalysisToDraft(res, mime === 'image/jpeg' ? b64 : undefined, mime !== 'image/jpeg' ? b64 : undefined, f.name, date);
          setInputMethod('manual');
      } catch (e: any) { alert(`Error archivo: ${e.message}`); } 
      finally { setAiProcessing(false); }
  };

  // --- PERMISSION HELPERS FOR UI ---
  const isTypeVisible = (type: RecordType) => {
      if (!permissions.visible_types || permissions.visible_types.length === 0) return true;
      return permissions.visible_types.includes(type);
  };
  
  const calculateCanEdit = (event?: Partial<DogEvent>) => {
      if (!event || !event.id) return permissions.can_create; // New event logic delegated to can_create
      if (permissions.can_edit === 'all') return true;
      // If event.userId is missing (legacy), assume can't edit unless admin, OR fix data.
      if (permissions.can_edit === 'own') return event.userId === session?.user?.id;
      return false;
  };

  const calculateCanDelete = (event?: Partial<DogEvent>) => {
      if (!event || !event.id) return false;
      if (permissions.can_delete === 'all') return true;
      if (permissions.can_delete === 'own') return event.userId === session?.user?.id;
      return false;
  };

  // --- RENDER SECTIONS ---
  
  const renderHome = () => (
    <div className="flex flex-col h-full bg-slate-50">
        <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">
                    {currentPet ? currentPet.name : 'DogLog 🐾'}
                </h1>
                <p className="text-xs text-slate-500">{isSyncing ? 'Sincronizando...' : 'Online'}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => fetchEvents(true)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">🔄</button>
                <button onClick={() => setShowFilters(!showFilters)} className={`p-2 rounded-full ${showFilters ? 'bg-blue-100 text-blue-600' : 'bg-slate-100'}`}><Icons.Filter className="w-5 h-5"/></button>
              </div>
            </div>
            {showFilters && (
                <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
                    <input type="date" value={filterConfig.startDate} onChange={e=>setFilterConfig({...filterConfig,startDate:e.target.value})} className="p-2 rounded bg-slate-50 border"/>
                    <input type="date" value={filterConfig.endDate} onChange={e=>setFilterConfig({...filterConfig,endDate:e.target.value})} className="p-2 rounded bg-slate-50 border"/>
                    <select value={filterConfig.recordType} onChange={e=>setFilterConfig({...filterConfig,recordType:e.target.value as RecordType})} className="p-2 rounded bg-slate-50 border"><option value="">Todos</option>{Object.values(RecordType).map(t=><option key={t} value={t}>{t}</option>)}</select>
                    <input type="text" placeholder="Buscar..." value={filterConfig.searchTitle} onChange={e=>setFilterConfig({...filterConfig,searchTitle:e.target.value})} className="p-2 rounded bg-slate-50 border"/>
                </div>
            )}
        </header>
        <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4 no-scrollbar">
            {events.filter(ev => isTypeVisible(ev.recordType)).map(ev => (
                <div key={ev.id} onClick={() => { setDraftEvent(ev); setInputMethod('manual'); setView('add'); }} className="bg-white rounded-2xl p-4 shadow-sm border relative cursor-pointer active:scale-[0.98]">
                    <span className="absolute top-0 right-0 bg-slate-100 px-3 py-1 rounded-bl-xl text-xs font-bold">{ev.recordType}</span>
                    <h3 className="font-bold text-lg mb-2 pr-12">{ev.title}</h3>
                    <div className="flex flex-wrap gap-2 mb-3 text-xs">
                        {ev.healthStatus && <span className={`px-2 py-1 rounded-full border ${HEALTH_STATUS_COLORS[ev.healthStatus]}`}>{ev.healthStatus}</span>}
                        {/* SCORE BADGE */}
                        {ev.recordType === RecordType.POOP && ev.poopScore && (
                            <span className={`px-2 py-1 rounded-full border font-bold ${getPoopScoreColor(ev.poopScore)}`}>
                                Score: {ev.poopScore}
                            </span>
                        )}
                        <span className="px-2 py-1 bg-slate-50 border rounded-full">{ev.date} · {ev.time}</span>
                    </div>
                    {(ev.photoBase64 || ev.photoUrl) && (
                        <img 
                            src={ev.photoBase64 || ev.photoUrl} 
                            className="w-full h-48 object-cover rounded-lg mb-3 bg-slate-100"
                            onClick={(e) => {
                                e.stopPropagation(); // Stop opening edit view
                                setFullScreenImage(ev.photoBase64 || ev.photoUrl || null);
                            }}
                        />
                    )}
                    <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-wrap">{ev.description}</p>
                </div>
            ))}
            {hasMore && <button onClick={handleLoadMore} disabled={isSyncing} className="w-full py-3 text-sm text-slate-500 font-medium">Cargar más...</button>}
        </div>
    </div>
  );

  const renderAdd = () => {
      if(aiProcessing) return <div className="h-full flex items-center justify-center"><div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>;
      if(inputMethod==='menu') return (
          <div className="h-full px-6 pt-6 bg-slate-50 overflow-y-auto pb-24 space-y-4">
              <h2 className="text-2xl font-bold text-slate-800">Nuevo Evento</h2>
              {!permissions.can_create ? (
                  <div className="p-4 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-center">
                      No tienes permiso para crear eventos.
                  </div>
              ) : (
                  <>
                  {[
                    {m:'voice',i:<Icons.Mic className="w-6"/>,t:'Voz',c:'bg-blue-100 text-blue-600'},
                    {m:'chat',i:<Icons.MessageSquare className="w-6"/>,t:'Chat',c:'bg-purple-100 text-purple-600'},
                    {m:'manual',i:<Icons.Plus className="w-6"/>,t:'Manual',c:'bg-emerald-100 text-emerald-600'}
                  ].map(o=>(<button key={o.m} onClick={()=>setInputMethod(o.m as any)} className="flex items-center p-5 bg-white rounded-2xl border shadow-sm w-full"><div className={`w-12 h-12 rounded-full flex items-center justify-center mr-4 ${o.c}`}>{o.i}</div><span className="font-bold text-lg">{o.t}</span></button>))}
                  <label className="flex items-center p-5 bg-white rounded-2xl border shadow-sm w-full cursor-pointer"><div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mr-4"><Icons.ImagePlus className="w-6"/></div><span className="font-bold text-lg">Foto</span><input type="file" accept="image/*" className="hidden" onChange={handleImageCapture}/></label>
                  <label className="flex items-center p-5 bg-white rounded-2xl border shadow-sm w-full cursor-pointer"><div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mr-4"><Icons.Upload className="w-6"/></div><span className="font-bold text-lg">Archivo</span><input type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload}/></label>
                  </>
              )}
          </div>
      );
      if(inputMethod==='voice') return <div className="h-full flex flex-col items-center pt-10"><h2 className="text-2xl font-bold mb-10">Dictado</h2><AudioRecorder onAudioCaptured={handleAudioCaptured} isProcessing={aiProcessing}/><button onClick={()=>setInputMethod('menu')} className="mt-10 underline">Cancelar</button></div>;
      if(inputMethod==='chat') return <div className="h-full px-6 pt-6"><h2 className="text-2xl font-bold mb-4">Chat</h2><textarea className="w-full p-4 border rounded-xl mb-4 h-40" value={chatInput} onChange={e=>setChatInput(e.target.value)}/><button onClick={handleChatSubmit} className="w-full py-3 bg-purple-600 text-white rounded-xl">Procesar</button><button onClick={()=>setInputMethod('menu')} className="mt-4 w-full text-center underline">Cancelar</button></div>;
      
      return (
        <div className="flex flex-col h-full bg-slate-50">
            <header className="bg-white px-6 py-4 border-b flex items-center gap-3"><button onClick={()=>setInputMethod('menu')}>🔙</button><h2 className="font-bold">Editar</h2></header>
            <div className="flex-1 overflow-y-auto p-4">
                <EventForm 
                    initialData={draftEvent} 
                    onSubmit={handleEventSubmit} 
                    onCancel={()=>setView('home')} 
                    onDelete={draftEvent?.id?()=>handleDeleteEvent(draftEvent as DogEvent):undefined}
                    canEdit={calculateCanEdit(draftEvent)}
                    canDelete={calculateCanDelete(draftEvent)}
                />
            </div>
        </div>
      );
  };

  return (
    <>
      {/* Auth Screen */}
      {authLoading ? (
         <div className="h-full flex items-center justify-center bg-slate-50"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
      ) : !session ? (
         <Auth settings={settings} onLoginSuccess={() => fetchEvents(true)} />
      ) : (
         /* Main App */
         <div className="h-full w-full relative bg-slate-50">
            {view === 'home' && renderHome()}
            {view === 'board' && currentPet && (
                <BoardView 
                    settings={settings} 
                    petId={currentPet.id} 
                    currentUserId={session.user.id} 
                    accessToken={session.access_token}
                />
            )}
            {view === 'add' && renderAdd()}
            {view === 'stats' && currentPet && (
                 <StatsView settings={settings} petId={currentPet.id} accessToken={session.access_token} />
            )}
            {/* Added Dashboard View */}
            {view === 'dashboard' && currentPet && (
                <DashboardView settings={settings} petId={currentPet.id} accessToken={session.access_token} />
            )}
            {view === 'consult' && (
                 <AIQueryView 
                    settings={settings} 
                    onEventClick={(ev) => { setDraftEvent(ev); setInputMethod('manual'); setView('add'); }}
                    currentPetId={currentPet?.id || ''}
                    accessToken={session.access_token}
                 />
            )}
            {view === 'settings' && (
                 <div className="p-6 overflow-y-auto h-full pb-24">
                     <h2 className="text-2xl font-bold mb-6">Ajustes</h2>
                     
                     {/* Pet Selector */}
                     <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Mascota Activa</label>
                        <select 
                            value={currentPet?.id || ''} 
                            onChange={(e) => {
                                const selected = pets.find(p => p.id === e.target.value);
                                if (selected) {
                                    setCurrentPet(selected);
                                    setEvents([]); // Clear old events
                                }
                            }}
                            className="w-full p-3 rounded-xl border border-slate-200 bg-white"
                        >
                            {pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                     </div>

                     {/* Create Pet Fallback */}
                     <div className="mb-6 p-4 bg-white rounded-xl border border-slate-200">
                        <h3 className="font-bold text-sm mb-2">Crear nueva mascota</h3>
                        <div className="flex gap-2">
                            <input 
                                type="text" 
                                placeholder="Nombre..." 
                                value={newPetName} 
                                onChange={e => setNewPetName(e.target.value)}
                                className="flex-1 p-2 border rounded-lg"
                            />
                            <button 
                                onClick={handleCreatePet} 
                                disabled={creatingPet || !newPetName.trim()}
                                className="bg-blue-600 text-white px-4 rounded-lg font-bold text-sm disabled:opacity-50"
                            >
                                +
                            </button>
                        </div>
                     </div>

                     {/* Team Manager */}
                     {currentPet && session?.user && (
                         <TeamManager 
                            settings={settings} 
                            currentPet={currentPet} 
                            currentUserId={session.user.id} 
                            accessToken={session.access_token}
                         />
                     )}

                     {/* Migration & Tools */}
                     <MigrationPanel 
                        supabaseSettings={settings} 
                        currentPet={currentPet} 
                        currentUser={session?.user} 
                        accessToken={session.access_token}
                     />
                     
                     <div className="mt-10 border-t pt-6">
                        <button onClick={handleLogout} className="w-full py-3 bg-red-100 text-red-600 rounded-xl font-bold">Cerrar Sesión</button>
                        <p className="text-center text-xs text-slate-400 mt-4">v4.0.0 - Supabase + Gemini + Notion</p>
                     </div>
                 </div>
            )}
            
            <Navbar currentView={view} setView={setView} hasUnread={hasUnreadMessages} />
            
            {/* Full Screen Image Modal */}
            <ImageViewer src={fullScreenImage} onClose={() => setFullScreenImage(null)} />
         </div>
      )}
    </>
  );
};

export default App;
