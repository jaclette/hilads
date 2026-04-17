import { API_URL } from '@/constants';
import { getAuthToken } from './client';

/**
 * Upload a local image URI to Cloudflare R2 via the backend.
 *
 * Returns `{ url, thumbUrl }` where:
 *   - `url`      is the full-size public URL (always present)
 *   - `thumbUrl` is the thumbnail URL (≤400 px JPEG) if the server generated one,
 *                or null if thumbnail generation was skipped (GD unavailable, etc.)
 *
 * Note: Do NOT set Content-Type manually — fetch sets it with the
 * multipart boundary when body is FormData.
 */
export async function uploadFile(
  localUri: string,
  mimeType?: string | null,
): Promise<{ url: string; thumbUrl: string | null }> {
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

  const { url, thumbUrl = null } = await res.json();
  console.log('[image-upload] upload success url=', url, 'thumbUrl=', thumbUrl);
  return { url: url as string, thumbUrl: (thumbUrl as string | null) };
}
