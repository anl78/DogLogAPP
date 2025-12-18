



import React, { useState, useRef, useEffect } from 'react';
import { SupabaseSettings, Pet } from '../types';
import { startMigration, deleteMigratedEvents, assignOrphanEvents, optimizeExistingPhotos, batchScorePoops } from '../services/migrationService';

interface MigrationPanelProps {
    supabaseSettings: SupabaseSettings;
    currentPet?: Pet | null;
    currentUser?: any;
    accessToken?: string;
}

const MigrationPanel: React.FC<MigrationPanelProps> = ({ supabaseSettings, currentPet, currentUser, accessToken }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    // Inputs
    const [notionKey, setNotionKey] = useState('');
    const [dbId, setDbId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const [status, setStatus] = useState<'idle' | 'confirming_migration' | 'confirming_deletion' | 'confirming_rescue' | 'confirming_optimization' | 'confirming_scoring' | 'running' | 'done'>('idle');
    const [progress, setProgress] = useState({ current: 0, total: 0, msg: '' });
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    // Helpers to manage UI blocking
    const handleActionClick = (e: React.MouseEvent, action: 'migration' | 'deletion' | 'rescue' | 'optimization' | 'scoring') => {
        e.preventDefault();
        e.stopPropagation();

        if (action === 'migration' && (!notionKey || !dbId)) {
            alert("Faltan datos de Notion.");
            return;
        }
        if (!supabaseSettings.supabaseUrl) {
            alert("Supabase no configurado.");
            return;
        }
        
        if (action === 'rescue' && (!currentPet || !currentUser)) {
            alert("Necesitas estar logueado y tener una mascota activa.");
            return;
        }

        if (action === 'migration') setStatus('confirming_migration');
        else if (action === 'deletion') setStatus('confirming_deletion');
        else if (action === 'rescue') setStatus('confirming_rescue');
        else if (action === 'scoring') setStatus('confirming_scoring');
        else setStatus('confirming_optimization');
    };

    const runProcess = (type: 'migration' | 'deletion' | 'rescue' | 'optimization' | 'scoring') => {
        setStatus('running');
        let initialLog: string[] = [];

        if (type === 'migration') initialLog = ["🚀 Inicializando migración...", `📅 Filtro: ${startDate || 'Inicio'} a ${endDate || 'Fin'}`];
        else if (type === 'deletion') initialLog = ["🗑️ Inicializando borrado...", `📅 Filtro: ${startDate || 'Inicio'} a ${endDate || 'Fin'}`];
        else if (type === 'rescue') initialLog = ["🛟 Rescatando huérfanos..."];
        else if (type === 'optimization') initialLog = ["⚡ Iniciando optimización de imágenes...", "Esto puede tardar unos minutos."];
        else if (type === 'scoring') initialLog = ["💩 Iniciando IA para puntuar cacas antiguas...", "Esto consumirá tokens de IA."];
        
        setLogs(initialLog);
        
        setTimeout(async () => {
            try {
                const filters = {
                    startDate: startDate || undefined,
                    endDate: endDate || undefined
                };

                const logger = (msg: string) => setLogs(prev => [...prev, msg]);

                if (type === 'migration') {
                    await startMigration(
                        { apiKey: notionKey, databaseId: dbId },
                        supabaseSettings,
                        filters,
                        (current, total, msg) => setProgress({ current, total, msg }),
                        logger,
                        accessToken
                    );
                } else if (type === 'deletion') {
                    await deleteMigratedEvents(
                        supabaseSettings,
                        filters,
                        logger,
                        accessToken
                    );
                } else if (type === 'rescue') {
                    if (currentPet && currentUser) {
                        await assignOrphanEvents(
                            supabaseSettings,
                            currentUser.id,
                            currentPet.id,
                            logger,
                            accessToken
                        );
                    } else {
                        throw new Error("Faltan datos de usuario/mascota.");
                    }
                } else if (type === 'optimization') {
                    await optimizeExistingPhotos(
                        supabaseSettings,
                        (current, total, msg) => setProgress({ current, total, msg }),
                        logger,
                        accessToken
                    );
                } else if (type === 'scoring') {
                    await batchScorePoops(
                        supabaseSettings,
                        (current, total, msg) => setProgress({ current, total, msg }),
                        logger,
                        accessToken
                    );
                }
                
                setLogs(prev => [...prev, "🏁 OPERACIÓN FINALIZADA."]);
                setStatus('done');
            } catch (err: any) {
                setLogs(prev => [...prev, `❌ ERROR FATAL: ${err.message}`]);
                setStatus('done');
            }
        }, 100);
    };

    if (!isOpen) {
        return (
            <div className="mt-8 border-t border-slate-100 pt-6">
                 <button 
                    type="button"
                    onClick={(e) => { e.preventDefault(); setIsOpen(true); }}
                    className="text-xs text-slate-400 hover:text-slate-600 underline"
                >
                    Herramientas de Migración (Beta)
                </button>
            </div>
        );
    }

    return (
        <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 animate-fade-in-up">
            <h3 className="font-bold text-slate-700 mb-2">Gestión de Datos: Notion a Supabase</h3>
            
            <div className="space-y-3">
                {/* Notion Config */}
                <div className="grid grid-cols-1 gap-2">
                    <input 
                        type="password" 
                        value={notionKey} 
                        onChange={e => setNotionKey(e.target.value)}
                        className="w-full p-2 rounded-lg border border-slate-200 text-xs"
                        placeholder="Notion Secret Key (secret_...)"
                        disabled={status === 'running'}
                    />
                    <input 
                        type="text" 
                        value={dbId} 
                        onChange={e => setDbId(e.target.value)}
                        className="w-full p-2 rounded-lg border border-slate-200 text-xs"
                        placeholder="Notion Database ID"
                        disabled={status === 'running'}
                    />
                </div>

                {/* Date Filters */}
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Filtros de Acción</label>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <span className="text-[10px] text-slate-400">Desde (Incluido)</span>
                            <input 
                                type="date" 
                                value={startDate} 
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full p-2 rounded-lg border border-slate-200 text-xs"
                                disabled={status === 'running'}
                            />
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-400">Hasta (Incluido)</span>
                            <input 
                                type="date" 
                                value={endDate} 
                                onChange={e => setEndDate(e.target.value)}
                                className="w-full p-2 rounded-lg border border-slate-200 text-xs"
                                disabled={status === 'running'}
                            />
                        </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 italic">
                        Si dejas las fechas vacías, las acciones afectarán a <strong>TODO</strong> el historial.
                    </p>
                </div>

                {/* Progress Bar */}
                {status === 'running' && (
                    <div className="bg-white p-3 rounded-lg border border-blue-100">
                        <div className="flex justify-between text-xs font-bold text-blue-600 mb-1">
                            <span className="truncate pr-2">{progress.msg || "Procesando..."}</span>
                            <span>{progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : ''}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                            <div 
                                className="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                            ></div>
                        </div>
                    </div>
                )}

                {/* Action Buttons */}
                {status === 'idle' && (
                    <div className="flex flex-col gap-2 pt-2">
                        <button 
                            type="button"
                            onClick={(e) => handleActionClick(e, 'migration')}
                            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-sm active:scale-95"
                        >
                            Importar de Notion (con Filtro)
                        </button>
                        
                        <div className="flex gap-2">
                            <button 
                                type="button"
                                onClick={(e) => handleActionClick(e, 'optimization')}
                                className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg font-bold text-sm shadow-sm active:scale-95"
                            >
                                ⚡ Optimizar Fotos
                            </button>
                            <button 
                                type="button"
                                onClick={(e) => handleActionClick(e, 'scoring')}
                                className="flex-1 py-2.5 bg-fuchsia-600 text-white rounded-lg font-bold text-sm shadow-sm active:scale-95"
                            >
                                🤖 Puntuar Cacas
                            </button>
                        </div>

                        <button 
                            type="button"
                            onClick={(e) => handleActionClick(e, 'rescue')}
                            className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-bold text-sm shadow-sm active:scale-95"
                        >
                            Asignar Huérfanos a {currentPet?.name || 'Actual'}
                        </button>

                        <button 
                            type="button"
                            onClick={(e) => handleActionClick(e, 'deletion')}
                            className="w-full py-2.5 bg-white border border-red-200 text-red-600 rounded-lg font-bold text-sm shadow-sm active:scale-95 hover:bg-red-50"
                        >
                            Borrar Rango en Supabase
                        </button>
                    </div>
                )}

                {/* Confirmation States */}
                {status === 'confirming_migration' && (
                    <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                        <p className="text-xs font-bold text-indigo-900 mb-2">
                            ¿Importar eventos {startDate ? `desde ${startDate}` : 'desde el inicio'} {endDate ? `hasta ${endDate}` : 'hasta hoy'}?
                        </p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStatus('idle')} className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold">Cancelar</button>
                            <button type="button" onClick={() => runProcess('migration')} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-sm">Sí, Importar</button>
                        </div>
                    </div>
                )}
                
                {status === 'confirming_rescue' && (
                    <div className="bg-teal-50 p-3 rounded-lg border border-teal-100">
                        <p className="text-xs font-bold text-teal-900 mb-2">
                            ¿Asignar todos los eventos sin dueño a {currentPet?.name}?
                        </p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStatus('idle')} className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold">Cancelar</button>
                            <button type="button" onClick={() => runProcess('rescue')} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold shadow-sm">Sí, Asignar</button>
                        </div>
                    </div>
                )}

                {status === 'confirming_optimization' && (
                    <div className="bg-amber-50 p-3 rounded-lg border border-amber-100">
                        <p className="text-xs font-bold text-amber-900 mb-2">
                            Esto descargará, comprimirá y re-subirá todas las fotos grandes. Puede tardar un rato. ¿Seguro?
                        </p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStatus('idle')} className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold">Cancelar</button>
                            <button type="button" onClick={() => runProcess('optimization')} className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-xs font-bold shadow-sm">Sí, Optimizar</button>
                        </div>
                    </div>
                )}

                 {status === 'confirming_scoring' && (
                    <div className="bg-fuchsia-50 p-3 rounded-lg border border-fuchsia-100">
                        <p className="text-xs font-bold text-fuchsia-900 mb-2">
                            La IA leerá todas las descripciones de 'Caca' sin puntuar y asignará una nota (1-10).
                        </p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStatus('idle')} className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold">Cancelar</button>
                            <button type="button" onClick={() => runProcess('scoring')} className="flex-1 py-2 bg-fuchsia-600 text-white rounded-lg text-xs font-bold shadow-sm">Sí, Puntuar</button>
                        </div>
                    </div>
                )}

                {status === 'confirming_deletion' && (
                    <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                        <p className="text-xs font-bold text-red-900 mb-2">
                            ⚠️ PELIGRO: Se borrarán PERMANENTEMENTE fotos y registros de Supabase {startDate ? `desde ${startDate}` : ''} {endDate ? `hasta ${endDate}` : ''}.
                        </p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStatus('idle')} className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold">Cancelar</button>
                            <button type="button" onClick={() => runProcess('deletion')} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-xs font-bold shadow-sm">Sí, Borrar Todo</button>
                        </div>
                    </div>
                )}

                {status === 'done' && (
                    <button 
                        type="button"
                        onClick={() => setStatus('idle')}
                        className="w-full py-2 bg-green-600 text-white rounded-lg font-bold text-sm"
                    >
                        Listo (Volver)
                    </button>
                )}

                {/* LOGS WINDOW */}
                {(status === 'running' || status === 'done' || logs.length > 0) && (
                    <div className="mt-4 p-3 bg-slate-900 text-green-400 text-[10px] font-mono rounded-lg h-40 overflow-y-auto shadow-inner">
                        {logs.map((line, i) => <div key={i} className="border-b border-white/5 py-0.5 break-all">{line}</div>)}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
            
            <button type="button" onClick={(e) => { e.preventDefault(); setIsOpen(false); }} className="mt-4 text-xs text-slate-400 underline w-full text-center">
                Ocultar panel
            </button>
        </div>
    );
};

export default MigrationPanel;
