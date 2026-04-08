<?php
// Ultra-fast health check — no bootstrap, no DB, no vendor autoload.
// Apache serves this file directly; the rewrite rule in .htaccess maps
// GET /health → this file before the general catch-all fires.
http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo '{"status":"ok","service":"hilads-api"}';
