/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Vercel serverless function — dynamic OG image generation.
 *
 *   GET /api/og?type=event&id=<16-hex>
 *   GET /api/og?type=city&slug=<kebab>
 *
 * Returns a 1200×630 PNG. Used by the prerender function (api/prerender.mjs)
 * as the `og:image` for shared event / city URLs. WhatsApp, iMessage, Twitter,
 * Slack, etc. fetch this URL directly when rendering link previews.
 *
 * Runs on Node runtime (not Edge): Vercel's Edge bundler currently rejects
 * @vercel/og imports outside Next.js projects ("unsupported modules" build
 * error). Node serverless is well-supported and the @vercel/og Node entry
 * just works. Cold start is ~500 ms vs Edge's ~50 ms — mitigated by the
 * aggressive CDN cache TTL set below.
 *
 * Cache strategy
 *   - Events: s-maxage 5 min — attendee counts churn.
 *   - Cities: s-maxage 24 h — city metadata is stable.
 *   - 24 h stale-while-revalidate so the CDN never blocks on regen.
 *
 * Failure mode: any error renders a homepage fallback card (Hilads brand
 * + tagline) so the link preview is never broken.
 */

import { ImageResponse } from '@vercel/og';

const API_BASE  = 'https://api.hilads.live';
const SITE_BASE = 'https://hilads.live';

// Brand tokens — kept in sync with apps/web/src/index.css :root vars.
const BG     = '#0d0b09';
const TEXT   = '#ede9e5';
const MUTED  = '#968880';
const MUTED2 = '#635650';
const BORDER = '#272018';
const ACCENT     = '#FF7A3C';   // bright orange (icon glow / dots)
const ACCENT_DR  = '#C24A38';   // deep red-orange (CTA)
const ACCENT_AM  = '#B87228';   // gradient end
const GREEN  = '#3DDC84';
const VIOLET = '#8B5CF6';

const W = 1200;
const H = 630;

// ── Data fetchers (1.5 s timeout; null on failure) ────────────────────────────

async function fetchJson(url: string, ms = 1500): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatTime(unixTs: number, tz: string): string {
  return new Date(unixTs * 1000).toLocaleTimeString('en-US', {
    timeZone: tz || 'UTC',
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  });
}

function timeRange(starts: number, ends: number | null | undefined, tz: string): string {
  const a = formatTime(starts, tz);
  const b = ends ? ` → ${formatTime(ends, tz)}` : '';
  return `🕐 ${a}${b}`;
}

function cityFlag(country: string | undefined): string {
  if (!country || country.length !== 2) return '';
  const cc = country.toUpperCase();
  // Regional Indicator Symbol Letters: U+1F1E6 + (char - 'A')
  return [...cc].map(c => String.fromCodePoint(0x1F1E6 + (c.charCodeAt(0) - 65))).join('');
}

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// ── Shared chrome: Hilads "Hi" mark, logo gradient, URL pill ─────────────────

function HiladsMark({ size = 88 }: { size?: number }) {
  // Visual port of /public/logo/icon.svg via flat divs (Satori has no SVG path
  // support — we rebuild the H + ¡ glyph with absolutely-positioned rects).
  const s  = (n: number) => (n * size) / 64;
  return (
    <div
      style={{
        width:        size,
        height:       size,
        borderRadius: s(15),
        background:   `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DR} 50%, ${ACCENT_AM} 100%)`,
        position:     'relative',
        display:      'flex',
        flexShrink:   0,
      }}
    >
      {/* H — left bar, right bar, crossbar */}
      <div style={{ position: 'absolute', left: s(9),  top: s(13), width: s(8),   height: s(38), borderRadius: s(2.5), background: '#fff' }} />
      <div style={{ position: 'absolute', left: s(26), top: s(13), width: s(8),   height: s(38), borderRadius: s(2.5), background: '#fff' }} />
      <div style={{ position: 'absolute', left: s(17), top: s(28), width: s(9),   height: s(6),  borderRadius: s(2),   background: '#fff' }} />
      {/* ¡ — vertical bar + dot */}
      <div style={{ position: 'absolute', left: s(43), top: s(25), width: s(8),   height: s(26), borderRadius: s(2.5), background: '#fff' }} />
      <div style={{ position: 'absolute', left: s(47 - 5.5), top: s(15 - 5.5), width: s(11), height: s(11), borderRadius: s(5.5), background: '#fff' }} />
    </div>
  );
}

