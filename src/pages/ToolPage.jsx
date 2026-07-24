import { useEffect, useRef, useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getToolById } from '../config/tools'
import { getToolSeo } from '../config/toolSeo'
import Seo from '../components/Common/Seo'
import ToolSeoSection from '../components/Common/ToolSeoSection'

// Tool components
import MergeTool from '../components/Tools/MergeTool'
import SplitTool from '../components/Tools/SplitTool'
import ReorderTool from '../components/Tools/ReorderTool'
import RotateTool from '../components/Tools/RotateTool'
import PageNumberTool from '../components/Tools/PageNumberTool'
import WatermarkTool from '../components/Tools/WatermarkTool'
import RedactTool from '../components/Tools/RedactTool'
import CropTool from '../components/Tools/CropTool'
import EncryptTool from '../components/Tools/EncryptTool'
import DecryptTool from '../components/Tools/DecryptTool'
import SignTool from '../components/Tools/SignTool'
import ImageToPdfTool from '../components/Tools/ImageToPdfTool'
import PdfToImageTool from '../components/Tools/PdfToImageTool'
import PdfToWordTool from '../components/Tools/PdfToWordTool'
import PdfToTextTool from '../components/Tools/PdfToTextTool'
import WordToPdfTool from '../components/Tools/WordToPdfTool'
import ExcelToPdfTool from '../components/Tools/ExcelToPdfTool'
import HtmlToPdfTool from '../components/Tools/HtmlToPdfTool'
import BatchTool from '../components/Tools/BatchTool'
import WcagTool from '../components/Tools/WcagTool'

function CompressIframeWrapper() {
  const [frameReady, setFrameReady] = useState(false)

  const applyTheme = (event) => {
    const theme = document.documentElement.dataset.theme || 'light'
    const frameWindow = event.currentTarget.contentWindow
    try {
      event.currentTarget.contentDocument.documentElement.dataset.theme = theme
    } catch {
      // The iframe is same-origin in normal builds, but posting is harmless if direct access fails.
    }
    frameWindow?.postMessage({ type: 'pdfomni-theme', theme }, window.location.origin)
    setFrameReady(true)
  }

  return (
    <div className={`compress-frame-shell${frameReady ? ' is-ready' : ''}`}>
      <iframe
        src="/compress/app/index.html?embedded=1"
        onLoad={applyTheme}
        className="compress-frame"
        title="PDF Compressor"
      />
    </div>
  )
}

function EditPdfIframe() {
  const frameRef = useRef(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [landingTab, setLandingTab] = useState('pages')
  const [frameReady, setFrameReady] = useState(false)
  const isIOSWebKit = /iP(?:ad|hone|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    if (isIOSWebKit) window.location.replace('/editpdf.html?standalone=1')
  }, [isIOSWebKit])

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === 'pdfomni-editor-workspace') {
        setWorkspaceOpen(true)
        return
      }
      if (event.data?.type === 'pdfomni-theme' && ['light', 'dark'].includes(event.data.theme)) {
        document.documentElement.dataset.theme = event.data.theme
        try {
          localStorage.setItem('pdfomni_theme', event.data.theme)
        } catch {
          // Ignore private browsing storage failures.
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (!workspaceOpen) return undefined
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [workspaceOpen])

  if (isIOSWebKit) {
    return null
  }

  return (
    <div className={`edit-pdf-frame-shell${workspaceOpen ? ' workspace-open' : ''}${frameReady ? ' is-ready' : ''}`}>
      <iframe
        ref={frameRef}
        src="/editpdf.html?embedded=1"
        className="edit-pdf-frame"
        title="PDF Editor"
        onLoad={(event) => {
          const theme = document.documentElement.dataset.theme || 'light'
          event.currentTarget.contentWindow?.postMessage(
            { type: 'pdfomni-theme', theme },
            window.location.origin,
          )
          setFrameReady(true)
        }}
      />
      {frameReady && !workspaceOpen && (
        <aside className="edit-pdf-landing-sidebar" aria-label="PDF editor navigation">
          <div className="edit-pdf-landing-sidebar-top">
            <Link to="/" className="edit-pdf-landing-brand" aria-label="PDFOmni home">
              <span className="edit-pdf-landing-mark">P</span>
              <span>PDFOmni</span>
            </Link>
            <Link to="/" className="edit-pdf-landing-all-tools">‹ All Tools</Link>
          </div>
          <div className="edit-pdf-landing-tabs" role="tablist" aria-label="Editor sidebar">
            <button
              type="button"
              role="tab"
              aria-selected={landingTab === 'pages'}
              className={landingTab === 'pages' ? 'active' : ''}
              onClick={() => setLandingTab('pages')}
            >
              Pages
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={landingTab === 'layers'}
              className={landingTab === 'layers' ? 'active' : ''}
              onClick={() => setLandingTab('layers')}
            >
              Layers
            </button>
          </div>
          <div className="edit-pdf-landing-sidebar-body" role="tabpanel" aria-label={landingTab} />
        </aside>
      )}
    </div>
  )
}

