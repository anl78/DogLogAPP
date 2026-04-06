import React, { useEffect, useState } from 'react';
import { DogEvent, Pet, SupabaseSettings } from '../types';
import { getSharedPetData } from '../services/supabaseService';
import { HEALTH_STATUS_COLORS, Icons, getPoopScoreColor } from '../constants';

interface SharedPetViewProps {
    token: string;
    settings: SupabaseSettings;
}

const SharedPetView: React.FC<SharedPetViewProps> = ({ token, settings }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pet, setPet] = useState<Pet | null>(null);
    const [events, setEvents] = useState<DogEvent[]>([]);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            const result = await getSharedPetData(settings, token);
            if (result.error) {
                setError(result.error);
            } else {
                setPet(result.pet || null);
                setEvents(result.events || []);
            }
            setLoading(false);
        };
        loadData();
    }, [token, settings]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-600 font-medium">Cargando historial de la mascota...</p>
            </div>
        );
    }

    if (error || !pet) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                    <Icons.AlertTriangle className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-slate-800 mb-2">Enlace no válido</h2>
                <p className="text-slate-600 max-w-sm">{error || "No se ha podido cargar la información."}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white px-6 py-6 border-b border-slate-100 sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-4">
                    {pet.photo_url ? (
                        <img src={pet.photo_url} alt={pet.name} className="w-16 h-16 rounded-full object-cover border-2 border-slate-100" />
                    ) : (
                        <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl font-bold">
                            {pet.name.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">{pet.name}</h1>
                        <p className="text-sm text-slate-500">Historial Clínico (Solo Lectura)</p>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
                {events.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                        <Icons.Activity className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>No hay eventos registrados para esta mascota.</p>
                    </div>
                ) : (
                    events.map(ev => (
                        <div key={ev.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 flex flex-row items-stretch">
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
                                    {ev.description && <p className="text-sm text-slate-600 mb-3 leading-snug whitespace-pre-wrap">{ev.description}</p>}
                                </div>
                                <div className="flex items-center justify-between mt-auto">
                                    <div className="flex gap-2">
                                        {ev.healthStatus && <span className={`text-[10px] px-2 py-0.5 rounded-md border ${HEALTH_STATUS_COLORS[ev.healthStatus]}`}>{ev.healthStatus}</span>}
                                        {ev.weight && <span className="text-[10px] px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-600 font-bold">{ev.weight} kg</span>}
                                        {ev.poopScore && <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${getPoopScoreColor(ev.poopScore)}`}>Score: {ev.poopScore}</span>}
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400">{ev.date}</span>
                                </div>
                            </div>
                            {ev.photoUrl && (
                                <div className="w-32 shrink-0 overflow-hidden bg-slate-100">
                                    <img src={ev.photoUrl} alt={ev.title} className="w-full h-full object-cover" />
                                </div>
                            )}
                        </div>
                    ))
                )}
            </main>
        </div>
    );
};

export default SharedPetView;
