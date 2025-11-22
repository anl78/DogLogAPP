import React, { useState, useEffect } from 'react';
import { DogEvent, HealthStatus, RecordType } from '../types';
import { HEALTH_STATUS_COLORS, Icons } from '../constants';

interface EventFormProps {
  initialData?: Partial<DogEvent>;
  onSubmit: (event: DogEvent) => void;
  onCancel: () => void;
}

const EventForm: React.FC<EventFormProps> = ({ initialData, onSubmit, onCancel }) => {
  // Helper strictly for 24h format HH:mm (HTML input time requires this)
  const getCurrentTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
  };

  const [formData, setFormData] = useState<Partial<DogEvent>>({
    title: '',
    date: new Date().toISOString().split('T')[0],
    time: getCurrentTime(),
    recordType: RecordType.BEHAVIOR, // Default
    healthStatus: null,
    description: '',
    weight: undefined,
    photoBase64: undefined,
    fileBase64: undefined,
    ...initialData
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialData) {
        // Ensure time is valid HH:mm, otherwise default to now
        let safeTime = initialData.time;
        // Simple regex to check if it matches HH:mm
        if (!safeTime || !/^\d{2}:\d{2}$/.test(safeTime)) {
            safeTime = getCurrentTime();
        }
        setFormData(prev => ({ ...prev, ...initialData, time: safeTime }));
    }
  }, [initialData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'weight' ? (value !== '' ? parseFloat(value) : undefined) : value
    }));
  };

  // Compress image to avoid LocalStorage quota limits (approx 5MB limit)
  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800; // Resize to reasonable width for mobile viewing
          const scaleSize = MAX_WIDTH / img.width;
          // Only resize if image is larger than MAX_WIDTH
          const finalWidth = scaleSize < 1 ? MAX_WIDTH : img.width;
          const finalHeight = scaleSize < 1 ? img.height * scaleSize : img.height;

          canvas.width = finalWidth;
          canvas.height = finalHeight;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(event.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Compress to JPEG with 0.7 quality
          resolve(canvas.toDataURL('image/jpeg', 0.7)); 
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'photo' | 'file') => {
    const file = e.target.files?.[0];
    if (file) {
        try {
            if (type === 'photo') {
                // Compress photos
                const compressedBase64 = await resizeImage(file);
                setFormData(prev => ({ ...prev, photoBase64: compressedBase64 }));
            } else {
                // Generic files (usually smaller documents, but careful with size)
                const reader = new FileReader();
                reader.onloadend = () => {
                    setFormData(prev => ({ ...prev, fileBase64: reader.result as string, fileName: file.name }));
                };
                reader.readAsDataURL(file);
            }
        } catch (error) {
            console.error("Error processing file", error);
            alert("Error al procesar el archivo. Intenta con uno más pequeño.");
        }
    }
  };

  // Helper to generate VALID UUID v4 (Strictly required by Supabase UUID column)
  const generateId = () => {
    // Try native crypto first
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {
            console.warn("crypto.randomUUID failed, falling back");
        }
    }
    // Robust Polyfill for UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Small timeout to allow UI to update to "Guardando..." before heavy lifting
    setTimeout(() => {
        try {
            // CHANGED: Removed formData.description from required check
            if (!formData.title || !formData.recordType) {
                alert("Por favor, completa título y tipo de registro.");
                setIsSubmitting(false);
                return;
            }
            
            // Validate ID format. If existing ID is simple string (old local data), replace with UUID
            let safeId = formData.id;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!safeId || !uuidRegex.test(safeId)) {
                safeId = generateId();
            }

            const finalEvent: DogEvent = {
                id: safeId,
                title: formData.title!,
                recordType: formData.recordType!,
                date: formData.date!,
                time: formData.time!, // Should now be HH:mm
                healthStatus: formData.healthStatus || null,
                description: formData.description || "", // Allow empty string
                weight: formData.weight !== undefined ? formData.weight : undefined,
                photoBase64: formData.photoBase64,
                fileBase64: formData.fileBase64,
                fileName: formData.fileName,
                synced: false
            };
            
            onSubmit(finalEvent);
        } catch (error: any) {
            console.error("Form submission error:", error);
            alert(`Error al procesar el formulario: ${error.message}`);
            setIsSubmitting(false);
        }
    }, 50);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-24 px-1">
      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Título del Evento *</label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={handleInputChange}
          placeholder="Ej: Caca blanda, Vacunación"
          className="w-full p-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
        />
      </div>

      {/* Record Type (New Field) */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de Registro *</label>
        <select
          name="recordType"
          value={formData.recordType}
          onChange={handleInputChange}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm appearance-none"
        >
           {Object.values(RecordType).map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      {/* Date & Time Row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Fecha *</label>
          <input
            type="date"
            name="date"
            value={formData.date}
            onChange={handleInputChange}
            className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Hora *</label>
          <input
            type="time"
            name="time"
            value={formData.time}
            onChange={handleInputChange}
            className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm text-sm"
          />
        </div>
      </div>

      {/* Health Status (Optional) */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Estado de Salud (Opcional)</label>
        <select
          name="healthStatus"
          value={formData.healthStatus || ''}
          onChange={handleInputChange}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm appearance-none"
        >
          <option value="">-- Ninguno / No aplica --</option>
          {Object.values(HealthStatus).map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        {formData.healthStatus && (
            <div className={`mt-2 text-xs px-3 py-1 rounded-full inline-block border ${HEALTH_STATUS_COLORS[formData.healthStatus as HealthStatus]}`}>
                Indicador visual
            </div>
        )}
      </div>

      {/* Weight */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Peso (kg)</label>
        <input
          type="number"
          name="weight"
          step="0.1"
          value={formData.weight !== undefined ? formData.weight : ''}
          onChange={handleInputChange}
          placeholder="0.0"
          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
        <textarea
          name="description"
          rows={4}
          value={formData.description}
          onChange={handleInputChange}
          placeholder="Detalles del comportamiento, comida, etc."
          className="w-full p-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm resize-none"
        />
      </div>

      {/* Attachments */}
      <div className="space-y-3">
        <div>
            <label className="flex items-center space-x-2 p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-600 active:bg-slate-100 cursor-pointer">
                <Icons.Camera className="w-5 h-5" />
                <span className="text-sm">{formData.photoBase64 ? 'Cambiar Foto' : 'Adjuntar Foto'}</span>
                <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'photo')} className="hidden" />
            </label>
            {formData.photoBase64 && (
                <div className="mt-2 relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200">
                    <img src={formData.photoBase64} alt="Preview" className="w-full h-full object-cover" />
                    <button 
                        type="button"
                        onClick={() => setFormData(prev => ({...prev, photoBase64: undefined}))}
                        className="absolute top-0 right-0 bg-black/50 text-white p-1 rounded-bl-lg"
                    >
                        <Icons.Trash className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
        
        {/* Generic File (Simulated) */}
        <div>
            <label className="flex items-center space-x-2 p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-600 active:bg-slate-100 cursor-pointer">
                <span className="text-xl">📎</span>
                <span className="text-sm">{formData.fileName || 'Adjuntar Archivo'}</span>
                <input type="file" onChange={(e) => handleFileChange(e, 'file')} className="hidden" />
            </label>
        </div>
      </div>

      {/* Buttons */}
      <div className="pt-4 flex space-x-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 py-3.5 bg-slate-100 text-slate-700 font-semibold rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 py-3.5 bg-blue-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-200 active:scale-[0.98] transition-transform flex justify-center items-center space-x-2 disabled:opacity-70"
        >
          {isSubmitting ? (
             <span className="flex items-center gap-2">
               <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
               Procesando...
             </span>
          ) : (
             <>
               <Icons.Check className="w-5 h-5" />
               <span>Guardar</span>
             </>
          )}
        </button>
      </div>
    </form>
  );
};

export default EventForm;