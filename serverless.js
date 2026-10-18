// TRMNL serverless transform (Node.js runtime) for Swim Report.
//
// Input (from TRMNL):
//   The polled https://swim.report/api/beaches?near={{ location }} list, at the
//   root.
//   trmnl.plugin_settings.custom_fields_values: { location, units }
// The list only carries each beach's display flag, so the nearest beach's full
// record (reason, waves, rip risk, alerts) is fetched here from
// /api/beaches/{id}. If the poll failed (a blank location, or one typed as
// "lat lon" with no comma, both 400s upstream), the list is fetched here too.
//
// Output: { beach, error } — one display-ready object consumed by shared.liquid.

const API = 'https://swim.report';

const FLAG_LABELS = {
  green: 'GREEN',
  yellow: 'YELLOW',
  red: 'RED',
  'double-red': 'DOUBLE RED',
  unknown: 'UNKNOWN',
};

// swim.report's own verdict sentences (src/frontend/verdict.js), so the screen
// says what the site says.
const OFFICIAL_SENTENCES = {
  green: 'A green flag is posted at the beach.',
  yellow: 'A yellow flag is posted at the beach.',
  red: 'A red flag is posted at the beach.',
  'double-red': 'Water closed by the posted flag.',
};
const FORECAST_SENTENCES = {
  green: 'The NWS beach forecast calls for green-flag conditions today.',
  yellow: 'The NWS beach forecast calls for yellow-flag conditions today.',
  red: 'The NWS beach forecast calls for red-flag conditions today.',
  'double-red': 'The NWS beach forecast closes the water today.',
};
const NO_DATA_SENTENCE = 'No data yet for this beach.';

// The API always names a nearest beach, even 800 mi inland or an ocean away; past
// this the screen says so instead of showing a beach nobody there would visit.
const MAX_DISTANCE_MI = 50;

// "42.77, -86.21" or "42.77 -86.21" -> "42.77,-86.21"; null when unparseable.
function parseLocation(text) {
  const m = String(text || '').match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `${lat},${lon}`;
}

async function getJson(path) {
  const res = await fetch(API + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`swim.report answered ${res.status}`);
  return res.json();
}

function formatWave(ft, metric) {
  if (typeof ft !== 'number') return null;
  return metric ? `${(ft * 0.3048).toFixed(1)} m` : `${ft.toFixed(1)} ft`;
}

function formatDistance(mi, metric) {
  if (typeof mi !== 'number') return null;
  return metric ? `${(mi * 1.609344).toFixed(1)} km` : `${mi.toFixed(1)} mi`;
}

// The estimate's alert events, deduped, in feed order.
function alertEvents(estimate) {
  const events = [];
  for (const detail of (estimate && estimate.alertDetails) || []) {
    if (detail && detail.event && !events.includes(detail.event)) events.push(detail.event);
  }
  return events;
}

// The other beaches close enough to land on the full layout's map, as small
// flags: [lon, lat, color], nearest first. The polled list already carries them,
// so the map never downloads beaches.geojson (1.5 MB) per render.
const NEARBY_MAX_MI = 5;
const NEARBY_MAX = 30;
function nearbyFlags(beaches) {
  return beaches
    .filter((b) => typeof b.lat === 'number' && typeof b.lon === 'number' &&
      typeof b.distanceMi === 'number' && b.distanceMi <= NEARBY_MAX_MI)
    .slice(0, NEARBY_MAX)
    .map((b) => [b.lon, b.lat, b.display.color]);
}

function summarize(display, estimate) {
  if (display.source === 'official') {
    return (display.forecast ? FORECAST_SENTENCES : OFFICIAL_SENTENCES)[display.color] || NO_DATA_SENTENCE;
  }
  if (display.source === 'estimate' && estimate && estimate.reason) return estimate.reason;
  return NO_DATA_SENTENCE;
}

function sourceLabel(display) {
  if (display.source === 'official') return display.forecast ? 'Official forecast' : 'Official';
  if (display.source === 'estimate') return 'Estimate';
  return 'No data';
}

async function run(input) {
  const fields = (input && input.trmnl && input.trmnl.plugin_settings &&
    input.trmnl.plugin_settings.custom_fields_values) || {};
  const metric = fields.units === 'metric';

  let list = input;
  try {
    if (!Array.isArray(list.beaches)) {
      const near = parseLocation(fields.location);
      if (!near) return { beach: null, error: 'Set a location in the plugin settings.' };
      list = await getJson(`/api/beaches?near=${near}`);
    }
    const nearest = list.beaches[0];
    if (!nearest || !(nearest.distanceMi <= MAX_DISTANCE_MI)) {
      return { beach: null, error: `No beaches within ${metric ? '80 km' : `${MAX_DISTANCE_MI} miles`} of this location.` };
    }

    // The list's display flag stands if the detail fetch fails.
    const detail = await getJson(`/api/beaches/${nearest.id}`).catch(() => null);
    const display = (detail && detail.display) || nearest.display;
    const estimate = detail && detail.estimate;
    const official = detail && detail.official;
    const updated = display.source === 'official' ? official && official.updated
      : display.source === 'estimate' ? estimate && estimate.updated : null;

    return {
      beach: {
        name: nearest.name,
        lat: nearest.lat,
        lon: nearest.lon,
        color: display.color,
        label: FLAG_LABELS[display.color] || FLAG_LABELS.unknown,
        source: display.source,
        source_label: sourceLabel(display),
        summary: summarize(display, estimate),
        wave: formatWave(estimate && estimate.waveHeightFt, metric),
        rip: (estimate && estimate.ripCurrentRisk) || null,
        alerts: alertEvents(estimate).slice(0, 3),
        distance: formatDistance(nearest.distanceMi, metric),
        updated: updated || list.builtAt || null,
        nearby: nearbyFlags(list.beaches.slice(1)),
      },
      error: null,
    };
  } catch (e) {
    return { beach: null, error: 'Swim Report is unavailable right now.' };
  }
}
