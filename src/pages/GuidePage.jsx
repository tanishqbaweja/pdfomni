import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Seo from '../components/Common/Seo'
import { getGuide } from '../config/guides'

function GuideParagraph({ children }) {
  return <p dangerouslySetInnerHTML={{ __html: children }} />
}

export default function GuidePage() {
  const { guideSlug } = useParams()
  const guide = getGuide(guideSlug)

  if (!guide) return <Navigate to="/guides" replace />

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.published,
    author: { '@type': 'Organization', name: 'PDFOmni' },
    publisher: { '@type': 'Organization', name: 'PDFOmni' },
    mainEntityOfPage: `https://pdfomni.com/guides/${guide.slug}`,
  }

  return (
    <div className="tool-page guide-page">
      <Seo
        title={`${guide.title} | PDFOmni`}
        description={guide.description}
        canonicalPath={`/guides/${guide.slug}`}
        structuredData={articleSchema}
      />
      <article className="container guide-container">
        <header className="guide-article-header">
          <Link className="btn btn-ghost guide-nav-back" to="/guides">
            <ArrowLeft size={18} />
            Back to Guides
          </Link>
          <h1>{guide.title}</h1>
          {guide.richIntro
            ? <div className="guide-article-intro"><GuideParagraph>{guide.intro}</GuideParagraph></div>
            : <p className="guide-article-intro">{guide.intro}</p>}
          <div className="guide-article-meta">
            <time dateTime={guide.published}>
              Updated {new Date(`${guide.published}T00:00:00`).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </time>
            <span>{guide.readTime}</span>
          </div>
        </header>

        <div className="guide-article-body">
          {guide.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <GuideParagraph key={paragraph}>{paragraph}</GuideParagraph>
              ))}
            </section>
          ))}

          <aside className="guide-related" aria-labelledby="guide-related-title">
            <h2 id="guide-related-title">Related PDFOmni pages</h2>
            <div>
              {guide.related.map((item) => (
                <Link key={item.href} to={item.href}>{item.label}</Link>
              ))}
            </div>
          </aside>
        </div>
      </article>
    </div>
  )
}
