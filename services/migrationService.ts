
import { DogEvent, SupabaseSettings, RecordType, HealthStatus } from '../types';
import { saveEventToSupabase } from './supabaseService';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";

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

// --- NEW FUNCTION: START MIGRATION ---
export const startMigration = async (
    notionSettings: { apiKey: string, databaseId: string },
    supabaseSettings: SupabaseSettings,
    filters: { startDate?: string, endDate?: string },
    onProgress: (current: number, total: number, msg: string) => void,
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);
    log("🚀 Iniciando conexión con Notion...");

    if (!notionSettings.apiKey || !notionSettings.databaseId) {
        throw new Error("Faltan credenciales de Notion.");
    }

    // 1. Fetch Notion Data
    let pages: any[] = [];
    let cursor: string | undefined = undefined;
    let hasMore = true;

    // Build Notion Filter
    const notionFilter: any = { and: [] };
    if (filters.startDate) {
        notionFilter.and.push({ property: "Fecha", date: { on_or_after: filters.startDate } });
    }
    if (filters.endDate) {
        notionFilter.and.push({ property: "Fecha", date: { on_or_before: filters.endDate } });
    }
    const filterPayload = notionFilter.and.length > 0 ? notionFilter : undefined;

    while (hasMore) {
        const url = `https://api.notion.com/v1/databases/${notionSettings.databaseId}/query`;
        try {
            const response = await fetchWithFallback(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${notionSettings.apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    page_size: 100,
                    start_cursor: cursor,
                    filter: filterPayload
                })
            });

            if (!response.ok) {
                let errMsg = response.statusText;
                try {
                    const errBody = await response.json();
                    errMsg = errBody.message || errMsg;
                } catch(e) {}
                throw new Error(`Error Notion (${response.status}): ${errMsg}`);
            }

            const data = await response.json();
            pages = [...pages, ...data.results];
            cursor = data.next_cursor || undefined; 
            hasMore = data.has_more;
            
            onProgress(pages.length, 0, `Recuperando de Notion: ${pages.length} encontrados...`);
        } catch (e: any) {
            throw new Error(`Fallo al conectar con Notion: ${e.message}`);
        }
    }

    if (pages.length === 0) {
        log("⚠️ No se encontraron entradas en Notion para migrar.");
        return;
    }

    log(`📦 Se procesarán ${pages.length} entradas.`);

    // 2. Setup Supabase Client
    const client = createClient(supabaseSettings.supabaseUrl, supabaseSettings.supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
    });

    // 3. Process Pages
    let migrated = 0;
    let errors = 0;
    const total = pages.length;

    for (let i = 0; i < total; i++) {
        const page = pages[i];
        const props = page.properties;
        
        try {
            // Map Properties
            const title = props["Título"]?.title?.[0]?.plain_text || "Evento sin título";
            const date = props["Fecha"]?.date?.start || null;
            
            let time = props["Hora"]?.rich_text?.[0]?.plain_text || "00:00";
            if (!time.includes(':')) time = "00:00";
            if (time.length === 4) time = "0" + time; 

            const recordType = props["Tipo de registro"]?.select?.name || "Resumen";
            const healthStatus = props["Estado de Salud"]?.select?.name || null;
            const description = props["Descripción"]?.rich_text?.[0]?.plain_text || "";
            const weight = props["Peso"]?.number || null;

            if (!date) {
                continue;
            }

            const payload: any = {
                id: page.id, // IDempotency using Notion UUID
                title: title,
                record_type: recordType,
                date: date,
                time: time,
                health_status: healthStatus,
                description: description,
                weight: weight
            };

            const { error } = await client.from('events').upsert(payload);

            if (error) {
                log(`❌ Error insertando "${title}": ${error.message}`);
                errors++;
            } else {
                migrated++;
            }
            
            if (i % 5 === 0) onProgress(i + 1, total, `Migrando: ${title}`);

        } catch (e: any) {
            log(`❌ Excepción en "${pages[i].id}": ${e.message}`);
            errors++;
        }
    }

    log(`🏁 MIGRACIÓN COMPLETADA. Importados: ${migrated}, Errores: ${errors}.`);
    if (migrated > 0) {
        log("💡 RECOMENDACIÓN: Ejecuta 'Asignar Huérfanos' para vincular estos eventos a tu usuario/mascota.");
    }
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
    
    // Authenticate Client to pass RLS
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
                skippedCount++;
                continue;
            }

            // 3. Compress
            log(`📉 Comprimiendo ${ev.title} (${Math.round(sizeKB)}KB)...`);
            const compressedBlob = await compressBlob(blob);
            const newSizeKB = compressedBlob.size / 1024;

            // 4. Upload (Overwrite)
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/dog_photos/'); 
            if (pathParts.length < 2) {
                log(`⚠️ No pude extraer ruta de: ${url}`);
                errorCount++;
                continue;
            }
            const storagePath = decodeURIComponent(pathParts[1]); 

            const { error: uploadError } = await client.storage
                .from('dog_photos')
                .upload(storagePath, compressedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true 
                });

            if (uploadError) {
                const isRlsError = (uploadError as any).code === '42501' || uploadError.message.includes('row-level security');
                
                if (isRlsError) {
                    log(`⚠️ Upsert bloqueado por RLS. Intentando reemplazo...`);
                    
                    await client.storage.from('dog_photos').remove([storagePath]);
                    const { error: retryError } = await client.storage
                        .from('dog_photos')
                        .upload(storagePath, compressedBlob, {
                            contentType: 'image/jpeg',
                            upsert: false 
                        });

                    if (retryError) {
                        log(`❌ Falló la re-subida: ${retryError.message}`);
                        errorCount++;
                    } else {
                        compressedCount++;
                    }
                } else {
                    log(`❌ Error subiendo: ${uploadError.message}`);
                    errorCount++;
                }
            } else {
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
    if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    return cleaned;
}

