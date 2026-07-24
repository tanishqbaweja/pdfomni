import { lazy, Suspense, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import ToastContainer from '../Common/ToastContainer'
import { useAppStore } from '../../store/appStore'
import { loadChatSidebar, preloadChatSidebar } from '../AI/chatLoader'

const ChatSidebar = lazy(loadChatSidebar)

function ChatSidebarFallback() {
  return (
    <aside className="sidebar chat-sidebar open chat-sidebar-fallback" aria-label="Opening AI Copilot">
      <div className="chat-sidebar-fallback-header">
        <span>AI Copilot</span>
      </div>
      <div className="chat-sidebar-fallback-body">
        <div className="spinner" aria-hidden="true" />
        <span>Opening chat...</span>
      </div>
    </aside>
  )
}

export default function Layout({ children }) {
  const location = useLocation()
  const chatOpen = useAppStore((state) => state.chatOpen)
  const isEditPdfPage = location.pathname === '/edit-pdf'

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preloadChatSidebar, { timeout: 3000 })
      return () => window.cancelIdleCallback(idleId)
    }
    const timer = window.setTimeout(preloadChatSidebar, 1200)
    return () => window.clearTimeout(timer)
  }, [])

  const chat = chatOpen ? (
    <Suspense fallback={<ChatSidebarFallback />}>
      <ChatSidebar />
    </Suspense>
  ) : null

  return (
    <>
      {!isEditPdfPage && <Header />}
      <main
        className={isEditPdfPage ? 'edit-pdf-main' : undefined}
        style={{ flex: 1, paddingTop: isEditPdfPage ? 0 : 'var(--header-height)' }}
        aria-label="PDFOmni page content"
      >
        {children}
      </main>
      <Footer />
      <ToastContainer />
      {chat}
    </>
  )
}
