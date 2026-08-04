/* ---------- Schools: locations + best-effort phase/type from OpenStreetMap ----------
   There's no free, reliable nationwide API for Ofsted ratings or catchment area
   boundaries, so those link out to search it yourself instead of guessing —
   same approach already used for planning data elsewhere in this app. */

const SCHOOL_SEARCH_RADIUS_MILES = 3;
const SCHOOL_SEARCH_RADIUS_M = Math.round(SCHOOL_SEARCH_RADIUS_MILES * 1609.34);

const SCHOOL_PHASE_COLORS = { nursery:'#6FB98F', primary:'#D9A54B', secondary:'#C1603F', unknown:'#9FAE9C' };
const SCHOOL_PHASE_LETTERS = { nursery:'N', primary:'P', secondary:'S', unknown:'?' };
const SCHOOL_PHASE_LABELS = { nursery:'Nursery', primary:'Primary', secondary:'Secondary', unknown:'Unknown phase' };
const SCHOOL_TYPE_LABELS = { state:'State', private:'Private', grammar:'Grammar', unknown:'Unknown type' };

let schoolMarkers = {};
let selectedSchoolId = null;

function classifySchoolPhase(tags, name){
  const n = (name || '').toLowerCase();
  const iscedLevels = (tags['isced:level'] || '').split(';');
  if(tags.amenity === 'kindergarten' || iscedLevels.includes('0') || /nursery|pre-?school|early years/.test(n)) return 'nursery';
  if(iscedLevels.includes('1') || /\bprimary\b|infant|junior/.test(n)) return 'primary';
  if(iscedLevels.some(l => l === '2' || l === '3') || /secondary|high school|academy|grammar|college|comprehensive|sixth form/.test(n)) return 'secondary';
  return 'unknown';
}

function classifySchoolType(tags, name){
  const n = (name || '').toLowerCase();
  if(/grammar/.test(n)) return 'grammar';
  if(tags.fee === 'yes' || tags['operator:type'] === 'private' || /private school|independent school/.test(n)) return 'private';
  if(tags.fee === 'no' || tags['operator:type'] === 'public') return 'state';
  return 'unknown';
}

function schoolAddress(tags){
  const parts = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:postcode']].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/* ---------- Fetching (OpenStreetMap Overpass API) ---------- */

async function fetchNearbySchools(lat, lng){
  const query = `[out:json][timeout:25];(node["amenity"~"^(school|kindergarten)$"](around:${SCHOOL_SEARCH_RADIUS_M},${lat},${lng});way["amenity"~"^(school|kindergarten)$"](around:${SCHOOL_SEARCH_RADIUS_M},${lat},${lng}););out center tags;`;
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
      const schoolLat = el.type === 'node' ? el.lat : (el.center ? el.center.lat : null);
      const schoolLng = el.type === 'node' ? el.lon : (el.center ? el.center.lon : null);
      if(schoolLat == null || schoolLng == null) return null;
      const tags = el.tags || {};
      const name = tags.name || 'Unnamed school';
      return {
        id: `${el.type}${el.id}`,
        lat: schoolLat, lng: schoolLng, name, tags,
        address: schoolAddress(tags),
        website: tags.website || tags['contact:website'] || null,
        phase: classifySchoolPhase(tags, name),
        type: classifySchoolType(tags, name),
        distanceMiles: origin.distanceTo(L.latLng(schoolLat, schoolLng)) / 1609.34
      };
    }).filter(s => s).sort((a,b) => a.distanceMiles - b.distanceMiles);
  } catch(e){ return null; }
}

/* ---------- Filters ---------- */

function getCheckedSchoolPhases(){
  return new Set([...document.querySelectorAll('.school-phase-cb:checked')].map(cb => cb.value));
}
function getCheckedSchoolTypes(){
  return new Set([...document.querySelectorAll('.school-type-cb:checked')].map(cb => cb.value));
}
function filterSchools(schools, phases, types){
  return schools.filter(s => phases.has(s.phase) && types.has(s.type));
}

/* ---------- Map markers ---------- */

