


import React, { useEffect, useState, useMemo } from 'react';
import { DogEvent, SupabaseSettings, RecordType } from '../types';
import { searchEvents, getWeightHistory } from '../services/supabaseService';
import { Icons, getPoopScoreColor } from '../constants';

interface DashboardViewProps {
  settings: SupabaseSettings;
  petId: string;
  accessToken?: string;
}

// --- HELPER COMPONENTS FOR CHARTS (CUSTOM SVG) ---

// 1. Line Chart (Health Trend) - Existing
const LineChart = ({ data, height = 120 }: { data: number[], height?: number }) => {
    if (data.length < 2) return <div className="h-20 flex items-center justify-center text-xs text-slate-400">Insuficientes datos</div>;

    const max = 10;
    const min = 1;
    
    // Create points
    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 100 - ((val - min) / (max - min)) * 100;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="relative w-full" style={{ height: `${height}px` }}>
            <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                {/* Background Zones */}
                <rect x="0" y="0" width="100" height="40" fill="#ecfccb" opacity="0.5" /> {/* Good (Top) */}
                <rect x="0" y="40" width="100" height="30" fill="#fef9c3" opacity="0.3" /> {/* Mid */}
                <rect x="0" y="70" width="100" height="30" fill="#fee2e2" opacity="0.3" /> {/* Bad (Bottom) */}
                
                {/* Line */}
                <polyline 
                    fill="none" 
                    stroke="#2563eb" 
                    strokeWidth="3" 
                    points={points} 
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
                
                {/* Dots */}
                {data.map((val, i) => {
                    const x = (i / (data.length - 1)) * 100;
                    const y = 100 - ((val - min) / (max - min)) * 100;
                    return (
                        <circle 
                            key={i} 
                            cx={`${x}%`} 
                            cy={`${y}%`} 
                            r="3" 
                            fill={val >= 7 ? '#16a34a' : val <= 4 ? '#dc2626' : '#ca8a04'} 
                            stroke="white" 
                            strokeWidth="2"
                        />
                    );
                })}
            </svg>
        </div>
    );
};

