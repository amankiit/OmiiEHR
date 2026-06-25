import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Loading } from "../components/ui.jsx";
import { formatDateTime } from "../utils/fhir.js";

const OUTCOME_TONE = { success: "success", failure: "critical", error: "critical", denied: "warning" };
const ACTION_TONE = { create: "accent", update: "primary", read: "neutral", delete: "critical", search: "neutral" };

// Sortable columns: label drives the header, accessor returns a comparable value.
const COLUMNS = [
  { key: "createdAt", label: "Timestamp", accessor: (e) => (e.createdAt ? new Date(e.createdAt).getTime() : 0) },
  { key: "actorEmail", label: "Actor", accessor: (e) => (e.actorEmail || "").toLowerCase() },
  { key: "action", label: "Action", accessor: (e) => (e.action || "").toLowerCase() },
  { key: "resourceType", label: "Resource", accessor: (e) => (e.resourceType || "").toLowerCase() },
  { key: "statusCode", label: "Status", accessor: (e) => Number(e.statusCode) || 0 },
  { key: "outcome", label: "Outcome", accessor: (e) => (e.outcome || "").toLowerCase() },
  { key: "path", label: "Path", accessor: (e) => (e.path || "").toLowerCase() }
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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  const toggleSort = (key) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (outcomeFilter) {
          params.set("outcome", outcomeFilter);
        }
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
  }, [page, limit, token, outcomeFilter]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = !term
      ? rows
      : rows.filter((entry) =>
          [entry.actorEmail, entry.action, entry.resourceType, entry.path]
            .join(" ")
            .toLowerCase()
            .includes(term)
        );

    const column = COLUMNS.find((col) => col.key === sort.key) || COLUMNS[0];
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = column.accessor(a);
      const bv = column.accessor(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [rows, search, sort]);

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
