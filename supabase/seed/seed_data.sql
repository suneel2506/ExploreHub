-- ============================================================================
-- Explore Hub — Seed Data
-- ============================================================================
-- Inserts 6 countries, 30 states, ~75 districts, and 500+ real places
-- with accurate coordinates and descriptions.
--
-- Uses a DO $$ block with typed variables so generated UUIDs chain
-- correctly through foreign-key references.
-- ============================================================================

DO $$
DECLARE
    -- ── Countries ──
    c_india   uuid;  c_japan  uuid;  c_norway uuid;
    c_italy   uuid;  c_france uuid;  c_usa    uuid;

    -- ── India states ──
    s_tamilnadu uuid;  s_kerala uuid;  s_rajasthan uuid;
    s_himachal  uuid;  s_goa    uuid;
    -- ── Japan states ──
    s_tokyo uuid;  s_kyoto uuid;  s_hokkaido uuid;
    s_okinawa uuid;  s_osaka uuid;
    -- ── Norway states ──
    s_vestland uuid;  s_nordland uuid;  s_troms uuid;
    s_rogaland uuid;  s_innlandet uuid;
    -- ── Italy states ──
    s_lazio uuid;  s_tuscany uuid;  s_lombardy uuid;
    s_sicily uuid;  s_veneto uuid;
    -- ── France states ──
    s_idf uuid;  s_paca uuid;  s_occitanie uuid;
    s_ara uuid;  s_brittany uuid;
    -- ── USA states ──
    s_california uuid;  s_newyork uuid;  s_colorado uuid;
    s_hawaii uuid;  s_arizona uuid;

    -- ── Districts (≈75) ──
    -- India - Tamil Nadu
    d_chennai uuid;  d_madurai uuid;  d_nilgiris uuid;
    -- India - Kerala
    d_ernakulam uuid;  d_idukki uuid;  d_alappuzha uuid;
    -- India - Rajasthan
    d_jaipur uuid;  d_jodhpur uuid;  d_udaipur uuid;
    -- India - Himachal Pradesh
    d_kullu uuid;  d_shimla uuid;  d_kangra uuid;
    -- India - Goa
    d_northgoa uuid;  d_southgoa uuid;

    -- Japan - Tokyo
    d_shibuya uuid;  d_taito uuid;  d_minato uuid;
    -- Japan - Kyoto
    d_kyoto_city uuid;  d_uji uuid;
    -- Japan - Hokkaido
    d_sapporo uuid;  d_furano uuid;  d_otaru uuid;
    -- Japan - Okinawa
    d_naha uuid;  d_kunigami uuid;
    -- Japan - Osaka
    d_osaka_city uuid;  d_sakai uuid;

    -- Norway - Vestland
    d_bergen uuid;  d_odda uuid;
    -- Norway - Nordland
    d_bodo uuid;  d_lofoten uuid;
    -- Norway - Troms
    d_tromso uuid;  d_senja uuid;
    -- Norway - Rogaland
    d_stavanger uuid;  d_ryfylke uuid;
    -- Norway - Innlandet
    d_lillehammer uuid;  d_lom uuid;

    -- Italy - Lazio
    d_rome uuid;  d_viterbo uuid;
    -- Italy - Tuscany
    d_florence uuid;  d_siena uuid;  d_pisa uuid;
    -- Italy - Lombardy
    d_milan uuid;  d_como uuid;
    -- Italy - Sicily
    d_palermo uuid;  d_catania uuid;  d_agrigento uuid;
    -- Italy - Veneto
    d_venice uuid;  d_verona uuid;

    -- France - Île-de-France
    d_paris uuid;  d_versailles uuid;
    -- France - PACA
    d_marseille uuid;  d_nice uuid;
    -- France - Occitanie
    d_toulouse uuid;  d_carcassonne uuid;
    -- France - ARA
    d_lyon uuid;  d_chamonix uuid;
    -- France - Brittany
    d_rennes uuid;  d_saintmalo uuid;

    -- USA - California
    d_la uuid;  d_sf uuid;  d_yosemite_area uuid;
    -- USA - New York
    d_nyc uuid;  d_adirondacks uuid;
    -- USA - Colorado
    d_denver uuid;  d_aspen uuid;
    -- USA - Hawaii
    d_honolulu uuid;  d_maui uuid;
    -- USA - Arizona
    d_coconino uuid;  d_pima uuid;

BEGIN

-- ============================================================================
-- COUNTRIES
-- ============================================================================
INSERT INTO public.countries (name, code, continent, latitude, longitude, flag_emoji)
VALUES
    ('India',         'IN', 'Asia',          20.5937,   78.9629,  '🇮🇳'),
    ('Japan',         'JP', 'Asia',          36.2048,  138.2529,  '🇯🇵'),
    ('Norway',        'NO', 'Europe',        60.4720,    8.4689,  '🇳🇴'),
    ('Italy',         'IT', 'Europe',        41.8719,   12.5674,  '🇮🇹'),
    ('France',        'FR', 'Europe',        46.6034,    1.8883,  '🇫🇷'),
    ('United States', 'US', 'North America', 37.0902, -95.7129,   '🇺🇸')
RETURNING id INTO c_india;  -- we need all six; get them individually below

-- Fetch the IDs back by code (reliable)
SELECT id INTO c_india  FROM public.countries WHERE code = 'IN';
SELECT id INTO c_japan  FROM public.countries WHERE code = 'JP';
SELECT id INTO c_norway FROM public.countries WHERE code = 'NO';
SELECT id INTO c_italy  FROM public.countries WHERE code = 'IT';
SELECT id INTO c_france FROM public.countries WHERE code = 'FR';
SELECT id INTO c_usa    FROM public.countries WHERE code = 'US';


-- ============================================================================
-- STATES  (30 total — 5 per country)
-- ============================================================================

-- ── India ──
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_india, 'Tamil Nadu',        'TN', 11.1271, 78.6569) RETURNING id INTO s_tamilnadu;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_india, 'Kerala',            'KL',  10.8505, 76.2711) RETURNING id INTO s_kerala;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_india, 'Rajasthan',         'RJ',  27.0238, 74.2179) RETURNING id INTO s_rajasthan;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_india, 'Himachal Pradesh',  'HP',  31.1048, 77.1734) RETURNING id INTO s_himachal;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_india, 'Goa',               'GA',  15.2993, 74.1240) RETURNING id INTO s_goa;

-- ── Japan ──
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_japan, 'Tokyo',     '13', 35.6762, 139.6503) RETURNING id INTO s_tokyo;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_japan, 'Kyoto',     '26', 35.0116, 135.7681) RETURNING id INTO s_kyoto;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_japan, 'Hokkaido',  '01', 43.0642, 141.3469) RETURNING id INTO s_hokkaido;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_japan, 'Okinawa',   '47', 26.3344, 127.8056) RETURNING id INTO s_okinawa;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_japan, 'Osaka',     '27', 34.6937, 135.5023) RETURNING id INTO s_osaka;

-- ── Norway ──
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_norway, 'Vestland',   '46', 60.5000,  6.0000) RETURNING id INTO s_vestland;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_norway, 'Nordland',   '18', 67.2800, 14.4000) RETURNING id INTO s_nordland;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_norway, 'Troms',      '54', 69.6500, 18.9560) RETURNING id INTO s_troms;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_norway, 'Rogaland',   '11', 59.1500,  6.0000) RETURNING id INTO s_rogaland;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_norway, 'Innlandet',  '34', 61.5000,  9.0000) RETURNING id INTO s_innlandet;

-- ── Italy ──
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_italy, 'Lazio',     'LAZ', 41.8919, 12.5113) RETURNING id INTO s_lazio;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_italy, 'Tuscany',   'TOS', 43.7711, 11.2486) RETURNING id INTO s_tuscany;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_italy, 'Lombardy',  'LOM', 45.4791,  9.8452) RETURNING id INTO s_lombardy;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_italy, 'Sicily',    'SIC', 37.5999, 14.0154) RETURNING id INTO s_sicily;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_italy, 'Veneto',    'VEN', 45.4415, 12.3326) RETURNING id INTO s_veneto;

-- ── France ──
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_france, 'Île-de-France',                     'IDF', 48.8499, 2.6370) RETURNING id INTO s_idf;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_france, 'Provence-Alpes-Côte d''Azur',       'PAC', 43.9352, 6.0679) RETURNING id INTO s_paca;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_france, 'Occitanie',                         'OCC', 43.8927, 3.2828) RETURNING id INTO s_occitanie;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_france, 'Auvergne-Rhône-Alpes',              'ARA', 45.4472, 4.3872) RETURNING id INTO s_ara;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_france, 'Brittany',                          'BRE', 48.2020, -2.9326) RETURNING id INTO s_brittany;

-- ── USA ──
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_usa, 'California', 'CA', 36.7783, -119.4179) RETURNING id INTO s_california;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_usa, 'New York',   'NY', 40.7128, -74.0060)  RETURNING id INTO s_newyork;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_usa, 'Colorado',   'CO', 39.5501, -105.7821) RETURNING id INTO s_colorado;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_usa, 'Hawaii',     'HI', 19.8968, -155.5828) RETURNING id INTO s_hawaii;
INSERT INTO public.states (country_id, name, code, latitude, longitude) VALUES
    (c_usa, 'Arizona',    'AZ', 34.0489, -111.0937) RETURNING id INTO s_arizona;


-- ============================================================================
-- DISTRICTS  (~75 total)
-- ============================================================================

-- ── India — Tamil Nadu ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tamilnadu, 'Chennai',   13.0827,  80.2707) RETURNING id INTO d_chennai;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tamilnadu, 'Madurai',    9.9252,  78.1198) RETURNING id INTO d_madurai;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tamilnadu, 'Nilgiris',  11.4916,  76.7337) RETURNING id INTO d_nilgiris;

-- ── India — Kerala ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_kerala, 'Ernakulam',  9.9816, 76.2999) RETURNING id INTO d_ernakulam;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_kerala, 'Idukki',     9.9189, 76.9291) RETURNING id INTO d_idukki;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_kerala, 'Alappuzha', 9.4981, 76.3388) RETURNING id INTO d_alappuzha;

