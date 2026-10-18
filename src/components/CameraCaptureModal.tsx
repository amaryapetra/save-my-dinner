import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, RefreshCw, AlertCircle, Image as ImageIcon, Sparkles, SwitchCamera } from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (fileOrDataUrl: string) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackTimerRef = useRef<any>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isInitializing, setIsInitializing] = useState(true);
  const [availableCamerasCount, setAvailableCamerasCount] = useState<number>(2);

  // Stop current video stream cleanly
  const stopStream = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Start video stream with automatic smart fallback
  const startCamera = useCallback(async (desiredMode: 'environment' | 'user') => {
    stopStream();
    setIsInitializing(true);
    setErrorMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setHasPermission(false);
      setErrorMessage('Camera access is not supported by this browser. Use the photo button below.');
      setIsInitializing(false);
      return;
    }

    try {
      // 1. Detect how many cameras exist (e.g. laptop vs phone)
      let videoDevices: MediaDeviceInfo[] = [];
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setAvailableCamerasCount(videoDevices.length);
      } catch (e) {
        // Enumerate not permitted yet, proceed with default
      }

      // If device only has 1 camera (like laptops or desktop webcams), force 'user' mode immediately
      // to avoid black screen from non-existent rear camera
      let targetMode = desiredMode;
      if (videoDevices.length === 1) {
        targetMode = 'user';
        setFacingMode('user');
      }

      // 2. Request camera stream without rigid resolution constraints
      let stream: MediaStream;
      try {
        const constraints: MediaStreamConstraints = {
          video: targetMode === 'environment'
            ? { facingMode: { ideal: 'environment' } }
            : { facingMode: 'user' },
          audio: false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr: any) {
        // If ideal environment failed, try any available video camera
        console.warn('Initial camera constraint failed, falling back to any camera:', firstErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        setFacingMode('user');
      }

      streamRef.current = stream;

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');

        // Play video when metadata is ready
        video.onloadedmetadata = async () => {
          try {
            await video.play();
          } catch (playErr) {
            console.warn('Video play error:', playErr);
          }
        };

        // When actual frames arrive and video has dimensions
        video.onloadeddata = () => {
          if (video.videoWidth > 0) {
            setIsInitializing(false);
            setHasPermission(true);
          }
        };

        // Watchdog: If video stays black or 0-width for 1.2s on environment mode,
        // automatically swap to the front camera so the user never sees an endless black screen!
        if (targetMode === 'environment') {
          fallbackTimerRef.current = setTimeout(() => {
            if (video.videoWidth === 0 || video.readyState < 2) {
              console.log('Environment camera produced black feed. Switching to front camera...');
              setFacingMode('user');
              startCamera('user');
            } else {
              setIsInitializing(false);
              setHasPermission(true);
            }
          }, 1200);
        } else {
          // Front camera watchdog
          fallbackTimerRef.current = setTimeout(() => {
            setIsInitializing(false);
            setHasPermission(true);
          }, 800);
        }
      }
    } catch (err: any) {
      console.warn('Live camera access error:', err);
      setHasPermission(false);
      setIsInitializing(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Camera access was blocked. You can tap below to snap with your phone camera app.');
      } else {
        setErrorMessage('Could not open camera stream. Tap below to use your phone camera directly.');
      }
    }
  }, [stopStream]);

  useEffect(() => {
    if (isOpen) {
      startCamera(facingMode);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, startCamera, stopStream]);

  // Flip camera between back and front
  const toggleCameraFacing = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Capture photo snapshot from the active video feed
  const takeSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stopStream();
    onCapture(dataUrl);
    onClose();
  };

  // Fallback direct phone camera or gallery upload
  const handleNativeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          stopStream();
          onCapture(reader.result as string);
          onClose();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 animate-fade-in">
      <div className="relative w-full max-w-md bg-stone-900 border border-stone-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-stone-900 border-b border-stone-800 z-10">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-white text-xs sm:text-sm font-semibold tracking-wide">
              {facingMode === 'environment' ? 'Back Camera (Pan)' : 'Front Camera (Selfie)'}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {/* Flip camera button right in the top bar */}
            <button
              onClick={toggleCameraFacing}
              className="px-2.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs rounded-xl flex items-center space-x-1.5 transition active:scale-95"
              title="Flip to front/back camera"
            >
              <SwitchCamera className="w-3.5 h-3.5 text-emerald-400" />
              <span>Flip Camera</span>
            </button>

            <button
              onClick={() => {
                stopStream();
                onClose();
              }}
              className="p-1.5 text-stone-400 hover:text-white rounded-full hover:bg-stone-800 transition"
              aria-label="Close camera"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewfinder Area */}
        <div className="relative flex-1 min-h-[350px] bg-black flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              isInitializing ? 'opacity-0' : 'opacity-100'
            }`}
          />

          {/* Simple framing guide for non-chefs */}
          {!isInitializing && hasPermission && (
            <div className="absolute inset-8 pointer-events-none border-2 border-white/40 rounded-2xl flex flex-col justify-between p-3">
              <div className="text-center text-xs text-white/90 font-medium bg-black/50 py-1 px-3 rounded-full mx-auto backdrop-blur-xs">
                Aim phone at your pot or pan
              </div>
              <div className="text-center text-[11px] text-white/70">
                Tap the big button below to snap
              </div>
            </div>
          )}

          {/* Initializing Spinner */}
          {isInitializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-stone-950 text-stone-300">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
              <p className="text-sm font-medium">Turning on camera...</p>
              <p className="text-xs text-stone-500 mt-1">If it looks black, we'll flip it automatically</p>
            </div>
          )}

          {/* Fallback Screen when permission denied or unavailable */}
          {!isInitializing && hasPermission === false && (
            <div className="p-6 text-center flex flex-col items-center justify-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-white text-base font-bold">Use Phone Camera Directly</h3>
                <p className="text-stone-300 text-xs leading-relaxed max-w-xs mx-auto">
                  {errorMessage || 'Tap below to open your phone camera app.'}
                </p>
              </div>

              {/* Native Mobile Camera Fallback */}
              <div className="w-full space-y-2 pt-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm flex items-center justify-center space-x-2 shadow-lg transition active:scale-[0.98]"
                >
                  <Camera className="w-4 h-4" />
                  <span>Take Photo with Phone App</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Hidden native input with capture="environment" for immediate native camera trigger */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleNativeFileChange}
        />

        {/* Bottom Control Bar */}
        <div className="px-6 py-4 bg-stone-900 border-t border-stone-800 flex items-center justify-between">
          {/* Flip Camera button */}
          <button
            onClick={toggleCameraFacing}
            className="p-3 rounded-2xl text-stone-300 hover:text-white bg-stone-800/80 hover:bg-stone-800 transition active:scale-95 flex flex-col items-center justify-center space-y-0.5"
            title="Flip camera"
          >
            <SwitchCamera className="w-5 h-5 text-emerald-400" />
            <span className="text-[10px] text-stone-400">Flip</span>
          </button>

          {/* Shutter Button */}
          {hasPermission ? (
            <button
              onClick={takeSnapshot}
              className="relative p-1 rounded-full bg-white/20 active:scale-95 transition cursor-pointer"
              aria-label="Snap Photo"
            >
              <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:bg-stone-100 transition">
                <div className="w-14 h-14 rounded-full border-2 border-stone-900 flex items-center justify-center">
                  <div className="w-11 h-11 rounded-full bg-[#D9381E]"></div>
                </div>
              </div>
            </button>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center space-x-2"
            >
              <Camera className="w-4 h-4" />
              <span>Take Photo</span>
            </button>
          )}

          {/* Choose from Library button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 rounded-2xl text-stone-300 hover:text-white bg-stone-800/80 hover:bg-stone-800 transition active:scale-95 flex flex-col items-center justify-center space-y-0.5"
            title="Choose from photo library"
          >
            <ImageIcon className="w-5 h-5 text-stone-300" />
            <span className="text-[10px] text-stone-400">Photos</span>
          </button>
        </div>

      </div>
    </div>
  );
};
