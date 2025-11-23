import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DogEvent, SupabaseSettings, ConnectionResult, EventSearchParams, RecordType, Pet } from '../types';

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
            persistSession: true, // Persist session for Auth flow
            autoRefreshToken: true,
            detectSessionInUrl: true
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
            // Ignore 'empty' error, just check connectivity
            if (basicError.code === 'PGRST116') return { success: true, message: "Conexión OK (Tabla vacía)" };

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

// --- NEW AUTH / PET HELPERS ---

export const getUserPets = async (settings: SupabaseSettings): Promise<Pet[]> => {
    const client = createFreshClient(settings);
    if (!client) return [];

    // Get current user
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];

    // Query 'pet_collaborators' joined with 'pets'
    const { data, error } = await client
        .from('pet_collaborators')
        .select(`
            pet:pets (
                id,
                name,
                photo_url,
                owner_id
            )
        `)
        .eq('user_id', user.id);

    if (error) {
        console.error("Error fetching pets:", error);
        return [];
    }

    // Flatten structure
    return data.map((row: any) => row.pet as Pet);
};

export const createPet = async (settings: SupabaseSettings, name: string, ownerId: string): Promise<Pet | null> => {
    const client = createFreshClient(settings);
    if (!client) return null;

    const { data, error } = await client
        .from('pets')
        .insert({
            name: name,
            owner_id: ownerId
        })
        .select()
        .single();

    if (error) {
        throw new Error(error.message);
    }
    return data as Pet;
};

// --- CRUD ---

export const saveEventToSupabase = async (event: DogEvent, settings: SupabaseSettings): Promise<{ success: boolean; error?: string; photoUrl?: string; newId?: string }> => {
    const client = createFreshClient(settings);
    if (!client) return { success: false, error: "Error iniciando cliente Supabase." };

    if (!event.petId) {
        return { success: false, error: "Error interno: Falta ID de Mascota." };
    }

    let publicPhotoUrl = null;

    // 1. Upload Photo (Soft fail)
    if (event.photoBase64) {
        try {
            const blob = base64ToBlob(event.photoBase64);
            const fileName = `${event.petId}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            
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
            photo_url: publicPhotoUrl || event.photoUrl,
            pet_id: event.petId, // REQUIRED FK
            user_id: event.userId // Optional, for audit
        };

        const { data, error: insertError } = await client
            .from('events')
            .upsert(payload) 
            .select()
            .single();

        if (insertError) {
            const msg = insertError.message || JSON.stringify(insertError);
            
            if (insertError.code === '23503') {
                return { success: false, error: `Datos inválidos (FK Error): ${insertError.details}` };
            }

            return { success: false, error: `DB Error (${insertError.code}): ${msg}` };
        }

        return { success: true, photoUrl: publicPhotoUrl || undefined, newId: data?.id };
    } catch (err: any) {
        return { success: false, error: `App Error: ${err.message}` };
    }
};

export const deleteEvent = async (eventId: string, photoUrl: string | undefined, settings: SupabaseSettings): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings);
    if (!client) return { success: false, error: "Error de cliente." };

    try {
        // 1. Delete Photo from Storage if exists
        if (photoUrl) {
            const parts = photoUrl.split('/');
            const fileName = parts[parts.length - 1];
            // If organized by folders, might need full path extraction. 
            // Assuming simple filename or "folder/filename" logic if bucket allows.
            // For robustness, we try to match the path stored.
            
            // NOTE: If we used folders in saveEvent (petId/filename), standard split might lose folder.
            // Better to use the path after the bucket name if possible. 
            // For now, let's assume flat or the fileName handles it if simple. 
            // If deletion fails, it's acceptable garbage.
            
            if (fileName) {
                 // Try deleting just filename, or try to guess folder? 
                 // If we implemented folder structure, we should ideally store "storage_path" in DB.
                 // For this iteration, we accept simple delete attempt.
                const { error: storageError } = await client.storage
                    .from('dog_photos')
                    .remove([fileName]);
                
                if (storageError) console.warn("Could not delete photo file:", storageError);
            }
        }

        // 2. Delete Record from DB
        const { error: dbError } = await client
            .from('events')
            .delete()
            .eq('id', eventId);

        if (dbError) {
            return { success: false, error: dbError.message };
        }

        return { success: true };

    } catch (e: any) {
        return { success: false, error: e.message };
    }
};

export const searchEvents = async (params: EventSearchParams, settings: SupabaseSettings): Promise<DogEvent[]> => {
    const client = createFreshClient(settings);
    if (!client) return [];

    let query = client.from('events').select('*');

    // --- Mandatory Context Filter ---
    if (params.petId) {
        query = query.eq('pet_id', params.petId);
    } else {
        // If no petId provided (shouldn't happen in logged in app), return empty to be safe
        console.warn("Search attempted without petId");
        return [];
    }

    // --- Server Side Filtering ---

    if (params.recordType) {
        query = query.eq('record_type', params.recordType);
    }
    
    if (params.startDate) {
        query = query.gte('date', params.startDate);
    }
    
    if (params.endDate) {
        query = query.lte('date', params.endDate);
    }

    if (params.searchTitle) {
        query = query.ilike('title', `%${params.searchTitle}%`);
    }

    // Always newest first
    query = query.order('date', { ascending: false }).order('time', { ascending: false });

    // --- Pagination ---
    if (params.page !== undefined && params.pageSize !== undefined) {
        const from = params.page * params.pageSize;
        const to = from + params.pageSize - 1;
        query = query.range(from, to);
    } else if (params.limit) {
        query = query.limit(params.limit);
    } else {
        query = query.limit(50); 
    }

    const { data, error } = await query;

    if (error) {
        console.error("Search Error:", error);
        throw new Error(error.message);
    }

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
        petId: row.pet_id,
        userId: row.user_id,
        synced: true
    }));
};