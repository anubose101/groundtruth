/* ---------- Map setup ---------- */

const map = L.map('map', {zoomControl:false}).setView([54.5, -3.0], 6);
L.control.zoom({position:'bottomright'}).addTo(map);

const lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
});
const outdoorsLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17
});
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
});
lightLayer.addTo(map);

const crimeSpotLayerGroup = L.layerGroup();
// Unlike the crime heatmap (opt-in, manually refreshed), schools and transport
// stops are fetched automatically as part of a normal pin search — so these
// layers are visible by default, just toggle-able off from the same layers control.
const schoolMarkerLayerGroup = L.layerGroup().addTo(map);
const transportMarkerLayerGroup = L.layerGroup().addTo(map);
// Off by default like the crime heatmap — only populated when the user
// explicitly presses "Generate" on the Commute tab, never automatically.
const commuteIsochroneLayerGroup = L.layerGroup();

L.control.layers(
  { 'Light (readable)': lightLayer, 'Outdoors (rivers & footpaths)': outdoorsLayer, 'Dark': darkLayer },
  { 'Crime heatmap': crimeSpotLayerGroup, 'Schools': schoolMarkerLayerGroup, 'Transport links': transportMarkerLayerGroup, 'Commute map': commuteIsochroneLayerGroup },
  // Left open on desktop as before; starts collapsed on narrow (phone-width)
  // screens so it doesn't cover most of the shorter mobile map area.
  { position:'topright', collapsed: window.innerWidth <= 768 }
).addTo(map);

L.control.scale({position:'bottomleft', metric:true, imperial:true, maxWidth:150}).addTo(map);

let marker = null;
let localAreaCircle = null;
// Roughly ward/neighbourhood scale — deliberately bigger than the ~1 mile radius
// data.police.uk itself uses for the exact-pin crime query, so the "local area"
// figures are a genuinely wider comparison rather than a near-duplicate number.
const LOCAL_AREA_RADIUS_M = 3000;

/* ---------- Map status banner ---------- */

function showMapStatus(msg, autoHide){
  const el = document.getElementById('mapStatus');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showMapStatus._t);
  if(autoHide){
    showMapStatus._t = setTimeout(() => el.classList.add('hidden'), 5000);
  }
}

/* ---------- Pending pin ---------- */

function showPendingPin(lat, lng){
  const pinBar = document.getElementById('pinBar');
  pinBar.innerHTML = `
    <div class="coord" style="margin-bottom:8px;">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
    <button id="searchAreaBtn" class="search-btn" style="width:100%;">Search this area →</button>`;
  document.getElementById('searchAreaBtn').addEventListener('click', function(){
    loadStats(lat, lng);
  });
}

map.on('click', function(e){
  const { lat, lng } = e.latlng;
  if(marker) map.removeLayer(marker);
  marker = L.circleMarker([lat,lng], {radius:8, color:'#E4C87A', fillColor:'#E4C87A', fillOpacity:0.9, weight:2}).addTo(map);
  showPendingPin(lat, lng);
});

/* ---------- Boundary + postcode lookups ----------
   The parliamentary constituency is looked up for the Summary tab's MP/political
   facts only — it's a big area (often several miles across) so it's no longer
   drawn or zoomed to on the map. What IS drawn and zoomed to is the postcode
   circle below: the smallest boundary this app can actually get for free, and
   the one every other tab's "local area" figures are now built around. */

async function loadConstituencyBoundary(lat, lng){
  try{
    // returnGeometry=false — only the name is needed now that this boundary
    // isn't drawn on the map.
    const url = `https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BSC/FeatureServer/0/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=geojson`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const gj = await r.json();
    if(!gj.features || !gj.features.length) return null;
    const props = gj.features[0].properties;
    const nameKey = Object.keys(props).find(k => /NM$/i.test(k) && !/CD/i.test(k));
    return nameKey ? props[nameKey] : null;
  } catch(e){ return null; }
}

// Picks the smallest named area postcodes.io actually returned for this point:
// civil parish (village/small town — not every postcode has one), else the
// electoral ward (neighbourhood), else the council district (borough/town).
function smallestAreaName(place){
  if(!place) return null;
  if(place.parish && !/unparished/i.test(place.parish)) return place.parish;
  if(place.ward) return place.ward;
  if(place.district) return place.district;
  return null;
}

// Approximates a circle as a polygon ring of points on the Earth's surface —
// used to query "everything within the local area boundary" from APIs (like
// data.police.uk) that accept an arbitrary polygon but not a radius.
function destinationPoint(lat, lng, bearingDeg, distanceMeters){
  const R = 6371000;
  const brng = bearingDeg * Math.PI/180;
  const lat1 = lat * Math.PI/180, lng1 = lng * Math.PI/180;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(distanceMeters/R) + Math.cos(lat1)*Math.sin(distanceMeters/R)*Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng)*Math.sin(distanceMeters/R)*Math.cos(lat1), Math.cos(distanceMeters/R)-Math.sin(lat1)*Math.sin(lat2));
  return [lat2*180/Math.PI, lng2*180/Math.PI];
}

function circleRing(lat, lng, radiusMeters, points){
  points = points || 16;
  const ring = [];
  for(let i = 0; i < points; i++){
    ring.push(destinationPoint(lat, lng, (360/points)*i, radiusMeters));
  }
  return ring;
}

async function loadPostcodeInfo(lat, lng){
  try{
    const r = await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`);
    if(!r.ok) return null;
    const data = await r.json();
    if(!data.result || !data.result.length) return null;
    const p = data.result[0];

    if(localAreaCircle) map.removeLayer(localAreaCircle);
    localAreaCircle = L.circle([lat,lng], { radius: LOCAL_AREA_RADIUS_M, color:'#E4C87A', weight:2, fillColor:'#E4C87A', fillOpacity:0.1, dashArray:'4,4' }).addTo(map);
    map.setView([lat,lng], Math.max(map.getZoom(), 12));

    return { postcode: p.postcode, ward: p.admin_ward, district: p.admin_district, parish: p.parish };
  } catch(e){ return null; }
}
