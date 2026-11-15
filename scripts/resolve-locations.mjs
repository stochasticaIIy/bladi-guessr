/**
 * Resolves the curated Morocco seed into a playable dataset.
 *
 * For every seed location it:
 *   1. validates the coordinates against the English Wikipedia article,
 *   2. finds a representative photo on Wikimedia Commons (lead image of the
 *      article, falling back to a geosearch near the coordinates),
 *   3. downloads the photo, re-encodes it to a phone-friendly JPEG and stores
 *      it in public/photos/,
 *   4. records attribution/licence for the credit line.
 *
 * Usage: node scripts/resolve-locations.mjs
 * Output: data/locations.json + public/photos/*
 */
import { readFile, writeFile, mkdir, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const ROOT = process.cwd();
const SEED = path.join(ROOT, "scripts/locations.seed.json");
const OVERRIDES = path.join(ROOT, "scripts/photo-overrides.json");
const OUT_JSON = path.join(ROOT, "data/locations.json");
const PHOTO_DIR = path.join(ROOT, "public/photos");
const CREDITS_FILE = path.join(ROOT, "data/PHOTO_CREDITS.md");

/**
 * Commons originals are often 3-8 MB. Re-encode them to a small progressive
 * JPEG so a round costs a few hundred KB, not a few megabytes.
 */
async function optimise(buffer) {
  return sharp(buffer)
    .rotate() // apply EXIF orientation before stripping metadata
    .resize({ width: SERVE_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer();
}

/**
 * Photos are served from the public folder, so the file name must not reveal
 * the answer (`/photos/chefchaouen.jpg` would). A short hash keeps the URL
 * opaque while staying stable between runs.
 */
const photoName = (id) => createHash("sha256").update(id).digest("hex").slice(0, 12);
const UA = "BladiGuessr/0.1 (educational Morocco geography game; https://example.com)";
// Photos are served full-bleed, so start wide and step down until the file is
// small enough to keep the repo and mobile load times reasonable.
const WIDTHS = [1100, 850, 640];
const MAX_BYTES = 450_000;
// The full-bleed panel needs ~1000px on a retina phone; anything more is wasted
// data on a Moroccan mobile connection.
const SERVE_WIDTH = 1000;
const JPEG_QUALITY = 78;

// Files that are technically images but never make a good "where is this?" round.
const JUNK = /(map|karte|carte|coat|flag|drapeau|logo|seal|blason|arms|icon|diagram|plan|locator|banner|chart|graph|svg|wappen|escudo|bandera)/i;

const api = (base, params) =>
  `${base}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const haversine = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const stripHtml = (s) =>
  (s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Coordinates + lead image file name for a Wikipedia article. */
async function wikipediaInfo(title) {
  const url = api("https://en.wikipedia.org/w/api.php", {
    action: "query",
    redirects: "1",
    prop: "coordinates|pageimages",
    piprop: "name|original",
    pithumbsize: String(WIDTHS[0]),
    titles: title,
  });
  const data = await getJSON(url);
  const page = data?.query?.pages?.[0];
  if (!page || page.missing) return null;
  return {
    title: page.title,
    coord: page.coordinates?.[0]
      ? { lat: page.coordinates[0].lat, lng: page.coordinates[0].lon }
      : null,
    imageName: page.pageimage ? `File:${page.pageimage}` : null,
  };
}

/** Best-effort file title from a Commons geosearch around the coordinates. */
async function commonsNearby(coord) {
  const url = api("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    generator: "geosearch",
    ggscoord: `${coord.lat}|${coord.lng}`,
    ggsradius: "10000",
    ggsnamespace: "6",
    ggslimit: "30",
    prop: "imageinfo",
    iiprop: "url|size|mime",
  });
  const data = await getJSON(url);
  const pages = data?.query?.pages ?? [];
  const candidates = pages
    .filter((p) => p.imageinfo?.[0])
    .map((p) => {
      const info = p.imageinfo[0];
      return {
        title: p.title,
        width: info.width ?? 0,
        height: info.height ?? 0,
        mime: info.mime ?? "",
      };
    })
    .filter(
      (c) =>
        c.mime === "image/jpeg" &&
        c.width >= 900 &&
        c.height >= 600 &&
        c.width / c.height >= 1.1 &&
        !JUNK.test(c.title),
    )
    // Prefer wide, high-resolution frames.
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return candidates[0]?.title ?? null;
}

/** Thumb URL, size, and licence metadata for a Commons file. */
async function commonsFile(fileTitle, width) {
  const url = api("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(width),
  });
  const data = await getJSON(url);
  const page = data?.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  return {
    fileTitle: page.title,
    url: info.thumburl ?? info.url,
    mime: info.mime,
    width: info.thumbwidth ?? info.width,
    height: info.thumbheight ?? info.height,
    artist: stripHtml(meta.Artist?.value).slice(0, 120) || "Wikimedia Commons",
    licence: stripHtml(meta.LicenseShortName?.value) || "See Commons",
  };
}

async function resolveOne(entry, overrides) {
  // A few places (e.g. Legzira, a beach) have no article of their own; for
  // those we trust the curated coordinates and search Commons around them.
  const wiki = await wikipediaInfo(entry.wiki);

  const coord = wiki?.coord ?? { lat: entry.lat, lng: entry.lng };
  const drift = wiki?.coord ? haversine(coord, { lat: entry.lat, lng: entry.lng }) : 0;

  const candidates = [];
  // Hand-picked files always win: automatic selection sometimes lands on a
  // nearby-but-wrong subject (a parking lot, a mosque a town away).
  if (overrides[entry.id]) candidates.push(overrides[entry.id]);
  if (wiki?.imageName && !JUNK.test(wiki.imageName)) candidates.push(wiki.imageName);
  const nearby = await commonsNearby(coord);
  if (nearby) candidates.push(nearby);

  let photo = null;
  let local = null;
  for (const fileTitle of candidates) {
    const first = await commonsFile(fileTitle, WIDTHS[0]);
    // Lead images are sometimes crests or maps we could not spot by name.
    if (!first || first.mime !== "image/jpeg" || (first.width ?? 0) < 800) continue;
    if (first.width / first.height < 1.0) continue;

    for (const width of WIDTHS) {
      const attempt = width === WIDTHS[0] ? first : await commonsFile(fileTitle, width);
      if (!attempt) continue;
      const file = path.join(PHOTO_DIR, `${photoName(entry.id)}.jpg`);
      const res = await fetch(attempt.url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const raw = Buffer.from(await res.arrayBuffer());
      if (raw[0] !== 0xff || raw[1] !== 0xd8) continue;
      let buf;
      try {
        buf = await optimise(raw);
      } catch {
        continue;
      }
      await mkdir(PHOTO_DIR, { recursive: true });
      await writeFile(file, buf);
      if (buf.length <= MAX_BYTES) {
        photo = attempt;
        local = { path: `/photos/${photoName(entry.id)}.jpg`, bytes: buf.length };
        break;
      }
      // Too heavy at this width: keep the bytes as a fallback and try narrower.
      local = { path: `/photos/${photoName(entry.id)}.jpg`, bytes: buf.length };
      photo = attempt;
    }
    if (local) break;
  }

  if (!photo || !local) throw new Error("no usable photo found");
  if (local.bytes < 10_000) throw new Error(`suspiciously small (${local.bytes}B)`);

  return {
    id: entry.id,
    name: entry.name,
    region: entry.region,
    hint: entry.hint,
    lat: Number(coord.lat.toFixed(4)),
    lng: Number(coord.lng.toFixed(4)),
    photo: local.path,
    photoCredit: {
      author: photo.artist,
      licence: photo.licence,
      source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(photo.fileTitle.replace(/ /g, "_"))}`,
    },
    file: photo.fileTitle,
    coordinateDriftKm: Number(drift.toFixed(1)),
  };
}

