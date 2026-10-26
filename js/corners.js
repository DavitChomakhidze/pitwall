// Corner numbers and names.
//
// Turn numbers (T1, T2 …) are worked out from the track shape: the sharpest
// direction changes are picked, as many as the circuit officially has, and
// numbered in lap order. Names come from this table. Positions are lap
// fractions measured from the start/finish line in the racing direction —
// most were measured from OpenStreetMap's named track sections; entries marked
// `approx` are estimates that get snapped onto the nearest detected corner.
//
// `n` on a name pins it to an official turn number when the auto numbering
// would otherwise disagree (only used where OSM itself carries turn numbers).

const S = 'straight';

export const CIRCUITS = [
  {
    match: /spa|francorchamps/i, turns: 19,
    named: [[0.035, 'La Source'], [0.13, 'Eau Rouge'], [0.15, 'Raidillon'], [0.24, 'Kemmel Straight', S], [0.323, 'Les Combes'],
      [0.359, 'Malmedy'], [0.418, 'Bruxelles'], [0.452, "Speaker's Corner"], [0.546, 'Pouhon'], [0.631, 'Fagnes'], [0.686, 'Campus'],
      [0.718, 'Paul Frère'], [0.836, 'Blanchimont'], [0.944, 'Bus Stop']],
  },
  {
    match: /monza/i, turns: 11,
    named: [[0.112, 'Rettifilo'], [0.209, 'Curva Grande'], [0.318, 'Roggia'], [0.388, 'Lesmo 1'], [0.445, 'Lesmo 2'],
      [0.516, 'Serraglio'], [0.655, 'Ascari'], [0.75, 'Back Straight', S], [0.861, 'Parabolica']],
  },
  {
    match: /n[uü]rburgring/i, turns: 15,
    named: [[0.06, 'Castrol-S', 'approx'], [0.363, 'Ford-Kurve'], [0.482, 'Dunlop-Kehre'], [0.567, 'Schumacher-S'], [0.89, 'NGK Chicane']],
  },
  {
    match: /imola|enzo e dino/i, turns: 19,
    named: [[0.142, 'Tamburello'], [0.27, 'Villeneuve'], [0.351, 'Tosa'], [0.476, 'Piratella'], [0.557, 'Acque Minerali'],
      [0.684, 'Variante Alta'], [0.843, 'Rivazza'], [0.985, 'Variante Bassa']],
  },
  {
    match: /barcelona|catalunya/i, turns: 14,
    named: [[0.07, 'Elf', 'approx'], [0.2, 'Renault', 'approx'], [0.29, 'Repsol', 'approx'], [0.38, 'Seat', 'approx'], [0.56, 'Campsa', 'approx'], [0.67, 'La Caixa', 'approx'], [0.851, 'Europcar']],
  },
  {
    match: /paul ricard|castellet/i, turns: 15,
    named: [[0.081, 'Virage du Pont'], [0.108, 'Virage du Lac'], [0.194, 'Bendor'], [0.271, 'Beausset'], [0.34, 'Signes'],
      [0.501, 'Chicane Nord'], [0.6, 'Mistral Straight', S], [0.74, 'Sainte-Baume'], [0.79, "L'Hôtel"], [0.895, 'S de la Verrerie']],
  },
  {
    match: /algarve|portim/i, turns: 15,
    named: [[0.158, 'Lagos'], [0.314, 'VIP Tower'], [0.448, 'Samsung'], [0.527, 'Craig Jones'], [0.588, 'Portimão'],
      [0.747, 'Sagres'], [0.834, 'Galp']],
  },
  {
    match: /silverstone/i, turns: 18,
    named: [[0.046, 'Copse'], [0.146, 'Maggotts'], [0.177, 'Becketts'], [0.202, 'Chapel'], [0.335, 'Hangar Straight', S],
      [0.379, 'Stowe'], [0.417, 'Vale'], [0.487, 'Club'], [0.589, 'Abbey'], [0.625, 'Farm'], [0.67, 'Village'], [0.697, 'The Loop'],
      [0.729, 'Aintree'], [0.85, 'Brooklands'], [0.892, 'Luffield'], [0.953, 'Woodcote']],
  },
  {
    match: /suzuka/i, turns: 18,
    named: [[0.081, 'Turn 1'], [0.153, 'S Curves'], [0.23, 'Dunlop'], [0.357, 'Degner 1'], [0.384, 'Degner 2'], [0.464, 'Hairpin'],
      [0.616, 'Spoon'], [0.702, 'Back Straight', S], [0.831, '130R'], [0.893, 'Casio Triangle']],
  },
  {
    match: /americas|\bcota\b|austin/i, turns: 20,
    named: [[0.06, '', null, 1], [0.107, '', null, 2], [0.154, '', null, 3], [0.172, '', null, 4], [0.189, '', null, 5], [0.223, '', null, 6],
      [0.255, '', null, 7], [0.284, '', null, 8], [0.301, '', null, 9], [0.338, '', null, 10], [0.412, '', null, 11], [0.52, 'Back Straight', S],
      [0.628, '', null, 12], [0.671, '', null, 13], [0.686, '', null, 14], [0.71, '', null, 15], [0.723, '', null, 16], [0.768, '', null, 17],
      [0.806, '', null, 18], [0.861, '', null, 19], [0.913, '', null, 20]],
  },
  { match: /interlagos|carlos pace|s[aã]o paulo/i, turns: 15, named: [[0.07, 'Senna S', 'approx'], [0.2, 'Curva do Sol', 'approx'], [0.27, 'Reta Oposta', S], [0.36, 'Descida do Lago', 'approx'], [0.58, 'Pinheirinho', 'approx'], [0.66, 'Bico de Pato', 'approx'], [0.76, 'Junção', 'approx']] },
  { match: /bahrain|sakhir/i, turns: 15, named: [] },
  { match: /losail|lusail|qatar/i, turns: 16, named: [] },
  {
    match: /red bull ring|spielberg/i, turns: 10,
    named: [[0.076, 'Niki Lauda'], [0.294, 'Remus'], [0.485, 'Schlossgold'], [0.604, 'Rauch'], [0.676, 'Würth'], [0.85, 'Rindt'], [0.898, 'Red Bull Mobile']],
  },
  {
    match: /hockenheim/i, turns: 17,
    named: [[0.058, 'Nordkurve'], [0.186, 'Haarnadel'], [0.325, 'Parabolika', S], [0.757, 'Mobil 1'], [0.831, 'Sachs'], [0.936, 'Südkurve']],
  },
  {
    match: /zandvoort/i, turns: 14,
    named: [[0.104, 'Tarzan'], [0.181, 'Gerlach'], [0.217, 'Hugenholtz'], [0.27, 'Hunserug'], [0.329, 'Slotemaker'], [0.417, 'Scheivlak'],
      [0.502, 'Masters'], [0.603, 'Hans Ernst'], [0.902, 'Luyendyk']],
  },
  {
    match: /mugello/i, turns: 15,
    named: [[0.145, 'San Donato'], [0.185, 'Luco'], [0.21, 'Poggio Secco'], [0.286, 'Materassi'], [0.31, 'Borgo S. Lorenzo'], [0.375, 'Casanova'],
      [0.402, 'Savelli'], [0.463, 'Arrabbiata 1'], [0.515, 'Arrabbiata 2'], [0.583, 'Scarperia'], [0.607, 'Palagio'], [0.695, 'Correntaio'],
      [0.748, 'Biondetti'], [0.867, 'Bucine']],
  },
  {
    match: /watkins/i, turns: 11,
    named: [[0.067, 'The 90'], [0.13, 'The Esses'], [0.3, 'Back Straight', S], [0.423, 'Bus Stop', 'approx'], [0.517, 'Outer Loop'], [0.606, 'The Toe'], [0.736, 'The Heel'],
      [0.792, 'The Boot'], [0.869, 'Fast Lefthander']],
  },
  { match: /indianapolis/i, turns: 14, named: [] },
  {
    match: /sepang/i, turns: 15,
    named: [[0.075, 'Pangkor Laut'], [0.236, 'Langkawi'], [0.321, 'Genting'], [0.43, 'KLIA'], [0.519, 'Berjaya Tioman'],
      [0.586, 'Kenyir Lake'], [0.712, 'Sunway Lagoon'], [0.8, 'Back Straight', S]],
  },
  { match: /shanghai/i, turns: 16, named: [] },
  { match: /yas marina|abu dhabi/i, turns: 16, named: [] },
  { match: /hungaroring/i, turns: 14, named: [] },
  { match: /magny/i, turns: 17, named: [[0.08, 'Grande Courbe', 'approx'], [0.18, 'Estoril', 'approx'], [0.35, 'Adelaide', 'approx'], [0.55, 'Nürburgring', 'approx'], [0.75, 'Imola', 'approx'], [0.9, 'Lycée', 'approx']] },

  // Circuits that only come from Al Kamel (not in the open outline data).
  {
    match: /sarthe|le mans/i, turns: 38,
    named: [[0.045, 'Dunlop Curve', 'approx'], [0.07, 'Dunlop Chicane', 'approx'], [0.12, 'Esses', 'approx'], [0.155, 'Tertre Rouge', 'approx'],
      [0.2, 'Mulsanne Straight', S], [0.25, 'Chicane 1', 'approx'], [0.37, 'Chicane 2', 'approx'], [0.485, 'Mulsanne', 'approx'],
      [0.63, 'Indianapolis', 'approx'], [0.68, 'Arnage', 'approx'], [0.8, 'Porsche Curves', 'approx'], [0.965, 'Ford Chicanes', 'approx']],
  },
  {
    match: /daytona/i, turns: 12,
    named: [[0.1, 'International Horseshoe', 'approx'], [0.33, 'West Horseshoe', 'approx'], [0.5, 'Back Straight', S], [0.62, 'Le Mans Chicane', 'approx'], [0.78, 'NASCAR 3', 'approx'], [0.86, 'NASCAR 4', 'approx']],
  },
  {
    match: /sebring/i, turns: 17,
    named: [[0.42, 'Hairpin', 'approx'], [0.82, 'Ullman Straight', S], [0.93, 'Sunset Bend', 'approx']],
  },
  {
    match: /road atlanta/i, turns: 12,
    // positions checked against Al Kamel's Road Atlanta outline
    named: [[0.2, 'The Esses', 'approx'], [0.69, 'Back Straight', S], [0.86, 'T10 Chicane', 'approx']],
  },
  {
    match: /fuji/i, turns: 16,
    // positions checked against Al Kamel's Fuji outline (corner directions match)
    named: [[0.165, 'TGR Corner', 'approx'], [0.288, 'Coca-Cola', 'approx'], [0.386, '100R', 'approx'], [0.442, 'Advan Hairpin', 'approx'],
      [0.511, '300R', 'approx'], [0.624, 'Dunlop', 'approx'], [0.698, 'GR Supra', 'approx'], [0.815, 'Panasonic', 'approx'], [0.05, 'Main Straight', S]],
  },
  { match: /laguna/i, turns: 11, named: [[0.62, 'Corkscrew', 'approx'], [0.8, 'Rainey Curve', 'approx']] },
  { match: /road america|elkhart/i, turns: 14, named: [[0.62, 'Canada Corner', 'approx'], [0.48, 'The Kink', 'approx'], [0.82, 'Thunder Valley', 'approx']] },
  { match: /virginia|\bvir\b/i, turns: 17, named: [[0.45, 'Climbing Esses', 'approx'], [0.65, 'Oak Tree', 'approx'], [0.85, 'Roller Coaster', 'approx']] },
  { match: /mosport|canadian tire/i, turns: 10, named: [[0.06, 'Turn 1', 'approx'], [0.25, 'Moss Corner', 'approx'], [0.6, 'Mario Andretti Straight', S]] },
  { match: /long beach/i, turns: 11, named: [[0.95, 'Hairpin', 'approx']] },
  { match: /detroit/i, turns: 9, named: [] },
  { match: /bathurst|mount panorama/i, turns: 23, named: [[0.05, 'Hell Corner', 'approx'], [0.18, 'Mountain Straight', S], [0.3, 'Griffins Bend', 'approx'], [0.36, 'The Cutting', 'approx'], [0.5, 'Skyline', 'approx'], [0.55, 'The Esses', 'approx'], [0.66, 'Forrest’s Elbow', 'approx'], [0.8, 'Conrod Straight', S], [0.88, 'The Chase', 'approx'], [0.96, 'Murray’s Corner', 'approx']] },
  { match: /dubai/i, turns: 16, named: [] },
  { match: /kyalami/i, turns: 16, named: [[0.1, 'Crowthorne', 'approx'], [0.2, 'Barbecue', 'approx']] },
];

