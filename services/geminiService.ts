
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { AIAnalysisResult, HealthStatus, RecordType, SupabaseSettings, DogEvent, ChatMessage } from "../types";
import { searchEvents } from "./supabaseService";

// --- CONFIGURATION ---
// Priority list: Latest & Fastest -> Stable Backup
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite-preview-02-05'];

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
   - **Prioridad de Fechas en Documentos**: Si el usuario sube un PDF o Imagen de un informe médico antiguo, busca la fecha impresa en el documento y ÚSALA en lugar de la fecha actual.

REGLAS ESPECÍFICAS Y FORMATO DE TÍTULO:
- **PARA EL TIPO 'Caca' (IMPORTANTE)**:
  - Evalúa visualmente o por descripción la calidad de las heces asignando una puntuación del 1 al 10 (siendo 10 lo más saludable/perfecto).
  - Puntuación 1: Diarrea líquida grave.
  - Puntuación 5: Blanda o algo suelta.
  - Puntuación 10: Perfecta consistencia, forma y color.
  - Asigna este valor al campo 'poopScore' (entero 1-10).
  
  - Aplica esta lógica de etiquetas según tu puntuación:
    - Puntuación 7-10 -> "Buena"
    - Puntuación 4-6 -> "Regular"
    - Puntuación 1-3 -> "Mala"
  - **EL TÍTULO DEBE EMPEZAR CON LA ETIQUETA**. Formato: "[Etiqueta] - [Resumen]".
  - Ejemplo: "Buena - Caca sólida y color normal", "Mala - Diarrea líquida".

- Para el resto de tipos, el título es libre pero descriptivo.
`;

const CONSULTANT_INSTRUCTION = `
Eres un asistente veterinario inteligente con acceso a la base de datos del perro.
Tu objetivo es responder preguntas del dueño sobre el historial de salud, eventos, o análisis específicos.

Tienes a tu disposición una herramienta llamada 'query_events' para buscar en la base de datos.
Usa esta herramienta cuando el usuario pregunte por eventos pasados (ej: "¿Cómo han sido las cacas la última semana?", "¿Cuándo fue la última visita al veterinario?").

