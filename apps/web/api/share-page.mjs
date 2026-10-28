/**
 * Shared-content pages (sharing V1): hilads.live/p/{proofId}, /s/{spotId} and
 * /d/{YYYY-MM-DD}, each also under a locale prefix (/fr/p/...).
 *
 * With the app installed these links open it (Universal Links / App Links)
 * on the proof, the spot or the day's challenge. This page is for everyone
 * else, readable without an account: the content, then the same "Open in the
 * app" / store / join CTAs as /today. A proof still in moderation shows "being
 * reviewed" with its day's challenge (never an unapproved photo).
 *
 * Server-rendered for link previews: og:image is the landscape share card
 * (/api/og?type=proof|spot|day). Standalone (no app bundle), the same daylight
 * style as /today. UI strings: SHARE_STRINGS + TODAY_STRINGS in the path's
 * locale (bare paths: English, the browser language is not guessed so the
 * CDN copy stays one per path). PostHog: link_opened and link_cta, with the
 * share link's utm_source.
 */

import { API_BASE } from './_daily.mjs'
import { TODAY_STRINGS } from './_today-i18n.mjs'
import { SHARE_STRINGS } from './_share-i18n.mjs'

const SITE = 'https://hilads.live'
const LOCALES = Object.keys(SHARE_STRINGS)
const HEX16 = /^[a-f0-9]{16}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
function inlineJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) }

async function fetchJson(url, ms = 2500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    // themes=2: the themes v2 keys (the API answers v1 keys without it); themesRev=4: get_around.
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'themes=2&themesRev=4', { headers: { accept: 'application/json' }, signal: ctrl.signal })
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function flagImg(country) {
  return country && /^[A-Za-z]{2}$/.test(country)
    ? `<img class="flag" src="/flags/${country.toLowerCase()}.svg" alt="" width="16" height="12" />` : ''
}
const HEART = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3.4.6 1.6.6 2 0C13.2 6.1 14.6 5 16.6 5 20 5 22.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg>'

/** Load the page's data: { kind, state, ...content } or null (not found). */
async function load(type, id, locale) {
  const q = `locale=${encodeURIComponent(locale)}`
  if (type === 'p' && HEX16.test(id)) {
    const d = await fetchJson(`${API_BASE}/api/v1/daily/proofs/${id}/share?${q}`)
    return d && d.challenge ? { kind: 'proof', state: d.state, challenge: d.challenge, proof: d.proof } : null
  }
  if (type === 's' && HEX16.test(id)) {
    const d = await fetchJson(`${API_BASE}/api/v1/spots/${id}?${q}`)
    return d && d.spot ? { kind: 'spot', state: 'live', spot: d.spot, photos: (d.photos && d.photos.items) || [] } : null
  }
  if (type === 'd' && DATE.test(id)) {
    const d = await fetchJson(`${API_BASE}/api/v1/daily/challenges/${id}?scope=world&limit=30&${q}`)
    if (!d || !d.challenge) return null
    const best = (d.proofs || []).slice().sort((a, b) => b.voteCount - a.voteCount || b.approvedAt - a.approvedAt).slice(0, 9)
    return { kind: 'day', state: 'live', challenge: d.challenge, proofs: best }
  }
  return null
}

/** A theme in the page's language; a special day: its own name (Halloween). */
function themeLabel(theme, SS, special) {
  if (theme && theme.key === 'special') return special && special.name ? special.name : (SS.themes.special || 'Special')
  return theme && theme.key ? (SS.themes[theme.key] || theme.name) : null
}

function dateLabel(date, locale) {
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  } catch {
    return date
  }
}

