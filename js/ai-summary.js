/* ---------- AI summary: bring-your-own Anthropic API key, stored client-side only ---------- */

const AI_API_KEY_STORAGE_KEY = 'groundtruthAnthropicApiKey';

function getStoredApiKey(){
  try{ return (localStorage.getItem(AI_API_KEY_STORAGE_KEY) || '').trim(); } catch(e){ return ''; }
}

function setStoredApiKey(key){
  try{
    if(key) localStorage.setItem(AI_API_KEY_STORAGE_KEY, key);
    else localStorage.removeItem(AI_API_KEY_STORAGE_KEY);
  } catch(e){}
}

function updateAiKeyStatus(){
  const status = document.getElementById('aiKeyStatus');
  status.textContent = getStoredApiKey()
    ? 'Key saved in this browser only.'
    : "No key saved yet — the button below won't work until you add one.";
}

const aiApiKeyInput = document.getElementById('aiApiKeyInput');
aiApiKeyInput.value = getStoredApiKey();
updateAiKeyStatus();
aiApiKeyInput.addEventListener('change', function(){
  setStoredApiKey(this.value.trim());
  updateAiKeyStatus();
});

async function generateAiSummary(){
  if(!lastResults) return;
  const out = document.getElementById('aiSummaryOutput');
  const apiKey = getStoredApiKey();
  if(!apiKey){
    out.textContent = 'Add your Anthropic API key above first.';
    return;
  }

  const r = lastResults;
  const btn = document.getElementById('aiSummaryBtn');
  btn.disabled = true; btn.textContent = 'Thinking…';
  out.textContent = '';

  const lines = [];
  lines.push(`Area: ${r.constituency || 'unknown constituency'}${r.place ? ', council: ' + (r.place.district||'unknown') : ''}`);
  if(r.mp && r.mp.mpName) lines.push(`MP: ${r.mp.mpName} (${r.mp.party || 'party unknown'})`);
  lines.push(`Crime near exact pin: ${r.crime ? r.crime.length + ' reported in the most recent month on file' : 'unavailable'}`);
  if(r.crimeTrend) lines.push(`Pin crime trend: vs 5yr ago ${r.crimeTrend.vsFivePct!=null ? r.crimeTrend.vsFivePct+'%' : 'unavailable'}, vs 10yr ago ${r.crimeTrend.vsTenPct!=null ? r.crimeTrend.vsTenPct+'%' : 'unavailable'}`);
  lines.push(`Constituency-wide crime: ${r.areaCrime ? r.areaCrime.length + ' reported in the most recent month on file' : 'unavailable'}`);
  lines.push(`Air quality (PM2.5) at pin: ${r.air ? r.air.pm2_5 + ' µg/m3' : 'unavailable'}`);
  if(r.weather) lines.push(`Typical weather at pin (5yr avg): ${r.weather.sunnyDaysPerYear} sunny days/yr, ${r.weather.rainyDaysPerYear} rainy days/yr, ${r.weather.avgHumidity}% humidity`);
  if(r.hpi) lines.push(`Council average sold price: £${r.hpi.latestPrice ? Math.round(r.hpi.latestPrice).toLocaleString() : 'unavailable'}, vs 5yr ago ${r.hpi.vsFivePct!=null?r.hpi.vsFivePct+'%':'unavailable'}, vs 10yr ago ${r.hpi.vsTenPct!=null?r.hpi.vsTenPct+'%':'unavailable'}`);
  if(r.designations) lines.push(`Nearby protective designations: ${r.designations.length ? r.designations.map(d=>d.dataset).join(', ') : 'none found in the (beta) planning dataset'}`);

  const prompt = `You are summarising open UK data for someone deciding where to live. Using ONLY the facts below (do not invent numbers), write a neutral, plain-English summary in 4-6 sentences covering crime level and trend, air quality, weather/climate character, and house price trend. Be direct about both good and bad points.

${lines.join('\n')}`;

  try{
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    if(!resp.ok){
      const apiMsg = data && data.error && data.error.message;
      out.textContent = apiMsg ? `Anthropic API error: ${apiMsg}` : 'Could not generate a summary right now.';
    } else {
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      out.textContent = text || 'No summary returned. Try again in a moment.';
    }
  } catch(e){
    out.textContent = 'Could not generate a summary right now.';
  } finally {
    btn.disabled = false; btn.textContent = 'Generate AI summary';
  }
}
document.getElementById('aiSummaryBtn').addEventListener('click', generateAiSummary);
