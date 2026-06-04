'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const DEFAULT_PROJECT_ID = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_ID || '';

type PhotoType = 'legend' | 'board';

interface FilePreview {
  file: File;
  preview: string;
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [photoType, setPhotoType] = useState<PhotoType>('board');
  const [weekStartDate, setWeekStartDate] = useState('');
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [hasLegend, setHasLegend] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, name')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          setProjects(data);
          if (data.length > 0 && !projectId) setProjectId(data[0].id);
        }
      });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    supabase
      .from('trade_legends')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)
      .then(({ data }) => setHasLegend(!!data && data.length > 0));
  }, [projectId]);

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(f => f.type.startsWith('image/'));
    const previews = valid.map(f => ({ file: f, preview: URL.createObjectURL(f) }));
    setFiles(prev => [...prev, ...previews]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  const removeFile = (idx: number) => {
    setFiles(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const canExtract =
    files.length > 0 &&
    projectId &&
    (photoType === 'legend' || hasLegend) &&
    (photoType === 'legend' || weekStartDate);

  async function handleExtract() {
    if (!canExtract) return;
    setError('');
    setUploading(true);

    try {
      // Upload files to Supabase Storage
      const urls: string[] = [];
      for (const fp of files) {
        const ext = fp.file.name.split('.').pop() ?? 'jpg';
        const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        console.log('Uploading to storage:', path);
        const { error: uploadErr, data: uploadData } = await supabase.storage
          .from('pullplan-photos')
          .upload(path, fp.file, { upsert: true });
        console.log('Storage result:', uploadData, uploadErr);
        if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);
        const { data: urlData } = supabase.storage
          .from('pullplan-photos')
          .getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }

      if (photoType === 'legend') {
        // Fire-and-forget legend extraction directly from the client using the public URLs
        fetch('/api/extract-legend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, photoUrls: urls }),
        }).catch(console.error);

        setUploading(false);
        setHasLegend(true);
        setFiles([]);
        setPhotoType('board');
        setError('');
        alert('Legend uploaded! Now upload your board photos.');
        return;
      }

      // Board photos — create upload record then redirect immediately
      const { data: upload, error: insertErr } = await supabase
        .from('uploads')
        .insert({
          project_id: projectId,
          photo_urls: urls,
          week_start_date: weekStartDate || null,
          board_format: 'daily',
          status: 'pending',
        })
        .select()
        .single();

      if (insertErr || !upload) throw insertErr ?? new Error('Failed to create upload');

      // Fire extraction without awaiting — review page will poll for status
      fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: upload.id, projectId }),
      }).catch(console.error);

      setUploading(false);
      router.push(`/review/${upload.id}`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setUploading(false);
      setExtracting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1 text-white">Upload Pull Plan Photos</h1>
        <p className="text-gray-400 mb-8 text-sm">
          Upload legend first, then board photos each week.
        </p>

        {/* Project selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-1">Project</label>
          {projects.length === 0 ? (
            <p className="text-yellow-400 text-sm">
              No projects found.{' '}
              <a href="/projects/new" className="underline">
                Create one first.
              </a>
            </p>
          ) : (
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Photo type */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">Photo type</label>
          <div className="flex gap-4">
            {(['legend', 'board'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="photoType"
                  value={t}
                  checked={photoType === t}
                  onChange={() => setPhotoType(t)}
                  className="accent-blue-500"
                />
                <span className="text-sm capitalize">
                  {t === 'legend' ? 'This is the legend photo' : 'These are week board photos'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Week start date (board only) */}
        {photoType === 'board' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Week start date
            </label>
            <input
              type="date"
              value={weekStartDate}
              onChange={e => setWeekStartDate(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>
        )}

        {/* Legend warning */}
        {photoType === 'board' && projectId && !hasLegend && (
          <div className="mb-6 bg-yellow-900/40 border border-yellow-600 rounded p-3 text-yellow-300 text-sm">
            Upload the legend photo first so we can identify trade colors correctly.
          </div>
        )}

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-600 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500 transition-colors mb-4"
        >
          <div className="text-4xl mb-3">📷</div>
          <p className="text-gray-300 font-medium">
            Drag &amp; drop photos here, or tap to select
          </p>
          <p className="text-gray-500 text-sm mt-1">JPG, PNG — multiple files OK</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => addFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        {/* Thumbnails */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6">
            {files.map((fp, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fp.preview}
                  alt={fp.file.name}
                  className="w-24 h-24 object-cover rounded-lg border border-gray-600"
                />
                <button
                  onClick={() => removeFile(i)}
                  className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-900/40 border border-red-600 rounded p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleExtract}
          disabled={!canExtract || uploading || extracting}
          className="w-full py-3 rounded-lg font-semibold text-white transition-colors
            bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
        >
          {uploading
            ? 'Uploading photos...'
            : extracting
            ? '🔍 Reading board...'
            : 'Extract Schedule'}
        </button>

        {extracting && (
          <div className="mt-4 text-center text-gray-400 text-sm animate-pulse">
            Claude is reading your pull plan board. This takes 15–30 seconds per photo…
          </div>
        )}
      </div>
    </main>
  );
}
