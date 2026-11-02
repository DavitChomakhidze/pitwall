# Pitwall

A pit-wall style dashboard for GT3 and endurance racing: what's live, what's on this weekend and next, the full season calendar — and a race view with a live track map, timing tower, onboard window and TV-style action popups.

No build step, no dependencies, no API keys. Plain HTML + ES modules, plus a tiny Node server for the one thing a browser can't do itself: finding YouTube broadcasts.

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
- **Live broadcast**: the 📺 button finds the series' official YouTube stream for this event — live, upcoming (with start time) or replay — and plays it in a draggable TV window; it opens by itself when a session goes live
- Click a car → **onboard window**: the car's real onboard stream when one is public (WEC, the Nürburgring 24h and some teams stream them), otherwise the race broadcast, or a link you paste; plus a *Track view* drawn from the real track geometry
- Action popups: overtakes, battles, lead changes, pit stops, incidents, fastest laps, flags, race-control messages — each with an "Onboard" button; optional **auto-director**
- **Yellow flags on the track**: flashing local yellows, amber full-course yellow / safety car, red flag
- **Weather**: panel with air/track temperature, wind and a 2-hour rain outlook; damp and wet sections painted on the track; rain popups
- **Championship standings** tab for every series

**Live timing**

Race pages show plainly what you're looking at: **LIVE DATA**, **RECORDED** or **SIMULATED**.

| Series | Source | Car positions |
|---|---|---|
| WEC, ELMS, IMSA, Asian Le Mans | Al Kamel | Real x/y |
| IGTC Indianapolis 8 Hour, GTWC America* | Al Kamel (`usac_sro`) | Real x/y |
| Super Taikyu | supertaikyu.live | Estimated between timing points; no flags in the feed |
| Everything else | Simulation | Simulated |

*GTWC America's own rounds aren't confirmed on this feed yet.

Not connected: Swiss Timing (GTWC Europe, and very likely DTM and GT Masters) and Super GT's feed refuse outside access; TSL (GTWC Asia, British GT, IGTC Suzuka), Time Service (24H Series) and wige (NLS) can't be tested until an event is live.

When a session is running for the race on screen, the page switches to it automatically. Recorded sessions can be picked from the source menu.

## Run it

Needs Node 18+ (no packages to install).

```bash
npm start
```

Then open <http://localhost:5180>. Any static server works too (`python -m http.server 5180`), but then the broadcast / onboard streams are off.

## Data sources

| What | Source |
|---|---|
| Calendars, championship standings | Wikipedia season pages (MediaWiki API) |
| Live timing, positions, flags, track temp | Al Kamel Systems public live-timing feed (Meteor DDP over WebSocket); Super Taikyu's public JSON files |
| Track outlines | [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON; Al Kamel's own outline when live |
| Corner names | Measured from OpenStreetMap named track sections, plus hand-placed entries |
| Weather, forecasts, geocoding | [Open-Meteo](https://open-meteo.com) |
| Broadcasts, onboard streams | Official series YouTube channels, read by `server.js` |

Fetched data is cached in `localStorage` (schedules 12 h, standings 6 h, forecasts 3 h).

## Notes

- Built for personal use. The timing feeds are the public ones behind each live-timing website, not documented APIs — they can change without notice.
- Full race broadcasts depend on each series' streaming rights: SRO (GT World), IMSA, ELMS, Asian LMS, DTM, NLS, 24H Series and others stream races free on YouTube; WEC puts practice and onboards there, full races are on WEC TV. Some streams are geo-blocked.
- Team colours are a best-effort lookup (liveries change every season); edit `js/liveries.js`.
- Rain per track section comes from weather-model grid cells (~1–3 km), so it shows where rain is *likely*, not a sensor reading.

## Project layout

```
server.js               dev server + YouTube stream lookup
index.html, race.html   pages
css/style.css           all styles
js/home.js              race list page
js/race.js              race view (map, tower, onboard, popups, weather, standings UI)
js/schedule.js          Wikipedia calendar loader + parser
js/standings.js         Wikipedia standings parser
js/series.js            series list, classes, Wikipedia page names
js/sources.js           which real timing source a race can use
js/alkamel.js           Al Kamel live-timing client (DDP)
js/taikyu.js            Super Taikyu live timing
js/live.js              live model: positions, gaps, events, yellow zones
js/sim.js               race simulation (same interface as live.js)
js/tracks.js            track outlines + geometry
js/corners.js           corner numbering + names
js/weather.js           Open-Meteo weather, wet sections, forecasts
js/liveries.js          team colours
js/streams.js           series YouTube channels, matching broadcasts + onboards
```
