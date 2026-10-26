// Every series the hub tracks. `pages(year)` returns the Wikipedia season
// page titles that may hold races in that calendar year — this is what makes
// the schedule refresh itself every season with no manual edits.
//
// `classes` are [name, colour, typical car count], fastest first. Two kinds mix
// here: real car classes (Hypercar / LMP2 / LMGT3 — different cars and speeds)
// and driver categories inside one car class (Pro / Gold / Silver / Bronze are
// all GT3 cars, split by the FIA driver ratings of the line-up). Live timing
// always uses the organiser's own class list; these are for the simulation.
// `eventClasses` overrides the list for specific events (Le Mans adds LMP2,
// IGTC events each use their own categories).

const yy = (y) => String(y).slice(2);
const season = (name) => (y) => [`${y} ${name}`];
// Winter series run across New Year (e.g. "2025–26 Asian Le Mans Series").
const winterSeason = (name) => (y) => [`${y - 1}–${yy(y)} ${name}`, `${y}–${yy(y + 1)} ${name}`];

export const SERIES = [
  {
    id: 'wec', short: 'WEC', name: 'FIA World Endurance Championship',
    type: 'endurance', region: 'World', color: '#2f80ff',
    pages: season('FIA World Endurance Championship'),
    classes: [['Hypercar', '#e8443a', 18], ['LMGT3', '#2fbf71', 18]],
    eventClasses: [[/le mans/i, [['Hypercar', '#e8443a', 21], ['LMP2', '#3d7dff', 16], ['LMGT3', '#2fbf71', 25]]]],
  },
  {
    id: 'imsa', short: 'IMSA', name: 'IMSA SportsCar Championship',
    type: 'endurance', region: 'North America', color: '#d6262f',
    pages: season('IMSA SportsCar Championship'),
    classes: [['GTP', '#e8443a', 10], ['LMP2', '#3d7dff', 10], ['GTD Pro', '#f2b61f', 9], ['GTD', '#2fbf71', 20]],
  },
  {
    id: 'elms', short: 'ELMS', name: 'European Le Mans Series',
    type: 'endurance', region: 'Europe', color: '#1e9bd7',
    pages: season('European Le Mans Series'),
    classes: [['LMP2', '#3d7dff', 8], ['LMP2 Pro-Am', '#7aa8ff', 7], ['LMP3', '#a55cf0', 10], ['LMGT3', '#2fbf71', 12]],
  },
  {
    id: 'alms', short: 'Asian LMS', name: 'Asian Le Mans Series',
    type: 'endurance', region: 'Asia / Middle East', color: '#c9302c',
    pages: winterSeason('Asian Le Mans Series'),
    classes: [['LMP2', '#3d7dff', 10], ['LMP3', '#a55cf0', 8], ['GT', '#2fbf71', 20]],
  },
  {
    id: 'igtc', short: 'IGTC', name: 'Intercontinental GT Challenge',
    type: 'gt3', region: 'World', color: '#f28b00',
    pages: season('Intercontinental GT Challenge'),
    classes: [['Pro', '#e8443a', 20], ['Pro-Am', '#f2b61f', 10], ['Am', '#c27a3a', 8]],
    eventClasses: [
      [/spa/i, [['Pro', '#e8443a', 22], ['Gold', '#f2b61f', 10], ['Silver', '#c0c6cf', 12], ['Bronze', '#c27a3a', 16]]],
      [/n[uü]rburgring/i, [['SP9 Pro', '#e8443a', 18], ['SP9 Pro-Am', '#f2b61f', 6], ['SP-X', '#a55cf0', 3], ['SP10 GT4', '#3d7dff', 8], ['Cup2', '#c0c6cf', 12], ['Others', '#7f8796', 40]]],
      [/bathurst/i, [['Pro', '#e8443a', 10], ['Pro-Am', '#f2b61f', 8], ['Am', '#c27a3a', 4], ['Invitational', '#a55cf0', 4]]],
    ],
  },
  {
    id: 'gtwce', short: 'GTWC Europe', name: 'GT World Challenge Europe',
    type: 'gt3', region: 'Europe', color: '#ff6a00',
    pages: season('GT World Challenge Europe'),
    classes: [['Pro', '#e8443a', 18], ['Gold', '#f2b61f', 8], ['Silver', '#c0c6cf', 10], ['Bronze', '#c27a3a', 14]],
  },
  {
    id: 'gtwca', short: 'GTWC America', name: 'GT World Challenge America',
    type: 'gt3', region: 'North America', color: '#ff8a3d',
    pages: season('GT World Challenge America'),
    classes: [['Pro', '#e8443a', 6], ['Pro-Am', '#f2b61f', 10], ['Am', '#c27a3a', 6]],
  },
  {
    id: 'gtwcas', short: 'GTWC Asia', name: 'GT World Challenge Asia',
    type: 'gt3', region: 'Asia', color: '#ffa94d',
    pages: season('GT World Challenge Asia'),
    classes: [['Pro-Am', '#f2b61f', 8], ['Silver', '#c0c6cf', 6], ['Silver-Am', '#9aa6b5', 6], ['Am', '#c27a3a', 8]],
  },
  {
    id: 'gtwcau', short: 'GTWC Australia', name: 'GT World Challenge Australia',
    type: 'gt3', region: 'Oceania', color: '#ffc078',
    pages: season('GT World Challenge Australia'),
    classes: [['Pro-Am', '#f2b61f', 10], ['Am', '#c27a3a', 8], ['Trophy', '#a55cf0', 4]],
  },
  {
    id: 'dtm', short: 'DTM', name: 'Deutsche Tourenwagen Masters',
    type: 'gt3', region: 'Europe', color: '#1d4ed8',
    pages: season('Deutsche Tourenwagen Masters'),
    classes: [['GT3', '#3d7dff', 20]],
  },
  {
    id: 'supergt', short: 'Super GT', name: 'Super GT',
    type: 'gt3', region: 'Japan', color: '#e11d48',
    pages: season('Super GT Series'),
    classes: [['GT500', '#e8443a', 15], ['GT300', '#2fbf71', 25]],
  },
  {
    id: 'britgt', short: 'British GT', name: 'British GT Championship',
    type: 'gt3', region: 'UK', color: '#2563eb',
    pages: season('British GT Championship'),
    classes: [['GT3', '#3d7dff', 20], ['GT4', '#a55cf0', 12]],
  },
  {
    id: 'adac', short: 'GT Masters', name: 'ADAC GT Masters',
    type: 'gt3', region: 'Europe', color: '#facc15',
    pages: season('ADAC GT Masters'),
    classes: [['GT3', '#f2b61f', 20]],
  },
  {
    id: 'gtopen', short: 'GT Open', name: 'International GT Open',
    type: 'gt3', region: 'Europe', color: '#10b981',
    pages: season('International GT Open'),
    classes: [['Pro', '#e8443a', 10], ['Pro-Am', '#f2b61f', 10], ['Am', '#c27a3a', 6]],
  },
  {
    id: 'nls', short: 'NLS', name: 'Nürburgring Langstrecken-Serie',
    type: 'endurance', region: 'Germany', color: '#16a34a',
    pages: season('Nürburgring Langstrecken-Serie'),
    classes: [['SP9 GT3', '#e8443a', 25], ['SP4T', '#3d7dff', 10], ['Cup2', '#f2b61f', 15], ['Others', '#c0c6cf', 30]],
  },
  {
    id: '24h', short: '24H Series', name: '24H Series',
    type: 'endurance', region: 'World', color: '#9333ea',
    pages: season('24H Series'),
    classes: [['GT3', '#e8443a', 20], ['GTX', '#a55cf0', 5], ['992', '#f2b61f', 15], ['GT4', '#2fbf71', 6], ['TCE', '#3d7dff', 8]],
  },
  {
    id: 'taikyu', short: 'Super Taikyu', name: 'Super Taikyu Series',
    type: 'endurance', region: 'Japan', color: '#db2777',
    pages: season('Super Taikyu Series'),
    classes: [['ST-X', '#e8443a', 8], ['ST-Z', '#f2b61f', 8], ['ST-Q', '#3d7dff', 6], ['ST-2/3/4/5', '#c0c6cf', 20]],
  },
];

export const seriesById = (id) => SERIES.find((s) => s.id === id);

/** Class list for a specific event (falls back to the series default). */
export function classesFor(series, eventName = '') {
  const hit = (series.eventClasses || []).find(([re]) => re.test(eventName));
  return hit ? hit[1] : series.classes;
}