-- ── India — Rajasthan ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_rajasthan, 'Jaipur',   26.9124, 75.7873) RETURNING id INTO d_jaipur;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_rajasthan, 'Jodhpur',  26.2389, 73.0243) RETURNING id INTO d_jodhpur;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_rajasthan, 'Udaipur',  24.5854, 73.7125) RETURNING id INTO d_udaipur;

-- ── India — Himachal Pradesh ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_himachal, 'Kullu',   31.9576, 77.1095) RETURNING id INTO d_kullu;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_himachal, 'Shimla',  31.1048, 77.1734) RETURNING id INTO d_shimla;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_himachal, 'Kangra',  32.0998, 76.2691) RETURNING id INTO d_kangra;

-- ── India — Goa ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_goa, 'North Goa', 15.5348, 73.9629) RETURNING id INTO d_northgoa;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_goa, 'South Goa', 15.1200, 74.0855) RETURNING id INTO d_southgoa;

-- ── Japan — Tokyo ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tokyo, 'Shibuya',  35.6619, 139.7041) RETURNING id INTO d_shibuya;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tokyo, 'Taito',    35.7126, 139.7800) RETURNING id INTO d_taito;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tokyo, 'Minato',   35.6581, 139.7514) RETURNING id INTO d_minato;

-- ── Japan — Kyoto ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_kyoto, 'Kyoto City',  35.0116, 135.7681) RETURNING id INTO d_kyoto_city;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_kyoto, 'Uji',         34.8841, 135.8008) RETURNING id INTO d_uji;

-- ── Japan — Hokkaido ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_hokkaido, 'Sapporo',  43.0618, 141.3545) RETURNING id INTO d_sapporo;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_hokkaido, 'Furano',   43.3421, 142.3833) RETURNING id INTO d_furano;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_hokkaido, 'Otaru',    43.1907, 140.9944) RETURNING id INTO d_otaru;

-- ── Japan — Okinawa ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_okinawa, 'Naha',      26.2124, 127.6792) RETURNING id INTO d_naha;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_okinawa, 'Kunigami',  26.7574, 128.1797) RETURNING id INTO d_kunigami;

-- ── Japan — Osaka ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_osaka, 'Osaka City',  34.6937, 135.5023) RETURNING id INTO d_osaka_city;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_osaka, 'Sakai',       34.5732, 135.4831) RETURNING id INTO d_sakai;

-- ── Norway — Vestland ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_vestland, 'Bergen',   60.3913, 5.3221) RETURNING id INTO d_bergen;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_vestland, 'Odda',     60.0693, 6.5450) RETURNING id INTO d_odda;

-- ── Norway — Nordland ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_nordland, 'Bodø',     67.2804, 14.4049) RETURNING id INTO d_bodo;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_nordland, 'Lofoten',  68.2350, 14.5633) RETURNING id INTO d_lofoten;

-- ── Norway — Troms ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_troms, 'Tromsø',  69.6496, 18.9560) RETURNING id INTO d_tromso;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_troms, 'Senja',   69.2954, 17.0561) RETURNING id INTO d_senja;

-- ── Norway — Rogaland ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_rogaland, 'Stavanger', 58.9700, 5.7331) RETURNING id INTO d_stavanger;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_rogaland, 'Ryfylke',   59.2800, 6.2100) RETURNING id INTO d_ryfylke;

-- ── Norway — Innlandet ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_innlandet, 'Lillehammer', 61.1153, 10.4662) RETURNING id INTO d_lillehammer;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_innlandet, 'Lom',         61.8381, 8.5679) RETURNING id INTO d_lom;

-- ── Italy — Lazio ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_lazio, 'Rome',    41.9028, 12.4964) RETURNING id INTO d_rome;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_lazio, 'Viterbo', 42.4171, 11.8626) RETURNING id INTO d_viterbo;

-- ── Italy — Tuscany ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tuscany, 'Florence', 43.7696, 11.2558) RETURNING id INTO d_florence;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tuscany, 'Siena',    43.3188, 11.3308) RETURNING id INTO d_siena;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_tuscany, 'Pisa',     43.7228, 10.4017) RETURNING id INTO d_pisa;

-- ── Italy — Lombardy ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_lombardy, 'Milan',  45.4642, 9.1900) RETURNING id INTO d_milan;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_lombardy, 'Como',   45.8100, 9.0852) RETURNING id INTO d_como;

-- ── Italy — Sicily ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_sicily, 'Palermo',   38.1157, 13.3615) RETURNING id INTO d_palermo;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_sicily, 'Catania',   37.5079, 15.0830) RETURNING id INTO d_catania;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_sicily, 'Agrigento', 37.3109, 13.5765) RETURNING id INTO d_agrigento;

-- ── Italy — Veneto ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_veneto, 'Venice', 45.4408, 12.3155) RETURNING id INTO d_venice;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_veneto, 'Verona', 45.4384, 10.9916) RETURNING id INTO d_verona;

-- ── France — Île-de-France ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_idf, 'Paris',      48.8566, 2.3522)  RETURNING id INTO d_paris;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_idf, 'Versailles', 48.8014, 2.1301)  RETURNING id INTO d_versailles;

-- ── France — PACA ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_paca, 'Marseille', 43.2965, 5.3698) RETURNING id INTO d_marseille;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_paca, 'Nice',      43.7102, 7.2620) RETURNING id INTO d_nice;

-- ── France — Occitanie ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_occitanie, 'Toulouse',     43.6047, 1.4442) RETURNING id INTO d_toulouse;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_occitanie, 'Carcassonne',  43.2130, 2.3491) RETURNING id INTO d_carcassonne;

-- ── France — ARA ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_ara, 'Lyon',      45.7640, 4.8357) RETURNING id INTO d_lyon;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_ara, 'Chamonix',  45.9237, 6.8694) RETURNING id INTO d_chamonix;

-- ── France — Brittany ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_brittany, 'Rennes',     48.1173, -1.6778) RETURNING id INTO d_rennes;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_brittany, 'Saint-Malo', 48.6493, -2.0076) RETURNING id INTO d_saintmalo;

-- ── USA — California ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_california, 'Los Angeles County', 34.0522, -118.2437) RETURNING id INTO d_la;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_california, 'San Francisco County', 37.7749, -122.4194) RETURNING id INTO d_sf;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_california, 'Mariposa County', 37.5805, -119.9663) RETURNING id INTO d_yosemite_area;

-- ── USA — New York ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_newyork, 'New York City', 40.7128, -74.0060) RETURNING id INTO d_nyc;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_newyork, 'Essex County', 44.1167, -73.9236) RETURNING id INTO d_adirondacks;

-- ── USA — Colorado ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_colorado, 'Denver County', 39.7392, -104.9903) RETURNING id INTO d_denver;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_colorado, 'Pitkin County', 39.1911, -106.8175) RETURNING id INTO d_aspen;

-- ── USA — Hawaii ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_hawaii, 'Honolulu County', 21.3069, -157.8583) RETURNING id INTO d_honolulu;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_hawaii, 'Maui County', 20.7984, -156.3319) RETURNING id INTO d_maui;

-- ── USA — Arizona ──
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_arizona, 'Coconino County', 35.1983, -111.6513) RETURNING id INTO d_coconino;
INSERT INTO public.districts (state_id, name, latitude, longitude) VALUES
    (s_arizona, 'Pima County', 32.2226, -110.9747) RETURNING id INTO d_pima;


-- ============================================================================
-- PLACES  (500+ total, ~8-12 per state distributed across districts)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- INDIA
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tamil Nadu ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_chennai, 'Marina Beach', 'One of the longest urban beaches in the world, stretching over 13 km along the Bay of Bengal.', 13.0500, 80.2824, 'Beaches', 'Beach'),
    (d_chennai, 'Kapaleeshwarar Temple', 'A stunning 7th-century Dravidian-style Shiva temple in the heart of Mylapore with a towering gopuram.', 13.0337, 80.2694, 'Temples', 'Hindu Temple'),
    (d_chennai, 'Fort St. George', 'The first English fortress in India, built in 1644, now housing the Tamil Nadu legislative assembly and a museum.', 13.0800, 80.2878, 'Historical Sites', 'Fort'),
    (d_chennai, 'San Thome Basilica', 'A neo-Gothic basilica built over the tomb of St. Thomas the Apostle, one of only three churches in the world built over an apostle''s tomb.', 13.0334, 80.2780, 'Historical Sites', 'Church'),
    (d_madurai, 'Meenakshi Amman Temple', 'An awe-inspiring temple complex with 14 colorful gopurams, dedicated to Goddess Meenakshi and Lord Sundareshwar.', 9.9195, 78.1193, 'Temples', 'Hindu Temple'),
    (d_madurai, 'Thirumalai Nayakkar Palace', 'A 17th-century Indo-Saracenic palace with towering pillars and an impressive throne hall.', 9.9172, 78.1226, 'Historical Sites', 'Palace'),
    (d_madurai, 'Vaigai Dam', 'A scenic dam on the Vaigai River surrounded by lush hills, offering boating and pleasant picnic spots.', 10.0569, 77.5907, 'Lakes', 'Dam'),
    (d_nilgiris, 'Ooty Botanical Gardens', 'Established in 1848, these sprawling gardens house exotic plants, a fossilized tree trunk, and stunning terraced flower beds.', 11.4143, 76.6950, 'Tourist Attractions', 'Garden'),
    (d_nilgiris, 'Doddabetta Peak', 'The highest peak in the Nilgiri Mountains at 2,637 m, offering panoramic views of the surrounding valleys.', 11.4017, 76.7358, 'Mountains', 'Mountain Peak'),
    (d_nilgiris, 'Pykara Waterfalls', 'A stunning cascade of waterfalls surrounded by dense shola forests in the Nilgiri biosphere reserve.', 11.4699, 76.5938, 'Waterfalls', 'Waterfall'),
    (d_nilgiris, 'Hidden Valley of Nilgiris', 'A secluded valley between Coonoor and Kotagiri, known for its tea plantations and misty mornings.', 11.3530, 76.8600, 'Hidden Gems', 'Valley');

