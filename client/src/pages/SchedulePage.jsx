import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, fhirApi } from "../api.js";
import {
  buildDailySlots,
  getDayRangeFromDateInput,
  getNextBookableDateInput,
  getPractitionerIdFromAppointment,
  getSlotRange,
  isBlockingAppointmentStatus,
  isBookableDateInput,
  isSlotUnavailable,
  practitionerHasAvailableSlot,
  toDateInputValue
} from "../utils/scheduling.js";
import { SERVICE_CATEGORY_OPTIONS, ENCOUNTER_TYPES, PRACTITIONER_ROLES } from "../utils/catalog.js";
import { bundleToResources, patientFullName, patientIdentifier, reasonText } from "../utils/fhir.js";
import { formatTime, relativeDay } from "../utils/display.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Loading, Modal, StatTile, StatusBadge } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const canEdit = (role) => role === "admin" || role === "practitioner";

// Allowed next statuses per current appointment status.
const TRANSITIONS = {
  proposed: [
    { status: "booked", label: "Approve", variant: "primary" },
    { status: "cancelled", label: "Decline", variant: "ghost" }
  ],
  pending: [
    { status: "booked", label: "Approve", variant: "primary" },
    { status: "cancelled", label: "Decline", variant: "ghost" }
  ],
  booked: [
    { status: "arrived", label: "Arrive", variant: "secondary" },
    { status: "noshow", label: "No-show", variant: "ghost" },
    { status: "cancelled", label: "Cancel", variant: "ghost" }
  ],
  arrived: [
    { status: "checked-in", label: "Check in", variant: "secondary" },
    { status: "noshow", label: "No-show", variant: "ghost" }
  ],
  "checked-in": [{ status: "fulfilled", label: "Complete", variant: "primary" }],
  waitlist: [{ status: "booked", label: "Book", variant: "secondary" }]
};

const emptyForm = {
  patientId: "",
  appointmentDate: getNextBookableDateInput(),
  slotValue: "",
  practitionerType: "all",
  practitionerId: "",
  serviceCategory: "Outpatient",
  reason: "",
  description: "",
  comment: ""
};

