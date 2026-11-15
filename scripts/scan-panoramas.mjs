#!/usr/bin/env node
/**
 * Builds the round pool for BladiGuessr out of Mapillary's street-level imagery.
 *
 * Mapillary is the only free, openly licensed source of street-level imagery
 * (CC BY-SA) that also allows use inside a game, so the game's playable area is
 * exactly the area Mapillary contributors have driven. This script asks the
 * coverage tiles where 360° panoramas exist around a list of Moroccan towns,
 * groups them into chains the player can actually walk along, and writes
 * `data/panoramas.json`.
 *
 * Usage:
 *   MAPILLARY_TOKEN=MLY|... node scripts/scan-panoramas.mjs
 *   MAPILLARY_TOKEN=MLY|... node scripts/scan-panoramas.mjs --only casablanca
 *
 * Re-run it after new imagery is uploaded (including your own drives) to grow
 * the pool. Everything is committed, so the game itself never hard-codes an
 * image id.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

// Next reads .env.local for us; plain node does not. Load it so `npm run scan`
// works with the same file the app uses.
for (const file of [".env.local", ".env"]) {
  try {
    const contents = await readFile(file, "utf8");
    for (const line of contents.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // No env file is fine: the token may come from the shell.
  }
}

const TOKEN = process.env.MAPILLARY_TOKEN || process.env.NEXT_PUBLIC_MAPILLARY_TOKEN;
if (!TOKEN) {
  console.error(
    "MAPILLARY_TOKEN is required.\n" +
      "Create a free app at https://www.mapillary.com/dashboard/developers and copy its client token.",
  );
  process.exit(1);
}

const Z = 13; // ~4.4 km per tile at Morocco's latitudes
const CLUSTER_METRES = 30; // two panoramas this close are walkable neighbours
const MAX_PER_CITY = 14;

/** Towns to look at, with how many tiles to scan around each (odd numbers). */
const SEEDS = [
  { id: "casablanca", city: "الدار البيضاء", region: "الدار البيضاء - سطات", lat: 33.5731, lng: -7.5898, grid: 5 },
  { id: "rabat", city: "الرباط", region: "الرباط - سلا - القنيطرة", lat: 34.0209, lng: -6.8416, grid: 5 },
  { id: "marrakech", city: "مراكش", region: "مراكش - آسفي", lat: 31.6295, lng: -7.9811, grid: 5 },
  { id: "fes", city: "فاس", region: "فاس - مكناس", lat: 34.0331, lng: -5.0003, grid: 4 },
  { id: "tanger", city: "طنجة", region: "طنجة - تطوان - الحسيمة", lat: 35.7595, lng: -5.834, grid: 4 },
  { id: "agadir", city: "أكادير", region: "سوس - ماسة", lat: 30.4278, lng: -9.5981, grid: 4 },
  { id: "meknes", city: "مكناس", region: "فاس - مكناس", lat: 33.8935, lng: -5.5473, grid: 3 },
  { id: "oujda", city: "وجدة", region: "الشرق", lat: 34.6814, lng: -1.9086, grid: 3 },
  { id: "kenitra", city: "القنيطرة", region: "الرباط - سلا - القنيطرة", lat: 34.261, lng: -6.5802, grid: 3 },
  { id: "tetouan", city: "تطوان", region: "طنجة - تطوان - الحسيمة", lat: 35.5785, lng: -5.3684, grid: 3 },
  { id: "safi", city: "آسفي", region: "مراكش - آسفي", lat: 32.2994, lng: -9.2372, grid: 3 },
  { id: "eljadida", city: "الجديدة", region: "الدار البيضاء - سطات", lat: 33.2549, lng: -8.506, grid: 3 },
  { id: "mohammedia", city: "المحمدية", region: "الدار البيضاء - سطات", lat: 33.6866, lng: -7.383, grid: 3 },
  { id: "sale", city: "سلا", region: "الرباط - سلا - القنيطرة", lat: 34.0531, lng: -6.7985, grid: 3 },
  { id: "nador", city: "الناظور", region: "الشرق", lat: 35.1681, lng: -2.9335, grid: 3 },
  { id: "benimellal", city: "بني ملال", region: "بني ملال - خنيفرة", lat: 32.3373, lng: -6.3498, grid: 3 },
  { id: "khouribga", city: "خريبكة", region: "بني ملال - خنيفرة", lat: 32.8811, lng: -6.9063, grid: 3 },
  { id: "settat", city: "سطات", region: "الدار البيضاء - سطات", lat: 33.001, lng: -7.6166, grid: 3 },
  { id: "taza", city: "تازة", region: "فاس - مكناس", lat: 34.21, lng: -4.01, grid: 3 },
  { id: "larache", city: "العرائش", region: "طنجة - تطوان - الحسيمة", lat: 35.1932, lng: -6.1557, grid: 3 },
  { id: "asilah", city: "أصيلة", region: "طنجة - تطوان - الحسيمة", lat: 35.4652, lng: -6.0342, grid: 3 },
  { id: "chefchaouen", city: "شفشاون", region: "طنجة - تطوان - الحسيمة", lat: 35.1688, lng: -5.2636, grid: 3 },
  { id: "alhoceima", city: "الحسيمة", region: "طنجة - تطوان - الحسيمة", lat: 35.2517, lng: -3.9372, grid: 3 },
  { id: "errachidia", city: "الرشيدية", region: "درعة - تافيلالت", lat: 31.9314, lng: -4.4245, grid: 3 },
  { id: "ouarzazate", city: "ورزازات", region: "درعة - تافيلالت", lat: 30.9189, lng: -6.8934, grid: 3 },
  { id: "zagora", city: "زاكورة", region: "درعة - تافيلالت", lat: 30.3324, lng: -5.8372, grid: 3 },
  { id: "tinghir", city: "تنغير", region: "درعة - تافيلالت", lat: 31.5147, lng: -5.5326, grid: 3 },
  { id: "erfoud", city: "أرفود", region: "درعة - تافيلالت", lat: 31.494, lng: -4.2337, grid: 3 },
  { id: "merzouga", city: "مرزوكة", region: "درعة - تافيلالت", lat: 31.0996, lng: -4.0113, grid: 3 },
  { id: "midelt", city: "ميدلت", region: "درعة - تافيلالت", lat: 32.6852, lng: -4.7447, grid: 3 },
  { id: "azrou", city: "أزرو", region: "فاس - مكناس", lat: 33.4344, lng: -5.2214, grid: 3 },
  { id: "ifrane", city: "إفران", region: "فاس - مكناس", lat: 33.5228, lng: -5.1106, grid: 3 },
  { id: "khenifra", city: "خنيفرة", region: "بني ملال - خنيفرة", lat: 32.9394, lng: -5.6675, grid: 3 },
  { id: "essaouira", city: "الصويرة", region: "مراكش - آسفي", lat: 31.5085, lng: -9.7595, grid: 3 },
  { id: "oualidia", city: "الواليدية", region: "الدار البيضاء - سطات", lat: 32.7333, lng: -9.0333, grid: 3 },
  { id: "taroudant", city: "تارودانت", region: "سوس - ماسة", lat: 30.4703, lng: -8.8769, grid: 3 },
  { id: "tiznit", city: "تيزنيت", region: "سوس - ماسة", lat: 29.6974, lng: -9.7316, grid: 3 },
  { id: "guelmim", city: "كلميم", region: "كلميم - واد نون", lat: 28.987, lng: -10.0574, grid: 3 },
  { id: "tanttan", city: "طانطان", region: "كلميم - واد نون", lat: 28.438, lng: -11.102, grid: 3 },
  { id: "tarfaya", city: "طرفاية", region: "العيون - الساقية الحمراء", lat: 27.9394, lng: -12.9274, grid: 3 },
  { id: "laayoune", city: "العيون", region: "العيون - الساقية الحمراء", lat: 27.1536, lng: -13.2033, grid: 3 },
  { id: "boujdour", city: "بوجدور", region: "العيون - الساقية الحمراء", lat: 26.1267, lng: -14.4847, grid: 3 },
  { id: "dakhla", city: "الداخلة", region: "الداخلة - وادي الذهب", lat: 23.6848, lng: -15.958, grid: 3 },
  { id: "sidiifni", city: "سيدي إفني", region: "كلميم - واد نون", lat: 29.3797, lng: -10.1731, grid: 3 },
  { id: "mirleft", city: "ميرلفت", region: "كلميم - واد نون", lat: 29.5781, lng: -10.0323, grid: 3 },
  { id: "taghazout", city: "تغازوت", region: "سوس - ماسة", lat: 30.545, lng: -9.7112, grid: 3 },
  { id: "imlil", city: "إمليل", region: "مراكش - آسفي", lat: 31.1361, lng: -7.9186, grid: 3 },
  { id: "aitbenhaddou", city: "آيت بن حدو", region: "درعة - تافيلالت", lat: 31.0472, lng: -7.1319, grid: 3 },
  { id: "moulayidriss", city: "مولاي إدريس زرهون", region: "فاس - مكناس", lat: 34.055, lng: -5.523, grid: 3 },
  { id: "azemmour", city: "أزمور", region: "الدار البيضاء - سطات", lat: 33.2878, lng: -8.3425, grid: 3 },
  { id: "mdinq", city: "المضيق", region: "طنجة - تطوان - الحسيمة", lat: 35.685, lng: -5.325, grid: 3 },
];

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(500 * attempt);
    }
  }
  throw new Error("unreachable");
}

