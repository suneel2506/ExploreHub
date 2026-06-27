-- ============================================================================
-- ExploreHub — Migration 007: Enrichment Schema
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER migration 006.
-- Adds:
--   1. New nullable columns on places for enrichment data
--   2. enrichment_log table for deduplication
--   3. New indexes for search and enrichment queries
--   4. Updated search_places_hierarchical() to search aliases + wikipedia_title
--   5. Updated v_places_full view with new columns
--   6. find_duplicates() RPC for duplicate detection
--
-- SAFE: No existing columns removed. No existing data modified.
-- All new columns are nullable with safe defaults.
-- ============================================================================

-- ============================================================================
-- STEP 1: Add nullable columns to places table
-- ============================================================================
-- These columns store enrichment data from Wikidata, Wikipedia, Wikimedia.
-- All are nullable so existing rows are unaffected.

ALTER TABLE public.places
    ADD COLUMN IF NOT EXISTS wikidata_id text,
    ADD COLUMN IF NOT EXISTS wikipedia_title text,
    ADD COLUMN IF NOT EXISTS aliases text[],
    ADD COLUMN IF NOT EXISTS official_name text,
    ADD COLUMN IF NOT EXISTS heritage_status text,
    ADD COLUMN IF NOT EXISTS tourism_info jsonb,
    ADD COLUMN IF NOT EXISTS image_source text,
    ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
    ADD COLUMN IF NOT EXISTS enrichment_version integer DEFAULT 0;

-- Comment the columns for documentation
COMMENT ON COLUMN public.places.wikidata_id IS 'Wikidata Q-identifier, e.g. Q42';
COMMENT ON COLUMN public.places.wikipedia_title IS 'Exact English Wikipedia article title';
COMMENT ON COLUMN public.places.aliases IS 'Alternative names from Wikidata or OSM';
COMMENT ON COLUMN public.places.official_name IS 'Official name from Wikidata or OSM official_name tag';
COMMENT ON COLUMN public.places.heritage_status IS 'Heritage designation, e.g. UNESCO World Heritage Site, ASI Protected';
COMMENT ON COLUMN public.places.tourism_info IS 'Tourism metadata: opening_hours, fee, website, phone, etc.';
COMMENT ON COLUMN public.places.image_source IS 'Where the image came from: osm, wikimedia, wikipedia, user';
COMMENT ON COLUMN public.places.enriched_at IS 'Timestamp of last enrichment run';
COMMENT ON COLUMN public.places.enrichment_version IS 'Schema version of enrichment data, for re-enrichment';

-- ============================================================================
-- STEP 2: Create enrichment_log table
-- ============================================================================
-- Tracks which sources have been fetched for each place.
-- Prevents re-fetching the same data twice.

