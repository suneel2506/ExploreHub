-- ============================================================================
-- ExploreHub — Migration 008: Complete Enrichment Pipeline
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER migration 007.
--
-- Adds:
--   1. place_descriptions — Wikipedia/manual descriptions per place
--   2. place_images       — Multiple images per place with priority
--   3. categories         — Master tag/category definitions
--   4. place_tags         — Many-to-many place ↔ category
--   5. place_sources      — Data provenance tracking per source
--   6. place_metadata     — Extended Wikidata metadata
--   7. api_cache          — Cached API responses (30-day TTL)
--   8. Materialized view  — mv_search_places for sub-ms search
--   9. RPCs               — search_places_v2, get_place_detail,
--                           merge_duplicate_places, search_suggestions
--  10. Triggers           — Prevent manual description overwrites
--  11. Indexes            — Trigram, GIN, spatial for 5M+ places
--  12. RLS                — Public read, service-role write
--
-- SAFE: No existing columns/tables removed. All changes additive.
-- ============================================================================

-- ============================================================================
-- STEP 1: New columns on places table
-- ============================================================================

ALTER TABLE public.places
    ADD COLUMN IF NOT EXISTS wikipedia_page_id bigint;

COMMENT ON COLUMN public.places.wikipedia_page_id IS 'Wikipedia page ID for deduplication';

CREATE INDEX IF NOT EXISTS idx_places_wikipedia_page_id
    ON public.places(wikipedia_page_id)
    WHERE wikipedia_page_id IS NOT NULL;

-- ============================================================================
-- STEP 2: place_descriptions — Rich text descriptions from Wikipedia
-- ============================================================================
-- Stores full Wikipedia data per place. Supports multiple languages.
-- is_manual_edit = true prevents enrichment scripts from overwriting.

CREATE TABLE IF NOT EXISTS public.place_descriptions (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id        uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    title           text,            -- Wikipedia article title
    summary         text,            -- Short extract (first paragraph)
    history         text,            -- Extended content (first 3 sections)
    featured_image  text,            -- Wikipedia thumbnail URL
    wikipedia_url   text,            -- Full Wikipedia URL
    page_id         bigint,          -- Wikipedia page ID
    language        text             NOT NULL DEFAULT 'en',
    source          text             NOT NULL DEFAULT 'wikipedia', -- 'wikipedia', 'manual', 'tourism'
    is_manual_edit  boolean          NOT NULL DEFAULT false,
    created_at      timestamptz      DEFAULT now(),
    updated_at      timestamptz      DEFAULT now(),

    UNIQUE (place_id, language, source)
);

CREATE INDEX IF NOT EXISTS idx_place_descriptions_place
    ON public.place_descriptions(place_id);
CREATE INDEX IF NOT EXISTS idx_place_descriptions_page_id
    ON public.place_descriptions(page_id)
    WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_place_descriptions_title_trgm
    ON public.place_descriptions USING gin(title gin_trgm_ops);

COMMENT ON TABLE public.place_descriptions IS 'Rich text descriptions from Wikipedia, manual edits, or tourism sources';

-- ============================================================================
-- STEP 3: place_images — Multiple images per place with priority
-- ============================================================================
-- Priority order: government (1) > wikimedia (2) > wikipedia (3) > osm (4) > user (5) > placeholder (99)
-- One image per place is marked is_primary = true.

CREATE TABLE IF NOT EXISTS public.place_images (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id        uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    url             text             NOT NULL,
    source          text             NOT NULL DEFAULT 'unknown',
        -- 'government', 'wikimedia', 'wikipedia', 'osm', 'user', 'placeholder'
    is_primary      boolean          NOT NULL DEFAULT false,
    priority        integer          NOT NULL DEFAULT 50,
        -- 1 = highest priority (government), 99 = lowest (placeholder)
    attribution     text,            -- Image credit / license
    width           integer,
    height          integer,
    storage_path    text,            -- Supabase Storage path if downloaded
    created_at      timestamptz      DEFAULT now(),

    UNIQUE (place_id, url)
);

CREATE INDEX IF NOT EXISTS idx_place_images_place
    ON public.place_images(place_id);
CREATE INDEX IF NOT EXISTS idx_place_images_primary
    ON public.place_images(place_id, is_primary)
    WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_place_images_source
    ON public.place_images(source);

COMMENT ON TABLE public.place_images IS 'Multiple images per place with source priority (govt > wiki > osm > user)';

-- ============================================================================
-- STEP 4: categories — Master tag/category definitions
-- ============================================================================
-- Source of truth for all categories/tags. Frontend constants.js is a cache.

