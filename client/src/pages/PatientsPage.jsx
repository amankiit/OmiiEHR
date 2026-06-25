import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi, fhirApi } from "../api.js";
import {
  bundleToResources,
  patientFullName,
  patientMrn,
  patientPid,
  patientRegistrationStatus,
  patientRegistrationSource
} from "../utils/fhir.js";
import { calculateAge, genderShort, initialsOf } from "../utils/display.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Loading, Modal } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const PAGE_SIZE = 10;

const emptyForm = {
  mrn: "",
  givenName: "",
  familyName: "",
  gender: "unknown",
  birthDate: "",
  phone: "",
  email: "",
  line1: "",
  city: "",
  state: "",
  postalCode: ""
};

const PatientsPage = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState("");
  const [formError, setFormError] = useState("");

  const isAdmin = user.role === "admin";
  const canCreate = isAdmin;

  const loadPatients = async () => {
    const bundle = await fhirApi.listPatients(token);
    setPatients(bundleToResources(bundle));
  };

  useEffect(() => {
    setLoading(true);
    loadPatients()
      .catch((err) => toast.error(err.message || "Unable to load patients"))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return patients.filter((patient) => {
      const status = patientRegistrationStatus(patient);
      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [patientFullName(patient), patientMrn(patient), patientPid(patient), patient.birthDate]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [patients, query, statusFilter]);

  const requestedCount = useMemo(
    () => patients.filter((patient) => patientRegistrationStatus(patient) === "requested").length,
    [patients]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  // Reset to the first page whenever the result set changes.
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const onApprove = async (event, patient) => {
    event.stopPropagation();
    setApprovingId(patient.id);
    try {
      await adminApi.approvePatient(token, patient.id);
      toast.success("Patient approved");
      await loadPatients();
    } catch (err) {
      toast.error(err.message || "Unable to approve patient");
    } finally {
      setApprovingId("");
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const telecom = [];
      if (form.phone) telecom.push({ system: "phone", value: form.phone });
      if (form.email) telecom.push({ system: "email", value: form.email });

      const address =
        form.line1 || form.city || form.state || form.postalCode
          ? [{ line: form.line1 ? [form.line1] : [], city: form.city, state: form.state, postalCode: form.postalCode }]
          : [];

      await fhirApi.createPatient(token, {
        resourceType: "Patient",
        active: true,
        identifier: form.mrn ? [{ system: "urn:mrn", value: form.mrn }] : undefined,
        name: [{ family: form.familyName, given: form.givenName ? [form.givenName] : [] }],
        telecom,
        gender: form.gender,
        birthDate: form.birthDate || undefined,
        address
      });

      setForm(emptyForm);
      setModalOpen(false);
      toast.success("Patient registered");
      await loadPatients();
    } catch (err) {
      setFormError(err.message || "Unable to create patient");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <div className="page-title-row">
        <div>
          <h1>Patients</h1>
          <p className="muted-text">
            {patients.length} {isAdmin ? "patients" : "patients in your panel"}
            {isAdmin && requestedCount > 0 ? ` · ${requestedCount} awaiting approval` : ""}
          </p>
        </div>
        {canCreate ? (
          <Button icon="plus" onClick={() => setModalOpen(true)}>
            New patient
          </Button>
        ) : null}
      </div>

      {!isAdmin ? (
        <p className="banner banner-info">
          <Icon name="info" size={16} />
          Showing only patients with an approved appointment or a prior encounter with you.
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Patient registry"
          icon="patients"
          actions={
            <div className="row" style={{ gap: "0.5rem" }}>
              <div className="global-search-input" style={{ width: 240 }}>
                <Icon name="search" size={16} />
                <input
                  placeholder="Search name, MRN, DOB…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {isAdmin ? (
                <select className="input" style={{ width: 150 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="requested">Inactive</option>
                  <option value="active">Active</option>
                </select>
              ) : null}
            </div>
          }
        />
        <CardBody flush>
          {loading ? (
            <Loading label="Loading patients…" />
          ) : filtered.length === 0 ? (
            <EmptyState icon="patients" title="No patients found" message="Try adjusting your search or filters." />
          ) : (
            <>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>MRN</th>
                    <th>PID</th>
                    <th>Age / Sex</th>
                    <th>Birth date</th>
                    <th>Status</th>
                    {isAdmin ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((patient) => {
                    const age = calculateAge(patient.birthDate);
                    const status = patientRegistrationStatus(patient);
                    const requested = status === "requested";
                    return (
                      <tr key={patient.id} className="row-clickable" onClick={() => navigate(`/patients/${patient.id}`)}>
                        <td>
                          <div className="row" style={{ gap: "0.6rem" }}>
                            <span className="avatar" style={{ width: 32, height: 32, fontSize: "0.74rem" }}>
                              {initialsOf(patientFullName(patient))}
                            </span>
                            <strong>{patientFullName(patient)}</strong>
                          </div>
                        </td>
                        <td>{patientMrn(patient)}</td>
                        <td>{patientPid(patient)}</td>
                        <td>
                          {age != null ? `${age}y` : "-"} <Badge tone="neutral">{genderShort(patient.gender)}</Badge>
                        </td>
                        <td>{patient.birthDate || "-"}</td>
                        <td>
                          <Badge tone={requested ? "warning" : "success"} dot>
                            {requested ? "inactive" : "active"}
                          </Badge>
                          {patientRegistrationSource(patient) === "portal" ? <span className="sub">via portal</span> : null}
                        </td>
                        {isAdmin ? (
                          <td style={{ textAlign: "right" }}>
                            {requested ? (
                              <Button size="xs" disabled={approvingId === patient.id} onClick={(event) => onApprove(event, patient)}>
                                Approve
                              </Button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="row" style={{ gap: "0.5rem" }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="chevronRight"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        title="Register new patient"
        size="lg"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button form="patient-form" type="submit" loading={saving}>
              Create patient
            </Button>
          </>
        }
      >
        {formError ? (
          <p className="banner banner-error" style={{ marginBottom: "1rem" }}>
            <Icon name="alert" size={16} />
            {formError}
          </p>
        ) : null}
        <form id="patient-form" className="form-grid" onSubmit={onSubmit}>
          <Field label="MRN">
            <input value={form.mrn} onChange={update("mrn")} placeholder="Optional" />
          </Field>
          <Field label="Gender">
            <select value={form.gender} onChange={update("gender")}>
              <option value="unknown">Unknown</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Given name">
            <input value={form.givenName} onChange={update("givenName")} required />
          </Field>
          <Field label="Family name">
            <input value={form.familyName} onChange={update("familyName")} required />
          </Field>
          <Field label="Birth date">
            <input type="date" value={form.birthDate} onChange={update("birthDate")} />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={update("phone")} />
          </Field>
          <Field label="Email" span2>
            <input type="email" value={form.email} onChange={update("email")} />
          </Field>
          <Field label="Address line" span2>
            <input value={form.line1} onChange={update("line1")} />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={update("city")} />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={update("state")} />
          </Field>
          <Field label="Postal code">
            <input value={form.postalCode} onChange={update("postalCode")} />
          </Field>
        </form>
      </Modal>
    </section>
  );
};

export default PatientsPage;
