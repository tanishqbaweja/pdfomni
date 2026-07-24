import fs from 'node:fs'
import path from 'node:path'
import tools, { toolCategories } from '../src/config/tools.js'
import { getToolSeo } from '../src/config/toolSeo.js'
import { guides } from '../src/config/guides.js'

const outDir = process.argv[2] || 'dist'
const rootDir = process.cwd()
const outputRoot = path.resolve(rootDir, outDir)
const templatePath = path.join(outputRoot, 'index.html')
const SITE_URL = 'https://pdfomni.com'

if (!fs.existsSync(templatePath)) {
  throw new Error(`Cannot prerender routes because ${templatePath} does not exist.`)
}

const template = fs.readFileSync(templatePath, 'utf8')
  .replace(/\s*<!-- PDFOMNI_PRERENDER_HEAD_START -->[\s\S]*?<!-- PDFOMNI_PRERENDER_HEAD_END -->\s*/g, '\n')
  .replace(/\s*<!-- PDFOMNI_PRERENDER_BODY_START -->[\s\S]*?<!-- PDFOMNI_PRERENDER_BODY_END -->\s*/g, '\n')

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sentenceList(items, limit = 10) {
  const list = items.slice(0, limit)
  if (list.length <= 1) return list[0] || ''
  return `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}`
}

function richText(value) {
  const input = String(value ?? '')
  const linkPattern = /<a href="(\/[^"]+)">([^<]+)<\/a>/g
  let html = ''
  let lastIndex = 0
  let match
  while ((match = linkPattern.exec(input))) {
    html += esc(input.slice(lastIndex, match.index))
    html += `<a href="${esc(match[1])}">${esc(match[2])}</a>`
    lastIndex = match.index + match[0].length
  }
  return html + esc(input.slice(lastIndex))
}

