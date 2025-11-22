import React, { useState, useRef } from 'react';
import { Icons } from '../constants';

interface AudioRecorderProps {
  onAudioCaptured: (base64: string) => void;
  isProcessing: boolean;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onAudioCaptured, isProcessing }) => {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' }); // WebM is standard for MediaRecorder
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const base64 = reader.result as string;
            // We strip the prefix here or in service, usually safer to pass full data url
            // but the gemini service expects stripped for parts.
            const base64Data = base64.split(',')[1]; 
            onAudioCaptured(base64Data);
        };
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("No se pudo acceder al micrófono.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4 my-6">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isProcessing}
        className={`
            relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300
            ${isRecording 
                ? 'bg-red-500 shadow-[0_0_0_8px_rgba(239,68,68,0.3)] animate-pulse' 
                : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
            }
            ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {isRecording ? (
          <div className="w-8 h-8 bg-white rounded-sm" /> // Stop square
        ) : (
          <Icons.Mic className="w-8 h-8" />
        )}
      </button>
      <p className="text-sm font-medium text-slate-500">
        {isRecording ? 'Grabando... Toca para parar' : isProcessing ? 'Procesando...' : 'Toca para hablar'}
      </p>
    </div>
  );
};

export default AudioRecorder;