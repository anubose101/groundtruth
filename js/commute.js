/* ---------- Commute map: multi-modal isochrones via the TravelTime API ----------
   Bring-your-own API credentials (same pattern as the AI summary key) — this
   is a separate free account from everything else on this page. Nothing here
   ever fires automatically: it's the one feature on this app driven entirely
   by an explicit "Generate" click, and results are cached per (location,
   modes, minutes) in this browser tab so re-viewing the same query doesn't
   spend another call against your account's quota. */

const TT_APP_ID_STORAGE_KEY = 'groundtruthTravelTimeAppId';
const TT_API_KEY_STORAGE_KEY = 'groundtruthTravelTimeApiKey';

const COMMUTE_MODE_COLORS = {
  public_transport: '#E4C87A',
  driving: '#C1603F',
  cycling: '#6FB98F',
  walking: '#6FA8DC'
};
const COMMUTE_MODE_LABELS = {
  public_transport: 'Public transport',
  driving: 'Driving',
  cycling: 'Cycling',
  walking: 'Walking'
};

const commuteCache = new Map();
let commuteShapeLayers = [];

/* ---------- Credential storage ---------- */

function getStoredTtCredentials(){
  try{
    return {
      appId: (localStorage.getItem(TT_APP_ID_STORAGE_KEY) || '').trim(),
      apiKey: (localStorage.getItem(TT_API_KEY_STORAGE_KEY) || '').trim()
    };
  } catch(e){ return { appId:'', apiKey:'' }; }
}

function setStoredTtCredentials(appId, apiKey){
  try{
    if(appId) localStorage.setItem(TT_APP_ID_STORAGE_KEY, appId); else localStorage.removeItem(TT_APP_ID_STORAGE_KEY);
    if(apiKey) localStorage.setItem(TT_API_KEY_STORAGE_KEY, apiKey); else localStorage.removeItem(TT_API_KEY_STORAGE_KEY);
  } catch(e){}
}

function updateTtKeyStatus(){
  const { appId, apiKey } = getStoredTtCredentials();
  document.getElementById('ttKeyStatus').textContent = (appId && apiKey)
    ? 'Credentials saved in this browser only.'
    : "No credentials saved yet — \"Generate\" won't work until you add both.";
}

const ttAppIdInput = document.getElementById('ttAppIdInput');
const ttApiKeyInput = document.getElementById('ttApiKeyInput');
ttAppIdInput.value = getStoredTtCredentials().appId;
ttApiKeyInput.value = getStoredTtCredentials().apiKey;
updateTtKeyStatus();
function saveTtCredentialsFromInputs(){
  setStoredTtCredentials(ttAppIdInput.value.trim(), ttApiKeyInput.value.trim());
  updateTtKeyStatus();
}
ttAppIdInput.addEventListener('change', saveTtCredentialsFromInputs);
ttApiKeyInput.addEventListener('change', saveTtCredentialsFromInputs);

/* ---------- Fetching isochrones (TravelTime Time-Map API) ---------- */

function getCheckedCommuteModes(){
  return [...document.querySelectorAll('.tt-mode-cb:checked')].map(cb => cb.value);
}

