/**
 * FFCS OS API routes — all 14 endpoints.
 *
 * Compute-heavy routes (parse, optimize, reference data) spawn Python CLIs.
 * CRUD routes (preferences, timetables, history) persist to a local JSON store.
 */

import { Router, type Request, type Response } from "express";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../lib/logger";
import { selectPythonExecutable } from "../lib/python-executable.mjs";
import { currentUid, deleteFirebaseUser, type AuthenticatedRequest } from "../lib/firebase-auth";

const router = Router();

// ─── JSON file store ──────────────────────────────────────────────────────────

const configuredStorePath = process.env["FFCS_STORE_PATH"]?.trim();
const DEFAULT_DATA_DIRECTORY = process.platform === "win32"
  ? (process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local"))
  : process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support")
    : (process.env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share"));
const STORE_PATH = path.resolve(configuredStorePath || path.join(DEFAULT_DATA_DIRECTORY, "FFCS OS", "ffcs_store.json"));
const LEGACY_STORE_PATH = path.resolve(process.env["FFCS_LEGACY_STORE_PATH"] || "/tmp/ffcs_store.json");
const MAX_IMPORT_COURSES = 1_000;
const MAX_IMPORT_OFFERINGS = 5_000;
const MAX_OPTIMIZE_COURSES = 60;
const MAX_OPTIMIZE_OFFERINGS = 2_000;
const MAX_OPTIONS_PER_COURSE = 100;
const MAX_PYTHON_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_PYTHON_ERROR_BYTES = 2 * 1024 * 1024;

interface Store {
  // Legacy global values stay preserved but are never exposed to authenticated users.
  preferences: Record<string, unknown>;
  userPreferences?: Record<string, Record<string, unknown>>;
  timetables: Array<{ id: number; ownerUid?: string; name: string; notes?: string | null; score: unknown; courses: unknown[]; grid: unknown[]; savedAt: string }>;
  history: Array<{ id: number; ownerUid?: string; subjects: unknown[]; preferences: unknown; resultCount: number; durationMs: number; createdAt: string }>;
  nextTimetableId: number;
  nextHistoryId: number;
}


const DEFAULT_PREFERENCES = {
  mode: "LIVE_REGISTRATION",
  timePreference: "balanced",
  maxGap: 4,
  maxClassesPerDay: 5,
  teacherPriority: true,
  prioritizeDifficulty: false,
  prioritizeAttendance: false,
  preferredFreeDay: null,
  avoidSaturday: false,
  avoidEarlyMorning: false,
  walkingPriority: false,
};

class StoreUnavailableError extends Error {
  readonly code = "FFCS_STORE_UNAVAILABLE";
  readonly statusCode = 503;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreUnavailableError";
  }
}

function emptyStore(): Store {
  return {
    preferences: { ...DEFAULT_PREFERENCES },
    timetables: [],
    history: [],
    nextTimetableId: 1,
    nextHistoryId: 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStore(value: unknown): value is Store {
  if (!isRecord(value) || !isRecord(value.preferences) || !Array.isArray(value.timetables) ||
      !Array.isArray(value.history) || !Number.isSafeInteger(value.nextTimetableId) ||
      !Number.isSafeInteger(value.nextHistoryId) || Number(value.nextTimetableId) < 1 || Number(value.nextHistoryId) < 1) {
    return false;
  }
  return true;
}

function storeError(action: string, cause: unknown): StoreUnavailableError {
  const reason = cause instanceof Error ? ` ${cause.message}` : "";
  return new StoreUnavailableError(
    `FFCS local data store ${action} at ${STORE_PATH}.${reason} No data was replaced. Check the file and directory permissions, and preserve the existing file for recovery.`,
    cause instanceof Error ? { cause } : undefined,
  );
}

function readStore(): Store {
  const readValidatedFile = (filePath: string): Store => {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!isStore(parsed)) throw new Error("The JSON does not match the expected store structure");
    return parsed;
  };
  try {
    return readValidatedFile(STORE_PATH);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      logger.error({ error, storePath: STORE_PATH }, "Local data store could not be read; leaving it untouched");
      throw storeError("could not be read or has invalid JSON/structure", error);
    }
  }

  if (!configuredStorePath && STORE_PATH !== LEGACY_STORE_PATH) {
    let legacyContent: string;
    try {
      legacyContent = fs.readFileSync(LEGACY_STORE_PATH, "utf-8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyStore();
      throw storeError("could not read the legacy file for migration", error);
    }
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, legacyContent, { encoding: "utf-8", flag: "wx" });
      logger.info({ legacyPath: LEGACY_STORE_PATH, storePath: STORE_PATH }, "Migrated local data store by copying legacy file");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw storeError("could not migrate the legacy file", error);
      }
    }
    try { return readValidatedFile(STORE_PATH); }
    catch (error) { throw storeError("could not be read or has invalid JSON/structure", error); }
  }
  return emptyStore();
}

