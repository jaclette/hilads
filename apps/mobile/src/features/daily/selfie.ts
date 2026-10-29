import type { PhotoSource } from '@/ui';

/** A Daily photo's selfie for DualPhoto (dual photo), or null: absent on older API answers and single photos. */
export function selfieOf(p: { selfieUrl?: string | null; selfieThumbUrl?: string | null } | null | undefined): PhotoSource | null {
  return p?.selfieUrl ? { uri: p.selfieUrl, thumb: p.selfieThumbUrl ?? null } : null;
}
