/* ---------- Air quality fetching ---------- */

async function fetchAirQuality(lat, lng){
  try{
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,pm10,nitrogen_dioxide,ozone`);
    if(r.ok) return (await r.json()).current;
  } catch(e){}
  return null;
}

function pm25Rating(v){
  if(v == null) return {c:'mid', t:'No data'};
  if(v <= 10) return {c:'good', t:'Good'};
  if(v <= 25) return {c:'mid', t:'Moderate'};
  return {c:'bad', t:'Poor'};
}

/* ---------- Pollution tab rendering ---------- */

function renderPollution(results){
  let pollutionHtml = '';
  pollutionHtml += `<div class="block"><div class="block-title">Air quality</div>`;
  if(results.air){
    const pm25 = results.air.pm2_5, pm10 = results.air.pm10, no2 = results.air.nitrogen_dioxide;
    const r1 = pm25Rating(pm25);
    pollutionHtml += gauge('PM2.5', pm25||0, 40, pm25!=null?pm25.toFixed(1):'—', r1.c);
    pollutionHtml += gauge('PM10', pm10||0, 60, pm10!=null?pm10.toFixed(1):'—', pm10<=20?'good':pm10<=40?'mid':'bad');
    pollutionHtml += gauge('NO₂', no2||0, 100, no2!=null?no2.toFixed(1):'—', no2<=20?'good':no2<=40?'mid':'bad');
    pollutionHtml += `<div class="headline-sub" style="margin-top:6px;">Current reading, µg/m³. No reliable free long-term trend available for pollution.</div>`;
  } else {
    pollutionHtml += `<div class="err">Air quality data unavailable right now.</div>`;
  }
  pollutionHtml += `</div>`;
  pollutionHtml += `<div class="note">No separate local-area figure here — air quality readings come from a weather-style grid roughly a few miles across, so a local-area reading would just repeat this same number. Noise pollution isn't shown at all — there's no free, reliably accessible UK noise-map data source to pull from.</div>`;
  document.getElementById('pollutionBody').innerHTML = pollutionHtml;
}
