# CLAUDE.md

A TRMNL private plugin (plugin setting **511113**, framework `latest`; built against 3.4.3) showing the
hazard flag of the beach nearest a location, from the
[Swim Report API](https://swim.report/api/openapi.json). Sibling repo: `../swim.report`.

## Data flow

- **Strategy:** `polling`, URL `https://swim.report/api/beaches?near={{ location }}`.
  A blank `near`, or coordinates with a space and no comma, is a 400 upstream;
  a space after the comma (`lat, lon`) is fine. A successful poll is always
  `sort: "distance"`.
- **Transform:** `serverless.js` (uploaded to the `transform_js` slot). It reads the
  polled list, refetches it itself when the poll failed (`parseLocation`
  normalizes `lat lon` to `lat,lon`, or answers "Set a location"), then
  fetches `/api/beaches/{id}` for the nearest beach and outputs `{ beach, error }`.
  The list only carries `display`; reason, waves, rip risk and alerts need the detail.
  A nearest beach farther than 50 mi (fixed, no setting; shown as 80 km in metric)
  becomes an error screen, since the API always names some beach, even an ocean away.
- **Custom fields:** `custom_fields.yml` — `author_bio` ("About This Plugin", same shape as the sibling plugins), `location` (`field_type: lat_lon`: TRMNL's place search, stored as `lat,lon`), `units`
  (`imperial`/`metric`; conversion happens in the transform), `timemode`.
  Custom field *values* cannot be written via the TRMNL API; set them in the UI.

## API display rules (from the spec — keep them)

- Label estimates as estimates (`source_label`), never as a posted flag.
- `unknown` renders gray (`label--gray`), never green.
- Always remind people to obey posted flags and lifeguards.
- Official sentences come from `swim.report/src/frontend/verdict.js`.

## Templates

All markup is in `shared.liquid`; the four size files only
`{% render 'main', ..., size: '<size>' %}`. Partials: `main`, `details`
(the stack shared by `full` and `half_vertical`), `flag`, `glyph`, `stats`, `alerts`,
`title_bar`. Framework classes only — no custom CSS.

- The flag is an icon plus plain text, not a pill: the Font Awesome flag (tight
  448x512 viewBox; double-red stacks a second banner at +370) as a data-URI
  `<img class="image--adaptive" data-flag-color>`, which the runtime turns into a
  mask, painted by `TRMNLPaint.apply(img, swimFlagPaint(color, el))`. The `glyph`
  partial emits only the encoded SVG; the `src` is a literal `data:image/svg+xml,`
  plus `{{ glyph }}`, because recipe validation GETs any `<img>` src that isn't
  Liquid output. `main` opens
  with one script defining the helpers (`swimWhen`, the ready-wait; `swimFlagPaint`,
  flag color to paint) and ends with the pass that paints every flag glyph, so the
  `flag` partial has no script and the helpers exist before any caller. `swimFlagPaint`
  maps the raw flag color to a token: the hues `green`,
  `yellow`, `red` and `gray-50` for unknown, not the semantic roles, because
  `warning` maps to orange. Don't use `fill="currentColor"` with `text--*`: on
  dithered screens `text--*` sets `color` to transparent and paints a clipped
  background. The black `image-stroke` sits on a wrapper span because CSS applies
  filter before mask. The linter's `image-dither` warning doesn't apply to a mask.
- Limited color palettes snap a hue they lack to the closest ink (B/W/R/Y prints
  green as yellow, a wrong and unsafe flag). `swimFlagPaint` (also used by the
  map markers) checks the screen's
  `screen--color-3bwr`/`3bwy`/`4bwry` class and gives a missing hue the gray
  1-bit prints for it (green/yellow `gray-60`, red `gray-40`). The map is left
  as the framework paints it (water and parks turn red/yellow on B/W/R/Y);
  re-pointing its slots needs inline slot vars or style internals, both declined.
- Avoid `label--gray` for body text: it dithers on 1-bit.
- `.flex--col` and `.layout` center their children; use `flex--left` /
  `layout--left` for left-aligned stacks.
- `full` adds a framework map (`.map` + `TRMNLMaps`, MapLibre 5.24.0 from trmnl.com,
  `streets` preset, zoom 13, `labels: true`; `'major'` showed nothing at zoom 13 and
  there is no `'minor'`) beside the details; `portrait:layout--col` stacks it.
  Beaches are `maplibregl.Marker`s built from the same painted flag glyph (the
  `glyph` partial), with the pole's foot on the point (`anchor: bottom-left`). The
  selected beach is large; `beach.nearby` (transform: other beaches within 5 mi,
  max 30, `[lon, lat, color]`) are small. A neighbor within 24 px of a kept flag
  is skipped, and markers are added in reverse so the selected flag draws on top.
  Markers carry `z--2`. The runtime adds its `map__dither` canvas (the dithered
  fills, drawn once the map is idle) to `.maplibregl-canvas-container`, the
  same container as the markers. Without a z-index it paints over them, and the
  flags show while loading, then vanish. `z--2` also clears the label overlay (z 1).
  Script-made images aren't armed by the runtime, so they get
  `--framework-icon-src` and `data-adaptive` by hand. The map doesn't fetch
  `beaches.geojson` (1.5 MB, every beach); the polled near-list already has
  coordinates and colors.
- Sizes scale with `lg:` for TRMNL X; base sizes target TRMNL OG.
- The update time uses `date: '%s' | plus: trmnl.user.utc_offset | date: mask`.
- Title bar icon: inline Font Awesome Free solid flag (swim.report's glyph).

## Deploying

There is no CLI sync: push each file through the TRMNL MCP `writeMarkup`
(`markup_full`, `markup_half_horizontal`, `markup_half_vertical`, `markup_quadrant`,
`markup_shared`, `transform_js`), then `startRefresh` and `startPreview` on
`og_plus`, `v2` and `og_bwry` (color problems are invisible without it).