function writeStore(store: Store): void {
  const absoluteStorePath = path.resolve(STORE_PATH);
  const tempPath = `${absoluteStorePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(absoluteStorePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), { encoding: "utf-8", flag: "wx" });
    fs.renameSync(tempPath, absoluteStorePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* retain the original write error */ }
    logger.error({ error, storePath: absoluteStorePath }, "Local data store write failed");
    throw storeError("could not be written", error);
  }
}

logger.info({ storePath: STORE_PATH }, "Using local FFCS data store");

// ─── Python subprocess helper ─────────────────────────────────────────────────

// Resolve workspace root relative to this compiled file:
// dist/index.mjs -> artifacts/api-server/dist -> artifacts/api-server -> artifacts -> workspace root
const _thisDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = process.env["WORKSPACE_ROOT"] ?? path.resolve(_thisDir, "../..");

// Prefer PYTHON_BIN when configured. Windows uses its standard `python`
// command; POSIX hosts retain the Replit pythonlibs binary when available.
const _pythonLibsBin = path.join(WORKSPACE_ROOT, ".pythonlibs/bin/python3");
const PYTHON_BIN = selectPythonExecutable(
  process.platform,
  process.env["PYTHON_BIN"],
  _pythonLibsBin,
  fs.existsSync(_pythonLibsBin),
);

class PythonProcessError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "PythonProcessError";
    this.statusCode = statusCode;
  }
}

function spawnPython(module: string, inputJson: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-m", module], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, PYTHONPATH: WORKSPACE_ROOT },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timeoutMs = Math.max(10, Number(process.env["FFCS_PYTHON_TIMEOUT_MS"] ?? 30_000));
    const timer = setTimeout(() => {
      child.kill();
      finish(new PythonProcessError(`Python subprocess timed out after ${timeoutMs} ms`, 504));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_PYTHON_OUTPUT_BYTES) {
        child.kill();
        finish(new PythonProcessError("Python subprocess output exceeded its limit"));
      } else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) + chunk.length > MAX_PYTHON_ERROR_BYTES) {
        child.kill();
        finish(new PythonProcessError("Python subprocess error output exceeded its limit"));
      } else stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        logger.error({ module, stderr, code }, "Python process failed");
        return finish(new PythonProcessError(stderr.slice(0, 2_000) || `Python exited with code ${code}`));
      }
      try {
        finish(undefined, JSON.parse(stdout));
      } catch {
        finish(new PythonProcessError("Python subprocess returned malformed JSON"));
      }
    });

    child.on("error", (err) => finish(new PythonProcessError(err.message)));
    child.stdin.on("error", (err) => finish(new PythonProcessError(err.message)));
    child.stdin.end(JSON.stringify(inputJson));
  });
}

function inspectRawData(rawData: string): { courseCount: number; offeringCount: number } | null {
  try {
    const value = JSON.parse(rawData) as unknown;
    const courses = Array.isArray(value) ? value : value && typeof value === "object"
      ? ((value as { courses?: unknown; subjects?: unknown }).courses ?? (value as { subjects?: unknown }).subjects)
      : undefined;
    if (!Array.isArray(courses)) return null;
    const offeringCount = courses.reduce((count: number, course: unknown) => {
      if (!course || typeof course !== "object") return count;
      const options = (course as { options?: unknown }).options;
      return count + (Array.isArray(options) ? options.length : 0);
    }, 0);
    return { courseCount: courses.length, offeringCount };
  } catch {
    return null;
  }
}

function subjectArrayLimit(subjects: unknown): string | null {
  if (!Array.isArray(subjects)) return "subjects must be an array";
  if (subjects.length > MAX_OPTIMIZE_COURSES) return `At most ${MAX_OPTIMIZE_COURSES} courses may be optimized at once`;
  let offerings = 0;
  for (const subject of subjects) {
    const options = subject && typeof subject === "object" ? (subject as { options?: unknown }).options : undefined;
    if (!Array.isArray(options)) continue;
    if (options.length > MAX_OPTIONS_PER_COURSE) return `Each course may include at most ${MAX_OPTIONS_PER_COURSE} offerings`;
    offerings += options.length;
    if (offerings > MAX_OPTIMIZE_OFFERINGS) return `At most ${MAX_OPTIMIZE_OFFERINGS} offerings may be optimized at once`;
  }
  return null;
}

// ─── GET /healthz ─────────────────────────────────────────────────────────────

router.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "ffcs-os-api", timestamp: new Date().toISOString() });
});

// ─── POST /parse ──────────────────────────────────────────────────────────────

router.post("/parse", async (req: Request, res: Response) => {
  try {
    const body = req.body as { rawData?: unknown };
    if (typeof body?.rawData !== "string" || !body.rawData.trim()) {
      return res.status(400).json({ error: "rawData is required" });
    }
    const counts = inspectRawData(body.rawData);
    if (counts && (counts.courseCount > MAX_IMPORT_COURSES || counts.offeringCount > MAX_IMPORT_OFFERINGS)) {
      return res.status(413).json({ error: `Import limit is ${MAX_IMPORT_COURSES} courses and ${MAX_IMPORT_OFFERINGS} offerings` });
    }
    const result = await spawnPython("backend.cli.parse_cli", { rawData: body.rawData });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Parse failed");
    res.status(err instanceof PythonProcessError ? err.statusCode : 500).json({ error: "Parsing could not be completed" });
  }
});

// ─── POST /optimize ───────────────────────────────────────────────────────────

router.post("/optimize", async (req: Request, res: Response) => {
  try {
    const body = req.body as { subjects: unknown[]; preferences: unknown; topN?: number };
    if (!body?.subjects || !body?.preferences) {
      return res.status(400).json({ error: "subjects and preferences are required" });
    }
    const preferences = body.preferences as Record<string, unknown>;
    if (preferences.mode !== undefined && !["PLANNING", "LIVE_REGISTRATION"].includes(String(preferences.mode))) {
      return res.status(400).json({ error: "preferences.mode must be PLANNING or LIVE_REGISTRATION" });
    }
    if (preferences.timePreference !== undefined && !["morning", "evening", "balanced"].includes(String(preferences.timePreference))) {
      return res.status(400).json({ error: "preferences.timePreference must be morning, evening, or balanced" });
    }
    const limitError = subjectArrayLimit(body.subjects);
    if (limitError) return res.status(Array.isArray(body.subjects) ? 413 : 400).json({ error: limitError });

    const inp = { subjects: body.subjects, preferences: body.preferences, topN: body.topN ?? 20 };
    const result = await spawnPython("backend.cli.optimize_cli", inp);
    if (!result || typeof result !== "object" || !Array.isArray((result as { timetables?: unknown }).timetables)) {
      throw new PythonProcessError("Optimizer returned malformed output");
    }

    // Record history
    const store = readStore();
    const uid = currentUid(req);
    store.history.unshift({
      id: store.nextHistoryId++,
      ownerUid: uid,
      subjects: body.subjects,
      preferences: body.preferences,
      resultCount: (result as { timetables?: unknown[] }).timetables?.length ?? 0,
      durationMs: (result as { durationMs?: number }).durationMs ?? 0,
      createdAt: new Date().toISOString(),
    });
    const ownedHistory = store.history.filter((item) => item.ownerUid === uid).slice(0, 50);
    store.history = [...ownedHistory, ...store.history.filter((item) => item.ownerUid !== uid)];
    writeStore(store);

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Optimize failed");
    const statusCode = err instanceof PythonProcessError || err instanceof StoreUnavailableError ? err.statusCode : 500;
    res.status(statusCode).json({ error: err instanceof StoreUnavailableError ? err.message : "Optimization could not be completed" });
  }
});

// ─── GET /preferences ─────────────────────────────────────────────────────────

router.get("/preferences", (req: Request, res: Response) => {
  const store = readStore();
  res.json({ id: 1, ...store.userPreferences?.[currentUid(req)] ?? DEFAULT_PREFERENCES });
});

// ─── PUT /preferences ─────────────────────────────────────────────────────────

router.put("/preferences", (req: Request, res: Response) => {
  const store = readStore();
  const uid = currentUid(req);
  store.userPreferences ??= {};
  store.userPreferences[uid] = { ...DEFAULT_PREFERENCES, ...(req.body as Record<string, unknown>) };
  writeStore(store);
  res.json({ id: 1, ...store.userPreferences[uid] });
});

// ─── GET /timetables ─────────────────────────────────────────────────────────

router.get("/timetables", (req: Request, res: Response) => {
  const store = readStore();
  // Library cards render the saved weekly grid, so list records must include it.
  res.json(store.timetables.filter((t) => t.ownerUid === currentUid(req)).map(({ ownerUid: _ownerUid, ...t }) => t));
});

// ─── POST /timetables ────────────────────────────────────────────────────────

router.post("/timetables", async (req: Request, res: Response) => {
  const body = req.body as {
    name?: unknown; notes?: unknown; rawData?: unknown; preferences?: unknown;
    courseCodes?: unknown; selectedOfferings?: unknown;
  };
  if (typeof body?.name !== "string" || !body.name.trim() || typeof body.rawData !== "string" ||
      !body.rawData.trim() || !body.preferences || typeof body.preferences !== "object" || Array.isArray(body.preferences) ||
      !Array.isArray(body.courseCodes) || !body.courseCodes.length || !body.selectedOfferings ||
      typeof body.selectedOfferings !== "object" || Array.isArray(body.selectedOfferings)) {
    return res.status(400).json({ error: "name, rawData, preferences, courseCodes, and selectedOfferings are required" });
  }
  try {
    const counts = inspectRawData(body.rawData);
    if (counts && (counts.courseCount > MAX_IMPORT_COURSES || counts.offeringCount > MAX_IMPORT_OFFERINGS)) {
      return res.status(413).json({ error: `Import limit is ${MAX_IMPORT_COURSES} courses and ${MAX_IMPORT_OFFERINGS} offerings` });
    }

    // Reparse the client export and rerun the optimizer. All client derived
    // schedule values, scores, flags, conflict lists, and timestamps are ignored.
    const parsed = await spawnPython("backend.cli.parse_cli", { rawData: body.rawData });
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { subjects?: unknown }).subjects)) {
      throw new PythonProcessError("Parser returned malformed output");
    }
    const parsedResult = parsed as { subjects: Array<{ courseCode: string; options: unknown[] }>; errors?: string[] };
    if (parsedResult.subjects.some((course) => !course || typeof course.courseCode !== "string" || !Array.isArray(course.options))) {
      throw new PythonProcessError("Parser returned malformed course data");
    }
    if (!parsedResult.subjects.length || (parsedResult.errors?.length ?? 0) > 0) {
      return res.status(422).json({ error: "Imported course data could not be validated", details: parsedResult.errors ?? [] });
    }

    const availableCodes = parsedResult.subjects.map((course) => course.courseCode);
    const codes = body.courseCodes as unknown[];
    if (codes.length > MAX_OPTIMIZE_COURSES || codes.some((code) => typeof code !== "string") ||
        new Set(codes).size !== codes.length || codes.some((code) => !availableCodes.includes(code as string))) {
      return res.status(422).json({ error: `Requested courses must be distinct imported course codes (maximum ${MAX_OPTIMIZE_COURSES})` });
    }
    const requestedSubjects = parsedResult.subjects.filter((course) => codes.includes(course.courseCode));
    const selected = body.selectedOfferings as Record<string, unknown>;
    const keys = Object.keys(selected);
    if (keys.length !== codes.length || codes.some((code) => typeof selected[code as string] !== "string" || !(selected[code as string] as string).trim()) ||
        keys.some((code) => !codes.includes(code))) {
      return res.status(422).json({ error: "Choose exactly one offering for every requested course and no others" });
    }
    const ids = Object.values(selected);
    if (new Set(ids).size !== ids.length) {
      return res.status(422).json({ error: "An offering ID cannot be selected for multiple courses" });
    }

    const preferences = { ...(body.preferences as Record<string, unknown>), selectedOfferings: selected };
    const validation = await spawnPython("backend.cli.optimize_cli", { subjects: requestedSubjects, preferences, topN: 1 });
    if (!validation || typeof validation !== "object" || !Array.isArray((validation as { timetables?: unknown }).timetables)) {
      throw new PythonProcessError("Optimizer returned malformed output");
    }
    const checked = validation as { selectionValid?: boolean; timetables: Array<{ score: unknown; courses: Array<{ courseCode: string; offeringId?: string }>; grid: unknown[] }> };
    const timetable = checked.selectionValid === true && checked.timetables.length === 1 ? checked.timetables[0] : null;
    if (timetable && (!Array.isArray(timetable.courses) || !Array.isArray(timetable.grid) ||
        timetable.courses.some((course) => !course || typeof course.courseCode !== "string"))) {
      throw new PythonProcessError("Optimizer returned malformed timetable data");
    }
    const actualCodes = timetable?.courses.map((course) => course.courseCode).sort();
    const expectedCodes = (codes as string[]).slice().sort();
    if (!timetable ||
        actualCodes?.length !== expectedCodes.length || actualCodes.some((code, i) => code !== expectedCodes[i]) ||
        new Set(actualCodes).size !== expectedCodes.length ||
        timetable.courses.some((course) => selected[course.courseCode] !== course.offeringId)) {
      if (checked.selectionValid === undefined) throw new PythonProcessError("Optimizer omitted selection validation output");
      return res.status(422).json({ error: "Timetable validation failed", validation });
    }

    // Re-read after all asynchronous validation so concurrent saves build on
    // the latest store. The atomic write below prevents partial JSON records.
    const store = readStore();
    const record = {
      id: store.nextTimetableId++,
      ownerUid: currentUid(req),
      name: body.name.trim().slice(0, 120),
      notes: typeof body.notes === "string" ? body.notes.slice(0, 2_000) : null,
      score: timetable.score,
      courses: timetable.courses,
      grid: timetable.grid,
      savedAt: new Date().toISOString(),
    };
    store.timetables.unshift(record);
    writeStore(store);
    const { ownerUid: _ownerUid, ...responseRecord } = record;
    return res.status(201).json(responseRecord);
  } catch (err) {
    logger.error({ err }, "Timetable validation or persistence failed");
    const statusCode = err instanceof PythonProcessError || err instanceof StoreUnavailableError ? err.statusCode : 500;
    const message = err instanceof StoreUnavailableError ? err.message : statusCode === 504 ? "Timetable validation timed out" : "Timetable validation or persistence failed";
    return res.status(statusCode).json({ error: message });
  }
});

// ─── GET /timetables/:id ─────────────────────────────────────────────────────

router.get("/timetables/:id", (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  const store = readStore();
  const tt = store.timetables.find((t) => t.id === id && t.ownerUid === currentUid(req));
  if (!tt) return res.status(404).json({ error: "Timetable not found" });
  const { ownerUid: _ownerUid, ...responseRecord } = tt;
  res.json(responseRecord);
});

// ─── DELETE /timetables/:id ──────────────────────────────────────────────────

router.delete("/timetables/:id", (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  const store = readStore();
  const idx = store.timetables.findIndex((t) => t.id === id && t.ownerUid === currentUid(req));
  if (idx === -1) return res.status(404).json({ error: "Timetable not found" });
  store.timetables.splice(idx, 1);
  writeStore(store);
  res.status(204).send();
});

// ─── GET /history ─────────────────────────────────────────────────────────────

router.get("/history", (req: Request, res: Response) => {
  const store = readStore();
  // Return history without bulky subjects payload for listing
  const list = store.history.filter((item) => item.ownerUid === currentUid(req))
    .map(({ subjects: _s, preferences: _p, ownerUid: _ownerUid, ...rest }) => rest);
  res.json(list);
});

// ─── GET /faculty/search ──────────────────────────────────────────────────────

router.get("/faculty/search", async (req: Request, res: Response) => {
  try {
    const query = String(req.query["q"] ?? "");
    const result = await spawnPython("backend.cli.reference_cli", { command: "faculty", query });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Faculty search failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /slots ───────────────────────────────────────────────────────────────

router.get("/slots", async (_req: Request, res: Response) => {
  try {
    const result = await spawnPython("backend.cli.reference_cli", { command: "slots" });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Slots fetch failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /buildings ───────────────────────────────────────────────────────────

router.get("/buildings", async (_req: Request, res: Response) => {
  try {
    const result = await spawnPython("backend.cli.reference_cli", { command: "buildings" });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Buildings fetch failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

router.get("/stats", (req: Request, res: Response) => {
  const store = readStore();
  const uid = currentUid(req);
  const timetables = store.timetables.filter((t) => t.ownerUid === uid);
  const history = store.history.filter((item) => item.ownerUid === uid);
  res.json({
    savedTimetables: timetables.length,
    totalOptimizations: history.length,
    avgScore:
      timetables.length > 0
        ? Math.round(
            timetables.reduce((s, t) => s + ((t.score as { overall?: number })?.overall ?? 0), 0) /
              timetables.length
          )
        : 0,
    lastOptimization: history[0]?.createdAt ?? null,
  });
});

router.delete("/account", async (req: Request, res: Response) => {
  const authenticated = req as AuthenticatedRequest;
  const uid = currentUid(req);
  if (!authenticated.authUser || Date.now() / 1000 - authenticated.authUser.authTime > 5 * 60) {
    return res.status(401).json({ error: "Sign in again before deleting your account" });
  }
  try {
    const store = readStore();
    store.timetables = store.timetables.filter((item) => item.ownerUid !== uid);
    store.history = store.history.filter((item) => item.ownerUid !== uid);
    if (store.userPreferences) delete store.userPreferences[uid];
    writeStore(store);
    await deleteFirebaseUser(uid);
    return res.status(204).send();
  } catch (error) {
    logger.error({ error, uid }, "Account deletion failed");
    const status = error instanceof StoreUnavailableError ? 503 : 502;
    return res.status(status).json({ error: "Account data could not be fully deleted. Please retry or contact support." });
  }
});

export default router;
