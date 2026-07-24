import { toolGuides } from './toolGuides.js'

const editorialGuides = [
  {
    slug: 'why-client-side-pdf-processing-matters',
    title: 'Why Client-Side PDF Processing Matters for Document Privacy',
    description: 'Learn what client-side PDF processing means, what stays on your device, and when a local browser tool is a better choice than a cloud service.',
    published: '2026-07-22',
    readTime: '9 min read',
    intro: 'Most online PDF tools begin with the same step: upload the document. That feels normal because the upload box is simple, but it also means another company receives a copy before it can do anything useful. Client-side processing changes that setup. The browser opens and changes the file on your device, so the document does not need to travel to a processing server.',
    sections: [
      {
        title: 'What client-side processing actually means',
        paragraphs: [
          'A website still has to load code, fonts, and other public files from the internet. Client-side processing does not mean the whole website works without a network connection. It means the document operation itself happens in the browser after the app has loaded. For example, a merge tool can read two local PDFs, copy their pages into a new file in memory, and let you download the result. The source PDFs never need to become attachments in a request to the site owner.',
          'This distinction is easy to miss because both kinds of tools can look almost identical. A cloud tool and a local tool may each show a large drop area and a progress bar. The important question is what happens after you choose a file. Browser developer tools can help advanced users inspect network traffic, while a clear privacy policy should explain the behavior for everyone else. A trustworthy product should not make a broad privacy promise without describing its limits.',
        ],
      },
      {
        title: 'Why an upload creates another copy to protect',
        paragraphs: [
          'When a file is uploaded, it usually passes through several systems. It can move through a content delivery network, an application server, temporary storage, logging tools, and a download service. A responsible provider can secure each part and delete temporary files quickly, but the workflow still creates more places where the document may exist. That matters when the PDF contains tax records, identification, medical details, contracts, grades, or unpublished work.',
          'Local processing removes the server copy from the main document workflow. It does not solve every security problem. Malware on the device, an unsafe browser extension, a compromised computer, or careless sharing can still expose a file. It simply reduces the number of systems involved. Good security often comes from removing unnecessary steps instead of claiming that one feature makes a document perfectly safe.',
        ],
      },
      {
        title: 'Where local PDF tools work especially well',
        paragraphs: [
          'Many common PDF jobs are a good fit for browser processing. Merging pages, splitting a packet, rotating scans, adding page numbers, placing a watermark, extracting text, and protecting a file can all be done on a modern device. These tasks often involve private material but do not always require a server. You can use PDFOmni to <a href="/merge">merge PDFs</a>, <a href="/split">extract selected pages</a>, or <a href="/protect">add password protection</a> while keeping the document work in the tab.',
          'Local tools are also useful on slow or limited connections. A 300 MB scan may take a long time to upload even when the actual page change is simple. Processing it on the device avoids that transfer. The tradeoff is that the browser uses your own memory and processor. An older phone may struggle with a huge scan that a powerful server could handle easily, so local processing is a privacy choice with practical hardware limits.',
        ],
      },
      {
        title: 'When a cloud service can still make sense',
        paragraphs: [
          'Cloud processing is not automatically bad. A team may need shared storage, approval history, account controls, electronic signature certificates, or a server API that runs when nobody has a browser open. Some conversions also depend on licensed desktop software or large computing resources. In those cases, a reputable provider with a clear retention policy, security documentation, and an appropriate contract may be the right tool.',
          'The useful habit is to match the service to the document. A public event flyer has a different risk level from a tax return. A personal school assignment is different from a company file covered by a client agreement. Before uploading sensitive material, check who operates the service, how long files are retained, whether links are private, where data is processed, and whether the provider uses files for model training or product improvement.',
        ],
      },
      {
        title: 'How to check the privacy claim',
        paragraphs: [
          'Start with the privacy policy, but do not stop at slogans such as military-grade or zero knowledge. Look for direct statements about document bytes, temporary storage, analytics, and optional features. A site may process PDFs locally while sending a question to an AI provider when you choose to use chat. That can still be a reasonable design if the boundary is explained and the optional action is clear.',
          'You can also test a tool with a harmless sample file. Open the browser network panel, clear the existing requests, choose the sample, and complete the operation. Large outgoing requests after file selection deserve attention. This test is not perfect because compressed or encrypted traffic is hard to interpret, but it can confirm whether the entire document appears to be uploaded. For very sensitive work, use an offline application on a trusted device and follow the rules of the organization that owns the file.',
        ],
      },
      {
        title: 'A practical privacy checklist',
        paragraphs: [
          'Before working on a private PDF, make a backup and decide whether the task truly needs an online account. Remove pages that are not required, redact information that the recipient should not receive, and review the exported copy before sharing it. Use a strong, separate password when protection is appropriate, then send that password through a different channel from the document.',
          'Client-side processing is useful because it gives the user a simpler data path. The file starts on the device, the browser performs the supported action, and the result returns to the device. It is not a magic shield, but it is a sensible default for everyday document jobs. The fewer unnecessary copies we create, the fewer copies we have to trust someone else to protect.',
        ],
      },
    ],
    related: [
      { href: '/privacy', label: 'Read PDFOmni privacy details' },
      { href: '/merge', label: 'Merge PDFs locally' },
      { href: '/protect', label: 'Protect a PDF with a password' },
    ],
  },
  {
    slug: 'risks-of-uploading-sensitive-pdfs-to-the-cloud',
    title: 'The Risks of Uploading Sensitive PDFs to the Cloud',
    description: 'A practical guide to PDF upload risks, retention policies, sharing links, metadata, and safer ways to handle confidential documents.',
    published: '2026-07-22',
    readTime: '10 min read',
    intro: 'PDFs often look like ordinary files, but they can contain a surprising amount of private information. A single document may include account numbers, signatures, addresses, revision history, hidden attachments, or metadata about the person who created it. Uploading that PDF to an unknown service adds a new party to the chain of people and systems that must keep it safe.',
    sections: [
      {
        title: 'The file may contain more than the visible page',
        paragraphs: [
          'People usually judge a PDF by what appears when it opens. The format can also hold form values, comments, layers, embedded files, links, document properties, and text hidden behind other objects. A black rectangle placed over a name may only cover it visually. If the original text remains underneath, another person may be able to select, search, or extract it. That is why proper <a href="/redact">PDF redaction</a> is different from drawing over a sentence.',
          'Metadata creates another source of exposure. Author names, software versions, dates, titles, and organization fields can survive an export. None of this means every PDF is dangerous. It means that a confidential file deserves a quick inspection before it is uploaded or shared. Open document properties, check comments and attachments, and use a copy rather than experimenting on the only version you have.',
        ],
      },
      {
        title: 'Temporary storage is still storage',
        paragraphs: [
          'Many cloud tools say that files are deleted after an hour or after processing. That is better than indefinite storage, but it still creates a period when the provider has the document. Backups, error logs, security scans, and distributed storage can make deletion more complicated than removing one visible record. A serious provider should explain retention clearly instead of relying on a vague promise that files are deleted soon.',
          'The risk is not limited to a dishonest operator. A well-run company can have a software bug, a misconfigured storage bucket, a stolen employee account, or a third-party incident. Security teams work hard to prevent these events, but no connected system has zero risk. If the job can be completed without an upload, avoiding the extra copy is often the easiest way to reduce exposure.',
        ],
      },
      {
        title: 'Public and guessable sharing links',
        paragraphs: [
          'Some services return a link that anyone can open. The address may be long and difficult to guess, but that is not the same as access control. Links can appear in browser history, chat previews, analytics logs, email scanners, and copied messages. A recipient can also forward the link. For documents that matter, use a service with authentication, expiration, and the ability to revoke access.',
          'Email attachments have similar problems. Once sent, the file can be downloaded and copied. Password protection can reduce casual access, but a weak password or a password sent in the same email offers little help. When possible, share the password through a phone call or a separate message. Confirm that the recipient has the correct file before removing your own secure copy.',
        ],
      },
      {
        title: 'Work, school, legal, and health documents need extra care',
        paragraphs: [
          'An employee may not have permission to upload internal records to a consumer PDF site, even if the tool appears secure. Client contracts, school systems, health records, and government forms can be covered by policies or laws that require approved services. Personal convenience does not override those rules. When a document belongs to an organization, check its approved software list or ask the person responsible for data protection.',
          'Students and freelancers face a similar issue with other people\'s information. A class research file can contain participant details, and a client packet can include addresses or financial data. The person holding the PDF has a responsibility to handle it carefully. A local tool can be a useful option, but the device itself must also be trusted, updated, and protected with a screen lock.',
        ],
      },
      {
        title: 'Safer ways to complete common PDF jobs',
        paragraphs: [
          'Use a browser tool that performs supported work locally, or use a reputable offline desktop application. PDFOmni can <a href="/split">split out only the pages you need</a>, <a href="/compress">compress a large attachment</a>, and <a href="/sign">place a visual signature</a> without sending the source through a PDF processing server. Keeping fewer pages can also reduce accidental disclosure when the recipient only needs one section.',
          'Always review the result. Check every redaction, make sure the correct pages are present, search for text that should have been removed, and reopen password-protected files before sending them. If an official submission portal requires an upload, that portal is part of the necessary workflow. The goal is not to avoid the internet at all costs. It is to avoid unrelated copies and choose the service deliberately.',
        ],
      },
      {
        title: 'Questions to ask before uploading',
        paragraphs: [
          'Find the company name and contact information. Read how document files are used, where they are stored, and when they are deleted. Check whether the service trains AI models on uploaded content, whether employees can access files for support, and whether third parties take part in processing. A clear answer is more valuable than a page full of security badges with no explanation.',
          'Finally, consider the consequence of exposure. If the file became public tomorrow, would it cause embarrassment, financial harm, identity theft, a contract problem, or a policy violation? The more serious the result, the stronger the reason to use an approved offline or local workflow. Privacy is not about being afraid of every website. It is about giving sensitive information only to the systems that genuinely need it.',
        ],
      },
    ],
    related: [
      { href: '/redact', label: 'Redact sensitive PDF content' },
      { href: '/split', label: 'Share only selected pages' },
      { href: '/guides/why-client-side-pdf-processing-matters', label: 'Understand client-side processing' },
    ],
  },
  {
    slug: 'make-pdfs-wcag-accessible',
    title: 'How to Make a PDF More Accessible for WCAG',
    description: 'Learn how headings, reading order, alt text, contrast, links, tables, forms, and testing can make a PDF easier to use with assistive technology.',
    published: '2026-07-22',
    readTime: '11 min read',
    intro: 'An accessible PDF should work for readers who use screen readers, keyboard navigation, zoom, high contrast settings, or other assistive technology. A document can look polished and still be confusing when its reading order is wrong or its headings are only large bold text. Accessibility begins in the source document and continues through export and testing.',
    sections: [
      {
        title: 'Start with the source file when possible',
        paragraphs: [
          'The easiest place to build accessibility is usually Word, Google Docs, InDesign, or the program that created the PDF. Use real heading styles instead of changing the font size by hand. Mark lists as lists, give tables clear headers, add useful alternative text to meaningful images, and write link text that makes sense outside the surrounding sentence. These choices can become tags when the file is exported correctly.',
          'Fixing a finished PDF is possible, but it can take much longer. A PDF editor may need to rebuild the tag tree, set the document language, correct reading order, and connect form labels manually. If the source is available, repair it there and export again. Keep the accessible source so future updates do not repeat the same cleanup work.',
        ],
      },
      {
        title: 'Use a clear structure and reading order',
        paragraphs: [
          'Screen readers follow the tag structure rather than guessing from visual position. A two-column page may be read across both columns if its order is not defined. Headers, footers, side notes, and page numbers can interrupt the main text. Check that each heading is followed by the correct paragraph and that columns are read from top to bottom in the intended sequence.',
          'Heading levels should describe the outline. The document title is normally the top level, major sections follow beneath it, and subsections sit under their parent sections. Do not choose a heading level because of how it looks. Style controls appearance, while structure tells assistive technology how ideas are related. A logical outline also helps every reader scan a long report.',
        ],
      },
      {
        title: 'Write useful alt text and handle complex figures',
        paragraphs: [
          'Alternative text should explain the purpose of an image in context. A decorative border can be marked as decorative, while a chart needs a short statement about its main point. Repeating the caption word for word is rarely helpful. If a diagram carries a lot of information, provide a longer explanation in the surrounding text or an appendix instead of forcing an entire analysis into one alt text field.',
          'Charts should not depend on color alone. Use labels, patterns, or different line styles so the series can still be distinguished. Make sure text inside figures is large enough when the page is viewed at normal size. If a scanned chart has blurry labels, replace it with a clearer source image when possible. The accessible version should communicate the same conclusion as the visual version.',
        ],
      },
      {
        title: 'Check contrast, zoom, links, and keyboard use',
        paragraphs: [
          'Normal text needs enough contrast against its background. Pale gray text, text over photographs, and color-coded warnings are common problems. Readers should be able to zoom without losing important content or encountering text that becomes impossible to follow. Large pages and fixed-width tables may require extra thought, especially on a small screen.',
          'Links need descriptive names such as download the annual report instead of click here. Keyboard users should be able to reach links and form fields in a sensible order, with a visible focus indicator in the viewing application. Avoid using a bare web address as the only description when a human-readable title would be clearer. Check that links actually work after export.',
        ],
      },
      {
        title: 'Make tables and forms understandable',
        paragraphs: [
          'Simple tables are easier to navigate than layouts with merged cells, blank spacing columns, or several header levels. Mark the header row and keep the relationship between each header and data cell clear. If a table becomes too complex, consider splitting it into smaller tables or describing the important information in text. Do not use a table just to position content on the page.',
          'Every form field needs a programmatic label, a useful name, and a logical tab order. Required fields and validation errors should not rely on color alone. Instructions should appear before the field that needs them. Test checkboxes, radio buttons, text inputs, and submit actions with only a keyboard. A form that looks correct but cannot be completed without a mouse is not accessible.',
        ],
      },
      {
        title: 'Run automated checks, then test manually',
        paragraphs: [
          'An automated checker can find missing titles, language settings, untagged content, and some structural problems. PDFOmni includes a local <a href="/wcag-check">PDF accessibility checker</a> that can help with an initial review. Automated results are a starting point, not a compliance certificate. A tool cannot always decide whether alt text is meaningful or whether the reading order makes sense.',
          'Finish with manual testing. Navigate by headings, read the document with a screen reader, use only a keyboard, inspect it at high zoom, and check important pages in more than one reader. Ask a person who uses assistive technology when the document has a public or high-impact purpose. Record what was tested and keep the source file. Accessibility is a publishing habit, not a button pressed at the end.',
        ],
      },
    ],
    related: [
      { href: '/wcag-check', label: 'Check a PDF for accessibility issues' },
      { href: '/edit-pdf', label: 'Edit PDF content locally' },
      { href: '/pdf-to-text', label: 'Check extracted text' },
    ],
  },
  {
    slug: 'organize-tax-documents-into-one-pdf',
    title: 'How to Organize Tax Documents Into One PDF',
    description: 'A simple workflow for naming, sorting, merging, checking, protecting, and archiving tax documents without creating a confusing packet.',
    published: '2026-07-22',
    readTime: '9 min read',
    intro: 'Tax documents arrive from employers, banks, payment apps, schools, and government offices. Some are PDFs, while others are scans or phone photos. Combining them can make review easier, but a single large file is only helpful when its pages are named, ordered, checked, and protected with care. A clear packet also saves the recipient from guessing where one record ends and the next begins.',
    sections: [
      {
        title: 'Make a working folder and keep the originals',
        paragraphs: [
          'Create a folder for the tax year and place copies of the original files inside it. Keep another folder called working copies for files you rename, rotate, or combine. This small separation makes it much harder to overwrite the only copy of an important form. Back up the original folder to an encrypted drive or another storage location you trust.',
          'Use names that sort naturally, such as 01-W2-Employer.pdf, 02-1099-Bank.pdf, and 03-Tuition-Statement.pdf. Include the year when the parent folder does not already make it obvious. Avoid names like scan1-final-new.pdf because they become confusing after a few weeks. A clear name should tell you what the file is without opening it.',
        ],
      },
      {
        title: 'Convert photos and clean up scans',
        paragraphs: [
          'If a form only exists as a photo, make sure the entire page is visible, the text is sharp, and no shadow covers a number. Convert related images with the <a href="/image-to-pdf">image to PDF tool</a>. Rotate pages that were scanned sideways and crop large empty borders only when the crop will not remove notes, identifiers, or page numbers.',
          'Do not compress the working copies too aggressively. Small financial text must remain readable, and a tax preparer may need to zoom in. Compression is useful after the packet is complete, but compare the output with the source at 200 percent zoom. If account numbers or totals become fuzzy, choose a higher-quality setting.',
        ],
      },
      {
        title: 'Choose an order that another person can follow',
        paragraphs: [
          'A practical packet often begins with an index or short cover sheet, followed by income forms, interest and investment forms, deductions, education records, health coverage, and supporting receipts. The exact order depends on the return and the person reviewing it. Ask an accountant whether they prefer a specific sequence before spending time on a complicated system.',
          'Within each group, put the primary form before its supporting pages. Keep multi-page statements together. If a document has instructions that are not needed, save them separately instead of silently deleting them from the original. The working packet should contain what the reviewer needs, while the archive should preserve the complete source records.',
        ],
      },
      {
        title: 'Merge and review the full packet',
        paragraphs: [
          'Add the working copies to the <a href="/merge">Merge PDF tool</a> in the intended order. After the merge, use <a href="/reorder">Reorder PDF</a> if a page landed in the wrong place. Page thumbnails are helpful, but they are too small for a final check. Open the exported file and move through every page at a readable zoom.',
          'Check that no form is missing its second page, no scan is upside down, and no page belongs to the wrong year. Search for the names of major forms when the PDF has selectable text. Compare the page count with the files in the working folder. A merged packet should make review easier, not hide gaps inside a long document.',
        ],
      },
      {
        title: 'Share only what the recipient needs',
        paragraphs: [
          'Tax records contain information that can be used for identity theft. Confirm the recipient and their preferred secure method before sending anything. Ordinary email may not be the right choice. A professional tax portal or encrypted transfer system can offer access controls and an audit trail. Follow the instructions of the accountant or agency receiving the documents.',
          'If you must share a smaller section, use <a href="/split">Split PDF</a> to create a separate file instead of sending the entire archive. Review the smaller file from beginning to end. Password protection can add a layer of access control, but send the password through a different channel and use a long password that is not reused elsewhere.',
        ],
      },
      {
        title: 'Archive the final version safely',
        paragraphs: [
          'Save the final packet with the tax year and a clear status such as submitted or accountant-copy. Keep submission confirmations and the final filed return beside the supporting documents. Do not rely on a download link that may expire. Make at least one backup and protect the storage account with a strong password and multi-factor authentication.',
          'When the retention period for a document ends, delete copies in old download folders, email attachments, and temporary working locations according to the advice that applies in your country. Organizing tax PDFs is mostly a matter of careful habits. Clear names, preserved originals, a sensible order, and a full review do more good than an elaborate folder system nobody remembers how to use.',
        ],
      },
    ],
    related: [
      { href: '/merge', label: 'Merge tax documents' },
      { href: '/reorder', label: 'Put pages in the right order' },
      { href: '/protect', label: 'Password-protect the final packet' },
    ],
  },
  {
    slug: 'compress-pdf-without-ruining-quality',
    title: 'How to Compress a PDF Without Ruining Its Quality',
    description: 'Understand what makes PDFs large and how to reduce file size while keeping text, images, signatures, and small details readable.',
    published: '2026-07-22',
    readTime: '9 min read',
    intro: 'A large PDF is usually large for a reason. It may contain high-resolution scans, repeated images, embedded fonts, or pages exported with settings meant for professional printing. Good compression removes waste and lowers image detail only as much as the final use allows. The goal is not the smallest possible file. The goal is a file that fits the limit and still works.',
    sections: [
      {
        title: 'Find out what is making the file large',
        paragraphs: [
          'A 100-page text report can be smaller than a five-page scan because selectable text takes little space compared with photographs. Open the document and check whether you can select its words. If every page behaves like one large image, scanning is probably the main source of size. Full-page color scans at 600 dots per inch can become enormous even when the paper is mostly black text.',
          'Other causes include a high-resolution logo repeated on every page, several versions of an embedded font, hidden editing data, and images saved in a format that does not suit their content. Before changing anything, note the current file size and page count. Keep the original so you can compare the result and try a different setting without losing quality.',
        ],
      },
      {
        title: 'Match the quality to the way the PDF will be used',
        paragraphs: [
          'A document meant for phone screens and email does not need the same image resolution as a poster going to a print shop. For ordinary office pages, moderate image resolution is often enough. Small diagrams, fine handwriting, maps, engineering drawings, and photo portfolios need more detail. Accessibility also matters because some readers depend on high zoom.',
          'Start with a balanced preset in the <a href="/compress">PDF compressor</a> rather than the strongest option. If a portal has a firm limit, aim slightly below it so a later signature or form value does not push the file over. Compression results vary because two PDFs with the same starting size may contain completely different kinds of data.',
        ],
      },
      {
        title: 'Protect small text and important details',
        paragraphs: [
          'After compression, inspect the hardest pages instead of only the cover. Zoom in on small print, account numbers, footnotes, signatures, barcodes, and thin chart lines. Look for blocky letters, halos around text, color bands, or numbers that become hard to distinguish. A file that opens successfully can still be unsuitable for its purpose.',
          'Compare the same page in the original and compressed copies at the same zoom. If the PDF contains a QR code or barcode, test it with the intended scanner. If it contains a signature, check the edges and any legal text nearby. Raise the quality and try again when a detail becomes uncertain. A few extra megabytes are better than an unreadable submission.',
        ],
      },
      {
        title: 'Use grayscale only when color has no meaning',
        paragraphs: [
          'Converting color scans to grayscale can save space, but it may also remove information. Colored annotations, chart series, warning labels, stamps, and highlighted answers can become ambiguous. Black-and-white conversion is even more aggressive and can erase pencil marks or light printing. Make the choice page by page when the document mixes ordinary text with material that depends on color.',
          'For a scanned form with black text on white paper, grayscale is often reasonable. For photographs or design work, preserve color and reduce dimensions more carefully. If a recipient has provided technical requirements, follow those instead of guessing. Government and school portals sometimes specify resolution, color mode, or accepted file types.',
        ],
      },
      {
        title: 'Remove pages before lowering quality',
        paragraphs: [
          'The cleanest byte is the one you do not need to send. Check for blank scanner pages, duplicate attachments, unused instructions, and cover sheets the recipient did not request. Use <a href="/split">Split PDF</a> to create a submission copy containing only the required pages. Keep the complete original in your archive.',
          'You can also split a very large packet into named sections if the receiving system accepts several files. This may preserve more detail than crushing the whole packet into one small limit. Use page ranges that keep related pages together, and name each output clearly so the recipient knows the intended order.',
        ],
      },
      {
        title: 'Review the final file like a recipient',
        paragraphs: [
          'Close the app, reopen the exported PDF, and move through it from start to finish. Confirm the page count, orientation, text search, links, form values, and signatures. Try another PDF reader when the document is important because rendering can vary. A local preview is useful, but the downloaded file is the result that matters.',
          'Compression is a tradeoff, not a score where smaller always wins. The best result meets the upload or storage requirement, opens reliably, and keeps every necessary detail readable. Save the compressed copy with a new name, keep the source, and write down the setting when you expect to process similar files again.',
        ],
      },
    ],
    related: [
      { href: '/compress', label: 'Compress a PDF locally' },
      { href: '/split', label: 'Remove unneeded pages' },
      { href: '/pdf-to-image', label: 'Inspect pages as images' },
    ],
  },
  {
    slug: 'redact-a-pdf-safely',
    title: 'How to Redact a PDF Without Leaving the Text Behind',
    description: 'Learn the difference between covering and removing PDF content, then follow a practical process for checking redactions before sharing a file.',
    published: '2026-07-22',
    readTime: '10 min read',
    intro: 'A redaction is supposed to remove information, not just make it hard to see. Drawing a black box over a name can look convincing while the original text remains searchable underneath. Safe redaction requires the content to be removed from the shared copy and the final file to be tested as if someone were trying to recover it.',
    sections: [
      {
        title: 'Why a black rectangle is not enough',
        paragraphs: [
          'PDF pages are built from separate objects. Text, images, lines, comments, and shapes can sit on top of one another. Adding a rectangle usually creates one more object without changing the text below it. A recipient may be able to drag across the covered area, copy the text, remove the rectangle in an editor, search for the hidden phrase, or extract all text with another program.',
          'Changing the text color to white has the same weakness, and blurring can leave enough visual information for a person or image tool to make a good guess. Cropping a page may only change the visible boundary while objects remain in the file. Real redaction removes the selected content from the output and replaces the visible area in a way that does not preserve the secret underneath.',
        ],
      },
      {
        title: 'Work on a copy and decide exactly what must go',
        paragraphs: [
          'Keep the original in a secure location and create a clearly named redaction copy. Make a list of names, addresses, numbers, signatures, photographs, and repeated headers that must be removed. Search the document for each item when the text is selectable. Manual page review is still necessary because scans, spelling differences, and text stored as outlines may not appear in search results.',
          'Consider indirect clues too. Removing a person\'s name may not protect them if a job title, email address, or unique event still identifies them. The correct scope depends on why the file is being shared and which rules apply. For legal, medical, government, or public-record work, follow the organization\'s redaction policy and have another qualified person review the result.',
        ],
      },
      {
        title: 'Apply redactions with a tool built for removal',
        paragraphs: [
          'Use the <a href="/redact">PDF redaction tool</a> to mark the full area that contains sensitive material. Include the entire word or image and allow a small margin so no edge remains visible. Be careful near table borders, nearby labels, and content in another column. A redaction should remove only what is required while leaving the surrounding document understandable.',
          'Apply the redactions and export a new file. Do not assume that placing the marks completes the job, because some applications have a separate apply step. Avoid printing and rescanning unless there is no better method. That approach can reduce accessibility, make all text unsearchable, lower quality, and still leave visual clues if the cover was incomplete.',
        ],
      },
      {
        title: 'Check text, images, comments, and hidden data',
        paragraphs: [
          'Open the exported file in a different reader. Search for every removed word and part of every number. Try to select and copy text across each covered area, then paste the result into a plain text editor. Use <a href="/pdf-to-text">PDF to Text</a> on the final copy and inspect the output. If a removed value appears anywhere, the file is not ready to share.',
          'Inspect comments, form fields, attachments, bookmarks, layers, and document properties. A name removed from the page may still appear in an annotation author field or attachment name. Images require special attention because text inside a scanned page will not appear in ordinary text search. Zoom in on every image redaction and consider OCR as another check, not as the only check.',
        ],
      },
      {
        title: 'Avoid revealing information through the filename or message',
        paragraphs: [
          'A well-redacted document can still be paired with a revealing filename such as Patient-Jane-Doe-Complaint.pdf. Rename the shared copy with a neutral, useful title. Check the email subject, message body, cloud folder name, and link preview too. Privacy includes the context around the file, not only the pixels on its pages.',
          'Share the smallest document that meets the purpose. If the recipient only needs three pages, use <a href="/split">Split PDF</a> instead of sending the entire packet. This reduces the chance of an overlooked detail on an unrelated page. Confirm the recipient and use an approved transfer method when the material is sensitive.',
        ],
      },
      {
        title: 'Use a two-person review for important files',
        paragraphs: [
          'The person who made a redaction already knows what should be hidden, which makes it easy to see what they expect instead of what is actually present. A second reviewer can approach the file like a recipient. Give that person the list of information that must be removed and ask them to search, copy, zoom, and inspect metadata independently.',
          'Keep a record of the final review when the document has legal or public consequences. Record the filename, date, redaction tool, checks performed, and reviewer. Do not store the review copy beside a public folder by accident. A safe redaction process is careful and slightly repetitive because one missed value can defeat the point of all the others.',
        ],
      },
      {
        title: 'Final redaction checklist',
        paragraphs: [
          'Before sending, confirm that you worked from a copy, applied every marked redaction, searched for removed terms, tested copy and paste, extracted the final text, checked image areas, removed comments and attachments that should not be shared, reviewed document properties, changed revealing filenames, and reopened the exact file that will be sent.',
          'No single automated test can understand every privacy requirement. The strongest process combines a proper removal tool, several recovery attempts, and a second human review. Slow down for the final five minutes. The exported copy, not the editing preview, is the document the other person will receive.',
        ],
      },
    ],
    related: [
      { href: '/redact', label: 'Redact a PDF locally' },
      { href: '/pdf-to-text', label: 'Test the final text layer' },
      { href: '/split', label: 'Share only the needed pages' },
    ],
  },
  {
    slug: 'merge-and-reorder-pdf-pages',
    title: 'How to Merge and Reorder PDF Pages Into a Clean Packet',
    description: 'Build a clear PDF packet by planning the order, naming source files, merging them, fixing page sequence, and checking the exported result.',
    published: '2026-07-22',
    readTime: '9 min read',
    intro: 'Merging PDFs is easy until the result contains two cover pages, an upside-down scan, missing attachments, and page numbers that restart halfway through. A clean packet needs a simple plan before the files are combined and a careful review afterward. The merge button is only one part of the job.',
    sections: [
      {
        title: 'Plan the packet for the person reading it',
        paragraphs: [
          'Write down the intended order before opening a tool. A client packet might begin with a cover letter, continue with the main agreement, include supporting records, and end with signature pages. A class submission may need a title page, report, references, and appendix. The best order is the one that lets the recipient understand the file without hunting for context.',
          'Check submission instructions for required names, page limits, and separate attachments. Some portals want one PDF, while others require the form and evidence as different files. Do not merge simply because you can. Combine documents when they belong together and keep unrelated records separate so they can be updated or shared independently.',
        ],
      },
      {
        title: 'Prepare and name the source files',
        paragraphs: [
          'Create working copies and give them numbered names such as 01-cover.pdf, 02-report.pdf, and 03-appendix.pdf. Numbered names make file selection and troubleshooting easier. Open each source and confirm its page count, orientation, and content. Remove accidental blank scans, but keep intentional blank pages used for double-sided printing.',
          'Convert photographs or office files before the merge so every source is a PDF. Use <a href="/image-to-pdf">Image to PDF</a> for scans and photos. If a source already contains its own page numbers, decide whether those numbers still make sense inside the final packet. A later page-numbering step may be clearer than showing several competing numbering systems.',
        ],
      },
      {
        title: 'Merge in a deliberate order',
        paragraphs: [
          'Add the files to <a href="/merge">Merge PDF</a> and arrange them according to the plan. Check the first and last thumbnail of each source when possible. Files with similar names are easy to swap. Export to a new filename that describes the complete packet and includes a date or version only when that information will help the reader.',
          'Merging normally copies pages rather than rebuilding their contents, so visual quality should remain close to the source. The file size may be roughly the total of all source files. If the result is too large, finish the order first and compress a copy afterward. That way, compression settings are applied consistently across the packet.',
        ],
      },
      {
        title: 'Fix individual pages after the merge',
        paragraphs: [
          'Use <a href="/reorder">Reorder PDF</a> when a signature page needs to move, a scanner saved the back side first, or an appendix landed in the wrong section. Move pages in small groups and pause after each change. It is easier to catch one mistaken move than to remember a long sequence of thumbnail changes.',
          'Rotate sideways pages and inspect mixed orientations. A landscape chart can be intentional, while a portrait form scanned sideways is not. Check page pairs around every moved section to make sure a paragraph or multi-page form was not separated from its continuation. Reordering should improve the reading path without breaking source documents into confusing pieces.',
        ],
      },
      {
        title: 'Add navigation for a longer document',
        paragraphs: [
          'For a packet that will be printed or discussed in a meeting, add continuous page numbers with <a href="/page-numbers">Add Page Numbers</a>. Keep them away from existing footers and signatures. If the original documents use internal page numbers, label the new number as the packet page in a cover note so references remain clear.',
          'A short contents page can help when the packet contains several named sections. Bookmarks are even better in a reader that supports them, but do not rely on bookmarks alone because printed copies will not show them. Use descriptive section titles and keep the visual design simple. Navigation should help the reader, not add another layer of decoration.',
        ],
      },
      {
        title: 'Perform a page-by-page export check',
        paragraphs: [
          'Reopen the exported PDF and verify the total page count. Compare it with the sum of the prepared sources, adjusted for pages you intentionally removed. Move through every page, paying special attention to boundaries between files. Check that forms, links, annotations, signatures, and selectable text still behave as expected.',
          'Look at the packet on a small screen if it will be read on a phone. Very wide pages or tiny scans may be technically present but difficult to use. Open the file in a second reader when it supports an important submission. Keep the original sources and the final packet so one incorrect page can be replaced later without rebuilding everything from memory.',
        ],
      },
      {
        title: 'Keep versions understandable',
        paragraphs: [
          'Use names such as Project-Packet-review.pdf and Project-Packet-submitted.pdf instead of final-final-2.pdf. If several people are involved, agree on who owns the current version and where it is stored. Do not edit separate copies in parallel unless you also have a clear way to reconcile them.',
          'A good packet feels uneventful to read. Pages appear in the expected place, labels make sense, and nothing calls attention to the assembly process. A few minutes spent planning names and order can save much more time than repairing a confusing merge after it has already been sent.',
        ],
      },
    ],
    related: [
      { href: '/merge', label: 'Merge PDF files' },
      { href: '/reorder', label: 'Reorder PDF pages' },
      { href: '/page-numbers', label: 'Add continuous page numbers' },
    ],
  },
  {
    slug: 'work-with-scanned-pdfs-and-ocr',
    title: 'How to Work With Scanned PDFs and OCR',
    description: 'Learn why scanned PDFs behave like images, how OCR creates searchable text, and how to improve scan quality before extracting or editing content.',
    published: '2026-07-22',
    readTime: '10 min read',
    intro: 'A scanned PDF may look like a normal document while every page is really a photograph. You cannot select a sentence because there is no sentence stored as text. Optical character recognition, usually called OCR, analyzes the image and guesses the letters. It can make a scan searchable, but the result still needs review.',
    sections: [
      {
        title: 'Tell the difference between text and a page image',
        paragraphs: [
          'Try to select a single word. If the reader selects the whole page or nothing at all, the page is probably an image. Search for a word that is clearly visible. A failed search is another clue, though some scans contain an invisible OCR layer that is inaccurate. Zoom in closely and look for small image pixels around the letters.',
          'A PDF can also be mixed. A cover page may contain selectable text while the attachments are scans. Check several pages before deciding how to process the file. Text extraction tools work with stored characters, while OCR is needed for image-only areas. Knowing the page type prevents confusion when one section extracts perfectly and another produces no words.',
        ],
      },
      {
        title: 'Improve the image before running OCR',
        paragraphs: [
          'OCR works best with straight pages, even lighting, strong contrast, and enough resolution to distinguish similar characters. Rotate sideways pages, crop scanner borders without cutting text, and replace blurry phone photos when the paper is still available. Flatten curled pages and avoid shadows from hands or bindings.',
          'More resolution is not always better. Extremely large images use more memory and time, while low-resolution images lose detail. Around 300 dots per inch is a common starting point for ordinary printed text. Small type, faded copies, or unusual scripts may need more. Preserve the original scan before applying aggressive cleanup so you can try again.',
        ],
      },
      {
        title: 'Choose the correct language and layout',
        paragraphs: [
          'An OCR engine uses language patterns to decide between characters that look alike. Choose the language or languages found in the document. A page with English, Greek symbols, and equations may still need manual correction because mathematical notation is not ordinary prose. Handwriting is also much harder than clear printed text.',
          'Columns, tables, forms, footnotes, and text wrapped around images can confuse reading order. If the tool offers layout settings, pick the closest match. It can be better to process difficult sections separately than to use one setting for the whole file. Preserve the visual page so a reader can compare any uncertain text with the scan.',
        ],
      },
      {
        title: 'Review the errors OCR commonly makes',
        paragraphs: [
          'Watch for zero and the letter O, one and lowercase l, rn and m, missing punctuation, broken words at line endings, and numbers with misplaced decimal points. Names, account numbers, citations, and technical terms deserve special attention because a language model cannot reliably infer them from context. One incorrect digit can matter more than a misspelled paragraph.',
          'Use search to check repeated headings and important terms. Read totals and dates against the image. For a document that will be quoted or used as evidence, proofread the relevant passage character by character. OCR confidence scores can help direct attention, but a high score is not proof that the recognized word is correct.',
        ],
      },
      {
        title: 'Extract text without losing the source',
        paragraphs: [
          'After OCR, use <a href="/pdf-to-text">PDF to Text</a> to create notes or a searchable copy. Expect paragraphs from complex pages to appear in a different order. Plain text does not preserve columns, font size, or the meaning of visual spacing. Keep page references in your notes so you can return to the image when context matters.',
          'Do not replace the original scan with an unreviewed text file. The image is the source evidence, while OCR is an interpretation. A searchable PDF can store both, displaying the scan and placing recognized text behind it. This is convenient, but errors in the hidden layer can still affect search, copy and paste, and screen reader output.',
        ],
      },
      {
        title: 'Think about accessibility and file size',
        paragraphs: [
          'OCR can make a scan more useful to a screen reader, but it does not create full accessibility by itself. The reading order, headings, language, tables, and alternative text may still need work. Run an <a href="/wcag-check">accessibility check</a> and review the document manually if it will be published for a broad audience.',
          'Scan files can also be large. Finish OCR and quality review before compression. Then use a moderate setting and confirm that thin characters remain readable. Compressing heavily before OCR can add block artifacts that lower recognition accuracy. Keep an archival copy at good quality and create a smaller sharing copy for email or upload limits.',
        ],
      },
      {
        title: 'A simple scan workflow',
        paragraphs: [
          'Keep the raw images, combine related pages, rotate and crop them, run OCR with the right language, and review important details. Name the searchable result clearly so nobody assumes it is a perfect transcription. Add page numbers only after the page order is final, then test the downloaded file in another reader.',
          'OCR is most helpful when treated as a draft created from an image. It saves time, makes search possible, and improves reuse, but the scan remains the place to settle uncertainty. The better the input image and the more focused the review, the more trustworthy the final document becomes.',
        ],
      },
    ],
    related: [
      { href: '/pdf-to-text', label: 'Extract stored PDF text' },
      { href: '/rotate', label: 'Rotate scanned pages' },
      { href: '/wcag-check', label: 'Review PDF accessibility' },
    ],
  },
  {
    slug: 'password-protect-and-share-pdfs',
    title: 'How to Password-Protect and Share a PDF Safely',
    description: 'Use PDF passwords wisely, choose a strong passphrase, share it through a separate channel, and understand what protection can and cannot do.',
    published: '2026-07-22',
    readTime: '9 min read',
    intro: 'A PDF password can stop someone from casually opening a document, but it does not control every copy forever. The protection is only as strong as the password, the software that created it, and the way the password is shared. A safe process combines encryption with careful delivery and a clear understanding of the remaining risks.',
    sections: [
      {
        title: 'Understand open passwords and permission passwords',
        paragraphs: [
          'An open password is required before the PDF can be viewed. This is the protection most people expect. A permission password may restrict printing, copying, or editing after the file opens. Reader support for permission restrictions varies, and someone who can view a document may still photograph the screen or use other software. Permissions are a request backed by PDF security, not permanent control over visible information.',
          'Use an open password when the file needs access control. Do not depend on print or copy restrictions to protect a secret that an authorized reader can see. If a recipient should not receive a page or value, remove it from the shared copy instead. Redaction and limited sharing solve a different problem from password protection.',
        ],
      },
      {
        title: 'Choose a long, unique passphrase',
        paragraphs: [
          'Length usually helps more than complicated substitutions in a short word. Use several unrelated words or a password manager to generate a strong value. Do not use the recipient\'s name, birthday, document title, or a pattern such as Company2026. Those choices may be easy to guess from the file or the message around it.',
          'Never reuse an important account password for a PDF. The recipient needs to know the document password, which means it cannot remain private to you. Store it in a password manager until the sharing task is complete. For a recurring exchange, decide whether each document gets a new password rather than using one phrase for years.',
        ],
      },
      {
        title: 'Protect the file on your own device',
        paragraphs: [
          'Use <a href="/protect">Protect PDF</a> to add the password locally. Save the output with a new name so the unprotected original is not overwritten. Close the tool and open the exported file in a normal PDF reader. Confirm that it asks for the password and that the correct password opens every page.',
          'Check the filename and document properties before sharing. Password protection hides page contents from someone who cannot open the file, but the filename may still be visible in an email or folder. Use a neutral name when the subject itself is sensitive. Keep the unprotected original only in secure storage.',
        ],
      },
      {
        title: 'Send the password through a different channel',
        paragraphs: [
          'Attaching the PDF and writing its password in the same email gives anyone with access to that message both pieces. Send the file through one channel and the password through another, such as a phone call or an encrypted message. Verify the recipient before giving them the password, especially when a request arrives unexpectedly.',
          'A separate channel does not need to be complicated. Its value comes from avoiding one point of failure. If an email account is compromised, a password delivered by phone is not sitting beside the attachment. Do not leave the password in voicemail when you are unsure who can hear it. Ask the recipient to confirm successful access.',
        ],
      },
      {
        title: 'Know when a secure portal is better',
        paragraphs: [
          'A professional portal may provide account authentication, expiration, access logs, and revocation. Those controls are helpful for tax, legal, health, or employment documents. Use the approved system when an organization provides one. A password-protected attachment may not meet its policy, even if the file encryption is technically strong.',
          'Cloud portals create their own trust requirements, so check the provider and destination carefully. Type a known address instead of following a surprising link. Multi-factor authentication improves the account side of the process. Remove old files from shared spaces when they are no longer needed and the retention rules allow it.',
        ],
      },
      {
        title: 'Plan for access and recovery',
        paragraphs: [
          'PDFOmni does not store a local document password for you. If everyone loses it, the file may become unusable. Keep a protected record in a password manager or follow the organization\'s recovery process. Do not weaken the password because you are afraid of forgetting it. Improve storage instead.',
          'When you receive permission to remove protection from your own file, <a href="/unlock">Unlock PDF</a> can create an unprotected working copy after you enter the correct password. Store that copy carefully and do not send it by accident. The original protected version may still be useful for archival or transfer.',
        ],
      },
      {
        title: 'Final sharing check',
        paragraphs: [
          'Confirm the document contains only the needed pages, sensitive values are properly redacted, the filename is appropriate, the exported PDF opens with the intended password, and the recipient address is correct. Send the password separately and ask the recipient to confirm. Delete stray unprotected copies from downloads and temporary folders when policy allows.',
          'Password protection is one layer in a larger process. It helps while the file is stored or moving between people, but an authorized recipient can still save or share what they see. Combine a strong password with minimal content, a trusted recipient, an appropriate delivery method, and clear handling expectations.',
        ],
      },
    ],
    related: [
      { href: '/protect', label: 'Protect a PDF locally' },
      { href: '/unlock', label: 'Unlock a PDF you own' },
      { href: '/redact', label: 'Remove content before sharing' },
    ],
  },
  {
    slug: 'build-a-better-pdf-workflow',
    title: 'How to Build a Better PDF Workflow for School or Work',
    description: 'A practical way to organize repeated PDF tasks, protect originals, use clear filenames, review output, and automate only the steps that stay predictable.',
    published: '2026-07-22',
    readTime: '10 min read',
    intro: 'PDF work becomes frustrating when the same file is downloaded, renamed, edited, and uploaded several times without a clear plan. A good workflow does not need complicated software. It needs a known starting point, a small set of repeatable steps, sensible filenames, and a final check before the document leaves your hands.',
    sections: [
      {
        title: 'Begin with the required final result',
        paragraphs: [
          'Write down where the PDF is going and what the recipient expects. Note the file type, size limit, page order, naming rule, deadline, signature requirement, and accessibility standard. This prevents wasted work, such as compressing a file before adding pages or merging attachments that the portal expects separately.',
          'Look at the source files and identify the risky parts. Scans may need rotation or OCR, forms may contain private values, and office documents may change layout during conversion. Keep a short checklist beside the working folder. The checklist should describe the result, not every button in a particular app, so it remains useful when the software changes.',
        ],
      },
      {
        title: 'Protect the originals and create a working area',
        paragraphs: [
          'Keep untouched source files in an originals folder and perform changes on copies. This is especially important for signed forms, scans, and documents received from another person. Use a working folder for intermediate files and an output folder for reviewed results. The separation makes cleanup easier and reduces the chance of sending the wrong version.',
          'Choose a naming pattern before the folder fills up. A useful name might include the project, document type, date, and status. Avoid final, final2, and newest. Names such as Lab-Report-review-2026-07-22.pdf and Lab-Report-submitted-2026-07-23.pdf explain what happened without opening the files. Keep dates in year-month-day order when sorting matters.',
        ],
      },
      {
        title: 'Put steps in an order that avoids repeated work',
        paragraphs: [
          'A common order is convert source files, clean scans, merge or split pages, reorder them, edit or redact content, add signatures and page numbers, compress a sharing copy, then perform the final review. The exact sequence changes by project. Redaction should happen before sharing, while compression should usually happen after the page content is settled.',
          'Think about which step can invalidate another. Reordering after adding page numbers may leave numbers in the wrong sequence. Editing after signing may create doubt about what was approved. Heavy compression before OCR can reduce recognition quality. A sensible order reduces the number of times the same PDF has to be exported and checked.',
        ],
      },
      {
        title: 'Use the smallest tool that completes each job',
        paragraphs: [
          'A one-step task is often easier on a dedicated page. Use <a href="/merge">Merge PDF</a> for a packet, <a href="/compress">Compress PDF</a> for an upload limit, or <a href="/sign">Sign PDF</a> for a visual signature. A focused tool has fewer settings to misunderstand and makes the expected output clearer.',
          'When the same sequence repeats, the <a href="/workflow">PDF workflow builder</a> can connect supported actions. Automation is helpful for predictable mechanical steps, not for decisions that need human judgment. A workflow can rotate every page or add a watermark consistently, but a person still needs to decide whether a redaction is complete or a conversion preserved the meaning of a table.',
        ],
      },
      {
        title: 'Create quality checks at useful points',
        paragraphs: [
          'Do not wait until the end to discover that the first conversion broke the layout. Check after a risky step such as office conversion, OCR, redaction, or strong compression. Quick checks during the workflow can focus on representative pages. The final check must cover the exact exported file from beginning to end.',
          'Record objective details such as page count, file size, required pages, phrases checked with document search, and whether the PDF opens in another reader. For accessibility, use an automated check and manual navigation. For privacy, search and extract text after redaction. For a submission, compare the finished filename and size with the portal instructions before uploading.',
        ],
      },
      {
        title: 'Handle collaboration and handoffs clearly',
        paragraphs: [
          'When several people edit copies, decide who owns the current version. Use a shared location with version history or pass one named working file at a time. Comments should say what changed and what still needs review. Avoid sending several attachments with similar names and asking the next person to guess which one is current.',
          'A handoff should include the source location, the status of the PDF, known issues, required next action, and deadline. Do not include a sensitive password in the same message as a protected file. When an approval matters, preserve the approved version and avoid making silent edits after the signature or confirmation.',
        ],
      },
      {
        title: 'Clean up without destroying the record',
        paragraphs: [
          'After delivery, keep the final reviewed output and the sources required by school, work, tax, or legal policy. Remove temporary downloads and confusing intermediate copies when they no longer serve a purpose. Do not delete records that must be retained. Move them into an archive with controlled access and a backup.',
          'Review the workflow after a repeated project. Notice where errors occurred, which step took too long, and which check caught a problem. Update the checklist in plain language. A better PDF workflow is not the one with the most automation. It is the one that reliably produces the correct file while making mistakes easy to notice before anyone else receives it.',
        ],
      },
    ],
    related: [
      { href: '/workflow', label: 'Build a reusable PDF workflow' },
      { href: '/batch', label: 'Process several PDFs' },
      { href: '/guides/merge-and-reorder-pdf-pages', label: 'Plan a clean PDF packet' },
    ],
  },
]

