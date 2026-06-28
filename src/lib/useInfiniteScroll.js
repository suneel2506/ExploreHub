import { useEffect, useRef, useCallback } from 'react';

/**
 * useInfiniteScroll — IntersectionObserver-based infinite scroll hook.
 * Calls `onLoadMore` when the sentinel element becomes visible.
 *
 * Usage:
 *   const sentinelRef = useInfiniteScroll(loadMore, hasMore, loading);
 *   // In JSX: <div ref={sentinelRef} />
 *
 * @param {Function} onLoadMore - Callback to load more items
 * @param {boolean} hasMore - Whether there are more items to load
 * @param {boolean} loading - Whether currently loading
 * @param {number} rootMargin - IntersectionObserver rootMargin (default '200px')
 * @returns {React.RefObject} Ref to attach to a sentinel element
 */
export function useInfiniteScroll(onLoadMore, hasMore, loading, rootMargin = '200px') {
  const sentinelRef = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);

  // Keep callback ref fresh without re-creating observer
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!hasMore || loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !loading) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin, threshold: 0 }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, rootMargin]);

  return sentinelRef;
}
