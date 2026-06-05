'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

async function deleteUpload(id: string) {
  await supabase.from('activities').delete().eq('upload_id', id);
  await supabase.from('uploads').delete().eq('id', id);
}

interface Upload {
  id: string;
  week_start_date: string | null;
  uploaded_at: string;
  status: string;
  project_id: string;
  projects: { name: string } | { name: string }[] | null;
}

export default function Home() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Delete this upload and all its activities? This cannot be undone.')) return;
    setDeleting(id);
    await deleteUpload(id);
    setUploads(prev => prev.filter(u => u.id !== id));
    setDeleting(null);
  }

  useEffect(() => {
    supabase
      .from('uploads')
      .select('id, week_start_date, uploaded_at, status, project_id, projects(name)')
      .order('uploaded_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setUploads(data as Upload[]);
        setLoading(false);
      });
  }, []);

  const statusBadge: Record<string, string> = {
    pending:    'bg-zinc-100 text-zinc-600',
    extracting: 'bg-yellow-100 text-yellow-800',
    review:     'bg-blue-100 text-blue-700',
    published:  'bg-green-100 text-green-700',
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">DOC Pull Plan</h1>
            <p className="text-zinc-500 text-sm mt-0.5">Construction schedule management</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/projects/new"
              className="px-4 py-2 rounded-md bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50 text-sm font-medium transition-colors"
            >
              + New Project
            </Link>
            <Link
              href="/upload"
              className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-sm font-medium text-white transition-colors"
            >
              Upload Photos
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : uploads.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-100 mb-4">
              <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-zinc-700">No boards yet</p>
            <p className="text-sm text-zinc-500 mt-1">Upload your first pull plan photo to get started</p>
            <Link
              href="/upload"
              className="inline-block mt-5 px-6 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Upload Photos
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {uploads.map(u => (
              <div
                key={u.id}
                className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-semibold text-zinc-900 text-sm">
                    {(Array.isArray(u.projects) ? u.projects[0]?.name : u.projects?.name) ?? 'Unknown project'}
                    {u.week_start_date && (
                      <span className="ml-2 text-zinc-500 font-normal">
                        — Week of{' '}
                        {new Date(u.week_start_date + 'T00:00:00').toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-400 text-xs mt-0.5">
                    Uploaded {new Date(u.uploaded_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${statusBadge[u.status] ?? 'bg-zinc-100 text-zinc-600'}`}
                  >
                    {u.status}
                  </span>
                  {u.status === 'review' && (
                    <Link
                      href={`/review/${u.id}`}
                      className="text-xs px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 rounded-md text-white font-medium transition-colors"
                    >
                      Review
                    </Link>
                  )}
                  <button
                    onClick={() => handleDelete(u.id)}
                    disabled={deleting === u.id}
                    className="text-xs px-3 py-1.5 text-red-600 hover:bg-red-50 border border-red-200 rounded-md transition-colors"
                  >
                    {deleting === u.id ? '…' : 'Delete'}
                  </button>
                  {u.status === 'published' && (
                    <Link
                      href={`/board/${u.id}`}
                      className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-md text-white font-medium transition-colors"
                    >
                      View Board
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
