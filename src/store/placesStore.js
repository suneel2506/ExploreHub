import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { PAGE_SIZE } from '@/lib/constants';

export const usePlacesStore = create((set, get) => ({
  places: [],
  customPlaces: [],
  totalCount: 0,
  page: 0,
  hasMore: true,
  loading: false,
  searching: false,
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

    set({ loading: true, error: null, ...(reset ? { places: [], page: 0, hasMore: true, searchContext: null } : {}) });

    const from = currentPage * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let query = supabase
      .from('v_places_full')
      .select(
        'id,name,description,category,place_type,latitude,longitude,image_url,wiki_url,osm_id,source,' +
        'city_id,city_name,district_id,district_name,state_id,state_name,state_code,' +
        'country_id,country_name,country_code,country_flag',
        { count: 'exact' }
      )
      .range(from, to);

    // Category filter
    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    // Smart location-aware search
    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim();

      // Check if search term matches a city, district, or state
      // Use OR across the denormalized view columns
      query = query.or(
        [
          `name.ilike.%${term}%`,
          `city_name.ilike.%${term}%`,
          `district_name.ilike.%${term}%`,
          `state_name.ilike.%${term}%`,
        ].join(',')
      );
    }

    // Sort
    if (filters.sort === 'name_desc') {
      query = query.order('name', { ascending: false });
    } else if (filters.sort === 'recent') {
      query = query.order('created_at', { ascending: false });
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
    if (filters.search && filters.search.trim() && data && data.length > 0) {
      const term = filters.search.trim().toLowerCase();

      // Check if most results share a common city/district/state
      const cityMatch    = data.find(p => p.city_name?.toLowerCase() === term);
      const districtMatch = data.find(p => p.district_name?.toLowerCase() === term);
      const stateMatch   = data.find(p => p.state_name?.toLowerCase() === term);

      if (cityMatch) {
        searchContext = { type: 'city', name: cityMatch.city_name, id: cityMatch.city_id };
      } else if (districtMatch) {
        searchContext = { type: 'district', name: districtMatch.district_name, id: districtMatch.district_id };
      } else if (stateMatch) {
        searchContext = { type: 'state', name: stateMatch.state_name, id: stateMatch.state_id };
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
      .ilike('name', `%${term}%`)
      .not('latitude', 'is', null)
      .limit(1);

    if (cities && cities.length > 0 && cities[0].latitude) {
      return { lat: cities[0].latitude, lon: cities[0].longitude, name: cities[0].name, type: 'city', zoom: 12 };
    }

    // Try districts
    const { data: districtPlaces } = await supabase
      .from('v_places_full')
      .select('latitude,longitude,district_name')
      .ilike('district_name', `%${term}%`)
      .limit(1);

    if (districtPlaces && districtPlaces.length > 0) {
      return { lat: districtPlaces[0].latitude, lon: districtPlaces[0].longitude, name: districtPlaces[0].district_name, type: 'district', zoom: 10 };
    }

    // Try states
    const { data: statePlaces } = await supabase
      .from('v_places_full')
      .select('latitude,longitude,state_name')
      .ilike('state_name', `%${term}%`)
      .limit(1);

    if (statePlaces && statePlaces.length > 0) {
      return { lat: statePlaces[0].latitude, lon: statePlaces[0].longitude, name: statePlaces[0].state_name, type: 'state', zoom: 7 };
    }

    // Try place name directly
    const { data: directPlaces } = await supabase
      .from('v_places_full')
      .select('latitude,longitude,name')
      .ilike('name', `%${term}%`)
      .limit(1);

    if (directPlaces && directPlaces.length > 0) {
      return { lat: directPlaces[0].latitude, lon: directPlaces[0].longitude, name: directPlaces[0].name, type: 'place', zoom: 14 };
    }

    return null;
  },

  resetPlaces: () => set({ places: [], page: 0, hasMore: true, totalCount: 0, searchContext: null }),
}));
