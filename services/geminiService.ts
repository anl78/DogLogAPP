
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { AIAnalysisResult, HealthStatus, RecordType, SupabaseSettings, DogEvent, ChatMessage } from "../types";
import { searchEvents } from "./supabaseService";

// --- CONFIGURATION ---
const FALLBACK_MODELS = [
    'gemini-2.0-flash', 
    'gemini-2.0-flash-lite-preview-02-05',
    'gemini-1.5-flash-latest' 
];

const SYSTEM_INSTRUCTION = `
Eres un asistente veterinario experto. Tu tarea es analizar la transcripción o el audio de un dueño de perro describiendo un evento.
Debes extraer información estructurada para rellenar una tabla de seguimiento de Notion/Supabase.

INFORMACIÓN CLAVE A EXTRAER:
1. **Título**: Un resumen breve.
2. **Tipo de Registro (Obligatorio)**: Clasifica el evento estrictamente en una de estas categorías: 'Caca', 'Comida', 'Medicamento', 'Veterinario', 'Comportamiento', 'Resumen', 'Analiticas', 'Vómito', 'Coche', 'Incidente'.
3. **Estado de Salud (Opcional)**: Solo si es relevante. Valores: 'Normal', 'En observación', 'Tratamiento', 'Preocupante', 'Urgente', 'En recuperación'.
4. **Descripción**: Detalles completos del evento.
5. **Peso**: Si se menciona (número).
6. **Fecha y Hora (IMPORTANTE)**:
   - Se te proporcionará la fecha y hora ACTUAL del sistema.
   - Si el usuario dice "ayer", "hace 2 horas", "el lunes pasado a las 3pm", CALCULA la fecha y hora exacta basándote en el momento actual.
   - Formato Fecha: YYYY-MM-DD.
   - Formato Hora: HH:MM (24h).
   - Si NO mencionan tiempo, devuelve null en estos campos.
`;

const CONSULTANT_INSTRUCTION = `
Eres un asistente veterinario inteligente con acceso a la base de datos del perro.
Tu objetivo es responder preguntas del dueño sobre el historial de salud, eventos, o análisis específicos.
Usa la herramienta 'query_events' cuando necesites datos del pasado.
`;

// --- HELPER: Get API Keys Securely ---
async function getGeminiApiKeys(settings: SupabaseSettings, accessToken?: string): Promise<string[]> {
    let keys: string[] = [];

    // 1. Try VITE_ Environment Variables (Client-side exposed)
    try {
        // @ts-ignore
        const primary = import.meta.env.VITE_GEMINI_API_KEY;
        // @ts-ignore
        const backup = import.meta.env.VITE_GEMINI_API_KEY_BACKUP;
        
        if (primary && primary.length > 10) keys.push(primary);
        if (backup && backup.length > 10) keys.push(backup);
    } catch (e) {
        console.warn("[Gemini] Env vars not found or inaccessible.");
    }

    if (keys.length > 0) return [...new Set(keys)];

    // 2. Fallback: Supabase DB
    const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
        global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }
    });

    const { data } = await client
        .from('app_secrets')
        .select('key_name, value')
        .in('key_name', ['GEMINI_API_KEY', 'GEMINI_API_KEY_BACKUP']);

    if (data) {
        const p = data.find(s => s.key_name === 'GEMINI_API_KEY')?.value;
        const b = data.find(s => s.key_name === 'GEMINI_API_KEY_BACKUP')?.value;
        if (p) keys.push(p);
        if (b) keys.push(b);
    }

    return [...new Set(keys)];
}

// --- HELPER: Logic to check if an error is a Quota Exceeded (429) error ---
function isQuotaError(error: any): boolean {
    if (!error) return false;
    
    const status = error.status || error.response?.status;
    const msg = error.message || "";
    
    // Check status directly
    if (status === 429) return true;
    
    // Check message for common quota strings (case insensitive)
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes('429') || 
        lowerMsg.includes('quota') || 
        lowerMsg.includes('rate limit') ||
        lowerMsg.includes('limit exceeded')) return true;
    
    // Check if message is a stringified JSON containing 429
    if (typeof msg === 'string' && msg.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(msg);
            const nestedCode = parsed.error?.code || parsed.code;
            const nestedMsg = (parsed.error?.message || parsed.message || "").toLowerCase();
            if (nestedCode === 429 || nestedMsg.includes('429') || nestedMsg.includes('quota')) return true;
        } catch(e) {}
    }
    
    return false;
}

