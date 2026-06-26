import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Loading } from "../components/ui.jsx";
import { formatDateTime } from "../utils/fhir.js";

const OUTCOME_TONE = { success: "success", failure: "critical", error: "critical", denied: "warning" };
const ACTION_TONE = { create: "accent", update: "primary", read: "neutral", delete: "critical", search: "neutral" };

// Sortable columns (sorting is performed server-side over the whole log).
const COLUMNS = [
  { key: "createdAt", label: "Timestamp" },
  { key: "actorEmail", label: "Actor" },
  { key: "initiator", label: "Source" },
  { key: "action", label: "Action" },
  { key: "resourceType", label: "Resource" },
  { key: "statusCode", label: "Status" },
  { key: "outcome", label: "Outcome" },
  { key: "path", label: "Path" }
];

const AuditPage = () => {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [initiatorFilter, setInitiatorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  // Sorting is server-side (it must order the whole log, not just the current page),
  // so changing the sort returns to page 1 and refetches.
  const toggleSort = (key) => {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
    setPage(1);
  };

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (outcomeFilter) {
          params.set("outcome", outcomeFilter);
        }
        if (initiatorFilter) {
          params.set("initiator", initiatorFilter);
        }
        params.set("sort", sort.key);
        params.set("dir", sort.dir);
        const response = await adminApi.listAuditLogs(token, `?${params.toString()}`);
        setRows(response.data || []);
        setTotal(response.total || 0);
      } catch (err) {
        setError(err.message || "Unable to load audit logs");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [page, limit, token, outcomeFilter, initiatorFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Rows arrive already sorted by the server; the search box only narrows the
  // current page (it's labelled "Filter this page…"), so it must not re-sort.
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((entry) =>
      [entry.actorEmail, entry.action, entry.resourceType, entry.path]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [rows, search]);

  return (
    <section className="stack">
      <div className="page-title-row">
        <div>
          <h1>Audit logs</h1>
          <p className="muted-text">HIPAA Security Rule trail of access and modification activity.</p>
        </div>
      </div>

      {error ? <p className="banner banner-error">{error}</p> : null}

      <Card>
        <CardHeader
          title="Activity trail"
          icon="shield"
          sub={`${total} total events`}
          actions={
            <div className="row" style={{ gap: "0.5rem" }}>
              <input
                className="input"
                style={{ width: 200 }}
                placeholder="Filter this page…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                className="input"
                style={{ width: 150 }}
                value={initiatorFilter}
                onChange={(event) => {
                  setInitiatorFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All sources</option>
                <option value="user">User</option>
                <option value="ai">AI assistant</option>
              </select>
              <select
                className="input"
                style={{ width: 150 }}
                value={outcomeFilter}
                onChange={(event) => {
                  setOutcomeFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All outcomes</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="denied">Denied</option>
              </select>
            </div>
          }
        />
        <CardBody flush>
          {loading ? (
            <Loading />
          ) : visibleRows.length === 0 ? (
            <EmptyState icon="shield" title="No audit events" message="No events match the current filters." />
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                        aria-sort={sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      >
                        {col.label}
                        <span style={{ opacity: sort.key === col.key ? 1 : 0.25, marginLeft: 4 }}>
                          {sort.key === col.key ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((entry) => (
                    <tr key={entry._id}>
                      <td className="nowrap">{formatDateTime(entry.createdAt)}</td>
                      <td>
                        {entry.actorEmail || "Unknown"}
                        <span className="sub">{entry.actorRole || "-"}</span>
                      </td>
                      <td>
                        {entry.initiator === "ai" ? (
                          <Badge tone="accent" dot>
                            AI assistant
                          </Badge>
                        ) : (
                          <Badge tone="neutral">User</Badge>
                        )}
                        {entry.initiator === "ai" && entry.agentSessionId ? (
                          <span className="sub">session {String(entry.agentSessionId).slice(-6)}</span>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={ACTION_TONE[entry.action] || "neutral"}>{entry.action}</Badge>
                      </td>
                      <td>
                        {entry.resourceType}
                        {entry.resourceId ? <span className="sub">{entry.resourceId}</span> : null}
                      </td>
                      <td>{entry.statusCode}</td>
                      <td>
                        <Badge tone={OUTCOME_TONE[entry.outcome] || "neutral"} dot>
                          {entry.outcome}
                        </Badge>
                      </td>
                      <td className="muted-text">{entry.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="row">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </section>
  );
};

export default AuditPage;
