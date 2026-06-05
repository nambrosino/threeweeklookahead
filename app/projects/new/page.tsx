'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('projects')
      .insert({ name: name.trim() });
    if (err) {
      setError(err.message);
      setSaving(false);
    } else {
      router.push('/upload');
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">New Project</h1>
          <p className="text-zinc-500 text-sm mt-1">Create a project to organize your pull plan uploads.</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Project name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Woonsocket Residence Inn"
              className="w-full h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              autoFocus
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 disabled:text-zinc-400 font-medium text-sm text-white transition-colors"
          >
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </main>
  );
}
