# Philly Permit Parking Map

An unofficial map of Philadelphia residential permit parking blocks. Each permit
block is drawn as a line on the side of the street where the permit applies.
Currently covers **District 6** only.

**Posted signs always win.** The data comes from the Parking Authority's published
list, which can be out of date or wrong.

## Files

- `index.html` is the whole map page (Leaflet + OpenStreetMap).
- `data/district-6.geojson` is the map data: the district outline and one line per block side.
- `build/` holds the script that rebuilds the data from the official sources.

## Hosting

The site is plain static files, served by GitHub Pages from the `main` branch root:
https://jessehaycraft.github.io/PhillyParkingBetterMap/

The page must be opened from a web server. Double-clicking `index.html` will not load the data.
To preview locally, run `python -m http.server 8000` in this folder and open http://localhost:8000.

## Refreshing the data

Needs Node 18 or newer:

    node build/build.mjs 6

This downloads the Parking Authority map and the City's Street Centerlines, matches
each permit block to its street segments, and rewrites `data/district-6.geojson`.
It prints a report listing any blocks it could not match.

## Sources

- Philadelphia Parking Authority, "Residential Parking Districts & Permit Streets" map
- City of Philadelphia, Street Centerlines (OpenDataPhilly)
- Base map © OpenStreetMap contributors
