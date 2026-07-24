import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import JavaScriptObfuscator from 'javascript-obfuscator'

const targetDir = path.resolve(process.argv[2] || 'obfuscated_dist')

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.18,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  rotateStringArray: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.55,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
}

const largeFileOptions = {
  ...options,
  controlFlowFlattening: false,
  numbersToExpressions: false,
  splitStrings: false,
  stringArrayEncoding: [],
  stringArrayThreshold: 0.35,
}

// These are first-party browser/server entry points emitted by the protected
// Vite builds or copied into the deployment. Keep this explicit so new shipped
// code appears as unclassified in the report instead of being silently missed.
const protectedNamePatterns = [
  /^assets\/(?:main|editpdf)-.+\.(?:js|mjs)$/i,
  /^assets\/(?:AboutPage|ChatSidebar|ContactPage|ErrorPage|GuidePage|GuidesPage|PrivacyPolicy|TermsOfService|ToolPage|WorkflowPage|guides)-.+\.(?:js|mjs)$/i,
  /^assets\/(?:BatchTool|CropTool|DecryptTool|EncryptTool|ExcelToPdfTool|HtmlToPdfTool|ImageToPdfTool|MergeTool|PageNumberTool|PdfToImageTool|PdfToTextTool|PdfToWordTool|RedactTool|ReorderTool|RotateTool|SignTool|SplitTool|WatermarkTool|WcagTool|WordToPdfTool)-.+\.(?:js|mjs)$/i,
  /^assets\/(?:FileDropZone|PageNavigator|PageThumbnail|PdfPagePreview|ProgressBar)-.+\.(?:js|mjs)$/i,
  /^assets\/(?:download|fileHelpers|ocrEngine|pdfEngine|pdfRenderer|qpdfNormalize|textPdf)-.+\.(?:js|mjs)$/i,
  /^assets\/embeddingWorker-.+\.(?:js|mjs)$/i,
  /^compress\/app\/assets\/(?:index|compressionWorker)-.+\.(?:js|mjs)$/i,
  /^pdf-to-word\/app\/assets\/(?:index|main|embed)-.+\.(?:js|mjs)$/i,
  /^functions\/.+\.(?:js|mjs)$/i,
  /^_worker\.(?:js|mjs)$/i,
]

// Vendor/runtime files are deliberately not transformed. Obfuscating these
// adds little protection and is disproportionately likely to break workers,
// WASM loaders, dynamic imports, or third-party license assumptions.
const vendorNamePatterns = [
  /(?:^|\/)lib\//i,
  /(?:^|\/)ocr\//i,
  /(?:^|\/)pdfjs-wasm\//i,
  /(?:^|\/)pdf\.worker/i,
  /(?:^|\/)assets\/(?:ai-runtime|browserRunner|content-libs|copy|html2canvas|index\.es|jspdf(?:\.es\.min)?|lucide-react|mammoth|modulepreload-polyfill|pdf|pdf-lib|pdfjs-dist|preload-helper|purify\.es|qpdf|rolldown-runtime|src|tesseract|vendor|worker|xlsx)-/i,
  /(?:^|\/)assets\/(?:framework|jszip(?:\.min)?|lib)-/i,
  /(?:^|\/)assets\/(?:arrow-left|check|chevron-right|circle-check|eye|eye-off|grip-vertical|loader-circle|rotate-ccw|trash-2|triangle-alert|undo-2)-/i,
  /(?:^|\/)compress\/app\/assets\/(?:browserRunner|lucide-react|pdf-lib|pdfjs-dist|qpdf|rolldown-runtime|src|vendor|worker)-/i,
  /(?:^|\/)pdf-to-word\/app\/assets\/(?:docx|jszip|pdfjs-dist|vendor)-/i,
  /\.min\.(?:js|mjs)$/i,
]

// Guide article text is already public in prerendered HTML. Transforming the
// generated data modules only inflates downloads without protecting app logic.
const publicContentNamePatterns = [
  /^assets\/(?:guideIndex|guideLoaders|guide-content-.+)-.+\.(?:js|mjs)$/i,
]

