-- ============================================================================
-- ExploreHub — Migration 004: Nuclear Rebuild
-- ============================================================================
-- Run this in Supabase SQL Editor to completely rebuild the schema.
-- This drops EVERYTHING and rebuilds cleanly.
-- Safe to run on a fresh project (no user data yet).
-- ============================================================================

-- ============================================================================
-- STEP 1: Nuclear drop — everything in dependency order
-- ============================================================================

DROP VIEW  IF EXISTS public.v_user_stats          CASCADE;
DROP VIEW  IF EXISTS public.v_district_progress   CASCADE;
DROP VIEW  IF EXISTS public.v_state_progress      CASCADE;
DROP VIEW  IF EXISTS public.v_country_progress    CASCADE;

DROP TABLE IF EXISTS public.media                 CASCADE;
DROP TABLE IF EXISTS public.memories              CASCADE;
DROP TABLE IF EXISTS public.wishlist              CASCADE;
DROP TABLE IF EXISTS public.visited_places        CASCADE;
DROP TABLE IF EXISTS public.custom_places         CASCADE;
DROP TABLE IF EXISTS public.places                CASCADE;
DROP TABLE IF EXISTS public.districts             CASCADE;
DROP TABLE IF EXISTS public.states                CASCADE;
DROP TABLE IF EXISTS public.countries             CASCADE;

-- ============================================================================
-- STEP 2: PLACES — flat, OSM-sourced
-- ============================================================================

CREATE TABLE public.places (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL,
    description text,
    country     text             NOT NULL DEFAULT 'India',
    state       text,
    district    text,
    city        text,
    category    text             NOT NULL DEFAULT 'Other',
    place_type  text,
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    image_url   text,
    osm_id      bigint           UNIQUE,
    source      text             NOT NULL DEFAULT 'OpenStreetMap',
    metadata    jsonb            DEFAULT '{}'::jsonb,
    created_at  timestamptz      DEFAULT now()
);

-- Full-Text Search column (generated)
ALTER TABLE public.places
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

CREATE INDEX idx_places_fts      ON public.places USING gin(fts);
CREATE INDEX idx_places_category ON public.places(category);
CREATE INDEX idx_places_state    ON public.places(state)    WHERE state    IS NOT NULL;
CREATE INDEX idx_places_district ON public.places(district) WHERE district IS NOT NULL;
CREATE INDEX idx_places_coords   ON public.places(latitude, longitude);
CREATE INDEX idx_places_osm      ON public.places(osm_id)   WHERE osm_id   IS NOT NULL;

-- ============================================================================
-- STEP 3: CUSTOM_PLACES — user-added
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
-- STEP 4: VISITED_PLACES
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
-- STEP 5: WISHLIST
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
-- STEP 6: MEMORIES
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
-- STEP 7: MEDIA
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

-- ============================================================================
-- STEP 8: STATS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW public.v_user_stats AS
SELECT
    p.id AS user_id,

    COALESCE((SELECT COUNT(*) FROM public.visited_places v
              WHERE v.user_id = p.id AND v.place_id IS NOT NULL), 0)        AS visited_count,

    COALESCE((SELECT COUNT(DISTINCT pl.country)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              WHERE v.user_id = p.id), 0)                                    AS countries_explored,

    COALESCE((SELECT COUNT(DISTINCT pl.state)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              WHERE v.user_id = p.id AND pl.state IS NOT NULL), 0)           AS states_explored,

    COALESCE((SELECT COUNT(DISTINCT pl.district)
              FROM public.visited_places v
              JOIN public.places pl ON pl.id = v.place_id
              WHERE v.user_id = p.id AND pl.district IS NOT NULL), 0)        AS districts_explored,

    COALESCE((SELECT COUNT(*) FROM public.media m
              WHERE m.user_id = p.id AND m.type = 'image'), 0)               AS photo_count,

    COALESCE((SELECT COUNT(*) FROM public.media m
              WHERE m.user_id = p.id AND m.type = 'video'), 0)               AS video_count,

    COALESCE((SELECT COUNT(*) FROM public.memories mem
              WHERE mem.user_id = p.id), 0)                                  AS memory_count,

    COALESCE((SELECT COUNT(*) FROM public.custom_places cp
              WHERE cp.user_id = p.id), 0)                                   AS custom_places_count

FROM public.profiles p;

-- ============================================================================
-- STEP 9: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.places         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_places  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visited_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media           ENABLE ROW LEVEL SECURITY;

-- places: authenticated users read; anon can also read (public data)
CREATE POLICY "places_select_auth" ON public.places FOR SELECT TO authenticated USING (true);
CREATE POLICY "places_select_anon" ON public.places FOR SELECT TO anon           USING (true);

-- custom_places
CREATE POLICY "cp_select" ON public.custom_places FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cp_insert" ON public.custom_places FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cp_update" ON public.custom_places FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cp_delete" ON public.custom_places FOR DELETE TO authenticated USING (user_id = auth.uid());

-- visited_places
CREATE POLICY "vp_select" ON public.visited_places FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "vp_insert" ON public.visited_places FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "vp_update" ON public.visited_places FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "vp_delete" ON public.visited_places FOR DELETE TO authenticated USING (user_id = auth.uid());

-- wishlist
CREATE POLICY "wl_select" ON public.wishlist FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wl_insert" ON public.wishlist FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "wl_update" ON public.wishlist FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wl_delete" ON public.wishlist FOR DELETE TO authenticated USING (user_id = auth.uid());

-- memories
CREATE POLICY "mem_select" ON public.memories FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "mem_insert" ON public.memories FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "mem_update" ON public.memories FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "mem_delete" ON public.memories FOR DELETE TO authenticated USING (user_id = auth.uid());

-- media
CREATE POLICY "med_select" ON public.media FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "med_insert" ON public.media FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "med_update" ON public.media FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "med_delete" ON public.media FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- STEP 10: TEMPORARILY ALLOW ANON INSERT FOR OSM IMPORT
-- (Comment this out AFTER the import completes)
-- ============================================================================

CREATE POLICY "places_import_anon"
    ON public.places FOR INSERT TO anon WITH CHECK (true);

-- After import finishes, run:
-- DROP POLICY "places_import_anon" ON public.places;

-- ============================================================================
-- DONE
-- ============================================================================

-- Verify: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- Verify: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'places' ORDER BY ordinal_position;
