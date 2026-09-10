import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Search, Loader2, AlertCircle, X } from 'lucide-react';
import { errorMessage, responseError } from '../lib/apiError';

export interface BoardType {
  code: string;
  name: string;
  description?: string;
  length: number;
  width: number;
  stockType?: string;
}

interface Props {
  env?: string;
  type?: 'sheet' | 'linear' | 'all';
  onSelect: (board: BoardType) => void;
  placeholder?: string;
}

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function BoardTypeSelector({ env, type = 'sheet', onSelect, placeholder = 'Search board type…' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BoardType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Search when query changes or dropdown opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Scope search to the framer's portal (saved by the import dialog)
    const portal = localStorage.getItem('clo-portal-url') ?? '';
    const params = new URLSearchParams({
      q: debouncedQuery,
      type,
      portal: portal.trim(),
    });
    if (env) params.set('env', env);
    const url = `${API_BASE}/api/iframer/boards/search?${params.toString()}`;
    fetch(url)
      .then(async r => {
        if (!r.ok) throw await responseError(r, 'i-framer board API request failed');
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        if (data.boards) {
          setResults(data.boards);
          setSearched(true);
        } else {
          setError(data.error ?? 'Failed to load boards');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, 'Could not reach the i-framer API'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, debouncedQuery, type, env]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSelect = useCallback((board: BoardType) => {
    onSelect(board);
    setOpen(false);
    setQuery('');
  }, [onSelect]);

  return (
    <div ref={ref} className="relative" style={{ minWidth: 200 }}>
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-xs border border-input rounded bg-background text-left text-muted-foreground hover:text-foreground hover:border-blue-400 transition-colors"
      >
        <Search size={11} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{placeholder}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white border border-border rounded shadow-lg flex flex-col max-h-72 overflow-hidden">
          {/* Search input */}
          <div className="p-1.5 border-b border-border flex items-center gap-1">
            <Search size={12} className="text-muted-foreground shrink-0 ml-1" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type code or name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 px-1.5 py-1 text-xs focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
            {loading && <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0 mr-1" />}
          </div>

          {/* Results */}
          <div className="overflow-y-auto flex-1">
            {error ? (
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-amber-600">
                <AlertCircle size={12} />
                <span>{error}</span>
              </div>
            ) : !searched && !loading ? (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">Type to search…</p>
            ) : results.length === 0 && !loading ? (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">No boards found</p>
            ) : (
              results.map(b => (
                <button
                  key={`${b.stockType}:${b.code}`}
                  type="button"
                  onClick={() => handleSelect(b)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-gray-800 truncate">{b.code}</span>
                    {b.name && b.name !== b.code && (
                      <span className="text-gray-400 truncate">{b.name}</span>
                    )}
                  </div>
                  <span className="text-gray-400 shrink-0 whitespace-nowrap text-right">
                    <span className="block">{b.length} × {b.width} mm</span>
                    {b.stockType && (
                      <span className="text-gray-300 capitalize">{b.stockType}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
