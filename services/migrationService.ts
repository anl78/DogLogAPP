
import { DogEvent, SupabaseSettings, RecordType, HealthStatus } from '../types';
import { saveEventToSupabase } from './supabaseService';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";

// Need to duplicate this to avoid circular dependencies if getApiKey is in geminiService which imports supabaseService
// Best practice: Extract this helper to a 'config.ts' or 'authService.ts', but for now duplicating logic.
async function getGeminiApiKeyInternal(settings: SupabaseSettings, accessToken?: string): Promise<string> {
    // 1. Try Production Env Var (Vercel)
    try {
        // @ts-ignore
        const envKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (envKey && envKey.length > 10) return envKey;
    } catch (e) {
        // Ignore error if env not available
    }

    // 2. Fallback: Fetch from Supabase DB (Development / Local)
    const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
        global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
    });

    const { data } = await client
        .from('app_secrets')
        .select('value')
        .eq('key_name', 'GEMINI_API_KEY')
        .single();

    if (!data?.value) {
        throw new Error("Missing Gemini Key");
    }
    return data.value;
}


// Proxy strategy same as notionService
const PROXIES = [
  "https://corsproxy.io/?",
  "https://thingproxy.freeboard.io/fetch/"
];

// Robust UUID Generator (Polyfill)
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

async function fetchWithFallback(targetUrl: string, options: RequestInit): Promise<Response> {
  let lastError: any;
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

// Helper to compress Blob
const compressBlob = (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
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
                    resolve(blob);
                    return;
                }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                canvas.toBlob((newBlob) => {
                    if (newBlob) resolve(newBlob);
                    else resolve(blob);
                }, 'image/jpeg', 0.7); // 70% Quality
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

// --- NEW MASS DELETE FUNCTION ---
export const deleteMigratedEvents = async (
    supabaseSettings: SupabaseSettings,
    filters: { startDate?: string, endDate?: string },
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);
    
    // Create authenticated client
    const client = createClient(supabaseSettings.supabaseUrl, supabaseSettings.supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
    });

    log("🔍 Buscando eventos para borrar...");

    // Build Query
    let query = client.from('events').select('id, photo_url');
    if (filters.startDate) query = query.gte('date', filters.startDate);
    if (filters.endDate) query = query.lte('date', filters.endDate);

    const { data: events, error } = await query;

    if (error) throw new Error(`Error buscando eventos: ${error.message}`);
    if (!events || events.length === 0) {
        log("⚠️ No se encontraron eventos en ese rango.");
        return;
    }

    log(`🗑️ Encontrados ${events.length} registros. Procesando borrado...`);

    // 1. Collect all photo files to delete
    const filesToDelete: string[] = [];
    events.forEach((ev: any) => {
        if (ev.photo_url) {
            const parts = ev.photo_url.split('/');
            const fileName = parts[parts.length - 1];
            if (fileName) filesToDelete.push(fileName);
        }
    });

    // 2. Delete from Storage (in batches of 50 just in case)
    if (filesToDelete.length > 0) {
        log(`📸 Borrando ${filesToDelete.length} fotos del almacenamiento...`);
        // Supabase storage remove accepts array of strings
        const { error: storageError } = await client.storage
            .from('dog_photos')
            .remove(filesToDelete);
        
        if (storageError) log(`⚠️ Error borrando fotos: ${storageError.message}`);
        else log("✅ Fotos eliminadas.");
    }

    // 3. Delete Rows
    log("🗄️ Borrando filas de la base de datos...");
    const idsToDelete = events.map((ev: any) => ev.id);
    const { error: deleteError } = await client
        .from('events')
        .delete()
        .in('id', idsToDelete);

    if (deleteError) throw new Error(`Error borrando filas: ${deleteError.message}`);

    log("✅ Base de datos limpiada con éxito.");
};


// --- ORPHAN RESCUE FUNCTION ---
export const assignOrphanEvents = async (
    settings: SupabaseSettings,
    targetUserId: string,
    targetPetId: string,
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);
    // Create authenticated client
    const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
    });

    log(`🔍 Buscando eventos huérfanos (sin usuario o mascota)...`);

    // Find orphans (rows where user_id IS NULL OR pet_id IS NULL)
    // Note: Supabase JS syntax for OR filters is specific
    const { data: orphans, error: searchError } = await client
        .from('events')
        .select('id')
        .or('user_id.is.null,pet_id.is.null');

    if (searchError) throw new Error(`Error buscando huérfanos: ${searchError.message}`);
    
    if (!orphans || orphans.length === 0) {
        log("✅ No hay eventos huérfanos. Todo está asignado.");
        return;
    }

    log(`⚠️ Encontrados ${orphans.length} eventos sin asignar.`);
    log(`🔄 Asignando a Usuario: ...${targetUserId.slice(-5)} y Mascota ID: ...${targetPetId.slice(-5)}...`);

    // Update matching rows
    const { error: updateError } = await client
        .from('events')
        .update({ 
            user_id: targetUserId, 
            pet_id: targetPetId 
        })
        .or('user_id.is.null,pet_id.is.null');

    if (updateError) throw new Error(`Error actualizando: ${updateError.message}`);

    log(`🎉 ¡Éxito! Se han rescatado y asignado ${orphans.length} eventos.`);
};

