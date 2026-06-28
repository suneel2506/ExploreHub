import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useDebounce — Debounces a value by the given delay.
 * Returns the debounced value that only updates after `delay` ms of inactivity.
 *
 * @param {*} value - The value to debounce
 * @param {number} delay - Debounce delay in milliseconds (default 300)
 * @returns {*} The debounced value
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useDebouncedCallback — Debounces a callback function.
 * The returned function will only execute after `delay` ms of inactivity.
 *
 * @param {Function} callback - The function to debounce
 * @param {number} delay - Debounce delay in milliseconds (default 300)
 * @returns {Function} The debounced callback
 */
export function useDebouncedCallback(callback, delay = 300) {
  const timerRef = useRef(null);

  const debouncedFn = useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return debouncedFn;
}
