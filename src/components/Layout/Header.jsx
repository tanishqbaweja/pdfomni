import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Moon, Shield, MessageCircle, Sun, Workflow } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

export default function Header() {
  const { toggleChat, chatOpen } = useAppStore()
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('pdfomni_theme') || 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('pdfomni_theme', theme)
    } catch {
      // Ignore private browsing storage failures.
    }
    document.querySelectorAll('iframe').forEach((frame) => {
      frame.contentWindow?.postMessage({ type: 'pdfomni-theme', theme }, window.location.origin)
    })
  }, [theme])

  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <header className="header" id="header">
      <Link to="/" className="header-logo" aria-label="PDFOmni home">
        <svg width="32" height="32" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="logoG" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6366f1"/>
              <stop offset="50%" stopColor="#a855f7"/>
              <stop offset="100%" stopColor="#ec4899"/>
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#logoG)"/>
          <path d="M18 14h18a8 8 0 0 1 8 8v4a8 8 0 0 1-8 8H26v16h-8V14z" fill="white" opacity="0.95"/>
        </svg>
        <span className="header-logo-text">PDFOmni</span>
      </Link>
      
      <nav className="header-nav" aria-label="Primary navigation">
        <Link to="/guides" className="btn btn-ghost" id="nav-guides" aria-label="PDF guides">
          <BookOpen size={18} aria-hidden="true" />
          <span>Guides</span>
        </Link>
        <Link to="/workflow" className="btn btn-ghost" id="nav-workflow" aria-label="Workflow builder">
          <Workflow size={18} aria-hidden="true" />
          <span>Workflow</span>
        </Link>
        <button 
          className={`btn ${chatOpen ? 'btn-primary' : 'btn-ghost'}`}
          onClick={toggleChat}
          id="nav-chat"
          aria-label={chatOpen ? 'Close AI chat' : 'Open AI chat'}
          aria-expanded={chatOpen}
          type="button"
        >
          <MessageCircle size={18} aria-hidden="true" />
          <span>AI Chat</span>
        </button>
        <button
          className="theme-toggle"
          onClick={() => setTheme(nextTheme)}
          aria-label={`Switch to ${nextTheme} mode`}
          title={`Switch to ${nextTheme} mode`}
          type="button"
        >
          {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>
        <div className="footer-privacy" aria-label="100% Private">
          <Shield size={14} aria-hidden="true" />
          <span>100% Private</span>
        </div>
      </nav>
    </header>
  )
}