-- ── Kerala ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_ernakulam, 'Fort Kochi Beach', 'A charming shoreline known for Chinese fishing nets, colonial architecture, and spectacular sunsets over the Arabian Sea.', 9.9658, 76.2421, 'Beaches', 'Beach'),
    (d_ernakulam, 'Mattancherry Palace', 'A Portuguese-built palace gifted to the Raja of Kochi, famous for its stunning Kerala murals depicting Hindu mythology.', 9.9581, 76.2596, 'Historical Sites', 'Palace'),
    (d_ernakulam, 'Jewish Synagogue Kochi', 'The oldest active synagogue in the Commonwealth, built in 1568, with hand-painted Chinese floor tiles.', 9.9576, 76.2599, 'Historical Sites', 'Synagogue'),
    (d_idukki, 'Munnar Tea Gardens', 'Endless rolling carpets of emerald-green tea plantations set against misty mountains at 1,600 m elevation.', 10.0889, 77.0595, 'Hidden Gems', 'Tea Plantation'),
    (d_idukki, 'Eravikulam National Park', 'A UNESCO World Heritage buffer zone and home to the endangered Nilgiri tahr, with stunning montane grasslands.', 10.1860, 77.0620, 'Forests', 'National Park'),
    (d_idukki, 'Mattupetty Dam', 'A scenic concrete gravity dam surrounded by lush hills and tea gardens, popular for boating and nature walks.', 10.1125, 77.1311, 'Lakes', 'Dam'),
    (d_idukki, 'Attukal Waterfalls', 'A picturesque waterfall cascading through dense tropical forest between Munnar and Bodhimettu.', 10.0340, 77.1130, 'Waterfalls', 'Waterfall'),
    (d_alappuzha, 'Alleppey Backwaters', 'A labyrinth of palm-fringed canals, lagoons, and lakes best experienced aboard a traditional kettuvallam houseboat.', 9.4981, 76.3388, 'Tourist Attractions', 'Backwaters'),
    (d_alappuzha, 'Marari Beach', 'A pristine, secluded beach with golden sand, swaying palms, and a traditional fishing village ambiance.', 9.5970, 76.2880, 'Beaches', 'Beach'),
    (d_alappuzha, 'Kumarakom Bird Sanctuary', 'A lush mangrove wetland on the banks of Vembanad Lake, home to migratory birds and egrets.', 9.5920, 76.4340, 'Forests', 'Bird Sanctuary');

-- ── Rajasthan ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_jaipur, 'Amber Fort', 'A majestic hilltop fort built from red sandstone and marble, featuring the stunning Sheesh Mahal mirror hall.', 26.9855, 75.8513, 'Historical Sites', 'Fort'),
    (d_jaipur, 'Hawa Mahal', 'The iconic Palace of Winds with 953 honeycomb windows, designed to allow royal women to observe street life unseen.', 26.9239, 75.8267, 'Historical Sites', 'Palace'),
    (d_jaipur, 'Nahargarh Fort', 'A hilltop fort overlooking Jaipur that offers breathtaking panoramic sunset views over the Pink City.', 26.9372, 75.8150, 'Historical Sites', 'Fort'),
    (d_jaipur, 'Jal Mahal', 'A romantic palace seemingly floating in the middle of Man Sagar Lake, beautifully illuminated at night.', 26.9530, 75.8460, 'Tourist Attractions', 'Palace'),
    (d_jodhpur, 'Mehrangarh Fort', 'One of India''s largest forts, perched 125 m above Jodhpur with intricate carvings and an excellent museum.', 26.2984, 73.0183, 'Historical Sites', 'Fort'),
    (d_jodhpur, 'Umaid Bhawan Palace', 'An Art Deco marvel and one of the world''s largest private residences, now partly a luxury hotel and museum.', 26.2752, 73.0484, 'Tourist Attractions', 'Palace'),
    (d_jodhpur, 'Toorji Ka Jhalra', 'A beautifully restored 18th-century stepwell in the heart of the Blue City, a hidden architectural gem.', 26.2943, 73.0249, 'Hidden Gems', 'Stepwell'),
    (d_udaipur, 'City Palace Udaipur', 'A grand palace complex on the banks of Lake Pichola, blending Rajasthani and Mughal architecture.', 24.5764, 73.6835, 'Historical Sites', 'Palace'),
    (d_udaipur, 'Lake Pichola', 'A serene artificial lake created in 1362, surrounded by palaces, temples, and the Aravalli Hills.', 24.5700, 73.6800, 'Lakes', 'Lake'),
    (d_udaipur, 'Saheliyon Ki Bari', 'The Garden of the Maidens, an ornamental garden with fountains, kiosks, marble elephants, and lotus pools.', 24.5932, 73.6897, 'Hidden Gems', 'Garden');

-- ── Himachal Pradesh ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_kullu, 'Manali Old Town', 'A charming Himalayan town with ancient temples, hippie cafés, and the rushing Beas River, gateway to Rohtang Pass.', 32.2432, 77.1892, 'Tourist Attractions', 'Town'),
    (d_kullu, 'Solang Valley', 'A popular adventure valley offering skiing, paragliding, and zorbing with panoramic views of snow-capped peaks.', 32.3152, 77.1575, 'Mountains', 'Valley'),
    (d_kullu, 'Jogini Waterfall', 'A hidden waterfall reached by a serene trek through deodar forests above the village of Vashisht.', 32.2621, 77.1834, 'Waterfalls', 'Waterfall'),
    (d_kullu, 'Great Himalayan National Park', 'A UNESCO World Heritage Site protecting pristine Himalayan biodiversity with ancient forests and alpine meadows.', 31.7600, 77.4500, 'Forests', 'National Park'),
    (d_shimla, 'The Ridge', 'A large open space in the heart of Shimla offering stunning views of surrounding mountains and colonial architecture.', 31.1048, 77.1734, 'Urban Attractions', 'Promenade'),
    (d_shimla, 'Jakhoo Temple', 'A hilltop temple dedicated to Lord Hanuman with a 108-foot statue and panoramic views of the Shimla skyline.', 31.1112, 77.1781, 'Temples', 'Hindu Temple'),
    (d_shimla, 'Kufri', 'A small hill station near Shimla known for skiing in winter and nature walks through dense pine forests.', 31.0987, 77.2670, 'Mountains', 'Hill Station'),
    (d_kangra, 'Dharamshala Cricket Stadium', 'One of the world''s most picturesque cricket stadiums, set against the backdrop of the Dhauladhar mountain range.', 32.2270, 76.3234, 'Tourist Attractions', 'Stadium'),
    (d_kangra, 'McLeod Ganj', 'The home of the Dalai Lama and a vibrant hub of Tibetan culture, monasteries, and cafés in the Himalayan foothills.', 32.2426, 76.3213, 'Villages', 'Town'),
    (d_kangra, 'Triund Trek', 'A moderately challenging trek offering sweeping views of the Dhauladhar range and the Kangra Valley below.', 32.2537, 76.3416, 'Mountains', 'Trek');

-- ── Goa ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_northgoa, 'Baga Beach', 'A lively beach famous for water sports, shacks, and vibrant nightlife stretching along the Arabian Sea.', 15.5550, 73.7514, 'Beaches', 'Beach'),
    (d_northgoa, 'Aguada Fort', 'A well-preserved 17th-century Portuguese fort and lighthouse overlooking the confluence of the Mandovi River and the Arabian Sea.', 15.4927, 73.7737, 'Historical Sites', 'Fort'),
    (d_northgoa, 'Basilica of Bom Jesus', 'A UNESCO World Heritage Site housing the mortal remains of St. Francis Xavier, a masterpiece of Baroque architecture.', 15.5009, 73.9116, 'Historical Sites', 'Church'),
    (d_northgoa, 'Anjuna Flea Market', 'A colorful weekly flea market on the beach selling everything from handicrafts to vintage clothing.', 15.5736, 73.7410, 'Tourist Attractions', 'Market'),
    (d_northgoa, 'Chapora Fort', 'Ruins of a fort made famous by the Bollywood film Dil Chahta Hai, offering stunning sunset views over Vagator Beach.', 15.6072, 73.7376, 'Historical Sites', 'Fort'),
    (d_southgoa, 'Dudhsagar Falls', 'India''s tallest tiered waterfall at 310 m, cascading through dense forest on the Karnataka-Goa border.', 15.3144, 74.3143, 'Waterfalls', 'Waterfall'),
    (d_southgoa, 'Palolem Beach', 'A crescent-shaped beach with calm waters, colorful beach huts, and stunning views of a tiny island offshore.', 15.0100, 74.0230, 'Beaches', 'Beach'),
    (d_southgoa, 'Cabo de Rama Fort', 'A remote fort perched on a cliff with panoramic ocean views, one of Goa''s least visited and most atmospheric ruins.', 15.0887, 73.9272, 'Hidden Gems', 'Fort'),
    (d_southgoa, 'Butterfly Beach', 'A secluded cove accessible only by boat or a jungle trek, known for its pristine sands and butterfly sightings.', 15.0026, 73.9540, 'Hidden Gems', 'Beach');

