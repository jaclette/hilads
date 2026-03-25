<?php

/**
 * Curated recurring venue seed — 10 cities, 4 bars + 3 coffee shops each.
 *
 * Rules applied at import time:
 *   bars    → event_type=drinks,  start=18:00, end=01:00, daily
 *   coffee  → event_type=coffee,  start=10:00, end=18:00, daily
 *
 * source_key is derived from city_id + slugified title + category.
 * Renaming a title produces a new source_key — the old series is left untouched
 * and expires naturally. Do not change titles unless you intend a new series.
 */

return [

    // ── Paris ─────────────────────────────────────────────────────────────────
    ['city_id' => 1, 'category' => 'bar',    'title' => 'Le Syndicat',               'location' => 'Rue du Faubourg Saint-Denis, Paris'],
    ['city_id' => 1, 'category' => 'bar',    'title' => "Harry's New York Bar",       'location' => 'Rue Daunou, Paris'],
    ['city_id' => 1, 'category' => 'bar',    'title' => 'Prescription Cocktail Club', 'location' => 'Rue Mazarine, Paris'],
    ['city_id' => 1, 'category' => 'bar',    'title' => 'Experimental Cocktail Club', 'location' => 'Rue Saint-Sauveur, Paris'],
    ['city_id' => 1, 'category' => 'coffee', 'title' => 'Café de Flore',              'location' => 'Boulevard Saint-Germain, Paris'],
    ['city_id' => 1, 'category' => 'coffee', 'title' => 'Ten Belles',                 'location' => 'Rue de la Grange aux Belles, Paris'],
    ['city_id' => 1, 'category' => 'coffee', 'title' => 'Fragments',                  'location' => 'Rue de Bretagne, Paris'],

    // ── London ────────────────────────────────────────────────────────────────
    ['city_id' => 2, 'category' => 'bar',    'title' => 'The Connaught Bar',          'location' => 'Carlos Place, Mayfair, London'],
    ['city_id' => 2, 'category' => 'bar',    'title' => 'Nightjar',                   'location' => 'City Road, London'],
    ['city_id' => 2, 'category' => 'bar',    'title' => 'Lyaness',                    'location' => 'South Bank, London'],
    ['city_id' => 2, 'category' => 'bar',    'title' => 'The Beaufort Bar',           'location' => 'The Strand, London'],
    ['city_id' => 2, 'category' => 'coffee', 'title' => 'Monmouth Coffee',            'location' => 'Monmouth Street, Covent Garden, London'],
    ['city_id' => 2, 'category' => 'coffee', 'title' => 'Workshop Coffee',            'location' => 'Clerkenwell Road, London'],
    ['city_id' => 2, 'category' => 'coffee', 'title' => 'Ozone Coffee Roasters',      'location' => 'Leonard Street, Shoreditch, London'],

    // ── New York ──────────────────────────────────────────────────────────────
    ['city_id' => 3, 'category' => 'bar',    'title' => 'Death & Company',            'location' => 'East 6th Street, East Village, New York'],
    ['city_id' => 3, 'category' => 'bar',    'title' => 'The Dead Rabbit',            'location' => 'Water Street, Financial District, New York'],
    ['city_id' => 3, 'category' => 'bar',    'title' => 'Employees Only',             'location' => 'Hudson Street, West Village, New York'],
    ['city_id' => 3, 'category' => 'bar',    'title' => 'Attaboy',                    'location' => 'Eldridge Street, Lower East Side, New York'],
    ['city_id' => 3, 'category' => 'coffee', 'title' => 'Blue Bottle Coffee',         'location' => 'Berry Street, Williamsburg, New York'],
    ['city_id' => 3, 'category' => 'coffee', 'title' => 'Devoción',                   'location' => 'Broadway, Williamsburg, New York'],
    ['city_id' => 3, 'category' => 'coffee', 'title' => 'Intelligentsia Coffee',      'location' => 'Broadway, New York'],

    // ── Tokyo ─────────────────────────────────────────────────────────────────
    ['city_id' => 4, 'category' => 'bar',    'title' => 'Bar High Five',              'location' => 'Ginza, Tokyo'],
    ['city_id' => 4, 'category' => 'bar',    'title' => 'The SG Club',                'location' => 'Shibuya, Tokyo'],
    ['city_id' => 4, 'category' => 'bar',    'title' => 'Benfiddich',                 'location' => 'Shinjuku, Tokyo'],
    ['city_id' => 4, 'category' => 'bar',    'title' => 'Tender Bar',                 'location' => 'Ginza, Tokyo'],
    ['city_id' => 4, 'category' => 'coffee', 'title' => 'Fuglen Tokyo',               'location' => 'Tomigaya, Shibuya, Tokyo'],
    ['city_id' => 4, 'category' => 'coffee', 'title' => 'Bear Pond Espresso',         'location' => 'Shimokitazawa, Tokyo'],
    ['city_id' => 4, 'category' => 'coffee', 'title' => '% Arabica Tokyo',            'location' => 'Omotesando, Tokyo'],

    // ── Sydney ────────────────────────────────────────────────────────────────
    ['city_id' => 5, 'category' => 'bar',    'title' => 'Baxter Inn',                 'location' => 'Clarence Street, Sydney CBD'],
    ['city_id' => 5, 'category' => 'bar',    'title' => 'Maybe Sammy',                'location' => 'The Rocks, Sydney'],
    ['city_id' => 5, 'category' => 'bar',    'title' => 'Bulletin Place',             'location' => 'Bulletin Place, Sydney CBD'],
    ['city_id' => 5, 'category' => 'bar',    'title' => 'PS40',                       'location' => 'King Street, Sydney CBD'],
    ['city_id' => 5, 'category' => 'coffee', 'title' => 'Single O',                   'location' => 'Reservoir Street, Surry Hills, Sydney'],
    ['city_id' => 5, 'category' => 'coffee', 'title' => 'Reuben Hills',               'location' => 'Albion Street, Surry Hills, Sydney'],
    ['city_id' => 5, 'category' => 'coffee', 'title' => 'Artificer Coffee',           'location' => 'Bourke Street, Surry Hills, Sydney'],

    // ── Bangkok ───────────────────────────────────────────────────────────────
    ['city_id' => 9, 'category' => 'bar',    'title' => 'Vesper',                     'location' => 'Convent Road, Silom, Bangkok'],
    ['city_id' => 9, 'category' => 'bar',    'title' => 'The Bamboo Bar',             'location' => 'Mandarin Oriental, Charoen Krung, Bangkok'],
    ['city_id' => 9, 'category' => 'bar',    'title' => 'Rabbit Hole',                'location' => 'Thonglor, Bangkok'],
    ['city_id' => 9, 'category' => 'bar',    'title' => 'Iron Balls Gin Distillery',  'location' => 'Sukhumvit 26, Bangkok'],
    ['city_id' => 9, 'category' => 'coffee', 'title' => 'Roots Coffee Roaster',       'location' => 'Patpong, Silom, Bangkok'],
    ['city_id' => 9, 'category' => 'coffee', 'title' => 'Ceresia Coffee Roasters',    'location' => 'Rama 4 Road, Bangkok'],
    ['city_id' => 9, 'category' => 'coffee', 'title' => 'Brave Roasters',             'location' => 'Thonglor, Bangkok'],

    // ── Buenos Aires ──────────────────────────────────────────────────────────
    ['city_id' => 13, 'category' => 'bar',    'title' => 'Florería Atlántico',        'location' => 'Arroyo, Retiro, Buenos Aires'],
    ['city_id' => 13, 'category' => 'bar',    'title' => 'Presidente Bar',            'location' => 'Godoy Cruz, Palermo, Buenos Aires'],
    ['city_id' => 13, 'category' => 'bar',    'title' => 'Verne Club',                'location' => 'Medrano, Almagro, Buenos Aires'],
    ['city_id' => 13, 'category' => 'bar',    'title' => 'El Drugstore',              'location' => 'Venezuela, Monserrat, Buenos Aires'],
    ['city_id' => 13, 'category' => 'coffee', 'title' => 'El Federal',                'location' => 'Carlos Calvo, San Telmo, Buenos Aires'],
    ['city_id' => 13, 'category' => 'coffee', 'title' => 'Ninina Bakery & Café',      'location' => 'Gorriti, Palermo Soho, Buenos Aires'],
    ['city_id' => 13, 'category' => 'coffee', 'title' => 'Lattente',                  'location' => 'El Salvador, Palermo, Buenos Aires'],

    // ── Singapore ─────────────────────────────────────────────────────────────
    ['city_id' => 15, 'category' => 'bar',    'title' => 'Operation Dagger',          'location' => 'Ann Siang Hill, Chinatown, Singapore'],
    ['city_id' => 15, 'category' => 'bar',    'title' => 'Manhattan',                 'location' => 'Regent Singapore, Cuscaden Road, Singapore'],
    ['city_id' => 15, 'category' => 'bar',    'title' => 'Native',                    'location' => 'Amoy Street, Singapore'],
    ['city_id' => 15, 'category' => 'bar',    'title' => 'The Elephant Room',         'location' => 'Tanjong Pagar, Singapore'],
    ['city_id' => 15, 'category' => 'coffee', 'title' => 'Nylon Coffee Roasters',     'location' => '4 Everton Park, #01-40, Singapore 080004'],
    ['city_id' => 15, 'category' => 'coffee', 'title' => 'Chye Seng Huat Hardware',   'location' => '150 Tyrwhitt Road, Singapore 207563'],
    ['city_id' => 15, 'category' => 'coffee', 'title' => 'Common Man Coffee Roasters','location' => '22 Martin Road, #01-00, Singapore 239058'],

    // ── Berlin ────────────────────────────────────────────────────────────────
    ['city_id' => 17, 'category' => 'bar',    'title' => 'Buck & Breck',              'location' => 'Brunnenstraße 177, Mitte, Berlin'],
    ['city_id' => 17, 'category' => 'bar',    'title' => 'Rum Trader',                'location' => 'Fasanenstraße, Charlottenburg, Berlin'],
    ['city_id' => 17, 'category' => 'bar',    'title' => 'Stagger Lee',               'location' => 'Nollendorfplatz, Schöneberg, Berlin'],
    ['city_id' => 17, 'category' => 'bar',    'title' => 'Prater Garten',             'location' => 'Kastanienallee, Prenzlauer Berg, Berlin'],
    ['city_id' => 17, 'category' => 'coffee', 'title' => 'The Barn Coffee Roasters',  'location' => 'Auguststraße 58, Mitte, Berlin'],
    ['city_id' => 17, 'category' => 'coffee', 'title' => 'Five Elephant',             'location' => 'Reichenberger Straße 101, Kreuzberg, Berlin'],
    ['city_id' => 17, 'category' => 'coffee', 'title' => 'Bonanza Coffee',            'location' => 'Oderberger Straße, Prenzlauer Berg, Berlin'],

    // ── Ho Chi Minh City ──────────────────────────────────────────────────────
    ['city_id' => 20, 'category' => 'bar',    'title' => 'Chill Skybar',              'location' => 'AB Tower, 76A Lê Lai, Bến Thành, District 1, Ho Chi Minh City'],
    ['city_id' => 20, 'category' => 'bar',    'title' => 'Saigon Saigon Rooftop Bar', 'location' => 'Caravelle Saigon, 19-23 Lam Son Square, District 1, Ho Chi Minh City'],
    ['city_id' => 20, 'category' => 'bar',    'title' => 'The Observatory',           'location' => 'Đề Thám, Bến Thành, Ho Chi Minh City'],
    ['city_id' => 20, 'category' => 'bar',    'title' => 'Social Club',               'location' => 'The Reverie Saigon, Nguyễn Huệ, Ho Chi Minh City'],
    ['city_id' => 20, 'category' => 'coffee', 'title' => 'The Workshop Coffee',       'location' => '27 Ngô Đức Kế, Bến Nghé, District 1, Ho Chi Minh City'],
    ['city_id' => 20, 'category' => 'coffee', 'title' => "L'Usine",                   'location' => 'Lê Lợi, District 1, Ho Chi Minh City'],
    ['city_id' => 20, 'category' => 'coffee', 'title' => 'Công Cà Phê',               'location' => 'Phạm Ngọc Thạch, District 3, Ho Chi Minh City'],

];
