import { Image } from 'expo-image';
import { mediumUrl } from '@/lib/imageThumb';
import type { DailyProof } from '@/types';

// What a full-screen viewer loads (DualPhoto: the medium size of the photo and of its selfie),
// warmed into memory before the viewer opens: on a press-in, or for the next stories.
const asked = new Set<string>();

/** Prefetch the viewer size of these originals (photo, selfie…); each URL once per session. */
export function prefetchFull(...originals: (string | null | undefined)[]): void {
  const urls = originals.map(u => mediumUrl(u) ?? u).filter((u): u is string => !!u && !asked.has(u));
  if (!urls.length) return;
  urls.forEach(u => asked.add(u));
  Image.prefetch(urls, 'memory-disk').catch(() => urls.forEach(u => asked.delete(u)));
}

/** A Daily photo's viewer images: the photo and its selfie. */
export function prefetchProof(p: { photoUrl?: string | null; selfieUrl?: string | null } | null | undefined): void {
  if (p) prefetchFull(p.photoUrl, p.selfieUrl);
}

// A photo tapped in a grid, handed to the screen that opens on it: its first frame shows it at
// once (from this object and the warm image cache) instead of a loader until the network answers.
const handed = new Map<string, DailyProof>();
export function handOffProof(p: DailyProof): void { handed.set(p.id, p); }
export function takeHandedProof(id: string | null | undefined): DailyProof | null {
  if (!id) return null;
  const p = handed.get(id) ?? null;
  handed.delete(id);
  return p;
}

// A ranked list of photos (the Ranks tab) handed to the photo feed, which plays it in that order.
let handedList: { key: string; proofs: DailyProof[] } | null = null;
export function handOffList(key: string, proofs: DailyProof[]): void { handedList = { key, proofs }; }
export function takeHandedList(key: string | null | undefined): DailyProof[] | null {
  if (!key || handedList?.key !== key) return null;
  const list = handedList.proofs;
  handedList = null;
  return list;
}
