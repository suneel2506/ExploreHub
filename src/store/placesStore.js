import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { PAGE_SIZE } from '@/lib/constants';
import { discoverAndInsert } from '@/lib/discover';

export const usePlacesStore = create((set, get) => ({
  places: [],
  customPlaces: [],
  totalCount: 0,
  page: 0,
  hasMore: true,
  loading: false,
  searching: false,
  discovering: false, // True while auto-discovering new places from OSM
  error: null,

  // Search context — when a search matches a city/state/district, store it for display
  searchContext: null, // { type: 'city'|'state'|'district', name, id }

  /**
   * Fetch places with filters using the v_places_full view.
   * Smart search: resolves city/state/district names and returns all places within.
   * reset=true clears existing results (new search).
   */
  fetchPlaces: async (filters = {}, reset = true) => {
    if (!supabase) return;
    const currentPage = reset ? 0 : get().page;
    if (!reset && !get().hasMore) return;

    set({ loading: true, error: null, ...(reset ? {  page: 0, hasMore: true, searchContext: null } : {}) });

    const from = currentPage * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let query = supabase
    .from('v_places_full')
    .select(`
        id,
        name,
        description,
        category,
        place_type,
        latitude,
        longitude,
        image_url,
        wiki_url,
  
        city_id,
        city_name,
  
        district_id,
        district_name,
  
        state_id,
        state_name,
  
        country_name,
        country_flag,

        wikidata_id,
        wikipedia_title,
        aliases,
        heritage_status,
        image_source
    `, { count: "exact" })
      .range(from, to);

    // Category filter
    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    // Smart location-aware search
    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim();

// 1. City
const { data: city } = await supabase
    .from("cities")
    .select("id")
    .ilike("name", term)
    .limit(1);

if (city && city.length) {

    query = query.eq("city_id", city[0].id);

} else {

    // 2. District
    const { data: district } = await supabase
        .from("districts")
        .select("id")
        .ilike("name", term)
        .limit(1);

    if (district && district.length) {

        query = query.eq("district_id", district[0].id);

    } else {

        // 3. State
        const { data: state } = await supabase
            .from("states")
            .select("id")
            .ilike("name", term)
            .limit(1);

        if (state && state.length) {

            query = query.eq("state_id", state[0].id);

        } else {

            // 4. Place name
            query = query.ilike("name", `%${term}%`);

        }
    }
}
    }
     

    // Sort
    if (filters.sort === 'name_desc') {
      query = query.order('name', { ascending: false });
    } else if (filters.sort === 'recent') {
      query = query.order('name', { ascending: false });
    } else {
      query = query.order('name', { ascending: true });
    }

    const { data, count, error } = await query;

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    // Detect search context for UI display
    let searchContext = null;

    if (data && data.length > 0) {
      const first = data[0];
    
      if (first.city_name) {
        searchContext = {
          type: "city",
          name: first.city_name,
          id: first.city_id
        };
      } else if (first.district_name) {
        searchContext = {
          type: "district",
          name: first.district_name,
          id: first.district_id
        };
      } else if (first.state_name) {
        searchContext = {
          type: "state",
          name: first.state_name,
          id: first.state_id
        };
      }
    }

    const newPlaces = reset ? (data ?? []) : [...get().places, ...(data ?? [])];
    set({
      places:        newPlaces,
      totalCount:    count ?? 0,
      page:          currentPage + 1,
      hasMore:       (data ?? []).length === PAGE_SIZE,
      loading:       false,
      searchContext,
    });
  },

  /** Load next page */
  loadMore: async (filters = {}) => {
    return get().fetchPlaces(filters, false);
  },

  /** Fetch custom places for current user */
  fetchCustomPlaces: async (userId, filters = {}) => {
    if (!supabase || !userId) return;
    let query = supabase
      .from('custom_places')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim();
      query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%,district.ilike.%${term}%,state.ilike.%${term}%`);
    }
    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    const { data } = await query;
    set({ customPlaces: (data ?? []).map((p) => ({ ...p, _isCustom: true })) });
  },

  /** Fetch places within a map bounding box using the v_places_full view */
  fetchPlacesByBounds: async (bounds, limit = 500) => {
    if (!supabase) return [];
    const { data } = await supabase
      .from('v_places_full')
      .select('id,name,category,latitude,longitude,image_url,state_name,district_name,city_name')
      .gte('latitude',  bounds.south)
      .lte('latitude',  bounds.north)
      .gte('longitude', bounds.west)
      .lte('longitude', bounds.east)
      .limit(limit);
    return data ?? [];
  },

  /**
   * Resolve a location name (city/state/district) to coordinates.
   * Used by MapPage to fly-to searched locations.
   */
  resolveLocation: async (searchTerm) => {
    if (!supabase || !searchTerm?.trim()) return null;
    const term = searchTerm.trim();

    // Try cities first (most specific)
    const { data: cities } = await supabase
      .from('cities')
      .select('id,name,latitude,longitude')
      .ilike("name", term)
      .not('latitude', 'is', null)
      .single();

if (cities && cities.latitude) {
    return {
        lat: cities.latitude,
        lon: cities.longitude,
        name: cities.name,
        type: "city",
        zoom: 12
    };
}

    // Try districts
    const { data: districtPlaces } = await supabase
      .from('v_places_full')
      .select('latitude,longitude,district_name')
      .ilike('district_name', term)
      .single();

      if (districtPlaces) {
        return {
            lat: districtPlaces.latitude,
            lon: districtPlaces.longitude,
            name: districtPlaces.district_name,
            type: "district",
            zoom: 10
        };
    }

    // Try states
    const { data: statePlaces } = await supabase
      .from('v_places_full')
      .select('latitude,longitude,state_name')
      .ilike('state_name', term)
      .single();

      if(statePlaces){

        return{
        
        lat:statePlaces.latitude,
        
        lon:statePlaces.longitude,
        
        name:statePlaces.state_name,
        
        type:"state",
        
        zoom:7
        
        };
        
        }

    // Try place name directly
    const { data: directPlaces } = await supabase
      .from('v_places_full')
      .select('latitude,longitude,name')
      .ilike('name', term)
      .single();
      if(directPlaces){

        return{
        
        lat:directPlaces.latitude,
        
        lon:directPlaces.longitude,
        
        name:directPlaces.name,
        
        type:"place",
        
        zoom:14
        
        };
        
        }

    return null;
  },

  resetPlaces: () => set({ places: [], page: 0, hasMore: true, totalCount: 0, searchContext: null }),

  /**
   * Discover new places near a location using OSM Overpass API.
   * Deduplicates against existing places and inserts only new ones.
   * After discovery, re-fetches places to show the new results.
   * 
   * @param {number} lat - Latitude to search around
   * @param {number} lon - Longitude to search around
   * @param {Object} filters - Current search filters (to re-fetch after discovery)
   * @returns {Promise<{discovered: number, inserted: number}>}
   */
  discoverPlaces: async (lat, lon, filters = {}) => {
    if (!supabase) return { discovered: 0, inserted: 0 };
    set({ discovering: true });

    try {
      const result = await discoverAndInsert(lat, lon, 25000);
      console.log(`[discover] Found ${result.discovered}, ${result.duplicates} dupes, inserted ${result.inserted}`);

      // Re-fetch places to include newly discovered ones
      if (result.inserted > 0) {
        await get().fetchPlaces(filters, true);
      }

      set({ discovering: false });
      return { discovered: result.discovered, inserted: result.inserted };
    } catch (err) {
      console.error('[discover] Error:', err.message);
      set({ discovering: false });
      return { discovered: 0, inserted: 0 };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // NEW: Enhanced search using search_places_v2 RPC (cursor-paginated)
  // These methods complement the existing fetchPlaces — they do NOT replace it.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Search using the v2 RPC with cursor pagination.
   * Falls back to existing fetchPlaces if RPC is not available.
   * @param {string} query - Search query
   * @param {Object} filters - { category, state }
   * @param {boolean} reset - Reset results (true) or append (false)
   */
  searchPlacesV2: async (query, filters = {}, reset = true) => {
    if (!supabase) return;
    const state = get();

    if (reset) {
      set({ loading: true, searching: true, error: null, page: 0, hasMore: true, searchContext: null });
    } else {
      if (!state.hasMore) return;
      set({ loading: true });
    }

    try {
      // Build cursor from last item
      const lastPlace = !reset && state.places.length > 0
        ? state.places[state.places.length - 1]
        : null;

      const { data, error } = await supabase.rpc('search_places_v2', {
        p_query: query || '',
        p_category: filters.category && filters.category !== 'all' ? filters.category : null,
        p_state: filters.state || null,
        p_cursor_name: lastPlace?.name || null,
        p_cursor_id: lastPlace?.id || null,
        p_page_size: PAGE_SIZE,
      });

      if (error) {
        // Fallback to existing search if RPC not available
        console.warn('[placesStore] search_places_v2 RPC not available, falling back:', error.message);
        return get().fetchPlaces({ search: query, ...filters }, reset);
      }

      const newPlaces = reset ? (data ?? []) : [...state.places, ...(data ?? [])];

      // Detect search context from results
      let searchContext = null;
      if (data?.length > 0) {
        const first = data[0];
        if (first.match_type === 'state' && first.state_name) {
          searchContext = { type: 'state', name: first.state_name, id: first.state_id };
        } else if (first.match_type === 'district' && first.district_name) {
          searchContext = { type: 'district', name: first.district_name, id: first.district_id };
        } else if (first.match_type === 'city' && first.city_name) {
          searchContext = { type: 'city', name: first.city_name, id: first.city_id };
        }
      }

      set({
        places: newPlaces,
        totalCount: newPlaces.length, // Cursor pagination doesn't have exact count
        page: (state.page || 0) + 1,
        hasMore: (data ?? []).length === PAGE_SIZE,
        loading: false,
        searching: false,
        searchContext,
      });
    } catch (err) {
      set({ loading: false, searching: false, error: err.message });
    }
  },

  /**
   * Fetch multiple images for a place from place_images table.
   * @param {string} placeId - Place UUID
   * @returns {Promise<Array>} Array of image objects
   */
  fetchPlaceImages: async (placeId) => {
    if (!supabase || !placeId) return [];
    const { data } = await supabase
      .from('place_images')
      .select('id, url, source, is_primary, priority, attribution')
      .eq('place_id', placeId)
      .order('priority', { ascending: true });
    return data || [];
  },

  /**
   * Fetch tags for a place from place_tags + categories.
   * @param {string} placeId - Place UUID
   * @returns {Promise<Array>} Array of tag objects with name, emoji, group
   */
  fetchPlaceTags: async (placeId) => {
    if (!supabase || !placeId) return [];
    const { data } = await supabase
      .from('place_tags')
      .select('category_id, categories(id, name, slug, emoji, "group")')
      .eq('place_id', placeId);
    return (data || []).map(t => t.categories).filter(Boolean);
  },
}));