const findCircuit = (name) => CIRCUITS.find((c) => c.match.test(name || ''));

/**
 * Build the corner labels for a track.
 * @param track  from tracks.js (pts, curvature, length)
 * @param names  circuit name(s) to look up
 * @param officialTurns optional turn count from the timing feed
 * @returns [{at, n, name, kind}] sorted by lap position
 */
export function cornerLabels(track, names, officialTurns) {
  const circuit = [].concat(names).map(findCircuit).find(Boolean);
  const count = officialTurns || circuit?.turns || null;
  const auto = detectTurns(track, count);
  const labels = auto.map((at, i) => ({ at, n: i + 1, name: '', kind: 'turn' }));
  if (!circuit || !track.real) return labels;

  // If the table pins official numbers (COTA), trust those positions instead.
  const pinned = circuit.named.filter((x) => x[3]);
  if (pinned.length >= (count || 0) * 0.8) {
    labels.length = 0;
    for (const [at, name, , n] of pinned) labels.push({ at, n, name, kind: 'turn' });
  }

  for (const [at, name, flag, pinnedN] of circuit.named) {
    // "Turn 7" adds nothing next to an auto "T7" label
    if (pinnedN || !name || /^turn\b/i.test(name)) continue;
    if (flag === S) { labels.push({ at, n: null, name, kind: 'straight' }); continue; }
    // attach to the nearest numbered turn (wider window for estimated positions)
    const win = flag === 'approx' ? 0.035 : 0.03;
    let best = null, bd = Infinity;
    for (const l of labels) {
      if (l.kind !== 'turn' || l.name) continue;
      const d = Math.min(Math.abs(l.at - at), 1 - Math.abs(l.at - at));
      if (d < bd) { bd = d; best = l; }
    }
    if (best && bd <= win) best.name = name;
    else if (flag !== 'approx') labels.push({ at, n: null, name, kind: 'turn' });
  }
  return labels.sort((a, b) => a.at - b.at);
}

