import { Link } from 'react-router-dom'
import Seo from '../components/Common/Seo'

export default function TermsOfService() {
  return (
    <div className="tool-page" id="terms-page">
      <Seo
        title="Terms of Service | PDFOmni"
        description="Read the terms for using PDFOmni, including lawful use, document responsibility, local processing, third-party services, exports, and service availability."
        canonicalPath="/terms"
      />
      <div className="container">
        <div className="tool-page-header">
          <h1 className="tool-page-title">Terms of Service</h1>
          <p className="tool-page-desc">Last updated July 22, 2026. By using PDFOmni, you agree to use the site lawfully and review important document output before relying on it.</p>
        </div>
        <div className="card legal-card">
          <h2>Using PDFOmni</h2>
          <p>
            PDFOmni provides browser-based tools for editing, organizing, converting, protecting, checking, and preparing documents. You may use the site only for files you own or are allowed to process. You are responsible for following laws, contracts, school rules, workplace policies, and submission requirements that apply to the document.
          </p>

          <h2>Unacceptable Use</h2>
          <p>
            Do not use PDFOmni for fraud, harassment, illegal distribution, copyright infringement, unauthorized access, removal of protection from files you do not have permission to open, or any attempt to harm the site or other people. Do not interfere with the service, bypass technical limits, distribute malicious files, or use automated traffic in a way that prevents normal use.
          </p>

          <h2>Your Documents and Ownership</h2>
          <p>
            You keep responsibility for the documents and content you process. PDFOmni does not claim ownership of a file because you opened it in a local tool. You must make sure that adding a signature, removing a page, changing text, or sharing an output does not violate someone else's rights or misrepresent an official record.
          </p>
          <p>
            Local processing does not grant PDFOmni a license to publish, sell, train on, or distribute the contents of a document. You still need the rights and permissions required for the work you perform. If a document belongs to a school, employer, client, government office, or another person, their handling rules can limit which device, browser, storage location, or tool may be used.
          </p>

          <h2>Keeping Backups and Working Copies</h2>
          <p>
            Keep the untouched source until the final result has been accepted. Save changes under a new filename and avoid overwriting the only copy. A browser crash, device problem, incorrect setting, or unusual PDF structure can produce an incomplete result. PDFOmni is not a storage service and should not be treated as the only place where an important document exists.
          </p>
          <p>
            Clear version names are part of responsible use. Names such as report-original, report-review, and report-submitted make it easier to identify the copy that was actually checked. Users working in a group should agree on who prepares the final file so two different versions are not shared as if both were current.
          </p>

          <h2>Local Processing and Device Requirements</h2>
          <p>
            Supported operations are designed to run on your device, but performance depends on the browser, available memory, processor, file size, page count, fonts, images, and document structure. The 500 MB per-file limit is an upper boundary for tool selection, not a guarantee that every file will process successfully on every device. Keep backups and close other demanding apps when working with a large document.
          </p>

          <h2>Reviewing Exported Files</h2>
          <p>
            PDFs can contain complex fonts, forms, scans, links, annotations, signatures, permissions, and images. Always open the downloaded output and check its page count, layout, readability, and required content. Redactions should be tested for recoverable information. Compressed documents should be checked at a useful zoom. Accessibility checks should be followed by manual review. PDFOmni is a tool, and the user remains responsible for deciding whether the final file is suitable for submission, publication, or sharing.
          </p>
          <p>
            A progress message or successful download only confirms that the browser completed a process and created a file. It does not confirm that an outside portal will accept the result or that every important detail survived. Compare the output with the source, test it in the program the recipient uses when possible, and follow any stated page size, file size, naming, signature, accessibility, or security rules.
          </p>

          <h2>Signatures and Security Features</h2>
          <p>
            A visual signature placed by the Sign PDF tool is not necessarily a certificate-based digital signature and may not meet every legal or organizational requirement. Password protection and permission settings reduce access but do not guarantee control after an authorized person opens the document. Use the signing, encryption, and transfer method required for the specific transaction.
          </p>

          <h2>Third-Party Services</h2>
          <p>
            The website may rely on hosting, analytics, advertising, AI, fonts, libraries, or other third-party services. Their availability and terms can affect related features. Optional AI features may send a message and selected context to an AI provider after you choose to ask a question. Review the <Link to="/privacy">Privacy Policy</Link> for more detail about these boundaries.
          </p>
          <p>
            Links to another website are provided for navigation or reference and do not make PDFOmni responsible for that site's content, availability, security, or privacy practices. Users should review the destination before uploading a document, entering personal information, or depending on an outside service for an important task.
          </p>

          <h2>No Professional Advice</h2>
          <p>
            Guides and tool explanations are general educational information. They are not legal, tax, medical, security, or accessibility certification advice. Requirements can vary by country, organization, document type, and intended audience. Ask a qualified professional when a mistake could have serious consequences.
          </p>

          <h2>Availability and Changes</h2>
          <p>
            PDFOmni can change, add, remove, or temporarily disable features. Browser updates and third-party libraries can also affect behavior. The project aims to keep tools available and useful, but uninterrupted operation is not promised. If a workflow matters, keep the source files and do not depend on the site as the only storage location for a document.
          </p>
          <p>
            Features can be updated to improve privacy, security, compatibility, accessibility, or document quality. An older guide or screenshot may not match every later control. The current interface and these terms apply to present use. Material changes to document handling should also be reflected in the privacy information so users can understand the boundary before choosing a file.
          </p>

          <h2>Feedback and Suggestions</h2>
          <p>
            Users may send bug reports and feature ideas. A suggestion does not create an employment, partnership, payment, confidentiality, or ownership agreement. PDFOmni may use general feedback to improve the site, while the sender keeps rights to original material they own. Do not include private documents, trade secrets, or information that cannot safely be used for testing.
          </p>

          <h2>Enforcement</h2>
          <p>
            Access can be limited when use harms the service, violates these terms, creates security risk, or prevents other people from using the site normally. Technical limits and protective measures must not be bypassed. If a user believes access was restricted by mistake, they can contact PDFOmni with the relevant page, date, browser, and a description of what happened.
          </p>

          <h2>Disclaimer and Limitation</h2>
          <p>
            PDFOmni is provided as available without a promise that every output will be error-free or fit a particular purpose. To the extent allowed by applicable law, PDFOmni and its maintainer are not responsible for indirect loss caused by missing backups, an unreviewed export, use without permission, a forgotten password, a failed submission, or reliance on general guide content. Nothing in these terms removes rights that cannot legally be excluded.
          </p>

          <h2>Changes to These Terms</h2>
          <p>
            These terms may be updated as the project changes. The date at the top shows the latest revision. Continued use after an update means the current terms apply to later use. If you do not agree with them, stop using the site.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent through the <Link to="/contact">contact page</Link> or directly to <a href="mailto:pdfomni@gmail.com">pdfomni@gmail.com</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
