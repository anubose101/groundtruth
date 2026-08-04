/* ---------- Crime state ---------- */

let rawCrimeData = null;
let crimeCategories = [];

const CRIME_MIN_ZOOM = 13;

/* ---------- Crime category table (built once, counts filled in after a search) ---------- */

async function loadCrimeCategories(){
  try{
    const r = await fetch('https://data.police.uk/api/crime-categories');
    if(!r.ok) return;
    crimeCategories = (await r.json()).filter(c => c.url !== 'all-crime');
  } catch(e){}
  buildCrimeCategoryTable();
}
loadCrimeCategories();

function buildCrimeCategoryTable(){
  const wrap = document.getElementById('crimeCatTableWrap');
  if(!crimeCategories.length){
    wrap.innerHTML = `<div class="err" style="margin-top:10px;">Could not load the list of crime categories right now.</div>`;
    return;
  }
  const rows = crimeCategories.map(c => `
    <tr data-cat="${c.url}">
      <td><input type="checkbox" class="crime-cat-cb" value="${c.url}" checked></td>
      <td>${c.name}</td>
      <td class="cat-count">—</td>
    </tr>`).join('');
  wrap.innerHTML = `<table class="crime-table"><thead><tr><th></th><th>Category</th><th>Constituency count</th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll('.crime-cat-cb').forEach(cb => cb.addEventListener('change', function(){
    if(rawCrimeData) renderCrimeSpots(rawCrimeData, getCheckedCategories());
  }));
}

function getCheckedCategories(){
  return new Set([...document.querySelectorAll('.crime-cat-cb:checked')].map(cb => cb.value));
}

function updateCrimeCategoryCounts(areaCrimeList){
  const counts = {};
  (areaCrimeList || []).forEach(c => { counts[c.category] = (counts[c.category]||0) + 1; });
  document.querySelectorAll('#crimeCatTableWrap tr[data-cat]').forEach(tr => {
    const cat = tr.getAttribute('data-cat');
    tr.querySelector('.cat-count').textContent = counts[cat] || 0;
  });
}

/* ---------- Crime spot markers ---------- */

function groupCrimesByLocation(crimes){
  const groups = {};
  crimes.forEach(c => {
    if(!c.location || !c.location.latitude || !c.location.longitude) return;
    const key = c.location.latitude + ',' + c.location.longitude;
    if(!groups[key]) groups[key] = { lat: parseFloat(c.location.latitude), lng: parseFloat(c.location.longitude), items: [] };
    groups[key].items.push(c.category);
  });
  return Object.values(groups);
}

function renderCrimeSpots(crimes, allowedCategories){
  crimeSpotLayerGroup.clearLayers();
  const filtered = crimes.filter(c => allowedCategories.has(c.category));
  const spots = groupCrimesByLocation(filtered);
  const maxCount = spots.reduce((m,s) => Math.max(m, s.items.length), 1);

  spots.forEach(spot => {
    const count = spot.items.length;
    const intensity = count / maxCount;
    const color = intensity > 0.66 ? '#8B2E1F' : intensity > 0.33 ? '#D9A54B' : '#3A6E52';
    const size = 16 + Math.round(intensity * 20);
    const icon = L.divIcon({
      className: 'crime-spot-icon',
      html: `<div style="width:${size}px;height:${size}px;font-size:${Math.max(9,size*0.4)}px;background:${color};">${count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size/2, size/2]
    });
    const marker = L.marker([spot.lat, spot.lng], { icon });

    const byType = {};
    spot.items.forEach(cat => { byType[cat] = (byType[cat]||0) + 1; });
    const breakdown = Object.entries(byType).sort((a,b) => b[1]-a[1])
      .map(([k,v]) => `${v} × ${k.replace(/-/g,' ')}`).join('<br>');
    marker.bindTooltip(
      `<div class="spot-tooltip"><strong>${count} crime${count>1?'s':''} at this point</strong><br>${breakdown}</div>`,
      { direction:'top', offset:[0, -size/2] }
    );
    crimeSpotLayerGroup.addLayer(marker);
  });

  return spots.length;
}

async function refreshCrimeHeatmap(){
  const z = map.getZoom();
  if(z < CRIME_MIN_ZOOM){
    showMapStatus('Zoom in past street level to load a crime heatmap for this view.', true);
    return;
  }
  showMapStatus('Loading crime incidents for this view…');
  const b = map.getBounds();
  const poly = [
    [b.getNorth(), b.getWest()], [b.getNorth(), b.getEast()],
    [b.getSouth(), b.getEast()], [b.getSouth(), b.getWest()]
  ].map(p => p[0].toFixed(4)+','+p[1].toFixed(4)).join(':');

  try{
    const r = await fetch(`https://data.police.uk/api/crimes-street/all-crime?poly=${poly}`);
    if(!r.ok){ showMapStatus('Could not load crime data (try zooming in a little more).', true); return; }
    rawCrimeData = await r.json();
    const spotCount = renderCrimeSpots(rawCrimeData, getCheckedCategories());
    if(!map.hasLayer(crimeSpotLayerGroup)) map.addLayer(crimeSpotLayerGroup);
    showMapStatus(`${rawCrimeData.length} incidents across ${spotCount} spots in this view. Untick categories in the Crime tab to filter.`, true);
  } catch(e){ showMapStatus('Could not load crime data for this view.', true); }
}

