// main.js - PDF to Word Converter for PDFOmni
import * as docx from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

const DEV_SESSION_ID = typeof __PDFOMNI_DEV_SESSION__ === 'string'
  ? __PDFOMNI_DEV_SESSION__
  : '';
let devSessionRequest = null;

async function ensureCurrentDevSession() {
  if (!import.meta.env.DEV || !DEV_SESSION_ID) return true;
  if (devSessionRequest) return devSessionRequest;

  devSessionRequest = fetch(`/__pdfomni_dev_session?t=${Date.now()}`, { cache: 'no-store' })
    .then(async response => response.ok && (await response.text()).trim() === DEV_SESSION_ID)
    .then(current => {
      if (!current) window.location.reload();
      return current;
    })
    // A server may be between shutdown and startup. Let the focus/visibility
    // checks retry rather than interrupting a conversion for a network blip.
    .catch(() => true)
    .finally(() => { devSessionRequest = null; });
  return devSessionRequest;
}

if (import.meta.env.DEV) {
  window.addEventListener('focus', () => { void ensureCurrentDevSession(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void ensureCurrentDevSession();
  });
  setInterval(() => { void ensureCurrentDevSession(); }, 5000);
}

// Set up the PDF.js worker using Vite's URL asset loader
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// Constants
const OT = { TEXT: 'text', IMAGE: 'image', SHAPE: 'shape', LINK: 'link' };
const RENDER_SCALE = 2; // Optimal resolution for thumbnails & extraction, balances speed & memory
const IMAGE_RENDER_SCALE = 4; // Higher raster pass for embedded photos/images only.
const DOCX_TEXT_SCALE = 0.88; // Word renders PDF-positioned text taller/wider than canvas/PDF.js.
const RASTER_ENCODE_CONCURRENCY = Math.max(3, Math.min(6,
  Math.floor((globalThis.navigator?.hardwareConcurrency || 6) / 2)));

// Timer callbacks are aggressively throttled in background tabs. Use the task
// queue for conversion yields so processing continues when the tab is hidden,
// while still giving the browser opportunities to paint and handle input.
const _yieldResolvers = [];
const _yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
if (_yieldChannel) {
  _yieldChannel.port1.onmessage = () => _yieldResolvers.shift()?.();
}
function yieldToBrowser() {
  // A hidden page has nothing to repaint. Queueing a MessageChannel task here
  // lets Chromium's background-tab task budget pause the conversion between
  // phases. Continue in the microtask queue instead; asynchronous PDF renders
  // and image encodes still provide natural browser scheduling boundaries.
  if (document.hidden) return Promise.resolve();
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  if (!_yieldChannel) return Promise.resolve();
  return new Promise(resolve => {
    _yieldResolvers.push(resolve);
    _yieldChannel.port2.postMessage(0);
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Several layout detectors inspect the same immutable rendered page. Cache one
// pixel snapshot per page canvas instead of copying the full bitmap repeatedly.
const _canvasPixelCache = new WeakMap();
function canvasPixelSnapshot(canvas) {
  if (!canvas?.width || !canvas?.height) return null;
  const cached = _canvasPixelCache.get(canvas);
  if (cached && cached.width === canvas.width && cached.height === canvas.height) return cached;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const snapshot = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  _canvasPixelCache.set(canvas, snapshot);
  return snapshot;
}

// ── UTILS (Adapted from editpdf.html) ──────────────────────────────
let _snkT;
const snack = (m, t = 'info', d = 3000) => {
  const el = document.getElementById('snackbar');
  el.className = t;
  document.getElementById('snk-msg').textContent = m;
  el.classList.add('show');
  clearTimeout(_snkT);
  _snkT = setTimeout(() => el.classList.remove('show'), d);
};

let _progPct = 0, _progTarget = 0, _progAnim = 0;
function _setProg(p = 0, immediate = false) {
  const fill = document.getElementById('prog-fill');
  if (!fill) return;
  _progTarget = Math.max(0, Math.min(100, Number(p) || 0));
  if (immediate) {
    if (_progAnim) cancelAnimationFrame(_progAnim);
    _progAnim = 0; _progPct = _progTarget;
    fill.style.width = _progPct + '%';
    return;
  }
  if (_progAnim) return;
  const tick = () => {
    const diff = _progTarget - _progPct;
    if (Math.abs(diff) < 0.12) {
      _progPct = _progTarget;
      fill.style.width = _progPct + '%';
      _progAnim = 0;
      return;
    }
    _progPct += diff * 0.15;
    fill.style.width = _progPct + '%';
    _progAnim = requestAnimationFrame(tick);
  };
  _progAnim = requestAnimationFrame(tick);
}

const showProg = (t, s = '', p = 0) => {
  const ov = document.getElementById('prog');
  const wasOn = ov?.classList.contains('on');
  if (ov) {
    ov.classList.add('on');
  }
  document.getElementById('prog-title').textContent = t;
  document.getElementById('prog-sub').textContent = s;
  _setProg(p, !wasOn);
};

const updProg = (s, p) => {
  document.getElementById('prog-sub').textContent = s;
  _setProg(p);
};

const hideProg = () => {
  const el = document.getElementById('prog');
  if (el) {
    el.classList.remove('on');
  }
  _setProg(0, true);
};

const CONVERSION_TIMING_STORAGE_KEY = 'pdfomni:lastConversionTiming';
let _conversionTimerInterval = 0;

function formatConversionDuration(elapsedMs) {
  const totalTenths = Math.max(0, Math.floor(Number(elapsedMs || 0) / 100));
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const core = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  return hours ? `${String(hours).padStart(2, '0')}:${core}` : core;
}

function persistConversionTiming(timing) {
  window.lastConversionTiming = timing;
  try {
    localStorage.setItem(CONVERSION_TIMING_STORAGE_KEY, JSON.stringify(timing));
  } catch (error) {
    console.warn('Unable to persist conversion timing', error);
  }
}

function beginConversionTiming(file, pageCount) {
  if (_conversionTimerInterval) clearInterval(_conversionTimerInterval);
  const timing = {
    status: 'running',
    filename: file?.name || '',
    pages: Number(pageCount || 0),
    startedAt: Date.now(),
    endedAt: null,
    elapsedMs: 0,
    pageTimings: [],
    visibilityEvents: [{ hidden: document.hidden, atMs: 0 }]
  };
  const timer = document.getElementById('prog-timer');
  const result = document.getElementById('conversion-time-result');
  if (timer) timer.style.display = 'block';
  if (result) result.style.display = 'none';
  const update = () => {
    timing.elapsedMs = Date.now() - timing.startedAt;
    if (timer) timer.textContent = `Elapsed: ${formatConversionDuration(timing.elapsedMs)}`;
  };
  timing._onVisibilityChange = () => {
    timing.visibilityEvents.push({ hidden: document.hidden, atMs: Date.now() - timing.startedAt });
    update();
    persistConversionTiming({ ...timing, _onVisibilityChange: undefined });
  };
  document.addEventListener('visibilitychange', timing._onVisibilityChange);
  update();
  persistConversionTiming({ ...timing, _onVisibilityChange: undefined });
  _conversionTimerInterval = setInterval(update, 250);
  return timing;
}

function recordConversionPageTiming(timing, pageIndex, startedAt) {
  if (!timing) return;
  const endedAt = Date.now();
  timing.pageTimings.push({
    page: pageIndex + 1,
    startedAtMs: startedAt - timing.startedAt,
    endedAtMs: endedAt - timing.startedAt,
    elapsedMs: endedAt - startedAt
  });
  timing.elapsedMs = endedAt - timing.startedAt;
  if ((pageIndex + 1) % 8 === 0 || pageIndex + 1 >= timing.pages) {
    persistConversionTiming({ ...timing, _onVisibilityChange: undefined });
  }
}

function finishConversionTiming(timing, status = 'complete', error = null) {
  if (!timing) return null;
  if (_conversionTimerInterval) clearInterval(_conversionTimerInterval);
  _conversionTimerInterval = 0;
  if (timing._onVisibilityChange) document.removeEventListener('visibilitychange', timing._onVisibilityChange);
  timing.status = status;
  timing.endedAt = Date.now();
  timing.elapsedMs = timing.endedAt - timing.startedAt;
  if (error) timing.error = String(error?.message || error);
  const timer = document.getElementById('prog-timer');
  if (timer) timer.textContent = `Elapsed: ${formatConversionDuration(timing.elapsedMs)}`;
  const result = document.getElementById('conversion-time-result');
  if (result && status === 'complete') {
    result.textContent = `Conversion time: ${formatConversionDuration(timing.elapsedMs)} (${(timing.elapsedMs / 1000).toFixed(2)} seconds)`;
    result.style.display = 'block';
  }
  const persisted = { ...timing, _onVisibilityChange: undefined };
  persistConversionTiming(persisted);
  console.info('pdfomni-conversion-timing', JSON.stringify(persisted));
  return persisted;
}

const uid = () => 'o' + (Date.now() % 1e9) + '_' + Math.floor(Math.random() * 1000);
const _roundNum = (v, d = 2) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * Math.pow(10, d)) / Math.pow(10, d) : 0; };

// Helper to convert HTML to TextRuns (Resolves requirement for inline bold / italic / underline / color / font-family)
function htmlToTextRuns(html, baseStyle) {
  if (!html) {
    return [new docx.TextRun({
      text: String(baseStyle.content || ""),
      font: baseStyle.fontFamily || "sans-serif",
      size: Math.round((baseStyle.fontSize || 11) * 2), // Size in half-points
      color: baseStyle.color ? baseStyle.color.replace('#', '') : "000000",
      bold: baseStyle.fontWeight === 'bold',
      italics: baseStyle.fontStyle === 'italic',
      underline: baseStyle.underline ? { type: "single" } : undefined
    })];
  }

  const div = document.createElement('div');
  div.innerHTML = html;
  const runs = [];

  function traverse(node, currentStyle) {
    if (node.nodeType === 3) { // Text node
      const txt = node.nodeValue;
      if (txt) {
        runs.push(new docx.TextRun({
          text: txt,
          font: currentStyle.fontFamily || "sans-serif",
          size: Math.round((currentStyle.fontSize || 11) * 2),
          color: currentStyle.color ? currentStyle.color.replace('#', '') : "000000",
          bold: currentStyle.fontWeight === 'bold',
          italics: currentStyle.fontStyle === 'italic',
          underline: currentStyle.underline ? { type: "single" } : undefined
        }));
      }
      return;
    }
    if (node.nodeType !== 1) return;

    let nextStyle = { ...currentStyle };
    const tag = node.tagName;
    if (tag === 'B' || tag === 'STRONG') nextStyle.fontWeight = 'bold';
    if (tag === 'I' || tag === 'EM') nextStyle.fontStyle = 'italic';
    if (tag === 'U') nextStyle.underline = true;

    const st = node.style;
    if (st.fontFamily) nextStyle.fontFamily = st.fontFamily.replace(/['"]/g, '');
    if (st.fontWeight) nextStyle.fontWeight = st.fontWeight;
    if (st.fontStyle) nextStyle.fontStyle = st.fontStyle;
    if (st.color) nextStyle.color = st.color;
    const dec = st.textDecoration || st.textDecorationLine;
    if (dec && dec.includes('underline')) nextStyle.underline = true;
    if (st.fontSize) {
      const fs = st.fontSize;
      if (fs.endsWith('em')) {
        nextStyle.fontSize = currentStyle.fontSize * (parseFloat(fs) || 1);
      } else if (fs.endsWith('px')) {
        nextStyle.fontSize = parseFloat(fs) || currentStyle.fontSize;
      } else {
        nextStyle.fontSize = parseFloat(fs) || currentStyle.fontSize;
      }
    }

    for (const child of node.childNodes) {
      traverse(child, nextStyle);
    }
  }

  const initialStyle = {
    fontFamily: baseStyle.fontFamily || "sans-serif",
    fontSize: baseStyle.fontSize || 11,
    fontWeight: baseStyle.fontWeight || 'normal',
    fontStyle: baseStyle.fontStyle || 'normal',
    color: baseStyle.color || '#000000',
    underline: baseStyle.underline || false
  };

  for (const child of div.childNodes) {
    traverse(child, initialStyle);
  }

  return runs.length ? runs : [new docx.TextRun({ text: String(baseStyle.content || "") })];
}

function objToDocxParagraphs(obj, alignmentMap) {
  const lines = obj.data.lines || [];
  if (!lines.length) {
    return [new docx.Paragraph({
      alignment: alignmentMap[obj.data.align || 'left'],
      children: [new docx.TextRun({
        text: String(obj.data.content || ''),
        font: obj.data.fontFamily || "sans-serif",
        size: Math.round((obj.data.fontSize || 11) * 2),
        color: obj.data.color ? obj.data.color.replace('#', '') : "000000",
        bold: obj.data.fontWeight === 'bold',
        italics: obj.data.fontStyle === 'italic',
        underline: obj.data.underline ? { type: "single" } : undefined
      })]
    })];
  }
  return lines.map((line, i) => {
    const align = (obj.data._lineAligns && obj.data._lineAligns[i]) || obj.data.align || 'left';
    const runs = line.map(r => new docx.TextRun({
      text: r.text,
      font: r.fontFamily || "sans-serif",
      size: Math.round((r.fontSize || 11) * 2),
      color: r.color ? r.color.replace('#', '') : "000000",
      bold: r.bold,
      italics: r.italic,
      underline: r.underline ? { type: "single" } : undefined
    }));
    return new docx.Paragraph({
      alignment: alignmentMap[align],
      children: runs
    });
  });
}

function cleanFontNameForDocx(fontFamily) {
  const first = String(fontFamily || 'Arial')
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
    .find(Boolean);
  if (!first || /^(sans-serif|serif|monospace)$/i.test(first)) {
    return /serif/i.test(first || '') && !/sans/i.test(first || '') ? 'Times New Roman' :
      /mono/i.test(first || '') ? 'Courier New' : 'Arial';
  }
  if (/^g_[a-z0-9]+_f\d+$/i.test(first)) {
    return first;
  }
  return first;
}

function docxFontNameFromEmbeddedPdfFont(font) {
  const originalName = String(font?.originalName || '').trim();
  if (!originalName) return null;
  // Computer Modern math italic has substantially larger visual glyphs than
  // Times New Roman at the same point size. Use Word's native math face for
  // editable TeX-style identifiers instead of shrinking their apparent size.
  if (/(?:^|[+,_\s-])cmmi\d*(?:$|[+,_\s-])/i.test(originalName)) return 'Cambria Math';
  const standard = _standardBrowserFontFamily(originalName);
  if (standard) return cleanFontNameForDocx(standard);
  const known = _knownWebFontFamily(originalName);
  return known ? cleanFontNameForDocx(known) : null;
}

function pointsToTwips(value) {
  return Math.round((Number(value) || 0) * 20);
}

function pointsToEmu(value) {
  return Math.round((Number(value) || 0) * 12700);
}

function pointsToDocxImagePx(value) {
  return (Number(value) || 0) * (96 / 72);
}

function canvasRegionLooksPhotographic(canvas, box, areaMultiplier = 1) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || !canvas?.width || !canvas?.height || !box) return false;
  const x = Math.max(0, Math.floor(Number(box.x || 0)));
  const y = Math.max(0, Math.floor(Number(box.y || 0)));
  const width = Math.max(0, Math.min(canvas.width - x, Math.ceil(Number(box.width || 0))));
  const height = Math.max(0, Math.min(canvas.height - y, Math.ceil(Number(box.height || 0))));
  const area = width * height;
  const effectiveArea = area * Math.max(1, Number(areaMultiplier) || 1);
  if (effectiveArea < 160000) return false;
  const pixels = snapshot.data;
  const sampleW = Math.max(1, Math.min(80, width));
  const sampleH = Math.max(1, Math.min(80, height));
  const stepX = width / sampleW;
  const stepY = height / sampleH;
  const buckets = new Set();
  let count = 0, colored = 0, midtone = 0;
  for (let yy = 0; yy < sampleH; yy++) {
    for (let xx = 0; xx < sampleW; xx++) {
      const px = Math.min(width - 1, Math.floor(xx * stepX));
      const py = Math.min(height - 1, Math.floor(yy * stepY));
      const index = ((y + py) * snapshot.width + x + px) * 4;
      if (pixels[index + 3] < 32) continue;
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      count++;
      if (max - min > 24) colored++;
      if (lum > 24 && lum < 238) midtone++;
      buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }
  if (!count) return false;
  const coloredRatio = colored / count;
  const midtoneRatio = midtone / count;
  return buckets.size > 96 || (buckets.size > 48 && coloredRatio > 0.08) ||
    (effectiveArea > 600000 && buckets.size > 32 && midtoneRatio > 0.45);
}

function canvasLooksPhotographic(canvas) {
  return canvasRegionLooksPhotographic(canvas, {
    x: 0,
    y: 0,
    width: canvas?.width || 0,
    height: canvas?.height || 0
  });
}

function createRasterWorkCanvas(width, height) {
  const safeWidth = Math.max(1, Math.ceil(Number(width) || 1));
  const safeHeight = Math.max(1, Math.ceil(Number(height) || 1));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(safeWidth, safeHeight);
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  return canvas;
}

async function canvasToOptimizedImageBuffer(canvas, photographicHint = null) {
  const photographic = typeof photographicHint === 'boolean' ? photographicHint : canvasLooksPhotographic(canvas);
  const toBlob = (type, quality) => {
    if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error(`Unable to encode canvas as ${type}`));
    }, type, quality));
  };
  if (photographic) {
    const blob = await toBlob('image/jpeg', 0.96);
    return { data: await blob.arrayBuffer(), type: 'jpg' };
  }

  const png = await toBlob('image/png');
  const isLargeGraphic = canvas.width * canvas.height >= 750000 && png.size >= 1000000;
  if (isLargeGraphic) {
    // Preserve lossless PNG for ordinary vector-like artwork. Textured document
    // graphics can be dramatically larger as PNG, while a 98-quality JPEG at
    // the existing 4x render resolution is visually equivalent in Word.
    const jpeg = await toBlob('image/jpeg', 0.98);
    if (jpeg && jpeg.size < png.size * 0.8) {
      return { data: await jpeg.arrayBuffer(), type: 'jpg' };
    }
  }
  return { data: await png.arrayBuffer(), type: 'png' };
}

function makeImageRun(image, options = {}) {
  const payload = image && typeof image === 'object' && 'data' in image
    ? image
    : { data: image, type: 'png' };
  return new docx.ImageRun({
    type: payload.type || 'png',
    data: payload.data,
    ...options
  });
}

function stripInvalidXmlChars(value) {
  return String(value ?? '')
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[\uFDD0-\uFDEF]|\uFFFE|\uFFFF|\u{1FFFE}|\u{1FFFF}|\u{2FFFE}|\u{2FFFF}|\u{3FFFE}|\u{3FFFF}|\u{4FFFE}|\u{4FFFF}|\u{5FFFE}|\u{5FFFF}|\u{6FFFE}|\u{6FFFF}|\u{7FFFE}|\u{7FFFF}|\u{8FFFE}|\u{8FFFF}|\u{9FFFE}|\u{9FFFF}|\u{AFFFE}|\u{AFFFF}|\u{BFFFE}|\u{BFFFF}|\u{CFFFE}|\u{CFFFF}|\u{DFFFE}|\u{DFFFF}|\u{EFFFE}|\u{EFFFF}|\u{FFFFE}|\u{FFFFF}|\u{10FFFE}|\u{10FFFF}/gu, '');
}

function base64EncodeUtf8(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64DecodeUtf8(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function rotatedTextMarker(payload) {
  return `__PDFOMNI_ROTATED_TEXT__${base64EncodeUtf8(JSON.stringify(payload))}__`;
}

function vectorLineMarker(payload) {
  return `__PDFOMNI_VECTOR_LINE__${base64EncodeUtf8(JSON.stringify(payload))}__`;
}

function vectorPathMarker(payload) {
  return `__PDFOMNI_VECTOR_PATH__${base64EncodeUtf8(JSON.stringify(payload))}__`;
}

function vectorRoundRectMarker(payload) {
  return `__PDFOMNI_VECTOR_ROUNDRECT__${base64EncodeUtf8(JSON.stringify(payload))}__`;
}

function isCompactChartLabelText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.length > 44) return false;
  if (/[,:;]\s/.test(trimmed) || /\b(?:doi|url|version|vol|pages?)\b/i.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  const lowerWords = words.filter(word => /^[a-z]{2,}\.?$/.test(word)).length;
  return lowerWords < Math.max(2, words.length * 0.55) &&
    words.every(word => /^[A-Za-z0-9][A-Za-z0-9._%+()\/-]*\.?$/.test(word)) &&
    words.some(word => /[0-9._%+()\/-]/.test(word) || /^(AP|AMC|GRE|SAT|LSAT|USABO|gpt|RLHF|PaLM|Askell)$/i.test(word));
}

function looksLikeReferenceFragmentText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (/https?:|www\.|\b(?:doi|url|version|arxiv)\b/i.test(value)) return true;
  return /\b(?:19|20)\d{2}\b/.test(value) && /[.,:;]/.test(value);
}

function shouldPreserveNaturalFontForLine(text, segmentCount, fontPt) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (segmentCount < 2 || value.length < 28 || fontPt <= 0) return false;
  if (looksLikeReferenceFragmentText(value)) return true;
  if (isCompactChartLabelText(value)) return false;
  if (isCaptionLikeText(value)) return false;
  const words = value.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  const proseWords = words.filter(word => /^[A-Za-z][A-Za-z'-]{2,}$/.test(word)).length;
  return proseWords >= 4 || /^\[\d+\]\s/.test(value);
}

function naturalFontPreserveRatio(text) {
  return looksLikeReferenceFragmentText(text) ? 0.995 : 0.96;
}

function makeDocxTextRun(run, fallback = {}) {
  // When the PDF exposes the script's baseline, retain its measured font size
  // and apply the measured vertical offset. Word's built-in sub/superscript
  // applies its own size and baseline shift, which compounds the PDF styling
  // and is visibly wrong for mathematical identifiers such as d_model.
  const baselineShiftPt = Number(run._baselineShiftPt);
  const hasMeasuredBaselineShift = Number.isFinite(baselineShiftPt) && Math.abs(baselineShiftPt) >= 0.05;
  // Numeric scientific-notation exponents and attached alphabetic variant
  // labels are safer as native Word scripts. A measured w:position run
  // participates in the surrounding textbox's top-aligned line box; after
  // font substitution that can make a word subscript look superscripted.
  const nativeNumericScript = !!run._verticalAlign && /^\s*\d{1,3}\s*$/.test(String(run.text || ''));
  const nativeWordScript = !!run._verticalAlign && /^[A-Z]{2,8}$/.test(String(run.text || '').trim());
  const nativeScript = nativeNumericScript || nativeWordScript;
  const rawFontSize = Number(
    (nativeScript ? run._scriptBaseFontSize : (hasMeasuredBaselineShift ? run.fontSize : run._scriptBaseFontSize)) ||
    run.fontSize || fallback.fontSize || 11
  );
  // Native Word script formatting shrinks the displayed glyphs from the base
  // size. Measure width at the PDF run's visual size so source-width fitting
  // does not compress a native subscript a second time.
  const measurementFontSize = nativeScript
    ? Number(run.fontSize || rawFontSize * 0.72)
    : rawFontSize;
  const compactMathIdentifier = !!run._verticalAlign &&
    (run._restoredMathIdentifier ||
      /^[A-Za-z]+(?:_[A-Za-z]+)+$/.test(String(run.text || '').trim()));
  const compactChartLabel = !compactMathIdentifier &&
    rawFontSize <= 7 && isCompactChartLabelText(run.text);
  const extractedFontFamily = run.fontFamily || fallback.fontFamily || 'Arial';
  const privatePdfFontName = /^g_[a-z0-9]+_f\d+$/i.test(
    String(extractedFontFamily).split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  );
  const preferredFontFamily = compactMathIdentifier || run._restoredMathIdentifier || privatePdfFontName
    ? (run._docxFontFamily || extractedFontFamily)
    : extractedFontFamily;
  // Cambria Math is the closest Word-native replacement for embedded CMMI,
  // but its rendered italic glyph box is slightly shorter at the same nominal
  // point size. Compensate for that font-level metric difference while
  // retaining the source width through the horizontal-fit calculation.
  const metricFontSize = run._docxFontFamily === 'Cambria Math' &&
    preferredFontFamily === 'Cambria Math'
    ? rawFontSize * 1.06
    : rawFontSize;
  const sizeHalfPoints = compactChartLabel || (privatePdfFontName && rawFontSize <= 5.5)
    ? Math.floor(metricFontSize * 2)
    : Math.round(metricFontSize * 2);
  const text = stripInvalidXmlChars(run.text);
  let scale;
  const sourceWidth = Number(run._sourceWidth);
  const fitToSourceWidth = compactChartLabel || compactMathIdentifier || !!run._fitToSourceWidth;
  if (fitToSourceWidth && Number.isFinite(sourceWidth) && sourceWidth > 0 && text.trim()) {
    const ctx = _measureCtx || (_measureCtx = document.createElement('canvas').getContext('2d'));
    const bold = run.bold ?? fallback.bold ?? fallback.fontWeight === 'bold';
    const italic = run.italic ?? fallback.italic ?? fallback.fontStyle === 'italic';
    ctx.font = _canvasTextFont({
      fontFamily: preferredFontFamily,
      fontSize: (measurementFontSize * (metricFontSize / rawFontSize)) * RENDER_SCALE,
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal'
    });
    const measured = ctx.measureText(text.trim()).width;
    if (Number.isFinite(measured) && measured > 0) {
      // At very small table sizes, even a modest fallback-font width mismatch
      // can wrap an otherwise single PDF line and consume an extra row line.
      // Reserve horizontal clearance for descriptive micro-text before Word
      // lays it out; short labels and numeric values keep their natural width.
      const longMicroText = run._fitToSourceWidth && rawFontSize <= 7 && text.trim().length >= 14;
      const maxScale = compactMathIdentifier
        ? 145
        : run._fitToSourceWidth
        ? (longMicroText ? 90 : 100)
        : 145;
      const pct = Math.max(55, Math.min(maxScale, Math.round((sourceWidth / measured) * 100)));
      if (Math.abs(pct - 100) >= 4) scale = pct;
    }
  }
  if (fitToSourceWidth && rawFontSize >= 18) {
    scale = Math.min(Number.isFinite(scale) ? scale : 100, 95);
  }
  // Generic fallback faces often contain only the radical's overbar or clip
  // its descending check mark inside Word text frames. Cambria Math provides
  // the complete editable glyph with stable metrics across Word renderers.
  const runFontFamily = text.trim() === '√'
    ? 'Cambria Math'
    : cleanFontNameForDocx(preferredFontFamily);
  const runLineContext = String(run._lineText || '').replace(/\s+/g, ' ').trim();
  const fallbackContext = String(fallback.content || '').replace(/\s+/g, ' ').trim();
  const colorContext = fallbackContext.length > runLineContext.length && (
    isCaptionLikeText(fallbackContext) ||
    looksLikeBodyProseText(fallbackContext) ||
    looksLikeNaturalLanguageFragmentText(fallbackContext)
  )
    ? fallbackContext
    : (runLineContext || fallbackContext || text);
  const runColor = normalizedRunTextColor(
    text,
    colorContext,
    run.color || fallback.color || '#000000',
    runFontFamily
  );
  return new docx.TextRun({
    text,
    font: runFontFamily,
    size: Math.max(2, sizeHalfPoints),
    characterSpacing: Number.isFinite(run._characterSpacing)
      ? run._characterSpacing
      : (compactChartLabel ? -2 : undefined),
    scale,
    color: String(runColor || '#000000').replace('#', ''),
    bold: run.bold ?? fallback.bold ?? fallback.fontWeight === 'bold',
    italics: run.italic ?? fallback.italic ?? fallback.fontStyle === 'italic',
    underline: (run.underline || fallback.underline) ? { type: 'single' } : undefined,
    // w:position is stored in half-points. Passing a CSS-style value such as
    // "3.6pt" produces invalid OOXML that Word can render as displaced or
    // overprinted script text, especially inside compact table values.
    position: hasMeasuredBaselineShift && !nativeScript ? Math.round(baselineShiftPt * 2) : undefined,
    superScript: nativeScript
      ? run._verticalAlign === 'superscript'
      : !hasMeasuredBaselineShift && !!(run.superScript || fallback.superScript || run._verticalAlign === 'superscript'),
    subScript: nativeScript
      ? run._verticalAlign === 'subscript'
      : !hasMeasuredBaselineShift && !!(run.subScript || fallback.subScript || run._verticalAlign === 'subscript')
  });
}

function sourceRunBaselineY(run) {
  const explicit = Number(run?._sourceBaselineY);
  if (Number.isFinite(explicit)) return explicit;
  const y = Number(run?._sourceY);
  const height = Number(run?._sourceHeight);
  return Number.isFinite(y) && Number.isFinite(height) ? y + height * (0.85 / 1.2) : y;
}

function nearestInlineBodyAnchor(candidate, anchors, xKey, endKey, widthKey) {
  if (!candidate || !Array.isArray(anchors)) return null;
  const x = Number(candidate?.[xKey]);
  const right = Number(candidate?.[endKey] ?? (x + Number(candidate?.[widthKey] || 0)));
  if (!Number.isFinite(x) || !Number.isFinite(right)) return null;
  let best = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    if (!anchor || anchor === candidate) continue;
    const anchorX = Number(anchor?.[xKey]);
    const anchorRight = Number(anchor?.[endKey] ?? (anchorX + Number(anchor?.[widthKey] || 0)));
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorRight)) continue;
    const gap = Math.max(0, Math.max(x - anchorRight, anchorX - right));
    if (gap < bestGap) {
      best = anchor;
      bestGap = gap;
    }
  }
  return best ? { anchor: best, gap: bestGap } : null;
}

function markInlineScriptRuns(sourceRuns) {
  if (!Array.isArray(sourceRuns) || sourceRuns.length < 2) return sourceRuns || [];
  const runs = sourceRuns.map(run => ({ ...run }));
  const visible = runs.filter(run => String(run?.text || '').trim() &&
    Number.isFinite(Number(run?._sourceY)) &&
    Number.isFinite(Number(run?._sourceX)));
  if (visible.length < 2) return runs;

  const sourceFontPt = run => Number(run?._sourceFontSize || run?.fontSize || 0);
  const bodyFontPt = Math.max(...visible.map(sourceFontPt).filter(value => Number.isFinite(value) && value > 0));
  if (!Number.isFinite(bodyFontPt) || bodyFontPt <= 0) return runs;
  const bodyRuns = visible.filter(run => sourceFontPt(run) >= bodyFontPt * 0.9);
  if (!bodyRuns.length) return runs;
  // PDF.js sometimes reports an inline script with the same nominal font size
  // as its base text even though the PDF positions it on a shifted baseline.
  // The widest body run is a more stable baseline anchor than a median that
  // can accidentally select a one-character subscript.
  const bodyRun = bodyRuns.reduce((best, run) =>
    Number(run._sourceWidth || 0) > Number(best._sourceWidth || 0) ? run : best
  , bodyRuns[0]);
  const bodyY = sourceRunBaselineY(bodyRun);
  const bodyFontPx = bodyFontPt * RENDER_SCALE;
  const ordered = visible.slice().sort((a, b) => Number(a._sourceX) - Number(b._sourceX));

  for (const run of runs) {
    const text = String(run?.text || '').trim();
    const fontPt = sourceFontPt(run);
    const restoredMathIdentifier = !!run?._restoredMathIdentifier &&
      /^[A-Za-z]+(?:_[A-Za-z]+)+$/.test(text);
    if (run?._disableScriptDetection) continue;
    // Monospaced literals often sit on a deliberately lower baseline beside a
    // larger prose label (for example, "Input = [CLS] ..."). That is a font
    // change, not subscript notation; turning it into w:position clips the
    // code line and shifts following literal text in Word.
    if (isCodeLikeSegment(run)) continue;
    if (!text || (!restoredMathIdentifier &&
        (text.length > 8 || !/^[\p{L}\p{N}*+\-.,()]+$/u.test(text))) ||
        !Number.isFinite(fontPt)) continue;
    const orderIndex = ordered.indexOf(run);
    if (orderIndex < 0) continue;
    const x = Number(run._sourceX);
    const right = Number(run._sourceEnd ?? (x + Number(run._sourceWidth || 0)));
    const previous = ordered[orderIndex - 1];
    const next = ordered[orderIndex + 1];
    const previousGap = previous
      ? x - Number(previous._sourceEnd ?? (Number(previous._sourceX) + Number(previous._sourceWidth || 0)))
      : Number.POSITIVE_INFINITY;
    const nextGap = next ? Number(next._sourceX) - right : Number.POSITIVE_INFINITY;
    if (Math.min(Math.abs(previousGap), Math.abs(nextGap)) > bodyFontPx * 0.45) continue;
    const nearbyBody = nearestInlineBodyAnchor(run, bodyRuns, '_sourceX', '_sourceEnd', '_sourceWidth');
    const localBodyRun = nearbyBody && nearbyBody.gap <= bodyFontPx * 3 ? nearbyBody.anchor : bodyRun;
    const localBodyFontPt = Math.max(fontPt, sourceFontPt(localBodyRun) || bodyFontPt);
    const localBodyFontPx = localBodyFontPt * RENDER_SCALE;
    const localBodyY = Number.isFinite(sourceRunBaselineY(localBodyRun)) ? sourceRunBaselineY(localBodyRun) : bodyY;
    const yDelta = sourceRunBaselineY(run) - localBodyY;
    if (Math.abs(yDelta) < localBodyFontPx * 0.04 || Math.abs(yDelta) > localBodyFontPx * 0.7) continue;
    const isSmallerScript = fontPt <= localBodyFontPt * 0.82;
    const isShiftedSingleGlyph = text.length <= 2 && fontPt <= localBodyFontPt * 1.05 &&
      Math.abs(yDelta) >= localBodyFontPx * 0.12;
    // Some PDFs encode an attached word subscript (for example a model
    // variant) at the body's nominal size and distinguish it only by its
    // baseline. Limit this fallback to unspaced all-cap tokens so ordinary
    // prose fragments cannot be mistaken for script text.
    const isShiftedAttachedWord = !run._sourceSpaceBefore && previous &&
      previousGap >= -localBodyFontPx * 0.08 && previousGap <= localBodyFontPx * 0.45 &&
      /^[A-Z]{2,8}$/.test(text) &&
      fontPt <= localBodyFontPt * 1.05 && Math.abs(yDelta) >= localBodyFontPx * 0.08;
    const sourceSpacedWord = run._sourceSpaceBefore &&
      /^[\p{L}][\p{L}'\u2019.-]*[.,;:!?]?$/u.test(text);
    if (sourceSpacedWord) continue;
    if (!isSmallerScript && !isShiftedSingleGlyph && !isShiftedAttachedWord) continue;
    if (isShiftedAttachedWord && !isSmallerScript) {
      const visualScriptFontPt = localBodyFontPt * 0.72;
      run.fontSize = visualScriptFontPt;
      run._sourceFontSize = visualScriptFontPt;
    }
    run._verticalAlign = yDelta > 0 ? 'subscript' : 'superscript';
    run._scriptBaseFontSize = localBodyFontPt;
    run._baselineShiftPt = Math.max(-localBodyFontPt * 0.45, Math.min(localBodyFontPt * 0.45, -yDelta / RENDER_SCALE));
  }
  return runs;
}

function normalizeMeasuredInlineRuns(sourceRuns) {
  if (!Array.isArray(sourceRuns) || sourceRuns.length < 2) return sourceRuns || [];
  const runs = sourceRuns.map(run => ({ ...run }));
  const visible = runs.filter(run =>
    String(run?.text || '').trim() &&
    Number.isFinite(sourceRunBaselineY(run)) &&
    Number.isFinite(Number(run?._sourceX))
  );
  if (visible.length < 2) return runs;

  // A style/font change can have a different top/ascent while still sharing
  // the exact PDF baseline with the surrounding words. Earlier extraction
  // stages may have classified that ascent difference as a script. Measured
  // baseline agreement is authoritative: clear only inferred script metadata,
  // leaving native PDF super/subscript information untouched.
  for (const run of visible) {
    if (!run?._verticalAlign || run?._nativeScript) continue;
    const baseline = sourceRunBaselineY(run);
    const fontPx = Math.max(
      1,
      Number(run?._sourceFontSize || run?.fontSize || 0) * RENDER_SCALE
    );
    const sameBaselinePeer = visible.some(peer =>
      peer !== run &&
      !peer?._nativeScript &&
      Math.abs(sourceRunBaselineY(peer) - baseline) <= Math.max(0.75, fontPx * 0.035)
    );
    if (sameBaselinePeer) {
      run._verticalAlign = undefined;
      run._baselineShiftPt = undefined;
      continue;
    }
    const bodyPeers = visible.filter(peer =>
      peer !== run &&
      !peer?._verticalAlign &&
      Number(peer?._sourceFontSize || peer?.fontSize || 0) >=
        Number(run?._sourceFontSize || run?.fontSize || 0) * 0.95
    );
    const nearbyBody = nearestInlineBodyAnchor(
      run,
      bodyPeers,
      '_sourceX',
      '_sourceEnd',
      '_sourceWidth'
    );
    if (!nearbyBody || nearbyBody.gap > fontPx * 1.2) continue;
    const baselineDelta = baseline - sourceRunBaselineY(nearbyBody.anchor);
    if (Math.abs(baselineDelta) < fontPx * 0.08 ||
        Math.abs(baselineDelta) > fontPx * 0.8) continue;
    run._verticalAlign = baselineDelta > 0 ? 'subscript' : 'superscript';
    run._baselineShiftPt = Math.max(
      -fontPx / RENDER_SCALE * 0.45,
      Math.min(fontPx / RENDER_SCALE * 0.45, -baselineDelta / RENDER_SCALE)
    );
  }

  const joined = visible.map(run => String(run?.text || '').trim()).join(' ');
  const proseLike = looksLikeBodyProseText(joined) ||
    looksLikeNaturalLanguageFragmentText(joined) ||
    (joined.length >= 24 && /\b(?:and|are|as|at|by|for|from|in|is|of|on|or|the|to|with)\b/i.test(joined));
  if (!proseLike) return runs;

  // PDF text items often omit their trailing space and encode it only as a
  // measured gap before the next item. Preserve that gap as an editable Word
  // space after script normalization, rather than joining words such as
  // "around" + "the" + "world".
  const ordered = visible.slice().sort((a, b) =>
    Number(a._sourceX) - Number(b._sourceX)
  );
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    const previousText = String(previous?.text || '');
    const currentText = String(current?.text || '');
    if (!previousText || !currentText || /^\s/.test(currentText)) continue;
    if (previous?._verticalAlign || current?._verticalAlign) continue;
    const previousEnd = Number(previous?._sourceEnd ??
      (Number(previous?._sourceX) + Number(previous?._sourceWidth || 0)));
    const gap = Number(current?._sourceX) - previousEnd;
    const fontPx = Math.max(
      1,
      Number(previous?._sourceFontSize || previous?.fontSize || 0) * RENDER_SCALE,
      Number(current?._sourceFontSize || current?.fontSize || 0) * RENDER_SCALE
    );
    const baselineGap = Math.abs(sourceRunBaselineY(current) - sourceRunBaselineY(previous));
    if (baselineGap > Math.max(1, fontPx * 0.08)) continue;
    if (shouldInsertVisualSpace(previousText, currentText, gap, fontPx)) {
      current.text = ` ${currentText}`;
      current._sourceSpaceBefore = true;
    }
  }
  return runs;
}

function markInlineScriptSegments(segments) {
  if (!Array.isArray(segments) || segments.length < 2) return segments || [];
  const visible = segments.filter(seg => String(seg?._text || '').trim() &&
    Number.isFinite(Number(seg?._baselineY)) && Number.isFinite(Number(seg?._x)));
  if (visible.length < 2) return segments;
  const bodyFontPx = Math.max(...visible.map(seg => Number(seg?._fs || 0)).filter(value => value > 0));
  if (!Number.isFinite(bodyFontPx) || bodyFontPx <= 0) return segments;
  const bodySegments = visible.filter(seg => Number(seg._fs || 0) >= bodyFontPx * 0.9);
  if (!bodySegments.length) return segments;
  const body = bodySegments.reduce((best, seg) =>
    Number(seg._width || 0) > Number(best._width || 0) ? seg : best, bodySegments[0]);
  const bodyBaseline = Number(body._baselineY);
  const ordered = visible.slice().sort((a, b) => Number(a._x) - Number(b._x));
  const separateNaturalLineRuns = new Set();
  let naturalLineCohort = [];
  const flushNaturalLineCohort = () => {
    if (naturalLineCohort.length >= 2) {
      const wordRuns = naturalLineCohort.filter(seg =>
        /^[\p{L}][\p{L}'\u2019.-]*[.,;:!?]?$/u.test(String(seg?._text || '').trim())
      );
      const textLength = naturalLineCohort.reduce(
        (sum, seg) => sum + String(seg?._text || '').trim().length,
        0
      );
      if (wordRuns.length >= 2 && textLength >= 8) {
        naturalLineCohort.forEach(seg => separateNaturalLineRuns.add(seg));
        for (let index = 1; index < naturalLineCohort.length; index++) {
          const previous = naturalLineCohort[index - 1];
          const current = naturalLineCohort[index];
          const gap = Number(current._x) - Number(previous._end ?? (
            Number(previous._x) + Number(previous._width || 0)
          ));
          if (current._itemIdx !== previous._itemIdx &&
              shouldInsertVisualSpace(previous._text, current._text, gap, Number(current._fs || 0))) {
            current._sourceSpaceBefore = true;
          }
        }
      }
    }
    naturalLineCohort = [];
  };
  for (const seg of ordered) {
    if (!naturalLineCohort.length) {
      naturalLineCohort.push(seg);
      continue;
    }
    const previous = naturalLineCohort[naturalLineCohort.length - 1];
    const previousRight = Number(previous._end ?? (
      Number(previous._x) + Number(previous._width || 0)
    ));
    const gap = Number(seg._x) - previousRight;
    const sameBaseline = Math.abs(Number(seg._baselineY) - Number(previous._baselineY)) <=
      Math.max(1, Math.min(Number(seg._fs || 0), Number(previous._fs || 0)) * 0.08);
    const similarSize = Math.min(Number(seg._fs || 0), Number(previous._fs || 0)) /
      Math.max(1, Number(seg._fs || 0), Number(previous._fs || 0)) >= 0.9;
    if (sameBaseline && similarSize && gap >= -bodyFontPx * 0.08 && gap <= bodyFontPx * 0.8) {
      naturalLineCohort.push(seg);
    } else {
      flushNaturalLineCohort();
      naturalLineCohort.push(seg);
    }
  }
  flushNaturalLineCohort();

  for (const seg of visible) {
    const text = String(seg._text || '').trim();
    const fontPx = Number(seg._fs || 0);
    const restoredMathIdentifier = !!seg?._restoredMathIdentifier &&
      /^[A-Za-z]+(?:_[A-Za-z]+)+$/.test(text);
    if (seg?._disableScriptDetection) continue;
    if (isCodeLikeSegment(seg)) continue;
    if (separateNaturalLineRuns.has(seg)) continue;
    if (!text || (!restoredMathIdentifier &&
        (text.length > 8 || !/^[\p{L}\p{N}*+\-.,()]+$/u.test(text))) || !fontPx) continue;
    const index = ordered.indexOf(seg);
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const right = Number(seg._end ?? (Number(seg._x) + Number(seg._width || 0)));
    const previousGap = previous
      ? Number(seg._x) - Number(previous._end ?? (Number(previous._x) + Number(previous._width || 0)))
      : Number.POSITIVE_INFINITY;
    const nextGap = next ? Number(next._x) - right : Number.POSITIVE_INFINITY;
    if (Math.min(Math.abs(previousGap), Math.abs(nextGap)) > bodyFontPx * 0.45) continue;
    const nearbyBody = nearestInlineBodyAnchor(seg, bodySegments, '_x', '_end', '_width');
    const localBody = nearbyBody && nearbyBody.gap <= bodyFontPx * 3 ? nearbyBody.anchor : body;
    const localBodyFontPx = Math.max(fontPx, Number(localBody?._fs || bodyFontPx));
    const localBodyBaseline = Number.isFinite(Number(localBody?._baselineY)) ? Number(localBody._baselineY) : bodyBaseline;
    const baselineDelta = Number(seg._baselineY) - localBodyBaseline;
    if (Math.abs(baselineDelta) < localBodyFontPx * 0.04 || Math.abs(baselineDelta) > localBodyFontPx * 0.7) continue;
    const smallerScript = fontPx <= localBodyFontPx * 0.82;
    const shiftedGlyph = text.length <= 2 && fontPx <= localBodyFontPx * 1.05 &&
      Math.abs(baselineDelta) >= localBodyFontPx * 0.12;
    const shiftedAttachedWord = !seg._sourceSpaceBefore && previous &&
      previousGap >= -localBodyFontPx * 0.08 && previousGap <= localBodyFontPx * 0.45 &&
      /^[A-Z]{2,8}$/.test(text) &&
      fontPx <= localBodyFontPx * 1.05 && Math.abs(baselineDelta) >= localBodyFontPx * 0.08;
    const previousText = String(previous?._text || '').trim();
    const inferredSpacedProseWord = !seg._sourceSpaceBefore && previous &&
      seg._itemIdx !== previous._itemIdx &&
      previousGap > Math.max(0.75, localBodyFontPx * 0.05) &&
      previousGap <= localBodyFontPx * 0.45 &&
      /[\p{L}]$/u.test(previousText) &&
      /^[\p{L}][\p{L}'\u2019.-]*[.,;:!?]?$/u.test(text);
    if (inferredSpacedProseWord) seg._sourceSpaceBefore = true;
    const sourceSpacedWord = seg._sourceSpaceBefore &&
      /^[\p{L}][\p{L}'\u2019.-]*[.,;:!?]?$/u.test(text);
    if (sourceSpacedWord) continue;
    // Small-cap typography commonly stores the initial capital in a separate
    // font object whose ascent differs slightly from the following lowercase
    // letters. That font-metric difference is not a script baseline. Keeping
    // an attached "B" + "idirectional" (and similar words) on the body
    // baseline also avoids Word inserting a visible gap between the runs.
    const attachedCapitalWordStart = /^[A-Z]$/.test(text) &&
      fontPx >= localBodyFontPx * 0.9 &&
      next && /^[a-z]/.test(String(next._text || '').trim()) &&
      nextGap >= -localBodyFontPx * 0.08 && nextGap <= localBodyFontPx * 0.16;
    if (attachedCapitalWordStart) continue;
    if (!smallerScript && !shiftedGlyph && !shiftedAttachedWord) continue;
    if (shiftedAttachedWord && !smallerScript) seg._fs = localBodyFontPx * 0.72;
    seg._verticalAlign = baselineDelta > 0 ? 'subscript' : 'superscript';
    seg._baselineShiftPt = Math.max(
      -localBodyFontPx / RENDER_SCALE * 0.45,
      Math.min(localBodyFontPx / RENDER_SCALE * 0.45, -baselineDelta / RENDER_SCALE)
    );
  }
  return segments;
}

function shouldInsertVisualSpace(prevText, nextText, gap, fontSize) {
  const prev = String(prevText || '');
  const next = String(nextText || '');
  if (!prev || !next) return false;
  if (/^[0-9]+$/.test(next) && /\[[\d,\s]*,$/.test(prev)) return true;
  if (gap <= fontSize * 0.15) return false;
  if (/[\[(\/]$/.test(prev)) return false;
  if (/^[\]\),.;:%]/.test(next)) return false;
  if (/^[0-9]+$/.test(next) && /\[$/.test(prev)) return false;
  if (/^[0-9]+$/.test(next) && /,$/.test(prev) && gap <= fontSize * 0.08) return false;
  return !/\s$/.test(prev);
}

function shouldInsertRunSpace(prevRun, nextRun, prevText, nextText, gap, fontSize) {
  if (nextRun?._verticalAlign) return false;
  if (prevRun?._verticalAlign) return /^[A-Za-z]/.test(String(nextText || ''));
  if (prevRun?._itemIdx === nextRun?._itemIdx &&
      (prevRun?._preserveItemWhitespace || nextRun?._preserveItemWhitespace)) {
    return !!nextRun?._sourceSpaceBefore;
  }
  // Token splitting used for linked/editable text temporarily removes source
  // whitespace into its own measured part. Preserve that explicit boundary;
  // its visual width can be slightly smaller than the inferred-space cutoff.
  if (prevRun?._itemIdx === nextRun?._itemIdx && nextRun?._sourceSpaceBefore) return true;
  if (isCodeLikeSegment(prevRun) && isCodeLikeSegment(nextRun) &&
      isCodePunctuationBoundary(prevText, nextText)) return false;
  return shouldInsertVisualSpace(prevText, nextText, gap, fontSize);
}

function segmentBoundaryGap(prevRun, nextRun) {
  const sameItem = prevRun?._itemIdx === nextRun?._itemIdx;
  const rawEnd = Number(prevRun?._rawEnd);
  const rawX = Number(nextRun?._rawX);
  if (!sameItem && Number.isFinite(rawEnd) && Number.isFinite(rawX)) {
    return rawX - rawEnd;
  }
  return Number(nextRun?._x || 0) - Number(prevRun?._end || 0);
}

function parseHexColor(value) {
  const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function isBlueOrTealColor(value) {
  const rgb = parseHexColor(value);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  return (b > r + 35 && g > r + 20) || (b > r + 55);
}

function isSaturatedNonNeutralColor(value) {
  const rgb = parseHexColor(value);
  if (!rgb) return false;
  const channels = [rgb.r, rgb.g, rgb.b];
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  return max > 105 && max - min > 55;
}

function isNeutralGrayTextColor(value) {
  const rgb = parseHexColor(value);
  if (!rgb) return false;
  const channels = [rgb.r, rgb.g, rgb.b];
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  return max >= 70 && max <= 190 && max - min <= 12;
}

function isNearWhiteTextColor(value) {
  const rgb = parseHexColor(value);
  if (!rgb) return false;
  const channels = [rgb.r, rgb.g, rgb.b];
  const min = Math.min(...channels);
  const max = Math.max(...channels);
  return min >= 220 && max - min <= 18;
}

function looksLikeBodyProseText(text) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length < 42) return false;
  if (/https?:|www\.|[{}]|=>|==|:=|^\s*(from|import|const|let|var|def|class|print)\b/i.test(trimmed)) return false;
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  if (words.length < 6) return false;
  const lowerWords = words.filter(word => /^[a-z][a-z'-]{2,}$/.test(word)).length;
  return lowerWords / words.length >= 0.55;
}

function looksLikeNaturalLanguageFragmentText(text) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length < 18 || trimmed.length > 100) return false;
  if (/https?:|www\.|[{}]|=>|==|:=|^\s*(from|import|const|let|var|def|class|print)\b/i.test(trimmed)) return false;
  if (looksLikeInternalLinkToken(trimmed)) return false;
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  if (words.length < 3) return false;
  const lowerWords = words.filter(word => /^[a-z][a-z'-]{2,}$/.test(word)).length;
  return lowerWords / words.length >= 0.7 && /(?:[a-z]|[)"'\]])[.!?]?$/.test(trimmed);
}

function normalizeLeakedBodyTextColor(text, color, fontFamily = '') {
  if (/courier|mono/i.test(String(fontFamily || ''))) return color || '#000000';
  const leakedBodyColor = looksLikeBodyProseText(text) || isCaptionLikeText(text) ||
    looksLikeNaturalLanguageFragmentText(text);
  if (!leakedBodyColor) return color || '#000000';
  if (isBlueOrTealColor(color) || isSaturatedNonNeutralColor(color)) return '#000000';
  return color || '#000000';
}

function textColorContextForRun(runText, lineText) {
  const run = String(runText || '').trim();
  if (!run) return runText;
  const line = String(lineText || '').replace(/\s+/g, ' ').trim();
  const captionNumberToken = isCaptionLikeText(line) && /^[A-Za-z]?\d+[A-Za-z]?\s*[:.]$/.test(run);
  if ((looksLikeInternalLinkToken(run) && !captionNumberToken) || /https?:|www\./i.test(run)) return runText;
  if (
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,}$/.test(run) &&
    (/[0-9_:/-]/.test(run) || /\.[A-Za-z0-9]/.test(run))
  ) return runText;
  return line && (
    isCaptionLikeText(line) ||
    looksLikeBodyProseText(line) ||
    looksLikeNaturalLanguageFragmentText(line)
  ) ? line : runText;
}

function normalizedRunTextColor(runText, lineText, color, fontFamily = '') {
  return normalizeLeakedBodyTextColor(textColorContextForRun(runText, lineText), color, fontFamily);
}

function colorLuminance(value) {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  return (rgb.r + rgb.g + rgb.b) / 3;
}

function repairLowContrastTextColor(color, backgroundColor) {
  const fg = colorLuminance(color);
  const bg = colorLuminance(backgroundColor);
  if (fg == null || bg == null) return color || '#000000';
  if (Math.abs(fg - bg) < 58) return bg < 128 ? '#ffffff' : '#000000';
  if (bg < 88 && fg < 150) return '#ffffff';
  if (bg > 218 && fg > 218) return '#000000';
  return color || '#000000';
}

function repairTextColorsFromCanvas(textObjs, canvas) {
  if (!Array.isArray(textObjs) || !canvas?.width) return textObjs || [];
  return textObjs.map(obj => {
    const d = obj?.data || {};
    const lineBoxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length
      ? d._lineBoxes
      : [{ x: obj.x, y: obj.y, width: obj.width, height: obj.height }];
    const lines = Array.isArray(d.lines) ? d.lines : [];
    let changed = false;
    const repairedLines = lines.map((line, index) => {
      const box = lineBoxes[index] || lineBoxes[0];
      const bg = _sampleCanvasColor(canvas, box);
      return (line || []).map(run => {
        const repaired = repairLowContrastTextColor(run?.color || d.color || '#000000', bg);
        if (repaired.toLowerCase() === String(run?.color || '').toLowerCase()) return run;
        changed = true;
        return { ...run, color: repaired };
      });
    });
    const firstBg = _sampleCanvasColor(canvas, lineBoxes[0]);
    const repairedBaseColor = repairLowContrastTextColor(d.color || '#000000', firstBg);
    if (!changed && repairedBaseColor.toLowerCase() === String(d.color || '').toLowerCase()) return obj;
    return {
      ...obj,
      data: {
        ...d,
        color: repairedBaseColor,
        lines: repairedLines.length ? repairedLines : d.lines,
        _originalStyle: d._originalStyle ? { ...d._originalStyle, color: repairedBaseColor } : d._originalStyle
      }
    };
  });
}

function colorDistanceFromCanvasBackground(color, background) {
  const fg = parseHexColor(color);
  const bg = parseHexColor(background);
  if (!fg || !bg) return 0;
  return Math.abs(fg.r - bg.r) + Math.abs(fg.g - bg.g) + Math.abs(fg.b - bg.b);
}

function dominantCanvasColorInfo(pixels, width, height) {
  if (!pixels || !width || !height) return null;
  const buckets = new Map();
  let sampledCount = 0;
  const area = width * height;
  const stride = area <= 2600 ? 1 : Math.max(1, Math.floor(Math.sqrt(area / 2400)));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4;
      if (pixels[index + 3] < 80) continue;
      sampledCount++;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      // Quantization groups anti-aliased shades with their flat page/card fill.
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return null;
  return {
    color: `#${Math.round(best.r / best.count).toString(16).padStart(2, '0')}${Math.round(best.g / best.count).toString(16).padStart(2, '0')}${Math.round(best.b / best.count).toString(16).padStart(2, '0')}`,
    share: best.count / Math.max(1, sampledCount)
  };
}

function dominantCanvasRegionColorInfo(snapshot, x, y, width, height) {
  if (!snapshot?.data || !width || !height) return null;
  const buckets = new Map();
  let sampledCount = 0;
  const area = width * height;
  const stride = area <= 2600 ? 1 : Math.max(1, Math.floor(Math.sqrt(area / 2400)));
  for (let yy = 0; yy < height; yy += stride) {
    for (let xx = 0; xx < width; xx += stride) {
      const index = ((y + yy) * snapshot.width + x + xx) * 4;
      if (snapshot.data[index + 3] < 80) continue;
      sampledCount++;
      const r = snapshot.data[index];
      const g = snapshot.data[index + 1];
      const b = snapshot.data[index + 2];
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return null;
  return {
    color: `#${Math.round(best.r / best.count).toString(16).padStart(2, '0')}${Math.round(best.g / best.count).toString(16).padStart(2, '0')}${Math.round(best.b / best.count).toString(16).padStart(2, '0')}`,
    share: best.count / Math.max(1, sampledCount)
  };
}

function dominantCanvasColor(pixels, width, height) {
  return dominantCanvasColorInfo(pixels, width, height)?.color || null;
}

function sampleCanvasInkColor(canvas, box, options = {}) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || !canvas?.width || !canvas?.height || !box) return null;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
  const sx = clamp(Number(box.x || 0), 0, canvas.width - 1);
  const sy = clamp(Number(box.y || 0), 0, canvas.height - 1);
  const ex = clamp(Number(box.x || 0) + Math.max(1, Number(box.width || 1)), 0, canvas.width);
  const ey = clamp(Number(box.y || 0) + Math.max(1, Number(box.height || 1)), 0, canvas.height);
  const width = Math.max(1, ex - sx);
  const height = Math.max(1, ey - sy);
  const sampleBox = { x: sx, y: sy, width, height };
  const interiorBackground = options.useInteriorBackground
    ? dominantCanvasRegionColorInfo(snapshot, sx, sy, width, height)
    : null;
  const background = options.useInteriorBackground
    ? (interiorBackground?.color || _sampleCanvasColor(canvas, sampleBox))
    : _sampleCanvasBorderColor(canvas, sampleBox);
  const bg = parseHexColor(background);
  if (!bg) return null;
  const area = width * height;
  const stride = area <= 2600 ? 1 : Math.max(1, Math.floor(Math.sqrt(area / 1600)));
  const buckets = new Map();
  let sampledCount = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = ((sy + y) * snapshot.width + sx + x) * 4;
      if (snapshot.data[index + 3] < 80) continue;
      sampledCount++;
      const r = snapshot.data[index];
      const g = snapshot.data[index + 1];
      const b = snapshot.data[index + 2];
      const contrast = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      if (contrast < 44) continue;
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      const bucket = buckets.get(key) || { count: 0, contrast: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.contrast += contrast;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  let best = null;
  let bestDarkNeutral = null;
  let bestLightNeutral = null;
  let bestChromatic = null;
  const minimumDarkNeutralSamples = Math.max(3, Math.floor(sampledCount * 0.025));
  const minimumLightNeutralSamples = Math.max(2, Math.floor(sampledCount * 0.01));
  const minimumChromaticSamples = Math.max(3, Math.floor(sampledCount * 0.01));
  const darkBackground = colorLuminance(background) < 115;
  const backgroundChroma = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
  for (const bucket of buckets.values()) {
    const score = bucket.contrast + bucket.count * 18;
    if (!best || score > best.score) best = { ...bucket, score };
    const avgR = bucket.r / bucket.count;
    const avgG = bucket.g / bucket.count;
    const avgB = bucket.b / bucket.count;
    const max = Math.max(avgR, avgG, avgB);
    const min = Math.min(avgR, avgG, avgB);
    const isDarkNeutral = max <= 195 && max - min <= 28;
    if (options.preferDarkNeutral && isDarkNeutral && bucket.count >= minimumDarkNeutralSamples) {
      if (!bestDarkNeutral || score > bestDarkNeutral.score) bestDarkNeutral = { ...bucket, score };
    }
    const isLightNeutral = min >= 185 && max - min <= 28;
    if (darkBackground && isLightNeutral && bucket.count >= minimumLightNeutralSamples) {
      const lightScore = max * 4 + bucket.count;
      if (!bestLightNeutral || lightScore > bestLightNeutral.lightScore) {
        bestLightNeutral = { ...bucket, score, lightScore };
      }
    }
    const isChromatic = max - min >= 48;
    if (options.preferChromatic && isChromatic && bucket.count >= minimumChromaticSamples) {
      const chromaticScore = bucket.contrast + bucket.count * 28;
      if (!bestChromatic || chromaticScore > bestChromatic.chromaticScore) {
        bestChromatic = { ...bucket, score, chromaticScore };
      }
    }
  }
  if (bestDarkNeutral) best = bestDarkNeutral;
  // On a saturated backdrop, a substantial dark-neutral cluster is the text
  // ink, while the light cluster is often page/card spill inside a generous
  // PDF line box. On neutral dark fills, keep preferring genuine light text.
  if (bestLightNeutral && !(bestDarkNeutral && backgroundChroma >= 48)) best = bestLightNeutral;
  if (bestChromatic) best = bestChromatic;
  if (!best) return null;
  const color = `#${Math.round(best.r / best.count).toString(16).padStart(2, '0')}${Math.round(best.g / best.count).toString(16).padStart(2, '0')}${Math.round(best.b / best.count).toString(16).padStart(2, '0')}`;
  return {
    color,
    background,
    contrast: colorDistanceFromCanvasBackground(color, background),
    backgroundShare: interiorBackground?.share || 0,
    inkShare: best.count / Math.max(1, sampledCount)
  };
}

function sampleCanvasTextInkColor(canvas, box, extractedColor, options = {}) {
  const borderSample = sampleCanvasInkColor(canvas, box, {
    ...options,
    useInteriorBackground: false
  });
  const interiorSample = sampleCanvasInkColor(canvas, box, {
    ...options,
    useInteriorBackground: true,
    preferDarkNeutral: false
  });
  if (!interiorSample || interiorSample.backgroundShare < 0.52) return borderSample;
  const backgroundLum = colorLuminance(interiorSample.background);
  const inkLum = colorLuminance(interiorSample.color);
  const extractedContrast = colorDistanceFromCanvasBackground(extractedColor, interiorSample.background);
  const isDominantDarkFill = backgroundLum != null && backgroundLum < 115;
  const isLightInk = inkLum != null && inkLum > 150;
  const backgroundRgb = parseHexColor(interiorSample.background);
  const inkRgb = parseHexColor(interiorSample.color);
  const chromaticBackground = backgroundRgb && Math.max(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b) - Math.min(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b) >= 48;
  const neutralInk = inkRgb && Math.max(inkRgb.r, inkRgb.g, inkRgb.b) - Math.min(inkRgb.r, inkRgb.g, inkRgb.b) <= 28;
  if (chromaticBackground && neutralInk && interiorSample.contrast >= 68) return interiorSample;
  if (isDominantDarkFill && isLightInk && extractedContrast < 65 &&
      interiorSample.contrast > extractedContrast + 45) {
    return interiorSample;
  }
  return borderSample;
}

function shouldReplaceWithCanvasInkColor(extractedColor, sampled) {
  if (!sampled?.color || sampled.contrast < 68) return false;
  const current = String(extractedColor || '#000000');
  const currentContrast = colorDistanceFromCanvasBackground(current, sampled.background);
  const sourceDistance = colorDistanceFromCanvasBackground(sampled.color, current);
  const sampledRgb = parseHexColor(sampled.color);
  if (!sampledRgb) return false;
  const sampledChroma = Math.max(sampledRgb.r, sampledRgb.g, sampledRgb.b) - Math.min(sampledRgb.r, sampledRgb.g, sampledRgb.b);
  const sampledNeutral = sampledChroma <= 24;
  const currentRgb = parseHexColor(current);
  const currentChroma = currentRgb
    ? Math.max(currentRgb.r, currentRgb.g, currentRgb.b) - Math.min(currentRgb.r, currentRgb.g, currentRgb.b)
    : 0;
  const backgroundRgb = parseHexColor(sampled.background);
  const currentNeutral = currentRgb && Math.max(currentRgb.r, currentRgb.g, currentRgb.b) - Math.min(currentRgb.r, currentRgb.g, currentRgb.b) <= 24;
  const sampledLum = colorLuminance(sampled.color);
  const currentLum = colorLuminance(current);
  const backgroundLum = colorLuminance(sampled.background);
  const renderedLightTextDisagreesWithDarkExtraction = sampledNeutral && currentNeutral &&
    sampledLum > 215 && currentLum < 90 && sourceDistance > 300 &&
    sampled.contrast >= 68 && Number(sampled.inkShare || 0) >= 0.01;
  // Some embedded neutral fonts expose a black operator color even though the
  // actual rendered glyph is intentionally gray. Require a clearly mid-tone
  // rendered cluster on a light background so ordinary black anti-aliasing is
  // not mistaken for deliberate gray text.
  const renderedGrayTextDisagreesWithBlackExtraction = sampledNeutral && currentNeutral &&
    currentLum < 38 && sampledLum >= 52 && sampledLum <= 185 && backgroundLum > 205 &&
    sourceDistance > 68 && Number(sampled.inkShare || 0) >= 0.018;
  const dominantChannel = rgb => {
    if (!rgb) return -1;
    const channels = [rgb.r, rgb.g, rgb.b];
    return channels.indexOf(Math.max(...channels));
  };
  const chromaticHueMismatch = currentRgb &&
    currentChroma >= 48 && sampledChroma >= 48 &&
    dominantChannel(currentRgb) !== dominantChannel(sampledRgb) &&
    sourceDistance > 110 && sampled.contrast >= 80 && Number(sampled.inkShare || 0) >= 0.012;
  // DeviceN/ICC operators can report white (or a saturated fallback) for
  // visible neutral ink. Replace only an implausible operator color, never a
  // normal deliberate accent color that agrees with the rendered page.
  return (currentContrast < 42 && sampled.contrast > currentContrast + 42) ||
    (backgroundRgb && backgroundLum < 90 && currentNeutral && sampledNeutral && sampledLum > 110 &&
      sampledLum > currentLum + 12 && sampled.contrast > currentContrast + 32) ||
    (isNearWhiteTextColor(current) && sampledNeutral && sourceDistance > 120) ||
    (sourceDistance > 150 && sampledNeutral &&
      (isBlueOrTealColor(current) || isSaturatedNonNeutralColor(current))) ||
    renderedLightTextDisagreesWithDarkExtraction ||
    renderedGrayTextDisagreesWithBlackExtraction ||
    chromaticHueMismatch;
}

function normalizeSampledTextColor(sampled) {
  if (!sampled?.color || !sampled?.background) return sampled?.color;
  const ink = parseHexColor(sampled.color);
  const background = parseHexColor(sampled.background);
  if (!ink || !background) return sampled.color;
  const neutralInk = Math.max(ink.r, ink.g, ink.b) - Math.min(ink.r, ink.g, ink.b) <= 24;
  if (neutralInk && colorLuminance(sampled.background) < 90 && colorLuminance(sampled.color) > 110) return '#ffffff';
  return sampled.color;
}

function looksLikeCorruptExtractedText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/[\uFFFD\uE000-\uF8FF]/.test(text)) return true;
  const letters = text.match(/[A-Za-z]/g) || [];
  if (letters.length < 14) return false;
  const tokens = text.match(/[A-Za-z]{2,}/g) || [];
  if (!tokens.length) return false;
  const upperLetters = letters.filter(ch => ch === ch.toUpperCase()).length;
  const vowels = letters.filter(ch => /[AEIOUaeiou]/.test(ch)).length;
  const longUpperTokens = tokens.filter(token => token.length >= 7 && token === token.toUpperCase()).length;
  const corruptUpperToken = tokens.some(token => {
    if (token.length < 6 || token !== token.toUpperCase()) return false;
    const tokenVowels = (token.match(/[AEIOU]/g) || []).length;
    return tokenVowels / token.length < 0.22;
  });
  const consonantRuns = (text.match(/[BCDFGHJKLMNPQRSTVWXYZ]{7,}/gi) || []).length;
  const upperRatio = upperLetters / letters.length;
  const vowelRatio = vowels / letters.length;
  if (corruptUpperToken || (letters.length >= 8 && upperRatio >= 0.72 && vowelRatio < 0.22)) return true;
  return (longUpperTokens >= 1 && upperRatio >= 0.58 && (vowelRatio < 0.24 || consonantRuns >= 1)) ||
    (longUpperTokens >= 2 && upperRatio >= 0.48) ||
    (consonantRuns >= 2 && upperRatio >= 0.42);
}

function findCorruptTextRegions(textObjs, canvas) {
  if (!Array.isArray(textObjs) || !canvas?.width || !canvas?.height) return [];
  const regions = [];
  for (const obj of textObjs) {
    const d = obj?.data || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
    lines.forEach((line, index) => {
      const text = (line || []).map(run => String(run?.text || '')).join('');
      if (!looksLikeCorruptExtractedText(text)) return;
      const box = boxes[index] || boxes[boxes.length - 1] || obj;
      const pad = Math.max(1.5, Math.min(5, Number(box.height || 0) * 0.18));
      regions.push({
        x: Math.max(0, Number(box.x ?? obj.x) - pad),
        y: Math.max(0, Number(box.y ?? obj.y) - pad),
        width: Math.min(canvas.width, Number(box.x ?? obj.x) + Number(box.width ?? obj.width) + pad) - Math.max(0, Number(box.x ?? obj.x) - pad),
        height: Math.min(canvas.height, Number(box.y ?? obj.y) + Number(box.height ?? obj.height) + pad) - Math.max(0, Number(box.y ?? obj.y) - pad),
        kind: 'corruptText',
        foreground: true
      });
    });
  }
  return regions;
}

function findPrivateUseGlyphRegions(textObjs, canvas) {
  if (!Array.isArray(textObjs) || !canvas?.width || !canvas?.height) return [];
  const regions = [];
  for (const obj of textObjs) {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    lines.forEach((line, index) => {
      const text = (line || []).map(run => String(run?.text || '')).join('');
      if (!/[\uE000-\uF8FF]/.test(text)) return;
      const box = boxes[index] || boxes[boxes.length - 1] || obj;
      const pad = Math.max(2, Math.min(8, Number(box.height || 0) * 0.22));
      regions.push({
        x: Math.max(0, Number(box.x ?? obj.x) - pad),
        y: Math.max(0, Number(box.y ?? obj.y) - pad),
        width: Math.min(canvas.width, Number(box.x ?? obj.x) + Number(box.width ?? obj.width) + pad) - Math.max(0, Number(box.x ?? obj.x) - pad),
        height: Math.min(canvas.height, Number(box.y ?? obj.y) + Number(box.height ?? obj.height) + pad) - Math.max(0, Number(box.y ?? obj.y) - pad),
        kind: 'privateUseGlyph',
        foreground: true
      });
    });
  }
  return regions;
}

function findUnstableMathGlyphRegions(textObjs, vectorObjs, canvas) {
  if (!Array.isArray(textObjs) || !canvas?.width || !canvas?.height) return [];
  const sourceRuns = (textObjs || []).flatMap(obj =>
    (Array.isArray(obj?.data?.lines) ? obj.data.lines : []).flatMap(line =>
      (Array.isArray(line) ? line : []).filter(hasSourceTextGeometry)
    )
  );
  const regions = [];
  for (const run of sourceRuns) {
    if (String(run?.text || '').trim() !== '√') continue;
    const rootBox = {
      x: Number(run._sourceX),
      y: Number(run._sourceY),
      width: Number(run._sourceWidth),
      height: Math.max(
        Number(run._sourceHeight || 0),
        Number(run._sourceFontSize || run.fontSize || 0) * RENDER_SCALE * 1.2
      )
    };
    if (![rootBox.x, rootBox.y, rootBox.width, rootBox.height].every(Number.isFinite) ||
        rootBox.width <= 0 || rootBox.height <= 0) continue;
    const fontPx = Math.max(rootBox.height, Number(run._sourceFontSize || run.fontSize || 0) * RENDER_SCALE);
    // Inline radicals belong to the surrounding editable prose. Rasterizing
    // them from the fully rendered page also captures ink from the line above
    // or beside them, which is then drawn a second time over Word's editable
    // text. Keep only isolated equation radicals on the raster path.
    const inlineProseNeighbor = sourceRuns.some(candidate => {
      if (candidate === run) return false;
      const text = String(candidate?.text || '').trim();
      if ((text.match(/[A-Za-z]{2,}/g) || []).length < 3) return false;
      const box = {
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY),
        width: Number(candidate._sourceWidth),
        height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
      };
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.width < fontPx * 5) return false;
      const horizontalGap = Math.max(
        0,
        rootBox.x - (box.x + box.width),
        box.x - (rootBox.x + rootBox.width)
      );
      const verticalGap = Math.max(
        0,
        rootBox.y - (box.y + box.height),
        box.y - (rootBox.y + rootBox.height)
      );
      return horizontalGap <= fontPx * 0.8 && verticalGap <= fontPx * 0.8;
    });
    if (inlineProseNeighbor) {
      // A standalone Unicode radical cannot stretch its overbar over the
      // radicand in Word. Preserve only the compact math fragment (optional
      // numerator, radical, radicand and its scripts) as one transparent crop.
      // The tight token/rule bounds avoid the neighbouring prose that caused
      // the old duplicate-text regression.
      const tightSearch = {
        x: rootBox.x - fontPx * 0.45,
        y: rootBox.y - fontPx * 0.7,
        width: rootBox.width + fontPx * 3.8,
        height: fontPx * 2.35
      };
      const compactRuns = sourceRuns.filter(candidate => {
        const text = String(candidate?.text || '').trim();
        if (candidate === run || !/^[\p{L}\p{N}]{1,2}$/u.test(text)) return candidate === run;
        const box = {
          x: Number(candidate._sourceX),
          y: Number(candidate._sourceY),
          width: Number(candidate._sourceWidth),
          height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
        };
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        return centerX >= tightSearch.x && centerX <= tightSearch.x + tightSearch.width &&
          centerY >= tightSearch.y && centerY <= tightSearch.y + tightSearch.height &&
          (/^[0-9]{1,2}$/.test(text) || box.y >= rootBox.y + rootBox.height * 0.35);
      });
      const nearbyRules = (vectorObjs || []).filter(vector => {
        const width = Math.max(0, Number(vector?.width || 0));
        const height = Math.max(0, Number(vector?.height || 0));
        return width >= 3 && width <= fontPx * 4.5 && height <= 5 &&
          rectIntersectionArea(vector, tightSearch) > 0;
      });
      const compactBounds = compactRuns.map(candidate => {
        const candidateHeight = Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0));
        const rootGlyph = candidate === run;
        const compactScript = !rootGlyph && candidateHeight <= fontPx * 0.78;
        return {
          x: Number(candidate._sourceX),
          // PDF.js places TeX radical ink down and right of its nominal text
          // origin. Start at the visible-glyph band so prose from the line
          // above cannot leak into the transparent math crop.
          y: Number(candidate._sourceY) + (rootGlyph ? candidateHeight * 0.58 : 0),
          width: Number(candidate._sourceWidth),
          height: rootGlyph ? candidateHeight * 0.42 : candidateHeight * (compactScript ? 0.78 : 1),
          maskPaddingLeft: rootGlyph ? Math.max(2.5, fontPx * 0.12) : 0.45,
          maskPaddingTop: rootGlyph ? 0.5 : 0.45,
          // TeX radical glyph ink is displaced down and right from PDF.js's
          // nominal text box. Retain that overhang so the check mark joins
          // its stem instead of appearing as a faint, detached fragment.
          maskPaddingRight: rootGlyph ? Math.max(6, fontPx * 0.28) : 0.45,
          maskPaddingBottom: rootGlyph ? Math.max(7, fontPx * 0.55) : compactScript ? 0.1 : 0.45
        };
      });
      const group = unionRects([rootBox, ...compactBounds, ...nearbyRules]) || rootBox;
      const pad = Math.max(5, fontPx * 0.24);
      const left = Math.max(0, group.x - pad);
      const top = Math.max(0, group.y - pad);
      const right = Math.min(canvas.width, group.x + group.width + pad);
      const bottom = Math.min(canvas.height, group.y + group.height + pad);
      regions.push({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        kind: 'mathGlyph',
        foreground: true,
        transparentBackground: true,
        mathRunBoxes: compactBounds,
        mathRemovalBoxes: compactRuns.map(candidate => ({
          x: Number(candidate._sourceX),
          y: Number(candidate._sourceY),
          width: Number(candidate._sourceWidth),
          height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
        })),
        mathRuleBoxes: nearbyRules.map(rule => ({
          x: Number(rule.x), y: Number(rule.y), width: Number(rule.width), height: Number(rule.height),
          maskPadding: 0.25
        }))
      });
      continue;
    }
    const lineSearch = {
      x: rootBox.x - fontPx * 0.8,
      y: rootBox.y - fontPx * 0.55,
      width: rootBox.width + fontPx * 6,
      height: fontPx * 2.2
    };
    const nearbyRules = (vectorObjs || []).filter(vector => {
      const width = Math.max(0, Number(vector?.width || 0));
      const height = Math.max(0, Number(vector?.height || 0));
      return width >= 3 && width <= fontPx * 8 && height <= 5 &&
        rectIntersectionArea(vector, lineSearch) > 0;
    });
    const ruleBounds = nearbyRules.length ? unionRects(nearbyRules) : rootBox;
    const horizontalRange = {
      x: Math.min(rootBox.x, ruleBounds.x) - 2,
      y: rootBox.y - fontPx * 1.1,
      width: Math.max(rootBox.x + rootBox.width, ruleBounds.x + ruleBounds.width) -
        Math.min(rootBox.x, ruleBounds.x) + 4,
      height: fontPx * 3.1
    };
    const groupedRuns = sourceRuns.filter(candidate => {
      const box = {
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY),
        width: Number(candidate._sourceWidth),
        height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
      };
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      return centerX >= horizontalRange.x && centerX <= horizontalRange.x + horizontalRange.width &&
        centerY >= horizontalRange.y && centerY <= horizontalRange.y + horizontalRange.height;
    });
    const runBounds = groupedRuns.map(candidate => {
      const candidateHeight = Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0));
      const rootGlyph = candidate === run;
      const compactScript = !rootGlyph && candidateHeight <= fontPx * 0.78;
      return {
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY) + (rootGlyph ? candidateHeight * 0.58 : 0),
        width: Number(candidate._sourceWidth),
        height: rootGlyph ? candidateHeight * 0.42 : candidateHeight * (compactScript ? 0.78 : 1),
        maskPaddingLeft: rootGlyph ? Math.max(2.5, fontPx * 0.12) : 0.45,
        maskPaddingTop: rootGlyph ? 0.5 : 0.45,
        maskPaddingRight: rootGlyph ? Math.max(6, fontPx * 0.28) : 0.45,
        maskPaddingBottom: rootGlyph ? Math.max(7, fontPx * 0.55) : compactScript ? 0.1 : 0.45
      };
    });
    const group = unionRects([rootBox, ...nearbyRules, ...runBounds]) || rootBox;
    const pad = Math.max(5, fontPx * 0.24);
    const left = Math.max(0, group.x - pad);
    const top = Math.max(0, group.y - pad);
    const right = Math.min(canvas.width, group.x + group.width + pad);
    const bottom = Math.min(canvas.height, group.y + group.height + pad);
    regions.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      kind: 'mathGlyph',
      foreground: true,
      transparentBackground: true,
      mathRunBoxes: runBounds,
      mathRemovalBoxes: groupedRuns.map(candidate => ({
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY),
        width: Number(candidate._sourceWidth),
        height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
      })),
      mathRuleBoxes: nearbyRules.map(rule => ({
        x: Number(rule.x), y: Number(rule.y), width: Number(rule.width), height: Number(rule.height),
        maskPadding: 0.25
      }))
    });
  }

  // Some TeX math fonts expose a summation glyph as the literal character
  // "P" while relying on the embedded font to draw ∑. If the glyph is kept as
  // editable fallback text, Word shows P and detaches the limits/subscripts.
  // Detect the geometry of a compact product/sum expression and preserve that
  // expression alone as one transparent foreground crop.
  for (const anchor of sourceRuns) {
    const anchorText = String(anchor?.text || '').trim();
    if (anchorText !== 'P' && anchorText !== '\u2211') continue;
    const anchorBox = {
      x: Number(anchor._sourceX),
      y: Number(anchor._sourceY),
      width: Number(anchor._sourceWidth),
      height: Math.max(1, Number(anchor._sourceHeight || anchor.fontSize || 0))
    };
    if (![anchorBox.x, anchorBox.y, anchorBox.width, anchorBox.height].every(Number.isFinite)) continue;
    const fontPx = Math.max(
      anchorBox.height,
      Number(anchor._sourceFontSize || anchor.fontSize || 0) * RENDER_SCALE
    );
    const search = {
      x: anchorBox.x - fontPx * 4.2,
      y: anchorBox.y - fontPx,
      width: fontPx * 10.5,
      height: fontPx * 3
    };
    const mathRuns = sourceRuns.filter(candidate => {
      const text = String(candidate?.text || '').trim();
      const compactMathToken = candidate === anchor || /^[\p{L}]$/u.test(text) || /^[\p{N}]{1,2}$/u.test(text) ||
        /^[=+·⋅*.,()\-]+$/u.test(text);
      if (!text || !compactMathToken) return false;
      const box = {
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY),
        width: Number(candidate._sourceWidth),
        height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
      };
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      return centerX >= search.x && centerX <= search.x + search.width &&
        centerY >= search.y && centerY <= search.y + search.height &&
        // A prose line immediately above the displayed formula can share the
        // same one-letter q/k tokens. Keep only the formula's baseline band.
        box.y >= anchorBox.y - fontPx * 0.75;
    });
    const texts = mathRuns.map(candidate => String(candidate?.text || '').trim());
    const hasEquals = texts.some(text => text.includes('='));
    const hasProduct = texts.some(text => /[·⋅*]/u.test(text));
    const smallerScripts = mathRuns.filter(candidate =>
      Number(candidate._sourceFontSize || candidate.fontSize || 0) * RENDER_SCALE <= fontPx * 0.78
    );
    const equalsRun = mathRuns.find(candidate => String(candidate?.text || '').includes('='));
    const visiblyTallOperator = equalsRun &&
      Number(equalsRun._sourceY) - anchorBox.y >= fontPx * 0.22;
    const stackedScripts = smallerScripts.some(candidate =>
      Number(candidate._sourceY) < anchorBox.y - fontPx * 0.18) && smallerScripts.some(candidate =>
      Number(candidate._sourceY) > anchorBox.y + fontPx * 0.18);
    if (!hasEquals || !hasProduct || smallerScripts.length < 2 ||
        !(visiblyTallOperator || (anchorText === '\u2211' && stackedScripts))) continue;

    const runBounds = mathRuns.map(candidate => {
      const candidateHeight = Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0));
      const largeOperator = candidate === anchor;
      const displacedOperator = largeOperator && anchorText === 'P';
      const glyphPadding = Math.max(3, candidateHeight * 0.2);
      return {
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY) + (displacedOperator ? candidateHeight * 0.52 : 0),
        width: Number(candidate._sourceWidth),
        height: displacedOperator ? candidateHeight * 0.48 : candidateHeight,
        maskPaddingLeft: largeOperator ? Math.max(3.5, fontPx * 0.18) : glyphPadding,
        maskPaddingTop: largeOperator ? 0.75 : glyphPadding,
        maskPaddingRight: largeOperator ? Math.max(3.5, fontPx * 0.18) : glyphPadding,
        maskPaddingBottom: largeOperator ? Math.max(10, fontPx * 0.55) : glyphPadding
      };
    });
    const runRegion = unionRects(runBounds) || anchorBox;
    const nearbyRules = (vectorObjs || []).filter(vector => {
      const width = Math.max(0, Number(vector?.width || 0));
      const height = Math.max(0, Number(vector?.height || 0));
      return width >= 3 && width <= fontPx * 4.5 && height <= 5 &&
        rectIntersectionArea(vector, runRegion) > 0;
    });
    const group = unionRects([runRegion, ...nearbyRules]) || runRegion;
    const pad = Math.max(8, fontPx * 0.48);
    const left = Math.max(0, group.x - pad);
    const top = Math.max(0, group.y - pad);
    const right = Math.min(canvas.width, group.x + group.width + pad);
    const bottom = Math.min(canvas.height, group.y + group.height + pad);
    regions.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      kind: 'mathGlyph',
      foreground: true,
      transparentBackground: true,
      mathRunBoxes: runBounds,
      mathRemovalBoxes: mathRuns.map(candidate => ({
        x: Number(candidate._sourceX),
        y: Number(candidate._sourceY),
        width: Number(candidate._sourceWidth),
        height: Math.max(1, Number(candidate._sourceHeight || candidate.fontSize || 0))
      })),
      mathRuleBoxes: nearbyRules.map(rule => ({
        x: Number(rule.x), y: Number(rule.y), width: Number(rule.width), height: Number(rule.height),
        maskPadding: 0.25
      }))
    });
  }
  return dedupeRasterRegions(regions);
}

function findComplexMathRegions(textObjs, vectorObjs, canvas) {
  if (!Array.isArray(textObjs) || !canvas?.width || !canvas?.height) return [];
  const regions = [];
  const operatorPattern = /[=+−×÷√∑∏∫∈∪∩≠≤≥←→*/^]/g;
  for (const obj of textObjs) {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    lines.forEach((line, index) => {
      const runs = Array.isArray(line) ? line.filter(run => hasSourceTextGeometry(run)) : [];
      if (runs.length < 2) return;
      const text = runs.map(run => String(run?.text || '')).join('').replace(/\s+/g, ' ').trim();
      const compact = text.replace(/\s+/g, '');
      if (compact.length < 5 || compact.length > 220) return;
      // Underlined links with a superscript footnote have the same raw cues as
      // a fraction (slashes, mixed baselines and a long horizontal rule). They
      // are still ordinary editable text; treating them as math rasterizes the
      // whole containing line and can remove adjacent prose from the DOCX.
      if (/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(text)) return;
      const operators = (compact.match(operatorPattern) || []).length;
      const mathMarks = operators + (compact.match(/[()[\]{}_,.:;\d]/g) || []).length;
      const words = text.match(/[A-Za-z]{3,}/g) || [];
      const sourceYs = runs.map(run => Number(run._sourceY)).filter(Number.isFinite);
      const fontPts = runs.map(run => Number(run._sourceFontSize ?? run.fontSize)).filter(value => Number.isFinite(value) && value > 0);
      const maxFont = fontPts.length ? Math.max(...fontPts) : 0;
      const minFont = fontPts.length ? Math.min(...fontPts) : maxFont;
      const ySpread = sourceYs.length > 1 ? Math.max(...sourceYs) - Math.min(...sourceYs) : 0;
      const mixedBaseline = maxFont > 0 && (minFont < maxFont * 0.84 || ySpread > maxFont * RENDER_SCALE * 0.22);
      const denseMath = mathMarks / Math.max(1, compact.length) >= 0.24;
      if (operators < 2 || !mixedBaseline || !denseMath || words.length > 8) return;

      const runBounds = runs.map(run => ({
        x: Number(run._sourceX),
        y: Number(run._sourceY),
        width: Number(run._sourceWidth),
        height: Math.max(Number(run._sourceHeight || 0), Number(run._sourceFontSize ?? run.fontSize) * RENDER_SCALE * 1.3)
      }));
      let region = unionRects(runBounds) || boxes[index] || boxes[boxes.length - 1] || obj;
      const textRegion = { ...region };
      const padX = Math.max(3, Math.min(8, region.height * 0.18));
      const padTop = Math.max(4, Math.min(12, region.height * 0.3));
      const padBottom = Math.max(3, Math.min(6, region.height * 0.15));
      const search = {
        x: region.x - padX,
        y: region.y - padTop,
        width: region.width + padX * 2,
        height: region.height + padTop + padBottom
      };
      const nearbyLineArt = (vectorObjs || []).filter(vector => {
        const width = Math.max(0, Number(vector?.width || 0));
        const height = Math.max(0, Number(vector?.height || 0));
        return (vector?.kind === 'line' || Math.min(width, height) <= 5) &&
          Math.max(width, height) >= 5 && rectIntersectionArea(vector, search) > 0;
      });
      const hasFractionLine = nearbyLineArt.some(vector => {
        const width = Math.max(0, Number(vector?.width || 0));
        const height = Math.max(0, Number(vector?.height || 0));
        const y = Number(vector?.y || 0);
        return width >= Math.max(12, height * 4, textRegion.width * 0.2) &&
          width <= textRegion.width * 3 && y >= textRegion.y - 3;
      });
      region = unionRects([region, ...nearbyLineArt]) || region;
      regions.push({
        x: Math.max(0, region.x - padX),
        y: Math.max(0, region.y - padTop),
        width: Math.min(canvas.width, region.x + region.width + padX) - Math.max(0, region.x - padX),
        height: Math.min(canvas.height, region.y + region.height + padBottom) - Math.max(0, region.y - padTop),
        kind: 'complexMath',
        foreground: true,
        transparentBackground: true,
        mathText: compact,
        hasFractionLine
      });
    });
  }
  const merged = [];
  const touchesSameExpression = (left, right) => {
    const overlap = rectIntersectionArea(left, right);
    const minArea = Math.max(1, Math.min(left.width * left.height, right.width * right.height));
    if (overlap / minArea >= 0.25) return true;
    const horizontalGap = Math.max(0, left.x - (right.x + right.width), right.x - (left.x + left.width));
    const verticalOverlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
    const minHeight = Math.max(1, Math.min(left.height, right.height));
    return verticalOverlap / minHeight >= 0.3 && horizontalGap <= Math.max(14, minHeight * 0.55);
  };
  for (const region of regions.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const existing = merged.find(item => {
      return touchesSameExpression(item, region);
    });
    if (!existing) {
      merged.push(region);
      continue;
    }
    const mathText = `${existing.mathText || ''}${region.mathText || ''}`;
    const hasFractionLine = existing.hasFractionLine || region.hasFractionLine;
    Object.assign(existing, unionRects([existing, region]), {
      kind: 'complexMath', foreground: true, transparentBackground: true, mathText, hasFractionLine
    });
  }
  const isCompoundFormula = region => {
    const text = String(region.mathText || '');
    const operators = (text.match(operatorPattern) || []).length;
    const stars = (text.match(/\*/g) || []).length;
    const matrixProduct = text.includes('=') && text.includes('×') && stars >= 2;
    return matrixProduct || (region.hasFractionLine && operators >= 2);
  };
  return dedupeRasterRegions(merged.filter(isCompoundFormula)).map(region => {
    const { mathText, hasFractionLine, ...result } = region;
    return result;
  });
}

function removeRasterizedComplexMathText(textObjs, regions) {
  if (!regions?.length) return textObjs || [];
  const textRemovalRegions = regions.map(region => ({
    x: region.x + Math.min(2, region.width * 0.05),
    y: region.y,
    width: Math.max(0, region.width - Math.min(4, region.width * 0.1)),
    height: Math.max(0, region.height - Math.min(7, region.height * 0.12))
  }));
  return (textObjs || []).flatMap(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) return [obj];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];
    lines.forEach((line, index) => {
      const box = boxes[index] || boxes[boxes.length - 1] || obj;
      const visual = {
        x: Number(box?.x ?? obj.x ?? 0), y: Number(box?.y ?? obj.y ?? 0),
        width: Number(box?.width ?? obj.width ?? 0), height: Number(box?.height ?? obj.height ?? 0)
      };
      if (isMostlyInsideAnyRegion(visual, textRemovalRegions, 0.22)) return;
      keptLines.push(line);
      keptBoxes.push(box);
      if (Array.isArray(data._lineAligns)) keptAligns.push(data._lineAligns[index]);
    });
    if (keptLines.length === lines.length) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...data,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(data._lineAligns) ? keptAligns : data._lineAligns
      }
    }];
  });
}

function makeCanvasBackgroundTransparent(ctx) {
  if (!ctx?.canvas?.width || !ctx?.canvas?.height) return;
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 24));
  const stepY = Math.max(1, Math.floor(height / 16));
  const add = (x, y) => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    if (data[i + 3] >= 180) samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x += stepX) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { add(0, y); add(width - 1, y); }
  if (!samples.length) return;
  const median = channel => samples.map(sample => sample[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const background = [median(0), median(1), median(2)];
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.max(
      Math.abs(data[i] - background[0]),
      Math.abs(data[i + 1] - background[1]),
      Math.abs(data[i + 2] - background[2])
    );
    if (distance <= 8) data[i + 3] = 0;
    else if (distance < 36) data[i + 3] = Math.round(data[i + 3] * (distance - 8) / 28);
  }
  const edge = Math.min(3, Math.floor(width / 2), Math.floor(height / 2));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const borderDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (borderDistance >= edge) continue;
      const i = (y * width + x) * 4;
      data[i + 3] = Math.round(data[i + 3] * borderDistance / Math.max(1, edge));
    }
  }
  ctx.putImageData(image, 0, 0);
}

function maskMathCropToSourceGeometry(ctx, region, scaleRatio = 1) {
  if (!ctx?.canvas?.width || !ctx?.canvas?.height || !region) return;
  const sourceBoxes = [
    ...(Array.isArray(region.mathRunBoxes) ? region.mathRunBoxes : []),
    ...(Array.isArray(region.mathRuleBoxes) ? region.mathRuleBoxes : [])
  ].filter(box => [box?.x, box?.y, box?.width, box?.height].every(Number.isFinite) &&
    box.width > 0 && box.height >= 0);
  if (!sourceBoxes.length) return;

  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const localBoxes = sourceBoxes.map(box => {
    const common = Number.isFinite(Number(box.maskPadding)) ? Number(box.maskPadding) : 0.45;
    const leftPadding = Number.isFinite(Number(box.maskPaddingLeft)) ? Number(box.maskPaddingLeft) : common;
    const topPadding = Number.isFinite(Number(box.maskPaddingTop)) ? Number(box.maskPaddingTop) : common;
    const rightPadding = Number.isFinite(Number(box.maskPaddingRight)) ? Number(box.maskPaddingRight) : common;
    const bottomPadding = Number.isFinite(Number(box.maskPaddingBottom)) ? Number(box.maskPaddingBottom) : common;
    return {
      left: (Number(box.x) - Number(region.x) - leftPadding) * scaleRatio,
      top: (Number(box.y) - Number(region.y) - topPadding) * scaleRatio,
      right: (Number(box.x) + Number(box.width) - Number(region.x) + rightPadding) * scaleRatio,
      bottom: (Number(box.y) + Math.max(Number(box.height), 0.75) - Number(region.y) + bottomPadding) * scaleRatio
    };
  });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (!data[index + 3]) continue;
      const keep = localBoxes.some(box =>
        x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
      );
      if (!keep) data[index + 3] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function removeRasterizedPrivateUseText(textObjs) {
  return (textObjs || []).flatMap(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) return [obj];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];
    lines.forEach((line, index) => {
      const text = (line || []).map(run => String(run?.text || '')).join('');
      if (/[\uE000-\uF8FF]/.test(text)) return;
      keptLines.push(line);
      keptBoxes.push(boxes[index] || boxes[boxes.length - 1] || obj);
      if (Array.isArray(data._lineAligns)) keptAligns.push(data._lineAligns[index]);
    });
    if (keptLines.length === lines.length) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...data,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(data._lineAligns) ? keptAligns : data._lineAligns
      }
    }];
  });
}

function removeRasterizedMathGlyphRuns(textObjs, regions) {
  return (textObjs || []).flatMap(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) return [obj];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];
    let changed = false;
    lines.forEach((line, index) => {
      const originalRuns = Array.isArray(line) ? line : [];
      let removedFromLine = false;
      const keptRuns = originalRuns.flatMap(run => {
        if (!hasSourceTextGeometry(run)) return [run];
        const box = {
          x: Number(run._sourceX),
          y: Number(run._sourceY),
          width: Number(run._sourceWidth),
          height: Math.max(1, Number(run._sourceHeight || run.fontSize || 0))
        };
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const inside = (regions || []).some(region => {
          const contributingBoxes = Array.isArray(region.mathRemovalBoxes) && region.mathRemovalBoxes.length
            ? region.mathRemovalBoxes
            : Array.isArray(region.mathRunBoxes) && region.mathRunBoxes.length
            ? region.mathRunBoxes
            : [region];
          return contributingBoxes.some(sourceBox =>
            center.x >= Number(sourceBox.x) && center.x <= Number(sourceBox.x) + Number(sourceBox.width) &&
            center.y >= Number(sourceBox.y) && center.y <= Number(sourceBox.y) + Number(sourceBox.height)
          );
        });
        if (!inside) return [run];
        changed = true;
        removedFromLine = true;
        return [];
      });
      if (!keptRuns.length) return;
      const fallbackBox = boxes[index] || boxes[boxes.length - 1] || obj;
      const groups = [];
      for (const run of keptRuns) {
        const current = groups[groups.length - 1];
        const previous = current?.[current.length - 1];
        let separatedByMathCrop = false;
        if (removedFromLine && previous && hasSourceTextGeometry(previous) && hasSourceTextGeometry(run)) {
          const previousEnd = Number(previous._sourceEnd ??
            (Number(previous._sourceX) + Number(previous._sourceWidth || 0)));
          const currentX = Number(run._sourceX);
          const bandTop = Math.min(Number(previous._sourceY), Number(run._sourceY));
          const bandBottom = Math.max(
            Number(previous._sourceY) + Math.max(1, Number(previous._sourceHeight || previous.fontSize || 0)),
            Number(run._sourceY) + Math.max(1, Number(run._sourceHeight || run.fontSize || 0))
          );
          separatedByMathCrop = currentX > previousEnd && (regions || []).some(region =>
            region.x < currentX && region.x + region.width > previousEnd &&
            region.y < bandBottom && region.y + region.height > bandTop
          );
        }
        if (!current || separatedByMathCrop) groups.push([run]);
        else current.push(run);
      }
      for (const group of groups) {
        const finite = group.filter(hasSourceTextGeometry);
        let groupBox = fallbackBox;
        if (finite.length) {
          const x = Math.min(...finite.map(run => Number(run._sourceX)));
          const y = Math.min(...finite.map(run => Number(run._sourceY)));
          const right = Math.max(...finite.map(run => Number(run._sourceEnd ??
            (Number(run._sourceX) + Number(run._sourceWidth || 0)))));
          const bottom = Math.max(...finite.map(run =>
            Number(run._sourceY) + Math.max(1, Number(run._sourceHeight || run.fontSize || 0))));
          groupBox = {
            ...fallbackBox,
            x,
            y,
            width: Math.max(1, right - x),
            height: Math.max(1, bottom - y)
          };
        }
        keptLines.push(group);
        keptBoxes.push(groupBox);
        if (Array.isArray(data._lineAligns)) keptAligns.push(data._lineAligns[index]);
      }
    });
    if (!changed) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...data,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(data._lineAligns) ? keptAligns : data._lineAligns
      }
    }];
  });
}

function removeRasterizedCorruptText(textObjs) {
  return (textObjs || []).flatMap(obj => {
    const d = obj?.data || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.length) return [obj];
    const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];
    lines.forEach((line, index) => {
      const text = (line || []).map(run => String(run?.text || '')).join('');
      if (looksLikeCorruptExtractedText(text)) return;
      keptLines.push(line);
      keptBoxes.push(boxes[index] || boxes[boxes.length - 1] || obj);
      if (Array.isArray(d._lineAligns)) keptAligns.push(d._lineAligns[index]);
    });
    if (keptLines.length === lines.length) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...d,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(d._lineAligns) ? keptAligns : d._lineAligns
      }
    }];
  });
}

function isBrightChromaticCanvasBackdrop(canvas, box, sampled) {
  const colors = [sampled?.background, _sampleCanvasColor(canvas, box)];
  return colors.some(color => {
    const rgb = parseHexColor(color);
    if (!rgb) return false;
    const spread = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
    return spread > 40 && colorLuminance(color) > 100;
  });
}

function reconcileTextColorsWithCanvas(textObjs, canvas) {
  if (!Array.isArray(textObjs) || !canvas?.width) return textObjs || [];
  return textObjs.map(obj => {
    const d = obj?.data || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const lineBoxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length
      ? d._lineBoxes
      : [{ x: obj.x, y: obj.y, width: obj.width, height: obj.height }];
    let changed = false;
    const repairedLines = lines.map((line, lineIndex) => {
      const visibleRuns = (line || []).filter(run => String(run?.text || '').trim());
      const lineSourceBoxes = visibleRuns.filter(hasSourceTextGeometry).map(run => ({
        x: Number(run._sourceX),
        y: Number(run._sourceY),
        width: Number(run._sourceWidth),
        height: Math.max(1, Number(run._sourceHeight || run.fontSize || 0) * 1.28)
      }));
      const lineColors = new Map();
      for (const run of visibleRuns) {
        const color = String(run?.color || d.color || '#000000').toLowerCase();
        lineColors.set(color, (lineColors.get(color) || 0) + Math.max(1, String(run?.text || '').trim().length));
      }
      const dominantEntry = [...lineColors.entries()].sort((a, b) => b[1] - a[1])[0];
      const visibleWeight = [...lineColors.values()].reduce((sum, value) => sum + value, 0);
      const uniformFragmentedLine = visibleRuns.length > 1 && dominantEntry &&
        dominantEntry[1] / Math.max(1, visibleWeight) >= 0.78 && lineSourceBoxes.length === visibleRuns.length;
      let lineReplacement = null;
      if (uniformFragmentedLine) {
        const x = Math.min(...lineSourceBoxes.map(box => box.x));
        const y = Math.min(...lineSourceBoxes.map(box => box.y));
        const right = Math.max(...lineSourceBoxes.map(box => box.x + box.width));
        const bottom = Math.max(...lineSourceBoxes.map(box => box.y + box.height));
        const sampled = sampleCanvasTextInkColor(canvas, { x, y, width: right - x, height: bottom - y }, dominantEntry[0], {
          preferDarkNeutral: isNearWhiteTextColor(dominantEntry[0])
        });
        const dominantRgb = parseHexColor(dominantEntry[0]);
        const dominantIsDarkNeutral = dominantRgb &&
          Math.max(dominantRgb.r, dominantRgb.g, dominantRgb.b) < 90 &&
          Math.max(dominantRgb.r, dominantRgb.g, dominantRgb.b) -
            Math.min(dominantRgb.r, dominantRgb.g, dominantRgb.b) <= 24;
        const falseWhiteOnChromaticFill = dominantIsDarkNeutral &&
          isNearWhiteTextColor(sampled?.color) &&
          isBrightChromaticCanvasBackdrop(canvas, { x, y, width: right - x, height: bottom - y }, sampled);
        if (!falseWhiteOnChromaticFill && shouldReplaceWithCanvasInkColor(dominantEntry[0], sampled)) {
          lineReplacement = normalizeSampledTextColor(sampled);
        }
      }
      return (line || []).map(run => {
      const extracted = run?.color || d.color || '#000000';
      if (lineReplacement && String(extracted).toLowerCase() === dominantEntry[0]) {
        changed = true;
        return { ...run, color: lineReplacement };
      }
      if (uniformFragmentedLine) return run;
      const runBox = hasSourceTextGeometry(run) ? {
        x: Number(run._sourceX),
        // _sourceY is the rendered top edge, not the PDF baseline.
        y: Number(run._sourceY),
        width: Number(run._sourceWidth),
        height: Math.max(1, Number(run._sourceHeight || run.fontSize || 0) * 1.28)
      } : { ...(lineBoxes[lineIndex] || lineBoxes[0]), rotation: 0 };
      const extractedRgb = parseHexColor(extracted);
      const extractedIsDarkNeutral = extractedRgb &&
        Math.max(extractedRgb.r, extractedRgb.g, extractedRgb.b) < 90 &&
        Math.max(extractedRgb.r, extractedRgb.g, extractedRgb.b) - Math.min(extractedRgb.r, extractedRgb.g, extractedRgb.b) <= 24;
      const sampled = sampleCanvasTextInkColor(canvas, textBoxVisualBounds(runBox), extracted, {
        // A white glyph can be a PDF operator fallback. When the rendered
        // label contains substantial dark neutral ink, prefer that ink over
        // white counter-shapes or adjacent card background.
        preferDarkNeutral: isNearWhiteTextColor(extracted)
      });
      const brightChromaticBackdrop = isBrightChromaticCanvasBackdrop(
        canvas,
        textBoxVisualBounds(runBox),
        sampled
      );
      if (extractedIsDarkNeutral && !brightChromaticBackdrop &&
          canvasBoxHasLightTextEvidence(canvas, textBoxVisualBounds(runBox))) {
        changed = true;
        return { ...run, color: '#ffffff' };
      }
      if (extractedIsDarkNeutral && isNearWhiteTextColor(sampled?.color)) {
        if (brightChromaticBackdrop) return run;
      }
      if (!shouldReplaceWithCanvasInkColor(extracted, sampled)) return run;
      changed = true;
      return { ...run, color: normalizeSampledTextColor(sampled) };
      });
    });
    const firstColor = repairedLines[0]?.[0]?.color || d.color;
    const baseColorChanged = firstColor && String(firstColor).toLowerCase() !== String(d.color || '').toLowerCase();
    if (!changed && !baseColorChanged) return obj;
    return {
      ...obj,
      data: {
        ...d,
        color: firstColor,
        lines: repairedLines,
        _originalStyle: d._originalStyle ? { ...d._originalStyle, color: firstColor } : d._originalStyle
      }
    };
  });
}

function canvasBoxHasLightTextEvidence(canvas, box) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot?.data || !box) return false;
  // Light pixels inside a text box are normally just the page background.
  // Only infer white glyphs when the pixels surrounding the run are actually
  // dark enough to support light-on-dark text.
  const surroundingColor = _sampleCanvasBorderColor(canvas, box);
  const surroundingLuminance = colorLuminance(surroundingColor);
  if (surroundingLuminance == null || surroundingLuminance > 205) return false;
  const surroundingRgb = parseHexColor(surroundingColor);
  const surroundingSpread = surroundingRgb
    ? Math.max(surroundingRgb.r, surroundingRgb.g, surroundingRgb.b) -
      Math.min(surroundingRgb.r, surroundingRgb.g, surroundingRgb.b)
    : 0;
  // Bright chromatic table bands can contain pale vertical separators inside
  // a tight cell box. Those separators are not white glyphs. Keep the light-
  // text fallback for genuinely dark fills (including dark colored cards),
  // but do not let a bright cyan/blue band repaint extracted black text.
  if (surroundingSpread > 40 && surroundingLuminance > 120) return false;
  const left = Math.max(0, Math.floor(Number(box.x || 0)));
  const top = Math.max(0, Math.floor(Number(box.y || 0)));
  const right = Math.min(snapshot.width, Math.ceil(Number(box.x || 0) + Math.max(1, Number(box.width || 1))));
  const bottom = Math.min(snapshot.height, Math.ceil(Number(box.y || 0) + Math.max(1, Number(box.height || 1))));
  if (right - left < 3 || bottom - top < 3) return false;
  const dominantBackdrop = dominantCanvasRegionColorInfo(
    snapshot,
    left,
    top,
    right - left,
    bottom - top
  );
  const dominantRgb = parseHexColor(dominantBackdrop?.color);
  const dominantLuminance = colorLuminance(dominantBackdrop?.color);
  const dominantSpread = dominantRgb
    ? Math.max(dominantRgb.r, dominantRgb.g, dominantRgb.b) -
      Math.min(dominantRgb.r, dominantRgb.g, dominantRgb.b)
    : 0;
  if (dominantBackdrop?.share >= 0.25 && dominantSpread > 40 && dominantLuminance > 100) return false;
  const pad = Math.max(2, Math.min(7, Math.round((bottom - top) * 0.28)));
  const outerLeft = Math.max(0, left - pad), outerTop = Math.max(0, top - pad);
  const outerRight = Math.min(snapshot.width, right + pad), outerBottom = Math.min(snapshot.height, bottom + pad);
  let inside = 0, insideLight = 0, ring = 0, ringLight = 0;
  const isLightNeutral = index => {
    const r = snapshot.data[index], g = snapshot.data[index + 1], b = snapshot.data[index + 2];
    return Math.min(r, g, b) >= 188 && Math.max(r, g, b) - Math.min(r, g, b) <= 34;
  };
  for (let y = outerTop; y < outerBottom; y++) {
    for (let x = outerLeft; x < outerRight; x++) {
      const index = (y * snapshot.width + x) * 4;
      if (snapshot.data[index + 3] < 80) continue;
      if (x >= left && x < right && y >= top && y < bottom) {
        inside++;
        if (isLightNeutral(index)) insideLight++;
      } else {
        ring++;
        if (isLightNeutral(index)) ringLight++;
      }
    }
  }
  const insideShare = insideLight / Math.max(1, inside);
  const ringShare = ringLight / Math.max(1, ring);
  return insideLight >= 5 && insideShare >= 0.018 && insideShare > ringShare + 0.012;
}

function reconcileInvisibleVectorColorsWithCanvas(vectorObjs, canvas) {
  if (!Array.isArray(vectorObjs) || !canvas?.width) return vectorObjs || [];
  const snapshot = canvasPixelSnapshot(canvas);
  const axisAlignedRectangle = vector => {
    const points = Array.isArray(vector?.points) ? vector.points : [];
    if (vector?.kind !== 'path' || !vector.closed || vector.fill === false || points.length < 4 || points.length > 6) return false;
    const xs = points.map(point => Number(point?.x)).filter(Number.isFinite);
    const ys = points.map(point => Number(point?.y)).filter(Number.isFinite);
    if (xs.length !== points.length || ys.length !== points.length) return false;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const tolerance = Math.max(1.25, Math.min(maxX - minX, maxY - minY) * 0.025);
    return maxX - minX >= 1 && maxY - minY >= 1 && points.every(point =>
      (Math.abs(Number(point.x) - minX) <= tolerance || Math.abs(Number(point.x) - maxX) <= tolerance) &&
      (Math.abs(Number(point.y) - minY) <= tolerance || Math.abs(Number(point.y) - maxY) <= tolerance)
    );
  };
  return vectorObjs.map(vector => {
    if (!vector) return vector;
    const width = Math.max(0, Number(vector.width || 0));
    const height = Math.max(0, Number(vector.height || 0));
    const pageArea = canvas.width * canvas.height;
    const narrowSide = Math.min(width, height);
    // Canvas sampling is authoritative for lost hairlines and tiny colored
    // markers, but a large pale card naturally contains other artwork. Limit
    // this correction to compact/narrow vectors so it cannot repaint a page
    // background from a child icon or label.
    const rectangularFill = axisAlignedRectangle(vector);
    if (rectangularFill && snapshot) {
      const x = Math.max(0, Math.floor(Number(vector.x || 0)));
      const y = Math.max(0, Math.floor(Number(vector.y || 0)));
      const right = Math.min(snapshot.width, Math.ceil(Number(vector.x || 0) + width));
      const bottom = Math.min(snapshot.height, Math.ceil(Number(vector.y || 0) + height));
      const dominant = dominantCanvasRegionColorInfo(snapshot, x, y, Math.max(1, right - x), Math.max(1, bottom - y));
      const extractedFill = vector.fillColor || vector.color || '#000000';
      if (dominant?.color && dominant.share >= 0.56 &&
          colorDistanceFromCanvasBackground(extractedFill, dominant.color) > 76) {
        return { ...vector, fillColor: dominant.color, color: dominant.color };
      }
      // A filled rectangle's dominant rendered region is its fill. Sampling
      // contrasting "ink" inside it instead picks up cell text and repaints
      // the entire rectangle black, which corrupts highlighted table bands.
      return vector;
    }
    const compactOrHairline = narrowSide <= Math.max(10, Math.min(canvas.width, canvas.height) * 0.018);
    if (!compactOrHairline || width * height > pageArea * 0.012) return vector;
    const usesFill = vector.fill !== false && vector.kind !== 'line';
    const extracted = usesFill
      ? (vector.fillColor || vector.color || '#000000')
      : (vector.strokeColor || vector.color || '#000000');
    const sampled = sampleCanvasInkColor(canvas, vector);
    if (!shouldReplaceWithCanvasInkColor(extracted, sampled)) return vector;
    return usesFill
      ? { ...vector, fillColor: sampled.color, color: sampled.color }
      : { ...vector, strokeColor: sampled.color, color: sampled.color };
  });
}

function suppressRestoredMathIdentifierUnderscoreVectors(vectorObjs, textObjs) {
  if (!Array.isArray(vectorObjs) || !Array.isArray(textObjs)) return vectorObjs || [];
  const restoredRuns = textObjs.flatMap(obj => (obj?.data?.lines || []).flat())
    .filter(run => run?._restoredMathIdentifier &&
      String(run.text || '').includes('_') &&
      Number.isFinite(Number(run._sourceX)) &&
      Number.isFinite(Number(run._sourceY)) &&
      Number.isFinite(Number(run._sourceWidth)) &&
      Number(run._sourceWidth) > 0);
  if (!restoredRuns.length) return vectorObjs;

  return vectorObjs.filter(vector => {
    const x = Number(vector?.x);
    const y = Number(vector?.y);
    const width = Number(vector?.width);
    const height = Number(vector?.height);
    if (![x, y, width, height].every(Number.isFinite) ||
        width <= 0 || height <= 0 || width < height * 1.8) return true;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const isRestoredUnderscore = restoredRuns.some(run => {
      const runX = Number(run._sourceX);
      const runY = Number(run._sourceY);
      const runWidth = Number(run._sourceWidth);
      const fontPx = Math.max(1, Number(run._sourceFontSize || run.fontSize || 0) * RENDER_SCALE);
      return width <= Math.max(6, fontPx * 0.6) &&
        height <= Math.max(2, fontPx * 0.18) &&
        centerX >= runX - 1 && centerX <= runX + runWidth + 1 &&
        centerY >= runY + fontPx * 0.55 && centerY <= runY + fontPx * 1.05;
    });
    return !isRestoredUnderscore;
  });
}

function padRect(rect, pad) {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

function rectOverlapArea(a, b) {
  if (!a || !b) return 0;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const maxX = Math.min(a.x + a.width, b.x + b.width);
  const maxY = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, maxX - x) * Math.max(0, maxY - y);
}

function pointInRect(x, y, rect) {
  return rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function looksLikeInternalLinkToken(text) {
  const trimmed = String(text || '').trim();
  return /^[\[(]?\d+(?:\s*,\s*\d+)*[\]).,;:]*$/.test(trimmed) ||
    /^[*\u2020\u2021]+$/.test(trimmed);
}

function linkRectCoversTextBox(box, linkRects = [], text = null) {
  if (!box || !linkRects?.length || box.width <= 0 || box.height <= 0) return false;
  const area = Math.max(1, box.width * box.height);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return linkRects.some(rect => {
    const isUrl = rect.linkType === 'url' || !!rect.href;
    if (!isUrl && text != null && !looksLikeInternalLinkToken(text)) return false;
    if (pointInRect(cx, cy, rect)) return true;
    return !isUrl && text != null && rectOverlapArea(box, rect) / area > 0.55;
  });
}

function isCodeLikeSegment(seg) {
  const hints = [
    seg?._styleName,
    seg?.fontName,
    seg?._style?.fontFamily,
    seg?.fontFamily
  ].filter(Boolean).join(' ');
  return /\b(courier|mono|monospace|consolas|cmtt|pcr|typewriter)\b/i.test(hints);
}

function isCodePunctuationBoundary(prevText, nextText) {
  const prev = String(prevText || '').trimEnd();
  const next = String(nextText || '').trimStart();
  if (!prev || !next) return false;
  const a = prev[prev.length - 1];
  const b = next[0];
  return /[._:/\\()[\]{}"'`,;]/.test(a) || /[._:/\\()[\]{}"'`,;]/.test(b);
}

function normalizeDetachedDiacritics(text) {
  let s = String(text || '');
  const maps = {
    '\u00a8': { A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü', Y: 'Ÿ', a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ' },
    '\u00b4': { A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý' },
    '`': { A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù', a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù' },
    '^': { A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û', a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' },
    '~': { A: 'Ã', N: 'Ñ', O: 'Õ', a: 'ã', n: 'ñ', o: 'õ' },
    '\u00b8': { C: 'Ç', c: 'ç' }
  };
  s = s.replace(/([\u00a8\u00b4`^~\u00b8])([A-Za-z])/g, (m, mark, ch) => maps[mark]?.[ch] || m);
  return s.normalize ? s.normalize('NFC') : s;
}

function normalizePdfCodeText(text) {
  let s = normalizeDetachedDiacritics(text);
  s = s.replace(/\s*:\s*\/\s*\/\s*/g, '://');
  s = s.replace(/([A-Za-z0-9_$\]\)])\s*\.\s*([A-Za-z0-9_$])/g, '$1.$2');
  s = s.replace(/([A-Za-z0-9_$\]\)])\s*\/\s*([A-Za-z0-9_$])/g, '$1/$2');
  s = s.replace(/([A-Za-z0-9_$\]\)])\s+\(\s*/g, '$1(');
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  s = s.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');
  s = s.replace(/\{\s+/g, '{').replace(/\s+\}/g, '}');
  s = s.replace(/"\s+([A-Za-z0-9_#./:-])/g, '"$1');
  s = s.replace(/([A-Za-z0-9_./:-])\s+"/g, '$1"');
  s = s.replace(/\s+([,;:])/g, '$1');
  s = s.replace(/([A-Za-z0-9])\s+-\s+([A-Za-z0-9])/g, '$1-$2');
  return s;
}

function normalizePdfCodeRuns(runs) {
  const normalized = (runs || []).map(run => ({
    ...run,
    text: normalizePdfCodeText(run?.text || '')
  }));
  for (let index = 1; index < normalized.length; index++) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (!isCodePunctuationBoundary(previous.text, current.text)) continue;
    previous.text = String(previous.text || '').trimEnd();
    current.text = String(current.text || '').trimStart();
  }
  return normalized.filter(run => String(run?.text || '').length);
}

const DETACHED_DIACRITIC_MAPS_SAFE = {
  '\u00a8': { A: '\u00c4', E: '\u00cb', I: '\u00cf', O: '\u00d6', U: '\u00dc', Y: '\u0178', a: '\u00e4', e: '\u00eb', i: '\u00ef', o: '\u00f6', u: '\u00fc', y: '\u00ff' },
  '\u00b4': { A: '\u00c1', E: '\u00c9', I: '\u00cd', O: '\u00d3', U: '\u00da', Y: '\u00dd', a: '\u00e1', e: '\u00e9', i: '\u00ed', o: '\u00f3', u: '\u00fa', y: '\u00fd' },
  '`': { A: '\u00c0', E: '\u00c8', I: '\u00cc', O: '\u00d2', U: '\u00d9', a: '\u00e0', e: '\u00e8', i: '\u00ec', o: '\u00f2', u: '\u00f9' },
  '^': { A: '\u00c2', E: '\u00ca', I: '\u00ce', O: '\u00d4', U: '\u00db', a: '\u00e2', e: '\u00ea', i: '\u00ee', o: '\u00f4', u: '\u00fb' },
  '~': { A: '\u00c3', N: '\u00d1', O: '\u00d5', a: '\u00e3', n: '\u00f1', o: '\u00f5' },
  '\u00b8': { C: '\u00c7', c: '\u00e7' }
};

function composeDetachedDiacriticSafe(mark, ch) {
  return DETACHED_DIACRITIC_MAPS_SAFE[mark]?.[ch] || null;
}

function normalizeDetachedDiacriticsSafe(text) {
  let s = String(text || '');
  s = s.replace(/([^AEIOUYCNaeiouycn\s])([\u00a8\u00b4`^~\u00b8])([AEIOUYCNaeiouycn])/g, (m, prefix, mark, ch) => {
    const composed = composeDetachedDiacriticSafe(mark, ch);
    return composed ? prefix + composed : m;
  });
  s = s.replace(/([AEIOUYCNaeiouycn])([\u00a8\u00b4`^~\u00b8])/g, (m, ch, mark) => composeDetachedDiacriticSafe(mark, ch) || m);
  s = s.replace(/([\u00a8\u00b4`^~\u00b8])([AEIOUYCNaeiouycn])/g, (m, mark, ch) => composeDetachedDiacriticSafe(mark, ch) || m);
  return s.normalize ? s.normalize('NFC') : s;
}

function normalizeBrokenMathIdentifierWhitespace(text, computerModernMathItalic = false) {
  const value = String(text || '');
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const core = value.trim();
  // A number of TeX/CFF math fonts map underscore glyphs to spaces and split
  // ligatures in ToUnicode ("of f set", "lef t", "righ t"). Restrict the
  // repair to that unmistakable signature so ordinary italic prose is not
  // compacted or rewritten.
  const compactMathWords = computerModernMathItalic &&
    /^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(core);
  if (!compactMathWords && !/\b(?:of\s+f|lef\s+t|righ\s+t)\b/i.test(core)) return value;
  const repaired = core
    .replace(/\bof\s+f\s+set\b/gi, 'offset')
    .replace(/\blef\s+t\b/gi, 'left')
    .replace(/\brigh\s+t\b/gi, 'right')
    // These spaces are broken ToUnicode mappings for the printed underscores
    // inside the already-subscripted identifier (for example,
    // center_offset). Restore that glyph instead of leaving Word-sized gaps.
    .replace(/\s+/g, '_');
  return `${leading}${repaired}${trailing}`;
}

function normalizeDetachedDiacriticRunsSafe(runs) {
  const out = Array.isArray(runs) ? runs : [];
  out.forEach(run => {
    run.text = normalizeDetachedDiacriticsSafe(run.text);
  });
  for (let i = 0; i < out.length - 1; i++) {
    const current = String(out[i]?.text || '');
    const next = String(out[i + 1]?.text || '');
    const mark = current.match(/([\u00a8\u00b4`^~\u00b8])$/)?.[1];
    if (!mark || !next) continue;
    const composed = composeDetachedDiacriticSafe(mark, next[0]);
    if (!composed) continue;
    out[i].text = current.slice(0, -1);
    out[i + 1].text = composed + next.slice(1);
  }
  return out;
}

function splitMixedBaselineRuns(lines, lineBoxes, obj) {
  const outLines = [];
  const outBoxes = [];
  const fallbackBoxes = Array.isArray(lineBoxes) ? lineBoxes : [];
  let hasDropCapLayout = false;

  for (let i = 0; i < lines.length; i++) {
    const line = Array.isArray(lines[i]) ? lines[i] : [];
    const sourceRuns = line.filter(run => Number.isFinite(Number(run?._sourceY)));
    if (sourceRuns.length < 2) {
      outLines.push(line);
      outBoxes.push(fallbackBoxes[i] || fallbackBoxes[fallbackBoxes.length - 1] || obj);
      continue;
    }
    // Runs already classified from one measured PDF baseline must remain in
    // one editable Word line. A table cell can, however, contain two physical
    // rows that both carry footnote markers. Treating the presence of any
    // script run as proof of a single line collapses those rows into one short
    // frame and clips the second row. Keep the fast path only when the
    // non-script body runs actually share a baseline.
    const bodySourceRuns = sourceRuns.filter(run => !run?._verticalAlign);
    const bodyBaselineSpan = bodySourceRuns.length > 1
      ? Math.max(...bodySourceRuns.map(sourceRunBaselineY)) - Math.min(...bodySourceRuns.map(sourceRunBaselineY))
      : 0;
    const bodyFontPx = Math.max(
      1,
      ...bodySourceRuns.map(run => Number(run.fontSize || 0) * RENDER_SCALE).filter(Number.isFinite)
    );
    if (sourceRuns.some(run => !!run?._verticalAlign) && bodyBaselineSpan <= Math.max(2, bodyFontPx * 0.24)) {
      outLines.push(line);
      outBoxes.push(fallbackBoxes[i] || fallbackBoxes[fallbackBoxes.length - 1] || obj);
      continue;
    }

    const maxFontPx = Math.max(
      1,
      ...sourceRuns.map(run => Number(run.fontSize || 0) * RENDER_SCALE).filter(Number.isFinite)
    );
    const minFontPx = Math.max(
      1,
      Math.min(...sourceRuns.map(run => Number(run.fontSize || 0) * RENDER_SCALE).filter(Number.isFinite))
    );
    const largestRun = sourceRuns.reduce((best, run) =>
      Number(run.fontSize || 0) > Number(best.fontSize || 0) ? run : best, sourceRuns[0]);
    const largestFontPx = Number(largestRun.fontSize || 0) * RENDER_SCALE;
    const largestX = Number(largestRun._sourceX || 0);
    const largestEnd = Number(largestRun._sourceEnd ?? (largestX + Number(largestRun._sourceWidth || 0)));
    const leftmostX = Math.min(...sourceRuns.map(run => Number(run._sourceX || 0)));
    const likelyDropCap = maxFontPx / minFontPx >= 2 &&
      /^[A-Za-z]$/.test(String(largestRun.text || '').trim()) &&
      largestX <= leftmostX + 1 &&
      sourceRuns.some(run => run !== largestRun &&
        Number(run.fontSize || 0) * RENDER_SCALE <= largestFontPx * 0.55 &&
        /^[A-Z]{2,}$/.test(String(run.text || '').trim()) &&
        Number(run._sourceX || 0) - largestEnd >= -2 &&
        Number(run._sourceX || 0) - largestEnd <= Math.max(3, minFontPx * 0.4));
    hasDropCapLayout ||= likelyDropCap;
    // A drop cap and its small-cap continuation can be close relative to the
    // large glyph while still having distinct PDF baselines. Only for that
    // typographic pattern, bound the tolerance by the smaller run; equations
    // and ordinary inline size changes keep the established grouping rule.
    const baselineTolerance = Math.max(2, likelyDropCap ? minFontPx * 0.35 : maxFontPx * 0.24);
    const sorted = line
      .map((run, order) => ({ run, order, y: sourceRunBaselineY(run) }))
      .sort((a, b) => {
        const ay = Number.isFinite(a.y) ? a.y : Number.POSITIVE_INFINITY;
        const by = Number.isFinite(b.y) ? b.y : Number.POSITIVE_INFINITY;
        return ay - by || (Number(a.run?._sourceX || 0) - Number(b.run?._sourceX || 0)) || a.order - b.order;
      });

    const groups = [];
    for (const item of sorted) {
      const last = groups[groups.length - 1];
      if (last && Number.isFinite(item.y) && Math.abs(item.y - last.y) <= baselineTolerance) {
        last.items.push(item);
        last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
      } else {
        groups.push({ y: Number.isFinite(item.y) ? item.y : Number.POSITIVE_INFINITY, items: [item] });
      }
    }

    if (groups.length <= 1 || !groups.some(group => Number.isFinite(group.y))) {
      outLines.push(line);
      outBoxes.push(fallbackBoxes[i] || fallbackBoxes[fallbackBoxes.length - 1] || obj);
      continue;
    }

    const groupStats = groups.map((group, groupIndex) => {
      const orderedItems = [...group.items].sort((a, b) => a.order - b.order);
      const text = orderedItems.map(item => String(item.run?.text || '')).join('');
      const fonts = orderedItems
        .map(item => Number(item.run?.fontSize || 0) * RENDER_SCALE)
        .filter(Number.isFinite);
      const avgFont = fonts.length ? fonts.reduce((sum, value) => sum + value, 0) / fonts.length : maxFontPx;
      const charCount = text.replace(/\s+/g, '').length;
      return { group, groupIndex, orderedItems, text, avgFont, charCount };
    });
    const bodyStats = groupStats.reduce((best, item) => {
      const bestScore = best.charCount * Math.max(1, best.avgFont);
      const itemScore = item.charCount * Math.max(1, item.avgFont);
      return itemScore > bestScore ? item : best;
    }, groupStats[0]);
    const shiftedOrders = new Map();
    let canKeepInline = true;
    for (const stats of groupStats) {
      if (stats === bodyStats) continue;
      const plain = stats.text.trim();
      const scriptLike = (plain.length <= 8 && /^[\p{L}\p{N}*+\-.,()×÷−√∑∏∈]+$/u.test(plain)) ||
        (plain.length <= 20 && /^[A-Z0-9]+$/.test(plain));
      const small = stats.avgFont <= bodyStats.avgFont * 0.88;
      const raised = Number.isFinite(stats.group.y) && stats.group.y < bodyStats.group.y - baselineTolerance * 0.45;
      const lowered = Number.isFinite(stats.group.y) && stats.group.y > bodyStats.group.y + baselineTolerance * 0.45;
      if (!scriptLike || !small || (!raised && !lowered)) {
        canKeepInline = false;
        break;
      }
      for (const item of stats.orderedItems) {
        shiftedOrders.set(item.order, {
          verticalAlign: raised ? 'superscript' : 'subscript',
          baselineShiftPt: Math.max(
            -bodyStats.avgFont / RENDER_SCALE * 0.45,
            Math.min(bodyStats.avgFont / RENDER_SCALE * 0.45, (bodyStats.group.y - stats.group.y) / RENDER_SCALE)
          )
        });
      }
    }

    if (canKeepInline && shiftedOrders.size) {
      outLines.push(line.map((run, order) => {
        const shift = shiftedOrders.get(order);
        return shift
          ? {
              ...run,
              _verticalAlign: shift.verticalAlign,
              _baselineShiftPt: shift.baselineShiftPt,
              _scriptBaseFontSize: bodyStats.avgFont / RENDER_SCALE
            }
          : run;
      }));
      outBoxes.push(fallbackBoxes[i] || fallbackBoxes[fallbackBoxes.length - 1] || obj);
      continue;
    }

    for (const group of groups) {
      const groupRuns = group.items
        .sort((a, b) => (Number(a.run?._sourceX || 0) - Number(b.run?._sourceX || 0)) || a.order - b.order)
        .map(item => item.run);
      const finite = groupRuns.filter(run => Number.isFinite(Number(run._sourceX)) && Number.isFinite(Number(run._sourceY)));
      const fallback = fallbackBoxes[i] || fallbackBoxes[fallbackBoxes.length - 1] || obj;
      if (finite.length) {
        const x = Math.min(...finite.map(run => Number(run._sourceX)));
        const y = Math.min(...finite.map(run => Number(run._sourceY)));
        const right = Math.max(...finite.map(run => Number(run._sourceEnd ?? (Number(run._sourceX) + Number(run._sourceWidth || 0)))));
        const height = Math.max(
          ...finite.map(run => Number(run._sourceHeight || 0)).filter(Number.isFinite),
          Number(fallback?.height || 0),
          maxFontPx * 1.2
        );
        outBoxes.push({ ...fallback, x, y, width: Math.max(1, right - x), height });
      } else {
        outBoxes.push(fallback);
      }
      outLines.push(groupRuns);
    }
  }

  return { lines: outLines, lineBoxes: outBoxes, hasDropCapLayout };
}

function hasSourceTextGeometry(run) {
  return run &&
    Number.isFinite(Number(run._sourceX)) &&
    Number.isFinite(Number(run._sourceY)) &&
    Number.isFinite(Number(run._sourceWidth)) &&
    Number(run._sourceWidth) > 0;
}

function trimPositionedRunText(value) {
  return stripInvalidXmlChars(value).replace(/^\s+|\s+$/g, '');
}

function alignedKeyValueRunLayout(line) {
  const orderedRuns = (line || [])
    .filter(run => hasSourceTextGeometry(run) && trimPositionedRunText(run.text))
    .map(run => ({
      run,
      text: trimPositionedRunText(run.text),
      x: Number(run._sourceX),
      end: Number(run._sourceEnd ?? (Number(run._sourceX) + Number(run._sourceWidth || 0)))
    }))
    .sort((a, b) => a.x - b.x);
  const colonIndex = orderedRuns.findIndex(item => item.text === ':');
  if (colonIndex < 1 || colonIndex >= orderedRuns.length - 1) return null;

  const fontPts = orderedRuns
    .map(item => Number(item.run.fontSize || 0))
    .filter(Number.isFinite);
  const maxFontPt = Math.max(0, ...fontPts);
  const gaps = orderedRuns.slice(1).map((item, index) => item.x - orderedRuns[index].end);
  const wideGapCount = gaps.filter(gap => gap / RENDER_SCALE > Math.max(7, maxFontPt * 0.75)).length;
  const joinedText = orderedRuns.map(item => item.text).join(' ');
  if (joinedText.length > 180 ||
      wideGapCount < 1 ||
      looksLikeBodyProseText(joinedText) ||
      looksLikeNaturalLanguageFragmentText(joinedText)) return null;
  return { orderedRuns, colonIndex };
}

function textSegmentVisualBounds(segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const points = [];
  for (const seg of segments) {
    const fs = Math.max(1, Number(seg?._fs || 0));
    // The corrected width is useful for fallback-font fitting, but the PDF's
    // raw advance is the authoritative visual extent of rotated text.
    const width = Math.max(fs * 0.35, Number(seg?._rawWidth || seg?._width || 0));
    const baselineX = Number.isFinite(seg?._baselineX) ? Number(seg._baselineX) : Number(seg?._x || 0);
    const baselineY = Number.isFinite(seg?._baselineY) ? Number(seg._baselineY) : Number(seg?._y || 0) + fs * 0.85;
    const angleRad = (-Number(seg?._angle || 0) * Math.PI) / 180;
    const ux = Math.cos(angleRad);
    const uy = Math.sin(angleRad);
    const vx = -uy;
    const vy = ux;
    const ascent = fs * 0.85;
    const descent = fs * 0.35;
    const addPoint = (along, normal) => {
      points.push({
        x: baselineX + ux * along + vx * normal,
        y: baselineY + uy * along + vy * normal
      });
    };
    addPoint(0, -ascent);
    addPoint(width, -ascent);
    addPoint(width, descent);
    addPoint(0, descent);
  }
  if (!points.length) return null;
  const minX = Math.min(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxX = Math.max(...points.map(p => p.x));
  const maxY = Math.max(...points.map(p => p.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function makeSourcePositionedRunFrames(line, box, obj, d) {
  const frames = [];
  const exactFormGeometry = d?._sourcePositionedFormText === true;
  const keyValueLayout = alignedKeyValueRunLayout(line);
  const sourceItemGroups = [];
  for (const run of line.slice().sort((a, b) => Number(a?._sourceX || 0) - Number(b?._sourceX || 0))) {
    const itemId = Number(run?._itemIdx);
    const last = sourceItemGroups[sourceItemGroups.length - 1];
    if (last && Number.isFinite(itemId) && last.itemId === itemId) last.runs.push(run);
    else sourceItemGroups.push({ itemId: Number.isFinite(itemId) ? itemId : null, runs: [run] });
  }
  const groups = keyValueLayout
    ? [
        keyValueLayout.orderedRuns.slice(0, keyValueLayout.colonIndex).map(item => item.run),
        keyValueLayout.orderedRuns.slice(keyValueLayout.colonIndex).map(item => item.run)
      ]
    : sourceItemGroups.map(group => group.runs);
  for (const group of groups) {
    const positionedRuns = group.filter(run => hasSourceTextGeometry(run) && trimPositionedRunText(run.text));
    if (!positionedRuns.length) continue;
    const firstRun = positionedRuns[0];

    const fontPt = Math.max(2, Number(
      (exactFormGeometry ? firstRun._sourceFontSize : firstRun.fontSize) ||
      firstRun.fontSize ||
      d.fontSize / RENDER_SCALE ||
      11
    ));
    const sourceX = Math.min(...positionedRuns.map(run => Number(run._sourceX)));
    const sourceRight = Math.max(...positionedRuns.map(run =>
      Number(run._sourceEnd ?? (Number(run._sourceX) + Number(run._sourceWidth || 0)))));
    const sourceWidthPt = Math.max(0.5, (sourceRight - sourceX) / RENDER_SCALE);
    const groupTextLength = positionedRuns.reduce(
      (sum, run) => sum + trimPositionedRunText(run.text).length,
      0
    );
    const isMicroText = fontPt <= 7;
    const measuredSourceHeightPt = Math.max(
      0,
      ...positionedRuns.map(run => Number(run._sourceHeight || 0) / RENDER_SCALE)
    );
    // Embedded reports frequently expose a coarse PDF.js line box (often
    // twelve points high) around four- or five-point text. Using that box as a
    // Word frame height makes adjacent source-positioned lines overlap. Only
    // for microtext, cap a clearly coarse envelope to measured font metrics.
    const effectiveSourceHeightPt = isMicroText &&
      measuredSourceHeightPt > fontPt * 1.75
      ? fontPt * 1.28
      : measuredSourceHeightPt;
    const sourceHeightPt = Math.max(
      fontPt * (isMicroText ? 1.08 : 1.15),
      effectiveSourceHeightPt
    );
    const microLineHeightPt = Math.max(fontPt * 1.2, sourceHeightPt);
    const widthPad = exactFormGeometry
      ? Math.max(fontPt * 0.9, Math.min(fontPt * 1.4, sourceWidthPt * 0.12))
      : isMicroText && groupTextLength >= 48
      ? Math.max(fontPt * 0.6, Math.min(fontPt * 7, sourceWidthPt * 0.18))
      : Math.max(fontPt * 0.25, Math.min(fontPt * 0.65, sourceWidthPt * 0.08));
    const heightPad = isMicroText ? 0 : fontPt * 0.35;
    const xPt = Math.max(0, sourceX / RENDER_SCALE);
    const yPt = Math.max(
      0,
      Math.min(...positionedRuns.map(run => Number(run._sourceY))) / RENDER_SCALE +
        Math.max(0, ...positionedRuns.map(run => Number(run._docxYAdjustPt || 0)))
    );
    const preserveItemWhitespace = positionedRuns.some(run => run?._preserveItemWhitespace);
    const docxRuns = positionedRuns.map((run, index) => {
      const text = trimPositionedRunText(run.text);
      const normalizedText = index > 0 && preserveItemWhitespace
        ? (run?._sourceSpaceBefore ? ` ${text}` : text)
        : (index > 0 && !/^[\])},.;:%]/.test(text) ? ` ${text}` : text);
      return makeDocxTextRun({
        ...run,
        text: normalizedText,
        fontSize: Number(run.fontSize || fontPt),
        _sourceFontSize: Number(run._sourceFontSize || run.fontSize || fontPt),
        _verticalAlign: undefined,
        _baselineShiftPt: undefined,
        _fitToSourceWidth: true
      }, d);
    }).filter(Boolean);
    if (!docxRuns.length) continue;

    frames.push(new docx.Paragraph({
      frame: {
        type: 'absolute',
        position: { x: pointsToTwips(xPt), y: pointsToTwips(yPt) },
        width: pointsToTwips(sourceWidthPt + widthPad),
        height: pointsToTwips(isMicroText
          ? microLineHeightPt + Math.max(0.2, fontPt * 0.08)
          : Math.max(fontPt * 1.45, sourceHeightPt + heightPad)),
        anchor: {
          horizontal: docx.FrameAnchorType.PAGE,
          vertical: docx.FrameAnchorType.PAGE
        },
        wrap: docx.FrameWrap.NONE,
        space: { horizontal: 0, vertical: 0 },
        rule: isMicroText ? docx.HeightRule.EXACT : docx.HeightRule.ATLEAST
      },
      spacing: {
        before: 0,
        after: 0,
        line: pointsToTwips(isMicroText ? microLineHeightPt : fontPt * 1.08),
        lineRule: isMicroText ? docx.LineRuleType.EXACT : docx.LineRuleType.AT_LEAST
      },
      children: docxRuns
    }));
  }
  return frames;
}

function normalizeLineRunColorsForDocx(line = [], d = {}) {
  const lineText = line.map(run => String(run?.text ?? '')).join('');
  return line.map(run => ({
    ...run,
    _lineText: lineText,
    color: normalizedRunTextColor(
      run?.text,
      lineText,
      run?.color || d.color || '#000000',
      run?.fontFamily || d.fontFamily || ''
    )
  }));
}

function shouldUseSourcePositionedRunFrames(line, box, obj, d) {
  const finiteRuns = line.filter(run => hasSourceTextGeometry(run) && trimPositionedRunText(run.text));
  if (!finiteRuns.length) return false;
  const rotation = Number(box.rotation ?? obj.rotation ?? d._originalBox?.rotation ?? 0) || 0;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  if (Math.min(normalizedRotation, 360 - normalizedRotation) > 3) return false;
  if (finiteRuns.length !== line.length) return false;
  const exactFormGeometry = d?._sourcePositionedFormText === true;

  const texts = finiteRuns.map(run => trimPositionedRunText(run.text)).filter(Boolean);
  const fontPts = finiteRuns.map(run => Number(run.fontSize || 0)).filter(Number.isFinite);
  const maxFontPt = Math.max(0, ...fontPts);
  const singleMicroRun = finiteRuns.length === 1 && maxFontPt <= 7;
  const compactToken = text => /^[A-Za-z0-9([{\u2022*+._%/-][A-Za-z0-9()[\]{}.,;:+_=%/-]*$/.test(text) && text.length <= 42;
  const compactCount = texts.filter(compactToken).length;
  const signalCount = texts.filter(text =>
    /[0-9%._+/()-]/.test(text) ||
    /^[A-Z]{2,}$/.test(text) ||
    /^(AP|AMC|GRE|SAT|LSAT|USABO|RLHF|gpt|PaLM|Askell|Codeforces)$/i.test(text)
  ).length;
  const proseCount = texts.filter(text => /^[a-z]{4,}[,.;:]?$/.test(text)).length;
  const compactLabelLine = texts.length >= 4 &&
    maxFontPt <= 10.5 &&
    compactCount / texts.length >= 0.72 &&
    signalCount >= 2 &&
    proseCount / texts.length < 0.55;

  const orderedRuns = finiteRuns
    .map(run => ({
      text: trimPositionedRunText(run.text),
      x: Number(run._sourceX),
      end: Number(run._sourceEnd ?? (Number(run._sourceX) + Number(run._sourceWidth || 0))),
      bold: !!run.bold
    }))
    .sort((a, b) => a.x - b.x);
  const sourceGapsPt = [];
  for (let i = 1; i < orderedRuns.length; i++) {
    sourceGapsPt.push((orderedRuns[i].x - orderedRuns[i - 1].end) / RENDER_SCALE);
  }
  const wideGapCount = sourceGapsPt.filter(gap => gap > Math.max(7, maxFontPt * 0.75)).length;
  const minSourceFontPt = Math.min(
    ...finiteRuns.map(run => Number(run._sourceFontSize || run.fontSize || 0)).filter(value => Number.isFinite(value) && value > 0),
    maxFontPt || 1
  );
  const separatedFormFragments = exactFormGeometry && finiteRuns.length >= 2 && (
    minSourceFontPt / Math.max(1, maxFontPt) < 0.9 ||
    wideGapCount >= 1
  );
  const words = texts.join(' ').match(/[A-Za-z][A-Za-z.'-]*/g) || [];
  const properNameWords = words.filter(word => /^[A-Z][A-Za-z.'-]+$/.test(word)).length;
  const mostlyBold = orderedRuns.filter(run => run.bold).length / Math.max(1, orderedRuns.length) >= 0.7;
  const authorOrNameListLine = orderedRuns.length >= 3 &&
    maxFontPt >= 7.5 &&
    maxFontPt <= 14.5 &&
    texts.join(' ').length <= 180 &&
    wideGapCount >= 2 &&
    mostlyBold &&
    properNameWords >= Math.min(6, Math.max(3, words.length * 0.65));

  const joinedText = texts.join(' ');
  const proseConnectorCount = (joinedText.match(/\b(?:a|an|and|are|as|at|by|for|from|in|is|of|on|or|that|the|to|was|were|with)\b/gi) || []).length;
  const alignedKeyValueLine = !!alignedKeyValueRunLayout(line);
  const proseLikeSeparatedLine = joinedText.length >= 24 && words.length >= 5 && proseConnectorCount >= 1 && !authorOrNameListLine;
  if (proseLikeSeparatedLine && !exactFormGeometry && !alignedKeyValueLine) return false;
  const compactSeparatedHeader = orderedRuns.length >= 2 &&
    orderedRuns.length <= 4 &&
    maxFontPt <= 10.5 &&
    joinedText.length <= 80 &&
    wideGapCount >= 1 &&
    texts.every(compactToken) &&
    !looksLikeBodyProseText(joinedText) &&
    !looksLikeNaturalLanguageFragmentText(joinedText);
  const smallSeparatedLabelLine = orderedRuns.length >= 4 &&
    maxFontPt <= 10.5 &&
    joinedText.length <= 180 &&
    wideGapCount >= Math.min(3, orderedRuns.length - 1) &&
    !looksLikeBodyProseText(joinedText) &&
    !looksLikeNaturalLanguageFragmentText(joinedText);

  // Very small, mixed-style text is usually a report embedded inside a larger
  // PDF canvas. Letting Word reflow its individual fragments produces the
  // familiar overlap/spacing failure even when the source geometry is sound.
  const denseMicroTypography = orderedRuns.length >= 2 &&
    orderedRuns.length <= 12 &&
    maxFontPt <= 5.5 &&
    texts.join(' ').length <= 260;

  const hasInlineBaselineShift = finiteRuns.some(run => !!run._verticalAlign);
  const tableHeaderLikeScriptLayout = hasInlineBaselineShift &&
    orderedRuns.length >= 3 &&
    wideGapCount >= Math.min(3, Math.max(1, texts.filter(text => /[A-Za-z]{2,}/.test(text)).length - 1)) &&
    texts.filter(text => /[A-Za-z]{2,}/.test(text)).length >= Math.min(3, orderedRuns.length) &&
    !/[=\u2208\u221a\u00d7]/.test(joinedText) &&
    !(joinedText.length >= 40 && proseConnectorCount >= 2) &&
    !looksLikeBodyProseText(joinedText) &&
    !looksLikeNaturalLanguageFragmentText(joinedText);
  if (hasInlineBaselineShift && !exactFormGeometry && !tableHeaderLikeScriptLayout) return false;
  const sourcePositionedScriptLayout = hasInlineBaselineShift && tableHeaderLikeScriptLayout;
  return separatedFormFragments || singleMicroRun || compactLabelLine || sourcePositionedScriptLayout || authorOrNameListLine ||
    compactSeparatedHeader ||
    alignedKeyValueLine || smallSeparatedLabelLine || denseMicroTypography;
}

function preserveSourceProseWordSpacing(line, sourceWidth, fallback = {}) {
  // Word-spacing expansion is only appropriate for justified PDF lines.
  // Applying it to ordinary left-aligned prose turns harmless font-metric
  // differences into visibly oversized gaps between every word.
  if (String(fallback.align || '').toLowerCase() !== 'justify') return line;
  // Inline mathematical scripts already carry their own measured geometry.
  // Redistributing the line's remaining width across surrounding spaces
  // creates large false gaps between identifiers and punctuation.
  if (line.some(run => !!run?._verticalAlign)) return line;
  const lineText = line.map(run => String(run?.text || '')).join('').replace(/\s+/g, ' ').trim();
  const gapCount = (lineText.match(/ /g) || []).length;
  if (gapCount < 3 ||
      !(looksLikeBodyProseText(lineText) || looksLikeNaturalLanguageFragmentText(lineText)) ||
      !Number.isFinite(sourceWidth) || sourceWidth <= 0) return line;

  const ctx = _measureCtx || (_measureCtx = document.createElement('canvas').getContext('2d'));
  let measuredWidth = 0;
  for (const run of line) {
    const fontSize = Number(run.fontSize || fallback.fontSize || 0);
    if (!Number.isFinite(fontSize) || fontSize <= 0) return line;
    ctx.font = _canvasTextFont({
      fontFamily: run.fontFamily || fallback.fontFamily || 'Arial',
      fontSize: fontSize * RENDER_SCALE,
      fontWeight: (run.bold ?? fallback.fontWeight === 'bold') ? 'bold' : 'normal',
      fontStyle: (run.italic ?? fallback.fontStyle === 'italic') ? 'italic' : 'normal'
    });
    measuredWidth += ctx.measureText(String(run.text || '').replace(/\s+/g, ' ')).width;
  }
  const expansionRatio = sourceWidth / measuredWidth;
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0 || expansionRatio <= 1.035 || expansionRatio > 1.28) return line;

  // OOXML character spacing is measured in twentieths of a point. Applying
  // it to one-character space runs preserves normal editable text while
  // matching the PDF's wider word gaps without inserting duplicate spaces.
  const extraPerGapPt = (sourceWidth - measuredWidth) / (gapCount * RENDER_SCALE);
  const wordSpacing = Math.max(1, Math.min(80, Math.round(extraPerGapPt * 20)));
  return line.flatMap(run => String(run.text || '').split(/(\s+)/).filter(Boolean).map(part => ({
    ...run,
    text: /^\s+$/.test(part) ? ' ' : part,
    _characterSpacing: /^\s+$/.test(part) ? wordSpacing : undefined
  })));
}

function preserveNameListSpacing(line, sourceWidth, fallback = {}) {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) return line;
  const lineText = line.map(run => String(run?.text || '')).join('').replace(/\s+/g, ' ').trim();
  const words = lineText.match(/[A-Za-z][A-Za-z.'-]*/g) || [];
  const properNameWords = words.filter(word => /^[A-Z][A-Za-z.'-]+$/.test(word)).length;
  const gapCount = (lineText.match(/ /g) || []).length;
  const fontSizes = line.map(run => Number(run?.fontSize || fallback.fontSize || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  const maxFontPt = fontSizes.length ? Math.max(...fontSizes) : 0;
  if (words.length < 5 || properNameWords < 5 || properNameWords / words.length < 0.68 ||
      gapCount < 2 || lineText.length > 190 || maxFontPt < 7.5 || maxFontPt > 14.5 ||
      /[,:;!?]/.test(lineText)) return line;

  const ctx = _measureCtx || (_measureCtx = document.createElement('canvas').getContext('2d'));
  let measuredWidth = 0;
  for (const run of line) {
    const fontSize = Number(run.fontSize || fallback.fontSize || 0);
    if (!Number.isFinite(fontSize) || fontSize <= 0) return line;
    ctx.font = _canvasTextFont({
      fontFamily: run.fontFamily || fallback.fontFamily || 'Arial',
      fontSize: fontSize * RENDER_SCALE,
      fontWeight: (run.bold ?? fallback.fontWeight === 'bold') ? 'bold' : 'normal',
      fontStyle: (run.italic ?? fallback.fontStyle === 'italic') ? 'italic' : 'normal'
    });
    measuredWidth += ctx.measureText(String(run.text || '').replace(/\s+/g, ' ')).width;
  }
  const expansionRatio = sourceWidth / measuredWidth;
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0 || expansionRatio <= 1.015 || expansionRatio > 1.24) return line;

  const extraPerGapPt = (sourceWidth - measuredWidth) / (gapCount * RENDER_SCALE);
  const wordSpacing = Math.max(1, Math.min(70, Math.round(extraPerGapPt * 20)));
  return line.flatMap(run => String(run.text || '').split(/(\s+)/).filter(Boolean).map(part => ({
    ...run,
    text: /^\s+$/.test(part) ? ' ' : part,
    _characterSpacing: /^\s+$/.test(part) ? wordSpacing : undefined
  })));
}

function preserveCompactTabularSpacing(line, sourceWidth, fallback = {}) {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) return line;
  const lineText = line.map(run => String(run?.text || '')).join('').replace(/\s+/g, ' ').trim();
  const tokens = lineText.split(' ').filter(Boolean);
  const fontSizes = line.map(run => Number(run?.fontSize || fallback.fontSize || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  const maxFontPt = fontSizes.length ? Math.max(...fontSizes) : 0;
  const compactValue = token => /^[✓✔]$/.test(token) || /^(?:[✓✔]\s*)?[+−-]?(?:\d+(?:\.\d+)?%?|n\/a)$/i.test(token);
  if (tokens.length < 2 || tokens.length > 4 || !tokens.every(compactValue) || maxFontPt > 10.5) return line;

  const ctx = _measureCtx || (_measureCtx = document.createElement('canvas').getContext('2d'));
  const sourceRuns = line.filter(run => String(run?.text || '').trim());
  if (sourceRuns.length > 1 && sourceRuns.every(hasSourceTextGeometry)) {
    const positioned = [];
    let previous = null;
    for (const run of sourceRuns) {
      const text = String(run.text || '');
      if (previous) {
        const sourceGap = Number(run._sourceX) -
          (Number(previous._sourceX) + Number(previous._sourceWidth));
        const fontSize = Number(run.fontSize || fallback.fontSize || 0);
        if (Number.isFinite(sourceGap) && sourceGap > 0 && Number.isFinite(fontSize) && fontSize > 0) {
          ctx.font = _canvasTextFont({
            fontFamily: run.fontFamily || fallback.fontFamily || 'Arial',
            fontSize: fontSize * RENDER_SCALE,
            fontWeight: (run.bold ?? fallback.fontWeight === 'bold') ? 'bold' : 'normal',
            fontStyle: (run.italic ?? fallback.fontStyle === 'italic') ? 'italic' : 'normal'
          });
          const normalSpacePt = ctx.measureText(' ').width / RENDER_SCALE;
          const sourceGapPt = sourceGap / RENDER_SCALE;
          positioned.push({
            ...run,
            text: ' ',
            _characterSpacing: Math.max(0, Math.min(160, Math.round((sourceGapPt - normalSpacePt) * 20)))
          });
        }
      }
      positioned.push({ ...run, text: text.replace(/^\s+/, '') });
      previous = run;
    }
    return positioned.filter(run => String(run.text || ''));
  }

  let measuredWidth = 0;
  for (const run of line) {
    const fontSize = Number(run.fontSize || fallback.fontSize || 0);
    if (!Number.isFinite(fontSize) || fontSize <= 0) return line;
    ctx.font = _canvasTextFont({
      fontFamily: run.fontFamily || fallback.fontFamily || 'Arial',
      fontSize: fontSize * RENDER_SCALE,
      fontWeight: (run.bold ?? fallback.fontWeight === 'bold') ? 'bold' : 'normal',
      fontStyle: (run.italic ?? fallback.fontStyle === 'italic') ? 'italic' : 'normal'
    });
    measuredWidth += ctx.measureText(String(run.text || '').replace(/\s+/g, ' ')).width;
  }
  const gapCount = tokens.length - 1;
  const extraPerGapPt = (sourceWidth - measuredWidth) / (gapCount * RENDER_SCALE);
  if (!Number.isFinite(extraPerGapPt) || extraPerGapPt <= 0.08 || extraPerGapPt > maxFontPt * 2.5) return line;
  const wordSpacing = Math.max(1, Math.min(160, Math.round(extraPerGapPt * 20)));
  return line.flatMap(run => String(run.text || '').split(/(\s+)/).filter(Boolean).map(part => ({
    ...run,
    text: /^\s+$/.test(part) ? ' ' : part,
    _characterSpacing: /^\s+$/.test(part) ? wordSpacing : undefined
  })));
}

function makeFidelityTextFrames(obj, alignmentMap) {
  const d = obj.data || {};
  const rawLines = Array.isArray(d.lines) && d.lines.length
    ? d.lines
    : [[{
      text: String(d.content || ''),
      fontFamily: d.fontFamily,
      fontSize: (d.fontSize || 12) / RENDER_SCALE,
      bold: d.fontWeight === 'bold',
      italic: d.fontStyle === 'italic',
      color: d.color || '#000000'
    }]];
  const rawLineBoxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length
    ? d._lineBoxes
    : rawLines.map((_, i) => ({
      x: obj.x,
      y: obj.y + i * (obj.height / Math.max(1, rawLines.length)),
      width: obj.width,
      height: obj.height / Math.max(1, rawLines.length)
    }));
  // Not every extraction path has segment-level script metadata. Normalize
  // measured baselines here as the shared DOCX handoff so editable scripts
  // behave consistently in tables, figures, and ordinary positioned text.
  const scriptLines = rawLines.map(line => {
    const measured = normalizeMeasuredInlineRuns(line);
    return measured.some(run => !!run?._verticalAlign)
      ? measured
      : markInlineScriptRuns(measured);
  });
  const normalized = splitMixedBaselineRuns(scriptLines, rawLineBoxes, obj);
  const lines = normalized.lines;
  const lineBoxes = normalized.lineBoxes;

  return lines.flatMap((rawLine, i) => {
    const line = normalizeLineRunColorsForDocx(rawLine, d);
    const box = lineBoxes[i] || lineBoxes[lineBoxes.length - 1] || obj;
    if (shouldUseSourcePositionedRunFrames(line, box, obj, d)) {
      const frames = makeSourcePositionedRunFrames(line, box, obj, d);
      if (frames.length) return frames;
    }
    const lineFontSizesPt = line
      .map(run => Number(run.fontSize || 0))
      .filter(value => Number.isFinite(value) && value > 0);
    const objectFontPt = Number(d.fontSize || 0) / RENDER_SCALE || 0;
    const lineMaxFontPt = lineFontSizesPt.length ? Math.max(...lineFontSizesPt) : 0;
    const useLineFontMetrics = normalized.hasDropCapLayout &&
      lineMaxFontPt > 0 && objectFontPt >= lineMaxFontPt * 1.8;
    const maxFontPt = Math.max(
      2,
      ...(lineFontSizesPt.length ? lineFontSizesPt : [objectFontPt]),
      useLineFontMetrics ? 0 : objectFontPt
    );
    const xPt = Math.max(0, (box.x ?? obj.x) / RENDER_SCALE);
    const yPt = Math.max(
      0,
      (box.y ?? obj.y) / RENDER_SCALE +
        Math.max(0, ...line.map(run => Number(run._docxYAdjustPt || 0)))
    );
    const lineText = line.map(run => String(run.text ?? '')).join('');
    const measuredWidthPt = (box.width ?? obj.width) / RENDER_SCALE;
    const measuredHeightPt = (box.height ?? obj.height) / RENDER_SCALE;
    const isSmallText = maxFontPt <= 7;
    const compactNumericScriptLine = lineText.trim().length <= 64 &&
      line.some(run => !!run?._verticalAlign && /^\s*\d{1,3}\s*$/.test(String(run?.text || ''))) &&
      /\d(?:\.\d+)?\s*[\u00B7\u22C5\u00D7*]\s*10\s*\d/u.test(lineText);
    const useExactLineMetrics = isSmallText || compactNumericScriptLine;
    const rotation = Number(box.rotation ?? obj.rotation ?? d._originalBox?.rotation ?? 0) || 0;
    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const isRotatedText = Math.min(normalizedRotation, 360 - normalizedRotation) > 3;
    // A PDF can use a CFF/Type1 face that Word cannot embed as a portable
    // DOCX font. Keep one-run display text anchored to its measured PDF width
    // so a metric-different fallback face does not drift into nearby artwork.
    const singleRun = line.length === 1 && hasSourceTextGeometry(line[0]);
    const compactDisplayText = lineText.trim().length <= 96 &&
      !looksLikeBodyProseText(lineText) &&
      !looksLikeNaturalLanguageFragmentText(lineText);
    const sourceWidthConstrainedRun = singleRun &&
      (maxFontPt >= 10 || isSmallText || compactDisplayText);
    const proseSpacedLine = preserveSourceProseWordSpacing(
      line,
      Number(box.width ?? obj.width),
      d
    );
    const sourceSpacedLine = proseSpacedLine.some(run => Number.isFinite(run._characterSpacing))
      ? proseSpacedLine
      : preserveNameListSpacing(line, Number(box.width ?? obj.width), d);
    const tabularSpacedLine = sourceSpacedLine.some(run => Number.isFinite(run._characterSpacing))
      ? sourceSpacedLine
      : preserveCompactTabularSpacing(line, Number(box.width ?? obj.width), d);
    const hasSourceWordSpacing = tabularSpacedLine.some(run => Number.isFinite(run._characterSpacing));
    const outputLine = sourceWidthConstrainedRun && !hasSourceWordSpacing
      ? line.map(run => ({ ...run, _fitToSourceWidth: true }))
      : tabularSpacedLine;
    const runs = outputLine.map(run => makeDocxTextRun(run, d)).filter(Boolean);
    const fallbackWidthPt = lineText.length ? lineText.length * maxFontPt * (isSmallText ? 0.58 : 0.64) : 0;
    const isProseLine = !isSmallText && /\s/.test(lineText) && lineText.trim().length >= 24;
    const compactFormLabel = d?._sourcePositionedFormText === true &&
      maxFontPt <= 9.5 &&
      lineText.trim().length <= 40 &&
      !looksLikeBodyProseText(lineText);
    const widthPad = isRotatedText
      ? 0
      : compactFormLabel
      ? Math.max(maxFontPt * 1.4, Math.min(maxFontPt * 2, measuredWidthPt * 0.18))
      : compactNumericScriptLine
      ? Math.max(maxFontPt * 1.4, measuredWidthPt * 0.16)
      : isProseLine
      ? Math.max(maxFontPt * 2.5, Math.min(maxFontPt * 6, measuredWidthPt * 0.09))
      : Math.max(
      maxFontPt * (isSmallText ? 0.35 : 0.55),
      Math.min(maxFontPt * (isSmallText ? 0.60 : 0.95), measuredWidthPt * 0.035)
    );
    const wPt = Math.max(maxFontPt * 0.8, measuredWidthPt > 0 ? measuredWidthPt + widthPad : fallbackWidthPt);
    const hPt = Math.max(maxFontPt * (isSmallText ? 1.45 : 1.65), measuredHeightPt + maxFontPt * (isSmallText ? 0.35 : 0.45));
    const align = (d._lineAligns && d._lineAligns[i]) || d.align || 'left';

    if (isRotatedText) {
      return new docx.Paragraph({
        spacing: { before: 0, after: 0, line: 1, lineRule: docx.LineRuleType.EXACT },
        children: [new docx.TextRun({
          text: rotatedTextMarker({
            x: xPt,
            y: yPt,
            width: wPt,
            height: hPt,
            rotation: -rotation,
            align,
            runs: line
          }),
          size: 2,
          color: 'FFFFFF'
        })]
      });
    }

    return new docx.Paragraph({
      frame: {
        type: 'absolute',
        position: { x: pointsToTwips(xPt), y: pointsToTwips(yPt) },
        width: pointsToTwips(wPt),
        height: pointsToTwips(hPt),
        anchor: {
          horizontal: docx.FrameAnchorType.PAGE,
          vertical: docx.FrameAnchorType.PAGE
        },
        wrap: docx.FrameWrap.NONE,
        space: { horizontal: 0, vertical: 0 },
        rule: useExactLineMetrics ? docx.HeightRule.EXACT : docx.HeightRule.ATLEAST
      },
      // Source-spaced runs already encode the PDF's justification. Asking
      // Word to justify the same one-line frame again expands those spaces a
      // second time and creates visibly irregular gaps.
      alignment: hasSourceWordSpacing
        ? docx.AlignmentType.LEFT
        : (alignmentMap[align] || docx.AlignmentType.LEFT),
      spacing: {
        before: 0,
        after: 0,
        line: pointsToTwips(maxFontPt * (isSmallText ? 1.08 : 1.18)),
        lineRule: useExactLineMetrics ? docx.LineRuleType.EXACT : docx.LineRuleType.AT_LEAST
      },
      children: [
        ...(runs.length ? runs : [makeDocxTextRun({ text: '' }, d)])
      ]
    });
  });
}

const SYMBOL_PRIVATE_USE_MAP = new Map([
  [0x20, ' '], [0x21, '!'], [0x22, '\u2200'], [0x23, '#'], [0x24, '\u2203'], [0x25, '%'],
  [0x26, '&'], [0x27, '\u220b'], [0x28, '('], [0x29, ')'], [0x2a, '*'], [0x2b, '+'],
  [0x2c, ','], [0x2d, '\u2212'], [0x2e, '.'], [0x2f, '/'], [0x30, '0'], [0x31, '1'],
  [0x32, '2'], [0x33, '3'], [0x34, '4'], [0x35, '5'], [0x36, '6'], [0x37, '7'],
  [0x38, '8'], [0x39, '9'], [0x3a, ':'], [0x3b, ';'], [0x3c, '<'], [0x3d, '='],
  [0x3e, '>'], [0x3f, '?'], [0x40, '\u2245'],
  [0x41, '\u0391'], [0x42, '\u0392'], [0x43, '\u03a7'], [0x44, '\u0394'], [0x45, '\u0395'],
  [0x46, '\u03a6'], [0x47, '\u0393'], [0x48, '\u0397'], [0x49, '\u0399'], [0x4a, '\u03d1'],
  [0x4b, '\u039a'], [0x4c, '\u039b'], [0x4d, '\u039c'], [0x4e, '\u039d'], [0x4f, '\u039f'],
  [0x50, '\u03a0'], [0x51, '\u0398'], [0x52, '\u03a1'], [0x53, '\u03a3'], [0x54, '\u03a4'],
  [0x55, '\u03a5'], [0x56, '\u03c2'], [0x57, '\u03a9'], [0x58, '\u039e'], [0x59, '\u03a8'],
  [0x5a, '\u0396'], [0x5b, '['], [0x5c, '\u2234'], [0x5d, ']'], [0x5e, '\u22a5'], [0x5f, '_'],
  [0x60, '\uf8e5'],
  [0x61, '\u03b1'], [0x62, '\u03b2'], [0x63, '\u03c7'], [0x64, '\u03b4'], [0x65, '\u03b5'],
  [0x66, '\u03c6'], [0x67, '\u03b3'], [0x68, '\u03b7'], [0x69, '\u03b9'], [0x6a, '\u03d5'],
  [0x6b, '\u03ba'], [0x6c, '\u03bb'], [0x6d, '\u03bc'], [0x6e, '\u03bd'], [0x6f, '\u03bf'],
  [0x70, '\u03c0'], [0x71, '\u03b8'], [0x72, '\u03c1'], [0x73, '\u03c3'], [0x74, '\u03c4'],
  [0x75, '\u03c5'], [0x76, '\u03d6'], [0x77, '\u03c9'], [0x78, '\u03be'], [0x79, '\u03c8'],
  [0x7a, '\u03b6'], [0x7b, '{'], [0x7c, '|'], [0x7d, '}'], [0x7e, '~'],
  [0xa0, '\u20ac'], [0xa1, '\u03d2'], [0xa2, '\u2032'], [0xa3, '\u2264'], [0xa4, '\u2044'],
  [0xa5, '\u221e'], [0xa6, '\u0192'], [0xa7, '\u2663'], [0xa8, '\u2666'], [0xa9, '\u2665'],
  [0xaa, '\u2660'], [0xab, '\u2194'], [0xac, '\u2190'], [0xad, '\u2191'], [0xae, '\u2192'],
  [0xaf, '\u2193'], [0xb0, '\u00b0'], [0xb1, '\u00b1'], [0xb2, '\u2033'], [0xb3, '\u2265'],
  [0xb4, '\u00d7'], [0xb5, '\u221d'], [0xb6, '\u2202'], [0xb7, '\u2022'], [0xb8, '\u00f7'],
  [0xb9, '\u2260'], [0xba, '\u2261'], [0xbb, '\u2248'], [0xbc, '\u2026'], [0xbd, '\u23d0'],
  [0xbe, '\u23af'], [0xbf, '\u21b5'], [0xc0, '\u2135'], [0xc1, '\u2111'], [0xc2, '\u211c'],
  [0xc3, '\u2118'], [0xc4, '\u2297'], [0xc5, '\u2295'], [0xc6, '\u2205'], [0xc7, '\u2229'],
  [0xc8, '\u222a'], [0xc9, '\u2283'], [0xca, '\u2287'], [0xcb, '\u2284'], [0xcc, '\u2282'],
  [0xcd, '\u2286'], [0xce, '\u2208'], [0xcf, '\u2209'], [0xd0, '\u2220'], [0xd1, '\u2207'],
  [0xd2, '\u00ae'], [0xd3, '\u00a9'], [0xd4, '\u2122'], [0xd5, '\u220f'], [0xd6, '\u221a'],
  [0xd7, '\u22c5'], [0xd8, '\u00ac'], [0xd9, '\u2227'], [0xda, '\u2228'], [0xdb, '\u21d4'],
  [0xdc, '\u21d0'], [0xdd, '\u21d1'], [0xde, '\u21d2'], [0xdf, '\u21d3'], [0xe0, '\u25ca'],
  [0xe1, '\u2329'], [0xe2, '\u00ae'], [0xe3, '\u00a9'], [0xe4, '\u2122'], [0xe5, '\u2211'],
  [0xe6, '\u239b'], [0xe7, '\u239c'], [0xe8, '\u239d'], [0xe9, '\u23a1'], [0xea, '\u23a2'],
  [0xeb, '\u23a3'], [0xec, '\u23a7'], [0xed, '\u23a8'], [0xee, '\u23a9'], [0xef, '\u23aa'],
  [0xf1, '\u232a'], [0xf2, '\u222b'], [0xf3, '\u2320'], [0xf4, '\u23ae'], [0xf5, '\u2321'],
  [0xf6, '\u239e'], [0xf7, '\u239f'], [0xf8, '\u23a0'], [0xf9, '\u23a4'], [0xfa, '\u23a5'],
  [0xfb, '\u23a6'], [0xfc, '\u23ab'], [0xfd, '\u23ac'], [0xfe, '\u23ad']
]);

function isSymbolEncodedFontName(name) {
  return /\bsymbol(mt)?\b/i.test(String(name || '').replace(/^[A-Z]{6}\+/, ' '));
}

function decodeSymbolPrivateUseText(text, fontName) {
  const value = String(text || '');
  if (!/[\uf000-\uf0ff]/.test(value)) return value;
  const commonBulletMap = new Map([[0xf0a7, '\u25aa'], [0xf0b7, '\u2022']]);
  const symbolFont = isSymbolEncodedFontName(fontName);
  return Array.from(value).map(ch => {
    const code = ch.codePointAt(0);
    if (code < 0xf000 || code > 0xf0ff) return ch;
    if (commonBulletMap.has(code)) return commonBulletMap.get(code);
    return symbolFont ? (SYMBOL_PRIVATE_USE_MAP.get(code - 0xf000) || ch) : ch;
  }).join('');
}

function isLegacyEncodedPdfText(text, fontName) {
  return /^g_d\d+_f\d+$/i.test(String(fontName || '')) &&
    /[ --]/.test(String(text || ''));
}

function decodeShiftedAsciiSubsetText(text, fontName, force = false) {
  const value = String(text || '');
  if (!/^g_d\d+_f\d+$/i.test(String(fontName || '')) || (!force && !/\x05/.test(value))) return value;
  const letters = value.match(/[F-Z[\]\\^_]/g) || [];
  if (!force && letters.length < 3) return value;
  const punctuation = new Map([
    [0x05, ' '], [0x0e, ')'], [0x11, ','], [0x12, '-'], [0x13, '.'],
    [0x14, '/'], [0x1f, ':'], [0x22, "'"], [0x24, '?'], [0x25, '@']
  ]);
  return Array.from(value).map(char => {
    const code = char.codePointAt(0);
    if (punctuation.has(code)) return punctuation.get(code);
    if (code >= 0x15 && code <= 0x1e) return String.fromCharCode(0x30 + code - 0x15);
    if (code >= 0x26 && code <= 0x3f) return String.fromCharCode(0x41 + code - 0x26);
    if (code >= 0x46 && code <= 0x5f) return String.fromCharCode(0x61 + code - 0x46);
    return char;
  }).join('');
}

function eraseRegion(ctx, box, padScale = 0.06) {
  if (!ctx?.canvas || !box) return;
  const pad = Math.max(1, Math.round(Math.min(box.width || 12, box.height || 12) * padScale));
  const x = Math.max(0, Math.floor((box.x || 0) - pad));
  const y = Math.max(0, Math.floor((box.y || 0) - pad));
  const w = Math.min(ctx.canvas.width - x, Math.ceil((box.width || 1) + pad * 2));
  const h = Math.min(ctx.canvas.height - y, Math.ceil((box.height || 1) + pad * 2));
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.fillStyle = _sampleCanvasBorderColor(ctx, { x, y, width: w, height: h });
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function _hexToRgb(hex, fallback = [255, 255, 255]) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return fallback;
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
}

function _sampleTextInnerBackgroundColor(ctx, x, y, w, h, expectedInkColor = null) {
  let img;
  try { img = ctx.getImageData(x, y, w, h).data; } catch { return null; }
  const expected = _hexToRgb(expectedInkColor, null);
  const insetX = Math.max(1, Math.min(Math.floor(w * 0.14), Math.floor(w / 3)));
  const insetY = Math.max(1, Math.min(Math.floor(h * 0.14), Math.floor(h / 3)));
  const stride = Math.max(1, Math.floor(Math.max(w, h) / 36));
  const buckets = new Map();
  const add = (px, py) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const i = (py * w + px) * 4;
    if (img[i + 3] < 30) return;
    if (expected) {
      const dr = img[i] - expected[0], dg = img[i + 1] - expected[1], db = img[i + 2] - expected[2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) < 72) return;
    }
    const key = `${img[i] >> 4},${img[i + 1] >> 4},${img[i + 2] >> 4}`;
    const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++; bucket.r += img[i]; bucket.g += img[i + 1]; bucket.b += img[i + 2];
    buckets.set(key, bucket);
  };
  for (let px = insetX; px < w - insetX; px += stride) {
    add(px, insetY);
    add(px, h - 1 - insetY);
  }
  for (let py = insetY; py < h - insetY; py += stride) {
    add(insetX, py);
    add(w - 1 - insetX, py);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best || best.n < 3) return null;
  return [
    Math.round(best.r / best.n),
    Math.round(best.g / best.n),
    Math.round(best.b / best.n)
  ];
}

function _sampleTextEraseColor(ctx, x, y, w, h, borderColor, expectedInkColor = null) {
  const border = _hexToRgb(borderColor);
  if (/^#?[0-9a-f]{6}$/i.test(String(expectedInkColor || ''))) {
    const inner = _sampleTextInnerBackgroundColor(ctx, x, y, w, h, expectedInkColor);
    if (inner) return inner;
    const sampled = _sampleCanvasColor(ctx, { x, y, width: w, height: h }, expectedInkColor);
    return _hexToRgb(sampled, border);
  }
  const inkMatch = String(expectedInkColor || '').match(/^#?([0-9a-f]{6})$/i);
  const expectedInk = inkMatch
    ? [0, 2, 4].map(i => parseInt(inkMatch[1].slice(i, i + 2), 16))
    : null;
  let img;
  try { img = ctx.getImageData(x, y, w, h).data; } catch { return border; }
  const area = w * h;
  const stride = area < 1200 ? 1 : Math.max(1, Math.floor(Math.sqrt(area / 900)));
  const buckets = new Map();
  for (let py = 0; py < h; py += stride) {
    for (let px = 0; px < w; px += stride) {
      const i = (py * w + px) * 4;
      if (img[i + 3] < 30) continue;
      if (expectedInk) {
        const dr = img[i] - expectedInk[0];
        const dg = img[i + 1] - expectedInk[1];
        const db = img[i + 2] - expectedInk[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) < 72) continue;
      }
      const lum = (img[i] + img[i + 1] + img[i + 2]) / 3;
      if (lum < 70) continue;
      const key = `${img[i] >> 4},${img[i + 1] >> 4},${img[i + 2] >> 4}`;
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += img[i]; b.g += img[i + 1]; b.b += img[i + 2]; buckets.set(key, b);
    }
  }
  let best = null;
  let bestChromatic = null;
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b;
    const r = b.r / Math.max(1, b.n);
    const g = b.g / Math.max(1, b.n);
    const blue = b.b / Math.max(1, b.n);
    if (Math.max(r, g, blue) - Math.min(r, g, blue) > 42 && (!bestChromatic || b.n > bestChromatic.n)) {
      bestChromatic = b;
    }
  }
  if (!best || best.n < 2) return border;
  const borderLum = (border[0] + border[1] + border[2]) / 3;
  if (bestChromatic && borderLum > 220 && bestChromatic.n >= Math.max(3, best.n * 0.18)) best = bestChromatic;
  return [
    Math.round(best.r / best.n),
    Math.round(best.g / best.n),
    Math.round(best.b / best.n)
  ];
}

function eraseTextRegion(ctx, box, padScale = 0.16, expectedInkColor = null, sampleCtx = ctx, preserveLineArt = true, nativeCtx = null, textureAware = false) {
  if (!ctx?.canvas || !box) return;
  const pad = Math.max(1, Math.round(Math.min(box.width || 12, box.height || 12) * padScale));
  const x = Math.max(0, Math.floor((box.x || 0) - pad));
  const y = Math.max(0, Math.floor((box.y || 0) - pad));
  const w = Math.min(ctx.canvas.width - x, Math.ceil((box.width || 1) + pad * 2));
  const h = Math.min(ctx.canvas.height - y, Math.ceil((box.height || 1) + pad * 2));
  if (w <= 0 || h <= 0) return;

  const borderColor = _sampleCanvasBorderColor(sampleCtx, { x, y, width: w, height: h });
  const bg = _sampleTextEraseColor(sampleCtx, x, y, w, h, borderColor, expectedInkColor);
  const inkMatch = String(expectedInkColor || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const expectedInk = inkMatch
    ? [parseInt(inkMatch[1], 16), parseInt(inkMatch[2], 16), parseInt(inkMatch[3], 16)]
    : null;
  const img = ctx.getImageData(x, y, w, h);
  const data = img.data;
  const sourceData = textureAware ? new Uint8ClampedArray(data) : null;
  let nativeData = null;
  if (nativeCtx?.canvas) {
    try { nativeData = nativeCtx.getImageData(x, y, w, h).data; } catch { nativeData = null; }
  }
  const isInk = (px, py, threshold = 28) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return false;
    const i = (py * w + px) * 4;
    if (data[i + 3] < 30) return false;
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db > threshold * threshold;
  };
  const matchesExpectedInk = (r, g, b) => {
    if (!expectedInk) return true;
    const vx = expectedInk[0] - bg[0];
    const vy = expectedInk[1] - bg[1];
    const vz = expectedInk[2] - bg[2];
    const lengthSquared = vx * vx + vy * vy + vz * vz;
    if (lengthSquared < 36) return true;
    const px = r - bg[0], py = g - bg[1], pz = b - bg[2];
    const projection = (px * vx + py * vy + pz * vz) / lengthSquared;
    if (projection < 0.05 || projection > 1.35) return false;
    const clamped = Math.max(0, Math.min(1, projection));
    const dr = r - (bg[0] + vx * clamped);
    const dg = g - (bg[1] + vy * clamped);
    const db = b - (bg[2] + vz * clamped);
    return dr * dr + dg * dg + db * db <= 42 * 42;
  };
  const horizontalMin = Math.min(Math.max(18, Math.round(w * 0.42)), 52);
  const copyTexturePixel = (px, py, index) => {
    const top = px * 4;
    const bottom = ((h - 1) * w + px) * 4;
    const left = (py * w) * 4;
    const right = (py * w + w - 1) * 4;
    const verticalWeight = Math.max(1, w);
    const horizontalWeight = Math.max(1, h);
    for (let channel = 0; channel < 3; channel++) {
      const vertical = sourceData[top + channel] * (h - 1 - py) / Math.max(1, h - 1) +
        sourceData[bottom + channel] * py / Math.max(1, h - 1);
      const horizontal = sourceData[left + channel] * (w - 1 - px) / Math.max(1, w - 1) +
        sourceData[right + channel] * px / Math.max(1, w - 1);
      data[index + channel] = Math.round((vertical * verticalWeight + horizontal * horizontalWeight) /
        (verticalWeight + horizontalWeight));
    }
    data[index + 3] = 255;
  };

  // Preserve exactly the same continuous-line test as the former per-pixel
  // bidirectional scans, but compute each horizontal/vertical run once. On a
  // table rule or chart leader the old work grew quadratically with line length.
  let horizontalRuns = null;
  if (preserveLineArt) {
    horizontalRuns = new Uint16Array(w * h);
    for (let py = 0; py < h; py++) {
      let start = -1;
      for (let px = 0; px <= w; px++) {
        const ink = px < w && isInk(px, py, 36);
        if (ink && start < 0) start = px;
        if (!ink && start >= 0) {
          const length = px - start;
          horizontalRuns.fill(length, py * w + start, py * w + px);
          start = -1;
        }
      }
    }
  }

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (!isInk(px, py)) continue;
      const index = py * w + px;
      // Text glyph stems are frequently long enough to look like vertical
      // rules inside a tight label box. Preserve horizontal chart/table rules,
      // but do not keep vertical glyph strokes as baked duplicate text.
      const keepLineArt = preserveLineArt && horizontalRuns[index] >= horizontalMin;
      if (keepLineArt) continue;
      const i = (py * w + px) * 4;
      if (nativeData && nativeData[i + 3] >= 80) {
        const nativeDistance = Math.abs(data[i] - nativeData[i]) +
          Math.abs(data[i + 1] - nativeData[i + 1]) +
          Math.abs(data[i + 2] - nativeData[i + 2]);
        // Pixels that match the clean embedded image are artwork rather than
        // extracted overlay text. Text painted over the image differs in color
        // and is still removed before editable DOCX text is placed above it.
        if (nativeDistance <= 72) continue;
      }
      // On solid/vector backdrops the full text box is known to be rebuilt as
      // editable text. Do not retain anti-aliased glyph pixels just because
      // PDF.js reports a slightly different run color. For charts, where a
      // rule may legitimately cross the label, keep the stricter color gate.
      if (preserveLineArt && !matchesExpectedInk(data[i], data[i + 1], data[i + 2])) continue;
      if (textureAware) copyTexturePixel(px, py, i);
      else {
        data[i] = bg[0];
        data[i + 1] = bg[1];
        data[i + 2] = bg[2];
        data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, x, y);
}

function eraseFlatBackdropTextBox(ctx, box, sampleCtx = ctx) {
  if (!ctx?.canvas || !box || !sampleCtx?.canvas) return false;
  const pad = Math.max(2, Math.min(18, Math.round(Math.max(
    Number(box.height || 12) * 0.52,
    Math.min(Number(box.width || 12), Number(box.height || 12)) * 0.20
  ))));
  const x = Math.max(0, Math.floor((box.x || 0) - pad));
  const y = Math.max(0, Math.floor((box.y || 0) - pad));
  const w = Math.min(ctx.canvas.width - x, Math.ceil((box.width || 1) + pad * 2));
  const h = Math.min(ctx.canvas.height - y, Math.ceil((box.height || 1) + pad * 2));
  if (w <= 2 || h <= 2) return false;
  const bg = _hexToRgb(_sampleCanvasBorderColor(sampleCtx, { x, y, width: w, height: h }));
  let pixels;
  try { pixels = sampleCtx.getImageData(x, y, w, h).data; } catch { return false; }
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 900)));
  let samples = 0;
  let background = 0;
  let borderSamples = 0;
  let borderBackground = 0;
  const borderDepth = Math.max(step * 2, Math.min(12, Math.floor(Math.min(w, h) * 0.16)));
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const i = (py * w + px) * 4;
      if (pixels[i + 3] < 30) continue;
      const dr = pixels[i] - bg[0];
      const dg = pixels[i + 1] - bg[1];
      const db = pixels[i + 2] - bg[2];
      const matchesBackground = dr * dr + dg * dg + db * db <= 28 * 28;
      if (matchesBackground) background++;
      if (px < borderDepth || py < borderDepth || px >= w - borderDepth || py >= h - borderDepth) {
        borderSamples++;
        if (matchesBackground) borderBackground++;
      }
      samples++;
    }
  }
  // Solid cards, pills and table bands have one dominant color. Replacing the
  // whole line box there is both cleaner and more faithful than leaving glyph
  // stems that resemble random rules. Photographs fail this uniformity gate.
  const backgroundRatio = samples ? background / samples : 0;
  const borderRatio = borderSamples ? borderBackground / borderSamples : 0;
  if (!samples || backgroundRatio < 0.34 || borderRatio < 0.68) return false;
  ctx.save();
  ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  return true;
}

function isPaleDecorativeRegion(ctx, box) {
  if (!ctx?.canvas || !box) return false;
  const x = Math.max(0, Math.floor(box.x || 0));
  const y = Math.max(0, Math.floor(box.y || 0));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(box.width || 0));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(box.height || 0));
  if (w < 8 || h < 8) return false;

  const stepX = Math.max(1, Math.floor(w / 48));
  const stepY = Math.max(1, Math.floor(h / 48));
  const data = ctx.getImageData(x, y, w, h).data;
  let count = 0;
  let lumTotal = 0;
  let satTotal = 0;
  let dark = 0;

  for (let py = 0; py < h; py += stepY) {
    for (let px = 0; px < w; px += stepX) {
      const i = (py * w + px) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      lumTotal += lum;
      satTotal += max - min;
      if (lum < 178) dark++;
      count++;
    }
  }

  if (!count) return false;
  const avgLum = lumTotal / count;
  const avgSat = satTotal / count;
  const darkRatio = dark / count;
  return avgLum > 218 && avgSat < 58 && darkRatio < 0.055;
}

function makeTextErasedBackground(canvas, textObjs, imageObjs = []) {
  const bg = document.createElement('canvas');
  bg.width = canvas.width;
  bg.height = canvas.height;
  const ctx = bg.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);

  for (const obj of textObjs) {
    const boxes = obj.data?._lineBoxes?.length ? obj.data._lineBoxes : [obj.data?._originalBox || obj];
    boxes.forEach(box => eraseTextRegion(ctx, box, 0.16));
  }
  for (const obj of imageObjs) {
    const box = obj.data?._originalBox || obj;
    if (!isPaleDecorativeRegion(ctx, box)) eraseRegion(ctx, box);
  }
  return bg;
}

function eraseTextFromImageCrop(ctx, imageBox, textObjs = [], scaleRatio = 1, preserveLineArt = true, nativeCtx = null, textureAware = false) {
  if (!ctx?.canvas || !imageBox || !Array.isArray(textObjs) || !textObjs.length) return;
  const crop = {
    x: Number(imageBox.x || 0),
    y: Number(imageBox.y || 0),
    width: Number(imageBox.width || 0),
    height: Number(imageBox.height || 0)
  };
  if (crop.width <= 0 || crop.height <= 0) return;
  const cropRight = crop.x + crop.width;
  const cropBottom = crop.y + crop.height;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = ctx.canvas.width;
  sampleCanvas.height = ctx.canvas.height;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sampleCtx.drawImage(ctx.canvas, 0, 0);
  for (const obj of textObjs) {
    const boxes = obj?.data?._lineBoxes?.length ? obj.data._lineBoxes : [obj?.data?._originalBox || obj];
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const box = boxes[boxIndex];
      if (!box) continue;
      const lineRuns = Array.isArray(obj?.data?.lines?.[boxIndex]) ? obj.data.lines[boxIndex] : [];
      const sourceRunBoxes = lineRuns.flatMap(run => {
        const x = Number(run?._sourceX);
        const y = Number(run?._sourceY);
        const width = Number(run?._sourceWidth);
        const height = Number(run?._sourceHeight);
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
        return [{
          x,
          y,
          width,
          height,
          color: run?.color || obj?.data?.color || null
        }];
      });
      const visualBox = {
        x: Number(box.x ?? obj.x ?? 0),
        y: Number(box.y ?? obj.y ?? 0),
        width: Number(box.width ?? obj.width ?? 0),
        height: Number(box.height ?? obj.height ?? 0),
        rotation: Number(box.rotation ?? obj.rotation ?? obj?.data?._originalBox?.rotation ?? 0),
        color: null
      };
      const normalizedRotation = normalizeDegrees(visualBox.rotation);
      const rotated = Math.min(normalizedRotation, 360 - normalizedRotation) > 3;
      let rotatedVisualBox = visualBox;
      if (rotated) {
        const theta = normalizedRotation * Math.PI / 180;
        const bboxWidth = Math.abs(visualBox.width * Math.cos(theta)) + Math.abs(visualBox.height * Math.sin(theta));
        const bboxHeight = Math.abs(visualBox.width * Math.sin(theta)) + Math.abs(visualBox.height * Math.cos(theta));
        // Rotated PDF text objects store the visual top-left at x/y while their
        // width and height still describe the unrotated line box.
        rotatedVisualBox = {
          ...visualBox,
          x: visualBox.x,
          y: visualBox.y,
          width: bboxWidth,
          height: bboxHeight,
          rotation: 0
        };
      }
      // Source-run bounds are the least destructive choice for ordinary text.
      // They are unrotated PDF coordinates, so rotated text must use the actual
      // visual bounding box instead.
      const eraseBoxes = rotated
        ? [rotatedVisualBox]
        : (sourceRunBoxes.length ? sourceRunBoxes : [visualBox]);
      for (const eraseBox of eraseBoxes) {
        const x = eraseBox.x;
        const y = eraseBox.y;
        const width = eraseBox.width;
        const height = eraseBox.height;
        if (width <= 0 || height <= 0) continue;
        const right = x + width;
        const bottom = y + height;
        const overlapX = Math.max(0, Math.min(right, cropRight) - Math.max(x, crop.x));
        const overlapY = Math.max(0, Math.min(bottom, cropBottom) - Math.max(y, crop.y));
        if (!overlapX || !overlapY) continue;
        const textArea = Math.max(1, width * height);
        const centerInside = x + width / 2 >= crop.x && x + width / 2 <= cropRight &&
          y + height / 2 >= crop.y && y + height / 2 <= cropBottom;
        const overlapRatio = (overlapX * overlapY) / textArea;
        if (!centerInside && (overlapRatio < 0.04 || overlapX < 1.5 || overlapY < height * 0.25)) continue;
        const colorWeights = new Map();
        for (const run of lineRuns) {
          const color = String(run?.color || obj?.data?.color || '').toLowerCase();
          if (!/^#[0-9a-f]{6}$/.test(color)) continue;
          colorWeights.set(color, (colorWeights.get(color) || 0) + Math.max(1, String(run?.text || '').trim().length));
        }
        const expectedInkColor = eraseBox.color ||
          [...colorWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || obj?.data?.color || null;
        const cropLocalBox = {
          x: (x - crop.x) * scaleRatio,
          y: (y - crop.y) * scaleRatio,
          width: width * scaleRatio,
          height: height * scaleRatio
        };
        // Never paint a full rectangle over the source artwork. That destroys
        // rounded pills, bar edges and photographs. Remove only rendered glyph
        // pixels, then place the editable DOCX text over the clean graphic.
        eraseTextRegion(ctx, cropLocalBox, rotated ? 0.06 : 0.10, expectedInkColor, sampleCtx, preserveLineArt, nativeCtx, textureAware);
      }
    }
  }
  sampleCanvas.width = 0;
  sampleCanvas.height = 0;
}

const _nativeImageCanvasCache = new WeakMap();

function nativePdfImageSource(asset) {
  if (!asset) return null;
  if (asset.bitmap) return asset.bitmap;
  if (!asset.data || !asset.width || !asset.height) return null;
  if (_nativeImageCanvasCache.has(asset)) return _nativeImageCanvasCache.get(asset);
  const width = Math.max(1, Number(asset.width || 0));
  const height = Math.max(1, Number(asset.height || 0));
  const input = asset.data instanceof Uint8ClampedArray
    ? asset.data
    : new Uint8ClampedArray(asset.data.buffer || asset.data, asset.data.byteOffset || 0, asset.data.byteLength || asset.data.length);
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (input.length === pixels.length) {
    pixels.set(input);
  } else if (input.length === width * height * 3) {
    for (let source = 0, target = 0; source < input.length; source += 3, target += 4) {
      pixels[target] = input[source];
      pixels[target + 1] = input[source + 1];
      pixels[target + 2] = input[source + 2];
      pixels[target + 3] = 255;
    }
  } else if (input.length === width * height) {
    for (let source = 0, target = 0; source < input.length; source++, target += 4) {
      pixels[target] = pixels[target + 1] = pixels[target + 2] = input[source];
      pixels[target + 3] = 255;
    }
  } else {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  _nativeImageCanvasCache.set(asset, canvas);
  return canvas;
}

function drawNativePdfImageIntoRegion(ctx, imageObj, region, scaleRatio = 1) {
  const data = imageObj?.data || {};
  const asset = data._nativeAsset;
  const source = nativePdfImageSource(asset);
  const paintBox = data._nativePaintBox || imageObj;
  if (!source || !data._nativeAxisAligned || data._mergedFragments > 1 ||
      !paintBox || paintBox.width <= 0 || paintBox.height <= 0) return false;
  const dx = (paintBox.x - region.x) * scaleRatio;
  const dy = (paintBox.y - region.y) * scaleRatio;
  const dw = paintBox.width * scaleRatio;
  const dh = paintBox.height * scaleRatio;
  ctx.save();
  ctx.translate(dx + (data._nativeFlipX ? dw : 0), dy + (data._nativeFlipY ? dh : 0));
  ctx.scale(data._nativeFlipX ? -1 : 1, data._nativeFlipY ? -1 : 1);
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, dw, dh);
  ctx.restore();
  return true;
}

function restoreTextAreasFromNativeImages(ctx, region, textObjs = [], imageObjs = [], scaleRatio = 1) {
  if (!ctx?.canvas || !region || !textObjs.length || !imageObjs.length) return 0;
  let restored = 0;
  for (const imageObj of imageObjs) {
    const data = imageObj?.data || {};
    // Native pixels are mapped by the PDF paint transform, which can differ
    // from the normalized/expanded object box used for DOCX placement.
    const imageBox = data._nativePaintBox || data._originalBox || imageObj;
    if (!data._nativeAsset || !data._nativeAxisAligned || data._mergedFragments > 1) continue;
    if (rectIntersectionArea(region, imageBox) <= 0) continue;
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = ctx.canvas.width;
    cleanCanvas.height = ctx.canvas.height;
    const cleanCtx = cleanCanvas.getContext('2d');
    if (!drawNativePdfImageIntoRegion(cleanCtx, imageObj, region, scaleRatio)) {
      cleanCanvas.width = 0;
      cleanCanvas.height = 0;
      continue;
    }
    for (const obj of textObjs) {
      const boxes = obj?.data?._lineBoxes?.length ? obj.data._lineBoxes : [obj?.data?._originalBox || obj];
      for (const box of boxes) {
        if (!box) continue;
        const overlap = {
          x: Math.max(region.x, imageBox.x, Number(box.x ?? obj.x ?? 0)),
          y: Math.max(region.y, imageBox.y, Number(box.y ?? obj.y ?? 0))
        };
        const right = Math.min(
          region.x + region.width,
          imageBox.x + imageBox.width,
          Number(box.x ?? obj.x ?? 0) + Number(box.width ?? obj.width ?? 0)
        );
        const bottom = Math.min(
          region.y + region.height,
          imageBox.y + imageBox.height,
          Number(box.y ?? obj.y ?? 0) + Number(box.height ?? obj.height ?? 0)
        );
        if (right <= overlap.x || bottom <= overlap.y) continue;
        const boxHeight = Number(box.height ?? obj.height ?? 0);
        const boxWidth = Number(box.width ?? obj.width ?? 0);
        const pad = Math.max(2, Math.min(18, Math.max(boxHeight * 0.68, boxWidth * 0.035)));
        const x = Math.max(region.x, imageBox.x, overlap.x - pad);
        const y = Math.max(region.y, imageBox.y, overlap.y - pad);
        const x2 = Math.min(region.x + region.width, imageBox.x + imageBox.width, right + pad);
        const y2 = Math.min(region.y + region.height, imageBox.y + imageBox.height, bottom + pad);
        const sx = Math.max(0, Math.floor((x - region.x) * scaleRatio));
        const sy = Math.max(0, Math.floor((y - region.y) * scaleRatio));
        const sw = Math.min(ctx.canvas.width - sx, Math.ceil((x2 - x) * scaleRatio));
        const sh = Math.min(ctx.canvas.height - sy, Math.ceil((y2 - y) * scaleRatio));
        if (sw <= 0 || sh <= 0) continue;
        const nativePatch = cleanCtx.getImageData(sx, sy, sw, sh);
        const sampleStep = Math.max(4, Math.floor((sw * sh) / 600));
        let sampled = 0, nativeBlack = 0, nativeTransparent = 0;
        for (let pixel = 0; pixel < nativePatch.data.length; pixel += 4 * sampleStep) {
          const nr = nativePatch.data[pixel], ng = nativePatch.data[pixel + 1], nb = nativePatch.data[pixel + 2];
          if (nativePatch.data[pixel + 3] < 20) nativeTransparent++;
          if (nr + ng + nb < 42) nativeBlack++;
          sampled++;
        }
        // PDF image masks are occasionally exposed as an opaque black margin
        // by page.objs even though the composed page correctly treats them as
        // transparent. Never paste that placeholder over the rendered crop.
        const invalidMaskMargin = sampled &&
          (nativeBlack / sampled > 0.7 || nativeTransparent / sampled > 0.7);
        if (invalidMaskMargin) continue;
        // Copy pixels including alpha without affecting the rest of the crop.
        ctx.putImageData(nativePatch, sx, sy);
        restored++;
      }
    }
    cleanCanvas.width = 0;
    cleanCanvas.height = 0;
  }
  return restored;
}

function canvasRegionHasRenderedTextDelta(fullCanvas, graphicsCanvas, box, scaleRatio = 1) {
  if (!fullCanvas?.width || !graphicsCanvas?.width || !box) return false;
  const left = Math.max(0, Math.floor(Number(box.x || 0) * scaleRatio));
  const top = Math.max(0, Math.floor(Number(box.y || 0) * scaleRatio));
  const right = Math.min(fullCanvas.width, graphicsCanvas.width,
    Math.ceil((Number(box.x || 0) + Math.max(1, Number(box.width || 1))) * scaleRatio));
  const bottom = Math.min(fullCanvas.height, graphicsCanvas.height,
    Math.ceil((Number(box.y || 0) + Math.max(1, Number(box.height || 1))) * scaleRatio));
  const width = right - left, height = bottom - top;
  if (width < 2 || height < 2) return false;
  const full = fullCanvas.getContext('2d', { willReadFrequently: true }).getImageData(left, top, width, height).data;
  const graphics = graphicsCanvas.getContext('2d', { willReadFrequently: true }).getImageData(left, top, width, height).data;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 2200)));
  let sampled = 0, changed = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4;
      sampled++;
      const delta = Math.abs(full[index] - graphics[index]) +
        Math.abs(full[index + 1] - graphics[index + 1]) +
        Math.abs(full[index + 2] - graphics[index + 2]);
      if (delta >= 42) changed++;
    }
  }
  return changed >= Math.max(4, Math.ceil(sampled * 0.006));
}

function textStillPaintedInGraphicsRender(textObjs, fullCanvas, graphicsCanvas, scaleRatio = 1) {
  if (!Array.isArray(textObjs) || !fullCanvas?.width || !graphicsCanvas?.width) return textObjs || [];
  return textObjs.flatMap(obj => {
    const data = obj?.data || {};
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length
      ? data._lineBoxes
      : [data._originalBox || obj];
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const keepIndexes = boxes.map((box, index) => ({ box, index }))
      // A delta means PDF.js removed the text operator successfully. Only
      // outline glyphs that remain identical in both renders need inpainting.
      .filter(({ box }) => !canvasRegionHasRenderedTextDelta(fullCanvas, graphicsCanvas, box, scaleRatio));
    if (!keepIndexes.length) return [];
    if (keepIndexes.length === boxes.length) return [obj];
    return [{
      ...obj,
      data: {
        ...data,
        lines: keepIndexes.map(({ index }) => lines[index] || []),
        _lineBoxes: keepIndexes.map(({ box }) => box),
        _lineAligns: Array.isArray(data._lineAligns)
          ? keepIndexes.map(({ index }) => data._lineAligns[index])
          : data._lineAligns
      }
    }];
  });
}

function isLowInformationImageCrop(canvas, box) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || !box) return false;
  const sx = Math.max(0, Math.floor(box.x || 0));
  const sy = Math.max(0, Math.floor(box.y || 0));
  const sw = Math.min(canvas.width - sx, Math.ceil(box.width || 0));
  const sh = Math.min(canvas.height - sy, Math.ceil(box.height || 0));
  if (sw <= 0 || sh <= 0) return true;

  const sampleW = Math.max(1, Math.min(96, sw));
  const sampleH = Math.max(1, Math.min(96, sh));
  const stepX = Math.max(1, sw / sampleW);
  const stepY = Math.max(1, sh / sampleH);
  let count = 0, nonWhite = 0, dark = 0, colored = 0;
  for (let yy = 0; yy < sampleH; yy++) {
    for (let xx = 0; xx < sampleW; xx++) {
      const px = Math.min(canvas.width - 1, sx + Math.floor(xx * stepX));
      const py = Math.min(canvas.height - 1, sy + Math.floor(yy * stepY));
      const index = (py * snapshot.width + px) * 4;
      const data = snapshot.data;
      if (data[index + 3] < 32) continue;
      count++;
      const r = data[index], g = data[index + 1], b = data[index + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      const isWhite = r > 244 && g > 244 && b > 244;
      if (!isWhite) nonWhite++;
      if (lum < 185) dark++;
      if (max - min > 36 && lum < 245) colored++;
    }
  }
  if (!count) return true;
  const nonWhiteRatio = nonWhite / count;
  const darkRatio = dark / count;
  const coloredRatio = colored / count;
  const thin = sw < 12 || sh < 12;
  const mostlyBlackOnWhite = darkRatio > nonWhiteRatio * 0.68 && coloredRatio < 0.01;
  const largeSparseArtwork = sw * sh > 12000 && (coloredRatio > 0.002 || darkRatio > 0.008);

  if (nonWhiteRatio < 0.012) return true;
  if (largeSparseArtwork) return false;
  if (thin && nonWhiteRatio < 0.18 && coloredRatio < 0.002) return true;
  if (sw > 80 && sh > 24 && nonWhiteRatio < 0.052 && mostlyBlackOnWhite) return true;
  return false;
}

function expandPhotographicImageBox(canvas, box, textObjs = []) {
  if (!canvas?.width || !canvas?.height || !box) return box;
  const original = {
    x: Number(box.x || 0),
    y: Number(box.y || 0),
    width: Number(box.width || 0),
    height: Number(box.height || 0)
  };
  const textured = region => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const width = Math.min(canvas.width - x, Math.max(1, Math.ceil(region.width)));
    const height = Math.min(canvas.height - y, Math.max(1, Math.ceil(region.height)));
    if (width * height < 240) return false;
    const pixels = ctx.getImageData(x, y, width, height).data;
    const sampleX = Math.max(1, Math.floor(width / 34));
    const sampleY = Math.max(1, Math.floor(height / 34));
    const buckets = new Set();
    let samples = 0, midtone = 0, colored = 0;
    for (let py = 0; py < height; py += sampleY) for (let px = 0; px < width; px += sampleX) {
      const i = (py * width + px) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const lum = (r + g + b) / 3;
      samples++;
      if (lum > 20 && lum < 240) midtone++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colored++;
      buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
    return samples > 0 && buckets.size >= 22 && midtone / samples >= 0.24 && (colored / samples >= 0.035 || buckets.size >= 42);
  };
  const texturedContinuation = region => {
    if (textured(region)) return true;
    const horizontal = region.width >= region.height;
    const slices = 5;
    let texturedSlices = 0;
    for (let index = 0; index < slices; index++) {
      const slice = horizontal
        ? {
            x: region.x + region.width * index / slices,
            y: region.y,
            width: region.width / slices,
            height: region.height
          }
        : {
            x: region.x,
            y: region.y + region.height * index / slices,
            width: region.width,
            height: region.height / slices
          };
      if (textured(slice)) texturedSlices++;
    }
    return texturedSlices >= 2;
  };
  if (original.width >= 20 && original.height >= 20 && original.width * original.height >= 7200 && textured(original)) {
    let grown = { ...original };
    const step = 8;
    const limits = {
      left: Math.max(0, original.x - canvas.width * 0.32),
      top: Math.max(0, original.y - canvas.height * 0.32),
      right: Math.min(canvas.width, original.x + original.width + canvas.width * 0.32),
      bottom: Math.min(canvas.height, original.y + original.height + canvas.height * 0.32)
    };
    for (let pass = 0; pass < 80; pass++) {
      let changed = false;
      const left = Math.max(limits.left, grown.x - step);
      if (left < grown.x && texturedContinuation({ x: left, y: grown.y, width: grown.x - left, height: grown.height })) {
        grown.width += grown.x - left; grown.x = left; changed = true;
      }
      const right = Math.min(limits.right, grown.x + grown.width + step);
      if (right > grown.x + grown.width && texturedContinuation({ x: grown.x + grown.width, y: grown.y, width: right - grown.x - grown.width, height: grown.height })) {
        grown.width = right - grown.x; changed = true;
      }
      const top = Math.max(limits.top, grown.y - step);
      if (top < grown.y && texturedContinuation({ x: grown.x, y: top, width: grown.width, height: grown.y - top })) {
        grown.height += grown.y - top; grown.y = top; changed = true;
      }
      const bottom = Math.min(limits.bottom, grown.y + grown.height + step);
      if (bottom > grown.y + grown.height && texturedContinuation({ x: grown.x, y: grown.y + grown.height, width: grown.width, height: bottom - grown.y - grown.height })) {
        grown.height = bottom - grown.y; changed = true;
      }
      if (!changed) break;
    }
    if (grown.width * grown.height >= original.width * original.height * 1.18) {
      return { ...box, ...padRegionToCanvas(grown, canvas, 2) };
    }
  }
  if (original.width < 120 || original.height < canvas.height * 0.55 || !canvasRegionLooksPhotographic(canvas, original)) return box;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const sampleVertical = y => {
    const values = [];
    for (let index = 1; index <= 9; index++) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(original.x + original.width * index / 10)));
      const pixel = ctx.getImageData(x, Math.max(0, Math.min(canvas.height - 1, Math.round(y))), 1, 1).data;
      values.push([pixel[0], pixel[1], pixel[2]]);
    }
    return values.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))[Math.floor(values.length / 2)];
  };
  const distance = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const topReference = sampleVertical(original.y + 2);
  const maxExpand = Math.min(140, Math.round(original.height * 0.16));
  let expandedTop = original.y;
  let misses = 0;
  for (let y = Math.floor(original.y) - 1; y >= Math.max(0, original.y - maxExpand); y--) {
    if (distance(sampleVertical(y), topReference) <= 54) {
      expandedTop = y;
      misses = 0;
    } else if (++misses > 3) break;
  }
  const blockingBottom = (textObjs || []).flatMap(textObjectVisualBoxes).reduce((bottom, textBox) => {
    const textRight = Number(textBox.x || 0) + Number(textBox.width || 0);
    const imageRight = original.x + original.width;
    const overlapX = Math.max(0, Math.min(textRight, imageRight) - Math.max(Number(textBox.x || 0), original.x));
    const textBottom = Number(textBox.y || 0) + Number(textBox.height || 0);
    const horizontallyRelevant = overlapX >= Math.min(Number(textBox.width || 0), original.width) * 0.25;
    const directlyAbove = textBottom <= original.y + 3 && textBottom >= original.y - maxExpand - 4;
    return horizontallyRelevant && directlyAbove ? Math.max(bottom, textBottom + 2) : bottom;
  }, 0);
  if (blockingBottom > 0) expandedTop = Math.max(expandedTop, blockingBottom);
  if (original.y - expandedTop < 4) return box;
  return {
    ...box,
    x: original.x,
    y: expandedTop,
    width: original.width,
    height: original.y + original.height - expandedTop
  };
}

function mergeFragmentedImageObjects(imageObjs, canvas) {
  if (!Array.isArray(imageObjs) || imageObjs.length < 2 || !canvas?.width || !canvas?.height) return imageObjs || [];
  const pending = imageObjs.map(image => ({ image, box: { ...(image?.data?._originalBox || image) } }))
    .filter(item => Number(item.box.width) > 0 && Number(item.box.height) > 0);
  const merged = [];
  const maxHorizontalGap = Math.max(8, Math.min(30, canvas.width * 0.018));
  const maxVerticalGap = Math.max(8, Math.min(30, canvas.height * 0.018));
  const axisOverlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  while (pending.length) {
    const members = [pending.shift()];
    let bounds = { ...members[0].box };
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index--) {
        const candidate = pending[index];
        const horizontalGap = Math.max(0, Math.max(bounds.x, candidate.box.x) - Math.min(bounds.x + bounds.width, candidate.box.x + candidate.box.width));
        const verticalGap = Math.max(0, Math.max(bounds.y, candidate.box.y) - Math.min(bounds.y + bounds.height, candidate.box.y + candidate.box.height));
        const overlapX = axisOverlap(bounds.x, bounds.x + bounds.width, candidate.box.x, candidate.box.x + candidate.box.width);
        const overlapY = axisOverlap(bounds.y, bounds.y + bounds.height, candidate.box.y, candidate.box.y + candidate.box.height);
        const joinsHorizontally = horizontalGap <= maxHorizontalGap && overlapY >= Math.min(bounds.height, candidate.box.height) * 0.67;
        const joinsVertically = verticalGap <= maxVerticalGap && overlapX >= Math.min(bounds.width, candidate.box.width) * 0.67;
        const overlaps = rectIntersectionArea(bounds, candidate.box) >= Math.min(bounds.width * bounds.height, candidate.box.width * candidate.box.height) * 0.02;
        if (!joinsHorizontally && !joinsVertically && !overlaps) continue;
        const union = unionRects([bounds, candidate.box]);
        // Transparent decorative layers and logos often overlap a photograph
        // by a few pixels. Treating that overlap as tiled-photo fragmentation
        // creates one giant crop whose text erasure damages the real photo.
        // Genuine photographic tiles remain mergeable because each member and
        // their union all contain photographic detail.
        if (overlaps) {
          const membersArePhotographic = canvasRegionLooksPhotographic(canvas, bounds) &&
            canvasRegionLooksPhotographic(canvas, candidate.box) &&
            canvasRegionLooksPhotographic(canvas, union);
          if (!membersArePhotographic) continue;
        } else if (!canvasRegionLooksPhotographic(canvas, union)) {
          continue;
        }
        members.push(candidate);
        bounds = union;
        pending.splice(index, 1);
        changed = true;
      }
    }
    if (members.length === 1) {
      merged.push(members[0].image);
      continue;
    }
    const padded = padRegionToCanvas(bounds, canvas, 2);
    const base = members[0].image;
    merged.push({
      ...base,
      x: padded.x,
      y: padded.y,
      width: padded.width,
      height: padded.height,
      data: { ...(base?.data || {}), _originalBox: padded, _mergedFragments: members.length }
    });
  }
  return merged;
}

function groupLinePositions(values, tolerance = 2) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const groups = [];
  for (const value of sorted) {
    const last = groups[groups.length - 1];
    if (last && value - last.values[last.values.length - 1] <= tolerance) {
      last.values.push(value);
    } else {
      groups.push({ values: [value] });
    }
  }
  return groups.map(group => Math.round(group.values.reduce((sum, v) => sum + v, 0) / group.values.length));
}

function detectGridTable(canvas) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || canvas.width < 120 || canvas.height < 120) return null;
  const { width, height } = canvas;
  const data = canvasPixelSnapshot(canvas)?.data;
  if (!data) return null;
  const darkAt = (x, y, threshold = 150) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 80) return false;
    return (data[i] + data[i + 1] + data[i + 2]) / 3 < threshold;
  };

  const horizontalSegments = [];
  for (let y = 0; y < height; y++) {
    let bestStart = -1, bestEnd = -1, bestLen = 0;
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      if (darkAt(x, y, 242)) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        const len = x - runStart;
        if (len > bestLen) {
          bestStart = runStart;
          bestEnd = x - 1;
          bestLen = len;
        }
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      const len = width - runStart;
      if (len > bestLen) {
        bestStart = runStart;
        bestEnd = width - 1;
        bestLen = len;
      }
    }
    if (bestLen > Math.max(80, width * 0.12)) {
      horizontalSegments.push({ y, x0: bestStart, x1: bestEnd, len: bestLen });
    }
  }

  const segmentRows = [];
  for (const segment of horizontalSegments) {
    const last = segmentRows[segmentRows.length - 1];
    if (last && segment.y - last[last.length - 1].y <= 3) {
      last.push(segment);
    } else {
      segmentRows.push([segment]);
    }
  }

  const solidHorizontalBands = [];
  const lineSegments = segmentRows.flatMap(row => {
    const best = row.reduce((a, b) => a.len >= b.len ? a : b);
    const firstY = row[0].y;
    const lastY = row[row.length - 1].y;
    // A filled table-header cell appears as one dark horizontal segment on
    // every scanline. Collapsing that thick band to its midpoint discards both
    // row edges, merges the header with the first data row, and leaves a blank
    // strip above the rebuilt table. Retain the two physical band edges.
    if (lastY - firstY >= 8) {
      const sampleXs = [0.08, 0.18, 0.29, 0.4, 0.5, 0.61, 0.72, 0.83, 0.92]
        .map(ratio => Math.max(0, Math.min(width - 1, Math.round(best.x0 + best.len * ratio))));
      const sampleYs = [0.12, 0.28, 0.5, 0.72, 0.88]
        .map(ratio => Math.max(firstY + 1, Math.min(lastY - 1, Math.round(firstY + (lastY - firstY) * ratio))));
      const samples = sampleYs.flatMap(y => sampleXs.map(x => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      }));
      const channelMedian = channel => {
        const values = samples.map(rgb => rgb[channel]).sort((a, b) => a - b);
        return values.length ? values[Math.floor(values.length / 2)] : 255;
      };
      const fill = [channelMedian(0), channelMedian(1), channelMedian(2)]
        .map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
      solidHorizontalBands.push({ top: firstY, bottom: lastY, fill });
      return [
        { y: firstY, x0: best.x0, x1: best.x1, len: best.len },
        { y: lastY, x0: best.x0, x1: best.x1, len: best.len }
      ];
    }
    return [{
      y: Math.round(row.reduce((sum, segment) => sum + segment.y, 0) / row.length),
      x0: best.x0,
      x1: best.x1,
      len: best.len
    }];
  });

  const clusters = [];
  for (const segment of lineSegments) {
    let bestCluster = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const left = Math.max(segment.x0, cluster.x0);
      const right = Math.min(segment.x1, cluster.x1);
      const overlap = Math.max(0, right - left);
      const score = overlap / Math.max(1, Math.min(segment.len, cluster.len));
      if (score > bestScore) {
        bestCluster = cluster;
        bestScore = score;
      }
    }
    if (bestCluster && bestScore > 0.82) {
      bestCluster.items.push(segment);
      bestCluster.x0 = Math.round(bestCluster.items.reduce((sum, item) => sum + item.x0, 0) / bestCluster.items.length);
      bestCluster.x1 = Math.round(bestCluster.items.reduce((sum, item) => sum + item.x1, 0) / bestCluster.items.length);
      bestCluster.len = Math.round(bestCluster.items.reduce((sum, item) => sum + item.len, 0) / bestCluster.items.length);
    } else {
      clusters.push({ x0: segment.x0, x1: segment.x1, len: segment.len, items: [segment] });
    }
  }

  const tableCluster = clusters
    .filter(cluster => cluster.items.length >= 3)
    .sort((a, b) => (b.items.length * b.len) - (a.items.length * a.len))[0];
  if (!tableCluster) return null;

  const hLines = tableCluster.items.map(item => item.y).sort((a, b) => a - b);
  if (hLines.length < 3) return null;
  const bandTop = hLines[0];
  const bandBottom = hLines[hLines.length - 1];
  const bandHeight = Math.max(1, bandBottom - bandTop);
  // Internal rules stop at merged cells, so their horizontal extents can be
  // shorter than the table's true outer rules. Use the union of the clustered
  // rules for the scan bounds; averaging their starts/ends shifts the inferred
  // table inward and leaves an apparent empty edge column in Word.
  const tableLeft = Math.min(...tableCluster.items.map(item => item.x0));
  const tableRight = Math.max(...tableCluster.items.map(item => item.x1));

  const vertical = [];
  const scanLeft = Math.max(0, tableLeft - 4);
  const scanRight = Math.min(width - 1, tableRight + 4);
  for (let x = scanLeft; x <= scanRight; x++) {
    let dark = 0;
    let run = 0;
    let longestRun = 0;
    let gap = 0;
    for (let y = bandTop; y <= bandBottom; y++) {
      if (darkAt(x, y, 242)) {
        dark++;
        run += gap + 1;
        gap = 0;
        longestRun = Math.max(longestRun, run);
      } else if (run && gap < 2) {
        gap++;
      } else {
        run = 0;
        gap = 0;
      }
    }
    if (dark > bandHeight * 0.45 && longestRun > Math.max(14, bandHeight * 0.28)) vertical.push(x);
  }

  let vLines = groupLinePositions(vertical, 3);
  if (!vLines.length || Math.abs(vLines[0] - tableLeft) > 6) vLines.unshift(tableLeft);
  if (Math.abs(vLines[vLines.length - 1] - tableRight) > 6) vLines.push(tableRight);
  vLines = [...new Set(vLines)].sort((a, b) => a - b);
  if (hLines.length < 3 || vLines.length < 2) return null;

  const tableWidth = vLines[vLines.length - 1] - vLines[0];
  const tableHeight = hLines[hLines.length - 1] - hLines[0];
  if (tableWidth < width * 0.12 || tableHeight < height * 0.10) return null;

  // A single-column line cluster that spans most of the page is usually a
  // form, not a spreadsheet-style table. Rebuilding it as one Word table
  // collapses small labels and checkboxes into the wrong cells.
  if (vLines.length === 2 && (hLines.length > 12 || tableHeight > height * 0.45)) return null;

  const columnWidths = [];
  for (let i = 0; i < vLines.length - 1; i++) {
    const w = vLines[i + 1] - vLines[i];
    if (w < 8) return null;
    columnWidths.push(w);
  }

  const rowHeights = [];
  for (let i = 0; i < hLines.length - 1; i++) {
    const h = hLines[i + 1] - hLines[i];
    if (h < 8) return null;
    rowHeights.push(h);
  }

  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const pageSpanning = tableHeight > height * 0.62;
  const rowHeightRatio = Math.max(...rowHeights) / Math.max(1, median(rowHeights));
  const columnWidthRatio = Math.max(...columnWidths) / Math.max(1, Math.min(...columnWidths));
  if (pageSpanning && (rowHeightRatio > 4 || (columnWidths.length <= 4 && columnWidthRatio > 8))) return null;

  return {
    x: vLines[0],
    y: hLines[0],
    width: tableWidth,
    height: tableHeight,
    vLines,
    hLines,
    columnWidths,
    rowHeights,
    rowFills: hLines.slice(0, -1).map((top, index) => {
      const bottom = hLines[index + 1];
      return solidHorizontalBands.find(band => Math.abs(band.top - top) <= 2 && Math.abs(band.bottom - bottom) <= 2)?.fill || 'FFFFFF';
    })
  };
}

function gridRuleCoverage(canvas, x, y0, y1, threshold = 242) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || y1 <= y0) return 0;
  let covered = 0;
  const top = Math.max(0, Math.ceil(y0 + 1));
  const bottom = Math.min(snapshot.height - 1, Math.floor(y1 - 1));
  for (let y = top; y <= bottom; y++) {
    let rowHit = false;
    for (let dx = -2; dx <= 2 && !rowHit; dx++) {
      const px = Math.max(0, Math.min(snapshot.width - 1, Math.round(x + dx)));
      const i = (y * snapshot.width + px) * 4;
      rowHit = snapshot.data[i + 3] >= 80 &&
        (snapshot.data[i] + snapshot.data[i + 1] + snapshot.data[i + 2]) / 3 < threshold;
    }
    if (rowHit) covered++;
  }
  return covered / Math.max(1, bottom - top + 1);
}

function gridRuleLongestCoverage(canvas, x, y0, y1, threshold = 242) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || y1 <= y0) return 0;
  const top = Math.max(0, Math.ceil(y0 + 1));
  const bottom = Math.min(snapshot.height - 1, Math.floor(y1 - 1));
  let run = 0;
  let longest = 0;
  let gap = 0;
  for (let y = top; y <= bottom; y++) {
    let rowHit = false;
    for (let dx = -2; dx <= 2 && !rowHit; dx++) {
      const px = Math.max(0, Math.min(snapshot.width - 1, Math.round(x + dx)));
      const i = (y * snapshot.width + px) * 4;
      rowHit = snapshot.data[i + 3] >= 80 &&
        (snapshot.data[i] + snapshot.data[i + 1] + snapshot.data[i + 2]) / 3 < threshold;
    }
    if (rowHit) {
      run += gap + 1;
      gap = 0;
      longest = Math.max(longest, run);
    } else if (run && gap < 2) {
      gap++;
    } else {
      run = 0;
      gap = 0;
    }
  }
  return longest / Math.max(1, bottom - top + 1);
}

function gridHorizontalRuleCoverage(canvas, y, x0, x1, threshold = 242) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || x1 <= x0) return 0;
  let covered = 0;
  const left = Math.max(0, Math.ceil(x0 + 1));
  const right = Math.min(snapshot.width - 1, Math.floor(x1 - 1));
  for (let x = left; x <= right; x++) {
    let columnHit = false;
    for (let dy = -2; dy <= 2 && !columnHit; dy++) {
      const py = Math.max(0, Math.min(snapshot.height - 1, Math.round(y + dy)));
      const i = (py * snapshot.width + x) * 4;
      columnHit = snapshot.data[i + 3] >= 80 &&
        (snapshot.data[i] + snapshot.data[i + 1] + snapshot.data[i + 2]) / 3 < threshold;
    }
    if (columnHit) covered++;
  }
  return covered / Math.max(1, right - left + 1);
}

function gridHorizontalRuleLongestCoverage(canvas, y, x0, x1, threshold = 242) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot || x1 <= x0) return 0;
  const left = Math.max(0, Math.ceil(x0 + 1));
  const right = Math.min(snapshot.width - 1, Math.floor(x1 - 1));
  let run = 0;
  let longest = 0;
  let gap = 0;
  for (let x = left; x <= right; x++) {
    let columnHit = false;
    for (let dy = -2; dy <= 2 && !columnHit; dy++) {
      const py = Math.max(0, Math.min(snapshot.height - 1, Math.round(y + dy)));
      const i = (py * snapshot.width + x) * 4;
      columnHit = snapshot.data[i + 3] >= 80 &&
        (snapshot.data[i] + snapshot.data[i + 1] + snapshot.data[i + 2]) / 3 < threshold;
    }
    if (columnHit) {
      run += gap + 1;
      gap = 0;
      longest = Math.max(longest, run);
    } else if (run && gap < 2) {
      gap++;
    } else {
      run = 0;
      gap = 0;
    }
  }
  return longest / Math.max(1, right - left + 1);
}

function gridRowSpans(canvas, vLines, hLines) {
  return hLines.slice(0, -1).map((top, rowIndex) => {
    const bottom = hLines[rowIndex + 1];
    const boundaries = vLines.slice(1, -1).map(x =>
      gridRuleCoverage(canvas, x, top, bottom) >= 0.42 &&
      gridRuleLongestCoverage(canvas, x, top, bottom) >= 0.55
    );
    const spans = [];
    let start = 0;
    for (let boundary = 0; boundary < boundaries.length; boundary++) {
      if (!boundaries[boundary]) continue;
      spans.push({ start, span: boundary + 1 - start });
      start = boundary + 1;
    }
    spans.push({ start, span: vLines.length - 1 - start });
    return spans;
  });
}

function gridCellTopology(canvas, vLines, hLines) {
  const rowSpans = gridRowSpans(canvas, vLines, hLines);
  const rowCount = Math.max(0, hLines.length - 1);
  const columnCount = Math.max(0, vLines.length - 1);
  const cellOwners = Array.from({ length: rowCount }, () => Array(columnCount).fill(null));
  const topology = Array.from({ length: rowCount }, () => []);

  for (let row = 0; row < rowCount; row++) {
    for (const sourceSpan of rowSpans[row]) {
      const start = sourceSpan.start;
      const span = Math.max(1, sourceSpan.span || 1);
      if (cellOwners[row][start]) continue;
      let rowSpan = 1;
      while (row + rowSpan < rowCount) {
        const nextSpan = rowSpans[row + rowSpan].find(item => item.start === start && item.span === span);
        if (!nextSpan || cellOwners[row + rowSpan].slice(start, start + span).some(Boolean)) break;
        const boundaryY = hLines[row + rowSpan];
        const x0 = vLines[start];
        const x1 = vLines[start + span];
        const dividerPresent = gridHorizontalRuleCoverage(canvas, boundaryY, x0, x1) >= 0.42 &&
          gridHorizontalRuleLongestCoverage(canvas, boundaryY, x0, x1) >= 0.55;
        if (dividerPresent) break;
        rowSpan++;
      }

      const cell = { start, span, rowSpan, ownerRow: row, ownerStart: start };
      topology[row].push(cell);
      for (let coveredRow = row; coveredRow < row + rowSpan; coveredRow++) {
        for (let col = start; col < start + span; col++) cellOwners[coveredRow][col] = cell;
      }
    }
  }

  return { rowSpans: topology, cellOwners };
}

function splitGridTableRows(canvas, grid) {
  if (!grid?.hLines?.length || grid.hLines.length < 3) return [];
  const groups = [];
  let start = 0;
  let sawDisconnectedGap = false;
  for (let row = 0; row < grid.hLines.length - 1; row++) {
    const y0 = grid.hLines[row];
    const y1 = grid.hLines[row + 1];
    const left = gridRuleCoverage(canvas, grid.vLines[0], y0, y1);
    const right = gridRuleCoverage(canvas, grid.vLines[grid.vLines.length - 1], y0, y1);
    const leftRun = gridRuleLongestCoverage(canvas, grid.vLines[0], y0, y1);
    const rightRun = gridRuleLongestCoverage(canvas, grid.vLines[grid.vLines.length - 1], y0, y1);
    // A page header/footer rule can share the table's horizontal span and be
    // clustered as an extra row. Real table rows keep continuous outer
    // borders; prose and headings between an unrelated rule and the grid do
    // not. Longest-run coverage avoids counting nearby glyph strokes as a
    // table edge.
    const disconnectedGap = (left < 0.28 && right < 0.28) ||
      (leftRun < 0.55 && rightRun < 0.55);
    if (disconnectedGap) {
      sawDisconnectedGap = true;
      if (row - start + 1 >= 3) groups.push(grid.hLines.slice(start, row + 1));
      start = row + 1;
    }
  }
  if (grid.hLines.length - start >= 3) groups.push(grid.hLines.slice(start));
  if (!groups.length && !sawDisconnectedGap) groups.push(grid.hLines.slice());

  return groups.map(hLines => {
    const top = hLines[0];
    const bottom = hLines[hLines.length - 1];
    const vertical = [];
    for (let x = grid.x - 3; x <= grid.x + grid.width + 3; x++) {
      if (gridRuleCoverage(canvas, x, top, bottom) >= 0.42 &&
          gridRuleLongestCoverage(canvas, x, top, bottom) >= 0.28) vertical.push(x);
    }
    let vLines = groupLinePositions(vertical, 3);
    if (!vLines.length || Math.abs(vLines[0] - grid.x) > 6) vLines.unshift(grid.x);
    const right = grid.x + grid.width;
    if (Math.abs(vLines[vLines.length - 1] - right) > 6) vLines.push(right);
    vLines = [...new Set(vLines)].sort((a, b) => a - b);
    if (vLines.length < 3) return null;
    const columnWidths = vLines.slice(0, -1).map((line, index) => vLines[index + 1] - line);
    const rowHeights = hLines.slice(0, -1).map((line, index) => hLines[index + 1] - line);
    const topology = gridCellTopology(canvas, vLines, hLines);
    return {
      x: vLines[0],
      y: top,
      width: vLines[vLines.length - 1] - vLines[0],
      height: bottom - top,
      vLines,
      hLines,
      columnWidths,
      rowHeights,
      rowFills: hLines.slice(0, -1).map((top, index) => {
        const sourceRow = grid.hLines.findIndex((line, sourceIndex) =>
          Math.abs(line - top) <= 2 && Math.abs((grid.hLines[sourceIndex + 1] ?? line) - hLines[index + 1]) <= 2);
        return sourceRow >= 0 ? (grid.rowFills?.[sourceRow] || 'FFFFFF') : 'FFFFFF';
      }),
      rowSpans: topology.rowSpans,
      cellOwners: topology.cellOwners
    };
  }).filter(Boolean);
}

function detectGridTables(canvas) {
  if (!canvas?.width || !canvas?.height) return [];
  const working = document.createElement('canvas');
  working.width = canvas.width;
  working.height = canvas.height;
  const ctx = working.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const grids = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const grid = detectGridTable(working);
    if (!grid) break;
    grids.push(...splitGridTableRows(working, grid));
    // Remove only the accepted table before looking for another independent
    // ruled grid on the same PDF page (common in embedded assurance reports).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      Math.max(0, grid.x - 6),
      Math.max(0, grid.y - 6),
      Math.min(working.width, grid.width + 12),
      Math.min(working.height, grid.height + 12)
    );
    _canvasPixelCache.delete(working);
  }
  _canvasPixelCache.delete(working);
  working.width = 0;
  working.height = 0;
  return grids.sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function normalizeEmptyNarrowGridEdgeColumns(grid, textObjs = [], canvas = null) {
  if (!grid?.vLines?.length || grid.vLines.length < 4) return grid;
  const boxes = (textObjs || []).flatMap(textObjectVisualBoxes).filter(box => {
    const cy = Number(box.y || 0) + Number(box.height || 0) / 2;
    return cy >= grid.y && cy <= grid.y + grid.height;
  });
  const vLines = grid.vLines.slice();
  const originalWidth = Math.max(1, grid.width || (vLines[vLines.length - 1] - vLines[0]));
  const narrowLimit = Math.max(6, Math.min(12, originalWidth * 0.025));
  const columnHasText = (left, right) => boxes.some(box => {
    const cx = Number(box.x || 0) + Number(box.width || 0) / 2;
    return cx > left && cx < right;
  });
  const edgeColumnIsFullHeightMerge = edgeIndex => {
    if (!canvas) return false;
    const topology = gridCellTopology(canvas, vLines, grid.hLines);
    const owner = topology.cellOwners?.[0]?.[edgeIndex];
    return owner?.ownerRow === 0 && owner?.ownerStart === edgeIndex &&
      Math.max(1, owner.span || 1) === 1 &&
      Math.max(1, owner.rowSpan || 1) >= grid.hLines.length - 1;
  };

  while (vLines.length >= 4) {
    const width = vLines[1] - vLines[0];
    if (columnHasText(vLines[0], vLines[1]) ||
        (width > narrowLimit && !edgeColumnIsFullHeightMerge(0))) break;
    // A page/frame stroke can form an empty edge column of any width when its
    // horizontal rules overlap the real table. A true table edge column is
    // divided by row rules; the artifact is empty and merged for the full grid.
    vLines.shift();
  }
  while (vLines.length >= 4) {
    const last = vLines.length - 1;
    const width = vLines[last] - vLines[last - 1];
    if (columnHasText(vLines[last - 1], vLines[last]) ||
        (width > narrowLimit && !edgeColumnIsFullHeightMerge(last - 1))) break;
    vLines.pop();
  }
  if (vLines.length === grid.vLines.length) return grid;
  const topology = canvas ? gridCellTopology(canvas, vLines, grid.hLines) : null;
  return {
    ...grid,
    x: vLines[0],
    width: vLines[vLines.length - 1] - vLines[0],
    vLines,
    columnWidths: vLines.slice(0, -1).map((line, index) => vLines[index + 1] - line),
    rowSpans: topology?.rowSpans || grid.rowSpans,
    cellOwners: topology?.cellOwners || grid.cellOwners
  };
}

function findCanvasTableRuleBackdropRegions(canvas, textObjs = []) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || canvas.width < 160 || canvas.height < 160) return [];
  const { width, height } = canvas;
  const data = canvasPixelSnapshot(canvas)?.data;
  if (!data) return [];
  const darkAt = (x, y) => {
    const index = (y * width + x) * 4;
    return data[index + 3] >= 80 && (data[index] + data[index + 1] + data[index + 2]) / 3 < 226;
  };
  let verticalDarkPrefix = null;
  const darkCountInColumn = (x, y0, y1) => {
    if (!verticalDarkPrefix) {
      const PrefixArray = height < 65535 ? Uint16Array : Uint32Array;
      verticalDarkPrefix = new PrefixArray(width * (height + 1));
      for (let y = 0; y < height; y++) {
        const previousRow = y * width;
        const nextRow = (y + 1) * width;
        for (let px = 0; px < width; px++) {
          verticalDarkPrefix[nextRow + px] = verticalDarkPrefix[previousRow + px] + (darkAt(px, y) ? 1 : 0);
        }
      }
    }
    const top = Math.max(0, Math.min(height, y0));
    const bottom = Math.max(top, Math.min(height - 1, y1));
    return verticalDarkPrefix[(bottom + 1) * width + x] - verticalDarkPrefix[top * width + x];
  };
  const minRuleWidth = Math.max(100, width * 0.12);
  const rowSegments = [];

  for (let y = 0; y < height; y++) {
    let start = -1;
    let lastDark = -1;
    for (let x = 0; x < width; x++) {
      if (darkAt(x, y)) {
        if (start < 0) start = x;
        lastDark = x;
      } else if (start >= 0 && x - lastDark > 4) {
        if (lastDark - start + 1 >= minRuleWidth) rowSegments.push({ x0: start, x1: lastDark, y });
        start = -1;
        lastDark = -1;
      }
    }
    if (start >= 0 && lastDark - start + 1 >= minRuleWidth) rowSegments.push({ x0: start, x1: lastDark, y });
  }

  const lineRows = [];
  for (const segment of rowSegments) {
    const existing = lineRows.find(row =>
      Math.abs(row.y - segment.y) <= 3 &&
      Math.abs(row.x0 - segment.x0) <= 10 &&
      Math.abs(row.x1 - segment.x1) <= 10
    );
    if (existing) {
      existing.samples++;
      existing.x0 = (existing.x0 * (existing.samples - 1) + segment.x0) / existing.samples;
      existing.x1 = (existing.x1 * (existing.samples - 1) + segment.x1) / existing.samples;
      existing.y = (existing.y * (existing.samples - 1) + segment.y) / existing.samples;
    } else {
      lineRows.push({ ...segment, samples: 1 });
    }
  }

  const clusters = [];
  for (const row of lineRows) {
    let cluster = clusters.find(candidate =>
      Math.abs(candidate.x0 - row.x0) <= 14 && Math.abs(candidate.x1 - row.x1) <= 14
    );
    if (!cluster) {
      cluster = { x0: row.x0, x1: row.x1, rows: [] };
      clusters.push(cluster);
    }
    cluster.rows.push(row);
    cluster.x0 = cluster.rows.reduce((sum, item) => sum + item.x0, 0) / cluster.rows.length;
    cluster.x1 = cluster.rows.reduce((sum, item) => sum + item.x1, 0) / cluster.rows.length;
  }

  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  const regionHasChromaticTableBand = region => {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(width, Math.ceil(region.x + region.width));
    const y1 = Math.min(height, Math.ceil(region.y + region.height));
    const stride = Math.max(1, Math.floor(Math.sqrt(Math.max(1, (x1 - x0) * (y1 - y0)) / 2400)));
    let samples = 0;
    let chromatic = 0;
    let continuousBandRows = 0;
    for (let y = y0; y < y1; y += stride) {
      let rowChromatic = 0;
      let run = 0;
      let longestRun = 0;
      for (let x = x0; x < x1; x += stride) {
        const index = (y * width + x) * 4;
        if (data[index + 3] < 80) continue;
        const r = data[index], g = data[index + 1], b = data[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        samples++;
        if (max - min > 42 && g > r * 1.12 && g > b * 1.04 && (r + g + b) / 3 < 225) {
          chromatic++;
          rowChromatic++;
          run++;
          longestRun = Math.max(longestRun, run);
        } else {
          run = 0;
        }
      }
      const rowSamples = Math.max(1, Math.ceil((x1 - x0) / stride));
      if (rowChromatic / rowSamples >= 0.55 || longestRun / rowSamples >= 0.42) continuousBandRows++;
    }
    return samples > 0 && chromatic / samples >= 0.055 && continuousBandRows >= 2;
  };
  const regions = [];
  for (const cluster of clusters) {
    const rows = cluster.rows.slice().sort((a, b) => a.y - b.y);
    if (rows.length < 2) continue;
    const x0 = Math.round(cluster.x0);
    const x1 = Math.round(cluster.x1);
    const y0 = Math.round(rows[0].y);
    const y1 = Math.round(rows[rows.length - 1].y);
    const tableWidth = x1 - x0;
    const tableHeight = y1 - y0;
    if (tableWidth < minRuleWidth || tableHeight < height * 0.025 || tableHeight > height * 0.76) continue;

    const verticalPositions = [];
    for (let x = Math.max(0, x0 - 3); x <= Math.min(width - 1, x1 + 3); x++) {
      const dark = darkCountInColumn(x, y0, y1);
      if (dark >= tableHeight * 0.62) verticalPositions.push(x);
    }
    let vLines = groupLinePositions(verticalPositions, 3);
    let ruledGrid = vLines.length >= 3 && vLines.length <= 12 && Math.abs(vLines[0] - x0) <= 9 && Math.abs(vLines[vLines.length - 1] - x1) <= 9;
    let regionY0 = y0;
    let regionY1 = y1;
    if (!ruledGrid && rows.length >= 3) {
      let best = null;
      for (let start = 0; start < rows.length - 1; start++) {
        for (let end = start + 1; end < rows.length; end++) {
          const subY0 = Math.round(rows[start].y);
          const subY1 = Math.round(rows[end].y);
          const span = subY1 - subY0;
          if (span < 14 || span > height * 0.42) continue;
          const positions = [];
          for (let x = Math.max(0, x0 - 3); x <= Math.min(width - 1, x1 + 3); x++) {
            const dark = darkCountInColumn(x, subY0, subY1);
            if (dark >= span * 0.42) positions.push(x);
          }
          const lines = groupLinePositions(positions, 3);
          const grid = lines.length >= 3 && lines.length <= 12 && Math.abs(lines[0] - x0) <= 10 && Math.abs(lines[lines.length - 1] - x1) <= 10;
          if (!grid) continue;
          const score = span * Math.min(lines.length, 10);
          if (!best || score > best.score) best = { y0: subY0, y1: subY1, lines, score };
        }
      }
      if (best) {
        ruledGrid = true;
        vLines = best.lines;
        regionY0 = best.y0;
        regionY1 = best.y1;
      }
    }
    if (ruledGrid) {
      const requiredSupports = Math.max(2, Math.ceil(vLines.length * 0.5));
      const supportsVerticalRules = y => vLines.filter(x =>
        [-1, 0, 1].some(dx => x + dx >= 0 && x + dx < width && darkAt(x + dx, y))
      ).length >= requiredSupports;
      const limit = Math.max(24, Math.min(120, Math.round(height * 0.12)));
      let gaps = 0;
      for (let y = regionY0 - 1; y >= Math.max(0, regionY0 - limit); y--) {
        if (supportsVerticalRules(y)) {
          regionY0 = y;
          gaps = 0;
        } else if (++gaps > 3) break;
      }
      gaps = 0;
      for (let y = regionY1 + 1; y <= Math.min(height - 1, regionY1 + limit); y++) {
        if (supportsVerticalRules(y)) {
          regionY1 = y;
          gaps = 0;
        } else if (++gaps > 3) break;
      }
    }
    const region = padRegionToCanvas({ x: x0, y: regionY0, width: tableWidth, height: regionY1 - regionY0 }, canvas, 3);
    const containedText = textBoxes.filter(box => rectIntersectionArea(region, box) > 0).length;
    if (containedText < (ruledGrid ? 4 : 8)) continue;
    // Decorative timelines and chart callouts can contain several long rules
    // plus colored pills, but they are not tables. Only synthesize a chromatic
    // table backdrop when a real closed row/column grid was also detected.
    const bandedTable = ruledGrid && rows.length >= 3 && regionHasChromaticTableBand(region);
    if (!ruledGrid && !bandedTable) continue;
    regions.push({
      ...region,
      kind: 'structuredBackdrop',
      preserveText: true,
      chromaticTableBackdrop: bandedTable,
      neutralTableBackdrop: ruledGrid && !bandedTable
    });
  }
  return regions;
}

function chromaticPixel(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b) > 28 && (r + g + b) / 3 < 232;
}

function chromaticRowShare(canvas, region, y) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot) return 0;
  const x0 = Math.max(0, Math.floor(region.x));
  const x1 = Math.min(canvas.width, Math.ceil(region.x + region.width));
  const row = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
  const stride = Math.max(1, Math.floor((x1 - x0) / 220));
  let total = 0, chromatic = 0;
  for (let x = x0; x < x1; x += stride) {
    const offset = (row * snapshot.width + x) * 4;
    total++;
    if (chromaticPixel(snapshot.data[offset], snapshot.data[offset + 1], snapshot.data[offset + 2])) chromatic++;
  }
  return chromatic / Math.max(1, total);
}

function boxHasLightNeutralInk(canvas, box) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot) return false;
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(canvas.width - x, Math.max(1, Math.ceil(box.width)));
  const height = Math.min(canvas.height - y, Math.max(1, Math.ceil(box.height)));
  if (width <= 0 || height <= 0) return false;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 700)));
  let light = 0;
  for (let py = 0; py < height; py += stride) {
    for (let px = 0; px < width; px += stride) {
      const i = ((y + py) * snapshot.width + x + px) * 4;
      const r = snapshot.data[i], g = snapshot.data[i + 1], b = snapshot.data[i + 2];
      if (Math.min(r, g, b) >= 185 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) light++;
    }
  }
  return light >= 2;
}

function boxHasDarkNeutralInk(canvas, box) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot) return false;
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(canvas.width - x, Math.max(1, Math.ceil(box.width)));
  const height = Math.min(canvas.height - y, Math.max(1, Math.ceil(box.height)));
  if (width <= 0 || height <= 0) return false;
  let dark = 0;
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const i = ((y + py) * snapshot.width + x + px) * 4;
    const r = snapshot.data[i], g = snapshot.data[i + 1], b = snapshot.data[i + 2];
    if ((r + g + b) / 3 <= 145 && Math.max(r, g, b) - Math.min(r, g, b) <= 28) dark++;
  }
  return dark >= 3;
}

function boxHasChromaticBackground(canvas, box) {
  const region = box?._chromaticRegion;
  if (!region) return false;
  // PDF.js line boxes include generous descent/leading and commonly overlap
  // the following table band. The upper quarter tracks the actual glyph row.
  return chromaticRowShare(canvas, region, box.y + box.height * 0.25) >= 0.42;
}

function sampleDominantChromaticInk(canvas, box) {
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot) return null;
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(canvas.width - x, Math.max(1, Math.ceil(box.width)));
  const height = Math.min(canvas.height - y, Math.max(1, Math.ceil(box.height)));
  if (width <= 0 || height <= 0) return null;
  const buckets = new Map();
  let chromaticCount = 0, darkNeutralCount = 0;
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const i = ((y + py) * snapshot.width + x + px) * 4;
    const r = snapshot.data[i], g = snapshot.data[i + 1], b = snapshot.data[i + 2];
    if (chromaticPixel(r, g, b)) {
      chromaticCount++;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
      buckets.set(key, bucket);
    } else if ((r + g + b) / 3 < 155 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) {
      darkNeutralCount++;
    }
  }
  if (chromaticCount < 3 || chromaticCount / Math.max(1, chromaticCount + darkNeutralCount) < 0.55) return null;
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return null;
  const hex = value => Math.round(value / best.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

function reconcileTextColorsOverChromaticTableBands(textObjs, canvas, regions = []) {
  const backdrops = regions.filter(region => region?.chromaticTableBackdrop);
  if (!backdrops.length) return textObjs;
  return textObjs.map(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    let changed = false;
    const repairedLines = lines.map((line, index) => {
      const box = boxes[index] || boxes[boxes.length - 1] || obj;
      const backdrop = backdrops.find(region => isMostlyInsideAnyRegion(box, [region], 0.45));
      if (!backdrop) return line;
      const hasChromaticRunColor = line.some(run => {
        const match = String(run?.color || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        return match && chromaticPixel(parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16));
      });
      if (boxHasDarkNeutralInk(canvas, box)) {
        const extracted = line.find(run => String(run?.text || '').trim())?.color || data.color || '#000000';
        const sampled = sampleCanvasTextInkColor(canvas, box, extracted, { preferDarkNeutral: true });
        const sampledRgb = parseHexColor(sampled?.color);
        const sampledNeutral = sampledRgb && Math.max(sampledRgb.r, sampledRgb.g, sampledRgb.b) - Math.min(sampledRgb.r, sampledRgb.g, sampledRgb.b) <= 30;
        if (sampledNeutral && colorLuminance(sampled.color) < 165) {
          changed = true;
          return line.map(run => ({ ...run, color: sampled.color }));
        }
        return line;
      }
      if (!hasChromaticRunColor && boxHasChromaticBackground(canvas, { ...box, _chromaticRegion: backdrop }) && boxHasLightNeutralInk(canvas, box)) {
        const extracted = line.find(run => String(run?.text || '').trim())?.color || data.color || '#000000';
        const sampled = sampleCanvasTextInkColor(canvas, box, extracted);
        const sampledRgb = parseHexColor(sampled?.color);
        const sampledNeutral = sampledRgb && Math.max(sampledRgb.r, sampledRgb.g, sampledRgb.b) - Math.min(sampledRgb.r, sampledRgb.g, sampledRgb.b) <= 30;
        // Use the rendered neutral ink itself. Never infer white merely because
        // the backdrop is colored; bright green pills commonly use dark text.
        if (sampledNeutral && sampled.contrast >= 68) {
          changed = true;
          return line.map(run => ({ ...run, color: sampled.color }));
        }
        return line;
      }
      const chromaticInk = sampleDominantChromaticInk(canvas, box);
      if (!chromaticInk) return line;
      changed = true;
      return line.map(run => ({ ...run, color: chromaticInk }));
    });
    if (!changed) return obj;
    const color = repairedLines[0]?.[0]?.color || data.color;
    return {
      ...obj,
      data: {
        ...data,
        lines: repairedLines,
        color,
        _originalStyle: data._originalStyle ? { ...data._originalStyle, color } : data._originalStyle
      }
    };
  });
}

function synthesizeChromaticTableBackdrop(ctx) {
  const width = ctx?.canvas?.width || 0;
  const height = ctx?.canvas?.height || 0;
  if (!width || !height) return;
  const image = ctx.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(image.data);
  const output = image.data;
  for (let i = 0; i < output.length; i += 4) output[i + 3] = 0;
  for (let y = 0; y < height; y++) {
    let count = 0, first = width, last = -1;
    const buckets = new Map();
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (source[i + 3] < 40 || !chromaticPixel(source[i], source[i + 1], source[i + 2])) continue;
      count++; first = Math.min(first, x); last = Math.max(last, x);
      const key = `${source[i] >> 4},${source[i + 1] >> 4},${source[i + 2] >> 4}`;
      const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bucket.n++; bucket.r += source[i]; bucket.g += source[i + 1]; bucket.b += source[i + 2];
      buckets.set(key, bucket);
    }
    // Filled table bands occupy most of a row. Colored header glyphs can span
    // the table width too, but only cover a minority of the row's pixels.
    if (count / Math.max(1, width) < 0.55 || last - first < width * 0.3) continue;
    let best = null;
    for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
    if (!best) continue;
    const r = Math.round(best.r / best.n), g = Math.round(best.g / best.n), b = Math.round(best.b / best.n);
    for (let x = first; x <= last; x++) {
      const i = (y * width + x) * 4;
      output[i] = r; output[i + 1] = g; output[i + 2] = b; output[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function synthesizeNeutralTableRuleBackdrop(ctx) {
  const width = ctx?.canvas?.width || 0;
  const height = ctx?.canvas?.height || 0;
  if (!width || !height) return;
  const image = ctx.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(image.data);
  const output = image.data;
  const dark = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = source[i], g = source[i + 1], b = source[i + 2], a = source[i + 3];
      const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 46;
      if (a >= 80 && neutral && (r + g + b) / 3 <= 238) {
        dark[y * width + x] = 1;
      }
    }
  }

  const ruleRows = new Uint8Array(height);
  const ruleCols = new Uint8Array(width);
  const minRowRun = Math.max(18, Math.round(width * 0.30));
  const minColRun = Math.max(18, Math.round(height * 0.30));
  for (let y = 0; y < height; y++) {
    let run = 0, longest = 0, count = 0, first = width, last = -1, gap = 0;
    for (let x = 0; x < width; x++) {
      if (dark[y * width + x]) {
        count++;
        first = Math.min(first, x);
        last = x;
        run++;
        gap = 0;
        longest = Math.max(longest, run);
      } else {
        if (++gap > 9) run = 0;
      }
    }
    if (longest >= minRowRun) ruleRows[y] = 1;
  }
  for (let x = 0; x < width; x++) {
    let run = 0, longest = 0, count = 0, first = height, last = -1, gap = 0;
    for (let y = 0; y < height; y++) {
      if (dark[y * width + x]) {
        count++;
        first = Math.min(first, y);
        last = y;
        run++;
        gap = 0;
        longest = Math.max(longest, run);
      } else {
        if (++gap > 9) run = 0;
      }
    }
    if (longest >= minColRun) ruleCols[x] = 1;
  }

  for (let i = 0; i < output.length; i += 4) output[i + 3] = 0;
  const groupedRows = groupLinePositions([...ruleRows].flatMap((value, index) => value ? [index] : []), 3);
  const groupedCols = groupLinePositions([...ruleCols].flatMap((value, index) => value ? [index] : []), 3);
  const hasDarkNear = (x, y, radius = 2) => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let py = Math.max(0, cy - radius); py <= Math.min(height - 1, cy + radius); py++) {
      for (let px = Math.max(0, cx - radius); px <= Math.min(width - 1, cx + radius); px++) {
        if (dark[py * width + px]) return true;
      }
    }
    return false;
  };
  const armLength = Math.max(5, Math.min(12, Math.round(Math.min(width, height) * 0.01)));
  const hasRuleIntersection = (col, row) => hasDarkNear(col, row, 1) &&
    hasDarkNear(col, row - armLength, 1) &&
    hasDarkNear(col, row + armLength, 1) &&
    hasDarkNear(col - armLength, row, 1) &&
    hasDarkNear(col + armLength, row, 1);
  let tableRows = groupedRows.filter(row => {
    const supports = groupedCols.filter(col => hasRuleIntersection(col, row)).length;
    return supports >= Math.max(2, Math.ceil(groupedCols.length * 0.5));
  });
  let tableCols = groupedCols.filter(col => {
    const supports = tableRows.filter(row => hasRuleIntersection(col, row)).length;
    return supports >= Math.max(2, Math.ceil(tableRows.length * 0.5));
  });
  tableRows = tableRows.filter(row => {
    const supports = tableCols.filter(col => hasRuleIntersection(col, row)).length;
    return supports >= Math.max(2, Math.ceil(tableCols.length * 0.5));
  });
  if (tableRows.length < 2 || tableCols.length < 2) {
    ctx.putImageData(image, 0, 0);
    return;
  }
  const x0 = Math.max(0, Math.round(tableCols[0]));
  const x1 = Math.min(width - 1, Math.round(tableCols[tableCols.length - 1]));
  const y0 = Math.max(0, Math.round(tableRows[0]));
  const y1 = Math.min(height - 1, Math.round(tableRows[tableRows.length - 1]));
  const ruleSamples = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!dark[y * width + x] || (!ruleRows[y] && !ruleCols[x])) continue;
    const i = (y * width + x) * 4;
    ruleSamples.push((source[i] + source[i + 1] + source[i + 2]) / 3);
  }
  ruleSamples.sort((a, b) => a - b);
  const tone = Math.max(20, Math.min(190, Math.round(ruleSamples[Math.floor(ruleSamples.length * 0.35)] || 100)));
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    output[i] = tone; output[i + 1] = tone; output[i + 2] = tone; output[i + 3] = 255;
  };
  for (const row of tableRows) {
    const y = Math.round(row);
    for (let x = x0; x <= x1; x++) paint(x, y);
  }
  for (const col of tableCols) {
    const x = Math.round(col);
    for (let y = y0; y <= y1; y++) paint(x, y);
  }
  ctx.putImageData(image, 0, 0);
}

function dedupeCoincidentTextObjects(textObjs) {
  if (!Array.isArray(textObjs) || textObjs.length < 2) return textObjs || [];
  const seen = new Set();
  const nearby = new Map();
  return textObjs.filter(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const text = (lines.length
      ? lines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n')
      : String(data.content || '')).replace(/\s+/g, ' ').trim();
    if (!text) return true;
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    const geometry = boxes.map(box => [
      Math.round(Number(box?.x ?? obj.x ?? 0)),
      Math.round(Number(box?.y ?? obj.y ?? 0)),
      Math.round(Number(box?.width ?? obj.width ?? 0)),
      Math.round(Number(box?.height ?? obj.height ?? 0)),
      Math.round(Number(box?.rotation ?? obj.rotation ?? 0))
    ].join(',')).join(';');
    const key = `${text}\u0000${geometry}`;
    if (seen.has(key)) return false;

    // PDF producers frequently emit the same glyph run twice with sub-pixel
    // coordinate differences (for example a fill pass plus a clipping pass).
    // Integer-key deduplication misses those runs, while Word makes the tiny
    // offset very obvious. Compare only equal text at nearly equal geometry so
    // repeated labels elsewhere on the page remain independent and editable.
    const normalizedText = text.toLowerCase();
    const visual = unionRects(boxes.map(box => ({
      x: Number(box?.x ?? obj.x ?? 0),
      y: Number(box?.y ?? obj.y ?? 0),
      width: Number(box?.width ?? obj.width ?? 0),
      height: Number(box?.height ?? obj.height ?? 0)
    })));
    const rotation = normalizeDegrees(Number(boxes[0]?.rotation ?? obj.rotation ?? 0));
    const candidates = nearby.get(normalizedText) || [];
    const fuzzyDuplicate = visual && candidates.some(candidate => {
      const centerDistance = Math.hypot(
        visual.x + visual.width / 2 - (candidate.box.x + candidate.box.width / 2),
        visual.y + visual.height / 2 - (candidate.box.y + candidate.box.height / 2)
      );
      const sizeTolerance = Math.max(2.5, Math.min(7, Math.max(visual.height, candidate.box.height) * 0.24));
      const widthDelta = Math.abs(visual.width - candidate.box.width);
      const heightDelta = Math.abs(visual.height - candidate.box.height);
      const rotationDelta = Math.min(
        Math.abs(rotation - candidate.rotation),
        360 - Math.abs(rotation - candidate.rotation)
      );
      return centerDistance <= sizeTolerance &&
        widthDelta <= Math.max(3, Math.max(visual.width, candidate.box.width) * 0.08) &&
        heightDelta <= Math.max(3, Math.max(visual.height, candidate.box.height) * 0.18) &&
        rotationDelta <= 3;
    });
    if (fuzzyDuplicate) return false;
    seen.add(key);
    if (visual) {
      candidates.push({ box: visual, rotation });
      nearby.set(normalizedText, candidates);
    }
    return true;
  });
}

function collapseOverlappingTextItemGrams(items, scale = 1) {
  if (!Array.isArray(items) || items.length < 4) return items || [];
  const ordered = items.slice().sort((a, b) => a._cy - b._cy || a._cx - b._cx);
  const result = [];
  const textEnd = item => Number(item._cx || 0) + Math.max(0, Number(item.width || 0) * scale);
  const suffixPrefixOverlap = (left, right) => {
    const max = Math.min(left.length, right.length);
    for (let length = max; length >= 1; length--) {
      if (left.slice(-length) === right.slice(0, length)) return length;
    }
    return 0;
  };

  for (let index = 0; index < ordered.length;) {
    const first = ordered[index];
    let mergedText = String(first.str || '');
    let right = textEnd(first);
    let chainEnd = index + 1;
    let transitions = 0;
    let compactFragments = mergedText.length <= 6 ? 1 : 0;
    const chain = [first];

    while (chainEnd < ordered.length) {
      const next = ordered[chainEnd];
      const nextText = String(next.str || '');
      const sameBaseline = Math.abs(Number(next._cy || 0) - Number(first._cy || 0)) <=
        Math.max(1.5, Math.max(Number(next._fs || 0), Number(first._fs || 0)) * 0.14);
      const sameAngle = Math.abs(Number(next._angle || 0) - Number(first._angle || 0)) <= 1.5;
      const sameFont = String(next.fontName || '') === String(first.fontName || '');
      const positionTolerance = Math.max(2, Math.max(Number(next._fs || 0), Number(first._fs || 0)) * 0.28);
      const geometricallyOverlapping = Number(next._cx || 0) >= Number(first._cx || 0) - positionTolerance &&
        Number(next._cx || 0) <= right + positionTolerance;
      if (!nextText || !sameBaseline || !sameAngle || !sameFont || !geometricallyOverlapping) break;

      const overlap = suffixPrefixOverlap(mergedText, nextText);
      if (!overlap) break;
      mergedText += nextText.slice(overlap);
      right = Math.max(right, textEnd(next));
      transitions++;
      compactFragments += nextText.length <= 6 ? 1 : 0;
      chain.push(next);
      chainEnd++;
    }

    // Require a sustained chain of compact, overlapping fragments. Ordinary
    // adjacent words can share a boundary character by chance; PDF overprint
    // encoding repeats this pattern across several consecutive glyph grams.
    const isOverprintChain = chain.length >= 4 &&
      transitions === chain.length - 1 &&
      compactFragments / chain.length >= 0.75;
    if (!isOverprintChain) {
      result.push(first);
      index++;
      continue;
    }

    const start = Math.min(...chain.map(item => Number(item._cx || 0)));
    const base = chain.reduce((best, item) => String(item.str || '').length > String(best.str || '').length ? item : best, first);
    result.push({
      ...base,
      str: mergedText,
      _cx: start,
      width: Math.max(0, right - start) / Math.max(0.01, scale)
    });
    index = chainEnd;
  }
  return result.sort((a, b) => a._cy - b._cy || a._cx - b._cx);
}

function isDenseSpreadsheetGrid(grid) {
  if (!grid) return false;
  const rows = grid.rowHeights?.length || 0;
  const cols = grid.columnWidths?.length || 0;
  if (rows < 2 || cols < 2) return false;
  // A two-by-two frame is a common chart/panel layout. It does not carry
  // enough repeated structure to be promoted to a native Word table.
  if (rows === 2 && cols === 2) return false;
  const narrowCols = (grid.columnWidths || []).filter(w => w < 18).length;
  if (narrowCols > cols * 0.35) return false;
  return true;
}

function gridHasTabularTextDensity(grid, textObjs = []) {
  const rows = grid?.rowHeights?.length || 0;
  const cols = grid?.columnWidths?.length || 0;
  if (rows < 2 || cols < 2 || !Array.isArray(grid?.hLines) || !Array.isArray(grid?.vLines)) return false;
  if (rows === 2 && cols < 3) return false;

  const occupied = new Set();
  let containedText = 0;
  for (const box of (textObjs || []).flatMap(textObjectVisualBoxes)) {
    const cx = Number(box.x || 0) + Number(box.width || 0) / 2;
    const cy = Number(box.y || 0) + Number(box.height || 0) / 2;
    const col = findGridIndex(grid.vLines, cx);
    const row = findGridIndex(grid.hLines, cy);
    if (row < 0 || col < 0) continue;
    occupied.add(`${row}:${col}`);
    containedText++;
  }

  const cells = rows * cols;
  const requiredShare = rows === 2 ? 0.70 : 0.42;
  const requiredCells = Math.max(4, Math.ceil(cells * requiredShare));
  return containedText >= Math.max(rows, cols) && occupied.size >= requiredCells;
}

function rectIntersectionArea(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.x || 0, b.x || 0);
  const top = Math.max(a.y || 0, b.y || 0);
  const right = Math.min((a.x || 0) + (a.width || 0), (b.x || 0) + (b.width || 0));
  const bottom = Math.min((a.y || 0) + (a.height || 0), (b.y || 0) + (b.height || 0));
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function unionRects(rects) {
  const usable = (rects || []).filter(r => r && r.width > 0 && r.height > 0);
  if (!usable.length) return null;
  const x = Math.min(...usable.map(r => r.x || 0));
  const y = Math.min(...usable.map(r => r.y || 0));
  const right = Math.max(...usable.map(r => (r.x || 0) + (r.width || 0)));
  const bottom = Math.max(...usable.map(r => (r.y || 0) + (r.height || 0)));
  return { x, y, width: right - x, height: bottom - y };
}

function normalizeDegrees(value) {
  return ((Number(value || 0) % 360) + 360) % 360;
}

function textBoxVisualBounds(box) {
  if (!box) return box;
  const rotation = normalizeDegrees(box.rotation || 0);
  if (Math.min(rotation, 360 - rotation) <= 3) return box;
  const theta = rotation * Math.PI / 180;
  return {
    ...box,
    width: Math.abs(Number(box.width || 0) * Math.cos(theta)) + Math.abs(Number(box.height || 0) * Math.sin(theta)),
    height: Math.abs(Number(box.width || 0) * Math.sin(theta)) + Math.abs(Number(box.height || 0) * Math.cos(theta)),
    rotation: 0
  };
}

function isNonOrthogonalRotation(value) {
  const deg = normalizeDegrees(value);
  return [0, 90, 180, 270, 360].every(anchor => Math.abs(deg - anchor) > 3);
}

function findComplexFigureRegions(textObjs, vectorObjs, canvas, imageObjs = [], options = {}) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs)) return [];
  const debugReject = (reason, extra = {}) => {
    if (window.__PDFOMNI_DEBUG_LAYOUT) {
      console.info('pdfomni-figure-reject', JSON.stringify({ reason, ...extra }));
    }
    return [];
  };
  const pageArea = canvas.width * canvas.height;
  const vectors = vectorObjs
    .filter(v => Math.max(Number(v?.width || 0), Number(v?.height || 0)) > 1.5)
    .map(v => ({
      ...v,
      x: Number(v.x || 0),
      y: Number(v.y || 0),
      width: Math.max(1, Number(v.width || 0)),
      height: Math.max(1, Number(v.height || 0))
    }));
  const imageBoxes = (imageObjs || [])
    .map(img => img?.data?._originalBox || img)
    .filter(box => box?.width > 4 && box?.height > 4);
  const textBoxes = (textObjs || []).flatMap(obj => {
    const d = obj.data || {};
    const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
    const lines = Array.isArray(d.lines) ? d.lines : [];
    return boxes.map((box, index) => {
      const lineText = Array.isArray(lines[index])
        ? lines[index].map(run => String(run?.text || '')).join('')
        : String(d.content || '');
      return {
        x: box.x ?? obj.x,
        y: box.y ?? obj.y,
        width: box.width ?? obj.width,
        height: box.height ?? obj.height,
        fontSize: Number(d.fontSize || d._originalStyle?.fontSize || 0),
        text: lineText
      };
    });
  });
  const rotatedText = (textObjs || []).flatMap(obj => {
    const d = obj.data || {};
    const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
    return boxes
      .filter(box => isNonOrthogonalRotation(box.rotation ?? obj.rotation ?? d._originalBox?.rotation))
      .map(box => ({ x: box.x ?? obj.x, y: box.y ?? obj.y, width: box.width ?? obj.width, height: box.height ?? obj.height }));
  });

  if (rotatedText.length >= 8) {
    const labelBounds = unionRects(rotatedText);
    if (labelBounds) {
      const padX = Math.max(24, Math.min(canvas.width * 0.08, labelBounds.width * 0.12));
      const above = Math.min(canvas.height * 0.36, Math.max(180, labelBounds.height * 5.5));
      const below = Math.max(8, Math.min(canvas.height * 0.025, labelBounds.height * 0.18));
      const x = Math.max(0, labelBounds.x - padX);
      const y = Math.max(0, labelBounds.y - above);
      const right = Math.min(canvas.width, labelBounds.x + labelBounds.width + padX);
      const bottom = Math.min(canvas.height, labelBounds.y + labelBounds.height + below);
      const region = { x, y, width: right - x, height: bottom - y, kind: 'rotatedLabelFigure' };
      const area = region.width * region.height;
      if (area >= pageArea * 0.025 && area <= pageArea * 0.62) return [region];
    }
  }

  if (vectors.length < 20 && imageBoxes.length < 6) return debugReject('few-vectors', { vectors: vectors.length, images: imageBoxes.length });
  const vectorSource = imageBoxes.length >= 3 && vectors.length >= 20
    ? [...vectors, ...imageBoxes]
    : imageBoxes.length >= 6
      ? [...imageBoxes, ...vectors]
      : vectors;
  const vectorBounds = unionRects(vectorSource);
  if (!vectorBounds) return debugReject('no-vector-bounds', { vectors: vectors.length, images: imageBoxes.length });

  const padX = Math.max(20, Math.min(canvas.width * 0.06, vectorBounds.width * 0.12));
  const padTop = options.denseRotatedLabels
    ? Math.max(16, Math.min(canvas.height * 0.08, vectorBounds.height * 0.14))
    : Math.max(16, Math.min(canvas.height * 0.04, vectorBounds.height * 0.10));
  const padBottom = Math.max(32, Math.min(canvas.height * 0.18, vectorBounds.height * 0.35));
  let region = {
    x: Math.max(0, vectorBounds.x - padX),
    y: Math.max(0, vectorBounds.y - padTop),
    width: Math.min(canvas.width, vectorBounds.x + vectorBounds.width + padX) - Math.max(0, vectorBounds.x - padX),
    height: Math.min(canvas.height, vectorBounds.y + vectorBounds.height + padBottom) - Math.max(0, vectorBounds.y - padTop)
  };

  const nearbyRotated = rotatedText.filter(r => rectIntersectionArea(region, r) > 0 || (
    (r.x + r.width / 2) >= region.x - padX &&
    (r.x + r.width / 2) <= region.x + region.width + padX &&
    (r.y + r.height / 2) >= region.y - padBottom &&
    (r.y + r.height / 2) <= region.y + region.height + padBottom
  ));
  const seekPadX = Math.max(padX * 2, canvas.width * 0.22);
  const seekPadTop = Math.max(padTop * 1.5, canvas.height * 0.035);
  const seekPadBottom = Math.max(padBottom, canvas.height * 0.08);
  const seekRegion = {
    x: Math.max(0, region.x - seekPadX),
    y: Math.max(0, region.y - seekPadTop),
    width: Math.min(canvas.width, region.x + region.width + seekPadX) - Math.max(0, region.x - seekPadX),
    height: Math.min(canvas.height, region.y + region.height + seekPadBottom) - Math.max(0, region.y - seekPadTop)
  };
  const nearRegion = box => {
    if (!box) return false;
    if (rectIntersectionArea(seekRegion, box) > 0) return true;
    const cx = (box.x || 0) + (box.width || 0) / 2;
    const cy = (box.y || 0) + (box.height || 0) / 2;
    return cx >= seekRegion.x && cx <= seekRegion.x + seekRegion.width &&
      cy >= seekRegion.y && cy <= seekRegion.y + seekRegion.height;
  };
  const nearbyImages = imageBoxes.filter(nearRegion);
  const nearbyFigureText = textBoxes.filter(box => {
    const h = Number(box.height || 0);
    const fs = Number(box.fontSize || 0);
    const tinyFigureText = (fs > 0 && fs <= 12) || (h > 0 && h <= Math.max(8, canvas.height * 0.012));
    const text = String(box.text || '').replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    const compactFigureLabel = text.length <= 54 &&
      words.length <= 6 &&
      !isCaptionLikeText(text) &&
      !looksLikeBodyProseText(text) &&
      !looksLikeNaturalLanguageFragmentText(text) &&
      (/[0-9%._+/()[\]-]/.test(text) || words.length <= 3);
    const narrowLine = Number(box.width || 0) <= canvas.width * 0.56;
    const smallPanelLine = (fs > 0 && fs <= 14) ||
      (narrowLine && h > 0 && h <= Math.max(24, canvas.height * 0.015));
    const withinFigureVerticalBand = (Number(box.y || 0) + h) <= region.y + region.height + 2 &&
      Number(box.y || 0) >= region.y - seekPadTop;
    const denseFigureText = smallPanelLine &&
      withinFigureVerticalBand &&
      text.length <= 180 &&
      words.length <= 28 &&
      !isCaptionLikeText(text);
    return ((tinyFigureText && compactFigureLabel) || denseFigureText) && nearRegion(box);
  });
  region = unionRects([region, ...nearbyRotated, ...nearbyImages, ...nearbyFigureText]) || region;
  region.x = Math.max(0, region.x - 8);
  region.y = Math.max(0, region.y - 8);
  region.width = Math.min(canvas.width - region.x, region.width + 16);
  region.height = Math.min(canvas.height - region.y, region.height + 16);

  const area = region.width * region.height;
  const intersectsRegion = box => rectIntersectionArea(region, box) > 0;
  const regionTextBoxes = textBoxes.filter(intersectsRegion);
  const compactLabelCount = regionTextBoxes.filter(box => {
    const text = String(box.text || '').replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    return text.length <= 54 &&
      words.length <= 6 &&
      !isCaptionLikeText(text) &&
      !looksLikeBodyProseText(text) &&
      !looksLikeNaturalLanguageFragmentText(text) &&
      (/[0-9%._+/()[\]-]/.test(text) || words.length <= 3);
  }).length;
  const rotatedInRegion = rotatedText.filter(intersectsRegion).length;
  const lineLikeCount = vectors.filter(v => {
    if (!intersectsRegion(v)) return false;
    const w = Number(v.width || 0);
    const h = Number(v.height || 0);
    return v.kind === 'line' || Math.min(w, h) <= 4;
  }).length;
  const filledSignalCount = vectors.filter(v => {
    if (!intersectsRegion(v) || !v.fill) return false;
    const w = Number(v.width || 0);
    const h = Number(v.height || 0);
    const vectorArea = w * h;
    return vectorArea >= pageArea * 0.0002 &&
      vectorArea <= pageArea * 0.08 &&
      isSaturatedNonNeutralColor(v.fillColor || v.color);
  }).length;
  const imageAreaRatio = imageBoxes.reduce((sum, box) => sum + rectIntersectionArea(region, box), 0) / Math.max(1, area);
  const hasChartSignal = rotatedInRegion >= 4 ||
    compactLabelCount >= 8 ||
    (lineLikeCount >= 10 && compactLabelCount >= 3) ||
    (filledSignalCount >= 4 && compactLabelCount >= 3);
  if (!hasChartSignal && imageBoxes.length >= 3 && imageAreaRatio > 0.12) {
    return debugReject('image-card-layout', { vectors: vectors.length, images: imageBoxes.length, compactLabelCount, rotatedInRegion, lineLikeCount, filledSignalCount, imageAreaRatio });
  }
  const maximumAreaRatio = options.denseRotatedLabels ? 0.70 : 0.62;
  if (area < pageArea * 0.025 || area > pageArea * maximumAreaRatio) return debugReject('area', { vectors: vectors.length, images: imageBoxes.length, vectorBounds, region, areaRatio: area / pageArea });
  if (region.width < canvas.width * 0.20 || region.height < canvas.height * 0.08) return debugReject('too-small', { vectors: vectors.length, images: imageBoxes.length, vectorBounds, region });
  return [{ ...region, kind: 'complexFigure' }];
}

function findConnectedBoxDiagramRegions(textObjs, vectorObjs, markerRegions, canvas) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs) ||
      !Array.isArray(markerRegions) || markerRegions.length < 8 || markerRegions.length > 96) return [];
  const pageArea = canvas.width * canvas.height;
  const vectors = vectorObjs.filter(vector => {
    const width = Math.max(1, Number(vector?.width || 0));
    const height = Math.max(1, Number(vector?.height || 0));
    if (Math.max(width, height) <= 1.5) return false;
    const pageRule = width >= canvas.width * 0.72 && height <= 4;
    const pageDivider = height >= canvas.height * 0.72 && width <= 4;
    return !pageRule && !pageDivider;
  }).slice(0, 700);
  if (vectors.length < 30) return [];

  const parent = vectors.map((_, index) => index);
  const find = index => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const join = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const padX = Math.max(14, canvas.width * 0.014);
  const padY = Math.max(14, canvas.height * 0.009);
  for (let i = 0; i < vectors.length; i++) {
    const a = vectors[i];
    for (let j = i + 1; j < vectors.length; j++) {
      const b = vectors[j];
      if (Number(b.y || 0) > Number(a.y || 0) + Number(a.height || 0) + padY &&
          Number(b.x || 0) > Number(a.x || 0) + Number(a.width || 0) + padX) continue;
      const near = Number(a.x || 0) <= Number(b.x || 0) + Number(b.width || 0) + padX &&
        Number(b.x || 0) <= Number(a.x || 0) + Number(a.width || 0) + padX &&
        Number(a.y || 0) <= Number(b.y || 0) + Number(b.height || 0) + padY &&
        Number(b.y || 0) <= Number(a.y || 0) + Number(a.height || 0) + padY;
      if (near) join(i, j);
    }
  }

  const groups = new Map();
  vectors.forEach((vector, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(vector);
  });
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  return [...groups.values()].flatMap(group => {
    if (group.length < 24) return [];
    let bounds = unionRects(group);
    if (!bounds) return [];
    const markerCount = markerRegions.filter(marker =>
      rectIntersectionArea(marker, bounds) / Math.max(1, Number(marker.width || 0) * Number(marker.height || 0)) >= 0.65
    ).length;
    const areaRatio = bounds.width * bounds.height / Math.max(1, pageArea);
    if (markerCount < 8 || areaRatio < 0.012 || areaRatio > 0.30 ||
        bounds.width < canvas.width * 0.32 || bounds.height < canvas.height * 0.055) return [];
    const searchPad = Math.max(10, Math.min(bounds.width, bounds.height) * 0.04);
    const search = padRegionToCanvas(bounds, canvas, searchPad);
    const labels = textBoxes.filter(box => {
      const cx = Number(box.x || 0) + Number(box.width || 0) / 2;
      const cy = Number(box.y || 0) + Number(box.height || 0) / 2;
      return cx >= search.x && cx <= search.x + search.width &&
        cy >= search.y && cy <= search.y + search.height;
    });
    bounds = unionRects([bounds, ...labels]) || bounds;
    const region = padRegionToCanvas(bounds, canvas, 6);
    return [{
      ...region,
      kind: 'complexFigure',
      rasterize: true,
      keepRepeatedMarkersInRaster: true
    }];
  }).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 3);
}

function findTiledCompoundDiagramRegions(textObjs, vectorObjs, imageObjs, canvas) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(imageObjs) || imageObjs.length < 4 ||
      !Array.isArray(vectorObjs) || vectorObjs.length < 24) return [];
  const pageArea = canvas.width * canvas.height;
  const imageBoxes = imageObjs
    .map(image => image?.data?._originalBox || image)
    .filter(box => Number(box?.width) > 4 && Number(box?.height) > 4)
    .map(box => ({
      x: Number(box.x || 0), y: Number(box.y || 0),
      width: Number(box.width || 0), height: Number(box.height || 0)
    }));
  if (imageBoxes.length < 4) return [];

  // PDF figures are commonly assembled from repeated XObject tiles plus
  // editable vector boxes/arrows. Treat overlapping or similarly sized tiles
  // as one diagram only when the surrounding region also contains substantial
  // vector structure and compact labels; ordinary photo collages stay apart.
  const parent = imageBoxes.map((_, index) => index);
  const find = index => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const join = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  // Multi-panel diagrams place their repeated tiles in a 2x2 (or wider)
  // arrangement with deliberate whitespace between panels. Use page-relative
  // proximity here; the later vector/label tests prevent photo grids from
  // being flattened as diagrams.
  const padX = Math.max(24, canvas.width * 0.12);
  const padY = Math.max(24, canvas.height * 0.18);
  for (let i = 0; i < imageBoxes.length; i++) {
    for (let j = i + 1; j < imageBoxes.length; j++) {
      const a = imageBoxes[i], b = imageBoxes[j];
      const near = a.x <= b.x + b.width + padX && b.x <= a.x + a.width + padX &&
        a.y <= b.y + b.height + padY && b.y <= a.y + a.height + padY;
      if (near) join(i, j);
    }
  }
  const groups = new Map();
  imageBoxes.forEach((box, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(box);
  });
  const textBoxes = (textObjs || []).flatMap(obj => {
    const data = obj?.data || {};
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    const lines = Array.isArray(data.lines) ? data.lines : [];
    return boxes.map((box, index) => ({
      x: box.x ?? obj.x, y: box.y ?? obj.y,
      width: box.width ?? obj.width, height: box.height ?? obj.height,
      text: Array.isArray(lines[index])
        ? lines[index].map(run => String(run?.text || '')).join('')
        : String(data.content || '')
    }));
  });
  return [...groups.values()].flatMap(group => {
    if (group.length < 4) return [];
    const imageBounds = unionRects(group);
    if (!imageBounds) return [];
    const imageAreaRatio = imageBounds.width * imageBounds.height / Math.max(1, pageArea);
    if (imageAreaRatio < 0.012 || imageAreaRatio > 0.32 ||
        imageBounds.width < canvas.width * 0.28 || imageBounds.height < canvas.height * 0.045) return [];
    const repeatedTilePairs = group.reduce((count, box, index) => count + group.slice(index + 1).filter(other => {
      const widthRatio = Math.min(box.width, other.width) / Math.max(1, box.width, other.width);
      const heightRatio = Math.min(box.height, other.height) / Math.max(1, box.height, other.height);
      const overlap = rectIntersectionArea(box, other) / Math.max(1, Math.min(box.width * box.height, other.width * other.height));
      return overlap >= 0.72 || (widthRatio >= 0.82 && heightRatio >= 0.82);
    }).length, 0);
    if (repeatedTilePairs < 2) return [];

    const search = {
      x: Math.max(0, imageBounds.x - Math.max(24, canvas.width * 0.035)),
      y: Math.max(0, imageBounds.y - Math.max(30, canvas.height * 0.045)),
      width: 0,
      height: 0
    };
    const searchRight = Math.min(canvas.width, imageBounds.x + imageBounds.width + Math.max(24, canvas.width * 0.035));
    const searchBottom = Math.min(canvas.height, imageBounds.y + imageBounds.height + Math.max(80, canvas.height * 0.16));
    search.width = searchRight - search.x;
    search.height = searchBottom - search.y;
    const insideSearch = box => {
      const cx = Number(box.x || 0) + Number(box.width || 0) / 2;
      const cy = Number(box.y || 0) + Number(box.height || 0) / 2;
      return cx >= search.x && cx <= search.x + search.width && cy >= search.y && cy <= search.y + search.height;
    };
    const nearbyVectors = vectorObjs.filter(insideSearch);
    const nearbyLabels = textBoxes.filter(box => {
      const text = String(box.text || '').replace(/\s+/g, ' ').trim();
      return insideSearch(box) && text && !isCaptionLikeText(text) &&
        text.length <= 100 && !looksLikeBodyProseText(text);
    });
    if (nearbyVectors.length < 24 || nearbyLabels.length < 8) return [];
    const bounds = unionRects([imageBounds, ...nearbyVectors, ...nearbyLabels]) || imageBounds;
    const region = padRegionToCanvas(bounds, canvas, 6);
    const areaRatio = region.width * region.height / Math.max(1, pageArea);
    if (areaRatio < 0.025 || areaRatio > 0.48) return [];
    return [{
      ...region,
      kind: 'complexFigure',
      rasterize: true,
      keepRepeatedMarkersInRaster: true
    }];
  }).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 2);
}

function findSmallVectorSymbolRegions(vectorObjs, textObjs, canvas, imageObjs = []) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs)) return [];
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  const imageBoxes = (imageObjs || [])
    .map(image => image?.data?._originalBox || image)
    .filter(box => Number(box?.width) > 1 && Number(box?.height) > 1);
  const regions = [];

  for (const anchor of vectorObjs) {
    const width = Number(anchor?.width || 0);
    const height = Number(anchor?.height || 0);
    const aspect = width / Math.max(1, height);
    const circleSized = width >= 18 && height >= 18 && width <= 120 && height <= 120 && aspect >= 0.7 && aspect <= 1.3;
    const circleLike = anchor?.kind === 'path' && (anchor?.points || []).length >= 12;
    const color = anchor?.fillColor || anchor?.color;
    if (!circleSized || !circleLike || anchor?.fill === false || !color) continue;

    const pad = Math.max(4, Math.min(width, height) * 0.12);
    const region = {
      x: Math.max(0, Number(anchor.x || 0) - pad),
      y: Math.max(0, Number(anchor.y || 0) - pad),
      width: Math.min(canvas.width, Number(anchor.x || 0) + width + pad) - Math.max(0, Number(anchor.x || 0) - pad),
      height: Math.min(canvas.height, Number(anchor.y || 0) + height + pad) - Math.max(0, Number(anchor.y || 0) - pad),
      kind: 'vectorSymbol',
      foreground: true
    };
    if (textBoxes.some(box => {
      const overlap = rectIntersectionArea(region, box);
      return overlap / Math.max(1, box.width * box.height) > 0.2 &&
        overlap / Math.max(1, region.width * region.height) > 0.12;
    })) continue;
    if (imageBoxes.some(box => rectIntersectionArea(region, box) / Math.max(1, region.width * region.height) > 0.65)) continue;

    const detailCount = vectorObjs.filter(vector => {
      if (vector === anchor) return false;
      const area = Math.max(1, Number(vector?.width || 0) * Number(vector?.height || 0));
      return rectIntersectionArea(region, vector) / area >= 0.72;
    }).length;
    if (detailCount < 1) continue;
    if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, region.width * region.height) > 0.8)) {
      regions.push(region);
    }
  }
  return regions;
}

function drawVectorObjectsIntoRasterRegion(ctx, region, vectorObjs, scaleRatio = 1) {
  if (!ctx || !region || !Array.isArray(vectorObjs)) return;
  const vectors = vectorObjs.filter(vector =>
    rectIntersectionArea(region, vector) > 0
  ).sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
  const localPoint = point => ({
    x: (Number(point?.x || 0) - Number(region.x || 0)) * scaleRatio,
    y: (Number(point?.y || 0) - Number(region.y || 0)) * scaleRatio
  });
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const vector of vectors) {
    const thickness = Math.max(0.5, Number(vector.thickness || 1) * scaleRatio);
    if (vector.kind === 'line') {
      const start = localPoint({ x: vector.x1 ?? vector.x, y: vector.y1 ?? vector.y });
      const end = localPoint({
        x: vector.x2 ?? (Number(vector.x || 0) + Number(vector.width || 0)),
        y: vector.y2 ?? (Number(vector.y || 0) + Number(vector.height || 0))
      });
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = vector.color || vector.strokeColor || '#000000';
      ctx.lineWidth = thickness;
      ctx.stroke();
      continue;
    }
    if (vector.kind !== 'path' || !Array.isArray(vector.points) || vector.points.length < 2) continue;
    ctx.beginPath();
    const contours = Array.isArray(vector.contours) && vector.contours.length
      ? vector.contours
      : [vector.points];
    for (const contour of contours) {
      if (!Array.isArray(contour) || contour.length < 2) continue;
      const first = localPoint(contour[0]);
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < contour.length; index++) {
        const point = localPoint(contour[index]);
        ctx.lineTo(point.x, point.y);
      }
      if (vector.closed || vector.fill === true) ctx.closePath();
    }
    if (vector.fill === true) {
      ctx.fillStyle = vector.fillColor || vector.color || '#000000';
      ctx.fill('evenodd');
    }
    if (vector.stroke === true) {
      ctx.strokeStyle = vector.strokeColor || vector.color || '#000000';
      ctx.lineWidth = thickness;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function padRegionToCanvas(region, canvas, pad = 4) {
  const x = Math.max(0, Number(region.x || 0) - pad);
  const y = Math.max(0, Number(region.y || 0) - pad);
  const right = Math.min(canvas.width, Number(region.x || 0) + Number(region.width || 0) + pad);
  const bottom = Math.min(canvas.height, Number(region.y || 0) + Number(region.height || 0) + pad);
  return { x, y, width: right - x, height: bottom - y };
}

function findRepeatedMarkerBackdropRegions(vectorObjs, canvas) {
  if (!canvas?.width || !Array.isArray(vectorObjs)) return [];
  const candidates = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const aspect = width / Math.max(1, height);
    return vector?.fill !== false && width >= 5 && height >= 5 && width <= 65 && height <= 65 && aspect >= 0.55 && aspect <= 1.8;
  });
  const groups = new Map();
  for (const vector of candidates) {
    const key = `${Math.round(Number(vector.width || 0) / 4)}:${Math.round(Number(vector.height || 0) / 4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(vector);
  }
  return [...groups.values()].filter(group => group.length >= 8).flatMap(group => group.map(vector => ({
    ...padRegionToCanvas(vector, canvas, 2),
    kind: 'markerCell',
    preserveText: false,
    foreground: true,
    sourceX: Number(vector.x || 0),
    sourceY: Number(vector.y || 0),
    sourceWidth: Number(vector.width || 0),
    sourceHeight: Number(vector.height || 0),
    fillColor: vector.fillColor || vector.color || '#ffffff',
    strokeColor: vector.strokeColor || vector.color || vector.fillColor || '#ffffff',
    stroke: vector.stroke === true,
    thickness: Number(vector.thickness || 0.5)
  })));
}

function findRotatedTextStripRegions(textObjs, canvas) {
  if (!canvas?.width) return [];
  const rotated = (textObjs || []).flatMap(obj => {
    const boxes = Array.isArray(obj?.data?._lineBoxes) && obj.data._lineBoxes.length ? obj.data._lineBoxes : [obj];
    return boxes.filter(box => isNonOrthogonalRotation(box.rotation ?? obj.rotation ?? obj?.data?._originalBox?.rotation));
  }).filter(box => Number(box.y || 0) > canvas.height * 0.35);
  if (rotated.length < 5) return [];
  const sorted = rotated.slice().sort((a, b) => a.y - b.y);
  const groups = [];
  for (const box of sorted) {
    let group = groups.find(candidate => Math.abs(candidate.cy - (box.y + box.height / 2)) < canvas.height * 0.12);
    if (!group) { group = { cy: box.y + box.height / 2, boxes: [] }; groups.push(group); }
    group.boxes.push(box);
    group.cy = group.boxes.reduce((sum, item) => sum + item.y + item.height / 2, 0) / group.boxes.length;
  }
  return groups.filter(group => group.boxes.length >= 5).map(group => ({
    ...padRegionToCanvas(unionRects(group.boxes), canvas, 5),
    kind: 'rotatedTextStrip',
    foreground: true,
    preserveText: false
  }));
}

function clearRepeatedMarkerCellsFromRaster(ctx, rasterRegion, markerRegions, scaleRatio = 1) {
  if (!ctx?.canvas || !rasterRegion || !Array.isArray(markerRegions) || !markerRegions.length) return;
  const contained = markerRegions.filter(marker =>
    rectIntersectionArea(marker, rasterRegion) / Math.max(1, Number(marker.width || 0) * Number(marker.height || 0)) >= 0.9
  );
  if (!contained.length) return;
  for (const marker of contained) {
    // Marker regions carry a two-pixel detection pad. Remove the native vector
    // plus one anti-aliasing pixel from the raster copy, then let the original
    // editable Word vector be drawn over the untouched panel background.
    const x = Math.max(0, Math.floor((Number(marker.x || 0) - Number(rasterRegion.x || 0) + 1) * scaleRatio));
    const y = Math.max(0, Math.floor((Number(marker.y || 0) - Number(rasterRegion.y || 0) + 1) * scaleRatio));
    const width = Math.min(ctx.canvas.width - x, Math.ceil(Math.max(1, Number(marker.width || 0) - 2) * scaleRatio));
    const height = Math.min(ctx.canvas.height - y, Math.ceil(Math.max(1, Number(marker.height || 0) - 2) * scaleRatio));
    if (width < 1 || height < 1) continue;
    const background = _sampleTextEraseColor(ctx, x, y, width, height, null, null);
    ctx.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`;
    ctx.fillRect(x, y, width, height);
  }
}

function findMarkerLabelStripRegions(markerRegions, canvas) {
  if (!Array.isArray(markerRegions) || markerRegions.length < 8 || !canvas?.width) return [];
  const bounds = unionRects(markerRegions);
  if (!bounds) return [];
  const y = Math.max(0, bounds.y + bounds.height - 4);
  const bottom = Math.min(canvas.height, y + canvas.height * 0.13);
  return [{
    x: Math.max(0, bounds.x - 8),
    y,
    width: Math.min(canvas.width, bounds.x + bounds.width + 8) - Math.max(0, bounds.x - 8),
    height: bottom - y,
    kind: 'markerLabelStrip',
    foreground: true,
    preserveText: false
  }];
}

function findLargeRadialVectorRegions(vectorObjs, canvas) {
  if (!canvas?.width || !Array.isArray(vectorObjs)) return [];
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot) return [];
  const luminanceAt = (x, y) => {
    const offset = (y * snapshot.width + x) * 4;
    return (snapshot.data[offset] + snapshot.data[offset + 1] + snapshot.data[offset + 2]) / 3;
  };
  const radialContrast = vector => {
    const cx = Number(vector.x || 0) + Number(vector.width || 0) / 2;
    const cy = Number(vector.y || 0) + Number(vector.height || 0) / 2;
    const radius = Math.min(Number(vector.width || 0), Number(vector.height || 0)) * 0.39;
    const centerLum = luminanceAt(
      Math.max(0, Math.min(canvas.width - 1, Math.round(cx))),
      Math.max(0, Math.min(canvas.height - 1, Math.round(cy)))
    );
    let contrasting = 0;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(cx + Math.cos(angle) * radius)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(cy + Math.sin(angle) * radius)));
      const lum = luminanceAt(x, y);
      if (Math.abs(lum - centerLum) >= 24) contrasting++;
    }
    return contrasting >= 17;
  };
  const hasClearCenter = vector => {
    const cx = Number(vector.x || 0) + Number(vector.width || 0) / 2;
    const cy = Number(vector.y || 0) + Number(vector.height || 0) / 2;
    const radius = Math.max(5, Math.min(Number(vector.width || 0), Number(vector.height || 0)) * 0.12);
    let samples = 0, dark = 0;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 3) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 3) {
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
        const lum = luminanceAt(x, y);
        samples++;
        if (lum < 178) dark++;
      }
    }
    return samples > 0 && dark / samples <= 0.13;
  };
  const radialDiagnostics = [];
  const candidates = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const aspect = width / Math.max(1, height);
    const fillLum = colorLuminance(vector?.fillColor || vector?.color || '#ffffff');
    const coarseMatch = vector?.kind === 'path' && width >= canvas.width * 0.10 && height >= canvas.height * 0.12 &&
      width <= canvas.width * 0.38 && height <= canvas.height * 0.55 && aspect >= 0.72 && aspect <= 1.35 &&
      Number.isFinite(fillLum) && fillLum < 245;
    if (!coarseMatch) return false;
    const contrast = radialContrast(vector);
    const clearCenter = hasClearCenter(vector);
    radialDiagnostics.push({ x: vector.x, y: vector.y, width, height, fillLum, contrast, clearCenter });
    return contrast && clearCenter;
  });
  if (window.__PDFOMNI_DEBUG_LAYOUT && radialDiagnostics.length) {
    console.info('pdfomni-radial-vector-candidates', JSON.stringify(radialDiagnostics));
  }
  const regions = [];
  for (const vector of candidates) {
    // PDF path bounds often stop on the mathematical arc. Keep a wider safety
    // margin so Word's bitmap interpolation cannot shave antialiased circle edges.
    const region = { ...padRegionToCanvas(vector, canvas, 18), kind: 'radialChartBackdrop', preserveText: true };
    if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, Math.min(existing.width * existing.height, region.width * region.height)) > 0.65)) {
      regions.push(region);
    }
  }
  return regions;
}

function findLeaderLineChartRegions(vectorObjs, canvas) {
  if (!canvas?.width || !Array.isArray(vectorObjs)) return [];
  const lines = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const color = vector?.strokeColor || vector?.color || vector?.fillColor;
    return width >= canvas.width * 0.08 && height <= 6 && isSaturatedNonNeutralColor(color);
  }).sort((a, b) => a.y - b.y);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const left = lines[i].x < lines[j].x ? lines[i] : lines[j];
      const right = left === lines[i] ? lines[j] : lines[i];
      if (Math.abs(left.y - right.y) > 10) continue;
      const gapStart = left.x + left.width;
      const gapEnd = right.x;
      if (gapEnd - gapStart < canvas.width * 0.08 || gapEnd - gapStart > canvas.width * 0.35) continue;
      pairs.push({ y: (left.y + right.y) / 2, x0: gapStart, x1: gapEnd });
    }
  }
  const regions = [];
  const used = new Set();
  for (let i = 0; i < pairs.length; i++) {
    if (used.has(i)) continue;
    let mate = -1;
    for (let j = i + 1; j < pairs.length; j++) {
      if (used.has(j)) continue;
      const overlap = Math.max(0, Math.min(pairs[i].x1, pairs[j].x1) - Math.max(pairs[i].x0, pairs[j].x0));
      if (overlap > Math.min(pairs[i].x1 - pairs[i].x0, pairs[j].x1 - pairs[j].x0) * 0.55 &&
          Math.abs(pairs[i].y - pairs[j].y) >= 30 && Math.abs(pairs[i].y - pairs[j].y) <= canvas.height * 0.30) {
        mate = j;
        break;
      }
    }
    if (mate < 0) continue;
    used.add(i); used.add(mate);
    const x0 = Math.min(pairs[i].x0, pairs[mate].x0) - 12;
    const x1 = Math.max(pairs[i].x1, pairs[mate].x1) + 12;
    const y0 = Math.min(pairs[i].y, pairs[mate].y) - 70;
    const y1 = Math.max(pairs[i].y, pairs[mate].y) + 70;
    regions.push({ ...padRegionToCanvas({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, canvas, 2), kind: 'leaderLineChartBackdrop', preserveText: true });
  }
  return regions;
}

function findLeaderLineChartRegionsFromCanvas(canvas) {
  if (!canvas?.width || !canvas?.height) return [];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = canvasPixelSnapshot(canvas)?.data;
  if (!pixels) return [];
  const greenAt = (x, y) => {
    const offset = (y * canvas.width + x) * 4;
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2], a = pixels[offset + 3];
    return a > 180 && g > 105 && g > r * 1.35 && g > b * 1.18;
  };
  const gaps = [];
  for (let y = 0; y < canvas.height; y += 2) {
    const runs = [];
    let start = -1;
    for (let x = 0; x < canvas.width; x += 2) {
      if (greenAt(x, y)) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (x - start >= canvas.width * 0.045) runs.push({ x0: start, x1: x });
        start = -1;
      }
    }
    if (start >= 0 && canvas.width - start >= canvas.width * 0.045) runs.push({ x0: start, x1: canvas.width });
    for (let i = 0; i < runs.length - 1; i++) {
      const gap = runs[i + 1].x0 - runs[i].x1;
      if (gap >= canvas.width * 0.07 && gap <= canvas.width * 0.38) gaps.push({ y, x0: runs[i].x1, x1: runs[i + 1].x0 });
    }
  }
  const rows = [];
  for (const gap of gaps) {
    const existing = rows.find(row => Math.abs(row.y - gap.y) <= 8 && Math.abs(row.x0 - gap.x0) <= 30 && Math.abs(row.x1 - gap.x1) <= 30);
    if (existing) {
      existing.samples++;
      existing.y = (existing.y * (existing.samples - 1) + gap.y) / existing.samples;
    } else rows.push({ ...gap, samples: 1 });
  }
  const regions = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const dy = Math.abs(rows[i].y - rows[j].y);
      const overlap = Math.max(0, Math.min(rows[i].x1, rows[j].x1) - Math.max(rows[i].x0, rows[j].x0));
      if (dy < 35 || dy > canvas.height * 0.32 || overlap < Math.min(rows[i].x1 - rows[i].x0, rows[j].x1 - rows[j].x0) * 0.45) continue;
      const x0 = Math.min(rows[i].x0, rows[j].x0) - 65;
      const x1 = Math.max(rows[i].x1, rows[j].x1) + 65;
      const y0 = Math.min(rows[i].y, rows[j].y) - 70;
      const y1 = Math.max(rows[i].y, rows[j].y) + 70;
      const region = { ...padRegionToCanvas({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, canvas, 2), kind: 'leaderLineChartBackdrop', preserveText: true };
      if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, Math.min(existing.width * existing.height, region.width * region.height)) > 0.72)) regions.push(region);
    }
  }
  return regions;
}

function findLargeRadialCanvasRegions(canvas) {
  if (!canvas?.width || !canvas?.height) return [];
  const step = 4;
  const cols = Math.ceil(canvas.width / step);
  const rows = Math.ceil(canvas.height / step);
  const data = canvasPixelSnapshot(canvas)?.data;
  if (!data) return [];
  const dark = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const x = Math.min(canvas.width - 1, gx * step), y = Math.min(canvas.height - 1, gy * step);
    const offset = (y * canvas.width + x) * 4;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    if (Math.max(r, g, b) < 185 && Math.max(r, g, b) - Math.min(r, g, b) < 38) dark[gy * cols + gx] = 1;
  }
  const seen = new Uint8Array(dark.length);
  const regions = [];
  const diagnostics = [];
  for (let seed = 0; seed < dark.length; seed++) {
    if (!dark[seed] || seen[seed]) continue;
    const queue = [seed]; seen[seed] = 1;
    let count = 0, minX = cols, maxX = 0, minY = rows, maxY = 0;
    while (queue.length) {
      const index = queue.pop();
      const x = index % cols, y = Math.floor(index / cols);
      count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const next of [index - 1, index + 1, index - cols, index + cols]) {
        if (next < 0 || next >= dark.length || seen[next] || !dark[next]) continue;
        const nx = next % cols;
        if (Math.abs(nx - x) > 1) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    const width = (maxX - minX + 1) * step, height = (maxY - minY + 1) * step;
    const aspect = width / Math.max(1, height);
    if (count < 260 || width < canvas.width * 0.10 || height < canvas.height * 0.10 || aspect < 0.38 || aspect > 2.25) continue;
    // A connected component spanning most of the page is usually display text
    // joined to a page background, not a pie or donut chart.
    if (width > canvas.width * 0.72 || height > canvas.height * 0.78 || width * height > canvas.width * canvas.height * 0.55) continue;
    const size = Math.max(width, height) + 60;
    const cx = (minX + maxX + 1) * step / 2, cy = (minY + maxY + 1) * step / 2;
    let centerLum = 0, centerSamples = 0, centerDark = 0;
    const radius = Math.max(8, Math.floor(Math.min(width, height) * 0.12));
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(canvas.height - 1, Math.ceil(cy + radius)); y += 3) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(canvas.width - 1, Math.ceil(cx + radius)); x += 3) {
        const offset = (y * canvas.width + x) * 4;
        centerLum += (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if ((data[offset] + data[offset + 1] + data[offset + 2]) / 3 < 178) centerDark++;
        centerSamples++;
      }
    }
    const centerAverage = centerSamples ? centerLum / centerSamples : 0;
    const centerDarkRatio = centerSamples ? centerDark / centerSamples : 1;
    // Donut centres often contain a short editable value label. Allow that
    // limited centre ink and let the circumference test reject large glyphs.
    if (!centerSamples || centerAverage < 190 || centerDarkRatio > 0.28) {
      diagnostics.push({ count, width, height, aspect, cx, cy, centerAverage, centerDarkRatio, rejected: 'center' });
      continue;
    }
    let ringHits = 0;
    const ringRadius = Math.min(width, height) * 0.40;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(cx + Math.cos(angle) * ringRadius)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(cy + Math.sin(angle) * ringRadius)));
      const offset = (y * canvas.width + x) * 4;
      const lum = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (lum < 220) ringHits++;
    }
    // Large display glyphs can resemble a radial component by bounds alone.
    // A true pie/donut has ink around most of its circumference and a light centre.
    if (ringHits < 17) {
      diagnostics.push({ count, width, height, aspect, cx, cy, centerAverage, centerDarkRatio, ringHits, rejected: 'ring' });
      continue;
    }
    diagnostics.push({ count, width, height, aspect, cx, cy, centerAverage, centerDarkRatio, ringHits, accepted: true });
    const region = { ...padRegionToCanvas({ x: cx - size / 2, y: cy - size / 2, width: size, height: size }, canvas, 2), kind: 'radialChartBackdrop', preserveText: true };
    if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, Math.min(existing.width * existing.height, region.width * region.height)) > 0.7)) regions.push(region);
  }
  if (window.__PDFOMNI_DEBUG_LAYOUT && diagnostics.length) {
    console.info('pdfomni-radial-canvas-components', JSON.stringify(diagnostics));
  }
  return regions;
}

function findBracketedRadialChartRegions(vectorObjs, canvas) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs)) return [];
  const colorOf = vector => vector?.strokeColor || vector?.color || vector?.fillColor;
  const verticals = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    return height >= canvas.height * 0.07 && width <= 5 && isSaturatedNonNeutralColor(colorOf(vector));
  });
  const horizontals = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    return width >= canvas.width * 0.055 && height <= 5 && isSaturatedNonNeutralColor(colorOf(vector));
  });
  const regions = [];
  for (let i = 0; i < verticals.length; i++) {
    for (let j = i + 1; j < verticals.length; j++) {
      const left = verticals[i].x < verticals[j].x ? verticals[i] : verticals[j];
      const right = left === verticals[i] ? verticals[j] : verticals[i];
      const gap = right.x - left.x;
      if (gap < canvas.width * 0.07 || gap > canvas.width * 0.18) continue;
      const attached = horizontals.filter(line =>
        Math.abs((line.x + line.width) - left.x) <= 16 || Math.abs(line.x - right.x) <= 16 ||
        Math.abs((line.x + line.width) - right.x) <= 16 || Math.abs(line.x - left.x) <= 16
      );
      if (attached.length < 2) continue;
      const diameter = gap * 2;
      const centerX = (left.x + right.x) / 2;
      const upperBottom = Math.max(left.y + left.height, right.y + right.height);
      const lowerTopCandidates = verticals
        .filter(line => Math.abs(line.x - left.x) <= 8 || Math.abs(line.x - right.x) <= 8)
        .filter(line => line.y > upperBottom + 24)
        .map(line => line.y);
      const centerY = lowerTopCandidates.length
        ? (upperBottom + Math.min(...lowerTopCandidates)) / 2
        : (Math.min(left.y, right.y) + Math.max(left.y + left.height, right.y + right.height)) / 2 + diameter * 0.25;
      const region = {
        ...padRegionToCanvas({ x: centerX - diameter / 2, y: centerY - diameter / 2, width: diameter, height: diameter }, canvas, 14),
        kind: 'radialChartBackdrop',
        preserveText: true
      };
      if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, region.width * region.height) > 0.65)) regions.push(region);
    }
  }
  return regions;
}

function findLightTextPanelBackdropRegions(vectorObjs, textObjs, canvas) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs) || !Array.isArray(textObjs)) return [];
  const snapshot = canvasPixelSnapshot(canvas);
  if (!snapshot) return [];
  const textBoxes = textObjs.flatMap(textObjectVisualBoxes);
  const sampleColor = (x, y) => {
    const sx = Math.max(0, Math.min(canvas.width - 3, Math.round(x) - 1));
    const sy = Math.max(0, Math.min(canvas.height - 3, Math.round(y) - 1));
    const color = [0, 0, 0];
    for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
      const offset = ((sy + yy) * snapshot.width + sx + xx) * 4;
      color[0] += snapshot.data[offset];
      color[1] += snapshot.data[offset + 1];
      color[2] += snapshot.data[offset + 2];
    }
    return color.map(channel => Math.round(channel / 9));
  };
  const luminance = color => (color[0] + color[1] + color[2]) / 3;
  const regions = [];
  for (const vector of vectorObjs) {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const area = width * height;
    const fillLum = colorLuminance(vector?.fillColor || vector?.color || '#ffffff');
    if (vector?.kind !== 'path' || vector?.fill === false || !Number.isFinite(fillLum) || fillLum < 240) continue;
    if (width < canvas.width * 0.10 || width > canvas.width * 0.34 || height < canvas.height * 0.14 || height > canvas.height * 0.48) continue;
    if (area < canvas.width * canvas.height * 0.018) continue;

    const insideText = textBoxes.filter(box => rectIntersectionArea(box, vector) / Math.max(1, box.width * box.height) >= 0.72);
    if (insideText.length < 2) continue;

    const panelColor = sampleColor(vector.x + width / 2, vector.y + height / 2);
    const centerLum = luminance(panelColor);
    let graphicSamples = 0;
    let sampled = 0;
    for (let gy = 1; gy < 20; gy++) {
      for (let gx = 1; gx < 24; gx++) {
        const color = sampleColor(vector.x + width * gx / 24, vector.y + height * gy / 20);
        const distance = Math.sqrt(
          (color[0] - panelColor[0]) ** 2 +
          (color[1] - panelColor[1]) ** 2 +
          (color[2] - panelColor[2]) ** 2
        );
        sampled++;
        if (distance > 48 && luminance(color) < 220) graphicSamples++;
      }
    }
    // Text-only cards contain sparse dark strokes. A chart/photo panel has a
    // sustained non-background interior and must retain its original vectors.
    if (graphicSamples / Math.max(1, sampled) > 0.12) continue;
    const outsideSamples = [
      [vector.x - 7, vector.y + height / 2],
      [vector.x + width + 7, vector.y + height / 2],
      [vector.x + width / 2, vector.y - 7],
      [vector.x + width / 2, vector.y + height + 7]
    ].filter(([x, y]) => x >= 1 && y >= 1 && x < canvas.width - 1 && y < canvas.height - 1)
      .map(([x, y]) => luminance(sampleColor(x, y)));
    if (!outsideSamples.length || centerLum - Math.min(...outsideSamples) < 3) continue;

    const region = {
      ...padRegionToCanvas(vector, canvas, 4),
      kind: 'lightTextPanel',
      preserveText: true,
      syntheticPanel: true,
      panelInset: 4,
      panelRadius: Math.min(width, height) * 0.055,
      panelColor
    };
    if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, Math.min(existing.width * existing.height, region.width * region.height)) > 0.75)) {
      regions.push(region);
    }
  }
  return regions;
}

function findFramedContentPanelRegions(vectorObjs, textObjs, imageObjs, canvas) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs)) return [];
  const pageArea = canvas.width * canvas.height;
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  const imageBoxes = (imageObjs || []).map(image => image?.data?._originalBox || image);
  const candidates = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const area = width * height;
    const aspect = width / Math.max(1, height);
    const fillColor = vector?.fillColor || vector?.color;
    const fillLum = colorLuminance(fillColor);
    const rgb = parseHexColor(fillColor);
    const spread = rgb ? Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) : 255;
    if (vector?.fill === false || !['path', 'roundRect', 'fillRect'].includes(vector?.kind)) return false;
    if (!Number.isFinite(fillLum) || fillLum < 35 || spread > 34) return false;
    if (area < pageArea * 0.025 || area > pageArea * 0.24) return false;
    if (width < canvas.width * 0.085 || width > canvas.width * 0.34) return false;
    if (height < canvas.height * 0.20 || height > canvas.height * 0.78) return false;
    return aspect >= 0.16 && aspect <= 1.18;
  });

  return candidates.map(candidate => {
    const insideText = textBoxes.filter(box =>
      rectIntersectionArea(box, candidate) / Math.max(1, Number(box.width || 0) * Number(box.height || 0)) >= 0.68
    );
    const imageOverlap = imageBoxes.some(image =>
      rectIntersectionArea(image, candidate) / Math.max(1, Number(image.width || 0) * Number(image.height || 0)) >= 0.42
    );
    if (insideText.length < 2 && !imageOverlap) return null;
    return {
      ...padRegionToCanvas(candidate, canvas, 4),
      kind: 'framedContentPanel',
      preserveText: true
    };
  }).filter(Boolean).filter((candidate, index, all) => !all.slice(0, index).some(existing =>
    rectIntersectionArea(existing, candidate) / Math.max(1, candidate.width * candidate.height) >= 0.88
  ));
}

function expandStructuredRegionsToContainingBackdrops(regions, vectorObjs, textObjs, canvas) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(regions) || !Array.isArray(vectorObjs)) return regions || [];
  const pageArea = canvas.width * canvas.height;
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  const backdrops = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const area = width * height;
    const fillLum = colorLuminance(vector?.fillColor || vector?.color);
    return vector?.fill !== false && ['path', 'roundRect', 'fillRect'].includes(vector?.kind) &&
      Number.isFinite(fillLum) && fillLum >= 180 &&
      area >= pageArea * 0.025 && area <= pageArea * 0.48 &&
      width >= canvas.width * 0.12 && height >= canvas.height * 0.16;
  });

  return regions.map(region => {
    if (region?.kind !== 'structuredBackdrop') return region;
    const regionArea = Math.max(1, Number(region.width || 0) * Number(region.height || 0));
    const enclosing = backdrops.filter(backdrop => {
      const backdropArea = Math.max(1, Number(backdrop.width || 0) * Number(backdrop.height || 0));
      if (backdropArea < regionArea * 1.05 || backdropArea > regionArea * 5.5) return false;
      if (rectIntersectionArea(region, backdrop) / regionArea < 0.78) return false;
      const insideText = textBoxes.filter(box =>
        rectIntersectionArea(box, backdrop) / Math.max(1, Number(box.width || 0) * Number(box.height || 0)) >= 0.65
      );
      return insideText.length >= 2;
    }).sort((left, right) => left.width * left.height - right.width * right.height)[0];
    if (!enclosing) return region;
    return {
      ...region,
      ...padRegionToCanvas(enclosing, canvas, 2),
      preserveText: true,
      foreground: region.foreground === true
    };
  });
}

function detectSolidPageBackground(canvas) {
  if (!canvas?.width || !canvas?.height) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const insetX = Math.max(2, Math.round(canvas.width * 0.008));
  const insetY = Math.max(2, Math.round(canvas.height * 0.008));
  const samples = [
    [insetX, insetY], [canvas.width - insetX - 1, insetY],
    [insetX, canvas.height - insetY - 1], [canvas.width - insetX - 1, canvas.height - insetY - 1],
    [Math.round(canvas.width / 2), insetY], [Math.round(canvas.width / 2), canvas.height - insetY - 1]
  ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
  const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  let best = null;
  for (const sample of samples) {
    const matches = samples.filter(candidate => distance(sample, candidate) <= 24);
    if (!best || matches.length > best.matches.length) best = { color: sample, matches };
  }
  if (!best || best.matches.length < 4) return null;
  const color = best.matches.reduce((sum, sample) => sum.map((value, index) => value + sample[index]), [0, 0, 0])
    .map(value => Math.round(value / best.matches.length));
  if (color.every(channel => channel >= 248)) return null;
  return color;
}

function findRadialChartBackdropRegions(symbolRegions, canvas) {
  if (!canvas?.width || !Array.isArray(symbolRegions) || symbolRegions.length < 4) return [];
  const symbols = symbolRegions.slice().sort((a, b) => a.y - b.y);
  const rows = [];
  for (const symbol of symbols) {
    const cy = symbol.y + symbol.height / 2;
    let row = rows.find(candidate => Math.abs(candidate.cy - cy) <= canvas.height * 0.26);
    if (!row) {
      row = { cy, items: [] };
      rows.push(row);
    }
    row.items.push(symbol);
    row.cy = row.items.reduce((sum, item) => sum + item.y + item.height / 2, 0) / row.items.length;
  }
  const regions = [];
  for (const row of rows.filter(candidate => candidate.items.length >= 4)) {
    const sorted = row.items.slice().sort((a, b) => a.x - b.x);
    const midpoint = canvas.width / 2;
    const left = sorted.filter(item => item.x + item.width / 2 < midpoint);
    const right = sorted.filter(item => item.x + item.width / 2 >= midpoint);
    if (left.length < 2 || right.length < 2) continue;
    const x0 = Math.max(...left.map(item => item.x + item.width)) - 8;
    const x1 = Math.min(...right.map(item => item.x)) + 8;
    const y0 = Math.min(...sorted.map(item => item.y)) - 36;
    const y1 = Math.max(...sorted.map(item => item.y + item.height)) + 36;
    if (x1 - x0 < canvas.width * 0.10) continue;
    regions.push({ ...padRegionToCanvas({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, canvas, 3), kind: 'radialChartBackdrop', preserveText: true });
  }

  // Radial charts are often placed wholly within one page column. Infer their
  // local centre from two distant icon-anchor columns instead of assuming the
  // chart straddles the page midpoint.
  const columns = [];
  for (const symbol of symbols) {
    const cx = Number(symbol.x || 0) + Number(symbol.width || 0) / 2;
    let column = columns.find(candidate => Math.abs(candidate.cx - cx) <= 34);
    if (!column) {
      column = { cx, items: [] };
      columns.push(column);
    }
    column.items.push(symbol);
    column.cx = column.items.reduce((sum, item) => sum + Number(item.x || 0) + Number(item.width || 0) / 2, 0) / column.items.length;
  }
  for (let leftIndex = 0; leftIndex < columns.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < columns.length; rightIndex++) {
      const left = columns[leftIndex].cx < columns[rightIndex].cx ? columns[leftIndex] : columns[rightIndex];
      const right = left === columns[leftIndex] ? columns[rightIndex] : columns[leftIndex];
      const gap = right.cx - left.cx;
      if (gap < canvas.width * 0.20 || gap > canvas.width * 0.38) continue;
      if (columns.some(candidate => candidate !== left && candidate !== right && candidate.cx > left.cx + 40 && candidate.cx < right.cx - 40)) continue;
      const anchored = [...left.items, ...right.items]
        .map(item => ({ ...item, cy: Number(item.y || 0) + Number(item.height || 0) / 2 }))
        .sort((a, b) => a.cy - b.cy);
      const verticalGroups = [];
      for (const item of anchored) {
        const previous = verticalGroups[verticalGroups.length - 1];
        if (!previous || item.cy - previous.maxY > canvas.height * 0.22) {
          verticalGroups.push({ items: [item], minY: item.cy, maxY: item.cy });
        } else {
          previous.items.push(item);
          previous.minY = Math.min(previous.minY, item.cy);
          previous.maxY = Math.max(previous.maxY, item.cy);
        }
      }
      for (const group of verticalGroups) {
        const leftCount = group.items.filter(item => Math.abs(item.x + item.width / 2 - left.cx) <= 40).length;
        const rightCount = group.items.filter(item => Math.abs(item.x + item.width / 2 - right.cx) <= 40).length;
        if (group.items.length < 3 || !leftCount || !rightCount) continue;
        const size = Math.max(gap * 0.76, group.maxY - group.minY + 96);
        const region = {
          ...padRegionToCanvas({
            x: (left.cx + right.cx) / 2 - size / 2,
            y: (group.minY + group.maxY) / 2 - size / 2,
            width: size,
            height: size
          }, canvas, 4),
          kind: 'radialChartBackdrop',
          preserveText: true
        };
        if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, Math.min(existing.width * existing.height, region.width * region.height)) > 0.68)) {
          regions.push(region);
        }
      }
    }
  }
  return regions;
}

function findTableRuleBackdropRegions(vectorObjs, textObjs, canvas) {
  if (!canvas?.width || !Array.isArray(vectorObjs)) return [];
  const rules = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    return vector?.kind === 'line' || (Math.max(width, height) >= 18 && Math.min(width, height) <= 4);
  });
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  const seen = new Set();
  const regions = [];
  for (const seed of rules) {
    if (seen.has(seed)) continue;
    const members = [seed];
    seen.add(seed);
    let bounds = unionRects(members);
    let changed = true;
    while (changed) {
      changed = false;
      const connectivityPad = Math.max(7, Math.min(18, Math.min(canvas.width, canvas.height) * 0.012));
      const expanded = padRegionToCanvas(bounds, canvas, connectivityPad);
      for (const rule of rules) {
        if (seen.has(rule) || rectIntersectionArea(expanded, rule) <= 0) continue;
        members.push(rule);
        seen.add(rule);
        bounds = unionRects(members);
        changed = true;
      }
    }
    if (members.length < 6 || !bounds) continue;
    const horizontal = members.filter(rule => Number(rule.width || 0) > Number(rule.height || 0) * 4).length;
    const vertical = members.filter(rule => Number(rule.height || 0) > Number(rule.width || 0) * 4).length;
    if (horizontal < 2 || vertical < 2 || bounds.width < canvas.width * 0.08 || bounds.height < canvas.height * 0.08) continue;
    const region = padRegionToCanvas(bounds, canvas, 4);
    const containedText = textBoxes.filter(box => rectIntersectionArea(region, box) > 0).length;
    if (containedText < 5 || region.width * region.height > canvas.width * canvas.height * 0.55) continue;
    regions.push({ ...region, kind: 'structuredBackdrop', preserveText: true });
  }
  return regions;
}

function findDocumentPanelBackdropRegions(imageObjs, textObjs, canvas) {
  if (!canvas?.width || !Array.isArray(imageObjs)) return [];
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  return imageObjs.map(image => image?.data?._originalBox || image).filter(box => {
    const width = Number(box?.width || 0);
    const height = Number(box?.height || 0);
    if (width < canvas.width * 0.14 || height < canvas.height * 0.35) return false;
    if (width * height > canvas.width * canvas.height * 0.45) return false;
    return textBoxes.filter(textBox => rectIntersectionArea(box, textBox) > 0).length >= 12;
  }).map(box => ({ ...padRegionToCanvas(box, canvas, 2), kind: 'structuredBackdrop', preserveText: true }));
}

function findDenseTinyDocumentColumns(textObjs, canvas) {
  if (!canvas?.width) return [];
  const boxes = (textObjs || []).flatMap(obj => {
    const size = Number(obj?.data?.fontSize || obj?.data?._originalStyle?.fontSize || 0);
    return textObjectVisualBoxes(obj).map(box => ({ ...box, fontSize: size }));
  }).filter(box => box.y > canvas.height * 0.22 && box.fontSize > 0 && box.fontSize <= 11);
  const columns = [[], [], []];
  for (const box of boxes) {
    const center = box.x + box.width / 2;
    columns[Math.max(0, Math.min(2, Math.floor(center / (canvas.width / 3))))].push(box);
  }
  return columns.filter(column => column.length >= 18).map(column => {
    const bounds = unionRects(column);
    if (!bounds || bounds.height < canvas.height * 0.34 || bounds.width > canvas.width * 0.39) return null;
    const third = canvas.width / 3;
    const center = bounds.x + bounds.width / 2;
    const index = Math.max(0, Math.min(2, Math.floor(center / third)));
    const region = {
      x: index * third + canvas.width * 0.025,
      y: Math.max(canvas.height * 0.22, bounds.y - 12),
      width: third - canvas.width * 0.05,
      height: Math.min(canvas.height, bounds.y + bounds.height + 12) - Math.max(canvas.height * 0.22, bounds.y - 12)
    };
    return { ...region, kind: 'structuredBackdrop', preserveText: true };
  }).filter(Boolean);
}

function findCorruptDocumentPanelRegions(textObjs, canvas) {
  return findDenseTinyDocumentColumns(textObjs, canvas).filter(region => {
    const lines = (textObjs || []).flatMap(obj => {
      const boxes = Array.isArray(obj?.data?._lineBoxes) && obj.data._lineBoxes.length ? obj.data._lineBoxes : [obj];
      const content = Array.isArray(obj?.data?.lines) ? obj.data.lines : [];
      return boxes.map((box, index) => ({
        box,
        text: Array.isArray(content[index]) ? content[index].map(run => String(run?.text || '')).join('') : String(obj?.data?.content || '')
      }));
    }).filter(line => rectIntersectionArea(region, line.box) > 0);
    const corrupt = lines.filter(line => looksLikeCorruptExtractedText(line.text)).length;
    return corrupt >= 3 && corrupt / Math.max(1, lines.length) >= 0.06;
  }).map(region => {
    const third = canvas.width / 3;
    const index = Math.max(0, Math.min(2, Math.floor((region.x + region.width / 2) / third)));
    return {
      x: index * third + canvas.width * 0.008,
      y: canvas.height * 0.245,
      width: third - canvas.width * 0.016,
      height: canvas.height * 0.72,
      kind: 'corruptTextPanel',
      foreground: true,
      preserveText: false
    };
  });
}

function dedupeRasterRegions(regions) {
  return (regions || []).filter((region, index, all) => !all.slice(0, index).some(existing => {
    const overlap = rectIntersectionArea(existing, region);
    const existingArea = Math.max(1, existing.width * existing.height);
    const regionArea = Math.max(1, region.width * region.height);
    const sizeRatio = Math.max(existingArea, regionArea) / Math.min(existingArea, regionArea);
    return sizeRatio <= 4 && overlap / Math.min(existingArea, regionArea) > 0.86;
  }));
}

function findCompoundCircularArtworkRegions(vectorObjs, textObjs, canvas) {
  if (!Array.isArray(vectorObjs) || !canvas?.width || !canvas?.height) return [];
  const pageArea = canvas.width * canvas.height;
  const minDiameter = Math.min(canvas.width, canvas.height) * 0.09;
  const parseColor = value => {
    const color = String(value || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(color)) return null;
    const number = parseInt(color, 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  };
  const paleCircularParents = vectorObjs.filter(vector => {
    const width = Number(vector?.width || 0);
    const height = Number(vector?.height || 0);
    const aspect = width / Math.max(1, height);
    const rgb = parseColor(vector?.fillColor || vector?.color);
    if (!rgb) return false;
    const luminance = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const spread = Math.max(...rgb) - Math.min(...rgb);
    return vector?.kind === 'path' && vector?.fill !== false &&
      width >= minDiameter && height >= minDiameter &&
      width <= canvas.width * 0.42 && height <= canvas.height * 0.46 &&
      aspect >= 0.78 && aspect <= 1.28 &&
      luminance >= 220 && spread <= 20;
  }).map(vector => ({
    x: Number(vector.x || 0),
    y: Number(vector.y || 0),
    width: Number(vector.width || 0),
    height: Number(vector.height || 0)
  })).sort((left, right) => right.width * right.height - left.width * left.height)
    .filter((candidate, index, all) => !all.slice(0, index).some(existing =>
      rectIntersectionArea(existing, candidate) / Math.max(1, candidate.width * candidate.height) >= 0.82
    ));
  if (paleCircularParents.length < 3) return [];

  const pending = paleCircularParents.map(parent => ({ ...parent }));
  const clusters = [];
  while (pending.length) {
    const members = [pending.shift()];
    let bounds = { ...members[0] };
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index--) {
        const candidate = pending[index];
        const expanded = padRegionToCanvas(bounds, canvas, Math.max(18, minDiameter * 0.12));
        const yOverlap = Math.max(0, Math.min(bounds.y + bounds.height, candidate.y + candidate.height) - Math.max(bounds.y, candidate.y));
        if (rectIntersectionArea(expanded, candidate) <= 0 ||
            yOverlap < Math.min(bounds.height, candidate.height) * 0.28) continue;
        members.push(candidate);
        bounds = unionRects([bounds, candidate]);
        pending.splice(index, 1);
        changed = true;
      }
    }
    if (members.length >= 3) clusters.push({ members, bounds });
  }

  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  return clusters.map(cluster => {
    const region = padRegionToCanvas(cluster.bounds, canvas, 10);
    const regionArea = region.width * region.height;
    const containedVectors = vectorObjs.filter(vector => {
      const cx = Number(vector?.x || 0) + Number(vector?.width || 0) / 2;
      const cy = Number(vector?.y || 0) + Number(vector?.height || 0) / 2;
      return cx >= region.x && cx <= region.x + region.width &&
        cy >= region.y && cy <= region.y + region.height;
    });
    const proseLines = textBoxes.filter(box => {
      const overlap = rectIntersectionArea(region, box) / Math.max(1, Number(box.width || 0) * Number(box.height || 0));
      return overlap >= 0.6 && looksLikeBodyProseText(String(box.text || ''));
    });
    if (regionArea < pageArea * 0.035 || regionArea > pageArea * 0.34 ||
        containedVectors.length < 20 || proseLines.length > 2) return null;
    return {
      ...region,
      kind: 'compoundCircularArtwork',
      preserveText: true,
      foreground: true
    };
  }).filter(Boolean);
}

function mergeConnectedChartBackdropRegions(regions, canvas) {
  const chartKinds = new Set(['radialChartBackdrop', 'leaderLineChartBackdrop']);
  const others = (regions || []).filter(region => !chartKinds.has(region?.kind));
  const pending = (regions || []).filter(region => chartKinds.has(region?.kind)).map(region => ({ ...region }));
  const merged = [];
  while (pending.length) {
    let current = pending.shift();
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index--) {
        const candidate = pending[index];
        const expanded = padRegionToCanvas(current, canvas, 28);
        const close = rectIntersectionArea(expanded, candidate) > 0;
        const xOverlap = Math.max(0, Math.min(current.x + current.width, candidate.x + candidate.width) - Math.max(current.x, candidate.x));
        const yOverlap = Math.max(0, Math.min(current.y + current.height, candidate.y + candidate.height) - Math.max(current.y, candidate.y));
        const aligned = xOverlap >= Math.min(current.width, candidate.width) * 0.16 ||
          yOverlap >= Math.min(current.height, candidate.height) * 0.16;
        if (!close || !aligned) continue;
        current = {
          ...padRegionToCanvas(unionRects([current, candidate]), canvas, 8),
          kind: 'radialChartBackdrop',
          preserveText: true
        };
        pending.splice(index, 1);
        changed = true;
      }
    }
    if (current.kind === 'radialChartBackdrop') {
      const padX = Math.max(28, current.width * 0.28);
      const padTop = Math.max(36, current.height * 0.24);
      const padBottom = Math.max(18, current.height * 0.12);
      current = {
        ...padRegionToCanvas({
          x: current.x - padX,
          y: current.y - padTop,
          width: current.width + padX * 2,
          height: current.height + padTop + padBottom
        }, canvas, 0),
        kind: 'radialChartBackdrop',
        preserveText: true,
        foreground: true
      };
    }
    merged.push(current);
  }
  return [...others, ...merged];
}

function isPageScaleBackdropOverProse(region, textObjs, canvas) {
  if (region?.kind !== 'radialChartBackdrop' || !canvas?.width || !canvas?.height) return false;
  const pageArea = canvas.width * canvas.height;
  const regionArea = Math.max(0, Number(region.width || 0) * Number(region.height || 0));
  if (regionArea < pageArea * 0.42) return false;
  const proseLines = (textObjs || []).flatMap(obj => {
    const boxes = obj?.data?._lineBoxes?.length ? obj.data._lineBoxes : [obj?.data?._originalBox || obj];
    return boxes.map((box, index) => ({
      box,
      text: (obj?.data?.lines?.[index] || []).map(run => run?.text || '').join('').replace(/\s+/g, ' ').trim()
    }));
  }).filter(({ box, text }) =>
    text.length >= 24 &&
    rectIntersectionArea(box, region) / Math.max(1, Number(box?.width || 0) * Number(box?.height || 0)) >= 0.6
  );
  return proseLines.length >= 12;
}

function findDenseMicroVectorRegions(vectorObjs, textObjs, canvas, imageObjs = []) {
  if (!canvas?.width || !canvas?.height || !Array.isArray(vectorObjs)) return [];
  const textBoxes = (textObjs || []).flatMap(textObjectVisualBoxes);
  const imageBoxes = (imageObjs || [])
    .map(image => image?.data?._originalBox || image)
    .filter(box => Number(box?.width) > 1 && Number(box?.height) > 1);
  const microVectors = vectorObjs.filter(vector => {
    const width = Math.max(0, Number(vector?.width || 0));
    const height = Math.max(0, Number(vector?.height || 0));
    return width > 0 && height > 0 && width <= 20 && height <= 20;
  });
  const regions = [];
  const seen = new Set();
  const growBy = 24;
  const boundsFor = vector => ({
    x: Number(vector.x || 0),
    y: Number(vector.y || 0),
    width: Math.max(0, Number(vector.width || 0)),
    height: Math.max(0, Number(vector.height || 0))
  });
  const mergeBounds = (left, right) => {
    const x = Math.min(left.x, right.x);
    const y = Math.min(left.y, right.y);
    return {
      x,
      y,
      width: Math.max(left.x + left.width, right.x + right.width) - x,
      height: Math.max(left.y + left.height, right.y + right.height) - y
    };
  };
  const isNear = (bounds, candidate) => {
    const expanded = {
      x: bounds.x - growBy,
      y: bounds.y - growBy,
      width: bounds.width + growBy * 2,
      height: bounds.height + growBy * 2
    };
    return rectIntersectionArea(expanded, candidate) > 0;
  };

  for (const seed of microVectors) {
    if (seen.has(seed)) continue;
    const members = [seed];
    seen.add(seed);
    let bounds = boundsFor(seed);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of microVectors) {
        if (seen.has(candidate) || !isNear(bounds, boundsFor(candidate))) continue;
        seen.add(candidate);
        members.push(candidate);
        bounds = mergeBounds(bounds, boundsFor(candidate));
        changed = true;
      }
    }
    if (members.length < 8 || bounds.width < 8 || bounds.height < 8 || bounds.width > 150 || bounds.height > 150) continue;
    const pad = Math.max(4, Math.min(bounds.width, bounds.height) * 0.18);
    const region = {
      x: Math.max(0, bounds.x - pad),
      y: Math.max(0, bounds.y - pad),
      width: Math.min(canvas.width, bounds.x + bounds.width + pad) - Math.max(0, bounds.x - pad),
      height: Math.min(canvas.height, bounds.y + bounds.height + pad) - Math.max(0, bounds.y - pad),
      kind: 'microVectorSymbol',
      foreground: true
    };
    if (textBoxes.some(box => rectIntersectionArea(region, box) / Math.max(1, box.width * box.height) > 0.12)) continue;
    if (imageBoxes.some(box => rectIntersectionArea(region, box) / Math.max(1, region.width * region.height) > 0.65)) continue;
    if (!regions.some(existing => rectIntersectionArea(existing, region) / Math.max(1, region.width * region.height) > 0.7)) {
      regions.push(region);
    }
  }
  return regions;
}

function filterPageVisibleVectors(vectorObjs, canvas, imageObjs = []) {
  if (!Array.isArray(vectorObjs) || !canvas?.width || !canvas?.height) return vectorObjs || [];
  const pageW = canvas.width;
  const pageH = canvas.height;
  const snapshot = canvasPixelSnapshot(canvas);
  const pageArea = pageW * pageH;
  const pad = Math.max(24, Math.max(pageW, pageH) * 0.08);
  const imageBoxes = (imageObjs || [])
    .map(image => image?.data?._originalBox || image)
    .filter(box => Number(box?.width) > 1 && Number(box?.height) > 1);
  const overlapArea = (a, b) => {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  };
  const vectorFillLuminance = vector => {
    const color = String(vector?.fillColor || vector?.color || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(color)) return 255;
    const n = parseInt(color, 16);
    return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
  };
  const rectHasNonLightPixels = rect => {
    if (!snapshot) return false;
    const sx = Math.max(0, Math.floor(rect.x - 3));
    const sy = Math.max(0, Math.floor(rect.y - 3));
    const ex = Math.min(pageW, Math.ceil(rect.x + rect.width + 3));
    const ey = Math.min(pageH, Math.ceil(rect.y + rect.height + 3));
    const w = Math.max(1, ex - sx);
    const h = Math.max(1, ey - sy);
    const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 900)));
    let count = 0;
    let nonLight = 0;
    for (let yy = 0; yy < h; yy += stride) {
      for (let xx = 0; xx < w; xx += stride) {
        const i = ((sy + yy) * snapshot.width + sx + xx) * 4;
        if (snapshot.data[i + 3] < 32) continue;
        const r = snapshot.data[i], g = snapshot.data[i + 1], b = snapshot.data[i + 2];
        const lum = (r + g + b) / 3;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        count++;
        if (lum < 232 || sat > 34) nonLight++;
      }
    }
    return count > 0 && nonLight / count > 0.055;
  };
  const colorToRgb = value => {
    const color = String(value || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(color)) return null;
    const n = parseInt(color, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const isPaleNeutralVector = vector => {
    const isFilled = vector?.fill !== false && vector?.kind !== 'line';
    const rgb = colorToRgb(isFilled
      ? (vector?.fillColor || vector?.color)
      : (vector?.strokeColor || vector?.color));
    if (!rgb) return false;
    const luminance = (rgb.r + rgb.g + rgb.b) / 3;
    const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
    return luminance > 175 && chroma < 48;
  };
  const lightVectorAppearsInRender = vector => {
    const isFilled = vector?.fill !== false && vector?.kind !== 'line';
    const target = colorToRgb(isFilled
      ? (vector?.fillColor || vector?.color)
      : (vector?.strokeColor || vector?.color));
    if (!target || !snapshot) return true;
    const samples = [];
    const addSample = (px, py) => {
      if (Number.isFinite(px + py) && px >= 0 && px < pageW && py >= 0 && py < pageH) {
        samples.push({ x: px, y: py });
      }
    };
    if (vector?.kind === 'line' || !isFilled) {
      const x1 = Number(vector?.x1 ?? vector?.x ?? 0);
      const y1 = Number(vector?.y1 ?? vector?.y ?? 0);
      const x2 = Number(vector?.x2 ?? (Number(vector?.x || 0) + Number(vector?.width || 0)));
      const y2 = Number(vector?.y2 ?? (Number(vector?.y || 0) + Number(vector?.height || 0)));
      const length = Math.hypot(x2 - x1, y2 - y1);
      const count = Math.max(4, Math.min(28, Math.ceil(length / Math.max(2, Number(vector?.thickness || 1)))));
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        addSample(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      }
      for (const point of vector?.points || []) addSample(point.x, point.y);
    } else {
      const pathPoints = [
        ...(Array.isArray(vector?.contours) ? vector.contours.flat() : []),
        ...(Array.isArray(vector?.points) ? vector.points : [])
      ].filter(point => Number.isFinite(Number(point?.x) + Number(point?.y)));
      // A complex filled path can span a large bounding box while only covering
      // thin decorative strokes. Sampling its box mistakes unrelated white page
      // content for that artwork; sample its actual outline instead.
      if (pathPoints.length > 6) {
        const stride = Math.max(1, Math.floor(pathPoints.length / 56));
        for (let index = 0; index < pathPoints.length; index += stride) {
          addSample(Number(pathPoints[index].x), Number(pathPoints[index].y));
        }
      } else {
      const x = Number(vector?.x || 0);
      const y = Number(vector?.y || 0);
      const width = Math.max(1, Number(vector?.width || 0));
      const height = Math.max(1, Number(vector?.height || 0));
      const columns = Math.max(2, Math.min(10, Math.ceil(width / 16)));
      const rows = Math.max(2, Math.min(10, Math.ceil(height / 16)));
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          addSample(x + ((column + 0.5) / columns) * width, y + ((row + 0.5) / rows) * height);
        }
      }
      }
    }
    if (!samples.length) return false;
    let matches = 0;
    for (const sample of samples) {
      const radius = Math.max(1, Math.min(3, Math.round(Number(vector?.thickness || 1))));
      let matched = false;
      for (let yy = -radius; yy <= radius && !matched; yy++) {
        for (let xx = -radius; xx <= radius; xx++) {
          const px = Math.round(sample.x + xx);
          const py = Math.round(sample.y + yy);
          if (px < 0 || py < 0 || px >= pageW || py >= pageH) continue;
          const offset = (py * snapshot.width + px) * 4;
          const distance = Math.abs(snapshot.data[offset] - target.r) +
            Math.abs(snapshot.data[offset + 1] - target.g) +
            Math.abs(snapshot.data[offset + 2] - target.b);
          if (snapshot.data[offset + 3] > 32 && distance <= 72) {
            matched = true;
            break;
          }
        }
      }
      if (matched) matches++;
    }
    return matches / samples.length >= (isFilled ? 0.08 : 0.16);
  };
  return vectorObjs.filter(vector => {
    const x = Number(vector?.x || 0);
    const y = Number(vector?.y || 0);
    const width = Math.max(0, Number(vector?.width || 0));
    const height = Math.max(0, Number(vector?.height || 0));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return false;
    if (width <= 0 && height <= 0) return false;
    const intersectsPage = x + width >= -pad && x <= pageW + pad && y + height >= -pad && y <= pageH + pad;
    if (!intersectsPage) return false;
    const area = width * height;
    const box = { x, y, width, height };
    const plausiblePageFill = vector?.fill !== false &&
      (vector?.kind === 'path' || vector?.kind === 'roundRect' || vector?.kind === 'fillRect') &&
      area > pageArea * 0.72 &&
      width <= pageW * 1.12 &&
      height <= pageH * 1.12 &&
      vectorFillLuminance(vector) < 253;
    if (plausiblePageFill) return true;
    const fillRgb = colorToRgb(vector?.fillColor || vector?.color);
    const wideChromaticBand = vector?.fill !== false &&
      width >= pageW * 0.72 &&
      height >= pageH * 0.015 &&
      area >= pageArea * 0.025 &&
      fillRgb &&
      Math.max(fillRgb.r, fillRgb.g, fillRgb.b) - Math.min(fillRgb.r, fillRgb.g, fillRgb.b) >= 10 &&
      vectorFillLuminance(vector) < 250;
    if (wideChromaticBand) return true;
    const wildlyUnclipped = width > pageW * 1.45 || height > pageH * 1.45 || width * height > pageArea * 0.72;
    if (wildlyUnclipped) return false;
    const lightArtwork = isPaleNeutralVector(vector);
    // The image crop is rendered from the original page canvas, so it already
    // contains its own pale card/background. Keeping a matching VML fill above
    // it hides the photo in Word because VML is layered over the image run.
    if (lightArtwork && vector?.fill !== false && area > 4 && imageBoxes.some(image => {
      const covered = overlapArea(box, image) / Math.max(1, area);
      const imageArea = Math.max(1, image.width * image.height);
      return covered >= 0.88 && area <= imageArea * 1.18;
    })) return false;
    if (lightArtwork && area < pageArea * 0.18) {
      const hasContainedVectorDetail = vectorObjs.some(detail => {
        if (detail === vector) return false;
        const detailArea = Math.max(1, Number(detail?.width || 0) * Number(detail?.height || 0));
        return detailArea < Math.max(64, area * 0.45) &&
          rectIntersectionArea(box, detail) / detailArea >= 0.72;
      });
      if (!lightVectorAppearsInRender(vector) && !hasContainedVectorDetail) return false;
      const borderLum = colorLuminance(_sampleCanvasBorderColor(canvas, { x, y, width, height }));
      if (!hasContainedVectorDetail && borderLum != null && borderLum > 238 && !rectHasNonLightPixels({ x, y, width, height }) && Math.abs(vectorFillLuminance(vector) - borderLum) < 18) {
        return false;
      }
    }
    return true;
  });
}

function isMostlyInsideAnyRegion(box, regions, threshold = 0.55) {
  if (!box || !regions?.length) return false;
  const area = Math.max(1, (box.width || 0) * (box.height || 0));
  return regions.some(region => rectIntersectionArea(box, region) / area >= threshold);
}

function textObjectVisualBoxes(obj) {
  const d = obj?.data || {};
  const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
  return boxes.map(box => ({
    x: box.x ?? obj.x,
    y: box.y ?? obj.y,
    width: box.width ?? obj.width,
    height: box.height ?? obj.height,
    rotation: box.rotation ?? obj.rotation ?? d._originalBox?.rotation ?? 0
  })).filter(box => Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0);
}

function sampleRenderedTextColor(fullCanvas, graphicsCanvas, box, scaleRatio) {
  if (!fullCanvas?.width || !graphicsCanvas?.width || !box ||
      fullCanvas.width !== graphicsCanvas.width || fullCanvas.height !== graphicsCanvas.height) return null;
  box = textBoxVisualBounds(box);
  const ratio = Math.max(0.01, Number(scaleRatio || 1));
  const pad = Math.max(1, Math.min(5, Number(box.height || 0) * 0.12));
  const x0 = Math.max(0, Math.floor((Number(box.x || 0) - pad) * ratio));
  const y0 = Math.max(0, Math.floor((Number(box.y || 0) - pad) * ratio));
  const x1 = Math.min(fullCanvas.width, Math.ceil((Number(box.x || 0) + Number(box.width || 0) + pad) * ratio));
  const y1 = Math.min(fullCanvas.height, Math.ceil((Number(box.y || 0) + Number(box.height || 0) + pad) * ratio));
  if (x1 <= x0 || y1 <= y0) return null;

  const fullSnapshot = canvasPixelSnapshot(fullCanvas);
  const graphicsSnapshot = canvasPixelSnapshot(graphicsCanvas);
  if (!fullSnapshot?.data || !graphicsSnapshot?.data) return null;
  const full = fullSnapshot.data;
  const graphics = graphicsSnapshot.data;

  const area = (x1 - x0) * (y1 - y0);
  const step = Math.max(1, Math.floor(Math.sqrt(area / 5000)));
  const buckets = new Map();
  let changed = 0;
  let totalWeight = 0;
  for (let y = 0; y < y1 - y0; y += step) {
    for (let x = 0; x < x1 - x0; x += step) {
      const offset = ((y0 + y) * fullSnapshot.width + x0 + x) * 4;
      const delta = Math.max(
        Math.abs(full[offset] - graphics[offset]),
        Math.abs(full[offset + 1] - graphics[offset + 1]),
        Math.abs(full[offset + 2] - graphics[offset + 2])
      );
      if (delta < 18 || full[offset + 3] < 80) continue;
      const r = full[offset];
      const g = full[offset + 1];
      const b = full[offset + 2];
      const weight = delta * delta;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const bucket = buckets.get(key) || { count: 0, weight: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.weight += weight;
      bucket.r += r * weight;
      bucket.g += g * weight;
      bucket.b += b * weight;
      buckets.set(key, bucket);
      changed++;
      totalWeight += weight;
    }
  }
  if (changed < 2 || !totalWeight) return null;
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.weight > best.weight) best = bucket;
  }
  if (!best || best.weight / totalWeight < 0.16) return null;
  let r = Math.round(best.r / best.weight);
  let g = Math.round(best.g / best.weight);
  let b = Math.round(best.b / best.weight);
  if (Math.min(r, g, b) >= 246 && Math.max(r, g, b) - Math.min(r, g, b) <= 12) r = g = b = 255;
  if (Math.max(r, g, b) <= 12) r = g = b = 0;
  return {
    color: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
    confidence: best.weight / totalWeight,
    changed
  };
}

function reconcileTextColorsFromRenderDelta(textObjs, fullCanvas, graphicsCanvas, scaleRatio) {
  if (!Array.isArray(textObjs) || !textObjs.length || !graphicsCanvas?._pdfomniGraphicsOnly) return textObjs || [];
  return textObjs.map(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
    let changed = false;
    const repairedLines = lines.map((line, lineIndex) => {
      const visibleRuns = (line || []).filter(run => String(run?.text || '').trim());
      const uniformLine = new Set(visibleRuns.map(run => String(run?.color || data.color || '#000000').toLowerCase())).size <= 1;
      return (line || []).map(run => {
        if (!String(run?.text || '').trim()) return run;
        const rotation = Number(boxes[lineIndex]?.rotation ?? obj.rotation ?? data._originalBox?.rotation ?? 0) || 0;
        const normalizedRotation = normalizeDegrees(rotation);
        // Render-delta sampling works on axis-aligned source-run bounds. For
        // rotated text those bounds do not share the same origin after the
        // transform, so sampling them can pick up adjacent black body text
        // and overwrite an otherwise correct extracted foreground color.
        if (Math.min(normalizedRotation, 360 - normalizedRotation) > 3) return run;
        const box = hasSourceTextGeometry(run) ? {
          x: Number(run._sourceX),
          y: Number(run._sourceY),
          width: Number(run._sourceWidth),
          height: Math.max(1, Number(run._sourceHeight || run.fontSize || 0) * 1.28)
        } : (visibleRuns.length === 1 || uniformLine
          ? { ...(boxes[lineIndex] || boxes[0]), rotation: 0 }
          : null);
        if (!box) return run;
        const sampled = sampleRenderedTextColor(fullCanvas, graphicsCanvas, box, scaleRatio);
        if (!sampled?.color || colorDistanceFromCanvasBackground(sampled.color, run.color || data.color || '#000000') < 24) return run;
        changed = true;
        return { ...run, color: sampled.color };
      });
    });
    if (!changed) return obj;
    const firstColor = repairedLines.flat().find(run => String(run?.text || '').trim())?.color || data.color;
    return {
      ...obj,
      data: {
        ...data,
        color: firstColor,
        lines: repairedLines,
        _originalStyle: data._originalStyle ? { ...data._originalStyle, color: firstColor } : data._originalStyle
      }
    };
  });
}

function suppressInvisiblePdfTextOverlays(textObjs, fullCanvas, graphicsCanvas, scaleRatio, preciseRuns = true) {
  if (!Array.isArray(textObjs) || !textObjs.length ||
      !fullCanvas?.width || !fullCanvas?.height ||
      !graphicsCanvas?._pdfomniGraphicsOnly ||
      graphicsCanvas.width !== fullCanvas.width || graphicsCanvas.height !== fullCanvas.height) {
    return textObjs || [];
  }

  // Compare the ordinary page render with the same PDF operator list rendered
  // with text made invisible. Visible PDF text leaves a clear pixel delta;
  // hidden OCR/search text placed over a scanned or image-baked document does
  // not. Work at the normal analysis resolution to keep this page-wide test
  // cheap while retaining enough pixels for even small certificate text.
  const ratio = Math.max(0.01, Number(scaleRatio || 1));
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = Math.max(1, Math.round(fullCanvas.width / ratio));
  diffCanvas.height = Math.max(1, Math.round(fullCanvas.height / ratio));
  const diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true });
  diffCtx.drawImage(fullCanvas, 0, 0, diffCanvas.width, diffCanvas.height);
  diffCtx.globalCompositeOperation = 'difference';
  diffCtx.drawImage(graphicsCanvas, 0, 0, diffCanvas.width, diffCanvas.height);
  diffCtx.globalCompositeOperation = 'source-over';

  let diff;
  try {
    diff = diffCtx.getImageData(0, 0, diffCanvas.width, diffCanvas.height).data;
  } catch {
    diffCanvas.width = 0;
    diffCanvas.height = 0;
    return textObjs;
  }

  const lineIsVisible = box => {
    if (!box) return true;
    const rotation = normalizeDegrees(Number(box.rotation || 0));
    const theta = rotation * Math.PI / 180;
    const rotated = Math.min(rotation, 360 - rotation) > 3;
    const width = rotated
      ? Math.abs(Number(box.width || 0) * Math.cos(theta)) + Math.abs(Number(box.height || 0) * Math.sin(theta))
      : Number(box.width || 0);
    const height = rotated
      ? Math.abs(Number(box.width || 0) * Math.sin(theta)) + Math.abs(Number(box.height || 0) * Math.cos(theta))
      : Number(box.height || 0);
    const pad = Math.max(1, Math.min(4, Number(box.height || 0) * 0.12));
    const x0 = Math.max(0, Math.floor(Number(box.x || 0) - pad));
    const y0 = Math.max(0, Math.floor(Number(box.y || 0) - pad));
    const x1 = Math.min(diffCanvas.width, Math.ceil(Number(box.x || 0) + width + pad));
    const y1 = Math.min(diffCanvas.height, Math.ceil(Number(box.y || 0) + height + pad));
    if (x1 <= x0 || y1 <= y0) return true;

    const area = (x1 - x0) * (y1 - y0);
    const step = Math.max(1, Math.floor(Math.sqrt(area / 5000)));
    let samples = 0;
    let changed = 0;
    let energy = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const offset = (y * diffCanvas.width + x) * 4;
        const delta = Math.max(diff[offset], diff[offset + 1], diff[offset + 2]);
        if (delta >= 10) changed++;
        energy += delta;
        samples++;
      }
    }
    if (!samples) return true;
    // A genuine glyph changes a meaningful share of its tight source box, even
    // at small sizes. PDF clipping and antialias noise can leave a few changed
    // pixels behind, so treating any two pixels as visible leaks clipped Form
    // XObject text into the editable Word layer.
    const meanEnergy = energy / samples;
    return preciseRuns
      ? changed > Math.max(3, samples * 0.05) || meanEnergy > 6
      : changed > Math.max(2, samples * 0.0008) || meanEnergy > 0.35;
  };

  const sourceRunBox = (run, lineBox, obj, data) => ({
    x: Number(run._sourceX),
    y: Number(run._sourceY),
    width: Number(run._sourceWidth),
    height: Math.max(1, Number(run._sourceHeight || run.fontSize || lineBox?.height || 0)),
    rotation: lineBox?.rotation ?? obj?.rotation ?? data?._originalBox?.rotation ?? 0
  });
  const runVisibility = new WeakMap();
  const runIsVisible = (run, box) => {
    if (runVisibility.has(run)) return runVisibility.get(run);
    const visible = lineIsVisible(box);
    runVisibility.set(run, visible);
    return visible;
  };
  const visibleSourceRuns = [];
  for (const obj of preciseRuns ? textObjs : []) {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length
      ? data._lineBoxes
      : [data._originalBox || obj];
    lines.forEach((line, index) => {
      const lineBox = boxes[index] || boxes[boxes.length - 1] || obj;
      for (const run of line || []) {
        if (!String(run?.text || '').trim() || !hasSourceTextGeometry(run)) continue;
        const box = sourceRunBox(run, lineBox, obj, data);
        if (runIsVisible(run, box)) visibleSourceRuns.push({ run, box });
      }
    });
  }
  const hiddenBehindLargerVisibleText = (run, box) => {
    const area = Math.max(1, box.width * box.height);
    return visibleSourceRuns.some(candidate => {
      if (candidate.run === run || candidate.box.height < box.height * 1.55) return false;
      return rectIntersectionArea(box, candidate.box) / area >= 0.55;
    });
  };

  const filtered = textObjs.flatMap(obj => {
    const data = obj?.data || {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length
      ? data._lineBoxes
      : [data._originalBox || obj];
    if (!lines.length || !boxes.length) return lineIsVisible(boxes[0]) ? [obj] : [];

    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];
    let removedRun = false;
    lines.forEach((line, index) => {
      const box = boxes[index] || boxes[boxes.length - 1] || obj;
      const positionedRuns = (line || []).filter(run =>
        String(run?.text || '').trim() && hasSourceTextGeometry(run));
      let keptLine = line;
      if (preciseRuns && positionedRuns.length) {
        const visibleRuns = new Set(positionedRuns.filter(run => {
          const runBox = sourceRunBox(run, box, obj, data);
          if (/^[-\u2013\u2014]$/.test(String(run?.text || '').trim())) return true;
          return runIsVisible(run, runBox) && !hiddenBehindLargerVisibleText(run, runBox);
        }));
        if (!visibleRuns.size) return;
        if (visibleRuns.size < positionedRuns.length) {
          keptLine = (line || []).filter(run =>
            !String(run?.text || '').trim() || !hasSourceTextGeometry(run) || visibleRuns.has(run));
          removedRun = true;
        }
      } else if (!lineIsVisible(box)) {
        return;
      }
      keptLines.push(keptLine);
      keptBoxes.push(box);
      if (Array.isArray(data._lineAligns)) keptAligns.push(data._lineAligns[index]);
    });
    if (keptLines.length === lines.length && !removedRun) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...data,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(data._lineAligns) ? keptAligns : data._lineAligns
      }
    }];
  });

  diffCanvas.width = 0;
  diffCanvas.height = 0;
  return filtered;
}

function restoreFullRenderOutsideEditableText(graphicsCanvas, fullCanvas, textObjs, scaleRatio) {
  if (!graphicsCanvas?._pdfomniGraphicsOnly || !fullCanvas?.width || !fullCanvas?.height ||
      graphicsCanvas.width !== fullCanvas.width || graphicsCanvas.height !== fullCanvas.height) return;
  const cleanCanvas = document.createElement('canvas');
  cleanCanvas.width = graphicsCanvas.width;
  cleanCanvas.height = graphicsCanvas.height;
  const cleanCtx = cleanCanvas.getContext('2d');
  cleanCtx.drawImage(graphicsCanvas, 0, 0);
  const ctx = graphicsCanvas.getContext('2d');
  ctx.drawImage(fullCanvas, 0, 0);

  for (const obj of textObjs || []) {
    for (const sourceBox of textObjectVisualBoxes(obj)) {
      const rotation = normalizeDegrees(Number(sourceBox.rotation || 0));
      const rotated = Math.min(rotation, 360 - rotation) > 3;
      let box = sourceBox;
      if (rotated) {
        const theta = rotation * Math.PI / 180;
        const width = Math.abs(sourceBox.width * Math.cos(theta)) + Math.abs(sourceBox.height * Math.sin(theta));
        const height = Math.abs(sourceBox.width * Math.sin(theta)) + Math.abs(sourceBox.height * Math.cos(theta));
        box = {
          x: sourceBox.x,
          y: sourceBox.y,
          width,
          height
        };
      }
      const pad = Math.max(1, Math.min(5, Number(sourceBox.height || 0) * 0.14));
      const sx = Math.max(0, Math.floor((box.x - pad) * scaleRatio));
      const sy = Math.max(0, Math.floor((box.y - pad) * scaleRatio));
      const right = Math.min(graphicsCanvas.width, Math.ceil((box.x + box.width + pad) * scaleRatio));
      const bottom = Math.min(graphicsCanvas.height, Math.ceil((box.y + box.height + pad) * scaleRatio));
      const sw = right - sx;
      const sh = bottom - sy;
      if (sw > 0 && sh > 0) ctx.drawImage(cleanCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
    }
  }
  cleanCanvas.width = 0;
  cleanCanvas.height = 0;
}

function textObjectFontPt(obj) {
  const d = obj?.data || {};
  return Math.max(
    0,
    Number(d.fontSize || 0) / RENDER_SCALE || 0,
    ...((d.lines || []).flat().map(run => Number(run?.fontSize || 0)).filter(Number.isFinite))
  );
}

function filterUnboundedGlyphArtifacts(textObjs, canvas) {
  if (!Array.isArray(textObjs) || !textObjs.length || !canvas?.width || !canvas?.height) return textObjs || [];
  const pageHeightPt = canvas.height / RENDER_SCALE;
  const fontLimitPt = Math.max(108, pageHeightPt * 0.18);
  const frameLimitPt = pageHeightPt * 0.55;
  const broadFontLimitPt = Math.max(72, pageHeightPt * 0.12);
  const broadFrameLimitPt = pageHeightPt * 0.24;

  return textObjs.flatMap(obj => {
    const d = obj?.data || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.length) return [obj];
    const lineBoxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length
      ? d._lineBoxes
      : lines.map(() => ({ x: obj.x, y: obj.y, width: obj.width, height: obj.height }));
    let changed = false;
    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];

    lines.forEach((line, index) => {
      const box = lineBoxes[index] || lineBoxes[lineBoxes.length - 1] || obj;
      const boxHeightPt = Number(box?.height || obj?.height || 0) / RENDER_SCALE;
      const retained = (line || []).filter(run => {
        const text = trimPositionedRunText(run?.text);
        const fontPt = Number(run?.fontSize || d.fontSize / RENDER_SCALE || 0);
        const isUnboundedGlyph = text.length <= 12 && (
          (fontPt >= fontLimitPt && boxHeightPt >= frameLimitPt) ||
          (fontPt >= broadFontLimitPt && boxHeightPt >= broadFrameLimitPt)
        );
        if (isUnboundedGlyph) changed = true;
        return !isUnboundedGlyph;
      });
      if (!retained.length) return;
      keptLines.push(retained);
      keptBoxes.push(box);
      if (Array.isArray(d._lineAligns)) keptAligns.push(d._lineAligns[index]);
    });

    if (!changed) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...d,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(d._lineAligns) ? keptAligns : d._lineAligns
      }
    }];
  });
}

function suppressImageBackedTextOverlays(textObjs, imageObjs, canvas) {
  if (!Array.isArray(textObjs) || !textObjs.length || !Array.isArray(imageObjs) || !imageObjs.length || !canvas?.width) {
    return textObjs || [];
  }
  const pageArea = canvas.width * canvas.height;
  const regions = imageObjs
    .map(img => img?.data?._originalBox || img)
    .filter(box => box?.width > canvas.width * 0.12 && box?.height > canvas.height * 0.10 && box.width * box.height > pageArea * 0.018)
    .map(box => ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      photographic: canvasRegionLooksPhotographic(canvas, box)
    }));
  if (!regions.length) return textObjs;

  const suppressRegions = regions.filter(region => {
    if (region.photographic && region.width * region.height < pageArea * 0.65) return false;
    const inside = [];
    for (const obj of textObjs) {
      for (const box of textObjectVisualBoxes(obj)) {
        const area = Math.max(1, box.width * box.height);
        if (rectIntersectionArea(box, region) / area >= 0.82) inside.push({ obj, box });
      }
    }
    if (inside.length < 12) return false;
    const fonts = inside
      .map(item => textObjectFontPt(item.obj))
      .filter(size => Number.isFinite(size) && size > 0)
      .sort((a, b) => a - b);
    const medianFont = fonts.length ? fonts[Math.floor(fonts.length / 2)] : 0;
    const textArea = inside.reduce((sum, item) => sum + Math.max(1, item.box.width * item.box.height), 0);
    const density = textArea / Math.max(1, region.width * region.height);
    return inside.length >= 24 || medianFont <= 8.5 || density > 0.025;
  });
  if (!suppressRegions.length) return textObjs;

  return textObjs.flatMap(obj => {
    const d = obj?.data || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
    if (!lines.length || !boxes.length) return [obj];
    const keptLines = [];
    const keptBoxes = [];
    const keptAligns = [];
    lines.forEach((line, index) => {
      const box = boxes[index] || boxes[boxes.length - 1] || obj;
      const area = Math.max(1, box.width * box.height);
      const inDenseImageOverlay = suppressRegions.some(region =>
        rectIntersectionArea(box, region) / area >= 0.82);
      if (inDenseImageOverlay) return;
      keptLines.push(line);
      keptBoxes.push(box);
      if (Array.isArray(d._lineAligns)) keptAligns.push(d._lineAligns[index]);
    });
    if (keptLines.length === lines.length) return [obj];
    if (!keptLines.length) return [];
    return [{
      ...obj,
      data: {
        ...d,
        content: keptLines.map(line => line.map(run => String(run?.text || '')).join('')).join('\n'),
        lines: keptLines,
        _lineBoxes: keptBoxes,
        _lineAligns: Array.isArray(d._lineAligns) ? keptAligns : d._lineAligns
      }
    }];
  });
}

function isCaptionLikeText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return /^(fig(?:ure)?\.?|table)\s+\d+[A-Za-z]?\s*[:.]/i.test(value);
}

function trimFigureRegionsAroundCaptions(regions, textObjs) {
  if (!Array.isArray(regions) || !regions.length || !Array.isArray(textObjs) || !textObjs.length) return regions || [];
  const textEntries = textObjs.map(obj => ({
    obj,
    fontPt: textObjectFontPt(obj),
    boxes: textObjectVisualBoxes(obj)
  })).filter(entry => entry.boxes.length);
  return regions.map(region => {
    const captionBoxes = [];
    const preserveTextBoxes = [];
    for (const entry of textEntries) {
      const obj = entry.obj;
      if (!isCaptionLikeText(obj?.data?.content)) continue;
      const captionFontPt = entry.fontPt;
      if (captionFontPt < 7.5) continue;
      for (const box of entry.boxes) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const horizontallyNear = centerX >= region.x - region.width * 0.08 &&
          centerX <= region.x + region.width * 1.08;
        const lowerPart = centerY >= region.y + region.height * 0.64 &&
          centerY <= region.y + region.height + Math.max(16, box.height * 2);
        if (horizontallyNear && lowerPart && rectIntersectionArea(region, box) > 0) {
          captionBoxes.push(box);
          const lineHeight = Math.max(box.height, captionFontPt * RENDER_SCALE * 1.4);
          const minFontPt = Math.max(7, captionFontPt * 0.72);
          const captionLeft = box.x;
          const captionY = box.y;
          for (const candidate of textEntries) {
            if (candidate.fontPt < minFontPt || candidate.fontPt > captionFontPt * 1.35) continue;
            for (const candidateBox of candidate.boxes) {
              const sameLine = Math.abs(candidateBox.y - captionY) <= lineHeight * 0.35;
              const continuationLine = candidateBox.y > captionY &&
                candidateBox.y <= captionY + lineHeight * 5.5 &&
                Math.abs(candidateBox.x - captionLeft) <= lineHeight * 2.2;
              const sameLineContinuation = sameLine &&
                candidateBox.x >= captionLeft - lineHeight * 0.8 &&
                candidateBox.x <= region.x + region.width + lineHeight * 1.8;
              if (continuationLine || sameLineContinuation) preserveTextBoxes.push(candidateBox);
            }
          }
        }
      }
    }
    if (!captionBoxes.length) return region;
    const captionTop = Math.min(...captionBoxes.map(box => box.y));
    const newHeight = Math.max(1, captionTop - region.y - 2);
    if (newHeight < region.height * 0.35) return region;
    const preserveBottom = preserveTextBoxes.length
      ? Math.max(...preserveTextBoxes.map(box => box.y + box.height))
      : Math.max(...captionBoxes.map(box => box.y + box.height));
    const preservePad = Math.max(
      8,
      ...preserveTextBoxes.map(box => Number(box.height || 0) * 0.85),
      ...captionBoxes.map(box => Number(box.height || 0) * 0.85)
    );
    return {
      ...region,
      height: newHeight,
      _textExclusionRegion: {
        ...region,
        height: Math.max(region.height, preserveBottom + preservePad - region.y)
      },
      _preserveTextBoxes: preserveTextBoxes
    };
  });
}

function isPreservedFigureTextBox(box, region) {
  const preserveBoxes = region?._preserveTextBoxes;
  if (!Array.isArray(preserveBoxes) || !preserveBoxes.length) return false;
  const area = Math.max(1, (box?.width || 0) * (box?.height || 0));
  return preserveBoxes.some(preserve => {
    const maxHeight = Math.max(1, Number(box?.height || 0), Number(preserve?.height || 0));
    const sameBaseline = Math.abs(Number(box?.y || 0) - Number(preserve?.y || 0)) <= maxHeight * 0.38;
    const sameStart = Math.abs(Number(box?.x || 0) - Number(preserve?.x || 0)) <= maxHeight * 0.9;
    return sameBaseline && sameStart && rectIntersectionArea(box, preserve) / area >= 0.35;
  });
}

function shouldDropTextBoxForFigureRegion(box, region) {
  if (!box || !region) return false;
  if (isPreservedFigureTextBox(box, region)) return false;
  const area = Math.max(1, (box.width || 0) * (box.height || 0));
  const coreOverlapRatio = rectIntersectionArea(box, region) / area;
  const boxX = Number(box.x || 0);
  const boxY = Number(box.y || 0);
  const boxW = Number(box.width || 0);
  const boxH = Number(box.height || 0);
  const cy = boxY + boxH / 2;
  const cx = boxX + boxW / 2;
  const verticallyInsideCore = cy >= region.y - 1 && cy <= region.y + region.height + 1;
  const horizontallyAnchoredInCore = (boxX >= region.x - 2 && boxX <= region.x + region.width + 2) ||
    (cx >= region.x - 2 && cx <= region.x + region.width + 2);
  const anchoredInsideCore = verticallyInsideCore && horizontallyAnchoredInCore;
  const exclusion = region._textExclusionRegion || region;
  const exclusionOverlapRatio = rectIntersectionArea(box, exclusion) / area;
  const text = String(box.text || '').replace(/\s+/g, ' ').trim();
  if (text) {
    if (anchoredInsideCore) return true;
    const inTrimmedFigureBand = !!region._textExclusionRegion &&
      !isCaptionLikeText(text) &&
      cy >= region.y + region.height - Math.max(1, boxH * 0.35) &&
      exclusionOverlapRatio >= 0.35;
    if (inTrimmedFigureBand) return true;
    const narrowExpandedFigureLeak = coreOverlapRatio < 0.20 &&
      exclusionOverlapRatio >= 0.40 &&
      boxW <= region.width * 0.58 &&
      boxX >= region.x + region.width * 0.38;
    if (narrowExpandedFigureLeak && !isCaptionLikeText(text)) return true;
    if (isCaptionLikeText(text) && coreOverlapRatio < 0.20) return false;
    if (
      coreOverlapRatio < 0.20 &&
      (looksLikeBodyProseText(text) || looksLikeNaturalLanguageFragmentText(text))
    ) {
      return false;
    }
  }
  return exclusionOverlapRatio >= 0.40;
}

function gridOverlapsMeaningfulImage(grid, imageObjs, canvas) {
  if (!grid || !canvas?.width || !canvas?.height || !Array.isArray(imageObjs)) return false;
  const pageArea = canvas.width * canvas.height;
  const table = { x: grid.x, y: grid.y, width: grid.width, height: grid.height };
  for (const image of imageObjs) {
    const box = image?.data?._originalBox || image;
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const imageArea = box.width * box.height;
    if (imageArea < pageArea * 0.008) continue;
    const left = Math.max(table.x, box.x);
    const top = Math.max(table.y, box.y);
    const right = Math.min(table.x + table.width, box.x + box.width);
    const bottom = Math.min(table.y + table.height, box.y + box.height);
    const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (overlapArea > imageArea * 0.18 || overlapArea > pageArea * 0.012) return true;
  }
  return false;
}

function findGridIndex(lines, center) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (center >= lines[i] - 2 && center <= lines[i + 1] + 2) return i;
  }
  return -1;
}

function normalizeTableText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tableTextOverlapScore(candidate, tableText) {
  const text = normalizeTableText(candidate);
  const haystack = normalizeTableText(tableText);
  if (text.length < 8 || haystack.length < 8) return 0;
  if (haystack.includes(text)) return 1;

  const chunkSize = 18;
  let covered = 0;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    if (chunk.length >= 8 && haystack.includes(chunk)) covered += chunk.length;
  }
  return covered / text.length;
}

function orderTableRunsByVisualPosition(sourceRuns) {
  if (!Array.isArray(sourceRuns) || sourceRuns.length < 2 ||
      !sourceRuns.every(run => Number.isFinite(Number(run?._sourceX)))) return sourceRuns || [];
  const sorted = sourceRuns.slice().sort((a, b) => Number(a._sourceX) - Number(b._sourceX));
  const runs = [];
  let right = null;
  for (const run of sorted) {
    const x = Number(run._sourceX);
    const width = Math.max(0, Number(run._sourceWidth || 0));
    const gap = right == null ? 0 : x - right;
    const previousText = runs.length ? String(runs[runs.length - 1]?.text || '') : '';
    const nextText = String(run?.text || '');
    const fontPt = Math.max(3, Number(run?.fontSize || 0));
    if (gap > Math.max(0.15, fontPt * RENDER_SCALE * 0.02) && previousText && nextText && !/\s$/.test(previousText) && !/^\s/.test(nextText)) {
      runs.push({ ...run, text: ' ' });
    }
    runs.push(run);
    right = Math.max(right ?? x, x + width);
  }
  return runs;
}

function getTextLinesForTable(textObjs, splitPositionedRuns = true) {
  const out = [];
  for (const obj of textObjs || []) {
    const d = obj.data || {};
    const lines = Array.isArray(d.lines) && d.lines.length ? d.lines : [[{
      text: String(d.content || ''),
      fontFamily: d.fontFamily,
      fontSize: Number(d.fontSize || 12) / RENDER_SCALE,
      bold: d.fontWeight === 'bold',
      italic: d.fontStyle === 'italic',
      color: d.color || '#000000'
    }]];
    const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : lines.map((_, i) => ({
      x: obj.x,
      y: obj.y + i * (obj.height / Math.max(1, lines.length)),
      width: obj.width,
      height: obj.height / Math.max(1, lines.length)
    }));
    for (let i = 0; i < lines.length; i++) {
      const runs = orderTableRunsByVisualPosition(lines[i] || []);
      const positionedRuns = runs.length && runs.every(run =>
        [run?._sourceX, run?._sourceY, run?._sourceWidth, run?._sourceHeight]
          .every(value => Number.isFinite(Number(value))) &&
        Number(run._sourceWidth) > 0 && Number(run._sourceHeight) > 0
      );
      const keepPositionedRunsTogether = runs.some(run => !!run?._keepTogetherInWord);
      if (splitPositionedRuns && positionedRuns && !keepPositionedRunsTogether) {
        for (const run of runs) {
          const text = String(run.text ?? '');
          if (!text.trim()) continue;
          out.push({
            obj,
            data: d,
            runs: [run],
            text,
            box: {
              x: Number(run._sourceX),
              y: Number(run._sourceY),
              width: Number(run._sourceWidth),
              height: Number(run._sourceHeight),
              rotation: boxes[i]?.rotation ?? obj.rotation ?? d._originalBox?.rotation ?? 0
            }
          });
        }
        continue;
      }
      const text = runs.map(run => String(run.text ?? '')).join('');
      if (!text.trim()) continue;
      const box = boxes[i] || boxes[boxes.length - 1] || obj;
      out.push({ obj, data: d, runs, text, box });
    }
  }
  return out;
}

function mergeTableCellLineFragments(lines) {
  const clusters = [];
  const sorted = (lines || []).slice().sort((a, b) => {
    const ay = Number(a.box?.y || 0) + Number(a.box?.height || 0) / 2;
    const by = Number(b.box?.y || 0) + Number(b.box?.height || 0) / 2;
    return (ay - by) || (Number(a.box?.x || 0) - Number(b.box?.x || 0));
  });
  for (const line of sorted) {
    const centerY = Number(line.box?.y || 0) + Number(line.box?.height || 0) / 2;
    const height = Math.max(1, Number(line.box?.height || 0));
    const cluster = clusters[clusters.length - 1];
    if (!cluster || Math.abs(centerY - cluster.centerY) > Math.max(2, Math.min(height, cluster.height) * 0.45)) {
      clusters.push({ centerY, height, lines: [line] });
    } else {
      cluster.lines.push(line);
      cluster.centerY = cluster.lines.reduce((sum, item) => sum + Number(item.box?.y || 0) + Number(item.box?.height || 0) / 2, 0) / cluster.lines.length;
      cluster.height = Math.max(cluster.height, height);
    }
  }
  return clusters.map(cluster => {
    const fragments = cluster.lines.sort((a, b) => Number(a.box?.x || 0) - Number(b.box?.x || 0));
    const first = fragments[0];
    const runs = [];
    let right = null;
    for (const fragment of fragments) {
      const fragmentRuns = fragment.runs || [];
      const x = Number(fragment.box?.x || 0);
      const gap = right == null ? 0 : x - right;
      const fontPt = Math.max(3, ...fragmentRuns.map(run => Number(run?._sourceFontSize || run?.fontSize || 0)).filter(Number.isFinite));
      const previousText = runs.length ? String(runs[runs.length - 1]?.text || '') : '';
      const nextText = fragmentRuns.length ? String(fragmentRuns[0]?.text || '') : '';
      if (gap > Math.max(0.15, fontPt * RENDER_SCALE * 0.02) && previousText && nextText && !/\s$/.test(previousText) && !/^\s/.test(nextText)) {
        runs.push({ ...fragmentRuns[0], text: ' ' });
      }
      runs.push(...fragmentRuns);
      right = Math.max(right ?? x, x + Number(fragment.box?.width || 0));
    }
    const minX = Math.min(...fragments.map(item => Number(item.box?.x || 0)));
    const minY = Math.min(...fragments.map(item => Number(item.box?.y || 0)));
    const maxX = Math.max(...fragments.map(item => Number(item.box?.x || 0) + Number(item.box?.width || 0)));
    const maxY = Math.max(...fragments.map(item => Number(item.box?.y || 0) + Number(item.box?.height || 0)));
    const normalizedRuns = markInlineScriptRuns(runs);
    return {
      ...first,
      runs: normalizedRuns,
      text: normalizedRuns.map(run => String(run?.text || '')).join(''),
      box: { ...first.box, x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    };
  });
}

function tableCellLineAlignment(line, cellLeft, cellRight, fallback = 'left') {
  const text = String(line?.text || '').replace(/\s+/g, ' ').trim();
  if (looksLikeBodyProseText(text) || looksLikeNaturalLanguageFragmentText(text)) return 'left';
  const box = line?.box || {};
  const x = Number(box.x || 0);
  const width = Math.max(0, Number(box.width || 0));
  const cellWidth = Math.max(1, cellRight - cellLeft);
  const leftGap = x - cellLeft;
  const rightGap = cellRight - (x + width);
  const fontPt = Math.max(3, ...(line?.runs || []).map(run => Number(run?._sourceFontSize || run?.fontSize || 0)).filter(Number.isFinite));
  const fontPx = fontPt * RENDER_SCALE;
  const centerTolerance = Math.max(fontPx * 0.85, cellWidth * 0.07);
  const edgeTolerance = Math.max(3, fontPx * 0.8);
  if (leftGap > fontPx * 0.35 && rightGap > fontPx * 0.35 &&
      Math.abs(leftGap - rightGap) <= centerTolerance) return 'center';
  if (rightGap <= edgeTolerance && leftGap > edgeTolerance * 1.5) return 'right';
  return fallback === 'center' || fallback === 'right' ? fallback : 'left';
}

function makeGridTablePageChildren(grid, textObjs, alignmentMap, includeOutside = true) {
  const lines = getTextLinesForTable(textObjs);
  const cellLines = Array.from({ length: grid.rowHeights.length }, () =>
    Array.from({ length: grid.columnWidths.length }, () => [])
  );
  const outside = [];

  for (const line of lines) {
    const cx = (line.box.x || 0) + (line.box.width || 0) / 2;
    const cy = (line.box.y || 0) + (line.box.height || 0) / 2;
    const row = findGridIndex(grid.hLines, cy);
    let col = findGridIndex(grid.vLines, cx);
    if (row >= 0 && col >= 0) {
      const owner = grid.cellOwners?.[row]?.[col];
      const ownerRow = owner?.ownerRow ?? row;
      col = owner?.ownerStart ?? col;
      const span = grid.rowSpans?.[ownerRow]?.find(item => col >= item.start && col < item.start + item.span);
      if (span) col = span.start;
      cellLines[ownerRow][col].push(line);
    } else {
      outside.push(line);
    }
  }

  const pageChildren = [];
  const tableText = cellLines.flat(2).map(line => line.text).join(' ');
  const gridLeft = grid.x - 8;
  const gridRight = grid.x + grid.width + 8;
  const gridTop = grid.y - Math.max(24, grid.height * 0.25);
  const gridBottom = grid.y + grid.height + 8;
  const outsideTableText = outside.filter(line => {
    const box = line.box || {};
    const overlapsTableX = (box.x || 0) <= gridRight && ((box.x || 0) + (box.width || 0)) >= gridLeft;
    const nearTableY = (box.y || 0) <= gridBottom && ((box.y || 0) + (box.height || 0)) >= gridTop;
    const duplicateScore = tableTextOverlapScore(line.text, tableText);
    const duplicateTableText = duplicateScore > 0.72 && overlapsTableX && nearTableY;
    return !duplicateTableText;
  });

  outsideTableText.sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  const outsideFrames = outsideTableText.flatMap(line => makeFidelityTextFrames({
    ...line.obj,
    data: {
      ...line.data,
      lines: [line.runs],
      _lineBoxes: [line.box],
      _lineAligns: [line.data.align || 'left']
    }
  }, alignmentMap));

  const tableXPt = grid.x / RENDER_SCALE;
  const tableYPt = grid.y / RENDER_SCALE;

  const border = { style: docx.BorderStyle.SINGLE, size: 4, color: '000000' };
  const rowLayouts = cellLines.map((row, rowIndex) => {
    const spanInfos = grid.rowSpans?.[rowIndex] || row.map((_, start) => ({ start, span: 1 }));
    const continuationInfos = [...new Map((grid.cellOwners?.[rowIndex] || [])
      .filter(owner => owner && Number(owner.ownerRow) < rowIndex)
      .map(owner => [owner.ownerStart, {
        start: owner.ownerStart,
        span: owner.span,
        verticalMergeContinuation: true
      }])).values()];
    const cellInfos = [
      ...spanInfos,
      ...continuationInfos
    ].sort((a, b) => a.start - b.start);
    const forceExactRow = continuationInfos.length > 0;
    const hasWrappedCell = spanInfos.some(spanInfo => {
      const rowSpan = Math.max(1, spanInfo.rowSpan || 1);
      // A vertically merged cell has the combined height of every row it
      // spans. Growing only its first row repeats that available height and
      // pushes the table's bottom edge into following captions/footnotes.
      if (rowSpan > 1) return false;
      const fragments = cellLines
        .slice(rowIndex, rowIndex + rowSpan)
        .flatMap(sourceRow => sourceRow.slice(spanInfo.start, spanInfo.start + Math.max(1, spanInfo.span || 1)).flat());
      return mergeTableCellLineFragments(fragments).length > 1;
    });
    const sourceRowHeightPt = grid.rowHeights[rowIndex] / RENDER_SCALE;
    const rowFontFitScale = spanInfos.reduce((scale, spanInfo) => {
      if (Math.max(1, spanInfo.rowSpan || 1) > 1) return scale;
      const grouped = mergeTableCellLineFragments(cellLines[rowIndex]
        .slice(spanInfo.start, spanInfo.start + Math.max(1, spanInfo.span || 1)).flat());
      if (!grouped.length) return scale;
      const topInsetPt = Math.max(0,
        (Number(grouped[0].box?.y || grid.hLines[rowIndex]) - grid.hLines[rowIndex]) / RENDER_SCALE);
      const lineHeightPt = grouped.reduce((sum, line, lineIndex) => {
        const fontPt = Math.max(3, ...line.runs
          .map(run => Number(run._sourceFontSize || run.fontSize || 0))
          .filter(Number.isFinite));
        const nextLine = grouped[lineIndex + 1];
        const lineHeightPt = nextLine
          ? Math.max(fontPt * 1.22, (Number(nextLine.box?.y || 0) - Number(line.box?.y || 0)) / RENDER_SCALE)
          : fontPt * 1.22;
        return sum + lineHeightPt;
      }, 0) * (grouped.length > 1 ? 1.12 : 1);
      // A PDF line box is tighter than Word's substituted-font metrics. Fit
      // the editable text to the detected row instead of letting Word enlarge
      // the table or clip the last baseline. Keep the source inset and reserve
      // a small bottom clearance for Word's cell glyph leading.
      const availableHeightPt = Math.max(1, sourceRowHeightPt - topInsetPt - 1);
      return Math.min(scale, availableHeightPt / Math.max(1, lineHeightPt));
    }, 1);
    const boundedFontFitScale = Math.min(1, rowFontFitScale);
    const canFitDetectedRow = boundedFontFitScale >= 0.6;
    const allowWordGrowth = hasWrappedCell && !forceExactRow && !canFitDetectedRow;
    return {
      spanInfos,
      cellInfos,
      forceExactRow,
      hasWrappedCell,
      allowWordGrowth,
      fontFitScale: canFitDetectedRow ? boundedFontFitScale : 1
    };
  });
  const rowHeightAdjustmentsPt = new Array(cellLines.length).fill(0);
  rowLayouts.forEach((layout, rowIndex) => {
    if (!layout.forceExactRow || !layout.hasWrappedCell) return;
    const fragments = layout.spanInfos.flatMap(spanInfo => cellLines
      .slice(rowIndex, rowIndex + Math.max(1, spanInfo.rowSpan || 1))
      .flatMap(sourceRow => sourceRow.slice(spanInfo.start, spanInfo.start + Math.max(1, spanInfo.span || 1)).flat()));
    const fontPt = Math.max(3, ...fragments
      .flatMap(fragment => fragment.runs || [])
      .map(run => Number(run._sourceFontSize || run.fontSize || 0))
      .filter(Number.isFinite));
    // Word needs more vertical leading than the PDF glyph boxes report. Give
    // the wrapped header a bounded allowance, then take it only from unused
    // padding in later rows so the table's outer boundary does not move.
    let neededPt = Math.min(4, fontPt * 0.55);
    for (let donorIndex = rowIndex + 1; donorIndex < cellLines.length && neededPt > 0.01; donorIndex++) {
      const donorLayout = rowLayouts[donorIndex];
      if (donorLayout.forceExactRow || donorLayout.hasWrappedCell ||
          donorLayout.spanInfos.some(spanInfo => Math.max(1, spanInfo.rowSpan || 1) > 1)) continue;
      const donorFragments = cellLines[donorIndex].flat().filter(fragment => fragment?.box);
      if (!donorFragments.length) continue;
      const donorHeightPt = grid.rowHeights[donorIndex] / RENDER_SCALE;
      const donorLines = mergeTableCellLineFragments(donorFragments);
      const contentBottomPt = Math.max(...donorLines.map(line => {
        const lineFontPt = Math.max(3, ...line.runs
          .map(run => Number(run._sourceFontSize || run.fontSize || 0))
          .filter(Number.isFinite));
        return (Number(line.box?.y || grid.hLines[donorIndex]) - grid.hLines[donorIndex]) / RENDER_SCALE + lineFontPt * 1.22;
      }));
      const sparePt = Math.max(0, donorHeightPt - contentBottomPt - 0.25);
      const borrowedPt = Math.min(neededPt, sparePt);
      if (borrowedPt <= 0) continue;
      rowHeightAdjustmentsPt[rowIndex] += borrowedPt;
      rowHeightAdjustmentsPt[donorIndex] -= borrowedPt;
      neededPt -= borrowedPt;
    }
  });
  const rows = cellLines.map((row, rowIndex) => {
    const { cellInfos, forceExactRow, hasWrappedCell, allowWordGrowth, fontFitScale } = rowLayouts[rowIndex];
    const adjustedRowHeightPt = grid.rowHeights[rowIndex] / RENDER_SCALE + rowHeightAdjustmentsPt[rowIndex];
    return new docx.TableRow({
      // Simple rows keep the detected grid height. A wrapped row under a
      // vertical merge receives only padding borrowed within this table.
      height: {
        value: pointsToTwips(adjustedRowHeightPt),
        rule: allowWordGrowth ? docx.HeightRule.ATLEAST : docx.HeightRule.EXACT
      },
      tableHeader: rowIndex === 0,
      children: cellInfos.map(spanInfo => {
      const colIndex = spanInfo.start;
      const spanCount = Math.max(1, spanInfo.span || 1);
      if (spanInfo.verticalMergeContinuation) {
        return new docx.TableCell({
          width: {
            size: pointsToTwips(grid.columnWidths.slice(colIndex, colIndex + spanCount).reduce((sum, width) => sum + width, 0) / RENDER_SCALE),
            type: docx.WidthType.DXA
          },
          columnSpan: spanCount > 1 ? spanCount : undefined,
          verticalMerge: docx.VerticalMergeType.CONTINUE,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: [new docx.Paragraph({
            spacing: { before: 0, after: 0, line: 1, lineRule: docx.LineRuleType.EXACT },
            children: [new docx.TextRun({ text: '', size: 2 })]
          })]
        });
      }
      const rowSpan = Math.max(1, spanInfo.rowSpan || 1);
      const grouped = mergeTableCellLineFragments(cellLines
        .slice(rowIndex, rowIndex + rowSpan)
        .flatMap(sourceRow => sourceRow.slice(colIndex, colIndex + spanCount).flat()));
      const rowHeightPt = adjustedRowHeightPt;
      const sourceTopInsetPt = grouped.length
        ? Math.max(0, (Number(grouped[0].box?.y || grid.hLines[rowIndex]) - grid.hLines[rowIndex]) / RENDER_SCALE)
        : 0;
      let lineSpacingsPt = grouped.map((line, lineIndex) => {
        const fontPt = Math.max(3, ...line.runs.map(run => Number(run._sourceFontSize || run.fontSize || 0)).filter(Number.isFinite));
        const nextLine = grouped[lineIndex + 1];
        if (!nextLine) return fontPt * 1.22;
        const sourceLeadPt = (Number(nextLine.box?.y || 0) - Number(line.box?.y || 0)) / RENDER_SCALE;
        return Math.max(fontPt * 1.22, sourceLeadPt);
      }).map(value => value * fontFitScale);
      if (forceExactRow && grouped.length > 1) {
        const totalSpacingPt = lineSpacingsPt.reduce((sum, value) => sum + value, 0);
        // Use the inset that Word will actually receive below. Scaling from
        // the PDF inset plus an extra reserve compressed the line pitch below
        // the font height and clipped the final baseline.
        const availableSpacingPt = Math.max(1, rowHeightPt - 0.5);
        if (totalSpacingPt > availableSpacingPt) {
          const scale = availableSpacingPt / totalSpacingPt;
          lineSpacingsPt = lineSpacingsPt.map(value => value * scale);
        }
      }
      // Exact-height rows beneath a vertically merged cell have no spare
      // height for Word's extra cell-leading. Keeping even the source's tiny
      // top inset can push the final baseline into the bottom border.
      const topInsetPt = forceExactRow && grouped.length > 1
        // Word can enter a repagination loop when an exact-height cell under
        // a vertical merge has a literal zero top margin. A quarter point is
        // visually negligible, keeps the last baseline clear of the border,
        // and avoids that renderer edge case.
        ? 0.25
        : Math.min(sourceTopInsetPt, Math.max(0, rowHeightPt - lineSpacingsPt.reduce((sum, value) => sum + value, 0)));
      const makeLineRuns = line => line.runs.map(run => {
        const sourceFontSize = Number(run._sourceFontSize || run.fontSize || 0);
        const scriptBaseFontSize = Number(run._scriptBaseFontSize || 0);
        return makeDocxTextRun({
          ...run,
          fontFamily: run._docxFontFamily || run.fontFamily,
          fontSize: sourceFontSize > 0 ? sourceFontSize * fontFitScale : undefined,
          _scriptBaseFontSize: scriptBaseFontSize > 0 ? scriptBaseFontSize * fontFitScale : undefined,
          // A substituted Word font can be wider than the embedded PDF font and
          // introduce wrapping that was not present in the source table. Fit each
          // run back to its measured PDF width so the detected row geometry stays
          // valid without clipping text or inflating the table.
          _fitToSourceWidth: true
        }, line.data);
      });
      // Keep a multi-line cell in one Word paragraph. Separate paragraphs add
      // renderer-specific paragraph leading even when their before/after
      // spacing is zero, which can clip the final line or make adjacent lines
      // collide inside a fixed-height PDF table row.
      const children = grouped.length > 1
        ? [new docx.Paragraph({
          spacing: {
            before: 0,
            after: 0,
            line: pointsToTwips(Math.min(...lineSpacingsPt)),
            lineRule: docx.LineRuleType.EXACT
          },
          alignment: alignmentMap[tableCellLineAlignment(
            grouped[0],
            grid.vLines[colIndex],
            grid.vLines[colIndex + spanCount],
            grouped[0].data.align || 'left'
          )] || docx.AlignmentType.LEFT,
          children: grouped.flatMap((line, lineIndex) => [
            ...(lineIndex ? [new docx.TextRun({ break: 1, size: 2 })] : []),
            ...makeLineRuns(line)
          ])
        })]
        : grouped.length ? grouped.map((line, lineIndex) => {
        const sourceAlignment = tableCellLineAlignment(
          line,
          grid.vLines[colIndex],
          grid.vLines[colIndex + spanCount],
          line.data.align || 'left'
        );
        return new docx.Paragraph({
        spacing: {
          before: 0,
          after: 0,
          line: pointsToTwips(lineSpacingsPt[lineIndex]),
          lineRule: docx.LineRuleType.EXACT
        },
        alignment: alignmentMap[sourceAlignment] || docx.AlignmentType.LEFT,
        children: makeLineRuns(line)
        });
      }) : [new docx.Paragraph({ spacing: { before: 0, after: 0 }, children: [new docx.TextRun({ text: '' })] })];
      return new docx.TableCell({
        width: {
          size: pointsToTwips(grid.columnWidths.slice(colIndex, colIndex + spanCount).reduce((sum, width) => sum + width, 0) / RENDER_SCALE),
          type: docx.WidthType.DXA
        },
        columnSpan: spanCount > 1 ? spanCount : undefined,
        verticalMerge: rowSpan > 1 ? docx.VerticalMergeType.RESTART : undefined,
        verticalAlign: docx.VerticalAlign.TOP,
        shading: { type: docx.ShadingType.CLEAR, color: 'auto', fill: grid.rowFills?.[rowIndex] || 'FFFFFF' },
        margins: {
          top: pointsToTwips(topInsetPt),
          bottom: 0,
          left: 72,
          right: 42
        },
        children
      });
      })
    });
  });

  pageChildren.push(new docx.Table({
    width: { size: pointsToTwips(grid.width / RENDER_SCALE), type: docx.WidthType.DXA },
    float: {
      horizontalAnchor: docx.TableAnchorType.PAGE,
      verticalAnchor: docx.TableAnchorType.PAGE,
      absoluteHorizontalPosition: pointsToTwips(tableXPt),
      absoluteVerticalPosition: pointsToTwips(tableYPt),
      leftFromText: 0,
      rightFromText: 0,
      topFromText: 0,
      bottomFromText: 0
    },
    layout: docx.TableLayoutType.FIXED,
    columnWidths: grid.columnWidths.map(width => pointsToTwips(width / RENDER_SCALE)),
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border
    },
    margins: {
      marginUnitType: docx.WidthType.DXA,
      top: 42,
      bottom: 24,
      left: 72,
      right: 42
    },
    rows
  }));
  if (includeOutside) pageChildren.push(...outsideFrames);

  return pageChildren;
}

function makeGridTablesPageChildren(grids, textObjs, alignmentMap) {
  if (!Array.isArray(grids) || !grids.length) return [];
  const children = grids.flatMap(grid => makeGridTablePageChildren(grid, textObjs, alignmentMap, false));
  // Run-level geometry is required inside table cells, but retaining those
  // fragments for ordinary page prose turns one editable line into a row of
  // independently positioned word frames. Keep complete source lines outside
  // the detected grids.
  const lines = getTextLinesForTable(textObjs, false);
  const tableLines = [];
  const outside = [];
  for (const line of lines) {
    const cx = (line.box.x || 0) + (line.box.width || 0) / 2;
    const cy = (line.box.y || 0) + (line.box.height || 0) / 2;
    const inTable = grids.some(grid =>
      findGridIndex(grid.hLines, cy) >= 0 && findGridIndex(grid.vLines, cx) >= 0
    );
    (inTable ? tableLines : outside).push(line);
  }
  const tableText = tableLines.map(line => line.text).join(' ');
  const normalizedTableText = tableText.replace(/\s+/g, ' ').trim().toLowerCase();
  const outsideTableText = outside.filter(line => {
    const box = line.box || {};
    const nearAnyGrid = grids.some(grid => {
      const left = grid.x - 8;
      const right = grid.x + grid.width + 8;
      const top = grid.y - Math.max(24, grid.height * 0.25);
      const bottom = grid.y + grid.height + 8;
      return (box.x || 0) <= right && ((box.x || 0) + (box.width || 0)) >= left &&
        (box.y || 0) <= bottom && ((box.y || 0) + (box.height || 0)) >= top;
    });
    const duplicateScore = tableTextOverlapScore(line.text, tableText);
    const normalizedLineText = String(line.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const repeatedShortFragment = normalizedLineText.length >= 2 && normalizedLineText.length <= 48 &&
      nearAnyGrid && normalizedTableText.includes(normalizedLineText);
    return !(duplicateScore > 0.72 && nearAnyGrid) && !repeatedShortFragment;
  });
  outsideTableText.sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  children.push(...outsideTableText.flatMap(line => makeFidelityTextFrames({
    ...line.obj,
    data: {
      ...line.data,
      lines: [line.runs],
      _lineBoxes: [line.box],
      _lineAligns: [line.data.align || 'left']
    }
  }, alignmentMap)));
  return children;
}

function makeVectorBoxPageChild(vector) {
  const d = vector || {};
  if (d.kind === 'line') {
    return new docx.Paragraph({
      spacing: { before: 0, after: 0, line: 1, lineRule: docx.LineRuleType.EXACT },
      children: [new docx.TextRun({
        text: vectorLineMarker({
          x1: Number(d.x1 || d.x) / RENDER_SCALE,
          y1: Number(d.y1 || d.y) / RENDER_SCALE,
          x2: Number(d.x2 || (Number(d.x || 0) + Number(d.width || 0))) / RENDER_SCALE,
          y2: Number(d.y2 || (Number(d.y || 0) + Number(d.height || 0))) / RENDER_SCALE,
          thickness: Math.max(0.25, Number(d.thickness || 1) / RENDER_SCALE),
          color: d.color || '#000000',
          dash: Array.isArray(d.dash) ? d.dash.map(value => Number(value || 0) / RENDER_SCALE) : [],
          zIndex: Number(d.zIndex || 1000)
        }),
        size: 2,
        color: 'FFFFFF'
      })]
    });
  }
  if (d.kind === 'roundRect') {
    return new docx.Paragraph({
      spacing: { before: 0, after: 0, line: 1, lineRule: docx.LineRuleType.EXACT },
      children: [new docx.TextRun({
        text: vectorRoundRectMarker({
          x: Number(d.x || 0) / RENDER_SCALE,
          y: Number(d.y || 0) / RENDER_SCALE,
          width: Number(d.width || 0) / RENDER_SCALE,
          height: Number(d.height || 0) / RENDER_SCALE,
          fill: d.fill === true,
          stroke: d.stroke !== false,
          fillColor: d.fillColor || '#FFFFFF',
          strokeColor: d.strokeColor || d.color || '#000000',
          thickness: Math.max(0.25, Number(d.thickness || 1) / RENDER_SCALE),
          zIndex: Number(d.zIndex || 1000)
        }),
        size: 2,
        color: 'FFFFFF'
      })]
    });
  }
  if (d.kind === 'path') {
    const widthPt = Number(d.width || 0) / RENDER_SCALE;
    const heightPt = Number(d.height || 0) / RENDER_SCALE;
    const fillColor = d.fillColor || d.color || '#000000';
    const [fr, fg, fb] = _hexToRgb(fillColor, [0, 0, 0]);
    const tinyFilledGlyph = d.fill !== false && d.stroke === false && widthPt <= 6 && heightPt <= 5.5 && (d.points || []).length >= 6 && fr < 32 && fg < 32 && fb < 32;
    const pathFillColor = tinyFilledGlyph ? '#6f6f6f' : fillColor;
    return new docx.Paragraph({
      spacing: { before: 0, after: 0, line: 1, lineRule: docx.LineRuleType.EXACT },
      children: [new docx.TextRun({
        text: vectorPathMarker({
          x: Number(d.x || 0) / RENDER_SCALE,
          y: Number(d.y || 0) / RENDER_SCALE,
          width: widthPt,
          height: heightPt,
          points: (d.points || []).map(point => ({
            x: Number(point.x || 0) / RENDER_SCALE,
            y: Number(point.y || 0) / RENDER_SCALE
          })),
          contours: Array.isArray(d.contours) ? d.contours.map(contour =>
            (contour || []).map(point => ({
              x: Number(point.x || 0) / RENDER_SCALE,
              y: Number(point.y || 0) / RENDER_SCALE
            }))
          ) : undefined,
          fillColor: pathFillColor,
          strokeColor: d.strokeColor || d.color || '#000000',
          stroke: d.stroke !== false,
          fill: d.fill !== false,
          thickness: Math.max(0.25, Number(d.thickness || 1) / RENDER_SCALE),
          zIndex: Number(d.zIndex || 1000)
        }),
        size: 2,
        color: 'FFFFFF'
      })]
    });
  }
  const widthPt = Math.max(0.5, Number(d.width || 0) / RENDER_SCALE);
  const heightPt = Math.max(0.5, Number(d.height || 0) / RENDER_SCALE);
  const color = String(d.color || '#000000').replace('#', '').toUpperCase();
  const none = { style: docx.BorderStyle.NONE, size: 0, color };
  return new docx.Table({
    width: { size: pointsToTwips(widthPt), type: docx.WidthType.DXA },
    float: {
      horizontalAnchor: docx.TableAnchorType.PAGE,
      verticalAnchor: docx.TableAnchorType.PAGE,
      absoluteHorizontalPosition: pointsToTwips(Math.max(0, Number(d.x || 0) / RENDER_SCALE)),
      absoluteVerticalPosition: pointsToTwips(Math.max(0, Number(d.y || 0) / RENDER_SCALE)),
      leftFromText: 0,
      rightFromText: 0,
      topFromText: 0,
      bottomFromText: 0
    },
    layout: docx.TableLayoutType.FIXED,
    columnWidths: [pointsToTwips(widthPt)],
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    margins: { marginUnitType: docx.WidthType.DXA, top: 0, bottom: 0, left: 0, right: 0 },
    rows: [
      new docx.TableRow({
        height: { value: pointsToTwips(heightPt), rule: docx.HeightRule.EXACT },
        children: [
          new docx.TableCell({
            width: { size: pointsToTwips(widthPt), type: docx.WidthType.DXA },
            shading: { type: docx.ShadingType.CLEAR, fill: color },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
            children: [new docx.Paragraph({ spacing: { before: 0, after: 0, line: 1, lineRule: docx.LineRuleType.EXACT }, children: [new docx.TextRun({ text: '', size: 2 })] })]
          })
        ]
      })
    ]
  });
}

function attrValue(attrs, name, fallback = '0') {
  return attrs.match(new RegExp(`\\bw:${name}="([^"]*)"`))?.[1] ?? fallback;
}

function xmlEscapeAttr(value) {
  return stripInvalidXmlChars(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function makeFontGuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0'));
  return `{${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}}`.toUpperCase();
}

function guidToObfuscationBytes(guid) {
  const h = guid.replace(/[{}-]/g, '');
  const raw = [];
  for (let i = 0; i < h.length; i += 2) raw.push(parseInt(h.slice(i, i + 2), 16));
  return [
    raw[3], raw[2], raw[1], raw[0],
    raw[5], raw[4],
    raw[7], raw[6],
    raw[8], raw[9], raw[10], raw[11], raw[12], raw[13], raw[14], raw[15]
  ];
}

function obfuscateFontBytes(bytes, guid) {
  const out = new Uint8Array(bytes);
  const key = guidToObfuscationBytes(guid);
  for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= key[i % 16];
  return out;
}

const VML_ANCHOR_PARAGRAPH_PROPERTIES = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:widowControl w:val="0"/></w:pPr>';

function patchFrameParagraphsToVml(documentXml) {
  let shapeId = 1;
  return documentXml.replace(/<w:p><w:pPr>(((?:(?!<\/w:pPr>)[\s\S])*?)<w:framePr\b([^>]*)\/>((?:(?!<\/w:pPr>)[\s\S])*?))<\/w:pPr>([\s\S]*?)<\/w:p>/g, (_all, pPr, beforeFrame, frameAttrs, afterFrame, runs) => {
    const x = Number(attrValue(frameAttrs, 'x')) || 0;
    const y = Number(attrValue(frameAttrs, 'y')) || 0;
    const w = Math.max(1, Number(attrValue(frameAttrs, 'w')) || 1);
    const h = Math.max(1, Number(attrValue(frameAttrs, 'h')) || 1);
    const cleanPPr = beforeFrame + afterFrame;
    const id = `_x0000_s${1024 + shapeId++}`;
    const style = [
      'position:absolute',
      `left:${(x / 20).toFixed(2)}pt`,
      `top:${(y / 20).toFixed(2)}pt`,
      `width:${(w / 20).toFixed(2)}pt`,
      `height:${(h / 20).toFixed(2)}pt`,
      `z-index:${200000 + shapeId}`,
      'mso-position-horizontal-relative:page',
      'mso-position-vertical-relative:page'
    ].join(';');
    return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:pict><v:shape id="${id}" type="#_x0000_t202" style="${style}" filled="f" stroked="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr>${cleanPPr}</w:pPr>${runs}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
  });
}

function patchImageAnchorsToVml(documentXml) {
  let imageId = 1;
  return documentXml.replace(/<w:p><w:r><w:drawing><wp:anchor\b([^>]*)>([\s\S]*?<wp:extent cx="(\d+)" cy="(\d+)"\/>[\s\S]*?<a:blip r:embed="([^"]+)"[\s\S]*?)<\/wp:anchor><\/w:drawing><\/w:r><\/w:p>/g, (all, anchorAttrs, inner, cx, cy, relId) => {
    const x = Number(inner.match(/<wp:positionH\b[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/)?.[1] || 0);
    const y = Number(inner.match(/<wp:positionV\b[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/)?.[1] || 0);
    const relativeHeight = Number(anchorAttrs.match(/\brelativeHeight="(\d+)"/)?.[1] || 1);
    const widthPt = Math.max(1, Number(cx) / 12700);
    const heightPt = Math.max(1, Number(cy) / 12700);
    const isBehindDocument = /\bbehindDoc="1"/.test(anchorAttrs);
    const isPageScaleImage = widthPt >= 500 && heightPt >= 300;
    const isBackground = isBehindDocument && x === 0 && y === 0 && (relativeHeight === 1 || isPageScaleImage);
    const isFormBackground = /PDFOMNI_FORM_BACKGROUND/.test(inner);
    const isForeground = /\bbehindDoc="0"/.test(anchorAttrs);
    // Preserve real DrawingML background anchors. Converting a behind-text
    // page image to positive-z VML places it above normal-flow Word tables,
    // hiding their editable cell text even though the table XML is present.
    if (isBackground && !isFormBackground) return all;
    const id = `_x0000_img${imageId++}`;
    const style = [
      'position:absolute',
      `left:${(x / 12700).toFixed(2)}pt`,
      `top:${(y / 12700).toFixed(2)}pt`,
      `width:${widthPt.toFixed(2)}pt`,
      `height:${heightPt.toFixed(2)}pt`,
      `z-index:${isBackground ? '100' : (isForeground ? (190000 + imageId) : (100000 + imageId))}`,
      'mso-position-horizontal-relative:page',
      'mso-position-vertical-relative:page'
    ].join(';');
    return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:pict><v:shape id="${id}" type="#_x0000_t75" style="${style}" stroked="f"><v:imagedata r:id="${relId}" o:title=""/></v:shape></w:pict></w:r></w:p>`;
  });
}

const RUN_PROPERTY_ORDER = new Map([
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
  'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish',
  'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs',
  'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl',
  'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'
].map((name, index) => [name, index]));

function normalizeRunPropertiesXml(documentXml) {
  return String(documentXml || '').replace(/<w:rPr\b([^>]*)>([\s\S]*?)<\/w:rPr>/g, (all, attrs, body) => {
    body = body.replace(/<w:(?:b|bCs|i|iCs)\b[^>]*\bw:val="(?:false|0|off)"[^>]*\/>/gi, '');
    const children = [];
    body.replace(/<w:([A-Za-z0-9]+)\b[^>]*(?:\/>|>[\s\S]*?<\/w:\1>)/g, (child, name, offset) => {
      children.push({
        child,
        name,
        offset,
        order: RUN_PROPERTY_ORDER.has(name) ? RUN_PROPERTY_ORDER.get(name) : 1000
      });
      return child;
    });
    if (!children.length) return all;
    children.sort((a, b) => a.order - b.order || a.offset - b.offset);
    return `<w:rPr${attrs}>${children.map(item => item.child).join('')}</w:rPr>`;
  });
}

function xmlUnescapeText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function visibleTextFromXml(xml) {
  return [...String(xml || '').matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map(match => xmlUnescapeText(match[1]))
    .join('');
}

function runFontFamilyFromXml(runXml) {
  const rFonts = String(runXml || '').match(/<w:rFonts\b([^>]*)\/>/)?.[1] || '';
  return (
    rFonts.match(/\bw:ascii="([^"]+)"/)?.[1] ||
    rFonts.match(/\bw:hAnsi="([^"]+)"/)?.[1] ||
    rFonts.match(/\bw:cs="([^"]+)"/)?.[1] ||
    ''
  );
}

function normalizeLeakedTextColorsXml(documentXml) {
  return String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const paragraphText = visibleTextFromXml(paragraph).replace(/\s+/g, ' ').trim();
    if (!paragraphText) return paragraph;
    return paragraph.replace(/<w:r\b[\s\S]*?<\/w:r>/g, run => {
      const colorMatch = run.match(/<w:color\b[^>]*\bw:val="([0-9A-Fa-f]{6}|auto)"[^>]*\/>/);
      if (!colorMatch) return run;
      const rawColor = colorMatch[1];
      if (/^(?:000000|auto)$/i.test(rawColor)) return run;
      const runText = visibleTextFromXml(run);
      if (!runText.trim()) return run;
      const normalized = normalizedRunTextColor(
        runText,
        paragraphText,
        `#${rawColor}`,
        runFontFamilyFromXml(run)
      ).replace('#', '').toUpperCase();
      if (normalized === rawColor.toUpperCase()) return run;
      return run.replace(colorMatch[0], colorMatch[0].replace(/\bw:val="[^"]+"/, `w:val="${normalized}"`));
    });
  });
}

function normalizeDrawingDocPrIds(documentXml) {
  let nextId = 1;
  return String(documentXml || '').replace(/<wp:docPr\b([^>]*)\bid="[^"]*"([^>]*)>/g, (_all, before, after) => {
    return `<wp:docPr${before}id="${nextId++}"${after}>`;
  });
}

function normalizeTableHeaderFlags(documentXml) {
  return String(documentXml || '').replace(/<w:tblHeader\b[^>]*\bw:val="(?:false|0|off)"[^>]*\/>/gi, '');
}

function rotatedRunXml(run = {}) {
  const font = xmlEscapeAttr(cleanFontNameForDocx(run.fontFamily || 'Times New Roman'));
  const color = xmlEscapeAttr(String(run.color || '000000').replace('#', '').toUpperCase());
  const rawFontSize = Number(run.fontSize || 10);
  const fontScale = 1;
  const size = Math.max(2, Math.round(rawFontSize * fontScale * 2));
  const text = _htmlEscape(stripInvalidXmlChars(run.text));
  return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:b w:val="${run.bold ? 'true' : 'false'}"/><w:bCs w:val="${run.bold ? 'true' : 'false'}"/><w:i w:val="${run.italic ? 'true' : 'false'}"/><w:iCs w:val="${run.italic ? 'true' : 'false'}"/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function rotatedTextBoxXml(payload = {}, index = 1, sectPr = '') {
  const x = Number(payload.x || 0);
  const y = Number(payload.y || 0);
  const width = Math.max(1, Number(payload.width || 1));
  const height = Math.max(1, Number(payload.height || 1));
  const rotation = Number(payload.rotation || 0);
  const theta = rotation * Math.PI / 180;
  const bboxWidth = Math.abs(width * Math.cos(theta)) + Math.abs(height * Math.sin(theta));
  const bboxHeight = Math.abs(width * Math.sin(theta)) + Math.abs(height * Math.cos(theta));
  const normalizedRotation = normalizeDegrees(rotation);
  const isRightAngle = Math.abs(normalizedRotation - 90) <= 4 || Math.abs(normalizedRotation - 270) <= 4;
  // The PDF extractor stores right-angle y at the center of the original
  // horizontal line box. Other angles use the rotated visual top edge.
  let anchorX = x - (width - bboxWidth) / 2;
  const anchorY = isRightAngle ? y : y + (bboxHeight - height) / 2;
  const cx = Math.max(1, Math.round(width * 12700));
  const cy = Math.max(1, Math.round(height * 12700));
  const xEmu = Math.round(anchorX * 12700);
  const yEmu = Math.round(anchorY * 12700);
  const rot = Math.round(rotation * 60000);
  const outerWidth = isRightAngle ? bboxWidth : width;
  const outerHeight = isRightAngle ? bboxHeight : height;
  const outerCx = Math.max(1, Math.round(outerWidth * 12700));
  const outerCy = Math.max(1, Math.round(outerHeight * 12700));
  const shapeCx = isRightAngle ? outerCx : cx;
  const shapeCy = isRightAngle ? outerCy : cy;
  const shapeRot = isRightAngle ? 0 : rot;
  const bodyVert = isRightAngle
    ? (Math.abs(normalizedRotation - 90) <= 4 ? 'vert270' : 'vert')
    : 'horz';
  const align = /center/i.test(payload.align || '') ? 'center' : /right/i.test(payload.align || '') ? 'right' : 'left';
  const runs = (payload.runs || []).map(rotatedRunXml).join('') || rotatedRunXml({ text: '' });
  const docPrId = 200000000 + index;
  if (isRightAngle) {
    const textDirection = Math.abs(normalizedRotation - 90) <= 4 ? 'tbRl' : 'btLr';
    const layoutFlow = textDirection === 'tbRl' ? 'top-to-bottom' : 'bottom-to-top';
    const style = [
      'position:absolute',
      `left:${x.toFixed(2)}pt`,
      `top:${y.toFixed(2)}pt`,
      `width:${height.toFixed(2)}pt`,
      `height:${width.toFixed(2)}pt`,
      `z-index:${2100000000 + index}`,
      'mso-position-horizontal-relative:page',
      'mso-position-vertical-relative:page',
      'mso-wrap-style:none'
    ].join(';');
    return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:pict><v:shape id="_x0000_pdfvertical${index}" style="${style}" filled="f" stroked="f"><v:textbox inset="0,0,0,0" style="mso-layout-flow-alt:${layoutFlow}"><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:textDirection w:val="${textDirection}"/><w:jc w:val="${align}"/></w:pPr>${runs}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>${sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : ''}`;
  }
  // Word cannot rotate a native text-box object through its own object model;
  // it only preserves arbitrary-angle editing for a regular shape containing
  // text. Keep the rectangle invisible, but do not mark it as txBox="1".
  return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${xEmu}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${yEmu}</wp:posOffset></wp:positionV><wp:extent cx="${outerCx}" cy="${outerCy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${docPrId}" name="PDF rotated text ${index}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm rot="${shapeRot}"><a:off x="0" y="0"/><a:ext cx="${shapeCx}" cy="${shapeCy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${align}"/></w:pPr>${runs}</w:p></w:txbxContent></wps:txbx><wps:bodyPr rot="0" spcFirstLastPara="0" vertOverflow="overflow" horzOverflow="overflow" vert="${bodyVert}" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" numCol="1" spcCol="0" rtlCol="0" fromWordArt="0" anchor="t" anchorCtr="0" forceAA="0" compatLnSpc="1"><a:prstTxWarp prst="textNoShape"><a:avLst/></a:prstTxWarp><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>${sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : ''}`;
}

function vectorLineXml(payload = {}, index = 1, sectPr = '') {
  const x1 = Number(payload.x1 || 0);
  const y1 = Number(payload.y1 || 0);
  const x2 = Number(payload.x2 || x1);
  const y2 = Number(payload.y2 || y1);
  const thickness = Math.max(0.25, Number(payload.thickness || 0.5));
  const color = xmlEscapeAttr(String(payload.color || '#000000').replace(/^#?/, '#'));
  const dash = Array.isArray(payload.dash)
    ? payload.dash.map(value => Math.max(0, Number(value) || 0)).filter(Number.isFinite)
    : [];
  const dashStyle = dash.length >= 2 && dash.some(value => value > 0)
    ? (dash[0] <= Math.max(thickness * 0.5, dash[1] * 0.45) ? 'dot' : 'dash')
    : '';
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.max(thickness, Math.abs(x2 - x1));
  const height = Math.max(thickness, Math.abs(y2 - y1));
  const sx = x1 <= x2 ? 0 : 21600;
  const ex = x1 <= x2 ? 21600 : 0;
  const sy = y1 <= y2 ? 0 : 21600;
  const ey = y1 <= y2 ? 21600 : 0;
  const id = `_x0000_pdfline${index}`;
  const zIndex = Math.max(1, Math.round(Number(payload.zIndex || (1000 + index))));
  const style = [
    'position:absolute',
    `left:${x.toFixed(2)}pt`,
    `top:${y.toFixed(2)}pt`,
    `width:${width.toFixed(2)}pt`,
    `height:${height.toFixed(2)}pt`,
    `z-index:${zIndex}`,
    'mso-position-horizontal-relative:page',
    'mso-position-vertical-relative:page'
  ].join(';');
  const dashNode = dashStyle ? `<v:stroke dashstyle="${dashStyle}"/>` : '';
  return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:pict><v:shape id="${id}" style="${style}" coordsize="21600,21600" path="m ${sx},${sy} l ${ex},${ey} e" filled="f" stroked="t" strokecolor="${color}" strokeweight="${thickness.toFixed(2)}pt">${dashNode}</v:shape></w:pict></w:r></w:p>${sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : ''}`;
}

function vectorRoundRectXml(payload = {}, index = 1, sectPr = '') {
  const x = Number(payload.x || 0);
  const y = Number(payload.y || 0);
  const width = Math.max(0.25, Number(payload.width || 1));
  const height = Math.max(0.25, Number(payload.height || 1));
  const strokeColor = xmlEscapeAttr(String(payload.strokeColor || payload.color || '#000000').replace(/^#?/, '#'));
  const fillColor = xmlEscapeAttr(String(payload.fillColor || '#FFFFFF').replace(/^#?/, '#'));
  const thickness = Math.max(0.25, Number(payload.thickness || 0.5));
  const filled = payload.fill ? 't' : 'f';
  const stroked = payload.stroke === false ? 'f' : 't';
  const fillNode = payload.fill ? `<v:fill color="${fillColor}" opacity="100%"/>` : '';
  const id = `_x0000_pdfroundrect${index}`;
  const zIndex = Math.max(1, Math.round(Number(payload.zIndex || (1000 + index))));
  const style = [
    'position:absolute',
    `left:${x.toFixed(2)}pt`,
    `top:${y.toFixed(2)}pt`,
    `width:${width.toFixed(2)}pt`,
    `height:${height.toFixed(2)}pt`,
    `z-index:${zIndex}`,
    'mso-position-horizontal-relative:page',
    'mso-position-vertical-relative:page'
  ].join(';');
  return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:pict><v:roundrect id="${id}" style="${style}" arcsize="8%" filled="${filled}" stroked="${stroked}" fillcolor="${fillColor}" strokecolor="${strokeColor}" strokeweight="${thickness.toFixed(2)}pt">${fillNode}</v:roundrect></w:pict></w:r></w:p>${sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : ''}`;
}

function vectorPathXml(payload = {}, index = 1, sectPr = '') {
  const rawContours = Array.isArray(payload.contours) && payload.contours.length
    ? payload.contours
    : [Array.isArray(payload.points) ? payload.points : []];
  const contours = rawContours
    .map(contour => (contour || [])
      .map(point => ({ x: Number(point.x || 0), y: Number(point.y || 0) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)))
    .filter(contour => contour.length >= 3);
  const points = contours.flat();
  if (points.length < 3) return sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : '';

  const minX = Math.min(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxX = Math.max(...points.map(point => point.x));
  const maxY = Math.max(...points.map(point => point.y));
  const x = Number.isFinite(Number(payload.x)) ? Number(payload.x) : minX;
  const y = Number.isFinite(Number(payload.y)) ? Number(payload.y) : minY;
  const width = Math.max(0.25, Number(payload.width || (maxX - minX)) || (maxX - minX));
  const height = Math.max(0.25, Number(payload.height || (maxY - minY)) || (maxY - minY));
  if (!Number.isFinite(x + y + width + height)) return sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : '';

  const coord = point => [
    Math.max(0, Math.min(21600, Math.round(((point.x - x) / width) * 21600))),
    Math.max(0, Math.min(21600, Math.round(((point.y - y) / height) * 21600)))
  ];
  const filled = payload.fill === false ? 'f' : 't';
  const stroked = payload.stroke === false ? 'f' : 't';
  const closePath = filled === 't' || payload.closed !== false;
  const contourPath = contour => {
    const coords = contour.map(coord);
    const first = coords[0];
    const rest = coords.slice(1).map(([px, py]) => `${px},${py}`).join(' ');
    return `m ${first[0]},${first[1]}${rest ? ` l ${rest}` : ''}${closePath ? ' x' : ''}`;
  };
  const path = `${contours.map(contourPath).join(' ')} e`;
  const fillColor = xmlEscapeAttr(String(payload.fillColor || payload.color || '#000000').replace(/^#?/, '#'));
  const strokeColor = xmlEscapeAttr(String(payload.strokeColor || payload.color || '#000000').replace(/^#?/, '#'));
  const thickness = Math.max(0.25, Number(payload.thickness || 0.5));
  const fillNode = filled === 't' ? `<v:fill color="${fillColor}" opacity="100%"/>` : '';
  const id = `_x0000_pdfpath${index}`;
  const zIndex = Math.max(1, Math.round(Number(payload.zIndex || (1000 + index))));
  const style = [
    'position:absolute',
    `left:${x.toFixed(2)}pt`,
    `top:${y.toFixed(2)}pt`,
    `width:${width.toFixed(2)}pt`,
    `height:${height.toFixed(2)}pt`,
    `z-index:${zIndex}`,
    'mso-position-horizontal-relative:page',
    'mso-position-vertical-relative:page'
  ].join(';');
  return `<w:p>${VML_ANCHOR_PARAGRAPH_PROPERTIES}<w:r><w:pict><v:shape id="${id}" style="${style}" coordsize="21600,21600" path="${xmlEscapeAttr(path)}" filled="${filled}" stroked="${stroked}" fillcolor="${fillColor}" strokecolor="${strokeColor}" strokeweight="${thickness.toFixed(2)}pt">${fillNode}</v:shape></w:pict></w:r></w:p>${sectPr ? `<w:p><w:pPr>${sectPr}</w:pPr></w:p>` : ''}`;
}

function patchRotatedTextMarkers(documentXml) {
  let index = 1;
  return String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const encoded = paragraph.match(/__PDFOMNI_ROTATED_TEXT__([A-Za-z0-9+/=]+)__/)?.[1];
    if (!encoded) return paragraph;
    try {
      const sectPr = paragraph.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || '';
      return rotatedTextBoxXml(JSON.parse(base64DecodeUtf8(encoded)), index++, sectPr)
        .replace('relativeHeight="251658240"', 'relativeHeight="251659264"');
    } catch (error) {
      console.warn('Failed to patch rotated text marker', error);
      return '';
    }
  });
}

function patchVectorLineMarkers(documentXml) {
  let index = 1;
  return String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const encoded = paragraph.match(/__PDFOMNI_VECTOR_LINE__([A-Za-z0-9+/=]+)__/)?.[1];
    if (!encoded) return paragraph;
    try {
      const sectPr = paragraph.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || '';
      return vectorLineXml(JSON.parse(base64DecodeUtf8(encoded)), index++, sectPr);
    } catch (error) {
      console.warn('Failed to patch vector line marker', error);
      return '';
    }
  });
}

function patchVectorPathMarkers(documentXml) {
  let index = 1;
  return String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const encoded = paragraph.match(/__PDFOMNI_VECTOR_PATH__([A-Za-z0-9+/=]+)__/)?.[1];
    if (!encoded) return paragraph;
    try {
      const sectPr = paragraph.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || '';
      return vectorPathXml(JSON.parse(base64DecodeUtf8(encoded)), index++, sectPr);
    } catch (error) {
      console.warn('Failed to patch vector path marker', error);
      return '';
    }
  });
}

function patchVectorRoundRectMarkers(documentXml) {
  let index = 1;
  return String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const encoded = paragraph.match(/__PDFOMNI_VECTOR_ROUNDRECT__([A-Za-z0-9+/=]+)__/)?.[1];
    if (!encoded) return paragraph;
    try {
      const sectPr = paragraph.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] || '';
      return vectorRoundRectXml(JSON.parse(base64DecodeUtf8(encoded)), index++, sectPr);
    } catch (error) {
      console.warn('Failed to patch vector roundrect marker', error);
      return '';
    }
  });
}

function patchTextDirectionMarkers(documentXml) {
  return String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraph => {
    const match = paragraph.match(/__PDFOMNI_TEXTDIR_(BT_LR|TB_RL)__/);
    if (!match) return paragraph;
    const direction = match[1] === 'BT_LR' ? 'btLr' : 'tbRl';
    let out = paragraph.replace(/<w:r\b[\s\S]*?<\/w:r>/g, run =>
      /__PDFOMNI_TEXTDIR_(?:BT_LR|TB_RL)__/.test(run) ? '' : run
    );
    if (/<w:textDirection\b/.test(out)) {
      out = out.replace(/<w:textDirection\b[^>]*\/>/g, `<w:textDirection w:val="${direction}"/>`);
    } else if (/<w:pPr\b[\s\S]*?<\/w:pPr>/.test(out)) {
      out = out.replace(/<\/w:pPr>/, `<w:textDirection w:val="${direction}"/></w:pPr>`);
    } else {
      out = out.replace(/<w:p(\b[^>]*)>/, `<w:p$1><w:pPr><w:textDirection w:val="${direction}"/></w:pPr>`);
    }
    return out;
  });
}

async function embedPdfFonts(zip, fonts = []) {
  const isWordEmbeddableTrueType = bytes => {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length < 12) return false;
    const signature = String.fromCharCode(data[0], data[1], data[2], data[3]);
    // OOXML obfuscated-font parts are TrueType sfnt payloads. PDF may also
    // expose CFF/OpenType subsets (OTTO), which Word cannot safely embed here.
    if (!(signature === '\u0000\u0001\u0000\u0000' || signature === 'true')) return false;
    const tableCount = (data[4] << 8) | data[5];
    if (!tableCount || data.length < 12 + tableCount * 16) return false;
    let hasHead = false;
    let hasMaxp = false;
    for (let index = 0; index < tableCount; index++) {
      const offset = 12 + index * 16;
      const tag = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      if (tag === 'head') hasHead = true;
      if (tag === 'maxp') hasMaxp = true;
    }
    return hasHead && hasMaxp;
  };
  const usable = fonts.filter(f => f?.name && f?.data?.length && isWordEmbeddableTrueType(f.data));
  if (!usable.length) return;

  const contentTypesPath = '[Content_Types].xml';
  let contentTypes = await zip.file(contentTypesPath).async('string');
  if (!contentTypes.includes('Extension="odttf"')) {
    contentTypes = contentTypes.replace(
      '</Types>',
      '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>'
    );
    zip.file(contentTypesPath, contentTypes);
  }

  const relsPath = 'word/_rels/fontTable.xml.rels';
  let rels = await (zip.file(relsPath)?.async('string') ?? Promise.resolve('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'));
  const existingRelIds = [...rels.matchAll(/\bId="rId(\d+)"/g)].map(m => Number(m[1]));
  let nextRelId = Math.max(0, ...existingRelIds) + 1;

  const fontTablePath = 'word/fontTable.xml';
  let fontTable = await zip.file(fontTablePath).async('string');
  if (/<w:fonts\b([^>]*)\/>/.test(fontTable)) {
    fontTable = fontTable.replace(/<w:fonts\b([^>]*)\/>/, '<w:fonts$1></w:fonts>');
  }
  if (/<Relationships\b([^>]*)\/>/.test(rels)) {
    rels = rels.replace(/<Relationships\b([^>]*)\/>/, '<Relationships$1></Relationships>');
  }
  let fontIndex = 1;
  for (const font of usable) {
    const escapedName = xmlEscapeAttr(font.name);
    const styleName = String(font.originalName || font.name || '').toLowerCase();
    const bold = /(?:bold|black|heavy|demi|semibold)/.test(styleName);
    const italic = /(?:italic|oblique|slanted)/.test(styleName);
    const embedElement = bold && italic ? 'embedBoldItalic' : bold ? 'embedBold' : italic ? 'embedItalic' : 'embedRegular';
    const fontStart = `<w:font w:name="${escapedName}">`;
    const existingStart = fontTable.indexOf(fontStart);
    if (existingStart >= 0) {
      const existingEnd = fontTable.indexOf('</w:font>', existingStart);
      const existingFont = existingEnd >= 0 ? fontTable.slice(existingStart, existingEnd + 9) : '';
      if (existingFont.includes(`<w:${embedElement} `)) continue;
    }
    const rid = `rId${nextRelId++}`;
    const guid = makeFontGuid();
    const target = `fonts/pdfomni-font-${fontIndex++}.odttf`;
    zip.file(`word/${target}`, obfuscateFontBytes(font.data, guid));
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="${target}"/></Relationships>`);
    const embedXml = `<w:${embedElement} r:id="${rid}" w:fontKey="${guid}"/>`;
    if (existingStart >= 0) {
      const existingEnd = fontTable.indexOf('</w:font>', existingStart);
      fontTable = fontTable.slice(0, existingEnd) + embedXml + fontTable.slice(existingEnd);
    } else {
      fontTable = fontTable.replace('</w:fonts>', `${fontStart}<w:family w:val="auto"/>${embedXml}</w:font></w:fonts>`);
    }
  }

  zip.file(relsPath, rels);
  zip.file(fontTablePath, fontTable);
}

function referencedDocxFontNames(documentXml = '') {
  const names = new Set();
  for (const tag of String(documentXml || '').matchAll(/<w:rFonts\b[^>]*>/g)) {
    for (const value of tag[0].matchAll(/\bw:(?:ascii|hAnsi|eastAsia|cs)="([^"]+)"/g)) {
      const name = xmlUnescapeText(value[1]).trim();
      if (name) names.add(name);
    }
  }
  return names;
}

async function patchDocxForFidelityPreview(source, fonts = []) {
  // Packer.compiler already returns a JSZip-compatible package. Patching that
  // package directly avoids compressing, reopening, and recompressing every
  // image and XML part before the final DOCX is produced.
  const zip = source?.files && typeof source.file === 'function' && typeof source.generateAsync === 'function'
    ? source
    : await JSZip.loadAsync(source);
  const path = 'word/document.xml';
  const xml = await zip.file(path).async('string');
  const markerXml = patchVectorRoundRectMarkers(patchVectorPathMarkers(patchVectorLineMarkers(patchRotatedTextMarkers(patchTextDirectionMarkers(xml)))));
  const patchedXml = patchImageAnchorsToVml(patchFrameParagraphsToVml(markerXml));
  const normalizedDocumentXml = normalizeTableHeaderFlags(normalizeDrawingDocPrIds(normalizeRunPropertiesXml(normalizeLeakedTextColorsXml(stripInvalidXmlChars(patchedXml)))));
  zip.file(path, normalizedDocumentXml);
  const stylesPath = 'word/styles.xml';
  const styles = await zip.file(stylesPath)?.async('string');
  if (styles) zip.file(stylesPath, normalizeRunPropertiesXml(stripInvalidXmlChars(styles)));
  const referencedFontNames = referencedDocxFontNames(normalizedDocumentXml);
  const fontAliases = fonts.flatMap(font => {
    const alias = docxFontNameFromEmbeddedPdfFont(font);
    const needsEmbeddedAlias = alias && alias !== font?.name &&
      !/^(?:Arial|Times New Roman|Courier New)$/i.test(alias);
    return needsEmbeddedAlias ? [font, { ...font, name: alias }] : [font];
  });
  await embedPdfFonts(zip, fontAliases.filter(font => referencedFontNames.has(String(font?.name || ''))));
  for (const [partPath, part] of Object.entries(zip.files)) {
    if (part.dir || !/\.(xml|rels)$/i.test(partPath)) continue;
    const partXml = await part.async('string');
    const cleanXml = stripInvalidXmlChars(partXml);
    if (cleanXml !== partXml) zip.file(partPath, cleanXml);
  }
  // PNG/JPEG media is already compressed. Deflating it again costs substantial
  // CPU while preserving exactly the same bytes, so store those parts directly.
  for (const [partPath, part] of Object.entries(zip.files)) {
    if (part.dir || !/\.(?:png|jpe?g|gif|webp)$/i.test(partPath)) continue;
    part.options.compression = 'STORE';
    part.options.compressionOptions = null;
  }
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // DOCX is a ZIP package. Repacking with STORE leaves large XML parts
    // uncompressed, producing needlessly huge browser downloads.
    compression: 'DEFLATE',
    // Level 1 preserves identical package contents while reducing the final
    // main-thread compression pause; media parts are already stored directly.
    compressionOptions: { level: 1 }
  });
}

function _sampleCanvasColor(source, r, avoidColor = null) {
  const ctx = source?.canvas ? source : source?.getContext?.('2d');
  const canvas = ctx?.canvas; if (!ctx || !canvas?.width) return '#ffffff';
  const snapshot = source?.canvas ? null : canvasPixelSnapshot(canvas);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
  const pad = Math.max(3, Math.round(Math.min(r.width || 12, r.height || 12) * .08));
  const sx = clamp((r.x || 0) - pad, 0, canvas.width - 1), sy = clamp((r.y || 0) - pad, 0, canvas.height - 1);
  const ex = clamp((r.x || 0) + (r.width || 1) + pad, 0, canvas.width), ey = clamp((r.y || 0) + (r.height || 1) + pad, 0, canvas.height);
  const w = Math.max(1, ex - sx), h = Math.max(1, ey - sy);
  let img = null;
  if (!snapshot) {
    try { img = ctx.getImageData(sx, sy, w, h).data; } catch (e) { return '#ffffff'; }
  }
  const avoid = _parseCssColor(avoidColor);
  const area = w * h;
  const stride = area < 2000 ? 1 : Math.max(1, Math.floor(Math.sqrt(area / 1000)));
  const buckets = new Map();
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = snapshot ? ((sy + y) * snapshot.width + sx + x) * 4 : (y * w + x) * 4;
      const pixels = snapshot?.data || img;
      const a = pixels[i + 3]; if (a < 20) continue;
      if (avoid) {
        const dr = pixels[i] - avoid[0], dg = pixels[i + 1] - avoid[1], db = pixels[i + 2] - avoid[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) < 70) continue;
      }
      const key = `${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`;
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += pixels[i]; b.g += pixels[i + 1]; b.b += pixels[i + 2]; buckets.set(key, b);
    }
  }
  if (!buckets.size && avoid) return _sampleCanvasColor(source, r, null);
  let best = null; for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best) return '#ffffff';
  const hex = v => Math.max(0, Math.min(255, Math.round(v / best.n))).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

function _sampleCanvasBorderColor(source, r) {
  const ctx = source?.canvas ? source : source?.getContext?.('2d');
  const canvas = ctx?.canvas; if (!ctx || !canvas?.width) return _sampleCanvasColor(source, r);
  const snapshot = source?.canvas ? null : canvasPixelSnapshot(canvas);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
  const pad = Math.max(4, Math.round(Math.min(r.width || 20, r.height || 20) * .08));
  const boxes = [
    [r.x - pad, r.y - pad, (r.width || 1) + pad * 2, pad],
    [r.x - pad, (r.y || 0) + (r.height || 1), (r.width || 1) + pad * 2, pad],
    [r.x - pad, r.y, pad, r.height || 1],
    [(r.x || 0) + (r.width || 1), r.y, pad, r.height || 1],
  ];
  const buckets = new Map();
  for (const box of boxes) {
    const sx = clamp(box[0], 0, canvas.width - 1), sy = clamp(box[1], 0, canvas.height - 1);
    const ex = clamp(box[0] + box[2], 0, canvas.width), ey = clamp(box[1] + box[3], 0, canvas.height);
    const w = Math.max(1, ex - sx), h = Math.max(1, ey - sy);
    let img = null;
    if (!snapshot) {
      try { img = ctx.getImageData(sx, sy, w, h).data; } catch (e) { continue; }
    }
    const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 700)));
    for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
      const i = snapshot ? ((sy + y) * snapshot.width + sx + x) * 4 : (y * w + x) * 4;
      const pixels = snapshot?.data || img;
      if (pixels[i + 3] < 20) continue;
      const key = `${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`;
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += pixels[i]; b.g += pixels[i + 1]; b.b += pixels[i + 2]; buckets.set(key, b);
    }
  }
  let best = null; for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best) return _sampleCanvasColor(source, r);
  const hex = v => Math.max(0, Math.min(255, Math.round(v / best.n))).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

// ── PDF PARSER CLASS (Adapted directly from editpdf.html) ────────────────────
class PDFParser{
  constructor(){this.pdfDoc=null;this.pageCount=0;this._pageCache=new Map();this._fileHandle=null;this._bytes=null;this._fontHints=[];this._lastTextCount=0;this._pdfLibGenerated=false;this._fontsPrimed=new Set();this._embeddedFonts=new Map();this._legacyEncodedFonts=new Set();}

  /* Load via File System Access API (streaming, no full buffer) */
  async loadFromHandle(handle){
    this._fileHandle=handle;
    const file=await handle.getFile();
    return this._loadFromFile(file);
  }

  /* Fallback: load from classic File object */
  async loadFromFile(file){
    return this._loadFromFile(file);
  }

  async _loadFromFile(file){
    // Use PDF.js range transport so it fetches chunks on demand
    const fileSize=file.size;
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url
    ).toString();

    // For small files (<50 MB) load fully — avoids repeated slice overhead
    if(fileSize<50*1024*1024){
      const buf=await file.arrayBuffer();
      this._bytes=buf;
      this._fontHints=this._extractFontHints(buf);
      this._pdfLibGenerated=this._looksPdfLibGenerated(buf);
      this.pdfDoc=await pdfjsLib.getDocument({data:buf.slice(0),enableXfa:false,fontExtraProperties:true}).promise;
      this._pdfLibGenerated=this._pdfLibGenerated||await this._metadataLooksGenerated();
    } else {
      // Large files: use custom range transport
      this._pdfLibGenerated=await this._looksPdfLibGeneratedFile(file);
      const transport=this._makeRangeTransport(file);
      this.pdfDoc=await pdfjsLib.getDocument({range:transport,enableXfa:false,fontExtraProperties:true}).promise;
      this._pdfLibGenerated=this._pdfLibGenerated||await this._metadataLooksGenerated();
      // Keep a weak reference to the file for export (no full read)
      this._file=file;
      this._fontHints=[];
    }
    this.pageCount=this.pdfDoc.numPages;
    this._pageCache.clear();
    this._fontsPrimed.clear();
    this._embeddedFonts.clear();
    this._legacyEncodedFonts.clear();
    return this.pdfDoc;
  }

  _looksPdfLibGenerated(buf){
    try{
      const bytes=new Uint8Array(buf);
      const max=Math.min(bytes.length,1024*1024);
      const chunks=[bytes.subarray(0,max)];
      if(bytes.length>max)chunks.push(bytes.subarray(Math.max(0,bytes.length-max)));
      const decoder=new TextDecoder('latin1');
      const text=chunks.map(chunk=>decoder.decode(chunk)).join('\n').toLowerCase();
      return text.includes('pdf-lib')||text.includes('pdfomni')||text.includes('pdflover');
    }catch{return false;}
  }

  async _looksPdfLibGeneratedFile(file){
    try{
      const span=Math.min(file.size,512*1024);
      const parts=[file.slice(0,span)];
      if(file.size>span)parts.push(file.slice(Math.max(0,file.size-span)));
      return this._looksPdfLibGenerated(await new Blob(parts).arrayBuffer());
    }catch{return false;}
  }

  async _metadataLooksGenerated(){
    try{
      const meta=await this.pdfDoc.getMetadata();
      const info=meta?.info||{};
      const values=[info.Producer,info.Creator,info.Title,info.Subject].filter(Boolean).join(' ').toLowerCase();
      return values.includes('pdfomni')||values.includes('pdf-lib')||values.includes('pdflover');
    }catch{return false;}
  }

  /* Creates a PDF.js PDFDataRangeTransport backed by File.slice() */
  _makeRangeTransport(file){
    const CHUNK=65536; // 64 KB chunks
    const transport=new pdfjsLib.PDFDataRangeTransport(file.size,new Uint8Array(0));
    transport.requestDataRange=(begin,end)=>{
      const blob=file.slice(begin,end);
      blob.arrayBuffer().then(buf=>{
        transport.onDataRange(begin,new Uint8Array(buf));
      });
    };
    // Kick off first chunk
    const blob=file.slice(0,Math.min(CHUNK,file.size));
    blob.arrayBuffer().then(buf=>{
      transport.onDataProgress(Math.min(CHUNK,file.size),file.size);
      transport.onDataRange(0,new Uint8Array(buf));
    });
    return transport;
  }

  async getPage(pi){
    if(this._pageCache.has(pi))return this._pageCache.get(pi);
    const p=await this.pdfDoc.getPage(pi+1);
    this._pageCache.set(pi,p);return p;
  }

  releasePage(pi){
    const page=this._pageCache.get(pi);
    this._pageCache.delete(pi);
    this._fontsPrimed.delete(pi);
    this._pageFontMap?.delete(pi);
    try{page?.cleanup?.();}catch(e){console.warn('PDF page cleanup failed',pi,e);}
  }

  async getPageDimensions(pi){
    const page=await this.getPage(pi);
    const vp=page.getViewport({scale:1});
    return{width:vp.width,height:vp.height};
  }

  _extractFontHints(buf){
    try{
      const bytes=new Uint8Array(buf);
      let s='';
      for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
      const out=[],seen=new Set(),re=/\/BaseFont\s*\/([A-Za-z0-9+_.-]+)/g;
      let m;
      while((m=re.exec(s))){
        const name=m[1].replace(/^[A-Z]{6}\+/,'');
        if(!seen.has(name)){seen.add(name);out.push(name);}
      }
      return out;
    }catch(e){return[];}
  }

  async renderToCanvas(pi,canvas,scale=RENDER_SCALE){
    const page=await this.getPage(pi);
    const vp=page.getViewport({scale});
    _canvasPixelCache.delete(canvas);
    canvas.width=vp.width;canvas.height=vp.height;
    const ctx=canvas.getContext('2d', {willReadFrequently:scale===RENDER_SCALE});
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const task=page.render({canvasContext:ctx,viewport:vp});
    await task.promise;
    // Capture fonts PDF.js just injected
    this._capturePageFonts(pi,page);
    this._fontsPrimed.add(pi);
    return vp;
  }

  async renderGraphicsToCanvas(pi,canvas,scale=IMAGE_RENDER_SCALE){
    const page=await this.getPage(pi);
    const vp=page.getViewport({scale});
    _canvasPixelCache.delete(canvas);
    canvas.width=vp.width;canvas.height=vp.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:false});
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const intentArgs=page._transport?.getRenderingIntent?.('display');
    const intentState=intentArgs ? page._intentStates?.get?.(intentArgs.cacheKey) : null;
    const operatorList=intentState?.operatorList;
    const OPS=window.pdfjsLib?.OPS;
    if(!operatorList?.lastChunk||!Number.isFinite(OPS?.beginText)||!Number.isFinite(OPS?.setTextRenderingMode)){
      await this.renderToCanvas(pi,canvas,scale);
      canvas._pdfomniGraphicsOnly=false;
      return vp;
    }

    const originalFnArray=operatorList.fnArray;
    const originalArgsArray=operatorList.argsArray;
    const graphicsFnArray=[];
    const graphicsArgsArray=[];
    for(let index=0;index<originalFnArray.length;index++){
      const operation=originalFnArray[index];
      const args=originalArgsArray[index];
      graphicsFnArray.push(operation);
      if(operation===OPS.setTextRenderingMode){
        const mode=Number(args?.[0]||0);
        // PDF modes 4-7 include glyph clipping. Keep that clip while making
        // the glyph itself invisible; ordinary fill/stroke modes become 3.
        graphicsArgsArray.push([mode>=4?7:3]);
      }else{
        graphicsArgsArray.push(args);
      }
      if(operation===OPS.beginText){
        // Text rendering mode persists between BT/ET blocks, so explicitly
        // start every text object invisible even when the PDF omits a Tr op.
        graphicsFnArray.push(OPS.setTextRenderingMode);
        graphicsArgsArray.push([3]);
      }
    }
    operatorList.fnArray=graphicsFnArray;
    operatorList.argsArray=graphicsArgsArray;
    try{
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      canvas._pdfomniGraphicsOnly=true;
    }finally{
      operatorList.fnArray=originalFnArray;
      operatorList.argsArray=originalArgsArray;
    }
    return vp;
  }

  async _primePageFonts(pi,page){
    if(this._fontsPrimed.has(pi))return;
    try{
      const vp=page.getViewport({scale:0.01});
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.ceil(vp.width));
      canvas.height=Math.max(1,Math.ceil(vp.height));
      await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
      canvas.width=0;canvas.height=0;
      this._capturePageFonts(pi,page);
      this._fontsPrimed.add(pi);
    }catch(e){
      console.warn('Font priming failed for page',pi,e);
    }
  }

  _capturePageFonts(pi,page,fontKeys=[]){
    if(!this._pageFontMap)this._pageFontMap=new Map();
    const fontMap=this._pageFontMap.get(pi)||{};
    for(const key of fontKeys){
      try{
        const font=page.commonObjs?.get?.(key);
        if(font){
          const names=[font.name,font.loadedName,font.fontName,font.fallbackName].filter(Boolean).join(' ');
          if(names)fontMap[key]=names;
          this._rememberEmbeddedFont(font);
        }
      }catch{}
    }
    
    // Retrieve all loaded font families in document.fonts matching PDF.js pattern
    try {
      const families = Array.from(document.fonts)
        .map(f => f.family)
        .filter(fam => /^g_d\d+_f\d+$/i.test(fam));
        
      families.forEach(fam => {
        fontMap[fam]=[fontMap[fam],fam].filter(Boolean).join(' ');
      });
    } catch(e) {
      console.warn('Failed to extract fonts via document.fonts and commonObjs.get:', e);
    }

    // Keep legacy fallback for older PDF.js commonObjs cache structures
    const objs=page.commonObjs?._objs||page.commonObjs?._cache||{};
    for(const[key,entry]of Object.entries(objs)){
      const font=entry?.data||entry;
      if(!font||typeof font!=='object')continue;
      if(font.loadedName)fontMap[key]=font.loadedName;
      else if(font.fontName)fontMap[key]=font.fontName;
      this._rememberEmbeddedFont(font);
    }
    this._pageFontMap.set(pi,fontMap);
  }

  _rememberEmbeddedFont(font){
    const family=font?.loadedName;
    const data=font?.data;
    const byteLength=data?.byteLength ?? data?.length ?? 0;
    if(!family||!/^g_d\d+_f\d+$/i.test(family)||!byteLength)return;
    if(this._embeddedFonts.has(family))return;
    this._embeddedFonts.set(family,{
      name:family,
      originalName:font.name||font.fontName||family,
      mimetype:font.mimetype||'font/opentype',
      data:data instanceof Uint8Array?data:new Uint8Array(data)
    });
  }

  getEmbeddedFonts(){
    return [...this._embeddedFonts.values()];
  }

  getPageFontName(pi,pdfFontKey){
    return this._pageFontMap?.get(pi)?.[pdfFontKey]||null;
  }

  async extractObjects(pi){
    const page=await this.getPage(pi);
    await this._primePageFonts(pi,page);
    const vp=page.getViewport({scale:RENDER_SCALE});
    const[tc,anns,opList]=await Promise.all([
      page.getTextContent({includeMarkedContent:false}),
      page.getAnnotations(),
      page.getOperatorList().catch(()=>null)
    ]);
    const items=tc.items.filter(i=>i.str&&i.str.trim());
    const shiftedSubsetFonts=new Set(items
      .filter(item=>decodeShiftedAsciiSubsetText(item.str,item.fontName)!==item.str)
      .map(item=>item.fontName));
    for(const item of items)item._shiftedSubsetFont=shiftedSubsetFonts.has(item.fontName);
    const textFontKeys = [...new Set(items.map(item => item.fontName).filter(Boolean))];
    this._capturePageFonts(pi,page,[...new Set([...Object.keys(tc.styles||{}), ...textFontKeys])]);
    this._lastTextCount+=items.length;
    const fontDetails=this._fontDetails(page,tc.styles||{},textFontKeys);
    const capturedFonts=this._pageFontMap?.get?.(pi)||{};
    for(const key of textFontKeys){
      if(capturedFonts[key])fontDetails[key]=[fontDetails[key],capturedFonts[key]].filter(Boolean).join(' ');
    }
    let colors;
    try{
      colors=this._extractTextColors(opList,items);
    }catch{
      colors=Array(items.length).fill('#000000');
    }
    const hasText=items.length>0;
    const linkObjs=this._buildLinkObjs(anns,vp,pi);
    const textObjs=this._buildTextObjs(items,vp,pi,tc.styles||{},colors,fontDetails,linkObjs);
    let imageObjs=this._buildImageObjs(opList,vp,pi,hasText);
    await this._attachNativeImageAssets(imageObjs,page);
    const vectorObjs=this._buildVectorObjs(opList,vp,pi);
    if(textObjs.length&&imageObjs.length){
      imageObjs=this._filterTextImageOverlays(imageObjs,textObjs,vp);
    }
    const widgetCount=anns.filter(annotation=>annotation?.subtype==='Widget').length;
    return{
      textObjs,
      imageObjs,
      vectorObjs,
      linkObjs,
      textItemCount:items.length,
      annotationCount:anns.length,
      widgetCount
    };
  }

  _filterTextImageOverlays(imageObjs,textObjs,vp){
    const pageArea=Math.max(1,(vp?.width||0)*(vp?.height||0));
    const textBoxes=textObjs
      .map(o=>({x:o.x,y:o.y,width:o.width,height:o.height,text:o.data?.content||''}))
      .filter(r=>r.width>2&&r.height>2&&String(r.text||'').trim());
    if(!textBoxes.length)return imageObjs;
    return imageObjs.filter(img=>!this._isTextImageOverlay(img,textBoxes,pageArea));
  }

  _isTextImageOverlay(img,textBoxes,pageArea){
    const r=img?.data?._originalBox||img;
    if(!r||r.width<8||r.height<8)return false;
    const area=r.width*r.height;
    if(area>pageArea*.65)return false;
    const padX=Math.max(10,r.width*.06),padY=Math.max(8,r.height*.12);
    const padded={x:r.x-padX,y:r.y-padY,width:r.width+padX*2,height:r.height+padY*2};
    const near=[];
    for(const t of textBoxes){
      const overlap=this._rectArea(this._rectIntersection(padded,t));
      if(!overlap)continue;
      const actualOverlap=this._rectArea(this._rectIntersection(r,t));
      const tArea=Math.max(1,t.width*t.height);
      const centerInside=t.x+t.width/2>=padded.x&&t.x+t.width/2<=padded.x+padded.width&&
        t.y+t.height/2>=padded.y&&t.y+t.height/2<=padded.y+padded.height;
      const meaningfulOverlap=actualOverlap>Math.min(tArea,area)*.14;
      if(centerInside||meaningfulOverlap)near.push(t);
    }
    if(!near.length)return false;
    const union=this._rectUnion(near);
    const textLen=near.reduce((sum,t)=>sum+String(t.text||'').trim().length,0);
    const widthRatio=Math.min(union.width,r.width)/Math.max(1,r.width);
    const heightRatio=Math.min(union.height,r.height)/Math.max(1,r.height);
    const covered=near.reduce((sum,t)=>sum+this._rectArea(this._rectIntersection(r,t)),0)/Math.max(1,area);
    return textLen>=8&&widthRatio>.42&&heightRatio>.38&&covered>.55;
  }

  _rectIntersection(a,b){
    const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
    const maxX=Math.min(a.x+a.width,b.x+b.width),maxY=Math.min(a.y+a.height,b.y+b.height);
    return{x,y,width:Math.max(0,maxX-x),height:Math.max(0,maxY-y)};
  }

  _rectArea(r){return Math.max(0,r?.width||0)*Math.max(0,r?.height||0);}

  _rectUnion(rects){
    const minX=Math.min(...rects.map(r=>r.x)),minY=Math.min(...rects.map(r=>r.y));
    const maxX=Math.max(...rects.map(r=>r.x+r.width)),maxY=Math.max(...rects.map(r=>r.y+r.height));
    return{x:minX,y:minY,width:maxX-minX,height:maxY-minY};
  }

  _buildImageObjs(opList,vp,pi,hasText=false){
    const OPS=window.pdfjsLib?.OPS;if(!opList||!OPS)return[];
    const imageOps=new Set([
      OPS.paintImageXObject,OPS.paintJpegXObject,OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObjectRepeat,
      OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObjectGroup,OPS.paintSolidColorImageMask
    ].filter(Boolean));
    const out=[],stack=[];let ctm=[1,0,0,1,0,0],path=null,clipBox={x:0,y:0,width:vp.width||0,height:vp.height||0};
    const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
    const apply=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
    const bbox=m=>{
      const vm=mul(vp.transform,m),pts=[[0,0],[1,0],[0,1],[1,1]].map(p=>apply(vm,p[0],p[1]));
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
      return{x,y,width:w,height:h};
    };
    const rectIntersection=(a,b)=>{
      if(!a||!b)return null;
      const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
      const maxX=Math.min(a.x+a.width,b.x+b.width),maxY=Math.min(a.y+a.height,b.y+b.height);
      const width=Math.max(0,maxX-x),height=Math.max(0,maxY-y);
      return width>0&&height>0?{x,y,width,height}:null;
    };
    const parsePath=args=>{
      const kinds=args?.[0]||[],coords=args?.[1]||[];
      const pts=[];let ptr=0,last=null,start=null;
      const add=point=>{if(Number.isFinite(point.x+point.y)){pts.push(point);last=point;}};
      const segmentCurve=(p0,p1,p2,p3)=>{
        for(let step=1;step<=8;step++){
          const t=step/8,mt=1-t;
          add({
            x:mt*mt*mt*p0.x+3*mt*mt*t*p1.x+3*mt*t*t*p2.x+t*t*t*p3.x,
            y:mt*mt*mt*p0.y+3*mt*mt*t*p1.y+3*mt*t*t*p2.y+t*t*t*p3.y
          });
        }
      };
      for(const kind of kinds){
        if(kind===19){
          const x=Number(coords[ptr++]),y=Number(coords[ptr++]),width=Number(coords[ptr++]),height=Number(coords[ptr++]);
          add({x,y});add({x:x+width,y});add({x:x+width,y:y+height});add({x,y:y+height});
          last=null;start=null;
        }else if(kind===13){
          start={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          add(start);
        }else if(kind===14){
          add({x:Number(coords[ptr++]),y:Number(coords[ptr++])});
        }else if(kind===15){
          const p0=last,p1={x:Number(coords[ptr++]),y:Number(coords[ptr++])},p2={x:Number(coords[ptr++]),y:Number(coords[ptr++])},p3={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          if(p0)segmentCurve(p0,p1,p2,p3);else add(p3);
        }else if(kind===16){
          const p0=last,p2={x:Number(coords[ptr++]),y:Number(coords[ptr++])},p3={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          if(p0)segmentCurve(p0,p0,p2,p3);else add(p3);
        }else if(kind===17){
          const p0=last,p1={x:Number(coords[ptr++]),y:Number(coords[ptr++])},p3={x:Number(coords[ptr++])};
          p3.y=Number(coords[ptr++]);
          if(p0)segmentCurve(p0,p1,p3,p3);else add(p3);
        }else if(kind===18){
          if(start)add(start);
          last=start;
          start=null;
        }
      }
      return pts;
    };
    const pathBBox=points=>{
      if(!points?.length)return null;
      const vm=mul(vp.transform,ctm);
      const transformed=points.map(p=>apply(vm,p.x,p.y)).filter(p=>Number.isFinite(p[0]+p[1]));
      if(!transformed.length)return null;
      const xs=transformed.map(p=>p[0]),ys=transformed.map(p=>p[1]);
      const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
      return width>0&&height>0?{x,y,width,height}:null;
    };
    for(let i=0;i<opList.fnArray.length;i++){
      const fn=opList.fnArray[i],args=opList.argsArray[i]||[];
      if(fn===OPS.save)stack.push({ctm:ctm.slice(),clipBox:clipBox?{...clipBox}:null});
      else if(fn===OPS.restore){const s=stack.pop();if(s){ctm=s.ctm;clipBox=s.clipBox;}}
      else if(fn===OPS.transform)ctm=mul(ctm,args);
      else if(fn===OPS.constructPath)path=parsePath(args);
      else if(fn===OPS.clip||fn===OPS.eoClip){
        const box=pathBBox(path);
        if(box)clipBox=rectIntersection(clipBox,box)||clipBox;
      }
      else if(fn===OPS.endPath)path=null;
      else if(imageOps.has(fn)){
        const b=bbox(ctm);
        const screenMatrix=mul(vp.transform,ctm);
        const visible=rectIntersection(b,clipBox)||b;
        if(visible.width>8&&visible.height>8&&Number.isFinite(visible.x)&&Number.isFinite(visible.y)){
          const box={x:visible.x,y:visible.y,width:visible.width,height:visible.height,rotation:0};
          const nativeRef=args?.[0];
          out.push({id:uid(),type:OT.IMAGE,pageIndex:pi,x:b.x,y:b.y,width:b.width,height:b.height,rotation:0,opacity:1,visible:true,zIndex:3+out.length,dirty:false,isOriginal:true,selected:false,data:{src:'',brightness:100,contrast:100,saturate:100,blur:0,borderRadius:0,quality:.92,flipX:false,flipY:false,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,grayscale:false,bw:false,transparentWhite:false,_originalBox:box,_nativePaintBox:b,_nativeAssetKey:typeof nativeRef==='string'?nativeRef:null,_nativeInlineAsset:nativeRef&&typeof nativeRef==='object'?nativeRef:null,_nativeAxisAligned:Math.abs(screenMatrix[1])<0.01&&Math.abs(screenMatrix[2])<0.01,_nativeFlipX:screenMatrix[0]<0,_nativeFlipY:screenMatrix[3]>0}});
        }
      }
    }
    return out;
  }

  async _attachNativeImageAssets(imageObjs,page){
    if(!Array.isArray(imageObjs)||!imageObjs.length||!page)return;
    const cache=new Map();
    const resolveAsset=key=>{
      if(!key)return Promise.resolve(null);
      if(cache.has(key))return cache.get(key);
      // Rendering completed before extraction. Any native image needed by the
      // page is resolved now; waiting on a background-throttled timeout cannot
      // produce a new asset and can stall a hidden tab for minutes.
      const promise=Promise.resolve().then(()=>{
        try{
          if(typeof page.objs?.has==='function'&&!page.objs.has(key))return null;
          return page.objs?.get?.(key)||null;
        }catch{
          return null;
        }
      });
      cache.set(key,promise);
      return promise;
    };
    await Promise.all(imageObjs.map(async image=>{
      const data=image?.data||{};
      const asset=data._nativeInlineAsset||await resolveAsset(data._nativeAssetKey);
      if(!asset||!(asset.bitmap||(asset.data&&asset.width&&asset.height)))return;
      data._nativeAsset=asset;
      delete data._nativeInlineAsset;
    }));
  }

  _buildVectorObjs(opList,vp,pi){
    const OPS=window.pdfjsLib?.OPS;if(!opList||!OPS)return[];
    const out=[],stack=[],groupAlphaStack=[];
    let ctm=[1,0,0,1,0,0],strokeColor='#000000',fillColor='#000000',lineWidth=1,path=null,strokeAlpha=1,fillAlpha=1,groupStrokeAlpha=1,groupFillAlpha=1,dashPattern=[],dashPhase=0;
    let clipBox={x:0,y:0,width:vp.width||0,height:vp.height||0};
    let vectorZIndex=1000;
    const nextVectorZIndex=()=>++vectorZIndex;
    const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
    const apply=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
    const vm=()=>mul(vp.transform,ctm);
    const normColor=v=>{
      const n=Number(v);
      if(!Number.isFinite(n))return 0;
      return n>=0&&n<=1?n*255:n;
    };
    const colorHex=args=>{
      const r=normColor(args?.[0]??0),g=normColor(args?.[1]??0),b=normColor(args?.[2]??0);
      return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
    };
    const grayHex=args=>{
      const value=normColor(args?.[0]??0);
      return colorHex([value,value,value]);
    };
    const cmykHex=args=>{
      const c=Number(args?.[0]??0)||0,m=Number(args?.[1]??0)||0,y=Number(args?.[2]??0)||0,k=Number(args?.[3]??0)||0;
      return colorHex([255*(1-c)*(1-k),255*(1-m)*(1-k),255*(1-y)*(1-k)]);
    };
    const luminance=hex=>{
      const n=parseInt(String(hex).replace('#',''),16);
      return (((n>>16)&255)+((n>>8)&255)+(n&255))/3;
    };
    const alphaBlendColor=(hex,alpha)=>{
      const clean=String(hex||'#000000').replace('#','');
      const n=parseInt(clean,16);
      const a=Math.max(0,Math.min(1,Number.isFinite(Number(alpha))?Number(alpha):1));
      if(!Number.isFinite(n)||a>=0.999)return hex;
      if(a<=0)return '#ffffff';
      const r=(n>>16)&255,g=(n>>8)&255,b=n&255;
      const mix=v=>Math.max(0,Math.min(255,Math.round(255+(v-255)*a)));
      return '#'+[mix(r),mix(g),mix(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
    };
    const effectiveStrokeColor=hex=>alphaBlendColor(hex,strokeAlpha*groupStrokeAlpha);
    const effectiveFillColor=hex=>alphaBlendColor(hex,fillAlpha*groupFillAlpha);
    const colorNumbers=args=>{
      const values=[];
      const visit=value=>{
        if(typeof value==='number')values.push(value);
        else if(Array.isArray(value))value.forEach(visit);
      };
      visit(args);
      return values;
    };
    const rectIntersection=(a,b)=>{
      if(!a||!b)return null;
      const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
      const right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
      const width=Math.max(0,right-x),height=Math.max(0,bottom-y);
      return width>0&&height>0?{x,y,width,height}:null;
    };
    const clipLineToBox=(a,b,box)=>{
      if(!box||box.width<=0||box.height<=0)return null;
      const dx=b.x-a.x,dy=b.y-a.y;
      let start=0,end=1;
      const test=(p,q)=>{
        if(Math.abs(p)<1e-9)return q>=0;
        const ratio=q/p;
        if(p<0){if(ratio>end)return false;if(ratio>start)start=ratio;}
        else{if(ratio<start)return false;if(ratio<end)end=ratio;}
        return true;
      };
      if(!test(-dx,a.x-box.x)||!test(dx,box.x+box.width-a.x)||!test(-dy,a.y-box.y)||!test(dy,box.y+box.height-a.y)||end<start)return null;
      return [{x:a.x+dx*start,y:a.y+dy*start},{x:a.x+dx*end,y:a.y+dy*end}];
    };
    const clipPolygonToBox=(points,box)=>{
      if(!box||!box.width||!box.height||!points?.length)return[];
      const boundaries=[
        {inside:p=>p.x>=box.x,intersect:(a,b)=>({x:box.x,y:a.y+(b.y-a.y)*(box.x-a.x)/(b.x-a.x)})},
        {inside:p=>p.x<=box.x+box.width,intersect:(a,b)=>({x:box.x+box.width,y:a.y+(b.y-a.y)*(box.x+box.width-a.x)/(b.x-a.x)})},
        {inside:p=>p.y>=box.y,intersect:(a,b)=>({x:a.x+(b.x-a.x)*(box.y-a.y)/(b.y-a.y),y:box.y})},
        {inside:p=>p.y<=box.y+box.height,intersect:(a,b)=>({x:a.x+(b.x-a.x)*(box.y+box.height-a.y)/(b.y-a.y),y:box.y+box.height})}
      ];
      let output=points.slice();
      for(const boundary of boundaries){
        const input=output;output=[];
        if(!input.length)break;
        let previous=input[input.length-1],previousInside=boundary.inside(previous);
        for(const point of input){
          const inside=boundary.inside(point);
          if(inside!==previousInside){
            const dx=point.x-previous.x,dy=point.y-previous.y;
            if(Math.abs(dx)>1e-9||Math.abs(dy)>1e-9)output.push(boundary.intersect(previous,point));
          }
          if(inside)output.push(point);
          previous=point;previousInside=inside;
        }
      }
      return output.filter(point=>Number.isFinite(point.x+point.y));
    };
    const isWhite=hex=>luminance(hex)>245;
    const addRect=(rect,color,kind)=>{
      color=kind==='fillRect'?effectiveFillColor(color):effectiveStrokeColor(color);
      if(!rect)return;
      const m=vm();
      const pts=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(p=>apply(m,p[0],p[1]));
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      let x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
      const clipped=rectIntersection({x,y,width,height},clipBox);
      if(!clipped)return;
      ({x,y,width,height}=clipped);
      if(width<1||height<1||!Number.isFinite(x+y+width+height))return;
      const pageArea=Math.max(1,(vp.width||0)*(vp.height||0));
      const area=width*height;
      const pageSized=area>pageArea*0.75;
      const meaningfulLightContainer=kind==='fillRect'&&isWhite(color)&&!pageSized&&area>pageArea*0.01;
      const visibleLightCandidate=kind==='fillRect'&&isWhite(color)&&!pageSized&&area>pageArea*0.000002&&width>=1.5&&height>=1.5;
      if(luminance(color)>=253&&!meaningfulLightContainer&&!visibleLightCandidate)return;
      if(kind==='fillRect'&&area>pageArea*0.01){
        out.push({
          id:uid(),type:'vector',kind:'path',pageIndex:pi,
          x,y,width,height,zIndex:nextVectorZIndex(),
          points:[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}],
          closed:true,fill:true,stroke:false,
          fillColor:color,strokeColor:color,thickness:0.25
        });
        return;
      }
      out.push({id:uid(),type:'vector',kind,pageIndex:pi,x,y,width,height,color,zIndex:nextVectorZIndex()});
    };
    const addLine=(line,color)=>{
      color=effectiveStrokeColor(color);
      if(!line)return;
      const m=vm();
      let[a,b]=[apply(m,line.x1,line.y1),apply(m,line.x2,line.y2)];
      const clippedLine=clipLineToBox({x:a[0],y:a[1]},{x:b[0],y:b[1]},clipBox);
      if(!clippedLine)return;
      a=[clippedLine[0].x,clippedLine[0].y];
      b=[clippedLine[1].x,clippedLine[1].y];
      const dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);
      const scale=Math.max(Math.abs(m[0]||1),Math.abs(m[3]||1));
      const thickness=Math.max(1,Math.abs(lineWidth||1)*scale);
      // Fine pictograms and chart markers are commonly built from short curve
      // segments. Keep them; their final stroke box still has a stable size.
      const minSegment=Math.max(0.25,thickness*0.15);
      if(Math.max(dx,dy)<minSegment)return;
      let x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),width=dx,height=dy;
      if(dx>=dy){height=thickness;y-=thickness/2;width=Math.max(width,thickness);}
      else{width=thickness;x-=thickness/2;height=Math.max(height,thickness);}
      if(width<1||height<1||!Number.isFinite(x+y+width+height))return;
      out.push({
        id:uid(),type:'vector',kind:'line',pageIndex:pi,x,y,width,height,
        x1:a[0],y1:a[1],x2:b[0],y2:b[1],thickness,color,
        dash:dashPattern.map(value=>Math.max(0,Number(value)||0)*scale),
        dashPhase:Math.max(0,Number(dashPhase)||0)*scale,
        zIndex:nextVectorZIndex()
      });
    };
    const addPath=(subpath,fillColorValue,strokeColorValue,strokeEnabled=true,fillEnabled=true)=>{
      if(!subpath?.points?.length)return;
      fillColorValue=effectiveFillColor(fillColorValue);
      strokeColorValue=effectiveStrokeColor(strokeColorValue);
      const fillLum=luminance(fillColorValue);
      const preserveSubtleFill=strokeEnabled&&subpath.closed&&Number.isFinite(fillLum)&&fillLum<253;
      const pageArea=Math.max(1,(vp.width||0)*(vp.height||0));
      const m=vm();
      let points=subpath.points
        .map(point=>apply(m,point.x,point.y))
        .map(([x,y])=>({x,y}))
        .filter(point=>Number.isFinite(point.x+point.y));
      points=clipPolygonToBox(points,clipBox);
      if(points.length<3)return;
      const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
      const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
      if(width<1||height<1||!Number.isFinite(x+y+width+height))return;
      const area=width*height;
      const pageSized=area>pageArea*0.75;
      const meaningfulLightContainer=isWhite(fillColorValue)&&!pageSized&&area>pageArea*0.01;
      const visibleLightCandidate=isWhite(fillColorValue)&&!pageSized&&area>pageArea*0.000002&&width>=1.5&&height>=1.5;
      const doFill=fillEnabled&&(!isWhite(fillColorValue)||preserveSubtleFill||meaningfulLightContainer||visibleLightCandidate);
      const doStroke=strokeEnabled;
      if(!doFill&&!doStroke)return;
      if(pageSized&&isWhite(fillColorValue))return;
      const scale=Math.max(Math.abs(m[0]||1),Math.abs(m[3]||1));
      const thickness=Math.max(0.25,Math.abs(lineWidth||1)*scale);
      if(doStroke&&subpath.closed&&width>=8&&height>=8){
        const tol=Math.max(3,Math.min(width,height)*0.12);
        const nearEdge=point=>
          Math.abs(point.x-x)<=tol||
          Math.abs(point.x-(x+width))<=tol||
          Math.abs(point.y-y)<=tol||
          Math.abs(point.y-(y+height))<=tol;
        const hasLeft=points.some(point=>Math.abs(point.x-x)<=tol);
        const hasRight=points.some(point=>Math.abs(point.x-(x+width))<=tol);
        const hasTop=points.some(point=>Math.abs(point.y-y)<=tol);
        const hasBottom=points.some(point=>Math.abs(point.y-(y+height))<=tol);
        const segments=points.slice(1).map((point,index)=>({
          dx:Math.abs(point.x-points[index].x),
          dy:Math.abs(point.y-points[index].y)
        })).filter(segment=>segment.dx>1e-6||segment.dy>1e-6);
        const orthogonalSegments=segments.filter(segment=>
          segment.dx<=Math.max(0.2,tol*0.08)||segment.dy<=Math.max(0.2,tol*0.08)
        ).length;
        const isAxisAlignedOutline=segments.length>0&&orthogonalSegments/segments.length>=0.72;
        if(hasLeft&&hasRight&&hasTop&&hasBottom&&points.every(nearEdge)&&isAxisAlignedOutline){
          const inferredContainerFill=!doFill&&strokeEnabled&&subpath.closed&&width>=18&&height>=18&&!isWhite(strokeColorValue);
          out.push({
            id:uid(),type:'vector',kind:'roundRect',pageIndex:pi,
            x,y,width,height,zIndex:nextVectorZIndex(),
            fill:doFill||inferredContainerFill,stroke:true,
            fillColor:doFill?fillColorValue:'#f8f7f7',
            strokeColor:strokeColorValue,
            color:strokeColorValue,
            thickness
          });
          return;
        }
      }
      out.push({
        id:uid(),type:'vector',kind:'path',pageIndex:pi,
        x,y,width,height,points,zIndex:nextVectorZIndex(),
        closed:subpath.closed!==false,
        fill:doFill,stroke:doStroke,
        fillColor:fillColorValue,
        strokeColor:strokeColorValue,
        thickness
      });
    };
    const addCompoundPath=(subpaths,fillColorValue,strokeColorValue,strokeEnabled=true,fillEnabled=true)=>{
      const validSubpaths=(subpaths||[]).filter(subpath=>subpath?.points?.length>=4);
      if(!validSubpaths.length)return;
      fillColorValue=effectiveFillColor(fillColorValue);
      strokeColorValue=effectiveStrokeColor(strokeColorValue);
      const fillLum=luminance(fillColorValue);
      const preserveSubtleFill=strokeEnabled&&Number.isFinite(fillLum)&&fillLum<253;
      const pageArea=Math.max(1,(vp.width||0)*(vp.height||0));
      const m=vm();
      let contours=validSubpaths.map(subpath=>subpath.points
        .map(point=>apply(m,point.x,point.y))
        .map(([x,y])=>({x,y}))
        .filter(point=>Number.isFinite(point.x+point.y)))
        .filter(points=>points.length>=3);
      contours=contours.map(points=>clipPolygonToBox(points,clipBox)).filter(points=>points.length>=3);
      if(!contours.length)return;
      const points=contours.flat();
      const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
      const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
      if(width<1||height<1||!Number.isFinite(x+y+width+height))return;
      const area=width*height;
      const pageSized=area>pageArea*0.75;
      const meaningfulLightContainer=isWhite(fillColorValue)&&!pageSized&&area>pageArea*0.01;
      const visibleLightCandidate=isWhite(fillColorValue)&&!pageSized&&area>pageArea*0.000002&&width>=1.5&&height>=1.5;
      const doFill=fillEnabled&&(!isWhite(fillColorValue)||preserveSubtleFill||meaningfulLightContainer||visibleLightCandidate);
      const doStroke=strokeEnabled;
      if(!doFill&&!doStroke)return;
      if(pageSized&&isWhite(fillColorValue))return;
      const scale=Math.max(Math.abs(m[0]||1),Math.abs(m[3]||1));
      const thickness=Math.max(0.25,Math.abs(lineWidth||1)*scale);
      out.push({
        id:uid(),type:'vector',kind:'path',pageIndex:pi,
        x,y,width,height,points,contours,zIndex:nextVectorZIndex(),
        closed:true,
        fill:doFill,stroke:doStroke,
        fillColor:fillColorValue,
        strokeColor:strokeColorValue,
        thickness
      });
    };
    const parsePath=args=>{
      const kinds=args?.[0]||[],coords=args?.[1]||[];
      const shapes=[],subpaths=[];let ptr=0,last=null,start=null,current=null;
      const startSubpath=point=>{
        current={points:[point],closed:false};
        subpaths.push(current);
        start=point;
        last=point;
      };
      const addPoint=point=>{
        if(!current)startSubpath(point);
        else current.points.push(point);
        if(last)shapes.push({kind:'line',x1:last.x,y1:last.y,x2:point.x,y2:point.y});
        last=point;
      };
      const segmentCurve=(p0,p1,p2,p3)=>{
        let prev=p0;
        for(let step=1;step<=8;step++){
          const t=step/8,mt=1-t;
          const next={
            x:mt*mt*mt*p0.x+3*mt*mt*t*p1.x+3*mt*t*t*p2.x+t*t*t*p3.x,
            y:mt*mt*mt*p0.y+3*mt*mt*t*p1.y+3*mt*t*t*p2.y+t*t*t*p3.y
          };
          shapes.push({kind:'line',x1:prev.x,y1:prev.y,x2:next.x,y2:next.y});
          if(current)current.points.push(next);
          prev=next;
        }
        last=p3;
      };
      for(const kind of kinds){
        if(kind===19){
          const rect={kind:'rect',x:Number(coords[ptr++]),y:Number(coords[ptr++]),width:Number(coords[ptr++]),height:Number(coords[ptr++])};
          shapes.push(rect);
          const x2=rect.x+rect.width,y2=rect.y+rect.height;
          subpaths.push({
            closed:true,
            points:[
              {x:rect.x,y:rect.y},
              {x:x2,y:rect.y},
              {x:x2,y:y2},
              {x:rect.x,y:y2},
              {x:rect.x,y:rect.y}
            ]
          });
          last=null;start=null;current=null;
        }else if(kind===13){
          startSubpath({x:Number(coords[ptr++]),y:Number(coords[ptr++])});
        }else if(kind===14){
          const next={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          addPoint(next);
        }else if(kind===15){
          const p0=last;
          const p1={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          const p2={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          const p3={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          if(p0)segmentCurve(p0,p1,p2,p3);
          else last=p3;
        }else if(kind===16){
          const p0=last;
          const p2={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          const p3={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          if(p0)segmentCurve(p0,p0,p2,p3);
          else last=p3;
        }else if(kind===17){
          const p0=last;
          const p1={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          const p3={x:Number(coords[ptr++]),y:Number(coords[ptr++])};
          if(p0)segmentCurve(p0,p1,p3,p3);
          else last=p3;
        }else if(kind===18){
          if(current&&start&&last){
            const dx=Math.abs(last.x-start.x),dy=Math.abs(last.y-start.y);
            if(dx>1e-6||dy>1e-6){
              shapes.push({kind:'line',x1:last.x,y1:last.y,x2:start.x,y2:start.y});
              current.points.push(start);
            }
            current.closed=true;
          }
          last=start;
          current=null;
          start=null;
        }else{
          ptr+=0;
        }
      }
      return{shapes,subpaths};
    };
    const pathShapes=value=>Array.isArray(value)?value:(value?.shapes||[]);
    const pathSubpaths=value=>Array.isArray(value)?[]:(value?.subpaths||[]);
    const pathClipBounds=value=>{
      const points=pathSubpaths(value).flatMap(subpath=>subpath.points||[])
        .map(point=>apply(vm(),point.x,point.y))
        .filter(point=>Number.isFinite(point[0]+point[1]));
      if(!points.length)return null;
      const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
      const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
      return width>0&&height>0?{x,y,width,height}:null;
    };
    const applyGState=entries=>{
      const items=Array.isArray(entries?.[0])&&Array.isArray(entries[0]?.[0])?entries[0]:entries;
      for(const item of items||[]){
        const key=item?.[0];
        const value=Number(item?.[1]);
        if(!Number.isFinite(value))continue;
        if(key==='CA')strokeAlpha=Math.max(0,Math.min(1,value));
        else if(key==='ca')fillAlpha=Math.max(0,Math.min(1,value));
      }
    };
    const strokePath=(value=path)=>{
      const subpaths=pathSubpaths(value).filter(subpath=>subpath.points?.length>=3);
      if(subpaths.length){
        for(const subpath of subpaths){
          if(subpath.closed){
            addPath(subpath,fillColor,strokeColor,true,false);
          }else{
            for(let i=1;i<subpath.points.length;i++){
              const a=subpath.points[i-1],b=subpath.points[i];
              addLine({x1:a.x,y1:a.y,x2:b.x,y2:b.y},strokeColor);
            }
          }
        }
      }else for(const shape of pathShapes(value))shape.kind==='line'?addLine(shape,strokeColor):addRect(shape,strokeColor,'strokeRect');
      path=null;
    };
    const filledSubpaths=value=>pathSubpaths(value)
      .filter(subpath=>subpath?.points?.length>=3)
      // PDF fills implicitly close every subpath. Restricting this to an
      // explicit `closePath` drops valid filled artwork such as logos/icons.
      .map(subpath=>subpath.closed ? subpath : {...subpath,closed:true});
    const fillPath=(value=path)=>{
      const subpaths=filledSubpaths(value);
      if(subpaths.length>1)addCompoundPath(subpaths,fillColor,strokeColor,false);
      else if(subpaths.length)for(const subpath of subpaths)addPath(subpath,fillColor,strokeColor,false);
      else for(const shape of pathShapes(value))if(shape.kind==='rect')addRect(shape,fillColor,'fillRect');
      path=null;
    };
    const fillStrokePath=()=>{
      const value=path;
      const subpaths=filledSubpaths(value);
      if(subpaths.length>1)addCompoundPath(subpaths,fillColor,strokeColor,true);
      else if(subpaths.length)for(const subpath of subpaths)addPath(subpath,fillColor,strokeColor,true);
      else{fillPath(value);strokePath(value);}
      path=null;
    };
    for(let i=0;i<opList.fnArray.length;i++){
      const fn=opList.fnArray[i],args=opList.argsArray[i]||[];
        if(fn===OPS.save)stack.push({ctm:ctm.slice(),strokeColor,fillColor,lineWidth,strokeAlpha,fillAlpha,dashPattern:[...dashPattern],dashPhase,clipBox:{...clipBox}});
        else if(fn===OPS.restore){const s=stack.pop();if(s){ctm=s.ctm;strokeColor=s.strokeColor;fillColor=s.fillColor;lineWidth=s.lineWidth;strokeAlpha=s.strokeAlpha;fillAlpha=s.fillAlpha;dashPattern=s.dashPattern;dashPhase=s.dashPhase;clipBox=s.clipBox;}}
      else if(fn===OPS.transform)ctm=mul(ctm,args);
      else if(fn===OPS.setStrokeRGBColor)strokeColor=colorHex(args);
      else if(fn===OPS.setFillRGBColor)fillColor=colorHex(args);
      else if(fn===OPS.setStrokeGray)strokeColor=grayHex(args);
      else if(fn===OPS.setFillGray)fillColor=grayHex(args);
      else if(fn===OPS.setStrokeCMYKColor)strokeColor=cmykHex(args);
      else if(fn===OPS.setFillCMYKColor)fillColor=cmykHex(args);
      else if(fn===OPS.setStrokeColor||fn===OPS.setStrokeColorN){const values=colorNumbers(args);if(values.length>=3)strokeColor=colorHex(values);else if(values.length===1)strokeColor=grayHex(values);}
      else if(fn===OPS.setFillColor||fn===OPS.setFillColorN){const values=colorNumbers(args);if(values.length>=3)fillColor=colorHex(values);else if(values.length===1)fillColor=grayHex(values);}
      else if(fn===OPS.setGState)applyGState(args);
      else if(fn===OPS.beginGroup){
        groupAlphaStack.push({stroke:groupStrokeAlpha,fill:groupFillAlpha,strokeAlpha,fillAlpha});
        groupStrokeAlpha*=strokeAlpha;
        groupFillAlpha*=fillAlpha;
        strokeAlpha=1;
        fillAlpha=1;
      }
      else if(fn===OPS.endGroup){
        const s=groupAlphaStack.pop();
        if(s){groupStrokeAlpha=s.stroke;groupFillAlpha=s.fill;strokeAlpha=s.strokeAlpha;fillAlpha=s.fillAlpha;}
      }
      else if(fn===OPS.setLineWidth)lineWidth=Number(args?.[0]??1)||1;
      else if(fn===OPS.setDash){
        dashPattern=Array.from(args?.[0]||[]).map(value=>Math.max(0,Number(value)||0));
        dashPhase=Math.max(0,Number(args?.[1])||0);
      }
      else if(fn===OPS.constructPath)path=parsePath(args);
      else if(fn===OPS.clip||fn===OPS.eoClip){
        const nextClip=pathClipBounds(path);
        clipBox=nextClip?(rectIntersection(clipBox,nextClip)||{x:0,y:0,width:0,height:0}):clipBox;
      }
      else if(fn===OPS.endPath)path=null;
      else if(fn===OPS.stroke)strokePath();
      else if(fn===OPS.fill||fn===OPS.eoFill)fillPath();
      else if(fn===OPS.fillStroke||fn===OPS.eoFillStroke)fillStrokePath();
    }
    return this._coalesceVectorObjs(out.filter(v=>v.width>=0.5&&v.height>=0.5)).slice(0,2500);
  }

  _coalesceVectorObjs(vectors){
    const lineLikes=[],other=[];
    const cleanColor=v=>String(v.color||v.strokeColor||v.fillColor||'#000000').toLowerCase();
    const asLine=v=>{
      const horizontal=(v.width||0)>=(v.height||0);
      const thickness=Math.max(0.25,Number(v.thickness||0),horizontal?(v.height||0):(v.width||0));
      const color=cleanColor(v);
      if(horizontal){
        const y=(v.y||0)+(v.height||0)/2;
        return{...v,kind:'line',color,thickness,x1:v.x||0,y1:y,x2:(v.x||0)+(v.width||0),y2:y};
      }
      const x=(v.x||0)+(v.width||0)/2;
      return{...v,kind:'line',color,thickness,x1:x,y1:v.y||0,x2:x,y2:(v.y||0)+(v.height||0)};
    };
    for(const v of vectors||[]){
      const pathWidth=Number(v?.width||0);
      const pathHeight=Number(v?.height||0);
      const pathLongSide=Math.max(pathWidth,pathHeight);
      const pathShortSide=Math.min(pathWidth,pathHeight);
      const thinPath=v?.kind==='path'&&pathShortSide<=3.5&&pathLongSide>=16;
      const lineDx=Math.abs(Number(v?.x2||0)-Number(v?.x1||0));
      const lineDy=Math.abs(Number(v?.y2||0)-Number(v?.y1||0));
      const lineThickness=Math.max(1,Number(v?.thickness||1));
      const axisAlignedLine=v?.kind==='line'&&(lineDx<=lineThickness*1.5||lineDy<=lineThickness*1.5);
      if(axisAlignedLine||thinPath)lineLikes.push(asLine(v));
      else other.push(v);
    }
    const groups=new Map();
    for(const line of lineLikes){
      const horizontal=Math.abs((line.x2||0)-(line.x1||0))>=Math.abs((line.y2||0)-(line.y1||0));
      const axis=horizontal?((line.y1||0)+(line.y2||0))/2:((line.x1||0)+(line.x2||0))/2;
      const key=[
        line.pageIndex,
        line.color,
        (line.dash || []).map(value => Math.round(Number(value || 0) * 10) / 10).join(','),
        horizontal?'h':'v',
        Math.round(axis*2)/2,
        Math.round((line.thickness||1)*2)/2
      ].join('|');
      if(!groups.has(key))groups.set(key,{horizontal,items:[]});
      groups.get(key).items.push(line);
    }
    const merged=[];
    for(const group of groups.values()){
      const items=group.items.map(line=>{
        const a=group.horizontal?line.x1:line.y1;
        const b=group.horizontal?line.x2:line.y2;
        return{...line,start:Math.min(a,b),end:Math.max(a,b)};
      }).sort((a,b)=>a.start-b.start);
      let cur=null;
      const flush=()=>{
        if(!cur)return;
        if(group.horizontal){
          const y=((cur.y1||0)+(cur.y2||0))/2;
          const thickness=Math.max(0.25,cur.thickness||1);
          merged.push({...cur,x:cur.start,y:y-thickness/2,width:Math.max(thickness,cur.end-cur.start),height:thickness,x1:cur.start,y1:y,x2:cur.end,y2:y,kind:'line'});
        }else{
          const x=((cur.x1||0)+(cur.x2||0))/2;
          const thickness=Math.max(0.25,cur.thickness||1);
          merged.push({...cur,x:x-thickness/2,y:cur.start,width:thickness,height:Math.max(thickness,cur.end-cur.start),x1:x,y1:cur.start,x2:x,y2:cur.end,kind:'line'});
        }
        cur=null;
      };
      for(const item of items){
        if(!cur){cur={...item};continue;}
        const gap=item.start-cur.end;
        // Keep intentional PDF dash gaps. The previous tolerance merged nearby
        // segments into a continuous line, erasing dotted timelines and charts.
        if(gap<=Math.max(0.25,(cur.thickness||1)*0.15)){
          cur.end=Math.max(cur.end,item.end);
        }else{
          flush();
          cur={...item};
        }
      }
      flush();
    }
    return [...other,...merged];
  }

  _buildTextObjs(items,vp,pi,styles={},colors=[],fontDetails={},linkObjs=[]){
    const fontHintsByName=this._fontHintMap(items);
    // Some PDFs embed a one-glyph dingbat font whose ToUnicode map labels a
    // check mark as the ASCII letter X. Decode only fonts used exclusively for
    // repeated isolated X glyphs; real prose/code fonts remain untouched.
    const glyphsByFont=new Map();
    for(const item of items||[]){
      const fontName=String(item?.fontName||'');
      const glyph=String(item?.str||'').trim();
      if(!fontName||!glyph)continue;
      const values=glyphsByFont.get(fontName)||[];
      values.push(glyph);
      glyphsByFont.set(fontName,values);
    }
    const checkmarkFonts=new Set([...glyphsByFont.entries()]
      .filter(([fontName,glyphs])=>glyphs.length>=3&&glyphs.every(glyph=>glyph==='X')&&
        /monospace/i.test(String(styles?.[fontName]?.fontFamily||'')))
      .map(([fontName])=>fontName));
    const linkRects=(linkObjs||[])
      .filter(link=>link&&link.type===OT.LINK&&link.width>0&&link.height>0)
      .map(link=>({x:link.x,y:link.y,width:link.width,height:link.height,href:link.data?.href||'',linkType:link.data?.linkType||''}));
    let mapped=items.map((it,idx)=>{
      const[,b,,,e,f]=it.transform;
      const[cx,cy]=this._vpt(e,f,vp);
      // Font size: use the magnitude of the full transform, not just [3]
      // For rotated/scaled text, transform[3] might be near zero while actual size is in [0]
      const scaleX=Math.hypot(it.transform[0],it.transform[1]);
      const scaleY=Math.hypot(it.transform[2],it.transform[3]);
      const fs=Math.max(4*RENDER_SCALE,Math.max(scaleX,scaleY)*Math.abs(vp.transform[0]));
      const styleName=this._styleName(it,styles,fontHintsByName,fontDetails);
      const sourceText=checkmarkFonts.has(String(it.fontName||''))&&String(it.str||'').trim()==='X'?'✓':it.str;
      const decodedSubsetText=decodeShiftedAsciiSubsetText(sourceText,it.fontName,it._shiftedSubsetFont);
      const colorInfo=colors[idx];
      const itemColor=typeof colorInfo==='string'?colorInfo:colorInfo?.color;
      return{...it,str:decodedSubsetText,_decodedCheckmark:sourceText!==it.str,_decodedSubset:decodedSubsetText!==it.str,_cx:cx,_cy:cy,_fs:fs,_angle:Math.atan2(b,it.transform[0])*180/Math.PI,_styleName:styleName,_styleKey:this._styleKey(styleName,fs),_color:itemColor||'#000000',_colorRanges:Array.isArray(colorInfo?.ranges)?colorInfo.ranges:null};
    }).sort((a,b)=>a._cy-b._cy||a._cx-b._cx);

    const scale=Math.abs(vp.transform[0]);
    mapped=collapseOverlappingTextItemGrams(mapped,scale);
    const segs=[];
    mapped.forEach((it,idx)=>{
      let cursorX=it._cx;
      let cursorY=it._cy;
      let rawCursorX=it._cx;
      let rawCursorY=it._cy;
      const textAngleRad=(-Number(it._angle||0)*Math.PI)/180;
      const textDirX=Math.cos(textAngleRad);
      const textDirY=Math.sin(textAngleRad);
      const itemWidth=(it.width||0)*scale;
      const measureCtx=_measureCtx||(_measureCtx=document.createElement('canvas').getContext('2d'));
      measureCtx.font=_canvasTextFont({fontFamily:this._font(it._styleName||it.fontName||''),fontSize:it._fs,fontWeight:this._bold(it._styleName||it.fontName||'')?'bold':'normal',fontStyle:this._italic(it._styleName||it.fontName||'')?'italic':'normal'});
      const correctedItemWidth=this._correctTextItemWidth(it,itemWidth,measureCtx);
      const approxItemBox={
        x:Math.min(it._cx,it._cx+textDirX*itemWidth),
        y:Math.min(it._cy-it._fs*1.05,it._cy+textDirY*itemWidth-it._fs*1.05),
        width:Math.max(Math.abs(textDirX*itemWidth),it._fs*.35),
        height:Math.max(it._fs*1.35,Math.abs(textDirY*itemWidth)+it._fs*1.35)
      };
      const forceTokenSplitForLinks=linkRectCoversTextBox(approxItemBox,linkRects);
      const measuredParts=_measureTextPartWidths(measureCtx,it.str,correctedItemWidth,{forceTokenSplit:forceTokenSplitForLinks});
      const coloredParts=[];
      let normalizedColorOffset=0;
      for(const measuredPart of measuredParts){
        const ranges=it._colorRanges;
        if(!ranges?.length){
          coloredParts.push({...measuredPart,color:it._color});
          normalizedColorOffset+=String(measuredPart.text||'').replace(/\s+/g,'').length;
          continue;
        }
        const chunks=[];
        let chunkText='',chunkColor=null;
        const colorAt=offset=>ranges.find(range=>offset>=range.start&&offset<range.end)?.color||it._color;
        for(const character of String(measuredPart.text||'')){
          const whitespace=/\s/.test(character);
          const color=whitespace?(chunkColor||colorAt(normalizedColorOffset)):colorAt(normalizedColorOffset);
          if(chunkText&&color!==chunkColor){
            chunks.push({text:chunkText,color:chunkColor});
            chunkText='';
          }
          chunkText+=character;
          chunkColor=color;
          if(!whitespace)normalizedColorOffset++;
        }
        if(chunkText)chunks.push({text:chunkText,color:chunkColor||it._color});
        const measuredWidths=chunks.map(chunk=>Math.max(0,measureCtx.measureText(chunk.text).width));
        const measuredWidth=measuredWidths.reduce((sum,width)=>sum+width,0);
        chunks.forEach((chunk,index)=>coloredParts.push({
          ...chunk,
          width:measuredWidth>0?measuredPart.width*(measuredWidths[index]/measuredWidth):measuredPart.width/Math.max(1,chunks.length)
        }));
      }
      let trailingSourceWhitespace=false;
      for(const part of coloredParts){
        const rawText=String(part.text||'');
        const whitespaceOnly=/^\s+$/.test(rawText);
        part.sourceSpaceBefore=!whitespaceOnly&&(trailingSourceWhitespace||/^\s/.test(rawText));
        trailingSourceWhitespace=whitespaceOnly||/\s$/.test(rawText);
      }
      let sourceWhitespacePending=false;
      coloredParts.forEach((part,segIdx)=>{
        const whitespaceOnly=/^\s+$/.test(String(part.text||''));
        const sourceSpaceBefore=!whitespaceOnly&&(sourceWhitespacePending||part.sourceSpaceBefore);
        sourceWhitespacePending=whitespaceOnly||/\s$/.test(String(part.text||''));
        const detachedSafeText = normalizeDetachedDiacriticsSafe(part.text);
        const partText = this._italic(it._styleName || it.fontName || '')
          ? normalizeBrokenMathIdentifierWhitespace(
              detachedSafeText,
              this._docxFont(it._styleName || it.fontName || '') === 'Cambria Math'
            )
          : detachedSafeText;
        const restoredMathIdentifier = partText !== detachedSafeText && partText.includes('_');
        const rawPartWidth = correctedItemWidth > 0
          ? itemWidth * (part.width / correctedItemWidth)
          : part.width;
        const leftTrim=(partText.match(/^\s*/)||[''])[0].length;
        const rightTrim=(partText.match(/\s*$/)||[''])[0].length;
        const charW=partText.length?part.width/partText.length:0;
        const rawCharW=partText.length?rawPartWidth/partText.length:0;
        const subsetDecodedText=decodeShiftedAsciiSubsetText(partText,it.fontName);
        const decodedText=decodeSymbolPrivateUseText(subsetDecodedText,it._styleName);
        const content=decodedText.trim();
        if(content){
          const baselineX=cursorX+textDirX*leftTrim*charW;
          const baselineY=cursorY+textDirY*leftTrim*charW;
          const rawBaselineX=rawCursorX+textDirX*leftTrim*rawCharW;
          const rawBaselineY=rawCursorY+textDirY*leftTrim*rawCharW;
          const x=baselineX;
          const width=Math.max(part.width-(leftTrim+rightTrim)*charW,it._fs*.35);
          const rawWidth=Math.max(rawPartWidth-(leftTrim+rightTrim)*rawCharW,it._fs*.35);
          const textBox={x,y:baselineY-it._fs*0.95,width,height:it._fs*1.25};
          const segmentColor=part.color||it._color;
        const decodedSymbol=decodedText!==subsetDecodedText||!!it._decodedCheckmark;
          segs.push({
            ...it,
            _color:segmentColor,
            _segIdx:segIdx,_itemIdx:idx,_text:content,_sourceSpaceBefore:sourceSpaceBefore,_decodedSymbol:decodedSymbol,_decodedSubset:subsetDecodedText!==partText,
            _restoredMathIdentifier:restoredMathIdentifier,
            _preserveItemWhitespace:!!it._colorRanges,
            _disableScriptDetection:!!it._colorRanges,
            _styleKey: decodedSymbol ? `Times New Roman|false|false|${_roundNum(it._fs,1)}` : it._styleKey,
            _baselineX:baselineX,_baselineY:baselineY,
            _rawX:rawBaselineX,_rawY:rawBaselineY,_rawWidth:rawWidth,_rawEnd:rawBaselineX+rawWidth,
            _x:x,_y:baselineY-it._fs*0.85,_width:width,_end:x+width
          });
        }
        cursorX+=textDirX*part.width;
        cursorY+=textDirY*part.width;
        rawCursorX+=textDirX*rawPartWidth;
        rawCursorY+=textDirY*rawPartWidth;
      });
    });

    const isNonOrthogonalRotated=seg=>{
      const angle=normalizeDegrees(seg?._angle||0);
      const fromHorizontal=Math.min(angle,360-angle);
      return fromHorizontal>5;
    };
    const regularSegs=segs.filter(seg=>!isNonOrthogonalRotated(seg));
    const rotatedSegs=segs.filter(isNonOrthogonalRotated);

    const groupedLines=[];let line=[];let lineAnchor=null;
    for(const seg of regularSegs.sort((a,b)=>a._cy-b._cy||a._x-b._x)){
      if(!line.length){line.push(seg);lineAnchor=seg;continue;}
      // Compare with the dominant body baseline, not the immediately previous
      // fragment. Superscripts and subscripts can otherwise form a vertical
      // stepping stone that chains two adjacent PDF rows into one Word line.
      const anchor=lineAnchor||line[0];
      if(Math.abs(seg._cy-anchor._cy)<Math.max(2,Math.max(seg._fs,anchor._fs)*0.45)){
        line.push(seg);
        if(Number(seg._fs||0)>Number(anchor._fs||0))lineAnchor=seg;
      }else{
        groupedLines.push(line);
        line=[seg];
        lineAnchor=seg;
      }
    }
    if(line.length)groupedLines.push(line);

    const clusterLines=groupedLines.map(lineSegs=>lineSegs.slice());
    const lineStats=lineSegs=>{
      const fs=lineSegs.reduce((sum,seg)=>sum+(seg._fs||0),0)/Math.max(1,lineSegs.length);
      const cy=lineSegs.reduce((sum,seg)=>sum+(seg._cy||0),0)/Math.max(1,lineSegs.length);
      const minX=Math.min(...lineSegs.map(seg=>seg._x));
      const maxX=Math.max(...lineSegs.map(seg=>seg._end));
      const text=lineSegs.map(seg=>String(seg._text||'')).join('');
      return{fs,cy,minX,maxX,text};
    };
    const citationOnly=text=>/^[\d\s,[\]().:;\-\u2013\u2014]+$/.test(String(text||'').trim());
    clusterLines.forEach((lineSegs,index)=>{
      if(!lineSegs.length)return;
      const stats=lineStats(lineSegs);
      if(!citationOnly(stats.text))return;
      let bestIndex=-1,bestScore=Infinity,bestStats=null;
      clusterLines.forEach((candidate,candidateIndex)=>{
        if(candidateIndex===index||!candidate.length)return;
        const candidateStats=lineStats(candidate);
        if(citationOnly(candidateStats.text))return;
        const maxFont=Math.max(stats.fs,candidateStats.fs,1);
        const dy=Math.abs(stats.cy-candidateStats.cy);
        if(dy>maxFont*.75||stats.fs>candidateStats.fs*.9)return;
        const centerX=(stats.minX+stats.maxX)/2;
        if(centerX<candidateStats.minX-maxFont*5||centerX>candidateStats.maxX+maxFont*5)return;
        const score=dy+Math.abs(centerX-(candidateStats.minX+candidateStats.maxX)/2)*.02;
        if(score<bestScore){
          bestIndex=candidateIndex;
          bestScore=score;
          bestStats=candidateStats;
        }
      });
      if(bestIndex>=0&&bestStats){
        const verticalAlign=Math.abs(stats.cy-bestStats.cy)>bestStats.fs*.28
          ? stats.cy<bestStats.cy?'superscript':'subscript'
          : null;
        if(verticalAlign)lineSegs.forEach(seg=>{seg._verticalAlign=verticalAlign;});
        clusterLines[bestIndex].push(...lineSegs);
        clusterLines[index]=[];
      }
    });

    // A compact super/subscript can sit far enough from the body baseline for
    // PDF.js to group it with an unrelated line in the other column. Emitting
    // that glyph as its own absolute Word frame lets fallback-font width drift
    // move the surrounding prose underneath it. Reattach only an individual
    // smaller math/script segment that touches a neighbouring body baseline.
    const compactScriptSegment=text=>{
      const value=String(text||'').replace(/\s+/g,'').trim();
      return value.length>0&&value.length<=8&&
        /^[\p{L}\p{N}*+\-.,()×÷−√∑∏∈]+$/u.test(value);
    };
    const detachedScriptMoves=[];
    clusterLines.forEach((sourceLine,sourceIndex)=>{
      sourceLine.forEach(seg=>{
        if(!compactScriptSegment(seg._text))return;
        let bestIndex=-1,bestScore=Infinity,bestStats=null;
        clusterLines.forEach((candidate,candidateIndex)=>{
          if(candidateIndex===sourceIndex||!candidate.length)return;
          const candidateStats=lineStats(candidate);
          if(String(candidateStats.text||'').replace(/\s+/g,'').length<4||
              Number(seg._fs||0)>candidateStats.fs*.88)return;
          const dy=Math.abs(Number(seg._cy||0)-candidateStats.cy);
          if(dy<candidateStats.fs*.12||dy>candidateStats.fs*.78)return;
          const segLeft=Number(seg._x||0);
          const segRight=Number(seg._end||segLeft);
          if(segRight<candidateStats.minX-candidateStats.fs*.25||
              segLeft>candidateStats.maxX+candidateStats.fs*.25)return;
          const preceding=candidate
            .filter(item=>Number(item._end||item._x||0)<=segLeft+candidateStats.fs*.1)
            .sort((a,b)=>Number(b._end||b._x||0)-Number(a._end||a._x||0))[0];
          const following=candidate
            .filter(item=>Number(item._x||0)>=segRight-candidateStats.fs*.1)
            .sort((a,b)=>Number(a._x||0)-Number(b._x||0))[0];
          const leftGap=preceding
            ? Math.max(0,segLeft-Number(preceding._end||preceding._x||0))
            : Infinity;
          const rightGap=following
            ? Math.max(0,Number(following._x||0)-segRight)
            : Infinity;
          const attachmentGap=Math.min(leftGap,rightGap);
          if(attachmentGap>candidateStats.fs*.42)return;
          const score=dy+attachmentGap*.6;
          if(score<bestScore){
            bestIndex=candidateIndex;
            bestScore=score;
            bestStats=candidateStats;
          }
        });
        if(bestIndex>=0&&bestStats){
          detachedScriptMoves.push({
            seg,sourceIndex,bestIndex,
            verticalAlign:Number(seg._cy||0)<bestStats.cy?'superscript':'subscript'
          });
        }
      });
    });
    detachedScriptMoves.forEach(({seg,sourceIndex,bestIndex,verticalAlign})=>{
      const sourceLine=clusterLines[sourceIndex];
      const sourcePosition=sourceLine.indexOf(seg);
      if(sourcePosition<0)return;
      sourceLine.splice(sourcePosition,1);
      seg._verticalAlign=verticalAlign;
      clusterLines[bestIndex].push(seg);
    });

    // Tables drawn with horizontal rules often have no vertical grid for the
    // table detector to use. Their numeric cells still reveal stable columns:
    // the same value centres recur across several adjacent rows. Preserve
    // those source anchors instead of merging neighbouring cells into a
    // single Word frame whose fallback-font metrics collapse the spacing.
    const tabularValueText=text=>/^(?:[-\u2013\u2014]|n\/a|\d[\d.,%+\/-]*[A-Za-z]?)$/i.test(String(text||'').trim());
    const valueAnchorBuckets=[];
    clusterLines.forEach((lineSegs,lineIndex)=>{
      for(const seg of lineSegs){
        if(!tabularValueText(seg._text)||seg._verticalAlign)continue;
        const center=(Number(seg._x||0)+Number(seg._end||seg._x||0))/2;
        const tolerance=Math.max(4,Number(seg._fs||0)*.7);
        let bucket=valueAnchorBuckets.find(candidate=>Math.abs(candidate.center-center)<=Math.max(candidate.tolerance,tolerance));
        if(!bucket){
          bucket={center,tolerance,lines:new Set()};
          valueAnchorBuckets.push(bucket);
        }else{
          const count=bucket.lines.size;
          bucket.center=(bucket.center*count+center)/(count+1);
          bucket.tolerance=Math.max(bucket.tolerance,tolerance);
        }
        bucket.lines.add(lineIndex);
      }
    });
    const stableValueAnchors=valueAnchorBuckets.filter(bucket=>bucket.lines.size>=3);
    const closestStableValueAnchor=(center,tolerance=0)=>{
      let best=null,bestDistance=Infinity;
      for(const anchor of stableValueAnchors){
        const distance=Math.abs(anchor.center-center);
        if(distance<=Math.max(anchor.tolerance,tolerance)&&distance<bestDistance){
          best=anchor;
          bestDistance=distance;
        }
      }
      return best;
    };
    const numericTabularLineIndexes=new Set();
    clusterLines.forEach((lineSegs,lineIndex)=>{
      const anchors=[];
      for(const seg of lineSegs){
        if(!tabularValueText(seg._text)||seg._verticalAlign)continue;
        const center=(Number(seg._x||0)+Number(seg._end||seg._x||0))/2;
        const anchor=closestStableValueAnchor(center);
        if(anchor&&!anchors.includes(anchor))anchors.push(anchor);
      }
      if(anchors.length>=2)numericTabularLineIndexes.add(lineIndex);
    });
    const tabularAnchorsByLine=new Map();
    clusterLines.forEach((lineSegs,lineIndex)=>{
      const nearNumericTableLine=[...numericTabularLineIndexes].some(index=>Math.abs(index-lineIndex)<=4);
      if(!numericTabularLineIndexes.has(lineIndex)&&!nearNumericTableLine)return;
      const itemGroups=new Map();
      for(const seg of lineSegs){
        const key=seg._itemIdx;
        if(!itemGroups.has(key))itemGroups.set(key,[]);
        itemGroups.get(key).push(seg);
      }
      const anchorsByItem=new Map();
      const distinctAnchors=[];
      for(const [itemIndex,itemSegs] of itemGroups){
        const left=Math.min(...itemSegs.map(seg=>Number(seg._x||0)));
        const right=Math.max(...itemSegs.map(seg=>Number(seg._end||seg._x||0)));
        const fontSize=Math.max(...itemSegs.map(seg=>Number(seg._fs||0)));
        const anchor=closestStableValueAnchor((left+right)/2,Math.max(4,fontSize*.75));
        if(!anchor)continue;
        anchorsByItem.set(itemIndex,anchor);
        if(!distinctAnchors.includes(anchor))distinctAnchors.push(anchor);
      }
      const lineText=lineSegs.map(seg=>String(seg._text||'').trim()).filter(Boolean).join(' ');
      const averageFontSize=lineSegs.reduce((sum,seg)=>sum+Number(seg._fs||0),0)/Math.max(1,lineSegs.length);
      const compactHeaderLike=itemGroups.size>=2&&itemGroups.size<=12&&
        lineText.length<=96&&averageFontSize<=20;
      if(numericTabularLineIndexes.has(lineIndex)||(nearNumericTableLine&&compactHeaderLike&&distinctAnchors.length>=2)){
        tabularAnchorsByLine.set(lineSegs,anchorsByItem);
      }
    });

    const objs=[];
    clusterLines.filter(lineSegs=>lineSegs.length).forEach(lineSegs=>{
      markInlineScriptSegments(lineSegs);
      const tabularAnchors=tabularAnchorsByLine.get(lineSegs)||new Map();
      const valueAnchorFor=seg=>{
        if(!seg||seg._verticalAlign)return null;
        return tabularAnchors.get(seg._itemIdx)||null;
      };
      const compactInlineToken=text=>/^[A-Za-z0-9([][A-Za-z0-9._%+()\/-]*$/.test(String(text||'').trim())&&String(text||'').trim().length<=40;
      const smallLabelLine=(()=>{
        const texts=lineSegs.map(seg=>String(seg._text||'').trim()).filter(Boolean);
        if(texts.length<4)return false;
        const avgFs=lineSegs.reduce((sum,seg)=>sum+(seg._fs||0),0)/Math.max(1,lineSegs.length);
        if(avgFs>16)return false;
        const compact=texts.filter(compactInlineToken).length;
        const signal=texts.filter(text=>/[0-9%._+\-/]|^[A-Z]{2,}$|^(AP|AMC|GRE|SAT|LSAT|USABO|gpt|RLHF)/i.test(text)).length;
        const proseLower=texts.filter(text=>/^[a-z]{4,}$/.test(text)).length;
        return compact/texts.length>=0.72&&signal>=2&&proseLower/texts.length<0.55;
      })();
      const topHeaderLabelLine=(()=>{
        const distinctItems=new Set(lineSegs.map(seg=>seg._itemIdx)).size;
        const maxY=Math.max(...lineSegs.map(seg=>Number(seg._y||0)));
        const textLength=lineSegs.reduce((sum,seg)=>sum+String(seg._text||'').trim().length,0);
        const avgFs=lineSegs.reduce((sum,seg)=>sum+Number(seg._fs||0),0)/Math.max(1,lineSegs.length);
        return distinctItems>=4&&maxY<=(vp?.height||0)*.12&&textLength<=180&&avgFs<=18;
      })();
      let cluster=[];
      const flush=()=>{
        if(!cluster.length)return;
        objs.push(this._textClusterObj(cluster,pi,objs.length));
        cluster=[];
      };
      for(const seg of lineSegs.sort((a,b)=>a._x-b._x)){
        if(!cluster.length){cluster.push(seg);continue;}
        const last=cluster[cluster.length-1];
        const gap=segmentBoundaryGap(last, seg);
        const sizeRatio=Math.min(seg._fs,last._fs)/Math.max(seg._fs,last._fs);
        const avgCharW=Math.max(
          1,
          last._text?.length?last._width/last._text.length:0,
          seg._text?.length?seg._width/seg._text.length:0
        );
        const samePdfTextItem=seg._itemIdx===last._itemIdx;
        const maxFont=Math.max(seg._fs,last._fs);
        const maxWordGap=Math.max(maxFont*0.55,Math.min(maxFont*2.0,avgCharW*5.0));
        const bulletLead=/^[•\u2022]$/.test(String(last._text||''));
        const bulletContinuationOk=bulletLead&&seg._itemIdx===last._itemIdx+1;
        const allowedGap=samePdfTextItem?maxFont*0.75:(bulletContinuationOk?maxFont*2.6:maxWordGap);
        const joinedText=`${last._text||''}${seg._text||''}`;
        const citationLike=/^[\s\d,\[\]\(\).:-]+$/.test(joinedText);
        const closeCrossItemGap=!samePdfTextItem&&gap<=Math.max(maxFont*0.45,avgCharW*2.0);
        const lastText=String(last._text||'');
        const segText=String(seg._text||'');
        const punctuationGapOk=gap>=-Math.max(maxFont*0.25,avgCharW)&&
          gap<=Math.max(maxFont*0.62,avgCharW*1.7);
        const punctuationContinuation=!samePdfTextItem&&punctuationGapOk&&(/[\[(,]$/.test(lastText)||/^[\d\]\),.;:%]/.test(segText));
        const inlineDashSeparator=!samePdfTextItem&&
          /[-\u2013\u2014]$/.test(lastText.trim())&&
          /^[A-Z]/.test(segText.trim())&&
          gap<=Math.max(maxFont*1.35,avgCharW*3.25);
        const lineEndHyphenContinuation=!samePdfTextItem&&
          /-$/.test(lastText)&&
          gap>Math.max(1,avgCharW*0.8)&&
          !inlineDashSeparator;
        const shiftedInline=!!(seg._verticalAlign||last._verticalAlign)&&gap<=Math.max(maxFont*6,avgCharW*24);
        const smallMarkerContinuation=!samePdfTextItem&&
          /^[\d*\u2020\u2021]+$/.test(segText.trim())&&
          seg._fs<last._fs*0.88&&
          gap>=-Math.max(maxFont*1.5,avgCharW*8)&&
          gap<=Math.max(maxFont*.9,avgCharW*4);
        if(smallMarkerContinuation)seg._verticalAlign='superscript';
        // A compact numeric index followed by a larger text item is a
        // two-column label pattern (for example a contents page number), not
        // an inline script. Combining them makes the later auto-fit shrink the
        // label to the index's size after Word font substitution.
        const detachedNumericIndexLabel=!samePdfTextItem&&
          /^\d{1,4}$/.test(lastText.trim())&&
          /^[A-Za-z]/.test(segText.trim())&&
          last._fs<=seg._fs*.72&&
          gap>=maxFont*.35;
        // A footnote marker at the end of a table label can sit immediately
        // beside the next cell's placeholder dash. Keeping both in one frame
        // lets fallback-font metrics pull that dash into the label itself.
        const tabularDashAfterMarker=!samePdfTextItem&&
          /^[-\u2013\u2014]$/.test(segText.trim())&&
          last._verticalAlign==='superscript'&&
          /[A-Za-z]/.test(cluster.map(item=>String(item._text||'')).join(''));
        const nextValueAnchor=valueAnchorFor(seg);
        const tabularCellBoundary=!!nextValueAnchor&&
          !cluster.some(item=>valueAnchorFor(item)===nextValueAnchor);
        const minSizeRatio=(citationLike||shiftedInline||smallMarkerContinuation)?0.42:0.85;
        const pageMid=(vp?.width||0)/2;
        const accumulatedText=cluster.map(item=>String(item._text||'').trim()).filter(Boolean).join(' ');
        const clusterStartX=Number(cluster[0]?._x||last._x||0);
        const samePageHalf=pageMid>0&&
          ((clusterStartX<pageMid&&seg._x<pageMid)||(clusterStartX>=pageMid&&seg._x>=pageMid));
        const likelyProseWordContinuation=samePageHalf&&
          gap>=0&&gap<=Math.max(maxFont*1.35,avgCharW*3.25)&&
          /^[A-Za-z][A-Za-z.'-]*$/.test(lastText.trim())&&
          /^[A-Za-z][A-Za-z.'-]*$/.test(segText.trim())&&
          (/[a-z]/.test(lastText)||/[a-z]/.test(segText));
        const crossesLikelyColumnGutter=pageMid>0&&
          last._x<pageMid-maxFont*3&&
          seg._x>pageMid+maxFont*3&&
          gap>Math.max(maxFont*1.1,avgCharW*4)&&
          last._end>pageMid-maxFont*8;
        const crossesProseColumnBoundary=pageMid>0&&
          accumulatedText.length>=24&&
          clusterStartX<pageMid-maxFont*2&&seg._x>pageMid&&
          gap>Math.max(maxFont*.55,avgCharW*1.8)&&
          last._end>pageMid-maxFont*4;
        const crossesPageMidGap=pageMid>0&&
          last._end<pageMid&&seg._x>pageMid&&
          gap>Math.max(maxFont*.5,avgCharW*1.6);
        const sameVisualStyle=seg._styleKey===last._styleKey&&seg._color===last._color;
        const moderatePdfSpaceGap=!samePdfTextItem&&sameVisualStyle&&gap>=0&&
          gap<=Math.max(maxFont*1.35,avgCharW*3.25);
        const separatedTopHeaderLabel=topHeaderLabelLine&&
          !samePdfTextItem&&
          gap>Math.max(maxFont*.65,avgCharW*1.15);
        const compactInlineOverlap=!samePdfTextItem&&
          compactInlineToken(lastText)&&
          compactInlineToken(segText)&&
          seg._color===last._color&&
          seg._x>last._x&&
          gap<0&&
          gap>=-Math.max(maxFont*8,avgCharW*32);
        const compactInlineContinuation=!samePdfTextItem&&
          compactInlineToken(lastText)&&
          compactInlineToken(segText)&&
          seg._color===last._color&&
          seg._x>last._x&&
          gap>=-Math.max(maxFont*4,avgCharW*16)&&
          gap<=Math.max(maxFont*.85,avgCharW*3.5);
        const shiftedAcrossWideGap=shiftedInline&&
          gap>Math.max(maxFont*2.4,avgCharW*7);
        // A conspicuously wide gap between two PDF text items is usually a
        // column/cell boundary, even when no full boxed grid exists. Keeping
        // it in one Word frame lets fallback-font metrics move the left cell's
        // tail into the next column. Preserve the item boundary instead.
        const separatedTextItemColumns=!samePdfTextItem&&
          gap>Math.max(maxFont*.72,avgCharW*2.25)&&
          accumulatedText.length>=4&&
          segText.trim().length>=1&&
          !likelyProseWordContinuation&&
          !punctuationContinuation&&
          !smallMarkerContinuation&&
          (!shiftedInline||shiftedAcrossWideGap);
        const repeatedCompactLabel=
          compactInlineToken(lastText)&&
          compactInlineToken(segText)&&
          maxFont<=14&&
          /[0-9%._+\-/]|^[A-Z]{2,}/.test(lastText.trim())&&
          lastText.trim()===segText.trim();
        const smallSeparatedLabelBoundary=(smallLabelLine||!samePdfTextItem)&&
          maxFont<=14&&
          compactInlineToken(lastText)&&
          compactInlineToken(segText)&&
          !likelyProseWordContinuation&&
          (gap>Math.max(maxFont*.42,avgCharW*.95)||repeatedCompactLabel);
        const inlineOverlap=!samePdfTextItem&&
          (sameVisualStyle||punctuationContinuation||smallMarkerContinuation||compactInlineOverlap)&&
          seg._x>last._x&&
          gap<0&&
          gap>=-Math.max(maxFont*8,avgCharW*32);
        const blocksColumnMerge=(crossesLikelyColumnGutter||crossesProseColumnBoundary||separatedTextItemColumns||crossesPageMidGap)&&
          !punctuationContinuation&&
          !smallMarkerContinuation&&
          (!shiftedInline||crossesPageMidGap||separatedTextItemColumns)&&
          !inlineOverlap;
        const minGap=(punctuationContinuation||shiftedInline||smallMarkerContinuation||inlineOverlap)
          ? -Math.max(maxFont*8,avgCharW*32)
          : -Math.max(seg._fs,last._fs)*0.2;
        const maxGap=Math.max(
          allowedGap,
          shiftedInline?Math.max(maxFont*6,avgCharW*24):0,
          punctuationContinuation?Math.max(maxFont*1.25,avgCharW*4):0
        );
        const normalGap=gap>=minGap&&
          gap<=maxGap&&
          (samePdfTextItem||bulletContinuationOk||closeCrossItemGap||punctuationContinuation||moderatePdfSpaceGap||shiftedInline||smallMarkerContinuation||inlineOverlap||compactInlineContinuation)&&
          !blocksColumnMerge&&
          !smallSeparatedLabelBoundary&&
          !detachedNumericIndexLabel&&
          !separatedTopHeaderLabel&&
          !tabularDashAfterMarker&&
          !tabularCellBoundary&&
          !lineEndHyphenContinuation&&
          sizeRatio>=minSizeRatio&&
          Math.abs((seg._angle||0)-(last._angle||0))<=2;
        if(normalGap)cluster.push(seg);
        else{flush();cluster.push(seg);}
      }
      flush();
    });
    objs.push(...this._buildAngledTextObjs(rotatedSegs,pi,objs.length));
    return this._mergeParagraphObjs(objs);
  }

  _buildAngledTextObjs(segs,pi,orderOffset=0){
    if(!Array.isArray(segs)||!segs.length)return[];
    const out=[];
    let cluster=[];
    const compactRotatedLabelToken=text=>/^[A-Za-z0-9][A-Za-z0-9._%+()\/-]*\.?$/.test(String(text||'').trim())&&String(text||'').trim().length<=36;
    const flush=()=>{
      if(!cluster.length)return;
      cluster.sort((a,b)=>a._rotAlong-b._rotAlong||Number(a._itemIdx||0)-Number(b._itemIdx||0)||Number(a._segIdx||0)-Number(b._segIdx||0));
      const first=cluster[0];
      const fs=cluster.reduce((sum,seg)=>sum+(seg._fs||0),0)/Math.max(1,cluster.length);
      const styleName=first._styleName||first.fontName||'';
      const fontFamily=this._font(styleName);
      const fontSize=_roundNum(fs/RENDER_SCALE,1);
      const fontWeight=this._bold(styleName)?'bold':'normal';
      const fontStyle=this._italic(styleName)?'italic':'normal';
      const color=first._color||'#000000';
      let content='';
      cluster.forEach((seg,index)=>{
        if(index>0){
          const prev=cluster[index-1];
          const gap=Number.isFinite(seg._rotStart-prev._rotEnd)?seg._rotStart-prev._rotEnd:seg._x-prev._end;
          const crossItemLabelWords=seg._itemIdx!==prev._itemIdx&&
            compactRotatedLabelToken(prev._text)&&
            compactRotatedLabelToken(seg._text);
          if((gap>-Math.max(1,fs*.25)||crossItemLabelWords)&&!/^[\]\),.;:%]/.test(String(seg._text||'')))content+=' ';
        }
        content+=seg._text||'';
      });
      content=content.replace(/\s+/g,' ').trim();
      if(!content){cluster=[];return;}
      const rotStart=Math.min(...cluster.map(seg=>Number.isFinite(seg._rotStart)?seg._rotStart:seg._x));
      const rotEnd=Math.max(...cluster.map(seg=>Number.isFinite(seg._rotEnd)?seg._rotEnd:seg._end));
      const measuredWidth=cluster.reduce((sum,seg)=>sum+Math.max(0,Number(seg._width||0)),0)+Math.max(0,cluster.length-1)*fs*.35;
      const textWidth=Math.max(measuredWidth,rotEnd-rotStart);
      const rotation=Math.round(first._angle||0);
      const normalizedRotation=normalizeDegrees(rotation);
      const rightAngle=Math.abs(normalizedRotation-90)<=4||Math.abs(normalizedRotation-270)<=4;
      const visualBounds=rightAngle?textSegmentVisualBounds(cluster):null;
      // PDF.js exposes a rotated line from its baseline origin. Word's
      // vertical textbox is positioned from the visual top-left, so using the
      // baseline sends long labels hundreds of points down the page.
      const x=visualBounds?visualBounds.x:first._x;
      const y=visualBounds?visualBounds.y:first._y;
      const width=visualBounds
        ? Math.max(fs*.9,visualBounds.height)
        : Math.max(fs*.9,textWidth+fs*.8);
      const height=Math.max(fs*1.55,13*RENDER_SCALE,visualBounds?.width||0);
      const run={
        text:content,
        fontFamily:cleanFontNameForDocx(fontFamily),
        _docxFontFamily:this._docxFont(styleName),
        fontSize,
        _sourceFontSize:fontSize,
        bold:fontWeight==='bold',
        italic:fontStyle==='italic',
        color
      };
      out.push({
        id:uid(),type:OT.TEXT,pageIndex:pi,
        x,y,width,height,rotation,opacity:1,visible:true,
        zIndex:5+orderOffset+out.length,dirty:false,isOriginal:true,selected:false,
        data:{
          content,
          lines:[[run]],
          fontFamily,fontSize:fs,fontWeight,fontStyle,
          color,backgroundColor:'transparent',underline:false,align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0,
          _originalContent:content,
          _originalStyle:{fontFamily,fontSize:fs,fontWeight,fontStyle,color,backgroundColor:'transparent',underline:false,align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0},
          _originalBox:{x,y,width,height,rotation},
          _originalFontName:styleName,
          _pdfFontKey:first.fontName,
          _lineBoxes:[{x,y,width,height,rotation}],
          _lineAligns:['left'],
          _singleLine:true,
        }
      });
      cluster=[];
    };
    const projected=segs.map(seg=>{
      const angle=Number(seg._angle||0);
      const visualAngle=-angle;
      const angleRad=(visualAngle*Math.PI)/180;
      const ux=Math.cos(angleRad),uy=Math.sin(angleRad);
      const vx=-uy,vy=ux;
      const baselineX=Number.isFinite(seg._baselineX)?seg._baselineX:(seg._x||0);
      const baselineY=Number.isFinite(seg._baselineY)?seg._baselineY:((seg._y||0)+(seg._fs||0)*0.85);
      const along=baselineX*ux+baselineY*uy;
      const normal=baselineX*vx+baselineY*vy;
      const half=Math.max(1,(seg._width||0)/2);
      return{...seg,_rotAngle:Math.round(visualAngle/3)*3,_rotAlong:along,_rotNormal:normal,_rotStart:along-half,_rotEnd:along+half};
    }).sort((a,b)=>
      a._rotAngle-b._rotAngle||
      String(a._styleKey||'').localeCompare(String(b._styleKey||''))||
      String(a._color||'').localeCompare(String(b._color||''))||
      a._rotNormal-b._rotNormal||
      Number(a._itemIdx||0)-Number(b._itemIdx||0)||
      Number(a._segIdx||0)-Number(b._segIdx||0)||
      a._rotAlong-b._rotAlong
    );
    // PDF producers often emit each word of one angled label as a separate
    // text item. Keep separate baselines separate, but join collinear pieces
    // into one Word shape so the complete label stays aligned while editing.
    for(const seg of projected){
      if(!cluster.length){cluster=[seg];continue;}
      const first=cluster[0];
      const last=cluster[cluster.length-1];
      const fs=Math.max(1,Number(seg._fs||0),Number(last._fs||0));
      const minAlong=Math.min(seg._rotAlong,...cluster.map(item=>item._rotAlong));
      const maxAlong=Math.max(seg._rotAlong,...cluster.map(item=>item._rotAlong));
      const sameLine=
        seg._rotAngle===last._rotAngle&&
        seg._styleKey===last._styleKey&&
        seg._color===last._color&&
        Math.abs(seg._rotNormal-first._rotNormal)<=Math.max(1.25,fs*.22)&&
        maxAlong-minAlong<=fs*12;
      if(sameLine)cluster.push(seg);
      else{flush();cluster=[seg];}
    }
    flush();
    return out;
  }

  _mergeRotatedLabelObjs(objs){
    if(!Array.isArray(objs)||objs.length<2)return objs;
    const compactPhrase=text=>{
      const words=String(text||'').trim().split(/\s+/).filter(Boolean);
      return words.length>0&&words.length<=6&&words.join(' ').length<=90&&
        words.every(word=>/^[A-Za-z0-9][A-Za-z0-9._%+()\/-]*\.?$/.test(word));
    };
    const firstRun=obj=>obj?.data?.lines?.[0]?.[0]||{};
    const sameStyle=(a,b)=>{
      const ar=firstRun(a),br=firstRun(b);
      return String(ar.fontFamily||a?.data?.fontFamily||'')===String(br.fontFamily||b?.data?.fontFamily||'')&&
        !!ar.bold===!!br.bold&&
        !!ar.italic===!!br.italic&&
        String(ar.color||a?.data?.color||'')===String(br.color||b?.data?.color||'')&&
        Math.abs(Number(ar.fontSize||0)-Number(br.fontSize||0))<=.5;
    };
    const metrics=obj=>{
      const angle=Number(obj?.rotation||0);
      const visual=-angle;
      const rad=visual*Math.PI/180;
      const ux=Math.cos(rad),uy=Math.sin(rad);
      const vx=-uy,vy=ux;
      const x=Number(obj?.x||0),y=Number(obj?.y||0);
      const along=x*ux+y*uy;
      const normal=x*vx+y*vy;
      const width=Math.max(Number(obj?.width||0),Number(firstRun(obj).fontSize||obj?.data?.fontSize||8)*1.5);
      return{along,normal,end:along+width};
    };
    const candidates=objs.map((obj,index)=>({obj,index,m:metrics(obj)})).sort((a,b)=>
      Math.round(Number(a.obj.rotation||0))-Math.round(Number(b.obj.rotation||0))||
      String(firstRun(a.obj).fontFamily||a.obj.data?.fontFamily||'').localeCompare(String(firstRun(b.obj).fontFamily||b.obj.data?.fontFamily||''))||
      a.m.normal-b.m.normal||
      a.m.along-b.m.along
    );
    const used=new Set();
    const merged=[];
    const groups=[];
    let group=[];
    const flushGroup=()=>{if(group.length)groups.push(group);group=[];};
    for(const item of candidates){
      const obj=item.obj;
      const text=String(obj?.data?.content||'').trim();
      if(Math.abs(Number(obj?.rotation||0))<=3||!compactPhrase(text)){
        flushGroup();
        groups.push([item]);
        continue;
      }
      if(!group.length){group.push(item);continue;}
      const first=group[0],last=group[group.length-1];
      const fontPt=Math.max(1,Number(firstRun(obj).fontSize||firstRun(last.obj).fontSize||8));
      const normalTol=Math.max(8,fontPt*1.9);
      const gap=item.m.along-last.m.end;
      const sameLine=Math.abs(item.m.normal-first.m.normal)<=normalTol&&
        gap<=Math.max(34,fontPt*5.2)&&
        gap>=-Math.max(28,fontPt*4.2);
      if(Math.round(Number(obj.rotation||0))===Math.round(Number(last.obj.rotation||0))&&sameStyle(obj,last.obj)&&sameLine){
        group.push(item);
      }else{
        flushGroup();
        group.push(item);
      }
    }
    flushGroup();
    for(const groupItems of groups){
      if(groupItems.length===1){merged.push(groupItems[0].obj);continue;}
      const sorted=groupItems.slice().sort((a,b)=>a.m.along-b.m.along);
      const base=sorted[0].obj;
      const run={...firstRun(base)};
      run.text=sorted.map(item=>String(item.obj?.data?.content||'').trim()).filter(Boolean).join(' ');
      const minAlong=Math.min(...sorted.map(item=>item.m.along));
      const maxEnd=Math.max(...sorted.map(item=>item.m.end));
      const newWidth=Math.max(Number(base.width||0),maxEnd-minAlong+Number(run.fontSize||8)*1.5);
      const newHeight=Math.max(...sorted.map(item=>Number(item.obj.height||0)));
      const clone={
        ...base,
        width:newWidth,
        height:newHeight,
        data:{
          ...base.data,
          content:run.text,
          lines:[[run]],
          _originalContent:run.text,
          _originalBox:{x:base.x,y:base.y,width:newWidth,height:newHeight,rotation:base.rotation},
          _lineBoxes:[{x:base.x,y:base.y,width:newWidth,height:newHeight,rotation:base.rotation}]
        }
      };
      merged.push(clone);
      sorted.forEach(item=>used.add(item.index));
    }
    return merged.sort((a,b)=>Number(a.zIndex||0)-Number(b.zIndex||0));
  }

  _correctTextItemWidth(it,itemWidth,ctx){
    const text=String(it.str||'');
    const trimmed=text.trim();
    if(!trimmed)return itemWidth;
    const measured=Math.max(0,ctx.measureText(text).width);
    if(!Number.isFinite(measured)||measured<=0)return itemWidth;
    if(!itemWidth||itemWidth<=0)return measured;
    const ratio=measured/itemWidth;
    const styleName=String(it._styleName||it.fontName||'');
    const family=this._font(styleName);
    const standardish=/helvetica|arial|times|courier|mono|serif|sans|roman|nimbus|liberation|phv|ptm|pcr/i.test(styleName+' '+family);
    const words=trimmed.split(/\s+/).filter(Boolean);
    const lowerWords=words.filter(word=>/^[a-z]{2,}\.?$/.test(word)).length;
    const compactLabelPhrase=words.length>=2&&words.length<=12&&trimmed.length<=140&&
      lowerWords<Math.max(3,words.length*.55)&&
      words.every(word=>/^[A-Za-z0-9][A-Za-z0-9._%+()\/-]*\.?$/.test(word))&&
      (words.some(word=>/[0-9._%+()\/-]/.test(word)||/^(AP|AMC|GRE|SAT|LSAT|USABO|gpt|RLHF|PaLM|Askell)$/i.test(word))||itemWidth>measured*1.12);
    if(compactLabelPhrase&&itemWidth>measured*1.08)return itemWidth;
    const compactSingleToken=!/\s/.test(trimmed)&&trimmed.length<=36;
    const inflatedRatio=itemWidth/measured;
    if(!/\s{3,}/.test(text)){
      if(standardish&&inflatedRatio>1.18)return measured*1.08;
      if(!standardish&&inflatedRatio>1.45)return measured*1.12;
    }
    if(ratio<=1.08)return itemWidth;
    if(standardish&&compactSingleToken&&ratio>1.35)return itemWidth*1.08;
    if(!this._pdfLibGenerated&&!(standardish&&ratio>1.35)&&ratio<1.55)return itemWidth;
    if(!standardish&&ratio<1.22)return itemWidth;
    const cap=standardish?1.9:1.35;
    return Math.min(measured,itemWidth*cap);
  }

  _splitTextSegments(str,width){
    return _measureTextPartWidths(_measureCtx||(_measureCtx=document.createElement('canvas').getContext('2d')),str,width);
  }

  _mergeInlineTextFragments(objs){
    const textOf=obj=>String(obj?.data?.content||'').trim();
    const firstRun=obj=>obj?.data?.lines?.[0]?.[0]||{};
    const sameStyle=(a,b)=>{
      const ar=firstRun(a),br=firstRun(b);
      return (ar.fontFamily||a?.data?.fontFamily)===(br.fontFamily||b?.data?.fontFamily)&&
        !!ar.bold===!!br.bold&&
        !!ar.italic===!!br.italic&&
        (ar.color||a?.data?.color)===(br.color||b?.data?.color)&&
        Math.abs(Number(ar.fontSize||a?.data?.fontSize||0)-Number(br.fontSize||b?.data?.fontSize||0))<=1.5;
    };
    const hasUnclosedPair=text=>{
      const open=(text.match(/[\(\[\{]/g)||[]).length;
      const close=(text.match(/[\)\]\}]/g)||[]).length;
      return open>close;
    };
    const sourceBox=obj=>obj?.data?._lineBoxes?.[0]||obj;
    const sourceBaseline=obj=>{
      const run=firstRun(obj);
      const y=Number(run?._sourceY);
      const height=Number(run?._sourceHeight);
      if(Number.isFinite(y)&&Number.isFinite(height))return y+height*(0.85/1.2);
      const box=sourceBox(obj);
      return Number(box.y||0)+Number(box.height||0)*.7;
    };
    const sourceFontPx=obj=>Math.max(1,Number(firstRun(obj).fontSize||obj?.data?.fontSize||12)*RENDER_SCALE);
    const sameFontAndColor=(a,b)=>{
      const ar=firstRun(a),br=firstRun(b);
      return (ar.fontFamily||a?.data?.fontFamily)===(br.fontFamily||b?.data?.fontFamily)&&
        (ar.color||a?.data?.color)===(br.color||b?.data?.color);
    };
    const sameColor=(a,b)=>{
      const ar=firstRun(a),br=firstRun(b);
      return (ar.color||a?.data?.color)===(br.color||b?.data?.color);
    };
    const hasInlineScriptGeometry=obj=>{
      const runs=(obj?.data?.lines||[]).flat().filter(run=>String(run?.text||'').trim());
      if(runs.some(run=>!!run._verticalAlign))return true;
      const sizes=runs.map(run=>Number(run._sourceFontSize??run.fontSize??0))
        .filter(size=>Number.isFinite(size)&&size>0);
      if(sizes.length<2)return false;
      const maxSize=Math.max(...sizes);
      const baseRun=runs.find(run=>Number(run._sourceFontSize??run.fontSize??0)>=maxSize*.9);
      const baseY=Number(baseRun?._sourceY);
      return Number.isFinite(baseY)&&runs.some(run=>{
        const size=Number(run._sourceFontSize??run.fontSize??0);
        const y=Number(run._sourceY);
        return Number.isFinite(size)&&Number.isFinite(y)&&size<=maxSize*.78&&
          Math.abs(y-baseY)>=Math.min(size,maxSize)*.35;
      });
    };
    const mergeMode=(prev,obj)=>{
      if(!prev||!obj||prev.type!==OT.TEXT||obj.type!==OT.TEXT)return'';
      if(Math.abs(Number(prev.rotation||0))>3||Math.abs(Number(obj.rotation||0))>3)return'';
      if(!prev.data?._singleLine||!obj.data?._singleLine)return'';
      const prevText=textOf(prev),nextText=textOf(obj);
      if(!prevText||!nextText)return'';
      const prevBox=sourceBox(prev),nextBox=sourceBox(obj);
      const prevFs=Math.max(1,Number(firstRun(prev).fontSize||prev.data.fontSize||12)*RENDER_SCALE);
      const nextFs=Math.max(1,Number(firstRun(obj).fontSize||obj.data.fontSize||12)*RENDER_SCALE);
      const fs=Math.max(prevFs,nextFs);
      const prevCy=Number(prevBox.y||0)+Number(prevBox.height||0)/2;
      const nextCy=Number(nextBox.y||0)+Number(nextBox.height||0)/2;
      if(Math.abs(prevCy-nextCy)>fs*.42)return'';

      const sourceGap=Number(nextBox.x||0)-(Number(prevBox.x||0)+Number(prevBox.width||0));
      const allCapsFragment=text=>/^[A-Z0-9][A-Z0-9\s.&'()\/-]*$/.test(text);
      const inlineSmallCapsContinuation=sameFontAndColor(prev,obj)&&
        /[a-z].*[A-Z]$/.test(prevText)&&allCapsFragment(nextText)&&
        nextFs<prevFs*.92&&sourceGap>=-fs*.72&&sourceGap<=fs*.26;
      if(inlineSmallCapsContinuation)return'inline-small-caps-normalize';
      const standaloneSmallCapsWord=sameFontAndColor(prev,obj)&&
        /^[A-Z]$/.test(prevText)&&allCapsFragment(nextText)&&
        nextFs<prevFs*.92&&sourceGap>=-fs*.72&&sourceGap<=fs*.26;
      if(standaloneSmallCapsWord)return'small-caps-join';
      const mixedSizeSmallCaps=sameFontAndColor(prev,obj)&&
        allCapsFragment(prevText)&&allCapsFragment(nextText)&&
        sourceGap>=-fs*.22&&sourceGap<=fs*.26;
      if(mixedSizeSmallCaps)return sourceGap>fs*.08?'small-caps-space':'small-caps-join';

      // PDF producers often emit an inline style change (for example, an
      // italic parenthetical after a small-caps heading) as a separate text
      // object. Keeping those objects in separate Word frames lets fallback
      // font metrics make them collide even though their PDF baselines and
      // source gap are continuous. Rejoin only geometrically adjacent pieces
      // from the same face/color; genuinely separate columns and cells have a
      // much wider source gap and remain independent.
      const prevRun=firstRun(prev),nextRun=firstRun(obj);
      const prevSourceFontSize=Number(prevRun._sourceFontSize??prevRun.fontSize??prev.data.fontSize??0);
      const nextSourceFontSize=Number(nextRun._sourceFontSize??nextRun.fontSize??obj.data.fontSize??0);
      const inlineSourceSizeRatio=Math.min(prevSourceFontSize,nextSourceFontSize)/Math.max(1,prevSourceFontSize,nextSourceFontSize);
      const hasInlineStyleChange=!!prevRun.bold!==!!nextRun.bold||
        !!prevRun.italic!==!!nextRun.italic||
        Math.abs(prevSourceFontSize-nextSourceFontSize)>.4;
      const adjacentInlineStyle=hasInlineStyleChange&&inlineSourceSizeRatio>=.72&&sameFontAndColor(prev,obj)&&
        sourceGap>=-fs*.15&&sourceGap<=fs*.42;
      if(adjacentInlineStyle)return sourceGap>fs*.06?'inline-style-space':'inline-style-join';
      const sourceBaselineDelta=Math.abs(sourceBaseline(obj)-sourceBaseline(prev));
      const adjacentInlineScript=hasInlineStyleChange&&inlineSourceSizeRatio>=.62&&inlineSourceSizeRatio<.72&&
        nextSourceFontSize<prevSourceFontSize&&sameFontAndColor(prev,obj)&&
        sourceBaselineDelta>=Math.min(prevSourceFontSize,nextSourceFontSize)*.35&&
        sourceGap>=-fs*.15&&sourceGap<=fs*.25&&/^[A-Za-z][A-Za-z_ ]{1,24}$/.test(nextText);
      if(adjacentInlineScript)return'inline-script-join';
      const closesMathGroup=/^[)\]}]/.test(nextText);
      const compatibleMathFace=sameFontAndColor(prev,obj)||(closesMathGroup&&sameColor(prev,obj));
      const inlineMathContinuation=(hasInlineScriptGeometry(prev)||hasInlineScriptGeometry(obj))&&
        compatibleMathFace&&Math.abs(sourceBaseline(obj)-sourceBaseline(prev))<=fs*.18&&
        sourceGap>=-fs*.15&&sourceGap<=fs*1.4&&/^[,.;:)\]}]/.test(nextText);
      if(inlineMathContinuation)return'inline-math-join';

      if(!sameStyle(prev,obj))return'';
      const nextCompact=/^[A-Za-z0-9][A-Za-z0-9._%+()\/-]*\)?$/.test(nextText)&&nextText.length<=14;
      if(!nextCompact||!hasUnclosedPair(prevText))return'';
      const gap=obj.x-(prev.x+prev.width);
      return obj.x>prev.x&&gap<=Math.max(fs*3,48)&&gap>=-Math.max(fs*8,prev.width*.45)?'paired-token':'';
    };
    const append=(prev,obj,mode)=>{
      const prevText=textOf(prev),nextText=textOf(obj);
      const prevSource=sourceBox(prev),nextSource=sourceBox(obj);
      const spacer=mode==='small-caps-join'||mode==='inline-style-join'||mode==='inline-script-join'||mode==='inline-math-join'||mode==='inline-small-caps-normalize'
        ?''
        :(!/\s$/.test(prevText)&&!/^[\]\),.;:%]/.test(nextText))?' ':'';
      const cloneLine=(obj.data.lines?.[0]||[]).map(run=>({...run}));
      if(spacer&&cloneLine.length)cloneLine[0].text=spacer+String(cloneLine[0].text||'');
      const prevLine=(prev.data.lines?.[0]||[]).map(run=>({...run}));
      const keepSmallCapsTogether=mode==='inline-small-caps-normalize'||mode.startsWith('small-caps-');
      if(keepSmallCapsTogether){
        prevLine.forEach(run=>{run._keepTogetherInWord=true;});
        cloneLine.forEach(run=>{run._keepTogetherInWord=true;});
      }
      if(mode==='inline-small-caps-normalize'&&cloneLine.length){
        const initial=prevLine.slice().reverse().find(run=>/[A-Z]$/.test(String(run.text||'')))||prevLine[prevLine.length-1];
        const targetSize=Number(initial?._sourceFontSize??initial?.fontSize);
        for(const run of cloneLine){
          if(Number.isFinite(targetSize)&&targetSize>0){
            run.fontSize=targetSize;
            run._sourceFontSize=targetSize;
          }
          run._fitToSourceWidth=true;
          if(Number.isFinite(Number(initial?._sourceY)))run._sourceY=Number(initial._sourceY);
          if(Number.isFinite(Number(initial?._sourceHeight)))run._sourceHeight=Number(initial._sourceHeight);
        }
      }
      prev.data.lines=[[...prevLine,...cloneLine]];
      prev.data.content=prevText+spacer+nextText;
      prev.data._originalContent=String(prev.data._originalContent||prevText)+spacer+String(obj.data._originalContent||nextText);
      const minX=Math.min(prev.x,obj.x);
      const minY=Math.min(prev.y,obj.y);
      const maxX=Math.max(prev.x+prev.width,obj.x+obj.width);
      const maxY=Math.max(prev.y+prev.height,obj.y+obj.height);
      prev.x=minX;prev.y=minY;prev.width=maxX-minX;prev.height=maxY-minY;
      const sourceX=Math.min(Number(prevSource.x||0),Number(nextSource.x||0));
      const sourceY=Math.min(Number(prevSource.y||0),Number(nextSource.y||0));
      const sourceRight=Math.max(Number(prevSource.x||0)+Number(prevSource.width||0),Number(nextSource.x||0)+Number(nextSource.width||0));
      const sourceBottom=Math.max(Number(prevSource.y||0)+Number(prevSource.height||0),Number(nextSource.y||0)+Number(nextSource.height||0));
      prev.data._lineBoxes=[{x:sourceX,y:sourceY,width:sourceRight-sourceX,height:sourceBottom-sourceY,rotation:prev.rotation||0}];
      prev.data._originalBox={x:prev.x,y:prev.y,width:prev.width,height:prev.height,rotation:prev.rotation||0};
      prev.data._lineAligns=['left'];
      prev.data.align='left';
    };
    const out=[];
    const ordered=objs.slice().sort((a,b)=>{
      const pageDelta=(a.pageIndex||0)-(b.pageIndex||0);
      if(pageDelta)return pageDelta;
      const baselineDelta=sourceBaseline(a)-sourceBaseline(b);
      const sameLine=Math.abs(baselineDelta)<=Math.max(sourceFontPx(a),sourceFontPx(b))*.42;
      return sameLine?Number(sourceBox(a).x||a.x||0)-Number(sourceBox(b).x||b.x||0):baselineDelta;
    });
    for(const obj of ordered){
      const prev=out[out.length-1];
      const mode=mergeMode(prev,obj);
      if(mode)append(prev,obj,mode);
      else out.push(obj);
    }
    return out;
  }

  _mergeParagraphObjs(objs){
    if(!objs.length)return objs;
    objs=this._mergeInlineTextFragments(objs);
    objs.forEach(obj=>this._detectLineAligns(obj));
    return objs;
    const sameStyle=(a,b)=>{
      const da=a.data||{},db=b.data||{};
      return da.fontFamily===db.fontFamily&&da.fontWeight===db.fontWeight&&da.fontStyle===db.fontStyle&&da.color===db.color&&Math.abs((da.fontSize||0)-(db.fontSize||0))<=2;
    };
    const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
    const startsWithBullet=o=>/^\s*[•\u2022]/.test(String(o?.data?.content||''))||
      /^\s*[•\u2022]/.test(String(o?.data?.lines?.[0]?.[0]?.text||''));
    const out=[];
    for(const obj of objs.slice().sort((a,b)=>a.y-b.y||a.x-b.x)){
      let merged=false;
      for(const prev of out){
        if(sameStyle(prev,obj)){
          if(startsWithBullet(prev)||startsWithBullet(obj))continue;
          const fs=obj.data.fontSize||12;
          
          // Heuristic 1: Prevent merging if the previous block's last line is short (paragraph ended)
          const lineBoxes = prev.data._lineBoxes || [];
          if (lineBoxes.length > 0) {
            const lastLine = lineBoxes[lineBoxes.length - 1];
            const maxWidth = Math.max(...lineBoxes.map(b => b.width));
            if (maxWidth > fs * 5 && lastLine.width < maxWidth * 0.82) {
              continue;
            }
          }

          // Heuristic 2: Prevent merging if the new block has horizontally separated siblings on the same line (table / key-value column)
          const hasSameLineSibling = objs.some(o => 
            o.id !== obj.id && 
            Math.abs(o.y - obj.y) <= fs * 0.3 && 
            Math.abs(o.x - obj.x) > fs * 1.5
          );
          if (hasSameLineSibling) {
            continue;
          }

          const leftAligned=Math.abs(prev.x-obj.x)<=fs*0.9;
          const vGap=obj.y-(prev.y+prev.height);
          const meaningfulOverlap=overlap(prev,obj)>Math.min(prev.width,obj.width)*0.3;

          // Only merge if close vertically (max 0.5x font size) AND both aligned AND overlapping
          if(vGap>=-fs*.2&&vGap<=fs*.5&&leftAligned&&meaningfulOverlap){
            const minX=Math.min(prev.x,obj.x),minY=Math.min(prev.y,obj.y);
            const maxX=Math.max(prev.x+prev.width,obj.x+obj.width),maxY=Math.max(prev.y+prev.height,obj.y+obj.height);
            if(prev.data.html||obj.data.html){
              const block=o=>o.data.html||`<div>${_htmlEscape(o.data.content||'').replace(/\n/g,'<br>')}</div>`;
              prev.data.html=_cleanTextHtml(block(prev)+block(obj));
              prev.data._originalHtml=prev.data.html;
              prev.data.fontWeight='normal';
              prev.data.fontStyle='normal';
              prev.data.underline=false;
              if(prev.data._originalStyle){
                prev.data._originalStyle.fontWeight='normal';
                prev.data._originalStyle.fontStyle='normal';
                prev.data._originalStyle.underline=false;
              }
            }
            prev.data.content=(prev.data.content||'')+'\n'+(obj.data.content||'');
            prev.data.lines = [...(prev.data.lines || []), ...(obj.data.lines || [])];
            prev.data._originalContent=(prev.data._originalContent||'')+'\n'+(obj.data._originalContent||obj.data.content||'');
            prev.data._singleLine=false;
            prev.data._lineBoxes=[...(prev.data._lineBoxes||[{x:prev.x,y:prev.y,width:prev.width,height:prev.height}]),...(obj.data._lineBoxes||[{x:obj.x,y:obj.y,width:obj.width,height:obj.height}])];
            prev.x=minX;prev.y=minY;prev.width=maxX-minX;prev.height=maxY-minY;
            prev.data._originalBox={x:prev.x,y:prev.y,width:prev.width,height:prev.height,rotation:prev.rotation||0};
            const ys=prev.data._lineBoxes.map(b=>b.y).sort((a,b)=>a-b);
            if(ys.length>1){
              const avg=ys.slice(1).reduce((s,v,i)=>s+(v-ys[i]),0)/(ys.length-1);
              const lh=Math.max(.8,Math.min(3,Math.round((avg/Math.max(1,fs))*100)/100));
              prev.data.lineHeight=lh;
              if(prev.data._originalStyle)prev.data._originalStyle.lineHeight=lh;
            }
            merged=true;
            break;
          }
          break;
        }
      }
      if(!merged)out.push(obj);
    }
    out.forEach(obj=>this._detectLineAligns(obj));
    return out;
  }

  _detectLineAligns(obj){
    const d=obj.data||{},boxes=d._lineBoxes;
    if(!Array.isArray(boxes)||!boxes.length)return;
    if(boxes.length<2){
      d._lineAligns=['left'];
      d.align='left';
      if(d._originalStyle)d._originalStyle.align=d.align;
      return;
    }
    const fs=d.fontSize||12;
    const minX=Math.min(...boxes.map(b=>b.x));
    const maxX=Math.max(...boxes.map(b=>b.x+b.width));
    const blockW=Math.max(1,maxX-minX);
    d._lineAligns=boxes.map(b=>{
      const left=b.x-minX,right=maxX-(b.x+b.width);
      if(left<=fs*.7)return'left';
      if(right<=fs*.7&&left>fs*1.2)return'right';
      if(Math.abs(left-right)<=Math.max(fs*.8,blockW*.08)&&left>fs*.4&&right>fs*.4)return'center';
      return'left';
    });
    const unique=[...new Set(d._lineAligns)];
    d.align=unique.length===1?unique[0]:'left';
    if(d._originalStyle)d._originalStyle.align=d.align;
  }

  _segmentStyle(seg){
    const styleName=seg._styleName||seg.fontName||'';
    if(seg._decodedSymbol){
      return{
        fontFamily:'Times New Roman,serif',
        fontSize:_roundNum(seg._fs||12,2),
        fontWeight:'normal',
        fontStyle:'normal',
        color:seg._color||'#000000'
      };
    }
    return{
      fontFamily:this._font(styleName),
      fontSize:_roundNum(seg._fs||12,2),
      fontWeight:this._bold(styleName)?'bold':'normal',
      fontStyle:this._italic(styleName)?'italic':'normal',
      color:seg._color||'#000000'
    };
  }

  _segmentStyleCss(seg,base){
    const st=this._segmentStyle(seg),css=[];
    css.push(`font-family:${st.fontFamily.replace(/"/g, "'")}`);
    css.push(`font-weight:${st.fontWeight}`);
    css.push(`font-style:${st.fontStyle}`);
    css.push(`color:${st.color}`);
    if(Math.abs((st.fontSize||base.fontSize)-(base.fontSize||st.fontSize))>1){
      css.push(`font-size:${Math.max(.5,Math.round(st.fontSize/Math.max(1,base.fontSize)*1000)/1000)}em`);
    }
    return css.join(';');
  }

  _textClusterObj(cluster,pi,order){
    if(!cluster.length)return null;
    const styleKeys=new Set(cluster.map(seg=>`${seg._styleKey}|${seg._color}`));
    if(styleKeys.size===1)return this._textRunObj(cluster,pi,order);
    const first=cluster[0];
    const fs=cluster.reduce((s,i)=>s+i._fs,0)/cluster.length;
    const rotation=Math.round(first._angle);
    const normalizedRotation=normalizeDegrees(rotation);
    const rotatedBounds=Math.min(normalizedRotation, 360 - normalizedRotation) > 3 ? textSegmentVisualBounds(cluster) : null;
    const rawX=Math.min(...cluster.map(i=>i._x));
    const rawY=Math.min(...cluster.map(i=>i._y));
    const maxX=Math.max(...cluster.map(i=>i._end));
    const x=rotatedBounds ? rotatedBounds.x : rawX;
    let y=rotatedBounds ? rotatedBounds.y : rawY;
    const contentW=maxX-rawX;
    const rightPad=Math.max(2,Math.min(8,fs*.18,contentW*.025));
    const objW=Math.max(contentW+rightPad,fs*.8),objH=Math.max(fs*1.2,12*RENDER_SCALE);
    if (rotatedBounds && (Math.abs(normalizedRotation - 90) <= 4 || Math.abs(normalizedRotation - 270) <= 4)) {
      y = rotatedBounds.y + Math.max(0, (rotatedBounds.height - objH) / 2);
    }
    const base=this._segmentStyle(first);
    let content='',html='';
    cluster.forEach((seg,i)=>{
      if(i>0){
        const gap=segmentBoundaryGap(cluster[i-1], seg);
        if(shouldInsertRunSpace(cluster[i-1],seg,content,seg._text,gap,fs)){content+=' ';html+=' ';}
      }
      content+=seg._text;
      html+=`<span style="${this._segmentStyleCss(seg,base)}">${_htmlEscape(seg._text)}</span>`;
    });
    const codeLine=cluster.every(isCodeLikeSegment);
    content=normalizeDetachedDiacriticsSafe(content.replace(/\s+/g,' ').trim());
    if(codeLine)content=normalizePdfCodeText(content);
    html=_cleanTextHtml(`<div>${html.trim()}</div>`);
    const baseColor=normalizeLeakedBodyTextColor(content,base.color,base.fontFamily);
    const box={x,y,width:objW,height:objH,rotation};
    let fittedFontSize=_roundNum(_fitCanvasFontSize({...base,lineHeight:1.2},content,box),2);
    if (shouldPreserveNaturalFontForLine(content, cluster.length, fs / RENDER_SCALE)) {
      const preserveRatio = naturalFontPreserveRatio(content);
      if (fittedFontSize < fs * preserveRatio) {
        fittedFontSize = _roundNum(Math.max(fittedFontSize, fs * preserveRatio), 2);
      }
    }
    const fitRatio=Math.min(1,Math.max(0.35,fittedFontSize/Math.max(1,fs)));
    const originalStyle={fontFamily:base.fontFamily,fontSize:fittedFontSize,fontWeight:'normal',fontStyle:'normal',color:baseColor,backgroundColor:'transparent',underline:false,align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0};
    let runsList = [];
    cluster.forEach((seg, i) => {
      let text = seg._text;
      if (i > 0) {
        const gap = segmentBoundaryGap(cluster[i - 1], seg);
        if (shouldInsertRunSpace(cluster[i - 1],seg,runsList[runsList.length - 1]?.text,text,gap,fs)) {
          text = ' ' + text;
        }
      }
      runsList.push({
        text: text,
        fontFamily: cleanFontNameForDocx(seg._decodedSymbol ? 'Times New Roman' : this._font(seg._styleName || seg.fontName || '')),
        _docxFontFamily: seg._decodedSymbol ? 'Times New Roman' : this._docxFont(seg._styleName || seg.fontName || ''),
        fontSize: _roundNum((seg._fs / RENDER_SCALE)*fitRatio, 1),
        _sourceFontSize: _roundNum(seg._fs / RENDER_SCALE, 1),
        bold: seg._decodedSymbol ? false : this._bold(seg._styleName || seg.fontName || ''),
        italic: seg._decodedSymbol ? false : this._italic(seg._styleName || seg.fontName || ''),
        color: normalizedRunTextColor(text,content,seg._color || '#000000',this._font(seg._styleName || seg.fontName || '')),
        _verticalAlign: seg._verticalAlign,
        _baselineShiftPt: seg._baselineShiftPt,
        _disableScriptDetection: seg._disableScriptDetection,
        _preserveItemWhitespace: seg._preserveItemWhitespace,
        _restoredMathIdentifier: seg._restoredMathIdentifier,
        _sourceX: _roundNum(seg._x, 2),
        _sourceY: _roundNum(seg._y, 2),
        _sourceBaselineY: _roundNum(seg._baselineY, 2),
        _sourceWidth: _roundNum(seg._width, 2),
        _sourceEnd: _roundNum(seg._end, 2),
        _sourceHeight: _roundNum(seg._fs * 1.2, 2),
        _itemIdx: seg._itemIdx,
        _sourceSpaceBefore: !!seg._sourceSpaceBefore,
        _lineText: content
      });
    });
    if(codeLine){
      runsList=normalizePdfCodeRuns(runsList);
      content=runsList.map(item=>String(item.text||'')).join('');
    }
    normalizeDetachedDiacriticRunsSafe(runsList);
    runsList=markInlineScriptRuns(runsList);

    return{
      id:uid(),type:OT.TEXT,pageIndex:pi,
      x,y,width:objW,height:objH,
      rotation:box.rotation,opacity:1,visible:true,
      zIndex:5+order,dirty:false,isOriginal:true,selected:false,
      data:{
        content,
        html,
        lines: [runsList],
        fontFamily:base.fontFamily,fontSize:fittedFontSize,
        fontWeight:'normal',fontStyle:'normal',
        color:baseColor,backgroundColor:'transparent',underline:false,align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0,
        _originalContent:content,
        _originalHtml:html,
        _originalStyle:originalStyle,
        _originalBox:box,
        _originalFontName:first._styleName||first.fontName||'',
        _pdfFontKey:first.fontName,  // Raw PDF font key for lookup
        _lineBoxes:[{x,y,width:contentW,height:objH}],
        _lineAligns:['left'],
        _singleLine:true,
      }
    };
  }

  _textRunObj(run,pi,order){
    const first=run[0];
    const fs=run.reduce((s,i)=>s+i._fs,0)/run.length;
    const rotation=Math.round(first._angle);
    const normalizedRotation=normalizeDegrees(rotation);
    const rotatedBounds=Math.min(normalizedRotation, 360 - normalizedRotation) > 3 ? textSegmentVisualBounds(run) : null;
    const rawX=Math.min(...run.map(i=>i._x));
    const rawY=Math.min(...run.map(i=>i._y));
    const maxX=Math.max(...run.map(i=>i._end));
    const x=rotatedBounds ? rotatedBounds.x : rawX;
    let y=rotatedBounds ? rotatedBounds.y : rawY;
    const contentW=maxX-rawX;
    const rightPad=Math.max(2,Math.min(8,fs*.18,contentW*.025));
    const objW=Math.max(contentW+rightPad,fs*.8), objH=Math.max(fs*1.2,12*RENDER_SCALE);
    if (rotatedBounds && (Math.abs(normalizedRotation - 90) <= 4 || Math.abs(normalizedRotation - 270) <= 4)) {
      y = rotatedBounds.y + Math.max(0, (rotatedBounds.height - objH) / 2);
    }
    const styleName=first._styleName||first.fontName||'';
    const fontFamily=this._font(styleName);
    let fontSize=_roundNum(fs,2);
    const fontWeight=this._bold(styleName)?'bold':'normal';
    const fontStyle=this._italic(styleName)?'italic':'normal';
    let color=first._color||'#000000';
    let content='';
    run.forEach((seg,i)=>{
      if(i>0){
        const gap=segmentBoundaryGap(run[i-1], seg);
        if(shouldInsertRunSpace(run[i-1],seg,content,seg._text,gap,fs))content+=' ';
      }
      content+=seg._text;
    });
    const codeLine=run.every(isCodeLikeSegment);
    content=normalizeDetachedDiacriticsSafe(content.replace(/\s+/g,' ').trim());
    if(codeLine)content=normalizePdfCodeText(content);
    color=normalizeLeakedBodyTextColor(content,color,fontFamily);
    const box={x,y,width:objW,height:objH,rotation};
    const naturalFontSize = fontSize;
    fontSize=_roundNum(_fitCanvasFontSize({fontFamily,fontSize,fontWeight,fontStyle,lineHeight:1.2},content,box),2);
    const compactStandaloneCell = run.length === 1 &&
      naturalFontSize / RENDER_SCALE <= 10.5 &&
      /^[\d.,%+\-\u2013\u2014]+$/.test(content) &&
      content.length <= 18;
    if (compactStandaloneCell) fontSize = naturalFontSize;
    if (shouldPreserveNaturalFontForLine(content, run.length, fs / RENDER_SCALE)) {
      const preserveRatio = naturalFontPreserveRatio(content);
      if (fontSize < naturalFontSize * preserveRatio) {
        fontSize = _roundNum(Math.max(fontSize, naturalFontSize * preserveRatio), 2);
      }
    }
    const fitRatio=Math.min(1,Math.max(0.35,fontSize/Math.max(1,fs)));
    const originalStyle={fontFamily,fontSize,fontWeight,fontStyle,color,backgroundColor:'transparent',underline:false,align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0};
    let runsList = [];
    run.forEach((seg, i) => {
      let text = seg._text;
      if (i > 0) {
        const gap = segmentBoundaryGap(run[i - 1], seg);
        if (shouldInsertRunSpace(run[i - 1],seg,runsList[runsList.length - 1]?.text,text,gap,fs)) {
          text = ' ' + text;
        }
      }
      runsList.push({
        text: text,
        fontFamily: cleanFontNameForDocx(seg._decodedSymbol ? 'Times New Roman' : this._font(seg._styleName || seg.fontName || '')),
        _docxFontFamily: seg._decodedSymbol ? 'Times New Roman' : this._docxFont(seg._styleName || seg.fontName || ''),
        fontSize: _roundNum((seg._fs / RENDER_SCALE)*fitRatio, 1),
        _sourceFontSize: _roundNum(seg._fs / RENDER_SCALE, 1),
        bold: seg._decodedSymbol ? false : this._bold(seg._styleName || seg.fontName || ''),
        italic: seg._decodedSymbol ? false : this._italic(seg._styleName || seg.fontName || ''),
        color: normalizedRunTextColor(text,content,seg._color || '#000000',this._font(seg._styleName || seg.fontName || '')),
        _verticalAlign: seg._verticalAlign,
        _baselineShiftPt: seg._baselineShiftPt,
        _disableScriptDetection: seg._disableScriptDetection,
        _preserveItemWhitespace: seg._preserveItemWhitespace,
        _restoredMathIdentifier: seg._restoredMathIdentifier,
        _sourceX: _roundNum(seg._x, 2),
        _sourceY: _roundNum(seg._y, 2),
        _sourceBaselineY: _roundNum(seg._baselineY, 2),
        _sourceWidth: _roundNum(seg._width, 2),
        _sourceEnd: _roundNum(seg._end, 2),
        _sourceHeight: _roundNum(seg._fs * 1.2, 2),
        _itemIdx: seg._itemIdx,
        _sourceSpaceBefore: !!seg._sourceSpaceBefore,
        _fitToSourceWidth: compactStandaloneCell,
        _lineText: content
      });
    });
    if(codeLine){
      runsList=normalizePdfCodeRuns(runsList);
      content=runsList.map(item=>String(item.text||'')).join('');
    }
    normalizeDetachedDiacriticRunsSafe(runsList);
    runsList=markInlineScriptRuns(runsList);

    return{
      id:uid(),type:OT.TEXT,pageIndex:pi,
      x,y,width:objW,height:objH,
      rotation:box.rotation,opacity:1,visible:true,
      zIndex:5+order,dirty:false,isOriginal:true,selected:false,
      data:{
        content,
        lines: [runsList],
        fontFamily,fontSize,
        fontWeight,fontStyle,
        color,backgroundColor:'transparent',underline:false,align:'left',lineHeight:1.2,letterSpacing:0,wordSpacing:0,
        _originalContent:content, // immutable snapshot - never modify this
        _originalStyle:originalStyle,
        _originalBox:box,
        _originalFontName:styleName,
        _pdfFontKey:first.fontName,  // Raw PDF font key for lookup
        _lineBoxes:[{x,y,width:contentW,height:objH}],
        _lineAligns:['left'],
        _singleLine:true,
      }
    };
  }

  _extractTextColors(opList,itemsOrCount){
    const items=Array.isArray(itemsOrCount)?itemsOrCount:null;
    const itemCount=items?items.length:itemsOrCount;
    const out=[];
    if(!opList||!window.pdfjsLib?.OPS)return Array(itemCount).fill('#000000');
    const OPS=window.pdfjsLib.OPS;
    let fill='#000000';
    const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
    const hex=v=>clamp(v).toString(16).padStart(2,'0');
    const rgb=(r,g,b)=>`#${hex(r)}${hex(g)}${hex(b)}`;
    const norm=v=>{
      const n=Number(v);
      // Guard against NaN
      if(isNaN(n))return 0;
      // Handle 0-1 range (PDF standard)
      if(n>=0&&n<=1)return n*255;
      // Handle 0-255 range (already in display range)
      if(n>1&&n<=255)return Math.round(n);
      // Out of range values
      if(n<0)return 0;
      if(n>255)return 255;
      return 0;
    };
    const cmyk=(c,m,y,k)=>{
      c=Number(c)||0;m=Number(m)||0;y=Number(y)||0;k=Number(k)||0;
      return rgb(255*(1-c)*(1-k),255*(1-m)*(1-k),255*(1-y)*(1-k));
    };
    const colorNumbers=args=>{
      const values=[];
      const visit=value=>{
        if(typeof value==='number')values.push(value);
        else if(Array.isArray(value))value.forEach(visit);
      };
      visit(args);
      return values;
    };
    
    const textFromArgs=args=>{
      const read=value=>{
        if(!Array.isArray(value))return '';
        return value.map(part=>{
          if(Array.isArray(part))return read(part);
          return part&&typeof part==='object'?(part.unicode||''):'';
        }).join('');
      };
      return read(args?.[0])||read(args?.[2])||read(args)||'';
    };
    const normText=value=>String(value||'').replace(/\s+/g,'');
    const runs=[];
    let textOpIndex=0;
    for(let i=0;i<opList.fnArray.length&&(items||textOpIndex<itemCount);i++){
      const fn=opList.fnArray[i],args=opList.argsArray[i]||[];
      if(fn===OPS.setFillRGBColor){
        fill=rgb(norm(args[0]||0),norm(args[1]||0),norm(args[2]||0));
      }
      else if(fn===OPS.setFillGray){
        const v=norm(args[0]??0);
        fill=rgb(v,v,v);
      }
      else if(fn===OPS.setFillCMYKColor){
        fill=cmyk(args[0],args[1],args[2],args[3]);
      }
      else if(fn===OPS.setFillColor||fn===OPS.setFillColorN){
        const values=colorNumbers(args);
        if(values.length===1){
          const v=norm(values[0]);
          fill=rgb(v,v,v);
        }else if(values.length>=3){
          fill=rgb(norm(values[0]),norm(values[1]),norm(values[2]));
        }
      }
      else if(fn===OPS.setFillColorSpace){
        // Handle color space changes - some PDFs set color space before color
        const colorSpace=args[0];
        if(colorSpace&&typeof colorSpace==='string'&&colorSpace.toLowerCase().includes('gray')){
          // Grayscale color space
        }
      }
      else if(fn===OPS.showText||fn===OPS.showSpacedText||fn===OPS.nextLineShowText||fn===OPS.nextLineSetSpacingShowText){
        if(items)runs.push({color:fill,text:textFromArgs(args),offset:0});
        else out.push(fill);
        textOpIndex++;
      }
    }
    if(items){
      // getTextContent can merge several showText operators into one item even
      // when those operators change colour mid-line (for example linked author
      // names inside otherwise black table text). Map the item against one
      // monotonic character stream so those internal colour boundaries survive
      // into separate DOCX runs instead of inheriting the first operator colour.
      let streamText='';
      const streamColors=[];
      for(const run of runs){
        const text=normText(run.text);
        streamText+=text;
        for(let i=0;i<text.length;i++)streamColors.push(run.color);
      }
      let streamOffset=0;
      for(const item of items){
        const target=normText(item?.str);
        const matchPos=target?streamText.indexOf(target,streamOffset):-1;
        if(matchPos<0){
          out.push(streamColors[streamOffset]||'#000000');
          continue;
        }
        const ranges=[];
        for(let i=0;i<target.length;i++){
          const color=streamColors[matchPos+i]||'#000000';
          const previous=ranges[ranges.length-1];
          if(previous?.color===color)previous.end=i+1;
          else ranges.push({start:i,end:i+1,color});
        }
        const color=ranges[0]?.color||'#000000';
        out.push(ranges.length>1?{color,ranges}:color);
        streamOffset=matchPos+target.length;
      }
    }
    while(out.length<itemCount)out.push('#000000');
    
    return out;
  }

  _fontHintMap(items){
    const n=name=>Number((String(name).match(/f(\d+)$/i)||[])[1]||0);
    const names=[...new Set(items.map(i=>i.fontName).filter(Boolean))].sort((a,b)=>n(a)-n(b));
    const out={};
    names.forEach((name,i)=>{if(this._fontHints[i])out[name]=this._fontHints[i];});
    return out;
  }

  _fontDetails(page,styles={},extraKeys=[]){
    const out={};
    for(const name of [...new Set([...Object.keys(styles || {}), ...(extraKeys || [])])]){
      try{
        const f=page.commonObjs?.get?.(name);
        if(f)out[name]=[f.name,f.loadedName,f.fallbackName,f.bold?'Bold':'',f.italic?'Italic':''].filter(Boolean).join(' ');
      }catch(e){}
    }
    return out;
  }

  _styleName(it,styles,fontHintsByName={},fontDetails={}){
    const s=styles[it.fontName]||{};
    const fontKey=String(it.fontName||'');
    if(isLegacyEncodedPdfText(it.str,fontKey) && decodeShiftedAsciiSubsetText(it.str,fontKey)===it.str){
      this._legacyEncodedFonts?.add?.(fontKey);
    }
    if(fontKey&&this._legacyEncodedFonts?.has?.(fontKey)){
      const embedded=[fontDetails[fontKey],s.loadedName,s.name,fontHintsByName[fontKey],fontKey]
        .filter(Boolean)
        .map(name=>String(name).match(/\bg_d\d+_f\d+\b/i)?.[0])
        .find(Boolean);
      if(embedded)return embedded;
      return fontKey;
    }
    // Add s.fontFamily as a higher-priority source for precise font info
    const reliable=[fontDetails[it.fontName],s.fontFamily,s.loadedName,s.name].filter(Boolean).join(' ');
    return reliable||fontHintsByName[fontKey]||it.fontName||'';
  }
  _styleKey(n,fs){return `${this._font(n)}|${this._bold(n)}|${this._italic(n)}|${_roundNum(fs,1)}`;}

  _buildLinkObjs(anns,vp,pi){
    return anns.filter(a=>a.subtype==='Link').map((a,i)=>{
      const r=a.rect;
      const[x1,y1]=this._vpt(r[0],r[1],vp),[x2,y2]=this._vpt(r[2],r[3],vp);
      const x=Math.min(x1,x2),y=Math.min(y1,y2),w=Math.max(Math.abs(x2-x1),20),h=Math.max(Math.abs(y2-y1),10);
      let href='',linkType='url',targetPage=null;
      if(a.url){href=a.url;linkType='url';}
      else if(a.dest){targetPage=a.dest;linkType='page';}
      else if(a.action?.URI){href=a.action.URI;linkType='url';}
      return{id:uid(),type:OT.LINK,pageIndex:pi,x,y,width:w,height:h,rotation:0,opacity:1,visible:true,zIndex:50+i,dirty:false,selected:false,data:{href,linkType,targetPage,label:href||'Page link'}};
    });
  }

  _vpt(px,py,vp){const[a,b,c,d,e,f]=vp.transform;return[a*px+c*py+e, b*px+d*py+f];}
  _embeddedFontFace(n){
    const loadedNameMatch=String(n||'').match(/\b(g_[a-z0-9]+_f\d+)\b/i);
    if(!loadedNameMatch)return null;
    const loadedName=loadedNameMatch[1];
    let exists=this._embeddedFonts?.has?.(loadedName);
    if(!exists){
      try{exists=[...document.fonts].some(f=>f.family===loadedName);}catch{}
    }
    return exists?loadedName:null;
  }
  _font(n){
    const l=String(n||'').toLowerCase();

    const standard=_standardBrowserFontFamily(n);
    if(standard)return standard;

    const embeddedFace=this._embeddedFontFace(n);
    if(embeddedFace)return`"${embeddedFace}"`;

    // Keep embedded PDF.js fonts only when there is no stable Word/browser
    // fallback. Some embedded LaTeX fonts render too heavy in Word text boxes.
    const loadedNameMatch=String(n||'').match(/\b(g_[a-z0-9]+_f\d+)\b/i);
    if(loadedNameMatch){
      const loadedName=loadedNameMatch[1];
      let exists=this._embeddedFonts?.has?.(loadedName);
      if(!exists){
        try{exists=[...document.fonts].some(f=>f.family===loadedName);}catch{}
      }
      if(exists)return`"${loadedName}"`;
    }
    
    // Step 2: Try raw font name after stripping PDF subset prefix
    const cleanName=String(n||'').replace(/^[A-Z]{6}\+/,'').trim();
    if(cleanName&&cleanName!==n){
      // Check if this font exists in document.fonts
      const exists=[...document.fonts].some(f=>f.family.toLowerCase()===cleanName.toLowerCase());
      if(exists)return`"${cleanName}",sans-serif`;
    }

    const known=_knownWebFontFamily(n);
    if(known)return`"${known}",${/script/i.test(known)?'cursive':'sans-serif'}`;
    
    // Step 3: Fall back to standard font mapping
    if(l.includes('courier')||l.includes('mono'))return'Courier New,monospace';
    if(l.includes('times')||l.includes('tinos')||l.includes('lmroman')||l.includes('latinmodernroman')||/\blmr(?:oman)?\d*/i.test(l)||/\bcmr\d*/i.test(l)||l.includes('georgia')||l.includes('cambria')||l.includes('garamond')||l.includes('liberationserif')||l.includes('nimbusrom')||(l.includes('serif')&&!l.includes('sans')))return'Times New Roman,serif';
    if(l.includes('helvetica')||l.includes('arial'))return'Arial,sans-serif';
    return'sans-serif';
  }
  _docxFont(n){
    const loadedName=String(n||'').match(/\b(g_[a-z0-9]+_f\d+)\b/i)?.[1];
    const embedded=loadedName?this._embeddedFonts.get(loadedName):null;
    return docxFontNameFromEmbeddedPdfFont(embedded)||cleanFontNameForDocx(this._font(n));
  }
  _bold(n){
    const clean=String(n||'').replace(/^[A-Z]{6}\+/,'').trim().toLowerCase();
    if(/(bold|black|heavy|demi|semibold|extrabold|ultrabold)/.test(clean))return true;
    if(/(?:^|[-+_,\s])medi(?:[-+_,\s]|$)/.test(clean)&&/(nimbusrom|times|roman|serif|ptm)/.test(clean))return true;
    if(/\b(cmbx|cmbf|cmb|ptmb|phvb|pcrb)\d*/.test(clean))return true;
    if(/(^|[-+_,\s])(b|bd|bf|bx)([-+_,\s]|$)/.test(clean))return true;
    if(/[-+_,\s]b$/.test(clean))return true;
    return false;
  }
  _italic(n){
    const clean=String(n||'').replace(/^[A-Z]{6}\+/,'').trim().toLowerCase();
    if(/(italic|oblique|slanted|inclined|obli|ital(?:ic)?)/.test(clean))return true;
    if(/\b(cmmi|cmti|cmsl|ptmri|phvri|pcrri)\d*/.test(clean))return true;
    if(/(^|[-+_,\s])(it|ital|i|sl)([-+_,\s]|$)/.test(clean))return true;
    if(/[-+_,\s]i$/.test(clean))return true;
    return false;
  }

  async getExportBytes(){
    // If we stored full bytes, return them
    if(this._bytes)return this._bytes;
    
    // For large files (>50MB), read in chunks to avoid memory spike
    if(this._file){
      const fileSize=this._file.size;
      if(fileSize>50*1024*1024){
        // Read file in chunks to reduce memory pressure
        return await this._readFileInChunks(this._file);
      }
      const buf=await this._file.arrayBuffer();
      return buf;
    }
    
    if(this._fileHandle){
      const file=await this._fileHandle.getFile();
      const fileSize=file.size;
      if(fileSize>50*1024*1024){
        return await this._readFileInChunks(file);
      }
      const buf=await file.arrayBuffer();
      return buf;
    }
    
    return null;
  }
  
  async _readFileInChunks(file){
    // Read file in 10MB chunks to reduce memory pressure
    const CHUNK_SIZE=10*1024*1024;
    const chunks=[];
    let offset=0;
    
    while(offset<file.size){
      const end=Math.min(offset+CHUNK_SIZE,file.size);
      const blob=file.slice(offset,end);
      const chunk=await blob.arrayBuffer();
      chunks.push(new Uint8Array(chunk));
      offset=end;
      
      // Allow garbage collection between chunks
      await yieldToBrowser();
    }
    
    // Combine chunks into single buffer
    const totalLength=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
    const result=new Uint8Array(totalLength);
    let position=0;
    for(const chunk of chunks){
      result.set(chunk,position);
      position+=chunk.length;
    }
    
    return result.buffer;
  }

  destroy(){
    if(this.pdfDoc){this.pdfDoc.destroy();this.pdfDoc=null;}
    this._pageCache.clear();this._fontsPrimed.clear();this._embeddedFonts.clear();this._legacyEncodedFonts.clear();this._bytes=null;this._file=null;
  }
}

// OCR removed

// Low-level content stream patching used by Edit PDF exports. This removes the
// original selectable text when a native PDF text object is moved/edited, so the
// exported PDF does not contain both the old and new copies in its text layer.
function _pdfPatchMul(m1,m2){return[
  m1[0]*m2[0]+m1[1]*m2[2],m1[0]*m2[1]+m1[1]*m2[3],
  m1[2]*m2[0]+m1[3]*m2[2],m1[2]*m2[1]+m1[3]*m2[3],
  m1[4]*m2[0]+m1[5]*m2[2]+m2[4],m1[4]*m2[1]+m1[5]*m2[3]+m2[5]
];}
function _pdfPatchTokenize(str){
  const tokens=[];let i=0,len=str.length;
  while(i<len){
    const ch=str.charCodeAt(i);
    if(ch===0||ch===9||ch===10||ch===12||ch===13||ch===32){i++;continue;}
    if(ch===37){while(i<len&&str.charCodeAt(i)!==10&&str.charCodeAt(i)!==13)i++;continue;}
    if(ch===40){let depth=1,start=i;i++;while(i<len&&depth>0){const c=str.charCodeAt(i);if(c===92){i+=2;continue;}if(c===40)depth++;if(c===41)depth--;i++;}tokens.push({t:'s',v:str.slice(start,i)});continue;}
    if(ch===60&&(i+1>=len||str.charCodeAt(i+1)!==60)){const start=i;i++;while(i<len&&str.charCodeAt(i)!==62)i++;i++;tokens.push({t:'h',v:str.slice(start,i)});continue;}
    if(ch===60&&i+1<len&&str.charCodeAt(i+1)===60){tokens.push({t:'p',v:'<<'});i+=2;continue;}
    if(ch===62&&i+1<len&&str.charCodeAt(i+1)===62){tokens.push({t:'p',v:'>>'});i+=2;continue;}
    if(ch===91){tokens.push({t:'p',v:'['});i++;continue;}
    if(ch===93){tokens.push({t:'p',v:']'});i++;continue;}
    if(ch===47){let name='/';i++;while(i<len){const c=str.charCodeAt(i);if(c<=32||c===40||c===41||c===60||c===62||c===91||c===93||c===123||c===125||c===47||c===37)break;name+=str[i];i++;}tokens.push({t:'n',v:name});continue;}
    let word='';while(i<len){const c=str.charCodeAt(i);if(c<=32||c===40||c===41||c===60||c===62||c===91||c===93||c===123||c===125||c===47||c===37)break;word+=str[i];i++;}
    if(word)tokens.push({t:/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)?'#':'k',v:word});
  }
  return tokens;
}
const _PDF_PATCH_OPS=new Set(['b','B','b*','B*','BDC','BI','BMC','BT','BX','c','cm','CS','cs','d','d0','d1','Do','DP','EMC','ET','EX','f','F','f*','G','g','gs','h','i','j','J','K','k','l','m','M','MP','n','q','Q','re','RG','rg','ri','s','S','SC','sc','SCN','scn','sh','T*','Tc','Td','TD','Tf','Tj','TJ','TL','Tm','Tr','Ts','Tw','Tz','v','w','W','W*','y',"'",'"']);
function _pdfPatchCharCount(tok){if(tok.t==='s')return Math.max(tok.v.length-2,0);const n=tok.v.length-2;return n%4===0?n/4:n/2;}
function _pdfPatchVisibleCount(str){return Array.from(str||'').length;}
function _pdfPatchLiteralUnits(raw){const units=[];for(let i=0;i<raw.length;i++){if(raw[i]!=='\\'){units.push(raw[i]);continue;}let u=raw[i];i++;if(i>=raw.length){units.push(u);break;}u+=raw[i];if(/[0-7]/.test(raw[i])){for(let j=0;j<2&&i+1<raw.length&&/[0-7]/.test(raw[i+1]);j++){i++;u+=raw[i];}}else if(raw[i]==='\r'&&raw[i+1]==='\n'){i++;u+=raw[i];}units.push(u);}return units;}
function _pdfPatchUnits(tok,hint=0){const raw=tok.v.slice(1,-1);if(tok.t==='s')return _pdfPatchLiteralUnits(raw);const hex=raw.replace(/\s+/g,''),bytes=hex.length/2,bpc=hint>0&&bytes>=hint*1.5?2:1,step=bpc*2,out=[];for(let i=0;i<hex.length;i+=step)out.push(hex.slice(i,i+step));return out;}
function _pdfPatchString(tok,units){if(!units.length)return'';return tok.t==='h'?`<${units.join('')}>`:`(${units.join('')})`;}
function _pdfPatchEscapeRegExp(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function _pdfPatchBlankLiteralTexts(streamStr,texts=[]){
  const targets=[...new Set(texts.map(t=>String(t||'').trim()).filter(t=>t.length>2))];
  if(!targets.length)return streamStr;
  return targets.reduce((out,text)=>{
    const blank=' '.repeat(text.length);
    return out.replace(new RegExp(_pdfPatchEscapeRegExp(text),'g'),blank);
  },streamStr);
}
function _pdfPatchHits(x,y,w,h,reds){for(const r of reds){const ol=Math.max(x,r.x),or=Math.min(x+w,r.x+r.width);if(or<=ol)continue;if(y>=r.y-h*.15&&y<=r.y+r.height)return true;}return false;}
function _pdfPatchRanges(ranges,x,y,w,h,start,count,reds){if(count<=0||w<=0)return;const unitW=w/count;for(const r of reds){if(!(y>=r.y-h*.15&&y<=r.y+r.height))continue;const ol=Math.max(x,r.x),or=Math.min(x+w,r.x+r.width);if(or<=ol)continue;const coverage=(or-ol)/w;if(coverage>.72){ranges.push({start,end:start+count,width:w});continue;}const s=Math.max(0,Math.floor((ol-x)/unitW)),e=Math.min(count,Math.ceil((or-x)/unitW));if(e>s)ranges.push({start:start+s,end:start+e,width:(e-s)*unitW});}}
function _pdfPatchBuildSplit(tok,ranges,hScale,units){
  const sorted=ranges.filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
  for(const r of sorted){const last=merged[merged.length-1];if(last&&r.start<=last.end){const add=Math.max(0,r.end-Math.max(last.end,r.start)),uw=r.width/(r.end-r.start);last.end=Math.max(last.end,r.end);last.width+=add*uw;}else merged.push({...r});}
  if(!merged.length)return null;
  const parts=[];let cursor=0;
  for(const r of merged){if(r.start>cursor){const kept=_pdfPatchString(tok,units.slice(cursor,r.start));if(kept)parts.push(kept);}if(r.end>r.start&&hScale>0)parts.push(String(Math.round(-(r.width/hScale)*1000)));cursor=Math.max(cursor,r.end);}
  if(cursor<units.length){const kept=_pdfPatchString(tok,units.slice(cursor));if(kept)parts.push(kept);}
  return parts.some(p=>p.startsWith('(')||p.startsWith('<'))?`[ ${parts.join(' ')} ]`:'BLANK_ALL';
}
function _pdfPatchBlankText(streamStr,reds,textItems=[]){
  const tokens=_pdfPatchTokenize(streamStr),stack=[];let ctm=[1,0,0,1,0,0],tm=[1,0,0,1,0,0],tlm=[1,0,0,1,0,0],fontSize=12,leading=0,inText=false;
  const operands=[];
  const splitTok=(tok,x,y,w,h,hScale)=>{
    const fallbackUnits=_pdfPatchUnits(tok),fallbackW=w>0?w:fallbackUnits.length*(hScale*.55);
    const fallback=()=>{const ranges=[];_pdfPatchRanges(ranges,x,y,fallbackW,h,0,fallbackUnits.length,reds);return _pdfPatchBuildSplit(tok,ranges,hScale,fallbackUnits);};
    if(!textItems.length)return fallback();
    const line=textItems.filter(it=>Math.abs(it.y-y)<=Math.max(h*1.5,3)&&it.str&&it.x+it.width>=x-h&&it.x<=x+fallbackW+h).sort((a,b)=>a.x-b.x);
    if(!line.length)return fallback();
    const visible=line.reduce((s,it)=>s+_pdfPatchVisibleCount(it.str),0),units=_pdfPatchUnits(tok,visible),ranges=[];let unitOff=0,visOff=0;
    for(const it of line){const vc=_pdfPatchVisibleCount(it.str),nextVis=visOff+vc,nextUnit=visible>0?Math.round((nextVis/visible)*units.length):unitOff+vc,count=Math.max(0,nextUnit-unitOff);_pdfPatchRanges(ranges,it.x,it.y,it.width||((count/Math.max(units.length,1))*fallbackW),h,unitOff,count,reds);visOff=nextVis;unitOff=nextUnit;}
    if(unitOff<units.length){const count=units.length-unitOff;_pdfPatchRanges(ranges,x+fallbackW*unitOff/Math.max(units.length,1),y,fallbackW*count/Math.max(units.length,1),h,unitOff,count,reds);}
    return _pdfPatchBuildSplit(tok,ranges,hScale,units);
  };
  for(let i=0;i<tokens.length;i++){
    const tok=tokens[i];if(tok.t!=='k'||!_PDF_PATCH_OPS.has(tok.v)){operands.push(i);continue;}
    const op=tok.v,nums=()=>operands.map(j=>tokens[j]).filter(t=>t.t==='#').map(t=>parseFloat(t.v));
    if(op==='q')stack.push([...ctm]);if(op==='Q'&&stack.length)ctm=stack.pop();if(op==='cm'){const n=nums();if(n.length===6)ctm=_pdfPatchMul(n,ctm);}
    if(op==='BT'){inText=true;tm=[1,0,0,1,0,0];tlm=[1,0,0,1,0,0];}if(op==='ET')inText=false;if(op==='Tf'){const n=nums();if(n.length)fontSize=Math.abs(n[n.length-1]);}if(op==='TL'){const n=nums();if(n.length)leading=n[0];}
    if(op==='Tm'){const n=nums();if(n.length===6){tm=[...n];tlm=[...n];}}if(op==='Td'||op==='TD'){const n=nums();if(n.length>=2){if(op==='TD')leading=-n[1];const m=[1,0,0,1,n[0],n[1]];tlm=_pdfPatchMul(m,tlm);tm=[...tlm];}}if(op==='T*'){const m=[1,0,0,1,0,-leading];tlm=_pdfPatchMul(m,tlm);tm=[...tlm];}
    if(inText&&op==='TJ'){
      const pos=_pdfPatchMul(tm,ctm);let x=pos[4];const y=pos[5],h=fontSize*Math.abs(tm[3]||1),hScale=fontSize*Math.abs(tm[0]||1),avg=hScale*.55,parts=[];let changed=false;
      for(const j of operands){const t=tokens[j];if(t.t==='p')continue;if(t.t==='#'){x-=parseFloat(t.v)/1000*hScale;parts.push(t.v);continue;}if(t.t==='s'||t.t==='h'){const w=_pdfPatchCharCount(t)*avg;if(_pdfPatchHits(x,y,w,h,reds)){const split=splitTok(t,x,y,w,h,hScale);parts.push(split==='BLANK_ALL'?(t.t==='s'?'()':'<>'):split?split.slice(1,-1).trim():(t.t==='s'?'()':'<>'));changed=true;}else parts.push(t.v);x+=w;}}
      if(changed){const arr='[ '+parts.join(' ')+' ]';operands.forEach((idx,k)=>{tokens[idx].v=k===0?arr:'';tokens[idx].t='p';});}
      operands.length=0;continue;
    }
    if(inText&&(op==='Tj'||op==="'"||op==='"')){
      if(op==="'"||op==='"'){const m=[1,0,0,1,0,-leading];tlm=_pdfPatchMul(m,tlm);tm=[...tlm];}
      const pos=_pdfPatchMul(tm,ctm),h=fontSize*Math.abs(tm[3]||1),idx=operands.find(j=>tokens[j].t==='s'||tokens[j].t==='h');
      if(idx!==undefined){const st=tokens[idx],hScale=fontSize*Math.abs(tm[0]||1),w=_pdfPatchCharCount(st)*hScale*.55;if(_pdfPatchHits(pos[4],pos[5],w,h,reds)){const split=splitTok(st,pos[4],pos[5],w,h,hScale);if(split==='BLANK_ALL')st.v=st.t==='s'?'()':'<>';else if(split){st.v=split;st.t='p';tokens[i].v='TJ';}else st.v=st.t==='s'?'()':'<>';}}
    }
    if(op==='BI'){let id=i+1;while(id<tokens.length&&!(tokens[id].t==='k'&&tokens[id].v==='ID'))id++;let ei=id+1;while(ei<tokens.length&&!(tokens[ei].t==='k'&&tokens[ei].v==='EI'))ei++;i=ei;}
    operands.length=0;
  }
  return tokens.map(t=>t.v).join(' ');
}
async function _pdfPatchDecompressFlate(data){for(const fmt of['deflate','raw']){try{const ds=new DecompressionStream(fmt);return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());}catch{}}return null;}


// Inline fallback for check array since pdfjs does not export it
function ariaCheckIsArray(v) {
  return Array.isArray(v);
}

// ── MAIN APP OBJECT ──────────────────────────────────────────────────
const app = (() => {
  const parser = new PDFParser();
  let uploadedFile = null;
  const layoutMode = 'fidelity';
  let isScanned = false;
  let totalPages = 0;
  
  // Render pages asynchronously to build thumbnails
  async function loadFile(file) {
    if (!file) return;
    uploadedFile = file;
    
    // Clear status
    isScanned = false;
    document.getElementById('preview-grid').innerHTML = '';
    
    // Set UI details
    document.getElementById('info-filename').textContent = file.name;
    document.getElementById('info-filesize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    
    showProg('Analyzing PDF Structure...', 'Reading document metadata...', 10);
    
    try {
      // Direct load via pdfjsLib
      window.pdfjsLib = pdfjsLib;
      await parser.loadFromFile(file);
      totalPages = parser.pageCount;
      document.getElementById('info-pages').textContent = totalPages;
      
      // Update UI panels
      document.getElementById('drop-zone').style.display = 'none';
      document.getElementById('conversion-panel').style.display = 'grid';
      
      // Render previews sequentially
      updProg('Generating page previews...', 30);
      let textDetected = false;
      const previewGrid = document.getElementById('preview-grid');
      
      for (let pi = 0; pi < totalPages; pi++) {
        // Build skeleton
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'thumb-item';
        thumbWrap.innerHTML = '<div class="thumb-skeleton"></div>';
        previewGrid.appendChild(thumbWrap);
        
        // Render canvas preview
        try {
          const page = await parser.getPage(pi);
          const scale = 0.18; // Smaller thumbnail scale
          const vp = page.getViewport({ scale });
          const cvs = document.createElement('canvas');
          cvs.width = Math.round(vp.width); cvs.height = Math.round(vp.height);
          await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
          
          thumbWrap.querySelector('.thumb-skeleton').replaceWith(cvs);
          
          // Test text presence
          if (!textDetected) {
            const tc = await page.getTextContent();
            if (tc.items.some(item => item.str && item.str.trim())) {
              textDetected = true;
            }
          }
        } catch (e) {
          console.warn('Thumbnail generation failed for page', pi, e);
        } finally {
          parser.releasePage(pi);
        }
        
        // Yield thread
        await yieldToBrowser();
      }
      
      isScanned = !textDetected;
      document.getElementById('info-type').textContent = isScanned ? 'Scanned PDF (Image)' : 'Text-based PDF';
      if (isScanned) {
        snack('Scanned PDF detected. Will convert using image-based layout fallback.', 'warn', 5000);
      }
      
      hideProg();
    } catch (e) {
      hideProg();
      console.error(e);
      snack('Failed to load PDF: ' + e.message, 'error', 6000);
    }
  }

  // PDF to DOCX generation workflow
  async function startConversion() {
    if (!uploadedFile) return;
    if (!await ensureCurrentDevSession()) return;

    const conversionTiming = beginConversionTiming(uploadedFile, totalPages);
    showProg('Converting PDF...', 'Extracting elements...', 5);
    
    try {
      const sections = [];
      const alignmentMap = {
        'left': docx.AlignmentType.LEFT,
        'center': docx.AlignmentType.CENTER,
        'right': docx.AlignmentType.RIGHT,
        'justify': docx.AlignmentType.JUSTIFY
      };

      for (let pi = 0; pi < totalPages; pi++) {
        const pageWallStartedAt = Date.now();
        const pageProfile = window.__PDFOMNI_PROFILE ? { page: pi + 1 } : null;
        const pageStartedAt = performance.now();
        let phaseStartedAt = pageStartedAt;
        const markPagePhase = name => {
          if (!pageProfile) return;
          const now = performance.now();
          pageProfile[name] = Math.round(now - phaseStartedAt);
          phaseStartedAt = now;
        };
        const profilePageStep = (name, callback) => {
          if (!pageProfile) return callback();
          const startedAt = performance.now();
          const result = callback();
          pageProfile[name] = Math.round(performance.now() - startedAt);
          return result;
        };
        try {
        updProg(`Processing page ${pi + 1} of ${totalPages}...`, 10 + (pi / totalPages) * 75);
        
        // 1. Get viewport size and calculate native dimensions in points
        const page = await parser.getPage(pi);
        const vp = page.getViewport({ scale: RENDER_SCALE });
        const widthPt = vp.width / RENDER_SCALE;
        const heightPt = vp.height / RENDER_SCALE;
        const isLandscapePage = widthPt > heightPt;
        
        // Setup standard section properties in dxa (1 pt = 20 dxa)
        const sectionProperties = {
          page: {
            size: {
              width: (isLandscapePage ? heightPt : widthPt) * 20,
              height: (isLandscapePage ? widthPt : heightPt) * 20,
              orientation: isLandscapePage ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT
            },
            margin: {
              top: layoutMode === 'fidelity' ? 0 : 720,    // 0.5in standard margins for flowable layouts
              bottom: layoutMode === 'fidelity' ? 0 : 720,
              left: layoutMode === 'fidelity' ? 0 : 720,
              right: layoutMode === 'fidelity' ? 0 : 720
            }
          }
        };

        const pageChildren = [];
        markPagePhase('setup');

        // 2. Fallback for scanned PDFs: Render the page canvas and insert it as a full-page background image
        if (isScanned) {
          const canvas = document.createElement('canvas');
          await parser.renderToCanvas(pi, canvas);
          const buffer = await canvasToOptimizedImageBuffer(canvas);
          canvas.width = 0; canvas.height = 0; // Clear memory immediately

          if (layoutMode === 'fidelity') {
            // Absolute full page background
            pageChildren.push(new docx.Paragraph({
              children: [
                makeImageRun(buffer, {
                  transformation: {
                    width: pointsToDocxImagePx(widthPt),
                    height: pointsToDocxImagePx(heightPt)
                  },
                  floating: {
                    horizontalPosition: {
                      relative: docx.HorizontalPositionRelativeFrom.PAGE,
                      offset: 0
                    },
                    verticalPosition: {
                      relative: docx.VerticalPositionRelativeFrom.PAGE,
                      offset: 0
                    },
                    wrap: {
                      type: docx.TextWrappingType.NONE
                    }
                  }
                })
              ]
            }));
          } else {
            // Flow layout full page image
            pageChildren.push(new docx.Paragraph({
              alignment: docx.AlignmentType.CENTER,
              children: [
                makeImageRun(buffer, {
                  transformation: {
                    width: widthPt - 72, // adjust for margin (0.5 inch margins = 72 pt padding)
                    height: heightPt - 72
                  }
                })
              ]
            }));
          }
          
          sections.push({
            properties: sectionProperties,
            children: pageChildren
          });
          markPagePhase('scannedPage');
          
          await yieldToBrowser();
          continue;
        }

        // Render first so PDF.js initializes the page's fonts during the same
        // full-resolution pass used by the visual analysis below. Extracting
        // first would otherwise trigger a separate font-priming render.
        const canvas = document.createElement('canvas');
        await parser.renderToCanvas(pi, canvas);
        markPagePhase('analysisRender');

        // 3. Extract text structures, images and links
        let {
          textObjs,
          imageObjs,
          vectorObjs = [],
          annotationCount = 0,
          widgetCount = 0
        } = await parser.extractObjects(pi);
        // Keep the unmerged native image objects for clean-pixel restoration.
        // Merging is useful for DOCX placement, but a merged wrapper cannot be
        // mapped back to one original PDF image when removing overlay text.
        const nativeImageObjs = imageObjs.slice();
        markPagePhase('objectExtraction');

        // Extract native images from the page canvas based on coordinates (reusing editpdf.html hydrate technique)
        textObjs = profilePageStep('repairTextColors', () => repairTextColorsFromCanvas(textObjs, canvas));
        textObjs = profilePageStep('reconcileTextColors', () => reconcileTextColorsWithCanvas(textObjs, canvas));
        await yieldToBrowser();
        textObjs = profilePageStep('filterUnboundedGlyphs', () => filterUnboundedGlyphArtifacts(textObjs, canvas));
        textObjs = profilePageStep('dedupeText', () => dedupeCoincidentTextObjects(textObjs));
        vectorObjs = profilePageStep('reconcileVectorColors', () => reconcileInvisibleVectorColorsWithCanvas(vectorObjs, canvas));
        let rawVectorObjs = vectorObjs.slice();
        vectorObjs = profilePageStep('filterVectors', () => filterPageVisibleVectors(vectorObjs, canvas, imageObjs));
        vectorObjs = profilePageStep('suppressMathIdentifierUnderscores', () =>
          suppressRestoredMathIdentifierUnderscoreVectors(vectorObjs, textObjs));
        await yieldToBrowser();
        imageObjs = profilePageStep('mergeImages', () => mergeFragmentedImageObjects(imageObjs, canvas));
        textObjs = profilePageStep('suppressImageText', () => suppressImageBackedTextOverlays(textObjs, imageObjs, canvas));
        markPagePhase('objectReconciliation');
        await yieldToBrowser();

        let highResolutionCanvas = null;
        let highResolutionGraphicsCanvas = null;
        const getHighResolutionCanvas = async () => {
          if (!highResolutionCanvas) {
            highResolutionCanvas = document.createElement('canvas');
            await parser.renderToCanvas(pi, highResolutionCanvas, IMAGE_RENDER_SCALE);
          }
          return highResolutionCanvas;
        };
        const getHighResolutionGraphicsCanvas = async () => {
          if (!highResolutionGraphicsCanvas) {
            const fullRenderCanvas = await getHighResolutionCanvas();
            highResolutionGraphicsCanvas = document.createElement('canvas');
            await parser.renderGraphicsToCanvas(pi, highResolutionGraphicsCanvas, IMAGE_RENDER_SCALE);
            textObjs = reconcileTextColorsFromRenderDelta(
              textObjs,
              fullRenderCanvas,
              highResolutionGraphicsCanvas,
              IMAGE_RENDER_SCALE / RENDER_SCALE
            );
            textObjs = suppressInvisiblePdfTextOverlays(
              textObjs,
              fullRenderCanvas,
              highResolutionGraphicsCanvas,
              IMAGE_RENDER_SCALE / RENDER_SCALE,
              !(layoutMode === 'fidelity' && widgetCount >= 20 && textObjs.length >= 60)
            );
            restoreFullRenderOutsideEditableText(
              highResolutionGraphicsCanvas,
              fullRenderCanvas,
              textObjs,
              IMAGE_RENDER_SCALE / RENDER_SCALE
            );
            _canvasPixelCache.delete(highResolutionGraphicsCanvas);
          }
          return highResolutionGraphicsCanvas;
        };

        // A page with dozens of AcroForm widgets is a fillable form, not a
        // collection of independent icon images. Rasterizing each widget or
        // rule fragment creates renderer-dependent black boxes and loses the
        // page's continuous fills. Preserve the complete non-text layer once,
        // then keep every extracted text run at its original PDF coordinates.
        const widgetDenseFormPage = layoutMode === 'fidelity' &&
          widgetCount >= 20 &&
          textObjs.length >= 60;
        let fidelityBackground = null;
        if (widgetDenseFormPage) {
          const formGraphicsCanvas = await getHighResolutionGraphicsCanvas();
          fidelityBackground = await canvasToOptimizedImageBuffer(formGraphicsCanvas, false);
          for (const obj of textObjs) {
            if (obj?.data) obj.data._sourcePositionedFormText = true;
          }
          // All of these graphics are already represented by the single clean
          // page backdrop. Re-emitting them as foreground vectors/crops is the
          // source of the random opaque rectangles in Word.
          vectorObjs = [];
          rawVectorObjs = [];
          imageObjs = [];
        }

        let gridTables = layoutMode === 'fidelity' && !widgetDenseFormPage
          ? detectGridTables(canvas).map(grid => normalizeEmptyNarrowGridEdgeColumns(grid, textObjs, canvas))
          : [];
        gridTables = gridTables.filter(grid =>
          isDenseSpreadsheetGrid(grid) &&
          gridHasTabularTextDensity(grid, textObjs) &&
          !gridOverlapsMeaningfulImage(grid, imageObjs, canvas)
        );
        if (gridTables.length) {
          // Native Word tables still need the PDF's non-text visual layer.
          // Without it, entering this fast path drops page fills, logos,
          // signatures, badges and images that sit beside the detected grid.
          // Symbol-font glyphs such as logos are not portable editable text.
          // Leave them out of the Word text layer so the full-render pixels
          // are restored into the graphics layer instead of becoming a tofu
          // box when the source symbol font is unavailable.
          if (findPrivateUseGlyphRegions(textObjs, canvas).length) {
            textObjs = removeRasterizedPrivateUseText(textObjs);
          }
          const gridGraphicsCanvas = await getHighResolutionGraphicsCanvas();
          const gridGraphics = await canvasToOptimizedImageBuffer(gridGraphicsCanvas, false);
          pageChildren.push(new docx.Paragraph({
            children: [
              makeImageRun(gridGraphics, {
                transformation: {
                  width: pointsToDocxImagePx(widthPt),
                  height: pointsToDocxImagePx(heightPt)
                },
                floating: {
                  horizontalPosition: {
                    relative: docx.HorizontalPositionRelativeFrom.PAGE,
                    offset: 0
                  },
                  verticalPosition: {
                    relative: docx.VerticalPositionRelativeFrom.PAGE,
                    offset: 0
                  },
                  wrap: { type: docx.TextWrappingType.NONE },
                  behindDocument: true,
                  allowOverlap: true,
                  zIndex: 1
                }
              })
            ]
          }));
          pageChildren.push(...makeGridTablesPageChildren(gridTables, textObjs, alignmentMap));
          _canvasPixelCache.delete(canvas);
          canvas.width = 0;
          canvas.height = 0;
          sections.push({
            properties: sectionProperties,
            children: pageChildren
          });
          markPagePhase('gridTable');
          await yieldToBrowser();
          continue;
        }
        markPagePhase('gridDetection');

        const orthogonalRotatedLabelCount = textObjs.reduce((count, obj) => {
          const data = obj?.data || {};
          const boxes = Array.isArray(data._lineBoxes) && data._lineBoxes.length ? data._lineBoxes : [obj];
          return count + boxes.filter(box => {
            const rotation = normalizeDegrees(box.rotation ?? obj.rotation ?? data._originalBox?.rotation);
            return Math.abs(rotation - 90) <= 3 || Math.abs(rotation - 270) <= 3;
          }).length;
        }, 0);
        const denseRotatedVectorFigure = imageObjs.length === 0 && vectorObjs.length >= 180 &&
          orthogonalRotatedLabelCount >= 40 && textObjs.length <= 180;
        const markerCellRegions = denseRotatedVectorFigure
          ? []
          : findRepeatedMarkerBackdropRegions(rawVectorObjs, canvas);
        const diagonalConnectorCount = rawVectorObjs.filter(vector => {
          if (vector?.kind !== 'line') return false;
          const dx = Math.abs(Number(vector.x2 || 0) - Number(vector.x1 || 0));
          const dy = Math.abs(Number(vector.y2 || 0) - Number(vector.y1 || 0));
          return dx >= 8 && dy >= 8;
        }).length;
        // Repeated rounded boxes are also common inside architecture diagrams.
        // Marker detection alone must not exempt a connected diagram from
        // compound-figure handling: a meaningful set of diagonal connectors
        // distinguishes those diagrams from independent marker grids.
        const denseConnectorDiagram = imageObjs.length === 0 &&
          vectorObjs.length >= 80 &&
          textObjs.length <= 180 &&
          markerCellRegions.length <= 96 &&
          diagonalConnectorCount >= 8;
        const connectedBoxDiagramRegions = findConnectedBoxDiagramRegions(
          textObjs,
          rawVectorObjs,
          markerCellRegions,
          canvas
        );
        const tiledCompoundDiagramRegions = findTiledCompoundDiagramRegions(
          textObjs,
          rawVectorObjs,
          imageObjs,
          canvas
        );
        const editableMarkerVectors = new Set(rawVectorObjs.filter(vector => markerCellRegions.some(marker =>
          rectIntersectionArea(vector, marker) / Math.max(1, Number(vector?.width || 0) * Number(vector?.height || 0)) >= 0.9
        )));
        const editableMarkerShapes = markerCellRegions.map((marker, index) => ({
          kind: 'roundRect',
          x: marker.sourceX,
          y: marker.sourceY,
          width: marker.sourceWidth,
          height: marker.sourceHeight,
          fill: true,
          stroke: marker.stroke,
          fillColor: marker.fillColor,
          strokeColor: marker.strokeColor,
          thickness: marker.thickness,
          zIndex: 160000 + index
        }));
        const textLineCount = textObjs.reduce((count, obj) => count + Math.max(1, obj?.data?._lineBoxes?.length || obj?.data?.lines?.length || 1), 0);
        const microTextLineCount = textObjs.reduce((count, obj) => {
          const data = obj?.data || {};
          const lineCount = Math.max(1, data?._lineBoxes?.length || data?.lines?.length || 1);
          const fontSize = Number(data.fontSize || data?._originalStyle?.fontSize || 0);
          return count + (fontSize > 0 && fontSize <= 12 ? lineCount : 0);
        }, 0);
        // Embedded document previews combine one or more images with hundreds
        // of tiny text/vector elements. Marker-cell detection is expected
        // inside those previews and must not disable figure recognition.
        const denseEmbeddedPreview = imageObjs.length >= 1 && vectorObjs.length >= 80 &&
          microTextLineCount >= 80 && microTextLineCount / Math.max(1, textLineCount) >= 0.55;
        const denseVectorFigure = imageObjs.length === 0 && vectorObjs.length >= 400 && textObjs.length <= 160;
        const broadComplexFigureRegions = (markerCellRegions.length < 8 || denseEmbeddedPreview || denseVectorFigure || denseRotatedVectorFigure || denseConnectorDiagram) && vectorObjs.length >= 20 && (imageObjs.length || textObjs.length >= 180 || vectorObjs.length >= 80)
          ? findComplexFigureRegions(textObjs, vectorObjs, canvas, imageObjs, { denseRotatedLabels: denseRotatedVectorFigure })
          : [];
        let complexFigureRegions = [
          ...tiledCompoundDiagramRegions,
          ...connectedBoxDiagramRegions,
          ...broadComplexFigureRegions.filter(region => ![...tiledCompoundDiagramRegions, ...connectedBoxDiagramRegions].some(connected =>
            rectIntersectionArea(region, connected) / Math.max(1, region.width * region.height) >= 0.7
          ))
        ];
        complexFigureRegions = trimFigureRegionsAroundCaptions(complexFigureRegions, textObjs);
        if (denseEmbeddedPreview || denseVectorFigure || denseRotatedVectorFigure || denseConnectorDiagram) {
          complexFigureRegions = complexFigureRegions.map(region => ({
            ...region,
            rasterize: true,
            keepRepeatedMarkersInRaster: denseConnectorDiagram
          }));
        }
        const primaryVectorSymbolRegions = findSmallVectorSymbolRegions(vectorObjs, textObjs, canvas, imageObjs);
        const microVectorSymbolRegions = findDenseMicroVectorRegions(vectorObjs, textObjs, canvas, imageObjs)
          .filter(symbol => !primaryVectorSymbolRegions.some(primary =>
            rectIntersectionArea(primary, symbol) / Math.max(1, symbol.width * symbol.height) > 0.7
          ));
        const vectorSymbolRegions = [
          ...primaryVectorSymbolRegions,
          ...microVectorSymbolRegions
        ].filter(symbol => !complexFigureRegions.some(figure => isMostlyInsideAnyRegion(symbol, [figure], 0.6)))
          .filter((symbol, index, regions) => !regions.slice(0, index).some(existing =>
            rectIntersectionArea(existing, symbol) / Math.max(1, symbol.width * symbol.height) > 0.7
          ));
        const compoundVectorArtworkRegions = findCompoundCircularArtworkRegions(vectorObjs, textObjs, canvas);
        markPagePhase('figureRegionDetection');
        await yieldToBrowser();
        const imageSymbolAnchors = imageObjs.map(image => image?.data?._originalBox || image).filter(box => {
          const width = Number(box?.width || 0);
          const height = Number(box?.height || 0);
          const aspect = width / Math.max(1, height);
          return width >= 18 && height >= 18 && width <= 130 && height <= 130 && aspect >= 0.65 && aspect <= 1.45;
        });
        const rotatedTextStripRegions = [];
        const vectorTableBackdropRegions = findTableRuleBackdropRegions(rawVectorObjs, textObjs, canvas);
        const canvasTableBackdropRegions = findCanvasTableRuleBackdropRegions(canvas, textObjs);
        const tableBackdropRegions = [
          ...canvasTableBackdropRegions,
          ...vectorTableBackdropRegions.filter(region => !canvasTableBackdropRegions.some(canvasRegion =>
            isMostlyInsideAnyRegion(region, [canvasRegion], 0.65)
          ))
        ];
        markPagePhase('tableRegionDetection');
        await yieldToBrowser();
        const framedContentPanelRegions = profilePageStep('findFramedPanels', () =>
          findFramedContentPanelRegions(rawVectorObjs, textObjs, imageObjs, canvas));
        const largeRadialVectorRegions = profilePageStep('findRadialVectors', () =>
          findLargeRadialVectorRegions(rawVectorObjs, canvas));
        const leaderLineVectorRegions = profilePageStep('findLeaderVectors', () =>
          findLeaderLineChartRegions(rawVectorObjs, canvas));
        const leaderLineCanvasRegions = profilePageStep('findLeaderCanvas', () =>
          findLeaderLineChartRegionsFromCanvas(canvas));
        const bracketedRadialRegions = profilePageStep('findBracketedRadials', () =>
          findBracketedRadialChartRegions(rawVectorObjs, canvas));
        const largeRadialCanvasRegions = profilePageStep('findRadialCanvas', () =>
          findLargeRadialCanvasRegions(canvas));
        const lightTextPanelRegions = profilePageStep('findLightPanels', () =>
          findLightTextPanelBackdropRegions(rawVectorObjs, textObjs, canvas));
        const radialChartBackdropRegions = profilePageStep('findRadialBackdrops', () =>
          findRadialChartBackdropRegions([...vectorSymbolRegions, ...imageSymbolAnchors], canvas));
        const mergedStructuredRegions = profilePageStep('mergeStructuredRegions', () =>
          mergeConnectedChartBackdropRegions([
            ...tableBackdropRegions,
            // Repeated marker cells already have native vector geometry. Keeping
            // them in the raster backdrop list turns every editable square into
            // an image crop and can also merge neighbouring cells into a single
            // flattened strip. Leave them in vectorObjs so Word receives shapes.
            ...framedContentPanelRegions,
            ...largeRadialVectorRegions,
            ...leaderLineVectorRegions,
            ...leaderLineCanvasRegions,
            ...bracketedRadialRegions,
            ...largeRadialCanvasRegions,
            ...lightTextPanelRegions,
            ...radialChartBackdropRegions
          ], canvas));
        const expandedStructuredRegions = profilePageStep('expandStructuredRegions', () =>
          expandStructuredRegionsToContainingBackdrops(mergedStructuredRegions, rawVectorObjs, textObjs, canvas));
        let structuredBackdropRegions = profilePageStep('dedupeStructuredRegions', () =>
          dedupeRasterRegions(expandedStructuredRegions)).filter(region =>
            !complexFigureRegions.some(figure => isMostlyInsideAnyRegion(region, [figure], 0.65)) &&
            !compoundVectorArtworkRegions.some(artwork => isMostlyInsideAnyRegion(region, [artwork], 0.65)) &&
            !isPageScaleBackdropOverProse(region, textObjs, canvas)
          );
        markPagePhase('structuredRegionDetection');
        textObjs = profilePageStep('reconcileTableBandColors', () =>
          reconcileTextColorsOverChromaticTableBands(textObjs, canvas, structuredBackdropRegions));
        const privateUseGlyphRegions = profilePageStep('findPrivateGlyphs', () =>
          findPrivateUseGlyphRegions(textObjs, canvas));
        const unstableMathGlyphRegions = profilePageStep('findMathGlyphs', () =>
          findUnstableMathGlyphRegions(textObjs, rawVectorObjs, canvas));
        const complexMathRegions = profilePageStep('findComplexMath', () =>
          findComplexMathRegions(textObjs, rawVectorObjs, canvas));
        const corruptTextRegions = [];
        const corruptPanelRegions = [];
        const standaloneVectorSymbolRegions = profilePageStep('filterStandaloneSymbols', () =>
          vectorSymbolRegions.filter(symbol => !structuredBackdropRegions.some(region =>
            region.kind === 'radialChartBackdrop' && isMostlyInsideAnyRegion(symbol, [region], 0.72)
          )).filter(symbol => !compoundVectorArtworkRegions.some(region => isMostlyInsideAnyRegion(symbol, [region], 0.55))));
        const wideDesignBands = rawVectorObjs.flatMap(vector => {
          const width = Number(vector?.width || 0);
          const height = Number(vector?.height || 0);
          const area = width * height;
          const pageArea = Math.max(1, canvas.width * canvas.height);
          const rgb = String(vector?.fillColor || vector?.color || '').replace('#', '');
          if (vector?.fill === false ||
              width < canvas.width * 0.72 ||
              height < canvas.height * 0.01 ||
              area < pageArea * 0.012 ||
              !/^[0-9a-f]{6}$/i.test(rgb)) return [];
          const value = parseInt(rgb, 16);
          const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
          if (Math.max(...channels) - Math.min(...channels) < 10) return [];
          return [{
            x: Number(vector.x || 0),
            y: Number(vector.y || 0),
            width,
            height,
            color: channels
          }];
        });
        if (wideDesignBands.length) {
          vectorObjs = vectorObjs.filter(vector =>
            !wideDesignBands.some(band => isMostlyInsideAnyRegion(vector, [band], 0.98)));
        }
        const rasterFigureRegions = widgetDenseFormPage ? [] : profilePageStep('dedupeFigureRegions', () => dedupeRasterRegions([
            ...complexFigureRegions.filter(region => region.rasterize),
            ...compoundVectorArtworkRegions,
            ...standaloneVectorSymbolRegions,
            ...structuredBackdropRegions,
            ...complexMathRegions,
            ...unstableMathGlyphRegions,
            ...privateUseGlyphRegions
          ]));
        if (pageProfile) {
          pageProfile.textObjects = textObjs.length;
          pageProfile.imageObjects = imageObjs.length;
          pageProfile.vectorObjects = vectorObjs.length;
          pageProfile.rasterRegions = rasterFigureRegions.length;
        }
        markPagePhase('glyphRegionDetection');
        await yieldToBrowser();
        if (window.__PDFOMNI_DEBUG_LAYOUT) {
          console.info('pdfomni-page-layout', JSON.stringify({
            page: pi + 1,
            text: textObjs.length,
            images: imageObjs.length,
            vectors: vectorObjs.length,
            annotations: annotationCount,
            widgets: widgetCount,
            widgetDenseFormPage,
            complexFigureRegions,
            compoundVectorArtworkRegions,
            vectorSymbolRegions,
            structuredBackdropRegions,
            unstableMathGlyphRegions,
            complexMathRegions,
            corruptTextRegions
          }));
        }
        const figureImages = [];
        for (const band of wideDesignBands) {
          const bandCanvas = createRasterWorkCanvas(4, 4);
          const bandCtx = bandCanvas.getContext('2d');
          bandCtx.fillStyle = `rgb(${band.color[0]},${band.color[1]},${band.color[2]})`;
          bandCtx.fillRect(0, 0, bandCanvas.width, bandCanvas.height);
          figureImages.push({
            x: band.x / RENDER_SCALE,
            y: band.y / RENDER_SCALE,
            width: band.width / RENDER_SCALE,
            height: band.height / RENDER_SCALE,
            foreground: false,
            buffer: await canvasToOptimizedImageBuffer(bandCanvas, false)
          });
          bandCanvas.width = 0;
          bandCanvas.height = 0;
        }
        const solidPageBackground = fidelityBackground ? null : detectSolidPageBackground(canvas);
        if (solidPageBackground) {
          const backgroundCanvas = createRasterWorkCanvas(4, 4);
          const backgroundCtx = backgroundCanvas.getContext('2d');
          backgroundCtx.fillStyle = `rgb(${solidPageBackground[0]},${solidPageBackground[1]},${solidPageBackground[2]})`;
          backgroundCtx.fillRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
          figureImages.push({
            x: 0,
            y: 0,
            width: widthPt,
            height: heightPt,
            foreground: false,
            buffer: await canvasToOptimizedImageBuffer(backgroundCanvas, false)
          });
          backgroundCanvas.width = 0;
          backgroundCanvas.height = 0;
        }
        if (rasterFigureRegions.length) {
          const figureCanvas = await getHighResolutionCanvas();
          const cleanFigureCanvas = rasterFigureRegions.some(region => region.preserveText && !region.syntheticPanel)
            ? await getHighResolutionGraphicsCanvas()
            : null;
          const figureScaleRatio = IMAGE_RENDER_SCALE / RENDER_SCALE;
          const rasterizedFigures = await mapWithConcurrency(rasterFigureRegions, RASTER_ENCODE_CONCURRENCY, async region => {
            const figureStartedAt = performance.now();
            const sourceFigureCanvas = region.preserveText && cleanFigureCanvas?._pdfomniGraphicsOnly
              ? cleanFigureCanvas
              : figureCanvas;
            const sx = Math.max(0, Math.floor(region.x * figureScaleRatio));
            const sy = Math.max(0, Math.floor(region.y * figureScaleRatio));
            const sw = Math.min(sourceFigureCanvas.width - sx, Math.ceil(region.width * figureScaleRatio));
            const sh = Math.min(sourceFigureCanvas.height - sy, Math.ceil(region.height * figureScaleRatio));
            if (sw < 8 || sh < 8) return null;
            const c = createRasterWorkCanvas(sw, sh);
            const cropCtx = c.getContext('2d', { willReadFrequently: true });
            if (region.syntheticPanel) {
              const inset = Math.max(0, Number(region.panelInset || 0) * figureScaleRatio);
              const radius = Math.max(0, Number(region.panelRadius || 0) * figureScaleRatio);
              const [r, g, b] = Array.isArray(region.panelColor) ? region.panelColor : [255, 255, 255];
              cropCtx.fillStyle = `rgb(${r},${g},${b})`;
              cropCtx.beginPath();
              cropCtx.roundRect(inset, inset, Math.max(1, sw - inset * 2), Math.max(1, sh - inset * 2), radius);
              cropCtx.fill();
            } else {
              cropCtx.drawImage(sourceFigureCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
              if (region.kind === 'vectorSymbol' || region.kind === 'microVectorSymbol') {
                drawVectorObjectsIntoRasterRegion(cropCtx, region, vectorObjs, figureScaleRatio);
              }
              if (region.transparentBackground) {
                makeCanvasBackgroundTransparent(cropCtx);
                if (region.kind === 'mathGlyph') {
                  maskMathCropToSourceGeometry(cropCtx, region, figureScaleRatio);
                }
              }
              const graphicsOnly = sourceFigureCanvas._pdfomniGraphicsOnly === true;
              if (region.chromaticTableBackdrop) {
                synthesizeChromaticTableBackdrop(cropCtx);
                if (!graphicsOnly) eraseTextFromImageCrop(cropCtx, region, textObjs, figureScaleRatio, false);
              } else if (region.neutralTableBackdrop) {
                const ruleCanvas = createRasterWorkCanvas(sw, sh);
                const ruleCtx = ruleCanvas.getContext('2d');
                ruleCtx.drawImage(c, 0, 0);
                synthesizeNeutralTableRuleBackdrop(ruleCtx);
                if (!graphicsOnly) eraseTextFromImageCrop(cropCtx, region, textObjs, figureScaleRatio, false);
                cropCtx.drawImage(ruleCanvas, 0, 0);
                ruleCanvas.width = 0;
                ruleCanvas.height = 0;
              } else if (region.preserveText) {
                if (!graphicsOnly) {
                  const preserveLineArt = ['leaderLineChartBackdrop', 'radialChartBackdrop'].includes(region.kind);
                  eraseTextFromImageCrop(cropCtx, region, textObjs, figureScaleRatio, preserveLineArt);
                  restoreTextAreasFromNativeImages(cropCtx, region, textObjs, nativeImageObjs, figureScaleRatio);
                }
              }
              const selfContainedVectorSymbol = region.kind === 'vectorSymbol' || region.kind === 'microVectorSymbol';
              if (!region.keepRepeatedMarkersInRaster && !selfContainedVectorSymbol) {
                clearRepeatedMarkerCellsFromRaster(cropCtx, region, markerCellRegions, figureScaleRatio);
              }
            }
            const photographic = !region.syntheticPanel && canvasRegionLooksPhotographic(
              canvas,
              region,
              (IMAGE_RENDER_SCALE / RENDER_SCALE) ** 2
            );
            const figurePreparedAt = performance.now();
            const buffer = await canvasToOptimizedImageBuffer(c, photographic);
            const result = {
              x: region.x / RENDER_SCALE,
              y: region.y / RENDER_SCALE,
              width: region.width / RENDER_SCALE,
              height: region.height / RENDER_SCALE,
              foreground: region.foreground === true,
              buffer,
              _profile: pageProfile ? {
                prepare: Math.round(figurePreparedAt - figureStartedAt),
                encode: Math.round(performance.now() - figurePreparedAt)
              } : null
            };
            c.width = 0;
            c.height = 0;
            return result;
          });
          figureImages.push(...rasterizedFigures.filter(Boolean));
          if (pageProfile) pageProfile.figureTimings = figureImages.map(image => image._profile);
          for (const image of figureImages) delete image._profile;
          if (figureImages.length) {
            if (corruptTextRegions.length) textObjs = removeRasterizedCorruptText(textObjs);
            if (privateUseGlyphRegions.length) textObjs = removeRasterizedPrivateUseText(textObjs);
            if (unstableMathGlyphRegions.length) {
              textObjs = removeRasterizedMathGlyphRuns(textObjs, unstableMathGlyphRegions);
              vectorObjs = vectorObjs.filter(vector =>
                !isMostlyInsideAnyRegion(vector, unstableMathGlyphRegions, 0.72));
            }
            if (complexMathRegions.length) textObjs = removeRasterizedComplexMathText(textObjs, complexMathRegions);
            if (corruptPanelRegions.length) {
              textObjs = textObjs.filter(obj => !textObjectVisualBoxes(obj).some(box => isMostlyInsideAnyRegion(box, corruptPanelRegions, 0.45)));
            }
            if (rotatedTextStripRegions.length) {
              textObjs = textObjs.filter(obj => !textObjectVisualBoxes(obj).some(box => isMostlyInsideAnyRegion(box, rotatedTextStripRegions, 0.35)));
            }
            textObjs = textObjs.filter(obj => {
              const d = obj.data || {};
              const boxes = Array.isArray(d._lineBoxes) && d._lineBoxes.length ? d._lineBoxes : [obj];
              const lines = Array.isArray(d.lines) ? d.lines : [];
              return !boxes.some((box, index) => {
                const lineText = Array.isArray(lines[index])
                  ? lines[index].map(run => String(run?.text || '')).join('')
                  : String(d.content || '');
                const visualBox = {
                  x: box.x ?? obj.x,
                  y: box.y ?? obj.y,
                  width: box.width ?? obj.width,
                  height: box.height ?? obj.height,
                  text: lineText
                };
                return complexFigureRegions.some(region => region.rasterize && shouldDropTextBoxForFigureRegion(visualBox, region));
              });
            });
            const pageArea = Math.max(1, canvas.width * canvas.height);
            vectorObjs = vectorObjs.filter(vector => {
              const area = Math.max(0, Number(vector?.width || 0) * Number(vector?.height || 0));
              const largeFilledBackdrop = vector?.fill !== false && vector?.kind !== 'line' && area >= pageArea * 0.015;
              const chartRegions = rasterFigureRegions.filter(region => region.kind === 'radialChartBackdrop' || region.kind === 'leaderLineChartBackdrop');
              const nonChartRegions = rasterFigureRegions.filter(region => region.kind !== 'radialChartBackdrop' && region.kind !== 'leaderLineChartBackdrop');
              if (isMostlyInsideAnyRegion(vector, nonChartRegions, largeFilledBackdrop ? 0.92 : 0.35)) return false;
              return !isMostlyInsideAnyRegion(vector, chartRegions, 0.92);
            });
            imageObjs = imageObjs.filter(img => !isMostlyInsideAnyRegion(img.data?._originalBox || img, rasterFigureRegions, 0.92));
          }
        }
        if (editableMarkerShapes.length) {
          vectorObjs = vectorObjs.filter(vector => !editableMarkerVectors.has(vector));
          vectorObjs.push(...editableMarkerShapes.filter(shape => !complexFigureRegions.some(region =>
            region.rasterize && region.keepRepeatedMarkersInRaster && isMostlyInsideAnyRegion(shape, [region], 0.9)
          )));
        }
        markPagePhase('figureRasterization');
        await yieldToBrowser();
        
        const embeddedImages = [];
        let imageCanvas = highResolutionGraphicsCanvas;
        const imageScaleRatio = IMAGE_RENDER_SCALE / RENDER_SCALE;
        const imageCandidates = imageObjs.map(img => ({
          img,
          box: expandPhotographicImageBox(canvas, img.data?._originalBox || img, textObjs)
        })).filter(({ box }) => !isLowInformationImageCrop(canvas, box))
          .map(candidate => ({
            ...candidate,
            photographic: canvasRegionLooksPhotographic(
              canvas,
              candidate.box,
              (IMAGE_RENDER_SCALE / RENDER_SCALE) ** 2
            )
          }));
        if (pageProfile) pageProfile.imageBoxes = imageCandidates.map(({ box }) => ({
          x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height)
        }));
        if (imageCandidates.length && !imageCanvas) imageCanvas = await getHighResolutionGraphicsCanvas();
        const imageTextToErase = imageCanvas === highResolutionGraphicsCanvas && highResolutionCanvas
          ? textStillPaintedInGraphicsRender(textObjs, highResolutionCanvas, highResolutionGraphicsCanvas, imageScaleRatio)
          : textObjs;
        const rasterizedImages = await mapWithConcurrency(imageCandidates, RASTER_ENCODE_CONCURRENCY, async ({ img, box: b, photographic }) => {
          const imageStartedAt = performance.now();
          const sx = Math.max(0, Math.floor(b.x * imageScaleRatio)), sy = Math.max(0, Math.floor(b.y * imageScaleRatio));
          const sw = Math.min(imageCanvas.width - sx, Math.ceil(b.width * imageScaleRatio)), sh = Math.min(imageCanvas.height - sy, Math.ceil(b.height * imageScaleRatio));
          if (sw < 4 || sh < 4) return null;
          
          const c = createRasterWorkCanvas(sw, sh);
          const cropCtx = c.getContext('2d', { willReadFrequently: true });
          cropCtx.drawImage(imageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          const nativeCanvas = createRasterWorkCanvas(sw, sh);
          const nativeCtx = nativeCanvas.getContext('2d', { willReadFrequently: true });
          const hasNativeMask = drawNativePdfImageIntoRegion(nativeCtx, img, b, imageScaleRatio);
          // This crop is rendered from the page canvas, so it already includes
          // any PDF text painted over a photo or artwork. Remove only extracted
          // text before embedding it; the same text remains as editable DOCX
          // frames, while text baked solely into the source image is untouched.
          // Embedded image crops are not table/chart reconstruction layers.
          // Treat all extracted overlay text as removable ink; preserving
          // glyph-length strokes here is what leaves the stray vertical bars
          // seen on light product cards that do not score as photographic.
          // A graphics-only PDF.js render can still contain glyphs that the PDF
          // encodes as vector outlines. The pixel eraser is a no-op where text
          // is already absent, and removes those outlined glyphs where present.
          eraseTextFromImageCrop(cropCtx, b, imageTextToErase, imageScaleRatio, false, hasNativeMask ? nativeCtx : null, photographic);
          if (!hasNativeMask) restoreTextAreasFromNativeImages(cropCtx, b, imageTextToErase, nativeImageObjs, imageScaleRatio);
          const imagePreparedAt = performance.now();
          const buffer = await canvasToOptimizedImageBuffer(c, photographic);
          const result = {
            x: b.x / RENDER_SCALE,
            y: b.y / RENDER_SCALE,
            width: b.width / RENDER_SCALE,
            height: b.height / RENDER_SCALE,
            buffer,
            _profile: pageProfile ? {
              prepare: Math.round(imagePreparedAt - imageStartedAt),
              encode: Math.round(performance.now() - imagePreparedAt)
            } : null
          };
          nativeCanvas.width = 0;
          nativeCanvas.height = 0;
          c.width = 0; c.height = 0;
          return result;
        });
        embeddedImages.push(...rasterizedImages.filter(Boolean));
        if (pageProfile) {
          pageProfile.figureImages = figureImages.length;
          pageProfile.embeddedImages = embeddedImages.length;
          pageProfile.imageTimings = embeddedImages.map(image => image._profile);
        }
        for (const image of embeddedImages) delete image._profile;
        if (highResolutionCanvas) {
          highResolutionCanvas.width = 0;
          highResolutionCanvas.height = 0;
        }
        if (highResolutionGraphicsCanvas) {
          highResolutionGraphicsCanvas.width = 0;
          highResolutionGraphicsCanvas.height = 0;
        }
        markPagePhase('imageRasterization');
        await yieldToBrowser();
        _canvasPixelCache.delete(canvas);
        canvas.width = 0; canvas.height = 0; // Free page canvas memory

        // High-fidelity absolute layout path.
        if (layoutMode === 'fidelity') {
          if (fidelityBackground) {
            pageChildren.push(new docx.Paragraph({
              children: [
                makeImageRun(fidelityBackground, {
                  altText: {
                    name: 'PDFOmni form graphics',
                    description: 'PDFOMNI_FORM_BACKGROUND',
                    title: 'PDFOmni form graphics'
                  },
                  transformation: {
                    width: pointsToDocxImagePx(widthPt),
                    height: pointsToDocxImagePx(heightPt)
                  },
                  floating: {
                    horizontalPosition: {
                      relative: docx.HorizontalPositionRelativeFrom.PAGE,
                      offset: 0
                    },
                    verticalPosition: {
                      relative: docx.VerticalPositionRelativeFrom.PAGE,
                      offset: 0
                    },
                    wrap: {
                      type: docx.TextWrappingType.NONE
                    },
                    behindDocument: true,
                    allowOverlap: true,
                    zIndex: 1
                  }
                })
              ]
            }));
          }

          for (const img of figureImages) {
            pageChildren.push(new docx.Paragraph({
              children: [
                makeImageRun(img.buffer, {
                  transformation: {
                    width: pointsToDocxImagePx(img.width),
                    height: pointsToDocxImagePx(img.height)
                  },
                  floating: {
                    horizontalPosition: {
                      relative: docx.HorizontalPositionRelativeFrom.PAGE,
                      offset: pointsToEmu(img.x)
                    },
                    verticalPosition: {
                      relative: docx.VerticalPositionRelativeFrom.PAGE,
                      offset: pointsToEmu(img.y)
                    },
                    wrap: {
                      type: docx.TextWrappingType.NONE
                    },
                    behindDocument: img.foreground !== true,
                    allowOverlap: true,
                    zIndex: img.foreground === true ? 150000 : 0
                  }
                })
              ]
            }));
          }

          for (const vector of vectorObjs) {
            pageChildren.push(makeVectorBoxPageChild(vector));
          }

          // The fidelity background already carries raster/vector page artwork.
          // PDF.js exposes many images as clipped tiles, so painting them again
          // can damage visual fidelity if the target renderer reorders anchors.
          const renderExtractedImageLayer = true;
          if (renderExtractedImageLayer) for (const img of embeddedImages) {
            pageChildren.push(new docx.Paragraph({
              children: [
                makeImageRun(img.buffer, {
                  transformation: {
                    width: pointsToDocxImagePx(img.width),
                    height: pointsToDocxImagePx(img.height)
                  },
                  floating: {
                    horizontalPosition: {
                      relative: docx.HorizontalPositionRelativeFrom.PAGE,
                      offset: pointsToEmu(img.x)
                    },
                  verticalPosition: {
                    relative: docx.VerticalPositionRelativeFrom.PAGE,
                    offset: pointsToEmu(img.y)
                  },
                  wrap: {
                    type: docx.TextWrappingType.NONE
                  },
                  behindDocument: true,
                  allowOverlap: true,
                  zIndex: 0
                }
              })
            ]
            }));
          }

          // Add absolutely positioned editable text frames. A frame per visual
          // line avoids table/paragraph defaults stretching PDF-style layouts.
          for (const obj of textObjs) {
            pageChildren.push(...makeFidelityTextFrames(obj, alignmentMap));
          }
        }
        
        // Legacy flow layout branch kept inactive for now.
        else if (layoutMode === 'editability') {
          // Sort items by visual layout coordinates (top to bottom)
          const allFlowElements = [
            ...textObjs.map(t => ({ type: 'text', y: t.y / RENDER_SCALE, x: t.x / RENDER_SCALE, width: t.width / RENDER_SCALE, height: t.height / RENDER_SCALE, obj: t })),
            ...embeddedImages.map(img => ({ type: 'image', y: img.y, x: img.x, width: img.width, height: img.height, obj: img }))
          ].sort((a, b) => a.y - b.y || a.x - b.x);

          let lastBottomY = 36; // Initial top margin offset in pt

          for (const el of allFlowElements) {
            const rawGap = el.y - lastBottomY;
            const spacingBefore = Math.min(24, Math.max(0, rawGap));
            lastBottomY = el.y + el.height;

            if (el.type === 'text') {
              const leftIndent = Math.max(0, el.x - 36);
              const lines = el.obj.data.lines || [];
              if (!lines.length) {
                pageChildren.push(new docx.Paragraph({
                  alignment: alignmentMap[el.obj.data.align || 'left'],
                  indent: { left: Math.round(leftIndent * 20) },
                  spacing: { before: Math.round(spacingBefore * 20) },
                  children: [new docx.TextRun({
                    text: String(el.obj.data.content || ''),
                    font: el.obj.data.fontFamily || "sans-serif",
                    size: Math.round((el.obj.data.fontSize || 11) * 2),
                    color: el.obj.data.color ? el.obj.data.color.replace('#', '') : "000000",
                    bold: el.obj.data.fontWeight === 'bold',
                    italics: el.obj.data.fontStyle === 'italic',
                    underline: el.obj.data.underline ? { type: "single" } : undefined
                  })]
                }));
              } else {
                lines.forEach((line, idx) => {
                  const align = (el.obj.data._lineAligns && el.obj.data._lineAligns[idx]) || el.obj.data.align || 'left';
                  const runs = line.map(r => new docx.TextRun({
                    text: r.text,
                    font: r.fontFamily || "sans-serif",
                    size: Math.round((r.fontSize || 11) * 2),
                    color: r.color ? r.color.replace('#', '') : "000000",
                    bold: r.bold,
                    italics: r.italic,
                    underline: r.underline ? { type: "single" } : undefined
                  }));
                  pageChildren.push(new docx.Paragraph({
                    alignment: alignmentMap[align],
                    indent: { left: Math.round(leftIndent * 20) },
                    spacing: {
                      before: idx === 0 ? Math.round(spacingBefore * 20) : 0,
                      line: Math.round((el.obj.data.lineHeight || 1.2) * 240)
                    },
                    children: runs
                  }));
                });
              }
            } else {
              // Image flowable block
              const leftIndent = Math.max(0, el.x - 36);
              pageChildren.push(new docx.Paragraph({
                indent: { left: Math.round(leftIndent * 20) },
                spacing: { before: Math.round(spacingBefore * 20) },
                children: [
                  makeImageRun(el.obj.buffer, {
                    transformation: {
                      width: Math.min(el.width, widthPt - 72),
                      height: el.height
                    }
                  })
                ]
              }));
            }
          }
        }
        
        // Legacy structured-flow branch kept inactive for now.
        else {
          // Identify side-by-side columns using connected components (BFS)
          const allElements = [
            ...textObjs.map(t => ({ type: 'text', y: t.y / RENDER_SCALE, x: t.x / RENDER_SCALE, width: t.width / RENDER_SCALE, height: t.height / RENDER_SCALE, obj: t })),
            ...embeddedImages.map(img => ({ type: 'image', y: img.y, x: img.x, width: img.width, height: img.height, obj: img }))
          ].sort((a, b) => a.y - b.y || a.x - b.x);

          const n = allElements.length;
          const adj = Array.from({ length: n }, () => []);
          const gapTolerance = Math.max(80, widthPt * 0.08);

          function areRelated(a, b) {
            // Check vertical overlap
            const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            if (overlapY <= 0) return false;

            // Check horizontal proximity or overlap
            const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
            if (overlapX > 0) return true;

            const gapX = a.x < b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
            if (gapX <= gapTolerance) return true;

            return false;
          }

          // Build adjacency graph
          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
              if (areRelated(allElements[i], allElements[j])) {
                adj[i].push(j);
                adj[j].push(i);
              }
            }
          }

          const visited = new Set();
          const groups = [];

          // Find connected components
          for (let i = 0; i < n; i++) {
            if (!visited.has(i)) {
              const comp = [];
              const queue = [i];
              visited.add(i);
              while (queue.length > 0) {
                const u = queue.shift();
                comp.push(allElements[u]);
                for (const v of adj[u]) {
                  if (!visited.has(v)) {
                    visited.add(v);
                    queue.push(v);
                  }
                }
              }
              groups.push(comp);
            }
          }

          // Sort groups by their minimum Y coordinate to preserve top-to-bottom reading order
          groups.sort((gA, gB) => {
            const minY_A = Math.min(...gA.map(e => e.y));
            const minY_B = Math.min(...gB.map(e => e.y));
            return minY_A - minY_B;
          });

          let lastBottomY = 36;

          for (const group of groups) {
            const groupY = Math.min(...group.map(item => item.y));
            const groupHeight = Math.max(...group.map(item => item.y + item.height)) - groupY;
            const rawGap = groupY - lastBottomY;
            const spacingBefore = Math.min(24, Math.max(0, rawGap));

            // 1. Find columns by projecting elements onto X-axis and merging overlapping intervals
            const intervals = [];
            for (const el of group) {
              intervals.push({ min: el.x, max: el.x + el.width });
            }
            
            // Merge overlapping intervals
            intervals.sort((a, b) => a.min - b.min);
            const mergedIntervals = [];
            for (const iv of intervals) {
              if (!mergedIntervals.length) {
                mergedIntervals.push(iv);
              } else {
                const last = mergedIntervals[mergedIntervals.length - 1];
                if (iv.min <= last.max + 10) { // 10pt tolerance for overlap
                  last.max = Math.max(last.max, iv.max);
                } else {
                  mergedIntervals.push(iv);
                }
              }
            }

            // A group is structured as a table only if it contains multiple elements and multiple columns
            const isTable = group.length > 1 && mergedIntervals.length > 1;

            if (isTable) {
              lastBottomY = groupY + groupHeight;

              // Insert a vertical spacing paragraph before the table if gap exists
              if (spacingBefore > 1) {
                pageChildren.push(new docx.Paragraph({
                  spacing: { before: Math.round(spacingBefore * 20) }
                }));
              }

              // Sort group items left-to-right to align with columns
              group.sort((a, b) => a.x - b.x);
              
              // 2. Assign elements to columns
              const columns = mergedIntervals.map(iv => ({
                interval: iv,
                elements: []
              }));
              
              for (const el of group) {
                const elMid = el.x + el.width / 2;
                // Find closest column
                let bestCol = columns[0];
                let minCtx = Infinity;
                for (const col of columns) {
                  if (elMid >= col.interval.min && elMid <= col.interval.max) {
                    bestCol = col;
                    break;
                  }
                  const dist = Math.min(Math.abs(elMid - col.interval.min), Math.abs(elMid - col.interval.max));
                  if (dist < minCtx) {
                    minCtx = dist;
                    bestCol = col;
                  }
                }
                bestCol.elements.push(el);
              }
              
              // 3. Build table cells and spacer columns
              const cells = [];
              const colWidths = [];
              const startMargin = 36; // standard left margin in pt
              let currentX = startMargin;
              
              for (const col of columns) {
                // Sort column elements vertically (top to bottom)
                col.elements.sort((a, b) => a.y - b.y);
                
                const colX = col.interval.min;
                const colW = col.interval.max - colX;
                
                // If there's a gap before this column, insert a spacer cell
                if (colX > currentX + 4) {
                  const spacerWidth = (colX - currentX) * 20; // in dxa
                  colWidths.push(spacerWidth);
                  cells.push(new docx.TableCell({
                    children: [new docx.Paragraph({})],
                    width: { size: spacerWidth, type: docx.WidthType.DXA }
                  }));
                  currentX = colX;
                }
                
                // Build cell children by stacking elements of this column
                const cellChildren = [];
                for (const el of col.elements) {
                  if (el.type === 'text') {
                    const paragraphs = objToDocxParagraphs(el.obj, alignmentMap);
                    cellChildren.push(...paragraphs);
                  } else {
                    cellChildren.push(new docx.Paragraph({
                      children: [
                        makeImageRun(el.obj.buffer, {
                          transformation: {
                            width: el.width,
                            height: el.height
                          }
                        })
                      ]
                    }));
                  }
                }
                
                const cellWidth = colW * 20; // in dxa
                colWidths.push(cellWidth);
                cells.push(new docx.TableCell({
                  children: cellChildren,
                  width: { size: cellWidth, type: docx.WidthType.DXA }
                }));
                currentX = col.interval.max;
              }
              
              const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
              
              pageChildren.push(new docx.Table({
                width: {
                  size: tableWidth,
                  type: docx.WidthType.DXA
                },
                columnWidths: colWidths,
                rows: [
                  new docx.TableRow({
                    children: cells
                  })
                ],
                borders: docx.TableBorders.NONE,
                margins: {
                  marginUnitType: docx.WidthType.DXA,
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0
                }
              }));
            } 
            // Standalone flow items (or single-column stacked group)
            else {
              // Sort elements vertically to preserve reading order
              group.sort((a, b) => a.y - b.y);

              for (const el of group) {
                const elGap = el.y - lastBottomY;
                const elSpacingBefore = Math.min(24, Math.max(0, elGap));
                lastBottomY = el.y + el.height;

                if (el.type === 'text') {
                  const leftIndent = Math.max(0, el.x - 36);
                  const lines = el.obj.data.lines || [];
                  if (!lines.length) {
                    pageChildren.push(new docx.Paragraph({
                      alignment: alignmentMap[el.obj.data.align || 'left'],
                      indent: { left: Math.round(leftIndent * 20) },
                      spacing: {
                        before: Math.round(elSpacingBefore * 20),
                        line: Math.round((el.obj.data.lineHeight || 1.2) * 240)
                      },
                      children: [new docx.TextRun({
                        text: String(el.obj.data.content || ''),
                        font: el.obj.data.fontFamily || "sans-serif",
                        size: Math.round((el.obj.data.fontSize || 11) * 2),
                        color: el.obj.data.color ? el.obj.data.color.replace('#', '') : "000000",
                        bold: el.obj.data.fontWeight === 'bold',
                        italics: el.obj.data.fontStyle === 'italic',
                        underline: el.obj.data.underline ? { type: "single" } : undefined
                      })]
                    }));
                  } else {
                    lines.forEach((line, idx) => {
                      const align = (el.obj.data._lineAligns && el.obj.data._lineAligns[idx]) || el.obj.data.align || 'left';
                      const runs = line.map(r => new docx.TextRun({
                        text: r.text,
                        font: r.fontFamily || "sans-serif",
                        size: Math.round((r.fontSize || 11) * 2),
                        color: r.color ? r.color.replace('#', '') : "000000",
                        bold: r.bold,
                        italics: r.italic,
                        underline: r.underline ? { type: "single" } : undefined
                      }));
                      pageChildren.push(new docx.Paragraph({
                        alignment: alignmentMap[align],
                        indent: { left: Math.round(leftIndent * 20) },
                        spacing: {
                          before: idx === 0 ? Math.round(elSpacingBefore * 20) : 0,
                          line: Math.round((el.obj.data.lineHeight || 1.2) * 240)
                        },
                        children: runs
                      }));
                    });
                  }
                } else {
                  const leftIndent = Math.max(0, el.x - 36);
                  pageChildren.push(new docx.Paragraph({
                    indent: { left: Math.round(leftIndent * 20) },
                    spacing: { before: Math.round(elSpacingBefore * 20) },
                    children: [
                      makeImageRun(el.obj.buffer, {
                        transformation: {
                          width: Math.min(el.width, widthPt - 72),
                          height: el.height
                        }
                      })
                    ]
                  }));
                }
              }
            }
          }
        }

        sections.push({
          properties: sectionProperties,
          children: pageChildren
        });
        markPagePhase('docxLayout');
        
        // Yield execution to allow garbage collection and keep browser UI responsive
        await yieldToBrowser();
        } finally {
          parser.releasePage(pi);
          recordConversionPageTiming(conversionTiming, pi, pageWallStartedAt);
          if (pageProfile) {
            pageProfile.total = Math.round(performance.now() - pageStartedAt);
            console.info('pdfomni-page-performance', JSON.stringify(pageProfile));
          }
        }
      }

      updProg('Packaging document...', 90);
      await yieldToBrowser();
      
      // 4. Assemble section structures into a docx Document
      const doc = new docx.Document({
        sections: sections
      });

      // 5. Patch the compiler's in-memory ZIP package and compress once. The
      // fallback retains compatibility if a future docx build hides compiler.
      let blob;
      const compiledPackage = docx.Packer.compiler?.compile?.(doc);
      if (layoutMode === 'fidelity' && compiledPackage) {
        blob = await patchDocxForFidelityPreview(compiledPackage, parser.getEmbeddedFonts());
      } else {
        blob = await docx.Packer.toBlob(doc);
        if (layoutMode === 'fidelity') {
          blob = await patchDocxForFidelityPreview(blob, parser.getEmbeddedFonts());
        }
      }
      
      updProg('Completing...', 100);
      await yieldToBrowser();
      finishConversionTiming(conversionTiming, 'complete');
      hideProg();
      
      // Expose blob globally for automated testing
      window.lastGeneratedDocxBlob = blob;

      // 6. Transition to Success Panel & Setup download callback
      document.getElementById('conversion-panel').style.display = 'none';
      document.getElementById('success-card').style.display = 'flex';
      
      const btnDownload = document.getElementById('btn-download');
      btnDownload.onclick = () => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = uploadedFile.name.replace(/\.pdf$/i, '.docx');
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        snack('Downloaded successfully!', 'success');
      };
      
    } catch (e) {
      finishConversionTiming(conversionTiming, 'failed', e);
      hideProg();
      console.error(e);
      snack('Conversion failed: ' + e.message, 'error', 6000);
    }
  }

  // Reset conversion workflow to start state
  function reset() {
    uploadedFile = null;
    const timer = document.getElementById('prog-timer');
    const result = document.getElementById('conversion-time-result');
    if (timer) timer.style.display = 'none';
    if (result) result.style.display = 'none';
    document.getElementById('conversion-panel').style.display = 'none';
    document.getElementById('success-card').style.display = 'none';
    document.getElementById('drop-zone').style.display = 'flex';
    document.getElementById('file-input').value = '';
  }

  // Setup drag event boundaries (Adapted from editpdf.html)
  function _setupDrop() {
    const dz = document.getElementById('drop-zone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && (f.type === 'application/pdf' || f.name.endsWith('.pdf'))) loadFile(f); });
  }

  // Bind drop logic on initial load
  _setupDrop();

  return {
    loadFile,
    startConversion,
    reset
  };
})();

// Assign to window for inline event bindings

// ── HELPER FUNCTIONS FROM EDITPDF.HTML ──
function _htmlEscape(s){
  return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function _cleanTextHtml(html){
  const tpl=document.createElement('template');
  tpl.innerHTML=String(html||'');
  tpl.content.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
  tpl.content.querySelectorAll('*').forEach(el=>{
    if(el.tagName==='FONT'){
      const color=el.getAttribute('color'),face=el.getAttribute('face');
      if(color)el.style.color=color;
      if(face)el.style.fontFamily=face;
    }
    [...el.attributes].forEach(a=>{
      if(a.name==='style'){
        const keep=[],st=el.style;
        if(st.fontFamily)keep.push(`font-family:${st.fontFamily}`);
        if(st.fontSize)keep.push(`font-size:${st.fontSize}`);
        if(st.lineHeight)keep.push(`line-height:${st.lineHeight}`);
        if(st.letterSpacing)keep.push(`letter-spacing:${st.letterSpacing}`);
        if(st.wordSpacing)keep.push(`word-spacing:${st.wordSpacing}`);
        if(st.fontWeight)keep.push(`font-weight:${st.fontWeight}`);
        if(st.fontStyle)keep.push(`font-style:${st.fontStyle}`);
        if(st.textDecorationLine||st.textDecoration)keep.push(`text-decoration:${st.textDecoration||st.textDecorationLine}`);
        if(st.color)keep.push(`color:${st.color}`);
        if(st.backgroundColor)keep.push(`background-color:${st.backgroundColor}`);
        if(st.textAlign)keep.push(`text-align:${st.textAlign}`);
        if(keep.length)el.setAttribute('style',keep.join(';'));else el.removeAttribute('style');
      }else if(a.name!=='href')el.removeAttribute(a.name);
    });
  });
  return tpl.innerHTML;
}

function _getSystemFontFallback(n, fallback = 'Arial,sans-serif'){
  const standard=_standardBrowserFontFamily(n);
  if(standard)return standard;
  const known=_knownWebFontFamily(n);
  if(known)return`"${known}",${/script/i.test(known)?'cursive':'sans-serif'}`;
  const l=String(n||'').toLowerCase();
  const clean=l.replace(/\b(g_[a-z0-9]+_f\d+)\b/g,'')
               .replace(/sans-serif/g,'')
               .replace(/^[a-z]{6}\+/g,'')
               .trim();
  if(clean.includes('courier')||clean.includes('mono')||clean.includes('monospace')||clean.includes('pcr'))return 'Courier New,monospace';
  if(clean.includes('times')||clean.includes('tinos')||clean.includes('roman')||clean.includes('serif')||clean.includes('ptm')||clean.includes('georgia')||clean.includes('cambria')||clean.includes('garamond')||clean.includes('liberationserif')||clean.includes('nimbusrom'))return 'Times New Roman,serif';
  if(clean.includes('helvetica')||clean.includes('arial')||clean.includes('sans')||clean.includes('phv'))return 'Arial,sans-serif';
  if(l.includes('sans'))return 'Arial,sans-serif';
  if(l.includes('serif'))return 'Times New Roman,serif';
  return fallback;
}

function _standardBrowserFontFamily(name){
  const l=String(name||'').toLowerCase().replace(/[-_]+/g,' ');
  const compact=l.replace(/[^a-z0-9]/g,'');
  if(!l)return null;
  if(/(courier|couriernew|monotype|pcr)/.test(compact))return 'Courier New,monospace';
  if(/(texgyrepagella|pagella|palatino|bookantiqua)/.test(compact))return 'Palatino Linotype,serif';
  if(/(timesnewroman|timesroman|times|tinos|lmroman|latinmodernroman|georgia|cambria|garamond|liberationserif|nimbusrom|ptm)/.test(compact)||/\blmr(?:oman)?\d*/.test(l)||/\bcm(?:mi|r)\d*/.test(l))return 'Times New Roman,serif';
  if(/(helvetica|arial|arialmt|liberationsans|nimbussans|phv)/.test(compact))return 'Arial,sans-serif';
  if(/\b(courier|mono|monospace|pcr|consolas)\b/.test(l))return 'Courier New,monospace';
  if(/\b(times|tinos|roman|ptm|georgia|cambria|garamond|liberation serif|nimbus rom)\b/.test(l))return 'Times New Roman,serif';
  if(/\b(helvetica|arial|sans|phv|liberation sans|nimbus sans)\b/.test(l))return 'Arial,sans-serif';
  return null;
}

function _knownWebFontFamily(name){
  const raw=String(name||'')
    .replace(/\b(g_[a-z0-9]+_f\d+)\b/ig,' ')
    .replace(/^[A-Z0-9]{4,8}\+/,'')
    .replace(/['"]/g,' ')
    .replace(/[,;]/g,' ')
    .replace(/\b(sans-serif|serif|monospace|arial|helvetica|times new roman|courier new)\b/ig,' ')
    .replace(/[-_]+/g,' ')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/\s+/g,' ')
    .trim();
  if(!raw)return null;
  const clean=raw
    .replace(/\b(regular|normal|book|roman|medium|semibold|semi bold|bold|black|heavy|light|thin|italic|oblique)\b/ig,' ')
    .replace(/\b\d+\b/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  if(!clean)return null;
  return clean.split(' ').map(word=>{
    if(!word)return word;
    if(word.length<=3&&word===word.toUpperCase())return word;
    return word.charAt(0).toUpperCase()+word.slice(1);
  }).join(' ');
}

function _pdfInjectedFontFamily(...names){
  const raw=names.filter(Boolean).map(String).join(' ');
  const loaded=raw.match(/\b(g_[a-z0-9]+_f\d+)\b/i)?.[1];
  if(loaded)return`"${loaded}",sans-serif`;
  const standard=_standardBrowserFontFamily(raw);
  if(standard)return standard;
  const known=_knownWebFontFamily(raw);
  if(known)return`"${known}",${/script/i.test(known)?'cursive':'sans-serif'}`;
  const clean=raw.replace(/^[A-Z0-9]{4,8}\+/,'').trim();
  if(clean){
    try{
      const installed=[...document.fonts].find(f=>f.family.toLowerCase()===clean.toLowerCase());
      if(installed)return`"${installed.family}",sans-serif`;
    }catch{}
  }
  return null;
}

function _canvasTextFont(d){
  const fam=String(d.fontFamily||'sans-serif').split(',').map(f=>{
    f=f.trim();
    return /\s/.test(f)&&!/^['"]/.test(f)?`"${f}"`:f;
  }).join(',');
  return `${d.fontStyle||'normal'} ${d.fontWeight||'normal'} ${d.fontSize||12}px ${fam}`;
}
function _measureTextPartWidths(ctx,text,totalWidth,options={}){
  const raw=String(text||'');
  let parts=raw.split(/(\s{3,})/).filter(Boolean);
  const tokens=raw.split(/(\s+)/).filter(Boolean);
  const words=tokens.filter(part=>!/\s+/.test(part));
  const measuredRaw=Math.max(0,ctx.measureText(raw).width);
  const widthRatio=measuredRaw>0&&totalWidth>0?totalWidth/measuredRaw:1;
  const proseLikeLowerWords=words.filter(word=>/^[a-z]{2,}$/.test(word)).length;
  const proseLikePhrase=words.length>=5&&proseLikeLowerWords>=3;
  const compactLabelLike=words.length>=2&&
    words.length<=6&&
    raw.length<=90&&
    !proseLikePhrase&&
    words.every(word=>/^[A-Za-z0-9][A-Za-z0-9._%+()\/-]*$/.test(word))&&
    (widthRatio>1.08||/[0-9._%+()\/-]/.test(raw));
  const splitCompactLabel=compactLabelLike&&/\s{2,}/.test(raw);
  if(options.forceTokenSplit||splitCompactLabel)parts=tokens;
  if(parts.length<=1)return[{text:String(text||''),width:totalWidth}];
  const measured=parts.map(part=>({text:part,width:Math.max(0,ctx.measureText(part).width)}));
  if(splitCompactLabel&&measured.some(part=>/^\s+$/.test(part.text))){
    const nonSpaceWidth=measured.filter(part=>!(/^\s+$/.test(part.text))).reduce((sum,part)=>sum+part.width,0);
    const spaceParts=measured.filter(part=>/^\s+$/.test(part.text));
    const baseSpaceWidth=spaceParts.reduce((sum,part)=>sum+part.width,0);
    const extraSpace=Math.max(0,totalWidth-nonSpaceWidth-baseSpaceWidth);
    if(totalWidth>=nonSpaceWidth&&spaceParts.length){
      const perSpace=extraSpace/spaceParts.length;
      return measured.map(part=>({text:part.text,width:part.width+(/^\s+$/.test(part.text)?perSpace:0)}));
    }
  }
  const sum=measured.reduce((s,p)=>s+p.width,0);
  if(sum>0&&Number.isFinite(sum)){
    const factor=totalWidth/sum;
    return measured.map(part=>({text:part.text,width:part.width*factor}));
  }
  const chars=parts.reduce((sum,part)=>sum+part.length,0)||1;
  return parts.map(part=>({text:part,width:totalWidth*(part.length/chars)}));
}
let _measureCtx=null;
function _measureCanvasTextWidth(d,content,fontSize=d.fontSize||12){
  _measureCtx=_measureCtx||document.createElement('canvas').getContext('2d');
  _measureCtx.font=_canvasTextFont({...d,fontSize});
  return Math.max(1,...String(content||'').split('\n').map(line=>_measureCtx.measureText(line).width));
}
function _estimateWrappedLineCount(d,content,width,fontSize=d.fontSize||12){
  _measureCtx=_measureCtx||document.createElement('canvas').getContext('2d');
  _measureCtx.font=_canvasTextFont({...d,fontSize});
  const maxW=Math.max(1,width||1),letter=Number(d.letterSpacing)||0,word=Number(d.wordSpacing)||0;
  let total=0;
  for(const para of String(content||'').split('\n')){
    const words=para.split(/(\s+)/).filter(Boolean);
    let lineW=0,lines=1;
    for(const token of words){
      const isSpace=/^\s+$/.test(token);
      const w=_measureCtx.measureText(token).width+Math.max(0,token.length-1)*letter+(isSpace?word:0);
      if(!isSpace&&lineW>0&&lineW+w>maxW){lines++;lineW=w;}
      else lineW+=w;
    }
    total+=lines;
  }
  return Math.max(1,total);
}
function _fitCanvasFontSize(d,content,box){
  let fs=d.fontSize||12;
  const lines=String(content||'').split('\n').length||1;
  const width=_measureCanvasTextWidth(d,content,fs);
  if(width>box.width&&box.width>0)fs*=box.width/width;
  const maxH=box.height/(Math.max(.1,d.lineHeight||1.2)*lines);
  if(Number.isFinite(maxH)&&maxH>0&&fs>maxH)fs=maxH;
  return Math.max(4,fs);
}
function _parseCssColor(c){
  if(!c||c==='transparent')return null;
  // Handle 6-character hex (#rrggbb)
  const hex6=String(c).match(/^#?([0-9a-f]{6})$/i);
  if(hex6){const n=parseInt(hex6[1],16);return[(n>>16)&255,(n>>8)&255,n&255];}
  // Handle 3-character hex (#rgb)
  const hex3=String(c).match(/^#?([0-9a-f]{3})$/i);
  if(hex3){
    const r=parseInt(hex3[1][0],16);
    const g=parseInt(hex3[1][1],16);
    const b=parseInt(hex3[1][2],16);
    return[r*17,g*17,b*17]; // Convert to 0-255 range (e.g., f -> ff)
  }
  // Handle rgb/rgba, including comma-separated and modern space-separated forms.
  const rgb=String(c).match(/rgba?\(([^)]+)\)/i);
  if(rgb){const p=rgb[1].trim().split(/[,\s/]+/).filter(Boolean).map(Number);return[p[0]||0,p[1]||0,p[2]||0];}
  return null;
}
function _htmlHasRichStyle(html){
  return /<(span|b|strong|i|em|u|font)\b/i.test(String(html||''))||/style\s*=\s*["'][^"']*(font-|color|text-decoration|text-align|background|letter-spacing|word-spacing|line-height)/i.test(String(html||''));
}
function _sampleTextColorFromCanvas(canvas,box){
  // Sample the actual text color from the rendered canvas
  const ctx=canvas?.getContext?.('2d');
  if(!ctx||!canvas?.width)return'#000000';
  
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,Math.round(v)));
  const sx=clamp(box.x||0,0,canvas.width-1);
  const sy=clamp(box.y||0,0,canvas.height-1);
  const ex=clamp((box.x||0)+(box.width||1),0,canvas.width);
  const ey=clamp((box.y||0)+(box.height||1),0,canvas.height);
  const w=Math.max(1,ex-sx),h=Math.max(1,ey-sy);
  
  let img;
  try{img=ctx.getImageData(sx,sy,w,h).data;}catch(e){return'#000000';}
  
  const bgColorStr = _sampleCanvasColor(canvas, box);
  const bgColor = _parseCssColor(bgColorStr) || [255, 255, 255];
  
  const area = w * h;
  const stride = area < 2000 ? 1 : Math.max(1, Math.floor(Math.sqrt(area / 1000)));
  
  const candidates = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      if (img[i+3] < 100) continue; // skip transparent
      const r = img[i], g = img[i+1], b = img[i+2];
      const dist = Math.abs(r - bgColor[0]) + Math.abs(g - bgColor[1]) + Math.abs(b - bgColor[2]);
      if (dist > 30) {
        candidates.push({ r, g, b, dist });
      }
    }
  }
  
  if (candidates.length === 0) return '#000000';
  
  // Sort candidates by distance from background in descending order
  candidates.sort((a, b) => b.dist - a.dist);
  
  // Take the top 15% of pixels that are most different from background
  const topCount = Math.max(1, Math.floor(candidates.length * 0.15));
  let sumR = 0, sumG = 0, sumB = 0;
  for (let j = 0; j < topCount; j++) {
    sumR += candidates[j].r;
    sumG += candidates[j].g;
    sumB += candidates[j].b;
  }
  
  const avgR = Math.round(sumR / topCount);
  const avgG = Math.round(sumG / topCount);
  const avgB = Math.round(sumB / topCount);
  
  // If the color is extremely dark/near black, snap to pure black
  if (avgR < 25 && avgG < 25 && avgB < 25) {
    return '#000000';
  }
  
  const hex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${hex(avgR)}${hex(avgG)}${hex(avgB)}`;
}

window.app = app;
export default app;
