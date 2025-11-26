import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { AIAnalysisResult, HealthStatus, RecordType, SupabaseSettings, DogEvent, ChatMessage } from "../types";
import { searchEvents } from "./supabaseService";

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
  - Aplica esta lógica de etiquetas según tu puntuación:
    - Puntuación 7, 8, 9, 10 -> "Buena"
    - Puntuación 4, 5, 6 -> "Regular"
    - Puntuación 1, 2, 3 -> "Mala"
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

// --- HELPER: Get API Key Securely ---
async function getGeminiApiKey(settings: SupabaseSettings, accessToken?: string): Promise<string> {
    // 1. Try Production Env Var (Vercel)
    try {
        // @ts-ignore
        const envKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (envKey && envKey.length > 10) return envKey;
    } catch (e) {
        // Ignore error if env not available
    }

    // 2. Fallback: Fetch from Supabase DB (Development / Local)
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
        .select('value')
        .eq('key_name', 'GEMINI_API_KEY')
        .single();

    if (error || !data?.value) {
        console.error("Error fetching API Key:", error);
        throw new Error("No se encontró la API KEY de Gemini. Configura 'VITE_GEMINI_API_KEY' en Vercel o añade 'GEMINI_API_KEY' en la tabla 'app_secrets'.");
    }

    return data.value;
}

export const analyzeInput = async (
  textInput: string,
  imageParts: string[] = [],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<AIAnalysisResult> => {
  
  const apiKey = await getGeminiApiKey(settings, accessToken);
  const ai = new GoogleGenAI({ apiKey });
  
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

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Título del evento (Ej: 'Buena - Caca normal')" },
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
        },
        required: ["title", "recordType"]
      }
    }
  });

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
    const apiKey = await getGeminiApiKey(settings, accessToken);
    const ai = new GoogleGenAI({ apiKey });
    
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
    const now = new Date();

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                {
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: cleanBase64
                    }
                },
                {
                    text: `Momento actual: ${now.toLocaleString('es-ES')}. Analiza visualmente esta imagen. Identifica qué es (Caca, Vómito, Comida, etc.). Si es CACA, califícala como Buena/Regular/Mala según su aspecto saludable y ponlo en el título.`
                }
            ]
        },
        config: {
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
              },
              required: ["title", "recordType"]
            }
        }
    });

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
    const apiKey = await getGeminiApiKey(settings, accessToken);
    const ai = new GoogleGenAI({ apiKey });
    const now = new Date();

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
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
        },
        config: {
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
              },
              required: ["title", "recordType"]
            }
        }
    });

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
    const apiKey = await getGeminiApiKey(settings, accessToken);
    const ai = new GoogleGenAI({ apiKey });
    const cleanBase64 = base64Data.split(',')[1] || base64Data;
    const now = new Date();

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
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
        },
        config: {
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
              },
              required: ["title", "recordType"]
            }
        }
    });

    if (!response.text) {
        throw new Error("No analysis generated from file");
    }
  
    return JSON.parse(response.text) as AIAnalysisResult;
}

// --- NEW: Consultant Logic with Tool Use ---

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
    
    const apiKey = await getGeminiApiKey(settings, accessToken);
    const ai = new GoogleGenAI({ apiKey });
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

    let response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
            systemInstruction: CONSULTANT_INSTRUCTION,
            tools: [{ functionDeclarations: [queryEventsTool] }]
        }
    });

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
                desc: e.description
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

            response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: newContents,
                config: {
                    systemInstruction: CONSULTANT_INSTRUCTION
                }
            });
        }
    }

    return {
        text: response.text || "No pude generar una respuesta.",
        events: foundEvents.length > 0 ? foundEvents : undefined
    };
};