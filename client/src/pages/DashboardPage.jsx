import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminApi, fhirApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { bundleToResources, patientFullName, patientMrn } from "../utils/fhir.js";
import {
  buildPatientRiskProfile,
  calculateDayNoShowRate,
  extractPatientIdFromAppointment,
  extractPatientIdFromReference,
  getTaskDueDate,
  groupByPatient,
  isTaskOpen,
  isTaskOverdue
} from "../utils/clinicalOps.js";
import { calculateAge, formatTime, genderShort, initialsOf } from "../utils/display.js";
import { Badge, Card, CardBody, CardHeader, EmptyState, Loading, PriorityBadge, RiskBadge, StatTile, StatusBadge } from "../components/ui.jsx";

const isToday = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date();
  return date.toDateString() === now.toDateString();
};

const DashboardPage = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      const [
        patientBundle,
        conditionBundle,
        allergyBundle,
        medicationBundle,
        observationBundle,
        encounterBundle,
        appointmentBundle,
        taskBundle
      ] = await Promise.all([
        fhirApi.listPatients(token),
        fhirApi.listConditions(token),
        fhirApi.listAllergies(token),
        fhirApi.listMedicationRequests(token),
        fhirApi.listObservations(token),
        fhirApi.listEncounters(token),
        fhirApi.listAppointments(token),
        fhirApi.listTasks(token)
      ]);

      const patients = bundleToResources(patientBundle);
      const conditions = bundleToResources(conditionBundle);
      const allergies = bundleToResources(allergyBundle);
      const medications = bundleToResources(medicationBundle);
      const observations = bundleToResources(observationBundle);
      const encounters = bundleToResources(encounterBundle);
      const appointments = bundleToResources(appointmentBundle);
      const tasks = bundleToResources(taskBundle);

      let userCount = 0;
      if (user.role === "admin") {
        userCount = (await adminApi.listUsers(token).catch(() => ({ total: 0 }))).total;
      }

      setData({ patients, conditions, allergies, medications, observations, encounters, appointments, tasks, userCount });
    };

    load()
      .catch((err) => setError(err.message || "Unable to load dashboard"))
      .finally(() => setLoading(false));
  }, [token, user.role]);

  const model = useMemo(() => {
    if (!data) {
      return null;
    }
    const patientById = new Map(data.patients.map((patient) => [patient.id, patient]));

    const groups = {
      conditions: groupByPatient(data.conditions, (item) => extractPatientIdFromReference(item.subject?.reference)),
      allergies: groupByPatient(data.allergies, (item) => extractPatientIdFromReference(item.patient?.reference)),
      medications: groupByPatient(data.medications, (item) => extractPatientIdFromReference(item.subject?.reference)),
      observations: groupByPatient(data.observations, (item) => extractPatientIdFromReference(item.subject?.reference)),
      encounters: groupByPatient(data.encounters, (item) => extractPatientIdFromReference(item.subject?.reference)),
      appointments: groupByPatient(data.appointments, (item) => extractPatientIdFromAppointment(item)),
      tasks: groupByPatient(data.tasks, (item) => extractPatientIdFromReference(item.for?.reference))
    };

    const riskRows = data.patients
      .map((patient) => ({
        patient,
        profile: buildPatientRiskProfile({
          conditions: groups.conditions.get(patient.id) || [],
          allergies: groups.allergies.get(patient.id) || [],
          medications: groups.medications.get(patient.id) || [],
          observations: groups.observations.get(patient.id) || [],
          encounters: groups.encounters.get(patient.id) || [],
          appointments: groups.appointments.get(patient.id) || [],
          tasks: groups.tasks.get(patient.id) || []
        })
      }))
      .sort((a, b) => b.profile.score - a.profile.score);

    const openTasks = data.tasks.filter(isTaskOpen);
    const overdueTasks = openTasks.filter((task) => isTaskOverdue(task));
    const todaysAppointments = data.appointments
      .filter(
        (appointment) =>
          isToday(appointment.start) && !["cancelled", "proposed", "pending"].includes(appointment.status)
      )
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    const priorityTasks = [...openTasks].sort((a, b) => {
      const overdueDiff = (isTaskOverdue(b) ? 1 : 0) - (isTaskOverdue(a) ? 1 : 0);
      if (overdueDiff !== 0) {
        return overdueDiff;
      }
      return new Date(getTaskDueDate(a) || 0) - new Date(getTaskDueDate(b) || 0);
    });

    return {
      patientById,
      riskRows,
      highRisk: riskRows.filter((row) => row.profile.tier === "high"),
      openTaskCount: openTasks.length,
      overdueTaskCount: overdueTasks.length,
      todaysAppointments,
      priorityTasks,
      noShowRate: calculateDayNoShowRate(data.appointments),
      careGapCount: riskRows.reduce((sum, row) => sum + row.profile.careGaps.length, 0)
    };
  }, [data]);

  if (loading) {
    return <Loading label="Loading clinical dashboard…" />;
  }
  if (error) {
    return <p className="banner banner-error">{error}</p>;
  }
  if (!model) {
    return null;
  }

  const firstName = (user.fullName || "").split(" ")[0] || user.fullName;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const apptPatientName = (appointment) => {
    const patient = model.patientById.get(extractPatientIdFromAppointment(appointment));
    return patient ? patientFullName(patient) : "Unknown patient";
  };
  const taskPatient = (task) => model.patientById.get(extractPatientIdFromReference(task.for?.reference));

  const tiles =
    user.role === "admin"
      ? [
          { label: "Patients", value: data.patients.length, icon: "patients", to: "/patients" },
          { label: "High-risk patients", value: model.highRisk.length, icon: "alert", tone: model.highRisk.length ? "critical" : undefined },
          { label: "Open care tasks", value: model.openTaskCount, icon: "tasks", foot: `${model.overdueTaskCount} overdue` },
          { label: "Open care gaps", value: model.careGapCount, icon: "problem" },
          { label: "No-show rate (today)", value: `${model.noShowRate}%`, icon: "calendar" },
          { label: "Users", value: data.userCount, icon: "users", to: "/users" }
        ]
      : user.role === "auditor"
      ? [
          { label: "Patients", value: data.patients.length, icon: "patients" },
          { label: "Appointments", value: data.appointments.length, icon: "calendar" },
          { label: "Care tasks", value: data.tasks.length, icon: "tasks" },
          { label: "High-risk patients", value: model.highRisk.length, icon: "alert" }
        ]
      : [
          { label: "Today's appointments", value: model.todaysAppointments.length, icon: "calendar", to: "/schedule" },
          { label: "Open tasks", value: model.openTaskCount, icon: "tasks", to: "/worklist" },
          { label: "Overdue tasks", value: model.overdueTaskCount, icon: "clock", tone: model.overdueTaskCount ? "critical" : undefined, to: "/worklist" },
          { label: "High-risk patients", value: model.highRisk.length, icon: "alert", tone: model.highRisk.length ? "warning" : undefined }
        ];

  return (
    <section className="stack">
      <div className="page-title-row">
        <div>
          <h1>Good day, {firstName}</h1>
          <p className="muted-text">
            {today} · signed in as <strong>{user.role}</strong>
          </p>
        </div>
      </div>

      <div className="stat-grid">
        {tiles.map(({ to, ...tile }) => (
          <StatTile key={tile.label} {...tile} onClick={to ? () => navigate(to) : undefined} />
        ))}
      </div>

      <div className="form-grid" style={{ gap: "1.1rem" }}>
        <Card>
          <CardHeader
            title={user.role === "practitioner" ? "Today's schedule" : "Today's appointments"}
            icon="calendar"
            actions={
              <Link to="/schedule" className="inline-link">
                View all
              </Link>
            }
          />
          <CardBody flush>
            {model.todaysAppointments.length === 0 ? (
              <EmptyState icon="calendar" title="Nothing scheduled today" message="No appointments on the calendar." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <tbody>
                    {model.todaysAppointments.slice(0, 8).map((appointment) => (
                      <tr key={appointment.id}>
                        <td className="nowrap" style={{ width: 80 }}>
                          <strong>{formatTime(appointment.start)}</strong>
                        </td>
                        <td>
                          {apptPatientName(appointment)}
                          <span className="sub">{appointment.reasonCode?.[0]?.text || appointment.description || "—"}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <StatusBadge status={appointment.status} />
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
          <CardHeader
            title="Priority tasks"
            icon="tasks"
            actions={
              (user.role === "admin" || user.role === "practitioner") ? (
                <Link to="/worklist" className="inline-link">
                  Open worklist
                </Link>
              ) : null
            }
          />
          <CardBody flush>
            {model.priorityTasks.length === 0 ? (
              <EmptyState icon="check" title="All caught up" message="No open tasks right now." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <tbody>
                    {model.priorityTasks.slice(0, 8).map((task) => {
                      const patient = taskPatient(task);
                      return (
                        <tr key={task.id}>
                          <td>
                            {task.description}
                            <span className="sub">
                              {patient ? (
                                <Link to={`/patients/${patient.id}`} className="inline-link">
                                  {patientFullName(patient)}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }} className="nowrap">
                            <PriorityBadge priority={task.priority} />
                            {isTaskOverdue(task) ? (
                              <Badge tone="critical" className="right" style={{ marginLeft: 6 }}>
                                overdue
                              </Badge>
                            ) : null}
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
      </div>

      <Card>
        <CardHeader
          title="High-risk patients"
          icon="alert"
          sub="Risk stratified from active alerts, care gaps, and overdue tasks"
          actions={
            (user.role === "admin" || user.role === "practitioner") ? (
              <Link to="/worklist" className="inline-link">
                Care coordination
              </Link>
            ) : null
          }
        />
        <CardBody flush>
          {model.highRisk.length === 0 ? (
            <EmptyState icon="check" title="No high-risk patients" message="No patients currently meet the high-risk threshold." />
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
                  {model.highRisk.slice(0, 8).map((row) => {
                    const age = calculateAge(row.patient.birthDate);
                    return (
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
                              <span className="sub">
                                MRN {patientMrn(row.patient)} · {age != null ? `${age}y ` : ""}
                                {genderShort(row.patient.gender)}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <RiskBadge tier={row.profile.tier} score={row.profile.score} />
                        </td>
                        <td>{row.profile.safetyAlerts.length}</td>
                        <td>{row.profile.careGaps.length}</td>
                        <td>{row.profile.openTaskCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </section>
  );
};

export default DashboardPage;
