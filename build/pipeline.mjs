// Turns the Parking Authority's permit block list and the City's street centerlines into the
// map data: one outline per district and one line per permitted side of each block.
//
//   buildAll(kml, centerlines) -> { geojson, report }
//
// kml          text of the Parking Authority map, exported as KML
// centerlines  array of GeoJSON street segments (the whole city)
// report       lists everything that could not be placed, so it can be checked by hand

// Spellings in the Parking Authority list that differ from the City's street names.
// Only used when the name as written finds nothing.
const ALIAS = {
  'PARK TOWN': 'PARK TOWNE',
  'TANEY': 'LECOUNT',            // renamed by the City
  'FALLEN': 'FALLON',
  'STOKELY': 'STOKLEY',
  'SPRINGFILED': 'SPRINGFIELD',
  'MYRLTEWOOD': 'MYRTLEWOOD',
  'WESTMORLAND': 'WESTMORELAND',
  'BONAFFON': 'BONNAFFON',
  'WILLIAMS': 'WILLIAM',
  'MATHAIS': 'MATTHIAS',
  'BERNARD': 'SAINT BERNARD',
  'OVERBROOK': 'OVERLOOK',       // "500 Overbrook Rd" in district 15; a best guess
  '21TH': '21ST',
};

const TYPES = {
  ST: 'ST', STREET: 'ST', AVE: 'AVE', AV: 'AVE', AVENUE: 'AVE', BLVD: 'BLVD', PL: 'PL', PLACE: 'PL',
  RD: 'RD', ROAD: 'RD', DR: 'DR', LN: 'LN', LANE: 'LN', CT: 'CT', WAY: 'WAY', TER: 'TER', TERR: 'TER',
  TERRACE: 'TER', PKWY: 'PKWY', CIR: 'CIR', SQ: 'SQ', SQUARE: 'SQ', WALK: 'WALK', ALY: 'ALY',
  PIKE: 'PIKE', PK: 'PIKE',
};

const NS = ['N', 'S'], EW = ['E', 'W'];
const END_GAP = 7;          // metres cut off each end of a block so lines stop short of the corner
const NUM_COLORS = 7;       // size of the colour palette in index.html

// ---------- Reading the Parking Authority's wording ----------

// "1400 BAINBRIDGE ST." -> { hundreds: [1400], dir: '', name: 'BAINBRIDGE', type: 'ST' }
function parseBlock(raw) {
  let s = raw.toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/ [NSEW]\/S$/, '');                       // "900 S 46TH E/S"
  if (/ LOT$/.test(s)) return { lot: true };              // permit parking lots are not streets
  const m = s.match(/^(\d+)(?:\s*-\s*(\d+))?\s+(.+)$/);
  if (!m) return null;
  const words = m[3].split(' ');
  let dir = '', type = '';
  if (words.length > 1 && 'NSEW'.includes(words[0]) && words[0].length === 1) dir = words.shift();
  if (words.length > 1 && TYPES[words[words.length - 1]]) type = TYPES[words.pop()];
  const name = words.join(' ').replace(/^ST /, 'SAINT ').replace(/^MT /, 'MOUNT ');
  // odd numbers such as 599 mean the 500 block; "2500-2600" means both blocks
  const first = Math.floor(+m[1] / 100) * 100;
  let last = m[2] ? Math.floor(+m[2] / 100) * 100 : first;
  if (last < first || last - first > 300) last = first;
  const hundreds = [];
  for (let h = first; h <= last; h += 100) hundreds.push(h);
  return { hundreds, dir, name, type };
}

// "Both Sides" -> B, "East Side" -> E, "E/S" -> E
function parseSide(raw) {
  const s = raw.toUpperCase().trim();
  if (s.startsWith('B')) return 'B';
  return 'NSEW'.includes(s[0]) && s ? s[0] : '?';
}

