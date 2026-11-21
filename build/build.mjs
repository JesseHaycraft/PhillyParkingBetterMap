// Rebuilds data/parking.geojson (every district) and data/walk.json (the walking network)
// from the official sources.
// Usage (needs Node 18 or newer):   node build/build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildAll, buildWalk } from './pipeline.mjs';

// Blocks where the listed side is known to be wrong (see the "about" line inside the file)
const corrections = JSON.parse(await readFile(new URL('./side-corrections.json', import.meta.url), 'utf8'));

// PPA "Residential Parking Districts & Permit Streets" map, exported as KML
const KML_URL = 'https://www.google.com/maps/d/kml?mid=1c89qjwKU8xqE58aZdTUCaUfrY9PwwJ0&forcekml=1';
// City of Philadelphia Street Centerlines (OpenDataPhilly)
const STREETS_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Street_Centerline/FeatureServer/0/query';

console.log('Downloading the Parking Authority map...');
const kml = await (await fetch(KML_URL)).text();

// Every street segment in the city, 2000 at a time
console.log('Downloading the street centerlines (about 41,000 segments)...');
let streets = [];
for (;;) {
  const url = STREETS_URL + '?where=1%3D1&outFields=pre_dir,st_name,st_type,l_hundred,r_hundred,seg_id,class&outSR=4326&f=geojson'
    + '&orderByFields=seg_id&resultRecordCount=2000&resultOffset=' + streets.length;
  const page = (await (await fetch(url)).json()).features || [];
  if (!page.length) break;
  streets = streets.concat(page);
}

const { geojson, report } = buildAll(kml, streets, corrections);

// The report: anything listed here is worth a look
console.log(`\n${report.entries} entries in the Parking Authority list -> ${report.blocks} blocks -> ${report.lines} lines on the map`);
console.log('Lines per district: ' + Object.entries(report.perDistrict).map(([d, n]) => `${d}: ${n}`).join(', '));
const sections = {
  unparsed: 'Entries that could not be read',
  unmatched: 'Blocks with no matching street segment (not on the map)',
  lots: 'Parking lots (not on the map)',
  renamed: 'Blocks found under a different spelling',
  moved: 'Blocks more than 1 km from their listed district (shown under the district they sit in)',
  farFromDistrict: 'Blocks well outside their district outline (kept as listed)',
  sideUnclear: 'Blocks whose stated side does not fit the street (drawn down the middle)',
  mixedRules: 'Block sides with more than one set of rules',
  correctionsUnused: 'Entries in side-corrections.json that no longer match a block listed as East Side only',
};
console.log(`Blocks moved from the east side to the west side by side-corrections.json: ${report.sideCorrected.length}`);
for (const [key, title] of Object.entries(sections)) {
  if (report[key].length) console.log(`\n${title} (${report[key].length}):\n  ` + report[key].join('\n  '));
}

const out = { type: 'FeatureCollection', generated: new Date().toLocaleDateString('en-CA'),   // today's date here, as 2026-01-31
  source: 'Philadelphia Parking Authority "Residential Parking Districts & Permit Streets" map + City of Philadelphia Street Centerlines',
  features: geojson.features };
await mkdir('data', { recursive: true });
await writeFile('data/parking.geojson', JSON.stringify(out).replace(/\{"type":"Feature"/g, '\n{"type":"Feature"').replace(/\]\}$/, '\n]}'));
console.log(`\nWrote data/parking.geojson`);

// The street network for the walk-time view
const walk = buildWalk(streets);
await writeFile('data/walk.json', JSON.stringify(walk));
console.log(`Wrote data/walk.json: ${walk.n.length / 2} corners, ${walk.e.length / 3} street pieces`);
