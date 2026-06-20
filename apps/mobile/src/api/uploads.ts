import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { API_URL } from '@/constants';
import { getAuthToken } from './client';

const MAX_DIM  = 1600; // longest side - plenty for a phone screen, ~10x smaller file
const JPEG_Q   = 0.8;

function imageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
  });
}

/**
 * Downscale + re-compress a picked photo before upload. A raw phone photo is
 * 3-5 MB; the chat / challenge feeds loaded the full thing. Caps the longest
 * side at 1600px and re-encodes JPEG q0.8 (~200-500 KB). Any failure returns the
 * original uri untouched. Returns the (possibly new) uri + whether it's now JPEG.
 */
async function downscaleForUpload(uri: string): Promise<{ uri: string; jpeg: boolean }> {
  try {
    const size = await imageSize(uri);
    const ctx  = ImageManipulator.manipulate(uri);
    if (size && Math.max(size.width, size.height) > MAX_DIM) {
      if (size.width >= size.height) ctx.resize({ width: MAX_DIM });
      else                           ctx.resize({ height: MAX_DIM });
    }
    const rendered = await ctx.renderAsync();
    const result   = await rendered.saveAsync({ compress: JPEG_Q, format: SaveFormat.JPEG });
    return { uri: result.uri, jpeg: true };
  } catch (e) {
    console.warn('[image-upload] downscale failed, using original:', e);
    return { uri, jpeg: false };
  }
}

/**
 * Upload a local image URI to Cloudflare R2 via the backend.
 *
 * Returns `{ url, thumbUrl }` where:
 *   - `url`      is the full-size public URL (always present)
 *   - `thumbUrl` is the thumbnail URL (≤400 px JPEG) if the server generated one,
 *                or null if thumbnail generation was skipped (GD unavailable, etc.)
 *
 * Note: Do NOT set Content-Type manually - fetch sets it with the
 * multipart boundary when body is FormData.
 */
export async function uploadFile(
  localUri: string,
  mimeType?: string | null,
): Promise<{ url: string; thumbUrl: string | null }> {
  console.log('[image-upload] upload start - uri:', localUri, 'mimeType:', mimeType ?? 'auto');

  // Shrink before upload (skip GIFs - manipulation would flatten the animation).
  let sendUri = localUri;
  let forcedJpeg = false;
  if (mimeType !== 'image/gif') {
    const down = await downscaleForUpload(localUri);
    sendUri = down.uri;
    forcedJpeg = down.jpeg;
  }

  // Derive type + extension. After a successful downscale the bytes are JPEG;
  // otherwise honour the provided mimeType (Expo ImagePicker exposes it).
  const type = forcedJpeg ? 'image/jpeg'
             : mimeType === 'image/png' ? 'image/png'
             : mimeType === 'image/webp' ? 'image/webp'
             : mimeType === 'image/gif' ? 'image/gif'
             : 'image/jpeg';
  const ext  = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';

  const formData = new FormData();
  formData.append('file', {
    uri:  sendUri,
    type,
    name: `photo.${ext}`,
  } as unknown as Blob);

  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers['Cookie'] = `hilads_token=${token}`;

  const res = await fetch(`${API_URL}/uploads`, {
    method:  'POST',
    headers,
    body:    formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error('[image-upload] upload failed =', res.status, JSON.stringify(body));
    throw new Error(body?.error ?? 'Upload failed');
  }

  const { url, thumbUrl = null } = await res.json();
  console.log('[image-upload] upload success url=', url, 'thumbUrl=', thumbUrl);
  return { url: url as string, thumbUrl: (thumbUrl as string | null) };
}