/** Reads one coverage tile and returns the ids of its 360° images. */
async function panoramaIdsInTile(x, y) {
  const url = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/${Z}/${x}/${y}?access_token=${encodeURIComponent(TOKEN)}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) return [];
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) return [];
  const tile = new VectorTile(new Pbf(bytes));
  const layer = tile.layers.sequence;
  if (!layer) return [];

  const ids = [];
  for (let i = 0; i < layer.length; i++) {
    const properties = layer.feature(i).properties;
    if (Number(properties.is_pano) === 1) ids.push(String(properties.image_id));
  }
  return ids;
}

/** Metadata for up to 50 ids per request (the Graph API supports id lists). */
async function imageMetadata(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      `https://graph.mapillary.com/?ids=${chunk.join(",")}` +
      `&fields=id,geometry,captured_at,sequence,compass_angle,creator&access_token=${encodeURIComponent(TOKEN)}`;
    try {
      const response = await fetchWithRetry(url);
      if (!response.ok) continue;
      const json = await response.json();
      for (const value of Object.values(json)) out.push(value);
    } catch {
      // A missing batch is not fatal: those panoramas are simply not offered.
    }
    await sleep(60);
  }
  return out;
}

const metresBetween = (a, b) => {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Groups panoramas that are close enough to walk between. */
function groupIntoChains(points) {
  const parent = points.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (metresBetween(points[i], points[j]) <= CLUSTER_METRES) union(i, j);
    }
  }

  const groups = new Map();
  points.forEach((point, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(point);
  });
  return [...groups.values()];
}