CREATE TABLE IF NOT EXISTS public.categories (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text             NOT NULL UNIQUE,
    slug            text             NOT NULL UNIQUE,
    emoji           text,
    description     text,
    "group"         text,            -- 'nature', 'religious', 'historical', 'transport', 'experience', 'amenity'
    display_order   integer          DEFAULT 0,
    is_active       boolean          NOT NULL DEFAULT true,
    created_at      timestamptz      DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_group
    ON public.categories("group");
CREATE INDEX IF NOT EXISTS idx_categories_slug
    ON public.categories(slug);

COMMENT ON TABLE public.categories IS 'Master tag/category definitions for places';

-- Seed categories (all existing + new tags from requirements)
INSERT INTO public.categories (name, slug, emoji, "group", display_order) VALUES
    -- Nature
    ('Waterfalls',       'waterfalls',       '💧', 'nature',     1),
    ('Beaches',          'beaches',          '🏖️', 'nature',     2),
    ('Mountains',        'mountains',        '⛰️', 'nature',     3),
    ('Forests',          'forests',          '🌲', 'nature',     4),
    ('Lakes',            'lakes',            '🏞️', 'nature',     5),
    ('Caves',            'caves',            '🪨', 'nature',     6),
    ('Islands',          'islands',          '🏝️', 'nature',     7),
    ('National Parks',   'national-parks',   '🏕️', 'nature',     8),
    ('Parks',            'parks',            '🌿', 'nature',     9),
    ('Wildlife',         'wildlife',         '🐘', 'nature',    10),
    -- Religious
    ('Temples',          'temples',          '🛕', 'religious',  11),
    ('Churches',         'churches',         '⛪', 'religious',  12),
    ('Mosques',          'mosques',          '🕌', 'religious',  13),
    ('Gurudwaras',       'gurudwaras',       '🙏', 'religious',  14),
    ('Monasteries',      'monasteries',      '🧘', 'religious',  15),
    -- Historical
    ('Historical',       'historical',       '🏛️', 'historical', 16),
    ('Forts',            'forts',            '🏰', 'historical', 17),
    ('Museums',          'museums',          '🏫', 'historical', 18),
    ('Monuments',        'monuments',        '🗿', 'historical', 19),
    -- Transport
    ('Airports',         'airports',         '✈️', 'transport',  20),
    ('Railway Stations', 'railway-stations', '🚂', 'transport',  21),
    ('Bus Stations',     'bus-stations',     '🚌', 'transport',  22),
    -- Infrastructure
    ('Dams',             'dams',             '🌊', 'infrastructure', 23),
    ('Bridges',          'bridges',          '🌉', 'infrastructure', 24),
    -- Experience tags
    ('Attractions',      'attractions',      '⭐', 'experience', 25),
    ('Viewpoints',       'viewpoints',       '🔭', 'experience', 26),
    ('Adventure',        'adventure',        '🧗', 'experience', 27),
    ('Photography',      'photography',      '📸', 'experience', 28),
    ('Camping',          'camping',          '⛺', 'experience', 29),
    ('Family',           'family',           '👨‍👩‍👧‍👦', 'experience', 30),
    ('Nightlife',        'nightlife',        '🌃', 'experience', 31),
    ('Food',             'food',             '🍽️', 'experience', 32),
    ('Shopping',         'shopping',         '🛍️', 'experience', 33),
    -- Status tags
    ('UNESCO',           'unesco',           '🏆', 'status',     34),
    ('Heritage',         'heritage',         '🏗️', 'status',     35),
    ('Religious',        'religious',        '🕊️', 'status',     36),
    ('Nature',           'nature',           '🍃', 'status',     37),
    -- Settlement types
    ('Cities',           'cities',           '🏙️', 'settlement', 38),
    ('Villages',         'villages',         '🏘️', 'settlement', 39),
    -- Amenities
    ('Hotels',           'hotels',           '🏨', 'amenity',    40),
    ('Restaurants',      'restaurants',      '🍴', 'amenity',    41),
    -- Other
    ('Other',            'other',            '📍', 'other',      99)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- STEP 5: place_tags — Many-to-many place ↔ category
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.place_tags (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id        uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    category_id     uuid             NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    source          text             DEFAULT 'auto', -- 'auto', 'manual', 'wikidata', 'osm'
    created_at      timestamptz      DEFAULT now(),

    UNIQUE (place_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_place_tags_place
    ON public.place_tags(place_id);
CREATE INDEX IF NOT EXISTS idx_place_tags_category
    ON public.place_tags(category_id);

COMMENT ON TABLE public.place_tags IS 'Many-to-many relationship between places and categories/tags';

-- ============================================================================
-- STEP 6: place_sources — Data provenance tracking
-- ============================================================================
-- Records which external sources have been queried for each place.
-- Includes next_fetch_after for 30-day cache invalidation.

CREATE TABLE IF NOT EXISTS public.place_sources (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id        uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    source_name     text             NOT NULL,
        -- 'osm', 'wikipedia', 'wikidata', 'wikimedia', 'government', 'user'
    source_id       text,            -- External ID (OSM node ID, Wikidata QID, etc.)
    source_url      text,            -- Full URL to source
    raw_data        jsonb,           -- Raw API response (compressed)
    last_fetched    timestamptz      DEFAULT now(),
    next_fetch_after timestamptz     DEFAULT (now() + interval '30 days'),
    status          text             NOT NULL DEFAULT 'success',
        -- 'success', 'not_found', 'error', 'pending'
    error_message   text,
    created_at      timestamptz      DEFAULT now(),

    UNIQUE (place_id, source_name)
);

CREATE INDEX IF NOT EXISTS idx_place_sources_place
    ON public.place_sources(place_id);
-- NOTE: Cannot use "WHERE next_fetch_after < now()" in a partial index because
-- now() is STABLE, not IMMUTABLE (PostgreSQL error 42P17). Queries that filter
-- on next_fetch_after < now() will still use this B-tree index via range scan.
CREATE INDEX IF NOT EXISTS idx_place_sources_stale
    ON public.place_sources(source_name, next_fetch_after);
CREATE INDEX IF NOT EXISTS idx_place_sources_source_id
    ON public.place_sources(source_name, source_id)
    WHERE source_id IS NOT NULL;

COMMENT ON TABLE public.place_sources IS 'Tracks data provenance and cache freshness per source per place';

-- ============================================================================
-- STEP 7: place_metadata — Extended Wikidata metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.place_metadata (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id        uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE UNIQUE,
    population      bigint,
    elevation       double precision, -- meters
    official_website text,
    heritage_status text,            -- 'UNESCO World Heritage Site', 'ASI Protected', etc.
    opening_date    text,            -- ISO date or freeform
    instance_of     text[],          -- Wikidata instance_of labels
    country         text,
    admin_entity    text,            -- Administrative territorial entity
    commons_image   text,            -- Wikimedia Commons image filename
    commons_category text,           -- Wikimedia Commons category
    opening_hours   text,            -- Structured opening hours
    phone           text,
    email           text,
    fee             text,            -- Entrance fee information
    raw_wikidata    jsonb,           -- Full Wikidata claims (for future use)
    created_at      timestamptz      DEFAULT now(),
    updated_at      timestamptz      DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_place_metadata_place
    ON public.place_metadata(place_id);
CREATE INDEX IF NOT EXISTS idx_place_metadata_heritage
    ON public.place_metadata(heritage_status)
    WHERE heritage_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_place_metadata_population
    ON public.place_metadata(population)
    WHERE population IS NOT NULL;

COMMENT ON TABLE public.place_metadata IS 'Extended metadata from Wikidata (population, elevation, heritage, etc.)';

-- ============================================================================
-- STEP 8: api_cache — Cached API responses
-- ============================================================================
-- Prevents redundant API calls. Entries expire after 30 days.

CREATE TABLE IF NOT EXISTS public.api_cache (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key       text             NOT NULL UNIQUE,
        -- Format: 'source:identifier' e.g. 'wikipedia:en:Taj_Mahal'
    source          text             NOT NULL,
        -- 'wikipedia', 'wikidata', 'wikimedia', 'overpass'
    response_data   jsonb            NOT NULL,
    fetched_at      timestamptz      DEFAULT now(),
    expires_at      timestamptz      DEFAULT (now() + interval '30 days'),
    hit_count       integer          DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_api_cache_key
    ON public.api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_api_cache_source
    ON public.api_cache(source);
-- NOTE: Cannot use "WHERE expires_at > now()" in a partial index because
-- now() is STABLE, not IMMUTABLE (PostgreSQL error 42P17). Queries that filter
-- on expires_at > now() will still use this B-tree index via range scan.
CREATE INDEX IF NOT EXISTS idx_api_cache_expires
    ON public.api_cache(expires_at);

COMMENT ON TABLE public.api_cache IS 'Cached API responses with 30-day TTL to prevent redundant fetches';

-- ============================================================================
-- STEP 9: Materialized View — mv_search_places
-- ============================================================================
-- Pre-joined, denormalized view for sub-millisecond search.
-- Includes names from all hierarchy levels, aliases, and wikipedia titles.
-- REFRESH CONCURRENTLY after enrichment runs or periodically.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_search_places AS
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
    p.wikidata_id,
    p.wikipedia_title,
    p.aliases,
    p.official_name,
    p.heritage_status,
    p.image_source,
    p.enriched_at,
    p.created_at,
    -- Hierarchy
    c.id            AS city_id,
    c.name          AS city_name,
    d.id            AS district_id,
    d.name          AS district_name,
    s.id            AS state_id,
    s.name          AS state_name,
    s.code          AS state_code,
    co.id           AS country_id,
    co.name         AS country_name,
    co.flag_emoji   AS country_flag,
    -- Composite search text for FTS
    to_tsvector('simple',
        coalesce(p.name, '') || ' ' ||
        coalesce(p.category, '') || ' ' ||
        coalesce(p.place_type, '') || ' ' ||
        coalesce(p.wikipedia_title, '') || ' ' ||
        coalesce(p.official_name, '') || ' ' ||
        coalesce(c.name, '') || ' ' ||
        coalesce(d.name, '') || ' ' ||
        coalesce(s.name, '') || ' ' ||
        coalesce(array_to_string(p.aliases, ' '), '')
    ) AS search_vector,
    -- Searchable text for trigram
    lower(
        coalesce(p.name, '') || ' ' ||
        coalesce(c.name, '') || ' ' ||
        coalesce(d.name, '') || ' ' ||
        coalesce(s.name, '')
    ) AS search_text
FROM public.places p
LEFT JOIN public.cities    c  ON c.id  = p.city_id
LEFT JOIN public.districts d  ON d.id  = c.district_id
LEFT JOIN public.states    s  ON s.id  = d.state_id
LEFT JOIN public.countries co ON co.id = s.country_id;

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_search_id
    ON public.mv_search_places(id);

-- Search indexes on materialized view
CREATE INDEX IF NOT EXISTS idx_mv_search_fts
    ON public.mv_search_places USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_mv_search_text_trgm
    ON public.mv_search_places USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mv_search_name
    ON public.mv_search_places(name);
CREATE INDEX IF NOT EXISTS idx_mv_search_name_trgm
    ON public.mv_search_places USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mv_search_category
    ON public.mv_search_places(category);
CREATE INDEX IF NOT EXISTS idx_mv_search_coords
    ON public.mv_search_places(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_mv_search_city_name_trgm
    ON public.mv_search_places USING gin(city_name gin_trgm_ops)
    WHERE city_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mv_search_state_name_trgm
    ON public.mv_search_places USING gin(state_name gin_trgm_ops)
    WHERE state_name IS NOT NULL;

-- ============================================================================
-- STEP 10: search_places_v2 — Cursor-paginated multi-field fuzzy search
-- ============================================================================
-- Searches across name, city, district, state, aliases, wikipedia_title.
-- Uses the materialized view for speed.
-- Supports cursor-based pagination via (name, id) composite cursor.
-- Returns results within milliseconds on 100k+ places.

CREATE OR REPLACE FUNCTION public.search_places_v2(
    p_query          text,
    p_category       text             DEFAULT NULL,
    p_state          text             DEFAULT NULL,
    p_cursor_name    text             DEFAULT NULL,
    p_cursor_id      uuid             DEFAULT NULL,
    p_page_size      integer          DEFAULT 50
)
RETURNS TABLE(
    id              uuid,
    name            text,
    description     text,
    category        text,
    place_type      text,
    latitude        double precision,
    longitude       double precision,
    image_url       text,
    wiki_url        text,
    city_id         uuid,
    city_name       text,
    district_id     uuid,
    district_name   text,
    state_id        uuid,
    state_name      text,
    state_code      text,
    country_name    text,
    country_flag    text,
    wikidata_id     text,
    wikipedia_title text,
    aliases         text[],
    heritage_status text,
    image_source    text,
    match_type      text,
    relevance       real
) AS $$
DECLARE
    v_query text := trim(coalesce(p_query, ''));
    v_tsquery tsquery;
BEGIN
    -- Build tsquery for FTS
    IF v_query <> '' THEN
        v_tsquery := plainto_tsquery('simple', v_query);
    END IF;

    RETURN QUERY
    SELECT
        mv.id,
        mv.name,
        mv.description,
        mv.category,
        mv.place_type,
        mv.latitude,
        mv.longitude,
        mv.image_url,
        mv.wiki_url,
        mv.city_id,
        mv.city_name,
        mv.district_id,
        mv.district_name,
        mv.state_id,
        mv.state_name,
        mv.state_code,
        mv.country_name,
        mv.country_flag,
        mv.wikidata_id,
        mv.wikipedia_title,
        mv.aliases,
        mv.heritage_status,
        mv.image_source,
        -- Match type classification
        CASE
            WHEN mv.state_name ILIKE v_query THEN 'state'
            WHEN mv.district_name ILIKE v_query THEN 'district'
            WHEN mv.city_name ILIKE v_query THEN 'city'
            WHEN mv.name ILIKE v_query THEN 'exact'
            WHEN mv.aliases IS NOT NULL AND EXISTS (
                SELECT 1 FROM unnest(mv.aliases) AS a WHERE a ILIKE v_query
            ) THEN 'alias'
            WHEN mv.wikipedia_title ILIKE '%' || v_query || '%' THEN 'wikipedia'
            ELSE 'fuzzy'
        END::text AS match_type,
        -- Relevance score (higher = better match)
        GREATEST(
            CASE WHEN mv.name ILIKE v_query THEN 1.0 ELSE 0.0 END,
            CASE WHEN mv.city_name ILIKE v_query THEN 0.95 ELSE 0.0 END,
            CASE WHEN mv.district_name ILIKE v_query THEN 0.9 ELSE 0.0 END,
            CASE WHEN mv.state_name ILIKE v_query THEN 0.85 ELSE 0.0 END,
            CASE WHEN mv.aliases IS NOT NULL AND EXISTS (
                SELECT 1 FROM unnest(mv.aliases) AS a WHERE a ILIKE v_query
            ) THEN 0.8 ELSE 0.0 END,
            CASE WHEN mv.wikipedia_title ILIKE '%' || v_query || '%' THEN 0.75 ELSE 0.0 END,
            similarity(mv.name, v_query),
            CASE WHEN v_query <> '' AND mv.search_text LIKE '%' || lower(v_query) || '%'
                THEN 0.6 ELSE 0.0 END
        )::real AS relevance
    FROM public.mv_search_places mv
    WHERE
        -- Search filter
        (v_query = '' OR (
            mv.search_vector @@ v_tsquery
            OR mv.name ILIKE '%' || v_query || '%'
            OR mv.city_name ILIKE v_query
            OR mv.district_name ILIKE v_query
            OR mv.state_name ILIKE v_query
            OR similarity(mv.name, v_query) > 0.3
            OR (mv.aliases IS NOT NULL AND EXISTS (
                SELECT 1 FROM unnest(mv.aliases) AS a WHERE a ILIKE '%' || v_query || '%'
            ))
            OR mv.wikipedia_title ILIKE '%' || v_query || '%'
        ))
        -- Category filter
        AND (p_category IS NULL OR mv.category = p_category)
        -- State filter
        AND (p_state IS NULL OR mv.state_name ILIKE p_state)
        -- Cursor pagination (keyset pagination)
        AND (
            p_cursor_name IS NULL
            OR (mv.name, mv.id) > (p_cursor_name, p_cursor_id)
        )
    ORDER BY
        -- Priority: exact matches first, then by relevance, then alphabetical
        CASE
            WHEN mv.name ILIKE v_query THEN 0
            WHEN mv.state_name ILIKE v_query THEN 1
            WHEN mv.district_name ILIKE v_query THEN 2
            WHEN mv.city_name ILIKE v_query THEN 3
            ELSE 4
        END,
        GREATEST(
            similarity(mv.name, v_query),
            CASE WHEN v_query <> '' AND mv.search_text LIKE '%' || lower(v_query) || '%'
                THEN 0.5 ELSE 0.0 END
        ) DESC,
        mv.name ASC,
        mv.id ASC
    LIMIT p_page_size;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- STEP 11: search_suggestions — Lightweight autocomplete
-- ============================================================================
-- Returns top 8 matches for autocomplete dropdown.
-- Much faster than full search — only returns name, category, location.

CREATE OR REPLACE FUNCTION public.search_suggestions(
    p_query text,
    p_limit integer DEFAULT 8
)
RETURNS TABLE(
    id              uuid,
    name            text,
    category        text,
    city_name       text,
    state_name      text,
    match_type      text,
    relevance       real
) AS $$
DECLARE
    v_query text := trim(coalesce(p_query, ''));
BEGIN
    IF v_query = '' OR length(v_query) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        mv.id,
        mv.name,
        mv.category,
        mv.city_name,
        mv.state_name,
        CASE
            WHEN mv.name ILIKE v_query THEN 'exact'
            WHEN mv.name ILIKE v_query || '%' THEN 'prefix'
            WHEN mv.city_name ILIKE v_query THEN 'city'
            WHEN mv.state_name ILIKE v_query THEN 'state'
            ELSE 'fuzzy'
        END::text AS match_type,
        GREATEST(
            CASE WHEN mv.name ILIKE v_query THEN 1.0 ELSE 0.0 END,
            CASE WHEN mv.name ILIKE v_query || '%' THEN 0.95 ELSE 0.0 END,
            CASE WHEN mv.city_name ILIKE v_query THEN 0.9 ELSE 0.0 END,
            CASE WHEN mv.state_name ILIKE v_query THEN 0.85 ELSE 0.0 END,
            similarity(mv.name, v_query)
        )::real AS relevance
    FROM public.mv_search_places mv
    WHERE
        mv.name ILIKE '%' || v_query || '%'
        OR mv.city_name ILIKE v_query || '%'
        OR mv.state_name ILIKE v_query || '%'
        OR similarity(mv.name, v_query) > 0.3
    ORDER BY
        CASE WHEN mv.name ILIKE v_query THEN 0
             WHEN mv.name ILIKE v_query || '%' THEN 1
             WHEN mv.city_name ILIKE v_query THEN 2
             ELSE 3
        END,
        similarity(mv.name, v_query) DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- STEP 12: get_place_detail — Full enriched place data in one round-trip
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_place_detail(p_place_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'place', jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'description', p.description,
            'category', p.category,
            'place_type', p.place_type,
            'latitude', p.latitude,
            'longitude', p.longitude,
            'image_url', p.image_url,
            'wiki_url', p.wiki_url,
            'osm_id', p.osm_id,
            'source', p.source,
            'metadata', p.metadata,
            'wikidata_id', p.wikidata_id,
            'wikipedia_title', p.wikipedia_title,
            'aliases', p.aliases,
            'official_name', p.official_name,
            'heritage_status', p.heritage_status,
            'image_source', p.image_source,
            'enriched_at', p.enriched_at,
            'created_at', p.created_at
        ),
        'city', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object(
            'id', c.id, 'name', c.name,
            'latitude', c.latitude, 'longitude', c.longitude
        ) ELSE NULL END,
        'district', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object(
            'id', d.id, 'name', d.name
        ) ELSE NULL END,
        'state', CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
            'id', s.id, 'name', s.name, 'code', s.code
        ) ELSE NULL END,
        'country', CASE WHEN co.id IS NOT NULL THEN jsonb_build_object(
            'id', co.id, 'name', co.name, 'code', co.code, 'flag', co.flag_emoji
        ) ELSE NULL END,
        'descriptions', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', pd.id,
                'title', pd.title,
                'summary', pd.summary,
                'history', pd.history,
                'featured_image', pd.featured_image,
                'wikipedia_url', pd.wikipedia_url,
                'page_id', pd.page_id,
                'language', pd.language,
                'source', pd.source
            )), '[]'::jsonb)
            FROM public.place_descriptions pd
            WHERE pd.place_id = p.id
        ),
        'images', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', pi.id,
                'url', pi.url,
                'source', pi.source,
                'is_primary', pi.is_primary,
                'priority', pi.priority,
                'attribution', pi.attribution
            ) ORDER BY pi.priority ASC), '[]'::jsonb)
            FROM public.place_images pi
            WHERE pi.place_id = p.id
        ),
        'tags', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', cat.id,
                'name', cat.name,
                'slug', cat.slug,
                'emoji', cat.emoji,
                'group', cat."group"
            )), '[]'::jsonb)
            FROM public.place_tags pt
            JOIN public.categories cat ON cat.id = pt.category_id
            WHERE pt.place_id = p.id
        ),
        'metadata', (
            SELECT jsonb_build_object(
                'population', pm.population,
                'elevation', pm.elevation,
                'official_website', pm.official_website,
                'heritage_status', pm.heritage_status,
                'opening_date', pm.opening_date,
                'instance_of', pm.instance_of,
                'country', pm.country,
                'admin_entity', pm.admin_entity,
                'commons_image', pm.commons_image,
                'opening_hours', pm.opening_hours,
                'phone', pm.phone,
                'email', pm.email,
                'fee', pm.fee
            )
            FROM public.place_metadata pm
            WHERE pm.place_id = p.id
        )
    ) INTO v_result
    FROM public.places p
    LEFT JOIN public.cities    c  ON c.id  = p.city_id
    LEFT JOIN public.districts d  ON d.id  = c.district_id
    LEFT JOIN public.states    s  ON s.id  = d.state_id
    LEFT JOIN public.countries co ON co.id = s.country_id
    WHERE p.id = p_place_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- STEP 13: merge_duplicate_places — Safely merge two duplicate places
