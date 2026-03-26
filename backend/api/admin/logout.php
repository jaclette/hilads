<?php

declare(strict_types=1);

csrf_verify();

$_SESSION = [];
session_destroy();

admin_redirect('/admin/login');