// "2/3" -> [2, 3]. A block can belong to more than one district.
function parseDistricts(raw) {
  const out = [];
  for (const part of String(raw || '').split('/')) {
    const n = Math.round(parseFloat(part));
    if (n > 0 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

const cleanLimit = s => s.toUpperCase().replace(/\s+/g, '').replace(/PK$/, '');
const cleanHours = s => s.toUpperCase()
  .replace(/24\s*\/\s*7/, '24HR').replace(/=/g, '-').replace(/,/g, ' ')
  .replace(/\s*-\s*/g, '-').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim()
  .replace(/(\d) (AM|PM)\b/g, '$1$2').replace(/:00/g, '').replace(/12MID/g, '12AM')
  .replace(/THURS/g, 'THUR').replace(/(AM|PM) (\d)/g, '$1-$2');

// ---------- Geometry (everything in metres on a flat grid centred on the city) ----------

const KX = 111320 * Math.cos(39.99 * Math.PI / 180), KY = 110540;
const toM = c => [c[0] * KX, c[1] * KY];
const toLL = m => [+(m[0] / KX).toFixed(5), +(m[1] / KY).toFixed(5)];

function insideRing(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// 0 when the point is inside the outline, otherwise metres to its edge
function distToRing(ring, p) {
  if (insideRing(ring, p)) return 0;
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], vx = b[0] - a[0], vy = b[1] - a[1];
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1);
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy));
  }
  return best;
}

// cut t metres off both ends of a line
function trim(pts, t) {
  const len = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { len.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); total += len[i - 1]; }
  if (total < 4 * t) return pts;
  const at = d => {
    let acc = 0;
    for (let i = 0; i < len.length; i++) {
      if (acc + len[i] >= d) { const f = (d - acc) / len[i]; return { i, p: [pts[i][0] + f * (pts[i + 1][0] - pts[i][0]), pts[i][1] + f * (pts[i + 1][1] - pts[i][1])] }; }
      acc += len[i];
    }
    return { i: len.length - 1, p: pts[pts.length - 1] };
  };
  const a = at(t), b = at(total - t);
  return [a.p, ...pts.slice(a.i + 1, b.i + 1), b.p];
}

