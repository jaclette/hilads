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

    // ── Lisbon ──────────────────────────────────────────────────────────────────
    ['city_id' => 62, 'category' => 'bar',    'title' => 'Red Frog',                'location' => 'Praça da Alegria 66b, Lisbon'],
    ['city_id' => 62, 'category' => 'bar',    'title' => 'Pavilhão Chinês',         'location' => 'Rua Dom Pedro V 89, Lisbon'],
    ['city_id' => 62, 'category' => 'bar',    'title' => 'A Capela',                'location' => 'Rua da Atalaia 45, Lisbon'],
    ['city_id' => 62, 'category' => 'bar',    'title' => 'Imprensa',                'location' => 'Rua da Imprensa Nacional 46, Lisbon'],
    ['city_id' => 62, 'category' => 'coffee', 'title' => 'Fábrica Coffee Roasters', 'location' => 'Rua das Portas de Santo Antão 136, Lisbon'],
    ['city_id' => 62, 'category' => 'coffee', 'title' => 'The Mill',                'location' => 'Rua do Poço dos Negros 103, Lisbon'],
    ['city_id' => 62, 'category' => 'coffee', 'title' => 'Hello, Kristof',          'location' => 'Rua Nova da Piedade 10, Lisbon'],

    // ── Vienna ──────────────────────────────────────────────────────────────────
    ['city_id' => 64, 'category' => 'bar',    'title' => 'Loos American Bar',          'location' => 'Kärntner Durchgang 10, Vienna'],
    ['city_id' => 64, 'category' => 'bar',    'title' => 'Kleinod',                    'location' => 'Innere Stadt, Vienna'],
    ['city_id' => 64, 'category' => 'bar',    'title' => 'Krypt',                      'location' => 'Innere Stadt, Vienna'],
    ['city_id' => 64, 'category' => 'bar',    'title' => "Nightfly's American Bar",    'location' => 'Innere Stadt, Vienna'],
    ['city_id' => 64, 'category' => 'coffee', 'title' => 'Jonas Reindl Coffee Roasters','location' => 'Währinger Strasse 2-4, Vienna'],
    ['city_id' => 64, 'category' => 'coffee', 'title' => 'Kaffeemodul',                'location' => 'Josefstädter Strasse 35, Vienna'],
    ['city_id' => 64, 'category' => 'coffee', 'title' => 'Kaffemik',                   'location' => 'Neubau, Vienna'],

    // ── Edinburgh ───────────────────────────────────────────────────────────────
    ['city_id' => 36, 'category' => 'bar',    'title' => 'Panda & Sons',              'location' => 'Queen Street, Edinburgh'],
    ['city_id' => 36, 'category' => 'bar',    'title' => 'Bramble',                   'location' => 'Queen Street, Edinburgh'],
    ['city_id' => 36, 'category' => 'bar',    'title' => "The Devil's Advocate",      'location' => "Advocate's Close, Royal Mile, Edinburgh"],
    ['city_id' => 36, 'category' => 'bar',    'title' => 'Hey Palu',                  'location' => 'Bread Street, Edinburgh'],
    ['city_id' => 36, 'category' => 'coffee', 'title' => 'Black Medicine Coffee Co.', 'location' => 'Nicolson Street, Edinburgh'],
    ['city_id' => 36, 'category' => 'coffee', 'title' => 'Thomas J Walls Coffee',     'location' => 'Forrest Road, Edinburgh'],
    ['city_id' => 36, 'category' => 'coffee', 'title' => 'Format',                    'location' => 'The Meadows, Edinburgh'],

    // ── Manchester ──────────────────────────────────────────────────────────────
    ['city_id' => 31, 'category' => 'bar',    'title' => 'Speak In Code',             'location' => "Jackson's Row, Manchester"],
    ['city_id' => 31, 'category' => 'bar',    'title' => 'Finders Keepers',           'location' => 'Little Quay Street, Manchester'],
    ['city_id' => 31, 'category' => 'bar',    'title' => 'Henry C',                   'location' => '107 Manchester Rd, Chorlton, Manchester'],
    ['city_id' => 31, 'category' => 'bar',    'title' => 'Sora Sky Bar',              'location' => 'Malmaison, Manchester'],
    ['city_id' => 31, 'category' => 'coffee', 'title' => 'Foundation Coffee House',   'location' => 'Northern Quarter, Manchester'],
    ['city_id' => 31, 'category' => 'coffee', 'title' => 'Siop Shop',                 'location' => '53 Tib Street, Manchester'],
    ['city_id' => 31, 'category' => 'coffee', 'title' => 'Pot Kettle Black',          'location' => 'Barton Arcade, Manchester'],

    // ── Chicago ─────────────────────────────────────────────────────────────────
    ['city_id' => 96, 'category' => 'bar',    'title' => 'Kumiko',                    'location' => '630 W Lake St, Chicago'],
    ['city_id' => 96, 'category' => 'bar',    'title' => 'Clara',                     'location' => '12 W Elm St, Chicago'],
    ['city_id' => 96, 'category' => 'bar',    'title' => 'Best Intentions',           'location' => '1520 N Damen Ave, Chicago'],
    ['city_id' => 96, 'category' => 'bar',    'title' => 'Bisous',                    'location' => '955 W Fulton Market, Chicago'],
    ['city_id' => 96, 'category' => 'coffee', 'title' => 'Intelligentsia Coffee',     'location' => 'Lakeview, Chicago'],
    ['city_id' => 96, 'category' => 'coffee', 'title' => 'Dark Matter Coffee',        'location' => 'Ukrainian Village, Chicago'],
    ['city_id' => 96, 'category' => 'coffee', 'title' => 'Metric Coffee',             'location' => 'Fulton Market, Chicago'],

    // ── Boston ──────────────────────────────────────────────────────────────────
    ['city_id' => 114, 'category' => 'bar',    'title' => 'OFFSUIT',                  'location' => '5 Utica St, Boston'],
    ['city_id' => 114, 'category' => 'bar',    'title' => 'Hecate',                   'location' => '48 Gloucester St, Boston'],
    ['city_id' => 114, 'category' => 'bar',    'title' => 'jm Curley',                'location' => '21 Temple Place, Boston'],
    ['city_id' => 114, 'category' => 'bar',    'title' => 'Bar Pallino',              'location' => '278 Newbury St, Boston'],
    ['city_id' => 114, 'category' => 'coffee', 'title' => 'George Howell Coffee',     'location' => '505 Washington St, Boston'],
    ['city_id' => 114, 'category' => 'coffee', 'title' => 'Gracenote Coffee',         'location' => '108 Lincoln St, Boston'],
    ['city_id' => 114, 'category' => 'coffee', 'title' => 'La Colombe Coffee Roasters','location' => '29 Northern Ave, Boston'],

    // ── Austin ──────────────────────────────────────────────────────────────────
    ['city_id' => 108, 'category' => 'bar',    'title' => 'Small Victory',            'location' => 'East 7th Street, Austin'],
    ['city_id' => 108, 'category' => 'bar',    'title' => 'Here Nor There',           'location' => 'Downtown, Austin'],
    ['city_id' => 108, 'category' => 'bar',    'title' => 'Tiki Tatsu-Ya',            'location' => 'South Lamar, Austin'],
    ['city_id' => 108, 'category' => 'bar',    'title' => 'Codependent Cocktails',    'location' => 'The Independent, Austin'],
    ['city_id' => 108, 'category' => 'coffee', 'title' => 'Radio Coffee',             'location' => '4208 Manchaca Rd, Austin'],
    ['city_id' => 108, 'category' => 'coffee', 'title' => 'Talisman Coffee Co.',      'location' => 'Austin'],
    ['city_id' => 108, 'category' => 'coffee', 'title' => "Ani's Day & Night",        'location' => 'East Austin, Austin'],

    // ── Miami ───────────────────────────────────────────────────────────────────
    ['city_id' => 111, 'category' => 'bar',    'title' => 'Café La Trova',            'location' => 'Calle Ocho, Little Havana, Miami'],
    ['city_id' => 111, 'category' => 'bar',    'title' => 'Broken Shaker',            'location' => 'Freehand Hotel, Miami Beach'],
    ['city_id' => 111, 'category' => 'bar',    'title' => 'The Regent Cocktail Club', 'location' => 'Gale Hotel, Miami Beach'],
    ['city_id' => 111, 'category' => 'bar',    'title' => 'Bar Centro',               'location' => 'Andaz, Miami Beach'],
    ['city_id' => 111, 'category' => 'coffee', 'title' => 'Panther Coffee',           'location' => 'Wynwood, Miami'],
    ['city_id' => 111, 'category' => 'coffee', 'title' => 'Pura Vida',                'location' => 'Miami'],
    ['city_id' => 111, 'category' => 'coffee', 'title' => 'MIAM Cafe',                'location' => 'Wynwood Building, Miami'],

    // ── Budapest ────────────────────────────────────────────────────────────────
    ['city_id' => 70, 'category' => 'bar',    'title' => "Boutiq'Bar",                'location' => 'Paulay Ede u. 5, Budapest'],
    ['city_id' => 70, 'category' => 'bar',    'title' => 'Hotsy Totsy',               'location' => 'Síp u. 24, Budapest'],
    ['city_id' => 70, 'category' => 'bar',    'title' => 'Black Swan',                'location' => 'Klauzál u. 32, Budapest'],
    ['city_id' => 70, 'category' => 'bar',    'title' => 'Tuk Tuk Bar',               'location' => 'Nagy Diófa u. 26, Budapest'],
    ['city_id' => 70, 'category' => 'coffee', 'title' => 'Espresso Embassy',          'location' => 'Arany János u. 15, Budapest'],
    ['city_id' => 70, 'category' => 'coffee', 'title' => 'Double Shot',               'location' => 'Pozsonyi út 16, Budapest'],
    ['city_id' => 70, 'category' => 'coffee', 'title' => 'My Little Melbourne',       'location' => 'Madách Imre út, Budapest'],

    // ── Kraków ──────────────────────────────────────────────────────────────────
    ['city_id' => 69, 'category' => 'bar',    'title' => 'Eszeweria',                 'location' => 'Józefa 9, Kraków'],
    ['city_id' => 69, 'category' => 'bar',    'title' => 'Café Hevre',                'location' => 'Beera Meiselsa 18, Kraków'],
    ['city_id' => 69, 'category' => 'bar',    'title' => 'Sababa',                    'location' => 'Straszewskiego 28, Kraków'],
    ['city_id' => 69, 'category' => 'bar',    'title' => 'Absynt',                    'location' => 'Miodowa 28, Kraków'],
    ['city_id' => 69, 'category' => 'coffee', 'title' => 'Karma',                     'location' => 'Krupnicza 12, Kraków'],
    ['city_id' => 69, 'category' => 'coffee', 'title' => 'Tektura',                   'location' => 'Krupnicza 7, Kraków'],
    ['city_id' => 69, 'category' => 'coffee', 'title' => 'Wesoła Cafe',               'location' => 'Rakowicka 17, Kraków'],

    // ── Melbourne ───────────────────────────────────────────────────────────────
    ['city_id' => 271, 'category' => 'bar',    'title' => 'Above Board',              'location' => '17 Casselden Pl, Melbourne'],
    ['city_id' => 271, 'category' => 'bar',    'title' => 'Siglo',                    'location' => '1 Malthouse Ln, Melbourne'],
    ['city_id' => 271, 'category' => 'bar',    'title' => 'Apollo Inn',               'location' => '165 Flinders Ln, Melbourne'],
    ['city_id' => 271, 'category' => 'bar',    'title' => 'Black Pearl',              'location' => '304 Brunswick St, Fitzroy, Melbourne'],
    ['city_id' => 271, 'category' => 'coffee', 'title' => 'Proud Mary',              'location' => '172 Oxford St, Collingwood, Melbourne'],
    ['city_id' => 271, 'category' => 'coffee', 'title' => 'St ALi',                  'location' => '12-18 Yarra Pl, South Melbourne'],
    ['city_id' => 271, 'category' => 'coffee', 'title' => 'Patricia Coffee Brewers', 'location' => 'Little Bourke St, Melbourne'],

    // ── Glasgow ─────────────────────────────────────────────────────────────────
    ['city_id' => 34, 'category' => 'bar',    'title' => 'The Absent Ear',            'location' => 'Brunswick Street, Merchant City, Glasgow'],
    ['city_id' => 34, 'category' => 'bar',    'title' => 'The Spiritualist',          'location' => 'George Square, Glasgow'],
    ['city_id' => 34, 'category' => 'bar',    'title' => 'The Finnieston',            'location' => 'Argyle Street, Finnieston, Glasgow'],
    ['city_id' => 34, 'category' => 'bar',    'title' => 'Kelvingrove Café',          'location' => 'West End, Glasgow'],
    ['city_id' => 34, 'category' => 'coffee', 'title' => 'The Steamie Coffee Roasters','location' => 'Finnieston, Glasgow'],
    ['city_id' => 34, 'category' => 'coffee', 'title' => "Thomson's Coffee",           'location' => 'Byres Road, Glasgow'],
    ['city_id' => 34, 'category' => 'coffee', 'title' => 'Tenement Coffee',           'location' => 'Glasgow'],

    // ── Frankfurt ───────────────────────────────────────────────────────────────
    ['city_id' => 41, 'category' => 'bar',    'title' => 'The Parlour',               'location' => 'Frankfurt'],
    ['city_id' => 41, 'category' => 'bar',    'title' => 'Kinly Bar',                 'location' => 'Sachsenhausen, Frankfurt'],
    ['city_id' => 41, 'category' => 'bar',    'title' => 'Rote Bar',                  'location' => 'Rotlintstraße 60, Frankfurt'],
    ['city_id' => 41, 'category' => 'bar',    'title' => 'La Luna',                   'location' => 'Baseler Str. 18a, Frankfurt'],
    ['city_id' => 41, 'category' => 'coffee', 'title' => 'drei kaffeebar',            'location' => 'Fahrgasse 23, Frankfurt'],
    ['city_id' => 41, 'category' => 'coffee', 'title' => 'Kioskie',                   'location' => 'Große Eschenheimer Str. 2, Frankfurt'],
    ['city_id' => 41, 'category' => 'coffee', 'title' => 'Retablo Coffee',            'location' => 'Schifferstraße 12, Frankfurt'],

    // ── Montreal ────────────────────────────────────────────────────────────────
    ['city_id' => 132, 'category' => 'bar',    'title' => 'Cloakroom',               'location' => 'Golden Square Mile, Montreal'],
    ['city_id' => 132, 'category' => 'bar',    'title' => 'Atwater Cocktail Club',   'location' => 'Saint-Henri, Montreal'],
    ['city_id' => 132, 'category' => 'bar',    'title' => 'Le Mal Nécessaire',       'location' => 'Chinatown, Montreal'],
    ['city_id' => 132, 'category' => 'bar',    'title' => 'Big in Japan',            'location' => 'Saint-Laurent Boulevard, Montreal'],
    ['city_id' => 132, 'category' => 'coffee', 'title' => 'Café Pista',              'location' => 'Plateau, Montreal'],
    ['city_id' => 132, 'category' => 'coffee', 'title' => 'Café Saint-Henri',        'location' => 'Saint-Henri, Montreal'],
    ['city_id' => 132, 'category' => 'coffee', 'title' => 'Le Café Big Trouble',     'location' => '2054 Rue Saint-Denis, Montreal'],

    // ── Hong Kong ───────────────────────────────────────────────────────────────
    ['city_id' => 181, 'category' => 'bar',    'title' => 'Penicillin',             'location' => '23 Hollywood Road, Central, Hong Kong'],
    ['city_id' => 181, 'category' => 'bar',    'title' => 'The Opposites',          'location' => '49 Hollywood Road, Central, Hong Kong'],
    ['city_id' => 181, 'category' => 'bar',    'title' => 'Dead Poets',             'location' => '41-49 Aberdeen Street, Central, Hong Kong'],
    ['city_id' => 181, 'category' => 'bar',    'title' => 'Argo',                   'location' => 'Four Seasons, 8 Finance Street, Central, Hong Kong'],
    ['city_id' => 181, 'category' => 'coffee', 'title' => 'Artista Perfetto',       'location' => 'Hollywood Road, Central, Hong Kong'],
    ['city_id' => 181, 'category' => 'coffee', 'title' => 'The Cupping Room',       'location' => 'Central, Hong Kong'],
    ['city_id' => 181, 'category' => 'coffee', 'title' => 'Halfway Coffee',         'location' => 'Mid-Levels, Hong Kong'],

    // ── Naples ──────────────────────────────────────────────────────────────────
    ['city_id' => 54, 'category' => 'bar',    'title' => "L'Antiquario",            'location' => 'Via Vannella Gaetani 2, Naples'],
    ['city_id' => 54, 'category' => 'bar',    'title' => 'Barril',                  'location' => 'Via Giuseppe Fiorelli 11, Naples'],
    ['city_id' => 54, 'category' => 'bar',    'title' => 'Libreria Berisio',        'location' => 'Via Mezzocannone 101, Naples'],
    ['city_id' => 54, 'category' => 'bar',    'title' => 'Fonoteca',                'location' => 'Vomero, Naples'],
    ['city_id' => 54, 'category' => 'coffee', 'title' => 'Gran Caffè Gambrinus',    'location' => 'Piazza del Plebiscito, Naples'],
    ['city_id' => 54, 'category' => 'coffee', 'title' => 'Caffè Mexico',            'location' => 'Piazza Dante, Naples'],
    ['city_id' => 54, 'category' => 'coffee', 'title' => 'Bar Nilo',               'location' => 'Via San Biagio dei Librai, Naples'],

    // ── Houston ─────────────────────────────────────────────────────────────────
    ['city_id' => 97, 'category' => 'bar',    'title' => 'Bandista',                'location' => 'Four Seasons, Houston'],
    ['city_id' => 97, 'category' => 'bar',    'title' => 'Bird of Paradise',        'location' => 'The Heights, Houston'],
    ['city_id' => 97, 'category' => 'bar',    'title' => 'Starduster Lounge',       'location' => 'Houston'],
    ['city_id' => 97, 'category' => 'bar',    'title' => "EZ's Liquor Lounge",      'location' => 'Houston'],
    ['city_id' => 97, 'category' => 'coffee', 'title' => 'Catalina Coffee',         'location' => 'Houston'],
    ['city_id' => 97, 'category' => 'coffee', 'title' => 'Blendin Coffee Club',     'location' => 'Montrose, Houston'],
    ['city_id' => 97, 'category' => 'coffee', 'title' => 'Tenfold Coffee',          'location' => 'Houston'],

    // ── Denver ──────────────────────────────────────────────────────────────────
    ['city_id' => 105, 'category' => 'bar',    'title' => 'Retrograde',             'location' => '619 East 13th Avenue, Denver'],
    ['city_id' => 105, 'category' => 'bar',    'title' => 'Union Lodge No. 1',      'location' => 'Larimer Street, Denver'],
    ['city_id' => 105, 'category' => 'bar',    'title' => 'Hudson Hill',            'location' => '1490 Curtis St, Denver'],
    ['city_id' => 105, 'category' => 'bar',    'title' => 'Deviation Distilling',   'location' => 'Dairy Block, Denver'],
    ['city_id' => 105, 'category' => 'coffee', 'title' => 'Corvus Coffee Roasters', 'location' => '1740 S Broadway, Denver'],
    ['city_id' => 105, 'category' => 'coffee', 'title' => 'Little Owl Coffee',      'location' => 'Blake Street, LoDo, Denver'],
    ['city_id' => 105, 'category' => 'coffee', 'title' => 'Steam Espresso Bar',     'location' => '1801 S Pearl St, Denver'],

    // ── Nashville ───────────────────────────────────────────────────────────────
    ['city_id' => 107, 'category' => 'bar',    'title' => 'Never Never',            'location' => '413 Houston St, Nashville'],
    ['city_id' => 107, 'category' => 'bar',    'title' => 'Chopper',                'location' => '1100 Stratton Ave, Nashville'],
    ['city_id' => 107, 'category' => 'bar',    'title' => 'Pushing Daisies',        'location' => '570 Broadway, Nashville'],
    ['city_id' => 107, 'category' => 'bar',    'title' => 'Coral Club',             'location' => 'Gallatin Avenue, East Nashville, Nashville'],
    ['city_id' => 107, 'category' => 'coffee', 'title' => 'Barista Parlor',         'location' => 'East Nashville, Nashville'],
    ['city_id' => 107, 'category' => 'coffee', 'title' => 'Elegy Coffee',           'location' => 'Germantown, Nashville'],
    ['city_id' => 107, 'category' => 'coffee', 'title' => 'Frothy Monkey',          'location' => '12 South, Nashville'],

    // ── Bogotá ──────────────────────────────────────────────────────────────────
    ['city_id' => 159, 'category' => 'bar',    'title' => 'Apache Bar',             'location' => 'Calle 82 #12-21, Zona T, Bogotá'],
    ['city_id' => 159, 'category' => 'bar',    'title' => 'Huerta Bar',             'location' => 'Quinta Camacho, Bogotá'],
    ['city_id' => 159, 'category' => 'bar',    'title' => 'Pedro Mandinga Rum Bar', 'location' => 'Usaquén, Bogotá'],
    ['city_id' => 159, 'category' => 'bar',    'title' => 'Bar 8yCuarto',           'location' => 'Carrera 14 #86A-12, Bogotá'],
    ['city_id' => 159, 'category' => 'coffee', 'title' => 'Amor Perfecto',          'location' => 'Carrera 4 #66-46, Bogotá'],
    ['city_id' => 159, 'category' => 'coffee', 'title' => 'Azahar Coffee',          'location' => 'Carrera 14 #93A-48, Bogotá'],
    ['city_id' => 159, 'category' => 'coffee', 'title' => 'Bourbon Coffee Roasters','location' => 'Calle 70A #13-83, Bogotá'],

    // ── Nice ────────────────────────────────────────────────────────────────────
    ['city_id' => 24, 'category' => 'bar',    'title' => 'Waka Bar',                'location' => '57 Quai des États-Unis, Nice'],
    ['city_id' => 24, 'category' => 'bar',    'title' => 'Le Plongeoir',            'location' => '41 Quai des États-Unis, Nice'],
    ['city_id' => 24, 'category' => 'bar',    'title' => 'Rooftop Monsigny',        'location' => '17 Av. Malaussena, Nice'],
    ['city_id' => 24, 'category' => 'bar',    'title' => 'El Merkado',              'location' => 'Nice'],
    ['city_id' => 24, 'category' => 'coffee', 'title' => 'Brume',                   'location' => 'Nice'],
    ['city_id' => 24, 'category' => 'coffee', 'title' => 'Hug Coffee',              'location' => 'Nice'],
    ['city_id' => 24, 'category' => 'coffee', 'title' => 'Café Marché',             'location' => 'Old Nice, Nice'],

    // ── Lima ────────────────────────────────────────────────────────────────────
    ['city_id' => 162, 'category' => 'bar',    'title' => 'Lady Bee',               'location' => 'Pedro de Osma 205, Barranco, Lima'],
    ['city_id' => 162, 'category' => 'bar',    'title' => 'Sastrería Martínez',     'location' => 'Av. Mariscal La Mar 1263, Miraflores, Lima'],
    ['city_id' => 162, 'category' => 'bar',    'title' => 'Carnaval',               'location' => 'Av. Felipe Pardo y Aliaga 662, San Isidro, Lima'],
    ['city_id' => 162, 'category' => 'bar',    'title' => 'Mayo',                   'location' => 'Jr. 2 de Mayo 253, Barranco, Lima'],
    ['city_id' => 162, 'category' => 'coffee', 'title' => 'Tostaduría Bisetti',     'location' => 'Barranco, Lima'],
    ['city_id' => 162, 'category' => 'coffee', 'title' => 'Origen Tostadores de Café','location' => 'Miraflores, Lima'],
    ['city_id' => 162, 'category' => 'coffee', 'title' => 'Neira Café Lab',         'location' => 'Lince, Lima'],

    // ── Santiago ────────────────────────────────────────────────────────────────
    ['city_id' => 163, 'category' => 'bar',    'title' => 'Chipe Libre',            'location' => 'José Victorino Lastarria 282, Santiago'],
    ['city_id' => 163, 'category' => 'bar',    'title' => 'Candelaria',             'location' => 'Lastarria, Santiago'],
    ['city_id' => 163, 'category' => 'bar',    'title' => 'Liguria',                'location' => 'Av. Providencia 1353, Santiago'],
    ['city_id' => 163, 'category' => 'bar',    'title' => 'Bocanáriz',              'location' => 'Lastarria, Santiago'],
    ['city_id' => 163, 'category' => 'coffee', 'title' => 'Café Altura',            'location' => 'Las Condes, Santiago'],
    ['city_id' => 163, 'category' => 'coffee', 'title' => 'Bemvindo Cafe',          'location' => 'Barrio Italia, Santiago'],
    ['city_id' => 163, 'category' => 'coffee', 'title' => 'Café Triciclo',          'location' => 'Providencia, Santiago'],

    // ── Medellín ────────────────────────────────────────────────────────────────
    ['city_id' => 160, 'category' => 'bar',    'title' => 'Alta Gracia',            'location' => 'Cra 43C #10-58, El Poblado, Medellín'],
    ['city_id' => 160, 'category' => 'bar',    'title' => 'Panorama Rooftop Bar',   'location' => 'Cl. 8 #34-33, El Poblado, Medellín'],
    ['city_id' => 160, 'category' => 'bar',    'title' => 'The Blue Bar',           'location' => 'Cl 10 #40-20, El Poblado, Medellín'],
    ['city_id' => 160, 'category' => 'bar',    'title' => 'Berlin Bar 1930',        'location' => 'Cl 10 #41-65, El Poblado, Medellín'],
    ['city_id' => 160, 'category' => 'coffee', 'title' => 'Pergamino Café',         'location' => 'El Poblado, Medellín'],
    ['city_id' => 160, 'category' => 'coffee', 'title' => 'Café Velvet',            'location' => 'El Poblado, Medellín'],
    ['city_id' => 160, 'category' => 'coffee', 'title' => 'Rituals Café',           'location' => 'Medellín'],

    // ── Rotterdam ───────────────────────────────────────────────────────────────
    ['city_id' => 60, 'category' => 'bar',    'title' => 'NY Basement',             'location' => 'Koninginnenhoofd 1, Rotterdam'],
    ['city_id' => 60, 'category' => 'bar',    'title' => 'The Rumah',               'location' => 'Oude Binnenweg 110C, Rotterdam'],
    ['city_id' => 60, 'category' => 'bar',    'title' => 'Spikizi',                 'location' => 'Zwarte Paardenstraat 91a, Rotterdam'],
    ['city_id' => 60, 'category' => 'bar',    'title' => 'Mavis',                   'location' => 'Westzeedijk 68a, Rotterdam'],
    ['city_id' => 60, 'category' => 'coffee', 'title' => 'Man Met Bril Koffie',     'location' => 'Rotterdam'],
    ['city_id' => 60, 'category' => 'coffee', 'title' => 'Schot Coffee Roasters',   'location' => 'Rotterdam'],
    ['city_id' => 60, 'category' => 'coffee', 'title' => 'Giraffe Coffee Bar',      'location' => 'Rotterdam'],

    // ── Wellington ──────────────────────────────────────────────────────────────
    ['city_id' => 278, 'category' => 'bar',    'title' => 'The Library',            'location' => 'Courtenay Place, Wellington'],
    ['city_id' => 278, 'category' => 'bar',    'title' => 'Hummingbird',            'location' => 'Courtenay Place, Wellington'],
    ['city_id' => 278, 'category' => 'bar',    'title' => 'Hanging Ditch',          'location' => 'Wellington'],
    ['city_id' => 278, 'category' => 'bar',    'title' => 'Night Flower Punch House','location' => '55 Ghuznee Street, Wellington'],
    ['city_id' => 278, 'category' => 'coffee', 'title' => 'Havana Coffee Works',    'location' => '163 Tory Street, Wellington'],
    ['city_id' => 278, 'category' => 'coffee', 'title' => 'Coffee Supreme',         'location' => '14 Jessie Street, Wellington'],
    ['city_id' => 278, 'category' => 'coffee', 'title' => 'Flight Coffee Hangar',   'location' => 'Wellington'],

    // ── Tallinn ─────────────────────────────────────────────────────────────────
    ['city_id' => 86, 'category' => 'bar',    'title' => 'Whisper Sister',          'location' => 'Pärnu mnt. 12, Tallinn'],
    ['city_id' => 86, 'category' => 'bar',    'title' => 'Botaanik',                'location' => 'Suurtüki 2, Tallinn'],
    ['city_id' => 86, 'category' => 'coffee', 'title' => 'Paper Mill Coffee',       'location' => 'Masina 20, Tallinn'],
    ['city_id' => 86, 'category' => 'coffee', 'title' => 'The Brick Coffee Roastery','location' => 'Telliskivi 60, Tallinn'],
    ['city_id' => 86, 'category' => 'coffee', 'title' => 'Kohvik August',           'location' => 'Väike-Karja 5, Tallinn'],

    // ── Bucharest ───────────────────────────────────────────────────────────────
    ['city_id' => 78, 'category' => 'bar',    'title' => 'Perfetto Bar',            'location' => 'Calea Victoriei, Bucharest'],
    ['city_id' => 78, 'category' => 'bar',    'title' => 'Sip',                     'location' => 'Str. Covaci 12, Bucharest'],
    ['city_id' => 78, 'category' => 'bar',    'title' => 'FIX Me a Drink',          'location' => 'Strada Ion Brezoianu 23-25, Bucharest'],
    ['city_id' => 78, 'category' => 'bar',    'title' => 'Interbelic',              'location' => 'Strada Șelari 9-11, Bucharest'],
    ['city_id' => 78, 'category' => 'coffee', 'title' => 'Origo',                   'location' => 'Strada Lipscani 9, Bucharest'],
    ['city_id' => 78, 'category' => 'coffee', 'title' => 'M60',                     'location' => 'Piața Amzei, Bucharest'],
    ['city_id' => 78, 'category' => 'coffee', 'title' => 'Beans & Dots',            'location' => 'Bucharest'],

    // ── Kyiv ────────────────────────────────────────────────────────────────────
    ['city_id' => 84, 'category' => 'bar',    'title' => 'Barman Dictat',           'location' => 'Tarasa Shevchenko Blvd 1, Kyiv'],
    ['city_id' => 84, 'category' => 'bar',    'title' => 'Parovoz',                 'location' => 'Lva Tolstoho Square, Kyiv'],
    ['city_id' => 84, 'category' => 'bar',    'title' => 'Alchemist',               'location' => 'Kyiv'],
    ['city_id' => 84, 'category' => 'bar',    'title' => 'Sklad',                   'location' => 'Bessarabska Square 2, Kyiv'],
    ['city_id' => 84, 'category' => 'coffee', 'title' => 'World of Coffee',         'location' => 'Ihorivska St 12, Podil, Kyiv'],
    ['city_id' => 84, 'category' => 'coffee', 'title' => 'Svit Kavy',               'location' => 'Velyka Vasylkivska St 23B, Kyiv'],
    ['city_id' => 84, 'category' => 'coffee', 'title' => 'Blur Coffee',             'location' => 'Dniprovska Naberezhna 12, Kyiv'],

    // ── Guadalajara ─────────────────────────────────────────────────────────────
    ['city_id' => 140, 'category' => 'bar',    'title' => 'Oliveria Cocktail Bar',  'location' => 'Libertad 1852, Col Americana, Guadalajara'],
    ['city_id' => 140, 'category' => 'bar',    'title' => 'El Gallo Altanero',      'location' => 'Colonia Americana, Guadalajara'],
    ['city_id' => 140, 'category' => 'bar',    'title' => 'La Fuente',              'location' => 'C. José María Morelos 1360, Guadalajara'],
    ['city_id' => 140, 'category' => 'bar',    'title' => 'Galgo',                  'location' => 'Guadalajara'],
    ['city_id' => 140, 'category' => 'coffee', 'title' => 'Café PalReal',           'location' => 'C. Lope de Vega 113, Guadalajara'],
    ['city_id' => 140, 'category' => 'coffee', 'title' => 'Leonela Café',           'location' => 'C. Emeterio Robles Gil 247, Guadalajara'],
    ['city_id' => 140, 'category' => 'coffee', 'title' => 'Caligari Café',          'location' => 'Colonia Americana, Guadalajara'],

    // ── Turin ───────────────────────────────────────────────────────────────────
    ['city_id' => 55, 'category' => 'bar',    'title' => 'Affini',                  'location' => 'San Salvario, Turin'],
    ['city_id' => 55, 'category' => 'bar',    'title' => 'La Drogheria',            'location' => 'Piazza Vittorio Veneto 18, Turin'],
    ['city_id' => 55, 'category' => 'bar',    'title' => 'Bar Cavour',              'location' => 'Del Cambio, Turin'],
    ['city_id' => 55, 'category' => 'bar',    'title' => 'Lanificio San Salvatore', 'location' => 'Turin'],
    ['city_id' => 55, 'category' => 'coffee', 'title' => 'Caffè Al Bicerin',        'location' => 'Piazza della Consolata, Turin'],
    ['city_id' => 55, 'category' => 'coffee', 'title' => 'Caffè Fiorio',            'location' => 'Via Po, Turin'],
    ['city_id' => 55, 'category' => 'coffee', 'title' => 'Caffè Torino',            'location' => 'Piazza San Carlo, Turin'],

    // ── Las Vegas ───────────────────────────────────────────────────────────────
    ['city_id' => 109, 'category' => 'bar',    'title' => 'Velveteen Rabbit',       'location' => '1218 S Main St, Las Vegas'],
    ['city_id' => 109, 'category' => 'bar',    'title' => 'Oak & Ivy',              'location' => '707 E Fremont St, Las Vegas'],
    ['city_id' => 109, 'category' => 'bar',    'title' => 'Downtown Cocktail Room',  'location' => '111 S Las Vegas Blvd, Las Vegas'],
    ['city_id' => 109, 'category' => 'bar',    'title' => 'Ghost Donkey',           'location' => 'The Cosmopolitan, Las Vegas'],
    ['city_id' => 109, 'category' => 'coffee', 'title' => 'Vesta Coffee',           'location' => '1114 S Casino Center Blvd, Las Vegas'],
    ['city_id' => 109, 'category' => 'coffee', 'title' => 'Makers & Finders',       'location' => '1120 S Main St, Las Vegas'],
    ['city_id' => 109, 'category' => 'coffee', 'title' => 'Parlour Coffee',         'location' => '616 E Carson Ave, Las Vegas'],

    // ── Phoenix ─────────────────────────────────────────────────────────────────
    ['city_id' => 98, 'category' => 'bar',    'title' => 'Bitter & Twisted',        'location' => '1 W Jefferson St, Phoenix'],
    ['city_id' => 98, 'category' => 'bar',    'title' => 'Highball',                'location' => '1514 N 7th Ave, Phoenix'],
    ['city_id' => 98, 'category' => 'bar',    'title' => 'Bar Saint Bruno',         'location' => '1029 N 1st St, Phoenix'],
    ['city_id' => 98, 'category' => 'bar',    'title' => 'Filthy',                  'location' => '455 N 3rd St, Phoenix'],
    ['city_id' => 98, 'category' => 'coffee', 'title' => 'Cartel Coffee Lab',       'location' => 'Phoenix'],
    ['city_id' => 98, 'category' => 'coffee', 'title' => 'Lux Central',             'location' => 'Central Avenue, Phoenix'],
    ['city_id' => 98, 'category' => 'coffee', 'title' => 'Songbird Coffee & Tea House','location' => 'Phoenix'],

    // ── San Antonio ─────────────────────────────────────────────────────────────
    ['city_id' => 100, 'category' => 'bar',    'title' => 'Bar 1919',               'location' => 'Blue Star Arts District, San Antonio'],
    ['city_id' => 100, 'category' => 'bar',    'title' => 'The Modernist',          'location' => 'San Antonio'],
    ['city_id' => 100, 'category' => 'bar',    'title' => 'Devils River Whiskey',   'location' => '401 E Houston St, San Antonio'],
    ['city_id' => 100, 'category' => 'bar',    'title' => 'Halcyon',                'location' => 'Blue Star Arts District, San Antonio'],
    ['city_id' => 100, 'category' => 'coffee', 'title' => 'San Antonio Gold',       'location' => '123 Heiman St, San Antonio'],
    ['city_id' => 100, 'category' => 'coffee', 'title' => 'Mural Coffee Roasters',  'location' => '1900 Broadway, San Antonio'],
    ['city_id' => 100, 'category' => 'coffee', 'title' => 'CommonWealth',           'location' => '1913 S Flores St, San Antonio'],

    // ── Tampa ───────────────────────────────────────────────────────────────────
    ['city_id' => 117, 'category' => 'bar',    'title' => "CW's Gin Joint",         'location' => 'Tampa'],
    ['city_id' => 117, 'category' => 'bar',    'title' => 'The Punch Room',         'location' => 'The Tampa EDITION, Tampa'],
    ['city_id' => 117, 'category' => 'bar',    'title' => 'Beacon',                 'location' => 'JW Marriott Water Street, Tampa'],
    ['city_id' => 117, 'category' => 'bar',    'title' => 'Jekyll',                 'location' => 'Tampa'],
    ['city_id' => 117, 'category' => 'coffee', 'title' => 'Buddy Brew',             'location' => 'Hyde Park Village, Tampa'],
    ['city_id' => 117, 'category' => 'coffee', 'title' => 'Kahwa Coffee Roasters',  'location' => 'Tampa'],
    ['city_id' => 117, 'category' => 'coffee', 'title' => 'Blind Tiger Coffee Roasters','location' => 'Ybor City, Tampa'],

    // ── Indianapolis ────────────────────────────────────────────────────────────
    ['city_id' => 121, 'category' => 'bar',    'title' => 'Ball & Biscuit',         'location' => '331 Massachusetts Ave, Indianapolis'],
    ['city_id' => 121, 'category' => 'bar',    'title' => 'The Alchemist',          'location' => 'Mass Ave, Indianapolis'],
    ['city_id' => 121, 'category' => 'bar',    'title' => 'Sundry and Vice',        'location' => 'Indianapolis'],
    ['city_id' => 121, 'category' => 'bar',    'title' => 'Nowhere Special',        'location' => 'Indianapolis'],
    ['city_id' => 121, 'category' => 'coffee', 'title' => 'Coat Check Coffee',      'location' => '401 E Michigan St, Indianapolis'],
    ['city_id' => 121, 'category' => 'coffee', 'title' => 'Quills Coffee',          'location' => 'Indianapolis'],
    ['city_id' => 121, 'category' => 'coffee', 'title' => 'Hubbard & Cravens',      'location' => 'Indianapolis'],

    // ── Jakarta ─────────────────────────────────────────────────────────────────
    ['city_id' => 192, 'category' => 'bar',    'title' => 'The Cocktail Club',      'location' => 'Jl. Senopati 37, Jakarta'],
    ['city_id' => 192, 'category' => 'bar',    'title' => 'modernhaus',             'location' => 'Thamrin Nine, Jakarta'],
    ['city_id' => 192, 'category' => 'bar',    'title' => 'Koda',                   'location' => 'Melawai, Jakarta'],
    ['city_id' => 192, 'category' => 'bar',    'title' => 'The Oddbird Bar',        'location' => 'Jl. Senopati 39, Jakarta'],
    ['city_id' => 192, 'category' => 'coffee', 'title' => 'Fuglen',                 'location' => 'SCBD, Jakarta'],
    ['city_id' => 192, 'category' => 'coffee', 'title' => 'First Crack',            'location' => 'Jl. Bumi 10, Jakarta'],
    ['city_id' => 192, 'category' => 'coffee', 'title' => 'Common Grounds',         'location' => 'Kelapa Gading, Jakarta'],

    // ── Delhi ───────────────────────────────────────────────────────────────────
    ['city_id' => 203, 'category' => 'bar',    'title' => 'Sidecar',                'location' => 'Basant Lok Market, Vasant Vihar, Delhi'],
    ['city_id' => 203, 'category' => 'bar',    'title' => 'Lair',                   'location' => 'Delhi'],
    ['city_id' => 203, 'category' => 'bar',    'title' => 'Hoots',                  'location' => 'Basant Lok Market, Vasant Vihar, Delhi'],
    ['city_id' => 203, 'category' => 'bar',    'title' => 'Mama Killa',             'location' => 'Mehrauli, Delhi'],
    ['city_id' => 203, 'category' => 'coffee', 'title' => 'Gram Street Coffee',     'location' => 'Delhi'],
    ['city_id' => 203, 'category' => 'coffee', 'title' => 'Blue Tokai Coffee Roasters','location' => 'Saket, Delhi'],
    ['city_id' => 203, 'category' => 'coffee', 'title' => 'Roastery Coffee House',  'location' => 'Delhi'],

    // ── Ghent ───────────────────────────────────────────────────────────────────
    ['city_id' => 290, 'category' => 'bar',    'title' => 'The Cobbler',            'location' => 'The Post Hotel, Ghent'],
    ['city_id' => 290, 'category' => 'bar',    'title' => "Jigger's",               'location' => 'Ghent'],
    ['city_id' => 290, 'category' => 'bar',    'title' => 'Rococo',                 'location' => 'Patershol, Ghent'],
    ['city_id' => 290, 'category' => 'bar',    'title' => 'Amigo',                  'location' => 'Dok Noord, Ghent'],
    ['city_id' => 290, 'category' => 'coffee', 'title' => 'Way',                    'location' => 'Ghent'],
    ['city_id' => 290, 'category' => 'coffee', 'title' => 'Take Five',              'location' => 'Ghent'],
    ['city_id' => 290, 'category' => 'coffee', 'title' => 'Full Circle Coffee',     'location' => 'Ghent'],

    // ── Wrocław ─────────────────────────────────────────────────────────────────
    ['city_id' => 294, 'category' => 'bar',    'title' => 'Cocktail Bar by Incognito','location' => 'Wrocław'],
    ['city_id' => 294, 'category' => 'bar',    'title' => 'Rusty Rat Cocktail Bar', 'location' => 'Wrocław'],
    ['city_id' => 294, 'category' => 'bar',    'title' => 'Szklarnia',              'location' => 'Ofiar Oświęcimskich 19, Wrocław'],
    ['city_id' => 294, 'category' => 'bar',    'title' => 'Papa Bar',               'location' => 'Wrocław'],
    ['city_id' => 294, 'category' => 'coffee', 'title' => 'El Gato Specialty Coffee Roasters','location' => 'Wrocław'],
    ['city_id' => 294, 'category' => 'coffee', 'title' => 'Kiosso',                 'location' => 'Wrocław'],
    ['city_id' => 294, 'category' => 'coffee', 'title' => 'Kawalerka',              'location' => 'Benedykta Polaka 12, Wrocław'],

    // ── Montevideo ──────────────────────────────────────────────────────────────
    ['city_id' => 166, 'category' => 'bar',    'title' => "Baker's Bar",            'location' => 'Pablo de María 1198, Montevideo'],
    ['city_id' => 166, 'category' => 'bar',    'title' => 'El Mingus',              'location' => 'Cordón Soho, Montevideo'],
    ['city_id' => 166, 'category' => 'bar',    'title' => 'Jackson Bar',            'location' => 'Juan D. Jackson 1220, Montevideo'],
    ['city_id' => 166, 'category' => 'bar',    'title' => 'Clandestino Bar',        'location' => 'Eduardo Víctor Haedo 1997, Montevideo'],
    ['city_id' => 166, 'category' => 'coffee', 'title' => 'Sauco Café',             'location' => 'Canelones 892, Montevideo'],
    ['city_id' => 166, 'category' => 'coffee', 'title' => 'Oro del Rhin',           'location' => 'Durazno 1402, Montevideo'],
    ['city_id' => 166, 'category' => 'coffee', 'title' => 'The Burrow Café',        'location' => 'Montevideo'],

    // ── Nantes ──────────────────────────────────────────────────────────────────
    ['city_id' => 25, 'category' => 'bar',    'title' => 'Bootlegger',              'location' => 'Nantes'],
    ['city_id' => 25, 'category' => 'bar',    'title' => 'La Réserve',              'location' => 'Nantes'],
    ['city_id' => 25, 'category' => 'bar',    'title' => "L'Industrie",             'location' => 'Nantes'],
    ['city_id' => 25, 'category' => 'bar',    'title' => 'Prohibition',             'location' => 'Nantes'],
    ['city_id' => 25, 'category' => 'coffee', 'title' => 'Café Sur Cour',           'location' => 'Place Louis Daubenton, Nantes'],
    ['city_id' => 25, 'category' => 'coffee', 'title' => 'Café Penché',             'location' => 'Nantes'],
    ['city_id' => 25, 'category' => 'coffee', 'title' => 'Chop Chop',               'location' => 'Nantes'],

    // ── Lille ───────────────────────────────────────────────────────────────────
    ['city_id' => 29, 'category' => 'bar',    'title' => 'Le Dandy',                'location' => 'Lille'],
    ['city_id' => 29, 'category' => 'bar',    'title' => 'Madwood',                 'location' => 'Lille'],
    ['city_id' => 29, 'category' => 'bar',    'title' => 'Bartown',                 'location' => 'Lille'],
    ['city_id' => 29, 'category' => 'bar',    'title' => 'Le Windsor',              'location' => 'Lille'],
    ['city_id' => 29, 'category' => 'coffee', 'title' => 'Paddo',                   'location' => 'Lille'],
    ['city_id' => 29, 'category' => 'coffee', 'title' => 'Tamper! Espresso Bar',    'location' => 'Rue des Vieux Murs, Lille'],
    ['city_id' => 29, 'category' => 'coffee', 'title' => 'Notting Hill Coffee',     'location' => 'Rue Esquermoise, Vieux-Lille, Lille'],

    // ── Columbus ────────────────────────────────────────────────────────────────
    ['city_id' => 122, 'category' => 'bar',    'title' => 'Service Bar',            'location' => '1230 Courtland Ave, Columbus'],
    ['city_id' => 122, 'category' => 'bar',    'title' => 'The Citizens Trust',     'location' => '11 W Gay Street, Columbus'],
    ['city_id' => 122, 'category' => 'bar',    'title' => 'Sacred Palm',            'location' => 'Short North, Columbus'],
    ['city_id' => 122, 'category' => 'bar',    'title' => 'The Oracle',             'location' => 'Olde Towne East, Columbus'],
    ['city_id' => 122, 'category' => 'coffee', 'title' => 'The Lion',               'location' => '2511 E Main St, Columbus'],
    ['city_id' => 122, 'category' => 'coffee', 'title' => 'Cure',                   'location' => 'Downtown, Columbus'],
    ['city_id' => 122, 'category' => 'coffee', 'title' => 'Qamaria Yemeni Coffee Co.','location' => 'Columbus'],

    // ── Honolulu ────────────────────────────────────────────────────────────────
    ['city_id' => 129, 'category' => 'bar',    'title' => 'Bar Leather Apron',      'location' => 'Honolulu'],
    ['city_id' => 129, 'category' => 'bar',    'title' => 'EP Bar',                 'location' => '1150 Nuuanu Ave, Honolulu'],
    ['city_id' => 129, 'category' => 'bar',    'title' => 'Obake',                  'location' => '1112 Smith St, Honolulu'],
    ['city_id' => 129, 'category' => 'bar',    'title' => 'Green Lady Cocktail Room','location' => '431 Nohonani St, Honolulu'],
    ['city_id' => 129, 'category' => 'coffee', 'title' => 'Island Vintage Coffee',  'location' => 'Waikiki, Honolulu'],
    ['city_id' => 129, 'category' => 'coffee', 'title' => 'Arvo',                   'location' => 'Kakaako, Honolulu'],
    ['city_id' => 129, 'category' => 'coffee', 'title' => 'Knots Coffee Roasters',  'location' => 'Honolulu'],

    // ── Fukuoka ─────────────────────────────────────────────────────────────────
    ['city_id' => 185, 'category' => 'bar',    'title' => 'Bar Oscar',              'location' => 'Tenjin, Fukuoka'],
    ['city_id' => 185, 'category' => 'bar',    'title' => 'Bar Sebek',              'location' => 'Fukuoka'],
    ['city_id' => 185, 'category' => 'bar',    'title' => 'Mitsubachi',             'location' => 'Fukuoka'],
    ['city_id' => 185, 'category' => 'bar',    'title' => 'Bar Leichardt',          'location' => 'Fukuoka'],
    ['city_id' => 185, 'category' => 'coffee', 'title' => 'Rec Coffee',             'location' => 'Tenjin, Fukuoka'],
    ['city_id' => 185, 'category' => 'coffee', 'title' => 'Manu Coffee',            'location' => 'Daimyo, Fukuoka'],
    ['city_id' => 185, 'category' => 'coffee', 'title' => 'Saredo Coffee',          'location' => 'Fukuoka'],

    // ── Curitiba ────────────────────────────────────────────────────────────────
    ['city_id' => 155, 'category' => 'bar',    'title' => 'We Are Bastards',        'location' => 'Água Verde, Curitiba'],
    ['city_id' => 155, 'category' => 'bar',    'title' => 'Taj Bar',                'location' => 'Av. Iguaçu 2310, Curitiba'],
    ['city_id' => 155, 'category' => 'bar',    'title' => 'Le Voleur de Vélo',      'location' => 'Curitiba'],
    ['city_id' => 155, 'category' => 'bar',    'title' => 'Gards Rooftop Bar',      'location' => 'Curitiba'],
    ['city_id' => 155, 'category' => 'coffee', 'title' => 'Lucca Cafés Especiais',  'location' => 'R. Comendador Fontana 229, Curitiba'],
    ['city_id' => 155, 'category' => 'coffee', 'title' => '4Beans Coffee Co.',      'location' => 'R. Gen. Carneiro 1434, Curitiba'],
    ['city_id' => 155, 'category' => 'coffee', 'title' => 'Distinctive Cafés',      'location' => 'Batel, Curitiba'],

    // ── Porto Alegre ────────────────────────────────────────────────────────────
    ['city_id' => 157, 'category' => 'bar',    'title' => 'Capone Drinkeria',       'location' => 'Porto Alegre'],
    ['city_id' => 157, 'category' => 'bar',    'title' => 'Dirty Old Man',          'location' => 'Cidade Baixa, Porto Alegre'],
    ['city_id' => 157, 'category' => 'bar',    'title' => 'Spoiler Bar',            'location' => 'R. Quintino Bocaiúva 256, Porto Alegre'],
    ['city_id' => 157, 'category' => 'bar',    'title' => 'A Virgem',               'location' => 'Porto Alegre'],
    ['city_id' => 157, 'category' => 'coffee', 'title' => 'Moa Cafeteria',          'location' => 'R. Cel. Bordini 332, Porto Alegre'],
    ['city_id' => 157, 'category' => 'coffee', 'title' => 'Café do Mercado',        'location' => 'Mercado Público, Porto Alegre'],
    ['city_id' => 157, 'category' => 'coffee', 'title' => 'Ginkgo',                 'location' => 'Porto Alegre'],

    // ── Canberra ────────────────────────────────────────────────────────────────
    ['city_id' => 275, 'category' => 'bar',    'title' => 'Molly',                  'location' => 'Odgers Lane, Canberra'],
    ['city_id' => 275, 'category' => 'bar',    'title' => 'Bar Rochford',           'location' => '65 London Circuit, Canberra'],
    ['city_id' => 275, 'category' => 'bar',    'title' => 'The Shaking Hand',       'location' => '7 Akuna St, Canberra'],
    ['city_id' => 275, 'category' => 'bar',    'title' => 'White Rabbit Cocktail Room','location' => '150 Northbourne Ave, Braddon, Canberra'],
    ['city_id' => 275, 'category' => 'coffee', 'title' => 'The Cupping Room',       'location' => 'Canberra'],
    ['city_id' => 275, 'category' => 'coffee', 'title' => 'Lonsdale Street Roasters','location' => 'Braddon, Canberra'],
    ['city_id' => 275, 'category' => 'coffee', 'title' => 'Highroad',               'location' => 'Canberra'],

    // ── Saragossa (Zaragoza) ─────────────────────────────────────────────────────
    ['city_id' => 284, 'category' => 'bar',    'title' => 'Moonlight Experimental Bar','location' => 'Casco Antiguo, Zaragoza'],
    ['city_id' => 284, 'category' => 'bar',    'title' => 'El Federal Cocktail Bar', 'location' => 'Casco Antiguo, Zaragoza'],
    ['city_id' => 284, 'category' => 'bar',    'title' => 'Umalas Bar',             'location' => 'Casco Antiguo, Zaragoza'],
    ['city_id' => 284, 'category' => 'bar',    'title' => 'El 35 Gin Club',         'location' => 'Zaragoza'],
    ['city_id' => 284, 'category' => 'coffee', 'title' => 'Met Coffee & Co',        'location' => 'Santa Teresa de Jesús 7, Zaragoza'],
    ['city_id' => 284, 'category' => 'coffee', 'title' => 'Criollo Coffee Store',   'location' => 'Zaragoza'],
    ['city_id' => 284, 'category' => 'coffee', 'title' => 'Café Nolasco',           'location' => 'Plaza de San Pedro Nolasco, Zaragoza'],

    // ── Macau ───────────────────────────────────────────────────────────────────
    ['city_id' => 327, 'category' => 'bar',    'title' => 'Wing Lei Bar',           'location' => 'Wynn Palace, Cotai, Macau'],
    ['city_id' => 327, 'category' => 'bar',    'title' => 'Mesa Bar',               'location' => 'Grand Lisboa Palace, Macau'],
    ['city_id' => 327, 'category' => 'bar',    'title' => 'Patuá Bar',              'location' => 'MGM Cotai, Macau'],
    ['city_id' => 327, 'category' => 'bar',    'title' => 'Vida Rica Bar',          'location' => 'Mandarin Oriental, Macau'],
    ['city_id' => 327, 'category' => 'coffee', 'title' => 'Two Moons',              'location' => 'Macau'],
    ['city_id' => 327, 'category' => 'coffee', 'title' => 'Single Origin',          'location' => 'Macau'],
    ['city_id' => 327, 'category' => 'coffee', 'title' => 'Terra Coffee House',     'location' => 'Macau'],

    // ── Monterrey ───────────────────────────────────────────────────────────────
    ['city_id' => 141, 'category' => 'bar',    'title' => 'Maverick',               'location' => 'Monterrey'],
    ['city_id' => 141, 'category' => 'bar',    'title' => 'Cuerno',                 'location' => 'San Pedro Garza García, Monterrey'],
    ['city_id' => 141, 'category' => 'bar',    'title' => 'Sibau',                  'location' => 'Monterrey'],
    ['city_id' => 141, 'category' => 'bar',    'title' => 'Mezcalerito',            'location' => 'Monterrey'],
    ['city_id' => 141, 'category' => 'coffee', 'title' => 'Alchemy Coffee Lab',     'location' => 'Del Valle, Monterrey'],
    ['city_id' => 141, 'category' => 'coffee', 'title' => 'BreAd Panaderos Artesanales','location' => 'San Pedro, Monterrey'],
    ['city_id' => 141, 'category' => 'coffee', 'title' => 'Cafeología',             'location' => 'Monterrey'],

    // ── Cancún ──────────────────────────────────────────────────────────────────
    ['city_id' => 142, 'category' => 'bar',    'title' => "Porfirio's",             'location' => 'Cancún'],
    ['city_id' => 142, 'category' => 'bar',    'title' => 'Mumma Rooftop Bar',      'location' => 'Nomads Hotel, Cancún'],
    ['city_id' => 142, 'category' => 'bar',    'title' => 'Nader 88',               'location' => 'Cancún'],
    ['city_id' => 142, 'category' => 'bar',    'title' => 'La Bodeguita del Medio', 'location' => 'Cancún'],
    ['city_id' => 142, 'category' => 'coffee', 'title' => 'Ah Cacao',               'location' => 'La Isla, Cancún'],
    ['city_id' => 142, 'category' => 'coffee', 'title' => 'Café con Gracia',        'location' => 'Avenida Tankah, Cancún'],
    ['city_id' => 142, 'category' => 'coffee', 'title' => 'Royal Roast Coffee Co.', 'location' => 'Cancún'],

    // ── Tijuana ─────────────────────────────────────────────────────────────────
    ['city_id' => 143, 'category' => 'bar',    'title' => 'Nórtico',                'location' => 'Emilio Carranza 3107, Tijuana'],
    ['city_id' => 143, 'category' => 'bar',    'title' => 'Dandy Del Sur',          'location' => 'Flores Magón 8274, Tijuana'],
    ['city_id' => 143, 'category' => 'bar',    'title' => 'Cereus',                 'location' => 'Tijuana'],
    ['city_id' => 143, 'category' => 'bar',    'title' => 'Rifo',                   'location' => 'Zona Río, Tijuana'],
    ['city_id' => 143, 'category' => 'coffee', 'title' => "Pichino's Coffee House", 'location' => 'Tijuana'],
    ['city_id' => 143, 'category' => 'coffee', 'title' => 'Electric Coffee Roasters','location' => 'Tijuana'],
    ['city_id' => 143, 'category' => 'coffee', 'title' => 'Unity Coffee House',     'location' => 'Tijuana'],

    // ── Panama City ─────────────────────────────────────────────────────────────
    ['city_id' => 144, 'category' => 'bar',    'title' => 'Amano Bar',              'location' => 'Casco Viejo, Panama City'],
    ['city_id' => 144, 'category' => 'bar',    'title' => 'Pedro Mandinga Rum Bar', 'location' => 'Casco Viejo, Panama City'],
    ['city_id' => 144, 'category' => 'bar',    'title' => 'CasaCasco',              'location' => 'Casco Viejo, Panama City'],
    ['city_id' => 144, 'category' => 'bar',    'title' => 'Hooch',                  'location' => 'Panama City'],
    ['city_id' => 144, 'category' => 'coffee', 'title' => 'Café Unido',             'location' => 'Via Argentina, Panama City'],
    ['city_id' => 144, 'category' => 'coffee', 'title' => 'Tiempos Coffee',         'location' => 'American Trade Hotel, Casco Viejo, Panama City'],
    ['city_id' => 144, 'category' => 'coffee', 'title' => 'Leto Coffee Brew Bar',   'location' => 'Panama City'],

    // ── Guatemala City ──────────────────────────────────────────────────────────
    ['city_id' => 146, 'category' => 'bar',    'title' => 'El Sesteo',              'location' => 'Zona 10, Guatemala City'],
    ['city_id' => 146, 'category' => 'bar',    'title' => 'La Esquina',             'location' => 'Zona 4, Guatemala City'],
    ['city_id' => 146, 'category' => 'bar',    'title' => 'Sky Bar Barceló',        'location' => 'Zona 9, Guatemala City'],
    ['city_id' => 146, 'category' => 'bar',    'title' => 'Bar La Luna',            'location' => 'Guatemala City'],
    ['city_id' => 146, 'category' => 'coffee', 'title' => 'Teco Coffee House',      'location' => '9 Avenida 2-18, Guatemala City'],
    ['city_id' => 146, 'category' => 'coffee', 'title' => "Mano's Coffee",          'location' => 'Guatemala City'],
    ['city_id' => 146, 'category' => 'coffee', 'title' => 'Rojo Cerezo Coffee',     'location' => 'Zona 4, Guatemala City'],

    // ── Brasília ────────────────────────────────────────────────────────────────
    ['city_id' => 151, 'category' => 'bar',    'title' => '313 Drink Bar',          'location' => 'Brasília'],
    ['city_id' => 151, 'category' => 'bar',    'title' => 'Pinella Bar',            'location' => 'Asa Norte, Brasília'],
    ['city_id' => 151, 'category' => 'bar',    'title' => 'Bar Responsa',           'location' => 'Brasília'],
    ['city_id' => 151, 'category' => 'bar',    'title' => 'Villa Carioca',          'location' => 'Asa Norte, Brasília'],
    ['city_id' => 151, 'category' => 'coffee', 'title' => 'Café Cristina',          'location' => 'Asa Norte, Brasília'],
    ['city_id' => 151, 'category' => 'coffee', 'title' => 'Clandestino Café',       'location' => 'Brasília'],
    ['city_id' => 151, 'category' => 'coffee', 'title' => 'Ernesto Cafés Especiais','location' => 'Asa Norte, Brasília'],

    // ── Asunción ────────────────────────────────────────────────────────────────
    ['city_id' => 167, 'category' => 'bar',    'title' => 'Checkpoint Downtown Bar','location' => 'Mcal. Estigarribia 456, Asunción'],
    ['city_id' => 167, 'category' => 'bar',    'title' => "O'Leary Club",           'location' => 'Juan E. O\'Leary 127, Asunción'],
    ['city_id' => 167, 'category' => 'bar',    'title' => 'Negroni Downtown Skybar','location' => 'Unicentro, Asunción'],
    ['city_id' => 167, 'category' => 'bar',    'title' => 'Coyote Drinks',          'location' => 'Asunción'],
    ['city_id' => 167, 'category' => 'coffee', 'title' => "Mary's Coffee",          'location' => 'Asunción'],
    ['city_id' => 167, 'category' => 'coffee', 'title' => 'Kafa Tostadores',        'location' => 'Ayala Velazquez 795, Asunción'],
    ['city_id' => 167, 'category' => 'coffee', 'title' => 'El Café de Acá',         'location' => 'Villa Morra, Asunción'],

    // ── Córdoba (Argentina) ──────────────────────────────────────────────────────
    ['city_id' => 170, 'category' => 'bar',    'title' => 'Milk Compañía Argentina de Cocteles','location' => 'Laprida 139, Córdoba'],
    ['city_id' => 170, 'category' => 'bar',    'title' => "Don't Worry Güemes",     'location' => 'Belgrano 695, Córdoba'],
    ['city_id' => 170, 'category' => 'bar',    'title' => 'Five Music',             'location' => 'Rondeau 38, Córdoba'],
    ['city_id' => 170, 'category' => 'bar',    'title' => 'Francis Bar & Charcutería','location' => 'Av. Marcelo T. de Alvear 386, Córdoba'],
    ['city_id' => 170, 'category' => 'coffee', 'title' => 'Goulu',                  'location' => 'Córdoba'],
    ['city_id' => 170, 'category' => 'coffee', 'title' => 'Santa Luz',              'location' => 'Av. Vélez Sarsfield 89, Córdoba'],
    ['city_id' => 170, 'category' => 'coffee', 'title' => 'La Vereda de Achaval',   'location' => 'Güemes, Córdoba'],

    // ── Mendoza ─────────────────────────────────────────────────────────────────
    ['city_id' => 321, 'category' => 'bar',    'title' => 'Charco Andino Bar',      'location' => 'Chacras de Coria, Mendoza'],
    ['city_id' => 321, 'category' => 'bar',    'title' => 'La Central Vermutería',  'location' => 'Av. Bartolomé Mitre 794, Mendoza'],
    ['city_id' => 321, 'category' => 'bar',    'title' => 'Gómez Rooftop',          'location' => 'Arístides Villanueva 528, Mendoza'],
    ['city_id' => 321, 'category' => 'bar',    'title' => 'Por Acá',                'location' => 'Arístides Villanueva, Mendoza'],
    ['city_id' => 321, 'category' => 'coffee', 'title' => 'Bröd Ciudad',            'location' => 'Chile 894, Mendoza'],
    ['city_id' => 321, 'category' => 'coffee', 'title' => 'Monono',                 'location' => 'Av. España 923, Mendoza'],
    ['city_id' => 321, 'category' => 'coffee', 'title' => 'Bonafide',               'location' => 'Av. San Martín 1483, Mendoza'],

    // ── Sarajevo ────────────────────────────────────────────────────────────────
    ['city_id' => 300, 'category' => 'bar',    'title' => 'Barometar',              'location' => 'Sarajevo'],
    ['city_id' => 300, 'category' => 'bar',    'title' => 'La Cava',                'location' => 'Baščaršija, Sarajevo'],
    ['city_id' => 300, 'category' => 'bar',    'title' => 'City Pub',               'location' => 'Mehmeda Spahe 20, Sarajevo'],
    ['city_id' => 300, 'category' => 'bar',    'title' => 'Zlatna Ribica',          'location' => 'Sarajevo'],
    ['city_id' => 300, 'category' => 'coffee', 'title' => 'Kawa',                   'location' => 'Sarački 32, Sarajevo'],
    ['city_id' => 300, 'category' => 'coffee', 'title' => 'Ministry of Ćejf',       'location' => 'Sarajevo'],
    ['city_id' => 300, 'category' => 'coffee', 'title' => 'Fabrika Coffee',         'location' => 'Sarački 70, Sarajevo'],

    // ── Kazan ───────────────────────────────────────────────────────────────────
    ['city_id' => 95, 'category' => 'bar',    'title' => 'Relab Cocktail Bar',      'location' => 'Kazan'],
    ['city_id' => 95, 'category' => 'bar',    'title' => 'Zero Bar',                'location' => 'Profsoyuznaya 34, Kazan'],
    ['city_id' => 95, 'category' => 'bar',    'title' => "Nit' Bar",                'location' => 'Profsoyuznaya 10/14, Kazan'],
    ['city_id' => 95, 'category' => 'bar',    'title' => 'Volna',                   'location' => 'Kazan'],
    ['city_id' => 95, 'category' => 'coffee', 'title' => 'Neft Cafe',               'location' => 'Universitetskaya, Kazan'],
    ['city_id' => 95, 'category' => 'coffee', 'title' => 'Smorodina',               'location' => 'Universitetskaya 7, Kazan'],
    ['city_id' => 95, 'category' => 'coffee', 'title' => 'Skuratov Coffee',         'location' => 'Kazan'],

    // ── Almaty ──────────────────────────────────────────────────────────────────
    ['city_id' => 218, 'category' => 'bar',    'title' => 'Bla Bla Bar',            'location' => 'Valikhanov St 170, Almaty'],
    ['city_id' => 218, 'category' => 'bar',    'title' => 'Barbara',                'location' => 'Almaty'],
    ['city_id' => 218, 'category' => 'coffee', 'title' => 'Bowler Coffee Roasters', 'location' => 'Seyfullin Avenue, Almaty'],
    ['city_id' => 218, 'category' => 'coffee', 'title' => 'Spectre Coffee',         'location' => 'Almaty'],
    ['city_id' => 218, 'category' => 'coffee', 'title' => 'Urban Coffee',           'location' => 'Kabanbai Batyr St 33, Almaty'],

    // ── Amman ───────────────────────────────────────────────────────────────────
    ['city_id' => 235, 'category' => 'bar',    'title' => 'District Urban Rooftop', 'location' => 'Jabal Amman, Amman'],
    ['city_id' => 235, 'category' => 'bar',    'title' => 'La Calle',               'location' => 'Rainbow Street, Amman'],
    ['city_id' => 235, 'category' => 'bar',    'title' => 'Cantaloupe',             'location' => 'Abdali, Amman'],
    ['city_id' => 235, 'category' => 'bar',    'title' => 'Sirr Bar',               'location' => 'Four Seasons, Amman'],
    ['city_id' => 235, 'category' => 'coffee', 'title' => "Dimitri's Coffee",       'location' => 'Jabal al-Weibdeh, Amman'],
    ['city_id' => 235, 'category' => 'coffee', 'title' => 'Turtle Green Tea Bar',   'location' => 'Rainbow Street, Amman'],
    ['city_id' => 235, 'category' => 'coffee', 'title' => 'Books@cafe',             'location' => 'Jabal Amman, Amman'],

    // ── Accra ───────────────────────────────────────────────────────────────────
    ['city_id' => 249, 'category' => 'bar',    'title' => 'Skybar 25',              'location' => 'Villaggio Vista, Accra'],
    ['city_id' => 249, 'category' => 'bar',    'title' => 'Bloom Bar',              'location' => 'Osu, Accra'],
    ['city_id' => 249, 'category' => 'bar',    'title' => 'Sai',                    'location' => 'Labone, Accra'],
    ['city_id' => 249, 'category' => 'bar',    'title' => 'Exhale Lounge',          'location' => '25 Garden Rd, Accra'],
    ['city_id' => 249, 'category' => 'coffee', 'title' => 'Café Kwae',              'location' => 'Accra'],
    ['city_id' => 249, 'category' => 'coffee', 'title' => "Moka's Resto Café",      'location' => 'Accra'],
    ['city_id' => 249, 'category' => 'coffee', 'title' => 'Theia Coffee House',     'location' => 'Accra'],

    // ── Casablanca ──────────────────────────────────────────────────────────────
    ['city_id' => 259, 'category' => 'bar',    'title' => "Rick's Café",            'location' => '248 Bd Sour Jdid, Casablanca'],
    ['city_id' => 259, 'category' => 'bar',    'title' => 'Le Cabestan',            'location' => 'Bd de la Corniche, Casablanca'],
    ['city_id' => 259, 'category' => 'bar',    'title' => 'Sky 28',                 'location' => 'Kenzi Tower, Casablanca'],
    ['city_id' => 259, 'category' => 'bar',    'title' => 'The Nixx',               'location' => '1 Bd Mohamed Abdou, Casablanca'],
    ['city_id' => 259, 'category' => 'coffee', 'title' => 'Bondi Coffee Kitchen',   'location' => 'Casablanca'],
    ['city_id' => 259, 'category' => 'coffee', 'title' => 'Arabica',                'location' => 'Anfa Boulevard, Casablanca'],
    ['city_id' => 259, 'category' => 'coffee', 'title' => 'Café Bianca',            'location' => 'Casablanca'],

    // ── Łódź ────────────────────────────────────────────────────────────────────
    ['city_id' => 293, 'category' => 'bar',    'title' => 'Spaleni Słońcem',        'location' => 'Piotrkowska 138/140, Łódź'],
    ['city_id' => 293, 'category' => 'bar',    'title' => 'Stopklatka Cocktail Bar','location' => 'Łódź'],
    ['city_id' => 293, 'category' => 'bar',    'title' => 'Whiskey In The Jar',     'location' => 'Łódź'],
    ['city_id' => 293, 'category' => 'bar',    'title' => 'Woda i Ogień',           'location' => 'Łódź'],
    ['city_id' => 293, 'category' => 'coffee', 'title' => 'Owoce i Warzywa',        'location' => 'Piotrkowska 217, Łódź'],
    ['city_id' => 293, 'category' => 'coffee', 'title' => 'Przędza',                'location' => 'Łódź'],
    ['city_id' => 293, 'category' => 'coffee', 'title' => 'Niebostan',              'location' => 'Piotrkowska 17, Łódź'],

    // ── Minsk ───────────────────────────────────────────────────────────────────
    ['city_id' => 296, 'category' => 'bar',    'title' => 'Madmen',                 'location' => 'Minsk'],
    ['city_id' => 296, 'category' => 'bar',    'title' => 'ID Bar',                 'location' => 'Zybickaja 9, Minsk'],
    ['city_id' => 296, 'category' => 'coffee', 'title' => 'Zerno',                  'location' => 'Minsk'],
    ['city_id' => 296, 'category' => 'coffee', 'title' => 'Cafe 26',                'location' => 'Minsk'],
    ['city_id' => 296, 'category' => 'coffee', 'title' => 'Manufactura',            'location' => 'Minsk'],

    // ── Odessa ──────────────────────────────────────────────────────────────────
    ['city_id' => 298, 'category' => 'bar',    'title' => 'The Fitz',               'location' => 'Ekateryninska 6, Odessa'],
    ['city_id' => 298, 'category' => 'bar',    'title' => 'Mint Lounge',            'location' => 'Deribasivska 5, Odessa'],
    ['city_id' => 298, 'category' => 'bar',    'title' => 'Granat',                 'location' => 'Ekateryninska 1, Odessa'],
    ['city_id' => 298, 'category' => 'bar',    'title' => 'Zelda Bar',              'location' => 'Lanzheronivska 26, Odessa'],
    ['city_id' => 298, 'category' => 'coffee', 'title' => 'Coffeetory',             'location' => 'Odessa'],
    ['city_id' => 298, 'category' => 'coffee', 'title' => 'Tishina',                'location' => 'Odessa'],
    ['city_id' => 298, 'category' => 'coffee', 'title' => 'Atelier',                'location' => 'Odessa'],

    // ── Jacksonville ────────────────────────────────────────────────────────────
    ['city_id' => 309, 'category' => 'bar',    'title' => 'Sidecar',                'location' => '1000 Riverside Ave, Jacksonville'],
    ['city_id' => 309, 'category' => 'bar',    'title' => 'The Volstead',           'location' => '1406 Hendricks Ave, Jacksonville'],
    ['city_id' => 309, 'category' => 'bar',    'title' => 'Dos Gatos',              'location' => 'Downtown, Jacksonville'],
    ['city_id' => 309, 'category' => 'bar',    'title' => 'Grape & Grain Exchange', 'location' => 'San Marco, Jacksonville'],
    ['city_id' => 309, 'category' => 'coffee', 'title' => 'Bold Bean Coffee Roasters','location' => 'Riverside, Jacksonville'],
    ['city_id' => 309, 'category' => 'coffee', 'title' => 'Vagabond Coffee',        'location' => 'Murray Hill, Jacksonville'],
    ['city_id' => 309, 'category' => 'coffee', 'title' => 'Social Grounds Coffee',  'location' => 'Riverside, Jacksonville'],

    // ── Fort Worth ──────────────────────────────────────────────────────────────
    ['city_id' => 310, 'category' => 'bar',    'title' => 'Proper',                 'location' => '409 W Magnolia Ave, Fort Worth'],
    ['city_id' => 310, 'category' => 'bar',    'title' => 'The Coupe',              'location' => '1404 W Magnolia Ave, Fort Worth'],
    ['city_id' => 310, 'category' => 'bar',    'title' => "Thompson's",             'location' => 'Fort Worth'],
    ['city_id' => 310, 'category' => 'bar',    'title' => "Jackie O's Cocktail Club",'location' => 'Fort Worth'],
    ['city_id' => 310, 'category' => 'coffee', 'title' => 'Crude Craft Coffee Bar', 'location' => '804 S Main St, Fort Worth'],
    ['city_id' => 310, 'category' => 'coffee', 'title' => 'Race Street Coffee',     'location' => '3021 Race St, Fort Worth'],
    ['city_id' => 310, 'category' => 'coffee', 'title' => 'Enduro Coffee Roasters', 'location' => 'Fort Worth'],

    // ── Fresno ──────────────────────────────────────────────────────────────────
    ['city_id' => 313, 'category' => 'bar',    'title' => 'Bespoke Cocktail Lounge','location' => '711 Fulton St, Fresno'],
    ['city_id' => 313, 'category' => 'bar',    'title' => 'Modernist',              'location' => '719 Fulton St, Fresno'],
    ['city_id' => 313, 'category' => 'bar',    'title' => 'The Golden Hour',        'location' => 'Fresno'],
    ['city_id' => 313, 'category' => 'bar',    'title' => 'Neat & Noir',            'location' => 'Fresno'],
    ['city_id' => 313, 'category' => 'coffee', 'title' => 'Kuppa Joy Coffee House', 'location' => 'Fresno'],
    ['city_id' => 313, 'category' => 'coffee', 'title' => 'Otherside Cafe',         'location' => 'North Fresno, Fresno'],
    ['city_id' => 313, 'category' => 'coffee', 'title' => 'Component Coffee Lab',   'location' => 'Downtown, Fresno'],

    // ── Milwaukee ───────────────────────────────────────────────────────────────
    ['city_id' => 315, 'category' => 'bar',    'title' => "Bryant's Cocktail Lounge",'location' => 'Milwaukee'],
    ['city_id' => 315, 'category' => 'bar',    'title' => 'Edith Cocktail Bar',     'location' => 'Milwaukee'],
    ['city_id' => 315, 'category' => 'bar',    'title' => 'The Tin Widow',          'location' => 'Milwaukee'],
    ['city_id' => 315, 'category' => 'bar',    'title' => 'Lost Whale',             'location' => 'Milwaukee'],
    ['city_id' => 315, 'category' => 'coffee', 'title' => 'Rochambo Coffee and Tea House','location' => 'Brady Street, Milwaukee'],
    ['city_id' => 315, 'category' => 'coffee', 'title' => 'Valentine Coffee Roasters','location' => 'Vliet Street, Milwaukee'],
    ['city_id' => 315, 'category' => 'coffee', 'title' => 'Canary Coffee Bar',      'location' => 'Westown, Milwaukee'],

    // ── Louisville ──────────────────────────────────────────────────────────────
    ['city_id' => 319, 'category' => 'bar',    'title' => 'Hell or High Water',     'location' => '112 W Washington St, Louisville'],
    ['city_id' => 319, 'category' => 'bar',    'title' => 'Trial + Error',          'location' => '722 W Main St, Louisville'],
    ['city_id' => 319, 'category' => 'bar',    'title' => 'Black Rabbit',           'location' => '122 Sears Ave, Louisville'],
    ['city_id' => 319, 'category' => 'bar',    'title' => 'Pretty Decent',          'location' => '2235 Frankfort Ave, Louisville'],
    ['city_id' => 319, 'category' => 'coffee', 'title' => 'Quills Coffee',          'location' => 'Louisville'],
    ['city_id' => 319, 'category' => 'coffee', 'title' => 'Sunergos Coffee',        'location' => 'Louisville'],
    ['city_id' => 319, 'category' => 'coffee', 'title' => 'Please & Thank You',     'location' => 'Louisville'],

    // ── Nairobi ─────────────────────────────────────────────────────────────────
    ['city_id' => 18, 'category' => 'bar',    'title' => 'Hero Bar',                'location' => 'Nairobi'],
    ['city_id' => 18, 'category' => 'bar',    'title' => 'Jekyll & Hyde',           'location' => 'Westlands, Nairobi'],
    ['city_id' => 18, 'category' => 'bar',    'title' => 'BangBang',                'location' => 'Village Market, Nairobi'],
    ['city_id' => 18, 'category' => 'bar',    'title' => 'The Living Rooms',        'location' => 'Nairobi'],
    ['city_id' => 18, 'category' => 'coffee', 'title' => 'Amka',                    'location' => 'CBD, Nairobi'],
    ['city_id' => 18, 'category' => 'coffee', 'title' => 'Stream',                  'location' => 'Gigiri, Nairobi'],
    ['city_id' => 18, 'category' => 'coffee', 'title' => 'Barista & Co',            'location' => 'Nairobi'],

    // ── Yerevan ─────────────────────────────────────────────────────────────────
    ['city_id' => 224, 'category' => 'bar',    'title' => 'Minas Cocktail Room',    'location' => 'Yerevan'],
    ['city_id' => 224, 'category' => 'bar',    'title' => 'The Phoenix Bar',        'location' => 'Yerevan'],
    ['city_id' => 224, 'category' => 'bar',    'title' => 'Roza Bar',               'location' => 'Yerevan'],
    ['city_id' => 224, 'category' => 'bar',    'title' => 'Daboo',                  'location' => 'Cascade, Yerevan'],
    ['city_id' => 224, 'category' => 'coffee', 'title' => 'Ground Zero Specialty Coffee','location' => 'Yerevan'],
    ['city_id' => 224, 'category' => 'coffee', 'title' => 'Hayk Coffee Roasters',   'location' => 'Yerevan'],
    ['city_id' => 224, 'category' => 'coffee', 'title' => 'Lumen Coffee',           'location' => 'Yerevan'],

    // ── Astana ──────────────────────────────────────────────────────────────────
    ['city_id' => 219, 'category' => 'bar',    'title' => 'Ozen',                   'location' => 'Ritz-Carlton, Astana'],
    ['city_id' => 219, 'category' => 'bar',    'title' => 'Dark Side Bar',          'location' => 'Mangilik Yel 52a, Astana'],
    ['city_id' => 219, 'category' => 'bar',    'title' => 'Local Bar',              'location' => 'Astana'],
    ['city_id' => 219, 'category' => 'bar',    'title' => 'The Leprechaun',         'location' => 'Kabanbai Batyr 58, Astana'],
    ['city_id' => 219, 'category' => 'coffee', 'title' => 'Coffee Boom',            'location' => 'Astana'],
    ['city_id' => 219, 'category' => 'coffee', 'title' => 'Marrone Coffee',         'location' => 'Astana'],

    // ── Bishkek ─────────────────────────────────────────────────────────────────
    ['city_id' => 221, 'category' => 'bar',    'title' => 'CoCoGin',                'location' => '92 Bokonbaeva St, Bishkek'],
    ['city_id' => 221, 'category' => 'bar',    'title' => 'No Name Bar',            'location' => 'Bokonbaeva St, Bishkek'],
    ['city_id' => 221, 'category' => 'coffee', 'title' => 'Flask',                  'location' => 'Erkindik 9, Bishkek'],
    ['city_id' => 221, 'category' => 'coffee', 'title' => 'Sierra Coffee',          'location' => 'Manas St, Bishkek'],
    ['city_id' => 221, 'category' => 'coffee', 'title' => 'Kölökö',                 'location' => 'Abdymomunov 229, Bishkek'],

    // ── Abidjan ─────────────────────────────────────────────────────────────────
    ['city_id' => 246, 'category' => 'bar',    'title' => 'Le Roof Top',            'location' => 'Ivotel, Plateau, Abidjan'],
    ['city_id' => 246, 'category' => 'bar',    'title' => 'Link Bar',               'location' => 'Sofitel, Cocody, Abidjan'],
    ['city_id' => 246, 'category' => 'bar',    'title' => 'Monak',                  'location' => 'Abidjan'],
    ['city_id' => 246, 'category' => 'bar',    'title' => 'Swell Lounge',           'location' => 'Abidjan'],
    ['city_id' => 246, 'category' => 'coffee', 'title' => 'Café Continent',         'location' => 'Zone 03, Abidjan'],
    ['city_id' => 246, 'category' => 'coffee', 'title' => 'La Croissanterie',       'location' => 'Abidjan'],

    // ── Kigali ──────────────────────────────────────────────────────────────────
    ['city_id' => 253, 'category' => 'bar',    'title' => 'Chillax Lounge',         'location' => 'Kigali'],
    ['city_id' => 253, 'category' => 'bar',    'title' => 'Y&T Cocktail Bar',       'location' => 'Kigali'],
    ['city_id' => 253, 'category' => 'bar',    'title' => 'The Piano Bar',          'location' => 'Kigali'],
    ['city_id' => 253, 'category' => 'bar',    'title' => 'Kivu Noir',              'location' => 'Kimihurura, Kigali'],
    ['city_id' => 253, 'category' => 'coffee', 'title' => 'Inzora Rooftop Café',    'location' => 'Kacyiru, Kigali'],
    ['city_id' => 253, 'category' => 'coffee', 'title' => 'Rubia Coffee Roasters',  'location' => 'Kimihurura, Kigali'],
    ['city_id' => 253, 'category' => 'coffee', 'title' => 'Question Coffee',        'location' => 'Gishushu, Kigali'],

    // ── Tianjin ─────────────────────────────────────────────────────────────────
    ['city_id' => 322, 'category' => 'bar',    'title' => 'Le Procope Lounge',      'location' => '126 Chengdu Ave, Tianjin'],
    ['city_id' => 322, 'category' => 'bar',    'title' => "O'Hara's",               'location' => "Tong'an Rd, Tianjin"],
    ['city_id' => 322, 'category' => 'bar',    'title' => 'Rich Cat',               'location' => 'Heping, Tianjin'],
    ['city_id' => 322, 'category' => 'bar',    'title' => 'The St. Regis Bar',      'location' => 'Tianjin'],
    ['city_id' => 322, 'category' => 'coffee', 'title' => 'Seesaw Coffee',          'location' => 'Tianjin'],
    ['city_id' => 322, 'category' => 'coffee', 'title' => 'Manner Coffee',          'location' => 'Tianjin'],
    ['city_id' => 322, 'category' => 'coffee', 'title' => '% Arabica',              'location' => 'Tianjin'],

    // ── Dhaka ───────────────────────────────────────────────────────────────────
    ['city_id' => 214, 'category' => 'bar',    'title' => 'Skye Lounge & Bar',      'location' => 'Hotel Sweet Dreams, Dhaka'],
    ['city_id' => 214, 'category' => 'bar',    'title' => 'Fu Wang Bar',            'location' => 'Begum Rokeya Ave, Dhaka'],
    ['city_id' => 214, 'category' => 'bar',    'title' => 'Tribe Rooftop Lounge',   'location' => 'Road 11, Dhaka'],
    ['city_id' => 214, 'category' => 'bar',    'title' => 'Sakura Restaurant & Bar','location' => 'Kazi Nazrul Islam Ave, Dhaka'],
    ['city_id' => 214, 'category' => 'coffee', 'title' => 'North End Coffee Roasters','location' => 'Dhaka'],
    ['city_id' => 214, 'category' => 'coffee', 'title' => 'Latitude 23',            'location' => 'Gulshan, Dhaka'],
    ['city_id' => 214, 'category' => 'coffee', 'title' => 'Arabika Coffee',         'location' => 'Gulshan-2, Dhaka'],

    // ── Damascus ────────────────────────────────────────────────────────────────
    ['city_id' => 238, 'category' => 'bar',    'title' => 'Copper Cocktail Bar',    'location' => 'Damascus'],
    ['city_id' => 238, 'category' => 'bar',    'title' => 'Abu George Bar',         'location' => 'Damascus'],
    ['city_id' => 238, 'category' => 'bar',    'title' => 'The Piano Bar',          'location' => 'Damascus'],
    ['city_id' => 238, 'category' => 'bar',    'title' => 'Barber Shop',            'location' => 'Old Damascus, Damascus'],
    ['city_id' => 238, 'category' => 'coffee', 'title' => 'Al-Nawfra',              'location' => 'Al-Qaymariyya, Damascus'],
    ['city_id' => 238, 'category' => 'coffee', 'title' => 'Blaque Boutique Cafe',   'location' => 'Abu Rummaneh, Damascus'],
    ['city_id' => 238, 'category' => 'coffee', 'title' => 'Pilots Café',            'location' => 'Abu Roumaneh, Damascus'],

    // ── Tehran (coffee only — no cocktail bars) ──────────────────────────────────
    ['city_id' => 225, 'category' => 'coffee', 'title' => 'Raees Coffee',           'location' => 'Fatemi Square, Tehran'],
    ['city_id' => 225, 'category' => 'coffee', 'title' => 'Cafe Tehroon',           'location' => 'Negarestan, Tehran'],
    ['city_id' => 225, 'category' => 'coffee', 'title' => 'Café Ansoo',             'location' => 'Tehran'],
    ['city_id' => 225, 'category' => 'coffee', 'title' => 'Godo Gole Yaas Café',    'location' => 'Enghelab St, Tehran'],

    // ── Mashhad (coffee only — no cocktail bars) ─────────────────────────────────
    ['city_id' => 226, 'category' => 'coffee', 'title' => 'Porsesh Book Cafe',      'location' => 'Zanbagh, Mashhad'],
    ['city_id' => 226, 'category' => 'coffee', 'title' => 'Cafe Parvaaz',           'location' => 'Yas, Mashhad'],
    ['city_id' => 226, 'category' => 'coffee', 'title' => 'Cafe View',              'location' => 'Mashhad'],
    ['city_id' => 226, 'category' => 'coffee', 'title' => 'Cafe 1860',              'location' => 'Mashhad'],

    // ── Kabul (coffee only — no cocktail bars) ───────────────────────────────────
    ['city_id' => 217, 'category' => 'coffee', 'title' => 'Cupcake Coffee Shop',    'location' => 'Kabul'],
    ['city_id' => 217, 'category' => 'coffee', 'title' => 'Slice',                  'location' => 'Shahr-e Naw, Kabul'],
    ['city_id' => 217, 'category' => 'coffee', 'title' => "Tim's Bakery",           'location' => 'Kabul'],

    // ── Lusaka ──────────────────────────────────────────────────────────────────
    ['city_id' => 255, 'category' => 'bar',    'title' => 'Casa Blanca',            'location' => 'Lusaka'],
    ['city_id' => 255, 'category' => 'bar',    'title' => 'Cloud 9 Bar',            'location' => 'Protea Marriott, Lusaka'],
    ['city_id' => 255, 'category' => 'bar',    'title' => 'Bodega',                 'location' => 'Lusaka'],
    ['city_id' => 255, 'category' => 'bar',    'title' => 'Champs VIP Lounge',      'location' => 'Lusaka'],
    ['city_id' => 255, 'category' => 'coffee', 'title' => 'Brew Me Coffee Shop',    'location' => 'Garden City, Lusaka'],
    ['city_id' => 255, 'category' => 'coffee', 'title' => 'Peaberry Coffee Roasters','location' => 'Lusaka'],
    ['city_id' => 255, 'category' => 'coffee', 'title' => 'The Zambean Coffee Co.', 'location' => 'Leopards Hill, Lusaka'],

    // ── Maputo ──────────────────────────────────────────────────────────────────
    ['city_id' => 256, 'category' => 'bar',    'title' => 'El Cubano',              'location' => 'Av. Maguiguana, Maputo'],
    ['city_id' => 256, 'category' => 'bar',    'title' => 'Vivo Lounge',            'location' => 'Radisson Blu, Maputo'],
    ['city_id' => 256, 'category' => 'bar',    'title' => 'Tree House',             'location' => 'Av. Francisco Magumbwe, Maputo'],
    ['city_id' => 256, 'category' => 'bar',    'title' => 'Chill Out Café & Bar',   'location' => 'Av. da Marginal, Maputo'],
    ['city_id' => 256, 'category' => 'coffee', 'title' => 'Taverna Doce',           'location' => 'Av. Mao Tse Tung, Maputo'],
    ['city_id' => 256, 'category' => 'coffee', 'title' => 'Craft Coffee Bar',       'location' => 'Maputo'],
    ['city_id' => 256, 'category' => 'coffee', 'title' => 'Botanica',               'location' => 'Maputo'],

    // ── Yaoundé ─────────────────────────────────────────────────────────────────
    ['city_id' => 265, 'category' => 'bar',    'title' => 'The Rooftop Yaoundé',    'location' => 'Nlongkak, Yaoundé'],
    ['city_id' => 265, 'category' => 'bar',    'title' => 'Black & White Sensation','location' => 'Bastos, Yaoundé'],
    ['city_id' => 265, 'category' => 'bar',    'title' => 'Panoramique Bar & Lounge','location' => 'Yaoundé'],
    ['city_id' => 265, 'category' => 'bar',    'title' => 'Monsieur Cocktail',      'location' => 'Yaoundé'],
    ['city_id' => 265, 'category' => 'coffee', 'title' => 'Terrific Coffee',        'location' => 'Bastos, Yaoundé'],
    ['city_id' => 265, 'category' => 'coffee', 'title' => 'Expresso House',         'location' => 'Carrefour Bastos, Yaoundé'],
    ['city_id' => 265, 'category' => 'coffee', 'title' => 'Nokadi',                 'location' => 'Quartier Manguissa, Yaoundé'],

    // ── Bamako ──────────────────────────────────────────────────────────────────
    ['city_id' => 267, 'category' => 'bar',    'title' => 'Appaloosa',              'location' => 'Quartier du Fleuve, Bamako'],
    ['city_id' => 267, 'category' => 'bar',    'title' => 'Bla Bla',                'location' => 'Hippodrome, Bamako'],
    ['city_id' => 267, 'category' => 'bar',    'title' => 'B Lounge',               'location' => 'Bamako'],
    ['city_id' => 267, 'category' => 'bar',    'title' => 'Escobar Lounge',         'location' => 'Bamako'],
    ['city_id' => 267, 'category' => 'coffee', 'title' => 'Comme Chez Soi',         'location' => 'Bamako'],
    ['city_id' => 267, 'category' => 'coffee', 'title' => 'Bissap Café',            'location' => 'Bamako'],

    // ── Ouagadougou ─────────────────────────────────────────────────────────────
    ['city_id' => 268, 'category' => 'bar',    'title' => 'Maradona Bar',           'location' => "Patte d'oie, Ouagadougou"],
    ['city_id' => 268, 'category' => 'bar',    'title' => 'La Vita Bar & Restaurant','location' => 'Ouaga 2000, Ouagadougou'],
    ['city_id' => 268, 'category' => 'bar',    'title' => 'De Niro Pub',            'location' => 'Ouagadougou'],
    ['city_id' => 268, 'category' => 'bar',    'title' => 'Sika Lounge',            'location' => 'Ouagadougou'],
    ['city_id' => 268, 'category' => 'coffee', 'title' => 'Koffi Gombo',            'location' => 'Zogona, Ouagadougou'],
    ['city_id' => 268, 'category' => 'coffee', 'title' => 'Café Onu',               'location' => 'Ouaga 2000, Ouagadougou'],

    // ── Brazzaville (bars only — no reliable specialty coffee found) ─────────────
    ['city_id' => 346, 'category' => 'bar',    'title' => 'Pichichi Lounge Bar',    'location' => 'Av. Nelson Mandela, Brazzaville'],
    ['city_id' => 346, 'category' => 'bar',    'title' => 'Le Faignond',            'location' => 'Brazzaville'],
    ['city_id' => 346, 'category' => 'bar',    'title' => 'Seven Bar',              'location' => 'Brazzaville'],
    ['city_id' => 346, 'category' => 'bar',    'title' => 'Le Christella',          'location' => 'Brazzaville'],

    // ── Asmara ──────────────────────────────────────────────────────────────────
    ['city_id' => 348, 'category' => 'bar',    'title' => 'Bar Zilli',              'location' => 'Sematat Ave, Asmara'],
    ['city_id' => 348, 'category' => 'bar',    'title' => 'Blue Nile Bar',          'location' => 'Sematat Ave, Asmara'],
    ['city_id' => 348, 'category' => 'bar',    'title' => 'Bar Lodi',               'location' => 'Asmara'],
    ['city_id' => 348, 'category' => 'coffee', 'title' => 'Bar Impero',             'location' => 'Harnet Ave, Asmara'],
    ['city_id' => 348, 'category' => 'coffee', 'title' => 'Cinema Roma Café',       'location' => 'Sematat Ave, Asmara'],

    // ── Lilongwe ────────────────────────────────────────────────────────────────
    ['city_id' => 350, 'category' => 'bar',    'title' => 'Pakwadi Sports Bar',     'location' => 'Lilongwe'],
    ['city_id' => 350, 'category' => 'bar',    'title' => 'Acres Bar & Grill',      'location' => 'Lilongwe'],
    ['city_id' => 350, 'category' => 'bar',    'title' => "Cousin Vinny's Bar",     'location' => 'Lilongwe'],
    ['city_id' => 350, 'category' => 'bar',    'title' => 'Hideout Bar and Grill',  'location' => 'Lilongwe'],
    ['city_id' => 350, 'category' => 'coffee', 'title' => 'Land & Lake Cafe',       'location' => 'Area 3, Lilongwe'],
    ['city_id' => 350, 'category' => 'coffee', 'title' => 'Ama Khofi',              'location' => 'City Centre, Lilongwe'],
    ['city_id' => 350, 'category' => 'coffee', 'title' => 'Warm Heart Cafe',        'location' => 'Area 10, Lilongwe'],

    // ── Medina (coffee only — no cocktail bars) ──────────────────────────────────
    ['city_id' => 338, 'category' => 'coffee', 'title' => 'Wacafe Specialty Coffee','location' => 'Al Aqool, Medina'],
    ['city_id' => 338, 'category' => 'coffee', 'title' => '44X Specialty Coffee',   'location' => 'Al Aridh, Medina'],
    ['city_id' => 338, 'category' => 'coffee', 'title' => 'Row Specialty Coffee',   'location' => 'Al Jamawat, Medina'],
    ['city_id' => 338, 'category' => 'coffee', 'title' => '8Oz Coffee',             'location' => 'Al Aridh, Medina'],

];
