/* ---------- Helpers ---------- */

function slugifyRegion(name){
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* ---------- Land Registry: council-wide House Price Index, full yearly series + by-type ---------- */

function findYearlyValue(yearly, yearsAgo, latestYear){
  const target = latestYear - yearsAgo;
  let best = null, bestDiff = Infinity;
  yearly.forEach(p => { const diff = Math.abs(parseInt(p.year) - target); if(diff < bestDiff){ bestDiff = diff; best = p; } });
  return best;
}

async function fetchHpiFull(regionName){
  if(!regionName) return null;
  const slug = slugifyRegion(regionName);
  try{
    const end = new Date(); end.setMonth(end.getMonth() - 3);
    const endStr = end.toISOString().slice(0,10);
    const start = new Date(end); start.setFullYear(start.getFullYear() - 15);
    const startStr = start.toISOString().slice(0,10);
    const props = 'housePriceIndex,refPeriodStart,averagePrice,averagePriceDetached,averagePriceSemiDetached,averagePriceTerraced,averagePriceFlatMaisonette';
    const url = `https://landregistry.data.gov.uk/data/ukhpi/region/${slug}.json?_pageSize=300&min-refPeriodStart=${startStr}&max-refPeriodStart=${endStr}&_properties=${props}`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const json = await r.json();
    const items = (json.result && json.result.items) || (json.result && json.result.primaryTopic && json.result.primaryTopic.items) || [];
    // Normalize refPeriodStart to a plain YYYY-MM-DD string up front — the API's
    // exact date literal shape isn't guaranteed, and every downstream year/month
    // extraction below relies on a consistent format rather than raw string-slicing.
    const clean = items
      .map(i => {
        if(!i.refPeriodStart || i.averagePrice == null) return null;
        const d = new Date(i.refPeriodStart);
        return isNaN(d) ? null : { ...i, refPeriodStart: d.toISOString().slice(0,10) };
      })
      .filter(i => i)
      .sort((a,b) => new Date(a.refPeriodStart) - new Date(b.refPeriodStart));
    if(!clean.length) return null;

    const byYear = {};
    clean.forEach(i => { byYear[i.refPeriodStart.slice(0,4)] = i; });
    const years = Object.keys(byYear).sort();
    const yearly = years.map(y => ({ year: y, price: byYear[y].averagePrice }));

    const latestItem = clean[clean.length - 1];
    const latestYear = parseInt(latestItem.refPeriodStart.slice(0,4));

    function pct(a,b){ return (a==null||b==null||b===0) ? null : Math.round(((a-b)/b)*100); }
    const fiveEntry = findYearlyValue(yearly, 5, latestYear);
    const tenEntry = findYearlyValue(yearly, 10, latestYear);

    const byTypeRaw = {
      detached: latestItem.averagePriceDetached != null ? latestItem.averagePriceDetached : null,
      semiDetached: latestItem.averagePriceSemiDetached != null ? latestItem.averagePriceSemiDetached : null,
      terraced: latestItem.averagePriceTerraced != null ? latestItem.averagePriceTerraced : null,
      flat: latestItem.averagePriceFlatMaisonette != null ? latestItem.averagePriceFlatMaisonette : null
    };
    const hasByType = Object.values(byTypeRaw).some(v => v != null);

    return {
      yearly,
      latestPrice: latestItem.averagePrice,
      latestDate: latestItem.refPeriodStart,
      fivePrice: fiveEntry ? fiveEntry.price : null,
      tenPrice: tenEntry ? tenEntry.price : null,
      vsFivePct: pct(latestItem.averagePrice, fiveEntry ? fiveEntry.price : null),
      vsTenPct: pct(latestItem.averagePrice, tenEntry ? tenEntry.price : null),
      byType: hasByType ? byTypeRaw : null
    };
  } catch(e){ return null; }
}

/* ---------- ONS inflation (CPI) series, fetched once and cached — same for the whole UK regardless of location ---------- */

let inflationSeriesCache = null;

async function fetchInflationSeries(){
  try{
    const r = await fetch('https://api.ons.gov.uk/timeseries/D7BT/dataset/MM23/data');
    if(!r.ok) return null;
    const json = await r.json();
    const months = json.months || [];
    if(!months.length) return null;
    const byYear = {};
    months.forEach(m => {
      const val = parseFloat(m.value);
      if(!m.date || isNaN(val)) return;
      const year = m.date.slice(0,4);
      if(!byYear[year]) byYear[year] = [];
      byYear[year].push(val);
    });
    const yearly = {};
    Object.keys(byYear).forEach(y => { yearly[y] = byYear[y].reduce((a,b)=>a+b,0) / byYear[y].length; });
    return yearly;
  } catch(e){ return null; }
}

async function getInflationSeries(){
  if(inflationSeriesCache) return inflationSeriesCache;
  inflationSeriesCache = await fetchInflationSeries();
  return inflationSeriesCache;
}

/* ---------- HPI chart: nominal vs inflation-adjusted line, toggleable to a by-type bar chart ---------- */

let hpiChartInstance = null;
let hpiShowingByType = false;

function renderHpiLineChart(yearly, inflationYearly){
  const canvas = document.getElementById('hpiChart');
  if(!canvas) return;
  // Chart.js will misread plain year strings ("2015" etc.) as parseable dates
  // and silently switch the x-axis to a day-level time scale unless the scale
  // type is forced — hence the explicit 'category' below. Also only the most
  // recent 5 years are plotted here (fetchHpiFull still pulls more history,
  // since the 5yr/10yr headline trend stats above the chart need it).
  const recentYearly = yearly.slice(-5);
  const labels = recentYearly.map(p => p.year);
  const nominal = recentYearly.map(p => p.price);
  const latestYearKey = recentYearly[recentYearly.length-1].year;
  const latestCpi = inflationYearly ? inflationYearly[latestYearKey] : null;
  const real = (inflationYearly && latestCpi) ? recentYearly.map(p => {
    const cpi = inflationYearly[p.year];
    return cpi ? Math.round(p.price * (latestCpi / cpi)) : null;
  }) : null;

  const datasets = [
    { label: 'Nominal average price', data: nominal, borderColor: '#E4C87A', backgroundColor: 'transparent', tension: 0.2 }
  ];
  if(real){
    datasets.push({ label: "Inflation-adjusted (today's money)", data: real, borderColor: '#6FB98F', backgroundColor: 'transparent', tension: 0.2, borderDash: [5,4] });
  }

  if(hpiChartInstance) hpiChartInstance.destroy();
  hpiChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#EDEEE6', font: { size: 11 } } } },
      scales: {
        x: { type: 'category', ticks: { color: '#9FAE9C', font: { size: 10 } }, grid: { color: '#24382B' } },
        y: { type: 'linear', ticks: { color: '#9FAE9C', font: { size: 10 }, callback: v => '£'+Math.round(v/1000)+'k' }, grid: { color: '#24382B' } }
      }
    }
  });
}

