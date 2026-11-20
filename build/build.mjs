// Rebuilds data/district-N.geojson from the official sources.
// Usage (needs Node 18 or newer):   node build/build.mjs 6
import { writeFile, mkdir } from 'node:fs/promises';
import { buildDistrict } from './pipeline.mjs';

const district = Number(process.argv[2] || 6);
// PPA "Residential Parking Districts & Permit Streets" map, exported as KML
const KML_URL = 'https://www.google.com/maps/d/kml?mid=1c89qjwKU8xqE58aZdTUCaUfrY9PwwJ0&forcekml=1';
// City of Philadelphia Street Centerlines (OpenDataPhilly)
const STREETS_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Street_Centerline/FeatureServer/0/query';

const kml = await (await fetch(KML_URL)).text();

// First pass with no streets, just to read the district outline and get its bounding box
const ring = buildDistrict(kml, [], district).geojson.features[0].geometry.coordinates[0];
const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
const bbox = [Math.min(...xs) - 0.001, Math.min(...ys) - 0.001, Math.max(...xs) + 0.001, Math.max(...ys) + 0.001].join(',');

// Download every street segment inside that box, 1000 at a time
let streets = [];
for (;;) {
  const url = STREETS_URL + '?where=1%3D1&geometry=' + bbox + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects'
    + '&outFields=pre_dir,st_name,st_type,l_hundred,r_hundred,seg_id&outSR=4326&f=geojson&orderByFields=seg_id&resultRecordCount=1000&resultOffset=' + streets.length;
  const page = (await (await fetch(url)).json()).features || [];
  streets = streets.concat(page);
  if (page.length < 1000) break;
}

const { geojson, report } = buildDistrict(kml, streets, district);
console.log(report);

const out = { type: 'FeatureCollection', generated: new Date().toISOString().slice(0, 10),
  source: 'Philadelphia Parking Authority "Residential Parking Districts & Permit Streets" map + City of Philadelphia Street Centerlines',
  features: geojson.features };
await mkdir('data', { recursive: true });
await writeFile(`data/district-${district}.geojson`, JSON.stringify(out).replace(/\{"type":"Feature"/g, '\n{"type":"Feature"').replace(/\]\}$/, '\n]}'));
console.log(`Wrote data/district-${district}.geojson with ${report.features} block sides`);
