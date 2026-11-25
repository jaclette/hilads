<?php

declare(strict_types=1);

// The back office's static files (admin/assets/*), served by the admin router so they work
// behind the same /admin prefix everywhere (Render, php -S). Only known files, long cache:
// layout.php adds ?v=<file mtime> so a deploy is picked up at once.

$name = basename(substr($uri, strlen('/admin/assets/')));
$types = ['admin.css' => 'text/css', 'admin.js' => 'text/javascript', 'qrcode.js' => 'text/javascript'];
$file = __DIR__ . '/assets/' . $name;
if (!isset($types[$name]) || !is_file($file)) {
    http_response_code(404);
    exit;
}
header('Content-Type: ' . $types[$name] . '; charset=utf-8');
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
readfile($file);
