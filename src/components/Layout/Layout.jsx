import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import ToastContainer from '../Common/ToastContainer'
import { useAppStore } from '../../store/appStore'

const ChatSidebar = lazy(() => import('../AI/ChatSidebar'))

export default function Layout({ children }) {
  const location = useLocation()
  const chatOpen = useAppStore((state) => state.chatOpen)
  const isEditPdfPage = location.pathname === '/edit-pdf'
  const chat = chatOpen ? (
    <Suspense fallback={null}>
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