async function generateWithFallback(
    apiKeys: string[],
    contents: any,
    baseConfig: any
): Promise<any> {
    let lastError: any;

    if (apiKeys.length === 0) {
        throw new Error("No hay API Keys configuradas. Añade VITE_GEMINI_API_KEY en Vercel.");
    }

    // Outer Loop: API Keys
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        const ai = new GoogleGenAI({ apiKey });

        // Inner Loop: Models
        for (const model of FALLBACK_MODELS) {
            // Attempt loop for transient network issues
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const response = await ai.models.generateContent({
                        model: model,
                        contents: contents,
                        config: baseConfig
                    });
                    return response;
                } catch (error: any) {
                    lastError = error;
                    console.warn(`[Gemini] Attempt ${attempt+1} failed with Key #${i+1} (${model}).`, error.message);

                    // Check for Quota/Rate Limit (429)
                    if (isQuotaError(error)) {
                        console.warn(`[Gemini] Quota exceeded on Key #${i+1}. Rotating to next key...`);
                        break; // Exit Attempt Loop AND Model Loop to try next Key
                    }

                    // Transient 503 Overloaded
                    if (error.message?.includes('503') || error.message?.toLowerCase().includes('overloaded')) {
                        const backoff = 1000 * (attempt + 1);
                        await new Promise(r => setTimeout(r, backoff));
                        continue; // Try next attempt
                    }
                    
                    // For other errors (400, 401, 403), stop attempting this model
                    break; 
                }
            }
            
            // If we hit a quota error in the attempt loop, skip all other models for this key
            if (isQuotaError(lastError)) break; 
        }
    }

    // If we've exhausted all keys
    const finalMsg = isQuotaError(lastError) 
        ? "Has superado la cuota gratuita de todas las cuentas configuradas hoy. Por favor, espera un minuto o añade una clave de pago." 
        : `Error de IA: ${lastError?.message || "Servicio no disponible"}`;
        
    throw new Error(finalMsg);
}

export const analyzeInput = async (
  textInput: string,
  imageParts: string[] = [],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<AIAnalysisResult> => {
  const apiKeys = await getGeminiApiKeys(settings, accessToken);
  const now = new Date();
  const parts: any[] = [{ text: `Fecha actual: ${now.toLocaleString('es-ES')}. Analiza: ${textInput}` }];
  
  imageParts.forEach(data => {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: data.split(',')[1] || data } });
  });

  const response = await generateWithFallback(apiKeys, { parts }, {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          recordType: { type: Type.STRING, enum: Object.values(RecordType) },
          healthStatus: { type: Type.STRING, enum: Object.values(HealthStatus), nullable: true },
          description: { type: Type.STRING },
          weight: { type: Type.NUMBER, nullable: true },
          date: { type: Type.STRING, nullable: true },
          time: { type: Type.STRING, nullable: true },
          poopScore: { type: Type.INTEGER, nullable: true }
        },
        required: ["title", "recordType"]
      }
  });

  if (!response.text) throw new Error("La IA devolvió una respuesta vacía.");
  return JSON.parse(response.text);
};

export const analyzeImage = async (imageBase64: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    return analyzeInput("Analiza esta imagen.", [imageBase64], settings, accessToken);
};

export const analyzeAudio = async (audioBase64: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const now = new Date();
    const contents = { 
        parts: [
            { inlineData: { mimeType: "audio/mp3", data: audioBase64 } }, 
            { text: `Hoy es ${now.toLocaleString('es-ES')}. Extrae los datos detallados del audio.` }
        ] 
    };
    const response = await generateWithFallback(apiKeys, contents, {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json"
    });
    return JSON.parse(response.text);
};

export const analyzeFile = async (base64Data: string, mimeType: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const contents = { 
        parts: [
            { inlineData: { mimeType, data: base64Data.split(',')[1] || base64Data } }, 
            { text: "Analiza el contenido de este archivo médico o imagen." }
        ] 
    };
    const response = await generateWithFallback(apiKeys, contents, {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json"
    });
    return JSON.parse(response.text);
};

export const consultAssistant = async (history: ChatMessage[], settings: SupabaseSettings, petId: string, accessToken?: string): Promise<{ text: string, events?: DogEvent[] }> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const contents = history.map(msg => ({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.text }] }));
    const response = await generateWithFallback(apiKeys, contents, { systemInstruction: CONSULTANT_INSTRUCTION });
    return { text: response.text || "No pude procesar tu consulta en este momento." };
};

export const detectTaskFromNote = async (message: string, mentionedUsers: {id: string, name: string}[], settings: SupabaseSettings, accessToken?: string): Promise<{ title: string, assignedToId: string } | null> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const prompt = `Mensaje: "${message}". Usuarios: ${JSON.stringify(mentionedUsers)}. ¿Hay una tarea explícita para alguien? Responde solo JSON {title, assignedToId} o null.`;
    try {
        const response = await generateWithFallback(apiKeys, { parts: [{ text: prompt }] }, { responseMimeType: "application/json" });
        return JSON.parse(response.text);
    } catch (e) { return null; }
};
