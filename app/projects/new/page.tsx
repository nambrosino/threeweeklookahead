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
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-6">New Project</h1>
        <label className="block text-sm text-gray-300 mb-1">Project name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="e.g. Woonsocket Residence Inn"
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white mb-4"
          autoFocus
        />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={!name.trim() || saving}
          className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 font-semibold"
        >
          {saving ? 'Creating…' : 'Create Project'}
        </button>
      </div>
    </main>
  );
}
