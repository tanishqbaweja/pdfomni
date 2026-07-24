import { useState, useCallback } from 'react'
import { Download, X, RotateCw, Undo2, FileText } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import PageThumbnail from '../Common/PageThumbnail'
import ProgressBar from '../Common/ProgressBar'
import { reorderPages, removePages } from '../../engine/pdfEngine'
import { getPageCount } from '../../engine/pdfRenderer'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, formatFileSize } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function ReorderTool({ toolId, tool }) {
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pdfBytes, setPdfBytes] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageOrder, setPageOrder] = useState([]) // array of original 0-indexed page indices
  const [removedPages, setRemovedPages] = useState(new Set())
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
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
        setPageOrder(Array.from({ length: count }, (_, i) => i))
        setRemovedPages(new Set())
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
    setPageOrder([])
    setRemovedPages(new Set())
  }, [])

  const handleRestore = useCallback(() => {
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i))
    setRemovedPages(new Set())
  }, [pageCount])

  const activePages = pageOrder.filter((i) => !removedPages.has(i))

  const handleDragStart = useCallback((e, visualIndex) => {
    setDragIndex(visualIndex)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e, visualIndex) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(visualIndex)
  }, [])

  const handleDrop = useCallback(
    (e, dropVisualIndex) => {
      e.preventDefault()
      if (dragIndex === null || dragIndex === dropVisualIndex) {
        setDragIndex(null)
        setDragOverIndex(null)
        return
      }

      // Work on the active (visible) pages
      const active = pageOrder.filter((i) => !removedPages.has(i))
      const [moved] = active.splice(dragIndex, 1)
      active.splice(dropVisualIndex, 0, moved)

      // Rebuild full order: active pages in new order + removed pages at end
      const removed = pageOrder.filter((i) => removedPages.has(i))
      setPageOrder([...active, ...removed])

      setDragIndex(null)
      setDragOverIndex(null)
    },
    [dragIndex, pageOrder, removedPages]
  )

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleRemovePage = useCallback((originalIndex) => {
    setRemovedPages((prev) => {
      const next = new Set(prev)
      next.add(originalIndex)
      return next
    })
  }, [])

  const handleRestorePage = useCallback((originalIndex) => {
    setRemovedPages((prev) => {
      const next = new Set(prev)
      next.delete(originalIndex)
      return next
    })
  }, [])

  const hasChanges =
    removedPages.size > 0 ||
    activePages.some((origIndex, i) => origIndex !== i)

  const handleApply = useCallback(async () => {
    if (!pdfBytes) return
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Applying changes...')

    try {
      setProgress(30)

      let resultBytes
      if (removedPages.size > 0 && activePages.some((origIndex, i) => origIndex !== i)) {
        // Both reorder and remove: use reorderPages with only active pages in new order
        resultBytes = await reorderPages(pdfBytes, activePages)
      } else if (removedPages.size > 0) {
        // Only remove
        resultBytes = await removePages(
          pdfBytes,
          Array.from(removedPages)
        )
      } else {
        // Only reorder
        resultBytes = await reorderPages(pdfBytes, activePages)
      }

      setProgress(80)
      setProgressMsg('Preparing download...')
      downloadBlob(resultBytes, fileName.replace('.pdf', '-reordered.pdf'))

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: 'PDF reordered and downloaded!' })
    } catch (err) {
      console.error('Reorder error:', err)
      addToast({ type: 'error', message: `Reorder failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [pdfBytes, activePages, removedPages, fileName, addToast])

  return (
    <div className="animate-fade-in-up" id="reorder-tool">
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
            label="Drop your PDF file here to reorder pages"
            sublabel="or click to browse"
            id="reorder-dropzone"
            maxFiles={1}
          />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* File info & controls */}
          <div className="card" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-4) var(--space-5)',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <FileText size={20} style={{ color: 'var(--color-accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{fileName}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {activePages.length} of {pageCount} pages
                  {removedPages.size > 0 && ` • ${removedPages.size} removed`}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {hasChanges && (
                <button className="btn btn-ghost btn-sm" onClick={handleRestore} disabled={processing} id="reorder-restore">
                  <Undo2 size={14} />
                  Reset
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={processing} id="reorder-change-file">
                Change file
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
          }}>
            Drag pages to reorder • Click <X size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> to remove a page
          </div>

          {/* Page grid */}
          <div className="page-grid">
            {activePages.map((originalIndex, visualIndex) => (
              <PageThumbnail
                key={originalIndex}
                pdfBytes={pdfBytes}
                pageNum={originalIndex + 1}
                label={`${visualIndex + 1} (was ${originalIndex + 1})`}
                maxWidth={140}
                draggable={!processing}
                onDragStart={(e) => handleDragStart(e, visualIndex)}
                onDragOver={(e) => handleDragOver(e, visualIndex)}
                onDrop={(e) => handleDrop(e, visualIndex)}
                id={`reorder-page-${visualIndex}`}
                overlay={
                  <>
                    {dragOverIndex === visualIndex && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(168, 85, 247, 0.2)',
                        border: '2px solid var(--color-accent)',
                        borderRadius: 'var(--radius-md)',
                        pointerEvents: 'none',
                      }} />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemovePage(originalIndex)
                      }}
                      disabled={processing || activePages.length <= 1}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 24,
                        height: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(239, 68, 68, 0.9)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: 'white',
                        cursor: 'pointer',
                        opacity: 0.7,
                        transition: 'opacity var(--transition-fast)',
                        zIndex: 2,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                      aria-label={`Remove page ${originalIndex + 1}`}
                    >
                      <X size={14} />
                    </button>
                  </>
                }
              />
            ))}
          </div>

          {/* Removed pages */}
          {removedPages.size > 0 && (
            <>
              <div className="section-header">
                <span className="section-label">Removed pages</span>
                <div className="section-line" />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {Array.from(removedPages)
                  .sort((a, b) => a - b)
                  .map((origIndex) => (
                    <button
                      key={origIndex}
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRestorePage(origIndex)}
                      disabled={processing}
                    >
                      Page {origIndex + 1}. Restore
                    </button>
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
              onClick={handleApply}
              disabled={processing || !hasChanges}
              id="reorder-apply-btn"
            >
              {processing ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Applying...
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