-- ════════════════════════════════════════════════════════════════════════════
-- JAPAN
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tokyo ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_shibuya, 'Shibuya Crossing', 'The world''s busiest pedestrian intersection, an iconic symbol of Tokyo''s energy and neon-lit urban chaos.', 35.6595, 139.7004, 'Urban Attractions', 'Crossing'),
    (d_shibuya, 'Meiji Shrine', 'A tranquil Shinto shrine set in a lush forest of 120,000 trees, dedicated to Emperor Meiji and Empress Shoken.', 35.6764, 139.6993, 'Temples', 'Shinto Shrine'),
    (d_shibuya, 'Yoyogi Park', 'A vast urban park popular for cherry blossom viewing, weekend musicians, and cosplay gatherings.', 35.6715, 139.6949, 'Forests', 'Park'),
    (d_taito, 'Senso-ji Temple', 'Tokyo''s oldest temple, dating to 645 AD, with the iconic Kaminarimon Thunder Gate and Nakamise shopping street.', 35.7148, 139.7967, 'Temples', 'Buddhist Temple'),
    (d_taito, 'Ueno Park', 'A sprawling cultural hub with museums, a zoo, and spectacular cherry blossoms surrounding Shinobazu Pond.', 35.7146, 139.7732, 'Tourist Attractions', 'Park'),
    (d_taito, 'Tokyo National Museum', 'Japan''s oldest and largest museum, housing over 110,000 objects spanning Japanese and Asian art history.', 35.7189, 139.7766, 'Tourist Attractions', 'Museum'),
    (d_minato, 'Tokyo Tower', 'An iconic 333 m communications tower inspired by the Eiffel Tower, offering panoramic city views.', 35.6586, 139.7454, 'Urban Attractions', 'Tower'),
    (d_minato, 'teamLab Borderless', 'An immersive digital art museum where rooms of light, color, and movement respond to visitor interactions.', 35.6262, 139.7840, 'Tourist Attractions', 'Museum'),
    (d_minato, 'Zojo-ji Temple', 'A grand Buddhist temple with the Tokyo Tower rising behind it, featuring stunning Tokugawa-era tombs.', 35.6575, 139.7483, 'Temples', 'Buddhist Temple');

-- ── Kyoto ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_kyoto_city, 'Fushimi Inari Shrine', 'A mesmerizing tunnel of 10,000 vermillion torii gates winding up Mount Inari, Kyoto''s most iconic shrine.', 34.9671, 135.7727, 'Temples', 'Shinto Shrine'),
    (d_kyoto_city, 'Kinkaku-ji (Golden Pavilion)', 'A Zen Buddhist temple whose top two stories are completely covered in gold leaf, reflected perfectly in the surrounding mirror pond.', 35.0394, 135.7292, 'Temples', 'Buddhist Temple'),
    (d_kyoto_city, 'Arashiyama Bamboo Grove', 'A surreal path through towering bamboo stalks that sway and creak in the wind, creating an otherworldly atmosphere.', 35.0173, 135.6715, 'Forests', 'Bamboo Forest'),
    (d_kyoto_city, 'Kiyomizu-dera', 'A UNESCO World Heritage temple perched on a hillside with a wooden stage offering panoramic views of Kyoto.', 34.9949, 135.7850, 'Temples', 'Buddhist Temple'),
    (d_kyoto_city, 'Nijo Castle', 'A 17th-century flatland castle with famous "nightingale floors" that chirp when walked upon, a UNESCO World Heritage Site.', 35.0142, 135.7480, 'Historical Sites', 'Castle'),
    (d_kyoto_city, 'Philosopher''s Path', 'A peaceful stone path along a cherry-tree-lined canal connecting Ginkaku-ji to Nanzen-ji temples.', 35.0272, 135.7942, 'Hidden Gems', 'Walking Path'),
    (d_kyoto_city, 'Gion District', 'Kyoto''s most famous geisha district, with preserved wooden machiya townhouses, tea houses, and traditional restaurants.', 35.0037, 135.7756, 'Villages', 'Historic District'),
    (d_uji, 'Byodo-in Temple', 'A UNESCO World Heritage Buddhist temple whose Phoenix Hall graces the 10-yen coin, set beside the Uji River.', 34.8893, 135.8077, 'Temples', 'Buddhist Temple'),
    (d_uji, 'Uji River', 'A scenic river famous for its tea plantations, cormorant fishing, and the literary setting of the Tale of Genji.', 34.8899, 135.8040, 'Hidden Gems', 'River');

-- ── Hokkaido ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_sapporo, 'Odori Park', 'A long ribbon of green in central Sapporo, venue for the Snow Festival and surrounded by TV Tower views.', 43.0600, 141.3566, 'Urban Attractions', 'Park'),
    (d_sapporo, 'Sapporo Beer Museum', 'Japan''s only beer museum, housed in a beautiful red-brick Meiji-era building with tastings and garden.', 43.0706, 141.3581, 'Tourist Attractions', 'Museum'),
    (d_sapporo, 'Mount Moiwa', 'A mountain offering one of Japan''s top three night views, with a ropeway to the illuminated summit observatory.', 43.0280, 141.3208, 'Mountains', 'Mountain Peak'),
    (d_furano, 'Farm Tomita', 'Iconic lavender fields that bloom in vivid purple from late June through August, with panoramic mountain backdrops.', 43.3530, 142.3854, 'Hidden Gems', 'Lavender Farm'),
    (d_furano, 'Blue Pond Biei', 'A surreal cobalt-blue pond created by volcanic minerals, surrounded by silver birch trees and an ethereal atmosphere.', 43.4555, 142.6029, 'Lakes', 'Pond'),
    (d_furano, 'Shikisai-no-Oka', 'A panoramic flower garden with rolling hills of multicolored blooms and views of the Tokachi mountain range.', 43.3621, 142.4257, 'Tourist Attractions', 'Flower Garden'),
    (d_otaru, 'Otaru Canal', 'A romantic canal lined with restored stone warehouses now housing cafés, galleries, and glass workshops.', 43.1967, 140.9994, 'Urban Attractions', 'Canal'),
    (d_otaru, 'Otaru Music Box Museum', 'A magical museum in a steam-clock-adorned heritage building with thousands of antique and modern music boxes.', 43.1932, 140.9931, 'Tourist Attractions', 'Museum'),
    (d_otaru, 'Asari Onsen', 'A quiet hot spring resort town along the coast, offering oceanfront bathing and fresh seafood.', 43.1600, 140.9300, 'Hidden Gems', 'Hot Spring');

-- ── Okinawa ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_naha, 'Shuri Castle', 'A restored Ryukyu Kingdom castle and UNESCO World Heritage Site perched on a hilltop overlooking Naha.', 26.2170, 127.7197, 'Historical Sites', 'Castle'),
    (d_naha, 'Kokusai Street', 'Naha''s vibrant main street packed with souvenir shops, local restaurants, and Okinawan music venues.', 26.2155, 127.6851, 'Urban Attractions', 'Shopping Street'),
    (d_naha, 'Naminoue Shrine', 'A clifftop Shinto shrine overlooking Naminoue Beach, the only urban beach in Naha.', 26.2254, 127.6702, 'Temples', 'Shinto Shrine'),
    (d_naha, 'Tsuboya Pottery Street', 'A historic lane of pottery workshops producing traditional Okinawan ceramics since the 17th century.', 26.2131, 127.6887, 'Hidden Gems', 'Pottery District'),
    (d_kunigami, 'Churaumi Aquarium', 'One of the world''s largest aquariums featuring whale sharks, manta rays, and a massive Kuroshio Sea tank.', 26.6936, 127.8779, 'Tourist Attractions', 'Aquarium'),
    (d_kunigami, 'Cape Hedo', 'The northernmost point of Okinawa Island with dramatic cliff formations and crashing turquoise waves.', 26.8724, 128.2513, 'Hidden Gems', 'Cape'),
    (d_kunigami, 'Yanbaru National Park', 'A subtropical forest reserve home to the endangered Okinawa rail, woodpecker, and ancient fern groves.', 26.7540, 128.2100, 'Forests', 'National Park'),
    (d_kunigami, 'Emerald Beach', 'A pristine coral-sand beach within Ocean Expo Park, with crystal-clear waters and gentle waves.', 26.6970, 127.8760, 'Beaches', 'Beach');

-- ── Osaka ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_osaka_city, 'Osaka Castle', 'A magnificent 16th-century castle surrounded by moats and parkland, a symbol of Japan''s unification era.', 34.6873, 135.5262, 'Historical Sites', 'Castle'),
    (d_osaka_city, 'Dotonbori', 'Osaka''s neon-lit canal district famous for its giant mechanical crab signs, street food, and lively atmosphere.', 34.6686, 135.5013, 'Urban Attractions', 'Entertainment District'),
    (d_osaka_city, 'Sumiyoshi Taisha', 'One of Japan''s oldest shrines, founded in the 3rd century, with distinctive straight-lined architecture predating Chinese influence.', 34.6128, 135.4929, 'Temples', 'Shinto Shrine'),
    (d_osaka_city, 'Shinsekai District', 'A retro neighborhood with a 1950s atmosphere, famous for kushikatsu deep-fried skewers and the Tsutenkaku Tower.', 34.6523, 135.5063, 'Urban Attractions', 'Historic District'),
    (d_osaka_city, 'Umeda Sky Building', 'A futuristic skyscraper with a floating garden observatory connecting twin towers 173 m above ground.', 34.7054, 135.4900, 'Urban Attractions', 'Skyscraper'),
    (d_sakai, 'Daisen Kofun', 'The largest burial mound in the world by area, shaped like a keyhole, the tomb of Emperor Nintoku.', 34.5636, 135.4875, 'Historical Sites', 'Ancient Tomb'),
    (d_sakai, 'Sakai Knife Museum', 'A museum dedicated to Sakai''s 600-year-old knife-making tradition, with live demonstrations of master craftsmen.', 34.5732, 135.4640, 'Tourist Attractions', 'Museum'),
    (d_sakai, 'Hamadera Park', 'A sprawling coastal park with pine forests, rose gardens, and one of the oldest public pools in Japan.', 34.5450, 135.4530, 'Tourist Attractions', 'Park');

-- ════════════════════════════════════════════════════════════════════════════
-- NORWAY
-- ════════════════════════════════════════════════════════════════════════════

