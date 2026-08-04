/* ---------- App state ---------- */

let lastResults = null;

/* ---------- Sidebar collapse/expand ---------- */

const sidebarEl = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggle');

function setSidebarCollapsed(collapsed){
  sidebarEl.classList.toggle('collapsed', collapsed);
  sidebarToggleBtn.textContent = collapsed ? '☰' : '✕';
  sidebarToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Show sidebar' : 'Hide sidebar');
}

sidebarToggleBtn.addEventListener('click', function(){
  setSidebarCollapsed(!sidebarEl.classList.contains('collapsed'));
});

// Start collapsed on narrow (phone-width) screens so the map is visible
// immediately; start open on desktop where there's room for both.
setSidebarCollapsed(window.innerWidth <= 768);

/* ---------- Tabs ---------- */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    this.classList.add('active');
    document.querySelector(`.tab-panel[data-panel="${this.dataset.tab}"]`).classList.remove('hidden');
    // Charts built while their tab was hidden get created at zero size and never fix
    // themselves — force a resize now that the tab (and its real width) is visible.
    if(this.dataset.tab === 'housing' && hpiChartInstance){
      requestAnimationFrame(() => hpiChartInstance.resize());
    }
  });
});

/* ---------- Small shared helpers ---------- */

function gauge(label, value, max, displayValue, colorClass){
  const pct = Math.min(100, Math.max(4, (value/max)*100));
  const colors = {good:'var(--good)', mid:'var(--mid)', bad:'var(--bad)'};
  return `<div class="gauge-row">
    <div class="gauge-label">${label}</div>
    <div class="gauge-track"><div class="gauge-fill" style="width:${pct}%; background:${colors[colorClass]}"></div></div>
    <div class="gauge-value">${displayValue}</div>
  </div>`;
}

function trendLine(label, oldVal, newVal, pct, betterIsDown){
  if(pct == null || oldVal == null || newVal == null){
    return `<div class="trend-row"><span>${label}</span><span class="tv trend-na">not enough data</span></div>`;
  }
  const dir = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
  const goodBad = betterIsDown ? (dir==='down'?'trend-down':dir==='up'?'trend-up':'trend-flat') : (dir==='up'?'trend-down':dir==='down'?'trend-up':'trend-flat');
  const arrow = dir==='up' ? '▲' : dir==='down' ? '▼' : '—';
  return `<div class="trend-row"><span>${label}</span><span class="tv ${goodBad}">${arrow} ${Math.abs(pct)}%</span></div>`;
}

/* ---------- Political representation lookup ---------- */

async function fetchMpInfo(constituencyName){
  if(!constituencyName) return null;
  try{
    const r = await fetch(`https://members-api.parliament.uk/api/Location/Constituency/Search?searchText=${encodeURIComponent(constituencyName)}&skip=0&take=1`);
    if(!r.ok) return null;
    const data = await r.json();
    const item = data && data.items && data.items[0] && data.items[0].value;
    if(!item) return null;
    const rep = item.currentRepresentation && item.currentRepresentation.member && item.currentRepresentation.member.value;
    return {
      mpName: rep && rep.nameDisplayAs ? rep.nameDisplayAs : null,
      party: rep && rep.latestParty ? rep.latestParty.name : null,
      electorate: item.electorate != null ? item.electorate : null
    };
  } catch(e){ return null; }
}

/* ---------- Summary tab rendering ---------- */

