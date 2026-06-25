import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { Button, Card, CardBody, CardHeader, Badge, EmptyState, Field, Loading, Modal } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { formatDate } from "../utils/display.js";
import { PRACTITIONER_ROLES, PRACTITIONER_ROLE_LABELS } from "../utils/catalog.js";

const emptyForm = {
  fullName: "",
  email: "",
  organization: "",
  role: "practitioner",
  practitionerRole: "physician",
  password: ""
};

const ROLE_TONE = { admin: "primary", practitioner: "accent", auditor: "warning" };

// Sortable columns: label drives the header, accessor returns a comparable value.
const COLUMNS = [
  { key: "fullName", label: "Name", accessor: (u) => (u.fullName || "").toLowerCase() },
  { key: "email", label: "Email", accessor: (u) => (u.email || "").toLowerCase() },
  { key: "role", label: "Role", accessor: (u) => u.role || "" },
  {
    key: "practitionerRole",
    label: "Practitioner role",
    accessor: (u) =>
      u.practitionerRole ? (PRACTITIONER_ROLE_LABELS[u.practitionerRole] || u.practitionerRole).toLowerCase() : ""
  },
  { key: "organization", label: "Organization", accessor: (u) => (u.organization || "").toLowerCase() },
  { key: "active", label: "Status", accessor: (u) => (u.active === false ? 0 : 1) },
  { key: "lastLoginAt", label: "Last login", accessor: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : 0) }
];

const UsersPage = () => {
  const { token } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState({ key: "fullName", dir: "asc" });

  const sortedUsers = useMemo(() => {
    const column = COLUMNS.find((col) => col.key === sort.key) || COLUMNS[0];
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...users].sort((a, b) => {
      const av = column.accessor(a);
      const bv = column.accessor(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [users, sort]);

  const toggleSort = (key) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));

  const loadUsers = async () => {
    const response = await adminApi.listUsers(token);
    setUsers(response.data || []);
  };

  useEffect(() => {
    setLoading(true);
    loadUsers()
      .catch((err) => toast.error(err.message || "Unable to load users"))
      .finally(() => setLoading(false));
  }, [token]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await adminApi.createUser(token, form);
      setForm(emptyForm);
      setModalOpen(false);
      toast.success("User created");
      await loadUsers();
    } catch (err) {
      setError(err.message || "Unable to create user");
    } finally {
      setSaving(false);
    }
  };

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <section className="stack">
      <div className="page-title-row">
        <div>
          <h1>User access</h1>
          <p className="muted-text">Provision clinician, administrator, and auditor accounts.</p>
        </div>
        <Button icon="plus" onClick={() => setModalOpen(true)}>
          New user
        </Button>
      </div>

      <Card>
        <CardHeader title="Provisioned users" icon="users" sub={`${users.length} accounts`} />
        <CardBody flush>
          {loading ? (
            <Loading />
          ) : users.length === 0 ? (
            <EmptyState icon="users" title="No users yet" message="Create the first account to get started." />
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
                  {sortedUsers.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <strong>{record.fullName}</strong>
                      </td>
                      <td>{record.email}</td>
                      <td>
                        <Badge tone={ROLE_TONE[record.role] || "neutral"}>{record.role}</Badge>
                      </td>
                      <td>
                        {record.practitionerRole
                          ? PRACTITIONER_ROLE_LABELS[record.practitionerRole] || record.practitionerRole
                          : "-"}
                      </td>
                      <td>{record.organization || "-"}</td>
                      <td>
                        <Badge tone={record.active === false ? "neutral" : "success"} dot>
                          {record.active === false ? "inactive" : "active"}
                        </Badge>
                      </td>
                      <td>{record.lastLoginAt ? formatDate(record.lastLoginAt) : "Never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        title="Create user"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button form="user-form" type="submit" loading={saving}>
              Create user
            </Button>
          </>
        }
      >
        {error ? (
          <p className="banner banner-error" style={{ marginBottom: "1rem" }}>
            <Icon name="alert" size={16} />
            {error}
          </p>
        ) : null}
        <form id="user-form" className="form-grid" onSubmit={onSubmit}>
          <Field label="Full name">
            <input value={form.fullName} onChange={update("fullName")} required />
          </Field>
          <Field label="Organization">
            <input value={form.organization} onChange={update("organization")} />
          </Field>
          <Field label="Email" span2>
            <input type="email" value={form.email} onChange={update("email")} required />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={update("role")}>
              <option value="practitioner">Practitioner</option>
              <option value="auditor">Auditor</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          {form.role === "practitioner" ? (
            <Field label="Practitioner type">
              <select value={form.practitionerRole} onChange={update("practitionerRole")}>
                {PRACTITIONER_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Password" hint="≥ 12 chars with upper, lower, number & symbol">
            <input
              type="password"
              value={form.password}
              onChange={update("password")}
              required
            />
          </Field>
        </form>
      </Modal>
    </section>
  );
};

export default UsersPage;
