import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Seo from '../components/Common/Seo'
import { getGuideMetadata } from '../generated/guideIndex'
import { loadGuide } from '../generated/guideLoaders'

function GuideParagraph({ children }) {
  return <p dangerouslySetInnerHTML={{ __html: children }} />
}

export default function GuidePage() {
  const { guideSlug } = useParams()
  const guideMetadata = getGuideMetadata(guideSlug)
  const [loadedGuide, setLoadedGuide] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let active = true
    setLoadFailed(false)
    loadGuide(guideSlug)
      .then((guide) => {
        if (active) setLoadedGuide(guide)
      })
      .catch(() => {
        if (active) setLoadFailed(true)
      })
    return () => {
      active = false
    }
  }, [guideSlug])

  if (!guideMetadata || loadFailed) return <Navigate to="/guides" replace />

  const guide = loadedGuide?.slug === guideSlug ? loadedGuide : guideMetadata
  const guideIsLoading = !guide.sections

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

        {guideIsLoading ? (
          <div className="guide-article-body" role="status" aria-live="polite">
            <p>Loading the guide...</p>
          </div>
        ) : (
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
              <p>
                Use these pages when you are ready to apply the ideas from the guide to a document. Open the source in the tool that matches the next task, keep the original nearby, and review the new download before moving to another step. The links are options, not a required sequence.
              </p>
              <div>
                {guide.related.map((item) => (
                  <Link key={item.href} to={item.href}>{item.label}</Link>
                ))}
              </div>
            </aside>
          </div>
        )}
      </article>
    </div>
  )
}