// --- OPTIMIZATION FUNCTION (COMPRESS EXISTING) ---
export const optimizeExistingPhotos = async (
    settings: SupabaseSettings,
    onProgress: (current: number, total: number, msg: string) => void,
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);
    
    // Authenticate Client to pass RLS (Use explicit config to avoid local storage conflicts)
    const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
        }
    });

    log("🔍 Buscando eventos con fotos...");
    
    const { data: events, error } = await client
        .from('events')
        .select('id, title, photo_url')
        .not('photo_url', 'is', null);

    if (error) throw new Error(error.message);
    
    if (!events || events.length === 0) {
        log("✅ No hay fotos para optimizar.");
        return;
    }

    const total = events.length;
    log(`📸 Encontradas ${total} fotos. Iniciando análisis...`);
    
    let compressedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < total; i++) {
        const ev = events[i];
        const url = ev.photo_url!;
        
        onProgress(i + 1, total, `Procesando: ${ev.title}`);

        try {
            // 1. Download
            const response = await fetch(url);
            if (!response.ok) {
                log(`⚠️ Error descargando foto de: ${ev.title} (Status ${response.status})`);
                errorCount++;
                continue;
            }
            const blob = await response.blob();
            const sizeKB = blob.size / 1024;

            // 2. Check Size (Skip if < 150KB)
            if (sizeKB < 150) {
                // log(`⏩ ${ev.title}: Pequeña (${Math.round(sizeKB)}KB). Saltando.`);
                skippedCount++;
                continue;
            }

            // 3. Compress
            log(`📉 Comprimiendo ${ev.title} (${Math.round(sizeKB)}KB)...`);
            const compressedBlob = await compressBlob(blob);
            const newSizeKB = compressedBlob.size / 1024;

            // 4. Upload (Overwrite)
            // Extract filename from URL
            // URL format: .../storage/v1/object/public/dog_photos/uuid/filename.jpg
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/dog_photos/'); // Split by bucket name
            if (pathParts.length < 2) {
                log(`⚠️ No pude extraer ruta de: ${url}`);
                errorCount++;
                continue;
            }
            const storagePath = decodeURIComponent(pathParts[1]); // e.g. "pet_id/timestamp.jpg"

            // Attempt 1: Standard Upsert
            const { error: uploadError } = await client.storage
                .from('dog_photos')
                .upload(storagePath, compressedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true 
                });

            if (uploadError) {
                // Handle RLS Violation: Policy might allow Insert/Delete but not Update.
                // Fallback: Delete original -> Upload new
                const isRlsError = (uploadError as any).code === '42501' || uploadError.message.includes('row-level security');
                
                if (isRlsError) {
                    log(`⚠️ Upsert bloqueado por RLS. Intentando reemplazo (Borrar -> Subir)...`);
                    
                    const { error: removeError } = await client.storage.from('dog_photos').remove([storagePath]);
                    if (removeError) {
                        log(`❌ Falló borrado previo: ${removeError.message}`);
                        errorCount++;
                        continue;
                    }

                    const { error: retryError } = await client.storage
                        .from('dog_photos')
                        .upload(storagePath, compressedBlob, {
                            contentType: 'image/jpeg',
                            upsert: false // Now it's a fresh insert
                        });

                    if (retryError) {
                        log(`❌ Falló la re-subida: ${retryError.message}`);
                        errorCount++;
                        continue;
                    } else {
                        const saving = Math.round(((sizeKB - newSizeKB) / sizeKB) * 100);
                        log(`✅ Optimizado (vía Reemplazo): ${Math.round(newSizeKB)}KB (Ahorro: ${saving}%)`);
                        compressedCount++;
                    }
                } else {
                    log(`❌ Error subiendo: ${uploadError.message}`);
                    errorCount++;
                }
            } else {
                const saving = Math.round(((sizeKB - newSizeKB) / sizeKB) * 100);
                log(`✅ Optimizado: ${Math.round(newSizeKB)}KB (Ahorro: ${saving}%)`);
                compressedCount++;
            }

        } catch (e: any) {
            log(`❌ Excepción en ${ev.title}: ${e.message}`);
            errorCount++;
        }
    }

    log(`🏁 FINALIZADO. Comprimidas: ${compressedCount}, Saltadas: ${skippedCount}, Errores: ${errorCount}`);
};