/** Pick the `count` biggest direction changes (or all clear ones) and return their lap fractions. */
function detectTurns(track, count) {
  const n = track.pts.length;
  const h = track.heading;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // signed turning per point, lightly smoothed so chicane apexes stay separate
  let turn = h.map((x, i) => wrap(h[(i + 1) % n] - x));
  const W = Math.max(1, Math.round(10 / track.step));
  turn = turn.map((_, i) => { let s = 0; for (let k = -W; k <= W; k++) s += turn[(i + k + n) % n]; return s / (2 * W + 1); });

  // a corner = a run of same-direction turning; score it by total angle
  const corners = [];
  const minRate = 0.0025 * track.step; // ignore gentle kinks
  let i = 0;
  // start scanning from a point that isn't inside a corner
  let start = turn.findIndex((t) => Math.abs(t) < minRate);
  if (start < 0) start = 0;
  while (i < n) {
    const idx = (start + i) % n;
    if (Math.abs(turn[idx]) < minRate) { i++; continue; }
    const sign = Math.sign(turn[idx]);
    let total = 0, peak = idx, peakVal = 0, len = 0;
    while (i < n && Math.sign(turn[(start + i) % n]) === sign && Math.abs(turn[(start + i) % n]) >= minRate * 0.5) {
      const j = (start + i) % n;
      total += Math.abs(turn[j]);
      if (Math.abs(turn[j]) > peakVal) { peakVal = Math.abs(turn[j]); peak = j; }
      i++; len++;
    }
    if (total > 0.2) corners.push({ at: peak / n, score: total });
  }
  let chosen = corners;
  if (count && corners.length > count) chosen = [...corners].sort((a, b) => b.score - a.score).slice(0, count);
  return chosen.map((c) => c.at).sort((a, b) => a - b);
}

/** Next labelled corner ahead of lap position p, with distance in metres. */
export function nextCorner(labels, p, length) {
  if (!labels?.length) return null;
  const x = ((p % 1) + 1) % 1;
  const turns = labels.filter((l) => l.kind === 'turn');
  const ahead = turns.find((l) => l.at > x + 0.002) || turns[0];
  if (!ahead) return null;
  const d = ((ahead.at - x + 1) % 1) * length;
  return { ...ahead, dist: d };
}

/** Human label: "T5 · Les Combes", "T5" or "Les Combes". */
export const cornerText = (l) => [l.n ? `T${l.n}` : '', l.name].filter(Boolean).join(' · ');