CREATE TABLE IF NOT EXISTS public.enrichment_log (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id    uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    source      text             NOT NULL, -- 'wikidata', 'wikipedia', 'wikimedia'
    fetched_at  timestamptz      DEFAULT now(),
    status      text             NOT NULL DEFAULT 'success', -- 'success', 'not_found', 'error'
    error_msg   text,            -- Error message if status = 'error'

    UNIQUE (place_id, source)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_log_place
    ON public.enrichment_log(place_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_log_source_status
    ON public.enrichment_log(source, status);

-- RLS: Allow anon INSERT/SELECT for enrichment script, authenticated SELECT
ALTER TABLE public.enrichment_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrichment_log_select_auth" ON public.enrichment_log
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "enrichment_log_select_anon" ON public.enrichment_log
    FOR SELECT TO anon USING (true);
CREATE POLICY "enrichment_log_insert_anon" ON public.enrichment_log
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "enrichment_log_update_anon" ON public.enrichment_log
    FOR UPDATE TO anon USING (true);

-- ============================================================================
-- STEP 3: Add indexes for enrichment and search
-- ============================================================================

-- Index on wikidata_id for duplicate detection
CREATE INDEX IF NOT EXISTS idx_places_wikidata_id
    ON public.places(wikidata_id)
    WHERE wikidata_id IS NOT NULL;

-- Index on enriched_at for incremental enrichment queries
CREATE INDEX IF NOT EXISTS idx_places_enriched_at
    ON public.places(enriched_at)
    WHERE enriched_at IS NULL;

-- GIN index on aliases array for search
CREATE INDEX IF NOT EXISTS idx_places_aliases
    ON public.places USING gin(aliases)
    WHERE aliases IS NOT NULL;

-- Index on wikipedia_title for search
CREATE INDEX IF NOT EXISTS idx_places_wikipedia_title
    ON public.places(wikipedia_title)
    WHERE wikipedia_title IS NOT NULL;

-- Trigram index on wikipedia_title for fuzzy search
CREATE INDEX IF NOT EXISTS idx_places_wikipedia_title_trgm
    ON public.places USING gin(wikipedia_title gin_trgm_ops);

-- ============================================================================
-- STEP 4: Update v_places_full view (add new columns, preserve all existing)
-- ============================================================================
-- CREATE OR REPLACE preserves dependent objects.
-- All existing columns are in the exact same order.
-- New columns are appended at the end.

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
    -- NEW: Enrichment columns (appended, backward compatible)
    p.wikidata_id,
    p.wikipedia_title,
    p.aliases,
    p.official_name,
    p.heritage_status,
    p.tourism_info,
    p.image_source,
    p.enriched_at,
    p.enrichment_version
FROM public.places p
LEFT JOIN public.cities    c  ON c.id  = p.city_id
LEFT JOIN public.districts d  ON d.id  = c.district_id
LEFT JOIN public.states    s  ON s.id  = d.state_id
LEFT JOIN public.countries co ON co.id = s.country_id;

-- ============================================================================
-- STEP 5: Update search_places_hierarchical() — add aliases + wikipedia_title
-- ============================================================================
-- Replaces the function with an expanded WHERE clause.
-- Return type is unchanged (same columns in same order).
-- Adds matching against aliases array and wikipedia_title.

CREATE OR REPLACE FUNCTION public.search_places_hierarchical(
    query text,
    max_results int DEFAULT 50
)
RETURNS TABLE(
    id            uuid,
    name          text,
    category      text,
    latitude      double precision,
    longitude     double precision,
    image_url     text,
    wiki_url      text,
    city_name     text,
    district_name text,
    state_name    text,
    match_type    text,
    relevance     real
) AS $$
SELECT
    p.id,
    p.name,
    p.category,
    p.latitude,
    p.longitude,
    p.image_url,
    p.wiki_url,
    c.name  AS city_name,
    d.name  AS district_name,
    s.name  AS state_name,
    CASE
        WHEN s.name ILIKE query THEN 'state'
        WHEN d.name ILIKE query THEN 'district'
        WHEN c.name ILIKE query THEN 'city'
        WHEN p.aliases IS NOT NULL AND EXISTS (
            SELECT 1 FROM unnest(p.aliases) AS a WHERE a ILIKE query
        ) THEN 'alias'
        WHEN p.wikipedia_title ILIKE '%' || query || '%' THEN 'wikipedia'
        ELSE 'place'
    END AS match_type,
    GREATEST(
        similarity(p.name, query),
        CASE WHEN c.name ILIKE query THEN 0.9 ELSE 0.0 END,
        CASE WHEN d.name ILIKE query THEN 0.85 ELSE 0.0 END,
        CASE WHEN s.name ILIKE query THEN 0.8 ELSE 0.0 END,
        CASE WHEN p.aliases IS NOT NULL AND EXISTS (
            SELECT 1 FROM unnest(p.aliases) AS a WHERE a ILIKE query
        ) THEN 0.75 ELSE 0.0 END,
        CASE WHEN p.wikipedia_title ILIKE '%' || query || '%' THEN 0.7 ELSE 0.0 END
    ) AS relevance
FROM public.places p
LEFT JOIN public.cities    c ON c.id = p.city_id
LEFT JOIN public.districts d ON d.id = c.district_id
LEFT JOIN public.states    s ON s.id = d.state_id
WHERE p.fts @@ plainto_tsquery('simple', query)
   OR p.name ILIKE '%' || query || '%'
   OR c.name ILIKE query
   OR d.name ILIKE query
   OR s.name ILIKE query
   -- NEW: Search aliases array
   OR (p.aliases IS NOT NULL AND EXISTS (
       SELECT 1 FROM unnest(p.aliases) AS a WHERE a ILIKE '%' || query || '%'
   ))
   -- NEW: Search wikipedia_title
   OR p.wikipedia_title ILIKE '%' || query || '%'
ORDER BY
    CASE
        WHEN s.name ILIKE query THEN 1
        WHEN d.name ILIKE query THEN 2
        WHEN c.name ILIKE query THEN 3
        ELSE 4
    END,
    relevance DESC,
    p.name ASC
LIMIT max_results;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- STEP 6: find_duplicates() — duplicate detection RPC
-- ============================================================================
-- Checks for duplicates by OSM ID, Wikidata ID, or coordinates + name similarity.
-- Returns matching place IDs with the match reason.

CREATE OR REPLACE FUNCTION public.find_duplicates(
    p_osm_id bigint DEFAULT NULL,
    p_wikidata_id text DEFAULT NULL,
    p_name text DEFAULT NULL,
    p_lat double precision DEFAULT NULL,
    p_lon double precision DEFAULT NULL,
    p_radius_km double precision DEFAULT 0.5
)
RETURNS TABLE(
    place_id    uuid,
    place_name  text,
    match_reason text,
    distance_km double precision
) AS $$
BEGIN
    -- Match by OSM ID (exact)
    IF p_osm_id IS NOT NULL THEN
        RETURN QUERY
        SELECT p.id, p.name, 'osm_id'::text,
               0.0::double precision
        FROM public.places p
        WHERE p.osm_id = p_osm_id
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- Match by Wikidata ID (exact)
    IF p_wikidata_id IS NOT NULL THEN
        RETURN QUERY
        SELECT p.id, p.name, 'wikidata_id'::text,
               0.0::double precision
        FROM public.places p
        WHERE p.wikidata_id = p_wikidata_id
        LIMIT 1;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- Match by coordinates + name similarity
    IF p_lat IS NOT NULL AND p_lon IS NOT NULL AND p_name IS NOT NULL THEN
        RETURN QUERY
        SELECT p.id, p.name, 'coords_name'::text,
               6371.0 * acos(
                   LEAST(1.0, GREATEST(-1.0,
                       cos(radians(p_lat)) * cos(radians(p.latitude)) *
                       cos(radians(p.longitude) - radians(p_lon)) +
                       sin(radians(p_lat)) * sin(radians(p.latitude))
                   ))
               ) AS dist_km
        FROM public.places p
        WHERE p.latitude  BETWEEN p_lat - (p_radius_km / 111.0)
                              AND p_lat + (p_radius_km / 111.0)
          AND p.longitude BETWEEN p_lon - (p_radius_km / (111.0 * GREATEST(cos(radians(p_lat)), 0.01)))
                              AND p_lon + (p_radius_km / (111.0 * GREATEST(cos(radians(p_lat)), 0.01)))
          AND similarity(p.name, p_name) > 0.4
        ORDER BY dist_km
        LIMIT 3;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- STEP 7: Clean up stale 'none' image_url values from old enrichment
-- ============================================================================
-- The old enrichment script set image_url = 'none' for places without images.
-- Clear these so the new enrichment script can try again with Wikidata/Wikimedia.

UPDATE public.places
SET image_url = NULL
WHERE image_url = 'none';

-- ============================================================================
-- STEP 8: Refresh statistics for query planner
-- ============================================================================

ANALYZE public.places;
ANALYZE public.enrichment_log;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify:
-- SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'places' ORDER BY ordinal_position;
-- SELECT * FROM enrichment_log LIMIT 1;
-- SELECT * FROM search_places_hierarchical('Chennai', 10);
-- SELECT * FROM find_duplicates(NULL, NULL, 'Taj Mahal', 27.1751, 78.0421);
