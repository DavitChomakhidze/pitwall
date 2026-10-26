# Pitwall

A pit-wall style dashboard for GT3 and endurance racing: what's live, what's on this weekend and next, the full season calendar — and a race view with a live track map, timing tower, onboard window and TV-style action popups.

No build step, no backend, no API keys. Plain HTML + ES modules that talk straight to public data sources from the browser.

## Features

**Race list**
- 17 series: WEC, IMSA, ELMS, Asian Le Mans, IGTC, GT World Challenge (Europe, America, Asia, Australia), DTM, Super GT, British GT, ADAC GT Masters, GT Open, NLS, 24H Series, Super Taikyu
- Live now / this weekend / next weekend / full season, with series and GT3 / endurance filters
- Calendars are read from each series' Wikipedia season page, so they **roll over to the new season automatically**
- Race-day weather forecast on upcoming race cards

**Race view**
- Track map with car markers in **team colour**, car number, and a **class-colour ring**
- Corner numbers (T1, T2 …) and corner names (Eau Rouge, Mulsanne, Parabolica …) — toggle with the map button
- Timing tower: overall and per class, gaps, last laps, pit status
- Click a car → draggable **onboard window**: a driver's-eye view built from the real track geometry, plus a *Live stream* tab for any YouTube / Twitch / video link you paste
- Action popups: overtakes, battles, lead changes, pit stops, incidents, fastest laps, flags, race-control messages — each with an "Onboard" button; optional **auto-director**
- **Yellow flags on the track**: flashing local yellows, amber full-course yellow / safety car, red flag
- **Weather**: panel with air/track temperature, wind and a 2-hour rain outlook; damp and wet sections painted on the track; rain popups
- **Championship standings** tab for every series

**Live timing (WEC, ELMS, IMSA, Asian Le Mans)**
When a session is running on [Al Kamel Systems](https://livetiming.alkamelsystems.com) live timing, the race view switches to it automatically: real car positions on the organiser's own track outline, real standings, flags, track-section yellows, race-control messages and weather station data. Recorded sessions can be picked from the source menu. Everything else falls back to a realistic simulation.

## Run it

Any static file server works — ES modules need `http://`, not `file://`.

```bash
python -m http.server 5180
```

Then open <http://localhost:5180>.

## Data sources

| What | Source |
|---|---|
| Calendars, championship standings | Wikipedia season pages (MediaWiki API) |
| Live timing, positions, flags, track temp | Al Kamel Systems public live-timing feed (Meteor DDP over WebSocket) |
| Track outlines | [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON; Al Kamel's own outline when live |
| Corner names | Measured from OpenStreetMap named track sections, plus hand-placed entries |
| Weather, forecasts, geocoding | [Open-Meteo](https://open-meteo.com) |

Fetched data is cached in `localStorage` (schedules 12 h, standings 6 h, forecasts 3 h).

## Notes

- Built for personal use. The Al Kamel feed is the public feed behind their live-timing website, not a documented API — it can change without notice.
- Team colours are a best-effort lookup (liveries change every season); edit `js/liveries.js`.
- Rain per track section comes from weather-model grid cells (~1–3 km), so it shows where rain is *likely*, not a sensor reading.

## Project layout

```
index.html, race.html   pages
css/style.css           all styles
js/home.js              race list page
js/race.js              race view (map, tower, onboard, popups, weather, standings UI)
js/schedule.js          Wikipedia calendar loader + parser
js/standings.js         Wikipedia standings parser
js/series.js            series list, classes, Wikipedia page names
js/alkamel.js           Al Kamel live-timing client (DDP)
js/live.js              live model: positions, gaps, events, yellow zones
js/sim.js               race simulation (same interface as live.js)
js/tracks.js            track outlines + geometry
js/corners.js           corner numbering + names
js/weather.js           Open-Meteo weather, wet sections, forecasts
js/liveries.js          team colours
```
