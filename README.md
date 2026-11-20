# Philly Permit Parking Map

An unofficial map of Philadelphia residential permit parking blocks. Each permit
block is drawn as a line on the side of the street where the permit applies,
coloured by district. Covers every district the Parking Authority publishes.

**Posted signs always win.** The data comes from the Parking Authority's published
list, which can be out of date or wrong.

## Reading the map

- A solid line is a permit block. Its colour shows the district.
- A line with two alternating colours is a block shared by two districts.
- A dashed outline is a district boundary. These are approximate.
- Tap a line for the time limit and hours that apply to cars without a permit.

## Files

- `index.html` is the whole map page (Leaflet + OpenStreetMap).
- `data/parking.geojson` is the map data: the district outlines and one line per block side.
- `build/` holds the script that rebuilds the data from the official sources.

## Hosting

The site is plain static files, served by GitHub Pages from the `main` branch root:
https://jessehaycraft.github.io/PhillyParkingBetterMap/

The page must be opened from a web server. Double-clicking `index.html` will not load the data.
To preview locally, run `python -m http.server 8000` in this folder and open http://localhost:8000.

## Refreshing the data

Needs Node 18 or newer:

    node build/build.mjs

This downloads the Parking Authority map and the City's Street Centerlines, matches
each permit block to its street segments, and rewrites `data/parking.geojson`.
It prints a report listing any blocks it could not place.

## Known gaps

- The Parking Authority lists whole blocks only, so a line covers the full block even
  where the signs cover part of it.
- A handful of listed blocks have no matching street segment and are not drawn.
  Permit parking lots are not drawn either. The build report names them.
- A few blocks are listed with a side that does not fit the street (for example the
  "east side" of an east-west street). Those are drawn down the middle of the street.

## Sources

- Philadelphia Parking Authority, "Residential Parking Districts & Permit Streets" map
- City of Philadelphia, Street Centerlines (OpenDataPhilly)
- Base map © OpenStreetMap contributors
