import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { SupabaseSettings } from '../types';
import { createPet } from '../services/supabaseService';

interface AuthProps {
  settings: SupabaseSettings;
  onLoginSuccess: () => void;
}

const Auth: React.FC<AuthProps> = ({ settings, onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  
  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Signup Extra State
  const [fullName, setFullName] = useState('');
  const [petName, setPetName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = React.useMemo(() => {
    return createClient(settings.supabaseUrl, settings.supabaseKey);
  }, [settings]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;
        onLoginSuccess();
    } catch (err: any) {
        setError(err.message || "Error iniciando sesión");
    } finally {
        setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!petName.trim()) {
        setError("Por favor, introduce el nombre de tu mascota.");
        setLoading(false);
        return;
    }

    try {
        // 1. Sign Up User
        // IMPORTANTE: emailRedirectTo asegura que el link del correo vuelva a ESTA app,
        // no a localhost:3000 por defecto.
        const { data, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName
                },
                emailRedirectTo: window.location.origin 
            }
        });

        if (signUpError) throw signUpError;
        
        // CASE: Email Confirmation Required (Supabase default)
        if (data.user && !data.session) {
            alert("¡Cuenta creada! Hemos enviado un enlace de confirmación a tu correo. Por favor, confírmalo antes de iniciar sesión.");
            setMode('login'); // Switch to login tab so they can enter after confirming
            setLoading(false);
            return;
        }

        // CASE: Auto-login successful (Email confirmation disabled or implicit)
        if (data.session && data.user) {
            // 2. Create Pet
            // We pass the user ID from the auth response.
            try {
                // We recreate the client with the session to ensure permissions work if RLS is strict
                // But createPet uses a fresh client from settings usually. 
                // Ideally, we pass the session token, but for now we rely on the backend accepting the insert
                // or the user being implicitly logged in.
                await createPet(settings, petName, data.user.id);
                alert("¡Cuenta y Mascota creadas con éxito!");
                onLoginSuccess();
            } catch (petError) {
                console.error("Error creating pet:", petError);
                // Non-blocking. User is created. They will land on "No Pet Found" screen in App.tsx
                // and can create it there.
                onLoginSuccess();
            }
        }

    } catch (err: any) {
        setError(err.message || "Error en el registro");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl overflow-hidden">
        
        {/* Header Image/Logo */}
        <div className="bg-blue-600 p-8 text-center">
            <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">DogLog 🐾</h1>
            <p className="text-blue-100 text-sm font-medium">Tu asistente veterinario personal</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
            <button 
                onClick={() => { setMode('login'); setError(null); }}
                className={`flex-1 py-4 text-sm font-bold transition-colors ${mode === 'login' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
                Iniciar Sesión
            </button>
            <button 
                onClick={() => { setMode('signup'); setError(null); }}
                className={`flex-1 py-4 text-sm font-bold transition-colors ${mode === 'signup' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
                Crear Cuenta
            </button>
        </div>

        <div className="p-8">
            <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
                
                {mode === 'signup' && (
                    <div className="animate-fade-in-down space-y-4">
                         <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Tu Nombre</label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={e => setFullName(e.target.value)}
                                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="Ej: Juan Pérez"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Nombre de Mascota</label>
                            <input
                                type="text"
                                value={petName}
                                onChange={e => setPetName(e.target.value)}
                                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="Ej: Toby"
                                required
                            />
                        </div>
                        <div className="border-t border-slate-100 my-4"></div>
                    </div>
                )}

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        placeholder="nombre@ejemplo.com"
                        required
                    />
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Contraseña</label>
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        placeholder="••••••••"
                        required
                        minLength={6}
                    />
                </div>

                {error && (
                    <div className="p-3 bg-red-50 text-red-600 text-xs font-medium rounded-lg border border-red-100 text-center animate-shake">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-all disabled:opacity-70 mt-4"
                >
                    {loading ? 'Procesando...' : (mode === 'login' ? 'Entrar' : 'Registrarse y Crear Perfil')}
                </button>
            </form>
        </div>
      </div>
      <p className="mt-8 text-xs text-slate-400 font-medium">DogLog Assistant v4.0</p>
    </div>
  );
};

export default Auth;