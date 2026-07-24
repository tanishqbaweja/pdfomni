import { useState, useCallback, useMemo } from 'react'
import { Download, FileText, Hash, Eye } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import PdfPagePreview from '../Common/PdfPagePreview'
import ProgressBar from '../Common/ProgressBar'
import { addPageNumbers } from '../../engine/pdfEngine'
import { getPageCount } from '../../engine/pdfRenderer'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, formatFileSize } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

const POSITION_OPTIONS = [
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
]

const FORMAT_OPTIONS = [
  { value: '{n}', label: 'Simple (1, 2, 3...)' },
  { value: 'Page {n}', label: 'Page 1, Page 2...' },
  { value: '{n} / {total}', label: '1 / 10, 2 / 10...' },
  { value: 'Page {n} of {total}', label: 'Page 1 of 10...' },
  { value: '- {n} -', label: '- 1 -, - 2 -...' },
]

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18]

export default function PageNumberTool({ toolId, tool }) {
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pdfBytes, setPdfBytes] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewBytes, setPreviewBytes] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Options
  const [position, setPosition] = useState('bottom-center')
  const [startNumber, setStartNumber] = useState(1)
  const [format, setFormat] = useState('{n}')
  const [fontSize, setFontSize] = useState(11)
  const [skipFirst, setSkipFirst] = useState(false)

  const addToast = useAppStore((s) => s.addToast)

  const handleFiles = useCallback(
    async (newFiles) => {
      const f = newFiles[0]
      if (!f) return
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        addToast({ type: 'error', message: 'Please upload a PDF file.' })
        return
      }
      setLoading(true)
      try {
        const bytes = await readFileAsArrayBuffer(f)
        const count = await getPageCount(bytes)
        setPdfBytes(bytes)
        setPageCount(count)
        setFileName(f.name)
        setFile(f)
        setPreviewBytes(null)
        setShowPreview(false)
        addToast({ type: 'success', message: `Loaded "${f.name}": ${count} pages` })
      } catch (err) {
        addToast({ type: 'error', message: `Failed to load PDF: ${err.message}` })
      } finally {
        setLoading(false)
      }
    },
    [addToast]
  )

  const handleReset = useCallback(() => {
    setFile(null)
    setPdfBytes(null)
    setPageCount(0)
    setFileName('')
    setPreviewBytes(null)
    setShowPreview(false)
  }, [])

  const currentOptions = useMemo(
    () => ({
      position,
      startNumber: parseInt(startNumber) || 1,
      format,
      fontSize: parseInt(fontSize) || 11,
      skipFirst,
    }),
    [position, startNumber, format, fontSize, skipFirst]
  )

  const handlePreview = useCallback(async () => {
    if (!pdfBytes) return
    setPreviewLoading(true)
    try {
      const result = await addPageNumbers(pdfBytes, currentOptions)
      setPreviewBytes(result)
      setShowPreview(true)
    } catch (err) {
      addToast({ type: 'error', message: `Preview failed: ${err.message}` })
    } finally {
      setPreviewLoading(false)
    }
  }, [pdfBytes, currentOptions, addToast])

  const handleApply = useCallback(async () => {
    if (!pdfBytes) return
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Adding page numbers...')

    try {
      setProgress(30)
      const resultBytes = await addPageNumbers(pdfBytes, currentOptions)

      setProgress(80)
      setProgressMsg('Preparing download...')
      downloadBlob(resultBytes, fileName.replace('.pdf', '-numbered.pdf'))

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: 'Page numbers added and PDF downloaded!' })
    } catch (err) {
      console.error('Page number error:', err)
      addToast({ type: 'error', message: `Failed to add page numbers: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [pdfBytes, currentOptions, fileName, addToast])

  // Preview text to show the user
  const previewText = useMemo(() => {
    const num = parseInt(startNumber) || 1
    return format.replace('{n}', num).replace('{total}', pageCount)
  }, [format, startNumber, pageCount])

  return (
    <div className="animate-fade-in-up" id="pagenumber-tool">
      {!pdfBytes ? (
        loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-16)' }}>
            <div className="spinner spinner-lg" />
            <p style={{ color: 'var(--color-text-secondary)' }}>Loading PDF...</p>
          </div>
        ) : (
          <FileDropZone
            onFiles={handleFiles}
            multiple={false}
            label="Drop your PDF file here to add page numbers"
            sublabel="or click to browse"
            id="pagenumber-dropzone"
            maxFiles={1}
          />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* File info */}
          <div className="card" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-4) var(--space-5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <FileText size={20} style={{ color: 'var(--color-accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{fileName}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {pageCount} pages • {formatFileSize(file.size)}
                </div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={processing} id="pagenumber-change-file">
              Change file
            </button>
          </div>

          {/* Options */}
          <div className="card">
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-5)',
            }}>
              {/* Position */}
              <div className="input-group">
                <label className="input-label" htmlFor="pagenumber-position">Position</label>
                <select
                  className="select"
                  id="pagenumber-position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  disabled={processing}
                >
                  {POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Format */}
              <div className="input-group">
                <label className="input-label" htmlFor="pagenumber-format">Format</label>
                <select
                  className="select"
                  id="pagenumber-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  disabled={processing}
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start number */}
              <div className="input-group">
                <label className="input-label" htmlFor="pagenumber-start">Start Number</label>
                <input
                  className="input"
                  type="number"
                  id="pagenumber-start"
                  min="0"
                  value={startNumber}
                  onChange={(e) => setStartNumber(e.target.value)}
                  disabled={processing}
                />
              </div>

              {/* Font size */}
              <div className="input-group">
                <label className="input-label" htmlFor="pagenumber-fontsize">Font Size</label>
                <select
                  className="select"
                  id="pagenumber-fontsize"
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value)}
                  disabled={processing}
                >
                  {FONT_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}pt
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Skip first page toggle */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 'var(--space-5)',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--color-border)',
            }}>
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Skip first page</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Don't add a number to the first page (e.g. title/cover page)
                </div>
              </div>
              <div
                className={`toggle ${skipFirst ? 'active' : ''}`}
                onClick={() => setSkipFirst(!skipFirst)}
                role="switch"
                aria-checked={skipFirst}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSkipFirst(!skipFirst)}
                id="pagenumber-skip-first"
              />
            </div>

            {/* Preview sample */}
            <div style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>
                Preview: {POSITION_OPTIONS.find((o) => o.value === position)?.label}
              </div>
              <div style={{
                fontSize: `${fontSize}px`,
                fontFamily: 'var(--font-sans)',
                color: 'var(--color-text-secondary)',
              }}>
                {previewText}
              </div>
            </div>
          </div>

          {/* Full page preview */}
          {showPreview && previewBytes && (
            <>
              <div className="section-header">
                <span className="section-label">Preview</span>
                <div className="section-line" />
              </div>
              <div className="pdf-preview-stack">
                {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => (
                  <PdfPagePreview
                    key={`preview-${i}`}
                    pdfBytes={previewBytes}
                    pageNum={i + 1}
                    scale={1.25}
                    id={`pagenumber-preview-${i}`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Progress */}
          {processing && <ProgressBar progress={progress} message={progressMsg} />}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-lg"
              onClick={handlePreview}
              disabled={processing || previewLoading}
              id="pagenumber-preview-btn"
            >
              {previewLoading ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Loading preview...
                </>
              ) : (
                <>
                  <Eye size={20} />
                  Preview
                </>
              )}
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleApply}
              disabled={processing}
              id="pagenumber-apply-btn"
            >
              {processing ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Processing...
                </>
              ) : (
                <>
                  <Download size={20} />
                  Add Numbers & Download
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
