/* ---------- Weather fetching, with a 5-vs-prior-5-year trend ---------- */

async function fetchWeather(lat, lng){
  const out = { weather: null, weatherTrend: null };

  try{
    const end = new Date(); end.setDate(end.getDate() - 7);
    const endStr = end.toISOString().slice(0,10);
    const start10y = new Date(end); start10y.setFullYear(start10y.getFullYear() - 10);
    const start10yStr = start10y.toISOString().slice(0,10);
    const start1y = new Date(end); start1y.setFullYear(start1y.getFullYear() - 1);
    const start1yStr = start1y.toISOString().slice(0,10);

    const [dailyRes, hourlyRes] = await Promise.all([
      fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start10yStr}&end_date=${endStr}&daily=precipitation_sum,sunshine_duration&timezone=auto`),
      fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start1yStr}&end_date=${endStr}&hourly=relative_humidity_2m&timezone=auto`)
    ]);

    if(dailyRes.ok && hourlyRes.ok){
      const daily = (await dailyRes.json()).daily;
      const hourly = (await hourlyRes.json()).hourly;

      function summarize(startIdx, endIdx){
        let rain=0, sunHours=0, sunnyDays=0, count=0;
        for(let i=startIdx;i<endIdx;i++){
          const p = daily.precipitation_sum[i], s = daily.sunshine_duration[i];
          if(p != null && p >= 1) rain++;
          if(s != null){ const hrs = s/3600; sunHours += hrs; if(hrs >= 6) sunnyDays++; }
          count++;
        }
        const yrs = count / 365.25;
        return { rainyDaysPerYear: rain/yrs, sunnyDaysPerYear: sunnyDays/yrs, sunHoursPerYear: sunHours/yrs };
      }

      const n = daily.time.length;
      const half = Math.floor(n/2);
      const older = summarize(0, half);
      const recent = summarize(half, n);

      const humidityVals = hourly.relative_humidity_2m.filter(v => v != null);
      const avgHumidity = humidityVals.reduce((a,b)=>a+b,0) / humidityVals.length;

      out.weather = {
        rainyDaysPerYear: Math.round(recent.rainyDaysPerYear),
        sunnyDaysPerYear: Math.round(recent.sunnyDaysPerYear),
        sunHoursPerYear: Math.round(recent.sunHoursPerYear),
        avgHumidity: Math.round(avgHumidity)
      };

      function pctChange(a,b){ return (b===0||b==null) ? null : Math.round(((a-b)/b)*100); }
      out.weatherTrend = {
        sunnyDaysOld: Math.round(older.sunnyDaysPerYear), sunnyDaysNew: Math.round(recent.sunnyDaysPerYear),
        sunnyDaysPct: pctChange(recent.sunnyDaysPerYear, older.sunnyDaysPerYear),
        rainyDaysOld: Math.round(older.rainyDaysPerYear), rainyDaysNew: Math.round(recent.rainyDaysPerYear),
        rainyDaysPct: pctChange(recent.rainyDaysPerYear, older.rainyDaysPerYear),
        sunHoursOld: Math.round(older.sunHoursPerYear), sunHoursNew: Math.round(recent.sunHoursPerYear),
        sunHoursPct: pctChange(recent.sunHoursPerYear, older.sunHoursPerYear)
      };
    }
  } catch(e){}

  return out;
}

/* ---------- Weather tab rendering ---------- */

function renderWeather(results){
  let weatherHtml = '';
  if(results.areaWeather){
    weatherHtml += `<div class="council-section"><div class="section-title">${results.constituency} — constituency-wide (centre point)</div>`;
    const w = results.areaWeather;
    weatherHtml += gauge('Sunny days/yr', w.sunnyDaysPerYear, 220, w.sunnyDaysPerYear, w.sunnyDaysPerYear>=140?'good':w.sunnyDaysPerYear>=100?'mid':'bad');
    weatherHtml += gauge('Rainy days/yr', w.rainyDaysPerYear, 220, w.rainyDaysPerYear, w.rainyDaysPerYear<=100?'good':w.rainyDaysPerYear<=150?'mid':'bad');
    if(results.areaWeatherTrend){
      const t = results.areaWeatherTrend;
      weatherHtml += `<div style="margin-top:10px;">` + trendLine('Sunny days vs prior 5yr', t.sunnyDaysOld, t.sunnyDaysNew, t.sunnyDaysPct, false) + trendLine('Rainy days vs prior 5yr', t.rainyDaysOld, t.rainyDaysNew, t.rainyDaysPct, true) + `</div>`;
    }
    weatherHtml += `</div>`;
  }
  weatherHtml += `<div class="divider-label">At your exact pin</div>`;
  weatherHtml += `<div class="block"><div class="block-title">Typical weather (last 5yr average)</div>`;
  if(results.weather){
    const w = results.weather;
    weatherHtml += `<div class="headline-stat">${w.sunnyDaysPerYear}</div><div class="headline-sub">sunny days per year (6+ hrs of sunshine)</div>`;
    weatherHtml += `<div class="block" style="margin:16px 0 0;">`;
    weatherHtml += gauge('Rainy days/yr', w.rainyDaysPerYear, 220, w.rainyDaysPerYear, w.rainyDaysPerYear<=100?'good':w.rainyDaysPerYear<=150?'mid':'bad');
    weatherHtml += gauge('Sun hours/yr', w.sunHoursPerYear, 2200, w.sunHoursPerYear, w.sunHoursPerYear>=1600?'good':w.sunHoursPerYear>=1300?'mid':'bad');
    weatherHtml += gauge('Avg humidity', w.avgHumidity, 100, w.avgHumidity+'%', w.avgHumidity<=75?'good':w.avgHumidity<=85?'mid':'bad');
    weatherHtml += `</div>`;
    if(results.weatherTrend){
      const t = results.weatherTrend;
      weatherHtml += `<div style="margin-top:10px;">` + trendLine('Sunny days vs prior 5yr', t.sunnyDaysOld, t.sunnyDaysNew, t.sunnyDaysPct, false) + trendLine('Rainy days vs prior 5yr', t.rainyDaysOld, t.rainyDaysNew, t.rainyDaysPct, true) + trendLine('Sun hours vs prior 5yr', t.sunHoursOld, t.sunHoursNew, t.sunHoursPct, false) + `</div>`;
    }
  } else {
    weatherHtml += `<div class="err">Weather averages unavailable right now.</div>`;
  }
  weatherHtml += `</div>`;
  document.getElementById('weatherBody').innerHTML = weatherHtml;
}
