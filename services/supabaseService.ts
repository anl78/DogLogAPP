
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DogEvent, SupabaseSettings, ConnectionResult, EventSearchParams, RecordType, Pet, PetCollaborator, CollaboratorPermissions, PetNote, PetTask } from '../types';

const createFreshClient = (settings: SupabaseSettings, accessToken?: string): SupabaseClient | null => {
  let cleanUrl = settings.supabaseUrl.trim().replace(/^["']|["']$/g, '');
  if (!cleanUrl.startsWith('http')) cleanUrl = `https://${cleanUrl}`;
  cleanUrl = cleanUrl.replace(/\/$/, "");

  let cleanKey = settings.supabaseKey.trim().replace(/^["']|["']$/g, '');

  if (cleanUrl && cleanKey) {
    try {
        const options: any = {
          auth: {
            persistSession: !accessToken,
            autoRefreshToken: !accessToken,
            detectSessionInUrl: !accessToken
          }
        };
        if (accessToken) {
            options.global = { headers: { Authorization: `Bearer ${accessToken}` } };
        }
        return createClient(cleanUrl, cleanKey, options);
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
        if (!settings.supabaseUrl || !settings.supabaseKey) return { success: false, message: "Faltan credenciales." };
        const client = createFreshClient(settings);
        if (!client) return { success: false, message: "URL inválida." };
        const { error: basicError } = await client.from('events').select('id').limit(1);
        if (basicError && basicError.code !== 'PGRST116') return { success: false, message: `Error Supabase: ${basicError.message}` };
        return { success: true, message: "✅ Conexión establecida." };
    } catch (e: any) {
        return { success: false, message: `Error de Red: ${e.message}` };
    }
};

export const getUserPets = async (settings: SupabaseSettings, accessToken?: string): Promise<{ pets: Pet[], error?: any }> => {
    try {
        const client = createFreshClient(settings, accessToken);
        if (!client) return { pets: [], error: "Cliente no inicializado" };
        const { data: { user } } = await client.auth.getUser();
        if (!user) return { pets: [], error: "No usuario" };

        // 1. Fetch Owned Pets directly
        const { data: ownedPets, error: ownError } = await client
            .from('pets')
            .select('id, name, photo_url, owner_id')
            .eq('owner_id', user.id);
        
        if (ownError) {
            console.error("Error fetching owned pets:", ownError);
            return { pets: [], error: ownError };
        }

        // 2. Fetch Collaborated Pets
        const { data: collabData, error: collabError } = await client
            .from('pet_collaborators')
            .select(`pets (id, name, photo_url, owner_id)`)
            .eq('user_id', user.id);
            
        if (collabError) {
             console.error("Error fetching collab pets:", collabError);
             // If owned pets worked but collab failed, return owned pets but signal warning?
             // For recursion error, usually both fail or one blocks the other.
             // We return error if ownedPets is empty, otherwise we return what we have.
             if (!ownedPets || ownedPets.length === 0) {
                 return { pets: [], error: collabError };
             }
        }
        
        const collabPets = (collabData || []).map((row: any) => row.pets as Pet).filter(p => !!p);

        // 3. Merge and deduplicate by ID
        const all = [...(ownedPets || []), ...collabPets];
        const uniqueMap = new Map();
        all.forEach(p => { if(p && p.id) uniqueMap.set(p.id, p); });
        
        return { pets: Array.from(uniqueMap.values()) };
    } catch (e) { 
        console.error("Error fetching pets:", e);
        return { pets: [], error: e }; 
    }
};

export const createPet = async (settings: SupabaseSettings, name: string, ownerId: string, accessToken?: string): Promise<{ pet: Pet | null, error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { pet: null, error: "Client Error" };
    
    // 1. Create Pet in pets table
    const { data: pet, error } = await client.from('pets').insert({ name, owner_id: ownerId }).select().single();
    
    if (error) {
        console.error("Error creating pet:", error);
        return { pet: null, error: error.message };
    }

    if (!pet) return { pet: null, error: "Unknown error: Pet not returned" };

    // 2. Auto-add owner as collaborator (Self-healing consistency for RLS)
    // We ignore error here just in case, but it helps keep queries consistent
    const { error: collabError } = await client.from('pet_collaborators').insert({
        pet_id: pet.id,
        user_id: ownerId,
        role: 'owner',
        permissions: { can_create: true, can_edit: 'all', can_delete: 'all', visible_types: [] }
    });
    
    if (collabError) {
        console.warn("Could not add owner as collaborator (minor issue):", collabError);
    }

    return { pet: pet as Pet };
};

export const deletePetCompletely = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<boolean> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return false;
    const { error } = await client.from('pets').delete().eq('id', petId);
    return !error;
};

export const transferPetOwnership = async (settings: SupabaseSettings, petId: string, newOwnerId: string, accessToken?: string): Promise<boolean> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return false;
    const { error: petError } = await client.from('pets').update({ owner_id: newOwnerId }).eq('id', petId);
    if (petError) return false;
    const { error: collError } = await client.from('pet_collaborators').update({ role: 'owner' }).match({ pet_id: petId, user_id: newOwnerId });
    return !collError;
};

export const deleteUserAccount = async (settings: SupabaseSettings, accessToken: string): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };
    const { error } = await client.rpc('delete_user_account');
    if (error) return { success: false, error: error.message };
    await client.auth.signOut();
    return { success: true };
};

export const getCollaborators = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<PetCollaborator[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];
    const { data, error } = await client.from('pet_collaborators').select(`pet_id, user_id, role, permissions, profiles ( email, full_name )`).eq('pet_id', petId);
    if (error) return [];
    return data as unknown as PetCollaborator[];
};