function URLFooter({ path }: { path: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom:   40,
        right:    50,
        fontSize: 22,
        color:    MUTED2,
        fontWeight: 500,
      }}
    >
      hilads.live{path}
    </div>
  );
}

// ── Surface 1: Event card ─────────────────────────────────────────────────────

function EventCard({ event, cityName, country, timezone, eventPath }: any) {
  const icon  = EVENT_ICONS[event.event_type] ?? '📌';
  const title = event.title;
  const where = event.location || event.venue || cityName || '';
  const when  = event.starts_at ? timeRange(event.starts_at, event.ends_at, timezone) : '';
  const going = event.participant_count ?? 0;
  const flag  = cityFlag(country);

  return (
    <div
      style={{
        width:  W,
        height: H,
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
        padding:  60,
        color:    TEXT,
        fontFamily: 'Geist',
        position: 'relative',
      }}
    >
      {/* Top row: brand mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <HiladsMark size={72} />
        <div style={{ display: 'flex', fontSize: 22, color: MUTED2, fontWeight: 600 }}>hilads.live</div>
      </div>

      {/* Centre block: title + meta */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            display: 'flex',
            fontSize: 70,
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: -2,
            color: TEXT,
            // Clamp at ~2 lines max to avoid layout overflow on long titles.
            maxHeight: 220,
            overflow: 'hidden',
          }}>
            {`${icon}  ${title}`}
          </div>
        </div>

        {when && (
          <div style={{ display: 'flex', fontSize: 30, color: TEXT, opacity: 0.9 }}>{when}</div>
        )}
        {(where) && (
          <div style={{ display: 'flex', fontSize: 28, color: ACCENT, fontWeight: 600 }}>
            📍 {flag ? `${flag}  ` : ''}{where}{cityName && where !== cityName ? `, ${cityName}` : ''}
          </div>
        )}

        {going > 0 && (
          <div style={{
            alignSelf: 'flex-start',
            display:   'flex',
            background: 'rgba(255,122,60,0.15)',
            border:     `1.5px solid ${ACCENT}`,
            borderRadius: 999,
            padding: '14px 28px',
            fontSize: 28,
            fontWeight: 700,
            color: ACCENT,
            marginTop: 10,
          }}>
            🙌 {going} going
          </div>
        )}
      </div>

      <URLFooter path={eventPath} />
    </div>
  );
}

// ── Surface 2: City card ──────────────────────────────────────────────────────

function CityCard({ city, country, slug, eventCount, onlineCount }: any) {
  const flag = cityFlag(country);
  return (
    <div
      style={{
        width: W, height: H,
        display: 'flex', flexDirection: 'column',
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
        padding: 60,
        color: TEXT,
        fontFamily: 'Geist',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <HiladsMark size={72} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {flag && <div style={{ fontSize: 96, display: 'flex' }}>{flag}</div>}
          <div style={{
            display: 'flex',
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -3,
            color: TEXT,
          }}>
            {city}
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 34, color: MUTED, fontWeight: 500 }}>
          What's happening tonight
        </div>

        <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
          <Stat icon="🎉" label="events live"   value={eventCount  > 0 ? String(eventCount)  : '—'} />
          <Stat icon="👥" label="here right now" value={onlineCount > 0 ? String(onlineCount) : '—'} />
          <Stat icon="✨" label="real-time"     value="LIVE" />
        </div>
      </div>

      <URLFooter path={`/city/${slug}`} />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 22,
        minWidth: 240,
      }}
    >
      <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, color: TEXT, gap: 10 }}>
        <span>{icon}</span>
        <span>{value}</span>
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: MUTED, marginTop: 6 }}>{label}</div>
    </div>
  );
}

