-- ============================================================================
-- ExploreHub — Migration 009: Universal Multi-Tier Enrichment
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER migration 008.
--
-- Adds:
--   1. category_templates   — Enrichment templates per category + tier
--   2. place_quality_scores — Quality scoring (0-100) per place
--   3. user_contributions   — User-submitted photos, descriptions, tips
--   4. search_places_nearby — Proximity search RPC
--   5. Seed data            — Templates for all 42 categories
--
-- SAFE: No existing tables/columns modified. All changes additive.
-- ============================================================================

-- ============================================================================
-- STEP 1: category_templates — Enrichment strategy per category
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.category_templates (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    category    text             NOT NULL UNIQUE,
    tier        integer          NOT NULL DEFAULT 6,
    template    text             NOT NULL,
    fallback    text             NOT NULL,
    icon_emoji  text,
    priority    text[]           DEFAULT '{}',
    created_at  timestamptz      DEFAULT now()
);

COMMENT ON TABLE  public.category_templates IS 'Enrichment templates per place category with tier classification';
COMMENT ON COLUMN public.category_templates.tier IS '1=Famous/Wikipedia, 2=Infrastructure, 3=Institutions, 4=Commercial, 5=Settlements, 6=Everything else';
COMMENT ON COLUMN public.category_templates.template IS 'Description template with {{name}}, {{city}}, {{state}}, {{district}}, {{type}}, {{religion}} placeholders';
COMMENT ON COLUMN public.category_templates.fallback IS 'Simpler fallback template when city/state are missing';

-- RLS
ALTER TABLE public.category_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "category_templates_read" ON public.category_templates FOR SELECT USING (true);

