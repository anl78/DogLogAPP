
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AIAnalysisResult, HealthStatus, RecordType, SupabaseSettings, DogEvent, ChatMessage } from "../types";

// ESTRATEGIA DE MODELOS:
// 1. Primary: El más inteligente (pero inestable/rate-limited en Preview).
// 2. Fallback: El más robusto, rápido y barato (para cuando el 1 falla).
const MODEL_PRIMARY = 'gemini-2.5-pro'; // Cambio temporal a 2.5 Pro que es más estable
const MODEL_FALLBACK = 'gemini-2.5-flash';

const SYSTEM_INSTRUCTION = `
Eres un asistente veterinario experto. Tu tarea es analizar imágenes, audios o textos de un dueño de perro.

REGLAS DE CLASIFICACIÓN VISUAL (CRÍTICO):
Analiza la imagen adjunta y clasifícala estrictamente en uno de estos tipos de 'recordType':
- 'Caca': Excrementos. OBLIGATORIO: Evalúa consistencia (poopScore 1-10).
  REGLA DE TÍTULO PARA CACA: El 'title' DEBE ser un resumen corto que empiece por la calificación.
  Usa esta escala estricta basada en el poopScore:
  * 0-2: "Muy mala"
  * 3-4: "Mala"
  * 5-6: "Regular"
  * 7-8: "Buena"
  * 9-10: "Excelente"
  Ejemplo de título: "Buena - Heces firmes y color normal".
- 'Comida': Cuencos, sacos de pienso, comida casera.
- 'Medicamento': Pastillas, jarabes, inyecciones, cajas de fármacos.
- 'Veterinario': Consultas, veterinarios, clínicas.
- 'Comportamiento': Acciones del perro, estado de ánimo.
- 'Resumen': Resúmenes semanales o notas generales.
- 'Analiticas': Informes médicos, analíticas de sangre, facturas.
- 'Vómito': Manchas de fluido estomacal, comida devuelta.
- 'Coche': Perro en el coche, transportín, viajes.
- 'Incidente': Heridas, accidentes, cosas inusuales.

REGLA DE FECHA Y HORA (MANDATORIO):
1. Si recibes un bloque "METADATOS_FOTO", DEBES usar esa fecha y hora EXACTAMENTE para los campos 'date' y 'time'. Es la fecha real de captura contenida en el EXIF.
2. Solo si NO hay metadatos específicos de foto, usa la fecha actual proporcionada.
3. El formato de 'date' debe ser YYYY-MM-DD y 'time' HH:MM.
`;

const CONSULTANT_INSTRUCTION = `
Eres un asistente veterinario inteligente. Responde dudas sobre el historial del perro basándote en los eventos proporcionados.
`;

const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey.length < 5) {
    throw new Error("API Key no configurada.");
  }
  return new GoogleGenAI({ apiKey });
};

// --- HELPER DE RESCATE (FALLBACK LOGIC) ---
const generateWithFallback = async (ai: GoogleGenAI, contents: any, config: any): Promise<GenerateContentResponse> => {
    // INTENTO 1: Modelo Primario
    try {
        return await ai.models.generateContent({
            model: MODEL_PRIMARY,
            contents,
            config
        });
    } catch (primaryError: any) {
        console.warn(`⚠️ [IA] Falló ${MODEL_PRIMARY}. Causa: ${primaryError.message}. Iniciando rescate con ${MODEL_FALLBACK}...`);

        // INTENTO 2: Modelo Fallback (Gemini 2.5 - Estable)
        try {
            return await ai.models.generateContent({
                model: MODEL_FALLBACK,
                contents,
                config
            });
        } catch (fallbackError: any) {
            console.warn(`⚠️ [IA] Falló ${MODEL_FALLBACK}. Causa: ${fallbackError.message}. Reintentando en 2s...`);
            
            // INTENTO 3: Reintento rápido del Fallback (espera 2s)
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            try {
                 return await ai.models.generateContent({
                    model: MODEL_FALLBACK,
                    contents,
                    config
                });
            } catch (finalError: any) {
                console.error("❌ Fallo total de IA:", finalError);
                throw new Error(`Ambos modelos fallaron. Error final: ${finalError.message}`);
            }
        }
    }
};

