'use client';

import { useState, useEffect, use, useRef } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { Activity } from '@/lib/types';
import { TRADE_COLORS, AREA_COLORS, AREA_ROWS } from '@/lib/constants';
import type { BuildingGeometry } from '@/components/Building3D';

const Building3D = dynamic(() => import('@/components/Building3D'), { ssr: false });
type ViewMode = 'board' | 'owner';

// Activity augmented with its resolved date string (YYYY-MM-DD)
interface DatedActivity extends Activity {
  resolved_date: string; // ISO date for the cell
}

const DAY_OFFSETS: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5 };

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(iso: string): string {
  // Return the Monday of the week containing iso
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatColHeader(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`;
}

function getTextColor(hex: string): string {
  const h = hex.replace('#', '');
  const lum = (0.299*parseInt(h.slice(0,2),16) + 0.587*parseInt(h.slice(2,4),16) + 0.114*parseInt(h.slice(4,6),16)) / 255;
  return lum > 0.5 ? '#111827' : '#ffffff';
}

export default function BoardPage({ params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = use(params);
  const printRef = useRef<HTMLDivElement>(null);

  const [allActivities, setAllActivities] = useState<DatedActivity[]>([]);
  const [projectId, setProjectId] = useState('');
  const [buildingGeometry, setBuildingGeometry] = useState<BuildingGeometry | null>(null);
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);
  const [startWeek, setStartWeek] = useState<string>('');
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterTrade, setFilterTrade] = useState<string | null>(null);
  const [hiddenAreas, setHiddenAreas] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [toast, setToast] = useState('');

  useEffect(() => {
    async function load() {
      const { data: up } = await supabase
        .from('uploads').select('project_id').eq('id', uploadId).single();
      if (!up?.project_id) return;
      setProjectId(up.project_id);

      // Load custom building geometry for this project
      const { data: proj } = await supabase
        .from('projects').select('building_geometry').eq('id', up.project_id).single();
      if (proj?.building_geometry) setBuildingGeometry(proj.building_geometry as BuildingGeometry);

      // Load all published uploads for this project with their week_start_date
      const { data: uploads } = await supabase
        .from('uploads')
        .select('id, week_start_date, status')
        .eq('project_id', up.project_id)
        .eq('status', 'published');
      if (!uploads) return;

      // Load activities for all published uploads
      const { data: acts } = await supabase
        .from('activities')
        .select('*')
        .in('upload_id', uploads.map(u => u.id));
      if (!acts) return;

      // Resolve each activity to a concrete date
      const uploadWeekMap: Record<string, string | null> = {};
      for (const u of uploads) uploadWeekMap[u.id] = u.week_start_date;

      const now = new Date();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const dated: DatedActivity[] = acts.map(act => {
        let resolved_date = '';
        if (act.week_of) {
          resolved_date = act.week_of;
        } else if (act.day_key && uploadWeekMap[act.upload_id]) {
          const weekStart = uploadWeekMap[act.upload_id]!;
          resolved_date = addDays(weekStart, DAY_OFFSETS[act.day_key] ?? 0);
        }
        // If date is more than 6 months in the past, it's likely a wrong year — bump forward 1 year
        if (resolved_date) {
          const d = new Date(resolved_date + 'T00:00:00');
          if (d < sixMonthsAgo) {
            d.setFullYear(d.getFullYear() + 1);
            resolved_date = d.toISOString().slice(0, 10);
          }
        }
        return { ...act, resolved_date };
      }).filter(a => a.resolved_date);

      setAllActivities(dated);

      // Find all unique Monday week starts
      const weeks = Array.from(new Set(
        dated.map(a => startOfWeek(a.resolved_date))
      )).sort();
      setAvailableWeeks(weeks);

      // Default: earliest week that has data
      if (weeks.length > 0 && !startWeek) setStartWeek(weeks[0]);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2000); }

  async function toggleStar(id: string, current: boolean) {
    const next = !current;
    await supabase.from('activities').update({ is_starred: next }).eq('id', id);
    setAllActivities(prev => prev.map(a => a.id === id ? { ...a, is_starred: next } : a));
    showToast(next ? 'Added to owner view' : 'Removed from owner view');
  }

  // Build 3-week column list from startWeek
  const threWeekDates: string[] = [];
  if (startWeek) {
    for (let w = 0; w < 3; w++) {
      for (let d = 0; d < 6; d++) { // Mon–Sat
        threWeekDates.push(addDays(startWeek, w * 7 + d));
      }
    }
  }

  const visibleActivities = (viewMode === 'owner'
    ? allActivities.filter(a => a.is_starred || a.is_milestone || (a.duration_days ?? 0) >= 3 || a.task_name.toLowerCase().includes('inspection'))
    : allActivities
  )
  .filter(a => threWeekDates.includes(a.resolved_date))
  .filter(a => !filterTrade || a.trade === filterTrade);

  // Cell lookup: rowKey → date → activities[]
  const cellMap: Record<string, Record<string, DatedActivity[]>> = {};
  for (const act of visibleActivities) {
    const row = AREA_ROWS.find(r => r.area === act.area && (r.area_sub ?? null) === (act.area_sub ?? null));
    if (!row) continue;
    const rk = row.label;
    if (!cellMap[rk]) cellMap[rk] = {};
    if (!cellMap[rk][act.resolved_date]) cellMap[rk][act.resolved_date] = [];
    cellMap[rk][act.resolved_date].push(act);
  }

  // When a contractor is filtered, only show rows that have at least one activity from them
  const activeRowLabels = filterTrade
    ? new Set(Object.keys(cellMap))
    : null;

  const tradesPresent = Array.from(new Set(allActivities.map(a => a.trade))).filter(Boolean).sort();
  const selectedActivity = allActivities.find(a => a.id === selectedId) ?? null;

  async function handleExportPDF() {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width/2, canvas.height/2] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, canvas.width/2, canvas.height/2);
    pdf.save(`pullplan-${startWeek}.pdf`);
  }

  // Week label for header
  const endWeek = startWeek ? addDays(startWeek, 20) : '';
  const weekLabel = startWeek
    ? `${new Date(startWeek+'T00:00:00').toLocaleDateString()} – ${new Date(endWeek+'T00:00:00').toLocaleDateString()}`
    : '';

  return (
    <div className="flex flex-col bg-zinc-50 text-zinc-900 overflow-hidden" style={{ height: '100dvh' }} ref={printRef}>

      {/* ── Header ── */}
      <div className="shrink-0 bg-white border-b border-zinc-200 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-zinc-900 text-sm">DOC Pull Plan</span>
          <button
            onClick={() => setShowWeekPicker(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 border border-zinc-300 rounded-md text-xs text-zinc-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {weekLabel || 'Select week range'}
            <span className="text-zinc-400">▾</span>
          </button>

          {/* Contractor filter dropdown */}
          <select
            value={filterTrade ?? ''}
            onChange={e => setFilterTrade(e.target.value || null)}
            className="h-8 pl-3 pr-7 rounded-md border border-zinc-300 bg-white text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
          >
            <option value="">All contractors</option>
            {tradesPresent.map(key => {
              const t = TRADE_COLORS[key];
              return (
                <option key={key} value={key}>
                  {t ? `${t.company} — ${t.name}` : key}
                </option>
              );
            })}
          </select>
          {filterTrade && (
            <button
              onClick={() => setFilterTrade(null)}
              className="h-8 px-2 rounded-md border border-zinc-300 bg-white text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-colors"
            >
              ✕ Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setViewMode(v => v === 'board' ? 'owner' : 'board')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${viewMode === 'owner' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50'}`}>
            {viewMode === 'board' ? 'Owner View' : '← Board View'}
          </button>
          <button onClick={() => setShowModel(v => !v)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${showModel ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            3D Model
          </button>
          <button onClick={handleExportPDF} className="px-3 py-1.5 rounded-md text-xs bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors">Export PDF</button>
          <a href="/upload" className="px-3 py-1.5 rounded-md text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors">+ Upload More</a>
          <a href={`/review/${uploadId}`} className="px-3 py-1.5 rounded-md text-xs bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors">Edit</a>
          <a href="/" className="px-3 py-1.5 rounded-md text-xs bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors">Home</a>
        </div>
      </div>

      {/* ── Week picker dropdown ── */}
      {showWeekPicker && (
        <div className="shrink-0 bg-white border-b border-zinc-200 px-4 py-3">
          <p className="text-xs text-zinc-500 mb-2">Select the starting week — board will show 3 weeks from that date:</p>
          <div className="flex flex-wrap gap-2">
            {availableWeeks.map(w => (
              <button key={w}
                onClick={() => { setStartWeek(w); setShowWeekPicker(false); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${startWeek === w ? 'bg-blue-600 text-white' : 'bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50'}`}>
                Week of {new Date(w+'T00:00:00').toLocaleDateString()}
              </button>
            ))}
            {availableWeeks.length === 0 && <span className="text-zinc-400 text-xs">No published boards yet</span>}
          </div>
        </div>
      )}

      {/* ── Trade legend bar ── */}
      <div className="shrink-0 bg-white border-b border-zinc-200 px-4 py-1.5 flex flex-wrap gap-1.5">
        {tradesPresent.map(key => {
          const t = TRADE_COLORS[key];
          const hex = t?.hex ?? '#6b7280';
          const active = filterTrade === key;
          return (
            <button key={key} onClick={() => setFilterTrade(prev => prev === key ? null : key)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-all bg-white"
              style={{
                border: `1px solid ${active ? hex : hex + '60'}`,
                color: active ? hex : '#52525b',
                boxShadow: active ? `0 0 0 1px ${hex}` : 'none',
              }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hex }} />
              {t?.company ?? key}
            </button>
          );
        })}
        {filterTrade && (
          <button onClick={() => setFilterTrade(null)} className="px-2 py-0.5 rounded-md text-xs text-zinc-500 hover:bg-zinc-100 transition-colors">
            Clear ×
          </button>
        )}
      </div>

      {/* ── Area filter pills ── */}
      <div className="shrink-0 bg-white border-b border-zinc-200 px-4 py-1.5 flex flex-wrap gap-1.5">
        {['A','B','C','D','sitework','cmu'].map(area => {
          const hidden = hiddenAreas.has(area);
          const color = AREA_COLORS[area];
          return (
            <button key={area} onClick={() => setHiddenAreas(prev => { const n = new Set(prev); n.has(area) ? n.delete(area) : n.add(area); return n; })}
              className="px-2 py-0.5 rounded-md text-xs font-semibold transition-all"
              style={{
                background: hidden ? '#f4f4f5' : color + '20',
                border: `1px solid ${hidden ? '#d4d4d8' : color + '80'}`,
                color: hidden ? '#a1a1aa' : color,
              }}>
              {area === 'sitework' ? 'SITEWORK' : area === 'cmu' ? 'CMU' : `AREA ${area}`}
            </button>
          );
        })}
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          {!startWeek ? (
            <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
              <div className="text-center">
                <svg className="w-10 h-10 mx-auto mb-3 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p>Click the week selector above to choose a starting week</p>
              </div>
            </div>
          ) : (
            <table className="border-collapse min-w-max text-xs bg-white">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 bg-zinc-50 border border-zinc-200 px-3 py-2 text-left text-zinc-500 font-medium min-w-[160px]">Area</th>
                  {threWeekDates.map((date, i) => {
                    const isSat = new Date(date+'T00:00:00').getDay() === 6;
                    const isMonday = i % 6 === 0;
                    return (
                      <th key={date}
                        className={`sticky top-0 z-10 border border-zinc-200 px-2 py-1 text-center whitespace-nowrap min-w-[100px] ${isSat ? 'bg-zinc-50 text-zinc-400' : 'bg-zinc-50 text-zinc-600'} ${isMonday ? 'border-l-2 border-l-blue-400' : ''}`}>
                        <div className="text-[10px] font-semibold">{formatColHeader(date)}</div>
                        {isMonday && <div className="text-[9px] text-blue-500 font-normal">Week {Math.floor(i/6)+1}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {AREA_ROWS.filter(r => !hiddenAreas.has(r.area) && (!activeRowLabels || activeRowLabels.has(r.label))).map(row => (
                  <tr key={row.label}>
                    <td className="sticky left-0 z-10 border border-zinc-200 px-2 py-1 font-semibold whitespace-nowrap text-white"
                      style={{ background: AREA_COLORS[row.area], minWidth: 160 }}>
                      {row.label}
                    </td>
                    {threWeekDates.map(date => {
                      const isSat = new Date(date+'T00:00:00').getDay() === 6;
                      const isMonday = new Date(date+'T00:00:00').getDay() === 1;
                      const cards = cellMap[row.label]?.[date] ?? [];
                      return (
                        <td key={date}
                          className={`border border-zinc-100 align-top p-1 ${isMonday ? 'border-l-2 border-l-blue-400' : ''}`}
                          style={{ minHeight: 60, minWidth: 100, background: isSat ? '#f9fafb' : '#ffffff' }}>
                          {isSat ? (
                            <div className="text-zinc-300 text-center text-xl font-bold select-none pt-1">×</div>
                          ) : (
                            cards.map(act => (
                              <TaskCard key={act.id} activity={act} filterTrade={filterTrade}
                                selected={selectedId === act.id}
                                onSelect={id => setSelectedId(prev => prev === id ? null : id)}
                                onToggleStar={toggleStar} />
                            ))
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── 3D Model right panel ── */}
        {showModel && (
          <div
            className="shrink-0 flex flex-col bg-white border-l border-zinc-200"
            style={{ width: viewMode === 'owner' ? '45%' : '300px' }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100">
              <span className="text-xs font-semibold text-zinc-700">3D Model</span>
              <div className="flex items-center gap-1">
                {projectId && (
                  <a href={`/projects/${projectId}/model`} target="_blank"
                    className="text-[10px] text-blue-600 hover:underline px-1">
                    Edit →
                  </a>
                )}
                <button onClick={() => setShowModel(false)}
                  className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 text-sm leading-none">
                  ×
                </button>
              </div>
            </div>

            {/* 3D viewer */}
            <div className="flex-1 min-h-0">
              <Building3D
                highlightArea={selectedActivity?.area ?? null}
                highlightLevel={selectedActivity?.level ?? null}
                highlightTrade={selectedActivity?.trade ?? null}
                geometry={buildingGeometry}
              />
            </div>

            {/* Selected task info */}
            {selectedActivity ? (
              <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50">
                <div className="text-xs font-semibold text-zinc-800 truncate">{selectedActivity.task_name}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {TRADE_COLORS[selectedActivity.trade]?.company ?? selectedActivity.trade} ·{' '}
                  {AREA_ROWS.find(r => r.area === selectedActivity.area && (r.area_sub ?? null) === (selectedActivity.area_sub ?? null))?.label}
                </div>
                {selectedActivity.predecessor && (
                  <div className="text-[10px] text-zinc-400 italic mt-0.5 truncate">↳ {selectedActivity.predecessor}</div>
                )}
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  Crew: {selectedActivity.crew_size ?? '—'} · Dur: {selectedActivity.duration_days ?? '—'}d
                </div>
              </div>
            ) : (
              <div className="px-3 py-2 border-t border-zinc-100 text-[10px] text-zinc-400 text-center">
                Click a task card to highlight it
              </div>
            )}

            {/* Build model prompt */}
            {!buildingGeometry && (
              <div className="px-3 py-2 bg-amber-50 border-t border-amber-100 text-[10px] text-amber-700 flex items-center justify-between">
                <span>Default geometry shown.</span>
                {projectId && (
                  <a href={`/projects/${projectId}/model`} className="font-medium underline">Build yours →</a>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-5 py-2 rounded-full text-sm shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}

function TaskCard({ activity: act, filterTrade, selected, onSelect, onToggleStar }:
  { activity: DatedActivity; filterTrade: string | null; selected: boolean; onSelect: (id: string) => void; onToggleStar: (id: string, current: boolean) => void }) {
  const trade = TRADE_COLORS[act.trade];
  const color = trade?.hex ?? '#6b7280';
  const statusDot = act.status === 'red' ? '🔴' : act.status === 'yellow' ? '🟡' : null;

  return (
    <div onClick={() => onSelect(act.id)}
      className="rounded mb-1 cursor-pointer transition-all relative bg-white"
      style={{
        borderLeft: act.is_milestone ? undefined : `3px solid ${color}`,
        border: act.is_milestone ? `1px dashed ${color}60` : undefined,
        background: act.is_milestone ? 'transparent' : hexToRgba(color, 0.07),
        opacity: 1,
        outline: selected ? `2px solid ${color}` : 'none',
        outlineOffset: selected ? '1px' : undefined,
        padding: '3px 5px',
        fontStyle: act.is_milestone ? 'italic' : 'normal',
      }}>
      <div className="flex items-start justify-between gap-1">
        <div className="font-semibold leading-tight text-[10px] text-zinc-800">
          {act.is_milestone && '★ '}{statusDot && <span className="mr-0.5">{statusDot}</span>}{act.task_name}
        </div>
        <button onClick={e => { e.stopPropagation(); onToggleStar(act.id, act.is_starred); }}
          className="shrink-0 text-[11px] leading-none hover:scale-125 transition-transform text-zinc-400 hover:text-yellow-500">
          {act.is_starred ? '★' : '☆'}
        </button>
      </div>
      {act.predecessor && (
        <div className="text-[9px] italic mt-0.5 truncate text-zinc-500">↳ {act.predecessor}</div>
      )}
      <div className="text-[9px] mt-0.5 flex gap-1.5 text-zinc-500">
        {act.crew_size !== null && <span>👷{act.crew_size}</span>}
        {act.duration_days !== null && <span>{act.duration_days}d</span>}
      </div>
    </div>
  );
}
