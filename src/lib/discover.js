/**
 * ExploreHub — On-demand Place Discovery via OSM Overpass API
 * 
 * Discovers new tourist places near a location using OpenStreetMap's Overpass API.
 * Deduplicates against existing places in Supabase before inserting.
 * 
 * Used by the search enhancement: when a search returns few results,
 * this module can discover additional places in that area.
 */

import { supabase } from './supabase';

// ─── Overpass API endpoint ────────────────────────────────────────────────────
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ─── Tourism-related OSM tags to search for ──────────────────────────────────
// These match the categories used by the existing importer (import-osm-v2.cjs)
const OVERPASS_QUERY_TEMPLATE = `
[out:json][timeout:30];
(
  node["tourism"~"attraction|museum|viewpoint|zoo|aquarium|gallery"](around:RADIUS,LAT,LON);
  node["historic"~"castle|fort|monument|ruins|palace|archaeological_site|memorial|temple|mosque|church|lighthouse"](around:RADIUS,LAT,LON);
  node["natural"~"waterfall|beach|peak|cave_entrance|hot_spring|island"](around:RADIUS,LAT,LON);
  node["leisure"~"nature_reserve|park|garden"](around:RADIUS,LAT,LON);
  node["amenity"="place_of_worship"](around:RADIUS,LAT,LON);
  node["waterway"="dam"](around:RADIUS,LAT,LON);
  way["tourism"~"attraction|museum|viewpoint|zoo|aquarium|gallery"](around:RADIUS,LAT,LON);
  way["historic"~"castle|fort|monument|ruins|palace|archaeological_site|memorial|temple|mosque|church|lighthouse"](around:RADIUS,LAT,LON);
  way["leisure"="nature_reserve"](around:RADIUS,LAT,LON);
);
out center tags 100;
`;

/**
 * Categorize an OSM element using the same logic as import-osm-v2.cjs
 * (simplified version — covers the most common cases)
 */
function categorizeOSM(tags) {
  if (tags.natural === 'waterfall') return 'Waterfalls';
  if (tags.natural === 'beach' || tags.natural === 'bay') return 'Beaches';
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'Mountains';
  if (tags.natural === 'cave_entrance') return 'Caves';
  if (tags.natural === 'island') return 'Islands';
  if (tags.tourism === 'attraction' || tags.tourism === 'theme_park') return 'Attractions';
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') return 'Museums';
  if (tags.tourism === 'viewpoint') return 'Viewpoints';
  if (tags.tourism === 'zoo' || tags.tourism === 'aquarium') return 'Wildlife';
  if (tags.historic === 'castle' || tags.historic === 'fort') return 'Forts';
  if (tags.historic === 'monument' || tags.historic === 'ruins' || tags.historic === 'palace') return 'Historical';
  if (tags.historic === 'archaeological_site' || tags.historic === 'memorial') return 'Historical';
  if (tags.historic === 'temple') return 'Temples';
  if (tags.historic === 'mosque') return 'Mosques';
  if (tags.historic === 'church') return 'Churches';
  if (tags.leisure === 'nature_reserve') return 'National Parks';
  if (tags.leisure === 'park' || tags.leisure === 'garden') return 'Parks';
  if (tags.waterway === 'dam') return 'Dams';
  if (tags.amenity === 'place_of_worship') {
    if (tags.religion === 'hindu' || tags.religion === 'jain') return 'Temples';
    if (tags.religion === 'buddhist') return 'Monasteries';
    if (tags.religion === 'muslim') return 'Mosques';
    if (tags.religion === 'christian') return 'Churches';
    if (tags.religion === 'sikh') return 'Gurudwaras';
    return 'Temples';
  }
  return 'Attractions';
}

/**
 * Extract a name from OSM tags (same logic as importer)
 */
function getName(tags) {
  return (tags['name:en'] || tags.name || tags['name:hi'] || '').trim() || null;
}

/**
 * Build a wiki_url from OSM wikipedia tag
 */
function getWikiUrl(tags) {
  if (tags.wikipedia) {
    const parts = tags.wikipedia.split(':');
    if (parts.length >= 2) {
      return `https://${parts[0]}.wikipedia.org/wiki/${encodeURIComponent(parts.slice(1).join(':').replace(/ /g, '_'))}`;
    }
  }
  return null;
}

/**
 * Extract image URL from OSM tags
 */