-- ============================================================================
-- STEP 2: place_quality_scores — Quality scoring per place
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.place_quality_scores (
    place_id            uuid             PRIMARY KEY REFERENCES public.places(id) ON DELETE CASCADE,
    score               integer          NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    has_description     boolean          DEFAULT false,
    has_image           boolean          DEFAULT false,
    has_metadata        boolean          DEFAULT false,
    has_history         boolean          DEFAULT false,
    has_coordinates     boolean          DEFAULT false,
    description_source  text,
    image_source        text,
    last_scored_at      timestamptz      DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_score ON public.place_quality_scores(score);
CREATE INDEX IF NOT EXISTS idx_quality_low   ON public.place_quality_scores(score) WHERE score < 50;

COMMENT ON TABLE  public.place_quality_scores IS 'Quality score (0-100) per place. Higher = more complete data.';
COMMENT ON COLUMN public.place_quality_scores.score IS '100=Complete(wiki+images+history), 80=Good(desc+img+meta), 50=Basic(generated desc), 20=Raw OSM only';

-- RLS
ALTER TABLE public.place_quality_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quality_scores_read" ON public.place_quality_scores FOR SELECT USING (true);
CREATE POLICY "quality_scores_write_anon" ON public.place_quality_scores FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "quality_scores_write_auth" ON public.place_quality_scores FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- STEP 3: user_contributions — User-submitted content
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_contributions (
    id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid             NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    place_id        uuid             NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    type            text             NOT NULL CHECK (type IN ('photo', 'description', 'correction', 'tip', 'hours', 'rating', 'accessibility')),
    content         text,
    image_url       text,
    status          text             NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at      timestamptz      DEFAULT now(),
    reviewed_at     timestamptz,
    reviewed_by     uuid             REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_user_contrib_place  ON public.user_contributions(place_id);
CREATE INDEX IF NOT EXISTS idx_user_contrib_user   ON public.user_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contrib_status ON public.user_contributions(status) WHERE status = 'pending';

COMMENT ON TABLE public.user_contributions IS 'User-submitted photos, descriptions, corrections, tips, hours, ratings. Supplements official data.';

-- RLS: Users can read all, insert own, update own pending
ALTER TABLE public.user_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contrib_read_all" ON public.user_contributions FOR SELECT USING (true);
CREATE POLICY "contrib_insert_own" ON public.user_contributions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contrib_update_own" ON public.user_contributions FOR UPDATE TO authenticated USING (auth.uid() = user_id AND status = 'pending');

-- ============================================================================
-- STEP 4: Seed category_templates with all 42 categories
-- ============================================================================

INSERT INTO public.category_templates (category, tier, template, fallback, icon_emoji, priority) VALUES
-- Tier 1: Famous Tourist Places
('Waterfalls',      1, '{{name}} is a waterfall located in {{district}} district, {{state}}, India. It is a popular natural attraction in the region.', '{{name}} is a waterfall in India.', '💧', '{wikipedia,wikidata,wikimedia,government}'),
('Temples',         1, '{{name}} is a {{religion}} temple located in {{city}}, {{state}}, India.{{heritage_note}}', '{{name}} is a temple in India.', '🛕', '{wikipedia,wikidata,wikimedia,government}'),
('Beaches',         1, '{{name}} is a beach located along the coast of {{state}}, India. It is a popular destination for tourists and locals alike.', '{{name}} is a beach in India.', '🏖️', '{wikipedia,wikidata,wikimedia,government}'),
('Mountains',       1, '{{name}} is a mountain located in {{district}} district, {{state}}, India.', '{{name}} is a mountain in India.', '⛰️', '{wikipedia,wikidata,wikimedia,government}'),
('Forests',         1, '{{name}} is a forest area located in {{district}}, {{state}}, India. It is home to diverse flora and fauna.', '{{name}} is a forest in India.', '🌲', '{wikipedia,wikidata,wikimedia}'),
('Historical',      1, '{{name}} is a historical site located in {{city}}, {{state}}, India.{{heritage_note}}', '{{name}} is a historical site in India.', '🏛️', '{wikipedia,wikidata,wikimedia,government}'),
('Forts',           1, '{{name}} is a historical fort located in {{city}}, {{state}}, India.{{heritage_note}}', '{{name}} is a fort in India.', '🏰', '{wikipedia,wikidata,wikimedia,government}'),
('Wildlife',        1, '{{name}} is a wildlife sanctuary located in {{district}}, {{state}}, India. It provides habitat for diverse species of flora and fauna.', '{{name}} is a wildlife area in India.', '🐘', '{wikipedia,wikidata,wikimedia,government}'),
('Lakes',           1, '{{name}} is a lake located in {{district}} district, {{state}}, India.', '{{name}} is a lake in India.', '🏞️', '{wikipedia,wikidata,wikimedia}'),
('Caves',           1, '{{name}} is a cave located in {{district}}, {{state}}, India. It is a site of geological and cultural significance.', '{{name}} is a cave in India.', '🪨', '{wikipedia,wikidata,wikimedia,government}'),
('National Parks',  1, '{{name}} is a national park located in {{state}}, India. It is a protected area home to diverse wildlife and natural landscapes.', '{{name}} is a national park in India.', '🏕️', '{wikipedia,wikidata,wikimedia,government}'),
('Museums',         1, '{{name}} is a museum located in {{city}}, {{state}}, India. It houses collections of historical, cultural, and artistic significance.', '{{name}} is a museum in India.', '🏫', '{wikipedia,wikidata,wikimedia,government}'),
('Attractions',     1, '{{name}} is a popular attraction located in {{city}}, {{state}}, India.', '{{name}} is an attraction in India.', '⭐', '{wikipedia,wikidata,wikimedia}'),
('Viewpoints',      1, '{{name}} is a scenic viewpoint located in {{district}}, {{state}}, India, offering panoramic views of the surrounding landscape.', '{{name}} is a viewpoint in India.', '🔭', '{wikipedia,wikidata,wikimedia}'),
('Monuments',       1, '{{name}} is a monument located in {{city}}, {{state}}, India.{{heritage_note}}', '{{name}} is a monument in India.', '🗿', '{wikipedia,wikidata,wikimedia,government}'),
('Islands',         1, '{{name}} is an island located off the coast of {{state}}, India.', '{{name}} is an island in India.', '🏝️', '{wikipedia,wikidata,wikimedia}'),
('Dams',            1, '{{name}} is a dam located in {{district}}, {{state}}, India. It serves purposes of irrigation, water supply, and hydroelectric power.', '{{name}} is a dam in India.', '🌊', '{wikipedia,wikidata,wikimedia,government}'),
('Bridges',         1, '{{name}} is a bridge located in {{city}}, {{state}}, India.', '{{name}} is a bridge in India.', '🌉', '{wikipedia,wikidata,wikimedia}'),
('UNESCO',          1, '{{name}} is a UNESCO World Heritage Site located in {{state}}, India. It has been recognized for its outstanding universal value.', '{{name}} is a UNESCO World Heritage Site in India.', '🏆', '{wikipedia,wikidata,wikimedia,government}'),

-- Tier 1: Religious Places
('Mosques',         1, '{{name}} is a mosque located in {{city}}, {{state}}, India. It serves as a place of worship for the local Muslim community.', '{{name}} is a mosque in India.', '🕌', '{wikipedia,wikidata,wikimedia}'),
('Churches',        1, '{{name}} is a church located in {{city}}, {{state}}, India. It serves as a place of worship for the local Christian community.', '{{name}} is a church in India.', '⛪', '{wikipedia,wikidata,wikimedia}'),
('Gurudwaras',      1, '{{name}} is a Gurudwara located in {{city}}, {{state}}, India. It serves as a place of worship for the Sikh community.', '{{name}} is a Gurudwara in India.', '🙏', '{wikipedia,wikidata,wikimedia}'),
('Monasteries',     1, '{{name}} is a monastery located in {{district}}, {{state}}, India.', '{{name}} is a monastery in India.', '🧘', '{wikipedia,wikidata,wikimedia}'),

-- Tier 2: Infrastructure
('Airports',        2, '{{name}} is an airport located in {{city}}, {{state}}, India. It serves the city and surrounding region with domestic and international flights.', '{{name}} is an airport in India.', '✈️', '{wikipedia,wikidata,osm,government}'),
('Railway Stations',2, '{{name}} is a railway station serving {{city}} and the surrounding region in {{state}}, India. It is part of the Indian Railways network.', '{{name}} is a railway station in India.', '🚂', '{wikipedia,wikidata,osm,government}'),
('Bus Stations',    2, '{{name}} is a bus station located in {{city}}, {{state}}, India. It serves as a hub for local and intercity bus services.', '{{name}} is a bus station in India.', '🚌', '{osm,government}'),

-- Tier 3: Parks & Recreation
('Parks',           3, '{{name}} is a public park located in {{city}}, {{state}}, India. It provides green space for recreation and leisure.', '{{name}} is a park in India.', '🌿', '{osm,wikipedia}'),

-- Tier 4: Commercial
('Hotels',          4, '{{name}} is an accommodation facility located in {{city}}, {{state}}, India.', '{{name}} is a hotel in India.', '🏨', '{osm,website}'),
('Restaurants',     4, '{{name}} is a dining establishment located in {{city}}, {{state}}, India.', '{{name}} is a restaurant in India.', '🍴', '{osm,website}'),

-- Tier 5: Settlements
('Cities',          5, '{{name}} is a city in {{district}} district, {{state}}, India.', '{{name}} is a city in India.', '🏙️', '{wikipedia,wikidata,government}'),
('Villages',        5, '{{name}} is a village in {{district}} district, {{state}}, India.', '{{name}} is a village in India.', '🏘️', '{wikipedia,wikidata,government}'),

-- Tier 6: Experience / Activity tags
('Adventure',       6, '{{name}} is an adventure activity destination located in {{city}}, {{state}}, India.', '{{name}} is an adventure destination in India.', '🧗', '{osm}'),
('Photography',     6, '{{name}} is a photography spot located in {{city}}, {{state}}, India.', '{{name}} is a photography spot in India.', '📸', '{osm}'),
('Camping',         6, '{{name}} is a camping site located in {{district}}, {{state}}, India.', '{{name}} is a camping site in India.', '⛺', '{osm}'),
('Family',          6, '{{name}} is a family-friendly destination located in {{city}}, {{state}}, India.', '{{name}} is a family destination in India.', '👨‍👩‍👧‍👦', '{osm}'),
('Nightlife',       6, '{{name}} is a nightlife venue located in {{city}}, {{state}}, India.', '{{name}} is a nightlife venue in India.', '🌃', '{osm}'),
('Food',            6, '{{name}} is a food destination located in {{city}}, {{state}}, India.', '{{name}} is a food destination in India.', '🍽️', '{osm}'),
('Shopping',        6, '{{name}} is a shopping destination located in {{city}}, {{state}}, India.', '{{name}} is a shopping destination in India.', '🛍️', '{osm}'),
('Other',           6, '{{name}} is located in {{city}}, {{state}}, India.', '{{name}} is a place in India.', '📍', '{osm}')
ON CONFLICT (category) DO NOTHING;

-- ============================================================================
-- STEP 5: Nearby search RPC (using simple Haversine — no extensions needed)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_places_nearby(
    p_lat double precision,
    p_lon double precision,
    p_radius_km integer DEFAULT 10,
    p_limit integer DEFAULT 20,
    p_exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    name text,
    category text,
    latitude double precision,
    longitude double precision,
    image_url text,
    description text,
    distance_km double precision
) AS $$
    SELECT
        p.id,
        p.name,
        p.category,
        p.latitude,
        p.longitude,
        p.image_url,
        p.description,
        (6371 * acos(
            cos(radians(p_lat)) * cos(radians(p.latitude)) *
            cos(radians(p.longitude) - radians(p_lon)) +
            sin(radians(p_lat)) * sin(radians(p.latitude))
        )) AS distance_km
    FROM public.places p
    WHERE p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND (p_exclude_id IS NULL OR p.id != p_exclude_id)
      AND p.latitude BETWEEN (p_lat - p_radius_km / 111.0) AND (p_lat + p_radius_km / 111.0)
      AND p.longitude BETWEEN (p_lon - p_radius_km / (111.0 * cos(radians(p_lat)))) AND (p_lon + p_radius_km / (111.0 * cos(radians(p_lat))))
    ORDER BY distance_km ASC
    LIMIT p_limit;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.search_places_nearby IS 'Find places within a radius (km) of a point. Uses bounding box pre-filter + Haversine for accuracy.';

-- ============================================================================
-- STEP 6: Additional indexes for performance
-- ============================================================================

-- Composite index for tier-based enrichment queries
CREATE INDEX IF NOT EXISTS idx_places_category_enriched
    ON public.places(category, enriched_at)
    WHERE enriched_at IS NULL;

-- Index for nearby search bounding box
CREATE INDEX IF NOT EXISTS idx_places_lat_lon_bbox
    ON public.places(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
