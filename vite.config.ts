import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carga las variables de entorno dependiendo del modo.
  // Usamos 'process' casteado a any para evitar errores de tipado estricto si @types/node no está completo.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // Esto inyecta la API KEY en el cliente. 
      // IMPORTANTE: En producción (Vercel), debes añadir la variable 'API_KEY' en la configuración del proyecto en Vercel.
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY)
    }
  };
});