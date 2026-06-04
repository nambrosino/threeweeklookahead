'use client';

import { useState, useEffect, use, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { Activity } from '@/lib/types';
import { TRADE_COLORS, AREA_COLORS, AREA_ROWS, DAY_KEYS, DAY_LABELS } from '@/lib/constants';

const Building3D = dynamic(() => import('@/components/Building3D'), { ssr: false });

type ViewMode = 'board' | 'owner';

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getTextColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? '#111' : '#fff';
}

export default function BoardPage({ params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = use(params);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [upload, setUpload] = useState<{ week_start_date: string | null; project_id: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterTrade, setFilterTrade] = useState<string | null>(null);
  const [hiddenAreas, setHiddenAreas] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [toast, setToast] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const { data: up } = await supabase
        .from('uploads')
        .select('week_start_date, project_id')
        .eq('id', uploadId)
        .single();
      setUpload(up);

      const { data } = await supabase
        .from('activities')
        .select('*')
        .eq('upload_id', uploadId);
      if (data) setActivities(data);
    }
    load();
  }, [uploadId]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  }

  async function toggleStar(id: string, current: boolean) {
    const next = !current;
    await supabase.from('activities').update({ is_starred: next }).eq('id', id);
    setActivities(prev => prev.map(a => (a.id === id ? { ...a, is_starred: next } : a)));
    showToast(next ? 'Added to owner view' : 'Removed from owner view');
  }

  function selectTask(id: string) {
    setSelectedId(prev => (prev === id ? null : id));
  }

  function toggleAreaFilter(area: string) {
    setHiddenAreas(prev => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  }

  const selectedActivity = activities.find(a => a.id === selectedId) ?? null;

  const visibleActivities =
    viewMode === 'owner'
      ? activities.filter(
          a =>
            a.is_starred ||
            a.is_milestone ||
            (a.duration_days !== null && a.duration_days >= 3) ||
            a.task_name.toLowerCase().includes('inspection')
        )
      : activities;

  // Build cell lookup: rowKey → dayKey → activities[]
  const cellMap: Record<string, Record<string, Activity[]>> = {};
  for (const act of visibleActivities) {
    const row = AREA_ROWS.find(
      r => r.area === act.area && (r.area_sub ?? null) === (act.area_sub ?? null)
    );
    if (!row) continue;
    const rowKey = row.label;
    const colKey = act.day_key ?? act.week_of ?? 'unknown';
    if (!cellMap[rowKey]) cellMap[rowKey] = {};
    if (!cellMap[rowKey][colKey]) cellMap[rowKey][colKey] = [];
    cellMap[rowKey][colKey].push(act);
  }

  // Collect column keys from data
  const colKeysSet = new Set<string>();
  for (const act of visibleActivities) {
    colKeysSet.add(act.day_key ?? act.week_of ?? 'unknown');
  }
  // Prefer canonical order if daily
  const hasDaily = visibleActivities.some(a => a.day_key !== null);
  const colKeys = hasDaily
    ? DAY_KEYS.filter(d => colKeysSet.has(d))
    : Array.from(colKeysSet).sort();

  // Distinct trade keys present in data
  const tradesPresent = Array.from(new Set(activities.map(a => a.trade))).filter(
    t => t in TRADE_COLORS
  );

  async function handleExportPDF() {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#0f172a' });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2);
    pdf.save(`pullplan-${uploadId}.pdf`);
  }

  const ownerScale = viewMode === 'owner' ? 1.2 : 1;

  return (
    <div
      className="flex flex-col bg-gray-950 text-gray-100 overflow-hidden"
      style={{ height: '100dvh', fontSize: `${ownerScale}rem` }}
      ref={printRef}
    >
      {/* ── Header ── */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span className="font-bold text-white text-sm">DOC Pull Plan</span>
          {upload?.week_start_date && (
            <span className="ml-3 text-gray-400 text-xs">
              Week of {new Date(upload.week_start_date + 'T00:00:00').toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setViewMode(v => (v === 'board' ? 'owner' : 'board'))}
            className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
              viewMode === 'owner'
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {viewMode === 'board' ? 'Owner View' : '← Board View'}
          </button>
          <button
            onClick={handleExportPDF}
            className="px-3 py-1 rounded text-xs bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700"
          >
            Export PDF
          </button>
          <a
            href={`/review/${uploadId}`}
            className="px-3 py-1 rounded text-xs bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700"
          >
            Edit
          </a>
        </div>
      </div>

      {/* ── Trade legend bar ── */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-1.5 flex flex-wrap gap-1.5">
        {tradesPresent.map(key => {
          const t = TRADE_COLORS[key];
          const active = filterTrade === key;
          return (
            <button
              key={key}
              onClick={() => setFilterTrade(prev => (prev === key ? null : key))}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-all"
              style={{
                background: hexToRgba(t.hex, 0.15),
                border: `1px solid ${active ? t.hex : t.hex + '50'}`,
                color: active ? '#fff' : '#ccc',
                boxShadow: active ? `0 0 0 1px ${t.hex}` : 'none',
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: t.hex }} />
              {t.company}
            </button>
          );
        })}
        {filterTrade && (
          <button
            onClick={() => setFilterTrade(null)}
            className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-white"
          >
            Clear filter ×
          </button>
        )}
      </div>

      {/* ── Area filter pills ── */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-1.5 flex flex-wrap gap-1.5">
        {['A', 'B', 'C', 'D', 'sitework', 'cmu'].map(area => {
          const hidden = hiddenAreas.has(area);
          const color = AREA_COLORS[area];
          return (
            <button
              key={area}
              onClick={() => toggleAreaFilter(area)}
              className="px-2 py-0.5 rounded text-xs font-semibold transition-all"
              style={{
                background: hidden ? '#374151' : color + '30',
                border: `1px solid ${hidden ? '#4b5563' : color}`,
                color: hidden ? '#6b7280' : color,
              }}
            >
              {area === 'sitework' ? 'SITEWORK' : area === 'cmu' ? 'CMU' : `AREA ${area}`}
            </button>
          );
        })}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* 3D Model */}
        <div
          className="shrink-0 border-r border-gray-700 bg-gray-950"
          style={{ width: viewMode === 'owner' ? '60%' : '280px' }}
        >
          <Building3D
            highlightArea={selectedActivity?.area ?? null}
            highlightLevel={selectedActivity?.level ?? null}
            highlightTrade={selectedActivity?.trade ?? null}
          />
          {selectedActivity && (
            <div className="px-3 pb-2 text-xs border-t border-gray-800 pt-2">
              <div className="font-semibold text-white truncate">{selectedActivity.task_name}</div>
              <div className="text-gray-400">
                {TRADE_COLORS[selectedActivity.trade]?.company} ·{' '}
                {AREA_ROWS.find(
                  r =>
                    r.area === selectedActivity.area &&
                    (r.area_sub ?? null) === (selectedActivity.area_sub ?? null)
                )?.label}
              </div>
              {selectedActivity.predecessor && (
                <div className="text-gray-500 italic mt-0.5">↳ {selectedActivity.predecessor}</div>
              )}
              <div className="text-gray-500 mt-0.5">
                Crew: {selectedActivity.crew_size ?? '—'} · Dur: {selectedActivity.duration_days ?? '—'}d
              </div>
            </div>
          )}
        </div>

        {/* Pull plan grid */}
        <div className="flex-1 overflow-auto">
          <table className="border-collapse min-w-max text-xs">
            <thead>
              <tr>
                <th
                  className="sticky top-0 left-0 z-20 bg-gray-900 border border-gray-700 px-3 py-2 text-left text-gray-400 font-medium min-w-[160px]"
                >
                  Area
                </th>
                {colKeys.map(col => (
                  <th
                    key={col}
                    className="sticky top-0 z-10 bg-gray-900 border border-gray-700 px-3 py-2 text-center text-gray-300 font-medium whitespace-nowrap min-w-[120px]"
                  >
                    {hasDaily ? DAY_LABELS[col] ?? col : `WK ${col}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AREA_ROWS.filter(r => !hiddenAreas.has(r.area)).map(row => {
                const areaColor = AREA_COLORS[row.area];
                return (
                  <tr key={row.label}>
                    <td
                      className="sticky left-0 z-10 border border-gray-700 px-2 py-1 font-semibold whitespace-nowrap"
                      style={{ background: areaColor, color: '#fff', minWidth: 160 }}
                    >
                      {row.label}
                    </td>
                    {colKeys.map(col => {
                      const isWeekend = hasDaily && (col === 'sat');
                      const cards = cellMap[row.label]?.[col] ?? [];
                      return (
                        <td
                          key={col}
                          className="border border-gray-800 align-top p-1"
                          style={{ minHeight: 60, verticalAlign: 'top', minWidth: 120 }}
                        >
                          {isWeekend ? (
                            <div className="text-gray-700 text-center text-2xl font-bold select-none pt-1">
                              ×
                            </div>
                          ) : (
                            cards.map(act => (
                              <TaskCard
                                key={act.id}
                                activity={act}
                                filterTrade={filterTrade}
                                selected={selectedId === act.id}
                                onSelect={selectTask}
                                onToggleStar={toggleStar}
                              />
                            ))
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-5 py-2 rounded-full text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  activity: act,
  filterTrade,
  selected,
  onSelect,
  onToggleStar,
}: {
  activity: Activity;
  filterTrade: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (id: string, current: boolean) => void;
}) {
  const trade = TRADE_COLORS[act.trade];
  const color = trade?.hex ?? '#888';
  const textColor = act.is_milestone ? '#e0e0ff' : getTextColor(color);
  const dimmed = filterTrade !== null && filterTrade !== act.trade;

  const statusDot =
    act.status === 'red' ? '🔴' : act.status === 'yellow' ? '🟡' : null;

  return (
    <div
      onClick={() => onSelect(act.id)}
      className="rounded mb-1 cursor-pointer transition-all relative"
      style={{
        background: act.is_milestone ? 'transparent' : hexToRgba(color, 0.12),
        border: act.is_milestone ? `1px dashed ${color}60` : `none`,
        borderLeft: act.is_milestone ? undefined : `3px solid ${color}`,
        opacity: dimmed ? 0.25 : 1,
        outline: selected ? `2px solid ${color}` : 'none',
        padding: '3px 5px',
        fontStyle: act.is_milestone ? 'italic' : 'normal',
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <div
          className="font-semibold leading-tight text-[10px]"
          style={{ color: textColor }}
        >
          {act.is_milestone && '★ '}
          {statusDot && <span className="mr-0.5">{statusDot}</span>}
          {act.task_name}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onToggleStar(act.id, act.is_starred); }}
          className="shrink-0 text-[11px] leading-none hover:scale-125 transition-transform"
          title={act.is_starred ? 'Remove from owner view' : 'Add to owner view'}
        >
          {act.is_starred ? '★' : '☆'}
        </button>
      </div>
      {act.predecessor && (
        <div className="text-[9px] italic mt-0.5 truncate" style={{ color: textColor, opacity: 0.7 }}>
          ↳ {act.predecessor}
        </div>
      )}
      <div className="text-[9px] mt-0.5 flex gap-1.5" style={{ color: textColor, opacity: 0.65 }}>
        {act.crew_size !== null && <span>👷{act.crew_size}</span>}
        {act.duration_days !== null && <span>{act.duration_days}d</span>}
      </div>
    </div>
  );
}
