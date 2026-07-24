import { useCallback, useEffect, useRef, useState } from 'react'

export default function PdfToWordTool() {
  const frameRef = useRef(null)
  const [frameHeight, setFrameHeight] = useState(680)
  const [frameReady, setFrameReady] = useState(false)

  const sendTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'pdfomni-theme',
      theme: document.documentElement.dataset.theme || 'light',
    }, window.location.origin)
  }, [])

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type !== 'pdfomni-pdf-to-word-height') return
      const nextHeight = Number(event.data.height)
      if (Number.isFinite(nextHeight)) setFrameHeight(Math.max(560, Math.min(nextHeight, 1600)))
    }
    const themeObserver = new MutationObserver(sendTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    window.addEventListener('message', handleMessage)
    return () => {
      themeObserver.disconnect()
      window.removeEventListener('message', handleMessage)
    }
  }, [sendTheme])

  return (
    <div className={`pdf-to-word-frame-shell${frameReady ? ' is-ready' : ''}`}>
      <iframe
        ref={frameRef}
        className="pdf-to-word-frame"
        src="/pdf-to-word/app/index.html?embedded=1"
        title="PDF to Word converter"
        style={{ height: `${frameHeight}px` }}
        onLoad={() => {
          sendTheme()
          setFrameReady(true)
        }}
      />
    </div>
  )
}
