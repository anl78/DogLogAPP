import React, { useEffect, useState } from 'react';
import { CollaboratorPermissions, Pet, PetCollaborator, RecordType, SupabaseSettings } from '../types';
import { getCollaborators, inviteCollaborator, removeCollaborator, updateCollaboratorPermissions } from '../services/supabaseService';
import { Icons } from '../constants';

interface TeamManagerProps {
    settings: SupabaseSettings;
    currentPet: Pet;
    currentUserId: string;
    accessToken?: string;
}

const DEFAULT_PERMISSIONS: CollaboratorPermissions = {
    can_create: true,
    can_edit: 'own',
    can_delete: 'own',
    visible_types: [] // All
};

const TeamManager: React.FC<TeamManagerProps> = ({ settings, currentPet, currentUserId, accessToken }) => {
    const [members, setMembers] = useState<PetCollaborator[]>([]);
    const [loading, setLoading] = useState(true);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviting, setInviting] = useState(false);
    
    // Edit Modal State
    const [editingMember, setEditingMember] = useState<PetCollaborator | null>(null);
    const [tempPerms, setTempPerms] = useState<CollaboratorPermissions>(DEFAULT_PERMISSIONS);
    const [savingPerms, setSavingPerms] = useState(false);

    useEffect(() => {
        loadMembers();
    }, [currentPet]);

    const loadMembers = async () => {
        setLoading(true);
        const data = await getCollaborators(settings, currentPet.id, accessToken);
        setMembers(data);
        setLoading(false);
    };

    const isOwner = currentPet.owner_id === currentUserId;

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        
        const result = await inviteCollaborator(settings, currentPet.id, inviteEmail.trim(), accessToken);
        
        if (result.success) {
            setInviteEmail('');
            alert("¡Invitación aceptada! El usuario ya tiene acceso.");
            loadMembers();
        } else {
            alert(result.error);
        }
        setInviting(false);
    };

    const handleRemove = async (userId: string) => {
        if (!window.confirm("¿Seguro que quieres eliminar a este usuario del equipo?")) return;
        
        const result = await removeCollaborator(settings, currentPet.id, userId, accessToken);
        if (result.success) {
            loadMembers();
        } else {
            alert("Error: " + result.error);
        }
    };

    const openEditModal = (member: PetCollaborator) => {
        setEditingMember(member);
        // Ensure permissions object structure exists (handle old data)
        setTempPerms(member.permissions || DEFAULT_PERMISSIONS);
    };

    const savePermissions = async () => {
        if (!editingMember) return;
        setSavingPerms(true);
        
        const result = await updateCollaboratorPermissions(
            settings, 
            currentPet.id, 
            editingMember.user_id, 
            tempPerms, 
            editingMember.role, 
            accessToken
        );

        if (result.success) {
            setEditingMember(null);
            loadMembers();
        } else {
            alert("Error: " + result.error);
        }
        setSavingPerms(false);
    };

    const toggleTypeVisibility = (type: RecordType) => {
        setTempPerms(prev => {
            const current = prev.visible_types || [];
            if (current.includes(type)) {
                return { ...prev, visible_types: current.filter(t => t !== type) };
            } else {
                return { ...prev, visible_types: [...current, type] };
            }
        });
    };

    // Helper: If array is empty, it means ALL are visible. 
    // If not empty, only those in array are visible.
    const isTypeVisible = (type: RecordType) => {
        if (!tempPerms.visible_types || tempPerms.visible_types.length === 0) return true;
        return tempPerms.visible_types.includes(type);
    };

    return (
        <div className="mt-8 border-t border-slate-100 pt-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                👥 Equipo de Cuidado
            </h3>

            {/* Members List */}
            <div className="space-y-3 mb-6">
                {loading ? (
                    <p className="text-sm text-slate-400">Cargando equipo...</p>
                ) : (
                    members.map(m => {
                        const isMe = m.user_id === currentUserId;
                        const isPetOwner = m.role === 'owner';
                        
                        return (
                            <div key={m.user_id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isPetOwner ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {m.profiles?.full_name?.charAt(0).toUpperCase() || m.profiles?.email.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">
                                            {m.profiles?.full_name || 'Usuario'} 
                                            {isMe && <span className="text-slate-400 font-normal ml-1">(Tú)</span>}
                                        </p>
                                        <p className="text-xs text-slate-500">{m.profiles?.email}</p>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isPetOwner ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                            {isPetOwner ? 'Dueño' : 'Colaborador'}
                                        </span>
                                    </div>
                                </div>
                                
                                {/* Actions: Only Owner can edit others */}
                                {isOwner && !isPetOwner && (
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => openEditModal(m)}
                                            className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg"
                                        >
                                            <Icons.Settings className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => handleRemove(m.user_id)}
                                            className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                                        >
                                            <Icons.Trash className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Invite Form (Only Owner) */}
            {isOwner && (
                <form onSubmit={handleInvite} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Invitar Miembro</label>
                    <div className="flex gap-2">
                        <input 
                            type="email" 
                            required
                            placeholder="Email del usuario registrado"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            className="flex-1 p-2 rounded-lg border border-slate-200 text-sm"
                        />
                        <button 
                            type="submit" 
                            disabled={inviting}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                        >
                            {inviting ? '...' : 'Invitar'}
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                        * El usuario debe haber descargado la app y registrado con este email antes de invitarle.
                    </p>
                </form>
            )}

            {/* PERMISSIONS MODAL */}
            {editingMember && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
                        <h3 className="font-bold text-lg mb-1">Permisos de Usuario</h3>
                        <p className="text-sm text-slate-500 mb-4">{editingMember.profiles?.email}</p>

                        <div className="space-y-4">
                            {/* CREATE */}
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Crear Eventos</span>
                                <input 
                                    type="checkbox" 
                                    checked={tempPerms.can_create}
                                    onChange={e => setTempPerms({...tempPerms, can_create: e.target.checked})}
                                    className="w-5 h-5 accent-blue-600"
                                />
                            </div>

                            {/* EDIT */}
                            <div>
                                <span className="text-sm font-medium block mb-2">Editar Eventos</span>
                                <div className="flex bg-slate-100 p-1 rounded-lg">
                                    {['none', 'own', 'all'].map(opt => (
                                        <button
                                            key={opt}
                                            onClick={() => setTempPerms({...tempPerms, can_edit: opt as any})}
                                            className={`flex-1 py-1.5 text-xs font-bold rounded-md capitalize ${tempPerms.can_edit === opt ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}
                                        >
                                            {opt === 'none' ? 'Nadie' : opt === 'own' ? 'Suyos' : 'Todos'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* DELETE */}
                            <div>
                                <span className="text-sm font-medium block mb-2">Eliminar Eventos</span>
                                <div className="flex bg-slate-100 p-1 rounded-lg">
                                    {['none', 'own', 'all'].map(opt => (
                                        <button
                                            key={opt}
                                            onClick={() => setTempPerms({...tempPerms, can_delete: opt as any})}
                                            className={`flex-1 py-1.5 text-xs font-bold rounded-md capitalize ${tempPerms.can_delete === opt ? 'bg-white shadow text-red-600' : 'text-slate-500'}`}
                                        >
                                            {opt === 'none' ? 'Nadie' : opt === 'own' ? 'Suyos' : 'Todos'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* VISIBLE TYPES */}
                            <div className="border-t pt-3">
                                <span className="text-sm font-medium block mb-2">Tipos Visibles</span>
                                <p className="text-[10px] text-slate-400 mb-2">
                                    {(!tempPerms.visible_types || tempPerms.visible_types.length === 0) 
                                        ? "✅ Actualmente ve TODO." 
                                        : "⚠️ Acceso restringido a:"}
                                </p>
                                
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.values(RecordType).map(type => {
                                        // Logic: If array is empty, all checked. If not empty, check if included.
                                        const isChecked = (!tempPerms.visible_types || tempPerms.visible_types.length === 0) 
                                            ? true 
                                            : tempPerms.visible_types.includes(type);

                                        return (
                                            <label key={type} className="flex items-center gap-2 text-xs">
                                                <input 
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => {
                                                        // Special logic for UI: If list empty (all), and user unchecks one, we must populate list with ALL OTHERS.
                                                        if ((!tempPerms.visible_types || tempPerms.visible_types.length === 0)) {
                                                            // Transition from "ALL" to "ALL EXCEPT ONE"
                                                            const allTypes = Object.values(RecordType);
                                                            setTempPerms({...tempPerms, visible_types: allTypes.filter(t => t !== type)});
                                                        } else {
                                                            // Standard toggle
                                                            toggleTypeVisibility(type);
                                                        }
                                                    }}
                                                    className="w-4 h-4 accent-blue-600 rounded"
                                                />
                                                {type}
                                            </label>
                                        );
                                    })}
                                </div>
                                <button 
                                    onClick={() => setTempPerms({...tempPerms, visible_types: []})}
                                    className="text-xs text-blue-500 underline mt-2"
                                >
                                    Ver Todo (Resetear)
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6 pt-4 border-t">
                            <button 
                                onClick={() => setEditingMember(null)}
                                className="flex-1 py-3 bg-slate-100 font-bold text-slate-600 rounded-xl"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={savePermissions}
                                disabled={savingPerms}
                                className="flex-1 py-3 bg-blue-600 font-bold text-white rounded-xl shadow-lg"
                            >
                                {savingPerms ? 'Guardando...' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TeamManager;