const guideChecklists = {
  'why-client-side-pdf-processing-matters': [
    'Decide whether the document is public, personal, confidential, or controlled by a school or workplace policy.',
    'Check whether the tool explains where document processing happens instead of relying on a general security slogan.',
    'Use a harmless sample PDF when you want to inspect browser network activity before opening a sensitive file.',
    'Keep the operating system, browser, and PDF software updated before working with documents that contain private information.',
    'Disable browser extensions you do not trust because extensions can sometimes read content displayed inside browser tabs.',
    'Make a backup of the source file before merging, editing, compressing, redacting, or changing its security settings.',
    'Use a local or approved offline application when policy does not allow the document to be handled by a website.',
    'Review optional features such as AI chat separately because they may have a different data path from the main PDF tool.',
    'Open and inspect the exported file before sharing it, even when the tool reports that processing finished successfully.',
    'Delete temporary working copies when they are no longer required, while preserving records you are expected to retain.',
  ],
  'risks-of-uploading-sensitive-pdfs-to-the-cloud': [
    'Look beyond the visible page for comments, attachments, form values, layers, bookmarks, and document properties.',
    'Read the provider\'s file retention policy and check whether deletion includes temporary files and stored output links.',
    'Confirm the company operating the tool has clear contact details and does not hide behind anonymous marketing pages.',
    'Check whether uploaded documents can be used for analytics, product improvement, human support, or AI model training.',
    'Use an approved company, school, legal, tax, or health portal when the document is covered by an organizational policy.',
    'Remove pages the recipient does not need instead of uploading or sending the complete document by default.',
    'Replace visual cover-ups with proper redaction and test the exported copy for recoverable text before it leaves the device.',
    'Avoid public sharing links for confidential files unless the link has access controls, expiration, and a way to revoke it.',
    'Send passwords through a separate channel and never place the password beside the protected attachment in one message.',
    'Treat the consequence of a leak as part of the decision, not only the convenience of the upload interface.',
  ],
  'make-pdfs-wcag-accessible': [
    'Use real heading styles in the source document and keep heading levels in a logical order.',
    'Set the document title and primary language, then confirm both values survive the PDF export.',
    'Check the tag tree and reading order on pages with columns, sidebars, captions, footnotes, or floating images.',
    'Write alt text that explains the image\'s purpose and mark purely decorative images so they can be skipped.',
    'Give tables clear header cells and simplify layouts that depend on merged cells or blank columns for spacing.',
    'Label every form control, place fields in a sensible tab order, and make errors understandable without relying on color.',
    'Use descriptive link text and verify that keyboard focus moves through links and controls in the expected sequence.',
    'Inspect text and important graphics at high zoom, including charts with small labels or information shown only by color.',
    'Run an automated accessibility checker, then treat its results as a list for review rather than proof of compliance.',
    'Test with a keyboard and screen reader, and involve assistive-technology users when the document has a public purpose.',
  ],
  'organize-tax-documents-into-one-pdf': [
    'Create separate folders for untouched originals, working copies, final submissions, and confirmations from the receiving service.',
    'Name each source with the tax year, form type, and organization so files sort clearly before they are merged.',
    'Check that every multi-page form includes all of its pages and that each document belongs to the correct tax year.',
    'Replace blurry photographs when possible and verify that small numbers remain readable at a high zoom level.',
    'Ask the accountant or receiving agency whether documents should be combined and whether they expect a particular order.',
    'Arrange income forms, deductions, supporting statements, and receipts in groups that another person can follow easily.',
    'Merge working copies, compare the final page count, and review every transition between source documents.',
    'Split out only the pages a recipient requests instead of sending the complete archive for every follow-up question.',
    'Use an approved secure portal or another agreed transfer method, especially for documents containing identity or account data.',
    'Back up the filed return, supporting packet, and submission confirmation according to the retention advice that applies to you.',
  ],
  'compress-pdf-without-ruining-quality': [
    'Record the original file size and keep the original PDF before testing any compression setting.',
    'Check whether large pages are scans, photographs, repeated graphics, or selectable text so you know where the space is used.',
    'Remove accidental blank pages and unrelated attachments before lowering image quality across the whole document.',
    'Choose a target based on the actual email or portal limit and leave a little room for later signatures or form values.',
    'Inspect the smallest text, thin chart lines, signatures, stamps, barcodes, and QR codes in the compressed output.',
    'Preserve color when it carries meaning, such as annotations, warnings, chart categories, highlights, or official stamps.',
    'Compare the same difficult page in the original and output at equal zoom instead of judging only from the cover page.',
    'Test links, text search, forms, and signatures because a smaller file still needs to behave like the intended document.',
    'Open the downloaded copy in a second reader when the file is being submitted for an important purpose.',
    'Prefer a slightly larger readable file over an impressive compression number that makes required details uncertain.',
  ],
  'redact-a-pdf-safely': [
    'Work on a copy and make a written list of every word, number, image, and repeated label that must be removed.',
    'Search for spelling variations and partial numbers, then manually inspect scanned pages that do not contain selectable text.',
    'Use a redaction feature that removes content rather than a shape, highlight, blur, crop, or white text color.',
    'Apply marked redactions before export and include enough margin to remove the full edge of each sensitive item.',
    'Search the exported file, copy across covered areas, and extract its text into a plain text view for another check.',
    'Review comments, form fields, bookmarks, attachments, layers, and metadata for information that no longer belongs in the copy.',
    'Check filenames, folder names, email subjects, and link previews because they can reveal facts missing from the page.',
    'Share only the pages required for the purpose instead of relying on dozens of redactions in unrelated sections.',
    'Ask a second person to review important redactions without assuming that the first person caught every occurrence.',
    'Reopen the exact attachment or upload file one final time instead of trusting the editing preview or an earlier version.',
  ],
  'merge-and-reorder-pdf-pages': [
    'Write the intended section order before selecting files and check whether the recipient actually wants one combined PDF.',
    'Keep the original sources and create numbered working copies that sort in the same order as the planned packet.',
    'Open each source to check its page count, orientation, blank pages, and whether it contains a cover that will be duplicated.',
    'Convert images and office files first so layout problems are found before they become buried inside the merged packet.',
    'Merge files in small logical groups when the project is large, then combine the reviewed groups into the final document.',
    'Use page thumbnails for arrangement but inspect full pages around every boundary and every page that was moved.',
    'Add continuous page numbers only after the sequence is final and keep them away from existing footers or signatures.',
    'Compare the exported page count with the prepared sources and explain any intentionally removed or added pages.',
    'Test forms, links, annotations, signatures, and selectable text in the final file rather than checking appearance alone.',
    'Use version names that explain review or submission status so another person can identify the current packet quickly.',
  ],
  'work-with-scanned-pdfs-and-ocr': [
    'Test several pages for selectable text because one PDF can contain both digital pages and image-only scans.',
    'Keep the raw scan before rotating, cropping, changing contrast, running OCR, or compressing the working copy.',
    'Replace blurry or shadowed phone photographs when the original paper is still available and can be captured again.',
    'Choose the correct recognition language and process unusual columns, tables, forms, or mixed scripts with extra care.',
    'Review names, dates, totals, account numbers, citations, and technical terms against the image character by character.',
    'Expect plain text extraction to lose columns and visual spacing, then preserve page references in notes made from it.',
    'Keep the page image as the source of truth because recognized text is an interpretation that can contain mistakes.',
    'Run accessibility checks after OCR because searchable text alone does not create headings, reading order, or useful tags.',
    'Compress only after recognition and review, then confirm that thin letters and punctuation remain clear in the output.',
    'Name the searchable copy clearly so readers know it came from OCR and may need comparison with the original scan.',
  ],
  'password-protect-and-share-pdfs': [
    'Decide whether the recipient needs the whole document or whether a smaller, properly redacted copy would be safer.',
    'Use an open password for access control and do not rely only on printing or copying restrictions after the file opens.',
    'Create a long, unique passphrase that does not contain names, dates, project titles, or passwords used for accounts.',
    'Save a new protected output so the only unprotected source is not accidentally overwritten during the process.',
    'Close the tool and test the downloaded PDF in a normal reader with both an incorrect and the correct password.',
    'Rename the file when its existing name reveals a private subject that encryption does not hide from email or storage views.',
    'Send the document and password through different channels and verify the recipient before providing access.',
    'Use an approved portal when a school, employer, accountant, lawyer, or health provider has a required transfer system.',
    'Store the passphrase in a password manager because a strong document password may not be recoverable if everyone loses it.',
    'Remove stray unprotected copies from downloads and temporary folders after confirming the protected handoff succeeded.',
  ],
  'build-a-better-pdf-workflow': [
    'Write the required file type, size, name, page order, signature, accessibility, and delivery rules before changing a source.',
    'Separate untouched originals, working copies, reviewed outputs, and submission confirmations into clearly named folders.',
    'Put conversion, cleanup, page organization, content changes, signatures, compression, and review in a sensible order.',
    'Check after risky steps such as OCR, office conversion, redaction, and strong compression instead of waiting until the end.',
    'Use dedicated tools for one-off jobs and automate only repeated steps whose correct result can be described clearly.',
    'Keep human review for privacy, accessibility, layout, and meaning because those decisions depend on the actual document.',
    'Record page counts, file sizes, phrases checked with document search, and submission requirements so checks have objective pass or fail results.',
    'Give one person ownership of the current version when a team is collaborating and document each important handoff.',
    'Review the exact downloaded file in another reader before delivery, then preserve the version that was actually approved.',
    'Update the checklist after a repeated project so the next run fixes the real source of mistakes instead of adding busywork.',
  ],
}

