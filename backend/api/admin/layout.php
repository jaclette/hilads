<?php

declare(strict_types=1);

/**
 * The back office shell: <head> (one stylesheet, one script), the grouped sidebar with counts,
 * and the top bar (search, environment, theme, my account). Pages keep calling
 * admin_head($title) → admin_nav($current) → their content → admin_foot().
 */

function admin_asset(string $name): string
{
    $file = __DIR__ . '/assets/' . $name;
    return '/admin/assets/' . $name . '?v=' . (is_file($file) ? filemtime($file) : '0');
}

function admin_head(string $title): void
{
    global $uri;
    header('Content-Type: text/html; charset=utf-8');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    $archive = isset($uri) && class_exists('AdminAuth') && AdminAuth::area((string) $uri) === 'archive';
    echo '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>' . htmlspecialchars($title, ENT_QUOTES) . ' · Hilads Admin</title>
<script>try{var t=localStorage.getItem("admin_theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="' . admin_asset('admin.css') . '">
<script src="' . admin_asset('admin.js') . '" defer></script>
<script>
// Shared searchable-city picker (user_create.php / user_edit.php). `cities` = [{name, country}].
function initCityPickers(cities) {
    if (!Array.isArray(cities) || cities.length === 0) return;
    const MAX_RESULTS = 100;
    function flagEmoji(cc) {
        if (!cc || cc.length !== 2) return "";
        const A = "A".charCodeAt(0);
        return String.fromCodePoint(0x1F1E6 + cc.toUpperCase().charCodeAt(0) - A, 0x1F1E6 + cc.toUpperCase().charCodeAt(1) - A);
    }
    document.querySelectorAll(".city-picker").forEach(function (picker) {
        const search  = picker.querySelector(".city-picker-search");
        const hidden  = picker.querySelector("input[type=\"hidden\"]");
        const options = picker.querySelector(".city-picker-options");
        if (!search || !hidden || !options) return;
        let activeIdx = -1;
        function render(query) {
            const q = (query || "").trim().toLowerCase();
            const list = q === "" ? cities.slice(0, MAX_RESULTS)
                : cities.filter(function (c) { return (c.name || "").toLowerCase().indexOf(q) !== -1; }).slice(0, MAX_RESULTS);
            options.innerHTML = list.length === 0 ? "<li class=\"city-picker-empty\">No matches</li>" : list.map(function (c) {
                const safe = (c.name || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
                return "<li data-city=\"" + safe + "\"><span class=\"city-picker-flag\">" + flagEmoji(c.country || "") + "</span>" + safe + "</li>";
            }).join("");
            options.hidden = false;
            activeIdx = -1;
        }
        function setActive(idx) {
            const items = options.querySelectorAll("li[data-city]");
            items.forEach(function (li) { li.classList.remove("active"); });
            if (idx < 0 || idx >= items.length) { activeIdx = -1; return; }
            activeIdx = idx;
            items[idx].classList.add("active");
            items[idx].scrollIntoView({ block: "nearest" });
        }
        function commit(city) { search.value = city; hidden.value = city; options.hidden = true; }
        search.addEventListener("focus",  function () { render(search.value); });
        search.addEventListener("input",  function () { render(search.value); hidden.value = search.value; });
        search.addEventListener("blur",   function () { setTimeout(function () { options.hidden = true; }, 150); });
        search.addEventListener("keydown", function (e) {
            const items = options.querySelectorAll("li[data-city]");
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
            else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); commit(items[activeIdx].dataset.city); }
            else if (e.key === "Escape") { options.hidden = true; activeIdx = -1; }
        });
        options.addEventListener("mousedown", function (e) {
            const li = e.target.closest("li[data-city]");
            if (!li) return;
            e.preventDefault();
            commit(li.dataset.city);
        });
    });
}
</script>
</head>
<body' . ($archive ? ' class="is-archive"' : '') . '>
';
}

/** Proposals waiting for a review (challenges + Local Twists), once per request. */
function admin_pending_proposals(): int
{
    return admin_badges()['proposals'] ?? 0;
}

/** The sidebar counts, one cached read (30 s) for every page. */
function admin_badges(): array
{
    static $b = null;
    if ($b !== null) return $b;
    $b = Cache::remember('admin_nav_badges', 30, function (): array {
        $n = fn (callable $f): int => (function () use ($f) { try { return (int) $f(); } catch (\Throwable) { return 0; } })();
        return [
            'proposals' => $n(fn () => class_exists('DailyProposals') ? DailyProposals::pendingCount() : 0),
            'photos'    => $n(fn () => class_exists('PhotoWatch') ? PhotoWatch::unseenCount() : 0),
            'cities'    => $n(fn () => CityAdmin::newAutoCount()),
            // Open reports of every kind on the Reports page: players, chat messages (text), photo comments.
            'reports'   => $n(fn () => Database::pdo()->query("SELECT count(*) FROM user_reports WHERE status = 'open'")->fetchColumn())
                         + $n(fn () => Database::pdo()->query("SELECT count(DISTINCT r.message_id) FROM message_reports r JOIN messages m ON m.id = r.message_id AND m.type = 'text' WHERE r.status = 'open'")->fetchColumn())
                         + $n(fn () => Database::pdo()->query("SELECT count(DISTINCT r.comment_id) FROM photo_comment_reports r JOIN photo_comments c ON c.id = r.comment_id AND c.deleted_at IS NULL WHERE r.status = 'open'")->fetchColumn()),
        ];
    }) ?? [];
    return $b;
}

/** Drop the cached counts after an action that changes them (photo seen, report handled…). */
function admin_badges_changed(): void
{
    Cache::forget('admin_nav_badges');
}

/** Inline icons (24×24 stroke), so the sidebar needs no icon font or emoji. */
function admin_icon(string $name): string
{
    static $p = [
        'home'     => '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
        'calendar' => '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
        'star'     => '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
        'question' => '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
        'image'    => '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
        'flag'     => '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
        'message'  => '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
        'ban'      => '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
        'users'    => '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
        'city'     => '<path d="M3 21h18M5 21V8l5-3v16M10 21V3l9 4v14M14 9h2M14 13h2M14 17h2"/>',
        'plan'     => '<path d="M8 2v4M16 2v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 14l3 3 5-6"/>',
        'pin'      => '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
        'scales'   => '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
        'trophy'   => '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4"/>',
        'shield'   => '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
        'bell'     => '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>',
        'mail'     => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
        'film'     => '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
        'clapper'  => '<path d="M4 9h16v11H4zM4 9l2-5 14 0-2 5M9 4l-2 5M15 4l-2 5"/>',
        'phone'    => '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
        'cog'      => '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        'list'     => '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
        'alert'    => '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
        'box'      => '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
        'zap'      => '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
        'door'     => '<path d="M14 3h5v18h-5M10 17l5-5-5-5M15 12H3"/>',
        'search'   => '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
        'sun'      => '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
        'menu'     => '<path d="M4 6h16M4 12h16M4 18h16"/>',
        'logout'   => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    ];
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         . ($p[$name] ?? '') . '</svg>';
}

/**
 * The sidebar: [group key, label, items]; item = [href, label, icon, match regex, badge key].
 * An item shows only when the signed-in role may open its page.
 */
function admin_menu(): array
{
    return [
        ['today', 'Today', [
            ['/admin', 'Dashboard', 'home', '#^/admin/?$#', null],
            ['/admin/daily', 'Daily challenges', 'calendar', '#^/admin/daily(?!/(specials|events|spots|picks|promo))#', 'proposals'],
            ['/admin/daily/specials', 'Special days & events', 'star', '#^/admin/daily/(specials|events)#', null],
            ['/admin/hi-questions', 'Hi questions', 'question', '#^/admin/hi-questions#', null],
        ]],
        ['moderation', 'Moderation', [
            ['/admin/photos', 'Photos', 'image', '#^/admin/photos#', 'photos'],
            ['/admin/reports', 'Reports', 'flag', '#^/admin/reports#', 'reports'],
            ['/admin/messages', 'Messages', 'message', '#^/admin/messages#', null],
            ['/admin/bans', 'Bans', 'ban', '#^/admin/bans#', null],
        ]],
        ['community', 'Community', [
            ['/admin/users', 'Users', 'users', '#^/admin/users#', null],
            ['/admin/cities', 'Cities', 'city', '#^/admin/cities#', 'cities'],
            ['/admin/events', 'Hi plan & Hi now', 'plan', '#^/admin/(events|topics)#', null],
            ['/admin/daily/spots', 'Places', 'pin', '#^/admin/daily/(spots|picks)#', null],
        ]],
        ['game', 'Game', [
            ['/admin/scoring', 'Scoring', 'scales', '#^/admin/scoring#', null],
            ['/admin/launch-season', 'Seasons', 'trophy', '#^/admin/launch-season#', null],
            ['/admin/scoring#fair-play', 'Fair play', 'shield', '#^$#', null],
        ]],
        ['growth', 'Growth', [
            ['/admin/push', 'Push', 'bell', '#^/admin/push#', null],
            ['/admin/email', 'Email', 'mail', '#^/admin/email#', null],
            ['/admin/worlds', 'Worlds studio', 'film', '#^/admin/worlds#', null],
            ['/admin/daily/promo', 'Promo', 'clapper', '#^/admin/daily/promo#', null],
        ]],
        ['system', 'System', [
            ['/admin/app-versions', 'App versions & switches', 'phone', '#^/admin/app-versions#', null],
            ['/admin/settings', 'Settings', 'cog', '#^/admin/settings#', null],
            ['/admin/audit', 'Audit log', 'list', '#^/admin/audit#', null],
            ['/admin/danger', 'Danger zone', 'alert', '#^/admin/danger#', null],
        ]],
        ['archive', 'Archive', [
            ['/admin/challenges', 'Old challenges', 'box', '#^/admin/challenges#', null],
            ['/admin/campaigns', 'Campaigns', 'zap', '#^/admin/campaigns#', null],
            ['/admin/arrivals', 'Arrivals', 'door', '#^/admin/arrivals#', null],
        ]],
    ];
}

function admin_nav(string $current = ''): void
{
    global $uri;
    if (!admin_is_logged_in()) return;
    $GLOBALS['admin_shell_open'] = true;
    $path   = (string) ($uri ?? $current);
    $role   = AdminAuth::role();
    $badges = admin_badges();
    $e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES);

    echo '<div class="shell"><aside class="sidebar" aria-label="Back office">';
    echo '<a class="brand" href="/admin"><span class="brand-mark">Hi</span><span>Hilads<small>Back office</small></span></a>';
    foreach (admin_menu() as [$key, $label, $items]) {
        $html = '';
        $groupCount = 0;
        $hasCurrent = false;
        foreach ($items as [$href, $text, $icon, $match, $badgeKey]) {
            if (!AdminAuth::canView($role, AdminAuth::area(strtok($href, '#?')))) continue;
            $isCurrent = preg_match($match, $path) === 1;
            $hasCurrent = $hasCurrent || $isCurrent;
            $n = $badgeKey ? (int) ($badges[$badgeKey] ?? 0) : 0;
            $groupCount += $n;
            $count = $n > 0 ? '<span class="count' . ($badgeKey === 'cities' ? ' quiet' : '') . '">' . ($n > 99 ? '99+' : $n) . '</span>' : '';
            $to = $badgeKey === 'cities' && $n > 0 ? '/admin/cities?view=auto' : $href;
            $html .= '<a href="' . $e($to) . '"' . ($isCurrent ? ' aria-current="page"' : '') . ' title="' . $e($text) . '">'
                   . admin_icon($icon) . '<span class="lbl">' . $e($text) . '</span>' . $count . '</a>';
        }
        if ($html === '') continue;
        $open = $key !== 'archive' || $hasCurrent;
        echo '<details class="navgroup" data-group="' . $key . '"' . ($open ? ' open' : '') . '><summary>' . $e($label)
           . ($groupCount > 0 ? '<span class="gcount">' . ($groupCount > 99 ? '99+' : $groupCount) . '</span>' : '')
           . '</summary><nav class="nav">' . $html . '</nav></details>';
    }
    echo '</aside><div class="main">';

    $u = AdminAuth::user();
    $initials = mb_strtoupper(mb_substr((string) $u['name'], 0, 1));
    $isProd = (getenv('APP_ENV') ?: '') === 'production';
    echo '<header class="topbar">'
       . '<button type="button" class="icon-btn menu-btn" data-menu aria-label="Menu">' . admin_icon('menu') . '</button>'
       . '<form class="search" method="GET" action="/admin/search" role="search">' . admin_icon('search')
       . '<input id="admin-search" type="search" name="q" placeholder="Search players, photos, cities" value="'
       . $e($path === '/admin/search' ? ($_GET['q'] ?? '') : '') . '" autocomplete="off" aria-label="Search"><kbd>/</kbd></form>'
       . '<span class="env ' . ($isProd ? 'env-prod' : 'env-local') . '" title="' . ($isProd ? 'Changes here affect real players' : 'Not production') . '">'
       . ($isProd ? 'PROD' : 'LOCAL') . '</span>'
       . '<div class="me">'
       . '<button type="button" class="icon-btn" data-theme-toggle title="Theme: system / light / dark" aria-label="Change theme">' . admin_icon('sun') . '</button>'
       . '<a class="who-link" href="/admin/account" title="My account"><span class="avatar">' . $e($initials) . '</span>'
       . '<span class="name">' . $e($u['name']) . '</span></a>'
       . '<span class="role">' . $e(AdminAuth::ROLES[$u['role']] ?? $u['role']) . '</span>'
       . '<form method="POST" action="/admin/logout" style="margin:0">' . csrf_input()
       . '<button type="submit" class="icon-btn" title="Sign out" aria-label="Sign out">' . admin_icon('logout') . '</button></form>'
       . '</div></header>';

    if (AdminAuth::area($path) === 'archive') {
        echo '<div class="admin-main" style="padding-bottom:0"><div class="callout warn archive-banner">Archive: this page is kept for history and is read-only. Its data stays, nothing here can be changed.</div></div>';
    }
}

function admin_foot(): void
{
    if (!empty($GLOBALS['admin_shell_open'])) echo '</div></div>';
    echo '</body></html>';
}
