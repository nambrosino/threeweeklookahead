/**
 * Pure text-based IFC parser — no WASM, no dependencies.
 *
 * IFC files are ASCII STEP format. We parse:
 *   IfcBuildingStorey  → floor names + elevations
 *   IfcSlab (FLOOR)    → placement coordinates → 2D footprint clusters
 *   IfcSpace           → fallback if no slabs found
 *
 * Footprints are derived from the bounding box of all elements per storey,
 * then clustered spatially into wings/zones.
 */

import type { BuildingGeometry, ZoneGeometry } from '@/components/Building3D';

// ── STEP line parser ──────────────────────────────────────────────────────────
// Returns a map: expressId (number) → entity type + raw params string
function parseSTEP(text: string): Map<number, { type: string; params: string }> {
  const map = new Map<number, { type: string; params: string }>();
  // Match lines like: #123 = IFCFOO(...)
  const re = /#(\d+)\s*=\s*([A-Z0-9]+)\s*\(([^;]*)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map.set(parseInt(m[1]), { type: m[2], params: m[3] });
  }
  return map;
}

// Split top-level params respecting nested parens
function splitParams(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' ) depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Extract string value from IFC string token like 'Foo' or "Foo"
function ifcStr(s: string): string {
  const m = s.match(/['"](.+?)['"]/);
  return m ? m[1] : s.replace(/['"]/g, '').trim();
}

// Extract a real number
function ifcReal(s: string): number {
  return parseFloat(s.replace(/[^0-9.\-eE]/g, '')) || 0;
}

// Resolve a Cartesian point → [x, y, z]
function resolvePoint(
  id: number,
  entities: Map<number, { type: string; params: string }>
): [number, number, number] | null {
  const e = entities.get(id);
  if (!e || e.type !== 'IFCCARTESIANPOINT') return null;
  const coords = e.params.replace(/[()]/g, '').split(',').map(ifcReal);
  return [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0];
}

// Follow IFCLOCALPLACEMENT chain to get world XYZ origin
function resolvePlacement(
  id: number,
  entities: Map<number, { type: string; params: string }>,
  depth = 0
): [number, number, number] {
  if (depth > 10) return [0, 0, 0];
  const e = entities.get(id);
  if (!e) return [0, 0, 0];

  if (e.type === 'IFCLOCALPLACEMENT') {
    const params = splitParams(e.params);
    const relToId = params[0] ? parseInt(params[0].replace('#', '')) : 0;
    const axisId  = params[1] ? parseInt(params[1].replace('#', '')) : 0;
    const parent  = relToId ? resolvePlacement(relToId, entities, depth + 1) : [0,0,0] as [number,number,number];
    const local   = axisId  ? resolvePlacement(axisId, entities, depth + 1)  : [0,0,0] as [number,number,number];
    return [parent[0]+local[0], parent[1]+local[1], parent[2]+local[2]];
  }

  if (e.type === 'IFCAXIS2PLACEMENT3D') {
    const params = splitParams(e.params);
    const ptId = params[0] ? parseInt(params[0].replace('#', '')) : 0;
    if (ptId) {
      const pt = resolvePoint(ptId, entities);
      if (pt) return pt;
    }
    return [0, 0, 0];
  }

  return [0, 0, 0];
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number,number], a: [number,number], b: [number,number]) =>
    (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lower: [number,number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number,number][] = [];
  for (let i = sorted.length-1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0,-1), ...upper.slice(0,-1)];
}

function clusterByDistance(
  items: { x: number; z: number; pts: [number, number][] }[],
  threshold: number
): { x: number; z: number; pts: [number, number][] }[][] {
  const clusters: (typeof items)[] = [];
  for (const item of items) {
    let placed = false;
    for (const c of clusters) {
      if (c.some(m => Math.hypot(m.x - item.x, m.z - item.z) < threshold)) {
        c.push(item); placed = true; break;
      }
    }
    if (!placed) clusters.push([item]);
  }
  return clusters;
}

function normalise(
  items: { x: number; z: number; pts: [number, number][] }[]
): { x: number; z: number; pts: [number, number][] }[] {
  const allPts = items.flatMap(i => i.pts);
  if (allPts.length === 0) return items;
  const xs = allPts.map(p => p[0]), zs = allPts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const scale = 140 / span;
  const offX = -((minX + maxX) / 2) * scale;
  const offZ = -((minZ + maxZ) / 2) * scale;
  return items.map(i => ({
    x: i.x * scale + offX,
    z: i.z * scale + offZ,
    pts: i.pts.map(([x,z]): [number,number] => [x * scale + offX, z * scale + offZ]),
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function parseIFC(buffer: ArrayBuffer): Promise<BuildingGeometry> {
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(buffer);

  const entities = parseSTEP(text);

  // 1. Count stories ──────────────────────────────────────────────────────────
  const stories: { name: string; elevation: number }[] = [];
  for (const [, e] of entities) {
    if (e.type !== 'IFCBUILDINGSTOREY') continue;
    const p = splitParams(e.params);
    const name = p[2] ? ifcStr(p[2]) : `Level ${stories.length + 1}`;
    const elevation = p[9] ? ifcReal(p[9]) : stories.length * 3000;
    stories.push({ name, elevation });
  }
  stories.sort((a, b) => a.elevation - b.elevation);
  const floorCount = Math.max(stories.length, 1);

  // 2. Collect placed elements (slabs, spaces, walls) → XZ positions ──────────
  const ELEMENT_TYPES = new Set(['IFCSLAB', 'IFCSPACE', 'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCCOLUMN']);
  const placed: { x: number; z: number; pts: [number, number][] }[] = [];

  for (const [, e] of entities) {
    if (!ELEMENT_TYPES.has(e.type)) continue;
    const p = splitParams(e.params);
    // Object placement is typically param index 5 for most IFC elements
    const placementRef = [4, 5, 6].map(i => p[i]).find(v => v?.startsWith('#'));
    if (!placementRef) continue;
    const placementId = parseInt(placementRef.replace('#', ''));
    const [wx, wy, wz] = resolvePlacement(placementId, entities);

    // Build a small footprint box around this element's placement point
    // Size is estimated — slabs are bigger than walls
    const r = e.type === 'IFCSLAB' ? 8 : e.type === 'IFCSPACE' ? 12 : 3;
    placed.push({
      x: wx, z: wz,
      pts: [
        [wx - r, wz - r], [wx + r, wz - r],
        [wx + r, wz + r], [wx - r, wz + r],
      ],
    });

    // Stop collecting after enough elements (large IFC files can be huge)
    if (placed.length > 2000) break;
  }

  // 3. Fallback: if nothing found, create a generic rectangular building ───────
  if (placed.length === 0) {
    return {
      zones: [{
        id: 'zone_0', name: 'Building', area: 'A',
        floors: floorCount,
        footprint: [[-50,-30],[50,-30],[50,30],[-50,30]],
      }],
      floorHeight: 26, floorDepth: 24, roofCapHeight: 5,
    };
  }

  // 4. Normalise → sector-split → build zones ──────────────────────────────
  const norm = normalise(placed);

  // First try distance clustering with a tight threshold
  let clusters = clusterByDistance(norm, 12);

  // If everything ends up in one cluster (connected building), split by angular sectors
  // around the centroid — works well for radial/wing-style buildings
  if (clusters.length <= 1 && norm.length > 4) {
    const cx = norm.reduce((s,p) => s + p.x, 0) / norm.length;
    const cz = norm.reduce((s,p) => s + p.z, 0) / norm.length;

    // Divide into 4 sectors: NW, NE, SE, SW
    const sectors: (typeof norm)[] = [[], [], [], []];
    for (const p of norm) {
      const dx = p.x - cx, dz = p.z - cz;
      const sector = dx >= 0 ? (dz >= 0 ? 1 : 0) : (dz >= 0 ? 2 : 3);
      sectors[sector].push(p);
    }

    // Add center cluster (elements near centroid)
    const CENTER_R = 18;
    const center = norm.filter(p => Math.hypot(p.x - cx, p.z - cz) < CENTER_R);
    const wings  = sectors.filter(s => s.length > 2);

    clusters = center.length > 2
      ? [center, ...wings.filter(s => s.some(p => Math.hypot(p.x-cx,p.z-cz) >= CENTER_R))]
      : wings;

    if (clusters.length <= 1) clusters = [norm]; // fallback
  }

  const AREA_NAMES = ['A', 'B', 'C', 'D', 'E', 'core', 'sitework', 'cmu'];
  const zones: ZoneGeometry[] = [];

  for (let i = 0; i < Math.min(clusters.length, 8); i++) {
    const c = clusters[i];
    if (c.length === 0) continue;
    const allPts = c.flatMap(item => item.pts);
    const hull = convexHull(allPts);
    if (hull.length < 3) continue;
    zones.push({
      id: `zone_${i}`,
      name: `Zone ${(AREA_NAMES[i] ?? String(i + 1)).toUpperCase()}`,
      area: AREA_NAMES[i] ?? 'other',
      floors: floorCount,
      footprint: hull,
    });
  }

  if (zones.length === 0) {
    zones.push({
      id: 'zone_0', name: 'Building', area: 'A',
      floors: floorCount,
      footprint: [[-50,-30],[50,-30],[50,30],[-50,30]],
    });
  }

  return { zones, floorHeight: 26, floorDepth: 24, roofCapHeight: 5 };
}