function seoFallbackHtml({ description, canonicalPath, h1, intro, richIntro = false, sections = [], faq = [], verificationHtml = '' }) {
  const shouldRenderDescription = description && !String(description).trim().startsWith(String(intro).trim())
  return `
    <main class="prerendered-seo" data-prerendered-route="${esc(canonicalPath)}">
      <section>
        <p class="tool-seo-kicker">Private PDF tool</p>
        <h1>${esc(h1)}</h1>
        <p>${richIntro ? richText(intro) : esc(intro)}</p>
        ${shouldRenderDescription ? `<p>${esc(description)}</p>` : ''}
        ${sections.map((section) => `
          <h2>${esc(section.title)}</h2>
          ${(section.paragraphs || []).map((paragraph) => `<p>${section.rich ? richText(paragraph) : esc(paragraph)}</p>`).join('')}
          ${section.items?.length ? `<ul>${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
          ${section.links?.length ? `
            <ul>
              ${section.links.map((link) => `
                <li>
                  <a href="${esc(link.href)}">${esc(link.label)}</a>
                  ${link.description ? `<span> - ${esc(link.description)}</span>` : ''}
                </li>
              `).join('')}
            </ul>
          ` : ''}
        `).join('')}
        ${faq.length ? `
          <h2>Frequently Asked Questions</h2>
          ${faq.map((item) => `<h3>${esc(item.question)}</h3><p>${esc(item.answer)}</p>`).join('')}
        ` : ''}
        ${verificationHtml}
      </section>
    </main>
  `
}

function structuredData({ title, description, canonicalPath, faq = [], schemaType = 'WebPage', published }) {
  const graph = [
    {
      '@type': schemaType,
      name: title,
      ...(schemaType === 'Article' ? { headline: title, datePublished: published, dateModified: published } : {}),
      description,
      url: `${SITE_URL}${canonicalPath}`,
    },
  ]
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    })
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}

function injectPage({ canonicalPath, title, description, bodyHtml, schema, robots = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1', writeRootHtml = false }) {
  const canonicalUrl = `${SITE_URL}${canonicalPath}`
  let html = template
    .replace(/<title>.*?<\/title>/s, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/s, `<meta name="description" content="${esc(description)}">`)

  const headExtras = `
    <!-- PDFOMNI_PRERENDER_HEAD_START -->
    <link rel="canonical" href="${esc(canonicalUrl)}">
    <meta name="robots" content="${esc(robots)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${esc(canonicalUrl)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <script type="application/ld+json" data-seo-ld="true">${JSON.stringify(schema)}</script>
    <!-- PDFOMNI_PRERENDER_HEAD_END -->
  `
  html = html.replace('</head>', `${headExtras}\n</head>`)
  html = html.replace('<div id="root"></div>', `<!-- PDFOMNI_PRERENDER_BODY_START -->${bodyHtml}<!-- PDFOMNI_PRERENDER_BODY_END --><div id="root"></div>`)

  const cleanRoute = canonicalPath === '/' ? '' : canonicalPath.replace(/^\/+|\/+$/g, '')
  const routeDir = path.join(outputRoot, cleanRoute)
  fs.mkdirSync(routeDir, { recursive: true })
  const routeIndexPath = path.join(routeDir, 'index.html')
  fs.writeFileSync(routeIndexPath, html)
  if (cleanRoute || writeRootHtml) {
    const cleanName = canonicalPath.replace(/^\/+|\/+$/g, '')
    if (cleanName) {
      fs.writeFileSync(path.join(outputRoot, `${cleanName}.html`), html)
    }
  }
}

function toolPage(tool) {
  const seo = getToolSeo(tool.id, tool)
  const faq = seo.faqs
  const description = `${seo.intro} PDFOmni processes files locally in your browser with a clear 500 MB per-file limit.`
  const sections = [
    {
      title: `How to use ${tool.name}`,
      paragraphs: [
        ...seo.steps.map((step, index) => `${index + 1}. ${step}`),
        seo.why,
        `Common uses include ${sentenceList(seo.useCases, 3).toLowerCase()}. Keep the source file until you have opened the downloaded result and checked every important page.`,
      ],
    },
    {
      title: 'What happens to your file',
      paragraphs: [
        'The supported document work happens in the browser. Your device reads the file and prepares the output, so PDFOmni does not need to send the source to a document-processing server. Normal website resources, analytics, ads, and optional online features can still make internet requests, as explained in the Privacy Policy.',
        'Local processing means that speed depends on the device. A short text PDF can finish quickly, while a large scan with high-resolution images may use much more memory. The 500 MB per-file limit is an upper boundary, and complicated files can still take longer on an older phone or laptop.',
        'You do not need to create an account before starting. Choose the source file, make the change, and download a new copy. Keep the original until you have opened the export and checked that every important page still looks and works the way you expect.',
      ],
      links: [{ href: '/privacy', label: 'Read the Privacy Policy' }],
    },
    {
      title: 'Before you start',
      paragraphs: seo.notes,
    },
    ...(seo.formatGuidance?.length ? [{
      title: 'What to expect in the Word file',
      paragraphs: seo.formatGuidance,
    }] : []),
    {
      title: 'Tips for a reliable export',
      paragraphs: [
        seo.advanced,
        'Save the result with a name that separates it from the source. Reopen the downloaded file, compare the page count, and inspect the parts that changed. If the PDF is being submitted for school, work, taxes, or an official form, compare it with the receiving instructions before uploading it.',
        'PDFs can store text, images, forms, annotations, fonts, and security settings in very different ways. A preview is helpful, but it cannot replace a final check of the downloaded file. Use another PDF reader for an important document when you want an extra compatibility check.',
        'Check the page count and move through the full document. Pay extra attention to small text, page boundaries, forms, links, signatures, unusual fonts, and pages made from scans. A successful download only confirms that a file was created. It does not confirm that the result meets the rules of the person or service receiving it.',
        'Keep the original and final copies until the work is accepted. If a setting did not produce the right result, return to the source rather than repeatedly processing an already compressed or converted output. Clear filenames make it easier to tell which version was reviewed and which version was actually submitted.',
      ],
    },
    {
      title: 'Useful next steps',
      paragraphs: ['Continue only when the document needs another change. Each link opens a focused PDFOmni tool or guide.'],
      links: seo.related,
    },
    {
      title: 'Choose the right source and keep versions clear',
      paragraphs: [
        'Start from the clearest and most complete copy you have. Repeatedly converting or compressing an already processed PDF can lower image quality and make text harder to edit or extract. If the original came from Word, Excel, or another authoring program, keep that source because it is usually the easiest place to make large content changes. A clean source also gives you a reliable page to compare with the result.',
        'Use names that explain the document status, such as report-original.pdf, report-review.pdf, and report-submitted.pdf. Avoid overwriting the only copy or filling a folder with names like final2 and final-new. A clear name makes it easier to reopen the exact output you checked and prevents an older version from being sent by mistake.',
      ],
    },
    {
      title: 'Check the delivery requirements',
      paragraphs: [
        'Look at the instructions from the person, class, company, or portal receiving the file. They may require a particular filename, page size, file-size limit, signature method, color setting, or accessibility standard. Finish the document first, then compare the downloaded copy with that list. Open it in the program the recipient is likely to use when possible. If the file will be printed, check margins and small text on paper or in print preview. If it will be uploaded, confirm that the portal accepts the format before deleting any working copies. A technically successful export can still be the wrong submission when one of these practical requirements is missed.',
      ],
    },
  ]
  return {
    canonicalPath: tool.canonicalPath || `/tool/${tool.id}`,
    title: `${seo.h1} | PDFOmni`,
    description,
    h1: seo.h1,
    intro: seo.intro,
    sections,
    faq,
  }
}

function guideIndexPage() {
  return {
    canonicalPath: '/guides',
    title: 'PDF Guides for Privacy, Accessibility, and Better Workflows | PDFOmni',
    description: 'Read practical PDF guides about document privacy, accessibility, scanning, redaction, compression, security, and everyday file organization.',
    h1: 'Practical Guides for Better PDF Work',
    intro: 'These guides explain the parts of document work that a tool button cannot decide for you. They cover privacy, accessibility, scan quality, safe sharing, and ways to avoid common mistakes before a PDF is sent to someone else.',
    sections: [
      {
        title: 'All PDF guides',
        paragraphs: ['Choose a guide below for a detailed explanation and links to the PDFOmni tools that can help with the job.'],
        links: guides.map((guide) => ({
          href: `/guides/${guide.slug}`,
          label: guide.title,
          description: guide.description,
        })),
      },
    ],
    faq: [],
  }
}

function guideArticlePage(guide) {
  return {
    canonicalPath: `/guides/${guide.slug}`,
    title: `${guide.title} | PDFOmni`,
    description: guide.description,
    h1: guide.title,
    intro: guide.intro,
    richIntro: guide.richIntro,
    sections: [
      ...guide.sections.map((section) => ({ ...section, rich: true })),
      {
        title: 'Related PDFOmni pages',
        paragraphs: ['Use these pages when you are ready to apply the ideas from the guide to a document. Open the source in the tool that matches the next task, keep the original nearby, and review the new download before moving to another step. The links are options, not a required sequence.'],
        links: guide.related,
      },
    ],
    faq: [],
    schemaType: 'Article',
    published: guide.published,
  }
}

function homePageSections() {
  const visibleTools = tools.filter((tool) => tool.canonicalPath && !tool.hiddenOnHome)
  const categoryDescriptions = {
    organize: 'Use these tools when a PDF needs basic cleanup before you send it, print it, or archive it. Merge related documents into one file, split out only the pages you need, reorder messy packets, compress large attachments, rotate sideways scans, or add page numbers for reports and submissions.',
    'convert-to': 'Turn everyday files into PDFs when you need a format that is easier to share and review. Word documents, spreadsheets, image files, and HTML pages can become cleaner PDF outputs for school work, client documents, invoices, forms, portfolios, and web content.',
    'convert-from': 'Pull useful content out of a PDF when the document needs to move into another workflow. Export pages as images for previews and thumbnails, or extract text from a PDF so it can be copied into notes, research drafts, email replies, or document archives.',
    edit: 'Edit and annotate tools are for documents that need visible changes before they are shared. Edit PDF text, add watermarks, redact sensitive details, crop unwanted margins, draw attention to important areas, or adjust images without starting the document again from scratch.',
    security: 'Security tools help with private documents such as invoices, bank statements, contracts, school records, and signed forms. You can protect a PDF with a password, unlock files you are allowed to open, or add a signature before sending the document to someone else.',
    advanced: 'Advanced tools are useful when a one-off PDF action is not enough. Batch processing helps repeat the same document steps across multiple files, while the WCAG checker helps review accessibility issues before a PDF is published, submitted, or shared with a wider audience.',
  }
  const categorySections = toolCategories.map((category) => {
    const categoryTools = visibleTools.filter((tool) => tool.category === category.id)
    const toolNames = categoryTools.map((tool) => tool.name)
    return {
      title: `${category.label} tools`,
      paragraphs: [
        categoryDescriptions[category.id],
        `In this category you can use ${sentenceList(toolNames, 8)}. Each link opens a dedicated page with the actual browser tool, a simple upload flow, and more detail about the specific PDF task.`,
      ],
      links: categoryTools.map((tool) => ({
        href: tool.canonicalPath,
        label: tool.name,
        description: tool.description,
      })),
    }
  })

  return [
    {
      title: 'Private PDF tools for real document work',
      paragraphs: [
        'PDFOmni is built for people who need practical PDF tools without sending every file through an upload-first server workflow. The app covers common document jobs such as merging, splitting, compressing, converting, editing, signing, protecting, unlocking, redacting, and checking PDFs for accessibility.',
        'The homepage is organized around real document tasks, so you can search by tool name, browse by category, and open the exact workflow you need without digging through unrelated options.',
        'Core PDF processing is designed to happen locally in the browser wherever the selected workflow supports it. That matters for private files such as school documents, invoices, resumes, reports, contracts, scanned forms, and internal business PDFs.',
      ],
    },
    ...categorySections,
    {
      title: 'Why PDFOmni focuses on local processing',
      paragraphs: [
        'Many PDF websites work by uploading the file first, processing it on a remote server, and then sending the result back. PDFOmni takes a local-first approach so tools can create the output inside the browser tab. That makes the experience useful for people who care about privacy, speed on large files, and not waiting for a server queue.',
        'PDFOmni sets a clear 500 MB per-file limit for PDF tools. Browser performance still depends on the device, file complexity, image resolution, fonts, forms, and page count, but the limit gives users a straightforward boundary before they choose a file.',
        'The site is free to use and does not add artificial rate limits to local browser actions. When a document needs multiple steps, users can move from one PDFOmni tool to another, or use the workflow builder for repeatable document tasks.',
        'The Edit PDF tool can work with selectable text, embedded-font data, images, and document objects while keeping the source file on the device. Complicated PDFs can store those objects in unusual ways, so edited exports still need a careful check.',
      ],
    },
  ]
}

const routePages = [
  {
    canonicalPath: '/',
    title: 'PDFOmni | 100% Private PDF Tools',
    description: 'Merge, split, compress, convert, edit, sign, and protect PDFs locally in your browser with private client-side PDF tools.',
    h1: 'Every PDF tool you need, completely private',
    intro: 'PDFOmni is a local-first PDF toolkit for everyday document work. Files stay on your device while the browser handles merge, split, compress, convert, edit, sign, protect, unlock, and accessibility workflows.',
    sections: homePageSections(),
    faq: [],
    verificationHtml: `
      <p>
        <a href="https://www.foundrlist.com/product/pdfomni?utm_source=badge&amp;utm_medium=embed" rel="noopener">
          <img src="https://www.foundrlist.com/api/badge/pdfomni" alt="Featured on FoundrList" width="150" height="48" loading="lazy" decoding="async">
        </a>
        <a href="https://twelve.tools" rel="noopener">
          <img src="https://twelve.tools/badge1-light.svg" alt="Featured on Twelve Tools" width="200" height="54" loading="lazy" decoding="async">
        </a>
        <a href="https://wired.business" rel="noopener">
          <img src="https://wired.business/badge2-light.svg" alt="Featured on Wired Business" width="200" height="54" loading="lazy" decoding="async">
        </a>
      </p>
    `,
  },
  ...tools.filter((tool) => tool.canonicalPath && !tool.hiddenOnHome).map(toolPage),
  guideIndexPage(),
  ...guides.map(guideArticlePage),
  {
    canonicalPath: '/workflow',
    title: 'Build Private PDF Workflows Locally | PDFOmni',
    description: 'Create client-side PDF workflows for merge, split, rotate, watermark, page numbering, and batch document automation directly in your browser.',
    h1: 'Build Private PDF Workflows Locally in Your Browser',
    intro: 'PDFOmni workflow builder lets you chain PDF actions into a repeatable pipeline without sending documents to a server.',
    sections: [
      {
        title: 'Local PDF automation for repeated document work',
        paragraphs: [
          'The PDFOmni workflow page is made for people who need a PDF batch processor without turning every task into a manual, one-file-at-a-time chore. You can connect nodes for input, process steps, filters, and output so common jobs become a repeatable local pipeline. That is useful for office documents, school packets, client reports, scanned forms, and internal files where the same merge, split, rotate, watermark, page numbering, or conversion steps happen again and again.',
          'Repeated work often includes the same few jobs: combine a group of files, rotate scanned pages, add a watermark, prepare a preview, and save the result. The visual builder keeps those steps together. Supported operations run in the browser, and the output is prepared locally instead of waiting in a document-processing queue.',
          'Local workflow automation changes the privacy model. With a typical cloud service, every source document must be uploaded before the server can do the job. In PDFOmni, the browser opens the files, performs supported operations locally, and prepares the output on your device. That makes the workflow page a better fit for private PDFs, internal drafts, invoices, forms, resumes, academic packets, and files that should not be sent to an unknown processing server unless there is a clear reason.',
          'The 500 MB per-file limit gives the app a simple, honest boundary. Browser-based PDF processing still depends on device memory, document complexity, image resolution, and the number of pages being previewed. PDFOmni keeps previews lazy where possible so long documents do not need every page rendered at once. If a workflow touches many pages, the visible area and nearby pages get priority, which keeps mobile and desktop layouts more responsive.',
        ],
      },
      {
        title: 'When a local workflow makes sense',
        paragraphs: [
          'A local workflow makes sense when the files should stay on the device and the required actions can run in a modern browser. A cloud service may be more suitable when a team needs shared storage, account approvals, server automation, or another feature that depends on remote infrastructure.',
          'That does not mean every browser task is magically faster than a server. A powerful cloud service can be helpful for team accounts, server-side storage, or tasks that require infrastructure outside the browser. PDFOmni is strongest when the user wants control: chain the common PDF actions, avoid unnecessary uploads, keep files on the device, and review the exported result before sharing it.',
          'Use a workflow when several actions belong together and you expect to repeat them. A one-step job is usually simpler on the dedicated tool page. Automation should remove repeated clicks, while a person still checks privacy, layout, accessibility, and the final downloaded files.',
          'Use the workflow builder when a document process has more than one step. For example, you might merge PDFs, rotate a few pages, add page numbers, apply a watermark, and export the final packet. You might split a large document into sections and then compress the files for email. You might convert pages to images for review or run accessibility checks before sending a public document. The goal is a practical private workflow, not a landing page that hides the actual tool.',
          'For mobile users, the same SEO content remains below the working interface so the page can be indexed without pushing the workflow controls out of reach. The top of the page is for doing the job; the bottom explains how the tool works, who it is for, and why local PDF automation can be a better fit than upload-first PDF websites for sensitive or repeated document tasks.',
        ],
      },
      {
        title: 'Workflow FAQ',
        paragraphs: [
          'Can I batch process PDF files for free? PDFOmni is built around free local PDF workflows, with supported operations running in the browser and a 500 MB per-file limit. Very large or unusually complex PDFs may still depend on your device performance.',
          'Is a browser workflow private? Supported PDFOmni operations are designed to process documents locally in the browser. Normal website resources such as scripts, ads, and public assets can still load from the web, but the core document work does not require a PDFOmni processing server.',
          'When should I use a workflow instead of a single tool page? Use a workflow when the same files need multiple steps or when you repeat the same document process often. Use a single tool page when you only need one action such as merge PDF, split PDF, compress PDF, rotate PDF, or sign PDF.',
        ],
      },
      {
        title: 'Plan the pipeline before adding nodes',
        paragraphs: [
          'Write the starting files and required output in one sentence before building anything. Then list only the changes needed to move between them. This keeps the canvas from becoming a collection of actions that do not serve the final document. Put structural changes such as merging, splitting, rotating, and reordering before labels or finishing steps. Add a download node at the end so the reviewed result has a clear destination.',
          'Think about failure points while choosing the order. A page range can become wrong after an earlier split, and page numbers can become misleading if pages move afterward. Redaction, conversion, signatures, and strong compression deserve a review near the step where they happen. Finding a problem early is easier than deciding which of several later actions caused it.',
        ],
      },
      {
        title: 'Test with a small and varied sample',
        paragraphs: [
          'Run a saved workflow on copies of a few representative files before using a large set. Include a short digital PDF, a scan, and any unusual form or page size that appears in the real group. Compare input and output counts, open the downloaded files, and check pages from the beginning, middle, and end. Similar thumbnails do not guarantee that PDFs have the same fonts, permissions, forms, or image structure.',
          'Keep the source folder unchanged and send output to a separate location with traceable names. Record the workflow settings and the date of the run when another person will review or receive the files. Automation should make a repeated job easier to check. It should not make it harder to identify which source created an output or where an unexpected change began.',
          'Before saving the pipeline for later, remove unused nodes and give it a name that describes the real task. A clear name and a short process are easier to understand when the workflow is opened again after several weeks.',
          'When the sample passes review, note which files were tested and which checks were completed. That record gives the next run a useful starting point instead of relying on memory.',
        ],
      },
    ],
    faq: [],
  },
  {
    canonicalPath: '/privacy',
    title: 'Privacy Policy | PDFOmni',
    description: 'Read how PDFOmni approaches privacy, local browser processing, document handling, ads, analytics, and user-controlled PDF workflows.',
    h1: 'PDFOmni Privacy Policy',
    intro: 'PDFOmni is built around local-first PDF tools. This privacy page explains the difference between browser-side document processing and normal website requests such as loading the app, ads, or public assets.',
    sections: [
      { title: 'Core PDF processing', paragraphs: ['Supported PDF operations run in the browser. The device reads the selected file and prepares the output, so PDFOmni does not need to upload the document bytes to a PDF-processing server for those local workflows.', 'Closing or refreshing a tool normally clears its in-memory working session. Files saved through the browser remain on the device until the user removes them. Browser processing still depends on device memory, software, and the complexity of the document.'] },
      { title: 'Normal website requests and analytics', paragraphs: ['The browser requests the app, fonts, icons, and public resources needed to display the site. Hosting and security providers can receive ordinary request details such as IP address, browser type, requested page, approximate time, and referrer.', 'PDFOmni may use analytics to understand public page visits, device support, and technical problems. Analytics can use cookies or similar identifiers. The site does not intentionally send the contents of locally processed documents to analytics services.'] },
      { title: 'Advertising and cookies', paragraphs: ['PDFOmni may display advertising from Google AdSense or another provider. Advertising services can use cookies, local storage, IP addresses, and browser signals to deliver ads, measure performance, limit repetition, and prevent fraud under their own privacy policies.', 'Users can manage cookies through browser settings and any consent controls shown on the site. Browser storage can also hold preferences such as theme choices and saved local workflow settings.'] },
      { title: 'Optional AI features', paragraphs: ['AI features are separate from ordinary PDF actions. When a user chooses to send a question, the message and selected context needed for an answer may be sent to the configured AI provider. Users should not send information they are not permitted to share with that provider.'] },
      { title: 'Local storage and saved preferences', paragraphs: ['The site can use browser storage for preferences such as light or dark mode and for features that save a local workflow. This information stays in the browser unless a feature clearly says otherwise. Users can clear it with browser controls, although doing so can remove saved preferences and locally stored workflow settings.'] },
      { title: 'Data minimization', paragraphs: ['PDFOmni tries to collect only what is needed to operate and improve the public site. The local tools do not require a user account, profile, or document history. A selected file is used by the browser for the task the user started. The site does not need to build a library of those documents in order to merge pages, edit content, or create an export.', 'Ordinary website logs and analytics should be used for traffic, reliability, compatibility, security, and product decisions, not to reconstruct the contents of a local document. When a technical problem can be investigated with a page path, browser type, error message, and harmless sample, private source material is not needed. Users are asked not to send sensitive files in support messages unless the information has been removed and the sample is safe to share.'] },
      { title: 'Downloads and file names', paragraphs: ['Files downloaded from a tool are handled by the browser and operating system. PDFOmni does not control how long a download remains on the device, whether it is copied into cloud-synced storage, or who else can open the downloads folder. Users should choose a safe destination, use clear but neutral filenames, and remove working copies when they are no longer needed.', 'A filename can reveal information even when the PDF itself is protected. Avoid names that expose a diagnosis, account number, legal dispute, or other private subject when the file will be attached to email or placed in shared storage. Password protection applies to the contents of the closed file, not to the name displayed beside it.'] },
      { title: 'External links and other services', paragraphs: ['PDFOmni pages can link to public websites, tool directories, documentation, advertisers, or other services. Following an external link leaves PDFOmni, and the destination applies its own privacy practices. A link does not give the other site access to a document currently open in a local tool, but the destination can receive normal visit information when it is opened.', 'Browser extensions, password managers, cloud backup software, and device security tools operate outside PDFOmni. They may have access based on the permissions the user gave them. People working with sensitive documents should review those permissions and use a device managed according to the rules of the school, employer, client, or organization responsible for the information.'] },
      { title: 'User choices and control', paragraphs: ['Users can leave a tool without exporting, clear site storage through the browser, block or manage cookies, avoid optional AI features, and use approved offline software instead. Some choices can affect convenience. Blocking storage may reset the theme or remove a saved local workflow, and blocking required public resources may prevent a tool from loading.', 'Local processing is meant to make the document path easier to understand, not to pressure someone into using a website for every file. A regulated record or workplace document may need an approved desktop program, managed device, or specific transfer system. Those requirements take priority over the convenience of a browser tool.'] },
      { title: 'Retention and privacy requests', paragraphs: ['PDFOmni does not keep an account-based archive of locally processed files. Hosting, analytics, advertising, security, email, and AI providers can retain the limited information they receive according to their own policies and legal duties. Retention periods can differ because these services have different purposes.', 'A privacy question should identify the page or service involved and the approximate date without including document contents. Requests can be sent to pdfomni@gmail.com. PDFOmni can explain its own setup and act on information it controls, but it cannot erase data held independently by a user\'s browser, email provider, device backup, or an external service outside its control.'] },
      { title: 'Contact and security limits', paragraphs: ['The contact page prepares an email in the user\'s email app. Messages sent to pdfomni@gmail.com may be kept long enough to answer the request and investigate a bug. Users should not attach private documents unless sensitive information has been removed.', 'Local processing reduces an unnecessary server copy, but it cannot protect a document from an unsafe device, malicious browser extension, or careless sharing. Highly sensitive or regulated files should be handled with the software and transfer process approved by the responsible organization.'] },
      { title: 'Children and policy changes', paragraphs: ['PDFOmni is a general document utility and is not directed to children under the age required for independent online consent in their location. The site does not knowingly ask children to create an account or submit personal information. A parent, guardian, or school should supervise use when required.', 'This policy can change when features, providers, or legal requirements change. The updated date on the visible page shows when it was revised. Material changes should be explained in clear language rather than hidden inside unrelated text.'] },
    ],
    faq: [],
  },
  {
    canonicalPath: '/terms',
    title: 'Terms of Service | PDFOmni',
    description: 'Read the PDFOmni terms for using private browser-based PDF tools, local processing, export workflows, and document tasks.',
    h1: 'PDFOmni Terms of Service',
    intro: 'These terms describe the basic rules for using PDFOmni tools, including responsibility for uploaded local files, exported documents, and review of final PDF output.',
    sections: [
      { title: 'Lawful use', paragraphs: ['PDFOmni provides browser tools for editing, organizing, converting, protecting, and preparing documents. Users may process only files they own or are allowed to handle, and they remain responsible for following laws, contracts, school rules, workplace policies, and submission requirements.', 'The site must not be used for fraud, harassment, unauthorized access, copyright infringement, malicious files, interference with the service, or removal of protection from a document the user has no right to open.'] },
      { title: 'Documents and ownership', paragraphs: ['Users keep responsibility for their documents. PDFOmni does not claim ownership of a file because it was opened in a local tool. Users must make sure that adding a signature, removing a page, changing text, or sharing an output does not violate another person\'s rights or misrepresent an official record.', 'Local processing does not grant PDFOmni a license to publish, sell, train on, or distribute the contents of a document. Users still need the rights and permissions required for the work they perform. If a document belongs to a school, employer, client, government office, or another person, their handling rules can limit which device, browser, storage location, or tool may be used.'] },
      { title: 'Keeping backups and working copies', paragraphs: ['Keep the untouched source until the final result has been accepted. Save changes under a new filename and avoid overwriting the only copy. A browser crash, device problem, incorrect setting, or unusual PDF structure can produce an incomplete result. PDFOmni is not a storage service and should not be treated as the only place where an important document exists.', 'Clear version names are part of responsible use. Names such as report-original, report-review, and report-submitted make it easier to identify the copy that was actually checked. Users working in a group should agree on who prepares the final file so two different versions are not shared as if both were current.'] },
      { title: 'Local processing and device requirements', paragraphs: ['Supported operations are designed to run on the user\'s device, but performance depends on the browser, available memory, processor, file size, page count, fonts, images, and document structure. The 500 MB per-file limit is an upper boundary for tool selection, not a guarantee that every file will process successfully on every device. Close other demanding apps when working with a large document.'] },
      { title: 'Reviewing exported files', paragraphs: ['PDFs can contain complicated fonts, forms, scans, links, annotations, signatures, permissions, and images. Open the downloaded result and check its page count, layout, readability, and required content before submitting, publishing, or sharing it. Redactions should be tested for recoverable information, compressed documents should be checked at a useful zoom, and accessibility checks should be followed by manual review.', 'A progress message or successful download only confirms that the browser completed a process and created a file. It does not confirm that an outside portal will accept the result or that every important detail survived. Compare the output with the source, test it in the program the recipient uses when possible, and follow any stated page size, file size, naming, signature, accessibility, or security rules.'] },
      { title: 'Security and signatures', paragraphs: ['A visual signature placed on a page is not automatically a certificate-based digital signature. Passwords and permission settings reduce access but do not guarantee control after an authorized recipient opens the document. Users must follow any signing or security method required for the transaction.'] },
      { title: 'Third-party services', paragraphs: ['Hosting, analytics, advertising, AI, and public libraries can be provided by third parties. Their availability and terms can affect related features. Optional AI use can send a message and selected context to an AI provider after the user chooses to ask a question.', 'Links to another website are provided for navigation or reference and do not make PDFOmni responsible for that site\'s content, availability, security, or privacy practices. Users should review the destination before uploading a document, entering personal information, or depending on an outside service for an important task.'] },
      { title: 'No professional advice', paragraphs: ['Guides and tool explanations are general educational information. They are not legal, tax, medical, security, or accessibility certification advice. Requirements can vary by country, organization, document type, and intended audience. Users should ask a qualified professional when a mistake could have serious consequences.'] },
      { title: 'Availability and changes', paragraphs: ['PDFOmni is provided as available and features can change or become temporarily unavailable. Browser updates and third-party libraries can also affect behavior. Users should not treat the site as the only storage location for an important document.', 'Features can be updated to improve privacy, security, compatibility, accessibility, or document quality. An older guide or screenshot may not match every later control. The current interface and these terms apply to present use. Material changes to document handling should also be reflected in the privacy information.'] },
      { title: 'Feedback and enforcement', paragraphs: ['Users may send bug reports and feature ideas. A suggestion does not create an employment, partnership, payment, confidentiality, or ownership agreement. PDFOmni may use general feedback to improve the site, while the sender keeps rights to original material they own. Do not include private documents, trade secrets, or information that cannot safely be used for testing.', 'Access can be limited when use harms the service, violates these terms, creates security risk, or prevents other people from using the site normally. Technical limits and protective measures must not be bypassed. A user who believes access was restricted by mistake can contact PDFOmni with the relevant page, date, browser, and a description of what happened.'] },
      { title: 'Disclaimer and limits', paragraphs: ['PDFOmni is provided as available without a promise that every output will be error-free or fit a particular purpose. To the extent allowed by applicable law, PDFOmni and its maintainer are not responsible for indirect loss caused by missing backups, an unreviewed export, use without permission, a forgotten password, a failed submission, or reliance on general guide content. Nothing in these terms removes rights that cannot legally be excluded.'] },
      { title: 'Contact', paragraphs: ['Questions about these terms can be sent through the contact page or directly to pdfomni@gmail.com.'] },
    ],
    faq: [],
  },
  {
    canonicalPath: '/contact',
    title: 'Contact PDFOmni',
    description: 'Contact PDFOmni about private PDF tools, browser-based document workflows, bugs, feature requests, and support questions.',
    h1: 'Contact PDFOmni',
    intro: 'Send PDFOmni a support question, bug report, or suggestion at pdfomni@gmail.com. The on-site form prepares a message in the user\'s own email app.',
    sections: [
      { title: 'Before sending a bug report', paragraphs: ['Include the tool name, browser, device, approximate file size, and the steps that led to the problem. A screenshot is useful for layout, editing, or export issues.', 'The contact form prepares a message in the user\'s email app. It does not upload a message or document to PDFOmni by itself. Users can also write directly to pdfomni@gmail.com.'] },
      { title: 'What makes a bug report useful', paragraphs: ['Start with the result you expected and the result you actually saw. Then list the actions in the order you took them. For example, explain that you opened Edit PDF, selected a text block, changed one character, exported the file, and found that the text moved in the downloaded copy. A short sequence like that is easier to reproduce than a general message saying the editor is broken. If the problem happens only after dragging, double-clicking, changing the theme, or using a particular setting, include that detail.', 'Mention whether the issue appears in the working preview, the downloaded file, or both. Those views can use different rendering paths, so the distinction matters. Include the browser name and version when possible, the operating system, whether the device is a phone or computer, and an approximate page count and file size. Private content is not needed to explain most technical problems.'] },
      { title: 'Sharing a safe test file', paragraphs: ['A small sample that reproduces the issue can be very helpful, but it should be safe to share. Remove names, addresses, account numbers, signatures, medical details, grades, client information, and anything else that should stay private. Covering information with a rectangle is not enough because the original text may still be present. Create a new sample from public or invented content when possible.', 'Before attaching a sample, reopen it in another reader and try searching or copying areas that were removed. Check the filename and document metadata too. If the bug only appears in a sensitive original and cannot be recreated safely, send screenshots of the interface and describe the document structure instead. A report can still explain that the page contains selectable text, an embedded font, a scanned image, a table, or a password without revealing actual information.'] },
      { title: 'Reporting conversion problems', paragraphs: ['For a conversion issue, say which source format and output format were involved. Point to the kind of content that changed, such as a wide table, equation, unusual font, transparent image, link, header, footer, or multi-column page. Explain which office or PDF program you used to open the result because Microsoft Word, LibreOffice, Google Docs, and different PDF readers can interpret the same file in slightly different ways.', 'Screenshots should show the source and result at a similar zoom when the problem is visual. If text is missing, mention whether it was selectable in the source. If page previews are duplicated or out of order, include the source page count and the count shown by the tool. These details help separate an extraction problem from a display problem and make the fix more likely to apply to other documents too.'] },
      { title: 'Reporting editing or export problems', paragraphs: ['Editing reports are most useful when they identify the exact action that changes the page. Say whether you clicked once, double-clicked, typed in the middle of a line, changed formatting, resized an image, or dragged an object. Note whether nearby text, borders, or background artwork changed in the canvas. Then explain what remained wrong after export, since temporary preview artifacts and permanent PDF changes need different fixes.', 'If the text appearance changes, include the original and displayed font size if the interface shows them. Mention symbols, spacing, alignment, and whether the text was part of a paragraph or several separate objects. A cropped screenshot around the problem is usually enough. Keep one screenshot from before the edit and one from afterward so the comparison does not depend on memory.'] },
      { title: 'Accessibility feedback', paragraphs: ['Accessibility reports are welcome even when the PDF operation itself works. Include the control name or page section, how you reached it, and what made it difficult to use. Keyboard users can mention an invisible focus indicator, an unexpected tab order, a dialog that does not close with Escape, or a control that cannot be reached. Screen reader users can include the announced name, role, or status message that was confusing.', 'Contrast, zoom, reduced motion, touch target size, and mobile reflow are also useful areas to report. If an issue depends on a browser accessibility setting or assistive technology, name that setup. The goal is to fix the underlying structure and behavior, not hide an automated warning, so a description of what the person was trying to accomplish is especially valuable.'] },
      { title: 'Feature requests', paragraphs: ['A helpful feature request begins with the document task, not only the name of a button. Explain what kind of file you start with, what has to change, and what the final result needs to do. Mention how often the task comes up and whether an existing PDFOmni tool solves part of it. This makes it easier to judge whether the idea belongs in a current workflow, needs a new tool, or depends on software that cannot reasonably run in the browser.', 'Privacy requirements matter too. If the feature would need a server, account, external API, licensed office program, or online AI provider, say what tradeoff would be acceptable for the use case. PDFOmni prefers local processing, and a feature should not quietly weaken that model just because a remote implementation is easier.'] },
      { title: 'What support can and cannot do', paragraphs: ['Support can investigate reproducible site bugs, clarify how a tool is intended to work, and consider improvements. It cannot recover a password that was never stored, restore a file deleted from a device, provide legal approval for a signature, certify accessibility compliance, or decide whether a document meets a school, tax, court, employer, or government rule. Important submissions should be checked against the instructions from the organization receiving them.', 'There are no PDFOmni user accounts for the local tools, so support will never need an account password or ask for payment details to release a download. Be cautious with messages that claim otherwise. The official contact address shown on this page is pdfomni@gmail.com.'] },
      { title: 'After sending the message', paragraphs: ['Keep the original document and any safe test file until the problem is understood. If you discover a shorter set of steps or notice that the issue depends on one browser, reply to the same email so the details stay together. Do not keep sending sensitive copies. A corrected public sample is better for repeated testing and can be used without exposing the document that first revealed the problem.'] },
    ],
    faq: [],
  },
  {
    canonicalPath: '/about',
    title: 'About PDFOmni | Student-Built Private PDF Tools',
    description: 'Learn about PDFOmni, a student-built private PDF toolkit focused on local browser processing, free tools, and practical document workflows.',
    h1: 'About PDFOmni',
    intro: 'PDFOmni is a student-built PDF toolkit for people who want useful document tools without handing every file to a server.',
    sections: [
      {
        title: 'Why the project exists',
        paragraphs: [
          'PDFOmni began as a college project after its student developer kept finding simple PDF tasks behind account walls, small upload limits, and tools that wanted a private document before explaining the workflow. Modern browsers can handle many of these jobs on the device, so the project started with tools the developer wanted to use personally.',
          'The project grew from page operations into editing, conversions, security tools, accessibility checks, and repeatable workflows. PDF files can contain embedded fonts, scans, forms, annotations, unusual images, and years of software-specific decisions. Working through those real edge cases guides the development work.',
        ],
      },
      {
        title: 'The local-processing mission',
        paragraphs: [
          'Supported PDF actions are designed to run inside the browser. The site still loads normal public resources, analytics, ads, and optional services over the internet, but it does not need a document-processing server for the local workflows. The Privacy Policy explains where those boundaries sit.',
          'The zero-knowledge goal is simple: an ordinary PDF task should not require PDFOmni to receive the source document. This reduces unnecessary copies, but it does not protect users from an unsafe device, an untrusted browser extension, or a file shared with the wrong recipient.',
          'Local processing also depends on the user\'s device. A large scan can work differently on an older phone and a modern laptop. The 500 MB limit is a clear upper boundary, not a claim that every complicated file behaves the same everywhere.',
        ],
      },
      {
        title: 'Who maintains PDFOmni',
        paragraphs: [
          'PDFOmni is maintained independently by a college student. The project improves through real bug reports, document testing, and direct work on export, font, image, mobile, accessibility, and workflow problems.',
          'The tools are free, and local actions do not have artificial daily limits. Advertising may help cover hosting and development costs, but it does not change the local document-processing design.',
          'Questions and bug reports can be sent to pdfomni@gmail.com. Include the tool, browser, device, file size, and steps that caused the problem, but do not send a private document unless sensitive content has been removed.',
        ],
      },
      {
        title: 'How new features are chosen',
        paragraphs: [
          'New tools usually start with a document problem that comes up more than once. A feature is worth adding when it saves real work, can be explained clearly, and fits the local-processing model. A long list of half-finished converters would not make the site more useful. Time is better spent on page ordering that stays correct, text editing that respects the original font, or a conversion that gives an honest result than on a button that only works on one perfect sample.',
          'Requests from users help decide what deserves attention, but they still have to be tested against different files and devices. PDFs made by Word, scanners, design programs, tax software, and old office systems can store similar-looking pages in completely different ways. A change that fixes one document can damage another if it assumes too much. Bug reports with clear steps are more useful than a promise to support every possible file immediately.',
        ],
      },
      {
        title: 'Testing real documents',
        paragraphs: [
          'Development involves more than checking whether a download button creates a file. For editing work, the canvas is compared with the exported PDF and checked for text position, spacing, images, symbols, and nearby page objects. For page tools, review includes the page count, order, orientation, and whether links or forms still work. For conversions, the result needs to be opened in the program a person would actually use and compared with difficult pages in the source.',
          'Accessibility and keyboard use are part of that review too. Upload controls need labels, dialogs need sensible focus, and progress or error messages should be understandable without relying only on color. Automated checks can catch missing names and broken structure, but they cannot decide whether a workflow makes sense to a person. The site still needs manual use on a small screen, with a keyboard, and with the browser accessibility tree in view.',
        ],
      },
      {
        title: 'Why the guides matter',
        paragraphs: [
          'A tool can perform an operation, but it cannot know why a person is changing the document. Compression settings depend on whether the file will be printed or viewed on a phone. Redaction depends on what the recipient is allowed to see. A signature image may be accepted for a class form and rejected for a legal process. The guides explain these choices so the site is not just a set of upload boxes with vague claims underneath.',
          'The writing aims to sound like a student explaining a process to another person who needs to finish the same job. It should be direct, specific, and easy to scan. Search engines are useful for helping people find a page, but repeating slightly different versions of the same phrase does not help someone understand a document. When a paragraph exists only to attract a query, it needs to be rewritten or removed.',
        ],
      },
      {
        title: 'Funding and independence',
        paragraphs: [
          'PDFOmni is not owned by another PDF brand, and it is not a front end for a competitor\'s conversion service. The project may show advertising to help pay for hosting, testing, and development. Ads and normal website analytics can make their own internet requests, which is why the privacy policy describes them separately from local document processing. They do not need access to the contents of a file selected for a supported local tool.',
          'Independence also means the project has limits. There is no large customer service team or guarantee that every unusual PDF will work perfectly. The useful response to that limit is not to hide it. It is to keep originals safe, explain what the browser is doing, review exports, publish practical guides, and improve the code when a reproducible problem shows where the workflow fails.',
          'That approach keeps the project useful without pretending that one browser can remove every document risk.',
        ],
      },
    ],
    faq: [],
  },
  {
    canonicalPath: '/404',
    title: 'Page Not Found | PDFOmni',
    description: 'The PDFOmni page you are looking for could not be found.',
    h1: 'Page Not Found',
    intro: 'That page does not exist, may have moved, or was typed incorrectly.',
    sections: [
      { title: 'Error 404', paragraphs: ['Return to the PDFOmni home page to choose from the full list of private PDF tools.'] },
    ],
    faq: [],
    robots: 'noindex,follow',
    writeRootHtml: true,
  },
  {
    canonicalPath: '/500',
    title: 'Server Error | PDFOmni',
    description: 'PDFOmni hit an unexpected error while loading this page.',
    h1: 'Something Went Wrong',
    intro: 'The page could not be loaded correctly.',
    sections: [
      { title: 'Error 500', paragraphs: ['Try refreshing the page or return to the home page. If the same tool keeps failing, use the contact page with the tool name, browser, file size, and steps that caused the problem.'] },
    ],
    faq: [],
    robots: 'noindex,follow',
    writeRootHtml: true,
  },
]

for (const page of routePages) {
  injectPage({
    ...page,
    bodyHtml: seoFallbackHtml(page),
    schema: structuredData(page),
  })
}

console.log(`Prerendered ${routePages.length} route HTML file(s) into ${outDir}.`)
