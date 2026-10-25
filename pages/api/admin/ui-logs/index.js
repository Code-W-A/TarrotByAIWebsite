import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireDashboardAccess } from "../../../../lib/requireAuth";

const COLLECTION_NAME = "adminUiLogs";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 3;
const MAX_KEYS_PER_OBJECT = 20;
const MAX_ITEMS_PER_ARRAY = 20;

const ALLOWED_LEVELS = new Set(["info", "warn", "error"]);
const ALLOWED_SOURCES = new Set(["videos.create"]);
const ALLOWED_EVENTS = new Set([
  "create_button_pointerdown",
  "create_button_click",
  "create_modal_opened",
  "create_modal_closed",
  "create_modal_open_timeout",
  "create_runtime_error",
  "create_submit_start",
  "create_submit_success",
  "create_submit_error",
]);

function clipString(value, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return clipString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS_PER_ARRAY)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    const safe = {};
    for (const [key, nested] of Object.entries(value).slice(0, MAX_KEYS_PER_OBJECT)) {
      const safeNested = sanitizeValue(nested, depth + 1);
      if (safeNested !== undefined) {
        safe[clipString(key, 100)] = safeNested;
      }
    }
    return safe;
  }

  return clipString(String(value));
}

function sanitizeRecord(value) {
  const safe = sanitizeValue(value, 0);
  return isRecord(safe) ? safe : undefined;
}

function sanitizeIncomingPayload(body) {
  if (!isRecord(body)) return { error: "Invalid payload." };

  const source = clipString(body.source, 60);
  if (!ALLOWED_SOURCES.has(source)) {
    return { error: "Invalid source." };
  }

  const event = clipString(body.event, 80);
  if (!ALLOWED_EVENTS.has(event)) {
    return { error: "Invalid event." };
  }

  const level = clipString(body.level, 20);
  if (!ALLOWED_LEVELS.has(level)) {
    return { error: "Invalid level." };
  }

  const message = clipString(body.message || "", 300);
  const clientTs = Number.isFinite(body.clientTs) ? body.clientTs : Date.now();
  const sessionId = clipString(body.sessionId || "unknown", 120);
  const pagePath = clipString(body.pagePath || "", 300);
  if (!pagePath) {
    return { error: "Invalid pagePath." };
  }

  const errorPayload = sanitizeRecord(body.error);
  const meta = sanitizeRecord(body.meta);
  const uiState = sanitizeRecord(body.uiState);

  return {
    source,
    event,
    level,
    message,
    clientTs,
    sessionId,
    pagePath,
    ...(uiState ? { uiState } : {}),
    ...(errorPayload ? { error: errorPayload } : {}),
    ...(meta ? { meta } : {}),
  };
}

function parseLimit(raw) {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function timestampToMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

function mapLogDocument(docSnap) {
  const data = docSnap.data() || {};
  const createdAtMs = timestampToMs(data.createdAt);
  return {
    id: docSnap.id,
    source: clipString(data.source, 60),
    event: clipString(data.event, 80),
    level: ALLOWED_LEVELS.has(data.level) ? data.level : "info",
    message: clipString(data.message, 300),
    clientTs: Number.isFinite(data.clientTs) ? data.clientTs : null,
    sessionId: clipString(data.sessionId, 120),
    pagePath: clipString(data.pagePath, 300),
    uiState: isRecord(data.uiState) ? data.uiState : undefined,
    error: isRecord(data.error) ? data.error : undefined,
    meta: isRecord(data.meta) ? data.meta : undefined,
    createdAtMs,
    createdAtIso: createdAtMs ? new Date(createdAtMs).toISOString() : null,
  };
}

export default async function handler(req, res) {
  try {
    requireDashboardAccess(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  const db = getAdminDb();
  const collectionRef = db.collection(COLLECTION_NAME);

  if (req.method === "POST") {
    const payload = sanitizeIncomingPayload(req.body || {});
    if (typeof payload.error === 'string') {
      return res.status(400).json({ error: payload.error });
    }
    try {
      const storedPayload = {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
        serverReceivedAtMs: Date.now(),
        requestMeta: {
          userAgent: clipString(req.headers?.["user-agent"] || "", 220),
          referer: clipString(req.headers?.referer || "", 220),
        },
      };
      const ref = await collectionRef.add(storedPayload);
      return res.status(201).json({ id: ref.id });
    } catch (error) {
      return res.status(500).json({ error: "Failed to persist UI log." });
    }
  }

  if (req.method === "GET") {
    const limit = parseLimit(req.query?.limit);
    const cursor = clipString(firstQueryValue(req.query?.cursor) || "", 200);
    try {
      let query = collectionRef.orderBy("createdAt", "desc");
      if (cursor) {
        const cursorSnap = await collectionRef.doc(cursor).get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }
      const snapshot = await query.limit(limit).get();
      const docs = snapshot.docs;
      const logs = docs.map(mapLogDocument);
      const nextCursor = docs.length === limit ? docs[docs.length - 1].id : null;
      return res.status(200).json({ logs, nextCursor });
    } catch (error) {
      return res.status(500).json({ error: "Failed to load UI logs." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).end("Method Not Allowed");
}