function renderHpiTypeChart(byType){
  const canvas = document.getElementById('hpiChart');
  if(!canvas) return;
  const labels = ['Flat', 'Terraced', 'Semi-detached', 'Detached'];
  const data = [byType.flat, byType.terraced, byType.semiDetached, byType.detached];
  if(hpiChartInstance) hpiChartInstance.destroy();
  hpiChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Average price', data, backgroundColor: ['#6FB98F','#D9A54B','#E4C87A','#C1603F'] }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: 'category', ticks: { color: '#9FAE9C', font: { size: 10 } }, grid: { display: false } },
        y: { type: 'linear', ticks: { color: '#9FAE9C', font: { size: 10 }, callback: v => '£'+Math.round(v/1000)+'k' }, grid: { color: '#24382B' } }
      }
    }
  });
}

function drawHpiChart(hpi, inflationYearly){
  hpiShowingByType = false;
  if(typeof Chart === 'undefined'){
    const canvas = document.getElementById('hpiChart');
    if(canvas) canvas.outerHTML = '<div class="err">The chart library didn\'t load — try refreshing the page.</div>';
    return;
  }
  if(hpi && hpi.yearly && hpi.yearly.length){
    renderHpiLineChart(hpi.yearly, inflationYearly);
  }
  const btn = document.getElementById('hpiToggleBtn');
  if(!btn) return;
  if(hpi && hpi.byType){
    btn.style.display = 'block';
    btn.textContent = 'Show by property type →';
    btn.onclick = function(){
      hpiShowingByType = !hpiShowingByType;
      if(hpiShowingByType){
        renderHpiTypeChart(hpi.byType);
        btn.textContent = '← Back to price trend';
      } else {
        renderHpiLineChart(hpi.yearly, inflationYearly);
        btn.textContent = 'Show by property type →';
      }
    };
  } else {
    btn.style.display = 'none';
  }
}

