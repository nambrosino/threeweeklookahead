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

  const statusColor: Record<string, string> = {
    pending:    'bg-gray-700 text-gray-300',
    extracting: 'bg-yellow-800 text-yellow-200',
    review:     'bg-blue-800 text-blue-200',
    published:  'bg-green-800 text-green-200',
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">DOC Pull Plan</h1>
            <p className="text-gray-400 text-sm">Construction schedule management</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/projects/new"
              className="px-4 py-2 rounded bg-gray-800 border border-gray-600 text-sm text-gray-300 hover:bg-gray-700"
            >
              + New Project
            </Link>
            <Link
              href="/upload"
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white"
            >
              Upload Photos
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : uploads.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-lg font-medium text-gray-400">No boards yet</p>
            <p className="text-sm mt-1">Upload your first pull plan photo to get started</p>
            <Link
              href="/upload"
              className="inline-block mt-4 px-6 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              Upload Photos
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {uploads.map(u => (
              <div
                key={u.id}
                className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-semibold text-white text-sm">
                    {(Array.isArray(u.projects) ? u.projects[0]?.name : u.projects?.name) ?? 'Unknown project'}
                    {u.week_start_date && (
                      <span className="ml-2 text-gray-400 font-normal">
                        — Week of{' '}
                        {new Date(u.week_start_date + 'T00:00:00').toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    Uploaded {new Date(u.uploaded_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor[u.status] ?? 'bg-gray-700 text-gray-300'}`}
                  >
                    {u.status}
                  </span>
                  {u.status === 'review' && (
                    <Link
                      href={`/review/${u.id}`}
                      className="text-xs px-3 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-white"
                    >
                      Review
                    </Link>
                  )}
                  <button
                    onClick={() => handleDelete(u.id)}
                    disabled={deleting === u.id}
                    className="text-xs px-3 py-1 bg-gray-800 hover:bg-red-900 border border-gray-600 hover:border-red-700 rounded text-gray-400 hover:text-red-300 transition-colors"
                  >
                    {deleting === u.id ? '…' : 'Delete'}
                  </button>
                  {u.status === 'published' && (
                    <Link
                      href={`/board/${u.id}`}
                      className="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-white"
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
