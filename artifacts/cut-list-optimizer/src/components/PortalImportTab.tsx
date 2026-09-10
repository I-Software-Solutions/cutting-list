import { useState, useCallback } from 'react';
import { Globe, Loader2, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { CutPiece, StockItem, Mode } from '../types';
import { checkPreviewRow } from '../lib/oversizeCheck';

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const PORTAL_KEY = 'clo-portal-url';

interface PortalPiece {
  kind: string;
  code: string;
  name: string;
  width: number;
  length: number;
}

interface PortalJob {
  jobId: string;
  saleNumber: string;
  saleDate: string | null;
  description: string;
  artworkWidth: number;
  artworkHeight: number;
  artworkUnit: string;
  copies: number;
  pieces: PortalPiece[];
}

interface Props {
  mode: Mode;
  onConfirm: (pieces: CutPiece[], stockItems: StockItem[]) => void;
  onCancel: () => void;
}

export function PortalImportTab({ onConfirm, onCancel }: Props) {
  const [portal, setPortal] = useState(() => localStorage.getItem(PORTAL_KEY) ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [framerName, setFramerName] = useState<string | null>(null);
  const [jobs, setJobs] = useState<PortalJob[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Per the i-framer cutting list report: mouldings are linear cuts;
  // backings and glass are sheet cuts (matboards not needed here).
  // Everything is imported at once — the "Cutting list item" dropdown
  // in the main view is used to work on one item at a time.
  const wantedKinds = new Set(['backing', 'glass', 'moulding']);

  const handleFetch = useCallback(async () => {
    if (!portal.trim()) return;
    localStorage.setItem(PORTAL_KEY, portal.trim());
    setLoading(true);
    setError(null);
    setJobs(null);
    try {
      const res = await fetch(`${API_BASE}/api/iframer/cutting-list?portal=${encodeURIComponent(portal.trim())}&env=dev`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setFramerName(data.framer?.name ?? null);
      setJobs(data.jobs ?? []);
      setSelected(new Set((data.jobs ?? []).map((j: PortalJob) => j.jobId)));
    } catch {
      setError('Could not reach API');
    } finally {
      setLoading(false);
    }
  }, [portal]);

  const toggleJob = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const relevantPieceCount = (j: PortalJob) => j.pieces.filter(p => wantedKinds.has(p.kind)).length;

  // Preview-time sanity check for piece dimensions coming from the portal.
  // Stock sizes are only looked up during import, so only the ceiling applies.
  const pieceWarning = (p: PortalPiece): string | null => checkPreviewRow(p.length, p.width, null);
  const jobHasWarning = (j: PortalJob) => j.pieces.some(p => wantedKinds.has(p.kind) && pieceWarning(p) !== null);
  const flaggedJobCount = (jobs ?? []).filter(jobHasWarning).length;
  const selectedJobs = (jobs ?? []).filter(j => selected.has(j.jobId) && relevantPieceCount(j) > 0);
  const totalPieces = selectedJobs.reduce((n, j) => n + relevantPieceCount(j), 0);

  const handleImport = useCallback(async () => {
    if (selectedJobs.length === 0) return;
    setImporting(true);

    const pieces: CutPiece[] = [];
    // material code -> stock search type ('sheet' | 'linear')
    const materialCodes = new Map<string, string>();

    for (const j of selectedJobs) {
      const copies = j.copies || 1;
      const label = j.saleNumber + (j.description ? ` ${j.description}` : '');
      for (const p of j.pieces) {
        if (!wantedKinds.has(p.kind)) continue;
        if (p.code) materialCodes.set(p.code, p.kind === 'moulding' ? 'linear' : 'sheet');

        if (p.kind !== 'moulding') {
          pieces.push({
            id: crypto.randomUUID(),
            length: String(p.length),
            width: String(p.width),
            qty: String(copies),
            label,
            material: p.code,
            grain: false,
          });
        } else {
          // A moulding/frame piece needs 2 bars of each dimension per copy
          if (p.length === p.width) {
            pieces.push({
              id: crypto.randomUUID(),
              length: String(p.length),
              width: '',
              qty: String(copies * 4),
              label,
              material: p.code,
              grain: false,
            });
          } else {
            for (const dim of [p.length, p.width]) {
              pieces.push({
                id: crypto.randomUUID(),
                length: String(dim),
                width: '',
                qty: String(copies * 2),
                label,
                material: p.code,
                grain: false,
              });
            }
          }
        }
      }
    }

    // Look up stock sheet/bar sizes for each material from i-framer
    const stockItems: StockItem[] = [];
    for (const [code, stockKind] of materialCodes) {
      let length = '', width = '', qty = '1';
      try {
        const res = await fetch(`${API_BASE}/api/iframer/boards/search?q=${encodeURIComponent(code)}&type=${stockKind}&env=dev&portal=${encodeURIComponent(portal.trim())}`);
        const data = await res.json();
        const exact = (data.boards ?? []).find((b: any) => b.code.toLowerCase() === code.toLowerCase());
        if (exact) {
          if (stockKind === 'linear') {
            // Mouldings: `length` is the item's standard bar length (mm),
            // `stock` is whole bars on hand, `stockLengthMm` is total length
            // on hand. Many framers only track total metres, so fall back to
            // the standard 3 m bar length.
            const DEFAULT_BAR_MM = 3000;
            const stockLen = typeof exact.stockLengthMm === 'number' ? exact.stockLengthMm : 0;
            if (exact.length > 0) {
              length = String(exact.length);
              if (typeof exact.stock === 'number' && exact.stock > 0) {
                qty = String(exact.stock);
              }
            } else if (stockLen >= DEFAULT_BAR_MM) {
              length = String(DEFAULT_BAR_MM);
              qty = String(Math.floor(stockLen / DEFAULT_BAR_MM));
            } else if (stockLen > 0) {
              length = String(stockLen);
              qty = '1';
            } else {
              // No bar length or stock tracked in i-framer — assume plenty of
              // standard bars so Calculate reports how many are actually needed
              length = String(DEFAULT_BAR_MM);
              qty = '100';
            }
            width = '';
          } else {
            length = String(exact.length);
            width = String(exact.width);
            // Use the item's stock-on-hand from i-framer when the framer tracks it
            if (typeof exact.stock === 'number' && exact.stock > 0) {
              qty = String(Math.max(1, Math.floor(exact.stock)));
            }
          }
        }
      } catch { /* leave blank — user fills in */ }
      stockItems.push({ id: crypto.randomUUID(), length, width, qty, material: code });
    }

    setImporting(false);
    onConfirm(pieces, stockItems);
  }, [selectedJobs, wantedKinds, portal, onConfirm]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Portal input */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Framer portal URL or name</label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 px-2 py-1.5 border border-gray-300 rounded focus-within:ring-1 focus-within:ring-blue-400">
              <Globe size={13} className="text-gray-400 shrink-0" />
              <input
                type="text"
                className="flex-1 text-xs focus:outline-none"
                placeholder="thepictureframer.dev.i-framer.com"
                value={portal}
                onChange={e => setPortal(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFetch()}
              />
            </div>
            <button
              onClick={handleFetch}
              disabled={loading || !portal.trim()}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : 'Fetch cutting list'}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {jobs !== null && !error && (
          <>
            <div className="flex items-center gap-2 text-xs text-green-700">
              <CheckCircle2 size={13} />
              <span>
                {framerName} — {jobs.length} pending job{jobs.length !== 1 ? 's' : ''} on the cutting list
              </span>
            </div>

            {flaggedJobCount > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  {flaggedJobCount} job{flaggedJobCount !== 1 ? 's have' : ' has'} piece dimensions that look wrong
                  (highlighted below). Untick those jobs to skip them, or import anyway and fix the sizes afterwards.
                </span>
              </div>
            )}

            {jobs.length > 0 && (
              <div className="border border-gray-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-2 py-1.5 w-8">
                        <input
                          type="checkbox"
                          checked={selected.size === jobs.length}
                          onChange={e => setSelected(e.target.checked ? new Set(jobs.map(j => j.jobId)) : new Set())}
                        />
                      </th>
                      <th className="px-2 py-1.5 text-left font-medium">Sale</th>
                      <th className="px-2 py-1.5 text-left font-medium">Description</th>
                      <th className="px-2 py-1.5 text-left font-medium">Artwork</th>
                      <th className="px-2 py-1.5 text-left font-medium">Copies</th>
                      <th className="px-2 py-1.5 text-left font-medium">Pieces</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {jobs.map(j => {
                      const n = relevantPieceCount(j);
                      const flagged = jobHasWarning(j);
                      return (
                        <tr
                          key={j.jobId}
                          className={`cursor-pointer ${n === 0 ? 'opacity-40' : ''} ${flagged ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}
                          onClick={() => n > 0 && toggleJob(j.jobId)}
                        >
                          <td className="px-2 py-1 text-center">
                            <input type="checkbox" disabled={n === 0} checked={selected.has(j.jobId) && n > 0} readOnly />
                          </td>
                          <td className="px-2 py-1 font-mono text-gray-800 whitespace-nowrap">{j.saleNumber}</td>
                          <td className="px-2 py-1 text-gray-600 max-w-[160px] truncate">{j.description || <span className="italic text-gray-300">—</span>}</td>
                          <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{j.artworkWidth}×{j.artworkHeight} {j.artworkUnit}</td>
                          <td className="px-2 py-1 text-gray-600">{j.copies}</td>
                          <td className="px-2 py-1 text-gray-500">
                            {n === 0
                              ? <span className="italic">no cuttable pieces</span>
                              : j.pieces.filter(p => wantedKinds.has(p.kind)).map((p, i) => {
                                  const warning = pieceWarning(p);
                                  return (
                                    <span
                                      key={i}
                                      className={`inline-block mr-2 whitespace-nowrap ${warning ? 'text-amber-800 font-semibold' : ''}`}
                                      title={warning ?? undefined}
                                    >
                                      <span className="font-mono">{p.code}</span> {p.length}×{p.width}
                                      {warning && <AlertTriangle size={12} className="text-amber-500 inline-block ml-1 align-text-bottom" />}
                                    </span>
                                  );
                                })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 shrink-0">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleImport}
          disabled={totalPieces === 0 || importing}
          className="px-4 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {importing ? 'Looking up stock…' : `Import ${totalPieces} piece${totalPieces !== 1 ? 's' : ''} from ${selectedJobs.length} job${selectedJobs.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
