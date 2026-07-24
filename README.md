# 🚀 PDFOmni

This is the working repository for [PDFOmni](https://pdfomni.com) – the world's most advanced, local-first web PDF toolkit.

Unlike conventional online PDF utilities that simply rasterize your pages into flat images (which destroys text searchability, degrades quality, and inflates file size), **PDFOmni features a world-class, proprietary PDF stream editor that runs entirely within the browser.** We are the only platform that allows true, non-rasterizing PDF stream editing—manipulating text, paths, objects, and fonts directly inside the PDF binary stream itself—a capability that does not exist anywhere else on the web.

---

## 💎 What is PDFOmni?

PDFOmni is a high-performance, local-first PDF toolkit built with React, Vite, JavaScript, TypeScript, Web Workers, WebAssembly, PDF.js, and PDF-lib. By running core PDF operations entirely client-side, your documents never leave your computer.

Our standout feature is our **world-class browser-based PDF stream editor**. While other toolkits rasterize pages to make simple edits (essentially turning your document into a series of pictures), PDFOmni edits the live underlying PDF stream, keeping vectors crisp, text selectable, and file sizes extremely small.

---

## 📦 Product Catalog & Features

PDFOmni provides a comprehensive catalog of dedicated pages and tools for every PDF workflow:

### 🎨 World-Class PDF Editor
- **True PDF Stream Editing:** Modify text, shapes, and layouts directly in the browser without rasterization. Text remains searchable and scalable, and fonts are dynamically subset and embedded.
- **Markup & Drawing:** Add annotations, hand-drawn vector paths, highlights, and custom shapes.
- **Watermarking & Cropping:** Crop page boundaries and stamp watermarks directly onto the page stream.
- **Secure Redaction:** Permanently remove sensitive text and vector elements from the document stream rather than just covering them up.

### 🗂️ Organizing PDFs
- **Merge & Split:** Combine multiple files or extract specific pages.
- **Reorder & Rotate:** Drag and drop pages to rearrange, and rotate individual pages.
- **Compress:** Reduce file sizes using advanced client-side optimization workers.
- **Page Numbering:** Insert dynamic page numbers into headers or footers.

### 🔄 Conversions
- **To PDF:** Convert Word (Mammoth), Excel (SheetJS), images, and raw HTML to PDF format.
- **From PDF:** Extract original images or convert the text layout into markdown/text.

### 🛡️ Security & Signatures
- **Lock & Unlock:** Apply owner/user passwords, restrict permissions, or unlock protected files.
- **Digital Signatures:** Sign documents electronically inside the browser.

### 🤖 AI Copilot & Advanced Workflows
- **AI Copilot:** Chat with your document locally using RAG (Retrieval-Augmented Generation) powered by OpenRouter (using your own API key).
- **Batch Processing:** Run operations on multiple files concurrently.
- **Accessibility Checks:** Validate tagging and structure for screen readers.

---

## 📖 How to Use PDFOmni

Using PDFOmni is designed to be seamless and instantaneous:

1. **Visit the Site:** Open [pdfomni.com](https://pdfomni.com) in any modern web browser.
2. **Select your Tool:** Choose the desired utility from our visual tools library.
3. **Add Your Files:** Drag and drop files up to 500 MB.
4. **Edit the Stream:** If editing, double-click any text block or element. Our stream editor lets you type, erase, and edit directly within the native PDF stream, avoiding the rasterization that compromises quality in alternative tools.
5. **Download Instantly:** Click **Save/Download**. Because processing occurs locally on your CPU/GPU, exporting is near-instantaneous with no server queues.

---

## 🔒 Privacy Model

Core PDF processing is designed to happen locally in the browser. Selected files remain on the user's device while tools read, transform, preview, and export them.

- **True Stream Privacy:** Since PDFOmni edits the native stream client-side, your raw documents are never uploaded to a PDFOmni processing server.
- **AI Copilot Privacy:** The AI Copilot is optional. It stores indexing metadata locally, and only sends selected query and retrieved document context to OpenRouter using the API key supplied by the user.
- **Processing Limits:** Practical limits depend on device hardware, browser memory, page count, and image resolution. The interface presents a 500 MB per-file limit.

---

## 🛠️ Architecture

### Main Application
The main site lives in `src/` and uses:
- **React 19** & **React Router**
- **Vite**
- **Zustand** (State management)
- **Vanilla CSS** design tokens and responsive layouts
- **Core Libs:** PDF.js, PDF-lib, qpdf WebAssembly, Tesseract.js, Mammoth, SheetJS, and jsPDF.

Most tool routes are rendered inside the shared React shell with the common header, footer, AI sidebar, SEO content, and download flow.

### Standalone PDF Stream Editor
The world-class stream editor lives in `editpdf.html` as a standalone entry point. It runs its own custom rendering and editing engine because text detection, font embedding, canvas virtualization, and raw PDF stream manipulation require low-level, tight control that standard DOM libraries cannot provide.
- **No Rasterization:** Maintains full vector/text integrity by editing the PDF stream directly in the browser, separating us from every other tool which rasterizes the page.
- **Route:** The public route is `/edit-pdf`; legacy editor routes redirect here.

### PDF Compressor
`compress_pdf/` is an isolated React and TypeScript application. It uses a Web Worker for compression and builds into the main deployment under `dist/compress/app/`. Keeping it isolated prevents its worker, TypeScript, and styling pipeline from interfering with the main application.

### AI and RAG
The local retrieval system lives in `src/ai/` with its embedding worker and chat integration. It combines searchable document chunks with optional semantic embeddings so large PDFs can be queried without sending the entire document in every request. See [rag.md](./rag.md) for details.

### Static Route Generation
The app remains interactive React in the browser, while `scripts/prerender_routes.js` generates meaningful initial HTML for the homepage, every tool route, workflow, and supporting pages to optimize SEO and indexing.
- Route-specific titles and descriptions.
- Self-referencing canonical URLs on `https://pdfomni.com`.
- JSON-LD structured data.
- `scripts/verify_prerender_routes.js` checks the generated routes during each build.

---

## 📁 Repository Layout

```text
src/                    Main React application
src/components/Tools/   PDF tool interfaces
src/engine/             Shared PDF, OCR, and rendering engines
src/ai/                 Local retrieval and embedding code
src/config/             Tool catalog and SEO content
compress_pdf/           Isolated TypeScript compressor application
public/                 Static assets, crawler files, headers, and redirects
scripts/                Prerendering, verification, and protected-build scripts
tests/                  Playwright test suites and reusable fixtures
editpdf.html            Standalone PDF editor
```

---

## 💻 Requirements

- **Node.js** 18 or newer
- **npm** 9 or newer
- A modern browser with WebAssembly and Web Worker support

---

## 🚀 Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```
   *Note: The root `postinstall` script installs dependencies inside `compress_pdf/` automatically.*

2. **Run the development server:**
   ```bash
   npm run dev
   ```
   The default main development URL is: [http://localhost:5174](http://localhost:5174).

3. **Develop the compressor separately (optional):**
   ```bash
   npm run dev --prefix compress_pdf
   ```

---

## 📦 Builds

### Full Build
```bash
npm run build
```
This command:
1. Builds the main application into `dist/`.
2. Builds the compressor into `dist/compress/app/`.
3. Prerenders and verifies all public routes.
4. Generates the Cloudflare deployment manifest.
5. Repeats the build into `obfuscated_dist/` and obfuscates the shipped first-party code.

To create only the normal `dist/` output, run:
```bash
npm run build:standard
```

### Protected Build
```bash
npm run build:protected
```
This creates a separate deployment in `obfuscated_dist/`, obfuscates the explicitly classified first-party application and worker code, syntax-checks every transformed file, and then prerenders and verifies the routes. Its report lists protected, vendor/runtime, and unclassified JavaScript so newly shipped entry points cannot be silently missed. The protected build is a copying deterrent, not a security boundary.

### Bundle Analysis and Source Maps
```bash
npm run build:analyze
```
This writes a local treemap and raw module graph to `output/` and creates source maps in the ignored `analysis_dist/` directory. Production builds intentionally do not publish source maps because PDFOmni's first-party editor and processing code is protected. The private analysis build provides module-level debugging and bundle attribution without adding source files or `.map` files to `dist/`, `obfuscated_dist/`, or the Cloudflare manifests.

---

## 🧪 Testing

Run lint checks:
```bash
npm run lint
```

Run the Playwright suite:
```bash
npx playwright test
```

Run a focused test:
```bash
npx playwright test tests/verify-compressor.spec.js
```
*Playwright uses `http://localhost:5174` by default. Override it with `PLAYWRIGHT_TEST_BASE_URL` when testing another deployment.*

---

## ☁️ Cloudflare Deployment

The production target is Cloudflare Pages with the custom domain `pdfomni.com`.
Deploy either:
- The contents of `dist/` for the normal build
- The contents of `obfuscated_dist/` for the protected build

The generated build includes headers, redirects, verification files, crawler directives, sitemaps, static HTML, workers, WASM files, and compressor assets. Do not commit local environment files, API keys, certificates, or deployment archives.

---

## ⚠️ Important Project Notes

- Keep `pdfjs-dist` API and worker versions aligned.
- Preserve the isolated editor and compressor build paths when changing Vite configuration.
- Test PDF export changes by reopening exported files in PDFOmni and at least one external viewer.
- Check both light and dark themes on desktop and mobile after shared CSS changes.
- Rebuild both normal and protected distributions before publishing.
