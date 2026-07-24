import { useState, useCallback } from 'react'
import { Download, Trash2, GripVertical, Plus, FileText, Merge } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import ProgressBar from '../Common/ProgressBar'
import { mergePDFFiles } from '../../engine/pdfEngine'
import { useAppStore } from '../../store/appStore'
import { formatFileSize } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function MergeTool({ toolId, tool }) {
  const [files, setFiles] = useState([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const addToast = useAppStore((s) => s.addToast)

  const handleFiles = useCallback((newFiles) => {
    const pdfFiles = newFiles.filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )
    if (pdfFiles.length === 0) {
      addToast({ type: 'error', message: 'Please upload PDF files only.' })
      return
    }
    setFiles((prev) => [
      ...prev,
      ...pdfFiles.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
      })),
    ])
  }, [addToast])

  const handleRemove = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const handleClearAll = useCallback(() => {
    setFiles([])
  }, [])

  const handleDragStart = useCallback((e, index) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback(
    (e, dropIndex) => {
      e.preventDefault()
      if (dragIndex === null || dragIndex === dropIndex) {
        setDragIndex(null)
        setDragOverIndex(null)
        return
      }
      setFiles((prev) => {
        const updated = [...prev]
        const [moved] = updated.splice(dragIndex, 1)
        updated.splice(dropIndex, 0, moved)
        return updated
      })
      setDragIndex(null)
      setDragOverIndex(null)
    },
    [dragIndex]
  )

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleMerge = useCallback(async () => {
    if (files.length < 2) {
      addToast({ type: 'error', message: 'Please add at least 2 PDF files to merge.' })
      return
    }
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Reading files...')
    try {
      const mergedBytes = await mergePDFFiles(
        files.map((item) => item.file),
        (current, total) => {
          const displayIndex = Math.min(current + 1, total)
          setProgress(total ? (current / total) * 70 : 0)
          setProgressMsg(`Merging file ${displayIndex} of ${total}...`)
        }
      )

      setProgress(90)
      setProgressMsg('Preparing download...')
      downloadBlob(mergedBytes, 'merged.pdf')

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: `Successfully merged ${files.length} PDFs!` })
    } catch (err) {
      console.error('Merge error:', err)
      addToast({ type: 'error', message: `Merge failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [files, addToast])

  return (
    <div className="animate-fade-in-up" id="merge-tool">
      {files.length === 0 ? (
        <FileDropZone
          onFiles={handleFiles}
          multiple={true}
          label="Drop your PDF files here to merge"
          sublabel="or click to browse and add 2 or more files"
          id="merge-dropzone"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* File list */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-4) var(--space-5)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                {files.length} file{files.length !== 1 ? 's' : ''}. Drag to reorder.
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleClearAll}
                  disabled={processing}
                  id="merge-clear-all"
                >
                  <Trash2 size={14} />
                  Clear all
                </button>
              </div>
            </div>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {files.map((f, index) => (
                <div
                  key={f.id}
                  className="file-list-item"
                  draggable={!processing}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  style={{
                    borderRadius: 0,
                    borderLeft: 'none',
                    borderRight: 'none',
                    borderTop: 'none',
                    background:
                      dragOverIndex === index
                        ? 'var(--color-accent-dim)'
                        : dragIndex === index
                        ? 'var(--color-surface-active)'
                        : undefined,
                    opacity: dragIndex === index ? 0.6 : 1,
                    transition: 'background var(--transition-fast)',
                  }}
                  id={`merge-file-${index}`}
                >
                  <GripVertical
                    size={16}
                    style={{ color: 'var(--color-text-muted)', cursor: 'grab', flexShrink: 0 }}
                  />
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-accent-dim)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-accent)',
                      fontWeight: 700,
                      fontSize: 'var(--text-xs)',
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <FileText size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {formatFileSize(f.size)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => handleRemove(f.id)}
                    disabled={processing}
                    aria-label={`Remove ${f.name}`}
                    id={`merge-remove-${index}`}
                  >
                    <Trash2 size={16} style={{ color: 'var(--color-red)' }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add more files */}
          <FileDropZone
            onFiles={handleFiles}
            multiple={true}
            label="Add more PDF files"
            sublabel="Drop or click to add"
            id="merge-add-more"
            maxFiles={50}
          />

          {/* Progress */}
          {processing && (
            <ProgressBar progress={progress} message={progressMsg} />
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleMerge}
              disabled={processing || files.length < 2}
              id="merge-btn"
            >
              {processing ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Merging...
                </>
              ) : (
                <>
                  <Merge size={20} />
                  Merge {files.length} PDF{files.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
