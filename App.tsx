import React, { useState, useEffect } from 'react';
import { DogEvent, SupabaseSettings, HealthStatus, AIAnalysisResult, RecordType } from './types';
import { saveEventToSupabase, testSupabaseConnection } from './services/supabaseService';
import { analyzeAudio, analyzeInput, analyzeImage, analyzeFile } from './services/geminiService';
import { HEALTH_STATUS_COLORS, Icons } from './constants';
import Navbar from './components/Navbar';
import EventForm from './components/EventForm';
import AudioRecorder from './components/AudioRecorder';
import AIQueryView from './components/AIQueryView';
import MigrationPanel from './components/MigrationPanel';

const App: React.FC = () => {
  // --- Environment Variables Check ---
  // Safely access import.meta.env to avoid crashes if it's undefined
  const meta = import.meta as any;
  const envVars = meta.env || {};
  const envSupabaseUrl = envVars.VITE_SUPABASE_URL;
  const envSupabaseKey = envVars.VITE_SUPABASE_KEY;
  const isEnvConfigured = !!(envSupabaseUrl && envSupabaseKey);

  // --- State ---
  const [view, setView] = useState<'home' | 'add' | 'settings' | 'consult'>('home');
  const [events, setEvents] = useState<DogEvent[]>([]);
  
  // Initialize settings with priority: Env Vars > LocalStorage > Empty
  const [settings, setSettings] = useState<SupabaseSettings>(() => {
      if (isEnvConfigured) {
          return { supabaseUrl: envSupabaseUrl, supabaseKey: envSupabaseKey };
      }
      const savedSettings = localStorage.getItem('doglog_settings');
      if (savedSettings) {
          try {
              return JSON.parse(savedSettings);
          } catch (e) {
              console.error("Error loading settings", e);
          }
      }
      return { supabaseUrl: '', supabaseKey: '' };
  });

  const [isLoading, setIsLoading] = useState(false);
  
  // Settings Validation State
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [showSqlScript, setShowSqlScript] = useState(false);
  
  // State for Add/Edit Flow
  const [aiProcessing, setAiProcessing] = useState(false);
  const [draftEvent, setDraftEvent] = useState<Partial<DogEvent> | undefined>(undefined);
  const [inputMethod, setInputMethod] = useState<'menu' | 'voice' | 'chat' | 'manual'>('menu');
  const [chatInput, setChatInput] = useState('');

  // --- Filter State ---
  const [showFilters, setShowFilters] = useState(false);
  const [visibleDays, setVisibleDays] = useState(3); // Default view: last 3 days
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

  // --- Effects ---
  useEffect(() => {
    const savedEvents = localStorage.getItem('doglog_events');
    if (savedEvents) {
        try {
            setEvents(JSON.parse(savedEvents));
        } catch (e) {
            console.error("Error loading events", e);
        }
    }
    // Note: We no longer load settings here because we do it in useState initialization
  }, []);

  useEffect(() => {
    try {
        localStorage.setItem('doglog_events', JSON.stringify(events));
    } catch (e: any) {
        console.error("Storage full or error", e);
        if (e.name === 'QuotaExceededError') {
             alert("⚠️ Almacenamiento lleno. Las fotos antiguas o este evento podrían no guardarse localmente.");
        }
    }
  }, [events]);

  // --- Handlers ---

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEnvConfigured) return; // Prevent saving if managed by env

    // Sanitize inputs
    const cleanUrl = settings.supabaseUrl.trim().replace(/\/$/, ""); // Remove trailing slash
    const cleanKey = settings.supabaseKey.trim();
    
    const newSettings = { supabaseUrl: cleanUrl, supabaseKey: cleanKey };
    setSettings(newSettings);
    localStorage.setItem('doglog_settings', JSON.stringify(newSettings));
    alert('Configuración guardada exitosamente.');
    setView('home');
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionMessage('');
    
    const result = await testSupabaseConnection(settings);
    
    if (result.success) {
        setConnectionStatus('success');
        setConnectionMessage(result.message || 'Conexión Correcta');
    } else {
        setConnectionStatus('error');
        setConnectionMessage(result.message || 'Error desconocido');
    }
    
    setIsTestingConnection(false);
  };

  const handleEditEvent = (event: DogEvent) => {
      setDraftEvent(event);
      setInputMethod('manual');
      setView('add');
  };

  const handleEventSubmit = async (event: DogEvent) => {
    setIsLoading(true);
    
    try {
        // Optimistic UI update (save locally first)
        let eventToSave = { ...event };
        let syncSuccess = false;
        
        // Try to sync with Supabase
        if (settings.supabaseUrl && settings.supabaseKey) {
            const result = await saveEventToSupabase(event, settings);
            if (result.success) {
                eventToSave.synced = true;
                // IMPORTANT: Update ID with real Cloud ID if provided
                if (result.newId) {
                    eventToSave.id = result.newId;
                }
                if (result.photoUrl) {
                    eventToSave.photoUrl = result.photoUrl;
                }
                syncSuccess = true;
            } else {
                console.warn("Supabase sync failed:", result.error);
                alert(`⚠️ ERROR AL GUARDAR EN SUPABASE:\n\n${result.error}\n\nEl evento se ha guardado LOCALMENTE.`);
            }
        } else {
            console.log("No Supabase settings configured, saving locally.");
        }

        // If editing existing event (check ID), update it. Otherwise add new.
        const existsIndex = events.findIndex(e => e.id === eventToSave.id);
        let newEvents;
        
        if (existsIndex >= 0) {
            newEvents = [...events];
            newEvents[existsIndex] = eventToSave;
        } else {
            newEvents = [eventToSave, ...events];
        }
        
        setEvents(newEvents);

        setDraftEvent(undefined);
        setInputMethod('menu');
        setView('home');
    } catch (error: any) {
        console.error("Critical error in submit handler:", error);
        alert(`Error inesperado al guardar: ${error.message}`);
    } finally {
        setIsLoading(false);
    }
  };

  // Helper for 24h time format HH:mm (Strictly for DB compatibility)
  const getCurrentTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
  };

  // --- ROBUST EXIF PARSER ---
  // Navigates through IFD0 -> Exif SubIFD to find DateTimeOriginal (0x9003)
  const getExifDate = (file: File): Promise<Date | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const view = new DataView(e.target?.result as ArrayBuffer);
          if (view.getUint16(0, false) !== 0xFFD8) return resolve(null); // Not JPEG

          const length = view.byteLength;
          let offset = 2;

          while (offset < length) {
            // Look for APP1 (Exif)
            if (view.getUint16(offset, false) === 0xFFE1) {
               // Check "Exif" string signature
               if (view.getUint32(offset + 4, false) !== 0x45786966) return resolve(null);

               const littleEndian = view.getUint16(offset + 10, false) === 0x4949;
               const tiffStart = offset + 10;

               // Helper to read string tags
               const readTagValue = (tagOffset: number) => {
                   const type = view.getUint16(tagOffset + 2, littleEndian);
                   const count = view.getUint32(tagOffset + 4, littleEndian);
                   if (type === 2) { // ASCII String
                       const valOffset = view.getUint32(tagOffset + 8, littleEndian) + tiffStart;
                       let str = '';
                       // count-1 because strings are null-terminated in EXIF
                       for(let i=0; i<count-1; i++) str += String.fromCharCode(view.getUint8(valOffset + i));
                       return str;
                   }
                   return null;
               };

               // Read IFD0 (Main Image)
               const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
               let dirStart = tiffStart + ifdOffset;
               let entries = view.getUint16(dirStart, littleEndian);

               let dateTime = null;
               let exifSubIfdOffset = 0;

               // Scan IFD0 tags
               for (let i = 0; i < entries; i++) {
                   const entryOffset = dirStart + 2 + (i * 12);
                   const tag = view.getUint16(entryOffset, littleEndian);
                   
                   // 0x0132 is "DateTime" (Modification Date) - Fallback
                   if (tag === 0x0132) {
                       dateTime = readTagValue(entryOffset);
                   }
                   // 0x8769 is "Exif Offset" - Pointer to SubIFD where Original Date lives
                   if (tag === 0x8769) {
                       exifSubIfdOffset = view.getUint32(entryOffset + 8, littleEndian);
                   }
               }

               // If we found the Exif SubIFD, go there (Priority)
               if (exifSubIfdOffset > 0) {
                   dirStart = tiffStart + exifSubIfdOffset;
                   entries = view.getUint16(dirStart, littleEndian);
                   for (let i = 0; i < entries; i++) {
                       const entryOffset = dirStart + 2 + (i * 12);
                       const tag = view.getUint16(entryOffset, littleEndian);
                       
                       // 0x9003: DateTimeOriginal (When photo was taken)
                       // 0x9004: CreateDate (Digitized)
                       if (tag === 0x9003 || tag === 0x9004) { 
                           const dt = readTagValue(entryOffset);
                           if (dt) { 
                               dateTime = dt; 
                               break; // Found strict capture time, stop searching
                           }
                       }
                   }
               }

               if (dateTime) {
                   // Parse format: "YYYY:MM:DD HH:MM:SS"
                   const parts = dateTime.split(" ");
                   if (parts.length >= 2) {
                       const [d, t] = parts;
                       const [yyyy, mm, dd] = d.split(":");
                       const [hh, min, ss] = t.split(":");
                       const date = new Date(
                           parseInt(yyyy), parseInt(mm)-1, parseInt(dd), 
                           parseInt(hh), parseInt(min), parseInt(ss)
                       );
                       if (!isNaN(date.getTime())) {
                           resolve(date);
                           return;
                       }
                   }
               }
               resolve(null);
               return;
            }
            // Move to next marker
            offset += 2 + view.getUint16(offset + 2, false);
          }
        } catch (e) {
          console.warn("EXIF Parsing error", e);
          resolve(null);
        }
        resolve(null);
      };
      // Read 128KB to ensure we catch headers even in files with large thumbnails
      reader.readAsArrayBuffer(file.slice(0, 128 * 1024)); 
    });
  };

  // Image Resizing Utility
  const resizeImage = (file: File): Promise<string> => {
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
          if (!ctx) {
            resolve(event.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7)); 
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const mapAnalysisToDraft = (
      result: AIAnalysisResult, 
      photoBase64?: string, 
      fileBase64?: string, 
      fileName?: string,
      overrideDate?: Date | null
  ) => {
      let finalDate = result.date;
      let finalTime = result.time;

      // Priority: 1. Override Date (EXIF) 2. AI Extracted Date 3. Current Date
      if (overrideDate) {
          const yyyy = overrideDate.getFullYear();
          const mm = String(overrideDate.getMonth() + 1).padStart(2, '0');
          const dd = String(overrideDate.getDate()).padStart(2, '0');
          finalDate = `${yyyy}-${mm}-${dd}`;
          
          const hh = String(overrideDate.getHours()).padStart(2, '0');
          const min = String(overrideDate.getMinutes()).padStart(2, '0');
          finalTime = `${hh}:${min}`;
          console.log(`Using EXIF Date: ${finalDate} ${finalTime}`);
      }

      if (!finalDate) finalDate = new Date().toISOString().split('T')[0];
      if (!finalTime) finalTime = getCurrentTime();

      setDraftEvent({
          title: result.title,
          recordType: result.recordType,
          healthStatus: result.healthStatus,
          description: result.description,
          weight: result.weight,
          date: finalDate,
          time: finalTime, 
          photoBase64: photoBase64, 
          fileBase64: fileBase64, 
          fileName: fileName
      });
  };

  const handleAudioCaptured = async (base64Audio: string) => {
    setAiProcessing(true);
    try {
        const result: AIAnalysisResult = await analyzeAudio(base64Audio);
        mapAnalysisToDraft(result);
        setInputMethod('manual'); 
    } catch (error) {
        console.error(error);
        alert("Error analizando audio. Intenta de nuevo.");
    } finally {
        setAiProcessing(false);
    }
  };

  const handleChatSubmit = async () => {
      if (!chatInput.trim()) return;
      setAiProcessing(true);
      try {
          const result: AIAnalysisResult = await analyzeInput(chatInput);
          mapAnalysisToDraft(result);
          setChatInput('');
          setInputMethod('manual');
      } catch (error) {
          console.error(error);
          alert("Error analizando el texto. Intenta de nuevo.");
      } finally {
          setAiProcessing(false);
      }
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAiProcessing(true);
    try {
        const compressedBase64 = await resizeImage(file);
        const result = await analyzeImage(compressedBase64);
        mapAnalysisToDraft(result, compressedBase64);
        setInputMethod('manual');
    } catch (error) {
        console.error(error);
        alert("Error analizando la imagen. Inténtalo de nuevo.");
    } finally {
        setAiProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setAiProcessing(true);
      try {
          let base64Data = '';
          let mimeType = file.type;
          let exifDate: Date | null = null;
          
          if (file.type.startsWith('image/')) {
              // Try to extract EXIF before resizing (resizing strips metadata)
              try {
                 exifDate = await getExifDate(file);
                 if (exifDate) {
                     console.log("EXIF Date Found Successfully:", exifDate);
                 } else {
                     console.log("No EXIF Date found in image.");
                 }
              } catch (e) {
                 console.log("Could not read EXIF", e);
              }

              base64Data = await resizeImage(file);
              mimeType = 'image/jpeg'; 
          } else {
              base64Data = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
              });
          }

          const result = await analyzeFile(base64Data, mimeType);

          if (file.type.startsWith('image/')) {
              mapAnalysisToDraft(result, base64Data, undefined, undefined, exifDate); 
          } else {
              mapAnalysisToDraft(result, undefined, base64Data, file.name); 
          }
          
          setInputMethod('manual');

      } catch (error) {
          console.error("File upload error", error);
          alert("Error analizando el archivo. Asegúrate de que no sea demasiado grande.");
      } finally {
          setAiProcessing(false);
      }
  };

  const SQL_SCRIPT = `
-- SCRIPT V9 (RELACIONAL Y ROBUSTO)
-- Copia y Ejecuta en Supabase SQL Editor

-- 1. Limpieza Total
drop table if exists public.events cascade;
drop table if exists public.record_types cascade;
drop table if exists public.health_statuses cascade;

-- 2. Crear Tablas Maestras (Diccionarios)
-- Usamos el texto como ID para simplificar la app
create table public.record_types (
  name text primary key
);

create table public.health_statuses (
  name text primary key
);

-- 3. Insertar Valores (Deben coincidir EXACTAMENTE con la App)
insert into public.record_types (name) values 
  ('Caca'), ('Comida'), ('Medicamento'), ('Veterinario'), 
  ('Comportamiento'), ('Resumen'), ('Analiticas'), 
  ('Vómito'), ('Coche'), ('Incidente');

insert into public.health_statuses (name) values 
  ('Normal'), ('En observación'), ('Tratamiento'), 
  ('Preocupante'), ('Urgente'), ('En recuperación');

-- 4. Crear Tabla Eventos (Con Relaciones)
create table public.events (
  id uuid not null default gen_random_uuid(),
  title text null,
  
  -- Relación Obligatoria
  record_type text null references public.record_types(name),
  
  date date null,
  time time null,
  
  -- Relación Opcional
  health_status text null references public.health_statuses(name),
  
  weight numeric null,
  description text null,
  photo_url text null,
  file_url text null,
  created_at timestamp with time zone not null default now(),
  
  constraint events_pkey primary key (id)
);

-- 5. DESACTIVAR SEGURIDAD (RLS) para evitar problemas de permisos
alter table public.events disable row level security;
alter table public.record_types disable row level security;
alter table public.health_statuses disable row level security;

-- 6. Configurar Storage (Fotos)
insert into storage.buckets (id, name, public)
values ('dog_photos', 'dog_photos', true)
on conflict (id) do nothing;

drop policy if exists "Fotos Publicas" on storage.objects;
create policy "Fotos Publicas" on storage.objects
  for all to anon using (bucket_id = 'dog_photos') with check (bucket_id = 'dog_photos');
  `;

  // --- Views ---

  const renderHome = () => {
    // 1. Determine which events to show
    let filteredEvents = [...events];
    const hasActiveFilters = !!(filterConfig.startDate || filterConfig.endDate || filterConfig.recordType || filterConfig.searchTitle);

    if (hasActiveFilters) {
        // --- Custom Filter Logic ---
        filteredEvents = filteredEvents.filter(e => {
            // Date Range
            if (filterConfig.startDate && e.date < filterConfig.startDate) return false;
            if (filterConfig.endDate && e.date > filterConfig.endDate) return false;
            
            // Record Type
            if (filterConfig.recordType && e.recordType !== filterConfig.recordType) return false;

            // Title Search (Case insensitive)
            if (filterConfig.searchTitle) {
                const term = filterConfig.searchTitle.toLowerCase();
                if (!e.title.toLowerCase().includes(term) && !e.description?.toLowerCase().includes(term)) return false;
            }

            return true;
        });
    } else {
        // --- Default View Logic (Incrementally by days) ---
        // FIX: Use local date construction to avoid UTC offsets
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - visibleDays);
        
        const yyyy = cutoffDate.getFullYear();
        const mm = String(cutoffDate.getMonth() + 1).padStart(2, '0');
        const dd = String(cutoffDate.getDate()).padStart(2, '0');
        const cutoffStr = `${yyyy}-${mm}-${dd}`;

        filteredEvents = filteredEvents.filter(e => e.date >= cutoffStr);
    }

    // Explicitly sort DESC by Date and Time
    filteredEvents.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.time.localeCompare(a.time);
    });

    // Check if there are more events to load hidden by the date filter
    const hasHiddenEvents = !hasActiveFilters && events.length > filteredEvents.length;

    return (
    <div className="flex flex-col h-full bg-slate-50">
        <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">DogLog 🐾</h1>
                <p className="text-sm text-slate-500 flex items-center gap-1">
                  {settings.supabaseUrl ? <span className="w-2 h-2 bg-green-50 rounded-full"></span> : <span className="w-2 h-2 bg-gray-300 rounded-full"></span>}
                  {settings.supabaseUrl ? 'Conectado a Supabase' : 'Modo Local'}
                </p>
              </div>
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-full transition-colors ${showFilters ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                title="Filtrar eventos"
              >
                <Icons.Filter className="w-5 h-5" />
              </button>
            </div>
            
            {/* Filter Panel */}
            {showFilters && (
                <div className="mt-4 pt-4 border-t border-slate-100 animate-fade-in-up">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                         <div>
                            <label className="text-xs font-semibold text-slate-500 mb-1 block">Desde</label>
                            <input 
                                type="date" 
                                value={filterConfig.startDate}
                                onChange={(e) => setFilterConfig({...filterConfig, startDate: e.target.value})}
                                className="w-full text-xs p-2 rounded-lg bg-slate-50 border border-slate-200 outline-none focus:border-blue-300"
                            />
                         </div>
                         <div>
                            <label className="text-xs font-semibold text-slate-500 mb-1 block">Hasta</label>
                            <input 
                                type="date" 
                                value={filterConfig.endDate}
                                onChange={(e) => setFilterConfig({...filterConfig, endDate: e.target.value})}
                                className="w-full text-xs p-2 rounded-lg bg-slate-50 border border-slate-200 outline-none focus:border-blue-300"
                            />
                         </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                             <label className="text-xs font-semibold text-slate-500 mb-1 block">Tipo</label>
                             <select
                                value={filterConfig.recordType}
                                onChange={(e) => setFilterConfig({...filterConfig, recordType: e.target.value as RecordType})}
                                className="w-full text-xs p-2 rounded-lg bg-slate-50 border border-slate-200 outline-none focus:border-blue-300"
                             >
                                <option value="">Todos</option>
                                {Object.values(RecordType).map(t => <option key={t} value={t}>{t}</option>)}
                             </select>
                        </div>
                        <div>
                             <label className="text-xs font-semibold text-slate-500 mb-1 block">Buscar Texto</label>
                             <input 
                                type="text"
                                placeholder="Título o descripción..."
                                value={filterConfig.searchTitle}
                                onChange={(e) => setFilterConfig({...filterConfig, searchTitle: e.target.value})}
                                className="w-full text-xs p-2 rounded-lg bg-slate-50 border border-slate-200 outline-none focus:border-blue-300"
                             />
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                         <span className="text-xs text-slate-400 font-medium">{filteredEvents.length} resultados</span>
                         <button 
                            onClick={() => {
                                setFilterConfig({ startDate: '', endDate: '', recordType: '', searchTitle: '' });
                                setVisibleDays(3); // Reset to last 3 days
                            }}
                            className="text-xs text-blue-600 font-medium hover:underline"
                         >
                            Limpiar Filtros
                         </button>
                    </div>
                </div>
            )}
        </header>
        <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4 no-scrollbar">
            {filteredEvents.length === 0 ? (
                <div className="text-center text-slate-400 mt-20">
                    <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icons.Home className="w-8 h-8 text-slate-400" />
                    </div>
                    <p>{events.length === 0 ? "No hay eventos registrados." : "No hay resultados recientes."}</p>
                    {events.length === 0 ? (
                        <p className="text-sm mt-2">Configura Supabase en Ajustes y pulsa +</p>
                    ) : !hasActiveFilters && (
                        <button 
                            onClick={() => setVisibleDays(prev => prev + 3)}
                            className="mt-4 text-blue-600 font-semibold text-sm hover:underline"
                        >
                            Ver días anteriores
                        </button>
                    )}
                </div>
            ) : (
                <>
                    {!hasActiveFilters && (
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-400 px-1">
                            <span>Mostrando últimos {visibleDays} días</span>
                        </div>
                    )}
                    
                    {filteredEvents.map(event => (
                        <div key={event.id} onClick={() => handleEditEvent(event)} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative overflow-hidden active:scale-[0.98] transition-transform cursor-pointer">
                            <div className="absolute top-0 right-0 bg-slate-100 px-3 py-1 rounded-bl-xl text-xs font-bold text-slate-600">
                                {event.recordType}
                            </div>

                            <div className="flex justify-between items-start mb-2 pr-16">
                                <h3 className="font-bold text-slate-800 text-lg leading-tight">{event.title}</h3>
                            </div>
                            
                            <div className="flex flex-wrap gap-2 mb-3">
                                {event.healthStatus && (
                                    <span className={`text-xs font-medium px-2 py-1 rounded-full border ${HEALTH_STATUS_COLORS[event.healthStatus]}`}>
                                        {event.healthStatus}
                                    </span>
                                )}
                                <span className="text-xs font-medium px-2 py-1 rounded-full border bg-slate-50 text-slate-500 border-slate-100">
                                    {event.date} · {event.time}
                                </span>
                                {event.synced ? (
                                <span className="text-green-600 flex items-center gap-1 text-xs"><Icons.Check className="w-3 h-3"/> Nube</span>
                                ) : (
                                <span className="text-red-400 flex items-center gap-1 text-xs"><Icons.AlertTriangle className="w-3 h-3"/> Local</span>
                                )}
                            </div>
                            
                            {event.photoBase64 && (
                                <div className="mb-3 rounded-lg overflow-hidden h-48 w-full bg-slate-100">
                                    <img src={event.photoBase64} alt="Evento" className="w-full h-full object-cover" />
                                </div>
                            )}

                            <p className="text-slate-600 text-sm line-clamp-3 whitespace-pre-wrap">{event.description}</p>
                            
                            {event.weight && (
                                <div className="mt-3 pt-3 border-t border-slate-50 flex gap-4 text-xs font-semibold text-slate-700">
                                    <span>⚖️ {event.weight} kg</span>
                                </div>
                            )}
                        </div>
                    ))}
                    
                    {/* Incremental Load Button */}
                    {!hasActiveFilters && hasHiddenEvents && (
                        <div className="pt-4 pb-8 text-center">
                            <button 
                                onClick={() => setVisibleDays(prev => prev + 3)}
                                className="px-6 py-2.5 bg-white border border-slate-200 shadow-sm rounded-full text-sm font-semibold text-slate-600 active:scale-95 transition-all hover:bg-slate-50"
                            >
                                Cargar 3 días anteriores...
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    </div>
  )};

  const renderAdd = () => {
    // Logic for showing loading screen ONLY when analyzing photo/file
    if (aiProcessing && inputMethod === 'menu') { 
        return (
            <div className="flex flex-col h-full items-center justify-center p-8 bg-slate-50">
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
                <h2 className="text-xl font-bold text-slate-800 mb-2">Analizando...</h2>
                <p className="text-slate-500 text-center">La IA está examinando el contenido para rellenar el formulario.</p>
            </div>
        );
    }

    if (inputMethod === 'menu') {
        return (
            <div className="flex flex-col h-full px-6 pt-6 bg-slate-50 overflow-y-auto pb-24">
                <h2 className="text-2xl font-bold text-slate-800 mb-6">Nuevo Evento</h2>
                
                <div className="grid gap-4">
                    <button onClick={() => setInputMethod('voice')} className="flex flex-row items-center p-5 bg-white rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
                        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mr-4 shrink-0"><Icons.Mic className="w-6 h-6" /></div>
                        <div className="text-left"><span className="block font-semibold text-lg text-slate-700">Dictar por Voz</span><span className="text-sm text-slate-500">La IA te escucha</span></div>
                    </button>

                    <button onClick={() => setInputMethod('chat')} className="flex flex-row items-center p-5 bg-white rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
                        <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mr-4 shrink-0"><Icons.MessageSquare className="w-6 h-6" /></div>
                        <div className="text-left"><span className="block font-semibold text-lg text-slate-700">Chat con IA</span><span className="text-sm text-slate-500">Escribe lo que pasó</span></div>
                    </button>
                    
                    {/* AI Camera Button */}
                    <label className="flex flex-row items-center p-5 bg-white rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition-transform cursor-pointer">
                        <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mr-4 shrink-0"><Icons.ImagePlus className="w-6 h-6" /></div>
                        <div className="text-left"><span className="block font-semibold text-lg text-slate-700">Foto con IA</span><span className="text-sm text-slate-500">Analiza foto y rellena</span></div>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageCapture} />
                    </label>

                    {/* NEW: File Upload Button */}
                    <label className="flex flex-row items-center p-5 bg-white rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition-transform cursor-pointer">
                        <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mr-4 shrink-0"><Icons.Upload className="w-6 h-6" /></div>
                        <div className="text-left"><span className="block font-semibold text-lg text-slate-700">Subir Archivo</span><span className="text-sm text-slate-500">PDF, Informes, Fotos</span></div>
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
                    </label>

                    <button onClick={() => { setDraftEvent(undefined); setInputMethod('manual'); }} className="flex flex-row items-center p-5 bg-white rounded-2xl border border-slate-200 shadow-sm active:scale-95 transition-transform">
                        <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mr-4 shrink-0"><Icons.Plus className="w-6 h-6" /></div>
                        <div className="text-left"><span className="block font-semibold text-lg text-slate-700">Manual</span><span className="text-sm text-slate-500">Rellena el formulario</span></div>
                    </button>
                </div>
            </div>
        );
    }
    if (inputMethod === 'voice') {
        return (
            <div className="flex flex-col h-full px-6 pt-10 bg-slate-50 items-center">
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Dictado IA</h2>
                <p className="text-slate-500 text-center mb-10">Cuéntame qué ha pasado con detalle.</p>
                <AudioRecorder onAudioCaptured={handleAudioCaptured} isProcessing={aiProcessing} />
                <button onClick={() => setInputMethod('menu')} className="mt-10 text-slate-500 underline" disabled={aiProcessing}>Cancelar</button>
            </div>
        );
    }
    if (inputMethod === 'chat') {
        return (
            <div className="flex flex-col h-full px-6 pt-6 bg-slate-50">
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Chat Inteligente</h2>
                <p className="text-slate-500 text-sm mb-4">Escribe qué ha ocurrido.</p>
                <textarea className="w-full flex-1 p-4 rounded-xl border border-slate-200 mb-4 resize-none focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Escribe aquí..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} disabled={aiProcessing} />
                <div className="flex gap-3 mb-24">
                    <button onClick={() => setInputMethod('menu')} className="flex-1 py-3 bg-slate-200 text-slate-700 rounded-xl font-medium" disabled={aiProcessing}>Volver</button>
                    <button onClick={handleChatSubmit} disabled={!chatInput.trim() || aiProcessing} className="flex-[2] py-3 bg-purple-600 text-white rounded-xl font-medium shadow-lg shadow-purple-200 flex justify-center items-center">{aiProcessing ? 'Analizando...' : 'Procesar'}</button>
                </div>
            </div>
        )
    }
    return (
        <div className="flex flex-col h-full bg-slate-50">
            <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10 flex items-center space-x-3">
                <button onClick={() => setInputMethod('menu')} className="text-slate-400"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg></button>
                <h2 className="text-lg font-bold text-slate-800">Detalles del Evento</h2>
            </header>
            <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
                <EventForm initialData={draftEvent} onSubmit={handleEventSubmit} onCancel={() => setView('home')} />
            </div>
            {isLoading && (
                <div className="absolute inset-0 bg-white/80 z-50 flex items-center justify-center flex-col">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="font-medium text-slate-600">Subiendo a Supabase...</p>
                </div>
            )}
        </div>
    );
  };

  const renderSettings = () => (
    <div className="flex flex-col h-full bg-slate-50">
        <header className="bg-white px-6 py-4 border-b border-slate-100 sticky top-0 z-10">
            <h2 className="text-2xl font-bold text-slate-800">Configuración</h2>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 no-scrollbar">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 mb-6">
                <p className="text-sm text-slate-600 mb-4">Configura tu proyecto de Supabase (Base de Datos PostgreSQL).</p>
                
                {isEnvConfigured && (
                    <div className="mb-4 bg-blue-50 text-blue-800 text-xs p-3 rounded-lg border border-blue-100 flex items-center gap-2">
                        <Icons.Check className="w-4 h-4" />
                        <span>Configurado automáticamente mediante variables de entorno.</span>
                    </div>
                )}

                <form onSubmit={handleSaveSettings} className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Project URL</label>
                        <input 
                            type="text" 
                            className={`w-full p-3 rounded-xl border border-slate-200 outline-none ${isEnvConfigured ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50 focus:bg-white'}`}
                            placeholder="https://xyz.supabase.co" 
                            value={settings.supabaseUrl} 
                            onChange={(e) => setSettings({...settings, supabaseUrl: e.target.value})} 
                            disabled={isEnvConfigured}
                        />
                        {!isEnvConfigured && <p className="text-xs text-slate-400 mt-1">Debe ser del formato: https://&lt;tu-proyecto&gt;.supabase.co</p>}
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">API Key (anon/public)</label>
                        <input 
                            type="password" 
                            className={`w-full p-3 rounded-xl border border-slate-200 outline-none ${isEnvConfigured ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50 focus:bg-white'}`}
                            placeholder="eyJ..." 
                            value={settings.supabaseKey} 
                            onChange={(e) => setSettings({...settings, supabaseKey: e.target.value})} 
                            disabled={isEnvConfigured}
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={!settings.supabaseUrl || !settings.supabaseKey || isTestingConnection}
                            className={`w-full py-3 rounded-xl font-medium text-sm transition-colors border ${
                                connectionStatus === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 
                                connectionStatus === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 
                                'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                        >
                            {isTestingConnection ? 'Probando...' : 
                             connectionStatus === 'success' ? '✅ Conexión Establecida' : 
                             connectionStatus === 'error' ? '❌ Error' : 
                             'Probar Conexión y Diagnosticar'}
                        </button>
                        {connectionMessage && (
                            <p className={`mt-3 text-sm p-3 rounded-lg border text-center overflow-hidden text-ellipsis ${connectionStatus === 'error' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                {connectionMessage}
                            </p>
                        )}
                    </div>

                    {/* SQL Helper */}
                    <div className="pt-4 border-t border-slate-100">
                        <button 
                            type="button" 
                            onClick={() => setShowSqlScript(!showSqlScript)}
                            className="text-blue-600 text-sm font-medium flex items-center gap-2"
                        >
                            <span>{showSqlScript ? 'Ocultar' : 'Ver'} Script de Base de Datos (V9 Relacional)</span>
                        </button>
                        
                        {showSqlScript && (
                            <div className="mt-3">
                                <p className="text-xs text-slate-500 mb-2">Script V9: Crea tablas relacionales y vincula datos.</p>
                                <div className="relative bg-slate-800 rounded-lg p-3 overflow-hidden">
                                    <pre className="text-[10px] text-green-300 overflow-x-auto font-mono">
                                        {SQL_SCRIPT}
                                    </pre>
                                    <button 
                                        type="button"
                                        onClick={() => navigator.clipboard.writeText(SQL_SCRIPT).then(() => alert('Copiado al portapapeles'))}
                                        className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white text-xs px-2 py-1 rounded"
                                    >
                                        Copiar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {!isEnvConfigured && (
                        <button type="submit" className="w-full bg-slate-800 text-white py-3.5 rounded-xl font-semibold mt-4 shadow-lg shadow-slate-200">
                            Guardar Configuración
                        </button>
                    )}
                </form>

                {/* --- MIGRATION SECTION --- */}
                <MigrationPanel supabaseSettings={settings} />

            </div>
        </div>
    </div>
  );

  return (
    <div className="h-full w-full max-w-md mx-auto bg-white shadow-2xl relative overflow-hidden">
      {view === 'home' && renderHome()}
      {view === 'add' && renderAdd()}
      {view === 'consult' && <AIQueryView settings={settings} onEventClick={handleEditEvent} />}
      {view === 'settings' && renderSettings()}
      <Navbar currentView={view === 'add' && inputMethod !== 'menu' ? 'add' : view} setView={(v) => {
        setView(v);
        if (v === 'add') setInputMethod('menu');
      }} />
    </div>
  );
};

export default App;