FROM php:8.2-apache

# Enable mod_rewrite
RUN a2enmod rewrite

ENV APACHE_DOCUMENT_ROOT /var/www/html/public

# Point document root to public/
RUN sed -i 's|/var/www/html|${APACHE_DOCUMENT_ROOT}|g' /etc/apache2/sites-available/000-default.conf \
    && sed -i 's|/var/www/html|${APACHE_DOCUMENT_ROOT}|g' /etc/apache2/apache2.conf

# Allow .htaccess overrides
RUN sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# ── PHP config ────────────────────────────────────────────────────────────────

RUN echo "log_errors = On\nerror_log = /dev/stderr" \
    > /usr/local/etc/php/conf.d/errors.ini

RUN echo "upload_max_filesize = 10M\npost_max_size = 12M" \
    > /usr/local/etc/php/conf.d/uploads.ini

# OPcache — pre-compiles PHP files at startup so first requests are fast.
# opcache.validate_timestamps=0 disables stat() calls per request in production.
RUN echo "opcache.enable=1\n\
opcache.memory_consumption=128\n\
opcache.interned_strings_buffer=16\n\
opcache.max_accelerated_files=10000\n\
opcache.validate_timestamps=0\n\
opcache.fast_shutdown=1\n\
opcache.enable_cli=0" \
    > /usr/local/etc/php/conf.d/opcache.ini && \
    docker-php-ext-enable opcache

# ── System deps + PHP extensions ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    zip \
    libcurl4-openssl-dev \
    libpq-dev \
    && docker-php-ext-install curl pdo_pgsql \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY . /var/www/html

WORKDIR /var/www/html

RUN composer install --no-dev --optimize-autoloader --no-interaction

# Pre-warm OPcache by scanning all PHP files at build time.
# Apache/PHP still needs to load them on first request, but the compiled
# bytecode is already in the cache file so it's near-instant.
RUN php -r "
\$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator('/var/www/html'));
foreach (\$it as \$f) {
    if (\$f->getExtension() === 'php') opcache_compile_file(\$f->getPathname());
}" 2>/dev/null || true

RUN mkdir -p /var/www/html/storage \
    && chown -R www-data:www-data /var/www/html/storage \
    && chmod -R 775 /var/www/html/storage

EXPOSE 80