-- =============================================================================
-- ExploreHub — Temporary: Allow Anon Import
-- =============================================================================
-- Run this BEFORE running the import script if you are using the anon key
-- (i.e. you have NOT set SUPABASE_SERVICE_KEY in .env).
--
-- STEP 1: Run this block
-- =============================================================================

-- Temporarily disable RLS so anon key can insert during import
ALTER TABLE public.places DISABLE ROW LEVEL SECURITY;

-- =============================================================================
-- After the import finishes, run this block (STEP 2) to restore RLS:
-- =============================================================================

-- ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Optional: verify the import worked
-- =============================================================================

-- SELECT category, count(*) FROM places GROUP BY category ORDER BY count DESC;
-- SELECT * FROM places WHERE name ILIKE '%Chennai%' LIMIT 5;
-- SELECT * FROM places WHERE name ILIKE '%Ooty%' OR name ILIKE '%Udhagamandalam%' LIMIT 5;
-- SELECT * FROM places WHERE name ILIKE '%Kodaikanal%' LIMIT 5;
-- SELECT * FROM places WHERE name ILIKE '%Madurai%' LIMIT 5;
-- SELECT * FROM places WHERE name ILIKE '%Coimbatore%' LIMIT 5;
-- SELECT * FROM places WHERE name ILIKE '%Kanyakumari%' LIMIT 5;
