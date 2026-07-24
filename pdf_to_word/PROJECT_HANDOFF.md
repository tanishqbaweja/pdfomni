# PDFOmni PDF-to-Word Project Handoff

This document explains what this repository contains, how the active converter works, what must be copied when moving it elsewhere, how to run and deploy it, and how another agent should safely continue development.

## Quick answer: what should be copied?

The safest transfer is to clone the repository rather than manually copying files:

```powershell
git clone https://github.com/Trebell16/pdf_to_word.git
cd pdf_to_word
npm ci
npm run dev
```

The local development URL is:

```text
http://localhost:8082/
```

If files must be copied manually, the minimum source set for the current converter is:

```text
index.html
main.js
package.json
package-lock.json
vite.config.js
```

Also copy `.gitignore` when the destination is another Git repository.

Do **not** copy only `main.js`. The active converter depends on:

- DOM elements and IDs in `index.html`
- Vite's module bundling and PDF.js worker handling
- packages pinned by `package-lock.json`
- the development-session behavior in `vite.config.js`

For continued regression testing, copy or clone the tracked sample PDFs and verification scripts too. See [Transfer profiles](#transfer-profiles).

## Project purpose

PDFOmni is a local, browser-based PDF-to-DOCX converter. A selected PDF is processed in the browser and is not uploaded to an application server. The converter aims to preserve:

- editable and selectable text
- original page geometry
- text positioning, font attributes, color, scripts, and rotation
- raster images and vector artwork
- detected table structure
- hyperlinks and annotations
- embedded PDF fonts when their bytes are available
- visually complete image-based fallbacks for scanned or unusually complex content

The generated DOCX is assembled in memory and downloaded through a browser-generated Blob URL.

## Active application architecture

The production path is:

```text
index.html
    -> main.js
        -> pdfjs-dist: parse and render the PDF
        -> docx: construct the initial DOCX package
        -> JSZip: patch OOXML for high-fidelity positioned content
        -> browser Blob: expose and download the final .docx
```

The conversion is fully client-side. There is no PDF conversion API, database, upload service, or server-side document processor in this repository.

### Active entry point

`index.html` is the active UI. Near the end of the file it loads:

```html
<script type="module" src="/main.js"></script>
```

The page contains all primary UI markup and most of the page styling. `main.js` exposes the application object as `window.app`, and the HTML calls:

```text
app.loadFile(...)
app.startConversion()
app.reset()
```

The following DOM IDs are part of the current integration contract and should not be renamed without updating `main.js`:

```text
file-input
drop-zone
conversion-panel
preview-grid
info-filename
info-filesize
info-pages
info-type
success-card
btn-download
prog-timer
conversion-time-result
```

The safest way to embed the converter in another product is to preserve this route as a self-contained page first. Refactor the UI only after the unchanged converter has been built and verified in the new environment.

### Main conversion pipeline

`main.js` is the current converter implementation and intentionally contains most of the PDF analysis and DOCX generation logic in one large module.

At a high level it:

1. Loads the PDF with PDF.js.
2. Uses a complete ArrayBuffer for PDFs smaller than 50 MB.
3. Uses `PDFDataRangeTransport` and `File.slice()` for larger PDFs.
4. Generates page previews and determines whether extractable text exists.
5. Processes one page at a time.
6. Extracts and classifies text, fonts, images, vector graphics, tables, annotations, and page backgrounds.
7. Reconstructs editable content with absolute page-aligned Word objects.
8. Uses selective raster fallbacks for content that cannot be represented reliably as editable Word elements.
9. Builds a DOCX package with `docx`.
10. Patches the generated OOXML package with JSZip to preserve fidelity features that the high-level `docx` API does not expose.
11. Exposes the completed Blob as `window.lastGeneratedDocxBlob` for automated tests.
12. Downloads the Blob when the user clicks the download button.

Each processed PDF page becomes its own DOCX section with the source page size and orientation.

### PDF.js worker

The worker URL is resolved through the bundler:

```js
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();
```

Do not replace this with a machine-specific path. Do not open the project directly with a `file://` URL; serve or build it through Vite so the worker and module assets resolve correctly.

### Background-tab behavior

The converter contains yield logic intended to avoid browser animation-frame throttling when the page is hidden. The automated comparison harness can simulate a hidden tab with:

```powershell
$env:FORCE_HIDDEN_STATE='1'
node compare.js
```

This behavior should be tested after changes to page scheduling, concurrency, PDF rendering, or cleanup.

### Memory management

The converter:

- processes pages incrementally
- releases PDF.js page objects after processing
- clears page/font caches
- avoids retaining every rendered page at full resolution
- uses range-backed loading for large files
- revokes generated download URLs

Changes that cache canvases, page objects, image buffers, or base64 strings can easily reintroduce browser freezes or repeated-upload memory growth.

## Repository file map

### Required runtime source

| File | Purpose |
| --- | --- |
| `index.html` | Active converter page, styles, upload UI, progress UI, and download UI |
| `main.js` | Active PDF parsing, reconstruction, DOCX generation, and OOXML patching |
| `package.json` | Project metadata, scripts, and declared dependencies |
| `package-lock.json` | Exact dependency tree required for reproducible installation |
| `vite.config.js` | Vite server, worker bundling, no-auto-open behavior, cache handling, and dev-session reload handling |

### Recommended repository support

| File | Purpose |
| --- | --- |
| `.gitignore` | Excludes dependencies, builds, comparison artifacts, and logs |
| `PROJECT_HANDOFF.md` | This transfer and maintenance guide |

### Verification tools

| File | Purpose |
| --- | --- |
| `compare.js` | Headless browser conversion, DOCX download, page-1 PDF render, package inspection, and timing capture |
| `render_docx_visual_verify.mjs` | Renders selected DOCX pages from their OOXML/VML into PNG files without opening Word |
| `verify_docx_to_png.js` | Renders a selected PDF and DOCX page, creates a pixel diff, and writes comparison metrics |
| `scratch_debug_matrix.js` | Targeted debugging helper |
| `scratch_dump_objs.js` | Object inspection helper |
| `scratch_read_xml.js` | DOCX/XML inspection helper |
| `scratch_render_word_subset.mjs` | Targeted Word rendering/debug helper |
| `tmp_inspect_pdf.mjs` | PDF inspection helper |

The scratch utilities are not required in production. Keep them when handing the repository to an agent who will continue converter development.

### Tracked regression PDFs

The repository currently tracks a varied PDF corpus:

```text
another_research_paper.pdf
another_research_paper_2.pdf
apple_report.pdf
docline_report.pdf
f1040.pdf
latest.pdf
nasabook.pdf
openai_report.pdf
research_paper.pdf
sndc.pdf
student_cheating_dataset.pdf
```

These files are not needed at runtime, but they are valuable regression fixtures covering:

- long, design-heavy reports
- academic multi-column layouts
- mathematical notation
- tables
- rotated text
- forms
- photos and diagrams
- hyperlinks and annotations

Additional local PDFs such as `attention.pdf`, `bert.pdf`, `llama.pdf`, and `yolo.pdf` may exist in a working directory but are currently untracked. They will **not** be included in a Git clone unless they are deliberately added or transferred separately.

### Legacy or separate tools

| File | Status |
| --- | --- |
| `pdftoword.html` | Legacy monolithic converter; not loaded by the current application |
| `editpdf.html` | Separate PDF editing tool; not required for PDF-to-DOCX conversion |

Do not replace the current `index.html` + `main.js` path with code from `pdftoword.html` unless explicitly performing a reviewed migration. A stale legacy implementation can make a change appear to work in one file while `npm run dev` continues serving a different implementation.

## Transfer profiles

### Profile A: continue development

Best option: clone the complete Git repository.

Include:

```text
.git/
.gitignore
PROJECT_HANDOFF.md
index.html
main.js
package.json
package-lock.json
vite.config.js
verification scripts
scratch/debug scripts
tracked regression PDFs
legacy/separate HTML tools for reference
```

Exclude:

```text
node_modules/
dist/
output/
tmp/
comparisons/
.playwright-cli/
*.log
```

Run `npm ci` after transfer.

### Profile B: integrate source into another JavaScript application

Copy:

```text
index.html
main.js
package.json
package-lock.json
vite.config.js
```

Then either:

1. keep the converter as a dedicated Vite route; or
2. port the markup and IDs from `index.html` into the host application's component system while keeping `main.js` behavior unchanged initially.

If merging dependencies into an existing package:

- retain compatible versions of `docx`, `pdfjs-dist`, and `vite`
- declare `jszip` directly rather than relying on another package to install it transitively
- preserve the PDF.js worker URL strategy
- test `npm run build` before changing converter logic

### Profile C: deploy only the built site

On a trusted build machine:

```powershell
npm ci
npm run build
```

Deploy the contents of:

```text
dist/
```

This profile is suitable when the destination only needs to host the current tool and will not modify the source. Do not treat an old `dist/` directory as canonical source; rebuild it from the committed source.

## Installation and local use

Prerequisites:

- a current Node.js LTS release
- npm
- a modern Chromium-based browser for the best-tested behavior
- enough memory for the PDFs being converted

Install exact dependencies:

```powershell
npm ci
```

Start the development server:

```powershell
npm run dev
```

Vite is configured to:

- listen on port `8082`
- accept LAN connections with `host: true`
- use a strict port
- avoid opening a browser automatically
- disable caching in development
- force existing tabs to reload after the dev server restarts

Build a production bundle:

```powershell
npm run build
```

Preview the production bundle:

```powershell
npm run preview
```

If `"vite" is not recognized`, do not install a random global Vite version. Run:

```powershell
npm ci
npm run dev
```

The development script invokes the repository's local Vite executable.

## Deployment notes

The generated `dist/` site can be hosted on a static HTTPS host. No server-side converter is required.

The host must:

- serve JavaScript modules and worker assets with correct MIME types
- preserve Vite-generated asset paths
- allow Blob downloads
- avoid rewriting worker files to HTML
- provide enough client-side execution time for long conversions

If the converter is deployed beneath a subpath, configure Vite's `base` option and test the PDF.js worker URL in the built application.

### Branding and telemetry

`index.html` currently contains:

- PDFOmni branding
- a canonical URL for `https://pdfomni.com/pdf-to-word`
- Google Analytics ID `G-TSWLYFYBM8`

When deploying under another product or domain, review or remove these values. PDF bytes are processed locally, but the analytics script still makes ordinary analytics network requests. Do not describe a deployment as completely offline unless third-party analytics and other remote resources have been removed.

### Licensing

This repository currently has no tracked `LICENSE` file. Before public redistribution or commercial reuse, the owner should add or confirm the intended project license and review the licenses of `pdfjs-dist`, `docx`, JSZip, Vite, and Playwright.

## Verification workflow

Visual verification is mandatory for converter changes. XML structure checks alone cannot catch clipped images, incorrect font metrics, misplaced scripts, invisible text, or visually flattened shapes.

### 1. Build check

```powershell
npm run build
```

### 2. Headless full conversion

Start the Vite server in one terminal:

```powershell
npm run dev
```

In another terminal:

```powershell
$env:PDF_FILE='apple_report.pdf'
$env:CONVERT_TIMEOUT_MS='600000'
node compare.js
```

Outputs are written under `comparisons/`. `compare.js`:

- opens the converter in headless Chromium
- uploads the chosen PDF
- performs a full conversion
- saves the browser-generated DOCX
- captures conversion timing
- renders the source PDF's first page
- inspects the DOCX package

To test hidden-tab scheduling:

```powershell
$env:PDF_FILE='apple_report.pdf'
$env:CONVERT_TIMEOUT_MS='600000'
$env:FORCE_HIDDEN_STATE='1'
node compare.js
```

### 3. Render selected DOCX pages without opening Word

```powershell
$env:DOCX_FILE='comparisons\apple_report.docx'
$env:OUTPUT_DIR='comparisons\apple_report_rendered'
$env:PAGES='1,2,3,16,19,93,104,105'
node render_docx_visual_verify.mjs
```

This renderer understands the positioned VML/OOXML generated by the current fidelity pipeline. It is suitable for quiet visual QA without opening applications in the user's active desktop workspace.

### 4. Generate a PDF-versus-DOCX pixel comparison

```powershell
$env:PDF_FILE='apple_report.pdf'
$env:DOCX_FILE='comparisons\apple_report.docx'
$env:PAGE_NUMBER='19'
node verify_docx_to_png.js
```

It writes:

- the rendered PDF page
- the rendered DOCX page
- a visual diff image
- JSON comparison metrics

The custom renderer is a verification aid, not a complete replacement for Microsoft Word. For final compatibility checks, use Word rendering through hidden/non-interactive automation when available, and never open visible desktop applications while the user is working.

### 5. Regression scope

Do not validate only the page named in a bug report. At minimum:

1. reproduce and inspect the reported page at a useful zoom level
2. inspect nearby pages using the same construct
3. run at least one unrelated PDF from the regression corpus
4. regenerate the full target DOCX
5. inspect representative text, tables, images, vectors, rotated text, and mathematical content
6. confirm that conversion time and memory use have not regressed materially

## Rules for future agents

These rules summarize the project's development expectations:

1. Read this file before editing.
2. Confirm that `npm run dev` is serving `index.html` and `main.js`.
3. Make the smallest change that addresses the root cause.
4. Do not add PDF-name, page-number, or sample-specific hardcoding.
5. Do not repair one screenshot by degrading other PDFs.
6. Preserve editability unless a selective raster fallback is genuinely necessary for fidelity.
7. Keep tables as real Word tables when table detection is reliable.
8. Keep separate images separate when the PDF exposes separate image objects.
9. Preserve rotations as native editable Word text rotation where supported.
10. Preserve text color, scripts, font metrics, hyperlinks, and page coordinates.
11. Do not reduce render quality or resolution to gain speed without explicit approval.
12. Do not retain page canvases, PDF.js pages, or large buffers longer than necessary.
13. Run headless verification and inspect zoomed page screenshots before declaring a visual fix complete.
14. Do not open Word, browsers, or desktop viewers visibly in the user's active workspace.
15. Do not stage generated DOCX files, screenshots, temporary XML, `node_modules`, `dist`, `output`, `tmp`, or `comparisons`.
16. Preserve unrelated user files and untracked regression assets.
17. Commit the completed source change and push the current branch after verification.

## Known constraints and transfer caveats

### 500 MB claim is not currently enforced in code

The FAQ in `index.html` advertises support for files up to 500 MB. The current `loadFile` path does not contain an explicit 500 MB rejection. Large files use range-backed loading, but that is not the same as enforcing a size limit.

A future change should either:

- implement and test an explicit 500 MB limit; or
- change the displayed claim to match the actual supported behavior.

Do not tell users the limit is enforced until the implementation and a regression test confirm it.

### JSZip is imported but not declared directly

`main.js` imports:

```js
import JSZip from 'jszip';
```

The current lockfile supplies JSZip through the dependency tree, but `package.json` does not declare it directly. Therefore:

- exact transfers must include `package-lock.json`
- installs should use `npm ci`
- dependency cleanup should add JSZip as a direct dependency in a dedicated, tested change

Do not casually regenerate or omit the lockfile during transfer.

### `main.js` is a monolith

The current converter is concentrated in one large module. This makes behavior discoverable in one place but increases regression risk. A future modularization should be behavior-preserving, incremental, and accompanied by full visual regression testing. Do not combine a large refactor with a fidelity bug fix.

### DOCX rendering varies

Microsoft Word, LibreOffice, Google Docs, and custom previewers do not render all positioned OOXML identically. The OOXML patching layer is primarily aimed at Word-compatible fidelity. Test the actual target viewer before promising identical output across office suites.

### Fonts affect geometry

When a PDF font cannot be embedded or mapped, Word substitutes another font. Different glyph widths can change line wrapping, table row height, and visual alignment. The converter attempts to preserve embedded font data and horizontal scaling, but substitutions remain a platform-dependent constraint.

### Complex math and diagrams

PDF mathematical notation and diagrams often consist of independently positioned glyphs and vector fragments rather than semantic equations. The converter reconstructs these pieces and selectively uses image fallbacks where editable reconstruction would be visibly worse. It is not a general PDF-to-OMML equation recognizer.

### Browser resource limits

Conversion speed and memory use depend on:

- PDF page count and complexity
- render resolution
- number of images and vector paths
- available RAM
- CPU core count
- browser throttling and memory policies

Because processing is client-side, static hosting does not move this load to a server.

## Transfer checklist

Before handing the project to another agent or environment:

- [ ] Push all intended source changes to GitHub.
- [ ] Clone from `https://github.com/Trebell16/pdf_to_word.git`.
- [ ] Confirm the expected branch and latest commit.
- [ ] Run `npm ci`.
- [ ] Run `npm run build`.
- [ ] Run `npm run dev` and confirm `http://localhost:8082/`.
- [ ] Confirm `index.html` loads `/main.js`.
- [ ] Confirm the PDF.js worker loads without console errors.
- [ ] Convert a small research PDF.
- [ ] Convert a long design-heavy PDF such as `apple_report.pdf`.
- [ ] Run the hidden-tab test.
- [ ] Render and inspect selected DOCX pages.
- [ ] Verify no generated artifacts were staged.
- [ ] Review analytics, canonical URL, branding, and licensing for the destination.
- [ ] Transfer any locally untracked regression PDFs separately if they are needed.

## Copyable prompt for another agent

Use the following handoff prompt:

```text
Clone https://github.com/Trebell16/pdf_to_word.git and read PROJECT_HANDOFF.md before editing.

The active converter is index.html + main.js under Vite. Do not use pdftoword.html as the implementation. Install with npm ci so package-lock.json is honored, then run npm run build and npm run dev.

Make minimal, root-cause changes only. Do not add PDF-name or page-number special cases. Preserve existing quality, editability, performance, and background-tab behavior. Verify changes using the headless scripts in PROJECT_HANDOFF.md, regenerate the complete target DOCX, inspect zoomed screenshots of affected and related pages, and test at least one unrelated regression PDF. Do not open visible desktop applications. Do not commit generated output, temporary files, screenshots, node_modules, or dist. Commit and push the completed source change.
```
