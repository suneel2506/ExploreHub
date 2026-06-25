-- ============================================================================
-- ExploreHub — Migration 005: Hierarchical Schema
-- ============================================================================
-- Run this in Supabase SQL Editor.
-- Rebuilds all tables into a proper geographic hierarchy:
--   Country → State → District → City → Place
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop everything in dependency order
-- ============================================================================

DROP VIEW  IF EXISTS public.v_user_stats          CASCADE;
DROP VIEW  IF EXISTS public.v_places_full         CASCADE;

DROP TABLE IF EXISTS public.media                 CASCADE;
DROP TABLE IF EXISTS public.memories              CASCADE;
DROP TABLE IF EXISTS public.wishlist              CASCADE;
DROP TABLE IF EXISTS public.visited_places        CASCADE;
DROP TABLE IF EXISTS public.custom_places         CASCADE;
DROP TABLE IF EXISTS public.places                CASCADE;
DROP TABLE IF EXISTS public.cities                CASCADE;
DROP TABLE IF EXISTS public.districts             CASCADE;
DROP TABLE IF EXISTS public.states                CASCADE;
DROP TABLE IF EXISTS public.countries             CASCADE;

-- ============================================================================
-- STEP 2: COUNTRIES
-- ============================================================================

CREATE TABLE public.countries (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL UNIQUE,
    code        text,                -- ISO 3166-1 alpha-2 (e.g. 'IN')
    flag_emoji  text,                -- e.g. '🇮🇳'
    osm_id      bigint           UNIQUE,
    created_at  timestamptz      DEFAULT now()
);

CREATE INDEX idx_countries_name ON public.countries(name);

-- ============================================================================
-- STEP 3: STATES
-- ============================================================================

CREATE TABLE public.states (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL,
    country_id  uuid             NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    code        text,                -- e.g. 'TN' for Tamil Nadu
    osm_id      bigint           UNIQUE,
    created_at  timestamptz      DEFAULT now(),

    UNIQUE (name, country_id)
);

CREATE INDEX idx_states_country ON public.states(country_id);
CREATE INDEX idx_states_name    ON public.states(name);

-- ============================================================================
-- STEP 4: DISTRICTS
-- ============================================================================

CREATE TABLE public.districts (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL,
    state_id    uuid             NOT NULL REFERENCES public.states(id) ON DELETE CASCADE,
    osm_id      bigint           UNIQUE,
    created_at  timestamptz      DEFAULT now(),

    UNIQUE (name, state_id)
);

CREATE INDEX idx_districts_state ON public.districts(state_id);
CREATE INDEX idx_districts_name  ON public.districts(name);

-- ============================================================================
-- STEP 5: CITIES
-- ============================================================================

CREATE TABLE public.cities (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL,
    district_id uuid             NOT NULL REFERENCES public.districts(id) ON DELETE CASCADE,
    latitude    double precision,
    longitude   double precision,
    population  integer,
    place_type  text,                -- 'city', 'town', 'village'
    osm_id      bigint           UNIQUE,
    created_at  timestamptz      DEFAULT now(),

    UNIQUE (name, district_id)
);

CREATE INDEX idx_cities_district ON public.cities(district_id);
CREATE INDEX idx_cities_name     ON public.cities(name);
CREATE INDEX idx_cities_coords   ON public.cities(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ============================================================================
-- STEP 6: PLACES — travel-relevant entities, linked to city
-- ============================================================================

CREATE TABLE public.places (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL,
    description text,
    city_id     uuid             REFERENCES public.cities(id) ON DELETE SET NULL,
    category    text             NOT NULL DEFAULT 'Other',
    place_type  text,
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    image_url   text,
    wiki_url    text,
    osm_id      bigint           UNIQUE,
    source      text             NOT NULL DEFAULT 'OpenStreetMap',
    metadata    jsonb            DEFAULT '{}'::jsonb,
    created_at  timestamptz      DEFAULT now()
);

-- Full-Text Search column (generated, covers place + hierarchy via view)
ALTER TABLE public.places
    ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple',
            coalesce(name, '') || ' ' ||
            coalesce(category, '') || ' ' ||
            coalesce(place_type, '') || ' ' ||
            coalesce(description, '')
        )
    ) STORED;

CREATE INDEX idx_places_fts      ON public.places USING gin(fts);
CREATE INDEX idx_places_category ON public.places(category);
CREATE INDEX idx_places_city     ON public.places(city_id) WHERE city_id IS NOT NULL;
CREATE INDEX idx_places_coords   ON public.places(latitude, longitude);
CREATE INDEX idx_places_osm      ON public.places(osm_id)  WHERE osm_id IS NOT NULL;
CREATE INDEX idx_places_name     ON public.places(name);

