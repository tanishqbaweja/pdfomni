import { useState, useCallback } from 'react'
import { Download, Trash2, X } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import ProgressBar from '../Common/ProgressBar'
import { imagesToPDF } from '../../engine/pdfEngine'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, readFileAsDataURL, formatFileSize, isValidImage } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'

export default function ImageToPdfTool({ toolId, tool }) {
  const [images, setImages] = useState([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [pageSize, setPageSize] = useState('image')
  const [fitToPage, setFitToPage] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const addToast = useAppStore((s) => s.addToast)

  const handleFiles = useCallback(async (files) => {
    const validFiles = files.filter((f) => isValidImage(f))
    if (validFiles.length === 0) {
      addToast({ type: 'error', message: 'Please upload image files only (JPG, PNG, WebP, BMP).' })
      return
    }
    try {
      const newImages = []
      for (const f of validFiles) {
        const preview = await readFileAsDataURL(f)
        
        // Normalize image using a canvas to get clean JPEG/PNG bytes that pdf-lib supports
        const bytes = await new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)
            const type = (f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')) ? 'image/png' : 'image/jpeg'
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error('Failed to create blob from image canvas'))
                return
              }
              const reader = new FileReader()
              reader.onload = () => resolve(new Uint8Array(reader.result))
              reader.onerror = reject
              reader.readAsArrayBuffer(blob)
            }, type, 0.95)
          }
          img.onerror = () => reject(new Error('Failed to load image for normalization'))
          img.src = preview
        })

        newImages.push({
          id: crypto.randomUUID(),
          file: f,
          name: f.name,
          size: f.size,
          type: (f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')) ? 'image/png' : 'image/jpeg',
          preview,
          bytes,
        })
      }
      setImages((prev) => [...prev, ...newImages])
    } catch (err) {
      addToast({ type: 'error', message: `Failed to load images: ${err.message}` })
    }
  }, [addToast])

  const handleRemove = useCallback((id) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  const handleClearAll = useCallback(() => {
    setImages([])
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
      setImages((prev) => {
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

  const handleConvert = useCallback(async () => {
    if (images.length === 0) {
      addToast({ type: 'error', message: 'Please add at least one image.' })
      return
    }
    setProcessing(true)
    setProgress(0)
    setProgressMsg('Reading images...')
    try {
      const imageDataArray = []
      for (let i = 0; i < images.length; i++) {
        setProgress(((i + 1) / images.length) * 50)
        setProgressMsg(`Reading image ${i + 1} of ${images.length}...`)
        imageDataArray.push({
          bytes: images[i].bytes,
          type: images[i].type || images[i].file.type,
          name: images[i].name,
        })
      }

      setProgress(60)
      setProgressMsg('Creating PDF...')
      const pdfBytes = await imagesToPDF(imageDataArray, { pageSize, fitToPage })

      setProgress(90)
      setProgressMsg('Preparing download...')
      downloadBlob(pdfBytes, 'images-to-pdf.pdf')

      setProgress(100)
      setProgressMsg('Done!')
      addToast({ type: 'success', message: `Successfully created PDF from ${images.length} image${images.length !== 1 ? 's' : ''}!` })
    } catch (err) {
      console.error('Image to PDF error:', err)
      addToast({ type: 'error', message: `Conversion failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }, [images, pageSize, fitToPage, addToast])

  return (
    <div className="animate-fade-in-up" id="image-to-pdf-tool">
      {images.length === 0 ? (
        <FileDropZone
          onFiles={handleFiles}
          accept=".jpg,.jpeg,.png,.webp,.bmp"
          multiple={true}
          label="Drop your images here to convert to PDF"
          sublabel="or click to browse (JPG, PNG, WebP, or BMP)"
          id="image-to-pdf-dropzone"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Options */}
          <div className="card" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'center' }}>
              <div>
                <label className="input-label" htmlFor="img2pdf-page-size">Page Size</label>
                <select
                  className="select"
                  id="img2pdf-page-size"
                  value={pageSize}
                  onChange={(e) => setPageSize(e.target.value)}
                  disabled={processing}
                >
                  <option value="image">Same as image</option>
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', paddingTop: 'var(--space-5)' }}>
                <input
                  type="checkbox"
                  id="img2pdf-fit-to-page"
                  checked={fitToPage}
                  onChange={(e) => setFitToPage(e.target.checked)}
                  disabled={processing}
                />
                <label htmlFor="img2pdf-fit-to-page" style={{ fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                  Fit to page
                </label>
              </div>
              {pageSize === 'image' && (
                <span className="badge badge-accent" style={{ marginTop: 'var(--space-5)' }}>
                  Images with area larger than 1920 x 1080 are scaled down proportionally
                </span>
              )}
            </div>
          </div>

          {/* Image grid */}
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
                {images.length} image{images.length !== 1 ? 's' : ''}. Drag to reorder.
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleClearAll}
                disabled={processing}
                id="img2pdf-clear-all"
              >
                <Trash2 size={14} />
                Clear all
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                maxHeight: '500px',
                overflowY: 'auto',
              }}
            >
              {images.map((img, index) => (
                <div
                  key={img.id}
                  draggable={!processing}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  style={{
                    position: 'relative',
                    borderRadius: 'var(--radius-md)',
                    border: '2px solid',
                    borderColor:
                      dragOverIndex === index
                        ? 'var(--color-accent)'
                        : 'var(--color-border)',
                    background: dragIndex === index ? 'var(--color-surface-active)' : 'var(--color-surface)',
                    opacity: dragIndex === index ? 0.6 : 1,
                    cursor: 'grab',
                    transition: 'all var(--transition-fast)',
                    overflow: 'hidden',
                  }}
                  id={`img2pdf-image-${index}`}
                >
                  <img
                    src={img.preview}
                    alt={img.name}
                    style={{
                      width: '100%',
                      height: '120px',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  <div
                    style={{
                      padding: 'var(--space-2)',
                      fontSize: 'var(--text-xs)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{img.name}</div>
                    <div style={{ color: 'var(--color-text-muted)' }}>{formatFileSize(img.size)}</div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 4,
                      width: 22,
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-accent)',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '10px',
                    }}
                  >
                    {index + 1}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(img.id)
                    }}
                    disabled={processing}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 22,
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(0,0,0,0.6)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fff',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                    aria-label={`Remove ${img.name}`}
                    id={`img2pdf-remove-${index}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add more */}
          <FileDropZone
            onFiles={handleFiles}
            accept=".jpg,.jpeg,.png,.webp,.bmp"
            multiple={true}
            label="Add more images"
            sublabel="Drop or click to add"
            id="img2pdf-add-more"
          />

          {/* Progress */}
          {processing && <ProgressBar progress={progress} message={progressMsg} />}

          {/* Action */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleConvert}
              disabled={processing || images.length === 0}
              id="img2pdf-convert-btn"
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
