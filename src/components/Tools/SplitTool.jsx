import { useState, useCallback } from 'react'
import { Download, Scissors, FileText, Package } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import PageThumbnail from '../Common/PageThumbnail'
import ProgressBar from '../Common/ProgressBar'
import { splitPDF, splitIntoPages, extractPages } from '../../engine/pdfEngine'
import { getPageCount } from '../../engine/pdfRenderer'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, formatFileSize, parsePageRanges } from '../../utils/fileHelpers'
import { downloadBlob, downloadMultipleAsZip } from '../../utils/download'

export default function SplitTool({ toolId, tool }) {
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pdfBytes, setPdfBytes] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [rangeInput, setRangeInput] = useState('')
  const [splitMode, setSplitMode] = useState('ranges') // 'ranges' | 'individual'
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [selectedPages, setSelectedPages] = useState(new Set())
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
        setRangeInput('')
        setSelectedPages(new Set())
        addToast({ type: 'success', message: `Loaded "${f.name}": ${count} pages` })
      } catch (err) {
        addToast({ type: 'error', message: `Failed to load PDF: ${err.message}` })
      } finally {
        setLoading(false)
      }
    },
    [addToast]
  )

  const handlePageClick = useCallback(
    (pageIndex) => {
      setSelectedPages((prev) => {
        const next = new Set(prev)
        if (next.has(pageIndex)) {
          next.delete(pageIndex)
        } else {
          next.add(pageIndex)
        }
        return next
      })
    },
    []
  )

  const handleReset = useCallback(() => {
    setFile(null)
    setPdfBytes(null)
    setPageCount(0)
    setFileName('')
    setRangeInput('')
    setSelectedPages(new Set())
  }, [])

  const parseRangesToSplitFormat = useCallback(
    (input) => {
      // Parse "1-3, 5, 7-9" into [{start:1,end:3}, {start:5,end:5}, {start:7,end:9}]
      const ranges = []
      const parts = input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map((n) => parseInt(n.trim()))
          if (
            !isNaN(start) &&
            !isNaN(end) &&
            start >= 1 &&
            end <= pageCount &&
            start <= end
          ) {
            ranges.push({ start, end })
          }
        } else {
          const num = parseInt(part)
          if (!isNaN(num) && num >= 1 && num <= pageCount) {
            ranges.push({ start: num, end: num })
          }
        }
      }
      return ranges
    },
    [pageCount]
  )

  const handleSplit = useCallback(async () => {
    if (!pdfBytes) return
    setProcessing(true)
    setProgress(0)

    try {
      if (splitMode === 'individual') {
        setProgressMsg('Splitting into individual pages...')
        setProgress(20)
        const results = await splitIntoPages(pdfBytes)
        setProgress(80)
        setProgressMsg('Preparing download...')

        if (results.length === 1) {
          downloadBlob(results[0].bytes, results[0].name)
        } else {
          await downloadMultipleAsZip(results, `${fileName.replace('.pdf', '')}-pages.zip`)
        }
        setProgress(100)
        setProgressMsg('Done!')
        addToast({
          type: 'success',
          message: `Split into ${results.length} individual pages!`,
        })
      } else if (selectedPages.size > 0) {
        // Extract selected pages
        setProgressMsg('Extracting selected pages...')
        setProgress(20)
        const indices = Array.from(selectedPages).sort((a, b) => a - b)
        const resultBytes = await extractPages(pdfBytes, indices)
        setProgress(80)
        setProgressMsg('Preparing download...')
        const pageLabel = indices.map((i) => i + 1).join('-')
        downloadBlob(resultBytes, `${fileName.replace('.pdf', '')}-pages-${pageLabel}.pdf`)
        setProgress(100)
        setProgressMsg('Done!')
        addToast({
          type: 'success',
          message: `Extracted ${indices.length} page(s)!`,
        })
      } else {
        // Parse ranges
        const ranges = parseRangesToSplitFormat(rangeInput)
        if (ranges.length === 0) {
          addToast({
            type: 'error',
            message: 'Please enter valid page ranges (e.g. "1-3, 5, 7-9") or select pages.',
          })
          setProcessing(false)
          return
        }
        setProgressMsg('Splitting PDF...')
        setProgress(20)
        const results = await splitPDF(pdfBytes, ranges)
        setProgress(80)
        setProgressMsg('Preparing download...')

        if (results.length === 1) {
          downloadBlob(results[0].bytes, results[0].name)
        } else {
          await downloadMultipleAsZip(results, `${fileName.replace('.pdf', '')}-split.zip`)
        }
        setProgress(100)
        setProgressMsg('Done!')
        addToast({
          type: 'success',
          message: `Split into ${results.length} part(s)!`,
        })
      }
    } catch (err) {
      console.error('Split error:', err)
      addToast({ type: 'error', message: `Split failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [pdfBytes, splitMode, rangeInput, selectedPages, fileName, parseRangesToSplitFormat, addToast])

  return (
    <div className="animate-fade-in-up" id="split-tool">
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
            label="Drop your PDF file here to split"
            sublabel="or click to browse"
            id="split-dropzone"
            maxFiles={1}
          />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* File info & reset */}
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
            <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={processing} id="split-reset">
              Change file
            </button>
          </div>

          {/* Split mode tabs */}
          <div className="tabs" id="split-mode-tabs">
            <button
              className={`tab ${splitMode === 'ranges' ? 'active' : ''}`}
              onClick={() => setSplitMode('ranges')}
              disabled={processing}
            >
              <Scissors size={14} style={{ marginRight: 4 }} />
              By page ranges
            </button>
            <button
              className={`tab ${splitMode === 'individual' ? 'active' : ''}`}
              onClick={() => setSplitMode('individual')}
              disabled={processing}
            >
              <Package size={14} style={{ marginRight: 4 }} />
              Individual pages
            </button>
          </div>

          {/* Range input */}
          {splitMode === 'ranges' && (
            <div className="card">
              <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label className="input-label" htmlFor="split-range-input">
                  Page ranges (e.g. "1-3, 5, 7-9")
                </label>
                <input
                  className="input"
                  type="text"
                  id="split-range-input"
                  placeholder={`Enter page ranges (1-${pageCount})`}
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  disabled={processing}
                />
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Or click on page thumbnails below to select pages to extract
              </p>
            </div>
          )}

          {splitMode === 'individual' && (
            <div className="card">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                Each page will be saved as a separate PDF file. {pageCount > 1 ? `All ${pageCount} pages will be downloaded as a ZIP file.` : ''}
              </p>
            </div>
          )}

          {/* Page thumbnails */}
          {splitMode === 'ranges' && (
            <>
              <div className="section-header">
                <span className="section-label">Pages</span>
                <div className="section-line" />
                {selectedPages.size > 0 && (
                  <span className="badge badge-accent">
                    {selectedPages.size} selected
                  </span>
                )}
              </div>
              <div className="page-grid">
                {Array.from({ length: pageCount }, (_, i) => (
                  <PageThumbnail
                    key={i}
                    pdfBytes={pdfBytes}
                    pageNum={i + 1}
                    selected={selectedPages.has(i)}
                    onClick={() => handlePageClick(i)}
                    label={`Page ${i + 1}`}
                    maxWidth={140}
                    id={`split-page-${i}`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Progress */}
          {processing && <ProgressBar progress={progress} message={progressMsg} />}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleSplit}
              disabled={processing}
              id="split-btn"
            >
              {processing ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Splitting...
                </>
              ) : (
                <>
                  <Scissors size={20} />
                  {splitMode === 'individual'
                    ? `Split into ${pageCount} pages`
                    : selectedPages.size > 0
                    ? `Extract ${selectedPages.size} page(s)`
                    : 'Split PDF'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
