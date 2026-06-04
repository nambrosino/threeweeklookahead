'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TRADE_COLOR_MAP_PROMPT, TRADE_COLORS } from '@/lib/constants';
import { extractLegendFromFile, extractBoardFromFile } from '@/lib/extract-client';

type PhotoType = 'legend' | 'board';

interface FilePreview { file: File; preview: string; }

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projectId, setProjectId] = useState('');
  const [photoType, setPhotoType] = useState<PhotoType>('board');
  const [weekStartDate, setWeekStartDate] = useState('');
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [hasLegend, setHasLegend] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('projects').select('id, name').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) { setProjects(data); if (data.length > 0) setProjectId(data[0].id); }
      });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    supabase.from('trade_legends').select('id').eq('project_id', projectId).limit(1)
      .then(({ data }) => setHasLegend(!!data && data.length > 0));
  }, [projectId]);

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(f => f.type.startsWith('image/'));
    setFiles(prev => [...prev, ...valid.map(f => ({ file: f, preview: URL.createObjectURL(f) }))]);
  }, []);

  const removeFile = (idx: number) => {
    setFiles(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx); });
  };

  const canSubmit = files.length > 0 && projectId &&
    (photoType === 'legend' || hasLegend) &&
    (photoType === 'legend' || weekStartDate);

  async function handleSubmit() {
    if (!canSubmit || busy) return;
    setError(''); setBusy(true);

    try {
      if (photoType === 'legend') {
        setStatus('Uploading photo...');
        // Upload to storage first
        const file = files[0];
        const path = `${projectId}/${Date.now()}-legend.jpg`;
        const { error: upErr } = await supabase.storage.from('pullplan-photos').upload(path, file.file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('pullplan-photos').getPublicUrl(path);

        setStatus('Reading legend colors...');
        const trades = await extractLegendFromFile(file.file, projectId);

        if (trades.length > 0) {
          await supabase.from('trade_legends').delete().eq('project_id', projectId);
          await supabase.from('trade_legends').insert(
            trades.map(t => ({ project_id: projectId, color_hex: t.color_hex, trade_key: t.trade_key, company_name: t.company_name }))
          );
          setHasLegend(true);
        }

        setStatus('');
        setBusy(false);
        setFiles([]);
        setPhotoType('board');
        alert(`Legend saved! Found ${trades.length} trades. Now upload your board photos.`);
        return;
      }

      // Board photos
      setStatus('Uploading photos...');
      const urls: string[] = [];
      for (const fp of files) {
        const ext = fp.file.name.split('.').pop() ?? 'jpg';
        const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('pullplan-photos').upload(path, fp.file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('pullplan-photos').getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }

      // Create upload record
      const { data: upload, error: insertErr } = await supabase.from('uploads').insert({
        project_id: projectId,
        photo_urls: urls,
        week_start_date: weekStartDate || null,
        board_format: 'daily',
        status: 'extracting',
      }).select().single();
      if (insertErr || !upload) throw insertErr ?? new Error('Failed to create upload');

      // Load trade legend for color map
      const { data: legendRows } = await supabase.from('trade_legends').select('*').eq('project_id', projectId);
      let colorMapString = TRADE_COLOR_MAP_PROMPT;
      if (legendRows && legendRows.length > 0) {
        colorMapString = `TRADE COLOR MAP FOR THIS PROJECT:\n${legendRows.map(
          (l: { color_hex: string; trade_key: string; company_name: string }) => `- ${l.color_hex}: ${l.trade_key} — ${l.company_name}`
        ).join('\n')}`;
      }

      // Extract each photo client-side
      const allActivities: object[] = [];
      for (let i = 0; i < files.length; i++) {
        setStatus(`Reading board photo ${i + 1} of ${files.length}...`);
        try {
          const extracted = await extractBoardFromFile(files[i].file, colorMapString);
          for (const act of extracted.activities as Array<Record<string, unknown>>) {
            const needsReview = (act.confidence as number) < 0.8 || act.crew_size === null || act.duration_days === null;
            allActivities.push({
              upload_id: upload.id, project_id: projectId,
              area: act.area, area_sub: act.area_sub ?? null, level: act.level ?? 0,
              day_key: act.day_key ?? null, week_of: act.week_of ?? null,
              trade: act.trade, task_name: act.task_name,
              predecessor: act.predecessor ?? null, crew_size: act.crew_size ?? null,
              duration_days: act.duration_days ?? null, duration_text: act.duration_text ?? null,
              is_milestone: act.is_milestone ?? false, is_starred: false,
              status: 'green', constraint_text: null,
              confidence: act.confidence ?? 1.0, needs_review: needsReview,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          allActivities.push({
            upload_id: upload.id, project_id: projectId,
            area: 'A', area_sub: null, level: 0, day_key: null, week_of: null,
            trade: 'doc', task_name: `[Extraction failed: ${msg.substring(0, 60)}]`,
            predecessor: null, crew_size: null, duration_days: null, duration_text: null,
            is_milestone: false, is_starred: false, status: 'green', constraint_text: null,
            confidence: 0, needs_review: true,
          });
        }
      }

      setStatus('Saving cards...');
      if (allActivities.length > 0) await supabase.from('activities').insert(allActivities);
      await supabase.from('uploads').update({ status: 'review' }).eq('id', upload.id);

      router.push(`/review/${upload.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setBusy(false);
      setStatus('');
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1 text-white">Upload Pull Plan Photos</h1>
        <p className="text-gray-400 mb-8 text-sm">Upload legend first, then board photos each week.</p>

        {/* Project */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-1">Project</label>
          {projects.length === 0 ? (
            <p className="text-yellow-400 text-sm">No projects found. <a href="/projects/new" className="underline">Create one first.</a></p>
          ) : (
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white">
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        {/* Photo type */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Photo type</label>
          <div className="flex gap-4">
            {(['legend', 'board'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="photoType" value={t} checked={photoType === t}
                  onChange={() => setPhotoType(t)} className="accent-blue-500" />
                <span className="text-sm">{t === 'legend' ? 'This is the legend photo' : 'These are week board photos'}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Week start date */}
        {photoType === 'board' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-1">Week start date</label>
            <input type="date" value={weekStartDate} onChange={e => setWeekStartDate(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white" />
          </div>
        )}

        {/* Legend warning */}
        {photoType === 'board' && projectId && !hasLegend && (
          <div className="mb-6 bg-yellow-900/40 border border-yellow-600 rounded p-3 text-yellow-300 text-sm">
            Upload the legend photo first so we can identify trade colors correctly.
          </div>
        )}

        {/* Drop zone */}
        <div onClick={() => fileInputRef.current?.click()}
          onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-gray-600 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500 transition-colors mb-4">
          <div className="text-4xl mb-3">📷</div>
          <p className="text-gray-300 font-medium">Drag &amp; drop photos here, or tap to select</p>
          <p className="text-gray-500 text-sm mt-1">JPG, PNG — multiple files OK</p>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => addFiles(Array.from(e.target.files ?? []))} />
        </div>

        {/* Thumbnails */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6">
            {files.map((fp, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fp.preview} alt="" className="w-24 h-24 object-cover rounded-lg border border-gray-600" />
                <button onClick={() => removeFile(i)}
                  className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">×</button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="mb-4 bg-red-900/40 border border-red-600 rounded p-3 text-red-300 text-sm">{error}</div>}

        <button onClick={handleSubmit} disabled={!canSubmit || busy}
          className="w-full py-3 rounded-lg font-semibold text-white transition-colors bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed">
          {busy ? (status || 'Working...') : 'Extract Schedule'}
        </button>

        {busy && (
          <div className="mt-4 text-center text-gray-400 text-sm animate-pulse">{status}</div>
        )}
      </div>
    </main>
  );
}
