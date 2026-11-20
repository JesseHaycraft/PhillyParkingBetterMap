// Rebuilds data/parking.geojson (every district) from the official sources.
// Usage (needs Node 18 or newer):   node build/build.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { buildAll } from './pipeline.mjs';

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
  const url = STREETS_URL + '?where=1%3D1&outFields=pre_dir,st_name,st_type,l_hundred,r_hundred,seg_id&outSR=4326&f=geojson'
    + '&orderByFields=seg_id&resultRecordCount=2000&resultOffset=' + streets.length;
  const page = (await (await fetch(url)).json()).features || [];
  if (!page.length) break;
  streets = streets.concat(page);
}

const { geojson, report } = buildAll(kml, streets);

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
};
for (const [key, title] of Object.entries(sections)) {
  if (report[key].length) console.log(`\n${title} (${report[key].length}):\n  ` + report[key].join('\n  '));
}

const out = { type: 'FeatureCollection', generated: new Date().toISOString().slice(0, 10),
  source: 'Philadelphia Parking Authority "Residential Parking Districts & Permit Streets" map + City of Philadelphia Street Centerlines',
  features: geojson.features };
await mkdir('data', { recursive: true });
await writeFile('data/parking.geojson', JSON.stringify(out).replace(/\{"type":"Feature"/g, '\n{"type":"Feature"').replace(/\]\}$/, '\n]}'));
console.log(`\nWrote data/parking.geojson`);
