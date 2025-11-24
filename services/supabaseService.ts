import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DogEvent, SupabaseSettings, ConnectionResult, EventSearchParams, RecordType, Pet, PetCollaborator, CollaboratorPermissions } from '../types';

// Helper to create a fresh client every time. 
// If accessToken is provided, we inject it into the global headers to ensure RLS works for Storage/DB.
const createFreshClient = (settings: SupabaseSettings, accessToken?: string): SupabaseClient | null => {
  let cleanUrl = settings.supabaseUrl.trim();
  if (!cleanUrl.startsWith('http')) {
    cleanUrl = `https://${cleanUrl}`;
  }
  cleanUrl = cleanUrl.replace(/\/$/, "");

  if (cleanUrl && settings.supabaseKey) {
    try {
        const options: any = {
          auth: {
            persistSession: !accessToken, // Only auto-persist if we don't have a manual token
            autoRefreshToken: !accessToken,
            detectSessionInUrl: !accessToken
          }
        };

        // If we have a token (logged in user), force it in headers
        if (accessToken) {
            options.global = {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            };
        }

        return createClient(cleanUrl, settings.supabaseKey, options);
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

export const getUserPets = async (settings: SupabaseSettings, accessToken?: string): Promise<Pet[]> => {
    try {
        const client = createFreshClient(settings, accessToken);
        if (!client) return [];

        // Get current user details from the token
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError || !user) {
             console.error("Auth Error in getUserPets:", authError?.message);
             return [];
        }

        // Query 'pet_collaborators' joined with 'pets'
        const { data, error } = await client
            .from('pet_collaborators')
            .select(`
                pets (
                    id,
                    name,
                    photo_url,
                    owner_id
                )
            `)
            .eq('user_id', user.id);

        if (error) {
            console.error("Error fetching pets (DB):", error.message || JSON.stringify(error));
            return [];
        }

        // Flatten structure
        return (data || []).map((row: any) => row.pets as Pet).filter(p => !!p);

    } catch (e: any) {
        console.error("Critical Error fetching pets (Network):", e.message || e);
        return [];
    }
};

export const createPet = async (settings: SupabaseSettings, name: string, ownerId: string, accessToken?: string): Promise<Pet | null> => {
    const client = createFreshClient(settings, accessToken);
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
        console.error("Error creating pet:", JSON.stringify(error));
        return null;
    }
    return data as Pet;
};

// --- TEAM MANAGEMENT (COLLABORATORS) ---

export const getCollaborators = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<PetCollaborator[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];

    const { data, error } = await client
        .from('pet_collaborators')
        .select(`
            pet_id,
            user_id,
            role,
            permissions,
            profiles ( email, full_name )
        `)
        .eq('pet_id', petId);

    if (error) {
        console.error("Error getting collaborators:", error);
        return [];
    }
    return data as unknown as PetCollaborator[];
};

export const inviteCollaborator = async (
    settings: SupabaseSettings, 
    petId: string, 
    email: string, 
    accessToken?: string
): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };

    try {
        console.log("Inviting email (via find_user_by_email):", email);
        
        // USA NUEVA FUNCIÓN 'find_user_by_email' con parámetro 'user_email'
        // Esto evita conflictos de caché con la función anterior.
        const { data: userId, error: rpcError } = await client.rpc('find_user_by_email', { user_email: email });
        
        if (rpcError) {
            console.error("RPC Error:", rpcError);
            return { success: false, error: `Error buscando usuario: ${rpcError.message}` };
        }
        
        if (!userId) return { success: false, error: "Usuario no encontrado. Pídele que se registre en la App primero." };

        // 2. Insert into collaborators
        const { error: insertError } = await client
            .from('pet_collaborators')
            .insert({
                pet_id: petId,
                user_id: userId,
                role: 'viewer', // Default role
                permissions: { 
                    can_create: true, 
                    can_edit: 'own', 
                    can_delete: 'own', 
                    visible_types: [] // All
                }
            });

        if (insertError) {
            if (insertError.code === '23505') return { success: false, error: "Este usuario ya es miembro." };
            return { success: false, error: insertError.message };
        }

        return { success: true };

    } catch (e: any) {
        return { success: false, error: e.message };
    }
};

export const updateCollaboratorPermissions = async (
    settings: SupabaseSettings,
    petId: string,
    userId: string,
    permissions: CollaboratorPermissions,
    role: string,
    accessToken?: string
): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };

    const { error } = await client
        .from('pet_collaborators')
        .update({ permissions, role })
        .match({ pet_id: petId, user_id: userId });

    if (error) return { success: false, error: error.message };
    return { success: true };
};

export const removeCollaborator = async (
    settings: SupabaseSettings,
    petId: string,
    userId: string,
    accessToken?: string
): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };

    const { error } = await client
        .from('pet_collaborators')
        .delete()
        .match({ pet_id: petId, user_id: userId });

    if (error) return { success: false, error: error.message };
    return { success: true };
};

