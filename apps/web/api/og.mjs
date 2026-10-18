/**
 * Vercel serverless function - dynamic OG image generation.
 *
 *   GET /api/og?type=event&id=<16-hex>
 *   GET /api/og?type=city&slug=<kebab>
 *   GET /api/og?type=today&d=<YYYY-MM-DD>   (the /today page's Daily Challenge)
 *   GET /api/og?type=proof&id=<16-hex>      (hilads.live/p/{id}: the share card)
 *   GET /api/og?type=spot&id=<16-hex>       (hilads.live/s/{id})
 *   GET /api/og?type=day&id=<YYYY-MM-DD>    (hilads.live/d/{date})
 *   GET /api/og?ping=1     -> returns the build marker (deploy verification)
 *   GET /api/og?...&debug=1 -> returns the real error+stack on failure (not a 302)
 *
 * Returns a 1200x630 PNG, used as the og:image for shared event / city URLs.
 * WhatsApp, iMessage, Twitter, Slack, etc. fetch this URL directly.
 *
 * WHY .mjs + NO top-level imports + React.createElement (NOT JSX):
 * This started life as api/og.tsx and 500'd with FUNCTION_INVOCATION_FAILED on
 * EVERY request - even ?ping, which does no work. That means the crash was at
 * MODULE LOAD, before the handler ran. On this Vite (non-Next) project, the
 * sibling .mjs functions (sitemap, prerender) load fine but the lone .tsx one
 * never did - Vercel's handling of a .tsx + JSX + top-level-import function here
 * is the unknown. So we remove every variable:
 *   - .mjs  -> Node runs it natively, no TS/JSX compile step.
 *   - no top-level imports -> the module cannot throw at load; the handler
 *     ALWAYS runs (so ?ping / ?debug always work).
 *   - react + @vercel/og imported DYNAMICALLY inside the guarded try, so a
 *     failure there becomes a clean 302 -> static card, never a 500.
 * An og:image must never 500 (a 500 = a broken link preview).
 *
 * OG images are NOT an SEO ranking factor - impact is social-share previews only.
 */

const API_BASE  = process.env.HILADS_API_BASE || 'https://api.hilads.live';  // override: local testing only
const SITE_BASE = 'https://hilads.live';

// Bump on each deploy so `?ping=1` confirms which build is actually live.
const OG_BUILD = 'og-v7-share';

// Brand tokens - kept in sync with apps/web/src/index.css :root vars.
const BG     = '#0d0b09';
const TEXT   = '#ede9e5';
const MUTED  = '#968880';
const MUTED2 = '#635650';
const BORDER = '#272018';
const ACCENT    = '#FF7A3C';   // bright orange (icon glow / dots)
const ACCENT_DR = '#C24A38';   // deep red-orange (CTA)
const ACCENT_AM = '#B87228';   // gradient end

const W = 1200;
const H = 630;

// JSX factory - assigned from the dynamically-imported React at the top of the
// handler (before any card is built). Module-scoped so the builder helpers can
// reference it without threading it through every call.
let h = null;

