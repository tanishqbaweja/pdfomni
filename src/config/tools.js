import {
  Combine, Scissors, ArrowUpDown, Minimize2, RotateCw, Hash,
  FileText, FileSpreadsheet, Presentation, Image, Globe,
  Type, PenTool, Stamp, Droplets, Crop, ShieldAlert,
  Lock, Unlock, FileSignature,
  Layers, ListOrdered, ScanSearch,
  ImagePlus
} from 'lucide-react'

const tools = [
  // ─── Organize & Optimize ───
  {
    id: 'merge',
    name: 'Merge PDF',
    description: 'Combine multiple PDFs into one',
    canonicalPath: '/merge',
    icon: Combine,
    category: 'organize',
    color: '#6366f1',
  },
  {
    id: 'split',
    name: 'Split PDF',
    description: 'Split a PDF by page ranges',
    canonicalPath: '/split',
    icon: Scissors,
    category: 'organize',
    color: '#8b5cf6',
  },
  {
    id: 'reorder',
    name: 'Reorder Pages',
    description: 'Drag and drop to rearrange pages',
    canonicalPath: '/reorder',
    icon: ArrowUpDown,
    category: 'organize',
    color: '#a855f7',
  },
  {
    id: 'compress',
    name: 'Compress PDF',
    description: 'Reduce file size without losing quality',
    canonicalPath: '/compress',
    icon: Minimize2,
    category: 'organize',
    color: '#c084fc',
  },
  {
    id: 'rotate',
    name: 'Rotate Pages',
    description: 'Rotate individual or all pages',
    canonicalPath: '/rotate',
    icon: RotateCw,
    category: 'organize',
    color: '#d946ef',
  },
  {
    id: 'page-numbers',
    name: 'Page Numbers',
    description: 'Add page numbers to your PDF',
    canonicalPath: '/page-numbers',
    icon: Hash,
    category: 'organize',
    color: '#e879f9',
  },

  // ─── Convert To PDF ───
  {
    id: 'word-to-pdf',
    name: 'Word to PDF',
    description: 'Convert DOCX files to PDF',
    canonicalPath: '/word-to-pdf',
    icon: FileText,
    category: 'convert-to',
    color: '#3b82f6',
  },
  {
    id: 'excel-to-pdf',
    name: 'Excel to PDF',
    description: 'Convert spreadsheets to PDF',
    canonicalPath: '/excel-to-pdf',
    icon: FileSpreadsheet,
    category: 'convert-to',
    color: '#22c55e',
  },
  {
    id: 'image-to-pdf',
    name: 'Image to PDF',
    description: 'Convert JPG/PNG images to PDF',
    canonicalPath: '/image-to-pdf',
    icon: Image,
    category: 'convert-to',
    color: '#f59e0b',
  },
  {
    id: 'html-to-pdf',
    name: 'HTML to PDF',
    description: 'Convert HTML pages to PDF',
    canonicalPath: '/html-to-pdf',
    icon: Globe,
    category: 'convert-to',
    color: '#06b6d4',
  },

  // ─── Convert From PDF ───
  {
    id: 'pdf-to-image',
    name: 'PDF to Image',
    description: 'Export pages as JPG or PNG',
    canonicalPath: '/pdf-to-image',
    icon: Image,
    category: 'convert-from',
    color: '#ec4899',
  },
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    description: 'Convert PDF files into editable DOCX documents',
    canonicalPath: '/pdf-to-word',
    icon: FileText,
    category: 'convert-from',
    color: '#2563eb',
  },
  {
    id: 'pdf-to-text',
    name: 'PDF to Text',
    description: 'Extract all text content',
    canonicalPath: '/pdf-to-text',
    icon: FileText,
    category: 'convert-from',
    color: '#f97316',
  },

  // ─── Edit & Annotate ───
  {
    id: 'edit',
    name: 'Edit PDF',
    description: 'Edit text, images, and page objects',
    canonicalPath: '/edit-pdf',
    icon: Type,
    category: 'edit',
    color: '#14b8a6',
  },
  {
    id: 'draw',
    name: 'Draw on PDF',
    description: 'Freehand drawing and shapes',
    icon: PenTool,
    category: 'edit',
    color: '#10b981',
    hiddenOnHome: true,
    redirectTo: 'edit',
  },
  {
    id: 'watermark',
    name: 'Add Watermark',
    description: 'Stamp text watermark on pages',
    canonicalPath: '/watermark',
    icon: Stamp,
    category: 'edit',
    color: '#0ea5e9',
  },
  {
    id: 'redact',
    name: 'Redact',
    description: 'Black out sensitive information',
    canonicalPath: '/redact',
    icon: ShieldAlert,
    category: 'edit',
    color: '#ef4444',
  },
  {
    id: 'crop',
    name: 'Crop Pages',
    description: 'Crop page dimensions',
    canonicalPath: '/crop',
    icon: Crop,
    category: 'edit',
    color: '#84cc16',
  },
  {
    id: 'image-edit',
    name: 'Edit Images',
    description: 'Replace embedded images in PDF',
    icon: ImagePlus,
    category: 'edit',
    color: '#f472b6',
    hiddenOnHome: true,
    redirectTo: 'edit',
  },

  // ─── Security ───
  {
    id: 'encrypt',
    name: 'Protect PDF',
    description: 'Add password protection',
    canonicalPath: '/protect',
    icon: Lock,
    category: 'security',
    color: '#f59e0b',
  },
  {
    id: 'decrypt',
    name: 'Unlock PDF',
    description: 'Remove password protection',
    canonicalPath: '/unlock',
    icon: Unlock,
    category: 'security',
    color: '#22c55e',
  },
  {
    id: 'sign',
    name: 'Sign PDF',
    description: 'Add digital signature',
    canonicalPath: '/sign',
    icon: FileSignature,
    category: 'security',
    color: '#6366f1',
  },

  // ─── Advanced ───
  {
    id: 'batch',
    name: 'Batch Process',
    description: 'Process multiple PDFs at once',
    canonicalPath: '/batch',
    icon: Layers,
    category: 'advanced',
    color: '#8b5cf6',
  },
  {
    id: 'wcag',
    name: 'WCAG Check',
    description: 'Scan for accessibility issues',
    canonicalPath: '/wcag-check',
    tooltip: 'A WCAG check (or WCAG audit) is the process of evaluating a website or digital product against the Web Content Accessibility Guidelines (WCAG). These guidelines ensure digital content is accessible to people with disabilities, including those with visual, auditory, motor, and cognitive impairments.',
    icon: ScanSearch,
    category: 'advanced',
    color: '#06b6d4',
  },
]

export const toolCategories = [
  { id: 'organize', label: 'Organize & Optimize' },
  { id: 'convert-to', label: 'Convert to PDF' },
  { id: 'convert-from', label: 'Convert from PDF' },
  { id: 'edit', label: 'Edit & Annotate' },
  { id: 'security', label: 'Security' },
  { id: 'advanced', label: 'Advanced' },
]

export function getToolById(id) {
  return tools.find(t => t.id === id)
}

export function getToolsByCategory(categoryId) {
  return tools.filter(t => t.category === categoryId)
}

export default tools
