'use client';

import { useState, useEffect, use, useRef } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { Activity } from '@/lib/types';
import { TRADE_COLORS, AREA_COLORS, AREA_ROWS } from '@/lib/constants';

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
  return lum > 0.5 ? '#111' : '#fff';
}

export default function BoardPage({ params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = use(params);
  const printRef = useRef<HTMLDivElement>(null);

  const [allActivities, setAllActivities] = useState<DatedActivity[]>([]);
  const [projectId, setProjectId] = useState('');
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]); // ISO Monday dates
  const [startWeek, setStartWeek] = useState<string>('');
  const [showWeekPicker, setShowWeekPicker] = useState(false);
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
  ).filter(a => threWeekDates.includes(a.resolved_date));

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

  const tradesPresent = Array.from(new Set(allActivities.map(a => a.trade))).filter(t => t in TRADE_COLORS);
  const selectedActivity = allActivities.find(a => a.id === selectedId) ?? null;

  async function handleExportPDF() {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#0f172a' });
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
    <div className="flex flex-col bg-gray-950 text-gray-100 overflow-hidden" style={{ height: '100dvh' }} ref={printRef}>

      {/* ── Header ── */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-bold text-white text-sm">DOC Pull Plan</span>
          <button
            onClick={() => setShowWeekPicker(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs text-gray-300"
          >
            📅 {weekLabel || 'Select week range'}
            <span className="text-gray-500">▾</span>
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setViewMode(v => v === 'board' ? 'owner' : 'board')}
            className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${viewMode === 'owner' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'}`}>
            {viewMode === 'board' ? 'Owner View' : '← Board View'}
          </button>
          <button onClick={handleExportPDF} className="px-3 py-1 rounded text-xs bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700">Export PDF</button>
          <a href="/upload" className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 border border-blue-500 text-white font-semibold">+ Upload More</a>
          <a href={`/review/${uploadId}`} className="px-3 py-1 rounded text-xs bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700">Edit</a>
          <a href="/" className="px-3 py-1 rounded text-xs bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700">Home</a>
        </div>
      </div>

      {/* ── Week picker dropdown ── */}
      {showWeekPicker && (
        <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-3">
          <p className="text-xs text-gray-400 mb-2">Select the starting week — board will show 3 weeks from that date:</p>
          <div className="flex flex-wrap gap-2">
            {availableWeeks.map(w => (
              <button key={w}
                onClick={() => { setStartWeek(w); setShowWeekPicker(false); }}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${startWeek === w ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700'}`}>
                Week of {new Date(w+'T00:00:00').toLocaleDateString()}
              </button>
            ))}
            {availableWeeks.length === 0 && <span className="text-gray-500 text-xs">No published boards yet</span>}
          </div>
        </div>
      )}

      {/* ── Trade legend bar ── */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-1.5 flex flex-wrap gap-1.5">
        {tradesPresent.map(key => {
          const t = TRADE_COLORS[key];
          const active = filterTrade === key;
          return (
            <button key={key} onClick={() => setFilterTrade(prev => prev === key ? null : key)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-all"
              style={{ background: hexToRgba(t.hex, 0.15), border: `1px solid ${active ? t.hex : t.hex+'50'}`, color: active ? '#fff' : '#ccc', boxShadow: active ? `0 0 0 1px ${t.hex}` : 'none' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: t.hex }} />{t.company}
            </button>
          );
        })}
        {filterTrade && <button onClick={() => setFilterTrade(null)} className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-white">Clear ×</button>}
      </div>

      {/* ── Area filter pills ── */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-1.5 flex flex-wrap gap-1.5">
        {['A','B','C','D','sitework','cmu'].map(area => {
          const hidden = hiddenAreas.has(area);
          const color = AREA_COLORS[area];
          return (
            <button key={area} onClick={() => setHiddenAreas(prev => { const n = new Set(prev); n.has(area) ? n.delete(area) : n.add(area); return n; })}
              className="px-2 py-0.5 rounded text-xs font-semibold transition-all"
              style={{ background: hidden ? '#374151' : color+'30', border: `1px solid ${hidden ? '#4b5563' : color}`, color: hidden ? '#6b7280' : color }}>
              {area === 'sitework' ? 'SITEWORK' : area === 'cmu' ? 'CMU' : `AREA ${area}`}
            </button>
          );
        })}
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* 3D model */}
        <div className="shrink-0 border-r border-gray-700 bg-gray-950" style={{ width: viewMode === 'owner' ? '60%' : '240px' }}>
          <Building3D highlightArea={selectedActivity?.area ?? null} highlightLevel={selectedActivity?.level ?? null} highlightTrade={selectedActivity?.trade ?? null} />
          {selectedActivity && (
            <div className="px-3 pb-2 text-xs border-t border-gray-800 pt-2">
              <div className="font-semibold text-white truncate">{selectedActivity.task_name}</div>
              <div className="text-gray-400">{TRADE_COLORS[selectedActivity.trade]?.company} · {AREA_ROWS.find(r => r.area === selectedActivity.area && (r.area_sub ?? null) === (selectedActivity.area_sub ?? null))?.label}</div>
              {selectedActivity.predecessor && <div className="text-gray-500 italic mt-0.5">↳ {selectedActivity.predecessor}</div>}
              <div className="text-gray-500 mt-0.5">Crew: {selectedActivity.crew_size ?? '—'} · Dur: {selectedActivity.duration_days ?? '—'}d</div>
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          {!startWeek ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              <div className="text-center">
                <div className="text-3xl mb-3">📅</div>
                <p>Click the week selector above to choose a starting week</p>
              </div>
            </div>
          ) : (
            <table className="border-collapse min-w-max text-xs">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 bg-gray-900 border border-gray-700 px-3 py-2 text-left text-gray-400 font-medium min-w-[160px]">Area</th>
                  {threWeekDates.map((date, i) => {
                    const isSat = new Date(date+'T00:00:00').getDay() === 6;
                    const isMonday = i % 6 === 0;
                    return (
                      <th key={date}
                        className={`sticky top-0 z-10 border border-gray-700 px-2 py-1 text-center whitespace-nowrap min-w-[100px] ${isSat ? 'bg-gray-800 text-gray-600' : 'bg-gray-900 text-gray-300'} ${isMonday ? 'border-l-2 border-l-blue-800' : ''}`}>
                        <div className="text-[10px] font-semibold">{formatColHeader(date)}</div>
                        {isMonday && <div className="text-[9px] text-blue-400 font-normal">Week {Math.floor(i/6)+1}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {AREA_ROWS.filter(r => !hiddenAreas.has(r.area)).map(row => (
                  <tr key={row.label}>
                    <td className="sticky left-0 z-10 border border-gray-700 px-2 py-1 font-semibold whitespace-nowrap"
                      style={{ background: AREA_COLORS[row.area], color: '#fff', minWidth: 160 }}>
                      {row.label}
                    </td>
                    {threWeekDates.map(date => {
                      const isSat = new Date(date+'T00:00:00').getDay() === 6;
                      const isMonday = new Date(date+'T00:00:00').getDay() === 1;
                      const cards = cellMap[row.label]?.[date] ?? [];
                      return (
                        <td key={date} className={`border border-gray-800 align-top p-1 ${isMonday ? 'border-l-2 border-l-blue-800' : ''}`}
                          style={{ minHeight: 60, minWidth: 100, background: isSat ? '#111827' : undefined }}>
                          {isSat ? (
                            <div className="text-gray-700 text-center text-xl font-bold select-none pt-1">×</div>
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
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-5 py-2 rounded-full text-sm shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}

function TaskCard({ activity: act, filterTrade, selected, onSelect, onToggleStar }:
  { activity: DatedActivity; filterTrade: string | null; selected: boolean; onSelect: (id: string) => void; onToggleStar: (id: string, current: boolean) => void }) {
  const trade = TRADE_COLORS[act.trade];
  const color = trade?.hex ?? '#888';
  const dimmed = filterTrade !== null && filterTrade !== act.trade;
  const statusDot = act.status === 'red' ? '🔴' : act.status === 'yellow' ? '🟡' : null;

  return (
    <div onClick={() => onSelect(act.id)}
      className="rounded mb-1 cursor-pointer transition-all relative"
      style={{
        background: act.is_milestone ? 'transparent' : hexToRgba(color, 0.15),
        borderLeft: act.is_milestone ? undefined : `3px solid ${color}`,
        border: act.is_milestone ? `1px dashed ${color}60` : undefined,
        opacity: dimmed ? 0.25 : 1,
        outline: selected ? `2px solid ${color}` : 'none',
        padding: '3px 5px',
        fontStyle: act.is_milestone ? 'italic' : 'normal',
      }}>
      <div className="flex items-start justify-between gap-1">
        <div className="font-semibold leading-tight text-[10px]" style={{ color: getTextColor(color) }}>
          {act.is_milestone && '★ '}{statusDot && <span className="mr-0.5">{statusDot}</span>}{act.task_name}
        </div>
        <button onClick={e => { e.stopPropagation(); onToggleStar(act.id, act.is_starred); }}
          className="shrink-0 text-[11px] leading-none hover:scale-125 transition-transform">
          {act.is_starred ? '★' : '☆'}
        </button>
      </div>
      {act.predecessor && <div className="text-[9px] italic mt-0.5 truncate" style={{ color: getTextColor(color), opacity: 0.7 }}>↳ {act.predecessor}</div>}
      <div className="text-[9px] mt-0.5 flex gap-1.5" style={{ color: getTextColor(color), opacity: 0.65 }}>
        {act.crew_size !== null && <span>👷{act.crew_size}</span>}
        {act.duration_days !== null && <span>{act.duration_days}d</span>}
      </div>
    </div>
  );
}