// ── Data fetcher (1.5 s timeout; null on failure, never throws) ───────────────
async function fetchJson(url, ms = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // themes=2: the themes v2 keys (the API answers v1 keys without it).
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'themes=2', { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────
function formatTime(unixTs, tz) {
  return new Date(unixTs * 1000).toLocaleTimeString('en-US', {
    timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function timeRange(starts, ends, tz) {
  const a = formatTime(starts, tz);
  const b = ends ? ` -> ${formatTime(ends, tz)}` : '';
  return `🕐 ${a}${b}`;
}

function cityFlag(country) {
  if (!country || country.length !== 2) return '';
  const cc = country.toUpperCase();
  return [...cc].map(c => String.fromCodePoint(0x1F1E6 + (c.charCodeAt(0) - 65))).join('');
}

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// ── Shared chrome ─────────────────────────────────────────────────────────────
function HiladsMark(size = 88) {
  const s = (n) => (n * size) / 64;
  return h('div', {
    style: {
      width: size, height: size, borderRadius: s(15),
      background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DR} 50%, ${ACCENT_AM} 100%)`,
      position: 'relative', display: 'flex', flexShrink: 0,
    },
  },
    h('div', { style: { position: 'absolute', left: s(9),  top: s(13), width: s(8),  height: s(38), borderRadius: s(2.5), background: '#fff' } }),
    h('div', { style: { position: 'absolute', left: s(26), top: s(13), width: s(8),  height: s(38), borderRadius: s(2.5), background: '#fff' } }),
    h('div', { style: { position: 'absolute', left: s(17), top: s(28), width: s(9),  height: s(6),  borderRadius: s(2),   background: '#fff' } }),
    h('div', { style: { position: 'absolute', left: s(43), top: s(25), width: s(8),  height: s(26), borderRadius: s(2.5), background: '#fff' } }),
    h('div', { style: { position: 'absolute', left: s(47 - 5.5), top: s(15 - 5.5), width: s(11), height: s(11), borderRadius: s(5.5), background: '#fff' } }),
  );
}

function URLFooter(path) {
  return h('div', {
    style: { position: 'absolute', bottom: 40, right: 50, fontSize: 22, color: MUTED2, fontWeight: 500 },
  }, `hilads.live${path}`);
}

// ── Surface 1: Event card ─────────────────────────────────────────────────────
function EventCard({ event, cityName, country, timezone, eventPath }) {
  const icon  = EVENT_ICONS[event.event_type] ?? '📌';
  const title = event.title;
  const where = event.location || event.venue || cityName || '';
  const when  = event.starts_at ? timeRange(event.starts_at, event.ends_at, timezone) : '';
  const going = event.participant_count ?? 0;
  const flag  = cityFlag(country);

  return h('div', {
    style: {
      width: W, height: H, display: 'flex', flexDirection: 'column',
      background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
      padding: 60, color: TEXT, position: 'relative',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 18 } },
      HiladsMark(72),
      h('div', { style: { display: 'flex', fontSize: 22, color: MUTED2, fontWeight: 600 } }, 'hilads.live'),
    ),
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', {
          style: { display: 'flex', fontSize: 70, lineHeight: 1.05, fontWeight: 800, letterSpacing: -2, color: TEXT, maxHeight: 220, overflow: 'hidden' },
        }, `${icon}  ${title}`),
      ),
      when ? h('div', { style: { display: 'flex', fontSize: 30, color: TEXT, opacity: 0.9 } }, when) : null,
      where ? h('div', {
        style: { display: 'flex', fontSize: 28, color: ACCENT, fontWeight: 600 },
      }, `📍 ${flag ? `${flag}  ` : ''}${where}${cityName && where !== cityName ? `, ${cityName}` : ''}`) : null,
      going > 0 ? h('div', {
        style: {
          alignSelf: 'flex-start', display: 'flex', background: 'rgba(255,122,60,0.15)',
          border: `1.5px solid ${ACCENT}`, borderRadius: 999, padding: '14px 28px',
          fontSize: 28, fontWeight: 700, color: ACCENT, marginTop: 10,
        },
      }, `🙌 ${going} going`) : null,
    ),
    URLFooter(eventPath),
  );
}

// ── Surface 2: City card ──────────────────────────────────────────────────────
function CityCard({ city, country, slug, eventCount, onlineCount }) {
  const flag = cityFlag(country);
  return h('div', {
    style: {
      width: W, height: H, display: 'flex', flexDirection: 'column',
      background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
      padding: 60, color: TEXT, position: 'relative',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 18 } }, HiladsMark(72)),
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 24 } },
        flag ? h('div', { style: { fontSize: 96, display: 'flex' } }, flag) : null,
        h('div', { style: { display: 'flex', fontSize: 96, fontWeight: 800, letterSpacing: -3, color: TEXT } }, city),
      ),
      h('div', { style: { display: 'flex', fontSize: 34, color: MUTED, fontWeight: 500 } }, "What's happening tonight"),
      h('div', { style: { display: 'flex', gap: 20, marginTop: 10 } },
        Stat('🎉', 'events live',    eventCount  > 0 ? String(eventCount)  : '-'),
        Stat('👥', 'here right now', onlineCount > 0 ? String(onlineCount) : '-'),
        Stat('✨', 'real-time',      'LIVE'),
      ),
    ),
    URLFooter(`/city/${slug}`),
  );
}

function Stat(icon, label, value) {
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${BORDER}`, borderRadius: 18, padding: 22, minWidth: 240,
    },
  },
    h('div', { style: { display: 'flex', fontSize: 40, fontWeight: 800, color: TEXT, gap: 10 } },
      h('span', null, icon),
      h('span', null, value),
    ),
    h('div', { style: { display: 'flex', fontSize: 22, color: MUTED, marginTop: 6 } }, label),
  );
}

// ── Surface 3: Challenge card ─────────────────────────────────────────────────
function ChallengeCard({ challenge, cityName, country, targetCityName, targetCountry }) {
  const icon  = EVENT_ICONS[challenge.challenge_type] ?? '🏆';
  const title = challenge.title;
  const intl  = (challenge.mode ?? 'local') === 'international';
  const originFlag = cityFlag(country);
  const targetFlag = cityFlag(targetCountry);
  const going = challenge.participant_count ?? 0;

  // Route line: "🇻🇳 Ho Chi Minh City  →  🇩🇪 Munich" for cross-city, else "📍 city".
  const routeChildren = intl && targetCityName
    ? [
        originFlag ? h('span', { key: 'of' }, `${originFlag} `) : null,
        h('span', { key: 'oc' }, cityName || 'Anywhere'),
        h('span', { key: 'ar', style: { color: ACCENT, margin: '0 6px' } }, ' → '),
        targetFlag ? h('span', { key: 'tf' }, `${targetFlag} `) : null,
        h('span', { key: 'tc' }, targetCityName),
      ].filter(Boolean)
    : [ h('span', { key: 'loc' }, `📍 ${originFlag ? `${originFlag}  ` : ''}${cityName || 'Anywhere'}`) ];

  return h('div', {
    style: {
      width: W, height: H, display: 'flex', flexDirection: 'column',
      background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
      padding: 60, color: TEXT, position: 'relative',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 18 } },
      HiladsMark(72),
      h('div', { style: { display: 'flex', fontSize: 22, color: MUTED2, fontWeight: 600 } }, 'hilads.live'),
    ),
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22 } },
      // "🏆 CHALLENGE" eyebrow so the card reads as a challenge, not an event.
      h('div', {
        style: {
          alignSelf: 'flex-start', display: 'flex', background: 'rgba(255,122,60,0.15)',
          border: `1.5px solid ${ACCENT}`, borderRadius: 999, padding: '8px 20px',
          fontSize: 24, fontWeight: 800, color: ACCENT, letterSpacing: 1,
        },
      }, `🏆 ${intl ? 'CROSS-CITY CHALLENGE' : 'CHALLENGE'}`),
      h('div', {
        style: { display: 'flex', fontSize: 64, lineHeight: 1.05, fontWeight: 800, letterSpacing: -2, color: TEXT, maxHeight: 220, overflow: 'hidden' },
      }, `${icon}  ${title}`),
      h('div', { style: { display: 'flex', fontSize: 34, color: ACCENT, fontWeight: 700 } }, routeChildren),
      going > 0 ? h('div', { style: { display: 'flex', fontSize: 28, color: MUTED, fontWeight: 600 } }, `🙌 ${going} taking it on`) : null,
    ),
    URLFooter(''),
  );
}