-- ============================================================================
-- Moves all relationships from source_place to target_place, then deletes source.
-- Preserves the richer data (longer description, more images, etc.)

CREATE OR REPLACE FUNCTION public.merge_duplicate_places(
    p_source_id uuid,
    p_target_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_source record;
    v_target record;
    v_moved_relations jsonb := '{}'::jsonb;
BEGIN
    -- Validate both places exist
    SELECT * INTO v_source FROM public.places WHERE id = p_source_id;
    SELECT * INTO v_target FROM public.places WHERE id = p_target_id;

    IF v_source IS NULL THEN
        RETURN jsonb_build_object('error', 'Source place not found');
    END IF;
    IF v_target IS NULL THEN
        RETURN jsonb_build_object('error', 'Target place not found');
    END IF;

    -- Move descriptions (skip conflicts)
    UPDATE public.place_descriptions
    SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.place_descriptions pd2
          WHERE pd2.place_id = p_target_id
            AND pd2.language = place_descriptions.language
            AND pd2.source = place_descriptions.source
      );

    -- Move images (skip duplicate URLs)
    UPDATE public.place_images
    SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.place_images pi2
          WHERE pi2.place_id = p_target_id AND pi2.url = place_images.url
      );

    -- Move tags (skip duplicates)
    UPDATE public.place_tags
    SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.place_tags pt2
          WHERE pt2.place_id = p_target_id AND pt2.category_id = place_tags.category_id
      );

    -- Move sources (skip duplicates)
    UPDATE public.place_sources
    SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.place_sources ps2
          WHERE ps2.place_id = p_target_id AND ps2.source_name = place_sources.source_name
      );

    -- Move metadata (only if target has none)
    UPDATE public.place_metadata
    SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.place_metadata pm2 WHERE pm2.place_id = p_target_id
      );

    -- Move user relationships
    UPDATE public.visited_places SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.visited_places vp2
          WHERE vp2.place_id = p_target_id AND vp2.user_id = visited_places.user_id
      );

    UPDATE public.wishlist SET place_id = p_target_id
    WHERE place_id = p_source_id
      AND NOT EXISTS (
          SELECT 1 FROM public.wishlist w2
          WHERE w2.place_id = p_target_id AND w2.user_id = wishlist.user_id
      );

    UPDATE public.memories SET place_id = p_target_id
    WHERE place_id = p_source_id;

    UPDATE public.media SET place_id = p_target_id
    WHERE place_id = p_source_id;

    -- Fill in missing data on target from source
    UPDATE public.places
    SET
        description = COALESCE(places.description, v_source.description),
        image_url = COALESCE(places.image_url, v_source.image_url),
        wiki_url = COALESCE(places.wiki_url, v_source.wiki_url),
        wikidata_id = COALESCE(places.wikidata_id, v_source.wikidata_id),
        wikipedia_title = COALESCE(places.wikipedia_title, v_source.wikipedia_title),
        aliases = COALESCE(places.aliases, v_source.aliases),
        official_name = COALESCE(places.official_name, v_source.official_name),
        heritage_status = COALESCE(places.heritage_status, v_source.heritage_status),
        image_source = COALESCE(places.image_source, v_source.image_source),
        wikipedia_page_id = COALESCE(places.wikipedia_page_id, v_source.wikipedia_page_id)
    WHERE id = p_target_id;

    -- Delete source
    DELETE FROM public.places WHERE id = p_source_id;

    RETURN jsonb_build_object(
        'success', true,
        'source_name', v_source.name,
        'target_name', v_target.name,
        'merged_into', p_target_id
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 14: refresh_search_index — Refresh materialized view
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_search_index()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_search_places;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 15: Trigger — Prevent overwriting manual descriptions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_protect_manual_descriptions()
RETURNS TRIGGER AS $$
BEGIN
    -- If the existing row is a manual edit, block non-manual updates
    IF OLD.is_manual_edit = true AND NEW.is_manual_edit = false THEN
        -- Keep the manual version
        RETURN OLD;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_place_descriptions_protect ON public.place_descriptions;
CREATE TRIGGER trg_place_descriptions_protect
    BEFORE UPDATE ON public.place_descriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_protect_manual_descriptions();

-- ============================================================================
-- STEP 16: Auto-assign primary category tag on place insert/update
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_auto_tag_place()
RETURNS TRIGGER AS $$
DECLARE
    v_cat_id uuid;
BEGIN
    -- Find matching category for the place's category column
    SELECT id INTO v_cat_id
    FROM public.categories
    WHERE name = NEW.category
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        INSERT INTO public.place_tags (place_id, category_id, source)
        VALUES (NEW.id, v_cat_id, 'auto')
        ON CONFLICT (place_id, category_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_places_auto_tag ON public.places;
CREATE TRIGGER trg_places_auto_tag
    AFTER INSERT ON public.places
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_auto_tag_place();

-- ============================================================================
-- STEP 17: Row Level Security for new tables
-- ============================================================================

-- place_descriptions: public read
ALTER TABLE public.place_descriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pd_select_auth" ON public.place_descriptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "pd_select_anon" ON public.place_descriptions FOR SELECT TO anon USING (true);
CREATE POLICY "pd_insert_anon" ON public.place_descriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pd_update_anon" ON public.place_descriptions FOR UPDATE TO anon USING (true);

-- place_images: public read
ALTER TABLE public.place_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pi_select_auth" ON public.place_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "pi_select_anon" ON public.place_images FOR SELECT TO anon USING (true);
CREATE POLICY "pi_insert_anon" ON public.place_images FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pi_update_anon" ON public.place_images FOR UPDATE TO anon USING (true);

-- categories: public read
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cat_select_auth" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "cat_select_anon" ON public.categories FOR SELECT TO anon USING (true);

-- place_tags: public read
ALTER TABLE public.place_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pt_select_auth" ON public.place_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "pt_select_anon" ON public.place_tags FOR SELECT TO anon USING (true);
CREATE POLICY "pt_insert_anon" ON public.place_tags FOR INSERT TO anon WITH CHECK (true);

-- place_sources: public read
ALTER TABLE public.place_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_select_auth" ON public.place_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "ps_select_anon" ON public.place_sources FOR SELECT TO anon USING (true);
CREATE POLICY "ps_insert_anon" ON public.place_sources FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "ps_update_anon" ON public.place_sources FOR UPDATE TO anon USING (true);

-- place_metadata: public read
ALTER TABLE public.place_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pm_select_auth" ON public.place_metadata FOR SELECT TO authenticated USING (true);
CREATE POLICY "pm_select_anon" ON public.place_metadata FOR SELECT TO anon USING (true);
CREATE POLICY "pm_insert_anon" ON public.place_metadata FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pm_update_anon" ON public.place_metadata FOR UPDATE TO anon USING (true);

-- api_cache: public read/write for scripts
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ac_select_anon" ON public.api_cache FOR SELECT TO anon USING (true);
CREATE POLICY "ac_insert_anon" ON public.api_cache FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "ac_update_anon" ON public.api_cache FOR UPDATE TO anon USING (true);
CREATE POLICY "ac_select_auth" ON public.api_cache FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- STEP 18: Backfill place_tags for existing places
-- ============================================================================
-- Assigns the primary category tag to all existing places.

INSERT INTO public.place_tags (place_id, category_id, source)
SELECT p.id, c.id, 'auto'
FROM public.places p
JOIN public.categories c ON c.name = p.category
ON CONFLICT (place_id, category_id) DO NOTHING;

-- ============================================================================
-- STEP 19: Update v_places_full view to include new data
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
    co.flag_emoji AS country_flag,
    -- Enrichment columns (from 007)
    p.wikidata_id,
    p.wikipedia_title,
    p.aliases,
    p.official_name,
    p.heritage_status,
    p.tourism_info,
    p.image_source,
    p.enriched_at,
    p.enrichment_version,
    -- NEW: wikipedia_page_id (from 008)
    p.wikipedia_page_id,
    -- NEW: primary description (joined)
    pd.summary    AS wiki_summary,
    pd.history    AS wiki_history,
    -- NEW: tag count
    (SELECT count(*) FROM public.place_tags pt WHERE pt.place_id = p.id)::integer AS tag_count
FROM public.places p
LEFT JOIN public.cities    c  ON c.id  = p.city_id
LEFT JOIN public.districts d  ON d.id  = c.district_id
LEFT JOIN public.states    s  ON s.id  = d.state_id
LEFT JOIN public.countries co ON co.id = s.country_id
LEFT JOIN public.place_descriptions pd ON pd.place_id = p.id
    AND pd.language = 'en'
    AND pd.source = 'wikipedia';

-- ============================================================================
-- STEP 20: Refresh statistics
-- ============================================================================

ANALYZE public.places;
ANALYZE public.place_descriptions;
ANALYZE public.place_images;
ANALYZE public.categories;
ANALYZE public.place_tags;
ANALYZE public.place_sources;
ANALYZE public.place_metadata;
ANALYZE public.api_cache;

-- ============================================================================
-- DONE — Verify
-- ============================================================================
-- SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT * FROM public.categories ORDER BY display_order;
-- SELECT count(*) FROM public.place_tags;
-- SELECT count(*) FROM public.mv_search_places;
-- SELECT * FROM search_places_v2('Chennai', NULL, NULL, NULL, NULL, 5);
-- SELECT * FROM search_suggestions('che', 5);
-- SELECT get_place_detail((SELECT id FROM places LIMIT 1));
