/**
 * Geo-medical spatial primitives (report §2.2-D and §2.2-E).
 * Coordinates follow GeoJSON order: [longitude, latitude].
 */

export type LngLat = [number, number];

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Eq. 2.8 — great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function boundingBox(polygon: LngLat[]): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Layer 1 — O(1) Minimum Bounding Box pre-filter. */
export function insideBoundingBox(x0: number, y0: number, box: BoundingBox): boolean {
  return x0 >= box.minX && x0 <= box.maxX && y0 >= box.minY && y0 <= box.maxY;
}

/**
 * Eq. 2.7 — Jordan-curve ray casting. Casts a ray from P along +X and counts edge
 * crossings; an odd count means P is inside.
 */
export function pointInPolygon(x0: number, y0: number, polygon: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const straddles = (yi <= y0 && y0 < yj) || (yj <= y0 && y0 < yi);
    if (straddles && x0 < xi + ((xj - xi) / (yj - yi)) * (y0 - yi)) inside = !inside;
  }
  return inside;
}

/** MBB pruning followed by exact ray casting. */
export function pointInPolygonPruned(x0: number, y0: number, polygon: LngLat[], box = boundingBox(polygon)): boolean {
  return insideBoundingBox(x0, y0, box) && pointInPolygon(x0, y0, polygon);
}

export interface ZoneGeometry {
  type: 'Polygon' | 'Circle';
  coordinates: number[][] | number[];
  radius?: number; // metres, for circles
}

export function pointInZone(lat: number, lng: number, geometry: ZoneGeometry): boolean {
  if (geometry.type === 'Circle') {
    const [cLng, cLat] = geometry.coordinates as number[];
    return haversineKm(lat, lng, cLat, cLng) * 1000 <= (geometry.radius ?? 1000);
  }
  return pointInPolygonPruned(lng, lat, geometry.coordinates as LngLat[]);
}

/** Hypoxia corridor floor used by Objective 3 (">3,000 m ASL"). */
export const HYPOXIA_ALTITUDE_M = 3000;
