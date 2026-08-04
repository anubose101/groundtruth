/* ---------- Transport links: nearest stops (OpenStreetMap) + walking time
   and route (OSRM's free public routing server). Note OSRM's public demo
   instance (router.project-osrm.org) is meant for demos/evaluation, not
   guaranteed uptime under heavy traffic — fine for this app's usage, worth
   knowing if it ever needs to move to a self-hosted or paid router. ---------- */

const TRANSPORT_SEARCH_RADIUS_MILES = 1.5;
const TRANSPORT_SEARCH_RADIUS_M = Math.round(TRANSPORT_SEARCH_RADIUS_MILES * 1609.34);
const TRANSPORT_CANDIDATE_LIMIT = 6;

const TRANSPORT_MODE_COLORS = { underground:'#E4C87A', rail:'#6FB98F', tram:'#D9A54B', bus:'#6FA8DC', ferry:'#9FAE9C' };
const TRANSPORT_MODE_LETTERS = { underground:'U', rail:'R', tram:'T', bus:'B', ferry:'F' };
const TRANSPORT_MODE_LABELS = { underground:'Underground/Metro', rail:'Rail', tram:'Tram', bus:'Bus', ferry:'Ferry' };

let transportMarkers = {};
let selectedStopId = null;
let walkingRouteLine = null;

function classifyStopMode(tags){
  if(tags.station === 'subway' || /underground|metro|subway/i.test(tags.network || '')) return 'underground';
  if(tags.railway === 'tram_stop') return 'tram';
  if(tags.railway === 'station' || tags.railway === 'halt') return 'rail';
  if(tags.amenity === 'ferry_terminal') return 'ferry';
  return 'bus';
}

/* ---------- Fetching nearby stops (OpenStreetMap Overpass API) ---------- */

async function fetchNearbyStops(lat, lng){
  const query = `[out:json][timeout:25];(node["railway"~"^(station|halt|tram_stop)$"](around:${TRANSPORT_SEARCH_RADIUS_M},${lat},${lng});node["highway"="bus_stop"](around:${TRANSPORT_SEARCH_RADIUS_M},${lat},${lng});node["amenity"~"^(bus_station|ferry_terminal)$"](around:${TRANSPORT_SEARCH_RADIUS_M},${lat},${lng}););out tags;`;
  try{
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
    if(!r.ok) return null;
    const json = await r.json();
    const origin = L.latLng(lat, lng);
    return (json.elements || []).map(el => {
      const tags = el.tags || {};
      return {
        id: `${el.type}${el.id}`,
        lat: el.lat, lng: el.lon,
        name: tags.name || TRANSPORT_MODE_LABELS[classifyStopMode(tags)],
        mode: classifyStopMode(tags),
        straightLineMiles: origin.distanceTo(L.latLng(el.lat, el.lon)) / 1609.34
      };
    }).sort((a,b) => a.straightLineMiles - b.straightLineMiles);
  } catch(e){ return null; }
}

/* ---------- Walking time/route (OSRM) ---------- */

