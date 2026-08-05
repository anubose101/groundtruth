/* ---------- Weather: last-5yr sunny/rainy day averages, used as a high-level
   climate note on the Summary tab (see main.js renderSummary) ---------- */

async function fetchWeather(lat, lng){
  try{
    const end = new Date(); end.setDate(end.getDate() - 7);
    const endStr = end.toISOString().slice(0,10);
    const start = new Date(end); start.setFullYear(start.getFullYear() - 5);
    const startStr = start.toISOString().slice(0,10);

    const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${startStr}&end_date=${endStr}&daily=precipitation_sum,sunshine_duration&timezone=auto`);
    if(!r.ok) return null;
    const daily = (await r.json()).daily;
    if(!daily || !daily.time) return null;

    let rain = 0, sunnyDays = 0;
    for(let i=0;i<daily.time.length;i++){
      const p = daily.precipitation_sum[i], s = daily.sunshine_duration[i];
      if(p != null && p >= 1) rain++;
      if(s != null && s/3600 >= 6) sunnyDays++;
    }
    const yrs = daily.time.length / 365.25;
    return { rainyDaysPerYear: Math.round(rain/yrs), sunnyDaysPerYear: Math.round(sunnyDays/yrs) };
  } catch(e){ return null; }
}