-- ── Vestland ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_bergen, 'Bryggen Wharf', 'A UNESCO World Heritage Site of colorful Hanseatic wooden buildings along Bergen''s historic waterfront.', 60.3974, 5.3235, 'Historical Sites', 'Wharf'),
    (d_bergen, 'Mount Fløyen', 'A panoramic viewpoint accessible by the Fløibanen funicular, offering sweeping views of Bergen and the fjords.', 60.3958, 5.3434, 'Mountains', 'Mountain Peak'),
    (d_bergen, 'Bergen Fish Market', 'An open-air market at the harbor selling fresh seafood, king crab, and local delicacies since 1276.', 60.3946, 5.3262, 'Tourist Attractions', 'Market'),
    (d_bergen, 'Fantoft Stave Church', 'A reconstructed medieval stave church originally built around 1150, surrounded by a serene birch forest.', 60.3444, 5.3486, 'Historical Sites', 'Stave Church'),
    (d_odda, 'Trolltunga', 'A dramatic cliff ledge jutting horizontally 700 m above Lake Ringedalsvatnet, one of Norway''s most iconic landmarks.', 60.1241, 6.7400, 'Hidden Gems', 'Rock Formation'),
    (d_odda, 'Buarbreen Glacier', 'An accessible glacier arm extending from the Folgefonna ice cap, reachable by a scenic valley hike.', 60.0590, 6.3710, 'Mountains', 'Glacier'),
    (d_odda, 'Låtefossen Waterfall', 'A stunning twin waterfall where two streams cascade together under a stone arch bridge on Route 13.', 59.9500, 6.5977, 'Waterfalls', 'Waterfall'),
    (d_odda, 'Hardangerfjord', 'Norway''s second-longest fjord, famous for apple orchards, dramatic cliffs, and glacier-fed waterfalls.', 60.2300, 6.2300, 'Tourist Attractions', 'Fjord');

-- ── Nordland ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_bodo, 'Saltstraumen Maelstrom', 'The world''s strongest tidal current, creating massive whirlpools four times daily in a narrow strait.', 67.2300, 14.6230, 'Hidden Gems', 'Tidal Current'),
    (d_bodo, 'Kjerringøy Trading Post', 'A preserved 19th-century trading village on a fjord, with historic warehouses and mountain backdrops.', 67.3161, 15.1073, 'Historical Sites', 'Trading Post'),
    (d_bodo, 'Norwegian Aviation Museum', 'An aircraft-shaped building housing vintage planes, Cold War spy jets, and flight simulators.', 67.2696, 14.3639, 'Tourist Attractions', 'Museum'),
    (d_lofoten, 'Reine', 'A postcard-perfect fishing village nestled between dramatic peaks and fjords, often called Norway''s most beautiful village.', 67.9330, 13.0890, 'Villages', 'Fishing Village'),
    (d_lofoten, 'Kvalvika Beach', 'A secluded beach accessible only by hiking over a mountain pass, with turquoise Arctic waters and golden sand.', 68.0760, 13.1590, 'Beaches', 'Beach'),
    (d_lofoten, 'Svolvær Goat', 'A twin-peaked mountain pillar that adventurous climbers leap between, an iconic Lofoten challenge.', 68.2340, 14.5690, 'Mountains', 'Mountain Peak'),
    (d_lofoten, 'Henningsvær', 'A picturesque fishing village built on tiny islands, known as the Venice of Lofoten, with art galleries and a football pitch on the rocks.', 68.1490, 14.2020, 'Villages', 'Fishing Village'),
    (d_lofoten, 'Viking Museum Borg', 'A reconstructed Viking chieftain''s longhouse, the largest ever found, with living history exhibits.', 68.2478, 13.9006, 'Historical Sites', 'Museum');

-- ── Troms ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_tromso, 'Arctic Cathedral', 'An iconic triangular church with a massive stained-glass window, symbolizing northern lights and Arctic ice.', 69.6492, 18.9891, 'Urban Attractions', 'Cathedral'),
    (d_tromso, 'Polaria Aquarium', 'An Arctic aquarium and experience center with bearded seals, panoramic films, and exhibits on polar research.', 69.6489, 18.9443, 'Tourist Attractions', 'Aquarium'),
    (d_tromso, 'Fjellheisen Cable Car', 'A cable car ascending 421 m to Storsteinen viewpoint, offering midnight sun views in summer and aurora watching in winter.', 69.6434, 19.0091, 'Tourist Attractions', 'Cable Car'),
    (d_tromso, 'Tromsø Northern Lights Observatory', 'A prime location above the Arctic Circle for viewing the Aurora Borealis from September through March.', 69.6620, 18.9400, 'Hidden Gems', 'Observatory'),
    (d_senja, 'Segla Peak', 'A dramatic mountain rising 639 m straight from the fjord, offering one of northern Norway''s most rewarding hikes.', 69.4075, 17.2430, 'Mountains', 'Mountain Peak'),
    (d_senja, 'Husøy Fishing Village', 'A tiny island village connected by a tunnel, with colorful houses perched between mountain and sea.', 69.3900, 17.0700, 'Villages', 'Fishing Village'),
    (d_senja, 'Bergsbotn Viewpoint', 'A cantilevered viewing platform overlooking the dramatic Bergsfjorden and surrounding peaks.', 69.3570, 17.2150, 'Hidden Gems', 'Viewpoint'),
    (d_senja, 'Mefjord', 'A stunningly secluded fjord surrounded by jagged peaks, popular for sea kayaking and fishing.', 69.3800, 17.1200, 'Hidden Gems', 'Fjord');

-- ── Rogaland ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_stavanger, 'Preikestolen (Pulpit Rock)', 'A flat-topped cliff rising 604 m above the Lysefjord, one of Norway''s most famous natural attractions.', 58.9863, 6.1886, 'Mountains', 'Cliff'),
    (d_stavanger, 'Stavanger Old Town', 'Northern Europe''s best-preserved wooden house settlement, with 173 white houses from the 18th century.', 58.9734, 5.7266, 'Historical Sites', 'Historic District'),
    (d_stavanger, 'Norwegian Petroleum Museum', 'An interactive museum shaped like an oil platform, telling the story of Norway''s offshore petroleum industry.', 58.9740, 5.7300, 'Tourist Attractions', 'Museum'),
    (d_stavanger, 'Sverd i Fjell', 'Three giant bronze swords planted in rock commemorating the Battle of Hafrsfjord that unified Norway in 872 AD.', 58.9414, 5.6698, 'Historical Sites', 'Monument'),
    (d_ryfylke, 'Kjeragbolten', 'A famous boulder wedged between two cliff faces 984 m above the Lysefjord, a bucket-list photo spot.', 59.0347, 6.5777, 'Hidden Gems', 'Rock Formation'),
    (d_ryfylke, 'Lysefjord', 'A 42 km fjord framed by 1,000 m granite walls, best experienced by boat beneath Preikestolen and Kjerag.', 59.0000, 6.3000, 'Tourist Attractions', 'Fjord'),
    (d_ryfylke, 'Flørli 4444', 'The world''s longest wooden staircase with 4,444 steps climbing 740 m along an old hydroelectric penstock.', 59.0670, 6.3190, 'Hidden Gems', 'Staircase'),
    (d_ryfylke, 'Månafossen Waterfall', 'A powerful 92 m waterfall plunging into a narrow gorge, accessed by a short but steep trail.', 58.9930, 6.3530, 'Waterfalls', 'Waterfall');

-- ── Innlandet ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_lillehammer, 'Lillehammer Olympic Park', 'The venue of the 1994 Winter Olympics, now a year-round sports and culture destination with ski jumping hills.', 61.1153, 10.4662, 'Tourist Attractions', 'Olympic Park'),
    (d_lillehammer, 'Maihaugen Open-Air Museum', 'One of Europe''s largest open-air museums with over 200 historical buildings spanning 600 years.', 61.1090, 10.4810, 'Historical Sites', 'Museum'),
    (d_lillehammer, 'Nøklevann Forest Trail', 'A peaceful lakeside walking trail through ancient birch and pine forest above the town.', 61.1300, 10.5000, 'Forests', 'Trail'),
    (d_lillehammer, 'Lake Mjøsa', 'Norway''s largest lake, offering scenic ferry rides on the historic paddle steamer DS Skibladner.', 60.7500, 10.7500, 'Lakes', 'Lake'),
    (d_lom, 'Jotunheimen National Park', 'Home to the two highest peaks in Scandinavia, Galdhøpiggen (2,469 m) and Glittertind (2,465 m).', 61.6400, 8.3100, 'Mountains', 'National Park'),
    (d_lom, 'Lom Stave Church', 'A remarkably preserved medieval stave church from around 1170, expanded in the 17th century with dragon-head carvings.', 61.8389, 8.5649, 'Historical Sites', 'Stave Church'),
    (d_lom, 'Galdhøpiggen', 'The highest mountain in Scandinavia at 2,469 m, with a glacier crossing to the summit.', 61.6367, 8.3125, 'Mountains', 'Mountain Peak'),
    (d_lom, 'Besseggen Ridge', 'A legendary ridge hike between Lake Gjende and Bessvatnet, with a 1,000 m drop and striking color contrast between the lakes.', 61.5000, 8.8500, 'Mountains', 'Ridge');

-- ════════════════════════════════════════════════════════════════════════════
-- ITALY
-- ════════════════════════════════════════════════════════════════════════════

-- ── Lazio ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_rome, 'Colosseum', 'The largest ancient amphitheatre ever built, a 2,000-year-old icon of Roman engineering and gladiatorial combat.', 41.8902, 12.4922, 'Historical Sites', 'Amphitheatre'),
    (d_rome, 'Pantheon', 'A masterpiece of Roman architecture with the world''s largest unreinforced concrete dome, built in 126 AD.', 41.8986, 12.4769, 'Historical Sites', 'Temple'),
    (d_rome, 'Trevi Fountain', 'Rome''s largest and most famous Baroque fountain, where tossing a coin over your shoulder ensures a return to Rome.', 41.9009, 12.4833, 'Tourist Attractions', 'Fountain'),
    (d_rome, 'Roman Forum', 'The ruins of the political, commercial, and religious center of ancient Rome, spanning centuries of history.', 41.8925, 12.4853, 'Historical Sites', 'Archaeological Site'),
    (d_rome, 'Vatican Museums', 'One of the world''s greatest art collections culminating in Michelangelo''s Sistine Chapel ceiling.', 41.9065, 12.4536, 'Tourist Attractions', 'Museum'),
    (d_rome, 'Trastevere', 'A bohemian neighborhood of cobblestone alleys, ivy-covered buildings, trattorias, and vibrant nightlife.', 41.8821, 12.4697, 'Villages', 'Historic District'),
    (d_viterbo, 'Bomarzo Monster Park', 'A 16th-century garden of bizarre giant stone sculptures including a screaming ogre mouth you can walk into.', 42.4915, 12.2471, 'Hidden Gems', 'Sculpture Garden'),
    (d_viterbo, 'Palazzo dei Papi', 'The medieval papal palace where several popes resided, with a stunning Gothic loggia overlooking the valley.', 42.4171, 12.1047, 'Historical Sites', 'Palace'),
    (d_viterbo, 'Terme dei Papi', 'Ancient hot springs used since Etruscan times, with a large thermal pool at 40°C in a volcanic landscape.', 42.4390, 12.0510, 'Hidden Gems', 'Hot Spring');

