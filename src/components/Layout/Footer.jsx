import { Shield, Heart } from 'lucide-react'
import { Link } from 'react-router-dom'
import tools, { toolCategories } from '../../config/tools'

export default function Footer() {
  const footerToolSections = toolCategories
    .map((category) => ({
      ...category,
      tools: tools.filter((tool) => tool.category === category.id && tool.canonicalPath && !tool.hiddenOnHome),
    }))
    .filter((category) => category.tools.length > 0)

  return (
    <footer className="footer" id="footer">
      <div className="container">
        <div className="footer-tool-map" aria-label="PDF tool links">
          {footerToolSections.map((category) => (
            <nav key={category.id} className="footer-tool-column" aria-label={`${category.label} tools`}>
              <h3>{category.label}</h3>
              {category.tools.map((tool) => (
                <a key={tool.id} href={tool.canonicalPath}>
                  {tool.name}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <div className="footer-inner">
          <div className="footer-summary">
            <div className="footer-text">
              &copy; {new Date().getFullYear()} PDFOmni - Free PDF Toolkit
            </div>
            <div className="footer-text">
              Local PDF tools built for practical document work without an unnecessary upload step.
            </div>
            <div className="footer-links">
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/contact">Contact</Link>
              <Link to="/about">About Us</Link>
              <Link to="/guides">Guides</Link>
            </div>
          </div>
          <div className="footer-end">
            <div className="footer-privacy">
              <Shield size={14} />
              <span>Zero-Knowledge Architecture</span>
            </div>
            <span className="footer-text footer-signoff">
              Made with <Heart size={14} aria-label="love" /> by <a href="https://trebell.dev/">Trebell</a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
