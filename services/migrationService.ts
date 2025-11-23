import { DogEvent, SupabaseSettings, RecordType, HealthStatus } from '../types';
import { saveEventToSupabase } from './supabaseService';
import { createClient } from '@supabase/supabase-js';

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

// --- NEW MASS DELETE FUNCTION ---
export const deleteMigratedEvents = async (
    supabaseSettings: SupabaseSettings,
    filters: { startDate?: string, endDate?: string },
    onLog: (msg: string) => void
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);
    
    // Create direct client
    const client = createClient(supabaseSettings.supabaseUrl, supabaseSettings.supabaseKey);

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
    onLog: (msg: string) => void
): Promise<void> => {
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);
    const client = createClient(settings.supabaseUrl, settings.supabaseKey);

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


// --- MIGRATION FUNCTION ---
export const startMigration = async (
    notionSettings: { apiKey: string, databaseId: string },
    supabaseSettings: SupabaseSettings,
    filters: { startDate?: string, endDate?: string },
    onProgress: (current: number, total: number, status: string) => void,
    onLog: (msg: string) => void
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
            // We read the RAW strings from Notion. We do NOT use new Date() to parse them.
            
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
            // Description stays as is.

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

            const saveResult = await saveEventToSupabase(newEvent, supabaseSettings);
            
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