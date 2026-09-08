import { useState, useEffect, useCallback } from 'react';
import { Folder, Trash2, Download, Loader2, Save, X, Check, RefreshCw } from 'lucide-react';
import { errorMessage, responseError } from '@/lib/apiError';

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

export interface SavedJobSummary {
  id: number;
  name: string;
  mode: string;
  units: string;
  created_at: string;
  updated_at: string;
}

export interface SavedJobFull extends SavedJobSummary {
  pieces: unknown[];
  stock: unknown[];
  options: Record<string, unknown>;
}

interface SavedJobsPanelProps {
  onLoad: (job: SavedJobFull) => void;
  currentName: string | null;
  onSave: (name: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  hasCurrentJob: boolean;
  savedId: number | null;
}

export function SavedJobsPanel({
  onLoad,
  currentName,
  onSave,
  onUpdate,
  hasCurrentJob,
  savedId,
}: SavedJobsPanelProps) {
  const [jobs, setJobs] = useState<SavedJobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/cut-lists`);
      if (!res.ok) throw await responseError(res, 'Saved-jobs API request failed');
      const data: SavedJobSummary[] = await res.json();
      if (!Array.isArray(data)) {
        throw new Error('Saved-jobs API returned an unexpected response');
      }
      setJobs(data.slice().reverse());
    } catch (err) {
      setLoadError(
        `${errorMessage(err, 'Could not reach the saved-jobs API')}. Check the API/database connection, then retry.`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name);
      setSaveName('');
      setShowSaveInput(false);
      await fetchJobs();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save job'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      await onUpdate();
      await fetchJobs();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update job'));
    } finally {
      setUpdating(false);
    }
  };

  const handleLoad = async (job: SavedJobSummary) => {
    setLoadingId(job.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/cut-lists/${job.id}`);
      if (!res.ok) throw await responseError(res, 'Failed to load job');
      const full: SavedJobFull = await res.json();
      onLoad(full);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load job'));
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/cut-lists/${id}`, { method: 'DELETE' });
      if (!res.ok) throw await responseError(res, 'Failed to delete job');
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete job'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Save controls */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        {currentName && savedId !== null ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground flex-1 truncate">
              <span className="font-medium text-foreground">{currentName}</span>
            </span>
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded transition-colors disabled:opacity-50"
            >
              {updating ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Update
            </button>
            <button
              onClick={() => setShowSaveInput(true)}
              className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors"
            >
              Save as…
            </button>
          </div>
        ) : showSaveInput ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              autoFocus
              placeholder="Job name or order ref…"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveName(''); } }}
              className="flex-1 text-xs px-2 py-1.5 border border-input rounded bg-background min-w-0"
            />
            <button
              onClick={handleSave}
              disabled={saving || !saveName.trim()}
              className="flex items-center gap-1 text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            </button>
            <button
              onClick={() => { setShowSaveInput(false); setSaveName(''); }}
              className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1.5 rounded transition-colors"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { if (hasCurrentJob) setShowSaveInput(true); }}
            disabled={!hasCurrentJob}
            className="w-full flex items-center justify-center gap-1.5 text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save size={11} />
            Save current job…
          </button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading…
          </div>
        ) : loadError ? (
          <div className="px-3 py-6 text-center" role="alert">
            <p className="text-xs text-red-600">{loadError}</p>
            <button
              type="button"
              onClick={fetchJobs}
              className="mt-3 inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            <Folder size={24} className="mx-auto mb-2 opacity-40" />
            No saved jobs yet
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {jobs.map(job => (
              <li
                key={job.id}
                className={`px-3 py-2 flex items-start gap-2 hover:bg-muted/50 transition-colors group ${savedId === job.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${savedId === job.id ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    {job.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {job.mode === 'sheet' ? 'Sheets (2D)' : 'Linear (1D)'} · {job.units === 'metric' ? 'mm' : 'in'} · {formatDate(job.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleLoad(job)}
                    disabled={loadingId === job.id}
                    title="Load this job"
                    className="p-1 rounded text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors disabled:opacity-50"
                  >
                    {loadingId === job.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  </button>
                  <button
                    onClick={() => handleDelete(job.id)}
                    disabled={deletingId === job.id}
                    title="Delete this job"
                    className="p-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-900 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {deletingId === job.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