-- ============================================================================
-- STEP 7: CUSTOM_PLACES — user-added
-- ============================================================================

CREATE TABLE public.custom_places (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid             NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name        text             NOT NULL,
    description text,
    country     text             DEFAULT 'India',
    state       text,
    district    text,
    city        text,
    city_id     uuid             REFERENCES public.cities(id) ON DELETE SET NULL,
    category    text             DEFAULT 'Other',
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    image_url   text,
    created_at  timestamptz      DEFAULT now()
);

ALTER TABLE public.custom_places
    ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple',
            coalesce(name,     '') || ' ' ||
            coalesce(state,    '') || ' ' ||
            coalesce(district, '') || ' ' ||
            coalesce(city,     '') || ' ' ||
            coalesce(category, '')
        )
    ) STORED;

CREATE INDEX idx_custom_places_user   ON public.custom_places(user_id);
CREATE INDEX idx_custom_places_fts    ON public.custom_places USING gin(fts);
CREATE INDEX idx_custom_places_coords ON public.custom_places(latitude, longitude);

-- ============================================================================
-- STEP 8: VISITED_PLACES
-- ============================================================================

CREATE TABLE public.visited_places (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid    NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
    place_id        uuid    REFERENCES public.places(id)                  ON DELETE CASCADE,
    custom_place_id uuid    REFERENCES public.custom_places(id)           ON DELETE CASCADE,
    visited_at      timestamptz DEFAULT now(),
    visit_count     integer DEFAULT 1,
    notes           text,
    rating          integer CHECK (rating >= 1 AND rating <= 10),

    CONSTRAINT chk_visited_one CHECK (
        (place_id IS NOT NULL AND custom_place_id IS NULL) OR
        (place_id IS NULL     AND custom_place_id IS NOT NULL)
    ),
    UNIQUE (user_id, place_id),
    UNIQUE (user_id, custom_place_id)
);

CREATE INDEX idx_visited_user   ON public.visited_places(user_id);
CREATE INDEX idx_visited_place  ON public.visited_places(place_id)        WHERE place_id  IS NOT NULL;
CREATE INDEX idx_visited_custom ON public.visited_places(custom_place_id) WHERE custom_place_id IS NOT NULL;

-- ============================================================================
-- STEP 9: WISHLIST
-- ============================================================================

CREATE TABLE public.wishlist (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid    NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
    place_id        uuid    REFERENCES public.places(id)                  ON DELETE CASCADE,
    custom_place_id uuid    REFERENCES public.custom_places(id)           ON DELETE CASCADE,
    added_at        timestamptz DEFAULT now(),

    CONSTRAINT chk_wish_one CHECK (
        (place_id IS NOT NULL AND custom_place_id IS NULL) OR
        (place_id IS NULL     AND custom_place_id IS NOT NULL)
    ),
    UNIQUE (user_id, place_id),
    UNIQUE (user_id, custom_place_id)
);

CREATE INDEX idx_wishlist_user   ON public.wishlist(user_id);
CREATE INDEX idx_wishlist_place  ON public.wishlist(place_id)        WHERE place_id  IS NOT NULL;
CREATE INDEX idx_wishlist_custom ON public.wishlist(custom_place_id) WHERE custom_place_id IS NOT NULL;

-- ============================================================================
-- STEP 10: MEMORIES
-- ============================================================================

