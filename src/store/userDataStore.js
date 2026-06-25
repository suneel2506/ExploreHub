import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { uploadPhoto, uploadVideo, deleteStorageFile } from '@/lib/storage';

export const useUserDataStore = create((set, get) => ({
  visitedPlaces: [],
  wishlist: [],
  memories: [],
  media: [],
  customPlaces: [],
  stats: null,
  loading: false,

  // ─── Bootstrap ──────────────────────────────────────────────────────────────

  fetchUserData: async (userId) => {
    if (!supabase || !userId) return;
    set({ loading: true });

    const [visited, wish, mems, med, custom, statsRes] = await Promise.all([
      supabase
        .from('visited_places')
        .select(`*, places(id,name,category,image_url,city_id)`)
        .eq('user_id', userId),
      supabase
        .from('wishlist')
        .select(`*, places(id,name,category,image_url,city_id)`)
        .eq('user_id', userId),
      supabase
        .from('memories')
        .select('*, places(id,name,image_url,category), custom_places(id,name,category)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('media')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('custom_places')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('v_user_stats')
        .select('*')
        .eq('user_id', userId)
        .single(),
    ]);

    set({
      visitedPlaces: visited.data  ?? [],
      wishlist:      wish.data     ?? [],
      memories:      mems.data     ?? [],
      media:         med.data      ?? [],
      customPlaces:  custom.data   ?? [],
      stats:         statsRes.data ?? null,
      loading: false,
    });
  },

  // ─── Visited ────────────────────────────────────────────────────────────────

  markVisited: async (userId, placeId, { rating, notes } = {}, isCustom = false) => {
    if (!supabase) return { error: new Error('Not configured') };
    const payload = {
      user_id:  userId,
      rating:   rating || null,
      notes:    notes  || null,
      visited_at: new Date().toISOString(),
    };
    if (isCustom) payload.custom_place_id = placeId;
    else          payload.place_id = placeId;

    const conflictCol = isCustom ? 'user_id,custom_place_id' : 'user_id,place_id';
    const { data, error } = await supabase
      .from('visited_places')
      .upsert(payload, { onConflict: conflictCol })
      .select('*, places(id,name,category,image_url)')
      .single();

    if (!error && data) {
      const key = isCustom ? 'custom_place_id' : 'place_id';
      set((s) => ({
        visitedPlaces: [
          ...s.visitedPlaces.filter((v) => v[key] !== placeId),
          data,
        ],
      }));
    }
    return { error };
  },

  unmarkVisited: async (userId, placeId, isCustom = false) => {
    if (!supabase) return { error: null };
    const col = isCustom ? 'custom_place_id' : 'place_id';
    const { error } = await supabase
      .from('visited_places')
      .delete()
      .eq('user_id', userId)
      .eq(col, placeId);
    if (!error) {
      set((s) => ({ visitedPlaces: s.visitedPlaces.filter((v) => v[col] !== placeId) }));
    }
    return { error };
  },

  // ─── Wishlist ────────────────────────────────────────────────────────────────

  addToWishlist: async (userId, placeId, isCustom = false) => {
    if (!supabase) return { error: new Error('Not configured') };
    const payload = { user_id: userId };
    if (isCustom) payload.custom_place_id = placeId;
    else          payload.place_id = placeId;

    const conflictCol = isCustom ? 'user_id,custom_place_id' : 'user_id,place_id';
    const { data, error } = await supabase
      .from('wishlist')
      .upsert(payload, { onConflict: conflictCol })
      .select('*, places(id,name,category,image_url)')
      .single();

    if (!error && data) {
      set((s) => ({ wishlist: [...s.wishlist.filter((w) => w.place_id !== placeId && w.custom_place_id !== placeId), data] }));
    }
    return { error };
  },

  removeFromWishlist: async (userId, placeId, isCustom = false) => {
    if (!supabase) return { error: null };
    const col = isCustom ? 'custom_place_id' : 'place_id';
    const { error } = await supabase
      .from('wishlist')
      .delete()
      .eq('user_id', userId)
      .eq(col, placeId);
    if (!error) {
      set((s) => ({ wishlist: s.wishlist.filter((w) => w[col] !== placeId) }));
    }
    return { error };
  },

  // ─── Memories ────────────────────────────────────────────────────────────────

  addMemory: async (memory) => {
    if (!supabase) return { data: null, error: new Error('Not configured') };
    const { data, error } = await supabase
      .from('memories')
      .insert(memory)
      .select('*, places(id,name,image_url,category), custom_places(id,name,category)')
      .single();
    if (!error && data) {
      set((s) => ({ memories: [data, ...s.memories] }));
    }
    return { data, error };
  },

  updateMemory: async (id, updates) => {
    if (!supabase) return { error: new Error('Not configured') };
    const { data, error } = await supabase
      .from('memories')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, places(id,name,image_url,category), custom_places(id,name,category)')
      .single();
    if (!error && data) {
      set((s) => ({ memories: s.memories.map((m) => (m.id === id ? data : m)) }));
    }
    return { error };
  },

  deleteMemory: async (id) => {
    if (!supabase) return { error: null };
    const { error } = await supabase.from('memories').delete().eq('id', id);
    if (!error) {
      set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
    }
    return { error };
  },

  // ─── Media ──────────────────────────────────────────────────────────────────

  /**
   * Save a media record. Accepts either a real File to upload, or
   * pre-uploaded { url, storagePath, type } from the MediaUpload component.
   */
  uploadMedia: async (file, userId, { memoryId, placeId, customPlaceId, caption, url: preUrl, storagePath: prePath, type: preType, thumbnailUrl: preThumbnail } = {}) => {
    if (!supabase) return { data: null, error: new Error('Not configured') };

    let url = preUrl;
    let storagePath = prePath;
    let thumbnailUrl = preThumbnail || null;
    let isVideo = preType === 'video' || (file?.type ?? '').startsWith('video/');
    let bucket = isVideo ? 'videos' : 'photos';

    // Upload if no pre-existing URL
    if (!url && file && file.size > 0) {
      const result = await (isVideo ? uploadVideo : uploadPhoto)(file, userId);
      if (result.error) return { data: null, error: result.error };
      url = result.url;
      storagePath = result.path;
      thumbnailUrl = result.thumbnailUrl || null;
    }

    if (!url) return { data: null, error: new Error('No URL to store') };

    const payload = {
      user_id:         userId,
      type:            isVideo ? 'video' : 'image',
      url,
      storage_path:    storagePath || null,
      bucket,
      thumbnail_url:   thumbnailUrl,
      caption:         caption        || null,
      file_size:       file?.size     || null,
      memory_id:       memoryId       || null,
      place_id:        placeId        || null,
      custom_place_id: customPlaceId  || null,
    };

    const { data, error } = await supabase.from('media').insert(payload).select().single();
    if (!error && data) set((s) => ({ media: [data, ...s.media] }));
    return { data, error };
  },

  deleteMedia: async (mediaId, storagePath, bucket) => {
    if (!supabase) return { error: null };
    await deleteStorageFile(bucket || 'photos', storagePath);
    const { error } = await supabase.from('media').delete().eq('id', mediaId);
    if (!error) {
      set((s) => ({ media: s.media.filter((m) => m.id !== mediaId) }));
    }
    return { error };
  },

  getMediaForMemory: (memoryId) => {
    return get().media.filter((m) => m.memory_id === memoryId);
  },

  getMediaForPlace: (placeId) => {
    return get().media.filter((m) => m.place_id === placeId);
  },

  // ─── Custom Places ────────────────────────────────────────────────────────────

  addCustomPlace: async (place) => {
    if (!supabase) return { data: null, error: new Error('Not configured') };
    const { data, error } = await supabase
      .from('custom_places')
      .insert(place)
      .select()
      .single();
    if (!error && data) {
      set((s) => ({ customPlaces: [data, ...s.customPlaces] }));
    }
    return { data, error };
  },

  updateCustomPlace: async (id, updates) => {
    if (!supabase) return { error: new Error('Not configured') };
    const { data, error } = await supabase
      .from('custom_places')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (!error && data) {
      set((s) => ({ customPlaces: s.customPlaces.map((p) => (p.id === id ? data : p)) }));
    }
    return { error };
  },

  deleteCustomPlace: async (id) => {
    if (!supabase) return { error: null };
    const { error } = await supabase.from('custom_places').delete().eq('id', id);
    if (!error) {
      set((s) => ({ customPlaces: s.customPlaces.filter((p) => p.id !== id) }));
    }
    return { error };
  },
}));
