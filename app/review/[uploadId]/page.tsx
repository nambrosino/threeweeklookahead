'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Activity, ActivityStatus } from '@/lib/types';
import { TRADE_COLORS, AREA_ROWS, DAY_KEYS, DAY_LABELS } from '@/lib/constants';

interface ReviewActivity extends Activity {
  _dirty?: boolean;
}

export default function ReviewPage({ params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = use(params);
  const router = useRouter();

  const [activities, setActivities] = useState<ReviewActivity[]>([]);
  const [uploadDate, setUploadDate] = useState('');
  const [uploadStatus, setUploadStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    async function load() {
      const { data: upload } = await supabase
        .from('uploads')
        .select('uploaded_at, status')
        .eq('id', uploadId)
        .single();
      if (upload) {
        setUploadDate(new Date(upload.uploaded_at).toLocaleDateString());
        setUploadStatus(upload.status);
      }

      const { data } = await supabase
        .from('activities')
        .select('*')
        .eq('upload_id', uploadId)
        .order('needs_review', { ascending: false });

      if (data) setActivities(data);
      setLoading(false);
    }
    load();
  }, [uploadId]);

  // Poll while extraction is running
  useEffect(() => {
    if (uploadStatus !== 'pending' && uploadStatus !== 'extracting') return;
    const interval = setInterval(async () => {
      const { data: upload } = await supabase
        .from('uploads')
        .select('status')
        .eq('id', uploadId)
        .single();
      if (upload) setUploadStatus(upload.status);

      const { data } = await supabase
        .from('activities')
        .select('*')
        .eq('upload_id', uploadId)
        .order('needs_review', { ascending: false });
      if (data) setActivities(data);

      if (upload?.status === 'review' || upload?.status === 'published') {
        clearInterval(interval);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [uploadId, uploadStatus]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function updateField(id: string, field: keyof Activity, value: unknown) {
    setActivities(prev =>
      prev.map(a => (a.id === id ? { ...a, [field]: value, _dirty: true } : a))
    );
  }

  async function saveActivity(id: string) {
    const act = activities.find(a => a.id === id);
    if (!act) return;
    const { _dirty, ...fields } = act;
    void _dirty;
    await supabase.from('activities').update(fields).eq('id', id);
    setActivities(prev => prev.map(a => (a.id === id ? { ...a, _dirty: false } : a)));
  }

  async function markReviewed(id: string) {
    await saveActivity(id);
    await supabase
      .from('activities')
      .update({ needs_review: false })
      .eq('id', id);
    setActivities(prev =>
      prev.map(a => (a.id === id ? { ...a, needs_review: false, _dirty: false } : a))
    );
    showToast('Marked as reviewed');
  }

  async function skipCard(id: string) {
    setActivities(prev => prev.filter(a => a.id !== id));
    showToast('Skipped — card hidden from this session');
  }

  async function publishBoard() {
    setPublishing(true);
    await supabase
      .from('uploads')
      .update({ status: 'published' })
      .eq('id', uploadId);
    showToast('Board published!');
    setTimeout(() => router.push(`/board/${uploadId}`), 1200);
  }

  const needsReviewCount = activities.filter(a => a.needs_review).length;
  const totalCount = activities.length;
  const progressPct = totalCount > 0 ? Math.round(((totalCount - needsReviewCount) / totalCount) * 100) : 100;
  const canPublish = needsReviewCount === 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-500 flex items-center justify-center text-sm">
        Loading…
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-zinc-200 px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-zinc-900">Review Extracted Schedule</h1>
            <p className="text-zinc-500 text-xs mt-0.5">
              {uploadDate} — {needsReviewCount > 0 ? `${needsReviewCount} cards need review` : 'All reviewed'}
            </p>
          </div>
          {(uploadStatus === 'pending' || uploadStatus === 'extracting') && (
            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-1.5 text-yellow-800 text-xs animate-pulse">
              Reading board… cards will appear shortly
            </div>
          )}
          <div className="flex items-center gap-2">
            <a href="/upload"
              className="px-4 py-2 rounded-md text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors">
              + Upload More
            </a>
            <a href="/"
              className="px-4 py-2 rounded-md text-sm bg-white border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors">
              Home
            </a>
            <button
              onClick={publishBoard}
              disabled={!canPublish || publishing}
              className="px-5 py-2 rounded-md font-medium text-sm transition-colors bg-green-600 hover:bg-green-700 text-white disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              {publishing ? 'Publishing…' : 'Publish Board'}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="max-w-4xl mx-auto mt-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-zinc-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              {totalCount - needsReviewCount} of {totalCount} reviewed
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-4">
        {activities.length === 0 && (
          <div className="text-center text-zinc-400 py-16 text-sm">No activities extracted.</div>
        )}

        {activities.map(act => (
          <ActivityCard
            key={act.id}
            activity={act}
            onUpdate={updateField}
            onSave={saveActivity}
            onMarkReviewed={markReviewed}
            onSkip={skipCard}
          />
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-5 py-2 rounded-full text-sm shadow-lg z-50">
          {toast}
        </div>
      )}
    </main>
  );
}

function ActivityCard({
  activity: act,
  onUpdate,
  onSave,
  onMarkReviewed,
  onSkip,
}: {
  activity: ReviewActivity;
  onUpdate: (id: string, field: keyof Activity, value: unknown) => void;
  onSave: (id: string) => void;
  onMarkReviewed: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const tradeColor = TRADE_COLORS[act.trade]?.hex ?? '#888';
  const tradeInfo = TRADE_COLORS[act.trade];

  const inputCls = 'w-full h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600';

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        act.needs_review
          ? 'bg-yellow-50 border-yellow-200 border-l-4 border-l-yellow-400'
          : 'bg-white border-zinc-200 border-l-4 border-l-green-400'
      } ${act._dirty ? 'ring-2 ring-blue-600 ring-offset-1' : ''}`}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {act.needs_review && (
            <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded-full">
              NEEDS REVIEW
            </span>
          )}
          {act.is_milestone && (
            <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full">MILESTONE</span>
          )}
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: tradeColor + '20', color: tradeColor, border: `1px solid ${tradeColor}50` }}
          >
            {tradeInfo?.company ?? act.trade}
          </span>
          <span className="text-xs text-zinc-400">confidence: {(act.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="flex gap-2 shrink-0">
          {act._dirty && (
            <button
              onClick={() => onSave(act.id)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-md text-white font-medium transition-colors"
            >
              Save
            </button>
          )}
          {act.needs_review && (
            <>
              <button
                onClick={() => onMarkReviewed(act.id)}
                className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-md text-white font-medium transition-colors"
              >
                Mark reviewed
              </button>
              <button
                onClick={() => onSkip(act.id)}
                className="text-xs px-3 py-1.5 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md text-zinc-600 transition-colors"
              >
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        {/* Trade */}
        <Field label="Trade">
          <select
            value={act.trade}
            onChange={e => onUpdate(act.id, 'trade', e.target.value)}
            className={inputCls}
          >
            {Object.entries(TRADE_COLORS).map(([key, t]) => (
              <option key={key} value={key}>
                {t.company} — {t.name}
              </option>
            ))}
          </select>
        </Field>

        {/* Area row */}
        <Field label="Area / Level">
          <select
            value={`${act.area}|${act.area_sub ?? ''}`}
            onChange={e => {
              const [area, area_sub] = e.target.value.split('|');
              const row = AREA_ROWS.find(r => r.area === area && (r.area_sub ?? '') === (area_sub ?? ''));
              onUpdate(act.id, 'area', area);
              onUpdate(act.id, 'area_sub', area_sub || null);
              if (row) onUpdate(act.id, 'level', row.level);
            }}
            className={inputCls}
          >
            {AREA_ROWS.map(r => (
              <option key={r.label} value={`${r.area}|${r.area_sub ?? ''}`}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Day / Week */}
        <Field label="Day">
          <select
            value={act.day_key ?? ''}
            onChange={e => onUpdate(act.id, 'day_key', e.target.value || null)}
            className={inputCls}
          >
            <option value="">— weekly board —</option>
            {DAY_KEYS.map(d => (
              <option key={d} value={d}>
                {DAY_LABELS[d]}
              </option>
            ))}
          </select>
        </Field>

        {/* Task name */}
        <Field label="Task name">
          <input
            type="text"
            value={act.task_name}
            onChange={e => onUpdate(act.id, 'task_name', e.target.value)}
            className={inputCls}
          />
        </Field>

        {/* Predecessor */}
        <Field label="Predecessor">
          <input
            type="text"
            value={act.predecessor ?? ''}
            onChange={e => onUpdate(act.id, 'predecessor', e.target.value || null)}
            className={inputCls}
          />
        </Field>

        {/* Crew size */}
        <Field label="Crew size">
          <input
            type="number"
            value={act.crew_size ?? ''}
            onChange={e => onUpdate(act.id, 'crew_size', e.target.value ? parseInt(e.target.value) : null)}
            className={inputCls}
          />
        </Field>

        {/* Duration */}
        <Field label="Duration (days)">
          <input
            type="number"
            value={act.duration_days ?? ''}
            onChange={e => onUpdate(act.id, 'duration_days', e.target.value ? parseInt(e.target.value) : null)}
            className={inputCls}
          />
        </Field>

        {/* Status */}
        <Field label="Status">
          <div className="flex gap-2 h-9">
            {(['green', 'yellow', 'red'] as ActivityStatus[]).map(s => (
              <button
                key={s}
                onClick={() => onUpdate(act.id, 'status', s)}
                className={`flex-1 rounded-md text-xs font-semibold transition-all ${
                  act.status === s ? 'ring-2 ring-offset-1 ring-zinc-400' : 'opacity-50'
                }`}
                style={{
                  background: s === 'green' ? '#16a34a' : s === 'yellow' ? '#ca8a04' : '#dc2626',
                  color: '#fff',
                }}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </Field>

        {/* Milestone toggle */}
        <Field label="Milestone">
          <label className="flex items-center gap-2 cursor-pointer h-9">
            <input
              type="checkbox"
              checked={act.is_milestone}
              onChange={e => onUpdate(act.id, 'is_milestone', e.target.checked)}
              className="accent-purple-600 w-4 h-4"
            />
            <span className="text-zinc-600 text-sm">Is a milestone</span>
          </label>
        </Field>
      </div>

      {/* Constraint text (yellow/red) */}
      {(act.status === 'yellow' || act.status === 'red') && (
        <div className="mt-3">
          <label className="block text-xs text-zinc-500 mb-1">Constraint / blocker note</label>
          <input
            type="text"
            value={act.constraint_text ?? ''}
            onChange={e => onUpdate(act.id, 'constraint_text', e.target.value || null)}
            placeholder="Describe the constraint…"
            className="w-full h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
