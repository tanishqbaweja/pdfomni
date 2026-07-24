import { normalizePdfForRewrite } from './qpdfNormalize'

let activeDownloadPrompt = null
let lastFocusedControl = null
const KOFI_GOAL_URL = 'https://ko-fi.com/trebell/goal?g=15'

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLElement && !event.target.closest('.support-download-overlay')) {
      lastFocusedControl = event.target
    }
  })
}

function ensureSupportPromptStyles() {
  if (typeof document === 'undefined' || document.getElementById('support-download-prompt-styles')) {
    return
  }

  const style = document.createElement('style')
  style.id = 'support-download-prompt-styles'
  style.textContent = `
    .support-download-overlay {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(12px);
    }
    .support-download-modal {
      width: min(560px, 100%);
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.25);
      padding: 24px;
      color: #0f172a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left;
    }
    .support-download-kicker {
      margin-bottom: 10px;
      color: #4f46e5;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .support-download-title {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      font-weight: 850;
      letter-spacing: 0;
    }
    .support-download-copy {
      margin: 12px 0 0;
      color: #475569;
      font-size: 14px;
      line-height: 1.6;
    }
    .support-download-copy a {
      color: #db2777;
      font-weight: 800;
      text-decoration: none;
    }
    .support-download-copy a:hover {
      text-decoration: underline;
    }
    .support-download-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 22px;
    }
    .support-download-button {
      min-height: 42px;
      border: 0;
      border-radius: 10px;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 750;
      cursor: pointer;
      transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    .support-download-button:active {
      transform: scale(0.98);
    }
    .support-download-cancel {
      background: #f1f5f9;
      color: #475569;
    }
    .support-download-cancel:hover {
      background: #e2e8f0;
    }
    .support-download-action {
      position: relative;
      width: 198px;
      height: 42px;
      flex: 0 0 198px;
    }
    .support-download-continue {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: #ffffff !important;
      line-height: 1;
      text-align: center;
      text-decoration: none;
      white-space: nowrap;
      background: linear-gradient(135deg, #6366f1, #db2777);
      box-shadow: 0 14px 30px rgba(99, 102, 241, 0.24);
    }
    .support-download-continue[aria-disabled="true"] {
      cursor: wait;
      opacity: 0.72;
      box-shadow: none;
      pointer-events: none;
    }
    .support-download-kofi {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      border-radius: 10px;
      padding: 0 16px;
      color: #ffffff;
      background: linear-gradient(135deg, #ff5f5f, #ff8a00);
      font-size: 14px;
      font-weight: 750;
      text-decoration: none;
      box-shadow: 0 12px 28px rgba(255, 95, 95, 0.28);
      transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
    }
    .support-download-kofi:hover {
      color: #ffffff;
      filter: brightness(1.04);
      box-shadow: 0 16px 34px rgba(255, 95, 95, 0.34);
    }
    .support-download-kofi:active {
      transform: scale(0.98);
    }
    @media (max-width: 520px) {
      .support-download-modal {
        padding: 20px;
      }
      .support-download-actions {
        flex-direction: column-reverse;
      }
      .support-download-button {
        width: 100%;
      }
      .support-download-kofi {
        width: 100%;
      }
      .support-download-action {
        width: 100%;
        flex-basis: 42px;
      }
    }
  `
  document.head.appendChild(style)
}