async function scanSeed(seed, taken) {
  const centreX = lonToX(seed.lng, Z);
  const centreY = latToY(seed.lat, Z);
  const half = Math.floor(seed.grid / 2);
  const ids = new Set();

  const tiles = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) tiles.push([centreX + dx, centreY + dy]);
  }

  // Small concurrency keeps the tile endpoint happy without taking forever.
  for (let i = 0; i < tiles.length; i += 4) {
    const batch = tiles.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(([x, y]) => panoramaIdsInTile(x, y).catch(() => [])),
    );
    for (const list of results) for (const id of list) ids.add(id);
  }

  const metadata = await imageMetadata([...ids]);
  const points = [];
  for (const image of metadata) {
    const coordinates = image.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) continue;
    points.push({
      imageId: String(image.id),
      lng: coordinates[0],
      lat: coordinates[1],
      capturedAt: image.captured_at ? new Date(image.captured_at).toISOString().slice(0, 10) : null,
      creator: image.creator?.username ?? null,
      compass: typeof image.compass_angle === "number" ? Math.round(image.compass_angle) : null,
      sequenceId: image.sequence ? String(image.sequence) : null,
    });
  }

  const chains = groupIntoChains(points)
    .map((chain) => {
      // Start on the panorama with the most neighbours around it: the player
      // then immediately sees arrows instead of an isolated sphere.
      const scored = chain
        .map((point) => ({
          point,
          neighbours: chain.filter((other) => metresBetween(point, other) <= CLUSTER_METRES).length,
        }))
        .sort((a, b) => b.neighbours - a.neighbours);
      return { start: scored[0].point, size: chain.length };
    })
    .sort((a, b) => b.size - a.size);

  const chosen = [];
  const usedSequences = new Set();
  for (const chain of chains) {
    if (chosen.length >= MAX_PER_CITY) break;
    // Town grids overlap: the same panorama must never enter the pool twice,
    // or two rounds in one game could show the same street.
    if (taken.has(chain.start.imageId)) continue;
    const sequenceId = chain.start.sequenceId;
    // One round per capture drive keeps the round pool varied.
    if (sequenceId && usedSequences.has(sequenceId)) continue;
    if (sequenceId) usedSequences.add(sequenceId);
    taken.add(chain.start.imageId);
    chosen.push({
      id: `${seed.id}-${chain.start.imageId}`,
      imageId: chain.start.imageId,
      city: seed.city,
      region: seed.region,
      lat: Number(chain.start.lat.toFixed(6)),
      lng: Number(chain.start.lng.toFixed(6)),
      neighbourhood: chain.size,
      capturedAt: chain.start.capturedAt,
      creator: chain.start.creator,
    });
  }
  return { ids: ids.size, points: points.length, chains: chains.length, chosen };
}

const seeds = only ? SEEDS.filter((seed) => seed.id === only) : SEEDS;
if (seeds.length === 0) {
  console.error(`No seed matches --only ${only}`);
  process.exit(1);
}

const rounds = [];
const taken = new Set();
let totalPanoramas = 0;
for (const seed of seeds) {
  const result = await scanSeed(seed, taken);
  totalPanoramas += result.points;
  rounds.push(...result.chosen);
  console.log(
    `${seed.id.padEnd(15)} panos=${String(result.points).padStart(4)} chains=${String(result.chains).padStart(4)} rounds=${String(result.chosen.length).padStart(2)}` +
      (result.chosen.length ? `  best chain=${result.chosen[0].neighbourhood}` : ""),
  );
}

// Deterministic order so re-running the scanner produces small diffs.
rounds.sort((a, b) => a.id.localeCompare(b.id));

await mkdir("data", { recursive: true });
await writeFile(
  "data/panoramas.json",
  `${JSON.stringify(
    {
      source: "Mapillary",
      licence: "CC BY-SA 4.0",
      generatedAt: new Date().toISOString().slice(0, 10),
      rounds,
    },
    null,
    2,
  )}\n`,
);

const walkable = rounds.filter((round) => round.neighbourhood > 1).length;
console.log(
  `\n${rounds.length} rounds written to data/panoramas.json ` +
    `(${walkable} with walkable neighbours, ${totalPanoramas} panoramas scanned, ` +
    `${new Set(rounds.map((r) => r.city)).size} towns).`,
);
