import { Link } from 'react-router-dom'
import Seo from '../components/Common/Seo'

export default function AboutPage() {
  return (
    <div className="tool-page" id="about-page">
      <Seo
        title="About PDFOmni | Student-Built Private PDF Tools"
        description="Learn why PDFOmni was built, how its local browser processing works, who maintains it, and what the project is trying to improve."
        canonicalPath="/about"
      />
      <div className="container">
        <div className="tool-page-header">
          <h1 className="tool-page-title">About PDFOmni</h1>
          <p className="tool-page-desc">PDFOmni is a student-built collection of PDF tools for people who want to finish document work without sending every file to a processing server.</p>
        </div>
        <div className="card legal-card">
          <h2>Why I Started Building It</h2>
          <p>
            PDFOmni began as a college project after I kept running into the same problem. A basic PDF task would lead to an account wall, a tiny upload limit, or a site that wanted a private document before it would explain what the tool could do. None of those problems felt impossible to fix. Modern browsers can handle a lot of document work on the device, so I started building the tools I wanted to use myself.
          </p>
          <p>
            The project grew from simple page operations into editing, conversions, security tools, accessibility checks, and repeatable workflows. PDFs are much more complicated than they first appear. They can contain embedded fonts, scans, forms, annotations, unusual image formats, and years of software-specific decisions. Working through those edge cases has become the most interesting part of the project.
          </p>

          <h2>What Local Processing Means Here</h2>
          <p>
            Core PDF operations are designed to run inside the browser. When you use tools such as <Link to="/merge">Merge PDF</Link>, <Link to="/split">Split PDF</Link>, <Link to="/reorder">Reorder PDF</Link>, or <Link to="/redact">Redact PDF</Link>, the goal is for the browser to read the source and prepare the output on your device. PDFOmni does not need a document-processing server for those supported actions.
          </p>
          <p>
            The website still uses normal internet resources. The app, public assets, analytics, ads, and optional services can make web requests. An optional AI feature may send the prompt and selected context needed to answer a question. That is different from silently uploading every PDF. The <Link to="/privacy">Privacy Policy</Link> explains these boundaries because a privacy claim should be specific enough for a user to understand.
          </p>

          <h2>The Zero-Knowledge Goal</h2>
          <p>
            PDFOmni uses the phrase zero-knowledge architecture to describe a simple goal: the site should not need to receive the source document in order to complete an ordinary PDF task. This reduces the number of copies and systems involved. It does not mean a browser is magically protected from an unsafe device, a malicious extension, or every risk on the internet. Users should still keep backups, review exports, and follow school or workplace rules for sensitive files.
          </p>
          <p>
            I prefer being honest about those limits. Local processing can be fast because it skips a large upload, but it also depends on the memory and processor in the device. A large scan may work smoothly on a laptop and struggle on an older phone. The current 500 MB per-file limit is a clear upper boundary, not a promise that every complicated file will behave the same on every device.
          </p>

          <h2>How the Project Is Maintained</h2>
          <p>
            PDFOmni is maintained independently by a college student. I work on it around classes and other responsibilities, test it with real documents, and pay close attention when users report that an export, font, image, or mobile layout behaves badly. A small project does not have a huge support department, but it does have a direct line between a real problem and the code that needs to improve.
          </p>
          <p>
            The tools are free, and local actions do not have artificial daily rate limits. The project may use advertising to help cover hosting and development costs. Ads do not change the local document-processing design. If that changes for a particular feature, the feature and privacy information should say so clearly before a user depends on it.
          </p>

          <h2>What I Am Trying to Build</h2>
          <p>
            The goal is not to collect the biggest possible list of buttons. I want each tool to solve a real document job and explain enough for a person to use it safely. That includes knowing the difference between covering text and redacting it, understanding why a compressed scan can become unreadable, and checking accessibility with more than an automated score.
          </p>
          <p>
            The <Link to="/guides">PDF guides</Link> are part of that work. They cover privacy, safe sharing, OCR, accessibility, page organization, and other decisions that cannot be handled by one button. They are written for students, freelancers, families, and small teams who need practical answers without a wall of sales copy.
          </p>

          <h2>How New Features Are Chosen</h2>
          <p>
            New tools usually start with a document problem that comes up more than once. A feature is worth adding when it saves real work, can be explained clearly, and fits the local-processing model. A long list of half-finished converters would not make the site more useful. I would rather spend time on page ordering that stays correct, text editing that respects the original font, or a conversion that gives an honest result than add a button that only works on one perfect sample.
          </p>
          <p>
            Requests from users help decide what deserves attention, but they still have to be tested against different files and devices. PDFs made by Word, scanners, design programs, tax software, and old office systems can store similar-looking pages in completely different ways. A change that fixes one document can damage another if it assumes too much. That is why bug reports with clear steps are more useful than a promise to support every possible file immediately.
          </p>

          <h2>Testing Real Documents</h2>
          <p>
            Development involves more than checking whether a download button creates a file. For editing work, I compare the canvas with the exported PDF and inspect text position, spacing, images, symbols, and nearby page objects. For page tools, I check the page count, order, orientation, and whether links or forms still work. For conversions, I open the result in the program a person would actually use and compare difficult pages with the source.
          </p>
          <p>
            Accessibility and keyboard use are part of that review too. Upload controls need labels, dialogs need sensible focus, and progress or error messages should be understandable without relying only on color. Automated checks can catch missing names and broken structure, but they cannot decide whether a workflow makes sense to a person. The site still needs manual use on a small screen, with a keyboard, and with the browser accessibility tree in view.
          </p>

          <h2>Why the Guides Matter</h2>
          <p>
            A tool can perform an operation, but it cannot know why a person is changing the document. Compression settings depend on whether the file will be printed or viewed on a phone. Redaction depends on what the recipient is allowed to see. A signature image may be accepted for a class form and rejected for a legal process. The guides explain these choices so the site is not just a set of upload boxes with vague claims underneath.
          </p>
          <p>
            The writing aims to sound like a student explaining a process to another person who needs to finish the same job. It should be direct, specific, and easy to scan. Search engines are useful for helping people find a page, but repeating slightly different versions of the same phrase does not help someone understand a document. When a paragraph exists only to attract a query, it needs to be rewritten or removed.
          </p>

          <h2>Funding and Independence</h2>
          <p>
            PDFOmni is not owned by another PDF brand, and it is not a front end for a competitor's conversion service. The project may show advertising to help pay for hosting, testing, and development. Ads and normal website analytics can make their own internet requests, which is why the privacy policy describes them separately from local document processing. They do not need access to the contents of a file selected for a supported local tool.
          </p>
          <p>
            Independence also means the project has limits. There is no large customer service team or guarantee that every unusual PDF will work perfectly. The useful response to that limit is not to hide it. It is to keep originals safe, explain what the browser is doing, review exports, publish practical guides, and improve the code when a reproducible problem shows where the workflow fails.
          </p>
          <p>
            That approach keeps the project useful without pretending that one browser can remove every document risk.
          </p>

          <h2>Feedback and Contact</h2>
          <p>
            Bug reports and specific examples help a lot. When reporting a problem, include the tool, browser, device, file size, and steps that caused it. Please do not email a private document unless you have removed sensitive information and are comfortable sharing the sample. You can reach PDFOmni at <a href="mailto:pdfomni@gmail.com">pdfomni@gmail.com</a> or use the <Link to="/contact">contact page</Link> to prepare a message.
          </p>
        </div>
      </div>
    </div>
  )
}
