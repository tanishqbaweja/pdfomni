import { useState } from 'react'
import Seo from '../components/Common/Seo'

const CONTACT_EMAIL = 'pdfomni@gmail.com'

export default function ContactPage() {
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject || 'PDFOmni Support')}&body=${encodeURIComponent(`Name: ${name}\n\n${message}`)}`

  return (
    <div className="tool-page" id="contact-page">
      <Seo
        title="Contact PDFOmni"
        description="Contact PDFOmni about support, privacy, bugs, accessibility, feedback, or questions about the browser-based PDF tools."
        canonicalPath="/contact"
      />
      <div className="container">
        <div className="tool-page-header">
          <h1 className="tool-page-title">Contact PDFOmni</h1>
          <p className="tool-page-desc">Send a question, bug report, or suggestion to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </div>
        <div className="card legal-card">
          <h2>Before Sending a Bug Report</h2>
          <p>
            Include the name of the tool, your browser and device, the approximate file size, and the steps that led to the problem. A screenshot is useful for layout or export issues. Please do not attach a private document unless you have removed sensitive information and are comfortable sharing the sample.
          </p>
          <p>
            The form below prepares a message in your email app. It does not upload your message or document to PDFOmni by itself. You can also write directly to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h2>What Makes a Bug Report Useful</h2>
          <p>
            Start with the result you expected and the result you actually saw. Then list the actions in the order you took them. For example, explain that you opened Edit PDF, selected a text block, changed one character, exported the file, and found that the text moved in the downloaded copy. A short sequence like that is easier to reproduce than a general message saying the editor is broken. If the problem happens only after dragging, double-clicking, changing the theme, or using a particular setting, include that detail.
          </p>
          <p>
            Mention whether the issue appears in the working preview, the downloaded file, or both. Those views can use different rendering paths, so the distinction matters. Include the browser name and version when possible, the operating system, whether the device is a phone or computer, and an approximate page count and file size. You do not need to provide private content to explain most technical problems.
          </p>

          <h2>Sharing a Safe Test File</h2>
          <p>
            A small sample that reproduces the issue can be very helpful, but it should be safe to share. Remove names, addresses, account numbers, signatures, medical details, grades, client information, and anything else that should stay private. Covering information with a rectangle is not enough because the original text may still be present. Create a new sample from public or invented content when possible.
          </p>
          <p>
            Before attaching a sample, reopen it in another reader and try searching or copying areas that were removed. Check the filename and document metadata too. If the bug only appears in a sensitive original and cannot be recreated safely, send screenshots of the interface and describe the document structure instead. A report can still be useful if it says the page contains selectable text, an embedded font, a scanned image, a table, or a password without revealing the actual information.
          </p>

          <h2>Reporting Conversion Problems</h2>
          <p>
            For a conversion issue, say which source format and output format were involved. Point to the kind of content that changed, such as a wide table, equation, unusual font, transparent image, link, header, footer, or multi-column page. Explain which office or PDF program you used to open the result because Microsoft Word, LibreOffice, Google Docs, and different PDF readers can interpret the same file in slightly different ways.
          </p>
          <p>
            Screenshots should show the source and result at a similar zoom when the problem is visual. If text is missing, mention whether it was selectable in the source. If page previews are duplicated or out of order, include the source page count and the count shown by the tool. These details help separate an extraction problem from a display problem and make the fix more likely to apply to other documents too.
          </p>

          <h2>Reporting Editing or Export Problems</h2>
          <p>
            Editing reports are most useful when they identify the exact action that changes the page. Say whether you clicked once, double-clicked, typed in the middle of a line, changed formatting, resized an image, or dragged an object. Note whether nearby text, borders, or background artwork changed in the canvas. Then explain what remained wrong after export, since temporary preview artifacts and permanent PDF changes need different fixes.
          </p>
          <p>
            If the text appearance changes, include the original and displayed font size if the interface shows them. Mention symbols, spacing, alignment, and whether the text was part of a paragraph or several separate objects. A cropped screenshot around the problem is usually enough. Keep one screenshot from before the edit and one from afterward so the comparison does not depend on memory.
          </p>

          <h2>Accessibility Feedback</h2>
          <p>
            Accessibility reports are welcome even when the PDF operation itself works. Include the control name or page section, how you reached it, and what made it difficult to use. Keyboard users can mention an invisible focus indicator, an unexpected tab order, a dialog that does not close with Escape, or a control that cannot be reached. Screen reader users can include the announced name, role, or status message that was confusing.
          </p>
          <p>
            Contrast, zoom, reduced motion, touch target size, and mobile reflow are also useful areas to report. If an issue depends on a browser accessibility setting or assistive technology, name that setup. The goal is to fix the underlying structure and behavior, not hide an automated warning, so a description of what the person was trying to accomplish is especially valuable.
          </p>

          <h2>Feature Requests</h2>
          <p>
            A helpful feature request begins with the document task, not only the name of a button. Explain what kind of file you start with, what has to change, and what the final result needs to do. Mention how often the task comes up and whether an existing PDFOmni tool solves part of it. This makes it easier to judge whether the idea belongs in a current workflow, needs a new tool, or depends on software that cannot reasonably run in the browser.
          </p>
          <p>
            Privacy requirements matter too. If the feature would need a server, account, external API, licensed office program, or online AI provider, say what tradeoff would be acceptable for the use case. PDFOmni prefers local processing, and a feature should not quietly weaken that model just because a remote implementation is easier.
          </p>

          <h2>What Support Can and Cannot Do</h2>
          <p>
            Support can investigate reproducible site bugs, clarify how a tool is intended to work, and consider improvements. It cannot recover a password that was never stored, restore a file deleted from a device, provide legal approval for a signature, certify accessibility compliance, or decide whether a document meets a school, tax, court, employer, or government rule. Important submissions should be checked against the instructions from the organization receiving them.
          </p>
          <p>
            There are no PDFOmni user accounts for the local tools, so support will never need an account password or ask for payment details to release a download. Be cautious with messages that claim otherwise. The official contact address shown on this page is <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h2>After You Send the Message</h2>
          <p>
            Keep the original document and any safe test file until the problem is understood. If you discover a shorter set of steps or notice that the issue depends on one browser, reply to the same email so the details stay together. Do not keep sending sensitive copies. A corrected public sample is better for repeated testing and can be used without exposing the document that first revealed the problem.
          </p>

          <div className="input-group">
            <label className="input-label" htmlFor="contact-name">Name</label>
            <input id="contact-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="contact-subject">Subject</label>
            <input id="contact-subject" className="input" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Support request" />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="contact-message">Message</label>
            <textarea
              id="contact-message"
              className="input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Describe the problem or question"
              style={{ minHeight: 180, resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={mailtoHref}>Open Email Draft</a>
          </div>
        </div>
      </div>
    </div>
  )
}
