import { API_URL } from '@/constants';
import { getAuthToken } from './client';

/**
 * Derives the thumbnail URL for a profile photo.
 * Backend stores thumbnails as `thumb_{basename}.jpg` alongside the original in R2.
 * Returns null if url is falsy. Use as the Image `source` URI with the full URL as fallback.
 */
export function profileThumbUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const slash = url.lastIndexOf('/');
  const file  = url.slice(slash + 1);
  const dot   = file.lastIndexOf('.');
  const name  = dot !== -1 ? file.slice(0, dot) : file;
  return url.slice(0, slash + 1) + 'thumb_' + name + '.jpg';
}

/**
 * Upload a local image URI to Cloudflare R2 via the backend.
 * Returns the public URL.
 *
 * Note: Do NOT set Content-Type manually — fetch sets it with the
 * multipart boundary when body is FormData.
 */
export async function uploadFile(localUri: string, mimeType?: string | null): Promise<string> {
  console.log('[image-upload] upload start — uri:', localUri, 'mimeType:', mimeType ?? 'auto');

  // Derive type + extension from the provided mimeType, or fall back to JPEG.
  // Expo ImagePicker (expo-image-picker ≥ 14) exposes asset.mimeType on iOS/Android.
  const type = mimeType === 'image/png' ? 'image/png'
             : mimeType === 'image/webp' ? 'image/webp'
             : 'image/jpeg';
  const ext  = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';

  const formData = new FormData();
  formData.append('file', {
    uri:  localUri,
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

  const data = await res.json();
  console.log('[image-upload] upload success url=', data.url);
  return data.url as string;
}