CREATE TABLE public.memories (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid    NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
    place_id        uuid    REFERENCES public.places(id)                  ON DELETE SET NULL,
    custom_place_id uuid    REFERENCES public.custom_places(id)           ON DELETE SET NULL,
    title           text,
    content         text,
    rating          integer CHECK (rating >= 1 AND rating <= 10),
    visit_date      date,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_memories_user  ON public.memories(user_id);
CREATE INDEX idx_memories_place ON public.memories(place_id) WHERE place_id IS NOT NULL;

-- ============================================================================
-- STEP 11: MEDIA
-- ============================================================================

CREATE TABLE public.media (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid    NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
    place_id        uuid    REFERENCES public.places(id)                  ON DELETE SET NULL,
    custom_place_id uuid    REFERENCES public.custom_places(id)           ON DELETE SET NULL,
    memory_id       uuid    REFERENCES public.memories(id)                ON DELETE SET NULL,
    type            text    NOT NULL CHECK (type IN ('image', 'video')),
    url             text    NOT NULL,
    storage_path    text,
    bucket          text    DEFAULT 'photos',
    thumbnail_url   text,
    caption         text,
    file_size       bigint,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_media_user   ON public.media(user_id);
CREATE INDEX idx_media_memory ON public.media(memory_id) WHERE memory_id IS NOT NULL;
CREATE INDEX idx_media_place  ON public.media(place_id)  WHERE place_id  IS NOT NULL;

-- ============================================================================
-- STEP 12: VIEW — v_places_full (denormalized for frontend queries)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_places_full AS
SELECT
    p.id,
    p.name,
    p.description,
    p.category,
    p.place_type,
    p.latitude,
    p.longitude,
    p.image_url,
    p.wiki_url,
    p.osm_id,
    p.source,
    p.metadata,
    p.created_at,
    p.fts,
    -- City
    c.id          AS city_id,
    c.name        AS city_name,
    -- District
    d.id          AS district_id,
    d.name        AS district_name,
    -- State
    s.id          AS state_id,
    s.name        AS state_name,
    s.code        AS state_code,
    -- Country
    co.id         AS country_id,
    co.name       AS country_name,
    co.code       AS country_code,
    co.flag_emoji AS country_flag
FROM public.places p
LEFT JOIN public.cities    c  ON c.id  = p.city_id
LEFT JOIN public.districts d  ON d.id  = c.district_id
LEFT JOIN public.states    s  ON s.id  = d.state_id
LEFT JOIN public.countries co ON co.id = s.country_id;

-- ============================================================================
-- STEP 13: VIEW — v_user_stats (expanded)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_user_stats AS
SELECT
    pr.id AS user_id,

    -- Places visited
    COALESCE((SELECT COUNT(*) FROM public.visited_places v
              WHERE v.user_id = pr.id AND v.place_id IS NOT NULL), 0)
        AS visited_count,

    -- Countries explored
    COALESCE((SELECT COUNT(DISTINCT co.id)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              LEFT JOIN public.cities    c  ON c.id  = pl.city_id
              LEFT JOIN public.districts d  ON d.id  = c.district_id
              LEFT JOIN public.states    s  ON s.id  = d.state_id
              LEFT JOIN public.countries co ON co.id = s.country_id
              WHERE v.user_id = pr.id AND co.id IS NOT NULL), 0)
        AS countries_explored,

    -- States explored
    COALESCE((SELECT COUNT(DISTINCT s.id)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              LEFT JOIN public.cities    c  ON c.id  = pl.city_id
              LEFT JOIN public.districts d  ON d.id  = c.district_id
              LEFT JOIN public.states    s  ON s.id  = d.state_id
              WHERE v.user_id = pr.id AND s.id IS NOT NULL), 0)
        AS states_explored,

    -- Districts explored
    COALESCE((SELECT COUNT(DISTINCT d.id)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              LEFT JOIN public.cities    c  ON c.id  = pl.city_id
              LEFT JOIN public.districts d  ON d.id  = c.district_id
              WHERE v.user_id = pr.id AND d.id IS NOT NULL), 0)
        AS districts_explored,

    -- Cities explored
    COALESCE((SELECT COUNT(DISTINCT c.id)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              LEFT JOIN public.cities c ON c.id = pl.city_id
              WHERE v.user_id = pr.id AND c.id IS NOT NULL), 0)
        AS cities_explored,

    -- Wishlist count
    COALESCE((SELECT COUNT(*) FROM public.wishlist w
              WHERE w.user_id = pr.id), 0)
        AS wishlist_count,

    -- Photo count
    COALESCE((SELECT COUNT(*) FROM public.media m
              WHERE m.user_id = pr.id AND m.type = 'image'), 0)
        AS photo_count,

    -- Video count
    COALESCE((SELECT COUNT(*) FROM public.media m
              WHERE m.user_id = pr.id AND m.type = 'video'), 0)
        AS video_count,

    -- Memory count
    COALESCE((SELECT COUNT(*) FROM public.memories mem
              WHERE mem.user_id = pr.id), 0)
        AS memory_count,

    -- Custom places count
    COALESCE((SELECT COUNT(*) FROM public.custom_places cp
              WHERE cp.user_id = pr.id), 0)
        AS custom_places_count

FROM public.profiles pr;

-- ============================================================================
-- STEP 14: ROW LEVEL SECURITY
-- ============================================================================

-- Geographic tables: public read
ALTER TABLE public.countries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.states     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.districts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "geo_select_auth" ON public.countries  FOR SELECT TO authenticated USING (true);
CREATE POLICY "geo_select_anon" ON public.countries  FOR SELECT TO anon           USING (true);
CREATE POLICY "geo_select_auth" ON public.states     FOR SELECT TO authenticated USING (true);
CREATE POLICY "geo_select_anon" ON public.states     FOR SELECT TO anon           USING (true);
CREATE POLICY "geo_select_auth" ON public.districts  FOR SELECT TO authenticated USING (true);
CREATE POLICY "geo_select_anon" ON public.districts  FOR SELECT TO anon           USING (true);
CREATE POLICY "geo_select_auth" ON public.cities     FOR SELECT TO authenticated USING (true);
CREATE POLICY "geo_select_anon" ON public.cities     FOR SELECT TO anon           USING (true);

-- Places: public read
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "places_select_auth" ON public.places FOR SELECT TO authenticated USING (true);
CREATE POLICY "places_select_anon" ON public.places FOR SELECT TO anon           USING (true);

-- Custom places: owner only
ALTER TABLE public.custom_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cp_select" ON public.custom_places FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cp_insert" ON public.custom_places FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cp_update" ON public.custom_places FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cp_delete" ON public.custom_places FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Visited places
ALTER TABLE public.visited_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vp_select" ON public.visited_places FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "vp_insert" ON public.visited_places FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "vp_update" ON public.visited_places FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "vp_delete" ON public.visited_places FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Wishlist
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wl_select" ON public.wishlist FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wl_insert" ON public.wishlist FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "wl_update" ON public.wishlist FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wl_delete" ON public.wishlist FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Memories
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mem_select" ON public.memories FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "mem_insert" ON public.memories FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "mem_update" ON public.memories FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "mem_delete" ON public.memories FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Media
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "med_select" ON public.media FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "med_insert" ON public.media FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "med_update" ON public.media FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "med_delete" ON public.media FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- STEP 15: TEMPORARY IMPORT POLICIES
-- Allow service-role and anon INSERT for OSM import
-- DROP THESE after import is complete!
-- ============================================================================

CREATE POLICY "import_countries_anon" ON public.countries  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "import_states_anon"    ON public.states     FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "import_districts_anon" ON public.districts  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "import_cities_anon"    ON public.cities     FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "import_places_anon"    ON public.places     FOR INSERT TO anon WITH CHECK (true);

-- Also allow UPDATE for image enrichment during import
CREATE POLICY "import_places_update_anon" ON public.places FOR UPDATE TO anon USING (true);

-- ============================================================================
-- STEP 16: SEED — India + States + Union Territories
-- ============================================================================

INSERT INTO public.countries (name, code, flag_emoji) VALUES
    ('India', 'IN', '🇮🇳')
ON CONFLICT (name) DO NOTHING;

-- Get the India ID for FK references
DO $$
DECLARE
    india_id uuid;
BEGIN
    SELECT id INTO india_id FROM public.countries WHERE name = 'India';

    -- 28 States
    INSERT INTO public.states (name, country_id, code) VALUES
        ('Andhra Pradesh',    india_id, 'AP'),
        ('Arunachal Pradesh', india_id, 'AR'),
        ('Assam',             india_id, 'AS'),
        ('Bihar',             india_id, 'BR'),
        ('Chhattisgarh',      india_id, 'CG'),
        ('Goa',               india_id, 'GA'),
        ('Gujarat',           india_id, 'GJ'),
        ('Haryana',           india_id, 'HR'),
        ('Himachal Pradesh',  india_id, 'HP'),
        ('Jharkhand',         india_id, 'JH'),
        ('Karnataka',         india_id, 'KA'),
        ('Kerala',            india_id, 'KL'),
        ('Madhya Pradesh',    india_id, 'MP'),
        ('Maharashtra',       india_id, 'MH'),
        ('Manipur',           india_id, 'MN'),
        ('Meghalaya',         india_id, 'ML'),
        ('Mizoram',           india_id, 'MZ'),
        ('Nagaland',          india_id, 'NL'),
        ('Odisha',            india_id, 'OD'),
        ('Punjab',            india_id, 'PB'),
        ('Rajasthan',         india_id, 'RJ'),
        ('Sikkim',            india_id, 'SK'),
        ('Tamil Nadu',        india_id, 'TN'),
        ('Telangana',         india_id, 'TG'),
        ('Tripura',           india_id, 'TR'),
        ('Uttar Pradesh',     india_id, 'UP'),
        ('Uttarakhand',       india_id, 'UK'),
        ('West Bengal',       india_id, 'WB')
    ON CONFLICT (name, country_id) DO NOTHING;

    -- 8 Union Territories
    INSERT INTO public.states (name, country_id, code) VALUES
        ('Andaman and Nicobar Islands',       india_id, 'AN'),
        ('Chandigarh',                        india_id, 'CH'),
        ('Dadra and Nagar Haveli and Daman and Diu', india_id, 'DD'),
        ('Delhi',                             india_id, 'DL'),
        ('Jammu and Kashmir',                 india_id, 'JK'),
        ('Ladakh',                            india_id, 'LA'),
        ('Lakshadweep',                       india_id, 'LD'),
        ('Puducherry',                        india_id, 'PY')
    ON CONFLICT (name, country_id) DO NOTHING;
END $$;

-- ============================================================================
-- DONE — Verify
-- ============================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT * FROM public.countries;
-- SELECT * FROM public.states ORDER BY name;
-- SELECT count(*) FROM public.states;  -- Should be 36
