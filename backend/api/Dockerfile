# Pinned to a patch release so a rebuild can never reuse an older cached base.
# 8.2.35 fixes CVE-2026-109618 / CVE-2026-109619 (RCE, mod_php most exposed).
FROM php:8.2.35-apache

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

# Session upload progress is unused; off removes the CVE-2026-109619 path.
RUN echo "session.upload_progress.enabled = 0" \
    > /usr/local/etc/php/conf.d/security.ini

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
# GD with JPEG/PNG/WebP support powers avatar thumbnail generation
# (ImageProcessor::generateAvatarThumbnail). Without GD every upload
# falls through to the COALESCE fallback and the client loads the
# full 1-3 MB original on every card. exif lets ImageProcessor::stripMetadata
# read a JPEG's orientation before re-encoding (uploads are stored without
# EXIF/GPS).
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    zip \
    libcurl4-openssl-dev \
    libpq-dev \
    libpng-dev \
    libjpeg-dev \
    libwebp-dev \
    libfreetype6-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install curl pdo_pgsql gd exif \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY . /var/www/html

WORKDIR /var/www/html

RUN composer install --no-dev --optimize-autoloader --no-interaction

RUN mkdir -p /var/www/html/storage \
    && chown -R www-data:www-data /var/www/html/storage \
    && chmod -R 775 /var/www/html/storage

EXPOSE 80