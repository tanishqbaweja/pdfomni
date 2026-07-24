import { useState, useCallback, useRef } from 'react'
import { Download, FileText, Trash2, Eye } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import ProgressBar from '../Common/ProgressBar'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, formatFileSize } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function WordToPdfTool({ toolId, tool }) {
  const [file, setFile] = useState(null)
  const [htmlContent, setHtmlContent] = useState('')
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const previewRef = useRef(null)
  const addToast = useAppStore((s) => s.addToast)

  const handleFiles = useCallback(async (files) => {
    const f = files[0]
    if (!f || !f.name.toLowerCase().endsWith('.docx')) {
      addToast({ type: 'error', message: 'Please upload a .docx file.' })
      return
    }
    setLoading(true)
    setProgress(0)
    setProgressMsg('Reading Word document...')
    try {
      const arrayBuffer = await readFileAsArrayBuffer(f)
      setProgress(40)
      setProgressMsg('Converting to HTML...')

      const { default: mammoth } = await import('mammoth')
      const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer.buffer })
      setHtmlContent(result.value)
      setFile(f)



      setProgress(100)
      setProgressMsg('Ready!')
      addToast({ type: 'success', message: 'Word document loaded! Preview below.' })
    } catch (err) {
      console.error('DOCX load error:', err)
      addToast({ type: 'error', message: `Failed to load document: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  const handleConvert = useCallback(async () => {
    if (!htmlContent) return
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Creating selectable PDF text...')
    try {
      setProgress(60)
      const { htmlToSelectablePdfBytes } = await import('../../utils/textPdf')
      const pdfBytes = htmlToSelectablePdfBytes(htmlContent, file?.name?.replace(/\.docx$/i, '') || 'Document')
      setProgress(90)
      setProgressMsg('Downloading PDF...')
      const pdfName = file ? file.name.replace(/\.docx$/i, '.pdf') : 'document.pdf'
      downloadBlob(pdfBytes, pdfName)

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: 'PDF created successfully!' })
    } catch (err) {
      console.error('Conversion error:', err)
      addToast({ type: 'error', message: `Conversion failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [htmlContent, file, addToast])

  const handleReset = useCallback(() => {
    setFile(null)
    setHtmlContent('')
  }, [])

  return (
    <div className="animate-fade-in-up" id="word-to-pdf-tool">
      {!file ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {loading && <ProgressBar progress={progress} message={progressMsg} />}
          <FileDropZone
            onFiles={handleFiles}
            accept=".docx"
            multiple={false}
            label="Drop your Word document here"
            sublabel="or click to browse (.docx files only)"
            id="word-to-pdf-dropzone"
            maxFiles={1}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* File info */}
          <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <FileText size={20} style={{ color: 'var(--color-accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{file.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {formatFileSize(file.size)}
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={processing} id="word2pdf-reset">
                <Trash2 size={14} />
                New file
              </button>
            </div>
          </div>

          {/* HTML Preview */}
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
            <div
              ref={previewRef}
              style={{
                padding: 'var(--space-5)',
                maxHeight: '85vh',
                overflowY: 'auto',
                background: '#fff',
                color: '#000',
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '14px',
                lineHeight: 1.6,
              }}
              dangerouslySetInnerHTML={{ __html: htmlContent }}
              id="word2pdf-preview"
            />
          </div>

          {/* Progress */}
          {processing && <ProgressBar progress={progress} message={progressMsg} />}

          {/* Action */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleConvert}
              disabled={processing || !htmlContent}
              id="word2pdf-convert-btn"
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
      )}
    </div>
  )
}
