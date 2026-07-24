import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE = {
  portrait: { width: 595.28, height: 841.89 },
  landscape: { width: 841.89, height: 595.28 },
}

const MARGIN = 42
const LINE_HEIGHT = 16

function getTextNodesFromHtml(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html || '', 'text/html')
  const blocks = []

  const walk = (node, depth = 0) => {
    if (!node) return
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'paragraph', text, depth })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const tag = node.tagName.toLowerCase()
    if (['script', 'style', 'noscript', 'meta', 'link'].includes(tag)) return

    if (/^h[1-6]$/.test(tag)) {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'heading', level: Number(tag[1]), text, depth })
      return
    }

    if (tag === 'li') {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'list', text: `- ${text}`, depth })
      return
    }

    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
        Array.from(row.children).map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
      ).filter((row) => row.some(Boolean))
      if (rows.length) blocks.push({ type: 'table', rows, depth })
      return
    }

    if (['p', 'div', 'section', 'article', 'blockquote'].includes(tag)) {
      const childBlockCount = blocks.length
      Array.from(node.childNodes).forEach((child) => walk(child, depth + 1))
      if (blocks.length === childBlockCount) {
        const text = node.textContent.replace(/\s+/g, ' ').trim()
        if (text) blocks.push({ type: 'paragraph', text, depth })
      }
      return
    }

    Array.from(node.childNodes).forEach((child) => walk(child, depth))
  }

  Array.from(doc.body.childNodes).forEach((child) => walk(child, 0))
  return blocks
}

function ensureSpace(pdf, state, needed = LINE_HEIGHT) {
  if (state.y + needed <= state.page.height - MARGIN) return
  pdf.addPage()
  state.y = MARGIN
}

function drawWrappedText(pdf, state, text, options = {}) {
  const size = options.size || 12
  const style = options.style || 'normal'
  const indent = options.indent || 0
  const maxWidth = state.page.width - (MARGIN * 2) - indent
  pdf.setFont('helvetica', style)
  pdf.setFontSize(size)
  const lines = pdf.splitTextToSize(text, maxWidth)
  for (const line of lines) {
    ensureSpace(pdf, state, size * 1.35)
    pdf.text(line, MARGIN + indent, state.y)
    state.y += size * 1.35
  }
  state.y += options.after ?? 6
}

function drawTable(pdf, state, rows) {
  const pageWidth = state.page.width - MARGIN * 2
  const colCount = Math.max(1, ...rows.map((row) => row.length))
  const colW = pageWidth / colCount
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  for (const row of rows) {
    const wrapped = row.map((cell) => pdf.splitTextToSize(cell || '', colW - 8))
    const rowH = Math.max(22, ...wrapped.map((lines) => lines.length * 11 + 10))
    ensureSpace(pdf, state, rowH)
    let x = MARGIN
    for (let c = 0; c < colCount; c++) {
      pdf.rect(x, state.y - 10, colW, rowH)
      pdf.text(wrapped[c] || [''], x + 4, state.y)
      x += colW
    }
    state.y += rowH
  }
  state.y += 10
}

export function htmlToSelectablePdfBytes(html, title = 'Document') {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const state = { y: MARGIN, page: PAGE.portrait }
  const blocks = getTextNodesFromHtml(html)

  if (title) drawWrappedText(pdf, state, title, { size: 16, style: 'bold', after: 12 })
  for (const block of blocks) {
    if (block.type === 'heading') {
      const size = block.level <= 2 ? 16 : 14
      drawWrappedText(pdf, state, block.text, { size, style: 'bold', after: 8 })
    } else if (block.type === 'list') {
      drawWrappedText(pdf, state, block.text, { size: 11, indent: 14, after: 2 })
    } else if (block.type === 'table') {
      drawTable(pdf, state, block.rows)
    } else {
      drawWrappedText(pdf, state, block.text, { size: 11, after: 8 })
    }
  }

  return new Uint8Array(pdf.output('arraybuffer'))
}

export function workbookToSelectablePdfBytes(workbook, sheetNames, sheetToRows) {
  const pdf = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4', compress: true })
  const page = PAGE.landscape
  let firstSheet = true

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = sheet ? sheetToRows(sheet) : []
    if (!firstSheet) pdf.addPage()
    firstSheet = false
    const state = { y: MARGIN, page }
    drawWrappedText(pdf, state, sheetName, { size: 16, style: 'bold', after: 10 })
    drawTable(pdf, state, rows.filter((row) => row.some((cell) => `${cell ?? ''}`.trim())))
  }

  return new Uint8Array(pdf.output('arraybuffer'))
}

export function rowsToSelectablePdfBytes(rows, title = 'Spreadsheet') {
  const pdf = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4', compress: true })
  const state = { y: MARGIN, page: PAGE.landscape }
  drawWrappedText(pdf, state, title, { size: 16, style: 'bold', after: 10 })
  drawTable(pdf, state, rows)
  return new Uint8Array(pdf.output('arraybuffer'))
}

const CSS_PX_TO_PT = 72 / 96

function pickPdfLibFont(fontFamily = '') {
  const family = fontFamily.toLowerCase()
  if (family.includes('times') || family.includes('serif')) return StandardFonts.TimesRoman
  if (family.includes('courier') || family.includes('mono')) return StandardFonts.Courier
  return StandardFonts.Helvetica
}