async function fetchIsochrones(lat, lng, modes, minutes){
  const { appId, apiKey } = getStoredTtCredentials();
  if(!appId || !apiKey) return { error: 'Add your TravelTime Application ID and API Key above first.' };
  if(!modes.length) return { error: 'Pick at least one mode of transport.' };

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}|${modes.slice().sort().join(',')}|${minutes}`;
  if(commuteCache.has(cacheKey)) return commuteCache.get(cacheKey);

  try{
    const body = {
      departure_searches: modes.map(mode => ({
        id: mode,
        coords: { lat, lng },
        departure_time: new Date().toISOString(),
        travel_time: minutes * 60,
        transportation: { type: mode }
      }))
    };
    const r = await fetch('https://api.traveltimeapp.com/v4/time-map', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Application-Id': appId,
        'X-Api-Key': apiKey
      },
      body: JSON.stringify(body)
    });
    const json = await r.json();
    if(!r.ok){
      const msg = json && (json.description || json.message);
      const result = { error: msg || `TravelTime API error (status ${r.status}).` };
      return result; // don't cache errors — a bad key fixed later shouldn't stay stuck
    }
    const shapesByMode = {};
    (json.results || []).forEach(res => {
      shapesByMode[res.search_id] = (res.shapes || []).map(shape => ({
        shell: (shape.shell && shape.shell.coordinates ? shape.shell.coordinates : shape.shell || []).map(c => [c[1], c[0]]),
        holes: (shape.holes || []).map(hole => (hole.coordinates || hole || []).map(c => [c[1], c[0]]))
      }));
    });
    const result = { shapesByMode };
    commuteCache.set(cacheKey, result);
    return result;
  } catch(e){ return { error: 'Could not reach the TravelTime API right now.' }; }
}

/* ---------- Map rendering ---------- */

function clearCommuteShapes(){
  commuteIsochroneLayerGroup.clearLayers();
  commuteShapeLayers = [];
}

function drawCommuteShapes(shapesByMode){
  clearCommuteShapes();
  Object.entries(shapesByMode).forEach(([mode, shapes]) => {
    const color = COMMUTE_MODE_COLORS[mode] || '#9FAE9C';
    shapes.forEach(shape => {
      if(!shape.shell.length) return;
      const rings = [shape.shell, ...shape.holes];
      const polygon = L.polygon(rings, { color, weight:2, fillColor:color, fillOpacity:0.18 });
      commuteIsochroneLayerGroup.addLayer(polygon);
      commuteShapeLayers.push(polygon);
    });
  });
  if(!map.hasLayer(commuteIsochroneLayerGroup)) map.addLayer(commuteIsochroneLayerGroup);
  if(commuteShapeLayers.length){
    const bounds = commuteShapeLayers[0].getBounds();
    commuteShapeLayers.slice(1).forEach(l => bounds.extend(l.getBounds()));
    map.fitBounds(bounds, { padding:[20,20] });
  }
}

function renderCommuteLegend(modes){
  const legendEl = document.getElementById('ttLegend');
  if(!modes.length){ legendEl.innerHTML = ''; return; }
  legendEl.innerHTML = modes.map(mode => `
    <div class="trend-row"><span><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${COMMUTE_MODE_COLORS[mode]}; margin-right:6px;"></span>${COMMUTE_MODE_LABELS[mode]}</span></div>
  `).join('');
}

/* ---------- Wiring ---------- */

document.getElementById('ttGenerateBtn').addEventListener('click', async function(){
  if(!lastResults || lastResults.lat == null){
    document.getElementById('ttResult').innerHTML = `<div class="err">Search a location first.</div>`;
    return;
  }
  const modes = getCheckedCommuteModes();
  const minutes = parseInt(document.getElementById('ttMinutesSelect').value, 10);
  const resultEl = document.getElementById('ttResult');
  const btn = this;
  btn.disabled = true; btn.textContent = 'Generating…';
  resultEl.innerHTML = '';

  const result = await fetchIsochrones(lastResults.lat, lastResults.lng, modes, minutes);
  if(result.error){
    resultEl.innerHTML = `<div class="err">${result.error}</div>`;
    renderCommuteLegend([]);
  } else {
    drawCommuteShapes(result.shapesByMode);
    renderCommuteLegend(Object.keys(result.shapesByMode));
    resultEl.innerHTML = `<div class="headline-sub">Showing where you can reach within ${minutes} minutes, drawn on the map.</div>`;
  }
  btn.disabled = false; btn.textContent = 'Generate commute map →';
});

/* ---------- Called from the search flow: just enables the button and clears
   any isochrone from a previous pin — never fetches automatically. ---------- */

function renderCommute(results){
  clearCommuteShapes();
  renderCommuteLegend([]);
  document.getElementById('ttResult').innerHTML = '';
  const btn = document.getElementById('ttGenerateBtn');
  btn.disabled = false;
  btn.textContent = 'Generate commute map →';
}
