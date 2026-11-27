<?php

declare(strict_types=1);

// The back office's static files (admin/assets/*), served by the admin router so they work
// behind the same /admin prefix everywhere (Render, php -S). Only known files, long cache:
// layout.php adds ?v=<file mtime> so a deploy is picked up at once.

$name = basename(substr($uri, strlen('/admin/assets/')));
$types = ['admin.css' => 'text/css', 'admin.js' => 'text/javascript', 'qrcode.js' => 'text/javascript',
          // The logo and the favicons (the -dev set: a teal tint off production, so PROD and staging tabs never look alike).
          'logo.svg' => 'image/svg+xml', 'logo-dev.svg' => 'image/svg+xml', 'favicon.ico' => 'image/x-icon', 'favicon-dev.ico' => 'image/x-icon',
          'favicon-32.png' => 'image/png', 'favicon-dev-32.png' => 'image/png', 'apple-touch-icon.png' => 'image/png',
          'apple-touch-icon-dev.png' => 'image/png', 'icon-192.png' => 'image/png', 'icon-dev-192.png' => 'image/png'];
$file = __DIR__ . '/assets/' . $name;
if (!isset($types[$name]) || !is_file($file)) {
    http_response_code(404);
    exit;
}
header('Content-Type: ' . $types[$name] . (str_starts_with($types[$name], 'text/') ? '; charset=utf-8' : ''));
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
readfile($file);
