'use client';

import { useState, useEffect, use, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import type { BuildingGeometry, ZoneGeometry } from '@/components/Building3D';

const Building3D = dynamic(() => import('@/components/Building3D'), { ssr: false });

// ── Colour palette for zones ──────────────────────────────────────────────────
const ZONE_PALETTE = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#be185d','#65a30d'];
const AREA_OPTIONS = ['A','B','C','D','E','sitework','cmu','core','other'];

// ── Coordinate helpers ────────────────────────────────────────────────────────
// Canvas is 600×600 pixels; world coords range roughly -100..100 on each axis.
const CANVAS = 600;
const SCALE  = CANVAS / 200; // 3 px per world unit

function pxToWorld(px: number, py: number): [number, number] {
  return [(px - CANVAS/2) / SCALE, (py - CANVAS/2) / SCALE];
}
function worldToPx(wx: number, wz: number): [number, number] {
  return [wx * SCALE + CANVAS/2, wz * SCALE + CANVAS/2];
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ModelEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();

  const [projectName, setProjectName] = useState('');
  const [geometry, setGeometry] = useState<BuildingGeometry>({ zones: [], floorHeight: 26, floorDepth: 24, roofCapHeight: 5 });
  const [floorPlanUrl, setFloorPlanUrl] = useState<string | null>(null);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number,number][]>([]); // world coords
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragPt, setDragPt] = useState<{zoneId:string; ptIdx:number} | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');
  const canvasRef = useRef<SVGSVGElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const ifcRef    = useRef<HTMLInputElement>(null);

  // Load project
  useEffect(() => {
    supabase.from('projects').select('name, building_geometry').eq('id', projectId).single()
      .then(({ data }) => {
        if (!data) return;
        setProjectName(data.name);
        if (data.building_geometry) setGeometry(data.building_geometry as BuildingGeometry);
      });
    // Load floor plan image if stored
    const { data: fpData } = supabase.storage.from('pullplan-photos').getPublicUrl(`${projectId}/floorplan.jpg`);
    if (fpData?.publicUrl) {
      fetch(fpData.publicUrl, { method: 'HEAD' })
        .then(r => { if (r.ok) setFloorPlanUrl(fpData.publicUrl); })
        .catch(() => {});
    }
  }, [projectId]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  // ── IFC import ─────────────────────────────────────────────────────────────
  async function handleIFCImport(file: File) {
    setImporting(true);
    showToast('Parsing IFC… this may take 15–30 seconds for large files');
    try {
      const buffer = await file.arrayBuffer();
      const { parseIFC } = await import('@/lib/parse-ifc');
      const geo = await parseIFC(buffer);
      setGeometry(geo);
      setActiveZoneId(geo.zones[0]?.id ?? null);
      showToast(`Imported ${geo.zones.length} zones from IFC. Review and adjust as needed.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('IFC import failed: ' + msg.slice(0, 120));
      console.error('IFC parse error:', err);
    } finally {
      setImporting(false);
    }
  }

  // ── Floor plan upload ──────────────────────────────────────────────────────
  async function uploadFloorPlan(file: File) {
    const { error } = await supabase.storage.from('pullplan-photos')
      .upload(`${projectId}/floorplan.jpg`, file, { upsert: true });
    if (error) { showToast('Upload failed: ' + error.message); return; }
    const { data } = supabase.storage.from('pullplan-photos').getPublicUrl(`${projectId}/floorplan.jpg`);
    setFloorPlanUrl(data.publicUrl + '?t=' + Date.now());
    showToast('Floor plan uploaded');
  }

  // ── Zone management ────────────────────────────────────────────────────────
  function addZone() {
    const id = `zone_${Date.now()}`;
    const newZone: ZoneGeometry = {
      id,
      name: `Zone ${geometry.zones.length + 1}`,
      area: AREA_OPTIONS[geometry.zones.length % AREA_OPTIONS.length],
      floors: 3,
      footprint: [],
    };
    setGeometry(g => ({ ...g, zones: [...g.zones, newZone] }));
    setActiveZoneId(id);
    setIsDrawing(true);
    setDrawingPoints([]);
  }

  function deleteZone(id: string) {
    setGeometry(g => ({ ...g, zones: g.zones.filter(z => z.id !== id) }));
    if (activeZoneId === id) { setActiveZoneId(null); setIsDrawing(false); setDrawingPoints([]); }
  }

  function updateZone(id: string, patch: Partial<ZoneGeometry>) {
    setGeometry(g => ({ ...g, zones: g.zones.map(z => z.id === id ? { ...z, ...patch } : z) }));
  }

  // ── Drawing on SVG canvas ──────────────────────────────────────────────────
  function getSVGCoords(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (CANVAS / rect.width);
    const py = (e.clientY - rect.top)  * (CANVAS / rect.height);
    return pxToWorld(px, py);
  }

  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawing || !activeZoneId) return;
    if (dragPt) return; // was a drag
    const [wx, wz] = getSVGCoords(e);

    // Close polygon if clicking near first point
    if (drawingPoints.length >= 3) {
      const [fx, fz] = drawingPoints[0];
      const [fpx, fpy] = worldToPx(fx, fz);
      const [cpx, cpy] = worldToPx(wx, wz);
      if (Math.hypot(cpx - fpx, cpy - fpy) < 12) {
        // Close and commit
        updateZone(activeZoneId, { footprint: drawingPoints });
        setDrawingPoints([]);
        setIsDrawing(false);
        showToast('Zone drawn — adjust points by dragging, or draw another zone');
        return;
      }
    }
    setDrawingPoints(prev => [...prev, [wx, wz]]);
  }

  // Drag existing point
  const onPtMouseDown = useCallback((e: React.MouseEvent, zoneId: string, ptIdx: number) => {
    e.stopPropagation();
    setDragPt({ zoneId, ptIdx });
  }, []);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragPt) return;
    const [wx, wz] = getSVGCoords(e);
    setGeometry(g => ({
      ...g,
      zones: g.zones.map(z => {
        if (z.id !== dragPt.zoneId) return z;
        const fp = [...z.footprint];
        fp[dragPt.ptIdx] = [wx, wz];
        return { ...z, footprint: fp };
      }),
    }));
  }

  function handleMouseUp() { setDragPt(null); }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveGeometry() {
    setSaving(true);
    const { error } = await supabase.from('projects')
      .update({ building_geometry: geometry })
      .eq('id', projectId);
    setSaving(false);
    if (error) showToast('Save failed: ' + error.message);
    else showToast('Model saved!');
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const activeZone = geometry.zones.find(z => z.id === activeZoneId);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">3D Model Editor</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{projectName}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/`} className="px-3 py-1.5 rounded-md text-sm bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50">
            ← Home
          </a>
          <button onClick={saveGeometry} disabled={saving}
            className="px-4 py-1.5 rounded-md text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Model'}
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-57px)]">

        {/* ── Left panel: zone list + settings ── */}
        <div className="w-72 shrink-0 bg-white border-r border-zinc-200 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-zinc-100">
            <h2 className="text-sm font-semibold text-zinc-700 mb-3">Zones</h2>
            <button onClick={addZone}
              className="w-full px-3 py-2 rounded-md text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium">
              + Add Zone
            </button>
            <p className="text-xs text-zinc-400 mt-2">
              Click the canvas to draw a polygon. Click the first point again to close.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {geometry.zones.length === 0 && (
              <p className="text-xs text-zinc-400 text-center py-4">No zones yet. Click "Add Zone" to start drawing.</p>
            )}
            {geometry.zones.map((zone, zi) => {
              const color = ZONE_PALETTE[zi % ZONE_PALETTE.length];
              const isActive = activeZoneId === zone.id;
              return (
                <div key={zone.id}
                  className={`rounded-lg border p-3 cursor-pointer transition-all ${isActive ? 'border-blue-400 bg-blue-50' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
                  onClick={() => { setActiveZoneId(zone.id); setIsDrawing(false); setDrawingPoints([]); }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                    <input
                      value={zone.name}
                      onChange={e => updateZone(zone.id, { name: e.target.value })}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 text-sm font-medium bg-transparent border-none outline-none focus:bg-white focus:border focus:border-zinc-300 focus:rounded px-1"
                    />
                    <button onClick={e => { e.stopPropagation(); deleteZone(zone.id); }}
                      className="text-zinc-400 hover:text-red-500 text-xs px-1">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-0.5">Area</label>
                      <select value={zone.area} onChange={e => updateZone(zone.id, { area: e.target.value })}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-7 text-xs rounded border border-zinc-300 bg-white px-1 focus:outline-none focus:ring-1 focus:ring-blue-600">
                        {AREA_OPTIONS.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-0.5">Floors</label>
                      <input type="number" min={1} max={20} value={zone.floors}
                        onChange={e => updateZone(zone.id, { floors: parseInt(e.target.value) || 1 })}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-7 text-xs rounded border border-zinc-300 bg-white px-2 focus:outline-none focus:ring-1 focus:ring-blue-600" />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    {zone.footprint.length} points
                    {isActive && zone.footprint.length > 0 && (
                      <button onClick={e => { e.stopPropagation(); setIsDrawing(true); setDrawingPoints([]); updateZone(zone.id, { footprint: [] }); }}
                        className="ml-2 text-blue-600 hover:underline">Redraw</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Global settings */}
          <div className="p-4 border-t border-zinc-100">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Global Settings</h3>
            <div className="space-y-2">
              {[
                { label: 'Floor height (world units)', key: 'floorHeight' as const },
                { label: 'Floor thickness', key: 'floorDepth' as const },
                { label: 'Roof cap height', key: 'roofCapHeight' as const },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="text-xs text-zinc-400">{label}</label>
                  <input type="number" value={geometry[key] ?? ''} onChange={e => setGeometry(g => ({ ...g, [key]: parseFloat(e.target.value) || undefined }))}
                    className="w-full h-7 mt-0.5 text-xs rounded border border-zinc-300 bg-white px-2 focus:outline-none focus:ring-1 focus:ring-blue-600" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Centre: floor plan canvas ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="shrink-0 bg-white border-b border-zinc-200 px-4 py-2 flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              {isDrawing
                ? `Drawing "${activeZone?.name ?? '...'}" — click to place points, click first point to close`
                : activeZoneId
                  ? 'Drag points to adjust. Click "Redraw" to restart a zone.'
                  : 'Select a zone from the left panel, then draw on the canvas.'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {/* IFC import */}
              <input ref={ifcRef} type="file" accept=".ifc" className="hidden"
                onChange={e => e.target.files?.[0] && handleIFCImport(e.target.files[0])} />
              <button onClick={() => ifcRef.current?.click()} disabled={importing}
                className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-60 flex items-center gap-1.5">
                {importing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Parsing IFC…
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                    </svg>
                    Import IFC
                  </>
                )}
              </button>
              {/* Floor plan image */}
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && uploadFloorPlan(e.target.files[0])} />
              <button onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 text-xs rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50">
                {floorPlanUrl ? '↺ Replace Floor Plan' : '+ Upload Floor Plan'}
              </button>
            </div>
          </div>

          {/* SVG canvas */}
          <div className="flex-1 overflow-auto bg-zinc-100 flex items-center justify-center p-4">
            <div className="relative shadow-lg rounded-lg overflow-hidden" style={{ width: CANVAS, height: CANVAS }}>
              {/* Floor plan background */}
              {floorPlanUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={floorPlanUrl} alt="Floor plan" className="absolute inset-0 w-full h-full object-contain opacity-40 pointer-events-none select-none" />
              )}
              {!floorPlanUrl && (
                <div className="absolute inset-0 bg-white flex items-center justify-center">
                  <p className="text-xs text-zinc-300">Upload a floor plan image to trace over</p>
                </div>
              )}

              <svg ref={canvasRef} width={CANVAS} height={CANVAS} className="absolute inset-0"
                style={{ cursor: isDrawing ? 'crosshair' : 'default' }}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}>

                {/* Grid overlay */}
                <defs>
                  <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" strokeWidth="0.5"/>
                  </pattern>
                </defs>
                <rect width={CANVAS} height={CANVAS} fill="url(#grid)" opacity={floorPlanUrl ? 0.3 : 1} />

                {/* Centre crosshair */}
                <line x1={CANVAS/2} y1={0} x2={CANVAS/2} y2={CANVAS} stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="4 4" />
                <line x1={0} y1={CANVAS/2} x2={CANVAS} y2={CANVAS/2} stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="4 4" />

                {/* Drawn zones */}
                {geometry.zones.map((zone, zi) => {
                  const color = ZONE_PALETTE[zi % ZONE_PALETTE.length];
                  const pts = zone.footprint.map(([wx,wz]) => worldToPx(wx,wz));
                  if (pts.length === 0) return null;
                  const pStr = pts.map(([x,y])=>`${x},${y}`).join(' ');
                  const isActive = activeZoneId === zone.id;
                  return (
                    <g key={zone.id}>
                      <polygon points={pStr} fill={color} fillOpacity={isActive ? 0.25 : 0.15}
                        stroke={color} strokeWidth={isActive ? 2 : 1.5} strokeOpacity={0.8} />
                      {/* Vertex handles */}
                      {pts.map(([px,py], pi) => (
                        <circle key={pi} cx={px} cy={py} r={isActive ? 6 : 4}
                          fill={color} stroke="white" strokeWidth="1.5"
                          className="cursor-move"
                          onMouseDown={e => onPtMouseDown(e, zone.id, pi)} />
                      ))}
                      {/* Zone label at centroid */}
                      {pts.length > 0 && (
                        <text
                          x={pts.reduce((s,[x])=>s+x,0)/pts.length}
                          y={pts.reduce((s,[,y])=>s+y,0)/pts.length}
                          textAnchor="middle" dominantBaseline="middle"
                          fill={color} fontSize="11" fontWeight="600" fontFamily="system-ui"
                          style={{pointerEvents:'none',userSelect:'none'}}>
                          {zone.name}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* In-progress drawing */}
                {isDrawing && drawingPoints.length > 0 && (
                  <g>
                    {drawingPoints.map(([wx,wz],i) => {
                      const [px,py]=worldToPx(wx,wz);
                      return (
                        <g key={i}>
                          {i > 0 && (() => {
                            const [px0,py0]=worldToPx(drawingPoints[i-1][0],drawingPoints[i-1][1]);
                            return <line x1={px0} y1={py0} x2={px} y2={py} stroke="#2563eb" strokeWidth="2" strokeDasharray="4 3"/>;
                          })()}
                          <circle cx={px} cy={py} r={i===0?8:5} fill="#2563eb" stroke="white" strokeWidth="1.5" />
                          {i===0 && <circle cx={px} cy={py} r={12} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="3 2" opacity={0.6}/>}
                        </g>
                      );
                    })}
                  </g>
                )}
              </svg>
            </div>
          </div>
        </div>

        {/* ── Right panel: live 3D preview ── */}
        <div className="w-80 shrink-0 bg-white border-l border-zinc-200 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-100">
            <h2 className="text-sm font-semibold text-zinc-700">Live Preview</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Drag to rotate</p>
          </div>
          <div className="flex-1">
            <Building3D
              highlightArea={null}
              highlightLevel={null}
              highlightTrade={null}
              geometry={geometry.zones.length > 0 ? geometry : null}
            />
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-5 py-2 rounded-full text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </main>
  );
}