function schoolIcon(school, isSelected){
  const color = SCHOOL_PHASE_COLORS[school.phase];
  const size = isSelected ? 26 : 20;
  return L.divIcon({
    className: 'school-marker-icon',
    html: `<div style="width:${size}px;height:${size}px;font-size:${Math.max(9,size*0.5)}px;background:${color};${isSelected ? 'box-shadow:0 0 0 3px rgba(228,200,122,0.85);' : ''}">${SCHOOL_PHASE_LETTERS[school.phase]}</div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function renderSchoolMarkers(schools){
  schoolMarkerLayerGroup.clearLayers();
  schoolMarkers = {};
  schools.forEach(school => {
    const marker = L.marker([school.lat, school.lng], { icon: schoolIcon(school, school.id === selectedSchoolId) });
    marker.bindTooltip(`<div class="spot-tooltip"><strong>${school.name}</strong><br>${SCHOOL_PHASE_LABELS[school.phase]} · ${SCHOOL_TYPE_LABELS[school.type]}</div>`, { direction:'top', offset:[0,-12] });
    marker.on('click', () => selectSchool(school.id));
    schoolMarkerLayerGroup.addLayer(marker);
    schoolMarkers[school.id] = marker;
  });
}

/* ---------- Sidebar list + detail ---------- */

function renderSchoolsList(schools){
  const wrap = document.getElementById('schoolsBody');
  if(!schools.length){
    wrap.innerHTML = `<div class="empty-state">No schools matching these filters found within ${SCHOOL_SEARCH_RADIUS_MILES} miles.</div>`;
    return;
  }
  wrap.innerHTML = `<ul class="crime-list">` + schools.map(s => `
    <li class="school-list-item${s.id === selectedSchoolId ? ' active' : ''}" data-school-id="${s.id}">
      <span>${s.name}<br><span class="headline-sub" style="margin:0;">${SCHOOL_PHASE_LABELS[s.phase]} · ${SCHOOL_TYPE_LABELS[s.type]}</span></span>
      <span>${s.distanceMiles.toFixed(1)} mi</span>
    </li>`).join('') + `</ul>`;
  wrap.querySelectorAll('.school-list-item').forEach(li => {
    li.addEventListener('click', () => selectSchool(li.getAttribute('data-school-id')));
  });
}

function renderSchoolDetail(school){
  const detailEl = document.getElementById('schoolDetail');
  if(!school){ detailEl.innerHTML = ''; return; }

  const ofstedQuery = encodeURIComponent(`${school.name} ${school.address || ''} ofsted report`);
  const catchmentQuery = encodeURIComponent(`${school.name} catchment area map`);

  let html = `<div class="council-section">
    <div class="section-title">${school.name}</div>
    <div class="location-sub">
      ${SCHOOL_PHASE_LABELS[school.phase]} · ${SCHOOL_TYPE_LABELS[school.type]}<br>
      ${school.distanceMiles.toFixed(1)} miles from your pin
      ${school.address ? `<br>${school.address}` : ''}
    </div>`;
  if(school.website){
    html += `<a class="link-row" style="margin-top:10px;" href="${school.website.startsWith('http') ? school.website : 'https://'+school.website}" target="_blank" rel="noopener">School website →</a>`;
  }
  html += `<a class="link-row" href="https://www.google.com/search?q=${ofstedQuery}" target="_blank" rel="noopener">Search: Ofsted report →</a>`;
  html += `<a class="link-row" href="https://www.google.com/search?q=${catchmentQuery}" target="_blank" rel="noopener">Search: catchment area →</a>`;
  html += `<div class="headline-sub" style="margin-top:6px;">Phase/type are inferred from OpenStreetMap tags and may be wrong or missing — Ofsted ratings and catchment areas aren't available as a live data feed, so these open a search instead of guessing.</div>`;
  html += `</div>`;
  detailEl.innerHTML = html;
}

function selectSchool(schoolId){
  selectedSchoolId = schoolId;
  const school = (lastResults && lastResults.schools || []).find(s => s.id === schoolId);
  if(!school) return;

  renderSchoolDetail(school);
  document.querySelectorAll('.school-list-item').forEach(li => li.classList.toggle('active', li.getAttribute('data-school-id') === schoolId));
  Object.entries(schoolMarkers).forEach(([id, marker]) => {
    const s = lastResults.schools.find(x => x.id === id);
    if(s) marker.setIcon(schoolIcon(s, id === schoolId));
  });

  // Bring the sidebar into view for the click-to-see-detail flow described in
  // the brief — switch to the Schools tab, and on mobile, make sure the sheet
  // isn't minimized so the detail is actually visible.
  const schoolsTabBtn = document.querySelector('.tab-btn[data-tab="schools"]');
  if(schoolsTabBtn && !schoolsTabBtn.classList.contains('active')) schoolsTabBtn.click();
  if(isMobileLayout() && sidebarEl.classList.contains('sheet-minimized')) setSheetState('third');
}

/* ---------- Schools tab rendering (called from the search flow) ---------- */

function renderSchools(results){
  selectedSchoolId = null;
  document.getElementById('schoolDetail').innerHTML = '';

  if(!results.schools){
    document.getElementById('schoolsBody').innerHTML = `<div class="err">Could not load nearby schools right now — this pulls live from OpenStreetMap's Overpass API, which can occasionally be unreachable or slow.</div>`;
    schoolMarkerLayerGroup.clearLayers();
    return;
  }

  const applyFilters = () => {
    const filtered = filterSchools(results.schools, getCheckedSchoolPhases(), getCheckedSchoolTypes());
    renderSchoolMarkers(filtered);
    renderSchoolsList(filtered);
  };
  applyFilters();

  document.querySelectorAll('.school-phase-cb, .school-type-cb').forEach(cb => {
    cb.onchange = applyFilters;
  });
}
