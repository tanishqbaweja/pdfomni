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
    ...(seo.searchLanguage?.length ? [{
      title: 'Understanding PDF to Word search terms',
      paragraphs: seo.searchLanguage,
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
        'Start from the clearest and most complete copy you have. Repeatedly converting or compressing an already processed PDF can lower image quality and make text harder to edit or extract. If the original came from Word, Excel, or another authoring program, keep that source because it is usually the easiest place to make large content changes.',
        'Use names that explain the document status, such as report-original.pdf, report-review.pdf, and report-submitted.pdf. Avoid overwriting the only copy or filling a folder with names like final2 and final-new. A clear name makes it easier to reopen the exact output you checked and prevents an older version from being sent by mistake.',
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
        paragraphs: ['Use these pages when you are ready to apply the ideas from the guide to a document.'],
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
      { title: 'Contact and security limits', paragraphs: ['The contact page prepares an email in the user\'s email app. Messages sent to pdfomni@gmail.com may be kept long enough to answer the request and investigate a bug. Users should not attach private documents unless sensitive information has been removed.', 'Local processing reduces an unnecessary server copy, but it cannot protect a document from an unsafe device, malicious browser extension, or careless sharing. Highly sensitive or regulated files should be handled with the software and transfer process approved by the responsible organization.'] },
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
      { title: 'Documents and exported output', paragraphs: ['Users keep responsibility for their documents. PDFOmni does not claim ownership of a file because it was opened in a local tool. Keep backups and save important changes as a new copy.', 'PDFs can contain complicated fonts, forms, scans, links, annotations, signatures, permissions, and images. Open the downloaded result and check its page count, layout, readability, and required content before submitting, publishing, or sharing it.'] },
      { title: 'Security and signatures', paragraphs: ['A visual signature placed on a page is not automatically a certificate-based digital signature. Passwords and permission settings reduce access but do not guarantee control after an authorized recipient opens the document. Users must follow any signing or security method required for the transaction.'] },
      { title: 'Third-party services', paragraphs: ['Hosting, analytics, advertising, AI, and public libraries can be provided by third parties. Their availability and terms can affect related features. Optional AI use can send a message and selected context to an AI provider after the user chooses to ask a question.'] },
      { title: 'Availability and limits', paragraphs: ['Tool performance depends on the browser, device memory, processor, file size, page count, and document structure. The 500 MB limit is an upper selection boundary, not a promise that every file will process on every device.', 'PDFOmni is provided as available and features can change or become temporarily unavailable. Users should not treat the site as the only storage location for an important document. General guides are educational information, not legal, tax, medical, security, or accessibility certification advice.'] },
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
      { title: 'What to include', paragraphs: ['When reporting an issue, include the tool name, browser, device, approximate file size, and the steps that led to the problem. A screenshot is useful for layout, editing, or export issues.', 'Do not send a private document unless sensitive information has been removed and the sample is safe to share. The form does not upload a message to PDFOmni by itself. It opens an email draft addressed to pdfomni@gmail.com.'] },
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
