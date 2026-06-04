'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { TRADE_COLORS } from '@/lib/constants';

interface Building3DProps {
  highlightArea: string | null;
  highlightLevel: number | null;
  highlightTrade: string | null;
}

const FOOTPRINTS: Record<string, [number, number][]> = {
  core:  [[-20,-15],[20,-15],[30,0],[15,18],[-15,18],[-30,0]],
  wingA: [[-30,0],[-15,18],[-27,73],[-42,73],[-55,48],[-55,0]],
  wingB: [[15,18],[30,0],[55,0],[55,48],[42,73],[27,73]],
  blockD:[[-16,-15],[16,-15],[16,-55],[-16,-55]],
};

const LEVEL_HEIGHT = 26;
const FLOOR_H = 24;
const ROOF_CAP_H = 5;
const LEVELS = 4;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function lighten(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.min(255, Math.round(r + (255 - r) * (1 - factor)));
  const lg = Math.min(255, Math.round(g + (255 - g) * (1 - factor)));
  const lb = Math.min(255, Math.round(b + (255 - b) * (1 - factor)));
  return `rgb(${lr},${lg},${lb})`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function Building3D({ highlightArea, highlightLevel, highlightTrade }: Building3DProps) {
  const [rotY, setRotY] = useState(25);
  const [rotX, setRotX] = useState(28);
  const dragRef = useRef<{ x: number; y: number; ry: number; rx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  function getColors(zone: string, level: number, tradeHex: string | null) {
    const isHL = highlightArea === zone && highlightLevel === level;
    const dim = (highlightArea !== null) && !isHL;

    if (isHL && tradeHex) {
      return {
        top:    lighten(tradeHex, 0.1),
        front:  lighten(tradeHex, 0.35),
        right:  lighten(tradeHex, 0.2),
        stroke: tradeHex,
        opacity: 1.0,
      };
    }
    return {
      top:    '#c8cdd8',
      front:  '#a8adb8',
      right:  '#b8bdc8',
      stroke: '#9098a8',
      opacity: dim ? 0.28 : 0.82,
    };
  }

  function ptsToStr(pts: [number, number][]) {
    return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  }

  function drawPrisms() {
    const tradeHex = highlightTrade ? (TRADE_COLORS[highlightTrade]?.hex ?? null) : null;

    const faces: { pts: [number, number][]; fill: string; stroke: string; opacity: number; z: number }[] = [];

    const zoneAreaMap: Record<string, string> = {
      wingA: 'A', wingB: 'B', blockD: 'D', core: 'C',
    };

    for (let levelIdx = 0; levelIdx < LEVELS; levelIdx++) {
      const yBase = levelIdx * LEVEL_HEIGHT;
      const height = levelIdx === LEVELS - 1 ? ROOF_CAP_H : FLOOR_H;

      const drawOrder = ['blockD', 'core', 'wingA', 'wingB'];

      for (const zone of drawOrder) {
        if (zone === 'blockD' && levelIdx > 1) continue;

        const fp = FOOTPRINTS[zone];
        const area = zoneAreaMap[zone];
        const colors = getColors(area, levelIdx, tradeHex);

        const topPts = fp.map(([x, z]) => project(x, yBase + height, z));
        const botPts = fp.map(([x, z]) => project(x, yBase, z));
        const n = fp.length;

        const sideFaces: { pts: [number, number][]; isRight: boolean; dot: number }[] = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const nx = fp[j][1] - fp[i][1];
          const nz = -(fp[j][0] - fp[i][0]);
          const camX = Math.sin(rotY * Math.PI / 180);
          const camZ = Math.cos(rotY * Math.PI / 180);
          const dot = nx * camX + nz * camZ;
          if (dot <= 0) continue;
          const isRight = nx > 0 && Math.abs(nx) > Math.abs(nz) * 0.4;
          sideFaces.push({ pts: [topPts[i], topPts[j], botPts[j], botPts[i]], isRight, dot });
        }

        sideFaces.sort((a, b) => a.dot - b.dot);
        for (const sf of sideFaces) {
          faces.push({
            pts: sf.pts,
            fill: sf.isRight ? colors.right : colors.front,
            stroke: colors.stroke,
            opacity: colors.opacity,
            z: levelIdx,
          });
        }
        // Top face
        faces.push({
          pts: topPts,
          fill: colors.top,
          stroke: colors.stroke,
          opacity: colors.opacity,
          z: levelIdx + 0.5,
        });
      }
    }

    return faces.map((f, i) => (
      <polygon
        key={i}
        points={ptsToStr(f.pts)}
        fill={f.fill}
        stroke={f.stroke}
        strokeWidth="0.5"
        opacity={f.opacity}
      />
    ));
  }

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setRotY(dragRef.current.ry + dx * 0.55);
    setRotX(clamp(dragRef.current.rx - dy * 0.3, 8, 60));
  }

  function onMouseUp() {
    dragRef.current = null;
  }

  // Touch support
  const touchRef = useRef<{ x: number; y: number; ry: number; rx: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, ry: rotY, rx: rotX };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!touchRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    setRotY(touchRef.current.ry + dx * 0.55);
    setRotX(clamp(touchRef.current.rx - dy * 0.3, 8, 60));
  }
  function onTouchEnd() {
    touchRef.current = null;
  }

  // Reset to default angles on double-click
  function onDblClick() {
    setRotY(25);
    setRotX(28);
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 400 350"
      className="w-full h-full cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={onDblClick}
    >
      <rect width="400" height="350" fill="#0f172a" />
      {drawPrisms()}
      <text x="200" y="338" textAnchor="middle" fill="#475569" fontSize="9">
        drag to rotate · double-click to reset
      </text>
    </svg>
  );
}