// ── Surface 4: Daily Challenge card (/today) ──────────────────────────────────
function TodayCard({ challenge }) {
  return h('div', {
    style: {
      width: W, height: H, display: 'flex', flexDirection: 'column',
      background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
      padding: 60, color: TEXT, position: 'relative',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 18 } },
      HiladsMark(72),
      h('div', { style: { display: 'flex', fontSize: 22, color: MUTED2, fontWeight: 600 } }, 'hilads.live'),
    ),
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 } },
      h('div', {
        style: {
          alignSelf: 'flex-start', display: 'flex', background: 'rgba(255,122,60,0.15)',
          border: `1.5px solid ${ACCENT}`, borderRadius: 999, padding: '8px 20px',
          fontSize: 24, fontWeight: 800, color: ACCENT, letterSpacing: 1,
        },
      }, '🔥 DAILY CHALLENGE'),
      h('div', {
        style: { display: 'flex', fontSize: 62, lineHeight: 1.08, fontWeight: 800, letterSpacing: -2, color: TEXT, maxHeight: 280, overflow: 'hidden' },
      }, challenge.text),
      h('div', { style: { display: 'flex', fontSize: 30, color: MUTED, fontWeight: 600 } }, 'One challenge, the whole world, 24 hours.'),
    ),
    URLFooter('/today'),
  );
}

