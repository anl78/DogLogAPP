import { DogEvent, NotionSettings, ConnectionResult, SchemaCheck } from "../types";

// Proxy strategy: Try primary, then fallback
const PROXIES = [
  "https://corsproxy.io/?",
  "https://thingproxy.freeboard.io/fetch/"
];

const EXPECTED_SCHEMA: Record<string, string> = {
  "Título": "title",
  "Fecha": "date",
  "Hora": "rich_text", // or text
  "Tipo de registro": "select",
  "Descripción": "rich_text",
  "Estado de Salud": "select",
  "Peso": "number"
};

// Helper to fetch with retry logic across proxies
async function fetchWithFallback(targetUrl: string, options: RequestInit): Promise<Response> {
  let lastError: any;

  for (const proxyBase of PROXIES) {
    try {
      // Encode target URL for proxy
      const url = proxyBase + encodeURIComponent(targetUrl);
      const response = await fetch(url, options);
      
      // If 401/404/400, the proxy worked but API rejected. Don't switch proxy, return response.
      if (response.status === 401 || response.status === 404 || response.status === 400 || response.status === 422) {
        return response;
      }
      
      // If 200, great.
      if (response.ok) {
        return response;
      }
      
      // If 500 from proxy, try next.
    } catch (error) {
      console.warn(`Proxy ${proxyBase} failed:`, error);
      lastError = error;
    }
  }
  throw lastError || new Error("Todos los proxies fallaron.");
}

export const validateAndDiagnose = async (settings: NotionSettings): Promise<ConnectionResult> => {
  if (!settings.apiKey || !settings.databaseId) {
    return { success: false, message: "Faltan datos de configuración." };
  }

  const targetUrl = `https://api.notion.com/v1/databases/${settings.databaseId}`;
  
  try {
    const response = await fetchWithFallback(targetUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (response.status === 401) return { success: false, message: "API Key inválida. Revisa que empiece por 'secret_'." };
    if (response.status === 404) return { success: false, message: "Base de datos no encontrada. Asegúrate de invitar a la integración a la página." };
    if (!response.ok) return { success: false, message: `Error Notion: ${response.status} ${response.statusText}` };

    const data = await response.json();
    const checks: SchemaCheck[] = [];

    // Validate properties
    const properties = data.properties || {};
    
    Object.entries(EXPECTED_SCHEMA).forEach(([expectedName, expectedType]) => {
        const prop = properties[expectedName];
        if (!prop) {
            checks.push({ 
                field: expectedName, 
                status: 'missing', 
                details: `No encontrada.`, 
                requiredType: expectedType 
            });
        } else {
            // Notion types can be complex, simplified check
            const actualType = prop.type;
            if (actualType !== expectedType) {
                 checks.push({ 
                    field: expectedName, 
                    status: 'wrong_type', 
                    details: `Es tipo '${actualType}', debe ser '${expectedType}'.`, 
                    requiredType: expectedType 
                });
            } else {
                 checks.push({ 
                    field: expectedName, 
                    status: 'ok', 
                    details: 'Correcto', 
                    requiredType: expectedType 
                });
            }
        }
    });

    const hasErrors = checks.some(c => c.status !== 'ok');
    
    return { 
        success: !hasErrors, // Only fully success if schema matches
        message: hasErrors ? "Conexión OK, pero la tabla tiene errores." : "Conexión y Tabla Perfectas.",
        schemaChecks: checks 
    };

  } catch (error: any) {
    return { success: false, message: `Error de red: ${error.message}. Revisa tu internet.` };
  }
};

export const sendToNotion = async (event: DogEvent, settings: NotionSettings): Promise<{ success: boolean; error?: string }> => {
  if (!settings.apiKey || !settings.databaseId) return { success: false, error: "Faltan credenciales." };

  const targetUrl = "https://api.notion.com/v1/pages";

  const properties: any = {
    "Título": { title: [{ text: { content: event.title } }] },
    "Fecha": { date: { start: event.date } },
    "Hora": { rich_text: [{ text: { content: event.time } }] },
    "Tipo de registro": { select: { name: event.recordType } },
    "Descripción": { rich_text: [{ text: { content: event.description } }] }
  };

  if (event.healthStatus) properties["Estado de Salud"] = { select: { name: event.healthStatus } };
  if (event.weight) properties["Peso"] = { number: event.weight };

  const children: any[] = [
    {
      object: "block", type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: event.description } }] }
    }
  ];

  if (event.fileName) {
     children.push({
      object: "block", type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: `📎 Archivo adjunto (local): ${event.fileName}` } }] }
    });
  }

  // NOTE: Notion API does NOT support uploading raw image data (base64) directly.
  // Images must be hosted on a public URL. Since this is a client-side only app,
  // we cannot host images. We log that the image exists locally.
  if (event.photoBase64) {
    children.push({
      object: "block", type: "paragraph",
      paragraph: { 
          rich_text: [{ 
              type: "text", 
              text: { content: "📸 [Foto guardada en el dispositivo] (La API de Notion no permite subir imágenes directamente sin servidor)." },
              annotations: { italic: true, color: "gray" }
          }] 
      }
    });
  }
  
  const payload = {
    parent: { database_id: settings.databaseId },
    properties: properties,
    children: children
  };

  try {
    // 10s Timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetchWithFallback(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    const responseData = await response.json();

    if (!response.ok) {
      console.error("Notion Error:", responseData);
      return { success: false, error: `Notion: ${responseData.message || response.statusText}` };
    }

    return { success: true };
  } catch (error: any) {
    console.error("Submission Error:", error);
    if (error.name === 'AbortError') {
        return { success: false, error: "Tiempo de espera agotado. Revisa tu conexión." };
    }
    return { success: false, error: `Error: ${error.message}` };
  }
};