REGLAS:
1. Si te preguntan por un periodo de tiempo (ej: "última semana"), calcula las fechas aproximadas basándote en la fecha de hoy (que se te proporcionará).
2. Si encuentras resultados, analízalos médicamente. Por ejemplo, si hay muchas cacas "Malas", advierte al usuario.
3. Sé empático y profesional.
4. Si no encuentras datos, dilo claramente.
5. Mantén el contexto de la conversación. Si el usuario dice "¿Y de vómitos?", se refiere al mismo periodo de tiempo del que hablabais antes.
`;

// --- HELPER: Get API Keys Securely (Multi-Key Support) ---
async function getGeminiApiKeys(settings: SupabaseSettings, accessToken?: string): Promise<string[]> {
    const keys: string[] = [];

    // 1. Try Production Env Vars (Vercel)
    try {
        // @ts-ignore
        if (import.meta.env.VITE_GEMINI_API_KEY) keys.push(import.meta.env.VITE_GEMINI_API_KEY);
        // @ts-ignore
        if (import.meta.env.VITE_GEMINI_API_KEY_BACKUP) keys.push(import.meta.env.VITE_GEMINI_API_KEY_BACKUP);
    } catch (e) {
        // Ignore error if env not available
    }

    if (keys.length > 0) return keys;

    // 2. Fallback: Fetch from Supabase DB
    if (!settings.supabaseUrl || !settings.supabaseKey) {
        throw new Error("No hay configuración de Supabase para recuperar la clave API.");
    }

    const client = createClient(settings.supabaseUrl, settings.supabaseKey, {
        global: {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
        }
    });

    const { data, error } = await client
        .from('app_secrets')
        .select('key_name, value')
        .in('key_name', ['GEMINI_API_KEY', 'GEMINI_API_KEY_BACKUP']);

    if (error || !data) {
        console.error("Error fetching API Key:", error);
        throw new Error("No se encontraron claves API de Gemini.");
    }

    const primary = data.find(s => s.key_name === 'GEMINI_API_KEY')?.value;
    const backup = data.find(s => s.key_name === 'GEMINI_API_KEY_BACKUP')?.value;

    if (primary) keys.push(primary);
    if (backup) keys.push(backup);

    if (keys.length === 0) {
        throw new Error("No hay API KEYs configuradas en 'app_secrets'.");
    }

    return keys;
}

// --- HELPER: Robust Generation with Key Rotation & Fallback ---
async function generateWithFallback(
    apiKeys: string[],
    contents: any,
    baseConfig: any
): Promise<any> {
    let lastError: any;

    // Outer Loop: Rotate through API Keys
    for (const apiKey of apiKeys) {
        // console.log(`Using API Key: ...${apiKey.slice(-4)}`);
        const ai = new GoogleGenAI({ apiKey });

        // Inner Loop: Rotate through Models
        for (const model of FALLBACK_MODELS) {
            // Retry loop for transient errors (503) within the same model/key combo
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
                    const status = error.status || error.response?.status;
                    const msg = error.message || "";

                    // CRITICAL: If Quota Exceeded (429), break model loop to switch KEY immediately
                    if (status === 429 || msg.includes('429') || msg.includes('quota')) {
                        console.warn(`⚠️ Cuota excedida en clave ...${apiKey.slice(-4)}. Cambiando de cuenta...`);
                        break; // Breaks Attempt Loop
                    }

                    // Fatal errors (400, 401, 403, 404) -> Break attempt loop, try next model (if 404) or crash
                    if (status === 400 || status === 401 || status === 403 || status === 404) {
                        break; 
                    }

                    // Transient (503) -> Wait and Retry
                    const isTransient = status === 503 || msg.includes('Overloaded');
                    if (isTransient) {
                        const delay = Math.pow(2, attempt) * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue; 
                    }

                    break; // Unknown error, try next model
                }
            }
            
            // If we broke here due to 429, we need to exit the Model loop too to get to the Key loop
            const status = lastError?.status || lastError?.response?.status;
            const msg = lastError?.message || "";
            if (status === 429 || msg.includes('429') || msg.includes('quota')) {
                break; // Continue to next Key
            }
        }
    }

    throw lastError || new Error("Todas las cuentas y modelos de IA fallaron.");
}


export const analyzeInput = async (
  textInput: string,
  imageParts: string[] = [],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<AIAnalysisResult> => {
  
  const apiKeys = await getGeminiApiKeys(settings, accessToken);
  
  const now = new Date();
  const contextPrompt = `Momento actual del sistema: ${now.toLocaleString('es-ES')}. Analiza esto: "${textInput}"`;

  const parts: any[] = [{ text: contextPrompt }];
  
  imageParts.forEach(base64Data => {
    const cleanBase64 = base64Data.split(',')[1] || base64Data;
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: cleanBase64
      }
    });
  });

  const config = {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Título del evento" },
          recordType: {
            type: Type.STRING,
            enum: Object.values(RecordType),
            description: "Tipo de registro del evento"
          },
          healthStatus: { 
            type: Type.STRING, 
            enum: Object.values(HealthStatus),
            description: "Estado de salud (opcional)",
            nullable: true
          },
          description: { type: Type.STRING, description: "Descripción detallada" },
          weight: { type: Type.NUMBER, description: "Peso en kg", nullable: true },
          date: { type: Type.STRING, description: "Fecha del evento YYYY-MM-DD", nullable: true },
          time: { type: Type.STRING, description: "Hora del evento HH:MM", nullable: true },
          poopScore: { type: Type.INTEGER, description: "Puntuación de caca 1-10", nullable: true }
        },
        required: ["title", "recordType"]
      }
  };

  const response = await generateWithFallback(apiKeys, { parts }, config);

  if (!response.text) {
      throw new Error("No analysis generated");
  }

  return JSON.parse(response.text) as AIAnalysisResult;
};

export const analyzeImage = async (
    imageBase64: string, 
    settings: SupabaseSettings,
    accessToken?: string
): Promise<AIAnalysisResult> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
    const now = new Date();

    const contents = {
        parts: [
            {
                inlineData: {
                    mimeType: "image/jpeg",
                    data: cleanBase64
                }
            },
            {
                text: `Momento actual: ${now.toLocaleString('es-ES')}. Analiza visualmente esta imagen. Identifica qué es (Caca, Vómito, Comida, etc.). Si es CACA, califícala del 1 al 10 en 'poopScore'.`
            }
        ]
    };

    const config = {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Título (Ej: 'Mala - Diarrea')" },
            recordType: {
                type: Type.STRING,
                enum: Object.values(RecordType),
            },
            healthStatus: { 
              type: Type.STRING, 
              enum: Object.values(HealthStatus),
              nullable: true
            },
            description: { type: Type.STRING, description: "Descripción visual detallada del experto" },
            weight: { type: Type.NUMBER, description: "Peso en kg", nullable: true },
            date: { type: Type.STRING, description: "Fecha YYYY-MM-DD", nullable: true },
            time: { type: Type.STRING, description: "Hora HH:MM", nullable: true },
            poopScore: { type: Type.INTEGER, description: "Puntuación 1-10", nullable: true }
          },
          required: ["title", "recordType"]
        }
    };

    const response = await generateWithFallback(apiKeys, contents, config);

    if (!response.text) {
        throw new Error("No analysis generated from image");
    }
  
    return JSON.parse(response.text) as AIAnalysisResult;
}

export const analyzeAudio = async (
    audioBase64: string,
    settings: SupabaseSettings,
    accessToken?: string
): Promise<AIAnalysisResult> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const now = new Date();

    const contents = {
        parts: [
            {
                inlineData: {
                    mimeType: "audio/mp3",
                    data: audioBase64
                }
            },
            {
                text: `Momento actual: ${now.toLocaleString('es-ES')}. Analiza este audio y extrae los datos. Si mencionan "ayer", "hace una hora", etc, calcula la fecha/hora exacta.`
            }
        ]
    };

    const config = {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Breve título del evento" },
            recordType: {
                type: Type.STRING,
                enum: Object.values(RecordType),
            },
            healthStatus: { 
              type: Type.STRING, 
              enum: Object.values(HealthStatus),
              nullable: true
            },
            description: { type: Type.STRING, description: "Descripción detallada" },
            weight: { type: Type.NUMBER, description: "Peso en kg", nullable: true },
            date: { type: Type.STRING, description: "Fecha YYYY-MM-DD", nullable: true },
            time: { type: Type.STRING, description: "Hora HH:MM", nullable: true },
            poopScore: { type: Type.INTEGER, description: "Puntuación 1-10", nullable: true }
          },
          required: ["title", "recordType"]
        }
    };

    const response = await generateWithFallback(apiKeys, contents, config);

    if (!response.text) {
        throw new Error("No analysis generated from audio");
    }
  
    return JSON.parse(response.text) as AIAnalysisResult;
}

export const analyzeFile = async (
    base64Data: string, 
    mimeType: string,
    settings: SupabaseSettings,
    accessToken?: string
): Promise<AIAnalysisResult> => {
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const cleanBase64 = base64Data.split(',')[1] || base64Data;
    const now = new Date();

    const contents = {
        parts: [
            {
                inlineData: {
                    mimeType: mimeType,
                    data: cleanBase64
                }
            },
            {
                text: `Momento actual: ${now.toLocaleString('es-ES')}. Analiza este documento o imagen adjunta. Extrae la información más relevante para un registro veterinario. Identifica si es un informe médico, una analítica, una foto de un síntoma, etc. Si el documento contiene una fecha impresa, ÚSALA como la fecha del evento.`
            }
        ]
    };

    const config = {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Título (Ej: 'Informe Analítica', 'Foto Herida')" },
            recordType: {
                type: Type.STRING,
                enum: Object.values(RecordType),
            },
            healthStatus: { 
              type: Type.STRING, 
              enum: Object.values(HealthStatus),
              nullable: true
            },
            description: { type: Type.STRING, description: "Resumen detallado del contenido del archivo" },
            weight: { type: Type.NUMBER, description: "Peso en kg si aparece en el documento", nullable: true },
            date: { type: Type.STRING, description: "Fecha del documento o evento YYYY-MM-DD", nullable: true },
            time: { type: Type.STRING, description: "Hora HH:MM", nullable: true },
            poopScore: { type: Type.INTEGER, description: "Puntuación 1-10", nullable: true }
          },
          required: ["title", "recordType"]
        }
    };

    const response = await generateWithFallback(apiKeys, contents, config);

    if (!response.text) {
        throw new Error("No analysis generated from file");
    }
  
    return JSON.parse(response.text) as AIAnalysisResult;
}

// --- CONSULTANT LOGIC (UPDATED FOR MULTI-KEY) ---

const queryEventsTool: FunctionDeclaration = {
    name: 'query_events',
    description: 'Busca eventos en la base de datos. Útil para contestar preguntas sobre historial médico, cacas, comida, etc.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            recordType: {
                type: Type.STRING,
                enum: Object.values(RecordType),
                description: "Tipo de registro a buscar (opcional)"
            },
            startDate: {
                type: Type.STRING,
                description: "Fecha de inicio en formato YYYY-MM-DD (opcional)"
            },
            endDate: {
                type: Type.STRING,
                description: "Fecha de fin en formato YYYY-MM-DD (opcional)"
            },
            limit: {
                type: Type.NUMBER,
                description: "Número máximo de resultados (default 20)"
            }
        }
    }
};

export const consultAssistant = async (
    history: ChatMessage[], 
    settings: SupabaseSettings,
    petId: string, 
    accessToken?: string 
): Promise<{ text: string, events?: DogEvent[] }> => {
    
    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const today = new Date().toISOString().split('T')[0];

    // Build contents from history
    const contents = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));

    // Inject context
    const lastMessageIndex = contents.length - 1;
    if (lastMessageIndex >= 0 && contents[lastMessageIndex].role === 'user') {
        const originalText = contents[lastMessageIndex].parts[0].text;
        contents[lastMessageIndex].parts[0].text = `Hoy es ${today}. ${originalText}`;
    }

    const config = {
        systemInstruction: CONSULTANT_INSTRUCTION,
        tools: [{ functionDeclarations: [queryEventsTool] }]
    };

    // 1. Initial Call (Uses Fallback Keys)
    let response = await generateWithFallback(apiKeys, contents, config);

    let foundEvents: DogEvent[] = [];
    let functionCalls = response.functionCalls;

    // Step 2: Handle Function Calls (if any)
    if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0]; 
        
        if (call.name === 'query_events') {
            const args: any = call.args;
            try {
                foundEvents = await searchEvents({
                    recordType: args.recordType,
                    startDate: args.startDate,
                    endDate: args.endDate,
                    limit: args.limit,
                    petId: petId 
                }, settings, accessToken);
            } catch (e) {
                console.error("Supabase Search Error", e);
            }

            const minimalEvents = foundEvents.map(e => ({
                date: e.date,
                time: e.time,
                type: e.recordType,
                title: e.title,
                status: e.healthStatus,
                desc: e.description,
                score: e.poopScore // Pass score to AI
            }));

            const functionResponseParts = [
                {
                    functionResponse: {
                        name: 'query_events',
                        response: { result: minimalEvents },
                        id: call.id
                    }
                }
            ];

            const newContents = [
                ...contents,
                { role: 'model', parts: response.candidates![0].content.parts },
                { role: 'user', parts: functionResponseParts }
            ];

            // 2. Second Call (Tool Result - Uses Fallback Keys)
            response = await generateWithFallback(apiKeys, newContents, {
                systemInstruction: CONSULTANT_INSTRUCTION
            });
        }
    }

    return {
        text: response.text || "No pude generar una respuesta.",
        events: foundEvents.length > 0 ? foundEvents : undefined
    };
};

// --- TASK DETECTION (UPDATED FOR MULTI-KEY) ---
export const detectTaskFromNote = async (
    message: string, 
    mentionedUsers: {id: string, name: string}[],
    settings: SupabaseSettings,
    accessToken?: string
): Promise<{ title: string, assignedToId: string } | null> => {
    if (mentionedUsers.length === 0) return null;

    const apiKeys = await getGeminiApiKeys(settings, accessToken);
    const usersContext = mentionedUsers.map(u => `${u.name} (ID: ${u.id})`).join(", ");

    const prompt = `
    Analiza este mensaje del tablón de equipo: "${message}".
    Usuarios mencionados: [${usersContext}].
    
    ¿El mensaje contiene claramente una tarea, orden, recordatorio o solicitud de acción para alguno de los usuarios mencionados?
    
    - Si SÍ: Devuelve un JSON con "title" (resumen corto de la acción, infinitivo) y "assignedToId" (el ID exacto del usuario).
    - Si NO (es solo un comentario, aviso informativo, o pregunta general): Devuelve null.
    
    Ejemplos:
    - "@Juan saca al perro" -> {"title": "Sacar al perro", "assignedToId": "..."}
    - "@Maria ¿qué tal está?" -> null
    - "Hola @Pedro" -> null
    - "@Ana compra pienso por favor" -> {"title": "Comprar pienso", "assignedToId": "..."}
    `;

    const config = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING },
                assignedToId: { type: Type.STRING },
            },
            nullable: true
        }
    };

    try {
        const response = await generateWithFallback(apiKeys, { parts: [{ text: prompt }] }, config);
        if (!response.text) return null;
        const result = JSON.parse(response.text);
        if (!result || !result.title || !result.assignedToId) return null;
        return result;
    } catch (e) {
        console.error("Task detection failed", e);
        return null;
    }
};
