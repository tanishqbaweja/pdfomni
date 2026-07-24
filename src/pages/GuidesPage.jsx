import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Seo from '../components/Common/Seo'
import { guideIndex } from '../generated/guideIndex'

function warmGuide(slug) {
  import('../generated/guideLoaders').then(({ loadGuide }) => loadGuide(slug))
}

export default function GuidesPage() {
  const toolGuides = guideIndex.filter((guide) => guide.toolId)
  const documentGuides = guideIndex.filter((guide) => !guide.toolId)

  const guideCards = (items) => (
    <div className="guide-card-grid">
      {items.map((guide) => (
        <article
          className="guide-card"
          key={guide.slug}
          onPointerEnter={() => warmGuide(guide.slug)}
          onFocus={() => warmGuide(guide.slug)}
        >
          <div className="guide-card-meta">{guide.readTime}</div>
          <h2><Link to={`/guides/${guide.slug}`}>{guide.title}</Link></h2>
          <p>{guide.description}</p>
          <Link className="guide-card-link" to={`/guides/${guide.slug}`}>Read the guide</Link>
        </article>
      ))}
    </div>
  )

  return (
    <div className="tool-page guides-page">
      <Seo
        title="PDF Guides for Privacy, Accessibility, and Better Workflows | PDFOmni"
        description="Read practical PDF guides about document privacy, accessibility, scanning, redaction, compression, security, and everyday file organization."
        canonicalPath="/guides"
      />
      <div className="container guide-container">
        <Link className="btn btn-ghost guide-nav-back" to="/">
          <ArrowLeft size={18} />
          All Tools
        </Link>
        <header className="guide-index-header">
          <div className="tool-seo-kicker">PDFOmni Guides</div>
          <h1>Practical Guides for Better PDF Work</h1>
          <p>
            These guides explain the parts of document work that a tool button cannot decide for you. They cover privacy, accessibility, scan quality, safe sharing, and ways to avoid common mistakes before a PDF is sent to someone else.
          </p>
        </header>

        <section className="guide-index-section" aria-labelledby="tool-guides-title">
          <h2 id="tool-guides-title">Tool Guides</h2>
          <p>There is one detailed guide for every PDFOmni tool, with links to related tools when a document needs another step.</p>
          {guideCards(toolGuides)}
        </section>

        <section className="guide-index-section" aria-labelledby="document-guides-title">
          <h2 id="document-guides-title">Document Guides</h2>
          <p>These guides cover privacy, accessibility, sharing, scans, and document habits that apply across several tools.</p>
          {guideCards(documentGuides)}
        </section>
      </div>
    </div>
  )
}
