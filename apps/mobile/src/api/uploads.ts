import { API_URL } from '@/constants';
import { getAuthToken } from './client';

/**
 * Upload a local image URI to Cloudflare R2 via the backend.
 * Returns the public URL.
 *
 * Note: Do NOT set Content-Type manually — fetch sets it with the
 * multipart boundary when body is FormData.
 */
export async function uploadFile(localUri: string): Promise<string> {
  console.log('[image-upload] upload start — uri:', localUri);

  const formData = new FormData();
  formData.append('file', {
    uri:  localUri,
    type: 'image/jpeg',
    name: 'photo.jpg',
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

  const { url } = await res.json();
  console.log('[image-upload] upload success url=', url);
  return url as string;
}
