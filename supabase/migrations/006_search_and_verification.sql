-- ============================================================================
-- ExploreHub — Migration 006: Search & Verification Functions
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER migration 005.
-- Adds:
--   1. pg_trgm extension for fuzzy search
--   2. Trigram GIN indexes on names
--   3. find_nearest_city() RPC for spatial matching
--   4. Orphan detection RPCs for post-import verification
--   5. search_places_hierarchical() RPC for frontend search
-- ============================================================================

-- ============================================================================
-- STEP 1: Enable pg_trgm extension
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- STEP 2: Trigram indexes for fuzzy name search
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_places_name_trgm
    ON public.places USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cities_name_trgm
    ON public.cities USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_districts_name_trgm
    ON public.districts USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_states_name_trgm
    ON public.states USING gin(name gin_trgm_ops);

-- ============================================================================
-- STEP 3: find_nearest_city() — spatial nearest-city lookup
-- ============================================================================
-- Used by the importer as a server-side fallback for city matching.
-- Uses a bounding-box pre-filter for performance, then haversine for accuracy.

CREATE OR REPLACE FUNCTION public.find_nearest_city(
    p_lat double precision,
    p_lon double precision,
    p_max_km double precision DEFAULT 75
)
RETURNS TABLE(
    city_id   uuid,
    city_name text,
    distance_km double precision
) AS $$
SELECT
    c.id,
    c.name,
    6371.0 * acos(
        LEAST(1.0, GREATEST(-1.0,
            cos(radians(p_lat)) * cos(radians(c.latitude)) *
            cos(radians(c.longitude) - radians(p_lon)) +
            sin(radians(p_lat)) * sin(radians(c.latitude))
        ))
    ) AS dist_km
FROM public.cities c
WHERE c.latitude IS NOT NULL
  AND c.longitude IS NOT NULL
  -- Bounding box pre-filter (uses the lat/lon index)
  AND c.latitude  BETWEEN p_lat - (p_max_km / 111.0)
                      AND p_lat + (p_max_km / 111.0)
  AND c.longitude BETWEEN p_lon - (p_max_km / (111.0 * GREATEST(cos(radians(p_lat)), 0.01)))
                      AND p_lon + (p_max_km / (111.0 * GREATEST(cos(radians(p_lat)), 0.01)))
ORDER BY dist_km
LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- STEP 4: Orphan detection functions for post-import verification
-- ============================================================================

CREATE OR REPLACE FUNCTION public.count_orphan_districts()
RETURNS bigint AS $$
    SELECT count(*) FROM public.districts d
    WHERE NOT EXISTS (SELECT 1 FROM public.states s WHERE s.id = d.state_id);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.count_orphan_cities()
RETURNS bigint AS $$
    SELECT count(*) FROM public.cities c
    WHERE NOT EXISTS (SELECT 1 FROM public.districts d WHERE d.id = c.district_id);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.count_orphan_places()
RETURNS bigint AS $$
    SELECT count(*) FROM public.places p
    WHERE p.city_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.id = p.city_id);
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- STEP 5: search_places_hierarchical() — unified hierarchical search
-- ============================================================================
-- Searches across places, cities, districts, and states.
-- Returns places with full hierarchy context.
-- Match types: 'state', 'district', 'city', 'place'

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
        ELSE 'place'
    END AS match_type,
    GREATEST(
        similarity(p.name, query),
        CASE WHEN c.name ILIKE query THEN 0.9 ELSE 0.0 END,
        CASE WHEN d.name ILIKE query THEN 0.85 ELSE 0.0 END,
        CASE WHEN s.name ILIKE query THEN 0.8 ELSE 0.0 END
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
-- STEP 6: Refresh statistics for query planner
-- ============================================================================

ANALYZE public.countries;
ANALYZE public.states;
ANALYZE public.districts;
ANALYZE public.cities;
ANALYZE public.places;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify:
-- SELECT * FROM search_places_hierarchical('Chennai', 10);
-- SELECT * FROM find_nearest_city(13.0827, 80.2707);
-- SELECT count_orphan_districts(), count_orphan_cities(), count_orphan_places();
