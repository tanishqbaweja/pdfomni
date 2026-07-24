import fs from 'node:fs'
import path from 'node:path'
import tools from '../src/config/tools.js'
import { guides } from '../src/config/guides.js'

const outDir = process.argv[2] || 'dist'
const rootDir = process.cwd()
const outputRoot = path.resolve(rootDir, outDir)

const routes = [
  '/',
  ...tools.filter((tool) => tool.canonicalPath && !tool.hiddenOnHome).map((tool) => tool.canonicalPath),
  '/workflow',
  '/privacy',
  '/terms',
  '/contact',
  '/about',
  '/guides',
  ...guides.map((guide) => `/guides/${guide.slug}`),
  '/404',
  '/500',
]

function routeFile(route) {
  if (route === '/') return path.join(outputRoot, 'index.html')
  return path.join(outputRoot, route.replace(/^\/+|\/+$/g, ''), 'index.html')
}

function routeHtmlFile(route) {
  if (route === '/') return null
  return path.join(outputRoot, `${route.replace(/^\/+|\/+$/g, '')}.html`)
}

function textLength(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
}

function wordCount(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
  return text.match(/[A-Za-z0-9']+/g)?.length || 0
}

const failures = []
const publicTools = tools.filter((tool) => tool.canonicalPath && !tool.hiddenOnHome)
const sitemap = fs.readFileSync(path.join(rootDir, 'public', 'sitemap.xml'), 'utf8')

for (const tool of publicTools) {
  const matches = guides.filter((guide) => guide.toolId === tool.id)
  if (matches.length !== 1) failures.push(`${tool.canonicalPath}: expected exactly one dedicated tool guide, found ${matches.length}`)
}

for (const guide of guides) {
  const route = `/guides/${guide.slug}`
  if (!sitemap.includes(`<loc>https://pdfomni.com${route}</loc>`)) {
    failures.push(`${route}: missing from public/sitemap.xml`)
  }
  if (/—|â€”/.test(JSON.stringify(guide))) failures.push(`${route}: contains an em dash`)
  if (guide.toolId) {
    const primaryTool = publicTools.find((tool) => tool.id === guide.toolId)
    const otherToolLinks = new Set(
      guide.related
        .map((item) => item.href)
        .filter((href) => publicTools.some((tool) => tool.canonicalPath === href) && href !== primaryTool?.canonicalPath),
    )
    if (otherToolLinks.size < 2) failures.push(`${route}: needs links to at least two other tools`)
    if (!guide.intro.includes(`href="${primaryTool?.canonicalPath}"`)) failures.push(`${route}: primary tool is not linked in the introduction`)
  }
}

for (const route of routes) {
  const files = [routeFile(route), routeHtmlFile(route)].filter(Boolean)
  for (const file of files) {
    if (!fs.existsSync(file)) {
      failures.push(`${route}: missing ${file}`)
      continue
    }

    const html = fs.readFileSync(file, 'utf8')
    const seoIndex = html.indexOf('class="prerendered-seo"')
    const rootIndex = html.indexOf('id="root"')
    const isToolRoute = tools.some((tool) => tool.canonicalPath === route && !tool.hiddenOnHome)
    const isGuideArticle = guides.some((guide) => `/guides/${guide.slug}` === route)

    const checks = [
      ['title', /<title>[^<]{8,}<\/title>/i.test(html)],
      ['description', /<meta name="description" content="[^"]{50,}"/i.test(html)],
      ['canonical', html.includes(`rel="canonical" href="https://pdfomni.com${route}"`)],
      ['no old pages.dev domain', !html.includes('pdfomni.pages.dev')],
      ['crawler body', seoIndex >= 0],
      ['h1', /<h1>[^<]{8,}<\/h1>/i.test(html)],
      ['root after crawler body', rootIndex > seoIndex],
      ['not noscript-only', !html.includes('<noscript>')],
      ['body text', textLength(html) > (isToolRoute ? 1800 : 80)],
      ['minimum word count', wordCount(html) >= (isGuideArticle ? 1000 : isToolRoute ? 800 : 20)],
    ]

    if (isToolRoute) {
      checks.push(
        ['privacy copy', /local|browser|device|privacy/i.test(html)]
      )
      if (route !== '/edit-pdf') {
        checks.push(
          ['faq heading', html.includes('Frequently Asked Questions')],
          ['faq schema', html.includes('"@type":"FAQPage"')]
        )
      }
    }

    for (const [name, ok] of checks) {
      if (!ok) failures.push(`${route}: failed ${name} in ${file}`)
    }
  }
}

if (failures.length) {
  console.error(`Prerender verification failed for ${outDir}:`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Verified ${routes.length} prerendered route(s) with index and extensionless HTML in ${outDir}.`)