/** The page's main block for its content. */
function body(data, S, SS, locale) {
  if (!data) {
    return `<section class="card"><h1>${esc(SS.notFound)}</h1><a class="link" href="/today">${esc(SS.seeToday)}</a></section>`
  }
  const c = data.challenge
  // The theme and the comparison question ("Drinks · How do locals say cheers?"), then the challenge.
  const head = c ? [themeLabel(c.theme, SS, c.special), c.compare && c.compare.question].filter(Boolean).join(' · ') : ''
  const challenge = c ? `
      ${head ? `<div class="theme">${esc(head)}</div>` : ''}
      <h1>${esc(c.text)}</h1>` : ''

  if (data.kind === 'proof' && data.state === 'review') {
    return `<section class="card">
      <div class="kicker">Daily Challenge</div>
      <p class="review"><b>${esc(SS.review)}</b><br />${esc(SS.reviewSub)}</p>${challenge}
    </section>`
  }
  if (data.kind === 'proof') {
    const p = data.proof
    const rank = p.worldRank && p.worldRank <= 3 ? fmt(SS.rankWorld, { rank: p.worldRank })
      : p.cityRank && p.cityRank <= 3 && p.city ? fmt(SS.rankCity, { rank: p.cityRank, city: p.city.name }) : null
    return `<figure class="photo"><img src="${esc(p.photoUrl)}" alt="${esc(p.caption || '')}" />${rank ? `<span class="rank">${esc(rank)}</span>` : ''}</figure>
    <section class="card">
      <div class="kicker">Daily Challenge</div>${challenge}
      <div class="meta">${p.city ? `<span>${flagImg(p.city.country)}${esc(p.city.name)}</span>` : ''}${p.user && p.user.username ? `<span>${esc(fmt(SS.by, { user: p.user.username }))}</span>` : ''}<span>${HEART}${p.voteCount}</span></div>
      ${p.caption ? `<p class="caption">“${esc(p.caption)}”</p>` : ''}
    </section>`
  }
  if (data.kind === 'spot') {
    const s = data.spot
    const grid = data.photos.slice(0, 9).map(ph => `<img src="${esc(ph.thumbUrl || ph.photoUrl)}" alt="" loading="lazy" />`).join('')
    return `${s.cover && s.cover.photoUrl ? `<figure class="photo"><img src="${esc(s.cover.photoUrl)}" alt="" />${s.cover.by ? `<span class="credit">${esc(fmt(SS.photoBy, { user: s.cover.by }))}</span>` : ''}</figure>` : ''}
    <section class="card">
      <h1>${esc(s.name)}</h1>
      <div class="meta">${s.city ? `<span>${flagImg(s.city.country)}${esc(s.city.name)}</span>` : ''}<span>${HEART}${s.votes}</span></div>
      ${grid ? `<div class="grid-title">${esc(SS.spotPhotos)}</div><div class="grid">${grid}</div>` : ''}
    </section>`
  }
  // day
  const grid = data.proofs.map(p => `<img src="${esc(p.thumbUrl || p.photoUrl)}" alt="" loading="lazy" />`).join('')
  return `<section class="card">
      <div class="kicker">${esc(fmt(SS.dayOf, { date: dateLabel(c.date, locale) }))}</div>${challenge}
      ${grid ? `<div class="grid-title">${esc(SS.best)}</div><div class="grid">${grid}</div>` : ''}
    </section>`
}

