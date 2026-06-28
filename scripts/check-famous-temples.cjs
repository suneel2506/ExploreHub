#!/usr/bin/env node
// Enrich specific famous temples by name to demonstrate the pipeline's
// intelligent search capability with real Indian places.
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  // Get IDs of famous temples
  const { data } = await s
    .from('v_places_full')
    .select('id')
    .eq('category', 'Temples')
    .or('name.ilike.%Meenakshi%,name.ilike.%Brihadeeswarar%,name.ilike.%Jagannath Temple%,name.ilike.%Somnath%,name.ilike.%Golden Temple%,name.ilike.%Konark%,name.ilike.%Mahabodhi%,name.ilike.%Kedarnath%,name.ilike.%Tirupati%,name.ilike.%Akshardham%')
    .limit(15);

  if (!data || data.length === 0) {
    console.log('No famous temples found');
    return;
  }

  const ids = data.map(r => r.id);
  console.log('Found ' + ids.length + ' famous temples to enrich');
  console.log('IDs: ' + ids.join(', '));
})();
