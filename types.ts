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

export interface DogEvent {
  id: string;
  title: string;
  recordType: RecordType;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  healthStatus?: HealthStatus | null;
  weight?: number;
  description: string;
  
  // Local preview data (Base64)
  photoBase64?: string; 
  fileBase64?: string;
  fileName?: string;

  // Cloud data (Supabase)
  photoUrl?: string;
  fileUrl?: string;
  
  synced: boolean;
}

// Structure expected from Gemini analysis
export interface AIAnalysisResult {
  title: string;
  recordType: RecordType;
  healthStatus?: HealthStatus | null;
  description: string;
  weight?: number;
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
  recordType?: RecordType;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  relatedEvents?: DogEvent[]; // Events found during this turn
  isError?: boolean;
}