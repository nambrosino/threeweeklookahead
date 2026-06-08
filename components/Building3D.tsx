'use client';

import { useRef, useState, useCallback } from 'react';
import { TRADE_COLORS, AREA_COLORS } from '@/lib/constants';

// ─── Geometry types ───────────────────────────────────────────────────────────

export interface ZoneGeometry {
  id: string;
  name: string;
  area: string;          // maps to area label (A, B, C, D, sitework, cmu, or custom)
  floors: number;        // number of floors to stack
  footprint: [number, number][];              // default footprint for all levels
  levelFootprints?: { [level: number]: [number, number][] }; // per-level overrides
}

export interface BuildingGeometry {
  zones: ZoneGeometry[];
  floorHeight?: number;  // default 26
  floorDepth?: number;   // default 24 (wall height per floor)
  roofCapHeight?: number; // default 5
}

// ─── Woonsocket fallback geometry ─────────────────────────────────────────────

const WOONSOCKET: BuildingGeometry = {
  floorHeight: 26,
  floorDepth: 24,
  roofCapHeight: 5,
  zones: [
    {
      id: 'core',
      name: 'Core / Area C',
      area: 'C',
      floors: 4,
      footprint: [[-20,-15],[20,-15],[30,0],[15,18],[-15,18],[-30,0]],
    },
    {
      id: 'wingA',
      name: 'Wing A',
      area: 'A',
      floors: 4,
      footprint: [[-30,0],[-15,18],[-27,73],[-42,73],[-55,48],[-55,0]],
    },
    {
      id: 'wingB',
      name: 'Wing B',
      area: 'B',
      floors: 4,
      footprint: [[15,18],[30,0],[55,0],[55,48],[42,73],[27,73]],
    },
    {
      id: 'blockD',
      name: 'Block D',
      area: 'D',
      floors: 2,
      footprint: [[-16,-15],[16,-15],[16,-55],[-16,-55]],
    },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function lighten(hex: string, factor: number): string {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.min(255,Math.round(r+(255-r)*(1-factor)))},${Math.min(255,Math.round(g+(255-g)*(1-factor)))},${Math.min(255,Math.round(b+(255-b)*(1-factor)))})`;
}

// Assign a distinct color to each zone based on its area
function zoneBaseColor(area: string): string {
  return AREA_COLORS[area] ?? '#6080b0';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Building3DProps {
  highlightArea: string | null;
  highlightLevel: number | null;
  highlightTrade: string | null;
  geometry?: BuildingGeometry | null;
  activityCounts?: Record<string, number>; // area key → count in current 3-week window
}

export default function Building3D({
  highlightArea,
  highlightLevel,
  highlightTrade,
  geometry,
  activityCounts,
}: Building3DProps) {
  const geo = geometry ?? WOONSOCKET;
  const FLOOR_H   = geo.floorHeight   ?? 26;
  const FLOOR_D   = geo.floorDepth    ?? 24;
  const ROOF_CAP  = geo.roofCapHeight ?? 5;

  const [rotY, setRotY] = useState(25);
  const [rotX, setRotX] = useState(28);
  const dragRef  = useRef<{ x: number; y: number; ry: number; rx: number } | null>(null);
  const touchRef = useRef<{ x: number; y: number; ry: number; rx: number } | null>(null);

  const cx = 200, cy = 200;

  const project = useCallback(
    (x: number, y: number, z: number): [number, number] => {
      const ry = rotY * (Math.PI / 180);
      const rx = rotX * (Math.PI / 180);
      const x1 = x * Math.cos(ry) + z * Math.sin(ry);
      const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
      const y1 = y * Math.cos(rx) - z1 * Math.sin(rx);
      return [cx + x1, cy - y1];
    },
    [rotY, rotX]
  );

  function heatColor(area: string): { top: string; front: string; right: string; stroke: string } | null {
    if (!activityCounts) return null;
    const count = activityCounts[area] ?? 0;
    if (count === 0) return null;
    if (count <= 5)  return { top: '#fef08a', front: '#ca8a04', right: '#fde047', stroke: '#a16207' }; // yellow
    if (count <= 10) return { top: '#fed7aa', front: '#c2410c', right: '#fb923c', stroke: '#9a3412' }; // orange
    return           { top: '#fca5a5', front: '#b91c1c', right: '#f87171', stroke: '#991b1b' };        // red
  }

  function getColors(zone: ZoneGeometry, levelIdx: number) {
    const isHL = highlightArea === zone.area && highlightLevel === levelIdx;
    const dim  = highlightArea !== null && !isHL;

    // Task selected — bright red on selected zone, dim others
    if (isHL) {
      return { top: '#ff4444', front: '#cc1111', right: '#ee2222', stroke: '#bb0000', opacity: 1.0 };
    }
    if (dim) {
      return { top:'#d4d8e0', front:'#b8bcc8', right:'#c8ccd4', stroke:'#9098a8', opacity: 0.18 };
    }

    // No task selected — show activity heat map if counts provided
    if (!highlightArea) {
      const heat = heatColor(zone.area);
      if (heat) return { ...heat, opacity: 0.95 };
      // No activities in this area — neutral gray
      if (activityCounts) {
        return { top:'#e2e8f0', front:'#cbd5e1', right:'#d8e0ea', stroke:'#94a3b8', opacity: 0.7 };
      }
      // No counts provided — use zone area color
      const base = zoneBaseColor(zone.area);
      return { top: lighten(base,0.45), front: lighten(base,0.65), right: lighten(base,0.55), stroke: base, opacity: 0.9 };
    }

    return { top:'#d4d8e0', front:'#b8bcc8', right:'#c8ccd4', stroke:'#9098a8', opacity: 0.85 };
  }

  function ptsToStr(pts: [number,number][]) {
    return pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  }

  function drawScene() {
    const polys: { pts: [number,number][]; fill: string; stroke: string; opacity: number; depth: number }[] = [];

    for (const zone of geo.zones) {
      for (let levelIdx = 0; levelIdx < zone.floors; levelIdx++) {
        // Use per-level footprint if defined, else fall back to the default
        const fp = zone.levelFootprints?.[levelIdx] ?? zone.footprint;
        const n  = fp.length;
        if (n < 3) continue;
        const yBase  = levelIdx * FLOOR_H;
        const height = levelIdx === zone.floors - 1 ? ROOF_CAP : FLOOR_D;
        const colors = getColors(zone, levelIdx);

        const topPts = fp.map(([x,z]) => project(x, yBase + height, z));
        const botPts = fp.map(([x,z]) => project(x, yBase, z));

        // Centroid Z for depth sorting
        const centZ = fp.reduce((s,[,z])=>s+z,0)/n;
        const centX = fp.reduce((s,[x])=>s+x,0)/n;
        const depthBase = centX * Math.sin(rotY*Math.PI/180) + centZ * Math.cos(rotY*Math.PI/180);

        // Side faces
        const sideFaces: {pts:[number,number][]; isRight:boolean; dot:number}[] = [];
        for (let i=0; i<n; i++) {
          const j=(i+1)%n;
          const nx=fp[j][1]-fp[i][1];
          const nz=-(fp[j][0]-fp[i][0]);
          const camX=Math.sin(rotY*Math.PI/180);
          const camZ=Math.cos(rotY*Math.PI/180);
          const dot=nx*camX+nz*camZ;
          if (dot<=0) continue;
          const isRight=nx>0 && Math.abs(nx)>Math.abs(nz)*0.4;
          sideFaces.push({pts:[topPts[i],topPts[j],botPts[j],botPts[i]],isRight,dot});
        }
        sideFaces.sort((a,b)=>a.dot-b.dot);
        for (const sf of sideFaces) {
          polys.push({ pts:sf.pts, fill:sf.isRight?colors.right:colors.front, stroke:colors.stroke, opacity:colors.opacity, depth:depthBase-levelIdx*0.1 });
        }
        // Top face
        polys.push({ pts:topPts, fill:colors.top, stroke:colors.stroke, opacity:colors.opacity, depth:depthBase+levelIdx*0.1+0.5 });
      }
    }

    // Sort back-to-front
    polys.sort((a,b) => a.depth - b.depth);

    return polys.map((p,i) => (
      <polygon key={i} points={ptsToStr(p.pts)} fill={p.fill} stroke={p.stroke} strokeWidth="0.5" opacity={p.opacity} />
    ));
  }

  function onMouseDown(e: React.MouseEvent) { dragRef.current = {x:e.clientX,y:e.clientY,ry:rotY,rx:rotX}; }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    setRotY(dragRef.current.ry+(e.clientX-dragRef.current.x)*0.55);
    setRotX(clamp(dragRef.current.rx-(e.clientY-dragRef.current.y)*0.3,8,60));
  }
  function onMouseUp() { dragRef.current=null; }

  function onTouchStart(e: React.TouchEvent) {
    const t=e.touches[0];
    touchRef.current={x:t.clientX,y:t.clientY,ry:rotY,rx:rotX};
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!touchRef.current) return;
    const t=e.touches[0];
    setRotY(touchRef.current.ry+(t.clientX-touchRef.current.x)*0.55);
    setRotX(clamp(touchRef.current.rx-(t.clientY-touchRef.current.y)*0.3,8,60));
  }
  function onTouchEnd() { touchRef.current=null; }

  return (
    <svg
      viewBox="0 0 400 350"
      className="w-full h-full cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={() => { setRotY(25); setRotX(28); }}
    >
      <rect width="400" height="350" fill="#f8fafc" />
      {drawScene()}
      <text x="200" y="342" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="system-ui">
        drag to rotate · double-click to reset
      </text>
    </svg>
  );
}
