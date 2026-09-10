import { Router, type IRouter } from "express";
import { db, boardsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

const boardInputSchema = z.object({
  code: z.string().trim().min(1, "Code is required"),
  description: z.string().trim().nullable().optional(),
  stock_length: z.coerce.number().int().positive("Stock length must be greater than 0").nullable().optional(),
  stock_width: z.coerce.number().int().positive("Stock width must be greater than 0").nullable().optional(),
});

const boardUpdateSchema = boardInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function databaseErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object") break;
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return "UNKNOWN";
}

router.get("/boards", async (req, res) => {
  const rawCode = req.query.code;
  const code = typeof rawCode === "string" ? rawCode.trim() : undefined;
  if (rawCode !== undefined && !code) {
    res.status(400).json({ error: "code query parameter is required" });
    return;
  }

  try {
    if (!code) {
      const results = await db.select().from(boardsTable).orderBy(asc(boardsTable.code));
      res.json(results);
      return;
    }

    const results = await db.select().from(boardsTable).where(eq(boardsTable.code, code)).limit(1);

    if (results.length === 0) {
      res.status(404).json({ error: "Board not found" });
      return;
    }

    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

router.post("/boards", async (req, res) => {
  const parsed = boardInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const values = {
    ...parsed.data,
    description: parsed.data.description || null,
  };

  try {
    const inserted = await db.insert(boardsTable).values(values).returning();
    res.status(201).json(inserted[0]);
  } catch (err) {
    if (databaseErrorCode(err) === "23505") {
      res.status(409).json({ error: "A board with this code already exists" });
      return;
    }
    res.status(500).json({ error: "Database error" });
  }
});

router.put("/boards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = boardUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const values = {
    ...parsed.data,
    ...(parsed.data.code !== undefined && { code: parsed.data.code }),
    ...(parsed.data.description !== undefined && {
      description: parsed.data.description || null,
    }),
  };

  try {
    const updated = await db
      .update(boardsTable)
      .set(values)
      .where(eq(boardsTable.id, id))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ error: "Board not found" });
      return;
    }

    res.json(updated[0]);
  } catch (err) {
    if (databaseErrorCode(err) === "23505") {
      res.status(409).json({ error: "A board with this code already exists" });
      return;
    }
    res.status(500).json({ error: "Database error" });
  }
});

router.delete("/boards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const deleted = await db
      .delete(boardsTable)
      .where(eq(boardsTable.id, id))
      .returning({ id: boardsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Board not found" });
      return;
    }

    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
