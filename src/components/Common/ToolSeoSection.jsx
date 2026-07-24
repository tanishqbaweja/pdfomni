import { Link } from 'react-router-dom'

export default function ToolSeoSection({ tool, seo, headingLevel = 2 }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const Subheading = headingLevel === 1 ? 'h2' : 'h3'

  return (
    <section className="tool-seo-section" aria-labelledby="tool-seo-heading">
      <div className="tool-seo-kicker">How this PDF tool works</div>
      <Heading id="tool-seo-heading">{seo.h1}</Heading>
      <p className="tool-seo-lead">{seo.intro}</p>

      <div className="tool-seo-grid tool-seo-steps" aria-label={`How to use ${tool.name}`}>
        {seo.steps.map((step, index) => (
          <div className="tool-seo-item" key={step}>
            <span className="tool-seo-step">{index + 1}</span>
            <p>{step}</p>
          </div>
        ))}
      </div>

      <div className="tool-seo-copy">
        <div>
          <Subheading className="tool-seo-subheading">When This Tool Is Useful</Subheading>
          <p>{seo.why}</p>
          <p>
            You do not need to create an account before starting. Choose the source file, make the change, and download a new copy. Keep the original until you have opened the export and checked that every important page still looks and works the way you expect.
          </p>
        </div>
        <div>
          <Subheading className="tool-seo-subheading">What Happens to Your File</Subheading>
          <p>
            The supported document work happens in the browser. Your device reads the file and prepares the output, so PDFOmni does not need to send the source to a document-processing server. Normal website resources, analytics, ads, and optional online features can still make internet requests, as explained in the <Link to="/privacy">Privacy Policy</Link>.
          </p>
          <p>
            Local processing also means that speed depends on the device. A short text PDF can finish quickly, while a large scan with high-resolution images may use much more memory. The 500 MB per-file limit is an upper boundary, and complicated files can still take longer on an older phone or laptop.
          </p>
        </div>
      </div>

      <div className="tool-seo-use-cases">
        <Subheading className="tool-seo-subheading">Common Use Cases</Subheading>
        <ul>
          {seo.useCases.map((useCase) => <li key={useCase}>{useCase}</li>)}
        </ul>
      </div>

      <div className="tool-seo-copy tool-seo-expanded">
        <div>
          <Subheading className="tool-seo-subheading">Before You Start</Subheading>
          {seo.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
        <div>
          <Subheading className="tool-seo-subheading">Tips for a Reliable Export</Subheading>
          <p>{seo.advanced}</p>
          <p>
            Save the result with a name that separates it from the source. Reopen the downloaded file, compare the page count, and inspect the parts that changed. If the PDF is being submitted for school, work, taxes, or an official form, compare it with the receiving instructions before uploading it.
          </p>
          <p>
            PDFs can store text, images, forms, annotations, fonts, and security settings in very different ways. A preview is helpful, but it cannot replace a final check of the downloaded file. Use another PDF reader for an important document when you want an extra compatibility check.
          </p>
          <p>
            Check the page count and move through the full document. Pay extra attention to small text, page boundaries, forms, links, signatures, unusual fonts, and pages made from scans. A successful download only confirms that a file was created. It does not confirm that the result meets the rules of the person or service receiving it.
          </p>
          <p>
            Keep the original and final copies until the work is accepted. If a setting did not produce the right result, return to the source rather than repeatedly processing an already compressed or converted output. Clear filenames make it easier to tell which version was reviewed and which version was actually submitted.
          </p>
        </div>
      </div>

      {seo.searchLanguage?.length > 0 && (
        <div className="tool-seo-copy tool-seo-search-language">
          <div>
            <Subheading className="tool-seo-subheading">Understanding PDF to Word Search Terms</Subheading>
            {seo.searchLanguage.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </div>
      )}

      <div className="tool-seo-copy">
        <div>
          <Subheading className="tool-seo-subheading">Choose the Right Source File</Subheading>
          <p>
            Start from the clearest and most complete copy you have. Repeatedly converting or compressing an already processed PDF can lower image quality and make text harder to edit or extract. If the original came from Word, Excel, or another authoring program, keep that source because it is usually the easiest place to make large content changes.
          </p>
        </div>
        <div>
          <Subheading className="tool-seo-subheading">Keep Your Versions Clear</Subheading>
          <p>
            Use names that explain the document status, such as report-original.pdf, report-review.pdf, and report-submitted.pdf. Avoid overwriting the only copy or filling a folder with names like final2 and final-new. A clear name makes it easier to reopen the exact output you checked and prevents an older version from being sent by mistake.
          </p>
        </div>
      </div>

      <nav className="tool-seo-related" aria-labelledby="tool-related-heading">
        <Subheading className="tool-seo-subheading" id="tool-related-heading">Useful Next Steps</Subheading>
        <p>Continue only when the document needs another change. Each link opens a focused PDFOmni tool or guide.</p>
        <div>
          {seo.related.map((item) => <Link key={item.href} to={item.href}>{item.label}</Link>)}
        </div>
      </nav>

      <div className="tool-seo-faq">
        <Subheading className="tool-seo-subheading">Frequently Asked Questions</Subheading>
        {seo.faqs.map((faq) => (
          <details key={faq.question}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
