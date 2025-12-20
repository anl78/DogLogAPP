import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysisResult, HealthStatus, RecordType, SupabaseSettings, DogEvent, ChatMessage } from "../types";

// Siempre usar gemini-3-flash-preview para tareas de texto básico y multimodales
const MODEL_NAME = 'gemini-3-flash-preview';

const SYSTEM_INSTRUCTION = `
Eres un asistente veterinario experto. Tu tarea es analizar imágenes, audios o textos de un dueño de perro.

REGLAS DE CLASIFICACIÓN VISUAL (CRÍTICO):
Analiza la imagen adjunta y clasifícala en uno de estos tipos:
- 'Comida': Si ves cuencos, sacos de pienso o comida casera.
- 'Medicamento': Si ves pastillas, botes de jarabe, jeringuillas o cajas de fármacos.
- 'Vómito': Si ves manchas de fluido estomacal o comida devuelta.
- 'Caca': Si ves excrementos. Evalúa también la consistencia (poopScore 1-10).
- 'Analiticas': Si ves informes médicos, papeles con resultados o facturas veterinarias.
- 'Coche': Si la foto es dentro de un coche o transportín.
- 'Incidente': Si ves una herida o algo inusual.

REGLA DE FECHA Y HORA (MANDATORIO):
1. Si el mensaje de entrada contiene "METADATOS_IMAGEN", DEBES usar obligatoriamente esa fecha y hora para los campos 'date' y 'time'. No uses la fecha de hoy.
2. Solo si NO hay metadatos de imagen ni se menciona una fecha en el texto, usa la fecha actual proporcionada como fallback.

SALIDA: Devuelve siempre JSON con title, recordType, description, date (YYYY-MM-DD), time (HH:MM), healthStatus, weight (si aplica) y poopScore (si es caca).
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

export const analyzeInput = async (
  textInput: string,
  imageParts: string[] = [],
  settings: SupabaseSettings,
  accessToken?: string
): Promise<AIAnalysisResult> => {
  const ai = getAIClient();
  const now = new Date();
  
  // Estructuramos el prompt para que los metadatos tengan prioridad visual absoluta
  const promptText = imageParts.length > 0 
    ? `DATOS DE LA FOTO: ${textInput}\n\n[CONTEXTO SISTEMA: Si no hay datos arriba, hoy es ${now.toLocaleString('es-ES')}]`
    : `INSTRUCCIÓN: ${textInput}\nFECHA ACTUAL: ${now.toLocaleString('es-ES')}`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{
      parts: [
        { text: promptText },
        ...imageParts.map(data => ({
          inlineData: { mimeType: 'image/jpeg', data: data.split(',')[1] || data }
        }))
      ]
    }],
    config: {
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
        required: ["title", "recordType", "date", "time"]
      }
    }
  });

  if (!response.text) throw new Error("La IA no devolvió contenido.");
  return JSON.parse(response.text);
};

export const analyzeImage = async (imageBase64: string, settings: SupabaseSettings, metadataHint: string = "", accessToken?: string): Promise<AIAnalysisResult> => {
    return analyzeInput(metadataHint, [imageBase64], settings, accessToken);
};

export const analyzeAudio = async (audioBase64: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const ai = getAIClient();
    const now = new Date();
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "audio/mp3", data: audioBase64 } },
            { text: `Hoy es ${now.toLocaleString('es-ES')}. Transcribe y extrae datos.` }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json"
      }
    });
    if (!response.text) throw new Error("Audio vacío.");
    return JSON.parse(response.text);
};

export const analyzeFile = async (base64Data: string, mimeType: string, settings: SupabaseSettings, accessToken?: string): Promise<AIAnalysisResult> => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: base64Data.split(',')[1] || base64Data } },
            { text: "Analiza este documento veterinario." }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json"
      }
    });
    if (!response.text) throw new Error("Archivo vacío.");
    return JSON.parse(response.text);
};

export const consultAssistant = async (history: ChatMessage[], settings: SupabaseSettings, petId: string, accessToken?: string): Promise<{ text: string, events?: DogEvent[] }> => {
    const ai = getAIClient();
    const contents = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.text }]
    }));

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents,
      config: { systemInstruction: CONSULTANT_INSTRUCTION }
    });

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
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
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
      }
    });

    const result = JSON.parse(response.text || '{}');
    if (result.isTask && result.title) {
      return { title: result.title, assignedToId: result.assignedToId };
    }
  } catch (error) {
    console.error("Task detection error:", error);
  }
  return null;
};