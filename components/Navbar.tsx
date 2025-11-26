
import React from 'react';
import { Icons } from '../constants';

interface NavbarProps {
  currentView: 'home' | 'board' | 'add' | 'settings' | 'consult';
  setView: (view: 'home' | 'board' | 'add' | 'settings' | 'consult') => void;
  hasUnread?: boolean;
}

const Navbar: React.FC<NavbarProps> = ({ currentView, setView, hasUnread }) => {
  return (
    <nav className="absolute bottom-0 w-full bg-white border-t border-slate-200 pb-safe pt-2 px-1 flex justify-between items-center h-20 z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <button 
        onClick={() => setView('home')}
        className={`flex flex-col items-center space-y-1 w-1/5 transition-colors ${currentView === 'home' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <Icons.Home className="w-6 h-6" />
        <span className="text-[9px] font-medium">Inicio</span>
      </button>

      <button 
        onClick={() => setView('board')}
        className={`flex flex-col items-center space-y-1 w-1/5 transition-colors relative ${currentView === 'board' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <div className="relative">
            <Icons.Board className="w-6 h-6" />
            {hasUnread && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
            )}
        </div>
        <span className="text-[9px] font-medium">Tablón</span>
      </button>

      <button 
        onClick={() => setView('add')}
        className={`flex flex-col items-center space-y-1 w-1/5 transition-colors ${currentView === 'add' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <Icons.Plus className="w-6 h-6" />
        <span className="text-[9px] font-medium">Nuevo</span>
      </button>

      <button 
        onClick={() => setView('consult')}
        className={`flex flex-col items-center space-y-1 w-1/5 transition-colors ${currentView === 'consult' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <Icons.Sparkles className="w-6 h-6" />
        <span className="text-[9px] font-medium">IA</span>
      </button>

      <button 
        onClick={() => setView('settings')}
        className={`flex flex-col items-center space-y-1 w-1/5 transition-colors ${currentView === 'settings' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
      >
        <Icons.Settings className="w-6 h-6" />
        <span className="text-[9px] font-medium">Ajustes</span>
      </button>
    </nav>
  );
};

export default Navbar;