document.getElementById('crimeHeatRefresh').addEventListener('click', refreshCrimeHeatmap);

map.on('overlayadd', function(e){
  if(e.name === 'Crime heatmap'){
    if(map.getZoom() < CRIME_MIN_ZOOM){
      showMapStatus('Zoom in past street level, then turn the crime heatmap back on.', true);
      map.removeLayer(crimeSpotLayerGroup);
      return;
    }
    if(!rawCrimeData) refreshCrimeHeatmap();
  }
});

/* ---------- Crime trend ---------- */

async function fetchCrimeCountForMonth(baseQuery, monthStr){
  try{
    const r = await fetch(`${baseQuery}&date=${monthStr}`);
    if(r.ok) return (await r.json()).length;
  } catch(e){}
  return null;
}

async function fetchCrimeTrend(baseQuery){
  const now = new Date(); now.setDate(now.getDate() - 45);
  const fmt = d => d.toISOString().slice(0,7);
  const recentMonth = fmt(now);
  const d5 = new Date(now); d5.setFullYear(d5.getFullYear() - 5);
  const d10 = new Date(now); d10.setFullYear(d10.getFullYear() - 10);

  const [recent, five, ten] = await Promise.all([
    fetchCrimeCountForMonth(baseQuery, recentMonth),
    fetchCrimeCountForMonth(baseQuery, fmt(d5)),
    fetchCrimeCountForMonth(baseQuery, fmt(d10))
  ]);
  function pctChange(a,b){ return (b==null||a==null||b===0) ? null : Math.round(((a-b)/b)*100); }
  return { recent, five, ten, vsFivePct: pctChange(recent, five), vsTenPct: pctChange(recent, ten) };
}

/* ---------- Constituency-wide polygon helpers ---------- */

function extractMainRing(geometry){
  let rings = [];
  if(geometry.type === 'Polygon'){ rings = [geometry.coordinates[0]]; }
  else if(geometry.type === 'MultiPolygon'){ rings = geometry.coordinates.map(poly => poly[0]); }
  rings.sort((a,b) => b.length - a.length);
  return rings[0] || [];
}
function simplifyRing(ring, maxPoints){
  if(ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  return ring.filter((_, i) => i % step === 0);
}
function ringToPolyParam(ring){
  return ring.map(c => c[1].toFixed(4)+','+c[0].toFixed(4)).join(':');
}

async function fetchAreaCrimeStats(){
  const out = { crime: null, crimeTrend: null };
  if(!constituencyGeoJSON || !constituencyLayer) return out;

  let polyParam = null;
  try{
    const ring = simplifyRing(extractMainRing(constituencyGeoJSON.features[0].geometry), 120);
    polyParam = ringToPolyParam(ring);
    const r = await fetch(`https://data.police.uk/api/crimes-street/all-crime?poly=${polyParam}`);
    if(r.ok){ out.crime = await r.json(); }
  } catch(e){}

  if(polyParam){
    out.crimeTrend = await fetchCrimeTrend(`https://data.police.uk/api/crimes-street/all-crime?poly=${polyParam}`);
  }

  return out;
}

/* ---------- Crime tab rendering ---------- */

function renderCrime(results){
  let crimeHtml = '';
  if(results.constituency){
    crimeHtml += `<div class="council-section"><div class="section-title">${results.constituency} — constituency-wide</div>`;
    if(results.areaCrime){
      crimeHtml += `<div class="headline-stat">${results.areaCrime.length.toLocaleString()}</div><div class="headline-sub">reported crimes across the whole constituency, most recent month on file</div>`;
    } else {
      crimeHtml += `<div class="err">Constituency-wide crime total unavailable.</div>`;
    }
    if(results.areaCrimeTrend){
      const t = results.areaCrimeTrend;
      crimeHtml += `<div style="margin-top:10px;">` + trendLine('vs 5 years ago', t.five, t.recent, t.vsFivePct, true) + trendLine('vs 10 years ago', t.ten, t.recent, t.vsTenPct, true) + `</div>`;
    }
    crimeHtml += `</div>`;
  }
  crimeHtml += `<div class="divider-label">At your exact pin</div>`;
  crimeHtml += `<div class="block"><div class="block-title">Crime</div>`;
  if(results.crime){
    crimeHtml += `<div class="headline-stat">${results.crime.length}</div><div class="headline-sub">reported crimes within ~1 mile, most recent month on file</div>`;
  } else {
    crimeHtml += `<div class="err">Crime data unavailable for this point.</div>`;
  }
  if(results.crimeTrend){
    const t = results.crimeTrend;
    crimeHtml += `<div style="margin-top:10px;">` + trendLine('vs 5 years ago', t.five, t.recent, t.vsFivePct, true) + trendLine('vs 10 years ago', t.ten, t.recent, t.vsTenPct, true) + `</div>`;
  }
  crimeHtml += `</div>`;
  document.getElementById('crimeBody').innerHTML = crimeHtml;
  updateCrimeCategoryCounts(results.areaCrime || results.crime);
}
