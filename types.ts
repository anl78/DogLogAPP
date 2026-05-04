

export enum HealthStatus {
  NORMAL = 'Normal',
  OBSERVATION = 'En observación',
  TREATMENT = 'Tratamiento',
  WORRYING = 'Preocupante',
  URGENT = 'Urgente',
  RECOVERY = 'En recuperación'
}

export enum RecordType {
  POOP = 'Caca',
  FOOD = 'Comida',
  MEDICATION = 'Medicamento',
  VET = 'Veterinario',
  BEHAVIOR = 'Comportamiento',
  SUMMARY = 'Resumen',
  LABS = 'Analiticas',
  VOMIT = 'Vómito',
  CAR = 'Coche',
  INCIDENT = 'Incidente'
}

export interface SupabaseSettings {
  supabaseUrl: string;
  supabaseKey: string;
}

export interface NotionSettings {
  apiKey: string;
  databaseId: string;
}

export interface SchemaCheck {
  field: string;
  status: 'ok' | 'missing' | 'wrong_type';
  details: string;
  requiredType: string;
}

// --- NEW AUTH TYPES ---
export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
}

export interface Pet {
  id: string;
  name: string;
  photo_url?: string;
  owner_id: string;
}

// --- PERMISSIONS STRUCTURE ---
export interface CollaboratorPermissions {
    can_create: boolean;
    can_edit: 'own' | 'all' | 'none';
    can_delete: 'own' | 'all' | 'none';
    // If empty, ALL types are visible. If populated, ONLY these are visible.
    visible_types: RecordType[]; 
}

export interface PetCollaborator {
    pet_id: string;
    user_id: string;
    role: 'owner' | 'editor' | 'viewer';
    permissions: CollaboratorPermissions;
    // Joined profile data
    profiles?: {
        email: string;
        full_name?: string;
    };
}

export interface DogEvent {
  id: string;
  title: string;
  recordType: RecordType;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  healthStatus?: HealthStatus | null;
  weight?: number;
  description: string;
  poopScore?: number; // 1-10 Scale
  
  // Local preview data (Base64)
  photoBase64?: string; 
  fileBase64?: string;
  fileName?: string;

  // Cloud data (Supabase)
  photoUrl?: string;
  fileUrl?: string;
  
  // NEW RELATIONS
  userId?: string; // Created by
  petId?: string; // Belongs to
  
  needs_review?: boolean; // AI generated flag
  
  synced: boolean;
}

export interface SharedLink {
  id: string;
  pet_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
}

// --- BOARD / NOTES ---
export interface PetNote {
    id: string;
    pet_id: string;
    user_id: string;
    content: string;
    is_pinned: boolean;
    mentions?: string[]; // Array of UUIDs of mentioned users
    created_at: string;
    // Joined Data
    profiles?: {
        full_name?: string;
        email: string;
    }
}

// --- TASKS ---
export interface PetTask {
    id: string;
    pet_id: string;
    title: string;
    assigned_to?: string; // User ID
    created_by?: string; // User ID
    is_completed: boolean;
    created_at: string;
    completed_at?: string;
    // Joined Data
    assignee?: {
        full_name?: string;
        email: string;
    };
    creator?: {
        full_name?: string;
    };
}

// Structure expected from Gemini analysis
export interface AIAnalysisResult {
  title: string;
  recordType: RecordType;
  healthStatus?: HealthStatus | null;
  description: string;
  weight?: number;
  poopScore?: number;
  // Extracted temporal data
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
}

export interface ConnectionResult {
  success: boolean;
  message?: string;
  schemaChecks?: SchemaCheck[];
}

// --- AI Query / Chat Types ---

export interface EventSearchParams {
  recordType?: RecordType | '';
  startDate?: string;
  endDate?: string;
  searchTitle?: string;
  page?: number;
  pageSize?: number;
  limit?: number; // Keep for compatibility or manual overrides
  petId?: string; // REQUIRED for multi-tenant
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  relatedEvents?: DogEvent[]; // Events found during this turn
  isError?: boolean;
}