async function fetchRecentSales(postcode){
  if(!postcode) return null;
  try{
    const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(postcode)}&_pageSize=50&_properties=pricePaid,transactionDate,propertyAddress.paon,propertyAddress.street`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const json = await r.json();
    const items = (json.result && json.result.items) || [];
    return items.map(i => ({
      price: i.pricePaid,
      date: i.transactionDate,
      paon: i['propertyAddress.paon'] || (i.propertyAddress && i.propertyAddress.paon) || '',
      street: i['propertyAddress.street'] || (i.propertyAddress && i.propertyAddress.street) || ''
    })).filter(s => s.price != null)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
  } catch(e){ return null; }
}

function averageRecentSalePrice(sales){
  if(!sales || !sales.length) return null;
  const prices = sales.map(s => s.price).filter(p => p != null);
  if(!prices.length) return null;
  return { avg: prices.reduce((a,b) => a+b, 0) / prices.length, count: prices.length };
}

/* ---------- Local development watch: stable planning.data.gov.uk designations ---------- */

async function fetchDesignations(postcode){
  if(!postcode) return null;
  try{
    const url = `https://www.planning.data.gov.uk/entity.json?q=${encodeURIComponent(postcode)}&dataset=conservation-area&dataset=green-belt&dataset=article-4-direction&limit=20`;
    const r = await fetch(url);
    if(!r.ok) return null;
    const json = await r.json();
    return json.entities || [];
  } catch(e){ return null; }
}

/* ---------- Housing listings plug-in point (no live source connected yet) ---------- */

function getActiveFilters(){
  return {
    minPrice: document.getElementById('filterMinPrice').value || null,
    maxPrice: document.getElementById('filterMaxPrice').value || null,
    minBeds: document.getElementById('filterBeds').value || null,
    radius: document.getElementById('filterRadius').value,
    types: [...document.querySelectorAll('.filter-type-cb:checked')].map(cb => cb.value),
    sort: document.getElementById('filterSort').value
  };
}

// This is the plug-in point for a real listings source later (e.g. a licensed
// Rightmove/Zoopla partner feed, or a paid property-data API). Call
// renderListings(listings) with an array of {price, beds, type, address, url}
// objects once a real source is connected — everything else is already wired up.
function renderListings(listings){
  const wrap = document.getElementById('listingsWrap');
  if(!listings || !listings.length){
    wrap.innerHTML = `<div class="council-section">
      <div class="section-title">Listings</div>
      <div class="headline-sub">Live listings aren't connected yet. Filters above are fully functional and ready — once a real data source is wired in, matching results will render here as cards automatically.</div>
    </div>`;
    return;
  }
  wrap.innerHTML = listings.map(l => `<div class="council-section">
    <div class="headline-stat" style="font-size:22px;">£${l.price ? l.price.toLocaleString() : '—'}</div>
    <div class="headline-sub">${l.beds || '—'} bed ${l.type || ''} — ${l.address || ''}</div>
  </div>`).join('');
}
renderListings([]);

document.getElementById('applyFiltersBtn').addEventListener('click', function(){
  const filters = getActiveFilters();
  renderListings([]);
  showMapStatus('Filters saved (no live listings source connected yet).', true);
});

/* ---------- Housing tab rendering: Land Registry + planning/development watch ---------- */

