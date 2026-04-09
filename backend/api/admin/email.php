<?php

declare(strict_types=1);

admin_require_login();

/**
 * Parse a multi-email string (comma or newline separated) into a validated array.
 * Returns ['emails' => [...], 'invalid' => [...]]
 */
function parse_emails(string $raw): array
{
    $tokens  = preg_split('/[\s,]+/', $raw, -1, PREG_SPLIT_NO_EMPTY);
    $valid   = [];
    $invalid = [];
    foreach ($tokens as $token) {
        $email = trim($token);
        if ($email === '') continue;
        if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $valid[] = $email;
        } else {
            $invalid[] = $email;
        }
    }
    return ['emails' => array_unique($valid), 'invalid' => $invalid];
}

/**
 * Convert message body to HTML if it contains no HTML tags.
 */
function prepare_html(string $body): string
{
    if (preg_match('/<[a-z][\s\S]*>/i', $body)) {
        return $body; // already HTML
    }
    return nl2br(htmlspecialchars($body, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
}

$error   = null;
$success = null;

if ($method === 'POST') {
    csrf_verify();

    $from    = trim($_POST['from']    ?? '');
    $toRaw   = trim($_POST['to']      ?? '');
    $bccRaw  = trim($_POST['bcc']     ?? '');
    $subject = trim($_POST['subject'] ?? '');
    $body    = trim($_POST['body']    ?? '');
    $isTest  = isset($_POST['send_test']);

    if ($from === '' || $toRaw === '' || $subject === '' || $body === '') {
        $error = 'From, To, Subject, and Message are required.';
    } else {
        $toParsed  = parse_emails($toRaw);
        $bccParsed = $bccRaw !== '' ? parse_emails($bccRaw) : ['emails' => [], 'invalid' => []];

        if (empty($toParsed['emails'])) {
            $error = 'No valid "To" email addresses found.';
        } elseif (!empty($toParsed['invalid'])) {
            $error = 'Invalid "To" address(es): ' . implode(', ', $toParsed['invalid']);
        } elseif (!empty($bccParsed['invalid'])) {
            $error = 'Invalid "BCC" address(es): ' . implode(', ', $bccParsed['invalid']);
        } else {
            $apiKey = getenv('RESEND_API_KEY');
            if (!$apiKey) {
                $error = 'RESEND_API_KEY is not configured.';
            } else {
                $html = prepare_html($body);

                $payload = [
                    'from'    => $from,
                    'to'      => $toParsed['emails'],
                    'subject' => $isTest ? '[TEST] ' . $subject : $subject,
                    'html'    => $html,
                ];
                if (!empty($bccParsed['emails'])) {
                    $payload['bcc'] = $bccParsed['emails'];
                }

                $ch = curl_init('https://api.resend.com/emails');
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_POST           => true,
                    CURLOPT_POSTFIELDS     => json_encode($payload),
                    CURLOPT_HTTPHEADER     => [
                        'Authorization: Bearer ' . $apiKey,
                        'Content-Type: application/json',
                    ],
                    CURLOPT_TIMEOUT        => 10,
                ]);
                $respBody = curl_exec($ch);
                $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);

                if ($code >= 200 && $code < 300) {
                    $toCount  = count($toParsed['emails']);
                    $bccCount = count($bccParsed['emails']);
                    $label    = $isTest ? 'Test email' : 'Email';
                    $detail   = $toCount . ' recipient' . ($toCount !== 1 ? 's' : '');
                    if ($bccCount > 0) {
                        $detail .= ', ' . $bccCount . ' BCC';
                    }
                    $success = $label . ' sent successfully (' . $detail . ').';
                } else {
                    $decoded = json_decode($respBody, true);
                    $msg     = $decoded['message'] ?? $decoded['name'] ?? 'Unknown error';
                    $error   = 'Resend error (HTTP ' . $code . '): ' . $msg;
                }
            }
        }
    }

    // Preserve form values on error
    if ($error) {
        $savedFrom    = $from;
        $savedTo      = $toRaw;
        $savedBcc     = $bccRaw;
        $savedSubject = $subject;
        $savedBody    = $body;
    }
}

$savedFrom    = $savedFrom    ?? 'Hilads <contact@hilads.live>';
$savedTo      = $savedTo      ?? '';
$savedBcc     = $savedBcc     ?? '';
$savedSubject = $savedSubject ?? '';
$savedBody    = $savedBody    ?? '';

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
echo '<textarea name="to" rows="3" placeholder="one@example.com, two@example.com" required>' . htmlspecialchars($savedTo, ENT_QUOTES) . '</textarea>';
echo '<div class="hint">Comma or newline separated. Multiple recipients allowed.</div>';
echo '</div>';

echo '<div class="form-group">';
echo '<label>BCC <span style="color:#444;font-size:10px;text-transform:none;letter-spacing:0">(optional)</span></label>';
echo '<textarea name="bcc" rows="2" placeholder="bcc@example.com">' . htmlspecialchars($savedBcc, ENT_QUOTES) . '</textarea>';
echo '<div class="hint">Comma or newline separated.</div>';
echo '</div>';

echo '<div class="form-group">';
echo '<label>Subject</label>';
echo '<input type="text" name="subject" value="' . htmlspecialchars($savedSubject, ENT_QUOTES) . '" placeholder="Your subject line" required>';
echo '</div>';

echo '<div class="form-group">';
echo '<label>Message <span style="color:#444;font-size:10px;text-transform:none;letter-spacing:0">(HTML supported)</span></label>';
echo '<textarea name="body" rows="14" placeholder="Write your message here. Line breaks are preserved automatically. Paste HTML for full control." required>' . htmlspecialchars($savedBody, ENT_QUOTES) . '</textarea>';
echo '<div class="hint">Plain text: line breaks → &lt;br&gt; automatically. HTML: sent as-is.</div>';
echo '</div>';

echo '<div class="form-actions">';
echo '<button type="submit" name="send_test" class="btn btn-secondary">Send test</button>';
echo '<button type="submit" class="btn btn-primary">Send</button>';
echo '</div>';

echo '</div>';
echo '</form>';
echo '</div>';

admin_foot();