async function main() {
  const seed = JSON.parse(await readFile(SEED, "utf8"));
  let overrides = {};
  try {
    overrides = JSON.parse(await readFile(OVERRIDES, "utf8"));
  } catch {
    overrides = {};
  }
  // Start clean so a changed pick never leaves an orphan image behind.
  await rm(PHOTO_DIR, { recursive: true, force: true });
  const results = [];
  const failures = [];

  // Small concurrency so Commons sees polite traffic but this finishes quickly.
  const queue = [...seed];
  async function worker() {
    while (queue.length) {
      const entry = queue.shift();
      if (!entry) return;
      try {
        const resolved = await resolveOne(entry, overrides);
        results.push(resolved);
        console.log(
          `ok   ${entry.id.padEnd(22)} drift=${String(resolved.coordinateDriftKm).padStart(5)}km`,
        );
      } catch (err) {
        failures.push({ id: entry.id, title: entry.wiki, error: err.message });
        console.log(`FAIL ${entry.id.padEnd(22)} ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  results.sort((a, b) => seed.findIndex((s) => s.id === a.id) - seed.findIndex((s) => s.id === b.id));
  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(
    OUT_JSON,
    JSON.stringify({ generatedAt: new Date().toISOString(), count: results.length, locations: results }, null, 2) + "\n",
  );

  // Attribution for most Commons licences. Kept in data/ rather than public/
  // because the file names here would otherwise spell out every answer.
  await mkdir(PHOTO_DIR, { recursive: true });
  await mkdir(path.dirname(CREDITS_FILE), { recursive: true });
  const credits = [
    "# Photo credits",
    "",
    "All photos are from Wikimedia Commons and are used under their respective licences.",
    "Each location also shows its credit in-game.",
    "",
    ...results.map(
      (r) =>
        `- **${r.name}** (${r.id}, /photos/${r.photo.split("/").pop()}) — ${r.photoCredit.author}, ${r.photoCredit.licence} — ${r.photoCredit.source}`,
    ),
    "",
  ].join("\n");
  await writeFile(CREDITS_FILE, credits);

  const files = await readdir(PHOTO_DIR);
  let totalBytes = 0;
  const oversized = [];
  for (const f of files) {
    if (f.endsWith(".md")) continue;
    const size = (await stat(path.join(PHOTO_DIR, f))).size;
    totalBytes += size;
    if (size > MAX_BYTES * 1.5) oversized.push(`${f} (${(size / 1e6).toFixed(1)}MB)`);
  }
  if (oversized.length) console.log(`\nwarning: still heavy: ${oversized.join(", ")}`);

  console.log(`\nwrote ${results.length}/${seed.length} locations -> data/locations.json`);
  console.log(`photos: ${files.filter((f) => !f.endsWith(".md")).length} files, ${(totalBytes / 1e6).toFixed(1)} MB`);
  const drifted = results.filter((r) => r.coordinateDriftKm > 15);
  if (drifted.length) {
    console.log(`\nwarning: coordinates drifted >15km from the seed:`);
    for (const d of drifted) console.log(`  ${d.id}: ${d.coordinateDriftKm}km`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures) console.log(`  ${f.id} (${f.title}): ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
