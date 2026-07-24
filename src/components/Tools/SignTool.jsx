import { useState, useRef, useCallback, useEffect } from 'react'
import { PenTool, Type, Download, Trash2, Move, ImagePlus, Bold, Italic, Underline } from 'lucide-react'
import FileDropZone from '../Common/FileDropZone'
import PageNavigator from '../Common/PageNavigator'
import { useAppStore } from '../../store/appStore'
import { readFileAsArrayBuffer, readFileAsDataURL } from '../../utils/fileHelpers'
import { downloadBlob } from '../../utils/download'
import * as pdfEngine from '../../engine/pdfEngine'
import * as pdfRenderer from '../../engine/pdfRenderer'

const FONTS = [
  { name: 'Cursive', css: 'cursive' },
  { name: 'Serif', css: 'Georgia, serif' },
  { name: 'Sans', css: 'Arial, sans-serif' },
  { name: 'Mono', css: '"Courier New", monospace' },
]

export default function SignTool() {
  const { addToast } = useAppStore()
  const [pdfBytes, setPdfBytes] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)

  // Signature mode
  const [sigMode, setSigMode] = useState('draw') // 'draw' | 'type' | 'image'
  const [sigText, setSigText] = useState('')
  const [sigFont, setSigFont] = useState(FONTS[0])
  const [sigColor, setSigColor] = useState('#1a1a2e')
  const [sigSize, setSigSize] = useState(32)
  const [sigBold, setSigBold] = useState(false)
  const [sigItalic, setSigItalic] = useState(false)
  const [sigUnderline, setSigUnderline] = useState(false)

  // Signature image data
  const [sigDataUrl, setSigDataUrl] = useState(null)
  const [sigImageType, setSigImageType] = useState('png')

  // Drawing state
  const [isDrawingSig, setIsDrawingSig] = useState(false)
  const [sigPaths, setSigPaths] = useState([])
  const [currentSigPath, setCurrentSigPath] = useState([])

  // Placement
  const [sigPos, setSigPos] = useState({ x: 100, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [sigPlacedSize, setSigPlacedSize] = useState({ w: 200, h: 80 })
  const [maxPageWidth, setMaxPageWidth] = useState(595)

  const sigCanvasRef = useRef(null)
  const pdfCanvasRef = useRef(null)
  const sigImageInputRef = useRef(null)
  const pageDims = useRef({ width: 0, height: 0, scale: 1.5 })

  const handleFile = useCallback(async (files) => {
    const file = files[0]
    if (!file) return
    try {
      setLoading(true)
      const bytes = await readFileAsArrayBuffer(file)
      setPdfBytes(bytes)
      setFileName(file.name)
      const count = await pdfRenderer.getPageCount(bytes)
      setPageCount(count)
      setCurrentPage(1)
      const info = await pdfEngine.getPDFInfo(bytes)
      if (info.pages.length > 0) {
        const maxWidth = Math.max(...info.pages.map(p => p.width))
        setMaxPageWidth(maxWidth)
      }
    } catch (err) {
      addToast({ type: 'error', message: `Failed to load PDF: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  // Render PDF page
  useEffect(() => {
    if (!pdfBytes || !pdfCanvasRef.current) return
    let cancelled = false
    const render = async () => {
      try {
        const container = pdfCanvasRef.current.closest('.pdf-preview-container') || pdfCanvasRef.current.parentElement
        const containerWidth = container ? container.offsetWidth : 800
        const displayWidth = Math.max(300, containerWidth - 32)
        const renderScale = Math.min(2.2, displayWidth / maxPageWidth)

        const dims = await pdfRenderer.renderPageToCanvas(pdfBytes, currentPage, pdfCanvasRef.current, renderScale)
        if (cancelled || !dims) return
        pageDims.current = { ...dims, scale: renderScale }
      } catch (err) {
        if (cancelled || /Rendering cancelled/i.test(err?.message || '')) return
        addToast({ type: 'error', message: `Render failed: ${err.message}` })
      }
    }
    render()
    return () => { cancelled = true }
  }, [pdfBytes, currentPage, maxPageWidth])

  // Signature drawing canvas
  const redrawSigCanvas = useCallback(() => {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw a subtle line
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(20, canvas.height - 30)
    ctx.lineTo(canvas.width - 20, canvas.height - 30)
    ctx.stroke()

    // Draw paths
    ctx.strokeStyle = sigColor
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const path of sigPaths) {
      if (path.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(path[0].x, path[0].y)
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y)
      }
      ctx.stroke()
    }
  }, [sigPaths, sigColor])

  useEffect(() => {
    redrawSigCanvas()
  }, [sigPaths, sigColor, redrawSigCanvas])

  const getSigCanvasCoords = (e) => {
    const rect = sigCanvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleSigPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setIsDrawingSig(true)
    setCurrentSigPath([getSigCanvasCoords(e)])
  }

  const handleSigPointerMove = (e) => {
    if (!isDrawingSig) return
    const coords = getSigCanvasCoords(e)
    setCurrentSigPath(prev => [...prev, coords])

    // Live preview
    const ctx = sigCanvasRef.current.getContext('2d')
    redrawSigCanvas()
    ctx.strokeStyle = sigColor
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    const path = [...currentSigPath, coords]
    ctx.moveTo(path[0].x, path[0].y)
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y)
    }
    ctx.stroke()
  }

  const handleSigPointerUp = (e) => {
    if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!isDrawingSig) return
    setIsDrawingSig(false)
    if (currentSigPath.length > 1) {
      setSigPaths(prev => [...prev, currentSigPath])
    }
    setCurrentSigPath([])
  }

  const clearSignature = () => {
    setSigPaths([])
    setSigDataUrl(null)
  }

  const captureSignature = () => {
    if (sigMode === 'draw') {
      if (sigPaths.length === 0) {
        addToast({ type: 'warning', message: 'Please draw your signature first' })
        return
      }
      const dataUrl = sigCanvasRef.current.toDataURL('image/png')
      setSigDataUrl(dataUrl)
      setSigImageType('png')
    } else if (sigMode === 'type') {
      if (!sigText) {
        addToast({ type: 'warning', message: 'Please type your signature' })
        return
      }
      // Render typed sig to canvas
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = 400
      tempCanvas.height = 100
      const ctx = tempCanvas.getContext('2d')
      ctx.font = `${sigItalic ? 'italic ' : ''}${sigBold ? 'bold ' : ''}${sigSize}px ${sigFont.css}`
      ctx.fillStyle = sigColor
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(sigText, tempCanvas.width / 2, tempCanvas.height / 2)
      if (sigUnderline) {
        const textWidth = ctx.measureText(sigText).width
        const y = tempCanvas.height / 2 + sigSize * 0.35
        ctx.lineWidth = Math.max(1, sigSize * 0.06)
        ctx.beginPath()
        ctx.moveTo((tempCanvas.width - textWidth) / 2, y)
        ctx.lineTo((tempCanvas.width + textWidth) / 2, y)
        ctx.strokeStyle = sigColor
        ctx.stroke()
      }
      setSigDataUrl(tempCanvas.toDataURL('image/png'))
      setSigImageType('png')
    } else if (!sigDataUrl) {
      addToast({ type: 'warning', message: 'Please upload a signature image first' })
      return
    }
    addToast({ type: 'success', message: 'Signature captured! Position it on the PDF.' })
  }

  const handleSignatureImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await readFileAsDataURL(file)
      const img = await new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = dataUrl
      })
      const maxPixelArea = 1000 * 1000
      const sourceArea = img.naturalWidth * img.naturalHeight
      const scale = sourceArea > maxPixelArea ? Math.sqrt(maxPixelArea / sourceArea) : 1
      const normalizedWidth = Math.max(1, Math.round(img.naturalWidth * scale))
      const normalizedHeight = Math.max(1, Math.round(img.naturalHeight * scale))
      const isJpeg = file.type.includes('jpeg') || file.type.includes('jpg')
      const needsNormalization = scale < 1 || file.type.includes('webp')
      let normalizedDataUrl = dataUrl

      if (needsNormalization) {
        const canvas = document.createElement('canvas')
        canvas.width = normalizedWidth
        canvas.height = normalizedHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Unable to prepare the signature image.')
        context.drawImage(img, 0, 0, normalizedWidth, normalizedHeight)
        normalizedDataUrl = canvas.toDataURL(isJpeg ? 'image/jpeg' : 'image/png', 0.95)
      }

      setSigDataUrl(normalizedDataUrl)
      setSigImageType(isJpeg ? 'jpg' : 'png')
      const ratio = normalizedWidth / Math.max(1, normalizedHeight)
      setSigPlacedSize({ w: Math.min(220, normalizedWidth), h: Math.round(Math.min(220, normalizedWidth) / ratio) })
      addToast({ type: 'success', message: 'Signature image loaded. Position it on the PDF.' })
    } catch (err) {
      addToast({ type: 'error', message: `Failed to load image: ${err.message}` })
    } finally {
      e.target.value = ''
    }
  }

  const handleResizeStart = (e, corner) => {
    if (!sigDataUrl) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const initialPos = { ...sigPos }
    const initialSize = { ...sigPlacedSize }

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      let nextW = initialSize.w
      let nextH = initialSize.h
      let nextX = initialPos.x
      let nextY = initialPos.y

      if (corner.includes('e')) nextW = Math.max(40, initialSize.w + dx)
      if (corner.includes('s')) nextH = Math.max(20, initialSize.h + dy)
      if (corner.includes('w')) {
        nextW = Math.max(40, initialSize.w - dx)
        nextX = initialPos.x + (initialSize.w - nextW)
      }
      if (corner.includes('n')) {
        nextH = Math.max(20, initialSize.h - dy)
        nextY = initialPos.y + (initialSize.h - nextH)
      }

      setSigPlacedSize({ w: nextW, h: nextH })
      setSigPos({ x: nextX, y: nextY })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // Dragging signature on PDF
  const handlePdfPointerDown = (e) => {
    if (!sigDataUrl) return
    const rect = pdfCanvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x >= sigPos.x && x <= sigPos.x + sigPlacedSize.w &&
        y >= sigPos.y && y <= sigPos.y + sigPlacedSize.h) {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setIsDragging(true)
      setDragOffset({ x: x - sigPos.x, y: y - sigPos.y })
    }
  }

  const handlePdfPointerMove = (e) => {
    if (!isDragging) return
    const rect = pdfCanvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setSigPos({ x: x - dragOffset.x, y: y - dragOffset.y })
  }

  const handlePdfPointerUp = (e) => {
    if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }

  const handleSave = async () => {
    if (!pdfBytes || !sigDataUrl) return
    try {
      setProcessing(true)

      // Convert data URL to bytes
      const response = await fetch(sigDataUrl)
      const sigBlob = await response.arrayBuffer()
      const sigImageBytes = new Uint8Array(sigBlob)

      const { scale } = pageDims.current
      const info = await pdfEngine.getPDFInfo(pdfBytes)
      const pageInfo = info.pages[currentPage - 1]

      const pdfX = sigPos.x / scale
      const pdfY = pageInfo.height - ((sigPos.y + sigPlacedSize.h) / scale)
      const pdfW = sigPlacedSize.w / scale
      const pdfH = sigPlacedSize.h / scale

      const result = await pdfEngine.addImageToPDF(pdfBytes, sigImageBytes, {
        pageIndex: currentPage - 1,
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH,
        type: sigImageType,
      })

      const outName = fileName.replace('.pdf', '_signed.pdf')
      downloadBlob(result, outName)
      addToast({ type: 'success', message: 'Signed PDF downloaded!' })
    } catch (err) {
      addToast({ type: 'error', message: `Signing failed: ${err.message}` })
    } finally {
      setProcessing(false)
    }
  }

  if (!pdfBytes) {
    return (
      <div id="sign-tool" className="animate-fade-in-up">
        <FileDropZone onFiles={handleFile} accept=".pdf" multiple={false} label="Drop your PDF here" id="sign-dropzone" />
        {loading && <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>}
      </div>
    )
  }

  return (
    <div id="sign-tool" className="animate-fade-in-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          {fileName} - {pageCount} page{pageCount === 1 ? '' : 's'}
        </div>
        <PageNavigator currentPage={currentPage} pageCount={pageCount} onChange={setCurrentPage} compact idPrefix="sign-page" />
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Signature panel */}
        <div className="card" style={{ flex: '0 0 360px' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--space-4)' }}>
            Create Signature
          </h3>

          {/* Mode tabs */}
          <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
            <button className={`tab ${sigMode === 'draw' ? 'active' : ''}`} onClick={() => setSigMode('draw')}>
              <PenTool size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Draw
            </button>
            <button className={`tab ${sigMode === 'type' ? 'active' : ''}`} onClick={() => setSigMode('type')}>
              <Type size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Type
            </button>
            <button className={`tab ${sigMode === 'image' ? 'active' : ''}`} onClick={() => setSigMode('image')}>
              <ImagePlus size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Image
            </button>
          </div>

          {sigMode === 'draw' ? (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <canvas
                ref={sigCanvasRef}
                width={340}
                height={120}
                style={{
                  width: '100%', height: 120,
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  cursor: 'crosshair',
                  touchAction: 'none',
                }}
                onPointerDown={handleSigPointerDown}
                onPointerMove={handleSigPointerMove}
                onPointerUp={handleSigPointerUp}
                onPointerCancel={handleSigPointerUp}
              />
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)', textAlign: 'center' }}>
                Draw your signature above
              </div>
            </div>
          ) : sigMode === 'type' ? (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
                <input className="input" value={sigText} onChange={e => setSigText(e.target.value)} placeholder="Your name" id="sign-text" />
              </div>
              <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
                <label className="input-label">Font</label>
                <select className="select" value={sigFont.name} onChange={e => setSigFont(FONTS.find(f => f.name === e.target.value))} id="sign-font">
                  {FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 'var(--space-3)' }}>
                <label className="input-label">Size: {sigSize}px</label>
                <input type="range" min="16" max="64" value={sigSize} onChange={e => setSigSize(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <button className={`btn btn-sm ${sigBold ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSigBold(v => !v)}><Bold size={14} /> Bold</button>
                <button className={`btn btn-sm ${sigItalic ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSigItalic(v => !v)}><Italic size={14} /> Italic</button>
                <button className={`btn btn-sm ${sigUnderline ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSigUnderline(v => !v)}><Underline size={14} /> Underline</button>
              </div>
              {sigText && (
                <div style={{
                  padding: 'var(--space-4)',
                  background: 'white',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                  color: sigColor,
                  fontFamily: sigFont.css,
                  fontSize: sigSize,
                  fontWeight: sigBold ? 700 : 400,
                  fontStyle: sigItalic ? 'italic' : 'normal',
                  textDecoration: sigUnderline ? 'underline' : 'none',
                  marginBottom: 'var(--space-3)',
                }}>
                  {sigText}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <input ref={sigImageInputRef} type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleSignatureImage} style={{ display: 'none' }} />
              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => sigImageInputRef.current?.click()}>
                <ImagePlus size={16} /> Upload Signature Image
              </button>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
                PNG, JPG, or WebP. Images above 1 megapixel are scaled down proportionally.
              </div>
              {sigDataUrl && (
                <div style={{ marginTop: 'var(--space-3)', background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
                  <img src={sigDataUrl} alt="Uploaded signature" style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain' }} />
                </div>
              )}
            </div>
          )}

          <div className="input-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="input-label">Ink Color</label>
            <input type="color" value={sigColor} onChange={e => setSigColor(e.target.value)}
              style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }} />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            <button className="btn btn-secondary btn-sm" onClick={clearSignature}><Trash2 size={14} /> Clear</button>
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={captureSignature}>Capture Signature</button>
          </div>

          {sigDataUrl && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">Width</label>
                  <input className="input" type="number" value={sigPlacedSize.w} onChange={e => setSigPlacedSize(p => ({ ...p, w: Number(e.target.value) }))} min={50} />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label">Height</label>
                  <input className="input" type="number" value={sigPlacedSize.h} onChange={e => setSigPlacedSize(p => ({ ...p, h: Number(e.target.value) }))} min={20} />
                </div>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={handleSave} disabled={processing} id="sign-save">
                {processing ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <Download size={14} />}
                Save & Download
              </button>
            </>
          )}
        </div>

        {/* PDF preview with signature overlay */}
        <div style={{ flex: '1 1 400px', minWidth: 0 }}>
          <div className="pdf-preview-container">
            <div className="pdf-preview-wrapper" style={{
              borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)',
              touchAction: 'none',
            }}
              onPointerDown={handlePdfPointerDown}
              onPointerMove={handlePdfPointerMove}
              onPointerUp={handlePdfPointerUp}
              onPointerCancel={handlePdfPointerUp}
            >
              <canvas ref={pdfCanvasRef} style={{ display: 'block' }} />
              {sigDataUrl && (
                <div
                  style={{
                    position: 'absolute',
                    left: sigPos.x,
                    top: sigPos.y,
                    width: sigPlacedSize.w,
                    height: sigPlacedSize.h,
                    cursor: 'move',
                    border: '2px dashed var(--color-accent)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <img
                    src={sigDataUrl}
                    alt="Signature"
                    style={{ width: '100%', height: '100%', pointerEvents: 'none', objectFit: 'contain' }}
                  />
                  {['nw', 'ne', 'sw', 'se'].map((corner) => (
                    <button
                      key={corner}
                      className={`resize-handle resize-handle-${corner}`}
                      onPointerDown={(e) => handleResizeStart(e, corner)}
                      aria-label={`Resize signature ${corner}`}
                      style={{
                        position: 'absolute',
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid white',
                        background: 'var(--color-accent)',
                        padding: 0,
                        zIndex: 5,
                        cursor: `${corner}-resize`,
                        top: corner.includes('n') ? -7 : 'auto',
                        bottom: corner.includes('s') ? -7 : 'auto',
                        left: corner.includes('w') ? -7 : 'auto',
                        right: corner.includes('e') ? -7 : 'auto',
                        boxShadow: 'var(--shadow-sm)',
                      }}
                    />
                  ))}
                </div>
              )}
              {sigDataUrl && (
                <div style={{
                  position: 'absolute',
                  left: sigPos.x + sigPlacedSize.w / 2 - 20,
                  top: sigPos.y - 24,
                  background: 'var(--color-accent)',
                  color: 'white',
                  fontSize: 'var(--text-xs)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <Move size={10} /> Drag
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
