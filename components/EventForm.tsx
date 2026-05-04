

import React, { useState, useEffect } from 'react';
import { DogEvent, HealthStatus, RecordType } from '../types';
import { HEALTH_STATUS_COLORS, Icons, getPoopScoreColor } from '../constants';
import ImageViewer from './ImageViewer';

interface EventFormProps {
  initialData?: Partial<DogEvent>;
  onSubmit: (event: DogEvent) => void;
  onCancel: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

const EventForm: React.FC<EventFormProps> = ({ 
    initialData, 
    onSubmit, 
    onCancel, 
    onDelete,
    canEdit = true,
    canDelete = true 
}) => {
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
    photoUrl: undefined,
    fileBase64: undefined,
    poopScore: undefined,
    needs_review: undefined,
    ...initialData
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);

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
    if (!canEdit) return;
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'weight' ? (value !== '' ? parseFloat(value) : undefined) : value
    }));
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!canEdit) return;
      setFormData(prev => ({ ...prev, poopScore: parseInt(e.target.value) }));
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
          const MAX_WIDTH = 1600; // Increased width for better zoom quality
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
          // Compress to JPEG with high quality
          resolve(canvas.toDataURL('image/jpeg', 0.85)); 
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'photo' | 'file') => {
    if (!canEdit) return;
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
    if (!canEdit) return;

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
                poopScore: formData.recordType === RecordType.POOP ? formData.poopScore : undefined,
                photoBase64: formData.photoBase64,
                photoUrl: formData.photoUrl,
                fileBase64: formData.fileBase64,
                fileName: formData.fileName,
                userId: formData.userId, // PRESERVE OWNERSHIP
                petId: formData.petId,   // PRESERVE CONTEXT
                needs_review: false,     // Clear review flag when user explicitly saves from form
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

  const previewImage = formData.photoBase64 || formData.photoUrl;

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-5 pb-24 px-1">
      {!canEdit && (
          <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center gap-2">
              <Icons.AlertTriangle className="w-5 h-5 text-amber-600" />
              <p className="text-sm text-amber-800 font-medium">Modo solo lectura (Sin permisos de edición)</p>
          </div>
      )}

      {formData.needs_review && canEdit && (
          <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg flex items-start gap-2 shadow-sm">
              <Icons.Activity className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
              <div>
                  <h4 className="font-bold text-orange-800 text-sm">Pendiente de revisión</h4>
                  <p className="text-xs text-orange-700 mt-1">Este registro fue creado en bloque por la IA. Revisa que los datos y la fecha sean correctos y pulsa el botón guardar para validarlo.</p>
              </div>
          </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Título del Evento *</label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={handleInputChange}
          placeholder="Ej: Caca blanda, Vacunación"
          disabled={!canEdit}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
        />
      </div>

      {/* Record Type (New Field) */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de Registro *</label>
        <select
          name="recordType"
          value={formData.recordType}
          onChange={handleInputChange}
          disabled={!canEdit}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm appearance-none disabled:bg-slate-100 disabled:text-slate-500"
        >
           {Object.values(RecordType).map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      {/* SPECIAL FIELD: POOP SCORE */}
      {formData.recordType === RecordType.POOP && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 animate-fade-in-down">
              <label className="flex justify-between text-sm font-medium text-slate-700 mb-2">
                  <span>Puntuación de Caca (Escala 1-10)</span>
                  <span className={`px-2 rounded font-bold ${getPoopScoreColor(formData.poopScore || 5)}`}>{formData.poopScore || 5}</span>
              </label>
              <input 
                type="range" 
                min="1" 
                max="10" 
                step="1"
                value={formData.poopScore || 5}
                onChange={handleSliderChange}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                disabled={!canEdit}
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>Mala (1)</span>
                  <span>Regular (5)</span>
                  <span>Perfecta (10)</span>
              </div>
          </div>
      )}

      {/* Date & Time Row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Fecha *</label>
          <input
            type="date"
            name="date"
            value={formData.date}
            onChange={handleInputChange}
            disabled={!canEdit}
            className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm text-sm disabled:bg-slate-100 disabled:text-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Hora *</label>
          <input
            type="time"
            name="time"
            value={formData.time}
            onChange={handleInputChange}
            disabled={!canEdit}
            className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm text-sm disabled:bg-slate-100 disabled:text-slate-500"
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
          disabled={!canEdit}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm appearance-none disabled:bg-slate-100 disabled:text-slate-500"
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
          disabled={!canEdit}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
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
          disabled={!canEdit}
          className="w-full p-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm resize-none disabled:bg-slate-100 disabled:text-slate-500"
        />
      </div>

      {/* Attachments */}
      <div className="space-y-3">
        <div>
            <label className={`flex items-center space-x-2 p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-600 ${canEdit ? 'active:bg-slate-100 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <Icons.Camera className="w-5 h-5" />
                <span className="text-sm">{previewImage ? 'Cambiar Foto' : 'Adjuntar Foto'}</span>
                <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'photo')} className="hidden" disabled={!canEdit} />
            </label>
            {previewImage && (
                <div className="mt-2 relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200 group">
                    <img 
                        src={previewImage} 
                        alt="Preview" 
                        className="w-full h-full object-cover cursor-pointer" 
                        onClick={() => setViewImage(previewImage)}
                    />
                    
                    {/* View Button (Eye) */}
                    <button 
                        type="button"
                        onClick={() => setViewImage(previewImage)}
                        className="absolute top-0 right-0 bg-black/50 text-white p-1 rounded-bl-lg"
                    >
                        <Icons.Eye className="w-3 h-3" />
                    </button>

                    {/* Delete Button */}
                    {canEdit && (
                        <button 
                            type="button"
                            onClick={() => setFormData(prev => ({...prev, photoBase64: undefined, photoUrl: undefined}))}
                            className="absolute bottom-0 right-0 bg-red-500 text-white p-1 rounded-tl-lg"
                        >
                            <Icons.Trash className="w-3 h-3" />
                        </button>
                    )}
                </div>
            )}
        </div>
        
        {/* Generic File (Simulated) */}
        <div>
            <label className={`flex items-center space-x-2 p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-600 ${canEdit ? 'active:bg-slate-100 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <span className="text-xl">📎</span>
                <span className="text-sm">{formData.fileName || 'Adjuntar Archivo'}</span>
                <input type="file" onChange={(e) => handleFileChange(e, 'file')} className="hidden" disabled={!canEdit} />
            </label>
        </div>
      </div>

      {/* Buttons */}
      <div className="pt-4 flex flex-col gap-3">
        <div className="flex space-x-3">
            <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 py-3.5 bg-slate-100 text-slate-700 font-semibold rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50"
            >
            Volver
            </button>
            {canEdit && (
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
            )}
        </div>
        
        {/* DELETE BUTTON with Visual Confirmation */}
        {initialData?.id && onDelete && canDelete && (
             <div className="mt-4 pt-4 border-t border-slate-100">
                {!showDeleteConfirm ? (
                    <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isSubmitting}
                        className="w-full py-3 bg-red-50 text-red-600 border border-red-100 font-semibold rounded-xl active:scale-[0.98] transition-transform flex justify-center items-center gap-2"
                    >
                        <Icons.Trash className="w-5 h-5" />
                        <span>Eliminar Evento</span>
                    </button>
                ) : (
                    <div className="bg-red-50 p-3 rounded-xl border border-red-100 animate-fade-in-up">
                        <p className="text-red-800 text-sm font-bold text-center mb-3">¿Eliminar este evento y su foto?</p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-sm font-semibold"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={onDelete}
                                disabled={isSubmitting}
                                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold shadow-sm active:scale-95 transition-transform"
                            >
                                Sí, Eliminar
                            </button>
                        </div>
                    </div>
                )}
             </div>
        )}
      </div>
    </form>
    <ImageViewer src={viewImage} onClose={() => setViewImage(null)} />
    </>
  );
};

export default EventForm;
