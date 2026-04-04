<?php

declare(strict_types=1);

function admin_head(string $title): void
{
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>' . htmlspecialchars($title, ENT_QUOTES) . ' — Hilads Admin</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f0f; color: #e0e0e0; font-size: 14px; line-height: 1.5; }
a { color: #FF7A3C; text-decoration: none; }
a:hover { text-decoration: underline; }
button, .btn { cursor: pointer; font-family: inherit; font-size: 13px; }

/* Header */
.admin-header { background: #1a1a1a; border-bottom: 1px solid #2a2a2a; padding: 0 24px; display: flex; align-items: center; height: 52px; gap: 20px; position: sticky; top: 0; z-index: 100; }
.admin-header .logo { font-weight: 700; font-size: 15px; color: #fff; letter-spacing: -0.3px; flex-shrink: 0; }
.admin-header .logo span { color: #FF7A3C; }
.admin-header nav { display: flex; gap: 4px; }
.admin-header nav a { color: #999; font-size: 13px; padding: 5px 10px; border-radius: 5px; transition: color 0.15s; }
.admin-header nav a:hover { color: #fff; text-decoration: none; background: #252525; }
.admin-header nav a.active { color: #fff; background: #252525; }
.header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.logout-form button { background: none; border: 1px solid #333; color: #888; padding: 5px 12px; border-radius: 5px; font-size: 12px; transition: all 0.15s; }
.logout-form button:hover { border-color: #ef4444; color: #f87171; }

/* Layout */
.admin-main { padding: 28px 24px; max-width: 1440px; }
.page-title { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #fff; }

/* Stats */
.stats-row { display: flex; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
.stat-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px 20px; min-width: 130px; }
.stat-value { font-size: 26px; font-weight: 700; color: #FF7A3C; line-height: 1; }
.stat-label { color: #666; font-size: 11px; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px; }

/* Search / filter bar */
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
.toolbar input[type="text"], .toolbar select {
    background: #1a1a1a; border: 1px solid #2a2a2a; color: #e0e0e0;
    padding: 7px 12px; border-radius: 6px; font-size: 13px; font-family: inherit;
}
.toolbar input[type="text"] { width: 260px; }
.toolbar input[type="text"]::placeholder { color: #444; }
.toolbar input[type="text"]:focus, .toolbar select:focus { outline: none; border-color: #FF7A3C; }
.toolbar select { min-width: 130px; }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 6px; font-weight: 500; border: none; transition: background 0.15s; white-space: nowrap; }
.btn-primary { background: #FF7A3C; color: #fff; }
.btn-primary:hover { background: #e86b30; text-decoration: none; }
.btn-sm { padding: 4px 9px; font-size: 12px; border-radius: 5px; }
.btn-secondary { background: #252525; border: 1px solid #333; color: #ccc; }
.btn-secondary:hover { background: #2e2e2e; text-decoration: none; }
.btn-danger { background: #2a1010; border: 1px solid #7f1d1d; color: #fca5a5; }
.btn-danger:hover { background: #3a1515; text-decoration: none; }

/* Table */
.table-wrapper { overflow-x: auto; border: 1px solid #222; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th { text-align: left; padding: 9px 12px; background: #161616; border-bottom: 1px solid #2a2a2a; color: #666; font-weight: 500; white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
tbody tr { border-bottom: 1px solid #1a1a1a; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: #141414; }
td { padding: 9px 12px; vertical-align: middle; }
.td-mono { font-family: monospace; font-size: 11px; color: #888; }
.td-clip { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-actions { white-space: nowrap; display: flex; gap: 6px; }
.no-results { padding: 40px; text-align: center; color: #555; }

/* Badges */
.badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.badge-live    { background: rgba(255,122,60,0.18); color: #FF7A3C; }
.badge-active  { background: rgba(34,197,94,0.12); color: #4ade80; }
.badge-expired { background: rgba(255,255,255,0.05); color: #555; }
.badge-deleted { background: rgba(239,68,68,0.12); color: #f87171; }
.badge-recurring { background: rgba(167,139,250,0.12); color: #a78bfa; }
.badge-guest   { background: rgba(251,191,36,0.1); color: #fbbf24; }
.badge-registered { background: rgba(96,165,250,0.1); color: #60a5fa; }
.badge-photo       { background: rgba(34,197,94,0.08); color: #4ade80; }
.badge-ambassador  { background: rgba(255,122,60,0.15); color: #FF7A3C; }
.badge-fake        { background: rgba(167,139,250,0.15); color: #c4b5fd; }

/* Flash messages */
.flash { padding: 10px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
.flash-success { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.25); color: #4ade80; }
.flash-error   { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); color: #f87171; }

/* Forms */
.form-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 24px; max-width: 580px; }
.form-group { margin-bottom: 18px; }
.form-group label { display: block; font-size: 11px; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.form-group input, .form-group select, .form-group textarea {
    width: 100%; background: #111; border: 1px solid #2a2a2a; color: #e0e0e0;
    padding: 8px 12px; border-radius: 6px; font-size: 14px; font-family: inherit;
}
.form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline: none; border-color: #FF7A3C; }
.form-group input[readonly], .form-group input[disabled] { color: #555; background: #0d0d0d; }
.form-group .hint { font-size: 11px; color: #555; margin-top: 5px; }
.form-group textarea { resize: vertical; min-height: 80px; }
.form-actions { display: flex; gap: 10px; margin-top: 24px; align-items: center; }

.info-section { margin-bottom: 20px; }
.info-section h3 { font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
.info-grid { display: grid; grid-template-columns: 130px 1fr; gap: 6px 0; font-size: 12px; }
.info-label { color: #555; }
.info-value { color: #ccc; font-family: monospace; }

.warning-box { background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.2); border-radius: 6px; padding: 10px 14px; margin-bottom: 20px; font-size: 12px; color: #fbbf24; line-height: 1.5; }

/* Pagination */
.pagination { display: flex; gap: 6px; align-items: center; margin-top: 16px; font-size: 13px; color: #555; }
.pagination a { color: #FF7A3C; padding: 4px 8px; border-radius: 4px; }
.pagination a:hover { background: #1a1a1a; text-decoration: none; }
.pagination .current { background: #FF7A3C; color: #fff; padding: 4px 8px; border-radius: 4px; }
.pagination .sep { color: #333; }

/* Login */
.login-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.login-box { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 36px 32px; width: 340px; }
.login-box h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; color: #fff; }
.login-box .subtitle { color: #555; font-size: 13px; margin-bottom: 28px; }
.login-box .form-group label { color: #777; }
.login-box .btn-primary { width: 100%; justify-content: center; padding: 10px; margin-top: 4px; }
</style>
</head>
<body>
';
}

function admin_nav(string $current = ''): void
{
    $isLoggedIn = admin_is_logged_in();
    echo '<header class="admin-header">';
    echo '<div class="logo">Hilads <span>Admin</span></div>';
    if ($isLoggedIn) {
        echo '<nav>';
        $links = [
            '/admin'         => 'Dashboard',
            '/admin/users'   => 'Users',
            '/admin/events'  => 'Events',
            '/admin/topics'  => 'Topics',
        ];
        foreach ($links as $href => $label) {
            $active = ($current === $href) ? ' class="active"' : '';
            echo '<a href="' . $href . '"' . $active . '>' . $label . '</a>';
        }
        echo '</nav>';
        echo '<div class="header-right">';
        echo '<form class="logout-form" method="POST" action="/admin/logout">';
        echo csrf_input();
        echo '<button type="submit">Sign out</button>';
        echo '</form>';
        echo '</div>';
    }
    echo '</header>';
}

function admin_foot(): void
{
    echo '</body></html>';
}