-- ── Tuscany ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_florence, 'Florence Cathedral (Duomo)', 'Brunelleschi''s magnificent dome dominates the Florence skyline, an engineering marvel of the Renaissance.', 43.7731, 11.2560, 'Historical Sites', 'Cathedral'),
    (d_florence, 'Uffizi Gallery', 'One of the world''s greatest art museums, housing masterpieces by Botticelli, Leonardo, and Caravaggio.', 43.7677, 11.2553, 'Tourist Attractions', 'Museum'),
    (d_florence, 'Ponte Vecchio', 'A medieval stone bridge lined with goldsmith shops, spanning the Arno River since 1345.', 43.7680, 11.2531, 'Historical Sites', 'Bridge'),
    (d_florence, 'Boboli Gardens', 'An elaborate Renaissance garden behind the Pitti Palace with sculptures, fountains, and panoramic terraces.', 43.7628, 11.2481, 'Tourist Attractions', 'Garden'),
    (d_siena, 'Piazza del Campo', 'A shell-shaped medieval square, site of the famous Palio horse race, considered one of Europe''s finest public spaces.', 43.3186, 11.3316, 'Historical Sites', 'Square'),
    (d_siena, 'Siena Cathedral', 'A stunning Gothic cathedral with an intricate marble floor, Piccolomini Library, and Nicola Pisano''s pulpit.', 43.3176, 11.3287, 'Historical Sites', 'Cathedral'),
    (d_siena, 'Val d''Orcia', 'A UNESCO World Heritage landscape of rolling hills, cypress-lined roads, and golden wheat fields.', 43.0700, 11.5700, 'Hidden Gems', 'Valley'),
    (d_pisa, 'Leaning Tower of Pisa', 'The world-famous bell tower with its unintentional 4° tilt, part of the stunning Piazza dei Miracoli complex.', 43.7230, 10.3966, 'Tourist Attractions', 'Tower'),
    (d_pisa, 'Piazza dei Miracoli', 'A UNESCO World Heritage ensemble of the Cathedral, Baptistery, Camposanto, and the famous Leaning Tower.', 43.7228, 10.3966, 'Historical Sites', 'Square');

-- ── Lombardy ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_milan, 'Milan Cathedral (Duomo)', 'Italy''s largest church and a masterpiece of Gothic architecture, adorned with 3,400 statues and 135 spires.', 45.4642, 9.1919, 'Historical Sites', 'Cathedral'),
    (d_milan, 'Galleria Vittorio Emanuele II', 'Italy''s oldest active shopping gallery, a stunning iron-and-glass arcade connecting the Duomo and La Scala.', 45.4657, 9.1895, 'Urban Attractions', 'Gallery'),
    (d_milan, 'The Last Supper', 'Leonardo da Vinci''s iconic mural in the refectory of Santa Maria delle Grazie, a UNESCO World Heritage Site.', 45.4661, 9.1711, 'Tourist Attractions', 'Artwork'),
    (d_milan, 'Navigli District', 'A bohemian canal district with art studios, vintage shops, and aperitivo bars along illuminated waterways.', 45.4500, 9.1780, 'Urban Attractions', 'Canal District'),
    (d_como, 'Lake Como', 'A breathtaking Y-shaped lake surrounded by Alps, elegant villas, and charming lakeside villages.', 45.9863, 9.2572, 'Lakes', 'Lake'),
    (d_como, 'Villa del Balbianello', 'A stunning 18th-century villa on a wooded promontory, used as a filming location for Star Wars and James Bond.', 45.9653, 9.2029, 'Tourist Attractions', 'Villa'),
    (d_como, 'Varenna', 'A dreamy lakeside village with pastel-colored houses, narrow lanes, and the gardens of Villa Monastero.', 46.0100, 9.2840, 'Villages', 'Village'),
    (d_como, 'Brunate', 'A hilltop village above Como reached by funicular, known as the "balcony of the Alps" for its views.', 45.8270, 9.0990, 'Hidden Gems', 'Village');

-- ── Sicily ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_palermo, 'Palermo Cathedral', 'A grand Norman cathedral with a mix of architectural styles spanning 800 years, housing royal and imperial tombs.', 38.1147, 13.3562, 'Historical Sites', 'Cathedral'),
    (d_palermo, 'Teatro Massimo', 'Italy''s largest and Europe''s third-largest opera house, famous for the climactic scene in The Godfather Part III.', 38.1201, 13.3569, 'Urban Attractions', 'Opera House'),
    (d_palermo, 'Mondello Beach', 'A sandy beach in a sheltered bay framed by Monte Pellegrino and Monte Gallo, Palermo''s seaside escape.', 38.2024, 13.3240, 'Beaches', 'Beach'),
    (d_catania, 'Mount Etna', 'Europe''s tallest and most active volcano at 3,357 m, with lava fields, wine vineyards, and cable car excursions.', 37.7510, 14.9934, 'Mountains', 'Volcano'),
    (d_catania, 'Taormina', 'A hilltop town with a magnificently preserved Greek Theatre framing views of Mount Etna and the Ionian Sea.', 37.8516, 15.2854, 'Tourist Attractions', 'Town'),
    (d_catania, 'Isola Bella', 'A tiny island and nature reserve connected to Taormina''s shore by a narrow sandbar, a jewel of the Ionian coast.', 37.8472, 15.3000, 'Beaches', 'Island'),
    (d_agrigento, 'Valley of the Temples', 'A UNESCO World Heritage archaeological park with seven remarkably preserved ancient Greek temples.', 37.2908, 13.5882, 'Historical Sites', 'Archaeological Site'),
    (d_agrigento, 'Scala dei Turchi', 'A dramatic staircase-shaped cliff of bright white marl limestone descending into turquoise Mediterranean waters.', 37.2905, 13.4700, 'Beaches', 'Cliff Beach'),
    (d_agrigento, 'Kolymbetra Garden', 'A lush Mediterranean garden in a deep valley between ancient temples, with citrus groves and olive trees.', 37.2900, 13.5850, 'Hidden Gems', 'Garden');

-- ── Veneto ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_venice, 'St. Mark''s Basilica', 'A Byzantine masterpiece with golden mosaics, five domes, and the stolen bronze horses of Constantinople.', 45.4345, 12.3396, 'Historical Sites', 'Basilica'),
    (d_venice, 'Rialto Bridge', 'The oldest of four bridges spanning Venice''s Grand Canal, lined with shops and offering canal views.', 45.4381, 12.3358, 'Historical Sites', 'Bridge'),
    (d_venice, 'Doge''s Palace', 'A Gothic masterpiece that was the seat of Venetian government, with Tintoretto''s Paradise, the world''s largest oil painting.', 45.4337, 12.3401, 'Historical Sites', 'Palace'),
    (d_venice, 'Burano', 'A vibrantly colored island of rainbow houses famous for traditional lace-making and photogenic canals.', 45.4854, 12.4168, 'Villages', 'Island'),
    (d_venice, 'Grand Canal', 'Venice''s main water thoroughfare lined with over 170 palaces, best experienced by vaporetto or gondola.', 45.4340, 12.3280, 'Tourist Attractions', 'Canal'),
    (d_verona, 'Verona Arena', 'A 1st-century Roman amphitheatre still hosting spectacular open-air opera performances for 15,000 spectators.', 45.4389, 10.9946, 'Historical Sites', 'Amphitheatre'),
    (d_verona, 'Juliet''s House', 'The legendary balcony associated with Shakespeare''s Romeo and Juliet, in a 13th-century house with a bronze Juliet statue.', 45.4420, 10.9984, 'Tourist Attractions', 'Historic House'),
    (d_verona, 'Ponte Pietra', 'Verona''s oldest bridge, a Roman arch bridge spanning the Adige River with views of the Theatre and hillside San Pietro.', 45.4479, 10.9990, 'Historical Sites', 'Bridge'),
    (d_verona, 'Lake Garda', 'Italy''s largest lake, offering olive groves, lemon gardens, windsurfing, and the charming town of Sirmione.', 45.6500, 10.6833, 'Lakes', 'Lake');

-- ════════════════════════════════════════════════════════════════════════════
-- FRANCE
-- ════════════════════════════════════════════════════════════════════════════

-- ── Île-de-France ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_paris, 'Eiffel Tower', 'The 330 m iron lattice tower built for the 1889 World''s Fair, the most visited paid monument in the world.', 48.8584, 2.2945, 'Tourist Attractions', 'Tower'),
    (d_paris, 'Louvre Museum', 'The world''s largest and most visited art museum, home to the Mona Lisa, Venus de Milo, and 380,000 objects.', 48.8606, 2.3376, 'Tourist Attractions', 'Museum'),
    (d_paris, 'Notre-Dame Cathedral', 'A masterpiece of French Gothic architecture on the Île de la Cité, undergoing restoration after the 2019 fire.', 48.8530, 2.3499, 'Historical Sites', 'Cathedral'),
    (d_paris, 'Sacré-Cœur Basilica', 'A white-domed basilica atop Montmartre hill, offering panoramic views of Paris from its steps and dome.', 48.8867, 2.3431, 'Historical Sites', 'Basilica'),
    (d_paris, 'Montmartre', 'A bohemian hilltop village within Paris, where Picasso and Modigliani once lived, now filled with artists and cafés.', 48.8867, 2.3400, 'Villages', 'Historic District'),
    (d_paris, 'Luxembourg Gardens', 'A beloved Parisian park with formal gardens, the Medici Fountain, model sailboats, and open-air chess.', 48.8462, 2.3372, 'Tourist Attractions', 'Garden'),
    (d_versailles, 'Palace of Versailles', 'The opulent former royal residence with the Hall of Mirrors, sprawling gardens, and the Grand Trianon.', 48.8049, 2.1204, 'Historical Sites', 'Palace'),
    (d_versailles, 'Gardens of Versailles', 'Formal French gardens spanning 800 hectares with fountains, sculptures, and the Grand Canal.', 48.8048, 2.1120, 'Tourist Attractions', 'Garden'),
    (d_versailles, 'Marie Antoinette''s Estate', 'A rustic retreat within Versailles where the queen escaped court life, with a hamlet and English garden.', 48.8116, 2.1291, 'Hidden Gems', 'Estate');