// Helper to clean JSON string from Markdown
function cleanJsonString(str: string): string {
    if (!str) return "{}";
    let cleaned = str.trim();
    // Remove markdown code blocks if present
    if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    return cleaned;
}

// --- NEW FUNCTION: BATCH SCORE POOPS ---
export const batchScorePoops = async (
    settings: SupabaseSettings,
    onProgress: (current: number, total: number, msg: string) => void,
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);

    try {
        const apiKey = await getGeminiApiKeyInternal(settings, accessToken);
        const ai = new GoogleGenAI({ apiKey });

        // Create client
        const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
            global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
        });

        // CHANGED: Limited to last 15 unscored items for micro-batch processing
        log("🔍 Buscando últimas 15 'Cacas' sin puntuación...");

        const { data: events, error } = await client
            .from('events')
            .select('id, title, description, photo_url, date')
            .eq('record_type', 'Caca')
            .is('poop_score', null)
            .order('date', { ascending: false }) // Process newest first (chipping away at recent history)
            .limit(15);

        if (error) throw new Error(error.message);

        if (!events || events.length === 0) {
            log("✅ No hay más registros pendientes (o has completado el lote).");
            return;
        }

        const total = events.length;
        log(`📋 Lote encontrado: ${total} registros. Usando Gemini 1.5 Flash...`);

        let updatedCount = 0;
        let failureCount = 0;

        for (let i = 0; i < total; i++) {
            const ev = events[i];
            onProgress(i + 1, total, `Puntuando (${i+1}/${total}): ${ev.title}`);

            try {
                // Determine content for AI
                const prompt = `Analiza este registro de heces de perro y asigna una puntuación del 1 al 10 (1=Diarrea grave, 10=Perfecta). 
                Solo devuelve el JSON puro: {"score": number}.
                Título: ${ev.title}. Descripción: ${ev.description || "N/A"}.`;

                const parts: any[] = [{ text: prompt }];

                // Try to add image if exists
                if (ev.photo_url) {
                    try {
                        const imgBase64 = await urlToBase64(ev.photo_url);
                        if (imgBase64 && imgBase64.length > 100) {
                            parts.push({
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: imgBase64.split(',')[1]
                                }
                            });
                        }
                    } catch (imgErr) {
                        // Fail gracefully on image, continue with text
                        log(`⚠️ Imagen falló en ${ev.title}, usando solo texto.`);
                    }
                }

                // Call Gemini with RETRIES
                let resultText = "";
                let success = false;
                
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        // CHANGED: Use gemini-1.5-flash for stability/limits
                        const response = await ai.models.generateContent({
                            model: 'gemini-1.5-flash',
                            contents: { parts },
                            config: {
                                responseMimeType: 'application/json',
                                responseSchema: {
                                    type: Type.OBJECT,
                                    properties: {
                                        score: { type: Type.INTEGER }
                                    }
                                }
                            }
                        });
                        resultText = response.text || "";
                        if (resultText) {
                            success = true;
                            break;
                        }
                    } catch (err: any) {
                        const isRateLimit = err.message?.includes('429') || err.status === 429;
                        if (attempt < 2) {
                            // Backoff: 2s, 4s
                            const delay = (attempt + 1) * 2000;
                            if (isRateLimit) log(`⏳ Rate limit. Esperando ${delay}ms...`);
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }

                if (!success || !resultText) {
                    failureCount++;
                    continue; // Skip this event
                }

                const cleanedText = cleanJsonString(resultText);
                const result = JSON.parse(cleanedText);
                
                if (result.score) {
                    // Update DB
                    const { error: updateError } = await client
                        .from('events')
                        .update({ poop_score: result.score })
                        .eq('id', ev.id);
                    
                    if (updateError) {
                        log(`❌ Error guardando score para ${ev.title}: ${updateError.message}`);
                        failureCount++;
                    } else {
                        updatedCount++;
                    }
                } else {
                    failureCount++;
                }

                // CHANGED: Increased delay to 5 seconds to be safe with rate limits
                await new Promise(r => setTimeout(r, 5000)); 

            } catch (e: any) {
                log(`❌ Error procesando ${ev.title}: ${e.message}`);
                failureCount++;
            }
        }

        log(`🏁 LOTE FINALIZADO. Puntuados: ${updatedCount}/${total}.`);

    } catch (e: any) {
        log(`❌ Error General: ${e.message}`);
    }
};


