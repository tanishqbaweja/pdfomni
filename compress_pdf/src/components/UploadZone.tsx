/**
 * UploadZone.tsx
 * ---------------
 * Drag-and-drop + click-to-browse PDF upload area.
 * Validates file type and shows an error on invalid files.
 */

import React, { useRef, useState, DragEvent } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';

const MAX_FILE_SIZE_MB = 500;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface Props {
  onFile: (file: File) => void;
}

export const UploadZone: React.FC<Props> = ({ onFile }) => {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const validate = (file: File): boolean => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('Only PDF files are supported. Please select a valid .pdf file.');
      return false;
    }
    if (file.size < 512) {
      setError('This file appears to be empty or too small to be a valid PDF.');
      return false;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`PDFOmni supports PDF files up to ${MAX_FILE_SIZE_MB} MB.`);
      return false;
    }
    setError(null);
    return true;
  };

  const handleFile = (file: File) => {
    if (validate(file)) onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onDragOver  = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(true);  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ''; // reset so same file can be re-selected
  };

  return (
    <div className="w-full fade-in-up">
      {/* Drop area */}
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`
          relative flex flex-col items-center justify-center gap-5
          min-h-[300px] rounded-3xl border-2 border-dashed cursor-pointer
          transition-all duration-200 select-none
          ${dragging
            ? 'border-violet-400 bg-violet-50/50 drag-active'
            : 'border-slate-200 bg-white hover:border-violet-400 hover:bg-violet-50/10 shadow-sm'}
        `}
      >
        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onInputChange}
        />

        {/* Icon */}
        <div className={`
          w-20 h-20 rounded-2xl flex items-center justify-center
          transition-all duration-200
          ${dragging ? 'bg-violet-100 scale-110' : 'bg-violet-50'}
        `}>
          {dragging
            ? <FileText size={38} className="text-violet-600" />
            : <Upload   size={38} className="text-violet-500" />
          }
        </div>

        {/* Labels */}
        <div className="text-center px-4">
          <p className="text-xl font-semibold text-slate-800 mb-1">
            {dragging ? 'Release to upload' : 'Drop your PDF here'}
          </p>
          <p className="text-sm text-slate-500">
            or{' '}
            <span className="text-violet-600 font-medium underline underline-offset-2 hover:text-violet-500 transition-colors">
              browse files
            </span>
          </p>
        </div>

        {/* Hint strip */}
        <div className="flex gap-6 text-xs text-slate-600 dark:text-slate-300 mt-2">
          <span>PDF only</span>
          <span>·</span>
          <span>Up to {MAX_FILE_SIZE_MB} MB</span>
          <span>·</span>
          <span>100% private</span>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-100 fade-in-up">
          <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}
    </div>
  );
};
