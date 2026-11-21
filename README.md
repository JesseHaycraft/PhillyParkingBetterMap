# Philly Permit Parking Map

An unofficial map of Philadelphia's residential permit parking. The Parking Authority's
map marks each permit block with a pin. This one draws a line along the side of the
street where the permit applies, coloured by district.

Live map: https://jessehaycraft.github.io/PhillyParkingBetterMap/

**Posted signs always win.** The data comes from the Parking Authority's published list,
which has mistakes and can be out of date.

## Using it

- Tap a line for the time limit and hours that apply without a permit.
- A two-colour line is a block shared by two districts. Dashed outlines are district
  boundaries, roughly.
- "Walk times" colours one district's blocks by how far they are on foot from an address,
  your location or a spot you tap, up to 20 minutes. A typed address is looked up through
  OpenStreetMap's Nominatim. Your location and tapped spots stay in your browser.

## Things to know

- The list only gives whole blocks, so a line runs the full block even where the signs
  cover part of it.
- "East Side" in the list is unreliable. Going by the City's 2025 aerial photos, 126 of
  those blocks clearly have cars only on the west side, so they are drawn there
  (`build/side-corrections.json`, full results in `checks/`). Others may still be on the
  wrong side.
- A few listed blocks couldn't be matched to a street and aren't drawn. Permit lots
  aren't drawn either.
- Walk times assume about 3 mph along the City's street network. No hills, no waiting
  at lights.

## Running it

It's plain static files. Opening `index.html` directly won't load the data, so serve the
folder instead:

    python -m http.server 8000

To rebuild the data from the sources (Node 18 or newer, takes about a minute):

    node build/build.mjs

That rewrites the two files in `data/` and prints any blocks it couldn't place.

## Sources

- Philadelphia Parking Authority, "Residential Parking Districts & Permit Streets" map
- City of Philadelphia, Street Centerlines and 2025 aerial imagery
- Base map and address search © OpenStreetMap contributors