// --- NEW FUNCTION: BATCH SCORE POOPS (FOLLOWING GUIDELINES) ---
export const batchScorePoops = async (
    settings: SupabaseSettings,
    onProgress: (current: number, total: number, msg: string) => void,
    onLog: (msg: string) => void,
    accessToken?: string
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);

    try {
        // Initialize Gemini using process.env.API_KEY as mandated
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // Create client
        const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
            global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
        });

        log("🔍 Buscando últimas 15 'Cacas' sin puntuación...");

        const { data: events, error } = await client
            .from('events')
            .select('id, title, description, photo_url, date')
            .eq('record_type', 'Caca')
            .is('poop_score', null)
            .order('date', { ascending: false })
            .limit(15);

        if (error) throw new Error(error.message);

        if (!events || events.length === 0) {
            log("✅ No hay más registros pendientes.");
            return;
        }

        const total = events.length;
        log(`📋 Lote encontrado: ${total} registros.`);

        let updatedCount = 0;
        let failureCount = 0;

        for (let i = 0; i < total; i++) {
            const ev = events[i];
            onProgress(i + 1, total, `Puntuando (${i+1}/${total}): ${ev.title}`);

            try {
                const prompt = `Analiza este registro de heces de perro y asigna una puntuación del 1 al 10 (1=Diarrea grave, 10=Perfecta). 
                Solo devuelve el JSON puro: {"score": number}.
                Título: ${ev.title}. Descripción: ${ev.description || "N/A"}.`;

                const parts: any[] = [{ text: prompt }];

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
                        log(`⚠️ Imagen falló en ${ev.title}, usando solo texto.`);
                    }
                }

                // Call GenAI directly using ai.models.generateContent and preferred model
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: { parts },
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                score: { type: Type.INTEGER }
                            },
                            required: ["score"]
                        }
                    }
                });

                // Correct text property access
                const resultText = response.text || "";
                if (!resultText) {
                    failureCount++;
                    continue;
                }

                const cleanedText = cleanJsonString(resultText);
                const result = JSON.parse(cleanedText);
                
                if (result.score) {
                    const { error: updateError } = await client
                        .from('events')
                        .update({ poop_score: result.score })
                        .eq('id', ev.id);
                    
                    if (updateError) {
                        failureCount++;
                    } else {
                        updatedCount++;
                    }
                } else {
                    failureCount++;
                }

                // Small delay to respect rate limits
                await new Promise(r => setTimeout(r, 1000)); 

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
