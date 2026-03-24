/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  Mic, 
  MicOff, 
  FileAudio, 
  Copy, 
  Printer, 
  FileText, 
  Check, 
  Loader2, 
  Trash2, 
  Languages,
  Sparkles,
  Download,
  AlertCircle
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface TranscriptionChunk {
  id: string;
  text: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
}

// --- Constants ---
const CHUNK_SIZE_MB = 10; // Splitting for progress visibility
const MAX_FILE_SIZE_MB = 100;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- AI Initialization ---
  const getAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key is missing");
    return new GoogleGenAI({ apiKey });
  };

  // --- File Handling ---
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`حجم الملف كبير جداً. الحد الأقصى هو ${MAX_FILE_SIZE_MB} ميجابايت.`);
        return;
      }
      setFile(selectedFile);
      setError(null);
      setTranscription('');
      setProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg']
    },
    multiple: false
  } as any);

  // --- Recording Logic ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const recordedFile = new File([audioBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' });
        setFile(recordedFile);
        setIsRecording(false);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("تعذر الوصول إلى الميكروفون. يرجى التحقق من الأذونات.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  // --- Transcription Logic ---
  const processAudio = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgress(5);
    setStatusMessage('جاري تحضير الملف...');
    setError(null);
    
    try {
      const ai = getAI();
      const reader = new FileReader();
      
      const fileData = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setProgress(30);
      setStatusMessage('جاري التفريغ الحرفي الدقيق...');

      // Verbatim Transcription Prompt
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: file.type || 'audio/wav',
                  data: fileData
                }
              },
              {
                text: `أنت الآن محرك تفريغ صوتي (Transcription Engine) فائق الدقة. مهمتك هي تحويل الملف الصوتي المرفق إلى نص مكتوب باتباع القواعد الصارمة التالية:

الأمانة في النقل (Verbatim): قم بكتابة كل كلمة تسمعها في التسجيل حرفياً. يُمنع منعاً باتاً تلخيص النص، أو إعادة صياغته، أو تحسين أسلوبه اللغوي. أريد النص الخام كما نطق به المتحدث تماماً.

عدم الحذف: لا تحذف المصطلحات التقنية، أو الأمثلة الجانبية، أو حتى الجمل البسيطة. إذا ذكر المحاضر مصطلحاً بالإنجليزية وسط العربية، اكتبه كما هو (مثلاً: Node.js, Interface).

التعامل مع العامية: اكتب الكلمات باللهجة العامية كما قيلت، لا تحاول تحويلها إلى لغة عربية فصحى إذا كان المتحدث يستخدم العامية.

تنسيق الفقرات: وزع الكلام في فقرات منطقية بناءً على سكتات المتحدث، لكن دون تغيير في محتوى الكلام.

ممنوعات النظام: 
* ممنوع تقديم نصيحة أو رأي حول محتوى التسجيل.
* ممنوع كتابة مقدمات مثل 'إليك ملخص ما قيل'.
* ممنوع دمج الجمل المتباعدة.

الهدف النهائي: أريد نسخة نصية مطابقة 100% للتسجيل الصوتي لأتمكن من مراجعة المحاضرة وكأني أسمعها.`
              }
            ]
          }
        ]
      });

      const rawText = response.text;
      if (!rawText) throw new Error("فشل استخراج النص من التسجيل.");

      setTranscription(rawText);
      setProgress(100);
      setStatusMessage('اكتمل التفريغ الحرفي بنجاح!');
    } catch (err: any) {
      console.error("Transcription error:", err);
      setError(err.message || "حدث خطأ أثناء معالجة الملف. يرجى المحاولة مرة أخرى.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Actions ---
  const copyToClipboard = () => {
    navigator.clipboard.writeText(transcription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printTranscription = () => {
    window.print();
  };

  const downloadAsText = () => {
    const element = document.createElement("a");
    const fileBlob = new Blob([transcription], {type: 'text/plain'});
    element.href = URL.createObjectURL(fileBlob);
    element.download = "transcription.txt";
    document.body.appendChild(element);
    element.click();
  };

  const reset = () => {
    setFile(null);
    setTranscription('');
    setProgress(0);
    setError(null);
    setStatusMessage('');
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-emerald-100 selection:text-emerald-900">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Sparkles size={18} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">الكاتب الذكي</h1>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
            <span className="hidden sm:inline">تفريغ حرفي دقيق للمحاضرات</span>
            <Languages size={18} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid gap-12">
          
          {/* Hero Section */}
          <section className="text-center space-y-4">
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900"
            >
              حول صوتك إلى <span className="text-emerald-600">معرفة مكتوبة</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg text-gray-500 max-w-2xl mx-auto"
            >
              ارفع ملفاتك الصوتية الطويلة أو سجل مباشرة، واحصل على نسخة نصية مطابقة 100% لكل كلمة قيلت.
            </motion.p>
          </section>

          {/* Upload & Controls */}
          <section className="grid gap-6">
            {!file ? (
              <div className="grid sm:grid-cols-2 gap-6">
                {/* Dropzone */}
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "relative group cursor-pointer border-2 border-dashed rounded-3xl p-12 transition-all duration-300 flex flex-col items-center justify-center gap-4 text-center",
                    isDragActive ? "border-emerald-500 bg-emerald-50/50" : "border-gray-200 hover:border-emerald-400 hover:bg-gray-50/50"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                    <Upload size={32} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-medium">اسحب الملف هنا أو انقر للاختيار</p>
                    <p className="text-sm text-gray-400">MP3, WAV, M4A (حتى 100 ميجابايت)</p>
                  </div>
                </div>

                {/* Recorder */}
                <div className="border-2 border-gray-100 rounded-3xl p-12 flex flex-col items-center justify-center gap-6 bg-white shadow-sm">
                  <div className="relative">
                    {isRecording && (
                      <motion.div 
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                        className="absolute inset-0 bg-red-100 rounded-full -z-10"
                      />
                    )}
                    <button 
                      onClick={isRecording ? stopRecording : startRecording}
                      className={cn(
                        "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg",
                        isRecording ? "bg-red-500 text-white hover:bg-red-600" : "bg-gray-900 text-white hover:bg-black"
                      )}
                    >
                      {isRecording ? <MicOff size={32} /> : <Mic size={32} />}
                    </button>
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-lg font-medium">{isRecording ? "جاري التسجيل..." : "تسجيل صوتي مباشر"}</p>
                    <p className="text-sm text-gray-400">سجل محاضرتك أو ملاحظاتك الآن</p>
                  </div>
                </div>
              </div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white border border-gray-100 rounded-3xl p-8 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                    <FileAudio size={24} />
                  </div>
                  <div>
                    <p className="font-medium text-lg truncate max-w-[200px] sm:max-w-md">{file.name}</p>
                    <p className="text-sm text-gray-400">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  {!isProcessing && !transcription && (
                    <button 
                      onClick={processAudio}
                      className="flex-1 sm:flex-none bg-emerald-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Sparkles size={18} />
                      ابدأ المعالجة
                    </button>
                  )}
                  <button 
                    onClick={reset}
                    disabled={isProcessing}
                    className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </motion.div>
            )}
          </section>

          {/* Progress & Status */}
          <AnimatePresence>
            {isProcessing && (
              <motion.section 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-emerald-600 flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      {statusMessage}
                    </p>
                  </div>
                  <span className="text-2xl font-bold text-gray-900">{progress}%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-emerald-500"
                  />
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3"
            >
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          {/* Result Area */}
          <AnimatePresence>
            {transcription && (
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h3 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="text-emerald-600" />
                    النص الناتج
                  </h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={copyToClipboard}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                      {copied ? "تم النسخ" : "نسخ النص"}
                    </button>
                    <button 
                      onClick={downloadAsText}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      <Download size={16} />
                      تحميل
                    </button>
                    <button 
                      onClick={printTranscription}
                      className="p-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                      title="طباعة"
                    >
                      <Printer size={18} />
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-3xl p-8 sm:p-12 shadow-sm min-h-[400px] relative group">
                  <div className="prose prose-emerald max-w-none leading-relaxed text-lg text-gray-800 whitespace-pre-wrap text-right dir-rtl">
                    {transcription}
                  </div>
                  
                  {/* Print-only header */}
                  <div className="hidden print:block mb-8 border-b pb-4">
                    <h1 className="text-2xl font-bold">الكاتب الذكي - تفريغ حرفي دقيق</h1>
                    <p className="text-sm text-gray-500">تاريخ المعالجة: {new Date().toLocaleDateString('ar-EG')}</p>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/5 text-center text-gray-400 text-sm">
        <p>© {new Date().getFullYear()} الكاتب الذكي. جميع الحقوق محفوظة.</p>
      </footer>

      {/* Global Styles for RTL and Print */}
      <style dangerouslySetInnerHTML={{ __html: `
        .dir-rtl { direction: rtl; }
        @media print {
          body { background: white; }
          header, footer, section:not(:last-child), button { display: none !important; }
          main { padding: 0; }
          .rounded-3xl { border: none; box-shadow: none; }
          .prose { font-size: 12pt; line-height: 1.6; }
        }
      `}} />
    </div>
  );
}
