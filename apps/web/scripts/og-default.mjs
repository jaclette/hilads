/**
 * Renders the static Open Graph image, public/og/og-default.png, from
 * api/og.mjs FallbackCard (the theme covers as a mosaic, with the tagline).
 * Run after changing FallbackCard: `node scripts/og-default.mjs` (needs network:
 * the covers and the font are fetched). Then shrink it under 300 KB (WhatsApp
 * drops bigger previews), e.g. a 256-color quantize:
 *   python3 -c "from PIL import Image; Image.open('public/og/og-default.png').convert('RGB').quantize(256).save('public/og/og-default.png', optimize=True)"
 */
import { writeFile } from 'node:fs/promises'
import handler from '../api/og.mjs'

const chunks = []
const res = {
  statusCode: 0,
  setHeader() {},
  end(buf) { if (buf) chunks.push(buf) },
}
await handler({ query: { type: 'default', debug: '1' } }, res)
if (res.statusCode !== 200) throw new Error(`og: ${res.statusCode} ${chunks.join('')}`)
await writeFile(new URL('../public/og/og-default.png', import.meta.url), Buffer.concat(chunks))
console.log('public/og/og-default.png written')
