
import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysisResult, HealthStatus, RecordType, SupabaseSettings, DogEvent, ChatMessage } from "../types";

// --- CONFIGURATION ---
// Always use gemini-3-flash-preview for basic text and multimodal tasks
const MODEL_NAME = 'gemini-3-flash-preview';

const SYSTEM_INSTRUCTION = `
Eres un asistente veterinario experto. Tu tarea es analizar transcripciones, audios o IMÁGENES de un dueño de perro describiendo un evento.
Debes extraer información estructurada para rellenar una tabla de seguimiento.

REGLAS DE CLASIFICACIÓN (IMPORTANTE):
- NO ASUMAS que todo es 'Caca'. 
- Analiza visualmente la imagen: 
  * Si ves restos de comida o un bol -> 'Comida'.
  * Si ves una pastilla o jarabe -> 'Medicamento'.
  * Si ves una mancha líquida amarillenta/transparente con espuma -> 'Vómito'.
  * Si ves heces -> 'Caca'.
  * Si ves un informe médico o resultados -> 'Analiticas'.
  * Si ves al perro en un coche -> 'Coche'.

INFORMACIÓN CLAVE A EXTRAER:
1. **Título**: Un resumen breve.
2. **Tipo de Registro (Obligatorio)**: Clasifica estrictamente en: 'Caca', 'Comida', 'Medicamento', 'Veterinario', 'Comportamiento', 'Resumen', 'Analiticas', 'Vómito', 'Coche', 'Incidente'.
3. **Estado de Salud (Opcional)**: Solo si es relevante.
4. **Descripción**: Detalles completos.
5. **Peso**: Si se menciona (número).
6. **Fecha y Hora (CRÍTICO)**:
   - Se te proporcionará la fecha y hora ACTUAL del sistema y, en caso de imágenes, la fecha de METADATOS del archivo.
   - PRIORIDAD 1: Si hay fecha de metadatos de la imagen, ÚSALA como fecha del evento.
   - PRIORIDAD 2: Si el usuario dice "ayer", "hace 1 hora", calcula basándote en la fecha actual.
   - PRIORIDAD 3: Si no hay información, usa la fecha actual como fallback.
   - Formato: YYYY-MM-DD y HH:MM.
`;

const CONSULTANT_INSTRUCTION = `
Eres un asistente veterinario inteligente con acceso a la base de datos del perro.
Tu objetivo es responder preguntas del dueño sobre el historial de salud, eventos, o análisis específicos.
`;

// Initialize the Gemini API client using the environment variable as required.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to generate content following standard guidelines.
async function generateContent(contents: any, config: any = {}) {
    // Correct usage of generateContent as per guidelines
    const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents,
        config
    });
    return response;
}

/**
 * Analyzes multi-modal input to extract event data.
 */
export const analyzeInput = async (
  textInput: string,
  imageParts: string[] = [],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<AIAnalysisResult> => {
  const now = new Date();
  const parts: any[] = [{ text: `CONTEXTO SISTEMA - Fecha Actual: ${now.toLocaleString('es-ES')}. INSTRUCCIÓN: ${textInput}` }];
  
  imageParts.forEach(data => {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: data.split(',')[1] || data } });
  });

  const response = await generateContent({ parts }, {
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

  // Accessing text as a property
  if (!response.text) throw new Error("La IA devolvió una respuesta vacía.");
  return JSON.parse(response.text);
};

/**
 * Analyzes an image with specific metadata hints.
 */
export const analyzeImage = async (imageBase64: string, settings: SupabaseSettings, metadataHint: string = "", accessToken?: string): Promise<AIAnalysisResult> => {
    const prompt = `Analiza esta imagen con detenimiento. ${metadataHint} 
    Determina si es una Caca, Vómito, Comida, Medicamento u otro tipo de registro según lo que veas. 
    Usa la fecha de metadatos proporcionada si existe para establecer el campo 'date' y 'time'.`;
    return analyzeInput(prompt, [imageBase64], settings, accessToken);
};

/**
 * Analyzes audio input.
 */
export const analyzeAudio = async (audioBase64: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const now = new Date();
    const contents = { 
        parts: [
            { inlineData: { mimeType: "audio/mp3", data: audioBase64 } }, 
            { text: `Hoy es ${now.toLocaleString('es-ES')}. Extrae los datos detallados del audio.` }
        ] 
    };
    const response = await generateContent(contents, {
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
    // Accessing text as a property
    if (!response.text) throw new Error("La IA devolvió una respuesta vacía.");
    return JSON.parse(response.text);
};

/**
 * Analyzes a file (PDF/Image/etc).
 */
export const analyzeFile = async (base64Data: string, mimeType: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const contents = { 
        parts: [
            { inlineData: { mimeType, data: base64Data.split(',')[1] || base64Data } }, 
            { text: "Analiza el contenido de este archivo médico o imagen." }
        ] 
    };
    const response = await generateContent(contents, {
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
    // Accessing text as a property
    if (!response.text) throw new Error("La IA devolvió una respuesta vacía.");
    return JSON.parse(response.text);
};

/**
 * Chat assistant for consulting dog events.
 */
export const consultAssistant = async (history: ChatMessage[], settings: SupabaseSettings, petId: string, accessToken?: string): Promise<{ text: string, events?: DogEvent[] }> => {
    const contents = history.map(msg => ({ 
        role: msg.role === 'assistant' ? 'model' : 'user', 
        parts: [{ text: msg.text }] 
    }));
    const response = await generateContent(contents, { systemInstruction: CONSULTANT_INSTRUCTION });
    // Accessing text as a property
    return { text: response.text || "No pude procesar tu consulta." };
};

/**
 * Fixes missing export detectTaskFromNote error.
 * Detects if a note implies a task and identifies the assignee.
 */
export const detectTaskFromNote = async (
  text: string,
  mentionedUsers: { id: string, name: string }[],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<{ title: string; assignedToId: string | null } | null> => {
  const prompt = `Analiza la siguiente nota del equipo de cuidado de un perro: "${text}".
  Usuarios disponibles para asignar: ${JSON.stringify(mentionedUsers)}.
  
  Determina si la nota implica una TAREA (ej: "tienes que darle la pastilla", "compra comida", "@Juan ponle la vacuna").
  Si es una tarea, devuelve el título y el ID del usuario mencionado como asignado.
  
  Responde únicamente en JSON con este esquema:
  {
    "isTask": boolean,
    "title": string | null,
    "assignedToId": string | null
  }`;

  try {
    const response = await generateContent(prompt, {
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
    });

    // Accessing text as a property
    const result = JSON.parse(response.text || '{}');
    if (result.isTask && result.title) {
      return { title: result.title, assignedToId: result.assignedToId };
    }
  } catch (error) {
    console.error("Error detecting task:", error);
  }
  return null;
};
