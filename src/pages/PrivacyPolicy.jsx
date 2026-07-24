import { Link } from 'react-router-dom'
import Seo from '../components/Common/Seo'

export default function PrivacyPolicy() {
  return (
    <div className="tool-page" id="privacy-page">
      <Seo
        title="Privacy Policy | PDFOmni"
        description="Read how PDFOmni handles local document processing, website data, analytics, advertising, optional AI features, storage, and privacy questions."
        canonicalPath="/privacy"
      />
      <div className="container">
        <div className="tool-page-header">
          <h1 className="tool-page-title">Privacy Policy</h1>
          <p className="tool-page-desc">Last updated July 22, 2026. This page explains what stays on your device and which normal website features can exchange data over the internet.</p>
        </div>
        <div className="card legal-card">
          <h2>Core PDF Processing</h2>
          <p>
            PDFOmni is designed so supported PDF operations run in your browser. When you choose a document for tools such as merge, split, reorder, rotate, edit, redact, protect, unlock, sign, or convert, the core processing is performed on your device. PDFOmni does not need to upload the document bytes to a PDF-processing server for those local workflows.
          </p>
          <p>
            Browser processing uses your device memory and processor. Files can remain available to the page while a tool is open, but they are not stored in a PDFOmni account. Closing or refreshing the page normally clears the in-memory working session. Downloads and files saved by your browser remain on your device until you remove them.
          </p>

          <h2>Normal Website Requests</h2>
          <p>
            Local document processing does not mean the website makes no internet requests. Your browser requests the app code, fonts, icons, and other public resources needed to display the site. Hosting and security providers can receive ordinary request information such as an IP address, browser type, requested page, approximate time, and referrer. This information is part of delivering and protecting a website and is separate from the contents of a PDF selected for a local tool.
          </p>

          <h2>Analytics</h2>
          <p>
            PDFOmni may use analytics to understand which public pages are visited, which devices and browsers need support, and whether the site has technical problems. Analytics can use cookies or similar identifiers and may receive details such as page paths, approximate location based on IP address, device type, and referral source. PDFOmni does not intentionally send the contents of locally processed documents to analytics services.
          </p>

          <h2>Advertising</h2>
          <p>
            PDFOmni may display advertising, including ads provided by Google AdSense or another advertising partner. Advertising providers can use cookies, local storage, IP addresses, and browser signals to deliver ads, measure performance, limit repeated ads, and prevent fraud. Depending on your region and choices, ads may be personalized or non-personalized. Advertising providers process data under their own privacy policies.
          </p>
          <p>
            You can manage cookies through browser settings and any consent controls shown on the site. Blocking cookies may affect ad preferences, saved theme choices, or other website features, but it does not change the basic local PDF-processing design.
          </p>

          <h2>Optional AI Features</h2>
          <p>
            AI features are separate from the ordinary PDF tools. Document reading, chunking, retrieval, and context selection are designed to happen locally when the feature supports that flow. When you choose to send a question, the message and selected context needed for an answer may be sent to the configured AI provider. Do not use an optional AI feature with information you are not permitted to share with that provider.
          </p>

          <h2>Local Storage and Saved Preferences</h2>
          <p>
            The site can use browser storage for preferences such as light or dark mode and for features that save a local workflow. This information stays in the browser unless a feature clearly says otherwise. You can clear it with your browser controls. Clearing site data can remove saved preferences or locally stored workflow settings.
          </p>

          <h2>Contact Messages</h2>
          <p>
            The <Link to="/contact">contact page</Link> prepares an email in your own email app. If you send the message, the email provider delivers the information you include to <a href="mailto:pdfomni@gmail.com">pdfomni@gmail.com</a>. Support messages may be kept long enough to answer the request, investigate a bug, and maintain a record of the conversation. Do not send private documents unless you have removed sensitive content and are comfortable sharing the sample.
          </p>

          <h2>Children's Privacy</h2>
          <p>
            PDFOmni is a general document utility and is not directed to children under the age required for independent online consent in their location. The site does not knowingly ask children to create an account or submit personal information. A parent, guardian, or school should supervise use when required.
          </p>

          <h2>Security and Limits</h2>
          <p>
            Keeping document work local reduces an unnecessary server copy, but no website or device can promise perfect security. Users should keep software updated, use trusted devices, review browser extensions, make backups, and follow the data-handling rules of their school, employer, or client. For highly sensitive or regulated files, use the approved software and transfer process required by the organization responsible for the document.
          </p>

          <h2>Changes to This Policy</h2>
          <p>
            This policy may change when features, providers, or legal requirements change. The updated date at the top will show when the page was revised. Material changes should be explained in clear language rather than hidden inside unrelated text.
          </p>

          <h2>Privacy Questions</h2>
          <p>
            Questions about this policy or PDFOmni's document handling can be sent to <a href="mailto:pdfomni@gmail.com">pdfomni@gmail.com</a>. Include enough detail to identify the page or feature, but do not include sensitive document content unless it is necessary and safe to share.
          </p>
        </div>
      </div>
    </div>
  )
}