function walk(dir) {
  const out = []
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const relative = file => path.relative(targetDir, file).replace(/\\/g, '/')
const matches = (patterns, file) => patterns.some(pattern => pattern.test(relative(file)))
const isJavaScript = file => /\.(?:js|mjs)$/i.test(file)
const digest = source => crypto.createHash('sha256').update(source).digest('hex').slice(0, 12)

function classifyJs(filePath) {
  if (matches(protectedNamePatterns, filePath)) return 'protected'
  if (matches(publicContentNamePatterns, filePath)) return 'public-content'
  if (matches(vendorNamePatterns, filePath)) return 'vendor'
  return 'unclassified'
}

function verifyJavaScript(filePath) {
  const check = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' })
  if (check.status !== 0) {
    throw new Error(`Obfuscated JavaScript failed syntax validation: ${relative(filePath)}\n${check.stderr || check.stdout}`)
  }
}

function obfuscateJsFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  if (!source.trim()) return null
  const activeOptions = source.length > 650000 ? largeFileOptions : options
  const result = JavaScriptObfuscator.obfuscate(source, activeOptions).getObfuscatedCode()
  if (result === source) throw new Error(`Obfuscator did not change protected file: ${relative(filePath)}`)
  fs.writeFileSync(filePath, result, 'utf8')
  verifyJavaScript(filePath)
  return { before: digest(source), after: digest(result), bytes: source.length }
}

function obfuscateEditPdfHtml(filePath) {
  if (!fs.existsSync(filePath)) return null
  const html = fs.readFileSync(filePath, 'utf8')
  let resultInfo = null
  const next = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, code) => {
    const shouldObfuscate = code.length > 100000 && /\b(?:const|let)\s+RENDER_SCALE\b/.test(code) && code.includes('const app=')
    if (!shouldObfuscate) return match
    const result = JavaScriptObfuscator.obfuscate(code, {
      ...largeFileOptions,
      stringArray: true,
      stringArrayThreshold: 0.2,
    }).getObfuscatedCode()
    if (result === code) throw new Error('Obfuscator did not change editpdf.html inline editor code')
    resultInfo = { before: digest(code), after: digest(result), bytes: code.length }
    return `<script${attrs}>${result}</script>`
  })
  if (resultInfo) fs.writeFileSync(filePath, next, 'utf8')
  return resultInfo
}

if (!fs.existsSync(targetDir)) {
  console.error(`Protected build directory does not exist: ${targetDir}`)
  process.exit(1)
}

const protectedFiles = []
const publicContentFiles = []
const vendorFiles = []
const unclassifiedFiles = []
for (const file of walk(targetDir)) {
  if (!isJavaScript(file)) continue
  const classification = classifyJs(file)
  if (classification === 'protected') protectedFiles.push(file)
  else if (classification === 'public-content') publicContentFiles.push(file)
  else if (classification === 'vendor') vendorFiles.push(file)
  else unclassifiedFiles.push(file)
}

if (!protectedFiles.length) throw new Error('No first-party JavaScript was found in the protected build')

const protectedResults = protectedFiles.map(file => ({ file, ...obfuscateJsFile(file) }))
const editPdfResult = obfuscateEditPdfHtml(path.join(targetDir, 'editpdf.html'))
if (!editPdfResult) throw new Error('The standalone editpdf.html editor script was not obfuscated')

const reportPath = path.resolve('protected-obfuscation-report.txt')
const report = [
  'PDFOmni protected build obfuscation report',
  '',
  'Obfuscated first-party files/chunks:',
  ...protectedResults.map(({ file, before, after, bytes }) => `- ${relative(file)} (${bytes} bytes, ${before} -> ${after})`),
  `- editpdf.html inline editor script (${editPdfResult.bytes} bytes, ${editPdfResult.before} -> ${editPdfResult.after})`,
  '',
  'Skipped vendor/runtime files:',
  ...vendorFiles.map(file => `- ${relative(file)}`),
  '',
  'Skipped generated public guide content:',
  ...publicContentFiles.map(file => `- ${relative(file)}`),
  '',
  'Unclassified shipped JavaScript (review when adding new entry points):',
  ...(unclassifiedFiles.length ? unclassifiedFiles.map(file => `- ${relative(file)}`) : ['- none']),
  '',
  'Notes:',
  '- The standalone PDF editor, React application chunks, AI embedding worker, compressor application/worker, PDF-to-Word application code, and Cloudflare functions are protected.',
  '- Generated guide article data is already public in prerendered HTML and is not obfuscated.',
  '- PDF.js, DOCX, JSZip, qpdf, OCR, framework/runtime chunks, WASM loaders, and minified vendor libraries are intentionally skipped.',
  '- Every obfuscated JavaScript file is syntax-checked after transformation.',
  '- Obfuscation is a copying deterrent, not a security boundary.',
].join('\n')
fs.writeFileSync(reportPath, `${report}\n`, 'utf8')

console.log(`Obfuscated ${protectedResults.length} first-party JS/MJS file(s).`)
console.log('Obfuscated editpdf inline editor: yes.')
console.log(`Unclassified shipped JS/MJS files: ${unclassifiedFiles.length}.`)
console.log(`Wrote obfuscation report: ${reportPath}`)
