import React, { useState } from 'react';

interface ImageViewerProps {
  src: string | null;
  onClose: () => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ src, onClose }) => {
  // 0: Fit screen
  // 1: Zoom In 
  // 2: Max Zoom 
  const [zoomLevel, setZoomLevel] = useState<0 | 1 | 2>(0);

  if (!src) return null;

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel(prev => (prev === 0 ? 1 : prev === 1 ? 2 : 0));
  };

  const isZoomed = zoomLevel > 0;

  let imgStyles: React.CSSProperties = {};
  let imgClasses = 'shadow-2xl transition-all duration-300 ease-in-out block mx-auto ';

  if (zoomLevel === 0) {
    imgClasses += 'cursor-zoom-in max-w-full max-h-full object-contain rounded-lg';
  } else if (zoomLevel === 1) {
    imgClasses += 'cursor-zoom-in rounded-lg';
    // Mobile friendly sizing logic: min-width ensures it scales nicely on small screens
    imgStyles = { width: '200vw', minWidth: '800px', maxWidth: 'none', height: 'auto' }; 
  } else if (zoomLevel === 2) {
    imgClasses += 'cursor-zoom-out rounded-lg';
    imgStyles = { width: '350vw', minWidth: '1600px', maxWidth: 'none', height: 'auto' }; 
  }

  return (
    <div 
      className={`fixed inset-0 z-[100] bg-black/98 animate-fade-in ${
        isZoomed ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center p-4'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Close Button */}
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-4 right-4 p-3 bg-black/60 text-white rounded-full hover:bg-white/20 transition-colors z-[110]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      {/* Image Container */}
      <div 
        // Remove flex justify-center when zoomed to prevent top-left clipping on mobile devices
        className={isZoomed ? "min-h-full min-w-full p-4 md:p-12 block" : "h-full w-full flex items-center justify-center"}
        onClick={onClose}
      >
        <img 
          src={src} 
          alt="Vista completa" 
          className={imgClasses}
          style={imgStyles}
          onClick={handleImageClick}
        />
      </div>
    </div>
  );
};

export default ImageViewer;