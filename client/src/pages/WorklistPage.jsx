import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, fhirApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { bundleToResources, patientFullName, patientIdentifier } from "../utils/fhir.js";
import { TASK_CATEGORY_OPTIONS } from "../utils/catalog.js";
import {
  buildPatientRiskProfile,
  extractPatientIdFromAppointment,
  extractPatientIdFromReference,
  getTaskDueDate,
  groupByPatient,
  isTaskOpen,
  isTaskOverdue
} from "../utils/clinicalOps.js";
import { formatDate, initialsOf } from "../utils/display.js";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Loading, Modal, PriorityBadge, RiskBadge, StatTile } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const TASK_STATUS_OPTIONS = ["requested", "accepted", "in-progress", "on-hold", "completed", "cancelled"];
const PRIORITY_OPTIONS = ["routine", "urgent", "asap", "stat"];

const emptyTask = { patientId: "", ownerId: "", priority: "routine", category: "Care coordination", dueDate: "", description: "", note: "" };

const ownerReference = (task) => task?.owner?.reference || "";

const WorklistPage = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [bundles, setBundles] = useState(null);
  const [practitioners, setPractitioners] = useState([]);
  const [riskFilter, setRiskFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [formError, setFormError] = useState("");

  const loadData = async () => {
    const [patientB, conditionB, allergyB, medB, obsB, encB, apptB, taskB, practResp] = await Promise.all([
      fhirApi.listPatients(token),
      fhirApi.listConditions(token),
      fhirApi.listAllergies(token),
      fhirApi.listMedicationRequests(token),
      fhirApi.listObservations(token),
      fhirApi.listEncounters(token),
      fhirApi.listAppointments(token),
      fhirApi.listTasks(token),
      adminApi.listPractitioners(token).catch(() => ({ data: [] }))
    ]);

    const practitionerRecords = practResp.data || [];
    setPractitioners(practitionerRecords);
    setBundles({
      patients: bundleToResources(patientB),
      conditions: bundleToResources(conditionB),
      allergies: bundleToResources(allergyB),
      medications: bundleToResources(medB),
      observations: bundleToResources(obsB),
      encounters: bundleToResources(encB),
      appointments: bundleToResources(apptB),
      tasks: bundleToResources(taskB)
    });
    setTaskForm((prev) => ({
      ...prev,
      patientId: prev.patientId || bundleToResources(patientB)[0]?.id || "",
      ownerId: user.role === "practitioner" ? user.id : prev.ownerId || practitionerRecords[0]?.id || ""
    }));
  };

  useEffect(() => {
    setLoading(true);
    loadData()
      .catch((err) => toast.error(err.message || "Unable to load worklist"))
      .finally(() => setLoading(false));
  }, [token, user.id, user.role]);

  const model = useMemo(() => {
    if (!bundles) {
      return null;
    }
    const patientById = new Map(bundles.patients.map((p) => [p.id, p]));
    const practitionerById = new Map(practitioners.map((p) => [p.id, p]));
    const g = {
      conditions: groupByPatient(bundles.conditions, (i) => extractPatientIdFromReference(i.subject?.reference)),
      allergies: groupByPatient(bundles.allergies, (i) => extractPatientIdFromReference(i.patient?.reference)),
      medications: groupByPatient(bundles.medications, (i) => extractPatientIdFromReference(i.subject?.reference)),
      observations: groupByPatient(bundles.observations, (i) => extractPatientIdFromReference(i.subject?.reference)),
      encounters: groupByPatient(bundles.encounters, (i) => extractPatientIdFromReference(i.subject?.reference)),
      appointments: groupByPatient(bundles.appointments, (i) => extractPatientIdFromAppointment(i)),
      tasks: groupByPatient(bundles.tasks, (i) => extractPatientIdFromReference(i.for?.reference))
    };

    const rows = bundles.patients
      .map((patient) => {
        const patientTasks = g.tasks.get(patient.id) || [];
        const openTasks = patientTasks.filter(isTaskOpen);
        return {
          patient,
          profile: buildPatientRiskProfile({
            conditions: g.conditions.get(patient.id) || [],
            allergies: g.allergies.get(patient.id) || [],
            medications: g.medications.get(patient.id) || [],
            observations: g.observations.get(patient.id) || [],
            encounters: g.encounters.get(patient.id) || [],
            appointments: g.appointments.get(patient.id) || [],
            tasks: patientTasks
          }),
          openTasks,
          overdueCount: openTasks.filter((t) => isTaskOverdue(t)).length
        };
      })
      .sort((a, b) => b.profile.score - a.profile.score || b.overdueCount - a.overdueCount);

    const taskRows = bundles.tasks
      .filter((task) => String(task.status || "").toLowerCase() !== "completed")
      .sort((a, b) => {
        const overdueDiff = (isTaskOverdue(b) ? 1 : 0) - (isTaskOverdue(a) ? 1 : 0);
        if (overdueDiff !== 0) {
          return overdueDiff;
        }
        return new Date(getTaskDueDate(a) || 0) - new Date(getTaskDueDate(b) || 0);
      });

    const openTasks = bundles.tasks.filter(isTaskOpen);
    return {
      patientById,
      practitionerById,
      rows,
      taskRows,
      tasksByPatient: g.tasks,
      highRiskCount: rows.filter((r) => r.profile.tier === "high").length,
      openTaskCount: openTasks.length,
      overdueTaskCount: openTasks.filter((t) => isTaskOverdue(t)).length,
      careGapCount: rows.reduce((sum, r) => sum + r.profile.careGaps.length, 0)
    };
  }, [bundles, practitioners]);

  const filteredRows = useMemo(() => {
    if (!model) {
      return [];
    }
    return model.rows.filter((row) => {
      // Care coordination surfaces patients matching any of: an active disease, an
      // active allergy, a continuity visit due (no encounter in 180 days), no
      // follow-up appointment booked in the next 60 days, or at least one open task.
      const gapTitles = row.profile.careGaps.map((gap) => gap.title);
      const meetsCareCoordinationCriteria =
        row.profile.activeConditionCount > 0 ||
        row.profile.activeAllergyCount > 0 ||
        gapTitles.includes("Continuity-of-care visit due") ||
        gapTitles.includes("No upcoming follow-up appointment") ||
        row.openTasks.length > 0;
      if (!meetsCareCoordinationCriteria) {
        return false;
      }
      if (riskFilter !== "all" && row.profile.tier !== riskFilter) {
        return false;
      }
      if (ownerFilter === "all") {
        return true;
      }
      const open = model.tasksByPatient.get(row.patient.id)?.filter(isTaskOpen) || [];
      if (ownerFilter === "unassigned") {
        return open.some((t) => !ownerReference(t));
      }
      return open.some((t) => ownerReference(t) === `Practitioner/${ownerFilter}`);
    });
  }, [model, riskFilter, ownerFilter]);

  const updateTaskForm = (key) => (event) => setTaskForm((prev) => ({ ...prev, [key]: event.target.value }));

  const onCreateTask = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const ownerId = user.role === "practitioner" ? user.id : taskForm.ownerId || "";
      const owner = model.practitionerById.get(ownerId);
      const dueIso = taskForm.dueDate ? new Date(`${taskForm.dueDate}T23:59:59`).toISOString() : undefined;

      await fhirApi.createTask(token, {
        resourceType: "Task",
        status: "requested",
        intent: "order",
        priority: taskForm.priority,
        code: taskForm.category ? { text: taskForm.category } : undefined,
        description: taskForm.description.trim(),
        for: { reference: `Patient/${taskForm.patientId}` },
        owner: ownerId ? { reference: `Practitioner/${ownerId}`, display: owner?.fullName } : undefined,
        authoredOn: new Date().toISOString(),
        executionPeriod: dueIso ? { end: dueIso } : undefined,
        note: taskForm.note ? [{ text: taskForm.note.trim() }] : undefined
      });

      toast.success("Task created");
      setTaskForm((prev) => ({ ...prev, description: "", note: "", dueDate: "" }));
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err.message || "Unable to create task");
    } finally {
      setSaving(false);
    }
  };

  const onUpdateStatus = async (task, status) => {
    setUpdatingId(task.id);
    try {
      await fhirApi.updateTask(token, task.id, { ...task, status });
      setBundles((prev) =>
        prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) } : prev
      );
    } catch (err) {
      toast.error(err.message || "Unable to update task");
    } finally {
      setUpdatingId("");
    }
  };

  if (loading) {
    return <Loading label="Loading worklist…" />;
  }
  if (!model) {
    return null;
  }

  return (
    <section className="stack">
      <div className="page-title-row">
        <div>
          <h1>Worklist</h1>
          <p className="muted-text">Risk stratification, care gaps, and team task orchestration.</p>
        </div>
        <Button icon="plus" onClick={() => setModalOpen(true)}>
          New task
        </Button>
      </div>

      <div className="stat-grid">
        <StatTile label="High-risk patients" value={model.highRiskCount} icon="alert" tone={model.highRiskCount ? "critical" : undefined} />
        <StatTile label="Open care tasks" value={model.openTaskCount} icon="tasks" foot={`${model.overdueTaskCount} overdue`} />
        <StatTile label="Open care gaps" value={model.careGapCount} icon="problem" />
        <StatTile label="Patients" value={bundles.patients.length} icon="patients" />
      </div>

      <Card>
        <CardHeader
          title="Care coordination"
          icon="heart"
          actions={
            <div className="row" style={{ gap: "0.5rem" }}>
              <select className="input" style={{ width: 130 }} value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
                <option value="all">All tiers</option>
                <option value="high">High risk</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select className="input" style={{ width: 160 }} value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option value="all">All owners</option>
                <option value="unassigned">Unassigned</option>
                {practitioners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </div>
          }
        />
        <CardBody flush>
          {filteredRows.length === 0 ? (
            <EmptyState icon="patients" title="No patients match" message="Adjust the risk or owner filters." />
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Risk</th>
                    <th>Alerts</th>
                    <th>Care gaps</th>
                    <th>Open tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.patient.id}>
                      <td>
                        <div className="row" style={{ gap: "0.55rem" }}>
                          <span className="avatar" style={{ width: 30, height: 30, fontSize: "0.72rem" }}>
                            {initialsOf(patientFullName(row.patient))}
                          </span>
                          <div>
                            <Link to={`/patients/${row.patient.id}`} className="inline-link">
                              {patientFullName(row.patient)}
                            </Link>
                            <span className="sub">{patientIdentifier(row.patient)}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <RiskBadge tier={row.profile.tier} score={row.profile.score} />
                      </td>
                      <td>{row.profile.safetyAlerts.length}</td>
                      <td>{row.profile.careGaps.length}</td>
                      <td>
                        {row.openTasks.length}
                        {row.overdueCount > 0 ? (
                          <Badge tone="critical" style={{ marginLeft: 6 }}>
                            {row.overdueCount} overdue
                          </Badge>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Task inbox" icon="tasks" sub={`${model.taskRows.length} tasks`} />
        <CardBody flush>
          {model.taskRows.length === 0 ? (
            <EmptyState icon="check" title="No tasks" message="No care tasks have been created yet." />
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Patient</th>
                    <th>Owner</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {model.taskRows.map((task) => {
                    const patient = model.patientById.get(extractPatientIdFromReference(task.for?.reference));
                    const owner = task.owner?.display || model.practitionerById.get(ownerReference(task).split("/")[1])?.fullName || "—";
                    return (
                      <tr key={task.id}>
                        <td>
                          {task.description}
                          {task.code?.text ? <span className="sub">{task.code.text}</span> : null}
                        </td>
                        <td>
                          {patient ? (
                            <Link to={`/patients/${patient.id}`} className="inline-link">
                              {patientFullName(patient)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{owner}</td>
                        <td>
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className="nowrap">
                          {formatDate(getTaskDueDate(task))}
                          {isTaskOverdue(task) ? <span className="sub" style={{ color: "var(--critical)" }}>Overdue</span> : null}
                        </td>
                        <td>
                          <select
                            className="input"
                            style={{ width: 140 }}
                            value={task.status}
                            disabled={updatingId === task.id}
                            onChange={(event) => onUpdateStatus(task, event.target.value)}
                          >
                            {TASK_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        title="Create care task"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button form="task-form" type="submit" loading={saving} disabled={!taskForm.patientId}>
              Create task
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
        <form id="task-form" className="form-grid" onSubmit={onCreateTask}>
          <Field label="Patient" span2>
            <select value={taskForm.patientId} onChange={updateTaskForm("patientId")} required>
              {bundles.patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientFullName(patient)} ({patientIdentifier(patient)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee">
            <select value={user.role === "practitioner" ? user.id : taskForm.ownerId} onChange={updateTaskForm("ownerId")} disabled={user.role === "practitioner"}>
              {user.role === "admin" ? <option value="">Unassigned</option> : null}
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={taskForm.priority} onChange={updateTaskForm("priority")}>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select value={taskForm.category} onChange={updateTaskForm("category")}>
              {TASK_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={taskForm.dueDate} onChange={updateTaskForm("dueDate")} />
          </Field>
          <Field label="Task summary" span2>
            <input value={taskForm.description} onChange={updateTaskForm("description")} required />
          </Field>
          <Field label="Note" span2>
            <textarea rows="2" value={taskForm.note} onChange={updateTaskForm("note")} />
          </Field>
        </form>
      </Modal>
    </section>
  );
};

export default WorklistPage;
