import { haversineKm } from './geoMedical';

/**
 * Emergency evacuation routing (report §2.2-E). Great-circle distance feeds a Dijkstra
 * search over a rescue network whose edge weights are expected travel minutes, derived
 * from terrain ruggedness, passability and elevation gain. Complexity O(E + V log V).
 */

export type FacilityKind = 'sar_base' | 'trauma_center' | 'medical_post' | 'helipad' | 'waypoint';
export type Terrain = 'road' | 'jeep_track' | 'trail' | 'scree' | 'glacier';

export interface RescueNode {
  nodeId: string;
  name: string;
  kind: FacilityKind;
  lat: number;
  lng: number;
  elevation: number; // m ASL
  airAmbulance?: boolean; // can launch a helicopter
  traumaLevel?: 1 | 2 | 3; // 1 = definitive trauma care
  phone?: string;
}

export interface RescueEdge {
  from: string;
  to: string;
  terrain: Terrain;
  passable: boolean;
}

/** Ground speed of a rescue team (km/h) and how much longer the real path is than the great circle. */
const TERRAIN: Record<Terrain, { speedKmh: number; ruggedness: number }> = {
  road: { speedKmh: 35, ruggedness: 1.6 },
  jeep_track: { speedKmh: 15, ruggedness: 1.5 },
  trail: { speedKmh: 3.5, ruggedness: 1.3 },
  scree: { speedKmh: 1.8, ruggedness: 1.4 },
  glacier: { speedKmh: 1.2, ruggedness: 1.5 },
};

/** Naismith's rule: +60 min per 600 m ascent for teams on foot. */
const CLIMB_MIN_PER_M = 60 / 600;
const GROUND_MOBILISATION_MIN = 10;
const AIR_MOBILISATION_MIN = 15;
const HELICOPTER_KMH = 180;
const VICTIM_LINKS = 3;
export const GOLDEN_HOUR_MIN = 60;

export function edgeMinutes(from: RescueNode, to: RescueNode, terrain: Terrain): number {
  const { speedKmh, ruggedness } = TERRAIN[terrain];
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng) * ruggedness;
  const onFoot = terrain === 'trail' || terrain === 'scree' || terrain === 'glacier';
  const climb = onFoot ? Math.max(0, to.elevation - from.elevation) * CLIMB_MIN_PER_M : 0;
  return (km / speedKmh) * 60 + climb;
}

/** Binary min-heap keyed on distance. */
class MinHeap {
  private items: { id: string; d: number }[] = [];
  get size() { return this.items.length; }
  push(id: string, d: number) {
    const a = this.items;
    a.push({ id, d });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Dijkstra from `target` over reversed edges, so dist[n] is the time to travel from n
 * TO the target (climb penalties are direction-dependent).
 */
export function dijkstraTo(
  target: string,
  nodes: Map<string, RescueNode>,
  edges: RescueEdge[]
): { dist: Map<string, number>; next: Map<string, string> } {
  const incoming = new Map<string, { from: string; terrain: Terrain }[]>();
  for (const e of edges) {
    if (!e.passable) continue;
    // Undirected corridors: both directions are travelable.
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!incoming.has(b)) incoming.set(b, []);
      incoming.get(b)!.push({ from: a, terrain: e.terrain });
    }
  }

  const dist = new Map<string, number>([[target, 0]]);
  const next = new Map<string, string>();
  const heap = new MinHeap();
  heap.push(target, 0);
  const done = new Set<string>();

  while (heap.size) {
    const { id, d } = heap.pop();
    if (done.has(id)) continue;
    done.add(id);
    const here = nodes.get(id)!;
    for (const { from, terrain } of incoming.get(id) ?? []) {
      const src = nodes.get(from);
      if (!src || done.has(from)) continue;
      const nd = d + edgeMinutes(src, here, terrain);
      if (nd < (dist.get(from) ?? Infinity)) {
        dist.set(from, nd);
        next.set(from, id);
        heap.push(from, nd);
      }
    }
  }
  return { dist, next };
}

export interface DispatchOption {
  mode: 'ground' | 'air';
  unit: { nodeId: string; name: string; phone?: string };
  etaMinutes: number;
  distanceKm: number;
  route: { lat: number; lng: number; name: string }[];
}

export interface DispatchPlan {
  victim: { lat: number; lng: number; elevation: number };
  recommended: DispatchOption | null;
  options: DispatchOption[];
  destinationFacility: { nodeId: string; name: string; traumaLevel?: number; etaMinutes: number; mode: 'ground' | 'air'; phone?: string } | null;
  nearestMedicalPost: { nodeId: string; name: string; distanceKm: number } | null;
  withinGoldenHour: boolean;
  airEvacuationPossible: boolean;
  computedAt: string;
}

