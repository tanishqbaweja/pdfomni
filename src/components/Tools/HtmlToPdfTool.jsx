import { useState, useCallback, useRef } from 'react'
import { Download, Code, Upload, Eye, Trash2 } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import ProgressBar from '../Common/ProgressBar'
import { useAppStore } from '../../store/appStore'
import { readFileAsText } from '../../utils/fileHelpers'
import { htmlPreviewToSelectablePdfBytes } from '../../utils/textPdf'
import { downloadBlob } from '../../utils/download'

export default function HtmlToPdfTool({ toolId, tool }) {
  const [mode, setMode] = useState('paste') // 'paste' | 'upload'
  const [htmlContent, setHtmlContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const previewRef = useRef(null)
  const addToast = useAppStore((s) => s.addToast)

  const handleFileUpload = useCallback(async (files) => {
    const file = files[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['html', 'htm'].includes(ext)) {
      addToast({ type: 'error', message: 'Please upload an HTML file (.html, .htm).' })
      return
    }
    try {
      const text = await readFileAsText(file)
      setHtmlContent(text)
      setFileName(file.name.replace(/\.(html|htm)$/i, ''))
      addToast({ type: 'success', message: 'HTML file loaded!' })
    } catch (err) {
      addToast({ type: 'error', message: `Failed to read file: ${err.message}` })
    }
  }, [addToast])

  const handleConvert = useCallback(async () => {
    if (!htmlContent.trim()) {
      addToast({ type: 'error', message: 'Please enter or upload HTML content first.' })
      return
    }
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Capturing browser layout...')
    try {
      if (!previewRef.current) {
        throw new Error('Preview frame is not available yet.')
      }

      setProgress(55)
      const pdfBytes = await htmlPreviewToSelectablePdfBytes(previewRef.current, fileName || 'HTML Document')
      setProgress(90)
      setProgressMsg('Downloading PDF...')
      downloadBlob(pdfBytes, `${fileName || 'html-to-pdf'}.pdf`)

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: 'PDF created successfully!' })
    } catch (err) {
      console.error('HTML to PDF error:', err)
      addToast({ type: 'error', message: `Conversion failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [htmlContent, fileName, addToast])

  const handleClear = useCallback(() => {
    setHtmlContent('')
    setFileName('')
  }, [])

  // Build preview srcdoc with safe defaults
  const previewSrcdoc = htmlContent.trim().toLowerCase().startsWith('<!doctype') ||
    htmlContent.trim().toLowerCase().startsWith('<html')
    ? htmlContent
    : `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;padding:20px;font-size:14px;line-height:1.6;color:#000;background:#fff;}</style></head><body>${htmlContent}</body></html>`

  return (
    <div className="animate-fade-in-up" id="html-to-pdf-tool">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {/* Mode toggle */}
        <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            <button
              className={`btn btn-sm ${mode === 'paste' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode('paste')}
              id="html2pdf-mode-paste"
            >
              <Code size={14} />
              Paste HTML
            </button>
            <button
              className={`btn btn-sm ${mode === 'upload' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode('upload')}
              id="html2pdf-mode-upload"
            >
              <Upload size={14} />
              Upload File
            </button>
            {htmlContent && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleClear}
                disabled={processing}
                style={{ marginLeft: 'auto' }}
                id="html2pdf-clear"
              >
                <Trash2 size={14} />
                Clear
              </button>
            )}
          </div>

          {mode === 'paste' ? (
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              placeholder="<h1>Hello World</h1>\n<p>Paste your HTML here...</p>"
              disabled={processing}
              style={{
                width: '100%',
                minHeight: '200px',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                lineHeight: 1.5,
                resize: 'vertical',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
              }}
              id="html2pdf-textarea"
            />
          ) : (
            <FileDropZone
              onFiles={handleFileUpload}
              accept=".html,.htm"
              multiple={false}
              label="Drop your HTML file here"
              sublabel="or click to browse (.html or .htm)"
              id="html2pdf-file-dropzone"
              maxFiles={1}
            />
          )}
        </div>

        {/* Preview */}
        {htmlContent && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: '1px solid var(--color-border)',
                fontWeight: 600,
                fontSize: 'var(--text-sm)',
              }}
            >
              <Eye size={16} />
              Preview
            </div>
            <iframe
              ref={previewRef}
              srcDoc={previewSrcdoc}
              title="HTML Preview"
              style={{
                width: '100%',
                height: '400px',
                border: 'none',
                background: '#fff',
              }}
              sandbox="allow-same-origin"
              id="html2pdf-preview"
            />
          </div>
        )}

        {/* Progress */}
        {processing && <ProgressBar progress={progress} message={progressMsg} />}

        {/* Action */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleConvert}
            disabled={processing || !htmlContent.trim()}
            id="html2pdf-convert-btn"
          >
            {processing ? (
              <>
                <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                Converting...
              </>
            ) : (
              <>
                <Download size={20} />
                Convert to PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
