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

          <h2>Data Minimization</h2>
          <p>
            PDFOmni tries to collect only what is needed to operate and improve the public site. The local tools do not require a user account, profile, or document history. A selected file is used by the browser for the task the user started. The site does not need to build a library of those documents in order to merge pages, edit content, or create an export.
          </p>
          <p>
            Ordinary website logs and analytics should be used for traffic, reliability, compatibility, security, and product decisions, not to reconstruct the contents of a local document. When a technical problem can be investigated with a page path, browser type, error message, and harmless sample, private source material is not needed. Users are asked not to send sensitive files in support messages unless the information has been removed and the sample is safe to share.
          </p>

          <h2>Downloads and File Names</h2>
          <p>
            Files downloaded from a tool are handled by the browser and operating system. PDFOmni does not control how long a download remains on the device, whether it is copied into cloud-synced storage, or who else can open the downloads folder. Users should choose a safe destination, use clear but neutral filenames, and remove working copies when they are no longer needed.
          </p>
          <p>
            A filename can reveal information even when the PDF itself is protected. Avoid names that expose a diagnosis, account number, legal dispute, or other private subject when the file will be attached to email or placed in shared storage. Password protection applies to the contents of the closed file, not to the name displayed beside it.
          </p>

          <h2>External Links and Other Services</h2>
          <p>
            PDFOmni pages can link to public websites, tool directories, documentation, advertisers, or other services. Following an external link leaves PDFOmni, and the destination applies its own privacy practices. A link does not give the other site access to a document currently open in a local tool, but the destination can receive normal visit information when it is opened.
          </p>
          <p>
            Browser extensions, password managers, cloud backup software, and device security tools operate outside PDFOmni. They may have access based on the permissions the user gave them. People working with sensitive documents should review those permissions and use a device managed according to the rules of the school, employer, client, or organization responsible for the information.
          </p>

          <h2>User Choices and Control</h2>
          <p>
            Users can leave a tool without exporting, clear site storage through the browser, block or manage cookies, avoid optional AI features, and use approved offline software instead. Some choices can affect convenience. Blocking storage may reset the theme or remove a saved local workflow, and blocking required public resources may prevent a tool from loading.
          </p>
          <p>
            Local processing is meant to make the document path easier to understand, not to pressure someone into using a website for every file. A regulated record or workplace document may need an approved desktop program, managed device, or specific transfer system. Those requirements take priority over the convenience of a browser tool.
          </p>

          <h2>Retention and Privacy Requests</h2>
          <p>
            PDFOmni does not keep an account-based archive of locally processed files. Hosting, analytics, advertising, security, email, and AI providers can retain the limited information they receive according to their own policies and legal duties. Retention periods can differ because these services have different purposes.
          </p>
          <p>
            A privacy question should identify the page or service involved and the approximate date without including document contents. Requests can be sent to <a href="mailto:pdfomni@gmail.com">pdfomni@gmail.com</a>. PDFOmni can explain its own setup and act on information it controls, but it cannot erase data held independently by a user's browser, email provider, device backup, or an external service outside its control.
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
