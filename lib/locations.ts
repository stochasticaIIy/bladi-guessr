import dataset from "@/data/locations.json";

/**
 * Server-only dataset for the still-photo mode, built by `npm run photos` from
 * Wikimedia Commons (photos are CC-licensed, attribution is shown in-game).
 *
 * Do not import this from a client component: it holds the coordinates, and
 * shipping it would hand players every answer before they guess.
 */
export type PhotoCredit = {
  author: string;
  licence: string;
  source: string;
};

export type Location = {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  /** Public path, e.g. /photos/8f3c1d2e9a0b.jpg */
  photo: string;
  photoCredit: PhotoCredit;
};

const locations: Location[] = dataset.locations.map((entry) => ({
  id: entry.id,
  name: entry.name,
  region: entry.region,
  lat: entry.lat,
  lng: entry.lng,
  photo: entry.photo,
  photoCredit: entry.photoCredit,
}));

const byId = new Map(locations.map((location) => [location.id, location]));

export const allLocations = locations;
export const locationCount = locations.length;

export function getLocation(id: string): Location | undefined {
  return byId.get(id);
}

export function requireLocation(id: string): Location {
  const location = byId.get(id);
  if (!location) throw new Error(`Unknown location: ${id}`);
  return location;
}
