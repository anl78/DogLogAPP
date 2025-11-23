import { DogEvent, NotionSettings, SupabaseSettings, RecordType, HealthStatus } from '../types';
import { saveEventToSupabase } from './supabaseService';
import { analyzeImage } from './geminiService';

// Proxy strategy same as notionService
const PROXIES = [
  "https://corsproxy.io/?",
  "https://thingproxy.freeboard.io/fetch/"
];

// Robust UUID Generator (Polyfill) to prevent crashes on non-secure contexts
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {
            // Fallback if crypto exists but randomUUID fails
        }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

async function fetchWithFallback(targetUrl: string, options: RequestInit): Promise<Response> {
  let lastError: any;
  // 15 seconds timeout
  const TIMEOUT_MS = 15000;

  for (const proxyBase of PROXIES) {
    try {
      const url = proxyBase + encodeURIComponent(targetUrl);
      
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);

      if (response.status === 401 || response.status === 404) return response;
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Error de conexión con Notion (Proxies fallaron o Timeout)");
}

// Convert URL to Base64 (needed for Gemini and Supabase upload)
async function urlToBase64(url: string): Promise<string> {
    try {
        const response = await fetch(url); 
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        // Fallback with proxy if direct fetch fails due to CORS
        try {
            const response = await fetchWithFallback(url, { method: 'GET' });
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.error("Error downloading image", err);
            return "";
        }
    }
}

export const startMigration = async (
    notionSettings: { apiKey: string, databaseId: string },
    supabaseSettings: SupabaseSettings,
    onProgress: (current: number, total: number, status: string) => void,
    onLog: (msg: string) => void
): Promise<{ success: boolean }> => {
    
    // Immediate log wrapper
    const log = (msg: string) => {
        const timeMsg = `[${new Date().toLocaleTimeString()}] ${msg}`;
        console.log(timeMsg);
        onLog(timeMsg);
    };

    // Clean input (remove accidental spaces)
    const apiKey = notionSettings.apiKey.trim();
    const dbId = notionSettings.databaseId.trim();

    try {
        log("Iniciando motor de migración...");
        
        // 1. Fetch all pages from Notion Database
        let allResults: any[] = [];
        let hasMore = true;
        let cursor: string | undefined = undefined;

        while (hasMore) {
            log("📡 Contactando Notion API...");
            const url = `https://api.notion.com/v1/databases/${dbId}/query`;
            const body: any = { page_size: 50 }; // Reduce page size to avoid timeouts
            if (cursor) body.start_cursor = cursor;

            const response = await fetchWithFallback(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errText = await response.text();
                // Check specifically for 401/404 to give better hints
                if (response.status === 401) throw new Error("API Key rechazada (401). Verifica la clave.");
                if (response.status === 404) throw new Error("Base de datos no encontrada (404). Verifica el ID y los permisos.");
                
                throw new Error(`Error Notion (${response.status}): ${errText}`);
            }
            
            const data = await response.json();
            allResults = [...allResults, ...data.results];
            hasMore = data.has_more;
            cursor = data.next_cursor;
            
            log(`📥 Descargados ${data.results.length} registros. Total: ${allResults.length}`);
            onProgress(allResults.length, -1, "Escaneando Notion...");
        }

        const total = allResults.length;
        log(`📋 TOTAL ENCONTRADO: ${total} registros.`);

        // 2. Process each page
        for (let i = 0; i < total; i++) {
            const page = allResults[i];
            const props = page.properties;

            // --- MAP PROPERTIES ---
            
            // Title
            const titleList = props['Título']?.title || [];
            let title = titleList.length > 0 ? titleList[0].plain_text : "Sin título";
            
            onProgress(i + 1, total, `Procesando ${i + 1}/${total}: ${title}`);

            // Record Type (Select)
            let recordTypeStr = props['Tipo de registro']?.select?.name || "Resumen";
            let recordType = Object.values(RecordType).find(r => r === recordTypeStr) || RecordType.SUMMARY;

            // Date & Time
            let dateStr = "";
            let timeStr = "";
            
            if (props['Fecha']?.date?.start) {
                const dateObj = new Date(props['Fecha'].date.start);
                dateStr = dateObj.toISOString().split('T')[0];
            }
            
            if (props['Hora']?.rich_text && props['Hora'].rich_text.length > 0) {
                timeStr = props['Hora'].rich_text[0].plain_text;
            } else if (props['Fecha']?.date?.start && props['Fecha'].date.start.includes('T')) {
                 const dateObj = new Date(props['Fecha'].date.start);
                 const hh = String(dateObj.getHours()).padStart(2, '0');
                 const mm = String(dateObj.getMinutes()).padStart(2, '0');
                 timeStr = `${hh}:${mm}`;
            }

            if (!dateStr) dateStr = new Date().toISOString().split('T')[0];
            if (!timeStr) timeStr = "12:00";

            // Description
            const descList = props['Descripción']?.rich_text || [];
            let description = descList.map((t: any) => t.plain_text).join("");

            // Health Status
            const statusStr = props['Estado de Salud']?.select?.name;
            let healthStatus = Object.values(HealthStatus).find(s => s === statusStr) || null;

            // Weight
            const weight = props['Peso']?.number || undefined;

            // Files / Photos
            let photoBase64: string | undefined = undefined;
            const files = props['Foto']?.files || props['Archivos']?.files || [];
            
            if (files.length > 0) {
                const fileUrl = files[0].file?.url || files[0].external?.url;
                if (fileUrl) {
                    log(`   📸 Descargando foto...`);
                    photoBase64 = await urlToBase64(fileUrl);
                }
            }

            // --- AI ENRICHMENT ---
            if (!description && photoBase64) {
                log(`   ✨ Analizando con IA (falta descripción)...`);
                try {
                    const aiResult = await analyzeImage(photoBase64);
                    description = `[IA] ${aiResult.description}`;
                    if (title === "Sin título") title = aiResult.title;
                    if (!healthStatus) healthStatus = aiResult.healthStatus || null;
                } catch (e) {
                    log(`   ⚠️ IA falló: ${e}`);
                    description = "Imagen migrada (IA falló al describir).";
                }
            }

            // --- BUILD EVENT ---
            // CRITICAL: Use robust ID generator, NOT crypto.randomUUID directly
            const newEvent: DogEvent = {
                id: generateUUID(), 
                title,
                recordType: recordType as RecordType,
                date: dateStr,
                time: timeStr,
                description,
                healthStatus: healthStatus as HealthStatus,
                weight,
                photoBase64,
                synced: false
            };

            // --- SAVE TO SUPABASE ---
            const saveResult = await saveEventToSupabase(newEvent, supabaseSettings);
            
            if (!saveResult.success) {
                log(`   ❌ Error Supabase: ${saveResult.error}`);
            }
        }

        log("✅ Migración completada.");
        return { success: true };

    } catch (error: any) {
        log(`❌ Error CRÍTICO Migración: ${error.message}`);
        console.error(error);
        return { success: false };
    }
};