-- ── PACA ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_marseille, 'Calanques National Park', 'Dramatic white limestone cliffs plunging into turquoise Mediterranean waters, with hidden coves for swimming.', 43.2100, 5.4300, 'Mountains', 'National Park'),
    (d_marseille, 'Old Port (Vieux-Port)', 'Marseille''s historic harbor lined with fish restaurants, where fishermen still sell the morning catch.', 43.2951, 5.3740, 'Urban Attractions', 'Port'),
    (d_marseille, 'Basilique Notre-Dame de la Garde', 'A Neo-Byzantine basilica perched atop Marseille''s highest point, offering 360° views of the city and sea.', 43.2838, 5.3713, 'Historical Sites', 'Basilica'),
    (d_marseille, 'Château d''If', 'An island fortress made famous by Alexandre Dumas'' The Count of Monte Cristo, accessible by boat from Marseille.', 43.2800, 5.3250, 'Historical Sites', 'Castle'),
    (d_nice, 'Promenade des Anglais', 'Nice''s iconic seafront boulevard stretching 7 km along the Baie des Anges with palm trees and blue chairs.', 43.6949, 7.2652, 'Beaches', 'Promenade'),
    (d_nice, 'Old Town Nice (Vieux Nice)', 'A labyrinth of narrow alleys with Baroque churches, gelato shops, and the lively Cours Saleya flower market.', 43.6961, 7.2756, 'Villages', 'Historic District'),
    (d_nice, 'Castle Hill (Colline du Château)', 'A hilltop park with ruins, a waterfall, and stunning panoramic views over Nice, the port, and the coastline.', 43.6950, 7.2820, 'Tourist Attractions', 'Park'),
    (d_nice, 'Eze Village', 'A medieval hilltop village perched 427 m above the sea with exotic gardens and sweeping Riviera views.', 43.7283, 7.3617, 'Villages', 'Medieval Village');

-- ── Occitanie ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_toulouse, 'Capitole de Toulouse', 'The majestic city hall and opera house facing a grand pink-brick square in the heart of the Pink City.', 43.6044, 1.4436, 'Historical Sites', 'City Hall'),
    (d_toulouse, 'Basilique Saint-Sernin', 'The largest remaining Romanesque building in Europe, a key stop on the Santiago de Compostela pilgrimage route.', 43.6084, 1.4425, 'Historical Sites', 'Basilica'),
    (d_toulouse, 'Cité de l''Espace', 'A space-themed amusement park with a full-size Ariane 5 rocket, Mir space station replica, and planetarium.', 43.5867, 1.4917, 'Tourist Attractions', 'Theme Park'),
    (d_toulouse, 'Canal du Midi', 'A UNESCO World Heritage canal shaded by plane trees, perfect for cycling, boating, and leisurely walks.', 43.5900, 1.4700, 'Hidden Gems', 'Canal'),
    (d_carcassonne, 'Cité de Carcassonne', 'Europe''s largest intact medieval fortified city with 52 towers, double walls, and a fairytale silhouette.', 43.2069, 2.3634, 'Historical Sites', 'Fortified City'),
    (d_carcassonne, 'Château Comtal', 'A 12th-century castle within the walled city, with a museum, rampart walks, and views over the Aude valley.', 43.2065, 2.3620, 'Historical Sites', 'Castle'),
    (d_carcassonne, 'Pont Vieux', 'A 14th-century stone bridge spanning the Aude River, offering the classic postcard view of the fortified city.', 43.2070, 2.3510, 'Hidden Gems', 'Bridge'),
    (d_carcassonne, 'Lac de la Cavayère', 'A scenic recreational lake surrounded by pine forests, with beaches, water sports, and an adventure park.', 43.1860, 2.3800, 'Lakes', 'Lake');

-- ── Auvergne-Rhône-Alpes ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_lyon, 'Vieux Lyon', 'One of Europe''s largest Renaissance neighborhoods with traboules (hidden passageways), silk workshops, and bouchon restaurants.', 45.7625, 4.8270, 'Historical Sites', 'Historic District'),
    (d_lyon, 'Basilique Notre-Dame de Fourvière', 'An ornate 19th-century basilica overlooking Lyon from the Fourvière hill, blending Byzantine and Romanesque styles.', 45.7620, 4.8225, 'Historical Sites', 'Basilica'),
    (d_lyon, 'Parc de la Tête d''Or', 'Lyon''s largest urban park with a lake, botanical garden, free zoo, and rose garden with 16,000 rosebushes.', 45.7789, 4.8558, 'Tourist Attractions', 'Park'),
    (d_lyon, 'Les Halles de Lyon Paul Bocuse', 'A gourmet indoor market named after the legendary chef, with 56 stalls of French cheeses, charcuterie, and pastries.', 45.7540, 4.8512, 'Urban Attractions', 'Market'),
    (d_chamonix, 'Mont Blanc', 'Western Europe''s highest peak at 4,808 m, the crown jewel of the Alps and a mountaineering mecca.', 45.8326, 6.8652, 'Mountains', 'Mountain Peak'),
    (d_chamonix, 'Aiguille du Midi', 'A cable car ascending to 3,842 m with a glass-floored "Step into the Void" skywalk over a 1,000 m drop.', 45.8788, 6.8872, 'Mountains', 'Cable Car Station'),
    (d_chamonix, 'Mer de Glace', 'France''s largest glacier, accessible by the Montenvers railway, with an ice cave carved anew each year.', 45.9064, 6.9300, 'Mountains', 'Glacier'),
    (d_chamonix, 'Lac Blanc', 'A stunning alpine lake at 2,352 m reflecting the Mont Blanc massif, reached by a rewarding half-day hike.', 45.9708, 6.8861, 'Lakes', 'Alpine Lake');

-- ── Brittany ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_rennes, 'Parlement de Bretagne', 'The 17th-century seat of the Breton parliament, with richly decorated interiors restored after a 1994 fire.', 48.1140, -1.6768, 'Historical Sites', 'Parliament'),
    (d_rennes, 'Thabor Park', 'A beautiful botanical garden and French formal park in the heart of Rennes with over 3,000 plant species.', 48.1110, -1.6680, 'Tourist Attractions', 'Park'),
    (d_rennes, 'Les Champs Libres', 'A striking modern cultural center housing a science museum, planetarium, and the Brittany regional library.', 48.1054, -1.6756, 'Urban Attractions', 'Cultural Center'),
    (d_rennes, 'Forêt de Brocéliande', 'The legendary forest of Arthurian legend, home to Merlin''s tomb, the Fountain of Youth, and ancient megaliths.', 48.0700, -2.1700, 'Forests', 'Enchanted Forest'),
    (d_saintmalo, 'Intra-Muros (Walled City)', 'The granite-walled old town of Saint-Malo, a former corsair stronghold with rampart walks and sea views.', 48.6493, -2.0076, 'Historical Sites', 'Fortified City'),
    (d_saintmalo, 'Fort National', 'A 17th-century island fortress accessible at low tide, built by Vauban to defend the corsair city.', 48.6534, -2.0094, 'Historical Sites', 'Fort'),
    (d_saintmalo, 'Grand Bé Island', 'A tidal island with the tomb of Chateaubriand, accessible on foot at low tide with panoramic coastal views.', 48.6550, -2.0150, 'Hidden Gems', 'Island'),
    (d_saintmalo, 'Plage du Sillon', 'A beautiful sandy beach stretching 3 km along the coast with views of the walled city and dramatic tides.', 48.6560, -1.9850, 'Beaches', 'Beach');

-- ════════════════════════════════════════════════════════════════════════════
-- UNITED STATES
-- ════════════════════════════════════════════════════════════════════════════

-- ── California ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_la, 'Griffith Observatory', 'An iconic Art Deco observatory offering free telescope viewing and panoramic views of Los Angeles and the Hollywood Sign.', 34.1184, -118.3004, 'Tourist Attractions', 'Observatory'),
    (d_la, 'Santa Monica Pier', 'A historic waterfront pier with an amusement park, aquarium, and views of the Pacific Coast.', 34.0083, -118.4987, 'Tourist Attractions', 'Pier'),
    (d_la, 'The Getty Center', 'A hilltop arts campus with world-class European art, stunning architecture by Richard Meier, and terraced gardens.', 34.0780, -118.4741, 'Tourist Attractions', 'Museum'),
    (d_la, 'Venice Beach Boardwalk', 'A vibrant oceanfront promenade with street performers, Muscle Beach, murals, and eclectic shops.', 33.9850, -118.4695, 'Beaches', 'Boardwalk'),
    (d_sf, 'Golden Gate Bridge', 'The iconic 2.7 km suspension bridge spanning the Golden Gate strait, a marvel of 1930s engineering.', 37.8199, -122.4783, 'Tourist Attractions', 'Bridge'),
    (d_sf, 'Alcatraz Island', 'The notorious former federal penitentiary on an island in San Francisco Bay, now a national historic landmark.', 37.8270, -122.4230, 'Historical Sites', 'Prison'),
    (d_sf, 'Fisherman''s Wharf', 'San Francisco''s bustling waterfront neighborhood known for sea lions, clam chowder, and bay cruises.', 37.8080, -122.4177, 'Tourist Attractions', 'Wharf'),
    (d_sf, 'Painted Ladies', 'A row of colorful Victorian houses with the modern San Francisco skyline as a backdrop, an iconic photo spot.', 37.7762, -122.4327, 'Urban Attractions', 'Houses'),
    (d_yosemite_area, 'Yosemite Valley', 'A glacially carved valley with sheer granite walls, thundering waterfalls, and giant sequoia groves.', 37.7459, -119.5332, 'Mountains', 'Valley'),
    (d_yosemite_area, 'Half Dome', 'An iconic granite dome rising nearly 1,500 m above the valley floor, a bucket-list hike with cable assists.', 37.7460, -119.5332, 'Mountains', 'Granite Dome'),
    (d_yosemite_area, 'Yosemite Falls', 'The tallest waterfall in North America at 739 m, cascading in three sections down a massive granite cliff.', 37.7564, -119.5964, 'Waterfalls', 'Waterfall'),
    (d_yosemite_area, 'Mariposa Grove', 'A grove of over 500 mature giant sequoias, including the Grizzly Giant estimated at 1,900 years old.', 37.5142, -119.6007, 'Forests', 'Sequoia Grove');

