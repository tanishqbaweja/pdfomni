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