const toolComponents = {
  'edit': EditPdfIframe,
  'merge': MergeTool,
  'split': SplitTool,
  'reorder': ReorderTool,
  'compress': CompressIframeWrapper,
  'rotate': RotateTool,
  'page-numbers': PageNumberTool,
  'watermark': WatermarkTool,
  'redact': RedactTool,
  'crop': CropTool,
  'encrypt': EncryptTool,
  'decrypt': DecryptTool,
  'sign': SignTool,
  'image-to-pdf': ImageToPdfTool,
  'pdf-to-image': PdfToImageTool,
  'pdf-to-word': PdfToWordTool,
  'pdf-to-text': PdfToTextTool,
  'word-to-pdf': WordToPdfTool,
  'excel-to-pdf': ExcelToPdfTool,
  'html-to-pdf': HtmlToPdfTool,
  'batch': BatchTool,
  'wcag': WcagTool,
}

const wideLayoutTools = new Set(['watermark', 'crop', 'redact', 'sign', 'batch', 'word-to-pdf', 'excel-to-pdf', 'pdf-to-word'])

export default function ToolPage({ forcedToolId }) {
  const params = useParams()
  const toolId = forcedToolId || params.toolId
  const tool = getToolById(toolId)

  if (tool?.redirectTo && toolId === 'draw') {
    return <Navigate to={`/tool/${tool.redirectTo}`} replace />
  }

  const ToolComponent = toolComponents[toolId]

  if (!tool || !ToolComponent) {
    return (
      <div className="tool-page">
        <div className="container" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-4)' }}>
            Tool not found
          </h1>
          <Link to="/" className="btn btn-primary">
            <ArrowLeft size={18} />
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

  const Icon = tool.icon
  const canonicalPath = tool.canonicalPath || `/tool/${tool.id}`
  const seo = getToolSeo(toolId, tool)
  const title = `${seo.h1} | PDFOmni`
  const description = `${seo.intro} 100% client-side PDF workflow with no server upload.`
  const faqSchema = {
    '@type': 'FAQPage',
    mainEntity: seo.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
  const howToSchema = {
    '@type': 'HowTo',
    name: seo.h1,
    description: seo.intro,
    step: seo.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      text: step,
    })),
  }

  const seoMetadata = (
    <Seo
      title={title}
      description={description}
      canonicalPath={canonicalPath}
      structuredData={{
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'SoftwareApplication',
            name: `PDFOmni ${tool.name}`,
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web Browser',
            description,
            url: `https://pdfomni.com${canonicalPath}`,
          },
          howToSchema,
          faqSchema,
        ],
      }}
    />
  )

  if (toolId === 'edit') {
    return (
      <div className="tool-page edit-pdf-page" id="tool-page-edit">
        {seoMetadata}
        <ToolComponent toolId={toolId} tool={tool} />
        <div className="edit-pdf-seo-flow">
          <ToolSeoSection tool={tool} seo={seo} headingLevel={1} />
        </div>
      </div>
    )
  }

  return (
    <div className="tool-page" id={`tool-page-${toolId}`}>
      {seoMetadata}
      <div className={wideLayoutTools.has(toolId) ? 'container-wide' : 'container'}>
        <Link to="/" className="btn btn-ghost" style={{ marginBottom: 'var(--space-6)' }}>
          <ArrowLeft size={18} />
          All Tools
        </Link>
        
        <div className="tool-page-header">
          <div style={{ 
            display: 'inline-flex', 
            padding: 'var(--space-3)', 
            borderRadius: 'var(--radius-lg)',
            background: `${tool.color}15`,
            color: tool.color,
            marginBottom: 'var(--space-4)',
          }}>
            <Icon size={32} />
          </div>
          <h1 className={`tool-page-title ${tool.tooltip ? 'tooltip' : ''}`} data-tooltip={tool.tooltip || undefined}>
            {seo.h1}
          </h1>
          <p className="tool-page-desc">{tool.description}</p>
        </div>

        <div className={`tool-page-content ${wideLayoutTools.has(toolId) ? 'tool-page-content-wide' : ''}`}>
          <ToolComponent toolId={toolId} tool={tool} />
        </div>

        <ToolSeoSection tool={tool} seo={seo} />
      </div>
    </div>
  )
}
