import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guides } from '../src/config/guides.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(projectRoot, 'src')
const outputRoot = path.join(sourceRoot, 'generated')
const contentRoot = path.join(outputRoot, 'guides')

if (!outputRoot.startsWith(`${sourceRoot}${path.sep}`)) {
  throw new Error(`Refusing to generate guides outside src: ${outputRoot}`)
}

const asModuleValue = value => JSON.stringify(value, null, 2)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(contentRoot, { recursive: true })

const metadata = guides.map(({
  slug,
  title,
  description,
  published,
  readTime,
  toolId,
  intro,
  richIntro,
}) => ({
  slug,
  title,
  description,
  published,
  readTime,
  ...(toolId ? { toolId } : {}),
  intro,
  ...(richIntro ? { richIntro: true } : {}),
}))

fs.writeFileSync(
  path.join(outputRoot, 'guideIndex.js'),
  `export const guideIndex = ${asModuleValue(metadata)}\n\n`
    + 'const guideMetadataBySlug = new Map(guideIndex.map((guide) => [guide.slug, guide]))\n\n'
    + 'export function getGuideMetadata(slug) {\n'
    + '  return guideMetadataBySlug.get(slug)\n'
    + '}\n',
  'utf8',
)

const loaderLines = []
for (const guide of guides) {
  if (!/^[a-z0-9-]+$/.test(guide.slug)) {
    throw new Error(`Guide slug cannot be used as a generated filename: ${guide.slug}`)
  }
  const fileName = `guide-content-${guide.slug}.js`
  fs.writeFileSync(
    path.join(contentRoot, fileName),
    `export default ${asModuleValue(guide)}\n`,
    'utf8',
  )
  loaderLines.push(`  ${JSON.stringify(guide.slug)}: () => import('./guides/${fileName}'),`)
}

fs.writeFileSync(
  path.join(outputRoot, 'guideLoaders.js'),
  `const guideLoaders = {\n${loaderLines.join('\n')}\n}\n\n`
    + 'export async function loadGuide(slug) {\n'
    + '  const loader = guideLoaders[slug]\n'
    + '  if (!loader) return null\n'
    + '  return (await loader()).default\n'
    + '}\n',
  'utf8',
)

console.log(`Generated ${guides.length} lazy guide module(s).`)