function getImageFromTags(tags) {
  if (tags.image && tags.image.startsWith('http')) return tags.image;
  if (tags.wikimedia_commons) {
    const file = tags.wikimedia_commons.replace(/^(File|Category):/, '');
    if (file) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=400`;
  }
  return null;
}

/**
 * Discover places near a location using the Overpass API.
 * 
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusMeters - Search radius in meters (default 25km)
 * @returns {Promise<Array>} - Array of discovered place objects
 */
export async function discoverPlacesNear(lat, lon, radiusMeters = 25000) {
  // Build Overpass query
  const query = OVERPASS_QUERY_TEMPLATE
    .replace(/LAT/g, lat.toString())
    .replace(/LON/g, lon.toString())
    .replace(/RADIUS/g, radiusMeters.toString());

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      console.error(`[discover] Overpass API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data.elements || data.elements.length === 0) return [];

    // Convert OSM elements to place objects
    const places = [];
    for (const el of data.elements) {
      const tags = el.tags || {};
      const name = getName(tags);
      if (!name) continue; // Skip unnamed places

      // Get coordinates (for ways, use center)
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (!elLat || !elLon) continue;

      places.push({
        name,
        description: (tags.description || tags.note || '').substring(0, 2000) || null,
        category: categorizeOSM(tags),
        place_type: tags.natural || tags.tourism || tags.historic || tags.leisure || tags.amenity || null,
        latitude: elLat,
        longitude: elLon,
        image_url: getImageFromTags(tags) || null,
        wiki_url: getWikiUrl(tags) || null,
        osm_id: el.id || null,
        source: 'OpenStreetMap',
        metadata: {},
        wikidata_id: tags.wikidata || null,
      });
    }

    return places;
  } catch (err) {
    console.error(`[discover] Overpass fetch error: ${err.message}`);
    return [];
  }
}

/**
 * Check for duplicates against existing places in Supabase.
 * Uses the find_duplicates RPC for each candidate.
 * 
 * @param {Array} candidates - Array of place objects to check
 * @returns {Promise<Array>} - Filtered array with only non-duplicate places
 */
export async function filterDuplicates(candidates) {
  if (!supabase || candidates.length === 0) return candidates;

  const nonDuplicates = [];

  for (const place of candidates) {
    try {
      const { data: dupes } = await supabase.rpc('find_duplicates', {
        p_osm_id: place.osm_id || null,
        p_wikidata_id: place.wikidata_id || null,
        p_name: place.name,
        p_lat: place.latitude,
        p_lon: place.longitude,
        p_radius_km: 0.5,
      });

      if (!dupes || dupes.length === 0) {
        nonDuplicates.push(place);
      }
    } catch (err) {
      // If duplicate check fails, skip this candidate (safety first)
      console.warn(`[discover] Duplicate check failed for ${place.name}: ${err.message}`);
    }
  }

  return nonDuplicates;
}

/**
 * Insert discovered places into Supabase.
 * Assigns them to the nearest city using the find_nearest_city RPC.
 * 
 * @param {Array} places - Array of non-duplicate place objects
 * @returns {Promise<{inserted: number, errors: number}>}
 */
export async function insertDiscoveredPlaces(places) {
  if (!supabase || places.length === 0) return { inserted: 0, errors: 0 };

  let inserted = 0;
  let errors = 0;

  for (const place of places) {
    try {
      // Find nearest city for this place
      let cityId = null;
      const { data: nearestCity } = await supabase.rpc('find_nearest_city', {
        p_lat: place.latitude,
        p_lon: place.longitude,
        p_max_km: 75,
      });
      if (nearestCity && nearestCity.length > 0) {
        cityId = nearestCity[0].city_id;
      }

      // Insert the place
      const { error } = await supabase
        .from('places')
        .upsert({
          ...place,
          city_id: cityId,
        }, { onConflict: 'osm_id' });

      if (error) {
        errors++;
        console.warn(`[discover] Insert failed for ${place.name}: ${error.message}`);
      } else {
        inserted++;
      }
    } catch (err) {
      errors++;
      console.warn(`[discover] Insert error for ${place.name}: ${err.message}`);
    }
  }

  return { inserted, errors };
}

/**
 * Full discovery pipeline: discover → deduplicate → insert.
 * Returns the number of new places inserted.
 * 
 * @param {number} lat - Latitude to search around
 * @param {number} lon - Longitude to search around
 * @param {number} radiusMeters - Search radius in meters
 * @returns {Promise<{discovered: number, duplicates: number, inserted: number, errors: number}>}
 */
export async function discoverAndInsert(lat, lon, radiusMeters = 25000) {
  // Step 1: Discover from Overpass
  const candidates = await discoverPlacesNear(lat, lon, radiusMeters);
  if (candidates.length === 0) {
    return { discovered: 0, duplicates: 0, inserted: 0, errors: 0 };
  }

  // Step 2: Filter duplicates
  const nonDuplicates = await filterDuplicates(candidates);
  const duplicates = candidates.length - nonDuplicates.length;

  // Step 3: Insert new places
  const { inserted, errors } = await insertDiscoveredPlaces(nonDuplicates);

  return {
    discovered: candidates.length,
    duplicates,
    inserted,
    errors,
  };
}
