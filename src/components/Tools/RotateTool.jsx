import { useState, useCallback } from 'react'
import { Download, RotateCw, RotateCcw, FlipVertical, FileText, CheckSquare, Square } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import PageThumbnail from '../Common/PageThumbnail'
import ProgressBar from '../Common/ProgressBar'
import { rotatePages } from '../../engine/pdfEngine'
import { getPageCount } from '../../engine/pdfRenderer'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, formatFileSize } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function RotateTool({ toolId, tool }) {
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pdfBytes, setPdfBytes] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [selectedPages, setSelectedPages] = useState(new Set())
  const [rotationMap, setRotationMap] = useState({}) // { pageIndex: totalDegreesApplied }
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
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
        setSelectedPages(new Set())
        setRotationMap({})
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
    setSelectedPages(new Set())
    setRotationMap({})
  }, [])

  const handlePageClick = useCallback((pageIndex) => {
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pageIndex)) next.delete(pageIndex)
      else next.add(pageIndex)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (selectedPages.size === pageCount) {
      setSelectedPages(new Set())
    } else {
      setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)))
    }
  }, [selectedPages, pageCount])

  const applyRotation = useCallback(
    (degrees) => {
      const targets =
        selectedPages.size > 0
          ? selectedPages
          : new Set(Array.from({ length: pageCount }, (_, i) => i))

      setRotationMap((prev) => {
        const next = { ...prev }
        for (const idx of targets) {
          next[idx] = ((next[idx] || 0) + degrees) % 360
        }
        return next
      })
    },
    [selectedPages, pageCount]
  )

  const handleRotateCW = useCallback(() => applyRotation(90), [applyRotation])
  const handleRotateCCW = useCallback(() => applyRotation(-90), [applyRotation])
  const handleRotate180 = useCallback(() => applyRotation(180), [applyRotation])

  const handleClearRotations = useCallback(() => {
    setRotationMap({})
  }, [])

  const hasRotations = Object.values(rotationMap).some((deg) => deg !== 0)

  const handleApply = useCallback(async () => {
    if (!pdfBytes || !hasRotations) return
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Applying rotations...')

    try {
      setProgress(20)
      // Build rotation array for the engine
      const rotations = Object.entries(rotationMap)
        .filter(([, deg]) => deg !== 0)
        .map(([index, degrees]) => ({
          index: parseInt(index),
          degrees,
        }))

      setProgress(40)
      const resultBytes = await rotatePages(pdfBytes, rotations)

      setProgress(80)
      setProgressMsg('Preparing download...')
      downloadBlob(resultBytes, fileName.replace('.pdf', '-rotated.pdf'))

      setProgress(100)
      setProgressMsg('Done!')
      addToast({
        type: 'success',
        message: `Rotated ${rotations.length} page(s) successfully!`,
      })
    } catch (err) {
      console.error('Rotate error:', err)
      addToast({ type: 'error', message: `Rotation failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [pdfBytes, rotationMap, fileName, hasRotations, addToast])

  const getRotationBadge = (pageIndex) => {
    const deg = rotationMap[pageIndex]
    if (!deg || deg === 0) return null
    return (
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          padding: '2px 6px',
          background: 'rgba(168, 85, 247, 0.9)',
          borderRadius: 'var(--radius-sm)',
          color: 'white',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          zIndex: 2,
        }}
      >
        {deg > 0 ? '+' : ''}{deg}°
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up" id="rotate-tool">
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
            label="Drop your PDF file here to rotate pages"
            sublabel="or click to browse"
            id="rotate-dropzone"
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
            <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={processing} id="rotate-change-file">
              Change file
            </button>
          </div>

          {/* Rotation controls */}
          <div className="card" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            padding: 'var(--space-4) var(--space-5)',
          }}>
            <button className="btn btn-secondary btn-sm" onClick={handleSelectAll} disabled={processing} id="rotate-select-all">
              {selectedPages.size === pageCount ? <CheckSquare size={14} /> : <Square size={14} />}
              {selectedPages.size === pageCount ? 'Deselect all' : 'Select all'}
            </button>
            <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />
            <button className="btn btn-secondary" onClick={handleRotateCCW} disabled={processing} id="rotate-ccw">
              <RotateCcw size={16} />
              90° CCW
            </button>
            <button className="btn btn-secondary" onClick={handleRotateCW} disabled={processing} id="rotate-cw">
              <RotateCw size={16} />
              90° CW
            </button>
            <button className="btn btn-secondary" onClick={handleRotate180} disabled={processing} id="rotate-180">
              <FlipVertical size={16} />
              180°
            </button>
            <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />
            <button className="btn btn-ghost btn-sm" onClick={handleClearRotations} disabled={processing || !hasRotations} id="rotate-clear">
              Clear rotations
            </button>
          </div>

          {/* Info text */}
          <div style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
          }}>
            {selectedPages.size > 0
              ? `${selectedPages.size} page(s) selected. Rotation will apply to selected pages.`
              : 'No pages selected. Rotation will apply to all pages.'}
          </div>

          {/* Page grid */}
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
                id={`rotate-page-${i}`}
                overlay={getRotationBadge(i)}
                rotation={rotationMap[i] || 0}
              />
            ))}
          </div>

          {/* Progress */}
          {processing && <ProgressBar progress={progress} message={progressMsg} />}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleApply}
              disabled={processing || !hasRotations}
              id="rotate-apply-btn"
            >
              {processing ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Rotating...
                </>
              ) : (
                <>
                  <Download size={20} />
                  Apply & Download
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
