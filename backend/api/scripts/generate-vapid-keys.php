<?php
/**
 * Run once to generate VAPID keys for web push.
 *
 *   php scripts/generate-vapid-keys.php
 *
 * Copy the output into your environment variables (Render, .env, etc.).
 * Keep VAPID_PRIVATE_KEY secret — never commit it.
 */

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';

use Minishlink\WebPush\VAPID;

$keys = VAPID::createVapidKeys();

echo "\n";
echo "✅ VAPID keys generated. Add to your environment:\n\n";
echo "VAPID_PUBLIC_KEY={$keys['publicKey']}\n";
echo "VAPID_PRIVATE_KEY={$keys['privateKey']}\n";
echo "VAPID_SUBJECT=mailto:hello@hilads.com\n";
echo "\n";
echo "⚠️  VAPID_PRIVATE_KEY is secret — never commit it to version control.\n";
echo "ℹ️  Run this script only once. Changing keys invalidates all existing push subscriptions.\n\n";
