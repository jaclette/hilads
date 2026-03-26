<?php

declare(strict_types=1);

function flash_set(string $type, string $message): void
{
    $_SESSION['admin_flash'][] = ['type' => $type, 'message' => $message];
}

function flash_html(): string
{
    $messages = $_SESSION['admin_flash'] ?? [];
    unset($_SESSION['admin_flash']);
    if (empty($messages)) {
        return '';
    }
    $html = '';
    foreach ($messages as $f) {
        $cls = $f['type'] === 'success' ? 'flash-success' : 'flash-error';
        $html .= '<div class="flash ' . $cls . '">' . htmlspecialchars($f['message'], ENT_QUOTES) . '</div>';
    }
    return $html;
}
