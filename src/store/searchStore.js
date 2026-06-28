import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

/**
 * searchStore — Dedicated search store for debounced search, suggestions,
 * and search history. Complements the existing placesStore without modifying it.
 */
export const useSearchStore = create((set, get) => ({
  // Search suggestions
  suggestions: [],
  suggestionsLoading: false,
  suggestionsQuery: '',

  // Search history (last 10 searches, persisted in localStorage)
  searchHistory: (() => {
    try {
      const saved = localStorage.getItem('explorehub_search_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  })(),

  // Place detail (enriched)
  placeDetail: null,
  placeDetailLoading: false,

  /**
   * Fetch search suggestions (lightweight autocomplete).
   * Uses the search_suggestions RPC for speed.
   * @param {string} query - Search query (min 2 chars)
   */
  fetchSuggestions: async (query) => {
    if (!supabase) return;
    const trimmed = (query || '').trim();

    if (trimmed.length < 2) {
      set({ suggestions: [], suggestionsQuery: '' });
      return;
    }

    set({ suggestionsLoading: true, suggestionsQuery: trimmed });

    try {
      const { data, error } = await supabase.rpc('search_suggestions', {
        p_query: trimmed,
        p_limit: 8,
      });

      // Only update if query hasn't changed during fetch
      if (get().suggestionsQuery === trimmed) {
        if (error) {
          // Fallback to simple ILIKE if RPC not available
          const { data: fallback } = await supabase
            .from('v_places_full')
            .select('id, name, category, city_name, state_name')
            .ilike('name', `%${trimmed}%`)
            .limit(8);

          set({
            suggestions: (fallback || []).map(p => ({
              ...p,
              match_type: 'fuzzy',
              relevance: 0.5,
            })),
            suggestionsLoading: false,
          });
        } else {
          set({ suggestions: data || [], suggestionsLoading: false });
        }
      }
    } catch {
      set({ suggestions: [], suggestionsLoading: false });
    }
  },

  clearSuggestions: () => set({ suggestions: [], suggestionsQuery: '' }),

  /**
   * Add a query to search history.
   * Keeps last 10 unique queries, persisted in localStorage.
   */
  addToHistory: (query) => {
    const trimmed = (query || '').trim();
    if (!trimmed || trimmed.length < 2) return;

    const history = get().searchHistory.filter(h => h !== trimmed);
    history.unshift(trimmed);
    const updated = history.slice(0, 10);

    set({ searchHistory: updated });
    try { localStorage.setItem('explorehub_search_history', JSON.stringify(updated)); }
    catch { /* localStorage full or unavailable */ }
  },

  clearHistory: () => {
    set({ searchHistory: [] });
    try { localStorage.removeItem('explorehub_search_history'); } catch {}
  },

  /**
   * Fetch enriched place detail using get_place_detail RPC.
   * Returns full place data with descriptions, images, tags, metadata.
   * @param {string} placeId - Place UUID
   */
  fetchPlaceDetail: async (placeId) => {
    if (!supabase || !placeId) return null;
    set({ placeDetailLoading: true });

    try {
      const { data, error } = await supabase.rpc('get_place_detail', {
        p_place_id: placeId,
      });

      if (error) {
        console.warn('[searchStore] get_place_detail RPC error:', error.message);
        set({ placeDetail: null, placeDetailLoading: false });
        return null;
      }

      set({ placeDetail: data, placeDetailLoading: false });
      return data;
    } catch (err) {
      console.warn('[searchStore] fetchPlaceDetail error:', err.message);
      set({ placeDetail: null, placeDetailLoading: false });
      return null;
    }
  },

  clearPlaceDetail: () => set({ placeDetail: null }),
}));
