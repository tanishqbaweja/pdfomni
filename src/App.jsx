import { lazy, Suspense, useEffect, useRef } from 'react'
import { Navigate, Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import ToolUploadPlaceholder from './components/Common/ToolUploadPlaceholder'

const ToolPage = lazy(() => import('./pages/ToolPage'))
const WorkflowPage = lazy(() => import('./pages/WorkflowPage'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const TermsOfService = lazy(() => import('./pages/TermsOfService'))
const ContactPage = lazy(() => import('./pages/ContactPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const GuidesPage = lazy(() => import('./pages/GuidesPage'))
const GuidePage = lazy(() => import('./pages/GuidePage'))
const ErrorPage = lazy(() => import('./pages/ErrorPage'))
const TOOL_PAGE_PATHS = new Set([
  '/merge', '/split', '/reorder', '/compress', '/rotate', '/page-numbers',
  '/word-to-pdf', '/excel-to-pdf', '/image-to-pdf', '/html-to-pdf',
  '/pdf-to-image', '/pdf-to-word', '/pdf-to-text', '/edit-pdf', '/watermark',
  '/redact', '/crop', '/protect', '/unlock', '/sign', '/batch', '/wcag-check',
])

function RouteLoader({ isToolRoute = false }) {
  if (isToolRoute) {
    return (
      <div className="tool-route-placeholder">
        <div className="container">
          <ToolUploadPlaceholder />
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
      <div className="spinner" aria-label="Loading page" />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const hasTrackedInitialPage = useRef(false)
  const isToolRoute = TOOL_PAGE_PATHS.has(location.pathname) || location.pathname.startsWith('/tool/')

  useEffect(() => {
    if (!hasTrackedInitialPage.current) {
      hasTrackedInitialPage.current = true
      return
    }

    const pagePath = `${location.pathname}${location.search}`
    const timer = window.setTimeout(() => {
      if (typeof window.gtag === 'function') {
        window.gtag('config', 'G-TSWLYFYBM8', {
          page_path: pagePath,
          page_title: document.title,
        })
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [location.pathname, location.search])

  useEffect(() => {
    const shouldFocusToolHeader = TOOL_PAGE_PATHS.has(location.pathname) || location.pathname.startsWith('/tool/')

    if (!shouldFocusToolHeader || ['/tool/edit', '/tool/draw', '/tool/image-edit'].includes(location.pathname)) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      return undefined
    }

    const timer = window.setTimeout(() => {
      const toolPage = document.querySelector('.tool-page')
      if (!toolPage) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
        return
      }
      const headerHeight = document.getElementById('header')?.offsetHeight || 0
      window.scrollTo({
        top: Math.max(0, toolPage.getBoundingClientRect().top + window.scrollY - headerHeight - 16),
        left: 0,
        behavior: 'auto',
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [location.pathname])

  return (
    <Layout>
      <Suspense fallback={<RouteLoader isToolRoute={isToolRoute} />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tool/edit" element={<Navigate to="/edit-pdf" replace />} />
          <Route path="/tool/draw" element={<Navigate to="/edit-pdf" replace />} />
          <Route path="/tool/image-edit" element={<Navigate to="/edit-pdf" replace />} />
          <Route path="/tool/:toolId" element={<ToolPage />} />
          <Route path="/merge" element={<ToolPage forcedToolId="merge" />} />
          <Route path="/split" element={<ToolPage forcedToolId="split" />} />
          <Route path="/reorder" element={<ToolPage forcedToolId="reorder" />} />
          <Route path="/compress" element={<ToolPage forcedToolId="compress" />} />
          <Route path="/rotate" element={<ToolPage forcedToolId="rotate" />} />
          <Route path="/page-numbers" element={<ToolPage forcedToolId="page-numbers" />} />
          <Route path="/word-to-pdf" element={<ToolPage forcedToolId="word-to-pdf" />} />
          <Route path="/excel-to-pdf" element={<ToolPage forcedToolId="excel-to-pdf" />} />
          <Route path="/image-to-pdf" element={<ToolPage forcedToolId="image-to-pdf" />} />
          <Route path="/html-to-pdf" element={<ToolPage forcedToolId="html-to-pdf" />} />
          <Route path="/pdf-to-image" element={<ToolPage forcedToolId="pdf-to-image" />} />
          <Route path="/pdf-to-word" element={<ToolPage forcedToolId="pdf-to-word" />} />
          <Route path="/pdf-to-text" element={<ToolPage forcedToolId="pdf-to-text" />} />
          <Route path="/edit-pdf" element={<ToolPage forcedToolId="edit" />} />
          <Route path="/watermark" element={<ToolPage forcedToolId="watermark" />} />
          <Route path="/redact" element={<ToolPage forcedToolId="redact" />} />
          <Route path="/crop" element={<ToolPage forcedToolId="crop" />} />
          <Route path="/protect" element={<ToolPage forcedToolId="encrypt" />} />
          <Route path="/unlock" element={<ToolPage forcedToolId="decrypt" />} />
          <Route path="/sign" element={<ToolPage forcedToolId="sign" />} />
          <Route path="/batch" element={<ToolPage forcedToolId="batch" />} />
          <Route path="/wcag-check" element={<ToolPage forcedToolId="wcag" />} />
          <Route path="/workflow" element={<WorkflowPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/guides" element={<GuidesPage />} />
          <Route path="/guides/:guideSlug" element={<GuidePage />} />
          <Route path="/500" element={<ErrorPage status={500} />} />
          <Route path="*" element={<ErrorPage status={404} />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
