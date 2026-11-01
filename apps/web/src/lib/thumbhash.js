// A photo's placeholder: its thumbhash (base64, ~25 bytes, sent with the proof as
// thumbHash) decoded to a tiny blurred image, drawn behind the <img> until the
// photo loads. Decoder ported from the reference implementation
// (github.com/evanw/thumbhash, MIT).

function thumbHashToRGBA(hash) {
  const { PI, min, max, cos, round } = Math
  const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16)
  const header16 = hash[3] | (hash[4] << 8)
  const lDc = (header24 & 63) / 63
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1
  const lScale = ((header24 >> 18) & 31) / 31
  const hasAlpha = header24 >> 23
  const pScale = ((header16 >> 3) & 63) / 63
  const qScale = ((header16 >> 9) & 63) / 63
  const isLandscape = header16 >> 15
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7)
  const ly = max(3, isLandscape ? header16 & 7 : (hasAlpha ? 5 : 7))
  const aDc = hasAlpha ? (hash[5] & 15) / 15 : 1
  const aScale = (hash[5] >> 4) / 15

  const acStart = hasAlpha ? 6 : 5
  let acIndex = 0
  const decodeChannel = (nx, ny, scale) => {
    const ac = []
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push((((hash[acStart + (acIndex >> 1)] >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale)
      }
    }
    return ac
  }
  const lAc = decodeChannel(lx, ly, lScale)
  const pAc = decodeChannel(3, 3, pScale * 1.25)
  const qAc = decodeChannel(3, 3, qScale * 1.25)
  const aAc = hasAlpha && decodeChannel(5, 5, aScale)

  const ratio = aspectRatio(hash)
  const w = round(ratio > 1 ? 32 : 32 * ratio)
  const h = round(ratio > 1 ? 32 / ratio : 32)
  const rgba = new Uint8ClampedArray(w * h * 4)
  const fx = []
  const fy = []
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDc, p = pDc, q = qDc, a = aDc
      for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos(PI / w * (x + 0.5) * cx)
      for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos(PI / h * (y + 0.5) * cy)
      for (let cy = 0, j = 0; cy < ly; cy++) {
        for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx * ly < lx * (ly - cy); cx++, j++) l += lAc[j] * fx[cx] * fy2
      }
      for (let cy = 0, j = 0; cy < 3; cy++) {
        for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 3 - cy; cx++, j++) {
          const f = fx[cx] * fy2
          p += pAc[j] * f
          q += qAc[j] * f
        }
      }
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy++) {
          for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 5 - cy; cx++, j++) a += aAc[j] * fx[cx] * fy2
        }
      }
      const b = l - 2 / 3 * p
      const r = (3 * l - b + q) / 2
      const g = r - q
      rgba[i] = max(0, 255 * min(1, r))
      rgba[i + 1] = max(0, 255 * min(1, g))
      rgba[i + 2] = max(0, 255 * min(1, b))
      rgba[i + 3] = max(0, 255 * min(1, a))
    }
  }
  return { w, h, rgba }
}

function aspectRatio(hash) {
  const header = hash[3]
  const hasAlpha = hash[2] & 0x80
  const isLandscape = hash[4] & 0x80
  const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7
  const ly = isLandscape ? header & 7 : (hasAlpha ? 5 : 7)
  return lx / ly
}

export const _thumbHashToRGBA = thumbHashToRGBA   // tests

const cache = new Map()

/** The placeholder image (a data: URL) of a thumbhash, or null (none, bad hash, no canvas). */
export function placeholderUrl(hash) {
  if (!hash || typeof document === 'undefined') return null
  if (cache.has(hash)) return cache.get(hash)
  let url = null
  try {
    const bytes = Uint8Array.from(atob(hash), c => c.charCodeAt(0))
    const { w, h, rgba } = thumbHashToRGBA(bytes)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
    url = canvas.toDataURL('image/png')
  } catch { /* a bad hash: no placeholder */ }
  cache.set(hash, url)
  return url
}

/** The style that draws a thumbhash behind an <img> (stretched, it's already blurred), or undefined. */
export function placeholderStyle(hash) {
  const url = placeholderUrl(hash)
  return url ? { backgroundImage: `url("${url}")`, backgroundSize: '100% 100%' } : undefined
}
