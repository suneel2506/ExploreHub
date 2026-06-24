-- ============================================================================
-- Explore Hub — Supabase Schema Migration 001
-- ============================================================================
-- Creates all core tables, indexes, RLS policies, triggers, and views.
-- Run with: supabase db push   OR   psql -f 001_schema.sql
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- -------------------------
-- 1a. countries
-- -------------------------
CREATE TABLE IF NOT EXISTS public.countries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    code        text UNIQUE NOT NULL,               -- ISO 3166-1 alpha-2
    continent   text,
    latitude    double precision,
    longitude   double precision,
    flag_emoji  text
);

COMMENT ON TABLE  public.countries IS 'Reference table of countries with ISO codes and flag emojis.';
COMMENT ON COLUMN public.countries.code IS 'Two-letter ISO 3166-1 alpha-2 country code.';

-- -------------------------
-- 1b. states
-- -------------------------
CREATE TABLE IF NOT EXISTS public.states (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id  uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
    name        text NOT NULL,
    code        text,                                -- state/province code
    latitude    double precision,
    longitude   double precision,

    UNIQUE (country_id, name)
);

CREATE INDEX idx_states_country_id ON public.states(country_id);

COMMENT ON TABLE public.states IS 'States / provinces / prefectures within a country.';

-- -------------------------
-- 1c. districts
-- -------------------------
CREATE TABLE IF NOT EXISTS public.districts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id    uuid NOT NULL REFERENCES public.states(id) ON DELETE CASCADE,
    name        text NOT NULL,
    latitude    double precision,
    longitude   double precision,

    UNIQUE (state_id, name)
);

CREATE INDEX idx_districts_state_id ON public.districts(state_id);

COMMENT ON TABLE public.districts IS 'Districts / counties / sub-regions within a state.';