// ── Sharing V1: proof / spot / day cards (the landscape share card) ───────────
// Photo full-height on the left, the text on the right, and the Hilads footer
// (logo, tagline, hilads.live/<path>) - the 1200x630 sibling of the app's
// 1080x1920 story card.
const PHOTO_W = 520;

function ShareCard({ photo, kicker, title, lines, badge, path }) {
  return h('div', { style: { width: W, height: H, display: 'flex', background: BG, color: TEXT } },
    h('div', { style: { width: PHOTO_W, height: H, display: 'flex', position: 'relative', background: '#1e1812' } },
      photo ? h('img', { src: photo, width: PHOTO_W, height: H, style: { width: PHOTO_W, height: H, objectFit: 'cover' } }) : null,
      badge ? h('div', {
        style: { position: 'absolute', top: 28, left: 28, display: 'flex', padding: '8px 18px', borderRadius: 999,
                 background: '#B98A2E', color: '#fff', fontSize: 26, fontWeight: 800 },
      }, badge) : null,
    ),
    h('div', { style: { flex: 1, height: H, display: 'flex', flexDirection: 'column', padding: '48px 50px 40px' } },
      kicker ? h('div', {
        style: { alignSelf: 'flex-start', display: 'flex', background: 'rgba(255,122,60,0.15)', border: `1.5px solid ${ACCENT}`,
                 borderRadius: 999, padding: '6px 18px', fontSize: 22, fontWeight: 800, color: ACCENT },
      }, kicker) : null,
      h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 } },
        h('div', { style: { display: 'flex', fontSize: title.length > 70 ? 38 : 46, lineHeight: 1.12, fontWeight: 800, letterSpacing: -1, maxHeight: 270, overflow: 'hidden' } }, title),
        ...lines.filter(Boolean).map(l => h('div', { style: { display: 'flex', fontSize: 26, color: MUTED, fontWeight: 600 } }, l)),
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
        HiladsMark(48),
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', fontSize: 22, color: TEXT, fontWeight: 700 } }, 'One local thing. Every day.'),
          h('div', { style: { display: 'flex', fontSize: 20, color: MUTED2, fontWeight: 600 } }, `hilads.live${path}`),
        ),
      ),
    ),
  );
}

function themeKicker(theme, special) {
  const name = theme && theme.key === 'special' && special && special.name ? special.name : theme && theme.name;
  return name ? `Daily Challenge · ${name}` : 'Daily Challenge';
}

/** The bundled cover of a theme (a special day without a cover: its own when bundled, else Only here's). */
function themeCoverUrl(theme, special) {
  if (!theme) return null;
  if (theme.key !== 'special') return `${SITE_BASE}/covers/${theme.key}.jpg`;
  const id = special && special.id ? special.id.replace(/-\d{4}$/, '') : '';
  return `${SITE_BASE}/covers/${['halloween'].includes(id) ? id : 'only_here'}.jpg`;
}

