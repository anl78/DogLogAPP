
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carga las variables de entorno dependiendo del modo.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // Definimos constantes globales que Vite reemplazará por su valor literal en tiempo de compilación.
      // Esto evita errores de "process is not defined" o "import.meta.env is undefined" en el navegador.
      '__API_KEY__': JSON.stringify(env.API_KEY || process.env.API_KEY || "AIzaSyDRs92kUFJSJhQFgsbq7zgmBAgSYDi2Iuw"),
      '__SUPABASE_URL__': JSON.stringify(env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://nvnmlausdsexvmcrnzxc.supabase.co"),
      '__SUPABASE_KEY__': JSON.stringify(env.VITE_SUPABASE_KEY || process.env.VITE_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bm1sYXVzZHNleHZtY3JuenhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTE5MjAsImV4cCI6MjA3OTIyNzkyMH0.i2ddyT9GvT70bkIHqSW_whf9UMqqkNnAWawC4k91W0c")
    }
  };
});