export function planEvacuation(
  victim: { lat: number; lng: number; elevation?: number },
  network: { nodes: RescueNode[]; edges: RescueEdge[] },
  opts: { airEvacuationPossible?: boolean } = {}
): DispatchPlan {
  const airOk = opts.airEvacuationPossible ?? true;
  const victimNode: RescueNode = {
    nodeId: '__victim__',
    name: 'Casualty location',
    kind: 'waypoint',
    lat: victim.lat,
    lng: victim.lng,
    elevation: victim.elevation ?? 0,
  };
  const nodes = new Map(network.nodes.map((n) => [n.nodeId, n]));
  nodes.set(victimNode.nodeId, victimNode);

  // Connect the casualty to its nearest network nodes. The access leg uses the slowest terrain
  // that node is reached by: a node only on roads (city, mountain highway) is a road approach;
  // a trail node means the casualty is off-trail on foot (scree above 2,500 m).
  const byDistance = network.nodes
    .map((n) => ({ n, km: haversineKm(victim.lat, victim.lng, n.lat, n.lng) }))
    .sort((a, b) => a.km - b.km);
  const accessTerrain = (n: RescueNode): Terrain => {
    const incident = network.edges.filter((e) => e.passable && (e.from === n.nodeId || e.to === n.nodeId)).map((e) => e.terrain);
    const slowest = incident.sort((a, b) => TERRAIN[a].speedKmh - TERRAIN[b].speedKmh)[0];
    if (!slowest || slowest === 'trail') return n.elevation > 2500 ? 'scree' : 'trail';
    return slowest;
  };
  const edges: RescueEdge[] = [
    ...network.edges,
    ...byDistance.slice(0, VICTIM_LINKS).map(({ n }) => ({
      from: n.nodeId,
      to: victimNode.nodeId,
      terrain: accessTerrain(n),
      passable: true,
    })),
  ];

  const { dist, next } = dijkstraTo(victimNode.nodeId, nodes, edges);
  const pathFrom = (start: string) => {
    const route: { lat: number; lng: number; name: string }[] = [];
    let cur: string | undefined = start;
    let km = 0;
    while (cur) {
      const n = nodes.get(cur)!;
      if (route.length) {
        const prev = route[route.length - 1];
        km += haversineKm(prev.lat, prev.lng, n.lat, n.lng);
      }
      route.push({ lat: n.lat, lng: n.lng, name: n.name });
      cur = next.get(cur);
    }
    return { route, km };
  };

  const options: DispatchOption[] = [];
  for (const n of network.nodes) {
    if (n.kind === 'sar_base') {
      const d = dist.get(n.nodeId);
      if (d !== undefined) {
        const { route, km } = pathFrom(n.nodeId);
        options.push({
          mode: 'ground',
          unit: { nodeId: n.nodeId, name: n.name, phone: n.phone },
          etaMinutes: Math.round(GROUND_MOBILISATION_MIN + d),
          distanceKm: Math.round(km * 10) / 10,
          route,
        });
      }
    }
    if (n.airAmbulance && airOk) {
      const km = haversineKm(n.lat, n.lng, victim.lat, victim.lng);
      options.push({
        mode: 'air',
        unit: { nodeId: n.nodeId, name: n.name, phone: n.phone },
        etaMinutes: Math.round(AIR_MOBILISATION_MIN + (km / HELICOPTER_KMH) * 60),
        distanceKm: Math.round(km * 10) / 10,
        route: [{ lat: n.lat, lng: n.lng, name: n.name }, { lat: victim.lat, lng: victim.lng, name: victimNode.name }],
      });
    }
  }
  options.sort((a, b) => a.etaMinutes - b.etaMinutes);
  const recommended = options[0] ?? null;

  // Definitive care: the best trauma level among facilities not much slower than the fastest one.
  const facilities = network.nodes
    .filter((x) => x.kind === 'trauma_center')
    .map((n) => {
      const ground = dist.get(n.nodeId) ?? Infinity;
      const air = airOk ? (haversineKm(n.lat, n.lng, victim.lat, victim.lng) / HELICOPTER_KMH) * 60 : Infinity;
      return {
        nodeId: n.nodeId,
        name: n.name,
        traumaLevel: n.traumaLevel,
        etaMinutes: Math.round(Math.min(ground, air)),
        mode: (air < ground ? 'air' : 'ground') as 'ground' | 'air',
        phone: n.phone,
      };
    })
    .filter((f) => Number.isFinite(f.etaMinutes));
  let destinationFacility: DispatchPlan['destinationFacility'] = null;
  if (facilities.length) {
    const fastest = Math.min(...facilities.map((f) => f.etaMinutes));
    const acceptable = facilities.filter((f) => f.etaMinutes <= Math.max(fastest * 2, fastest + GOLDEN_HOUR_MIN));
    acceptable.sort((a, b) => (a.traumaLevel ?? 3) - (b.traumaLevel ?? 3) || a.etaMinutes - b.etaMinutes);
    destinationFacility = acceptable[0];
  }

  const post = byDistance.find(({ n }) => n.kind === 'medical_post' || n.kind === 'trauma_center');

  return {
    victim: { lat: victim.lat, lng: victim.lng, elevation: victimNode.elevation },
    recommended,
    options,
    destinationFacility,
    nearestMedicalPost: post ? { nodeId: post.n.nodeId, name: post.n.name, distanceKm: Math.round(post.km * 10) / 10 } : null,
    withinGoldenHour: !!recommended && recommended.etaMinutes <= GOLDEN_HOUR_MIN,
    airEvacuationPossible: airOk,
    computedAt: new Date().toISOString(),
  };
}