// Esquema común para todas las respuestas de análisis
const ANALYSIS_SCHEMA = {
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
  required: ["title", "recordType", "date", "time"]
};

export const analyzeInput = async (
  textInput: string,
  imageParts: string[] = [],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<AIAnalysisResult> => {
  const ai = getAIClient();
  const now = new Date();
  
  const promptText = imageParts.length > 0 
    ? `METADATOS_FOTO: ${textInput}`
    : `INSTRUCCIÓN: ${textInput}\nFECHA_ACTUAL: ${now.toLocaleString('es-ES')}`;

  const contents = [{
      parts: [
        { text: promptText },
        ...imageParts.map(data => ({
          inlineData: { mimeType: 'image/jpeg', data: data.split(',')[1] || data }
        }))
      ]
  }];

  const config = {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_SCHEMA
  };

  const response = await generateWithFallback(ai, contents, config);

  if (!response.text) throw new Error("La IA no devolvió contenido.");
  return JSON.parse(response.text);
};

export const analyzeImage = async (imageBase64: string, settings: SupabaseSettings, metadataHint: string = "", accessToken?: string): Promise<AIAnalysisResult> => {
    return analyzeInput(metadataHint, [imageBase64], settings, accessToken);
};

export const analyzeAudio = async (audioBase64: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const ai = getAIClient();
    const now = new Date();
    
    const contents = [
        {
          parts: [
            { inlineData: { mimeType: "audio/mp3", data: audioBase64 } },
            { text: `Hoy es ${now.toLocaleString('es-ES')}. Transcribe este audio y extrae los datos del evento del perro siguiendo las reglas de clasificación.` }
          ]
        }
    ];

    const config = {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA
    };

    const response = await generateWithFallback(ai, contents, config);
    
    if (!response.text) throw new Error("Audio vacío.");
    return JSON.parse(response.text);
};

export const analyzeFile = async (base64Data: string, mimeType: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const ai = getAIClient();
    
    const contents = [
        {
          parts: [
            { inlineData: { mimeType, data: base64Data.split(',')[1] || base64Data } },
            { text: "Analiza este documento veterinario." }
          ]
        }
    ];

    const config = {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA
    };

    const response = await generateWithFallback(ai, contents, config);
    
    if (!response.text) throw new Error("Archivo vacío.");
    return JSON.parse(response.text);
};

export const consultAssistant = async (history: ChatMessage[], settings: SupabaseSettings, petId: string, accessToken?: string): Promise<{ text: string, events?: DogEvent[] }> => {
    const ai = getAIClient();
    const contents = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));

    const config = { systemInstruction: CONSULTANT_INSTRUCTION };

    const response = await generateWithFallback(ai, contents, config);

    return { text: response.text || "No tengo respuesta." };
};

export const detectTaskFromNote = async (
  text: string,
  mentionedUsers: { id: string, name: string }[],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<{ title: string; assignedToId: string | null } | null> => {
  const ai = getAIClient();
  const prompt = `Nota: "${text}". Usuarios: ${JSON.stringify(mentionedUsers)}. ¿Es tarea? Responde JSON {isTask, title, assignedToId}`;

  try {
    const contents = [{ parts: [{ text: prompt }] }];
    const config = {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isTask: { type: Type.BOOLEAN },
            title: { type: Type.STRING, nullable: true },
            assignedToId: { type: Type.STRING, nullable: true }
          },
          required: ["isTask"]
        }
    };

    // We also use fallback here to ensure tasks are created even if 3.0 is busy
    const response = await generateWithFallback(ai, contents, config);

    const result = JSON.parse(response.text || '{}');
    if (result.isTask && result.title) {
      return { title: result.title, assignedToId: result.assignedToId };
    }
  } catch (error) {
    console.error("Task detection error:", error);
  }
  return null;
};
