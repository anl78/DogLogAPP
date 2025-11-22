import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DogEvent, SupabaseSettings, ConnectionResult, EventSearchParams, RecordType } from '../types';

// Helper to create a fresh client every time to avoid stale auth/config
const createFreshClient = (settings: SupabaseSettings): SupabaseClient | null => {
  let cleanUrl = settings.supabaseUrl.trim();
  // Ensure protocol
  if (!cleanUrl.startsWith('http')) {
    cleanUrl = `https://${cleanUrl}`;
  }
  // Remove trailing slash
  cleanUrl = cleanUrl.replace(/\/$/, "");

  if (cleanUrl && settings.supabaseKey) {
    try {
        return createClient(cleanUrl, settings.supabaseKey, {
          auth: {
            persistSession: false
          }
        });
    } catch (e) {
        console.error("Client creation failed:", e);
        return null;
    }
  }
  return null;
};

const base64ToBlob = (base64: string, mimeType: string = 'image/jpeg'): Blob => {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
};

export const testSupabaseConnection = async (settings: SupabaseSettings): Promise<ConnectionResult> => {
    try {
        if (!settings.supabaseUrl || !settings.supabaseKey) {
            return { success: false, message: "Faltan credenciales." };
        }
        const client = createFreshClient(settings);
        if (!client) return { success: false, message: "URL inválida." };
        
        // 1. Basic Connection Check (Just try to read 1 row)
        const { data, error: basicError } = await client.from('events').select('id').limit(1);
        
        if (basicError) {
            const errString = JSON.stringify(basicError);
            console.error("Connection check failed:", errString);
            
            if (basicError.code === '42P01') {
                return { success: false, message: "La tabla 'events' no existe. Ejecuta el Script V9." };
            }
            return { success: false, message: `Error Supabase (${basicError.code}): ${basicError.message || errString}` };
        }

        return { success: true, message: "✅ Conexión establecida. Tabla 'events' accesible." };

    } catch (e: any) {
        return { success: false, message: `Error de Red/Cliente: ${e.message}` };
    }
};

export const saveEventToSupabase = async (event: DogEvent, settings: SupabaseSettings): Promise<{ success: boolean; error?: string; photoUrl?: string; newId?: string }> => {
    const client = createFreshClient(settings);
    if (!client) return { success: false, error: "Error iniciando cliente Supabase." };

    let publicPhotoUrl = null;

    // 1. Upload Photo (Soft fail)
    if (event.photoBase64) {
        try {
            const blob = base64ToBlob(event.photoBase64);
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            
            const { error: uploadError } = await client.storage
                .from('dog_photos')
                .upload(fileName, blob, { contentType: 'image/jpeg' });

            if (!uploadError) {
                const { data: urlData } = client.storage.from('dog_photos').getPublicUrl(fileName);
                publicPhotoUrl = urlData.publicUrl;
            } else {
                console.warn("Upload failed:", uploadError);
            }
        } catch (err) {
            console.error("Photo upload crash:", err);
        }
    }

    // 2. Insert Record (using Upsert to handle edits if ID exists)
    try {
        // Strict Time Format HH:mm:ss
        let cleanTime = event.time;
        if (cleanTime.length === 5) cleanTime += ":00";

        const payload = {
            id: event.id, 
            title: event.title,
            record_type: event.recordType, // Now checked against Foreign Key
            date: event.date,
            time: cleanTime,
            health_status: event.healthStatus || null,
            weight: (event.weight !== undefined && event.weight !== null && !isNaN(Number(event.weight))) ? Number(event.weight) : null,
            description: event.description,
            // Only update photo_url if we uploaded a new one, otherwise keep existing logic handled by DB if undefined? 
            // Actually, upsert replaces the row. We should only include photo_url if we have a new one, 
            // OR if we want to keep the old one we need to fetch it first. 
            // However, for simplicity in this app, if we don't upload a new photo, we might pass the existing URL if available in event object.
            photo_url: publicPhotoUrl || event.photoUrl
        };

        const { data, error: insertError } = await client
            .from('events')
            .upsert(payload) // Changed from insert to upsert
            .select()
            .single();

        if (insertError) {
            const msg = insertError.message || JSON.stringify(insertError);
            
            // Handle Foreign Key Violation
            if (insertError.code === '23503') {
                return { success: false, error: `Datos inválidos: El Tipo de Registro o Estado no existen en la base de datos. (Error FK: ${insertError.details})` };
            }

            return { success: false, error: `DB Error (${insertError.code}): ${msg}` };
        }

        return { success: true, photoUrl: publicPhotoUrl || undefined, newId: data?.id };
    } catch (err: any) {
        return { success: false, error: `App Error: ${err.message}` };
    }
};

export const searchEvents = async (params: EventSearchParams, settings: SupabaseSettings): Promise<DogEvent[]> => {
    const client = createFreshClient(settings);
    if (!client) return [];

    let query = client.from('events').select('*');

    if (params.recordType) {
        query = query.eq('record_type', params.recordType);
    }
    
    if (params.startDate) {
        query = query.gte('date', params.startDate);
    }
    
    if (params.endDate) {
        query = query.lte('date', params.endDate);
    }

    // Always newest first
    query = query.order('date', { ascending: false }).order('time', { ascending: false });

    if (params.limit) {
        query = query.limit(params.limit);
    } else {
        query = query.limit(20); // Safety limit
    }

    const { data, error } = await query;

    if (error) {
        console.error("Search Error:", error);
        throw new Error(error.message);
    }

    // Map back to DogEvent structure (snake_case to camelCase)
    return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        recordType: row.record_type as RecordType,
        date: row.date,
        time: row.time.substring(0, 5), // HH:mm
        healthStatus: row.health_status,
        weight: row.weight,
        description: row.description,
        photoUrl: row.photo_url,
        synced: true
    }));
};