// --- MIGRATION FUNCTION ---
export const startMigration = async (
    notionSettings: { apiKey: string, databaseId: string },
    supabaseSettings: SupabaseSettings,
    filters: { startDate?: string, endDate?: string },
    onProgress: (current: number, total: number, status: string) => void,
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<{ success: boolean }> => {
    
    const log = (msg: string) => {
        const timeMsg = `[${new Date().toLocaleTimeString()}] ${msg}`;
        console.log(timeMsg);
        onLog(timeMsg);
    };

    const apiKey = notionSettings.apiKey.trim();
    const dbId = notionSettings.databaseId.trim();

    try {
        log("⚙️ Preparando consulta a Notion...");
        
        let allResults: any[] = [];
        let hasMore = true;
        let cursor: string | undefined = undefined;

        // Construct Notion Filter Object
        const notionFilters: any[] = [];
        if (filters.startDate) {
            notionFilters.push({ property: "Fecha", date: { on_or_after: filters.startDate } });
        }
        if (filters.endDate) {
            notionFilters.push({ property: "Fecha", date: { on_or_before: filters.endDate } });
        }

        const filterPayload = notionFilters.length > 0 
            ? (notionFilters.length === 1 ? notionFilters[0] : { and: notionFilters }) 
            : undefined;

        if (filterPayload) {
            log(`🔎 Aplicando filtro Notion: ${JSON.stringify(filterPayload)}`);
        }

        // 1. Fetch Loop
        while (hasMore) {
            const url = `https://api.notion.com/v1/databases/${dbId}/query`;
            const body: any = { 
                page_size: 50,
                filter: filterPayload
            };
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
                throw new Error(`Error Notion (${response.status}): ${errText}`);
            }
            
            const data = await response.json();
            allResults = [...allResults, ...data.results];
            hasMore = data.has_more;
            cursor = data.next_cursor;
            
            onProgress(allResults.length, -1, `Descargando: ${allResults.length} encontrados...`);
        }

        const total = allResults.length;
        log(`📋 TOTAL A PROCESAR: ${total} registros.`);

        if (total === 0) {
            log("⚠️ No se encontraron registros con esos filtros.");
            return { success: true };
        }

        // 2. Process
        for (let i = 0; i < total; i++) {
            const page = allResults[i];
            const props = page.properties;

            // Title
            const titleList = props['Título']?.title || [];
            let title = titleList.length > 0 ? titleList[0].plain_text : "Sin título";
            
            onProgress(i + 1, total, `Migrando ${i + 1}/${total}: ${title}`);

            // Type
            let recordTypeStr = props['Tipo de registro']?.select?.name || "Resumen";
            let recordType = Object.values(RecordType).find(r => r === recordTypeStr) || RecordType.SUMMARY;

            // --- STRICT DATE/TIME PARSING (Fixing Timezone Issues) ---
            
            // 1. Date: Notion returns "YYYY-MM-DD" in date.start
            let dateStr = props['Fecha']?.date?.start || "";
            
            // 2. Time: Search in 'Hora' Text Column
            let timeStr = "";
            const horaRichText = props['Hora']?.rich_text;
            if (horaRichText && horaRichText.length > 0) {
                // Assuming format "HH:mm" in text
                timeStr = horaRichText[0].plain_text.trim();
            }

            // Fallbacks
            if (!dateStr) dateStr = new Date().toISOString().split('T')[0]; // Only if missing
            if (!timeStr) timeStr = "12:00"; // Default noon if missing

            // Description
            const descList = props['Descripción']?.rich_text || [];
            let description = descList.map((t: any) => t.plain_text).join("");

            // Health
            const statusStr = props['Estado de Salud']?.select?.name;
            let healthStatus = Object.values(HealthStatus).find(s => s === statusStr) || null;

            // Weight
            const weight = props['Peso']?.number || undefined;

            // Photo
            let photoBase64: string | undefined = undefined;
            const files = props['Foto']?.files || props['Archivos']?.files || [];
            
            if (files.length > 0) {
                const fileUrl = files[0].file?.url || files[0].external?.url;
                if (fileUrl) {
                    log(`   📸 Descargando foto...`);
                    photoBase64 = await urlToBase64(fileUrl);
                }
            }

            // --- NO AI ---

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

            // Pass accessToken to ensure ownership is correctly assigned (if implicit in backend trigger) 
            // and RLS allows insert.
            const saveResult = await saveEventToSupabase(newEvent, supabaseSettings, accessToken);
            
            if (!saveResult.success) {
                log(`   ❌ Error guardando: ${saveResult.error}`);
            }
        }

        log("✅ Migración completada exitosamente.");
        return { success: true };

    } catch (error: any) {
        log(`❌ Error CRÍTICO Migración: ${error.message}`);
        return { success: false };
    }
};
