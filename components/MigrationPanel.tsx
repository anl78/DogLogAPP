import React, { useState, useRef, useEffect } from 'react';
import { SupabaseSettings } from '../types';
import { startMigration } from '../services/migrationService';

interface MigrationPanelProps {
    supabaseSettings: SupabaseSettings;
}

const MigrationPanel: React.FC<MigrationPanelProps> = ({ supabaseSettings }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [notionKey, setNotionKey] = useState('');
    const [dbId, setDbId] = useState('');
    const [status, setStatus] = useState<'idle' | 'confirming' | 'running' | 'done'>('idle');
    const [progress, setProgress] = useState({ current: 0, total: 0, msg: '' });
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const handlePreClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation(); // Evitar que suba al formulario de ajustes

        if (!notionKey || !dbId) {
            alert("Faltan datos de Notion.");
            return;
        }
        if (!supabaseSettings.supabaseUrl) {
            alert("Supabase no configurado.");
            return;
        }
        setStatus('confirming');
    };

    const handleStartMigration = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // 1. Update UI state IMMEDIATELY
        setStatus('running');
        setLogs(["🚀 Inicializando sistema...", "⏳ Por favor espera..."]);
        
        // 2. Defer execution to let UI paint
        setTimeout(async () => {
            try {
                await startMigration(
                    { apiKey: notionKey, databaseId: dbId },
                    supabaseSettings,
                    (current, total, msg) => {
                        setProgress({ current, total, msg });
                    },
                    (newLog) => {
                        setLogs(prev => [...prev, newLog]);
                    }
                );
                setLogs(prev => [...prev, "🏁 FINALIZADO."]);
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
            <h3 className="font-bold text-slate-700 mb-2">Importar desde Notion</h3>
            <p className="text-xs text-slate-500 mb-4">
                Copia los datos de tu tabla antigua a Supabase.
            </p>

            <div className="space-y-3">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Notion API Secret</label>
                    <input 
                        type="password" 
                        value={notionKey} 
                        onChange={e => setNotionKey(e.target.value)}
                        className="w-full p-2 rounded-lg border border-slate-200 text-sm"
                        placeholder="secret_..."
                        disabled={status === 'running'}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Database ID</label>
                    <input 
                        type="text" 
                        value={dbId} 
                        onChange={e => setDbId(e.target.value)}
                        className="w-full p-2 rounded-lg border border-slate-200 text-sm"
                        placeholder="ID de la base de datos (32 chars)"
                        disabled={status === 'running'}
                    />
                </div>

                {/* Progress Bar */}
                {status === 'running' && (
                    <div className="bg-white p-3 rounded-lg border border-blue-100">
                        <div className="flex justify-between text-xs font-bold text-blue-600 mb-1">
                            <span className="truncate pr-2">{progress.msg || "Iniciando..."}</span>
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

                {/* Buttons State Machine */}
                {status === 'idle' && (
                    <button 
                        type="button"
                        onClick={handlePreClick}
                        className="w-full py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm shadow-sm active:scale-95"
                    >
                        Preparar Migración
                    </button>
                )}

                {status === 'confirming' && (
                    <div className="flex gap-2">
                         <button 
                            type="button"
                            onClick={() => setStatus('idle')}
                            className="flex-1 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-sm"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="button"
                            onClick={handleStartMigration}
                            className="flex-[2] py-2 bg-red-600 text-white rounded-lg font-bold text-sm shadow-sm active:scale-95 animate-pulse"
                        >
                            ¿Confirmar Inicio?
                        </button>
                    </div>
                )}

                {status === 'done' && (
                    <button 
                        type="button"
                        onClick={() => setStatus('idle')}
                        className="w-full py-2 bg-green-600 text-white rounded-lg font-bold text-sm"
                    >
                        Listo (Reiniciar)
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