// Relative "expires in …" label for hangouts (24h lifespan). `expiresAt` is a
// unix timestamp in seconds. Computed on render — approximate is fine.

export function formatExpiresIn(expiresAt?: number | null): string | null {
  if (!expiresAt) return null;
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0)   return 'Expired';
  const mins = Math.floor(secs / 60);
  if (mins < 1)    return 'Expires soon';
  if (mins < 60)   return `Expires in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  return rem > 0 && hours < 6 ? `Expires in ${hours}h ${rem}m` : `Expires in ${hours}h`;
}
