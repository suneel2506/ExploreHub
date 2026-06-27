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
}));
