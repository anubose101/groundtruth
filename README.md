# Ground Truth — UK Location Explorer

A single-page tool for exploring what a UK location is actually like:
click a spot on the map and it pulls together the parliamentary
constituency and MP, crime stats and trends, weather and pollution
averages, and Land Registry house price history and planning designations
for that area — plus an optional AI-generated plain-English summary of it
all.

Everything runs client-side and talks directly to public UK data APIs
(data.police.uk, Land Registry, ONS, Parliament, planning.data.gov.uk,
postcodes.io) and Open-Meteo, with Leaflet for the map and Chart.js for
the house price chart.

## Running it

It's static HTML/CSS/JS — no build step. Open `index.html` in a browser,
or serve the folder with any static file server, e.g.:

```
python3 -m http.server
```

## File structure

```
index.html          Page structure and layout only
style.css            All CSS
js/
  map.js             Leaflet map setup, base layers, constituency boundary, postcode marker
  crime.js            Crime data fetching, the category table, and the heatmap spot markers
  weather.js          Weather fetching (with 5yr trend) and rendering
  pollution.js        Air quality fetching and rendering
  housing.js           Listing filters, Land Registry price data and chart, planning/development watch
  ai-summary.js        The "Generate AI summary" feature
  main.js               Shared helpers (gauge, trend line, tab switching), the search flow, and app startup
```

`index.html` loads Leaflet and Chart.js from CDN, then the local scripts
in the order above — `map.js` first since the other modules reference the
map instance and layer state it sets up, `main.js` last since it wires
together the search flow that drives every other module.