export function renderShare(type, id, data, locale) {
  const S = TODAY_STRINGS[locale] || TODAY_STRINGS.en
  const SS = SHARE_STRINGS[locale] || SHARE_STRINGS.en
  const path = `/${type}/${id}`
  const canonical = `${SITE}${path}`
  const kind = data ? data.kind : null
  const ogType = { proof: 'proof', spot: 'spot', day: 'day' }[kind]
  const image = data ? `${SITE}/api/og?type=${ogType}&id=${encodeURIComponent(id)}` : `${SITE}/og/og-default.png`
  const c = data && data.challenge
  const title = !data ? 'Hilads'
    : kind === 'spot' ? `${data.spot.name}${data.spot.city ? ` · ${data.spot.city.name}` : ''} - Hilads`
    : c ? `Daily Challenge: ${c.text}` : 'Hilads'
  const description = S.tag
  const appPath = `${type}/${id}`
  const boot = { kind, id, state: data ? data.state : 'not_found', locale, appPath }

  return `<!doctype html>
<html lang="${esc(locale)}"${locale === 'ar' ? ' dir="rtl"' : ''}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#FBF6F0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Hilads" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <meta name="apple-itunes-app" content="app-id=6768905591, app-argument=${esc(canonical)}" />
  <style>
    :root{ --bg:#FBF6F0; --surface:#FFFFFF; --surface2:#F3EAE0; --accent:#C24A38; --primary:#C9501A;
      --text:#241A12; --muted:#6E5D4E; --line:#EADDD0; color-scheme:light; }
    *{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    html,body{ margin:0; padding:0; }
    body{ min-height:100svh; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
    .wrap{ max-width:440px; margin:0 auto; min-height:100svh; display:flex; flex-direction:column; align-items:stretch; gap:14px;
      padding:calc(14px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }
    .brandrow{ display:flex; align-items:center; gap:7px; justify-content:center; }
    .brandrow svg{ display:block; }
    .brandrow .name{ font-weight:700; font-size:16px; letter-spacing:-.3px; }
    .brandrow .tag{ color:var(--muted); font-size:12px; padding-inline-start:8px; border-inline-start:1px solid rgba(28,20,14,.14); }
    .photo{ position:relative; margin:0; border-radius:22px; overflow:hidden; background:var(--surface2); }
    .photo img{ display:block; width:100%; max-height:70svh; object-fit:cover; }
    .rank{ position:absolute; top:12px; left:12px; padding:5px 12px; border-radius:999px; background:#B98A2E; color:#fff; font-size:13px; font-weight:800; }
    .credit{ position:absolute; left:10px; bottom:10px; padding:3px 9px; border-radius:999px; background:rgba(0,0,0,.58); color:#fff; font-size:12px; font-weight:700; }
    .card{ padding:20px 18px; border-radius:22px; background:var(--surface); border:1px solid var(--line); box-shadow:0 8px 28px rgba(28,20,14,.08);
      display:flex; flex-direction:column; gap:10px; }
    .kicker{ font-size:13px; font-weight:800; color:var(--muted); }
    .theme{ align-self:flex-start; font-size:13px; font-weight:800; background:var(--surface2); border-radius:999px; padding:5px 12px; }
    h1{ margin:0; font-weight:800; letter-spacing:-.4px; line-height:1.2; font-size:clamp(21px,6vw,26px); text-wrap:balance; }
    .meta{ display:flex; flex-wrap:wrap; gap:6px 14px; color:var(--muted); font-size:14px; font-weight:600; }
    .meta span{ display:inline-flex; align-items:center; gap:5px; }
    .flag{ border-radius:2px; box-shadow:0 0 0 1px rgba(42,28,19,.2); }
    .ico{ width:15px; height:15px; }
    .caption{ margin:0; font-size:15px; line-height:1.45; }
    .review{ margin:0; padding:12px; border-radius:14px; background:var(--bg); font-size:14px; line-height:1.45; color:var(--muted); }
    .review b{ color:var(--text); font-size:16px; }
    .grid-title{ margin-top:6px; font-size:14px; font-weight:800; }
    .grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:4px; border-radius:12px; overflow:hidden; }
    .grid img{ width:100%; aspect-ratio:1; object-fit:cover; display:block; background:var(--surface2); }
    .link{ color:var(--text); font-weight:700; }
    .ctas{ display:flex; flex-direction:column; gap:11px; margin-top:4px; }
    .stores{ display:flex; flex-direction:column; gap:11px; }
    a.btn{ display:flex; align-items:center; justify-content:center; gap:10px; min-height:56px; padding:0 18px; border-radius:16px;
      text-decoration:none; font-weight:700; font-size:16px; color:#fff; background:#1E150F; }
    a.btn small{ display:block; font-weight:500; font-size:11px; opacity:.7; line-height:1; margin-bottom:2px; }
    a.btn .lbl{ text-align:left; line-height:1.05; }
    a.open{ background:var(--primary); }
    a.web{ background:var(--surface); color:var(--text); border:1.5px solid var(--line); }
    a.btn:active{ transform:scale(.98); }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brandrow">
      <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
        <defs><linearGradient id="hig" x1="5%" y1="0%" x2="95%" y2="100%"><stop offset="0%" stop-color="#C24A38"/><stop offset="44%" stop-color="#B85530"/><stop offset="100%" stop-color="#B87228"/></linearGradient></defs>
        <rect width="64" height="64" rx="15" fill="url(#hig)"/>
        <rect x="9" y="13" width="8" height="38" rx="2.5" fill="#fff"/><rect x="26" y="13" width="8" height="38" rx="2.5" fill="#fff"/>
        <rect x="17" y="28" width="9" height="6" rx="2" fill="#fff"/><rect x="43" y="25" width="8" height="26" rx="2.5" fill="#fff"/>
        <circle cx="47" cy="15" r="5.5" fill="#fff"/>
      </svg>
      <span class="name">hilads</span>
      <span class="tag">${esc(S.tag)}</span>
    </div>

    ${body(data, S, SS, locale)}

    <div class="ctas">
      <a class="btn open" id="cta-open" href="hilads://${esc(appPath)}" hidden>${esc(S.open)}</a>
      <div class="stores" id="stores">
        <a class="btn" id="cta-ios" href="https://apps.apple.com/app/id6768905591" rel="noopener">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M16.365 1.43c0 1.14-.417 2.2-1.11 3.02-.83.98-2.19 1.74-3.32 1.65-.14-1.1.42-2.27 1.08-3.02.75-.85 2.06-1.5 3.35-1.65zM20.5 17.02c-.55 1.27-.81 1.83-1.52 2.95-.99 1.57-2.39 3.52-4.12 3.53-1.54.02-1.94-.99-4.03-.98-2.09.01-2.53 1-4.07.97-1.73-.02-3.05-1.79-4.04-3.36C-.19 16.6-.46 11.5 1.4 8.79c1.05-1.55 2.71-2.53 4.28-2.53 1.6 0 2.61 1 3.93 1 1.28 0 2.06-1 3.91-1 1.4 0 2.88.76 3.94 2.08-3.46 1.9-2.9 6.84.14 8.68z"/></svg>
          <span class="lbl"><small>${esc(S.ios)}</small>App Store</span>
        </a>
        <a class="btn" id="cta-android" href="https://play.google.com/store/apps/details?id=com.hilads.app" rel="noopener">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#34A853" d="M3.6 2.2 13 11.6l2.6-2.6z"/><path fill="#EA4335" d="M3.05 1.9c-.28.2-.45.5-.45.9v18.4c0 .4.17.7.45.9L13 11.6z" opacity=".9"/><path fill="#4285F4" d="M3.6 21.8 15.6 15l-2.6-2.6z"/><path fill="#FBBC05" d="M18.9 10.1 15.6 8.2 12.7 11l2.9 2.9 3.3-1.9c.9-.5.9-1.4 0-1.9z"/></svg>
          <span class="lbl"><small>${esc(S.android)}</small>Google Play</span>
        </a>
      </div>
      <a class="btn web" id="cta-web" href="/?auth=signup" rel="noopener">${esc(S.web)}</a>
    </div>
  </main>

  <script>window.__SHARE = ${inlineJson(boot)};</script>
  <script>
  (function () {
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister getFeatureFlag isFeatureEnabled reloadFeatureFlags identify setPersonProperties reset get_distinct_id opt_in_capturing opt_out_capturing set_config".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('phc_zz4Q6VJETesgBUkeKe8a9asUwbra9qGXgw4ff6zPTxLM', {
      api_host: 'https://hi.hilads.live', ui_host: 'https://eu.posthog.com',
      autocapture: false, capture_pageleave: false, disable_session_recording: true, disable_toolbar: true,
    });
    function cap(ev, props){ try { posthog.capture(ev, props); } catch (e) {} }
    function $(id){ return document.getElementById(id); }
    var B = window.__SHARE || {};

    /* UTM passthrough: super props + the signup CTA. */
    var KEEP = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','ttclid','ref'];
    var sp = new URLSearchParams(location.search), pass = new URLSearchParams(), sup = {};
    KEEP.forEach(function (k) { var v = sp.get(k); if (v) { pass.set(k, v); sup[k] = v; } });
    if (Object.keys(sup).length) { try { posthog.register(sup); } catch (e) {} }
    $('cta-web').setAttribute('href', '/?auth=signup' + (pass.toString() ? '&' + pass.toString() : ''));

    var ua = navigator.userAgent || '';
    var isAndroid = /android/i.test(ua), isMobile = /android|iphone|ipad|ipod/i.test(ua);
    var IN_APP_RE = /\\b(Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\\/|MicroMessenger|Snapchat|Twitter|TikTok|KAKAOTALK)\\b/i;
    if (isAndroid) $('stores').insertBefore($('cta-android'), $('cta-ios'));
    var appUrl = isAndroid
      ? 'intent://' + B.appPath + '#Intent;scheme=hilads;package=com.hilads.app;S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end'
      : 'hilads://' + B.appPath;
    if (isMobile && B.kind) {
      $('cta-open').setAttribute('href', appUrl);
      $('cta-open').hidden = false;
      // In-app browsers swallow Universal / App Links: bounce to the app, as on /today.
      if (IN_APP_RE.test(ua)) setTimeout(function () { try { location.href = appUrl; } catch (e) {} }, 400);
    }

    cap('link_opened', {
      content_type: B.kind || 'not_found', content_id: B.id, state: B.state, locale: B.locale,
      utm_source: sp.get('utm_source') || null, in_app_browser: IN_APP_RE.test(ua), source: 'web',
    });

    function wire(id, target){
      var el = $(id);
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var url = el.getAttribute('href');
        cap('link_cta', { target: target, content_type: B.kind || 'not_found', content_id: B.id, utm_source: sp.get('utm_source') || null });
        setTimeout(function () { location.href = url; }, 140);
      });
    }
    wire('cta-open', 'open_app');
    wire('cta-ios', 'appstore');
    wire('cta-android', 'playstore');
    wire('cta-web', 'web_signup');
  })();
  </script>
</body>
</html>`
}

export default async function handler(req, res) {
  const q = req.query || {}
  const type = ['p', 's', 'd'].includes(q.type) ? q.type : null
  const rawId = String(q.id || '').toLowerCase()
  const id = HEX16.test(rawId) || DATE.test(rawId) ? rawId : ''
  const raw = String(q.locale || '').toLowerCase()
  const locale = raw && LOCALES.includes(raw) ? raw : 'en'

  const data = type ? await load(type, id, locale) : null
  // Votes and moderation move: proofs and spots 5 min, a "being reviewed" page
  // 1 min, a past day 1 h (today's 5 min), not found 1 min.
  const ttl = !data ? 60 : data.state === 'review' ? 60
    : data.kind === 'day' && data.challenge && !data.challenge.isActive ? 3600 : 300
  res.statusCode = data ? 200 : 404
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=60`)
  res.end(renderShare(type || 'p', id, data, locale))
}
