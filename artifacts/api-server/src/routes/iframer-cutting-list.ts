import { Router, type IRouter } from "express";
import { getPool, isConfigured, resolveEnv, type IframerEnv } from "../lib/iframerDb.js";

const router: IRouter = Router();

const M_TO_MM = 1000;

function resolveEnvParam(req: any): IframerEnv {
  const e = req.query.env as string | undefined;
  if (e === "prod" || e === "beta" || e === "dev") return e;
  return resolveEnv(
    req.query.serverType as string,
    (req.query.portalUrl ?? req.query.portal) as string | undefined,
  );
}

/** Extract portal slug from a full URL or bare slug.
 *  "thepictureframer.dev.i-framer.com" → "thepictureframer"
 *  "https://thepictureframer.i-framer.com/x" → "thepictureframer"
 *  "thepictureframer" → "thepictureframer"
 */
function extractSlug(portal: string): string {
  let p = portal.trim().toLowerCase();
  try {
    if (p.includes("://")) p = new URL(p).hostname;
  } catch { /* keep as-is */ }
  const idx = p.indexOf(".");
  return idx === -1 ? p : p.slice(0, idx);
}

/**
 * GET /api/iframer/cutting-list?portal=thepictureframer.dev.i-framer.com&env=dev
 *
 * Mirrors the i-framer cutting list report:
 *  - resolves framer by slug
 *  - sales must be orders (SaleType=1) or invoices (SaleType=2) — quotes (0) excluded
 *  - jobs must be uncompleted AND uncollected
 *  - returns per-job component lines broken down by item type
 *    (moulding = linear; matboard / backing / glass = sheet), dimensions in mm
 */
router.get("/iframer/cutting-list", async (req, res) => {
  const env = resolveEnvParam(req);
  const portal = (req.query.portal as string) ?? "";

  if (!portal.trim()) {
    res.status(400).json({ error: "Missing ?portal= (slug or portal URL)" });
    return;
  }
  if (!isConfigured(env)) {
    res.status(503).json({ error: `i-framer ${env} database not configured` });
    return;
  }

  const slug = extractSlug(portal);

  try {
    const pool = getPool(env);

    // 1. Resolve the framer
    const [framers] = await pool.query<any[]>(
      "SELECT ID, Slug, Name FROM framer WHERE LOWER(Slug) = ? AND Deleted = 0 LIMIT 1",
      [slug],
    );
    if (framers.length === 0) {
      res.status(404).json({ error: `No framer found for portal "${slug}"` });
      return;
    }
    const framer = framers[0];

    // 2. Pending jobs: sales must be orders (1) or invoices (2), never quotes (0);
    //    jobs must be uncompleted and uncollected
    const [jobs] = await pool.query<any[]>(
      `SELECT j.ID, j.SaleID, j.Description, j.ArtworkWidth, j.ArtworkHeight,
              j.ArtworkUnit, j.Copies, s.Number AS SaleNumber, s.Created AS SaleCreated
       FROM sale s
       JOIN job j ON j.SaleID = s.ID
       WHERE s.FramerID = ?
         AND s.Deleted = 0
         AND s.SaleType IN (1, 2)
         AND j.Deleted = 0
         AND j.Completed = 0
         AND j.Collected = 0
       ORDER BY s.Created DESC
       LIMIT 300`,
      [framer.ID],
    );
    if (jobs.length === 0) {
      res.json({ framer: { slug: framer.Slug, name: framer.Name }, jobs: [], env });
      return;
    }
    const jobIds = jobs.map(j => j.ID);

    // 4. Component lines for those jobs
    const [lines] = await pool.query<any[]>(
      `SELECT
         jl.JobID                    AS jobId,
         i.Code                      AS code,
         COALESCE(NULLIF(TRIM(i.Name),''), TRIM(i.Code)) AS name,
         mb.TotalWidth  AS mbW, mb.TotalHeight AS mbH,
         bk.TotalWidth  AS bkW, bk.TotalHeight AS bkH,
         cv.TotalWidth  AS cvW, cv.TotalHeight AS cvH,
         ml.TotalWidth  AS mlW, ml.TotalHeight AS mlH
       FROM jobline jl
       JOIN saleline sl ON sl.ID = jl.ID AND sl.Deleted = 0
       LEFT JOIN item i ON i.ID = sl.ItemID
       LEFT JOIN matboardline mb ON mb.ID = jl.ID
       LEFT JOIN backingline  bk ON bk.ID = jl.ID
       LEFT JOIN coveringline cv ON cv.ID = jl.ID
       LEFT JOIN mouldingline ml ON ml.ID = jl.ID
       WHERE jl.JobID IN (?)`,
      [jobIds],
    );

    // 5. Assemble response
    const linesByJob = new Map<string, any[]>();
    for (const l of lines) {
      const pieces: any[] = [];
      const add = (w: any, h: any, kind: string) => {
        const wMm = Math.round(parseFloat(w) * M_TO_MM);
        const hMm = Math.round(parseFloat(h) * M_TO_MM);
        if (wMm > 0 && hMm > 0) pieces.push({ kind, code: (l.code ?? "").trim(), name: l.name ?? "", width: wMm, length: hMm });
      };
      if (l.mbW != null) add(l.mbW, l.mbH, "matboard");
      if (l.bkW != null) add(l.bkW, l.bkH, "backing");
      if (l.cvW != null) add(l.cvW, l.cvH, "glass");
      if (l.mlW != null) add(l.mlW, l.mlH, "moulding");
      if (pieces.length) {
        const arr = linesByJob.get(l.jobId) ?? [];
        arr.push(...pieces);
        linesByJob.set(l.jobId, arr);
      }
    }

    const out = jobs
      .map(j => {
        return {
          jobId: j.ID,
          saleNumber: j.SaleNumber ?? "",
          saleDate: j.SaleCreated ?? null,
          description: j.Description ?? "",
          artworkWidth: Math.round(parseFloat(j.ArtworkWidth)) || 0,
          artworkHeight: Math.round(parseFloat(j.ArtworkHeight)) || 0,
          artworkUnit: j.ArtworkUnit ?? "mm",
          copies: j.Copies || 1,
          pieces: linesByJob.get(j.ID) ?? [],
        };
      })
      .filter(j => j.pieces.length > 0)
      .sort((a, b) => (a.saleNumber < b.saleNumber ? 1 : -1));

    res.json({
      framer: { slug: framer.Slug, name: framer.Name },
      jobs: out,
      env,
      count: out.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Database error", detail: err?.message ?? String(err) });
  }
});

export default router;
