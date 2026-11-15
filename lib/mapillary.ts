/**
 * Client-safe Mapillary helpers. Safe to import from components: it carries no
 * coordinates, only the public token and link builders.
 *
 * The token is a Mapillary *client* token, which is designed to be published in
 * the browser. Create a free app (no card) at
 * https://www.mapillary.com/dashboard/developers and set it as
 * NEXT_PUBLIC_MAPILLARY_TOKEN.
 */
export const MAPILLARY_TOKEN = process.env.NEXT_PUBLIC_MAPILLARY_TOKEN ?? "";

export function panoramaSourceUrl(imageId: string): string {
  return `https://www.mapillary.com/app/?focus=photo&pKey=${encodeURIComponent(imageId)}`;
}