// ── Fallback (homepage / unknown surface) ─────────────────────────────────────

function FallbackCard() {
  return (
    <div
      style={{
        width: W, height: H,
        display: 'flex', flexDirection: 'column',
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
        padding: 60,
        color: TEXT,
        fontFamily: 'Geist',
        position: 'relative',
      }}
    >
      <HiladsMark size={88} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
        <div style={{
          display: 'flex',
          fontSize: 140,
          fontWeight: 800,
          letterSpacing: -4,
          background: `linear-gradient(90deg, ${ACCENT_DR} 0%, ${ACCENT_AM} 100%)`,
          backgroundClip: 'text',
          color: 'transparent',
        }}>
          Hilads
        </div>
        <div style={{ display: 'flex', fontSize: 46, color: TEXT, fontWeight: 600 }}>
          Challenge the city. Anywhere.
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: MUTED, fontWeight: 500 }}>
          See who's around. Join what's happening now.
        </div>
      </div>
      <URLFooter path="" />
    </div>
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────
// Node serverless signature (req, res). `req.query` is populated by Vercel's
// runtime; `res` is a Node ServerResponse-shaped object.

export default async function handler(req: any, res: any) {
  const { type, id, slug } = (req.query || {}) as Record<string, string | undefined>;

  let element: any;
  let cacheMaxAge = 60;

  try {
    if (type === 'event' && id) {
      // Accept hex-only or slug-with-trailing-hex; extract the canonical hex.
      const m = id.match(/([a-f0-9]{16})$/i);
      const hex = m ? m[1].toLowerCase() : null;
      if (hex) {
        const data = await fetchJson(`${API_BASE}/api/v1/events/${encodeURIComponent(hex)}`);
        if (data?.event) {
          element = (
            <EventCard
              event={data.event}
              cityName={data.cityName}
              country={data.country}
              timezone={data.timezone}
              eventPath={`/event/${hex}`}
            />
          );
          cacheMaxAge = 300;       // 5 min — attendee counts churn
        }
      }
    } else if (type === 'city' && slug && /^[a-z0-9-]{1,80}$/.test(slug)) {
      const cityData = await fetchJson(`${API_BASE}/api/v1/cities/by-slug/${encodeURIComponent(slug)}`);
      if (cityData?.city) {
        let eventCount  = 0;
        let onlineCount = 0;
        if (cityData.channelId) {
          const list = await fetchJson(`${API_BASE}/api/v1/channels`);
          const ch   = (list?.channels ?? []).find((c: any) => c.channelId === cityData.channelId);
          if (ch) {
            eventCount  = ch.eventCount  ?? 0;
            onlineCount = ch.activeUsers ?? 0;
          }
        }
        element = (
          <CityCard
            city={cityData.city}
            country={cityData.country}
            slug={cityData.slug ?? slug}
            eventCount={eventCount}
            onlineCount={onlineCount}
          />
        );
        cacheMaxAge = 86400;     // 1 day — cities stable
      }
    }
  } catch {
    // fall through to FallbackCard
  }

  if (!element) {
    element = <FallbackCard />;
    cacheMaxAge = 300;
  }

  // ImageResponse returns a Web Response with a streaming body. For Node
  // runtime we read the bytes once and send them via res.end(Buffer).
  const ir  = new ImageResponse(element, { width: W, height: H });
  const buf = Buffer.from(await ir.arrayBuffer());

  res.statusCode = 200;
  res.setHeader('Content-Type',  'image/png');
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${cacheMaxAge}, stale-while-revalidate=86400`);
  res.end(buf);
}