// 2. Weight Chart (New - Option A Style)
const WeightChart = ({ data }: { data: { date: string, weight: number }[] }) => {
    if (!data || data.length < 2) return <div className="h-32 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded-xl">Necesitas al menos 2 registros de peso en los últimos 6 meses.</div>;

    const weights = data.map(d => d.weight);
    const minW = Math.min(...weights) - 0.2; // Small padding
    const maxW = Math.max(...weights) + 0.2;
    const range = maxW - minW || 1; // Avoid division by zero

    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 100 - ((d.weight - minW) / range) * 100;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="relative w-full h-40 mt-6 mb-2">
            <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                 <defs>
                    <linearGradient id="weightGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2"/>
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0"/>
                    </linearGradient>
                </defs>

                {/* Grid Lines (Horizontal) */}
                <line x1="0" y1="0" x2="100" y2="0" stroke="#f1f5f9" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <line x1="0" y1="50" x2="100" y2="50" stroke="#f1f5f9" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <line x1="0" y1="100" x2="100" y2="100" stroke="#f1f5f9" strokeWidth="1" vectorEffect="non-scaling-stroke" />

                {/* Fill Area */}
                 <polygon 
                    points={`0,100 ${points} 100,100`} 
                    fill="url(#weightGradient)" 
                />

                {/* Line */}
                <polyline 
                    fill="none" 
                    stroke="#3b82f6" 
                    strokeWidth="3" 
                    points={points} 
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />

                {/* Dots & Labels */}
                {data.map((d, i) => {
                    const x = (i / (data.length - 1)) * 100;
                    const y = 100 - ((d.weight - minW) / range) * 100;
                    const isFirst = i === 0;
                    const isLast = i === data.length - 1;
                    
                    // Show dots for all, but maybe limit labels if too many points? 
                    // For now, always showing label is fine as weight is infrequent.
                    return (
                        <g key={i}>
                            <circle 
                                cx={`${x}%`} 
                                cy={`${y}%`} 
                                r={isLast ? "5" : "3.5"} 
                                fill={isLast ? "#2563eb" : "#93c5fd"} 
                                stroke="white" 
                                strokeWidth="2"
                            />
                            {/* Label above point */}
                            <text 
                                x={`${x}%`} 
                                y={`${y}%`} 
                                dy="-12" 
                                textAnchor="middle" 
                                className="text-[10px] fill-slate-500 font-bold"
                                fontSize="10" // Needed for SVG scaling
                            >
                                {d.weight}
                            </text>
                            
                            {/* Date Label below (only for start and end to avoid clutter) */}
                            {(isFirst || isLast) && (
                                 <text 
                                    x={`${x}%`} 
                                    y="100%" 
                                    dy="15" 
                                    textAnchor={isFirst ? "start" : "end"} 
                                    className="text-[9px] fill-slate-400"
                                    fontSize="8"
                                >
                                    {new Date(d.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

// 2. Heatmap Calendar (Last 30 days) - Existing
const Heatmap = ({ daysMap }: { daysMap: Record<string, number> }) => {
    // Generate last 30 days
    const days = Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        return d.toISOString().split('T')[0];
    });

    return (
        <div className="grid grid-cols-7 gap-1.5">
            {days.map(date => {
                const score = daysMap[date]; // Average score for that day, or undefined
                let colorClass = 'bg-slate-100';
                
                if (score !== undefined) {
                    if (score >= 8) colorClass = 'bg-green-500';
                    else if (score >= 6) colorClass = 'bg-lime-400';
                    else if (score >= 4) colorClass = 'bg-yellow-400';
                    else colorClass = 'bg-red-500';
                }

                const dayStr = new Date(date).getDate();

                return (
                    <div key={date} className="flex flex-col items-center">
                        <div 
                            title={`${date}: ${score || 'Sin datos'}`}
                            className={`w-full aspect-square rounded-md ${colorClass} transition-all`}
                        ></div>
                        <span className="text-[9px] text-slate-400 mt-0.5">{dayStr}</span>
                    </div>
                );
            })}
        </div>
    );
};

// 3. Donut Chart (Distribution) - Existing
const DonutChart = ({ good, regular, bad }: { good: number, regular: number, bad: number }) => {
    const total = good + regular + bad;
    if (total === 0) return <div className="h-32 flex items-center justify-center text-xs text-slate-300 bg-slate-50 rounded-full w-32 mx-auto">Sin datos</div>;

    const goodP = (good / total) * 100;
    const regP = (regular / total) * 100;
    const badP = (bad / total) * 100;

    return (
        <div className="relative w-32 h-32 mx-auto">
            <svg viewBox="0 0 32 32" className="transform -rotate-90 w-full h-full">
                <circle r="16" cx="16" cy="16" fill="transparent" stroke="#ef4444" strokeWidth="8" strokeDasharray={`100 0`} />
                <circle r="16" cx="16" cy="16" fill="transparent" stroke="#facc15" strokeWidth="8" strokeDasharray={`${regP + goodP} 100`} />
                <circle r="16" cx="16" cy="16" fill="transparent" stroke="#22c55e" strokeWidth="8" strokeDasharray={`${goodP} 100`} />
                <circle r="12" cx="16" cy="16" fill="white" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-slate-700">{total}</span>
                <span className="text-[9px] text-slate-400 uppercase">Registros</span>
            </div>
        </div>
    );
};


const DashboardView: React.FC<DashboardViewProps> = ({ settings, petId, accessToken }) => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<{
      avgScore: number,
      vomitCount: number,
      trendData: number[], // Last 14 avg scores
      heatmapData: Record<string, number>, // Date -> Avg Score
      distribution: { good: number, regular: number, bad: number },
      lastWeight: number | null,
      weightHistory: { date: string, weight: number }[] // NEW DATA
  } | null>(null);

  useEffect(() => {
      const loadDashboard = async () => {
          setLoading(true);
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 30); // 30 Days Context

          // Parallel Fetch: Dashboard events + Weight History
          const [events, weightHistory] = await Promise.all([
              searchEvents({
                  petId,
                  startDate: startDate.toISOString().split('T')[0],
                  endDate: endDate.toISOString().split('T')[0],
                  limit: 500
              }, settings, accessToken),
              getWeightHistory(settings, petId, 6, accessToken) // 6 months
          ]);

          // PROCESS DATA
          const poops = events.filter(e => e.recordType === RecordType.POOP);
          const vomits = events.filter(e => e.recordType === RecordType.VOMIT);
          const weights = events.filter(e => e.weight).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          // 1. Averages & Distribution
          let totalScore = 0;
          const dist = { good: 0, regular: 0, bad: 0 };
          const dailyScores: Record<string, {sum: number, count: number}> = {};

          poops.forEach(p => {
              const s = p.poopScore || 5; 
              totalScore += s;
              if (s >= 7) dist.good++;
              else if (s >= 5) dist.regular++;
              else dist.bad++;

              if (!dailyScores[p.date]) dailyScores[p.date] = { sum: 0, count: 0 };
              dailyScores[p.date].sum += s;
              dailyScores[p.date].count += 1;
          });

          // 2. Trend Data (Last 14 days strictly)
          const heatmap: Record<string, number> = {};
          
          Object.keys(dailyScores).forEach(date => {
              heatmap[date] = Number((dailyScores[date].sum / dailyScores[date].count).toFixed(1));
          });

          const sortedRecordedDays = Object.keys(heatmap).sort().slice(-14); 
          const cleanTrend = sortedRecordedDays.map(d => heatmap[d]);

          setMetrics({
              avgScore: poops.length > 0 ? Number((totalScore / poops.length).toFixed(1)) : 0,
              vomitCount: vomits.length,
              trendData: cleanTrend,
              heatmapData: heatmap,
              distribution: dist,
              lastWeight: weights.length > 0 ? weights[0].weight || null : null,
              weightHistory: weightHistory
          });

          setLoading(false);
      };
      loadDashboard();
  }, [petId]);

  // Calculations for Weight Header
  const weightDiff = useMemo(() => {
      if (!metrics || metrics.weightHistory.length < 2) return null;
      const first = metrics.weightHistory[0].weight;
      const last = metrics.weightHistory[metrics.weightHistory.length - 1].weight;
      const diff = last - first;
      return diff;
  }, [metrics]);

  if (loading) return <div className="h-full flex items-center justify-center bg-slate-50"><div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>;
  if (!metrics) return <div className="p-10 text-center">Sin datos.</div>;

  return (
    <div className="h-full bg-slate-50 flex flex-col">
        <header className="bg-white px-6 py-4 border-b border-slate-200 sticky top-0 z-10 shadow-sm flex justify-between items-center">
             <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Icons.Activity className="w-6 h-6 text-purple-600" />
                    Dashboard
                </h2>
                <p className="text-xs text-slate-500">Resumen de salud</p>
             </div>
             {metrics.avgScore > 0 && (
                 <div className={`px-3 py-1 rounded-full text-xs font-bold border ${metrics.avgScore >= 7 ? 'bg-green-100 text-green-700 border-green-200' : metrics.avgScore >= 5 ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                     {metrics.avgScore >= 7 ? 'Estado: Óptimo' : metrics.avgScore >= 5 ? 'Estado: Estable' : 'Estado: Atención'}
                 </div>
             )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 pb-32 space-y-4">
            
            {/* 1. KPIs */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
                    <span className="text-2xl font-bold text-slate-700 block">{metrics.avgScore || '-'}</span>
                    <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Promedio Caca</span>
                </div>
                <div className={`p-3 rounded-2xl shadow-sm border text-center ${metrics.vomitCount > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-slate-100'}`}>
                    <span className={`text-2xl font-bold block ${metrics.vomitCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>{metrics.vomitCount}</span>
                    <span className={`text-[10px] font-medium uppercase tracking-wide ${metrics.vomitCount > 0 ? 'text-red-400' : 'text-slate-400'}`}>Vómitos</span>
                </div>
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
                    <span className="text-2xl font-bold text-slate-700 block">{metrics.lastWeight || '-'} <span className="text-sm text-slate-400 font-normal">kg</span></span>
                    <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Peso Actual</span>
                </div>
            </div>

            {/* 2. NEW WEIGHT CHART (Option A) */}
             <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            Evolución Peso (6 meses)
                        </h3>
                    </div>
                    {/* Diff Indicator */}
                    {weightDiff !== null && (
                        <span className={`px-2 py-1 rounded text-xs font-bold ${weightDiff > 0 ? 'bg-green-100 text-green-700' : weightDiff < 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                            {weightDiff > 0 ? '+' : ''}{weightDiff.toFixed(1)} kg
                        </span>
                    )}
                </div>
                
                <WeightChart data={metrics.weightHistory} />
            </div>

            {/* 3. TREND CHART */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    Tendencia Digestiva (14 días)
                </h3>
                <LineChart data={metrics.trendData} />
            </div>

            {/* 4. HEATMAP & DISTRIBUTION */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Heatmap */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                     <h3 className="text-sm font-bold text-slate-700 mb-4">Calendario</h3>
                     <Heatmap daysMap={metrics.heatmapData} />
                </div>

                {/* Distribution */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 w-full text-left">Calidad (30d)</h3>
                    <div className="flex items-center gap-6">
                        <DonutChart {...metrics.distribution} />
                        <div className="space-y-2 text-xs">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded bg-green-500"></div>
                                <span className="text-slate-600">Buena ({metrics.distribution.good})</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded bg-yellow-400"></div>
                                <span className="text-slate-600">Regular ({metrics.distribution.regular})</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded bg-red-500"></div>
                                <span className="text-slate-600">Mala ({metrics.distribution.bad})</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    </div>
  );
};

export default DashboardView;