for (const guide of editorialGuides) {
  guide.checklist = guideChecklists[guide.slug] || []
}

const editorialClosingSections = {
  'risks-of-uploading-sensitive-pdfs-to-the-cloud': {
    title: 'Make the decision based on the document',
    paragraphs: [
      'The safest choice depends on what the PDF contains and why it needs to be processed. A public brochure does not require the same controls as a tax return, medical record, or signed client agreement. It helps to separate convenience from necessity. If a task can run locally, there may be no practical reason to create an extra server copy. If a school or workplace requires an approved portal, that requirement matters more than the convenience of a different tool.',
      'A careful decision also considers what happens after processing. The exported file can still reveal information through its filename, metadata, comments, or pages that were included by mistake. Privacy does not end when a progress bar reaches 100 percent. The person sharing the document should understand which copy is leaving the device, who can open it, and whether access can be removed later. That simple review prevents many problems that encryption or deletion policies cannot fix afterward.',
    ],
  },
  'make-pdfs-wcag-accessible': {
    title: 'Accessibility should survive real use',
    paragraphs: [
      'A useful accessibility review goes beyond checking whether tags exist. The document should make sense when someone moves through it with a keyboard or screen reader and cannot rely on the visual page. Headings need to describe the sections they introduce, link text should explain its destination, and table headers should help a reader understand each value. Images that carry information need descriptions, while decorative images should not interrupt the reading order with unnecessary announcements.',
      'Testing also needs more than one view of the file. Zooming to 200 or 400 percent can reveal clipped text and layouts that force horizontal scrolling. High contrast settings can expose weak color choices, while reading the extracted text can reveal columns or captions in the wrong order. Automated checks are still helpful because they find repeatable technical issues quickly. The final judgment, however, comes from whether a person can understand and complete the document without guessing how the page was designed.',
    ],
  },
  'organize-tax-documents-into-one-pdf': {
    title: 'A clear packet makes review easier',
    paragraphs: [
      'A well-organized tax packet should let the intended reader understand what is included without searching through unrelated pages. Income records, deduction support, identity documents, and explanatory statements are easier to review when each group has a clear order. The exact order may depend on an accountant, agency, or filing system, so it is worth checking their instructions before combining everything. A packet that looks tidy but follows the wrong requested order can still slow down the work.',
      'Privacy matters just as much as organization. Tax PDFs often contain addresses, account details, identification numbers, and signatures. Sending the entire archive for a question about one form can expose far more information than the recipient needs. A smaller extracted section may be the better response. When a complete packet is required, the final file should be checked for page count, blank scans, repeated forms, sideways pages, and readable small print before it is uploaded through an approved method. Keeping the submission confirmation beside the reviewed packet also makes it easier to identify exactly what was sent if a question comes up later.',
    ],
  },
  'compress-pdf-without-ruining-quality': {
    title: 'The best result is not always the smallest file',
    paragraphs: [
      'Compression is successful when the PDF meets its size limit and still communicates the same information. A file that shrinks dramatically but makes signatures, account numbers, footnotes, or chart labels difficult to read has not solved the real problem. The useful comparison is between the original and compressed versions on the same difficult pages. Cover pages and large headings usually survive strong compression, so they are poor places to judge quality. Small text and detailed images show the tradeoff much more clearly.',
      'Different documents also need different targets. A photo-heavy portfolio, a black and white scan, and a digital report do not use space in the same way. Removing an accidental blank page can save space with no quality loss, while lowering every image may damage content that was already efficient. Email and portal limits are practical boundaries, not competitions. Leaving a little space below the maximum is sensible, especially when another person may add a signature or form value before submitting the file. The reviewed original should remain available in case a second compression setting needs to be tested.',
    ],
  },
  'redact-a-pdf-safely': {
    title: 'A redacted copy should reveal nothing underneath',
    paragraphs: [
      'The final test for redaction is whether the removed information can still be recovered from the shared copy. Searching, selecting, copying, and extracting text can expose content that a visual cover-up only hides. Comments, form fields, attachments, bookmarks, and metadata deserve attention too because sensitive details are not always part of the visible page. A neutral filename can also prevent the document title from revealing the information that was removed inside.',
      'Important redactions benefit from a second review. Another person may notice a repeated name, partial account number, or scanned page that the first reviewer missed. The exact attachment or uploaded copy should be opened one final time because it is easy to choose an earlier version from a crowded folder. Proper redaction is less about drawing a convincing black box and more about proving that the unwanted content no longer exists in the delivered file.',
    ],
  },
  'merge-and-reorder-pdf-pages': {
    title: 'The finished packet should tell one clear story',
    paragraphs: [
      'Combining documents is useful only when the result is easier to understand than the separate sources. A good packet has a clear opening, keeps related pages together, and moves between sections in an order the reader can follow. Similar thumbnails can hide duplicates or missing continuation pages, so page boundaries deserve a full-size review. Existing page numbers can also become confusing when several reports are joined, especially when every source begins again at page one.',
      'The final page count provides a simple but valuable check. It should match the total of the prepared sources after accounting for any pages intentionally removed or added. Forms, links, annotations, and signatures should still work after the merge, not just look correct in the thumbnail grid. Clear version names help when another person reviews the packet later. A filename that identifies the project and review status is far more useful than a folder containing several files called final.',
    ],
  },
  'work-with-scanned-pdfs-and-ocr': {
    title: 'Recognized text is still an interpretation',
    paragraphs: [
      'OCR can make a scan searchable and easier to quote, but it does not turn the page image into a perfect digital source. Recognition mistakes often appear in names, dates, totals, technical terms, and characters that look alike. Columns and tables can also be read in the wrong order even when every individual word is recognized correctly. The original page image remains the best reference when accuracy matters, so extracted notes should keep page numbers or another way to return to the source.',
      'A scanned PDF may mix image-only pages with pages that already contain selectable text. Testing several pages gives a better picture than checking only the cover. Searchability also does not create accessibility by itself. Headings, lists, table structure, language, and reading order still need separate attention. After OCR, the reviewed copy should remain clear enough that thin punctuation and small letters can be compared with the scan, especially if compression is used before the file is shared.',
    ],
  },
  'password-protect-and-share-pdfs': {
    title: 'Protection is only one part of sharing safely',
    paragraphs: [
      'A password controls who can open the file, but it does not decide whether the recipient should receive every page. Removing unrelated material and properly redacting information can reduce the amount of sensitive data before encryption is added. The filename also remains visible in many email and storage systems, so it should not disclose a private diagnosis, account, or legal issue. These details matter because encryption protects the contents of the closed file, not every clue around it.',
      'The document and password should travel through different channels when the information is important. Sending both in one email means access to that message provides everything needed to open the attachment. The downloaded protected copy should be tested in a normal PDF reader with an incorrect password and the correct one. After the handoff is confirmed, stray unprotected copies should not remain in downloads or shared folders. Records that must be retained can stay in controlled storage with a backup and a clear owner.',
    ],
  },
  'build-a-better-pdf-workflow': {
    title: 'A good workflow makes mistakes easier to catch',
    paragraphs: [
      'The value of a document workflow is not the number of automated steps it contains. A useful workflow produces the required file consistently and leaves clear points where a person can review risky changes. Conversion, OCR, redaction, signing, and strong compression can each affect information in different ways. Checking immediately after those steps makes it easier to identify the source of a problem than discovering it after several more exports have been created.',
      'Repeated projects improve when the team records what actually went wrong. A missing page, confusing filename, unreadable scan, or outdated attachment points to a specific change in the process. Clear ownership also prevents two people from editing different copies and both assuming theirs is current. The final reviewed output, its source, and any submission confirmation should be easy to identify later. A shorter process with reliable checks is usually better than a complicated one that hides where decisions were made.',
    ],
  },
}

for (const guide of editorialGuides) {
  const closingSection = editorialClosingSections[guide.slug]
  if (closingSection) guide.sections.push(closingSection)
}

export const guides = [...toolGuides, ...editorialGuides]

export function getGuide(slug) {
  return guides.find((guide) => guide.slug === slug)
}