async function fetchWalkingRoute(fromLat, fromLng, toLat, toLng){
  try{
    const url = `https://router.project-osrm.org/route/v1/foot/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const json = await r.json();
    const route = json.routes && json.routes[0];
    if(!route) return null;
    return {
      walkMinutes: Math.round(route.duration / 60),
      walkMiles: route.distance / 1609.34,
      // GeoJSON [lng,lat] pairs -> Leaflet wants [lat,lng]
      path: route.geometry.coordinates.map(c => [c[1], c[0]])
    };
  } catch(e){ return null; }
}

async function fetchNearbyTransport(lat, lng){
  const stops = await fetchNearbyStops(lat, lng);
  if(!stops) return null;

  const candidates = stops.slice(0, TRANSPORT_CANDIDATE_LIMIT);
  const walks = await Promise.all(candidates.map(s => fetchWalkingRoute(lat, lng, s.lat, s.lng)));
  return candidates
    .map((s, i) => ({ ...s, walk: walks[i] }))
    .sort((a,b) => {
      const aTime = a.walk ? a.walk.walkMinutes : Infinity;
      const bTime = b.walk ? b.walk.walkMinutes : Infinity;
      return aTime - bTime;
    });
}

/* ---------- Map markers + walking route line ---------- */

function transportIcon(stop, isSelected){
  const color = TRANSPORT_MODE_COLORS[stop.mode];
  const size = isSelected ? 24 : 18;
  return L.divIcon({
    className: 'transport-marker-icon',
    html: `<div style="width:${size}px;height:${size}px;font-size:${Math.max(9,size*0.5)}px;background:${color};${isSelected ? 'box-shadow:0 0 0 3px rgba(228,200,122,0.85);' : ''}">${TRANSPORT_MODE_LETTERS[stop.mode]}</div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function renderTransportMarkers(stops){
  transportMarkerLayerGroup.clearLayers();
  transportMarkers = {};
  stops.forEach(stop => {
    const marker = L.marker([stop.lat, stop.lng], { icon: transportIcon(stop, stop.id === selectedStopId) });
    const walkLabel = stop.walk ? `${stop.walk.walkMinutes} min walk (${stop.walk.walkMiles.toFixed(1)} mi)` : 'walking time unavailable';
    marker.bindTooltip(`<div class="spot-tooltip"><strong>${stop.name}</strong><br>${TRANSPORT_MODE_LABELS[stop.mode]} · ${walkLabel}</div>`, { direction:'top', offset:[0,-10] });
    marker.on('click', () => selectStop(stop.id));
    transportMarkerLayerGroup.addLayer(marker);
    transportMarkers[stop.id] = marker;
  });
}

function drawWalkingRoute(stop){
  if(walkingRouteLine){ map.removeLayer(walkingRouteLine); walkingRouteLine = null; }
  if(!stop.walk || !stop.walk.path) return;
  walkingRouteLine = L.polyline(stop.walk.path, { color:'#E4C87A', weight:3, opacity:0.85, dashArray:'2,7' }).addTo(map);
}

/* ---------- Sidebar list + detail ---------- */

function renderTransportList(stops){
  const wrap = document.getElementById('transportBody');
  if(!stops.length){
    wrap.innerHTML = `<div class="empty-state">No public transport stops found within ${TRANSPORT_SEARCH_RADIUS_MILES} miles.</div>`;
    return;
  }
  wrap.innerHTML = `<ul class="crime-list">` + stops.map(s => `
    <li class="school-list-item${s.id === selectedStopId ? ' active' : ''}" data-stop-id="${s.id}">
      <span>${s.name}<br><span class="headline-sub" style="margin:0;">${TRANSPORT_MODE_LABELS[s.mode]}</span></span>
      <span>${s.walk ? s.walk.walkMinutes + ' min walk' : '—'}</span>
    </li>`).join('') + `</ul>`;
  wrap.querySelectorAll('.school-list-item').forEach(li => {
    li.addEventListener('click', () => selectStop(li.getAttribute('data-stop-id')));
  });
}

function renderTransportDetail(stop){
  const detailEl = document.getElementById('transportDetail');
  if(!stop){ detailEl.innerHTML = ''; return; }
  let html = `<div class="council-section">
    <div class="section-title">${stop.name}</div>
    <div class="location-sub">${TRANSPORT_MODE_LABELS[stop.mode]}<br>${stop.straightLineMiles.toFixed(2)} miles in a straight line from your pin</div>`;
  if(stop.walk){
    html += `<div class="headline-stat" style="font-size:22px; margin-top:10px;">${stop.walk.walkMinutes} min</div>
      <div class="headline-sub">walking (${stop.walk.walkMiles.toFixed(2)} miles by street route) — shown as a dashed line on the map</div>`;
  } else {
    html += `<div class="err" style="margin-top:10px;">Walking route unavailable right now — the free routing service this pulls from can occasionally be unreachable.</div>`;
  }
  html += `</div>`;
  detailEl.innerHTML = html;
}

function selectStop(stopId){
  selectedStopId = stopId;
  const stop = (lastResults && lastResults.transport || []).find(s => s.id === stopId);
  if(!stop) return;

  renderTransportDetail(stop);
  drawWalkingRoute(stop);
  document.querySelectorAll('#transportBody .school-list-item').forEach(li => li.classList.toggle('active', li.getAttribute('data-stop-id') === stopId));
  Object.entries(transportMarkers).forEach(([id, marker]) => {
    const s = lastResults.transport.find(x => x.id === id);
    if(s) marker.setIcon(transportIcon(s, id === stopId));
  });

  const transportTabBtn = document.querySelector('.tab-btn[data-tab="transport"]');
  if(transportTabBtn && !transportTabBtn.classList.contains('active')) transportTabBtn.click();
  if(isMobileLayout() && sidebarEl.classList.contains('sheet-minimized')) setSheetState('third');
}

/* ---------- Transport tab rendering (called from the search flow) ---------- */

function renderTransport(results){
  selectedStopId = null;
  document.getElementById('transportDetail').innerHTML = '';
  if(walkingRouteLine){ map.removeLayer(walkingRouteLine); walkingRouteLine = null; }

  if(!results.transport){
    document.getElementById('transportBody').innerHTML = `<div class="err">Could not load nearby transport links right now — this pulls live from OpenStreetMap and a free routing service, either of which can occasionally be unreachable or slow.</div>`;
    transportMarkerLayerGroup.clearLayers();
    return;
  }

  renderTransportMarkers(results.transport);
  renderTransportList(results.transport);
}
