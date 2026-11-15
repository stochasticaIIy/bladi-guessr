import dataset from "@/data/panoramas.json";

/**
 * Server-only dataset of playable spots, backed by real street-level panoramas
 * contributed to Mapillary (CC BY-SA 4.0).
 *
 * Do not import this module from a client component: it holds the coordinates,
 * and shipping it would hand players every answer before they guess.
 */
export type Panorama = {
  id: string;
  imageId: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
  capturedAt: string | null;
  creator: string | null;
  /** How many panoramas sit within walking distance: 1 means an isolated sphere. */
  neighbourhood: number;
};

const panoramas: Panorama[] = dataset.rounds.map((entry) => ({
  id: entry.id,
  imageId: entry.imageId,
  city: entry.city,
  region: entry.region,
  lat: entry.lat,
  lng: entry.lng,
  capturedAt: entry.capturedAt,
  creator: entry.creator,
  neighbourhood: entry.neighbourhood,
}));

const byId = new Map(panoramas.map((panorama) => [panorama.id, panorama]));

export const allPanoramas = panoramas;
export const panoramaCount = panoramas.length;

export function getPanorama(id: string): Panorama | undefined {
  return byId.get(id);
}

export function requirePanorama(id: string): Panorama {
  const panorama = byId.get(id);
  if (!panorama) throw new Error(`Unknown panorama: ${id}`);
  return panorama;
}
