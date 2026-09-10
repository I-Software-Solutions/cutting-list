import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import type { BoardRecord } from '@workspace/api-client-react';
import { responseError } from '../lib/apiError';

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

type Board = BoardRecord;

interface BoardForm {
  code: string;
  description: string;
  stock_length: string;
  stock_width: string;
}

interface BoardManagerProps {
  open: boolean;
  onClose: () => void;
}

const emptyForm: BoardForm = {
  code: '',
  description: '',
  stock_length: '',
  stock_width: '',
};

function formFromBoard(board: Board): BoardForm {
  return {
    code: board.code,
    description: board.description ?? '',
    stock_length: board.stock_length?.toString() ?? '',
    stock_width: board.stock_width?.toString() ?? '',
  };
}

export function BoardManager({ open, onClose }: BoardManagerProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [form, setForm] = useState<BoardForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBoards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/boards`);
      if (!res.ok) throw await responseError(res, 'Unable to load boards');
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error('The server returned an invalid board list');
      setBoards(data as Board[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load boards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setEditingId(null);
      setForm(emptyForm);
      void loadBoards();
    }
  }, [open, loadBoards]);

  const updateField = (field: keyof BoardForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const startEditing = (board: Board) => {
    setEditingId(board.id);
    setForm(formFromBoard(board));
    setError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = form.code.trim();
    const length = Number(form.stock_length);
    const width = Number(form.stock_width);

    if (!code) {
      setError('Enter a board code.');
      return;
    }
    if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(width) || width <= 0) {
      setError('Stock length and width must be whole numbers greater than 0.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/boards${editingId === null ? '' : `/${editingId}`}`,
        {
          method: editingId === null ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            description: form.description.trim() || null,
            stock_length: length,
            stock_width: width,
          }),
        },
      );
      if (!res.ok) throw await responseError(res, editingId === null ? 'Unable to add board' : 'Unable to update board');
      const saved: Board = await res.json();
      setBoards(current => {
        const next = editingId === null
          ? [...current, saved]
          : current.map(board => board.id === saved.id ? saved : board);
        return next.sort((a, b) => a.code.localeCompare(b.code));
      });
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save board');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (board: Board) => {
    if (!window.confirm(`Delete board "${board.code}"?`)) return;
    setDeletingId(board.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/boards/${board.id}`, { method: 'DELETE' });
      if (!res.ok) throw await responseError(res, 'Unable to delete board');
      setBoards(current => current.filter(item => item.id !== board.id));
      if (editingId === board.id) cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete board');
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="boards-title">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-accent px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-primary" />
            <div>
              <h2 id="boards-title" className="font-semibold">Boards</h2>
              <p className="text-xs text-muted-foreground">Manage material stock sizes used by imports</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close boards">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <form onSubmit={handleSubmit} className="mb-5 rounded border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">{editingId === null ? 'Add a board' : 'Edit board'}</h3>
              {editingId !== null && (
                <button type="button" onClick={cancelEditing} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel edit
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-medium">
                Code
                <input autoFocus={editingId === null} value={form.code} onChange={event => updateField('code', event.target.value)} placeholder="e.g. 3mm MDF" className="mt-1 cell-input rounded border border-input bg-background" />
              </label>
              <label className="text-xs font-medium">
                Description
                <input value={form.description} onChange={event => updateField('description', event.target.value)} placeholder="Optional" className="mt-1 cell-input rounded border border-input bg-background" />
              </label>
              <label className="text-xs font-medium">
                Stock length <span className="font-normal text-muted-foreground">(mm)</span>
                <input type="number" min="1" step="1" value={form.stock_length} onChange={event => updateField('stock_length', event.target.value)} placeholder="2440" className="mt-1 cell-input rounded border border-input bg-background" />
              </label>
              <label className="text-xs font-medium">
                Stock width <span className="font-normal text-muted-foreground">(mm)</span>
                <input type="number" min="1" step="1" value={form.stock_width} onChange={event => updateField('stock_width', event.target.value)} placeholder="1220" className="mt-1 cell-input rounded border border-input bg-background" />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button type="submit" disabled={saving} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : editingId === null ? <Plus size={14} /> : <Save size={14} />}
                {saving ? 'Saving…' : editingId === null ? 'Add board' : 'Save changes'}
              </button>
            </div>
          </form>

          {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Saved boards <span className="font-normal text-muted-foreground">({boards.length})</span></h3>
            <button type="button" onClick={() => void loadBoards()} disabled={loading} className="btn-secondary text-xs disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 size={16} className="mr-2 animate-spin" /> Loading boards…</div>
          ) : boards.length === 0 ? (
            <div className="rounded border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No boards saved yet. Add your first stock size above.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Stock length</th>
                    <th>Stock width</th>
                    <th className="w-24 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {boards.map(board => (
                    <tr key={board.id}>
                      <td className="px-2 py-2 font-medium">{board.code}</td>
                      <td className="px-2 py-2 text-muted-foreground">{board.description || '—'}</td>
                      <td className="px-2 py-2">{board.stock_length ? `${board.stock_length} mm` : '—'}</td>
                      <td className="px-2 py-2">{board.stock_width ? `${board.stock_width} mm` : '—'}</td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => startEditing(board)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${board.code}`} title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => void handleDelete(board)} disabled={deletingId === board.id} className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={`Delete ${board.code}`} title="Delete">
                            {deletingId === board.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}