// ── Fallback (homepage / unknown surface) ─────────────────────────────────────
function FallbackCard() {
  return h('div', {
    style: {
      width: W, height: H, display: 'flex', flexDirection: 'column',
      background: `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(194,74,56,0.18) 0%, transparent 60%), ${BG}`,
      padding: 60, color: TEXT, position: 'relative',
    },
  },
    HiladsMark(88),
    h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 } },
      h('div', {
        style: {
          display: 'flex', fontSize: 140, fontWeight: 800, letterSpacing: -4,
          background: `linear-gradient(90deg, ${ACCENT_DR} 0%, ${ACCENT_AM} 100%)`,
          backgroundClip: 'text', color: 'transparent',
        },
      }, 'Hilads'),
      h('div', { style: { display: 'flex', fontSize: 46, color: TEXT, fontWeight: 600 } }, 'One local thing. Every day.'),
      h('div', { style: { display: 'flex', fontSize: 30, color: MUTED, fontWeight: 500 } }, "See who's around. Join what's happening now."),
    ),
    URLFooter(''),
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { type, id, slug, ping, debug } = req.query || {};

  // Deploy-verification probe: returns instantly, touches nothing that can fail.
  // If this 200s with the marker, the new code is live and any remaining error is
  // inside the render path (visible via ?debug=1), not a stale deploy.
  if (ping) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(OG_BUILD);
    return;
  }

  try {
    // Dynamic imports - deferred out of module scope so the module can never
    // crash at load. Any failure here lands in the catch -> 302 static card.
    const ReactMod = await import('react');
    const React = ReactMod.default || ReactMod;
    h = React.createElement;
    const { ImageResponse } = await import('@vercel/og');

    let element = null;
    let cacheMaxAge = 60;

    if (type === 'event' && id) {
      const m = String(id).match(/([a-f0-9]{16})$/i);
      const hex = m ? m[1].toLowerCase() : null;
      if (hex) {
        const data = await fetchJson(`${API_BASE}/api/v1/events/${encodeURIComponent(hex)}`);
        if (data?.event) {
          element = EventCard({
            event: data.event, cityName: data.cityName, country: data.country,
            timezone: data.timezone, eventPath: `/event/${hex}`,
          });
          cacheMaxAge = 300;   // 5 min - attendee counts churn
        }
      }
    } else if (type === 'challenge' && id) {
      const m = String(id).match(/([a-f0-9]{16})$/i);
      const hex = m ? m[1].toLowerCase() : null;
      if (hex) {
        const data = await fetchJson(`${API_BASE}/api/v1/challenges/${encodeURIComponent(hex)}`);
        if (data?.challenge) {
          element = ChallengeCard({
            challenge: data.challenge, cityName: data.cityName, country: data.country,
            targetCityName: data.targetCityName, targetCountry: data.targetCountry,
          });
          cacheMaxAge = 1800;  // 30 min - challenges churn slowly
        }
      }
    } else if (type === 'today') {
      // d pins the date, so the image never changes once rendered: cache it a day.
      const d = typeof req.query.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.d) ? req.query.d : null;
      const data = await fetchJson(d
        ? `${API_BASE}/api/v1/daily/challenges/${d}?limit=1`
        : `${API_BASE}/api/v1/daily/today`);
      if (data?.challenge?.text) {
        element = TodayCard({ challenge: data.challenge });
        cacheMaxAge = d ? 86400 : 300;
      }
    } else if (type === 'proof' && id && /^[a-f0-9]{16}$/.test(id)) {
      const data = await fetchJson(`${API_BASE}/api/v1/daily/proofs/${id}/share`);
      if (data?.challenge) {
        const p = data.proof;
        const rank = p && p.worldRank && p.worldRank <= 3 ? `#${p.worldRank} in the world`
          : p && p.cityRank && p.cityRank <= 3 && p.city ? `#${p.cityRank} in ${p.city.name}` : null;
        element = ShareCard({
          // A proof in review never shows its photo: the challenge's cover instead.
          photo: p ? p.photoUrl : (data.challenge.coverUrl || themeCoverUrl(data.challenge.theme, data.challenge.special)),
          kicker: themeKicker(data.challenge.theme, data.challenge.special),
          title: data.challenge.text,
          lines: p ? [p.city ? `${cityFlag(p.city.country)} ${p.city.name}` : null, p.user?.username ? `@${p.user.username} · ♥ ${p.voteCount}` : null] : [],
          badge: rank, path: `/p/${id}`,
        });
        cacheMaxAge = p ? 300 : 60;
      }
    } else if (type === 'spot' && id && /^[a-f0-9]{16}$/.test(id)) {
      const data = await fetchJson(`${API_BASE}/api/v1/spots/${id}`);
      if (data?.spot) {
        const sp = data.spot;
        element = ShareCard({
          photo: sp.cover?.photoUrl || null, kicker: 'Hilads spot', title: sp.name,
          lines: [sp.city ? `${cityFlag(sp.city.country)} ${sp.city.name}` : null, `♥ ${sp.votes}`, sp.cover?.by ? `Photo by @${sp.cover.by}` : null],
          badge: null, path: `/s/${id}`,
        });
        cacheMaxAge = 300;
      }
    } else if (type === 'day' && id && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
      const data = await fetchJson(`${API_BASE}/api/v1/daily/challenges/${id}?scope=world&limit=30`);
      if (data?.challenge?.text) {
        const best = (data.proofs || []).slice().sort((a, b) => b.voteCount - a.voteCount)[0];
        element = ShareCard({
          photo: best?.photoUrl || data.challenge.coverUrl || themeCoverUrl(data.challenge.theme, data.challenge.special),
          kicker: themeKicker(data.challenge.theme, data.challenge.special), title: data.challenge.text,
          lines: [new Date(`${data.challenge.date}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })],
          badge: null, path: `/d/${id}`,
        });
        cacheMaxAge = data.challenge.isActive ? 300 : 3600;
      }
    } else if (type === 'city' && slug && /^[a-z0-9-]{1,80}$/.test(slug)) {
      const cityData = await fetchJson(`${API_BASE}/api/v1/cities/by-slug/${encodeURIComponent(slug)}`);
      if (cityData?.city) {
        let eventCount = 0;
        let onlineCount = 0;
        if (cityData.channelId) {
          const list = await fetchJson(`${API_BASE}/api/v1/channels`);
          const ch = (list?.channels ?? []).find(c => c.channelId === cityData.channelId);
          if (ch) {
            eventCount  = ch.eventCount  ?? 0;
            onlineCount = ch.activeUsers ?? 0;
          }
        }
        element = CityCard({
          city: cityData.city, country: cityData.country,
          slug: cityData.slug ?? slug, eventCount, onlineCount,
        });
        cacheMaxAge = 86400;   // 1 day - cities stable
      }
    }

    if (!element) {
      element = FallbackCard();
      cacheMaxAge = 300;
    }

    const ir  = new ImageResponse(element, { width: W, height: H });
    const buf = Buffer.from(await ir.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type',  'image/png');
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${cacheMaxAge}, stale-while-revalidate=86400`);
    res.end(buf);
  } catch (err) {
    console.error('[og] failed:', String(err));
    // ?debug=1 surfaces the real error+stack as text so a curl can see WHY it
    // failed. Normal (scraper) requests get the 302 fallback to a valid preview.
    if (debug) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`[og ${OG_BUILD}] failed:\n${(err && err.stack) || String(err)}`);
      return;
    }
    res.statusCode = 302;
    res.setHeader('Location',      `${SITE_BASE}/og/og-default.png`);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.end();
  }
}
