import React, { useState, useRef } from 'react';
import {
  Camera,
  Upload,
  Flame,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  HelpCircle,
  X,
  ChefHat,
  ArrowRight,
  RefreshCw,
  UtensilsCrossed,
  ShieldCheck,
  Zap,
  Info,
  Mic,
  MicOff,
  Award,
  BookOpen
} from 'lucide-react';
import { RescueResponse, ConversationMessage, SampleMishap } from './types';
import { compressImage, CompressionResult } from './utils/imageCompressor';
import { useVoiceDictation } from './utils/useVoiceDictation';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { RescueResultsView } from './components/RescueResultsView';
import { ProjectSubmissionModal } from './components/ProjectSubmissionModal';
import { SAMPLE_MISHAPS } from './data/sampleMishaps';

const SHARED_APP_URL = 'https://ais-pre-gncui5dtvv33az5clweulj-279845690615.us-west1.run.app';

export default function App() {
  // Input states
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string>('image/jpeg');
  const [compressionInfo, setCompressionInfo] = useState<{ origKB: number; compKB: number } | null>(null);

  const [dishName, setDishName] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [selectedIssueCategory, setSelectedIssueCategory] = useState<string | null>(null);

  // Flow & AI states
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'analyzing' | 'troubleshooting' | 'planning'>('analyzing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentDiagnosis, setCurrentDiagnosis] = useState<RescueResponse | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isFollowUpLoading, setIsFollowUpLoading] = useState(false);

  // Modals & inputs
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hands-free microphone voice dictation (Device Feature 2)
  const { isListening, isSupported: isVoiceSupported, toggleListening } = useVoiceDictation({
    onTranscript: (text) => {
      setProblemDescription(text);
    },
    onError: (err) => {
      setErrorMessage(err);
    },
  });

  const issueChips = [
    { label: 'Too watery', query: 'There is way too much water in the pan and it won\'t thicken up' },
    { label: 'Too salty', query: 'I poured in too much salt and it burns my tongue' },
    { label: 'Too dry', query: 'The food is drying out and looks tough or stuck' },
    { label: 'Not browning', query: 'The food is boiling and steaming instead of getting crispy or brown' },
    { label: 'Burning on bottom', query: 'The food is catching and turning black on the bottom of the pan' },
    { label: 'Raw inside', query: 'The outside looks browned, but the inside is still pink or raw' },
    { label: 'Something else', query: '' },
  ];

  // Handle image compression when a photo is selected
  const handleProcessImage = async (fileOrDataUrl: File | string) => {
    try {
      setIsLoading(true);
      setLoadingPhase('analyzing');
      const compressed: CompressionResult = await compressImage(fileOrDataUrl, 1400, 1400, 0.82);
      setPhotoDataUrl(compressed.dataUrl);
      setPhotoBase64(compressed.base64);
      setPhotoMimeType(compressed.mimeType);
      setCompressionInfo({
        origKB: compressed.originalSizeKB,
        compKB: compressed.compressedSizeKB,
      });
      setIsLoading(false);
    } catch (err: any) {
      console.error('Image processing failed:', err);
      setErrorMessage('Failed to process photo. Please try uploading another image.');
      setIsLoading(false);
    }
  };

  // Handle native file input
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessImage(file);
    }
  };

  // Select a preset mishap
  const handleSelectSampleMishap = (sample: SampleMishap) => {
    setDishName(sample.foodName);
    setProblemDescription(sample.description);
    setSelectedIssueCategory(sample.category);
    handleProcessImage(sample.previewImage);
  };

  // Submit diagnosis request to server-side Gemini
  const handleRescueSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!photoBase64 && !problemDescription.trim()) {
      setErrorMessage('Please snap a photo or describe what is going wrong with your food.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setLoadingPhase('analyzing');

    try {
      const response = await fetch('/api/rescue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageBase64: photoBase64,
          mimeType: photoMimeType,
          problemDescription: problemDescription.trim(),
          issueCategory: selectedIssueCategory,
          dishName: dishName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to analyze food. Please check your network and retry.');
      }

      const diagnosisData: RescueResponse = result.data;
      setCurrentDiagnosis(diagnosisData);

      // Seed multi-turn conversation history
      const initialHistory: ConversationMessage[] = [
        {
          role: 'user',
          text: `Dish: ${dishName || diagnosisData.foodIdentified}. Issue: ${problemDescription || selectedIssueCategory || 'See photo'}`,
          imageBase64: photoBase64 || undefined,
          mimeType: photoMimeType,
          timestamp: Date.now(),
        },
        {
          role: 'model',
          text: `Diagnosis: ${diagnosisData.diagnosis}. Steps: ${diagnosisData.rescuePlan.map((s) => `${s.stepNumber}. ${s.instruction}`).join(' ')}`,
          timestamp: Date.now(),
          diagnosisData,
        },
      ];
      setConversationHistory(initialHistory);
    } catch (err: any) {
      console.error('Rescue error:', err);
      setErrorMessage(err.message || 'Something went wrong while diagnosing your dinner. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Multi-turn follow-up request to server
  const handleSendFollowUp = async (userText: string, newImage: string | null) => {
    setIsFollowUpLoading(true);
    setErrorMessage(null);

    let compressedNewB64: string | null = null;
    let newMime = 'image/jpeg';

    if (newImage) {
      try {
        const compressed = await compressImage(newImage, 1200, 1200, 0.8);
        compressedNewB64 = compressed.base64;
        newMime = compressed.mimeType;
      } catch (e) {
        console.warn('Failed to compress follow-up image:', e);
      }
    }

    try {
      const response = await fetch('/api/follow-up', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationHistory,
          newImageBase64: compressedNewB64,
          newMimeType: newMime,
          userMessage: userText,
          previousDiagnosis: currentDiagnosis,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to evaluate follow-up. Please retry.');
      }

      const updatedDiagnosis: RescueResponse = result.data;
      setCurrentDiagnosis(updatedDiagnosis);

      // Append to conversation history
      setConversationHistory((prev) => [
        ...prev,
        {
          role: 'user',
          text: userText,
          imageBase64: compressedNewB64 || undefined,
          mimeType: newMime,
          timestamp: Date.now(),
        },
        {
          role: 'model',
          text: `Updated Diagnosis: ${updatedDiagnosis.diagnosis}`,
          timestamp: Date.now(),
          diagnosisData: updatedDiagnosis,
        },
      ]);
    } catch (err: any) {
      console.error('Follow-up error:', err);
      setErrorMessage(err.message || 'Could not process follow-up. Please try again.');
    } finally {
      setIsFollowUpLoading(false);
    }
  };

  // Reset to troubleshooting home screen
  const handleStartOver = () => {
    setCurrentDiagnosis(null);
    setPhotoDataUrl(null);
    setPhotoBase64(null);
    setCompressionInfo(null);
    setDishName('');
    setProblemDescription('');
    setSelectedIssueCategory(null);
    setConversationHistory([]);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-stone-900 font-sans antialiased selection:bg-emerald-200">
      
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#FAF7F2]/90 backdrop-blur-md border-b border-[#EFE8DD] px-4 py-3 sm:py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div
            onClick={handleStartOver}
            className="flex items-center space-x-2.5 cursor-pointer group"
          >
            {/* Custom Cooking Rescue App Icon */}
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 flex items-center justify-center text-white shadow-md shadow-emerald-900/15 group-hover:scale-105 transition">
              <ChefHat className="w-5 h-5 text-amber-200" />
            </div>
            <div>
              <h1 className="text-lg font-serif font-bold text-stone-900 tracking-tight flex items-center gap-1.5">
                <span>Save My Dinner</span>
                <span className="text-[10px] font-sans font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full border border-amber-200">
                  SOS
                </span>
              </h1>
              <p className="text-[11px] text-stone-500 font-medium">
                Snap it. Fix it. Save dinner.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsSubmissionModalOpen(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 flex items-center space-x-1.5 shadow-xs transition"
              title="View Canvas Submission Note & 2-Minute Demo Cheat-Sheet"
            >
              <Award className="w-3.5 h-3.5 text-amber-700" />
              <span className="hidden sm:inline">Project &amp; Demo Info</span>
              <span className="sm:hidden">Info</span>
            </button>

            {currentDiagnosis && (
              <button
                onClick={handleStartOver}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-stone-200/80 hover:bg-stone-300 text-stone-700 flex items-center space-x-1 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Problem</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-3xl mx-auto px-4 py-5 sm:py-8">
        
        {/* Error notification banner */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm flex items-start justify-between space-x-3 animate-fade-in shadow-sm">
            <div className="flex items-start space-x-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-800">Troubleshooting Notice</p>
                <p className="mt-0.5 text-rose-700 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="p-1 text-rose-500 hover:text-rose-800 rounded-lg hover:bg-rose-100 transition"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* View Switch: Results View vs Main Form */}
        {currentDiagnosis ? (
          <RescueResultsView
            diagnosis={currentDiagnosis}
            originalImage={photoDataUrl}
            userProblem={problemDescription}
            onStartOver={handleStartOver}
            onSendFollowUp={handleSendFollowUp}
            isFollowUpLoading={isFollowUpLoading}
            onOpenLiveCamera={() => setIsCameraModalOpen(true)}
          />
        ) : (
          <div className="space-y-6">
            
            {/* Hero Card */}
            <div className="bg-gradient-to-b from-white to-[#FAF8F5] rounded-3xl p-5 sm:p-7 border border-[#EFE8DD] shadow-sm space-y-3 relative overflow-hidden">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                <Flame className="w-3.5 h-3.5 text-orange-500" />
                <span>Quick Kitchen Fixer</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900 tracking-tight">
                Don't order takeout yet.
              </h2>
              <p className="text-stone-600 text-sm sm:text-base leading-relaxed max-w-xl">
                Sauce split? Pan burning? Meat won't brown or too salty?
                Take a quick photo of your pan to get easy, step-by-step instructions to save your dinner right now.
              </p>
            </div>

            {/* Photo Capture & Upload Box */}
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-[#EFE8DD] shadow-sm space-y-4">
              <label className="block text-sm font-bold text-stone-900 uppercase tracking-wide">
                Step 1: Take or pick a photo of your food
              </label>

              {photoDataUrl ? (
                /* Selected Photo Preview */
                <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500 bg-stone-900 max-h-80 flex items-center justify-center group shadow-md">
                  <img
                    src={photoDataUrl}
                    alt="Food to rescue"
                    className="w-full h-64 object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end justify-between p-4">
                    <div className="text-white text-xs space-y-0.5">
                      <span className="font-semibold block flex items-center text-emerald-300">
                        <Sparkles className="w-3.5 h-3.5 mr-1" /> Ready for AI Analysis
                      </span>
                      {compressionInfo && (
                        <span className="text-[11px] text-stone-300">
                          Compressed {compressionInfo.origKB}KB → {compressionInfo.compKB}KB
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setIsCameraModalOpen(true)}
                        className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-medium backdrop-blur-sm transition"
                      >
                        Retake
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoDataUrl(null);
                          setPhotoBase64(null);
                          setCompressionInfo(null);
                        }}
                        className="p-1.5 bg-rose-600/90 hover:bg-rose-600 text-white rounded-xl transition"
                        title="Remove photo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Photo Actions: Big Take Photo + Secondary Upload */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Primary: Take a Photo */}
                  <button
                    type="button"
                    onClick={() => setIsCameraModalOpen(true)}
                    className="p-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white flex flex-col items-center justify-center space-y-2 shadow-lg shadow-emerald-950/10 active:scale-[0.98] transition group cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center group-hover:scale-110 transition">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                    <span className="font-bold text-base tracking-tight">Take a Photo</span>
                    <span className="text-xs text-emerald-100 font-normal">
                      Point phone at pan, pot, or baking sheet
                    </span>
                  </button>

                  {/* Secondary: Upload Photo */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-5 rounded-2xl bg-[#FCFAF6] hover:bg-stone-100 text-stone-800 border-2 border-dashed border-stone-300 flex flex-col items-center justify-center space-y-2 active:scale-[0.98] transition group cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-full bg-stone-200/70 flex items-center justify-center group-hover:scale-110 transition">
                      <Upload className="w-5 h-5 text-stone-600" />
                    </div>
                    <span className="font-bold text-base tracking-tight text-stone-800">
                      Upload from Library
                    </span>
                    <span className="text-xs text-stone-500 font-normal">
                      Choose an existing camera roll image
                    </span>
                  </button>
                </div>
              )}

              {/* Hidden file input for file upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Problem Description & Chips Form */}
            <form onSubmit={handleRescueSubmit} className="bg-white rounded-3xl p-5 sm:p-6 border border-[#EFE8DD] shadow-sm space-y-4">
              
              <div className="space-y-1.5">
                <label className="block text-sm font-bold text-stone-900 uppercase tracking-wide">
                  Step 2: What's going wrong?
                </label>
                <p className="text-xs text-stone-500">
                  Select a common symptom below or describe what you see, smell, or taste.
                </p>
              </div>

              {/* Quick Select Issue Chips */}
              <div className="flex flex-wrap gap-2 pt-1">
                {issueChips.map((chip) => {
                  const isSelected = selectedIssueCategory === chip.label;
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedIssueCategory(null);
                        } else {
                          setSelectedIssueCategory(chip.label);
                          if (chip.query && !problemDescription) {
                            setProblemDescription(chip.query);
                          }
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-700 text-white shadow-sm'
                          : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200'
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              {/* Dish Name Optional Input */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">
                  What are you cooking? (optional)
                </label>
                <input
                  type="text"
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  placeholder="e.g. Creamy pasta sauce, chicken stir-fry, beef stew, mac and cheese..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-stone-50 border border-stone-300 text-sm text-stone-900 placeholder-stone-400 focus:bg-white focus:outline-emerald-600 focus:border-emerald-600 transition"
                />
              </div>

              {/* Problem Description Text Area with Hands-Free Mic Dictation */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-stone-700">
                    What does it look, smell, or taste like?
                  </label>
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer ${
                      isListening
                        ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse shadow-sm'
                        : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200'
                    }`}
                    title="Speak using phone microphone"
                  >
                    {isListening ? (
                      <>
                        <Mic className="w-3.5 h-3.5 text-rose-600 animate-bounce" />
                        <span>Listening... (Tap to stop)</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5 text-emerald-700" />
                        <span>🎤 Hands-Free Voice Dictate</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="relative">
                  <textarea
                    value={problemDescription}
                    onChange={(e) => setProblemDescription(e.target.value)}
                    placeholder="e.g. The sauce separated into grease and little clumps when I turned up the heat. Can it be saved? Or tap the mic to speak!"
                    className={`w-full p-3.5 rounded-2xl bg-stone-50 border text-sm text-stone-900 placeholder-stone-400 focus:bg-white focus:outline-emerald-600 focus:border-emerald-600 transition resize-none min-h-[95px] ${
                      isListening ? 'border-rose-400 ring-2 ring-rose-200' : 'border-stone-300'
                    }`}
                  />
                  {isListening && (
                    <div className="absolute bottom-2.5 right-3 flex items-center space-x-1.5 bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md text-[11px] font-medium border border-rose-200">
                      <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping"></span>
                      <span>Listening to your voice...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Primary Rescue Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || (!photoBase64 && !problemDescription.trim())}
                  className={`w-full py-4 px-6 rounded-2xl font-bold text-base sm:text-lg text-white flex items-center justify-center space-x-2.5 shadow-xl transition active:scale-[0.99] ${
                    isLoading || (!photoBase64 && !problemDescription.trim())
                      ? 'bg-stone-300 cursor-not-allowed text-stone-500 shadow-none'
                      : 'bg-[#D9381E] hover:bg-[#C42C13] shadow-red-950/20 cursor-pointer'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>
                        {loadingPhase === 'analyzing'
                          ? 'Checking your food...'
                          : 'Writing your quick fix...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Flame className="w-5 h-5 text-amber-300" />
                      <span>Fix My Dinner</span>
                      <ArrowRight className="w-5 h-5 ml-1" />
                    </>
                  )}
                </button>
              </div>

            </form>

            {/* Presets / Demo Scenarios for fast testing */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center">
                  <UtensilsCrossed className="w-3.5 h-3.5 mr-1.5 text-stone-400" />
                  Or test a common emergency scenario
                </span>
                <span className="text-[11px] text-stone-400">Tap to load</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SAMPLE_MISHAPS.map((mishap) => (
                  <button
                    key={mishap.id}
                    type="button"
                    onClick={() => handleSelectSampleMishap(mishap)}
                    className="p-3.5 rounded-2xl bg-white border border-[#EFE8DD] hover:border-emerald-400 text-left transition group shadow-xs hover:shadow-sm flex items-start space-x-3 cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-stone-200">
                      <img src={mishap.previewImage} alt={mishap.title} className="w-full h-full object-cover" />
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-xs font-bold text-stone-900 block group-hover:text-emerald-700 transition truncate">
                        {mishap.title}
                      </span>
                      <span className="text-[11px] text-stone-500 line-clamp-1">
                        {mishap.category}
                      </span>
                      <span className="text-[10px] text-emerald-700 font-semibold flex items-center pt-0.5">
                        Load scenario →
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Food Safety & Real-Time Disclaimer */}
            <div className="p-4 rounded-2xl bg-stone-100/70 border border-stone-200 text-stone-500 text-xs flex items-start space-x-2.5">
              <ShieldCheck className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Real-time Culinary Rescue:</strong> Diagnoses cooking problems directly from food photos and observations. Never rely on photos alone to evaluate bacterial safety or internal meat temperatures; always verify with a digital probe thermometer.
              </p>
            </div>

          </div>
        )}
      </main>

      {/* Live Camera Viewfinder Modal with native fallback */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={handleProcessImage}
      />

      {/* 150-Point Canvas Project Submission & 2-Minute Demo Modal */}
      <ProjectSubmissionModal
        isOpen={isSubmissionModalOpen}
        onClose={() => setIsSubmissionModalOpen(false)}
        sharedAppUrl={SHARED_APP_URL}
      />

    </div>
  );
}