-- ── New York ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_nyc, 'Central Park', 'An 843-acre urban oasis in Manhattan with meadows, woodlands, a lake, and world-class performing arts.', 40.7829, -73.9654, 'Tourist Attractions', 'Park'),
    (d_nyc, 'Statue of Liberty', 'A colossal neoclassical sculpture gifted by France, symbolizing freedom and welcoming immigrants since 1886.', 40.6892, -74.0445, 'Historical Sites', 'Monument'),
    (d_nyc, 'Times Square', 'The neon-lit crossroads of the world, a dazzling commercial intersection in the heart of Midtown Manhattan.', 40.7580, -73.9855, 'Urban Attractions', 'Square'),
    (d_nyc, 'Brooklyn Bridge', 'A majestic 1883 suspension bridge connecting Manhattan and Brooklyn, with a pedestrian walkway offering skyline views.', 40.7061, -73.9969, 'Historical Sites', 'Bridge'),
    (d_nyc, 'The High Line', 'A 2.3 km elevated linear park built on a former freight rail line, with gardens, art installations, and city views.', 40.7480, -74.0048, 'Urban Attractions', 'Park'),
    (d_nyc, 'Empire State Building', 'The iconic 102-story Art Deco skyscraper offering observation deck views from the 86th and 102nd floors.', 40.7484, -73.9857, 'Tourist Attractions', 'Skyscraper'),
    (d_adirondacks, 'Lake Placid', 'A charming mountain village and twice Winter Olympics host, set on a pristine lake in the Adirondack High Peaks.', 44.2795, -73.9799, 'Lakes', 'Lake'),
    (d_adirondacks, 'Whiteface Mountain', 'The fifth-highest peak in New York at 1,483 m, with a veterans'' memorial highway and castle at the summit.', 44.3659, -73.9026, 'Mountains', 'Mountain Peak'),
    (d_adirondacks, 'Ausable Chasm', 'A sandstone gorge known as the "Grand Canyon of the Adirondacks," with rafting, climbing, and scenic trails.', 44.4328, -73.4619, 'Hidden Gems', 'Canyon'),
    (d_adirondacks, 'Mirror Lake', 'A serene mountain lake in the heart of Lake Placid village, perfect for canoeing, skating, and lakeside strolls.', 44.2879, -73.9833, 'Lakes', 'Lake');

-- ── Colorado ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_denver, 'Red Rocks Amphitheatre', 'A world-famous natural amphitheatre with stunning red sandstone formations, hosting concerts since 1906.', 39.6654, -105.2057, 'Tourist Attractions', 'Amphitheatre'),
    (d_denver, 'Denver Botanic Gardens', 'A 24-acre urban oasis with diverse gardens, a conservatory, and seasonal art exhibitions.', 39.7322, -104.9611, 'Tourist Attractions', 'Garden'),
    (d_denver, 'Rocky Mountain Arsenal National Wildlife Refuge', 'An urban wildlife refuge where bison, deer, and raptors roam just minutes from downtown Denver.', 39.8117, -104.8619, 'Forests', 'Wildlife Refuge'),
    (d_denver, 'Denver Art Museum', 'An architecturally striking museum with an outstanding collection of Native American and Western art.', 39.7372, -104.9893, 'Urban Attractions', 'Museum'),
    (d_aspen, 'Maroon Bells', 'Two iconic 14,000-foot peaks reflected in Maroon Lake, the most photographed mountains in North America.', 39.0709, -106.9891, 'Mountains', 'Mountain Peak'),
    (d_aspen, 'Independence Pass', 'A breathtaking mountain pass at 3,687 m crossing the Continental Divide with alpine tundra and panoramic views.', 39.1074, -106.5624, 'Mountains', 'Mountain Pass'),
    (d_aspen, 'Hanging Lake', 'A fragile turquoise lake perched on a cliff edge in Glenwood Canyon, reached by a steep but rewarding trail.', 39.6017, -107.1922, 'Lakes', 'Alpine Lake'),
    (d_aspen, 'Ashcroft Ghost Town', 'A preserved 1880s silver mining ghost town in a scenic valley below the Elk Mountains.', 39.0572, -106.7869, 'Historical Sites', 'Ghost Town');

-- ── Hawaii ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_honolulu, 'Waikiki Beach', 'Hawaii''s most famous beach with golden sand, gentle waves, and Diamond Head crater as a backdrop.', 21.2793, -157.8292, 'Beaches', 'Beach'),
    (d_honolulu, 'Diamond Head', 'A 232 m volcanic crater with a trail to the summit offering 360° views of Honolulu and the Pacific.', 21.2620, -157.8050, 'Mountains', 'Volcanic Crater'),
    (d_honolulu, 'Pearl Harbor Memorial', 'A solemn memorial spanning the sunken USS Arizona, honoring the 1,177 crew members who perished on December 7, 1941.', 21.3649, -157.9500, 'Historical Sites', 'Memorial'),
    (d_honolulu, 'Hanauma Bay', 'A pristine marine life conservation area in a volcanic crater bay, one of Hawaii''s top snorkeling spots.', 21.2690, -157.6937, 'Beaches', 'Bay'),
    (d_honolulu, 'Manoa Falls', 'A 46 m waterfall at the end of a lush rainforest trail in the back of Manoa Valley.', 21.3330, -157.7980, 'Waterfalls', 'Waterfall'),
    (d_maui, 'Haleakalā Summit', 'A dormant volcano rising 3,055 m above sea level, famous for its otherworldly sunrise above the clouds.', 20.7204, -156.1552, 'Mountains', 'Volcanic Summit'),
    (d_maui, 'Road to Hana', 'A legendary 103 km coastal drive with 620 curves, 59 bridges, and stops at waterfalls, beaches, and gardens.', 20.8550, -156.1400, 'Tourist Attractions', 'Scenic Drive'),
    (d_maui, 'Seven Sacred Pools (Ohe''o Gulch)', 'A series of cascading waterfalls and pools in the Kīpahulu section of Haleakalā National Park.', 20.6614, -156.0428, 'Waterfalls', 'Pool Cascade'),
    (d_maui, 'Ka''anapali Beach', 'A 5 km stretch of white sand beach with cliff-jumping at Black Rock and sunset catamaran cruises.', 20.9275, -156.6920, 'Beaches', 'Beach'),
    (d_maui, 'Iao Valley', 'A lush rainforest valley with the Iao Needle, a 370 m natural monument rising from the valley floor.', 20.8815, -156.5450, 'Mountains', 'Valley');

-- ── Arizona ──
INSERT INTO public.places (district_id, name, description, latitude, longitude, category, place_type) VALUES
    (d_coconino, 'Grand Canyon South Rim', 'One of the Seven Natural Wonders of the World, revealing 2 billion years of Earth''s geological history in layered rock.', 36.0544, -112.1401, 'Mountains', 'Canyon'),
    (d_coconino, 'Horseshoe Bend', 'A dramatic horseshoe-shaped meander of the Colorado River 305 m below a cliff viewpoint near Page.', 36.8791, -111.5104, 'Hidden Gems', 'Canyon'),
    (d_coconino, 'Antelope Canyon', 'A narrow slot canyon with flowing sandstone walls sculpted by water, creating beams of light and vivid colors.', 36.8619, -111.3743, 'Hidden Gems', 'Slot Canyon'),
    (d_coconino, 'Sedona Red Rocks', 'Stunning red sandstone formations like Cathedral Rock and Bell Rock rising from the high desert floor.', 34.8697, -111.7610, 'Mountains', 'Rock Formation'),
    (d_coconino, 'Meteor Crater', 'A remarkably preserved 50,000-year-old impact crater nearly 1.6 km wide and 170 m deep.', 35.0270, -111.0225, 'Hidden Gems', 'Impact Crater'),
    (d_coconino, 'Havasu Falls', 'A stunning 30 m turquoise waterfall in a remote canyon on the Havasupai Indian Reservation.', 36.2553, -112.6979, 'Waterfalls', 'Waterfall'),
    (d_pima, 'Saguaro National Park', 'A park protecting giant saguaro cacti, the iconic symbol of the American Southwest, some over 150 years old.', 32.1797, -111.1661, 'Forests', 'National Park'),
    (d_pima, 'Arizona-Sonora Desert Museum', 'A world-renowned zoo, botanical garden, and natural history museum showcasing Sonoran Desert life.', 32.2434, -111.1668, 'Tourist Attractions', 'Museum'),
    (d_pima, 'Tucson Mountain Park', 'A desert mountain park with saguaro forests, petroglyphs, and the iconic Gates Pass sunset viewpoint.', 32.1850, -111.1200, 'Mountains', 'Desert Park'),
    (d_pima, 'Mission San Xavier del Bac', 'The "White Dove of the Desert," a stunning 18th-century Spanish mission with ornate Baroque interiors.', 32.1073, -111.0089, 'Historical Sites', 'Mission');


END $$;

-- ============================================================================
-- Verification queries (uncomment to check counts)
-- ============================================================================
-- SELECT 'countries'     AS tbl, COUNT(*) FROM public.countries
-- UNION ALL SELECT 'states', COUNT(*) FROM public.states
-- UNION ALL SELECT 'districts', COUNT(*) FROM public.districts
-- UNION ALL SELECT 'places', COUNT(*) FROM public.places;
