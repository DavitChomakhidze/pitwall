// Approximate team colours for the car markers. Liveries change every season,
// so this is a best-effort lookup: team name first, then manufacturer, then a
// stable colour derived from the team name so every car still looks distinct.

const TEAMS = [
  [/penske/i, '#f2f2f2'],
  [/af corse|ferrari/i, '#d40000'],
  [/toyota gazoo|tgr/i, '#1b1b1b'],
  [/wayne taylor/i, '#1f4fa8'],
  [/action express|whelen/i, '#c8102e'],
  [/jota/i, '#f5c400'],
  [/wrt/i, '#0a5ec2'],
  [/rll|rahal/i, '#0b2a5b'],
  [/alpine/i, '#0058c7'],
  [/peugeot/i, '#262626'],
  [/thor|heart of racing/i, '#00594f'],
  [/meyer shank|\bmsr\b/i, '#e4007c'],
  [/iron dames/i, '#ff4fa3'],
  [/iron lynx/i, '#7ac142'],
  [/united autosports/i, '#ff7a00'],
  [/manthey/i, '#00a19a'],
  [/proton/i, '#1d1d1d'],
  [/corvette|pratt/i, '#ffd100'],
  [/vasser sullivan/i, '#c8102e'],
  [/akkodis/i, '#ff6a13'],
  [/paul miller/i, '#3a7d44'],
  [/wright motorsports/i, '#e6e6e6'],
  [/inception/i, '#ff8000'],
  [/era motorsport/i, '#7b2cbf'],
  [/aor|af racing/i, '#1565c0'],
  [/tower motorsports/i, '#0f4c81'],
  [/crowdstrike/i, '#e01e37'],
  [/inter europol/i, '#d62828'],
  [/vector sport/i, '#005f73'],
  [/team wrt/i, '#0a5ec2'],
];

const MAKES = [
  [/porsche/i, '#e8e8e8'],
  [/ferrari/i, '#d40000'],
  [/toyota|lexus/i, '#c8102e'],
  [/cadillac/i, '#1f3a68'],
  [/bmw/i, '#0a5ec2'],
  [/alpine/i, '#0058c7'],
  [/peugeot/i, '#262626'],
  [/aston martin/i, '#00594f'],
  [/acura|honda/i, '#e4007c'],
  [/lamborghini/i, '#7ac142'],
  [/corvette|chevrolet/i, '#ffd100'],
  [/ford|mustang/i, '#1a3d8f'],
  [/mclaren/i, '#ff8000'],
  [/mercedes|amg/i, '#b8bec6'],
  [/audi/i, '#9a9a9a'],
  [/nissan/i, '#c3002f'],
  [/genesis/i, '#2b2b2b'],
  [/oreca|ligier|duqueine|ginetta/i, null], // spec chassis — colour comes from the team hash
];

function hashColour(text) {
  let h = 0;
  for (const ch of text || 'car') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // hsl(h, 70%, 50%) → hex
  const hue = h % 360, s = 0.7, l = 0.5;
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function teamColour(team, make) {
  for (const [re, c] of TEAMS) if (re.test(team || '')) return c;
  for (const [re, c] of MAKES) if (re.test(make || '')) return c || hashColour(team);
  return hashColour(team || make);
}

/** Black or white, whichever reads better on a #rrggbb `colour`. */
export function textOn(colour) {
  const n = parseInt(colour.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b0d12' : '#ffffff';
}
