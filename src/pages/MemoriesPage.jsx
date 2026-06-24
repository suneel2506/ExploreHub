import React, { useState } from 'react';
import { BookOpen, Plus, MapPin, Star, Edit2, Trash2, Calendar, Image as ImageIcon, Video } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import StarRating from '@/components/ui/StarRating';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import MediaUpload from '@/components/media/MediaUpload';
import MediaGallery from '@/components/media/MediaGallery';
import { useUserDataStore } from '@/store/userDataStore';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/Toast';
import { PLACE_CATEGORIES } from '@/lib/constants';

export default function MemoriesPage() {
  const { memories, addMemory, updateMemory, deleteMemory, media, uploadMedia, deleteMedia, customPlaces } = useUserDataStore();
  const { user } = useAuthStore();
  const toast = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState(null);
  const [viewingMemory, setViewingMemory] = useState(null); // for media gallery view
  const [form, setForm] = useState({ title: '', content: '', rating: 0, visit_date: '', place_id: '', custom_place_id: '' });
  const [pendingMedia, setPendingMedia] = useState([]); // { url, path, type }
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const openNew = () => {
    setEditingMemory(null);
    setForm({ title: '', content: '', rating: 0, visit_date: '', place_id: '', custom_place_id: '' });
    setPendingMedia([]);
    setIsModalOpen(true);
  };

  const openEdit = (memory) => {
    setEditingMemory(memory);
    setForm({
      title:           memory.title          ?? '',
      content:         memory.content        ?? '',
      rating:          memory.rating         ?? 0,
      visit_date:      memory.visit_date      ?? '',
      place_id:        memory.place_id        ?? '',
      custom_place_id: memory.custom_place_id ?? '',
    });
    setPendingMedia([]);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    setLoading(true);
    const payload = {
      title:           form.title     || null,
      content:         form.content   || null,
      rating:          form.rating    || null,
      visit_date:      form.visit_date || null,
      place_id:        form.place_id        || null,
      custom_place_id: form.custom_place_id || null,
    };

    let memoryId;
    if (editingMemory) {
      const { error } = await updateMemory(editingMemory.id, payload);
      if (error) { toast?.toast('Failed to update memory', 'error'); setLoading(false); return; }
      memoryId = editingMemory.id;
      toast?.toast('Memory updated!', 'success');
    } else {
      const { data, error } = await addMemory({ user_id: user.id, ...payload });
      if (error) { toast?.toast('Failed to save memory', 'error'); setLoading(false); return; }
      memoryId = data?.id;
      toast?.toast('Memory saved! 📓', 'success');
    }

    // Attach any uploaded media to the memory
    if (memoryId && pendingMedia.length > 0) {
      for (const m of pendingMedia) {
        await uploadMedia(
          null,
          user.id,
          { memoryId, url: m.url, storagePath: m.path, type: m.type }
        );
      }
    }

    setLoading(false);
    setIsModalOpen(false);
  };

  const handleDelete = async (id) => {
    const { error } = await deleteMemory(id);
    if (!error) toast?.toast('Memory deleted', 'info');
    else        toast?.toast('Failed to delete memory', 'error');
    setDeleteConfirm(null);
  };

  const handleDeleteMedia = async (mediaItem) => {
    await deleteMedia(mediaItem.id, mediaItem.storage_path, mediaItem.bucket);
    toast?.toast('Media deleted', 'info');
  };

  const getMemoryMedia = (memoryId) => media.filter((m) => m.memory_id === memoryId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <PageHeader
        title="Memories"
        subtitle={`${memories.length} journal entr${memories.length !== 1 ? 'ies' : 'y'}`}
        icon={<BookOpen size={20} />}
        actions={
          <Button id="add-memory-btn" icon={<Plus size={16} />} onClick={openNew}>
            New Memory
          </Button>
        }
      />

      <div style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>
        {memories.length === 0 ? (
          <EmptyState
            type="memories"
            title="No memories yet"
            description="Start capturing your travel stories — add photos, videos, ratings, and notes."
            action={<Button icon={<Plus size={15} />} onClick={openNew}>Write a Memory</Button>}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
            {memories.map((memory) => {
              const mMedia = getMemoryMedia(memory.id);
              return (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  mediaItems={mMedia}
                  onEdit={() => openEdit(memory)}
                  onDelete={() => setDeleteConfirm(memory.id)}
                  onViewMedia={() => setViewingMemory(memory)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Memory Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingMemory ? 'Edit Memory' : 'New Memory'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={loading}>
              {editingMemory ? 'Save Changes' : 'Save Memory'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Input
            id="memory-title"
            label="Title"
            placeholder="A memorable sunset at..."
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />

          {/* Link to a place */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              Linked Place (optional)
            </label>
            <select
              value={form.custom_place_id || form.place_id || ''}
              onChange={(e) => {
                const val = e.target.value;
                const isCustom = val.startsWith('custom:');
                setForm((f) => ({
                  ...f,
                  place_id:        isCustom ? '' : val,
                  custom_place_id: isCustom ? val.replace('custom:', '') : '',
                }));
              }}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="">— No linked place —</option>
              {customPlaces.map((p) => (
                <option key={p.id} value={`custom:${p.id}`}>📍 {p.name} (Custom)</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Your Memory</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Write about your experience, what you felt, what you saw..."
              rows={5}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.6, transition: 'border-color 150ms' }}
              onFocus={(e) => e.target.style.borderColor = 'var(--color-border-focus)'}
              onBlur={(e)  => e.target.style.borderColor = 'var(--color-border)'}
            />
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>Rating</label>
              <StarRating value={form.rating} onChange={(r) => setForm((f) => ({ ...f, rating: r }))} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Input
                id="memory-date"
                label="Visit Date"
                type="date"
                value={form.visit_date}
                onChange={(e) => setForm((f) => ({ ...f, visit_date: e.target.value }))}
                icon={<Calendar size={14} />}
              />
            </div>
          </div>

          {/* Media upload section */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 10 }}>
              Photos & Videos
            </label>
            <MediaUpload
              userId={user?.id}
              onUploaded={(item) => setPendingMedia((prev) => [...prev, item])}
              maxPhotos={10}
              maxVideos={3}
            />
          </div>
        </div>
      </Modal>

      {/* Media Gallery View Modal */}
      {viewingMemory && (
        <Modal
          isOpen={!!viewingMemory}
          onClose={() => setViewingMemory(null)}
          title={viewingMemory.title || 'Memory Media'}
          size="lg"
          footer={<Button variant="ghost" onClick={() => setViewingMemory(null)}>Close</Button>}
        >
          <MediaGallery
            items={getMemoryMedia(viewingMemory.id)}
            onDelete={handleDeleteMedia}
          />
          {getMemoryMedia(viewingMemory.id).length === 0 && (
            <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', textAlign: 'center', padding: '20px 0' }}>
              No photos or videos attached to this memory yet.
            </p>
          )}
        </Modal>
      )}

      {/* Delete Confirm */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Memory"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
          </>
        }
      >
        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          Are you sure you want to delete this memory? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function MemoryCard({ memory, mediaItems, onEdit, onDelete, onViewMedia }) {
  const place       = memory.places;
  const customPlace = memory.custom_places;
  const linkedPlace = place || customPlace;
  const photoCount  = mediaItems.filter((m) => m.type === 'image').length;
  const videoCount  = mediaItems.filter((m) => m.type === 'video').length;
  const coverPhoto  = mediaItems.find((m) => m.type === 'image');

  return (
    <div
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 200ms, transform 200ms' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-hover)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)';       e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Cover photo */}
      {coverPhoto && (
        <div style={{ height: 140, overflow: 'hidden', cursor: 'pointer' }} onClick={onViewMedia}>
          <img src={coverPhoto.url} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {memory.title && (
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {memory.title}
              </h3>
            )}
            {memory.visit_date && (
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Calendar size={10} />
                {new Date(memory.visit_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button onClick={onEdit}   style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px', display: 'flex', transition: 'color 150ms' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}><Edit2 size={14} /></button>
            <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px', display: 'flex', transition: 'color 150ms' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}><Trash2 size={14} /></button>
          </div>
        </div>

        {/* Content snippet */}
        {memory.content && (
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.6, fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            "{memory.content}"
          </p>
        )}

        {/* Footer */}
        <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {linkedPlace && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--color-text-muted)', flex: 1, overflow: 'hidden', minWidth: 0 }}>
              <MapPin size={11} />
              <Badge category={linkedPlace.category} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkedPlace.name}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
            {(photoCount > 0 || videoCount > 0) && (
              <button onClick={onViewMedia} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-sm)', transition: 'color 150ms' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-muted)'}>
                {photoCount > 0 && <><ImageIcon size={11} /> {photoCount}</>}
                {videoCount > 0 && <><Video size={11} style={{ marginLeft: photoCount > 0 ? 4 : 0 }} /> {videoCount}</>}
              </button>
            )}
            {memory.rating && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: '#F59E0B' }}>
                <Star size={11} fill="#F59E0B" /> {memory.rating}/10
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