function renderSummary(results){
  let summaryHtml = `<div class="location-block">`;
  if(results.constituency){
    summaryHtml += `<div class="location-constituency">${results.constituency}</div>`;
  } else {
    summaryHtml += `<div class="location-constituency" style="color:var(--ink-dim); font-size:15px;">Constituency boundary not found</div>`;
  }
  if(results.place){
    summaryHtml += `<div class="location-sub">Council: ${results.place.district || '—'}<br>Ward: ${results.place.ward || '—'}<br>Nearest postcode: ${results.place.postcode || '—'}</div>`;
  }
  summaryHtml += `</div>`;

  summaryHtml += `<div class="block"><div class="block-title">Political representation</div>`;
  if(results.mp && (results.mp.mpName || results.mp.electorate != null)){
    if(results.mp.mpName){
      summaryHtml += `<div class="headline-stat" style="font-size:20px;">${results.mp.mpName}</div>`;
      summaryHtml += `<div class="headline-sub">${results.mp.party || 'Party unavailable'}, current MP for ${results.constituency}</div>`;
    } else {
      summaryHtml += `<div class="err">MP name unavailable right now, though the constituency lookup worked.</div>`;
    }
    if(results.mp.electorate != null){
      summaryHtml += `<div class="headline-sub" style="margin-top:10px;">Registered electorate: ${results.mp.electorate.toLocaleString()} (not the same as total population)</div>`;
    }
  } else {
    summaryHtml += `<div class="err">Political data unavailable for this constituency right now.</div>`;
  }
  summaryHtml += `</div>`;
  summaryHtml += `<div class="note">Gold outline on the map = the parliamentary constituency. Green dashed circle = an approximate postcode zone. Trend arrows elsewhere: green = improving, red = worsening.</div>`;
  document.getElementById('summaryBody').innerHTML = summaryHtml;

  const aiBtn = document.getElementById('aiSummaryBtn');
  aiBtn.disabled = false;
  aiBtn.textContent = 'Generate AI summary';
}

/* ---------- Main search ---------- */

async function loadStats(lat, lng){
  document.getElementById('pinBar').innerHTML = `<div class="coord">Searching ${lat.toFixed(4)}, ${lng.toFixed(4)}…</div>`;
  ['summaryBody','crimeBody','weatherBody','pollutionBody','landRegistryBody','planningBody'].forEach(id => {
    document.getElementById(id).innerHTML = `<div class="empty-state">Loading…</div>`;
  });

  const results = { crime: null, crimeTrend: null, air: null, weather: null, weatherTrend: null,
                     constituency: null, place: null, mp: null,
                     areaCrime: null, areaCrimeTrend: null, areaAir: null, areaWeather: null, areaWeatherTrend: null,
                     hpi: null, recentSales: null, designations: null };

  const [constituencyName, placeInfo] = await Promise.all([
    loadConstituencyBoundary(lat, lng),
    loadPostcodeInfo(lat, lng)
  ]);
  results.constituency = constituencyName;
  results.place = placeInfo;
  results.mp = await fetchMpInfo(constituencyName);

  const pointBase = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`;
  try{
    const r = await fetch(pointBase);
    if(r.ok){ results.crime = await r.json(); }
  } catch(e){}
  results.crimeTrend = await fetchCrimeTrend(pointBase);

  results.air = await fetchAirQuality(lat, lng);
  const pinWeather = await fetchWeather(lat, lng);
  results.weather = pinWeather.weather;
  results.weatherTrend = pinWeather.weatherTrend;

  if(constituencyName){
    const areaCrimeStats = await fetchAreaCrimeStats();
    results.areaCrime = areaCrimeStats.crime;
    results.areaCrimeTrend = areaCrimeStats.crimeTrend;

    if(constituencyLayer){
      try{
        const c = constituencyLayer.getBounds().getCenter();
        results.areaAir = await fetchAirQuality(c.lat, c.lng);
        const areaWeather = await fetchWeather(c.lat, c.lng);
        results.areaWeather = areaWeather.weather;
        results.areaWeatherTrend = areaWeather.weatherTrend;
      } catch(e){}
    }
  }

  const councilName = results.place ? results.place.district : null;
  const postcode = results.place ? results.place.postcode : null;
  results.hpi = await fetchHpiFull(councilName);
  results.inflationYearly = await getInflationSeries();
  results.recentSales = await fetchRecentSales(postcode);
  results.designations = await fetchDesignations(postcode);

  lastResults = results;
  render(lat, lng, results);
}

/* ---------- Render orchestrator ---------- */

function render(lat, lng, results){
  document.getElementById('pinBar').innerHTML = `<div class="coord">${lat.toFixed(4)}, ${lng.toFixed(4)} — click the map to search a different pin</div>`;

  renderSummary(results);
  renderCrime(results);
  renderWeather(results);
  renderPollution(results);
  renderLandRegistry(results);
  renderPlanning(results);
}