// true when roadway o runs alongside s but further toward the right (divided streets)
function furtherRight(s, o) {
  const a = s[0], b = s[s.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const m = [(o[0][0] + o[o.length - 1][0]) / 2, (o[0][1] + o[o.length - 1][1]) / 2];
  const along = ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / len2;
  const across = ((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / Math.sqrt(len2);
  return along > 0 && along < 1 && across > 4;
}

// ---------- The build ----------

export function buildAll(kml, centerlines) {
  const report = {
    entries: 0, blocks: 0, lines: 0, perDistrict: {},
    lots: [], unparsed: [], unmatched: [], renamed: [], farFromDistrict: [], moved: [], sideUnclear: [], mixedRules: [],
  };

  // 1. Read the Parking Authority file: district outlines and block entries
  const text = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();
  const tag = (pm, t) => { const m = pm.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? text(m[1]) : ''; };
  const fields = pm => { const o = {}; for (const m of pm.matchAll(/<Data name="([^"]+)">\s*<value>([\s\S]*?)<\/value>/g)) o[m[1]] = text(m[2]); return o; };
  const placemarks = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || [];

  const outlines = new Map();    // district number -> { ring (lon/lat), ringM (metres) }
  const groups = new Map();      // one per block per set of districts
  for (const pm of placemarks) {
    if (pm.includes('<Polygon>')) {
      const m = tag(pm, 'name').match(/#\s*(\d+)\s*$/);
      if (!m) continue;
      const ring = tag(pm, 'coordinates').split(/\s+/).map(c => c.split(',').slice(0, 2).map(v => +(+v).toFixed(5)));
      outlines.set(+m[1], { ring, ringM: ring.map(toM) });
      continue;
    }
    const f = fields(pm), raw = tag(pm, 'name'), districts = parseDistricts(f['RPP#']), p = parseBlock(raw);
    report.entries++;
    if (!p || !districts.length) { report.unparsed.push(raw); continue; }
    if (p.lot) { report.lots.push(raw); continue; }
    const entry = { side: parseSide(f['Sides'] || ''), sideText: (f['Sides'] || '').trim(), limit: cleanLimit(f['HR.'] || ''), hours: cleanHours(f['Regulations'] || '') };
    for (const hundred of p.hundreds) {
      const label = [hundred, p.dir, p.name, p.type].filter(x => x !== '').join(' ');
      const key = label + ' #' + districts.join('/');
      if (!groups.has(key)) groups.set(key, { hundred, dir: p.dir, name: p.name, type: p.type, label, districts, entries: [] });
      groups.get(key).entries.push(entry);
    }
  }
  const distToDistricts = (p, list) => Math.min(...list.map(d => outlines.has(d) ? distToRing(outlines.get(d).ringM, p) : Infinity));

  // 2. Index the street segments by name. Spaces are ignored so MCKEAN finds MC KEAN.
  const squash = s => s.replace(/[^A-Z0-9]/g, '');
  const byName = new Map();
  for (const f of centerlines) {
    if (!f.geometry || f.geometry.type !== 'LineString') continue;
    const p = f.properties, name = (p.st_name || '').trim().toUpperCase();
    if (!name) continue;
    const pts = f.geometry.coordinates.map(toM), a = pts[0], b = pts[pts.length - 1];
    const seg = { id: p.seg_id, name, type: (p.st_type || '').trim(), dir: (p.pre_dir || '').trim(), lh: +p.l_hundred, rh: +p.r_hundred, pts, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    const k = squash(name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(seg);
  }

  // 3. Find the street segments for one block.
  // The same name and number can exist in several places (N and S 5th St, a St and an Ave),
  // so each possibility is scored by how far it is from the district, and the closest wins.
  function findSegments(g) {
    for (const name of [g.name, ALIAS[g.name]]) {
      if (!name) continue;
      const found = (byName.get(squash(name)) || []).filter(s => (s.lh === g.hundred || s.rh === g.hundred) && (!g.dir || !s.dir || s.dir === g.dir));
      if (!found.length) continue;
      const variants = new Map();
      for (const s of found) { const k = s.dir + '|' + s.name + '|' + s.type; if (!variants.has(k)) variants.set(k, []); variants.get(k).push(s); }
      let best = null;
      for (const segs of variants.values()) {
        const dist = Math.min(...segs.map(s => distToDistricts(s.mid, g.districts)));
        const score = dist + (g.type && segs[0].type !== g.type ? 200 : 0);
        if (!best || score < best.score) best = { segs, dist, score };
      }
      // drop stray pieces of the same street that are far from the rest
      best.segs = best.segs.filter(s => distToDistricts(s.mid, g.districts) <= best.dist + 400);
      best.renamed = name !== g.name;
      return best;
    }
    return null;
  }

  // 4. One line per permitted side of each block
  const blocks = new Map();     // street segments + side -> feature (so repeats merge)
  const matched = [];
  for (const g of groups.values()) {
    const match = findSegments(g);
    if (match) matched.push({ g, match });
    else report.unmatched.push(g.label + ' (district ' + g.districts.join('/') + ')');
  }
  // blocks that sit far from their listed district are handled last (see below)
  matched.sort((a, b) => (a.match.dist > 1000) - (b.match.dist > 1000));

  for (const { g, match } of matched) {
    const s0 = match.segs[0];
    const label = [g.hundred, g.dir || s0.dir, s0.name, s0.type].filter(x => x !== '').join(' ');
    if (match.renamed) report.renamed.push(g.label + ' -> ' + label);
    // The outlines are hand-drawn, so a block a little outside its district is normal.
    // A block more than 1 km away is a typo in the district number: it is shown under the
    // district it actually sits in, with a note, unless that block is already on the map.
    let districts = g.districts, listedAs = null;
    if (match.dist > 150) {
      const actual = [...outlines].filter(([, o]) => insideRing(o.ringM, s0.mid)).map(([d]) => d).sort((a, b) => a - b);
      const where = `${label} (listed under district ${g.districts.join('/')}): ${Math.round(match.dist)} m outside it` + (actual.length ? `, inside district ${actual.join('/')}` : '');
      if (match.dist > 1000 && actual.length) { listedAs = g.districts; districts = actual; report.moved.push(where); }
      else report.farFromDistrict.push(where);
    }
    const segs = match.segs.map(s => trim(s.pts, END_GAP));
    const ids = match.segs.map(s => s.id).sort().join(',');

    // Which way does the block run? That decides whether its sides are N/S or E/W.
    let ax = 0, ay = 0;
    for (const s of segs) { ax += Math.abs(s[s.length - 1][0] - s[0][0]); ay += Math.abs(s[s.length - 1][1] - s[0][1]); }
    const natural = ax > ay ? NS : EW;
    // The Parking Authority's own wording wins on diagonal streets (Pennsylvania Ave, Passyunk Ave)
    const named = g.entries.map(e => e.side).filter(s => s !== 'B' && s !== '?');
    const axis = named.length ? (NS.includes(named[0]) ? NS : EW) : natural;
    // ...but "East side" of a street that plainly runs east-west cannot be placed
    const misfit = axis !== natural && Math.min(ax, ay) / Math.max(ax, ay) < 0.25;

    const wanted = new Set();
    for (const e of g.entries) {
      if (misfit || e.side === '?' || (e.side !== 'B' && !axis.includes(e.side))) wanted.add('?');
      else if (e.side === 'B') axis.forEach(s => wanted.add(s));
      else wanted.add(e.side);
    }
    if (wanted.has('?')) { wanted.clear(); wanted.add('?'); report.sideUnclear.push(label + ' ("' + [...new Set(g.entries.map(e => e.sideText))].join('", "') + '")'); }

    for (const side of wanted) {
      const entries = g.entries.filter(e => side === '?' || e.side === 'B' || e.side === side);
      let lines;
      if (side === '?') {
        lines = segs;      // drawn down the middle of the street
      } else {
        // point every segment so the permit side is on the RIGHT of the direction of travel
        const oriented = segs.map(s => {
          const dx = s[s.length - 1][0] - s[0][0], dy = s[s.length - 1][1] - s[0][1];
          return { N: -dx, S: dx, E: dy, W: -dy }[side] < 0 ? s.slice().reverse() : s;
        });
        lines = oriented.filter(s => !oriented.some(o => o !== s && furtherRight(s, o)));
      }
      const key = ids + '|' + side;
      if (listedAs && blocks.has(key)) continue;
      if (!blocks.has(key)) {
        blocks.set(key, { type: 'Feature', properties: { kind: 'block', districts: [], block: label, side, rules: [] }, geometry: { type: 'MultiLineString', coordinates: lines.map(l => l.map(toLL)) } });
      }
      const props = blocks.get(key).properties;
      for (const d of districts) if (!props.districts.includes(d)) props.districts.push(d);
      if (listedAs) props.listedAs = listedAs;
      props.districts.sort((a, b) => a - b);
      for (const e of entries) if (!props.rules.some(r => r.limit === e.limit && r.hours === e.hours)) props.rules.push({ limit: e.limit, hours: e.hours });
      if (side === '?') props.sideText = [...new Set(g.entries.map(e => e.sideText))].join(' / ');
    }
  }

  // 5. Give neighbouring districts different colours.
  // Two districts are neighbours when their outlines come close or they share a block.
  const ids = [...outlines.keys()].sort((a, b) => a - b);
  const neighbours = new Map(ids.map(d => [d, new Set()]));
  const link = (a, b) => { if (a !== b && neighbours.has(a) && neighbours.has(b)) { neighbours.get(a).add(b); neighbours.get(b).add(a); } };
  for (const a of ids) for (const b of ids) if (a < b && outlines.get(a).ringM.some(p => distToRing(outlines.get(b).ringM, p) < 400) || a < b && outlines.get(b).ringM.some(p => distToRing(outlines.get(a).ringM, p) < 400)) link(a, b);
  for (const f of blocks.values()) for (const a of f.properties.districts) for (const b of f.properties.districts) link(a, b);
  const color = new Map();
  const order = ids.slice().sort((a, b) => (b === 6) - (a === 6) || neighbours.get(b).size - neighbours.get(a).size || a - b);
  for (const d of order) {
    const taken = new Set([...neighbours.get(d)].map(n => color.get(n)));
    // of the colours no neighbour has, pick the one used least so far
    const count = c => [...color.values()].filter(v => v === c).length;
    let pick = 0;
    for (let c = 1; c < NUM_COLORS; c++) if (taken.has(pick) && !taken.has(c) || !taken.has(c) && !taken.has(pick) && count(c) < count(pick)) pick = c;
    color.set(d, pick);
  }

  // 6. Put it together
  const features = ids.map(d => ({ type: 'Feature', properties: { kind: 'district', district: d, color: color.get(d) }, geometry: { type: 'Polygon', coordinates: [outlines.get(d).ring] } }));
  const sorted = [...blocks.values()].sort((a, b) => a.properties.districts[0] - b.properties.districts[0] || a.properties.block.localeCompare(b.properties.block, 'en', { numeric: true }) || a.properties.side.localeCompare(b.properties.side));
  for (const f of sorted) {
    features.push(f);
    if (f.properties.rules.length > 1) report.mixedRules.push(f.properties.block + ' ' + f.properties.side);
    for (const d of f.properties.districts) report.perDistrict[d] = (report.perDistrict[d] || 0) + 1;
  }
  report.blocks = groups.size;
  report.lines = sorted.length;
  return { geojson: { type: 'FeatureCollection', features }, report };
}