const SchedulePage = () => {
  const { token, user } = useAuth();
  const toast = useToast();
  const [patients, setPatients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [slotAppointments, setSlotAppointments] = useState([]);
  const [viewDate, setViewDate] = useState(getNextBookableDateInput());
  const [statusFilter, setStatusFilter] = useState("all");
  const [practitionerTypeFilter, setPractitionerTypeFilter] = useState("all");
  const [nameSearch, setNameSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [formError, setFormError] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleSlot, setRescheduleSlot] = useState("");
  const [rescheduleAppts, setRescheduleAppts] = useState([]);
  const [rescheduling, setRescheduling] = useState(false);
  const [encounterTarget, setEncounterTarget] = useState(null);
  const [encounterPatient, setEncounterPatient] = useState("");
  const [encounterForm, setEncounterForm] = useState({ typeCode: "185349003", reason: "", location: "", s: "", o: "", a: "", p: "" });
  const [encounterSaving, setEncounterSaving] = useState(false);
  const [encounterError, setEncounterError] = useState("");

  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const practitionerMap = useMemo(() => new Map(practitioners.map((p) => [p.id, p])), [practitioners]);

  const loadAppointments = useCallback(async () => {
    const { start, end } = getDayRangeFromDateInput(viewDate);
    const response = await fhirApi.listAppointments(token, { from: start.toISOString(), to: end.toISOString() });
    setAppointments(bundleToResources(response));
  }, [token, viewDate]);

  const loadRequests = useCallback(async () => {
    const all = bundleToResources(await fhirApi.listAppointments(token, {}));
    const confirmed = all.filter((a) => ["booked", "arrived", "checked-in", "fulfilled"].includes(a.status));
    const proposed = all
      .filter((a) => ["proposed", "pending"].includes(a.status))
      .map((request) => {
        const practitionerId = getPractitionerIdFromAppointment(request);
        const start = new Date(request.start).getTime();
        const end = new Date(request.end).getTime();
        const conflict = confirmed.some(
          (c) =>
            getPractitionerIdFromAppointment(c) === practitionerId &&
            new Date(c.start).getTime() < end &&
            new Date(c.end).getTime() > start
        );
        return { ...request, conflict };
      });
    setRequests(proposed);
  }, [token]);

  const loadSlotAppointments = useCallback(
    async (dateInput) => {
      if (!isBookableDateInput(dateInput)) {
        setSlotAppointments([]);
        return;
      }
      const { start, end } = getDayRangeFromDateInput(dateInput);
      const response = await fhirApi.listAppointments(token, { from: start.toISOString(), to: end.toISOString() });
      setSlotAppointments(bundleToResources(response));
    },
    [token]
  );

  useEffect(() => {
    setLoading(true);
    const loadBase = async () => {
      const [patientBundle, practitionerResponse] = await Promise.all([
        fhirApi.listPatients(token),
        adminApi.listPractitioners(token)
      ]);
      const patientResources = bundleToResources(patientBundle);
      const practitionerResources = practitionerResponse.data || [];
      setPatients(patientResources);
      setPractitioners(practitionerResources);
      setForm((prev) => ({
        ...prev,
        patientId: prev.patientId || patientResources[0]?.id || "",
        practitionerId: user.role === "practitioner" ? user.id : prev.practitionerId || practitionerResources[0]?.id || ""
      }));
    };
    loadBase()
      .catch((err) => toast.error(err.message || "Unable to load schedule"))
      .finally(() => setLoading(false));
  }, [token, user.id, user.role]);

  useEffect(() => {
    loadAppointments().catch((err) => toast.error(err.message || "Unable to load appointments"));
  }, [loadAppointments]);

  useEffect(() => {
    loadRequests().catch(() => {});
  }, [loadRequests]);

  useEffect(() => {
    if (!rescheduleTarget || !isBookableDateInput(rescheduleDate)) {
      setRescheduleAppts([]);
      return;
    }
    const practitionerId = getPractitionerIdFromAppointment(rescheduleTarget);
    const { start, end } = getDayRangeFromDateInput(rescheduleDate);
    fhirApi
      .listAppointments(token, {
        practitioner: `Practitioner/${practitionerId}`,
        from: start.toISOString(),
        to: end.toISOString()
      })
      .then((response) => setRescheduleAppts(bundleToResources(response)))
      .catch(() => setRescheduleAppts([]));
  }, [token, rescheduleTarget, rescheduleDate]);

  const rescheduleSlots = useMemo(() => {
    if (!rescheduleTarget) {
      return [];
    }
    const practitionerId = getPractitionerIdFromAppointment(rescheduleTarget);
    return buildDailySlots().map((slot) => ({
      ...slot,
      unavailable: isSlotUnavailable({
        appointments: rescheduleAppts,
        practitionerId,
        dateInput: rescheduleDate,
        slotValue: slot.value
      })
    }));
  }, [rescheduleTarget, rescheduleAppts, rescheduleDate]);

  useEffect(() => {
    loadSlotAppointments(form.appointmentDate).catch(() => {});
  }, [form.appointmentDate, loadSlotAppointments]);

  const scopedPractitioners = useMemo(
    () => (user.role === "practitioner" ? practitioners.filter((p) => p.id === user.id) : practitioners),
    [practitioners, user.id, user.role]
  );

  const availablePractitioners = useMemo(
    () =>
      scopedPractitioners.filter((p) =>
        practitionerHasAvailableSlot({ appointments: slotAppointments, practitionerId: p.id, dateInput: form.appointmentDate })
      ),
    [scopedPractitioners, slotAppointments, form.appointmentDate]
  );

  // Book dialog: narrow the available practitioners by the chosen specialty filter.
  const bookablePractitioners = useMemo(
    () =>
      form.practitionerType === "all"
        ? availablePractitioners
        : availablePractitioners.filter((p) => p.practitionerRole === form.practitionerType),
    [availablePractitioners, form.practitionerType]
  );

  const slotOptions = useMemo(
    () =>
      buildDailySlots().map((slot) => ({
        ...slot,
        unavailable:
          !form.practitionerId ||
          isSlotUnavailable({
            appointments: slotAppointments,
            practitionerId: form.practitionerId,
            dateInput: form.appointmentDate,
            slotValue: slot.value
          })
      })),
    [slotAppointments, form.practitionerId, form.appointmentDate]
  );

  useEffect(() => {
    setForm((prev) => {
      const stillAvailable = bookablePractitioners.some((p) => p.id === prev.practitionerId);
      if (stillAvailable || user.role === "practitioner") {
        return prev;
      }
      return { ...prev, practitionerId: bookablePractitioners[0]?.id || "" };
    });
  }, [bookablePractitioners, user.role]);

  useEffect(() => {
    setForm((prev) => {
      const ok = slotOptions.some((slot) => slot.value === prev.slotValue && !slot.unavailable);
      if (ok) {
        return prev;
      }
      return { ...prev, slotValue: slotOptions.find((slot) => !slot.unavailable)?.value || "" };
    });
  }, [slotOptions]);

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const onBook = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (!isBookableDateInput(form.appointmentDate)) {
        throw new Error("Appointments can only be booked Monday to Saturday");
      }
      const practitioner = practitionerMap.get(form.practitionerId);
      if (!practitioner) {
        throw new Error("Select an available practitioner");
      }
      const slotRange = getSlotRange(form.appointmentDate, form.slotValue);
      if (!slotRange) {
        throw new Error("Select a valid appointment slot");
      }

      await fhirApi.createAppointment(token, {
        resourceType: "Appointment",
        status: "booked",
        description: form.description,
        serviceCategory: form.serviceCategory ? [{ text: form.serviceCategory }] : undefined,
        start: slotRange.start.toISOString(),
        end: slotRange.end.toISOString(),
        minutesDuration: 15,
        participant: [
          { actor: { reference: `Patient/${form.patientId}` }, status: "accepted" },
          { actor: { reference: `Practitioner/${practitioner.id}`, display: practitioner.fullName }, status: "accepted" }
        ],
        reasonCode: form.reason ? [{ text: form.reason }] : undefined,
        comment: form.comment || undefined
      });

      toast.success("Appointment booked");
      setForm((prev) => ({ ...prev, slotValue: "", reason: "", description: "", comment: "" }));
      setModalOpen(false);
      await Promise.all([loadAppointments(), loadSlotAppointments(form.appointmentDate)]);
    } catch (err) {
      setFormError(err.message || "Unable to book appointment");
    } finally {
      setSaving(false);
    }
  };

  const openReschedule = (appointment) => {
    setRescheduleTarget(appointment);
    setRescheduleDate(toDateInputValue(new Date(appointment.start)));
    setRescheduleSlot("");
  };

  // After check-in the server opens the visit's encounter — load it so the clinician documents it.
  const openEncounterDoc = async (appointment) => {
    try {
      const encounter = bundleToResources(
        await fhirApi.listEncounters(token, { appointment: `Appointment/${appointment.id}` })
      )[0];
      if (!encounter) {
        return;
      }
      setEncounterTarget(encounter);
      setEncounterPatient(apptPatientName(appointment));
      setEncounterError("");
      setEncounterForm({
        typeCode: encounter.type?.[0]?.coding?.[0]?.code || "185349003",
        reason: encounter.reasonCode?.[0]?.text || "",
        location: encounter.location?.[0]?.location?.display || "",
        s: "",
        o: "",
        a: "",
        p: ""
      });
    } catch {
      // Non-blocking: check-in already succeeded.
    }
  };

  const changeStatus = async (appointment, status) => {
    setUpdatingId(appointment.id);
    try {
      await fhirApi.updateAppointment(token, appointment.id, { ...appointment, status });
      toast.success(status === "checked-in" ? "Checked in — document the encounter" : `Marked ${status}`);
      await Promise.all([loadAppointments(), loadRequests(), loadSlotAppointments(form.appointmentDate)]);
      if (status === "checked-in") {
        await openEncounterDoc(appointment);
      }
    } catch (err) {
      // Slot taken by a confirmed appointment → let staff pick a new time.
      if (status === "booked" && (err.status === 409 || /not available/i.test(err.message || ""))) {
        toast.error("That slot is occupied — choose a new time.");
        openReschedule(appointment);
      } else {
        toast.error(err.message || "Unable to update appointment");
      }
    } finally {
      setUpdatingId("");
    }
  };

  const submitReschedule = async (event) => {
    event.preventDefault();
    if (!rescheduleTarget) {
      return;
    }
    setRescheduling(true);
    try {
      const slotRange = getSlotRange(rescheduleDate, rescheduleSlot);
      if (!slotRange) {
        throw new Error("Choose an available slot");
      }
      await fhirApi.updateAppointment(token, rescheduleTarget.id, {
        ...rescheduleTarget,
        start: slotRange.start.toISOString(),
        end: slotRange.end.toISOString(),
        minutesDuration: 15,
        status: "booked"
      });
      toast.success("Request rescheduled and approved");
      setRescheduleTarget(null);
      await Promise.all([loadAppointments(), loadRequests(), loadSlotAppointments(form.appointmentDate)]);
    } catch (err) {
      toast.error(err.message || "Unable to reschedule");
    } finally {
      setRescheduling(false);
    }
  };

  const submitEncounter = async (event) => {
    event.preventDefault();
    if (!encounterTarget) {
      return;
    }
    setEncounterSaving(true);
    setEncounterError("");
    try {
      const f = encounterForm;
      const type = ENCOUNTER_TYPES.find((option) => option.code === f.typeCode) || ENCOUNTER_TYPES[0];
      const soap = [f.s && `S: ${f.s}`, f.o && `O: ${f.o}`, f.a && `A: ${f.a}`, f.p && `P: ${f.p}`]
        .filter(Boolean)
        .join("\n");
      await fhirApi.updateEncounter(token, encounterTarget.id, {
        ...encounterTarget,
        status: "in-progress",
        type: [{ coding: [{ system: "http://snomed.info/sct", code: type.code, display: type.display }] }],
        reasonCode: f.reason ? [{ text: f.reason }] : undefined,
        location: f.location ? [{ location: { display: f.location } }] : undefined,
        note: soap ? [{ text: soap }] : undefined
      });
      toast.success("Encounter documented");
      setEncounterTarget(null);
    } catch (err) {
      setEncounterError(err.message || "Unable to save encounter");
    } finally {
      setEncounterSaving(false);
    }
  };

  const updateEncounterField = (key) => (event) =>
    setEncounterForm((prev) => ({ ...prev, [key]: event.target.value }));

  // Appointments for the selected day, narrowed by practitioner specialty and a
  // free-text name search (matches practitioner or patient name). Drives the metric boxes.
  const dayAppointments = useMemo(() => {
    const term = nameSearch.trim().toLowerCase();
    return appointments.filter((appointment) => {
      const practitioner = practitionerMap.get(getPractitionerIdFromAppointment(appointment));
      if (practitionerTypeFilter !== "all" && practitioner?.practitionerRole !== practitionerTypeFilter) {
        return false;
      }
      if (term) {
        const practitionerName = (practitioner?.fullName || "").toLowerCase();
        const patientActor = appointment.participant?.find((p) =>
          String(p.actor?.reference || "").startsWith("Patient/")
        )?.actor;
        const patient = patientMap.get(patientActor?.reference?.split("/")[1]);
        const patientName = (patient ? patientFullName(patient) : patientActor?.display || "").toLowerCase();
        if (!practitionerName.includes(term) && !patientName.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [appointments, practitionerTypeFilter, nameSearch, practitionerMap, patientMap]);

  // The table additionally applies the status filter.
  const filtered = useMemo(
    () => dayAppointments.filter((appointment) => statusFilter === "all" || appointment.status === statusFilter),
    [dayAppointments, statusFilter]
  );

  const snapshot = useMemo(() => {
    const practitionerCount =
      practitionerTypeFilter === "all"
        ? Math.max(scopedPractitioners.length, 1)
        : Math.max(scopedPractitioners.filter((p) => p.practitionerRole === practitionerTypeFilter).length, 1);
    const totalSlots = buildDailySlots().length * practitionerCount;
    const booked = dayAppointments.filter((a) => isBlockingAppointmentStatus(a.status)).length;
    const noShow = dayAppointments.filter((a) => a.status === "noshow").length;
    return {
      fillRate: totalSlots ? Math.round((booked / totalSlots) * 1000) / 10 : 0,
      booked,
      totalSlots,
      checkedIn: dayAppointments.filter((a) => ["arrived", "checked-in", "fulfilled"].includes(a.status)).length,
      noShow,
      dayCount: dayAppointments.length,
      // Exact no-show rate for the selected day only.
      noShowRate: dayAppointments.length ? Math.round((noShow / dayAppointments.length) * 1000) / 10 : 0
    };
  }, [dayAppointments, practitionerTypeFilter, scopedPractitioners]);

  const apptPatientActor = (appointment) =>
    appointment.participant?.find((p) => String(p.actor?.reference || "").startsWith("Patient/"))?.actor;

  const apptPatient = (appointment) => patientMap.get(apptPatientActor(appointment)?.reference?.split("/")[1]);

  const apptPatientName = (appointment) => {
    const patient = apptPatient(appointment);
    return patient ? patientFullName(patient) : apptPatientActor(appointment)?.display || "Unknown patient";
  };
  const apptPractitioner = (appointment) => {
    const id = getPractitionerIdFromAppointment(appointment);
    return practitionerMap.get(id)?.fullName || "-";
  };

  const hasSlots = slotOptions.some((slot) => !slot.unavailable);

  if (loading) {
    return <Loading label="Loading schedule…" />;
  }

  return (
    <section className="stack">
      <div className="page-title-row">
        <div>
          <h1>Schedule</h1>
          <p className="muted-text">15-minute slots · 09:00–12:00 · Mon–Sat</p>
        </div>
        {canEdit(user.role) ? (
          <Button icon="plus" onClick={() => setModalOpen(true)}>
            Book appointment
          </Button>
        ) : null}
      </div>

      <div className="stat-grid">
        <StatTile label="Fill rate (selected day)" value={`${snapshot.fillRate}%`} foot={`${snapshot.booked}/${snapshot.totalSlots} slots booked`} icon="calendar" />
        <StatTile label="Checked-in / completed" value={snapshot.checkedIn} foot={`of ${snapshot.dayCount} this day`} icon="check" />
        <StatTile label="No-show rate (selected day)" value={`${snapshot.noShowRate}%`} foot={`${snapshot.noShow} of ${snapshot.dayCount} no-show`} icon="clock" tone={snapshot.noShow > 0 ? "warning" : undefined} />
        <StatTile label="Appointments shown" value={filtered.length} foot="matching filters" icon="patients" />
      </div>

      {requests.length > 0 ? (
        <Card>
          <CardHeader
            title="Pending appointment requests"
            icon="bell"
            sub="Patient-submitted requests awaiting confirmation"
            actions={<span className="badge badge-warning">{requests.length}</span>}
          />
          <CardBody flush>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Requested time</th>
                    <th>Patient</th>
                    <th>Practitioner</th>
                    <th>Reason</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="nowrap">
                        <strong>{relativeDay(request.start)}</strong>
                        <span className="sub">{formatTime(request.start)}</span>
                        {request.conflict ? (
                          <span className="badge badge-critical" style={{ marginTop: 4 }}>
                            Slot occupied
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {apptPatientName(request)}
                        <span className="sub">via patient portal</span>
                      </td>
                      <td>{apptPractitioner(request)}</td>
                      <td>{reasonText(request)}</td>
                      <td style={{ textAlign: "right" }}>
                        <div className="row" style={{ justifyContent: "flex-end", gap: "0.35rem" }}>
                          {request.conflict ? (
                            <Button size="xs" disabled={updatingId === request.id} onClick={() => openReschedule(request)}>
                              Change time
                            </Button>
                          ) : (
                            <>
                              <Button size="xs" disabled={updatingId === request.id} onClick={() => changeStatus(request, "booked")}>
                                Approve
                              </Button>
                              <Button size="xs" variant="secondary" disabled={updatingId === request.id} onClick={() => openReschedule(request)}>
                                Change time
                              </Button>
                            </>
                          )}
                          <Button size="xs" variant="ghost" disabled={updatingId === request.id} onClick={() => changeStatus(request, "cancelled")}>
                            Decline
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`Day view · ${relativeDay(`${viewDate}T00:00:00`)}`}
          icon="calendar"
          actions={
            <div className="row" style={{ gap: "0.5rem" }}>
              <input className="input" type="date" style={{ width: 160 }} value={viewDate} onChange={(event) => setViewDate(event.target.value)} />
              <input
                className="input"
                type="search"
                style={{ width: 180 }}
                placeholder="Search name…"
                value={nameSearch}
                onChange={(event) => setNameSearch(event.target.value)}
              />
              {user.role === "admin" ? (
                <select
                  className="input"
                  style={{ width: 180 }}
                  value={practitionerTypeFilter}
                  onChange={(event) => setPractitionerTypeFilter(event.target.value)}
                >
                  <option value="all">All practitioners</option>
                  {PRACTITIONER_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.plural}
                    </option>
                  ))}
                </select>
              ) : null}
              <select className="input" style={{ width: 150 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="proposed">Requested</option>
                <option value="booked">Booked</option>
                <option value="arrived">Arrived</option>
                <option value="checked-in">Checked-in</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="noshow">No-show</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          }
        />
        <CardBody flush>
          {filtered.length === 0 ? (
            <EmptyState icon="calendar" title="No appointments" message="Nothing scheduled for this day and filter." />
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>S. No</th>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Practitioner</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((appointment, index) => {
                    const patient = apptPatient(appointment);
                    const transitions = canEdit(user.role) ? TRANSITIONS[appointment.status] || [] : [];
                    return (
                      <tr key={appointment.id}>
                        <td className="muted-text">{index + 1}</td>
                        <td className="nowrap">
                          <strong>{formatTime(appointment.start)}</strong>
                          <span className="sub">{formatTime(appointment.end)}</span>
                        </td>
                        <td>
                          {patient ? (
                            <Link to={`/patients/${patient.id}`} className="inline-link">
                              {patientFullName(patient)}
                            </Link>
                          ) : (
                            apptPatientName(appointment)
                          )}
                          {patient ? <span className="sub">{patientIdentifier(patient)}</span> : null}
                        </td>
                        <td>{apptPractitioner(appointment)}</td>
                        <td>{reasonText(appointment)}</td>
                        <td>
                          <StatusBadge status={appointment.status} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="row" style={{ justifyContent: "flex-end", gap: "0.35rem" }}>
                            {transitions.map((transition) => (
                              <Button
                                key={transition.status}
                                size="xs"
                                variant={transition.variant}
                                disabled={updatingId === appointment.id}
                                onClick={() => changeStatus(appointment, transition.status)}
                              >
                                {transition.label}
                              </Button>
                            ))}
                          </div>
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
        title="Book appointment"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              form="book-form"
              type="submit"
              loading={saving}
              disabled={!form.patientId || !form.practitionerId || !form.slotValue || !hasSlots}
            >
              Book
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
        <form id="book-form" className="form-grid" onSubmit={onBook}>
          <Field label="Patient" span2>
            <select value={form.patientId} onChange={update("patientId")} required>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientFullName(patient)} ({patientIdentifier(patient)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={form.appointmentDate} onChange={update("appointmentDate")} required />
          </Field>
          {user.role !== "practitioner" ? (
            <Field label="Practitioner type">
              <select value={form.practitionerType} onChange={update("practitionerType")}>
                <option value="all">All practitioners</option>
                {PRACTITIONER_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.plural}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Practitioner">
            <select value={form.practitionerId} onChange={update("practitionerId")} disabled={user.role === "practitioner"} required>
              {bookablePractitioners.length === 0 ? (
                <option value="" disabled>
                  No practitioners available
                </option>
              ) : null}
              {bookablePractitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Slot">
            <select value={form.slotValue} onChange={update("slotValue")} required>
              <option value="" disabled>
                Choose a slot
              </option>
              {slotOptions.map((slot) => (
                <option key={slot.value} value={slot.value} disabled={slot.unavailable}>
                  {slot.label}
                  {slot.unavailable ? " (unavailable)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service category">
            <select value={form.serviceCategory} onChange={update("serviceCategory")}>
              {SERVICE_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason" span2>
            <input value={form.reason} onChange={update("reason")} placeholder="e.g. Diabetes follow-up" />
          </Field>
          <Field label="Comment" span2>
            <textarea rows="2" value={form.comment} onChange={update("comment")} />
          </Field>
          {!isBookableDateInput(form.appointmentDate) ? (
            <p className="banner banner-warning field-span-2">Slots are available Monday–Saturday only.</p>
          ) : !hasSlots ? (
            <p className="banner banner-warning field-span-2">No available slots for this date / practitioner.</p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(rescheduleTarget)}
        title="Change appointment time"
        onClose={() => setRescheduleTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button form="reschedule-form" type="submit" loading={rescheduling} disabled={!rescheduleSlot}>
              Approve at new time
            </Button>
          </>
        }
      >
        {rescheduleTarget ? (
          <form id="reschedule-form" className="form-grid" onSubmit={submitReschedule}>
            <Field label="Patient" span2>
              <input value={apptPatientName(rescheduleTarget)} disabled />
            </Field>
            <Field label="Practitioner">
              <input value={apptPractitioner(rescheduleTarget)} disabled />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={rescheduleDate}
                onChange={(event) => {
                  setRescheduleDate(event.target.value);
                  setRescheduleSlot("");
                }}
                required
              />
            </Field>
            <Field label="New slot" span2>
              <select value={rescheduleSlot} onChange={(event) => setRescheduleSlot(event.target.value)} required>
                <option value="" disabled>
                  Choose an available slot
                </option>
                {rescheduleSlots.map((slot) => (
                  <option key={slot.value} value={slot.value} disabled={slot.unavailable}>
                    {slot.label}
                    {slot.unavailable ? " (unavailable)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {!isBookableDateInput(rescheduleDate) ? (
              <p className="banner banner-warning field-span-2">Slots are available Monday–Saturday only.</p>
            ) : !rescheduleSlots.some((slot) => !slot.unavailable) ? (
              <p className="banner banner-warning field-span-2">No open slots on this date — try another day.</p>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(encounterTarget)}
        title="Document encounter"
        size="lg"
        onClose={() => setEncounterTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEncounterTarget(null)}>
              Later
            </Button>
            <Button form="encounter-form" type="submit" loading={encounterSaving}>
              Save encounter
            </Button>
          </>
        }
      >
        {encounterError ? (
          <p className="banner banner-error" style={{ marginBottom: "1rem" }}>
            <Icon name="alert" size={16} />
            {encounterError}
          </p>
        ) : null}
        <p className="muted-text" style={{ marginBottom: "0.8rem" }}>
          Visit started for <strong>{encounterPatient}</strong>. Complete the appointment to close the encounter.
        </p>
        <form id="encounter-form" className="form-grid" onSubmit={submitEncounter}>
          <Field label="Encounter type">
            <select value={encounterForm.typeCode} onChange={updateEncounterField("typeCode")}>
              {ENCOUNTER_TYPES.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.display}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input value={encounterForm.location} onChange={updateEncounterField("location")} />
          </Field>
          <Field label="Reason" span2>
            <input value={encounterForm.reason} onChange={updateEncounterField("reason")} />
          </Field>
          <Field label="Subjective" span2>
            <textarea rows="2" value={encounterForm.s} onChange={updateEncounterField("s")} placeholder="Patient-reported history" />
          </Field>
          <Field label="Objective" span2>
            <textarea rows="2" value={encounterForm.o} onChange={updateEncounterField("o")} placeholder="Exam findings, vitals" />
          </Field>
          <Field label="Assessment" span2>
            <textarea rows="2" value={encounterForm.a} onChange={updateEncounterField("a")} />
          </Field>
          <Field label="Plan" span2>
            <textarea rows="2" value={encounterForm.p} onChange={updateEncounterField("p")} />
          </Field>
        </form>
      </Modal>
    </section>
  );
};

export default SchedulePage;
