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

  /** Fetch first page of places with filters */
  fetchPlaces: async (filters = {}, reset = true) => {
    if (!supabase) return;
    const currentPage = reset ? 0 : get().page;
    if (!reset && !get().hasMore) return;

    set({ loading: true, error: null, ...(reset ? { places: [], page: 0, hasMore: true } : {}) });

    const from = currentPage * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let query = supabase
      .from('places')
      .select('id,name,description,country,state,district,city,category,place_type,latitude,longitude,image_url,osm_id,source', { count: 'exact' })
      .range(from, to);

    // Category filter
    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    // Full-text search
    if (filters.search && filters.search.trim()) {
      query = query.textSearch('fts', filters.search.trim(), {
        type: 'websearch',
        config: 'simple',
      });
    }

    // State filter
    if (filters.state) {
      query = query.ilike('state', `%${filters.state}%`);
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

    const newPlaces = reset ? (data ?? []) : [...get().places, ...(data ?? [])];
    set({
      places:     newPlaces,
      totalCount: count ?? 0,
      page:       currentPage + 1,
      hasMore:    (data ?? []).length === PAGE_SIZE,
      loading:    false,
    });
  },

  /** Load next page (pagination) */
  loadMore: async (filters = {}) => {
    return get().fetchPlaces(filters, false);
  },

  /** Fetch custom places for current user, merged into explore */
  fetchCustomPlaces: async (userId, filters = {}) => {
    if (!supabase || !userId) return;
    let query = supabase
      .from('custom_places')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (filters.search && filters.search.trim()) {
      query = query.textSearch('fts', filters.search.trim(), {
        type: 'websearch',
        config: 'simple',
      });
    }
    if (filters.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    const { data } = await query;
    set({ customPlaces: (data ?? []).map((p) => ({ ...p, _isCustom: true })) });
  },

  /** Fetch places within a map bounding box */
  fetchPlacesByBounds: async (bounds, limit = 500) => {
    if (!supabase) return [];
    const { data } = await supabase
      .from('places')
      .select('id,name,category,latitude,longitude,image_url,state,district')
      .gte('latitude',  bounds.south)
      .lte('latitude',  bounds.north)
      .gte('longitude', bounds.west)
      .lte('longitude', bounds.east)
      .limit(limit);
    return data ?? [];
  },

  resetPlaces: () => set({ places: [], page: 0, hasMore: true, totalCount: 0 }),
}));