-- -------------------------
-- 1d. places
-- -------------------------
CREATE TABLE IF NOT EXISTS public.places (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    district_id uuid NOT NULL REFERENCES public.districts(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    category    text NOT NULL,                       -- e.g. 'Waterfalls', 'Temples'
    place_type  text,                                -- specific type, e.g. 'Shinto Shrine'
    image_url   text,
    metadata    jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_places_district_id ON public.places(district_id);
CREATE INDEX idx_places_category    ON public.places(category);
CREATE INDEX idx_places_name_fts    ON public.places USING gin(to_tsvector('english', name));

COMMENT ON TABLE public.places IS 'Curated places of interest with coordinates and categories.';

-- -------------------------
-- 1e. profiles  (extends auth.users)
-- -------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username    text UNIQUE,
    full_name   text,
    avatar_url  text,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'Public user profiles, auto-created on sign-up via trigger.';

-- -------------------------
-- 1f. custom_places  (user-generated)
-- -------------------------
CREATE TABLE IF NOT EXISTS public.custom_places (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    district_id uuid REFERENCES public.districts(id),
    name        text NOT NULL,
    description text,
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    category    text,
    image_url   text,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_custom_places_user_id ON public.custom_places(user_id);

COMMENT ON TABLE public.custom_places IS 'User-created places that are not in the curated catalog.';

-- -------------------------
-- 1g. visited_places
-- -------------------------
CREATE TABLE IF NOT EXISTS public.visited_places (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    place_id        uuid REFERENCES public.places(id) ON DELETE CASCADE,
    custom_place_id uuid REFERENCES public.custom_places(id) ON DELETE CASCADE,
    visited_at      timestamptz DEFAULT now(),
    notes           text,
    rating          integer CHECK (rating >= 1 AND rating <= 10),

    -- Exactly one of place_id or custom_place_id must be set
    CONSTRAINT chk_visited_one_place CHECK (
        (place_id IS NOT NULL AND custom_place_id IS NULL) OR
        (place_id IS NULL AND custom_place_id IS NOT NULL)
    ),

    -- Prevent duplicate visits to the same curated place
    UNIQUE (user_id, place_id),
    -- Prevent duplicate visits to the same custom place
    UNIQUE (user_id, custom_place_id)
);

CREATE INDEX idx_visited_user_id ON public.visited_places(user_id);

COMMENT ON TABLE public.visited_places IS 'Tracks which places a user has visited, with optional rating/notes.';

-- -------------------------
-- 1h. wishlist
-- -------------------------
CREATE TABLE IF NOT EXISTS public.wishlist (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    place_id    uuid NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    added_at    timestamptz DEFAULT now(),

    UNIQUE (user_id, place_id)
);

CREATE INDEX idx_wishlist_user_id ON public.wishlist(user_id);

COMMENT ON TABLE public.wishlist IS 'Places a user wants to visit in the future.';

-- -------------------------
-- 1i. memories
-- -------------------------
CREATE TABLE IF NOT EXISTS public.memories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    place_id        uuid REFERENCES public.places(id) ON DELETE CASCADE,
    custom_place_id uuid REFERENCES public.custom_places(id) ON DELETE CASCADE,
    title           text,
    content         text,
    rating          integer CHECK (rating >= 1 AND rating <= 10),
    visit_date      date,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_memories_user_id ON public.memories(user_id);

COMMENT ON TABLE public.memories IS 'Journal entries / travel memories attached to places.';

-- -------------------------
-- 1j. media
-- -------------------------
CREATE TABLE IF NOT EXISTS public.media (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    place_id        uuid REFERENCES public.places(id) ON DELETE CASCADE,
    custom_place_id uuid REFERENCES public.custom_places(id) ON DELETE CASCADE,
    memory_id       uuid REFERENCES public.memories(id) ON DELETE SET NULL,
    type            text NOT NULL CHECK (type IN ('image', 'video')),
    url             text NOT NULL,
    thumbnail_url   text,
    caption         text,
    file_size       integer,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_media_user_id ON public.media(user_id);

COMMENT ON TABLE public.media IS 'Photos and videos uploaded by users, optionally linked to memories.';


-- ============================================================================
-- 2. TRIGGER — Auto-create profile on sign-up
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, username, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data ->> 'username',
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
        NEW.raw_user_meta_data ->> 'avatar_url'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a public.profiles row when a new auth.users row is inserted.';


-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================

-- Helper: enable RLS on every table
ALTER TABLE public.countries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.states          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.districts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_places   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visited_places  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media           ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------
-- 3a. Reference data — authenticated read-only
-- -------------------------------------------------------

-- countries
CREATE POLICY "countries_select_authenticated"
    ON public.countries FOR SELECT
    TO authenticated
    USING (true);

-- states
CREATE POLICY "states_select_authenticated"
    ON public.states FOR SELECT
    TO authenticated
    USING (true);

-- districts
CREATE POLICY "districts_select_authenticated"
    ON public.districts FOR SELECT
    TO authenticated
    USING (true);

-- places
CREATE POLICY "places_select_authenticated"
    ON public.places FOR SELECT
    TO authenticated
    USING (true);

-- -------------------------------------------------------
-- 3b. profiles — own row only
-- -------------------------------------------------------
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- -------------------------------------------------------
-- 3c. User-owned tables — full CRUD to own rows
-- -------------------------------------------------------

-- Macro-style: repeat for each user-owned table
-- custom_places
CREATE POLICY "custom_places_select" ON public.custom_places FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "custom_places_insert" ON public.custom_places FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "custom_places_update" ON public.custom_places FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "custom_places_delete" ON public.custom_places FOR DELETE TO authenticated USING (user_id = auth.uid());

-- visited_places
CREATE POLICY "visited_places_select" ON public.visited_places FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "visited_places_insert" ON public.visited_places FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "visited_places_update" ON public.visited_places FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "visited_places_delete" ON public.visited_places FOR DELETE TO authenticated USING (user_id = auth.uid());

-- wishlist
CREATE POLICY "wishlist_select" ON public.wishlist FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wishlist_insert" ON public.wishlist FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "wishlist_update" ON public.wishlist FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wishlist_delete" ON public.wishlist FOR DELETE TO authenticated USING (user_id = auth.uid());

-- memories
CREATE POLICY "memories_select" ON public.memories FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "memories_insert" ON public.memories FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "memories_update" ON public.memories FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "memories_delete" ON public.memories FOR DELETE TO authenticated USING (user_id = auth.uid());

-- media
CREATE POLICY "media_select" ON public.media FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "media_insert" ON public.media FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "media_update" ON public.media FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "media_delete" ON public.media FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ============================================================================
-- 4. DATABASE VIEWS
-- ============================================================================

-- -------------------------------------------------------
-- 4a. v_user_stats — aggregate stats per user
-- -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_user_stats AS
SELECT
    p.id                                                AS user_id,
    COALESCE(vis.visited_count, 0)                      AS visited_count,
    COALESCE(vis.countries_explored, 0)                  AS countries_explored,
    COALESCE(vis.states_explored, 0)                     AS states_explored,
    COALESCE(vis.districts_explored, 0)                  AS districts_explored,
    COALESCE(photo.photo_count, 0)                       AS photo_count,
    COALESCE(vid.video_count, 0)                         AS video_count,
    COALESCE(mem.memory_count, 0)                        AS memory_count
FROM public.profiles p
LEFT JOIN LATERAL (
    SELECT
        COUNT(*)                                       AS visited_count,
        COUNT(DISTINCT co.id)                          AS countries_explored,
        COUNT(DISTINCT s.id)                           AS states_explored,
        COUNT(DISTINCT d.id)                           AS districts_explored
    FROM public.visited_places vp
    JOIN public.places pl         ON pl.id  = vp.place_id
    JOIN public.districts d       ON d.id   = pl.district_id
    JOIN public.states s          ON s.id   = d.state_id
    JOIN public.countries co      ON co.id  = s.country_id
    WHERE vp.user_id = p.id
      AND vp.place_id IS NOT NULL
) vis ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS photo_count
    FROM public.media m
    WHERE m.user_id = p.id AND m.type = 'image'
) photo ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS video_count
    FROM public.media m
    WHERE m.user_id = p.id AND m.type = 'video'
) vid ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS memory_count
    FROM public.memories mem2
    WHERE mem2.user_id = p.id
) mem ON true;

COMMENT ON VIEW public.v_user_stats IS 'Aggregated stats for each user: visits, countries, media, memories.';

-- -------------------------------------------------------
-- 4b. v_country_progress — per user × country
-- -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_country_progress AS
SELECT
    p.id                                          AS user_id,
    co.id                                         AS country_id,
    co.name                                       AS country_name,
    co.flag_emoji,
    COUNT(DISTINCT pl.id)                         AS total_places,
    COUNT(DISTINCT vp.place_id)                   AS visited_places
FROM public.profiles p
CROSS JOIN public.countries co
JOIN public.states s       ON s.country_id = co.id
JOIN public.districts d    ON d.state_id   = s.id
JOIN public.places pl      ON pl.district_id = d.id
LEFT JOIN public.visited_places vp
    ON vp.place_id = pl.id AND vp.user_id = p.id
GROUP BY p.id, co.id, co.name, co.flag_emoji;

COMMENT ON VIEW public.v_country_progress IS 'Total vs visited places per user per country.';

-- -------------------------------------------------------
-- 4c. v_state_progress — per user × state
-- -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_state_progress AS
SELECT
    p.id                                          AS user_id,
    s.id                                          AS state_id,
    s.name                                        AS state_name,
    co.id                                         AS country_id,
    co.name                                       AS country_name,
    COUNT(DISTINCT pl.id)                         AS total_places,
    COUNT(DISTINCT vp.place_id)                   AS visited_places
FROM public.profiles p
CROSS JOIN public.states s
JOIN public.countries co   ON co.id = s.country_id
JOIN public.districts d    ON d.state_id = s.id
JOIN public.places pl      ON pl.district_id = d.id
LEFT JOIN public.visited_places vp
    ON vp.place_id = pl.id AND vp.user_id = p.id
GROUP BY p.id, s.id, s.name, co.id, co.name;

COMMENT ON VIEW public.v_state_progress IS 'Total vs visited places per user per state.';

-- -------------------------------------------------------
-- 4d. v_district_progress — per user × district
-- -------------------------------------------------------
CREATE OR REPLACE VIEW public.v_district_progress AS
SELECT
    p.id                                          AS user_id,
    d.id                                          AS district_id,
    d.name                                        AS district_name,
    s.id                                          AS state_id,
    s.name                                        AS state_name,
    co.id                                         AS country_id,
    co.name                                       AS country_name,
    COUNT(DISTINCT pl.id)                         AS total_places,
    COUNT(DISTINCT vp.place_id)                   AS visited_places
FROM public.profiles p
CROSS JOIN public.districts d
JOIN public.states s       ON s.id  = d.state_id
JOIN public.countries co   ON co.id = s.country_id
JOIN public.places pl      ON pl.district_id = d.id
LEFT JOIN public.visited_places vp
    ON vp.place_id = pl.id AND vp.user_id = p.id
GROUP BY p.id, d.id, d.name, s.id, s.name, co.id, co.name;

COMMENT ON VIEW public.v_district_progress IS 'Total vs visited places per user per district.';


-- ============================================================================
-- Done! Schema is ready.
-- ============================================================================
