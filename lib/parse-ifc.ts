/**
 * Client-side IFC parser using web-ifc (WASM).
 * Extracts floor stories and slab footprints → BuildingGeometry.
 */

import type { BuildingGeometry, ZoneGeometry } from '@/components/Building3D';

interface SlabRecord {
  cx: number;
  cz: number;
  pts: [number, number][];
  storey: number;
}

// ── Convex hull (Graham scan) ─────────────────────────────────────────────────
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

// ── Douglas-Peucker simplification ───────────────────────────────────────────
function simplify(pts: [number,number][], epsilon: number): [number,number][] {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  const [x1,y1] = pts[0], [x2,y2] = pts[pts.length-1];
  const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx, dy);
  for (let i=1; i<pts.length-1; i++) {
    const d = len === 0
      ? Math.hypot(pts[i][0]-x1, pts[i][1]-y1)
      : Math.abs(dy*pts[i][0] - dx*pts[i][1] + x2*y1 - y2*x1) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > epsilon) {
    return [...simplify(pts.slice(0, idx+1), epsilon).slice(0,-1), ...simplify(pts.slice(idx), epsilon)];
  }
  return [pts[0], pts[pts.length-1]];
}

// ── Single-link spatial clustering ───────────────────────────────────────────
function cluster(slabs: SlabRecord[], threshold: number): SlabRecord[][] {
  const clusters: SlabRecord[][] = [];
  for (const slab of slabs) {
    let placed = false;
    for (const c of clusters) {
      const close = c.some(m => Math.hypot(m.cx - slab.cx, m.cz - slab.cz) < threshold);
      if (close) { c.push(slab); placed = true; break; }
    }
    if (!placed) clusters.push([slab]);
  }
  return clusters;
}

// ── Normalise all world coords to -80..80 range ───────────────────────────────
function normaliseCoords(slabs: SlabRecord[]): SlabRecord[] {
  const allPts = slabs.flatMap(s => s.pts);
  if (allPts.length === 0) return slabs;
  const xs = allPts.map(p => p[0]), zs = allPts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX-minX, maxZ-minZ, 1);
  const scale = 160 / span;
  const offX = -((minX+maxX)/2) * scale;
  const offZ = -((minZ+maxZ)/2) * scale;
  return slabs.map(s => ({
    ...s,
    cx: s.cx * scale + offX,
    cz: s.cz * scale + offZ,
    pts: s.pts.map(([x,z]): [number,number] => [x * scale + offX, z * scale + offZ]),
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function parseIFC(buffer: ArrayBuffer): Promise<BuildingGeometry> {
  const WebIFC = await import('web-ifc');
  const ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath('/');
  await ifcApi.Init();

  const modelID = ifcApi.OpenModel(new Uint8Array(buffer));

  // 1. Stories ─────────────────────────────────────────────────────────────
  const storeyIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY);
  const stories: { name: string; elevation: number }[] = [];
  for (let i = 0; i < storeyIDs.size(); i++) {
    const id = storeyIDs.get(i);
    try {
      const s = ifcApi.GetLine(modelID, id, true) as {
        Name?: { value?: string };
        Elevation?: { value?: number };
      };
      stories.push({
        name: s?.Name?.value ?? `Level ${i+1}`,
        elevation: s?.Elevation?.value ?? i * 3000,
      });
    } catch { /* skip */ }
  }
  stories.sort((a, b) => a.elevation - b.elevation);
  const floorCount = Math.max(stories.length, 1);

  // 2. Floor slabs ──────────────────────────────────────────────────────────
  const slabIDs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCSLAB);
  const rawSlabs: SlabRecord[] = [];

  for (let i = 0; i < slabIDs.size(); i++) {
    const id = slabIDs.get(i);
    try {
      const mesh = ifcApi.GetFlatMesh(modelID, id);
      const verts2d: [number, number][] = [];
      let sumX = 0, sumZ = 0;

      for (let gi = 0; gi < mesh.geometries.size(); gi++) {
        const geom = mesh.geometries.get(gi);
        const geomData = ifcApi.GetGeometry(modelID, geom.geometryExpressID);
        const verts = ifcApi.GetVertexArray(
          geomData.GetVertexData(),
          geomData.GetVertexDataSize()
        );
        const m = geom.flatTransformation;

        // Each vertex is 6 floats: x,y,z,nx,ny,nz
        for (let v = 0; v < verts.length; v += 6) {
          const lx = verts[v], ly = verts[v+1], lz = verts[v+2];
          const wx = m[0]*lx + m[4]*ly + m[8]*lz  + m[12];
          const wz = m[2]*lx + m[6]*ly + m[10]*lz + m[14];
          verts2d.push([wx, wz]);
          sumX += wx; sumZ += wz;
        }
        geomData.delete();
      }

      if (verts2d.length >= 3) {
        const cx = sumX / verts2d.length;
        const cz = sumZ / verts2d.length;
        const hull = convexHull(verts2d);
        if (hull.length >= 3) {
          rawSlabs.push({ cx, cz, pts: hull, storey: 0 });
        }
      }
    } catch { /* skip bad geometry */ }
  }

  ifcApi.CloseModel(modelID);

  // 3. Normalise coordinates ────────────────────────────────────────────────
  const normSlabs = normaliseCoords(rawSlabs);

  // 4. Cluster into zones ───────────────────────────────────────────────────
  const CLUSTER_THRESHOLD = 25;
  const clusters = cluster(normSlabs, CLUSTER_THRESHOLD);

  // 5. Build zone list ──────────────────────────────────────────────────────
  const AREA_NAMES = ['A','B','C','D','E','core','sitework','cmu'];
  const zones: ZoneGeometry[] = [];

  for (let i = 0; i < Math.min(clusters.length, 8); i++) {
    const c = clusters[i];
    const allPts = c.flatMap(s => s.pts);
    const hull = convexHull(allPts);
    const simplified = simplify(hull, 2);
    if (simplified.length < 3) continue;

    zones.push({
      id: `zone_${i}`,
      name: `Zone ${(AREA_NAMES[i] ?? String(i+1)).toUpperCase()}`,
      area: AREA_NAMES[i] ?? 'other',
      floors: floorCount,
      footprint: simplified as [number, number][],
    });
  }

  // Fallback if no geometry was extracted
  if (zones.length === 0) {
    zones.push({
      id: 'zone_0',
      name: 'Building',
      area: 'A',
      floors: floorCount || 3,
      footprint: [[-50,-30],[50,-30],[50,30],[-50,30]],
    });
  }

  return { zones, floorHeight: 26, floorDepth: 24, roofCapHeight: 5 };
}
