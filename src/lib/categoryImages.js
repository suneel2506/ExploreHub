// =============================================================================
// Category Images — Fallback illustrations for places without real images
// =============================================================================
// Returns a data URL SVG with the category emoji + gradient background.
// Used when place.image_url is null or broken.

import { CATEGORY_COLORS } from '@/lib/constants';

/**
 * Category emoji map — used for fallback image generation.
 */
const CATEGORY_EMOJI = {
  Waterfalls:         '💧',
  Temples:            '🛕',
  Beaches:            '🏖️',
  Mountains:          '⛰️',
  Forests:            '🌲',
  Historical:         '🏛️',
  Forts:              '🏰',
  Wildlife:           '🐘',
  Lakes:              '🏞️',
  Caves:              '🪨',
  Parks:              '🌿',
  'National Parks':   '🏕️',
  Museums:            '🏫',
  Attractions:        '⭐',
  Viewpoints:         '🔭',
  Mosques:            '🕌',
  Churches:           '⛪',
  Gurudwaras:         '🙏',
  Monasteries:        '🧘',
  Dams:               '🌊',
  Islands:            '🏝️',
  Bridges:            '🌉',
  Airports:           '✈️',
  'Railway Stations': '🚂',
  'Bus Stations':     '🚌',
  Monuments:          '🗿',
  Hotels:             '🏨',
  Restaurants:        '🍴',
  Cities:             '🏙️',
  Villages:           '🏘️',
  UNESCO:             '🏆',
  Adventure:          '🧗',
  Photography:        '📸',
  Camping:            '⛺',
  Family:             '👨‍👩‍👧‍👦',
  Nightlife:          '🌃',
  Food:               '🍽️',
  Shopping:           '🛍️',
  Other:              '📍',
};

/**
 * Generate a fallback image URL for a category.
 * Returns a data: URL SVG with emoji + gradient.
 */
export function getCategoryImage(category) {
  const emoji = CATEGORY_EMOJI[category] || '📍';
  const color = CATEGORY_COLORS[category] || '#6B7280';

  // Create a lighter shade for gradient
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const lighter = `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`;
  const darker = `rgb(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)})`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${darker}"/>
        <stop offset="100%" style="stop-color:${lighter}"/>
      </linearGradient>
    </defs>
    <rect width="400" height="300" fill="url(#bg)" rx="8"/>
    <text x="200" y="150" text-anchor="middle" dominant-baseline="central" font-size="72">${emoji}</text>
    <text x="200" y="210" text-anchor="middle" dominant-baseline="central" font-size="14" fill="rgba(255,255,255,0.7)" font-family="system-ui, sans-serif">${category || 'Place'}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Check if a URL is a valid image (not a placeholder or empty).
 */
export function isValidImageUrl(url) {
  if (!url) return false;
  if (url.includes('placeholder')) return false;
  if (url.length < 10) return false;
  return true;
}

/**
 * Get the best image URL for a place: real image or category fallback.
 */
export function getPlaceImage(place) {
  if (isValidImageUrl(place?.image_url)) return place.image_url;
  return getCategoryImage(place?.category);
}