export const getCollaboratorPermissions = async (
    settings: SupabaseSettings,
    petId: string,
    userId: string,
    accessToken?: string
): Promise<CollaboratorPermissions | null> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return null;

    const { data, error } = await client
        .from('pet_collaborators')
        .select('permissions')
        .eq('pet_id', petId)
        .eq('user_id', userId)
        .single();

    if (error) {
        // If row not found, it might be the owner (who has no entry in collaborators if using direct owner_id link, 
        // OR we just didn't find them). UI handles owner logic.
        return null;
    }
    return data.permissions as CollaboratorPermissions;
};


// --- CRUD ---

export const saveEventToSupabase = async (event: DogEvent, settings: SupabaseSettings, accessToken?: string): Promise<{ success: boolean; error?: string; photoUrl?: string; newId?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Error iniciando cliente Supabase." };

    if (!event.petId) {
        return { success: false, error: "Error interno: Falta ID de Mascota." };
    }

    let publicPhotoUrl = null;

    // 1. Upload Photo (Hard fail logic)
    if (event.photoBase64) {
        try {
            const blob = base64ToBlob(event.photoBase64);
            const fileName = `${event.petId}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            
            const { error: uploadError } = await client.storage
                .from('dog_photos')
                .upload(fileName, blob, { 
                    contentType: 'image/jpeg',
                    upsert: true 
                });

            if (uploadError) {
                console.error("Upload failed:", uploadError);
                if ((uploadError as any).statusCode === '403' || (uploadError as any).code === '42501') {
                    return { success: false, error: `⛔ No tienes permiso para subir fotos.` };
                }
                return { success: false, error: `Error subiendo foto (Storage): ${uploadError.message}` };
            }

            const { data: urlData } = client.storage.from('dog_photos').getPublicUrl(fileName);
            publicPhotoUrl = urlData.publicUrl;

        } catch (err: any) {
            console.error("Photo upload crash:", err);
            return { success: false, error: `Error procesando imagen: ${err.message}` };
        }
    }

    // 2. Insert Record
    try {
        let cleanTime = event.time;
        if (cleanTime.length === 5) cleanTime += ":00";

        const payload = {
            id: event.id, 
            title: event.title,
            record_type: event.recordType,
            date: event.date,
            time: cleanTime,
            health_status: event.healthStatus || null,
            weight: (event.weight !== undefined && event.weight !== null && !isNaN(Number(event.weight))) ? Number(event.weight) : null,
            description: event.description,
            photo_url: publicPhotoUrl || event.photoUrl,
            pet_id: event.petId,
            user_id: event.userId
        };

        const { data, error: insertError } = await client
            .from('events')
            .upsert(payload) 
            .select()
            .single();

        if (insertError) {
            const msg = insertError.message || JSON.stringify(insertError);
            
            // Check for RLS Violation (42501)
            if (insertError.code === '42501') {
                 return { success: false, error: "⛔ Acceso Denegado: No tienes permiso para crear o editar este evento según la configuración del dueño." };
            }

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

export const deleteEvent = async (eventId: string, photoUrl: string | undefined, settings: SupabaseSettings, accessToken?: string): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Error de cliente." };

    try {
        // 1. Delete Record from DB FIRST to check permissions logic
        const { error: dbError } = await client
            .from('events')
            .delete()
            .eq('id', eventId);

        if (dbError) {
            // Check for RLS Violation (42501)
            if (dbError.code === '42501') {
                return { success: false, error: "⛔ Acceso Denegado: No tienes permiso para eliminar este evento." };
            }
            return { success: false, error: dbError.message };
        }

        // 2. Delete Photo from Storage (Only if DB delete succeeded)
        if (photoUrl) {
            const parts = photoUrl.split('/');
            const fileName = parts[parts.length - 1];
            
            if (fileName) {
                const { error: storageError } = await client.storage
                    .from('dog_photos')
                    .remove([`${fileName}`]); 
                
                if (storageError) console.warn("Could not delete photo file:", storageError);
            }
        }

        return { success: true };

    } catch (e: any) {
        return { success: false, error: e.message };
    }
};

export const searchEvents = async (params: EventSearchParams, settings: SupabaseSettings, accessToken?: string): Promise<DogEvent[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];

    let query = client.from('events').select('*');

    if (params.petId) {
        query = query.eq('pet_id', params.petId);
    } else {
        console.warn("Search attempted without petId");
        return [];
    }

    if (params.recordType) query = query.eq('record_type', params.recordType);
    if (params.startDate) query = query.gte('date', params.startDate);
    if (params.endDate) query = query.lte('date', params.endDate);
    if (params.searchTitle) query = query.ilike('title', `%${params.searchTitle}%`);

    query = query.order('date', { ascending: false }).order('time', { ascending: false });

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
        time: row.time.substring(0, 5),
        healthStatus: row.health_status,
        weight: row.weight,
        description: row.description,
        photoUrl: row.photo_url,
        petId: row.pet_id,
        userId: row.user_id,
        synced: true
    }));
};