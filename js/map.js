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
// Unlike the crime heatmap (opt-in, manually refreshed), schools are fetched
// automatically as part of a normal pin search — so this layer is visible
// by default, just toggle-able off from the same layers control if wanted.
const schoolMarkerLayerGroup = L.layerGroup().addTo(map);

L.control.layers(
  { 'Light (readable)': lightLayer, 'Outdoors (rivers & footpaths)': outdoorsLayer, 'Dark': darkLayer },
  { 'Crime heatmap': crimeSpotLayerGroup, 'Schools': schoolMarkerLayerGroup },
  // Left open on desktop as before; starts collapsed on narrow (phone-width)
  // screens so it doesn't cover most of the shorter mobile map area.
  { position:'topright', collapsed: window.innerWidth <= 768 }
).addTo(map);

L.control.scale({position:'bottomleft', metric:true, imperial:true, maxWidth:150}).addTo(map);

let marker = null;
let constituencyLayer = null;
let constituencyGeoJSON = null;
let postcodeCircle = null;

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

/* ---------- Boundary + postcode lookups ---------- */

async function loadConstituencyBoundary(lat, lng){
  try{
    const url = `https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BSC/FeatureServer/0/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const gj = await r.json();
    if(!gj.features || !gj.features.length) return null;
    constituencyGeoJSON = gj;

    if(constituencyLayer) map.removeLayer(constituencyLayer);
    constituencyLayer = L.geoJSON(gj, {
      style: { color:'#E4C87A', weight:2, fillColor:'#E4C87A', fillOpacity:0.1 }
    }).addTo(map);
    map.fitBounds(constituencyLayer.getBounds(), { maxZoom: 11, padding:[20,20] });

    const props = gj.features[0].properties;
    const nameKey = Object.keys(props).find(k => /NM$/i.test(k) && !/CD/i.test(k));
    return nameKey ? props[nameKey] : null;
  } catch(e){ return null; }
}

async function loadPostcodeInfo(lat, lng){
  try{
    const r = await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`);
    if(!r.ok) return null;
    const data = await r.json();
    if(!data.result || !data.result.length) return null;
    const p = data.result[0];

    if(postcodeCircle) map.removeLayer(postcodeCircle);
    postcodeCircle = L.circle([lat,lng], { radius:350, color:'#6FB98F', weight:1.5, fillColor:'#6FB98F', fillOpacity:0.15, dashArray:'4,4' }).addTo(map);

    return { postcode: p.postcode, ward: p.admin_ward, district: p.admin_district };
  } catch(e){ return null; }
}
