import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Zap, Shield, Cpu, Sparkles, Search } from 'lucide-react'
import { toolCategories, getToolsByCategory } from '../config/tools'
import Seo from '../components/Common/Seo'

const featureItems = [
  { icon: Shield, text: 'No Upload', desc: 'Files stay local' },
  { icon: Zap, text: 'Instant', desc: 'WebAssembly speed' },
  { icon: Cpu, text: 'AI Powered', desc: 'Smart copilot' },
]

function ToolCard({ tool }) {
  const Icon = tool.icon
  return (
    <Link
      to={tool.canonicalPath || `/tool/${tool.id}`}
      style={{ textDecoration: 'none' }}
      id={`tool-card-${tool.id}`}
      aria-label={`${tool.name}: ${tool.description}`}
    >
      <div
        className="tool-card tooltip"
        data-tooltip={tool.tooltip || tool.description}
        style={{ '--tool-accent-color': tool.color }}
      >
        <div
          className="tool-card-icon"
          style={{
            color: tool.color,
            background: `${tool.color}15`,
          }}
        >
          <Icon size={24} />
        </div>
        <div className="tool-card-title">{tool.name}</div>
        <div className="tool-card-desc">{tool.description}</div>
      </div>
    </Link>
  )
}

function ToolSections({ selectedCategory, searchQuery }) {
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleCategories = selectedCategory === 'all'
    ? toolCategories
    : toolCategories.filter((category) => category.id === selectedCategory)

  const searchMatches = useMemo(() => {
    if (!normalizedQuery) return []
    return toolCategories
      .flatMap((category) => getToolsByCategory(category.id))
      .filter((tool) => !tool.hiddenOnHome)
      .filter((tool) => {
        const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
        const categoryMatches = selectedCategory === 'all' || tool.category === selectedCategory
        return categoryMatches && haystack.includes(normalizedQuery)
      })
  }, [normalizedQuery, selectedCategory])

  if (normalizedQuery) {
    return (
      <div className="home-tool-section">
        <div className="section-header">
          <h2 className="section-label">Search Results</h2>
          <div className="section-line" />
        </div>
        {searchMatches.length > 0 ? (
          <div className="tool-grid">
            {searchMatches.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        ) : (
          <div className="home-tools-empty">No tools match your search.</div>
        )}
      </div>
    )
  }

  return (
    <>
      {visibleCategories.map((category) => {
        const categoryTools = getToolsByCategory(category.id).filter((tool) => !tool.hiddenOnHome)
        if (categoryTools.length === 0) return null

        return (
          <div key={category.id} className="home-tool-section">
            <div className="section-header">
              <h2 className="section-label">{category.label}</h2>
              <div className="section-line" />
            </div>

            <div className="tool-grid">
              {categoryTools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
            </div>
          </div>
        )
      })}
    </>
  )
}

export default function Home() {
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="bg-grid">
      <Seo
        title="PDFOmni | 100% Private PDF Tools"
        description="One of the best privacy-focused PDF toolkits for local editing, merging, compression, conversion, and true browser-based PDF processing."
        canonicalPath="/"
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'PDFOmni',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web Browser',
          description: 'Private client-side PDF toolkit with no server uploads.',
          url: 'https://pdfomni.com/',
        }}
      />

      <section className="hero home-hero bg-radial-glow" id="hero">
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div>
            <div className="badge badge-accent home-hero-badge">
              <Sparkles size={14} aria-hidden="true" />
              100% Client-Side &bull; Zero-Knowledge Architecture
            </div>
          </div>

          <h1 className="hero-title">
            Every PDF tool you need, <span className="hero-title-gradient">completely private</span>
          </h1>

          <p className="hero-subtitle">
            Merge, split, compress, convert, edit, and sign PDFs - all processing happens in your browser. Your files never leave your device.
          </p>
        </div>
      </section>

      <div className="home-main">
        <section className="container home-tools" id="tools">
          <div className="home-tool-controls" aria-label="Tool filters">
            <div className="home-category-tabs" role="group" aria-label="Filter tools by category">
              <button
                className={`home-category-tab ${selectedCategory === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('all')}
                type="button"
                aria-pressed={selectedCategory === 'all'}
              >
                All Tools
              </button>
              {toolCategories.map((category) => (
                <button
                  key={category.id}
                  className={`home-category-tab ${selectedCategory === category.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(category.id)}
                  type="button"
                  aria-pressed={selectedCategory === category.id}
                >
                  {category.label}
                </button>
              ))}
            </div>

            <label className="home-tool-search">
              <Search size={18} aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search tools..."
                aria-label="Search PDF tools"
              />
            </label>
          </div>

          <ToolSections selectedCategory={selectedCategory} searchQuery={searchQuery} />
        </section>

        <section className="container home-feature-strip" aria-label="PDFOmni benefits">
          {featureItems.map(({ icon: Icon, text, desc }) => (
            <div className="home-feature-item" key={text}>
              <div className="home-feature-icon">
                <Icon size={18} />
              </div>
              <div>
                <div className="home-feature-title">{text}</div>
                <div className="home-feature-desc">{desc}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="container" style={{ marginBottom: 'var(--space-16)' }} id="how-it-works">
          <div className="card" style={{ display: 'grid', gap: 'var(--space-6)' }}>
            <div>
              <span className="section-label">How It Works</span>
              <h2 style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
                Private PDF tools that run inside your browser
              </h2>
            </div>
            <div className="seo-grid">
              <div>
                <h3>1. Load files locally</h3>
                <p>PDFOmni opens your files in the browser and processes them with JavaScript, WebAssembly, and browser APIs instead of sending them to a remote server.</p>
              </div>
              <div>
                <h3>2. Process on your device</h3>
                <p>Merge, split, compress, edit, watermark, and convert PDFs directly on your machine. That makes PDFOmni ideal for secure document work and low-friction private workflows.</p>
              </div>
              <div>
                <h3>3. Export private results</h3>
                <p>You download the final files from your own session. The main PDF workflows are built for people who want private document handling without a cloud upload step.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="container" style={{ marginBottom: 'var(--space-10)' }}>
          <div className="card" style={{ display: 'grid', gap: 'var(--space-6)' }}>
            <div>
              <span className="section-label">Why People Use PDFOmni</span>
              <h2 style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2)' }}>
                Useful PDF tools with a clear privacy model
              </h2>
            </div>
            <div className="seo-grid">
              <div>
                <h3>Files stay on your device</h3>
                <p>PDFOmni keeps supported document processing in the browser. You can finish common PDF jobs without sending the source file to a separate processing server.</p>
              </div>
              <div>
                <h3>Edit more than a screenshot</h3>
                <p>The editor can work with PDF text streams, embedded font data, images, and selectable content. Complicated PDFs still need a careful export check because files can store these objects in very different ways.</p>
              </div>
              <div>
                <h3>One place for the next step</h3>
                <p>After one task, you can move into compression, conversion, signing, security, or a saved workflow. Use only the steps the document actually needs.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="container home-featured-on" aria-labelledby="featured-on-title">
          <div className="home-featured-heading">
            <span className="section-label" id="featured-on-title">Featured On</span>
            <div className="section-line" />
          </div>
          <div className="home-featured-badges">
            <a
              className="home-featured-badge"
              href="https://www.producthunt.com/products/pdfomni?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-pdfomni"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="home-featured-image home-featured-image-light"
                alt="PDFOmni - 100% private, client-side PDF toolkit and AI copilot on Product Hunt"
                width="250"
                height="54"
                loading="lazy"
                decoding="async"
                src="/producthunt-featured-light.svg"
              />
              <img
                className="home-featured-image home-featured-image-dark"
                alt="PDFOmni - 100% private, client-side PDF toolkit and AI copilot on Product Hunt"
                width="250"
                height="54"
                loading="lazy"
                decoding="async"
                src="/producthunt-featured-dark.svg"
              />
            </a>

            <a
              className="home-featured-badge"
              href="https://www.foundrlist.com/product/pdfomni?utm_source=badge&amp;utm_medium=embed"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="home-featured-image home-featured-image-adaptive"
                src="https://www.foundrlist.com/api/badge/pdfomni"
                alt="Featured on FoundrList"
                width="150"
                height="48"
                loading="lazy"
                decoding="async"
              />
            </a>

            <a
              className="home-featured-badge"
              href="https://www.uneed.best/tool/pdfomni"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="home-featured-image home-featured-image-light"
                src="https://www.uneed.best/EMBED3.png"
                alt="Launching Soon on Uneed"
                width="250"
                loading="lazy"
                decoding="async"
              />
              <img
                className="home-featured-image home-featured-image-dark"
                src="https://www.uneed.best/EMBED3B.png"
                alt="Launching Soon on Uneed"
                width="250"
                loading="lazy"
                decoding="async"
              />
            </a>

            <a
              className="home-featured-badge"
              href="https://startupfa.me/s/pdfomni?utm_source=pdfomni.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="home-featured-image home-featured-image-adaptive"
                src="https://startupfa.me/badges/featured-badge.webp"
                alt="PDFOmni - Featured on Startup Fame"
                width="171"
                height="54"
                loading="lazy"
                decoding="async"
              />
            </a>

            <a
              className="home-featured-badge"
              href="https://twelve.tools"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="home-featured-image home-featured-image-light"
                src="https://twelve.tools/badge1-light.svg"
                alt="Featured on Twelve Tools"
                width="200"
                height="54"
                loading="lazy"
                decoding="async"
              />
              <img
                className="home-featured-image home-featured-image-dark"
                src="https://twelve.tools/badge1-dark.svg"
                alt="Featured on Twelve Tools"
                width="200"
                height="54"
                loading="lazy"
                decoding="async"
              />
            </a>

            <a
              className="home-featured-badge"
              href="https://wired.business"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                className="home-featured-image home-featured-image-light"
                src="https://wired.business/badge2-light.svg"
                alt="Featured on Wired Business"
                width="200"
                height="54"
                loading="lazy"
                decoding="async"
              />
              <img
                className="home-featured-image home-featured-image-dark"
                src="https://wired.business/badge2-dark.svg"
                alt="Featured on Wired Business"
                width="200"
                height="54"
                loading="lazy"
                decoding="async"
              />
            </a>
          </div>
        </section>

      </div>
    </div>
  )
}