function renderLandRegistry(results){
  let lrHtml = '';
  if(results.hpi){
    const h = results.hpi;
    const verdict = h.vsTenPct == null ? 'not enough history to call a trend' :
      h.vsTenPct > 15 ? 'a strongly appreciating area' :
      h.vsTenPct > 0 ? 'a gently appreciating area' :
      h.vsTenPct < -5 ? 'a depreciating area' : 'a roughly flat area over the long run';
    lrHtml += `<div class="council-section">
      <div class="section-title">${results.place ? results.place.district : 'This council'} — average sold price</div>
      <div class="headline-stat">£${h.latestPrice ? Math.round(h.latestPrice).toLocaleString() : '—'}</div>
      <div class="headline-sub">Land Registry monthly average (${h.latestDate ? h.latestDate.slice(0,7) : '—'}) — reads as ${verdict}</div>
      <div style="margin-top:10px;">`
      + trendLine('vs 5 years ago', h.fivePrice, h.latestPrice, h.vsFivePct, false)
      + trendLine('vs 10 years ago', h.tenPrice, h.latestPrice, h.vsTenPct, false)
      + `</div>`;
    if(h.yearly && h.yearly.length > 1){
      lrHtml += `<div style="margin-top:16px;"><canvas id="hpiChart" height="200"></canvas></div>
      <button id="hpiToggleBtn" class="search-btn" style="width:100%; margin-top:10px; display:none;">Show by property type →</button>
      <div class="headline-sub" style="margin-top:8px;">Dashed line = the same prices adjusted for inflation, using ONS CPI data, so you can see whether values grew in real terms or just kept pace with everything else getting more expensive.</div>`;
    }
    lrHtml += `</div>`;
  } else {
    lrHtml += `<div class="err">Council-wide price history unavailable right now — this pulls live from Land Registry's own service, which can occasionally be unreachable.</div>`;
  }
  lrHtml += `<div class="block"><div class="block-title">Your postcode${results.place && results.place.postcode ? ' (' + results.place.postcode + ')' : ''}</div>`;
  const local = averageRecentSalePrice(results.recentSales);
  if(local){
    lrHtml += `<div class="headline-stat">£${Math.round(local.avg).toLocaleString()}</div>
      <div class="headline-sub">average of ${local.count} recent individual sale${local.count>1?'s':''} at this exact postcode — the smallest area with any real price data, so treat it as a rough steer rather than a precise figure.</div>`;
    if(results.hpi && results.hpi.latestPrice){
      const vsDistrictPct = Math.round(((local.avg - results.hpi.latestPrice) / results.hpi.latestPrice) * 100);
      const districtName = results.place ? results.place.district : 'the council area';
      const compareText = vsDistrictPct > 2 ? `${vsDistrictPct}% above` : vsDistrictPct < -2 ? `${Math.abs(vsDistrictPct)}% below` : 'about level with';
      lrHtml += `<div class="headline-sub" style="margin-top:8px;">${compareText} the ${districtName}-wide average shown above.</div>`;
    }
    lrHtml += `<ul class="crime-list" style="margin-top:10px;">` + results.recentSales.slice(0,8).map(s =>
      `<li><span>${(s.paon||'')} ${(s.street||'')}${s.date ? ', ' + s.date.slice(0,10) : ''}</span><span>£${s.price ? s.price.toLocaleString() : '—'}</span></li>`
    ).join('') + `</ul>`;
  } else {
    lrHtml += `<div class="err">No individual sale records found at this exact postcode, or the lookup didn't return data.</div>`;
  }
  lrHtml += `</div>`;
  document.getElementById('landRegistryBody').innerHTML = lrHtml;
  if(results.hpi && results.hpi.yearly && results.hpi.yearly.length > 1){
    drawHpiChart(results.hpi, results.inflationYearly);
  }
}

function renderPlanning(results){
  let planHtml = `<div class="block"><div class="block-title">Protective designations nearby</div>`;
  if(results.designations && results.designations.length){
    planHtml += `<ul class="crime-list">` + results.designations.slice(0,10).map(d =>
      `<li><span>${(d.name || d.reference || 'Designation')}</span><span>${(d.dataset || '').replace(/-/g,' ')}</span></li>`
    ).join('') + `</ul>`;
  } else {
    planHtml += `<div class="headline-sub">No conservation area, green belt, or Article 4 direction found near this postcode in the government's planning data platform. That dataset is still in beta with patchy council coverage, so an empty result isn't a guarantee nothing's protected — worth a manual check if this matters to you.</div>`;
  }
  planHtml += `</div>`;

  const areaTerm = (results.localAreaName || '') + ' ' + (results.place ? results.place.district : '');
  const searchQuery = encodeURIComponent(areaTerm + ' planning applications new development');
  const councilQuery = encodeURIComponent((results.place ? results.place.district : '') + ' council planning portal search');
  planHtml += `<div class="block"><div class="block-title">Worth checking yourself</div>
    <div class="headline-sub" style="margin-bottom:10px;">There's no reliable free automated feed for planning proposals, road/rail schemes, or local plan changes across every UK council, so these do the search for you instead of guessing.</div>
    <a class="link-row" href="https://www.google.com/search?q=${searchQuery}" target="_blank" rel="noopener">Search: recent planning activity nearby →</a>
    <a class="link-row" href="https://www.google.com/search?q=${councilQuery}" target="_blank" rel="noopener">Find: your council's planning portal →</a>
    <a class="link-row" href="https://www.planning.data.gov.uk/" target="_blank" rel="noopener">Browse: national planning data platform (beta) →</a>
  </div>`;
  document.getElementById('planningBody').innerHTML = planHtml;
}