export function promptSupportedDownload({ url, filename }) {
  if (typeof document === 'undefined') {
    return Promise.resolve(false)
  }

  if (!url) {
    return Promise.resolve(true)
  }

  if (activeDownloadPrompt) {
    return activeDownloadPrompt
  }

  ensureSupportPromptStyles()

  activeDownloadPrompt = new Promise((resolve) => {
    const activeElement = document.activeElement
    const previousFocus = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : lastFocusedControl
    const overlay = document.createElement('div')
    overlay.className = 'support-download-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'support-download-title')
    overlay.setAttribute('aria-describedby', 'support-download-description')
    overlay.tabIndex = -1
    overlay.innerHTML = `
      <div class="support-download-modal">
        <div class="support-download-kicker">Independent tools need real hardware</div>
        <h2 class="support-download-title" id="support-download-title">Keep PDFOmni Free...</h2>
        <p class="support-download-copy" id="support-download-description">
          PDFOmni stays free because it is built independently. If this saved you time,
          <a href="${KOFI_GOAL_URL}" target="_blank" rel="noopener noreferrer">support me</a>
          on Ko-fi and help fund a new laptop for building the next project.
          Your download is ready either way.
        </p>
        <div class="support-download-actions">
          <button type="button" class="support-download-button support-download-cancel" data-support-cancel>Cancel</button>
          <a class="support-download-kofi" href="${KOFI_GOAL_URL}" target="_blank" rel="noopener noreferrer">Support on Ko-fi</a>
          <span class="support-download-action">
            <a class="support-download-button support-download-continue" data-support-continue>Continue & Download</a>
          </span>
        </div>
      </div>
    `

    const continueLink = overlay.querySelector('[data-support-continue]')
    const cancelButton = overlay.querySelector('[data-support-cancel]')
    continueLink.textContent = 'Preparing PDF...'
    continueLink.setAttribute('aria-disabled', 'true')
    let settled = false
    let ready = false
    const readyTimer = window.setTimeout(() => {
      ready = true
      continueLink.href = url
      continueLink.download = filename
      continueLink.textContent = 'Continue & Download'
      continueLink.removeAttribute('aria-disabled')
    }, 4000)

    const cleanup = () => {
      window.clearTimeout(readyTimer)
      overlay.remove()
      activeDownloadPrompt = null
      window.setTimeout(() => previousFocus?.focus?.(), 0)
    }

    cancelButton.addEventListener('click', (event) => {
      event.stopImmediatePropagation()
      if (settled) return
      settled = true
      cleanup()
      resolve(false)
    })

    continueLink.addEventListener('click', (event) => {
      if (!ready) {
        event.preventDefault()
        return
      }
      if (settled) return
      settled = true
      window.setTimeout(cleanup, 500)
      resolve(true)
    })

    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelButton.click()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(overlay.querySelectorAll(
        'button:not([disabled]), a[href]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) {
        event.preventDefault()
        overlay.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    })

    document.body.appendChild(overlay)
    cancelButton.focus()
  })

  return activeDownloadPrompt
}

export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob)
  return promptSupportedDownload({ url, filename }).finally(() => {
    window.setTimeout(() => URL.revokeObjectURL(url), 5000)
  })
}

async function normalizePdfDownloadBytes(bytes, filename, mimeType) {
  if (bytes instanceof Blob) return bytes
  const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(filename || '')
  if (!isPdf) return bytes
  try {
    return await normalizePdfForRewrite(bytes)
  } catch {
    return bytes
  }
}

export async function downloadBlob(bytes, filename, mimeType = 'application/pdf') {
  const normalizedBytes = await normalizePdfDownloadBytes(bytes, filename, mimeType)
  const blob = normalizedBytes instanceof Blob ? normalizedBytes : new Blob([normalizedBytes], { type: mimeType })
  return downloadFile(blob, filename)
}

export function downloadImage(dataUrl, filename) {
  return promptSupportedDownload({ url: dataUrl, filename })
}

export async function downloadMultipleAsZip(files, zipName = 'pdfomni-output.zip') {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const { name, bytes } of files) {
    zip.file(name, await normalizePdfDownloadBytes(bytes, name, 'application/pdf'))
  }
  const content = await zip.generateAsync({ type: 'blob' })
  return downloadFile(content, zipName)
}

export function downloadText(text, filename, mimeType = 'text/plain') {
  const blob = new Blob([text], { type: mimeType })
  return downloadFile(blob, filename)
}
