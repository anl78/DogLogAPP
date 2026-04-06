import React, { useMemo, useState } from 'react';
import { DogEvent, RecordType } from '../types';
import { getPoopScoreColor, Icons } from '../constants';
import ImageViewer from './ImageViewer';

interface SharedDailyLogViewProps {
    events: DogEvent[];
}

const groupByDay = (events: DogEvent[]) => {
    const groups: Record<string, DogEvent[]> = {};
    events.forEach(ev => {
        if (!groups[ev.date]) groups[ev.date] = [];
        groups[ev.date].push(ev);
    });
    return groups;
};

const SharedDailyLogView: React.FC<SharedDailyLogViewProps> = ({ events }) => {
    const [viewImage, setViewImage] = useState<string | null>(null);

    const days = useMemo(() => {
        return Array.from(new Set(events.map(e => e.date))).sort().reverse();
    }, [events]);

    const groupedEvents = useMemo(() => groupByDay(events), [events]);

    return (
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
                                {/* Date Column */}
                                <div className="md:w-32 shrink-0 border-b md:border-b-0 md:border-r border-slate-100 pb-2 md:pb-0 md:pr-4">
                                    <h3 className="font-bold text-slate-800 capitalize text-lg">{dayName}</h3>
                                    <span className="text-xs text-slate-400">{date}</span>
                                    
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

                                {/* Main Content Grid */}
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-[60%_40%] gap-4">
                                    
                                    {/* Column 1: Poops & Vomits */}
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Salud Digestiva</h4>
                                        <div className="grid grid-cols-2 gap-2">
                                            {poops.map(ev => {
                                                const score = ev.poopScore || 5;
                                                const colorClass = getPoopScoreColor(score);
                                                
                                                return (
                                                    <div 
                                                        key={ev.id} 
                                                        className={`p-2 rounded-xl border-l-4 shadow-sm bg-white relative overflow-hidden ${colorClass.replace('bg-', 'border-').split(' ')[2]}`}
                                                    >
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className="text-xs font-bold text-slate-700">{ev.time}</span>
                                                            <span className={`text-[10px] px-1.5 rounded text-white font-bold ${colorClass.split(' ')[0]}`}>{score}/10</span>
                                                        </div>
                                                        {ev.photoUrl && (
                                                            <div className="h-28 w-full rounded-lg bg-slate-100 mb-1 overflow-hidden relative group cursor-pointer" onClick={() => setViewImage(ev.photoUrl!)}>
                                                                <img 
                                                                    src={ev.photoUrl} 
                                                                    className="w-full h-full object-cover hover:opacity-90 transition-opacity" 
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
                                                        className={`p-2 rounded-xl border-l-4 border-orange-500 shadow-sm relative overflow-hidden ${ev.photoUrl ? 'bg-white' : 'bg-orange-50'}`}
                                                    >
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className="text-xs font-bold text-orange-800">🤮 Vómito</span>
                                                            <span className={`text-[10px] ${ev.photoUrl ? 'text-slate-400' : 'text-orange-600'}`}>{ev.time}</span>
                                                        </div>
                                                        {ev.photoUrl && (
                                                            <div className="h-28 w-full rounded-lg bg-slate-100 mb-1 overflow-hidden relative group cursor-pointer" onClick={() => setViewImage(ev.photoUrl!)}>
                                                                <img 
                                                                    src={ev.photoUrl} 
                                                                    className="w-full h-full object-cover hover:opacity-90 transition-opacity" 
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
                                            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-slate-200"></div>

                                            {others.map(ev => (
                                                <div key={ev.id} className="relative pl-4">
                                                    <div className={`absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                                        ev.recordType === RecordType.FOOD ? 'bg-green-400' :
                                                        ev.recordType === RecordType.MEDICATION ? 'bg-purple-400' :
                                                        ev.recordType === RecordType.BEHAVIOR ? 'bg-blue-400' : 'bg-slate-400'
                                                    }`}></div>
                                                    
                                                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                                        <div className="flex justify-between">
                                                            <span className="text-[10px] font-bold text-slate-600 uppercase">{ev.recordType}</span>
                                                            <span className="text-[10px] text-slate-400">{ev.time}</span>
                                                        </div>
                                                        <p className="text-xs text-slate-800 font-medium line-clamp-1">{ev.title}</p>
                                                        {ev.description && <p className="text-[10px] text-slate-500 line-clamp-1">{ev.description}</p>}
                                                        {ev.photoUrl && (
                                                            <div className="mt-2 h-20 w-full rounded-lg bg-slate-200 overflow-hidden cursor-pointer" onClick={() => setViewImage(ev.photoUrl!)}>
                                                                <img src={ev.photoUrl} className="w-full h-full object-cover" />
                                                            </div>
                                                        )}
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
                </div>
            )}
            {viewImage && <ImageViewer imageUrl={viewImage} onClose={() => setViewImage(null)} />}
        </div>
    );
};

export default SharedDailyLogView;
