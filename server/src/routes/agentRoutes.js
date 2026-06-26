import express from "express";
import env from "../config/env.js";
import { authenticate } from "../middleware/auth.js";
import { ApiError } from "../utils/apiError.js";
import AgentSession from "../models/AgentSession.js";
import {
  buildSystemPrompt,
  runAssistantTurn,
  resumeAfterConfirmation
} from "../agent/orchestrator.js";

const router = express.Router();

router.use(authenticate);

// Block everything if the assistant isn't configured (no GROQ_API_KEY).
router.use((_req, _res, next) => {
  if (!env.agentEnabled) {
    return next(new ApiError(503, "AI assistant is not configured on this server."));
  }
  return next();
});

const bearer = (req) => req.headers.authorization.slice(7);

// First user line, used as a session label in the history list.
const sessionTitle = (messages) => {
  const firstUser = (messages || []).find(
    (m) => m.role === "user" && typeof m.content === "string"
  );
  const text = (firstUser?.content || "").trim() || "New conversation";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

// Display transcript: just the user/assistant text turns (drops system and tool plumbing).
const toTranscript = (messages) =>
  (messages || [])
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .map((m) => ({ role: m.role, content: m.content }));

// GET /api/agent/sessions — the signed-in user's recent conversations.
router.get("/sessions", async (req, res) => {
  const docs = await AgentSession.find({ userId: req.user.sub })
    .sort({ updatedAt: -1 })
    .limit(50)
    .select("messages status updatedAt")
    .lean();

  const sessions = docs
    .map((d) => ({
      id: String(d._id),
      title: sessionTitle(d.messages),
      status: d.status,
      updatedAt: d.updatedAt,
      empty: toTranscript(d.messages).length === 0
    }))
    .filter((s) => !s.empty);

  res.json({ sessions });
});

// GET /api/agent/sessions/:id — one conversation's transcript.
router.get("/sessions/:id", async (req, res) => {
  const doc = await AgentSession.findById(req.params.id).lean();
  if (!doc || String(doc.userId) !== String(req.user.sub)) {
    return res.status(404).json({ message: "Session not found." });
  }
  res.json({
    id: String(doc._id),
    title: sessionTitle(doc.messages),
    status: doc.status,
    transcript: toTranscript(doc.messages)
  });
});

// Open a Server-Sent Events stream. Returns an emit(type, data) helper.
const openStream = (res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  return (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data || {})}\n\n`);
};

const persist = (session) =>
  AgentSession.findByIdAndUpdate(
    session._id,
    {
      status: session.status,
      messages: session.messages,
      pendingWrites: session.pendingWrites,
      pendingToolResults: session.pendingToolResults
    },
    { new: true }
  );

// POST /api/agent/chat  { sessionId?, message, context? }  -> SSE stream
router.post("/chat", async (req, res) => {
  const { sessionId, message, context } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ message: "A message string is required." });
  }

  let doc;
  if (sessionId) {
    doc = await AgentSession.findById(sessionId);
    if (!doc || String(doc.userId) !== String(req.user.sub)) {
      return res.status(404).json({ message: "Session not found." });
    }
  } else {
    doc = await AgentSession.create({
      userId: req.user.sub,
      role: req.user.role,
      context,
      messages: [{ role: "system", content: buildSystemPrompt({ user: req.user, context }) }]
    });
  }

  // Working copy of the persisted state, plus the per-request runtime fields.
  const session = {
    _id: doc._id,
    role: req.user.role,
    status: doc.status,
    messages: doc.messages,
    pendingWrites: doc.pendingWrites || [],
    pendingToolResults: doc.pendingToolResults || []
  };
  session.messages.push({ role: "user", content: message });

  const emit = openStream(res);
  emit("session", { sessionId: String(doc._id) });

  try {
    await runAssistantTurn({ session, jwt: bearer(req), emit });
    await persist(session);
    emit("done", { status: session.status });
  } catch (error) {
    await persist(session).catch(() => {});
    emit("error", { message: error.message || "Assistant failed." });
  } finally {
    res.end();
  }
});

// POST /api/agent/confirm  { sessionId, approved }  -> SSE stream (resumes the turn)
router.post("/confirm", async (req, res) => {
  const { sessionId, approved } = req.body || {};

  const doc = await AgentSession.findById(sessionId);
  if (!doc || String(doc.userId) !== String(req.user.sub)) {
    return res.status(404).json({ message: "Session not found." });
  }
  if (doc.status !== "awaiting_confirmation") {
    return res.status(409).json({ message: "This session has no action awaiting confirmation." });
  }

  const session = {
    _id: doc._id,
    role: req.user.role,
    status: doc.status,
    messages: doc.messages,
    pendingWrites: doc.pendingWrites || [],
    pendingToolResults: doc.pendingToolResults || []
  };

  const emit = openStream(res);
  emit("session", { sessionId: String(doc._id) });

  try {
    await resumeAfterConfirmation({ session, jwt: bearer(req), approved: Boolean(approved), emit });
    await persist(session);
    emit("done", { status: session.status });
  } catch (error) {
    await persist(session).catch(() => {});
    emit("error", { message: error.message || "Assistant failed." });
  } finally {
    res.end();
  }
});

export default router;