export const inviteCollaborator = async (settings: SupabaseSettings, petId: string, email: string, accessToken?: string): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Error de cliente Supabase" };
    
    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[Invite] Buscando perfil para: ${normalizedEmail}`);

    // Standard lookup in public 'profiles' table which should contain email
    const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('id')
        .ilike('email', normalizedEmail)
        .single();
    
    if (profileError) {
        console.error("[Invite] Profile Lookup Error:", JSON.stringify(profileError));
        if (profileError.code === 'PGRST116') {
            return { success: false, error: "Usuario no encontrado. El usuario debe estar registrado y haber confirmado su email." };
        }
        return { success: false, error: `Error buscando usuario: ${profileError.message}` };
    }
    
    if (!profile || !profile.id) {
        return { success: false, error: "No se pudo identificar el ID del usuario." };
    }

    console.log(`[Invite] Usuario encontrado (ID: ${profile.id}). Vinculando a mascota...`);

    const { error: insertError } = await client.from('pet_collaborators').insert({ 
        pet_id: petId, 
        user_id: profile.id, 
        role: 'viewer', 
        permissions: { 
            can_create: true, 
            can_edit: 'own', 
            can_delete: 'own', 
            visible_types: [] 
        } 
    });

    if (insertError) {
        console.error("[Invite] Insert Error:", JSON.stringify(insertError));
        if (insertError.code === '23505') return { success: false, error: "Este usuario ya es parte del equipo de esta mascota." };
        return { success: false, error: `No se pudo añadir al grupo: ${insertError.message}` };
    }

    return { success: true };
};

export const updateCollaboratorPermissions = async (settings: SupabaseSettings, petId: string, userId: string, permissions: CollaboratorPermissions, role: string, accessToken?: string): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };
    const { error } = await client.from('pet_collaborators').update({ permissions, role }).match({ pet_id: petId, user_id: userId });
    return { success: !error, error: error?.message };
};

export const removeCollaborator = async (settings: SupabaseSettings, petId: string, userId: string, accessToken?: string): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };
    const { error } = await client.from('pet_collaborators').delete().match({ pet_id: petId, user_id: userId });
    return { success: !error, error: error?.message };
};

export const getCollaboratorPermissions = async (settings: SupabaseSettings, petId: string, userId: string, accessToken?: string): Promise<CollaboratorPermissions | null> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return null;
    const { data, error } = await client.from('pet_collaborators').select('permissions').eq('pet_id', petId).eq('user_id', userId).single();
    return error ? null : data.permissions as CollaboratorPermissions;
};

export const getPetNotes = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<PetNote[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];
    const { data, error } = await client.from('pet_notes').select(`*, profiles ( full_name, email )`).eq('pet_id', petId).order('created_at', { ascending: false });
    return error ? [] : data as unknown as PetNote[];
};

export const createPetNote = async (settings: SupabaseSettings, petId: string, userId: string, content: string, mentions: string[] = [], accessToken?: string): Promise<PetNote | null> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return null;
    const { data, error } = await client.from('pet_notes').insert({ pet_id: petId, user_id: userId, content, mentions }).select(`*, profiles(full_name, email)`).single();
    return error ? null : data as unknown as PetNote;
};

export const deletePetNote = async (settings: SupabaseSettings, noteId: string, accessToken?: string): Promise<boolean> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return false;
    const { data, error } = await client.from('pet_notes').delete().eq('id', noteId).select();
    return !!data && data.length > 0;
};

export const togglePinNote = async (settings: SupabaseSettings, noteId: string, currentStatus: boolean, accessToken?: string): Promise<boolean> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return false;
    const { error } = await client.from('pet_notes').update({ is_pinned: !currentStatus }).eq('id', noteId);
    return !error;
};

export const updateLastSeenBoard = async (settings: SupabaseSettings, petId: string, userId: string, accessToken?: string): Promise<void> => {
    const client = createFreshClient(settings, accessToken);
    if (client) await client.from('user_board_status').upsert({ user_id: userId, pet_id: petId, last_seen_at: new Date().toISOString() });
};

export const checkUnreadMessages = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<boolean> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return false;
    const { data } = await client.rpc('has_unread_board_messages', { p_pet_id: petId });
    return !!data;
};

export const getPetTasks = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<PetTask[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];
    const { data } = await client.from('pet_tasks').select(`*, assignee:assigned_to(full_name, email), creator:created_by(full_name)`).eq('pet_id', petId).order('is_completed', { ascending: true }).order('created_at', { ascending: false });
    return data as any;
};

export const createPetTask = async (settings: SupabaseSettings, petId: string, title: string, assignedTo: string | null, createdBy: string, accessToken?: string): Promise<PetTask | null> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return null;
    const { data } = await client.from('pet_tasks').insert({ pet_id: petId, title, assigned_to: assignedTo, created_by: createdBy }).select(`*, assignee:assigned_to(full_name, email), creator:created_by(full_name)`).single();
    return data as any;
};

export const toggleTaskCompletion = async (settings: SupabaseSettings, taskId: string, isCompleted: boolean, accessToken?: string): Promise<boolean> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return false;
    const { error } = await client.from('pet_tasks').update({ is_completed: !isCompleted, completed_at: !isCompleted ? new Date().toISOString() : null }).eq('id', taskId);
    return !error;
};

export const saveEventToSupabase = async (event: DogEvent, settings: SupabaseSettings, accessToken?: string): Promise<{ success: boolean; error?: string; photoUrl?: string; newId?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };
    let publicPhotoUrl = null;
    if (event.photoBase64) {
        const blob = base64ToBlob(event.photoBase64);
        const fileName = `${event.petId}/${Date.now()}.jpg`;
        const { error: uploadError } = await client.storage.from('dog_photos').upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
        if (uploadError) return { success: false, error: uploadError.message };
        const { data: urlData } = client.storage.from('dog_photos').getPublicUrl(fileName);
        publicPhotoUrl = urlData.publicUrl;
    }
    const payload: any = { id: event.id, title: event.title, record_type: event.recordType, date: event.date, time: event.time.length === 5 ? event.time + ":00" : event.time, health_status: event.healthStatus || null, weight: event.weight || null, description: event.description, photo_url: publicPhotoUrl || event.photoUrl, pet_id: event.petId, user_id: event.userId, poop_score: event.poopScore || null };
    const { data, error: insertError } = await client.from('events').upsert(payload).select().single();
    if (insertError) return { success: false, error: insertError.message };
    return { success: true, photoUrl: publicPhotoUrl || undefined, newId: data?.id };
};

export const deleteEvent = async (eventId: string, photoUrl: string | undefined, settings: SupabaseSettings, accessToken?: string): Promise<{ success: boolean; error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { success: false, error: "Client error" };
    const { error: dbError } = await client.from('events').delete().eq('id', eventId);
    if (dbError) return { success: false, error: dbError.message };
    if (photoUrl) {
        const fileName = photoUrl.split('/').pop();
        if (fileName) await client.storage.from('dog_photos').remove([fileName]);
    }
    return { success: true };
};

export const searchEvents = async (params: EventSearchParams, settings: SupabaseSettings, accessToken?: string): Promise<DogEvent[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];
    let query = client.from('events').select('*').eq('pet_id', params.petId);
    if (params.recordType) query = query.eq('record_type', params.recordType);
    if (params.startDate) query = query.gte('date', params.startDate);
    if (params.endDate) query = query.lte('date', params.endDate);
    if (params.searchTitle) query = query.ilike('title', `%${params.searchTitle}%`);
    query = query.order('date', { ascending: false }).order('time', { ascending: false });
    if (params.page !== undefined && params.pageSize !== undefined) query = query.range(params.page * params.pageSize, (params.page + 1) * params.pageSize - 1);
    else if (params.limit) query = query.limit(params.limit);
    const { data, error } = await query;
    if (error) return [];
    return (data || []).map((row: any) => ({ id: row.id, title: row.title, recordType: row.record_type as RecordType, date: row.date, time: row.time.substring(0, 5), healthStatus: row.health_status, weight: row.weight, description: row.description, photoUrl: row.photo_url, pet_id: row.pet_id, userId: row.user_id, poopScore: row.poop_score, synced: true }));
};

export const getWeightHistory = async (settings: SupabaseSettings, petId: string, months: number = 6, accessToken?: string): Promise<{ date: string, weight: number }[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];
    const d = new Date(); d.setMonth(d.getMonth() - months);
    const { data } = await client.from('events').select('date, weight').eq('pet_id', petId).not('weight', 'is', null).gte('date', d.toISOString().split('T')[0]).order('date', { ascending: true });
    return (data || []).map((row: any) => ({ date: row.date, weight: Number(row.weight) }));
};

// --- SHARED LINKS ---

export const createSharedLink = async (settings: SupabaseSettings, petId: string, expiresInDays: number, userId: string, accessToken?: string): Promise<{ linkId?: string, error?: string }> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return { error: "Client error" };
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    
    const { data, error } = await client.from('shared_links').insert({
        pet_id: petId,
        created_by: userId,
        expires_at: expiresAt.toISOString()
    }).select('id').single();
    
    if (error) return { error: error.message };
    return { linkId: data.id };
};

export const getSharedLinks = async (settings: SupabaseSettings, petId: string, accessToken?: string): Promise<any[]> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return [];
    const { data, error } = await client.from('shared_links').select('*').eq('pet_id', petId).order('created_at', { ascending: false });
    if (error) return [];
    return data;
};

export const revokeSharedLink = async (settings: SupabaseSettings, linkId: string, accessToken?: string): Promise<{success: boolean, error?: string}> => {
    const client = createFreshClient(settings, accessToken);
    if (!client) return {success: false, error: "Client not found"};
    const { data, error } = await client.from('shared_links').delete().eq('id', linkId).select('id');
    if (error) {
        console.error("Delete error:", error);
        return {success: false, error: error.message};
    }
    // If data is empty, it means RLS filtered it out or it didn't exist
    if (!data || data.length === 0) {
        return {success: false, error: "No se pudo borrar. Es posible que no tengas permisos (políticas RLS) o el enlace ya no exista."};
    }
    return {success: true};
};

export const getSharedPetData = async (settings: SupabaseSettings, token: string): Promise<{ pet?: Pet, events?: DogEvent[], error?: string }> => {
    const client = createFreshClient(settings); // No access token needed
    if (!client) return { error: "Client error" };
    
    const { data, error } = await client.rpc('get_shared_pet_data', { p_token: token });
    
    if (error) {
        return { error: error.message };
    }
    
    if (!data || !data.pet) {
        return { error: "Datos no encontrados" };
    }
    
    const events = (data.events || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        recordType: row.record_type as RecordType,
        date: row.date,
        time: row.time ? row.time.substring(0, 5) : '',
        healthStatus: row.health_status,
        weight: row.weight,
        description: row.description,
        photoUrl: row.photo_url,
        petId: row.pet_id,
        userId: row.user_id,
        poopScore: row.poop_score,
        synced: true
    }));
    
    return { pet: data.pet as Pet, events };
};

export const getSharedPetEventsByDate = async (settings: SupabaseSettings, token: string, startDate: string, endDate: string): Promise<DogEvent[]> => {
    const client = createFreshClient(settings);
    if (!client) return [];

    const { data, error } = await client.rpc('get_shared_pet_events_by_date', { 
        p_token: token,
        p_start_date: startDate,
        p_end_date: endDate
    });

    if (error || !data) {
        console.error("Error fetching shared events by date:", error);
        return [];
    }

    return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        recordType: row.record_type as RecordType,
        date: row.date,
        time: row.time ? row.time.substring(0, 5) : '',
        healthStatus: row.health_status,
        weight: row.weight,
        description: row.description,
        photoUrl: row.photo_url,
        petId: row.pet_id,
        userId: row.user_id,
        poopScore: row.poop_score,
        synced: true
    }));
};
