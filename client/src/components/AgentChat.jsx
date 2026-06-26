import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { agentApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import Icon from "./Icon.jsx";
import Markdown from "./Markdown.jsx";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

const STARTERS = [
  "List a few patients",
  "Summarize this patient's chart",
  "What's on the schedule today?"
];

// Pulls the patient id out of the URL (e.g. /patients/<id>) so the assistant knows
// which chart the user is looking at.
const usePatientContext = () => {
  const location = useLocation();
  return useMemo(() => {
    const id = location.pathname.split("/").filter(Boolean).find((seg) => OBJECT_ID.test(seg));
    return id ? { patientId: id } : undefined;
  }, [location.pathname]);
};

const relativeTime = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const ToolActivity = ({ item }) => (
  <div className={`ai-activity ${item.status}`}>
    <span className="ai-activity-dot" aria-hidden="true" />
    <span className="ai-activity-name">
      {item.write ? "Action" : "Looked up"} · {item.name}
    </span>
    {item.status === "ok" ? <Icon name="check" size={13} className="ai-activity-tick" /> : null}
    {item.status === "declined" ? <span className="ai-activity-state declined">declined</span> : null}
    {item.status === "running" ? <span className="ai-spinner" aria-hidden="true" /> : null}
  </div>
);

const ConfirmCard = ({ item, busy, onDecision }) => (
  <div className="ai-confirm">
    <div className="ai-confirm-title">
      <Icon name="alert" size={15} /> Approval needed
    </div>
    <ul className="ai-confirm-list">
      {item.actions.map((action) => (
        <li key={action.id}>{action.summary}</li>
      ))}
    </ul>
    <div className="ai-confirm-actions">
      <button type="button" className="ai-btn ai-btn-approve" disabled={busy} onClick={() => onDecision(true)}>
        Approve
      </button>
      <button type="button" className="ai-btn ai-btn-reject" disabled={busy} onClick={() => onDecision(false)}>
        Decline
      </button>
    </div>
  </div>
);

const AgentChat = () => {
  const { token, isAuthenticated } = useAuth();
  const context = usePatientContext();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("chat"); // "chat" | "history"
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const sessionIdRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (view === "chat" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, open, view]);

  // Routes each SSE event to the transcript.
  const handleEvent = useCallback((type, data) => {
    if (type === "session") {
      sessionIdRef.current = data.sessionId;
    } else if (type === "tool_call") {
      setItems((prev) => [
        ...prev,
        { kind: "activity", id: data.id, name: data.name, write: data.write, status: "running" }
      ]);
    } else if (type === "tool_result") {
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "activity" && it.id === data.id
            ? { ...it, status: data.declined ? "declined" : data.ok ? "ok" : "error" }
            : it
        )
      );
    } else if (type === "confirm_required") {
      setItems((prev) => [...prev, { kind: "confirm", id: `confirm-${Date.now()}`, actions: data.actions }]);
    } else if (type === "message") {
      setItems((prev) => [...prev, { kind: "assistant", id: `a-${Date.now()}`, content: data.content }]);
    } else if (type === "error") {
      setItems((prev) => [
        ...prev,
        { kind: "assistant", id: `e-${Date.now()}`, content: data.message, error: true }
      ]);
    }
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const message = text.trim();
      if (!message || busy) return;
      setView("chat");
      setItems((prev) => [...prev, { kind: "user", id: `u-${Date.now()}`, content: message }]);
      setBusy(true);
      try {
        await agentApi.chat(token, {
          sessionId: sessionIdRef.current,
          message,
          context,
          onEvent: handleEvent
        });
      } catch (error) {
        handleEvent("error", { message: error.message });
      } finally {
        setBusy(false);
      }
    },
    [busy, token, context, handleEvent]
  );

  const submit = useCallback(() => {
    const text = input;
    setInput("");
    sendMessage(text);
  }, [input, sendMessage]);

  const decide = useCallback(
    async (confirmId, approved) => {
      if (busy) return;
      setItems((prev) => prev.filter((it) => it.id !== confirmId));
      setBusy(true);
      try {
        await agentApi.confirm(token, {
          sessionId: sessionIdRef.current,
          approved,
          onEvent: handleEvent
        });
      } catch (error) {
        handleEvent("error", { message: error.message });
      } finally {
        setBusy(false);
      }
    },
    [busy, token, handleEvent]
  );

  const startNew = useCallback(() => {
    if (busy) return;
    sessionIdRef.current = null;
    setItems([]);
    setView("chat");
  }, [busy]);

  const openHistory = useCallback(async () => {
    if (busy) return;
    setView("history");
    setSessionsLoading(true);
    try {
      const { sessions: list } = await agentApi.listSessions(token);
      setSessions(list || []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [busy, token]);

  const loadSession = useCallback(
    async (id) => {
      setBusy(true);
      try {
        const data = await agentApi.getSession(token, id);
        sessionIdRef.current = data.id;
        setItems(
          (data.transcript || []).map((m, i) => ({
            kind: m.role === "user" ? "user" : "assistant",
            id: `h-${id}-${i}`,
            content: m.content
          }))
        );
        setView("chat");
      } catch (error) {
        handleEvent("error", { message: error.message });
        setView("chat");
      } finally {
        setBusy(false);
      }
    },
    [token, handleEvent]
  );

  if (!isAuthenticated) return null;

  return (
    <>
      {!open ? (
        <button type="button" className="ai-launcher" aria-label="Open assistant" onClick={() => setOpen(true)}>
          <Icon name="sparkle" size={22} />
        </button>
      ) : null}

      {open ? (
        <section className="ai-panel" aria-label="Clinical assistant">
          <header className="ai-panel-head">
            <div className="ai-head-title">
              <span className="ai-head-mark" aria-hidden="true">
                <Icon name="sparkle" size={15} />
              </span>
              <div>
                <div className="ai-head-name">Clinical assistant</div>
                {context?.patientId ? <div className="ai-head-sub">viewing this chart</div> : null}
              </div>
            </div>
            <div className="ai-head-actions">
              <button
                type="button"
                className={`ai-icon-btn ${view === "history" ? "active" : ""}`}
                aria-label="Conversation history"
                title="History"
                onClick={openHistory}
                disabled={busy}
              >
                <Icon name="history" size={17} />
              </button>
              <button
                type="button"
                className="ai-icon-btn"
                aria-label="New conversation"
                title="New chat"
                onClick={startNew}
                disabled={busy}
              >
                <Icon name="plus" size={17} />
              </button>
              <button
                type="button"
                className="ai-icon-btn"
                aria-label="Close assistant"
                title="Close"
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
          </header>

          {view === "history" ? (
            <div className="ai-history">
              {sessionsLoading ? (
                <div className="ai-empty">Loading history…</div>
              ) : sessions.length === 0 ? (
                <div className="ai-empty">No past conversations yet.</div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="ai-history-item"
                    onClick={() => loadSession(s.id)}
                  >
                    <Icon name="notes" size={15} className="ai-history-icon" />
                    <span className="ai-history-text">
                      <span className="ai-history-title">{s.title}</span>
                      <span className="ai-history-time">{relativeTime(s.updatedAt)}</span>
                    </span>
                    <Icon name="chevronRight" size={15} className="ai-history-chevron" />
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="ai-transcript" ref={scrollRef}>
                {items.length === 0 ? (
                  <div className="ai-welcome">
                    <span className="ai-welcome-mark" aria-hidden="true">
                      <Icon name="sparkle" size={20} />
                    </span>
                    <p className="ai-welcome-text">
                      I read and act through your own permissions, and pause for approval before
                      writing anything.
                    </p>
                    <div className="ai-chips">
                      {STARTERS.map((s) => (
                        <button key={s} type="button" className="ai-chip" onClick={() => sendMessage(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {items.map((item) => {
                  if (item.kind === "user") {
                    return (
                      <div key={item.id} className="ai-msg ai-msg-user">
                        {item.content}
                      </div>
                    );
                  }
                  if (item.kind === "assistant") {
                    return (
                      <div key={item.id} className={`ai-msg ai-msg-assistant ${item.error ? "ai-error" : ""}`}>
                        {item.error ? item.content : <Markdown>{item.content}</Markdown>}
                      </div>
                    );
                  }
                  if (item.kind === "activity") {
                    return <ToolActivity key={item.id} item={item} />;
                  }
                  if (item.kind === "confirm") {
                    return (
                      <ConfirmCard
                        key={item.id}
                        item={item}
                        busy={busy}
                        onDecision={(approved) => decide(item.id, approved)}
                      />
                    );
                  }
                  return null;
                })}

                {busy ? (
                  <div className="ai-typing">
                    <span className="ai-spinner" aria-hidden="true" /> Working…
                  </div>
                ) : null}
              </div>

              <form
                className="ai-input-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  className="ai-input"
                  placeholder="Ask the assistant…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={busy}
                />
                <button type="submit" className="ai-send" aria-label="Send" disabled={busy || !input.trim()}>
                  <Icon name="chevronRight" size={18} />
                </button>
              </form>
            </>
          )}
        </section>
      ) : null}
    </>
  );
};

export default AgentChat;
