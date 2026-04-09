<?php

declare(strict_types=1);

admin_require_login();

$error   = null;
$success = null;

if ($method === 'POST') {
    csrf_verify();

    $from    = trim($_POST['from']    ?? '');
    $to      = trim($_POST['to']      ?? '');
    $subject = trim($_POST['subject'] ?? '');
    $html    = trim($_POST['html']    ?? '');
    $isTest  = isset($_POST['send_test']);

    if ($from === '' || $to === '' || $subject === '' || $html === '') {
        $error = 'All fields are required.';
    } elseif (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $error = 'Invalid "To" email address.';
    } else {
        $apiKey = getenv('RESEND_API_KEY');
        if (!$apiKey) {
            $error = 'RESEND_API_KEY is not configured.';
        } else {
            $payload = json_encode([
                'from'    => $from,
                'to'      => [$to],
                'subject' => $isTest ? '[TEST] ' . $subject : $subject,
                'html'    => $html,
            ]);

            $ch = curl_init('https://api.resend.com/emails');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $payload,
                CURLOPT_HTTPHEADER     => [
                    'Authorization: Bearer ' . $apiKey,
                    'Content-Type: application/json',
                ],
                CURLOPT_TIMEOUT        => 10,
            ]);
            $body = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($code >= 200 && $code < 300) {
                $success = $isTest
                    ? 'Test email sent successfully to ' . htmlspecialchars($to, ENT_QUOTES) . '.'
                    : 'Email sent successfully to ' . htmlspecialchars($to, ENT_QUOTES) . '.';
            } else {
                $decoded = json_decode($body, true);
                $msg     = $decoded['message'] ?? $decoded['name'] ?? 'Unknown error';
                $error   = 'Resend error (HTTP ' . $code . '): ' . $msg;
            }
        }
    }

    // Preserve form values on error
    if ($error) {
        $savedFrom    = $from;
        $savedTo      = $to;
        $savedSubject = $subject;
        $savedHtml    = $html;
    }
}

$savedFrom    = $savedFrom    ?? 'Hilads <contact@hilads.live>';
$savedTo      = $savedTo      ?? '';
$savedSubject = $savedSubject ?? '';
$savedHtml    = $savedHtml    ?? '';

admin_head('Send Email');
admin_nav('/admin/email');

echo '<div class="admin-main">';
echo '<h1 class="page-title">Send Email</h1>';

if ($success) {
    echo '<div class="flash flash-success">' . $success . '</div>';
}
if ($error) {
    echo '<div class="flash flash-error">' . htmlspecialchars($error, ENT_QUOTES) . '</div>';
}

echo '<form method="POST" action="/admin/email">';
echo csrf_input();
echo '<div class="form-card">';

echo '<div class="form-group">';
echo '<label>From</label>';
echo '<input type="text" name="from" value="' . htmlspecialchars($savedFrom, ENT_QUOTES) . '" required>';
echo '</div>';

echo '<div class="form-group">';
echo '<label>To</label>';
echo '<input type="email" name="to" value="' . htmlspecialchars($savedTo, ENT_QUOTES) . '" placeholder="recipient@example.com" required>';
echo '</div>';

echo '<div class="form-group">';
echo '<label>Subject</label>';
echo '<input type="text" name="subject" value="' . htmlspecialchars($savedSubject, ENT_QUOTES) . '" placeholder="Your subject line" required>';
echo '</div>';

echo '<div class="form-group">';
echo '<label>HTML Body</label>';
echo '<textarea name="html" rows="12" placeholder="<p>Hello...</p>" required>' . htmlspecialchars($savedHtml, ENT_QUOTES) . '</textarea>';
echo '<div class="hint">Paste raw HTML. It will be sent as-is.</div>';
echo '</div>';

echo '<div class="form-actions">';
echo '<button type="submit" name="send_test" class="btn btn-secondary">Send test</button>';
echo '<button type="submit" class="btn btn-primary">Send</button>';
echo '</div>';

echo '</div>';
echo '</form>';
echo '</div>';

admin_foot();
