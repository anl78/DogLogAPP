import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carga las variables de entorno dependiendo del modo (development/production)
  // En Vercel, las variables de entorno están disponibles en process.env durante el build si se prefijan correctamente,
  // pero aquí usamos 'define' para reemplazar process.env.API_KEY por el valor real.
  // Use type assertion for process to avoid TS error about missing cwd() method
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // Esto permite que el código que usa `process.env.API_KEY` siga funcionando
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY)
    }
  };
});