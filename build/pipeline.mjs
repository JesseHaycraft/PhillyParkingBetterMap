export function buildDistrict(kml, centerlines, district) {
  const report = { unparsed: [], unmatched: [], sideIssues: [], outside: [], mixed: [] };
  const un = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();
  const placemarks = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || [];
  const tag = (pm, t) => { const m = pm.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? un(m[1]) : ''; };
  const data = pm => { const o = {}; for (const m of pm.matchAll(/<Data name="([^"]+)">\s*<value>([\s\S]*?)<\/value>/g)) o[m[1]] = un(m[2]); return o; };

  // 1. District outline
  let ring = null;
  for (const pm of placemarks) {
    if (!pm.includes('<Polygon>')) continue;
    const m = tag(pm, 'name').match(/#\s*(\d+)\s*$/);
    if (m && +m[1] === district) ring = tag(pm, 'coordinates').split(/\s+/).map(c => c.split(',').slice(0, 2).map(v => +(+v).toFixed(5)));
  }
  if (!ring) throw new Error('District ' + district + ' outline not found');

  // 2. Permit block entries, cleaned and grouped by block
  const ALIAS = { 'MT VERNON': 'MOUNT VERNON', 'PARK TOWN': 'PARK TOWNE', 'FRANKLINTOWN': 'FRANKLIN TOWN' };
  const sideOf = s => { s = s.toUpperCase().trim(); if (/^B/.test(s)) return 'B'; const m = s.match(/^[NSEW]/); return m ? m[0] : '?'; };
  const hoursOf = s => s.toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  const parse = name => {
    const m = name.toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
      .match(/^(\d+)(?:\s*-\s*\d+)?\s+(?:([NSEW])\s+)?(.+?)(?:\s+(ST|AVE|BLVD|PL|RD|DR|LN|CT|WAY|TER|PKWY|CIR|SQ|WALK|ALY))?$/);
    if (!m) return null;
    return { hundred: Math.floor(+m[1] / 100) * 100, dir: m[2] || '', name: ALIAS[m[3]] || m[3], type: m[4] || '' };
  };
  const groups = new Map();
  for (const pm of placemarks) {
    const d = data(pm);
    if (parseFloat(d['RPP#']) !== district) continue;
    const raw = tag(pm, 'name'), p = parse(raw);
    if (!p) { report.unparsed.push(raw); continue; }
    const key = [p.hundred, p.dir, p.name, p.type].filter(x => x !== '').join(' ');
    if (!groups.has(key)) groups.set(key, { ...p, key, entries: [] });
    groups.get(key).entries.push({ side: sideOf(d['Sides'] || ''), limit: (d['HR.'] || '').toUpperCase().trim(), hours: hoursOf(d['Regulations'] || '') });
  }

  // 3. Geometry helpers (work in metres on a local flat grid)
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length, KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110540;
  const toM = c => [c[0] * KX, c[1] * KY], toLL = m => [+(m[0] / KX).toFixed(5), +(m[1] / KY).toFixed(5)];
  const trim = (pts, t) => { // cut t metres off both ends so lines stop short of intersections
    const len = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { len.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); L += len[i - 1]; }
    if (L < 4 * t) return pts;
    const at = d => { let acc = 0; for (let i = 0; i < len.length; i++) { if (acc + len[i] >= d) { const f = (d - acc) / len[i]; return { i, p: [pts[i][0] + f * (pts[i + 1][0] - pts[i][0]), pts[i][1] + f * (pts[i + 1][1] - pts[i][1])] }; } acc += len[i]; } return { i: len.length - 1, p: pts[pts.length - 1] }; };
    const a = at(t), b = at(L - t);
    return [a.p, ...pts.slice(a.i + 1, b.i + 1), b.p];
  };
  // true when roadway o runs alongside s but further toward the permit side (divided streets)
  const furtherRight = (s, o) => { const a = s[0], b = s[s.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const m = [(o[0][0] + o[o.length - 1][0]) / 2, (o[0][1] + o[o.length - 1][1]) / 2]; const t = ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / L2; return t > 0 && t < 1 && ((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / Math.sqrt(L2) > 4; };
  const inRing = p => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const distToRing = p => { const P = toM(p); let best = Infinity; for (let i = 1; i < ring.length; i++) { const A = toM(ring[i - 1]), B = toM(ring[i]); const vx = B[0] - A[0], vy = B[1] - A[1]; let t = ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / (vx * vx + vy * vy); t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(P[0] - A[0] - t * vx, P[1] - A[1] - t * vy)); } return best; };

  // 4. Match each block to street centerline segments, one feature per permitted side
  const features = [{ type: 'Feature', properties: { kind: 'district', district }, geometry: { type: 'Polygon', coordinates: [ring] } }];
  for (const g of groups.values()) {
    const segs = centerlines.filter(f => { const p = f.properties; return (p.st_name || '').trim() === g.name && (!g.type || (p.st_type || '').trim() === g.type) && (!g.dir || (p.pre_dir || '').trim() === g.dir) && (+p.l_hundred === g.hundred || +p.r_hundred === g.hundred); })
      .map(f => trim(f.geometry.coordinates.map(toM), 7));
    if (!segs.length) { report.unmatched.push(g.key); continue; }
    const mid = toLL(segs[0][Math.floor(segs[0].length / 2)]);
    if (!inRing(mid) && distToRing(mid) > 120) report.outside.push(g.key + ' (' + Math.round(distToRing(mid)) + ' m)');
    let ax = 0, ay = 0;
    for (const s of segs) { ax += Math.abs(s[s.length - 1][0] - s[0][0]); ay += Math.abs(s[s.length - 1][1] - s[0][1]); }
    // PPA's own wording decides the side names (matters on diagonal streets like Pennsylvania Ave)
    const NS = ['N', 'S'], EW = ['E', 'W'], natural = ax > ay ? NS : EW;
    const stated = g.entries.map(e => e.side).filter(s => s !== 'B' && s !== '?');
    const axis = stated.length ? (NS.includes(stated[0]) ? NS : EW) : natural;
    if (axis !== natural && Math.min(ax, ay) / Math.max(ax, ay) < 0.25) report.sideIssues.push(g.key + ' (stated side does not fit the street direction)');
    const wanted = new Set();
    for (const e of g.entries) { if (e.side === 'B') axis.forEach(s => wanted.add(s)); else if (axis.includes(e.side)) wanted.add(e.side); else report.sideIssues.push(g.key + ' (side unclear)'); }
    for (const side of wanted) {
      const seen = new Set(), rules = [];
      for (const e of g.entries) if (e.side === 'B' || e.side === side) { const k = e.limit + '|' + e.hours; if (!seen.has(k)) { seen.add(k); rules.push({ limit: e.limit, hours: e.hours }); } }
      // orient every segment so the permit side is on the RIGHT of the direction of travel
      const oriented = segs.map(s => { const dx = s[s.length - 1][0] - s[0][0], dy = s[s.length - 1][1] - s[0][1]; const comp = { N: -dx, S: dx, E: dy, W: -dy }[side]; return comp < 0 ? s.slice().reverse() : s; });
      const lines = oriented.filter(s => !oriented.some(o => o !== s && furtherRight(s, o))).map(s => s.map(toLL));
      if (rules.length > 1) report.mixed.push(g.key + ' ' + side);
      features.push({ type: 'Feature', properties: { kind: 'block', district, block: g.key, side, rules }, geometry: { type: 'MultiLineString', coordinates: lines } });
    }
  }
  report.entries = [...groups.values()].reduce((a, g) => a + g.entries.length, 0); report.blocks = groups.size; report.features = features.length - 1;
  return { geojson: { type: 'FeatureCollection', features }, report };
}