function wrapTextToWidth(text, font, fontSize, maxWidth) {
  if (!text) return ['']
  const paragraphs = `${text}`.split('\n')
  const lines = []

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }

    const words = paragraph.split(/\s+/)
    let currentLine = ''

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSize)
      if (candidateWidth <= maxWidth || !currentLine) {
        currentLine = candidate
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines.length > 0 ? lines : ['']
}

function collectTextOverlayBlocks(root) {
  const doc = root.ownerDocument
  const win = doc.defaultView
  const blocks = []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  const textLikeTags = new Set(['P', 'SPAN', 'DIV', 'TD', 'TH', 'LI', 'A', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE'])

  while (walker.nextNode()) {
    const element = walker.currentNode
    if (!(element instanceof HTMLElement)) continue
    if (!textLikeTags.has(element.tagName)) continue
    if (element.children.length > 0 && !['TD', 'TH', 'A'].includes(element.tagName)) continue

    const text = element.innerText || element.textContent || ''
    if (!text.trim()) continue

    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue

    const styles = win.getComputedStyle(element)
    blocks.push({
      text,
      left: rect.left + win.scrollX,
      top: rect.top + win.scrollY,
      width: rect.width,
      height: rect.height,
      fontSize: Math.max(8, parseFloat(styles.fontSize || '12')),
      fontFamily: styles.fontFamily || 'Helvetica',
      color: styles.color || '#000000',
      textAlign: styles.textAlign || 'left',
      lineHeight: parseFloat(styles.lineHeight || '') || Math.max(14, parseFloat(styles.fontSize || '12') * 1.2),
    })
  }

  return blocks
}

function parseCssColor(color) {
  if (!color) return { r: 0, g: 0, b: 0 }
  const match = color.match(/\d+(\.\d+)?/g)
  if (!match || match.length < 3) return { r: 0, g: 0, b: 0 }
  return {
    r: Number(match[0]) / 255,
    g: Number(match[1]) / 255,
    b: Number(match[2]) / 255,
  }
}

export async function htmlPreviewToSelectablePdfBytes(iframe, title = 'HTML Document') {
  const doc = iframe?.contentDocument
  const win = iframe?.contentWindow
  if (!doc || !win || !doc.body) {
    throw new Error('HTML preview is not ready yet.')
  }

  const root = doc.documentElement
  const widthPx = Math.max(root.scrollWidth, doc.body.scrollWidth, doc.body.clientWidth, iframe.clientWidth || 800)
  const totalHeightPx = Math.max(root.scrollHeight, doc.body.scrollHeight, doc.body.clientHeight)
  const pageHeightPx = Math.max(300, Math.round(widthPx * Math.SQRT2))
  const totalPages = Math.max(1, Math.ceil(totalHeightPx / pageHeightPx))
  const overlayBlocks = collectTextOverlayBlocks(doc.body)

  const pdf = await PDFDocument.create()
  const fontCache = new Map()

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const sliceTop = pageIndex * pageHeightPx
    const sliceHeight = Math.min(pageHeightPx, totalHeightPx - sliceTop)

    const canvas = await html2canvas(doc.body, {
      backgroundColor: '#ffffff',
      scale: 2,
      x: 0,
      y: sliceTop,
      width: widthPx,
      height: sliceHeight,
      windowWidth: widthPx,
      windowHeight: sliceHeight,
      scrollX: 0,
      scrollY: sliceTop,
      useCORS: true,
      logging: false,
    })

    const pageWidthPt = widthPx * CSS_PX_TO_PT
    const pageHeightPt = sliceHeight * CSS_PX_TO_PT
    const page = pdf.addPage([pageWidthPt, pageHeightPt])

    const imageBytes = await fetch(canvas.toDataURL('image/png')).then((response) => response.arrayBuffer())
    const image = await pdf.embedPng(imageBytes)
    page.drawImage(image, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt })

    for (const block of overlayBlocks) {
      const blockBottom = block.top + block.height
      if (blockBottom <= sliceTop || block.top >= sliceTop + sliceHeight) continue

      const fontKey = pickPdfLibFont(block.fontFamily)
      if (!fontCache.has(fontKey)) {
        fontCache.set(fontKey, await pdf.embedFont(fontKey))
      }
      const font = fontCache.get(fontKey)
      const fontSizePt = block.fontSize * CSS_PX_TO_PT
      const maxWidthPt = Math.max(12, block.width * CSS_PX_TO_PT)
      const lines = wrapTextToWidth(block.text, font, fontSizePt, maxWidthPt)
      const lineHeightPt = Math.max(fontSizePt * 1.2, block.lineHeight * CSS_PX_TO_PT)
      const x = block.left * CSS_PX_TO_PT
      const topWithinPage = block.top - sliceTop
      let y = pageHeightPt - (topWithinPage * CSS_PX_TO_PT) - fontSizePt

      for (const line of lines) {
        let drawX = x
        const lineWidth = font.widthOfTextAtSize(line, fontSizePt)
        if (block.textAlign === 'center') {
          drawX = x + (maxWidthPt - lineWidth) / 2
        } else if (block.textAlign === 'right') {
          drawX = x + (maxWidthPt - lineWidth)
        }

        page.drawText(line, {
          x: drawX,
          y,
          size: fontSizePt,
          font,
          color: rgb(parseCssColor(block.color).r, parseCssColor(block.color).g, parseCssColor(block.color).b),
          opacity: 0.015,
          lineHeight: lineHeightPt,
        })
        y -= lineHeightPt
      }
    }
  }

  return await pdf.save()
}
