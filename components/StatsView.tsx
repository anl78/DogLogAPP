
import React, { useEffect, useState, useMemo } from 'react';
import { DogEvent, SupabaseSettings, RecordType } from '../types';
import { searchEvents } from '../services/supabaseService';
import { getPoopScoreColor, Icons } from '../constants';
import ImageViewer from './ImageViewer';

interface StatsViewProps {
  settings: SupabaseSettings;
  petId: string;
  accessToken?: string;
  onEventClick: (event: DogEvent) => void;
}

// Helper to group events by day
const groupByDay = (events: DogEvent[]) => {
    const groups: Record<string, DogEvent[]> = {};
    events.forEach(ev => {
        if (!groups[ev.date]) groups[ev.date] = [];
        groups[ev.date].push(ev);
    });
    return groups;
};

const StatsView: React.FC<StatsViewProps> = ({ settings, petId, accessToken, onEventClick }) => {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [events, setEvents] = useState<DogEvent[]>([]);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [oldestLoadedDate, setOldestLoadedDate] = useState<Date>(new Date());

  // Initial load
  useEffect(() => {
    const loadData = async () => {
        setLoading(true);
        // Fetch last 14 days initially
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 13); // 14 days total including today

        const data = await searchEvents({
            petId,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            limit: 200 // High limit to ensure we get all events in range
        }, settings, accessToken);
        
        setEvents(data);
        setOldestLoadedDate(startDate);
        setLoading(false);
    };
    loadData();
  }, [petId, settings]);

  const handleLoadMore = async () => {
      if (loadingMore) return;
      setLoadingMore(true);

      const endDate = new Date(oldestLoadedDate);
      endDate.setDate(endDate.getDate() - 1); // Start from previous day
      
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 13); // Load another 14 days chunk

      const newData = await searchEvents({
          petId,
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          limit: 200
      }, settings, accessToken);

      setEvents(prev => [...prev, ...newData]);
      setOldestLoadedDate(startDate);
      setLoadingMore(false);
  };

  // Derived state: unique days sorted descending
  const days = useMemo(() => {
      return Array.from(new Set(events.map(e => e.date))).sort().reverse();
  }, [events]);

  const groupedEvents = useMemo(() => groupByDay(events), [events]);

  if (loading) return <div className="h-full flex items-center justify-center">Cargando estadísticas...</div>;

  return (
    <div className="h-full bg-slate-100 flex flex-col">
        <header className="bg-white px-6 py-4 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Icons.Stats className="w-5 h-5 text-blue-600" />
                Panel de Salud Diario
            </h2>
            <p className="text-xs text-slate-500">
                Mostrando desde: {oldestLoadedDate.toLocaleDateString('es-ES')}
            </p>
        </header>

        <div className="flex-1 overflow-y-auto p-4 pb-32">
            {days.length === 0 ? (
                <div className="text-center text-slate-400 mt-10">No hay datos recientes.</div>
            ) : (
                <div className="space-y-6">
                    {days.map(date => {
                        const dayEvents = groupedEvents[date] || [];
                        const poops = dayEvents.filter(e => e.recordType === RecordType.POOP);
                        const vomits = dayEvents.filter(e => e.recordType === RecordType.VOMIT);
                        const others = dayEvents.filter(e => e.recordType !== RecordType.POOP && e.recordType !== RecordType.VOMIT);

                        const dateObj = new Date(date);
                        const dayName = dateObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });

                        return (
                            <div key={date} className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                                {/* Date Column (Mobile: Header) */}
                                <div className="md:w-32 shrink-0 border-b md:border-b-0 md:border-r border-slate-100 pb-2 md:pb-0 md:pr-4">
                                    <h3 className="font-bold text-slate-800 capitalize text-lg">{dayName}</h3>
                                    <span className="text-xs text-slate-400">{date}</span>
                                    
                                    {/* Daily Summary Stats */}
                                    <div className="flex gap-2 mt-2 md:flex-col">
                                        <div className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                                            💩 {poops.length}
                                        </div>
                                        {vomits.length > 0 && (
                                            <div className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">
                                                🤮 {vomits.length}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Main Content Grid - 60% / 40% */}
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-[60%_40%] gap-4">
                                    
                                    {/* Column 1: Poops & Vomits (Visual Focus) */}
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Salud Digestiva</h4>
                                        <div className="grid grid-cols-2 gap-2">
                                            {poops.map(ev => {
                                                const score = ev.poopScore || 5; // Default to 5 if unknown
                                                const colorClass = getPoopScoreColor(score);
                                                
                                                return (
                                                    <div 
                                                        key={ev.id} 
                                                        onClick={() => onEventClick(ev)}
                                                        className={`p-2 rounded-xl border-l-4 shadow-sm bg-white relative overflow-hidden cursor-pointer active:scale-95 transition-transform hover:opacity-95 ${colorClass.replace('bg-', 'border-').split(' ')[2]}`}
                                                    >
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className="text-xs font-bold text-slate-700">{ev.time}</span>
                                                            <span className={`text-[10px] px-1.5 rounded text-white font-bold ${colorClass.split(' ')[0]}`}>{score}/10</span>
                                                        </div>
                                                        {ev.photoUrl && (
                                                            <div className="h-28 w-full rounded-lg bg-slate-100 mb-1 overflow-hidden relative group">
                                                                <img 
                                                                    src={ev.photoUrl} 
                                                                    className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity" 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setViewImage(ev.photoUrl!);
                                                                    }}
                                                                />
                                                                <div className="absolute top-1 right-1 bg-black/30 rounded p-0.5 pointer-events-none">
                                                                    <Icons.ImagePlus className="w-3 h-3 text-white" />
                                                                </div>
                                                            </div>
                                                        )}
                                                        <p className="text-[10px] text-slate-500 line-clamp-2 leading-tight">{ev.description || ev.title}</p>
                                                    </div>
                                                );
                                            })}
                                            {vomits.map(ev => {
                                                return (
                                                    <div 
                                                        key={ev.id} 
                                                        onClick={() => onEventClick(ev)}
                                                        className={`p-2 rounded-xl border-l-4 border-orange-500 shadow-sm relative overflow-hidden cursor-pointer active:scale-95 transition-transform hover:opacity-95 ${ev.photoUrl ? 'bg-white' : 'bg-orange-50'}`}
                                                    >
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className="text-xs font-bold text-orange-800">🤮 Vómito</span>
                                                            <span className={`text-[10px] ${ev.photoUrl ? 'text-slate-400' : 'text-orange-600'}`}>{ev.time}</span>
                                                        </div>
                                                        {ev.photoUrl && (
                                                            <div className="h-28 w-full rounded-lg bg-slate-100 mb-1 overflow-hidden relative group">
                                                                <img 
                                                                    src={ev.photoUrl} 
                                                                    className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity" 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setViewImage(ev.photoUrl!);
                                                                    }}
                                                                />
                                                                 <div className="absolute top-1 right-1 bg-black/30 rounded p-0.5 pointer-events-none">
                                                                    <Icons.ImagePlus className="w-3 h-3 text-white" />
                                                                </div>
                                                            </div>
                                                        )}
                                                        <p className={`text-[10px] line-clamp-2 leading-tight ${ev.photoUrl ? 'text-slate-500' : 'text-orange-700'}`}>{ev.description || ev.title}</p>
                                                    </div>
                                                );
                                            })}
                                            {poops.length === 0 && vomits.length === 0 && (
                                                <div className="col-span-2 py-4 text-center text-xs text-slate-300 italic border-2 border-dashed border-slate-100 rounded-xl">
                                                    Sin registros digestivos
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Column 2: Context Timeline */}
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Contexto y Eventos</h4>
                                        <div className="space-y-2 relative pl-2">
                                            {/* Timeline line */}
                                            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-slate-200"></div>

                                            {others.map(ev => (
                                                <div key={ev.id} className="relative pl-4">
                                                    {/* Dot */}
                                                    <div className={`absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                                        ev.recordType === RecordType.FOOD ? 'bg-green-400' :
                                                        ev.recordType === RecordType.MEDICATION ? 'bg-purple-400' :
                                                        ev.recordType === RecordType.BEHAVIOR ? 'bg-blue-400' : 'bg-slate-400'
                                                    }`}></div>
                                                    
                                                    <div 
                                                        className="bg-slate-50 p-2 rounded-lg border border-slate-100 cursor-pointer active:scale-95 transition-transform hover:bg-slate-100/80 hover:border-blue-200"
                                                        onClick={() => onEventClick(ev)}
                                                    >
                                                        <div className="flex justify-between">
                                                            <span className="text-[10px] font-bold text-slate-600 uppercase">{ev.recordType}</span>
                                                            <span className="text-[10px] text-slate-400">{ev.time}</span>
                                                        </div>
                                                        <p className="text-xs text-slate-800 font-medium line-clamp-1">{ev.title}</p>
                                                        {ev.description && <p className="text-[10px] text-slate-500 line-clamp-1">{ev.description}</p>}
                                                    </div>
                                                </div>
                                            ))}
                                            {others.length === 0 && (
                                                <p className="text-[10px] text-slate-400 italic pl-4">Sin otros eventos</p>
                                            )}
                                        </div>
                                    </div>

                                </div>
                            </div>
                        );
                    })}
                    
                    {/* Load More Button */}
                    <button 
                        onClick={handleLoadMore} 
                        disabled={loadingMore}
                        className="w-full py-4 mb-8 bg-white border border-slate-200 rounded-xl text-slate-600 font-bold shadow-sm active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loadingMore ? (
                            <>
                                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                                Cargando...
                            </>
                        ) : (
                            <>
                                <Icons.Plus className="w-4 h-4" />
                                Cargar 14 días anteriores
                            </>
                        )}
                    </button>
                </div>
            )}
        </div>
        <ImageViewer src={viewImage} onClose={() => setViewImage(null)} />
    </div>
  );
};

export default StatsView;
