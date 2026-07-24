import { useState, useCallback } from 'react'
import { Download, Code, Upload, Trash2 } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import ProgressBar from '../Common/ProgressBar'
import { useAppStore } from '../../store/appStore'
import { readFileAsText } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function HtmlToPdfTool({ toolId, tool }) {
  const [mode, setMode] = useState('paste') // 'paste' | 'upload'
  const [htmlContent, setHtmlContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
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
    let renderFrame = null
    try {
      const previewSrcdoc = htmlContent.trim().toLowerCase().startsWith('<!doctype')
        || htmlContent.trim().toLowerCase().startsWith('<html')
        ? htmlContent
        : `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;padding:20px;font-size:14px;line-height:1.6;color:#000;background:#fff;}</style></head><body>${htmlContent}</body></html>`

      renderFrame = document.createElement('iframe')
      renderFrame.title = 'HTML conversion workspace'
      renderFrame.setAttribute('aria-hidden', 'true')
      renderFrame.setAttribute('sandbox', 'allow-same-origin')
      Object.assign(renderFrame.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        width: '800px',
        height: '1000px',
        opacity: '0',
        pointerEvents: 'none',
      })
      const frameReady = new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('HTML conversion workspace timed out.')), 10000)
        renderFrame.addEventListener('load', () => {
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      renderFrame.srcdoc = previewSrcdoc
      document.body.appendChild(renderFrame)
      await frameReady
      await renderFrame.contentDocument?.fonts?.ready

      setProgress(55)
      const { htmlPreviewToSelectablePdfBytes } = await import('../../utils/textPdf')
      const pdfBytes = await htmlPreviewToSelectablePdfBytes(renderFrame, fileName || 'HTML Document')
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
      renderFrame?.remove()
      setProcessing(false)
    }
  }, [htmlContent, fileName, addToast])

  const handleClear = useCallback(() => {
    setHtmlContent('')
    setFileName('')
  }, [])

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
