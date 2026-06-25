import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminApi, fhirApi } from "../api.js";
import {
  bundleToResources,
  formatDateTime,
  medicationDisplay,
  observationValue,
  patientAddress,
  patientContact,
  patientMrn,
  patientPid,
  pickCodingCode,
  pickCodingDisplay,
  reasonText,
  splitEverythingBundle
} from "../utils/fhir.js";
import {
  buildDailySlots,
  getDayRangeFromDateInput,
  getNextBookableDateInput,
  getPractitionerIdFromAppointment,
  getSlotRange,
  isBookableDateInput,
  isSlotUnavailable,
  practitionerHasAvailableSlot
} from "../utils/scheduling.js";
import {
  CONDITION_CATALOG,
  ALLERGEN_CATALOG,
  ALLERGY_REACTIONS,
  MEDICATION_CATALOG,
  OBSERVATION_CATALOG,
  ENCOUNTER_TYPES,
  TASK_CATEGORY_OPTIONS,
  SERVICE_CATEGORY_OPTIONS,
  VITALS,
  findObservationMeta,
  flagObservation,
  referenceRangeText
} from "../utils/catalog.js";
import { buildPatientRiskProfile, getTaskDueDate, isTaskOpen, isTaskOverdue } from "../utils/clinicalOps.js";
import { formatDate } from "../utils/display.js";
import { printPatientSummary } from "../utils/printSummary.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../components/Toast.jsx";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Loading,
  Modal,
  PriorityBadge,
  Sparkline,
  StatusBadge,
  Tabs
} from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import PatientBanner from "../components/PatientBanner.jsx";
import CodePicker from "../components/CodePicker.jsx";

const canEdit = (role) => role === "admin" || role === "practitioner";

const initialChart = {
  patient: null,
  observations: [],
  conditions: [],
  allergies: [],
  medications: [],
  encounters: [],
  appointments: [],
  tasks: []
};

const emptyForms = {
  patient: { mrn: "", givenName: "", familyName: "", gender: "unknown", birthDate: "", phone: "", email: "", line1: "", city: "", state: "", postalCode: "" },
  condition: { code: "", display: "", clinicalStatus: "active", note: "" },
  allergy: { code: "", display: "", category: "medication", criticality: "high", reaction: "", severity: "moderate", clinicalStatus: "active" },
  medication: { code: "", display: "", status: "active", dosage: "", reason: "" },
  observation: { code: "", display: "", value: "", unit: "", note: "" },
  encounter: { typeCode: "185349003", status: "finished", reason: "", location: "", s: "", o: "", a: "", p: "" },
  task: { description: "", priority: "routine", category: "Care coordination", dueDate: "", ownerId: "", note: "", status: "requested" },
  appointment: { appointmentDate: getNextBookableDateInput(), slotValue: "", practitionerId: "", serviceCategory: "Follow-up", reason: "", status: "booked" }
};

const APPOINTMENT_STATUS_OPTIONS = ["booked", "arrived", "fulfilled", "cancelled", "noshow"];
const TASK_STATUS_OPTIONS = ["requested", "accepted", "in-progress", "on-hold", "completed", "cancelled"];

// Maps an existing FHIR resource back into the flat form shape used by the modals.
const toFormValues = {
  patient: (r) => ({
    mrn: r.identifier?.find((i) => i.system === "urn:mrn")?.value || "",
    givenName: r.name?.[0]?.given?.[0] || "",
    familyName: r.name?.[0]?.family || "",
    gender: r.gender || "unknown",
    birthDate: r.birthDate || "",
    phone: r.telecom?.find((t) => t.system === "phone")?.value || "",
    email: r.telecom?.find((t) => t.system === "email")?.value || "",
    line1: r.address?.[0]?.line?.[0] || "",
    city: r.address?.[0]?.city || "",
    state: r.address?.[0]?.state || "",
    postalCode: r.address?.[0]?.postalCode || ""
  }),
  condition: (r) => ({
    code: pickCodingCode(r, ""),
    display: pickCodingDisplay(r, ""),
    clinicalStatus: r.clinicalStatus?.coding?.[0]?.code || "active",
    note: r.note?.[0]?.text || ""
  }),
  allergy: (r) => ({
    code: pickCodingCode(r, ""),
    display: pickCodingDisplay(r, ""),
    category: (r.category || [])[0] || "medication",
    criticality: r.criticality || "high",
    reaction: r.reaction?.[0]?.manifestation?.[0]?.text || r.reaction?.[0]?.description || "",
    severity: r.reaction?.[0]?.severity || "moderate",
    clinicalStatus: r.clinicalStatus?.coding?.[0]?.code || "active"
  }),
  medication: (r) => ({
    code: r.medicationCodeableConcept?.coding?.[0]?.code || "",
    display: r.medicationCodeableConcept?.coding?.[0]?.display || r.medicationCodeableConcept?.coding?.[0]?.code || "",
    status: r.status || "active",
    dosage: r.dosageInstruction?.[0]?.text || "",
    reason: r.reasonCode?.[0]?.text || ""
  }),
  observation: (r) => ({
    code: r.code?.coding?.[0]?.code || "",
    display: r.code?.coding?.[0]?.display || "",
    value: r.valueQuantity?.value ?? "",
    unit: r.valueQuantity?.unit || "",
    note: r.note?.[0]?.text || ""
  }),
  encounter: (r) => {
    const note = r.note?.[0]?.text || "";
    const section = (label) => {
      const match = note.match(new RegExp(`${label}:\\s*([^\\n]*)`));
      return match ? match[1].trim() : "";
    };
    return {
      typeCode: r.type?.[0]?.coding?.[0]?.code || ENCOUNTER_TYPES[0].code,
      status: r.status || "finished",
      reason: r.reasonCode?.[0]?.text || "",
      location: r.location?.[0]?.location?.display || "",
      s: section("S"),
      o: section("O"),
      a: section("A"),
      p: section("P")
    };
  },
  appointment: (r) => ({
    serviceCategory: r.serviceCategory?.[0]?.text || "Follow-up",
    reason: r.reasonCode?.[0]?.text || "",
    status: r.status || "booked"
  }),
  task: (r) => ({
    description: r.description || "",
    priority: r.priority || "routine",
    category: r.code?.text || "Care coordination",
    dueDate: r.executionPeriod?.end ? new Date(r.executionPeriod.end).toISOString().slice(0, 10) : "",
    ownerId: r.owner?.reference?.split("/")[1] || "",
    note: r.note?.[0]?.text || "",
    status: r.status || "requested"
  })
};

const isActiveCondition = (condition) => {
  const code = condition.clinicalStatus?.coding?.[0]?.code;
  return ["active", "recurrence", "relapse"].includes(code);
};
const isActiveMedication = (medication) =>
  !["stopped", "completed", "cancelled", "entered-in-error"].includes(medication.status);

const PatientDetailPage = () => {
  const { id } = useParams();
  const { token, user } = useAuth();
  const toast = useToast();
  const [chart, setChart] = useState(initialChart);
  const [practitioners, setPractitioners] = useState([]);
  const [activeTab, setActiveTab] = useState("summary");
  const [activeModal, setActiveModal] = useState("");
  const [editingRecord, setEditingRecord] = useState(null);
  const [forms, setForms] = useState(emptyForms);
  const [slotAppointments, setSlotAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const setForm = (key, patch) => setForms((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const load = useCallback(async () => {
    const [patientResource, practitionerResponse, taskBundle] = await Promise.all([
      fhirApi.getPatient(token, id),
      adminApi.listPractitioners(token),
      fhirApi.listTasks(token, { for: `Patient/${id}` })
    ]);

    const taskResources = bundleToResources(taskBundle);
    let grouped = { ...initialChart, patient: patientResource, tasks: taskResources };
    try {
      const split = splitEverythingBundle(await fhirApi.getPatientEverything(token, id));
      grouped = { ...split, patient: split.patient || patientResource, tasks: split.tasks.length ? split.tasks : taskResources };
    } catch {
      // keep demographics even if $everything fails
    }

    setChart(grouped);
    setPractitioners(practitionerResponse.data || []);
    setForms((prev) => ({
      ...prev,
      task: { ...prev.task, ownerId: user.role === "practitioner" ? user.id : prev.task.ownerId || practitionerResponse.data?.[0]?.id || "" },
      appointment: { ...prev.appointment, practitionerId: user.role === "practitioner" ? user.id : prev.appointment.practitionerId || practitionerResponse.data?.[0]?.id || "" }
    }));
  }, [id, token, user.id, user.role]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => toast.error(err.message || "Unable to load patient"))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const dateInput = forms.appointment.appointmentDate;
    if (!isBookableDateInput(dateInput)) {
      setSlotAppointments([]);
      return;
    }
    const { start, end } = getDayRangeFromDateInput(dateInput);
    fhirApi
      .listAppointments(token, { from: start.toISOString(), to: end.toISOString() })
      .then((response) => setSlotAppointments(bundleToResources(response)))
      .catch(() => {});
  }, [token, forms.appointment.appointmentDate]);

  const riskProfile = useMemo(
    () =>
      buildPatientRiskProfile({
        conditions: chart.conditions,
        allergies: chart.allergies,
        medications: chart.medications,
        observations: chart.observations,
        encounters: chart.encounters,
        appointments: chart.appointments,
        tasks: chart.tasks
      }),
    [chart]
  );

  const practitionerMap = useMemo(() => new Map(practitioners.map((p) => [p.id, p])), [practitioners]);
  const activeConditions = useMemo(() => chart.conditions.filter(isActiveCondition), [chart.conditions]);
  const activeMedications = useMemo(() => chart.medications.filter(isActiveMedication), [chart.medications]);

  // Vitals: build a time series per vital code for sparklines + latest + flag.
  const vitalSeries = useMemo(() => {
    return VITALS.map((vital) => {
      const matches = chart.observations
        .filter((obs) => obs.code?.coding?.[0]?.code === vital.code)
        .sort((a, b) => new Date(a.effectiveDateTime || 0) - new Date(b.effectiveDateTime || 0));
      const latest = matches[matches.length - 1];
      const value = latest?.valueQuantity?.value;
      return {
        ...vital,
        values: matches.map((obs) => Number(obs.valueQuantity?.value)).filter(Number.isFinite),
        latest: value,
        when: latest?.effectiveDateTime,
        ...flagObservation(vital.code, value)
      };
    }).filter((vital) => vital.latest !== undefined);
  }, [chart.observations]);

  // Available practitioners / slots for the in-chart booking modal.
  const availablePractitioners = useMemo(() => {
    const scoped = user.role === "practitioner" ? practitioners.filter((p) => p.id === user.id) : practitioners;
    return scoped.filter((p) =>
      practitionerHasAvailableSlot({ appointments: slotAppointments, practitionerId: p.id, dateInput: forms.appointment.appointmentDate })
    );
  }, [practitioners, slotAppointments, forms.appointment.appointmentDate, user.id, user.role]);

  const slotOptions = useMemo(
    () =>
      buildDailySlots().map((slot) => ({
        ...slot,
        unavailable:
          !forms.appointment.practitionerId ||
          isSlotUnavailable({
            appointments: slotAppointments,
            practitionerId: forms.appointment.practitionerId,
            dateInput: forms.appointment.appointmentDate,
            slotValue: slot.value
          })
      })),
    [slotAppointments, forms.appointment.practitionerId, forms.appointment.appointmentDate]
  );

  // Open a modal in "create" mode: clear any edit target and reset that form.
  const openModal = (key) => {
    setFormError("");
    setEditingRecord(null);
    setForms((prev) => ({
      ...prev,
      [key]:
        key === "task"
          ? { ...emptyForms.task, ownerId: user.role === "practitioner" ? user.id : prev.task.ownerId }
          : key === "appointment"
          ? { ...emptyForms.appointment, practitionerId: prev.appointment.practitionerId, appointmentDate: prev.appointment.appointmentDate }
          : emptyForms[key]
    }));
    setActiveModal(key);
  };

  // Open a modal in "edit" mode: prefill the form from the existing resource.
  const openEdit = (key, record) => {
    setFormError("");
    setEditingRecord(record);
    setForms((prev) => ({ ...prev, [key]: { ...prev[key], ...toFormValues[key](record) } }));
    setActiveModal(key === "appointment" ? "appointmentEdit" : key);
  };

  const closeModal = () => {
    setActiveModal("");
    setEditingRecord(null);
  };

  const submit = async (request, successMessage) => {
    setSaving(true);
    setFormError("");
    try {
      await request();
      toast.success(successMessage);
      closeModal();
      await load();
    } catch (err) {
      setFormError(err.message || "Unable to save");
    } finally {
      setSaving(false);
    }
  };

  /* ----- create / edit handlers ----- */
  const savePatient = (event) => {
    event.preventDefault();
    const f = forms.patient;
    const telecom = [];
    if (f.phone) telecom.push({ system: "phone", value: f.phone });
    if (f.email) telecom.push({ system: "email", value: f.email });
    const address =
      f.line1 || f.city || f.state || f.postalCode
        ? [{ line: f.line1 ? [f.line1] : [], city: f.city, state: f.state, postalCode: f.postalCode }]
        : [];
    submit(
      () =>
        fhirApi.updatePatient(token, id, {
          resourceType: "Patient",
          active: editingRecord?.active ?? true,
          identifier: f.mrn ? [{ system: "urn:mrn", value: f.mrn }] : undefined,
          name: [{ family: f.familyName, given: f.givenName ? [f.givenName] : [] }],
          telecom,
          gender: f.gender,
          birthDate: f.birthDate || undefined,
          address
        }),
      "Demographics updated"
    );
  };

  const saveCondition = (event) => {
    event.preventDefault();
    const f = forms.condition;
    const resource = {
      resourceType: "Condition",
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: f.clinicalStatus }] },
      verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
      code: { coding: [{ system: "http://snomed.info/sct", code: f.code, display: f.display }] },
      subject: { reference: `Patient/${id}` },
      recordedDate: editingRecord?.recordedDate || new Date().toISOString(),
      note: f.note ? [{ text: f.note }] : undefined
    };
    submit(
      () => (editingRecord ? fhirApi.updateCondition(token, editingRecord.id, resource) : fhirApi.createCondition(token, resource)),
      editingRecord ? "Problem updated" : "Problem added"
    ).then(() => setForms((prev) => ({ ...prev, condition: emptyForms.condition })));
  };

  const saveAllergy = (event) => {
    event.preventDefault();
    const f = forms.allergy;
    const resource = {
      resourceType: "AllergyIntolerance",
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: f.clinicalStatus }] },
      verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }] },
      type: "allergy",
      category: [f.category],
      criticality: f.criticality,
      code: { coding: [{ system: "http://snomed.info/sct", code: f.code, display: f.display }] },
      patient: { reference: `Patient/${id}` },
      recordedDate: editingRecord?.recordedDate || new Date().toISOString(),
      reaction: f.reaction
        ? [{ substance: { text: f.display }, manifestation: [{ text: f.reaction }], severity: f.severity, description: f.reaction }]
        : undefined
    };
    submit(
      () => (editingRecord ? fhirApi.updateAllergy(token, editingRecord.id, resource) : fhirApi.createAllergy(token, resource)),
      editingRecord ? "Allergy updated" : "Allergy added"
    ).then(() => setForms((prev) => ({ ...prev, allergy: emptyForms.allergy })));
  };

  const saveMedication = (event) => {
    event.preventDefault();
    const f = forms.medication;
    const resource = {
      resourceType: "MedicationRequest",
      status: f.status,
      intent: "order",
      medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: f.code, display: f.display }] },
      subject: { reference: `Patient/${id}` },
      authoredOn: editingRecord?.authoredOn || new Date().toISOString(),
      dosageInstruction: f.dosage ? [{ text: f.dosage }] : undefined,
      reasonCode: f.reason ? [{ text: f.reason }] : undefined
    };
    submit(
      () => (editingRecord ? fhirApi.updateMedicationRequest(token, editingRecord.id, resource) : fhirApi.createMedicationRequest(token, resource)),
      editingRecord ? "Medication updated" : "Medication prescribed"
    ).then(() => setForms((prev) => ({ ...prev, medication: emptyForms.medication })));
  };

  const saveObservation = (event) => {
    event.preventDefault();
    const f = forms.observation;
    const resource = {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: f.code, display: f.display }] },
      subject: { reference: `Patient/${id}` },
      effectiveDateTime: editingRecord?.effectiveDateTime || new Date().toISOString(),
      valueQuantity: { value: Number(f.value), unit: f.unit, system: "http://unitsofmeasure.org", code: f.unit },
      note: f.note ? [{ text: f.note }] : undefined
    };
    submit(
      () => (editingRecord ? fhirApi.updateObservation(token, editingRecord.id, resource) : fhirApi.createObservation(token, resource)),
      editingRecord ? "Result updated" : "Result recorded"
    ).then(() => setForms((prev) => ({ ...prev, observation: emptyForms.observation })));
  };

  const saveEncounter = (event) => {
    event.preventDefault();
    const f = forms.encounter;
    const type = ENCOUNTER_TYPES.find((t) => t.code === f.typeCode) || ENCOUNTER_TYPES[0];
    const soap = [f.s && `S: ${f.s}`, f.o && `O: ${f.o}`, f.a && `A: ${f.a}`, f.p && `P: ${f.p}`].filter(Boolean).join("\n");
    const resource = {
      resourceType: "Encounter",
      status: f.status,
      class: { code: type.classCode },
      type: [{ coding: [{ system: "http://snomed.info/sct", code: type.code, display: type.display }] }],
      subject: { reference: `Patient/${id}` },
      period: editingRecord?.period || { start: new Date().toISOString() },
      reasonCode: f.reason ? [{ text: f.reason }] : undefined,
      location: f.location ? [{ location: { display: f.location } }] : undefined,
      note: soap ? [{ text: soap }] : undefined
    };
    submit(
      () => (editingRecord ? fhirApi.updateEncounter(token, editingRecord.id, resource) : fhirApi.createEncounter(token, resource)),
      editingRecord ? "Encounter updated" : "Encounter documented"
    ).then(() => setForms((prev) => ({ ...prev, encounter: emptyForms.encounter })));
  };

  const saveTask = (event) => {
    event.preventDefault();
    const f = forms.task;
    const ownerId = !editingRecord && user.role === "practitioner" ? user.id : f.ownerId;
    const owner = practitionerMap.get(ownerId);
    const dueIso = f.dueDate ? new Date(`${f.dueDate}T23:59:59`).toISOString() : undefined;
    const resource = {
      resourceType: "Task",
      status: editingRecord ? f.status : "requested",
      intent: "order",
      priority: f.priority,
      code: f.category ? { text: f.category } : undefined,
      description: f.description.trim(),
      for: { reference: `Patient/${id}` },
      owner: ownerId ? { reference: `Practitioner/${ownerId}`, display: owner?.fullName } : undefined,
      authoredOn: editingRecord?.authoredOn || new Date().toISOString(),
      executionPeriod: dueIso ? { end: dueIso } : undefined,
      note: f.note ? [{ text: f.note.trim() }] : undefined
    };
    submit(
      () => (editingRecord ? fhirApi.updateTask(token, editingRecord.id, resource) : fhirApi.createTask(token, resource)),
      editingRecord ? "Task updated" : "Task created"
    ).then(() => setForms((prev) => ({ ...prev, task: { ...emptyForms.task, ownerId: prev.task.ownerId } })));
  };

  const createAppointment = (event) => {
    event.preventDefault();
    const f = forms.appointment;
    submit(() => {
      if (!isBookableDateInput(f.appointmentDate)) {
        throw new Error("Appointments can only be booked Monday to Saturday");
      }
      const slotRange = getSlotRange(f.appointmentDate, f.slotValue);
      if (!slotRange) {
        throw new Error("Select a valid slot");
      }
      const practitioner = availablePractitioners.find((p) => p.id === f.practitionerId);
      if (!practitioner) {
        throw new Error("Select an available practitioner");
      }
      return fhirApi.createAppointment(token, {
        resourceType: "Appointment",
        status: "booked",
        serviceCategory: f.serviceCategory ? [{ text: f.serviceCategory }] : undefined,
        start: slotRange.start.toISOString(),
        end: slotRange.end.toISOString(),
        minutesDuration: 15,
        participant: [
          { actor: { reference: `Patient/${id}` }, status: "accepted" },
          { actor: { reference: `Practitioner/${practitioner.id}`, display: practitioner.fullName }, status: "accepted" }
        ],
        reasonCode: f.reason ? [{ text: f.reason }] : undefined
      });
    }, "Appointment booked").then(() =>
      setForms((prev) => ({ ...prev, appointment: { ...emptyForms.appointment, practitionerId: prev.appointment.practitionerId, appointmentDate: prev.appointment.appointmentDate } }))
    );
  };

  // Editing an existing appointment changes status/service/reason but not the booked slot.
  const saveAppointmentEdit = (event) => {
    event.preventDefault();
    const f = forms.appointment;
    submit(
      () =>
        fhirApi.updateAppointment(token, editingRecord.id, {
          ...editingRecord,
          status: f.status,
          serviceCategory: f.serviceCategory ? [{ text: f.serviceCategory }] : undefined,
          reasonCode: f.reason ? [{ text: f.reason }] : undefined
        }),
      "Appointment updated"
    );
  };

  /* ----- inline status changes ----- */
  const resolveCondition = (condition) =>
    submit(
      () =>
        fhirApi.updateCondition(token, condition.id, {
          ...condition,
          clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "resolved" }] }
        }),
      "Problem resolved"
    );

  const discontinueMedication = (medication) =>
    submit(() => fhirApi.updateMedicationRequest(token, medication.id, { ...medication, status: "stopped" }), "Medication discontinued");

  const updateTaskStatus = (task, status) =>
    submit(() => fhirApi.updateTask(token, task.id, { ...task, status }), "Task updated");

  if (loading) {
    return <Loading label="Loading patient chart…" />;
  }
  if (!chart.patient) {
    return <EmptyState icon="patients" title="Patient not found" message="This patient record is unavailable." />;
  }

  const patient = chart.patient;
  const contact = patientContact(patient);
  const editable = canEdit(user.role);
  const alerts = [...riskProfile.safetyAlerts, ...riskProfile.careGaps].sort(
    (a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity])
  );

  const apptPractitionerName = (appointment) =>
    practitionerMap.get(getPractitionerIdFromAppointment(appointment))?.fullName ||
    appointment.participant?.find((p) => String(p.actor?.reference || "").startsWith("Practitioner/"))?.actor?.display ||
    "-";

  // FHIR Encounter.participant.individual → the practitioner who conducted the visit.
  const encounterPractitionerName = (encounter) => {
    const performer = (encounter.participant || []).find(
      (p) => p.individual?.reference || p.individual?.display
    );
    if (!performer) {
      return "-";
    }
    const id = String(performer.individual?.reference || "").split("/")[1];
    return practitionerMap.get(id)?.fullName || performer.individual?.display || "-";
  };

  const tabs = [
    { id: "summary", label: "Summary", icon: "clipboard" },
    { id: "problems", label: "Problems", icon: "problem", count: chart.conditions.length },
    { id: "medications", label: "Medications", icon: "pill", count: chart.medications.length },
    { id: "allergies", label: "Allergies", icon: "allergy", count: chart.allergies.length },
    { id: "results", label: "Results & vitals", icon: "vitals", count: chart.observations.length },
    { id: "encounters", label: "Encounters", icon: "notes", count: chart.encounters.length },
    { id: "appointments", label: "Appointments", icon: "calendar", count: chart.appointments.length },
    { id: "tasks", label: "Care tasks", icon: "tasks", count: chart.tasks.length }
  ];

  return (
    <section className="stack">
      <PatientBanner patient={patient} allergies={chart.allergies} riskProfile={riskProfile} activeProblemCount={activeConditions.length} />

      <div className="spread">
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
        <Button variant="secondary" size="sm" icon="print" onClick={() => printPatientSummary(patient, chart)}>
          Print summary
        </Button>
      </div>

      {/* ---------------- SUMMARY ---------------- */}
      {activeTab === "summary" ? (
        <div className="stack">
          {alerts.length > 0 ? (
            <Card>
              <CardHeader title="Clinical decision support" icon="alert" sub={`${riskProfile.safetyAlerts.length} safety alerts · ${riskProfile.careGaps.length} care gaps`} />
              <CardBody>
                <div className="stack-sm">
                  {alerts.map((alert) => (
                    <div key={`${alert.title}-${alert.detail}`} className={`alert-strip sev-${alert.severity}`}>
                      <Icon name={riskProfile.safetyAlerts.includes(alert) ? "alert" : "problem"} size={16} />
                      <div>
                        <strong>{alert.title}</strong>
                        <span className="muted-text">{alert.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <div className="form-grid" style={{ gap: "1.1rem" }}>
            <Card>
              <CardHeader
                title="Demographics"
                icon="user"
                actions={editable ? <Button size="sm" variant="secondary" icon="edit" onClick={() => openEdit("patient", patient)}>Edit</Button> : null}
              />
              <CardBody>
                <div className="stack-sm">
                  <div className="spread"><span className="muted-text">PID</span><strong>{patientPid(patient)}</strong></div>
                  <div className="spread"><span className="muted-text">MRN</span><strong>{patientMrn(patient)}</strong></div>
                  <div className="spread"><span className="muted-text">Gender</span><strong>{patient.gender || "-"}</strong></div>
                  <div className="spread"><span className="muted-text">Birth date</span><strong>{patient.birthDate || "-"}</strong></div>
                  <div className="spread"><span className="muted-text">Phone</span><strong>{contact.phone}</strong></div>
                  <div className="spread"><span className="muted-text">Email</span><strong>{contact.email}</strong></div>
                  <div className="spread"><span className="muted-text">Address</span><strong style={{ textAlign: "right" }}>{patientAddress(patient)}</strong></div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Latest vitals" icon="vitals" actions={<Link to="#" className="inline-link" onClick={(e) => { e.preventDefault(); setActiveTab("results"); }}>View all</Link>} />
              <CardBody>
                {vitalSeries.length === 0 ? (
                  <EmptyState icon="vitals" message="No vitals recorded yet." />
                ) : (
                  <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                    {vitalSeries.slice(0, 6).map((vital) => (
                      <div key={vital.code} className="vital-card">
                        <div className="vital-head">
                          <span className="vital-name">{vital.display}</span>
                          {vital.flag ? <span className={`flag-pill flag-${vital.flag}`}>{vital.flag}</span> : null}
                        </div>
                        <span className="vital-value">
                          {vital.latest}
                          <span className="unit">{vital.unit}</span>
                        </span>
                        <Sparkline values={vital.values} color={vital.flag === "H" || vital.flag === "L" ? "var(--critical)" : "var(--primary)"} />
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="form-grid" style={{ gap: "1.1rem" }}>
            <Card>
              <CardHeader title="Active problems" icon="problem" sub={`${activeConditions.length} active`} />
              <CardBody flush>
                {activeConditions.length === 0 ? (
                  <EmptyState message="No active problems." />
                ) : (
                  <ul style={{ margin: 0, padding: "0.6rem 1.2rem", listStyle: "none" }}>
                    {activeConditions.slice(0, 8).map((condition) => (
                      <li key={condition.id} className="spread" style={{ padding: "0.35rem 0" }}>
                        <span>{pickCodingDisplay(condition)}</span>
                        <Badge tone="warning">{condition.clinicalStatus?.coding?.[0]?.code}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Active medications" icon="pill" sub={`${activeMedications.length} active`} />
              <CardBody flush>
                {activeMedications.length === 0 ? (
                  <EmptyState message="No active medications." />
                ) : (
                  <ul style={{ margin: 0, padding: "0.6rem 1.2rem", listStyle: "none" }}>
                    {activeMedications.slice(0, 8).map((medication) => (
                      <li key={medication.id} className="spread" style={{ padding: "0.35rem 0" }}>
                        <span>{medicationDisplay(medication)}</span>
                        <span className="muted-text">{medication.dosageInstruction?.[0]?.text || ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ---------------- PROBLEMS ---------------- */}
      {activeTab === "problems" ? (
        <Card>
          <CardHeader
            title="Problem list"
            icon="problem"
            actions={editable ? <Button size="sm" icon="plus" onClick={() => openModal("condition")}>Add problem</Button> : null}
          />
          <CardBody flush>
            {chart.conditions.length === 0 ? (
              <EmptyState icon="problem" title="No problems recorded" message="Add a diagnosis to start the problem list." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>Code</th>
                      <th>Condition</th>
                      <th>Status</th>
                      {editable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.conditions.map((condition) => (
                      <tr key={condition.id}>
                        <td className="nowrap">{formatDate(condition.recordedDate)}</td>
                        <td>{pickCodingCode(condition)}</td>
                        <td>{pickCodingDisplay(condition)}</td>
                        <td>
                          <Badge tone={isActiveCondition(condition) ? "warning" : "neutral"}>
                            {condition.clinicalStatus?.coding?.[0]?.code || "-"}
                          </Badge>
                        </td>
                        {editable ? (
                          <td style={{ textAlign: "right" }}>
                            <div className="row" style={{ gap: "0.3rem", justifyContent: "flex-end" }}>
                              <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("condition", condition)}>
                                Edit
                              </Button>
                              {isActiveCondition(condition) ? (
                                <Button size="xs" variant="ghost" disabled={saving} onClick={() => resolveCondition(condition)}>
                                  Resolve
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- MEDICATIONS ---------------- */}
      {activeTab === "medications" ? (
        <div className="stack">
          {riskProfile.safetyAlerts.some((a) => a.title.includes("allergy-medication")) ? (
            <div className="alert-strip sev-high">
              <Icon name="alert" size={16} />
              <div>
                <strong>Possible drug–allergy conflict</strong>
                <span className="muted-text">An active medication may conflict with a recorded allergy. Review before prescribing.</span>
              </div>
            </div>
          ) : null}
          <Card>
            <CardHeader
              title="Medications"
              icon="pill"
              actions={editable ? <Button size="sm" icon="plus" onClick={() => openModal("medication")}>Prescribe</Button> : null}
            />
            <CardBody flush>
              {chart.medications.length === 0 ? (
                <EmptyState icon="pill" title="No medications" message="No medication orders on file." />
              ) : (
                <div className="table-scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Authored</th>
                        <th>Medication</th>
                        <th>Status</th>
                        <th>Dosage</th>
                        <th>Reason</th>
                        {editable ? <th /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {chart.medications.map((medication) => (
                        <tr key={medication.id}>
                          <td className="nowrap">{formatDate(medication.authoredOn)}</td>
                          <td>{medicationDisplay(medication)}</td>
                          <td>
                            <Badge tone={isActiveMedication(medication) ? "success" : "neutral"}>{medication.status || "-"}</Badge>
                          </td>
                          <td>{medication.dosageInstruction?.[0]?.text || "-"}</td>
                          <td>{reasonText(medication)}</td>
                          {editable ? (
                            <td style={{ textAlign: "right" }}>
                              <div className="row" style={{ gap: "0.3rem", justifyContent: "flex-end" }}>
                                <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("medication", medication)}>
                                  Edit
                                </Button>
                                {isActiveMedication(medication) ? (
                                  <Button size="xs" variant="ghost" disabled={saving} onClick={() => discontinueMedication(medication)}>
                                    Discontinue
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* ---------------- ALLERGIES ---------------- */}
      {activeTab === "allergies" ? (
        <Card>
          <CardHeader
            title="Allergies & intolerances"
            icon="allergy"
            actions={editable ? <Button size="sm" icon="plus" onClick={() => openModal("allergy")}>Add allergy</Button> : null}
          />
          <CardBody flush>
            {chart.allergies.length === 0 ? (
              <EmptyState icon="allergy" title="No known allergies" message="No allergy or intolerance records (NKDA)." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>Substance</th>
                      <th>Category</th>
                      <th>Criticality</th>
                      <th>Reaction</th>
                      {editable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.allergies.map((allergy) => (
                      <tr key={allergy.id}>
                        <td className="nowrap">{formatDate(allergy.recordedDate)}</td>
                        <td>{pickCodingDisplay(allergy)}</td>
                        <td>{(allergy.category || []).join(", ") || "-"}</td>
                        <td>
                          <Badge tone={allergy.criticality === "high" ? "critical" : "neutral"}>{allergy.criticality || "-"}</Badge>
                        </td>
                        <td>{allergy.reaction?.[0]?.manifestation?.[0]?.text || allergy.reaction?.[0]?.description || "-"}</td>
                        {editable ? (
                          <td style={{ textAlign: "right" }}>
                            <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("allergy", allergy)}>
                              Edit
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- RESULTS & VITALS ---------------- */}
      {activeTab === "results" ? (
        <div className="stack">
          {vitalSeries.length > 0 ? (
            <Card>
              <CardHeader title="Vitals trends" icon="vitals" />
              <CardBody>
                <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                  {vitalSeries.map((vital) => (
                    <div key={vital.code} className="vital-card">
                      <div className="vital-head">
                        <span className="vital-name">{vital.display}</span>
                        {vital.flag ? <span className={`flag-pill flag-${vital.flag}`}>{vital.flag}</span> : null}
                      </div>
                      <span className="vital-value">
                        {vital.latest}
                        <span className="unit">{vital.unit}</span>
                      </span>
                      <Sparkline values={vital.values} color={vital.flag === "H" || vital.flag === "L" ? "var(--critical)" : "var(--primary)"} />
                      <span className="muted-text" style={{ fontSize: "0.72rem" }}>{referenceRangeText(vital.code)}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Observations & results"
              icon="vitals"
              actions={editable ? <Button size="sm" icon="plus" onClick={() => openModal("observation")}>Record result</Button> : null}
            />
            <CardBody flush>
              {chart.observations.length === 0 ? (
                <EmptyState icon="vitals" title="No results" message="Record a vital sign or lab result." />
              ) : (
                <div className="table-scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Test</th>
                        <th>Value</th>
                        <th>Flag</th>
                        <th>Reference</th>
                        {editable ? <th /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {chart.observations.map((observation) => {
                        const code = observation.code?.coding?.[0]?.code;
                        const { flag, label } = flagObservation(code, observation.valueQuantity?.value);
                        return (
                          <tr key={observation.id}>
                            <td className="nowrap">{formatDateTime(observation.effectiveDateTime)}</td>
                            <td>{observation.code?.coding?.[0]?.display || code || "-"}</td>
                            <td>
                              <strong>{observationValue(observation)}</strong>
                            </td>
                            <td>{flag ? <span className={`flag-pill flag-${flag}`}>{flag === "N" ? "Normal" : label}</span> : "-"}</td>
                            <td className="muted-text">{referenceRangeText(code) || "-"}</td>
                            {editable ? (
                              <td style={{ textAlign: "right" }}>
                                <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("observation", observation)}>
                                  Edit
                                </Button>
                              </td>
                            ) : null}
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
      ) : null}

      {/* ---------------- ENCOUNTERS ---------------- */}
      {activeTab === "encounters" ? (
        <Card>
          <CardHeader
            title="Encounters & notes"
            icon="notes"
            actions={editable ? <Button size="sm" icon="plus" onClick={() => openModal("encounter")}>Document visit</Button> : null}
          />
          <CardBody flush>
            {chart.encounters.length === 0 ? (
              <EmptyState icon="notes" title="No encounters" message="Document a clinical visit." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>Type</th>
                      <th>Practitioner</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Note</th>
                      {editable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.encounters.map((encounter) => (
                      <tr key={encounter.id}>
                        <td className="nowrap">{formatDate(encounter.period?.start)}</td>
                        <td>{encounter.type?.[0]?.coding?.[0]?.display || "-"}</td>
                        <td>{encounterPractitionerName(encounter)}</td>
                        <td>
                          <Badge tone={encounter.status === "finished" ? "success" : "primary"}>{encounter.status}</Badge>
                        </td>
                        <td>{reasonText(encounter)}</td>
                        <td className="muted-text" style={{ whiteSpace: "pre-line", maxWidth: 320 }}>
                          {encounter.note?.[0]?.text || "-"}
                        </td>
                        {editable ? (
                          <td style={{ textAlign: "right" }}>
                            <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("encounter", encounter)}>
                              Edit
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- APPOINTMENTS ---------------- */}
      {activeTab === "appointments" ? (
        <Card>
          <CardHeader
            title="Appointments"
            icon="calendar"
            actions={
              <div className="row">
                <Link to="/schedule" className="inline-link">Open scheduler</Link>
                {editable ? <Button size="sm" icon="plus" onClick={() => openModal("appointment")}>Book</Button> : null}
              </div>
            }
          />
          <CardBody flush>
            {chart.appointments.length === 0 ? (
              <EmptyState icon="calendar" title="No appointments" message="No scheduled or past appointments." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>Practitioner</th>
                      <th>Status</th>
                      <th>Reason</th>
                      {editable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.appointments.map((appointment) => (
                      <tr key={appointment.id}>
                        <td className="nowrap">{formatDateTime(appointment.start)}</td>
                        <td>{apptPractitionerName(appointment)}</td>
                        <td>
                          <StatusBadge status={appointment.status} />
                        </td>
                        <td>{reasonText(appointment)}</td>
                        {editable ? (
                          <td style={{ textAlign: "right" }}>
                            <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("appointment", appointment)}>
                              Edit
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- TASKS ---------------- */}
      {activeTab === "tasks" ? (
        <Card>
          <CardHeader
            title="Care tasks"
            icon="tasks"
            actions={editable ? <Button size="sm" icon="plus" onClick={() => openModal("task")}>New task</Button> : null}
          />
          <CardBody flush>
            {chart.tasks.length === 0 ? (
              <EmptyState icon="tasks" title="No tasks" message="No care tasks for this patient." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Owner</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th>Status</th>
                      {editable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.tasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          {task.description}
                          {task.code?.text ? <span className="sub">{task.code.text}</span> : null}
                        </td>
                        <td>{task.owner?.display || "-"}</td>
                        <td>
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className="nowrap">
                          {formatDate(getTaskDueDate(task))}
                          {isTaskOverdue(task) ? <span className="sub" style={{ color: "var(--critical)" }}>Overdue</span> : null}
                        </td>
                        <td>
                          {editable && isTaskOpen(task) ? (
                            <select
                              className="input"
                              style={{ width: 140 }}
                              value={task.status}
                              disabled={saving}
                              onChange={(event) => updateTaskStatus(task, event.target.value)}
                            >
                              {["requested", "accepted", "in-progress", "on-hold", "completed", "cancelled"].map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge tone={isTaskOpen(task) ? "primary" : "neutral"}>{task.status}</Badge>
                          )}
                        </td>
                        {editable ? (
                          <td style={{ textAlign: "right" }}>
                            <Button size="xs" variant="ghost" icon="edit" disabled={saving} onClick={() => openEdit("task", task)}>
                              Edit
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ====================== MODALS ====================== */}
      <ChartModal open={activeModal === "condition"} title={editingRecord ? "Edit problem" : "Add problem"} onClose={closeModal} formId="condition-form" saving={saving} error={formError}>
        <form id="condition-form" className="form-grid" onSubmit={saveCondition}>
          <CodePicker label="Condition" catalog={CONDITION_CATALOG} code={forms.condition.code} display={forms.condition.display} onChange={(patch) => setForm("condition", patch)} required />
          <Field label="Clinical status">
            <select value={forms.condition.clinicalStatus} onChange={(e) => setForm("condition", { clinicalStatus: e.target.value })}>
              <option value="active">Active</option>
              <option value="recurrence">Recurrence</option>
              <option value="remission">Remission</option>
              <option value="resolved">Resolved</option>
            </select>
          </Field>
          <Field label="Note" span2>
            <textarea rows="2" value={forms.condition.note} onChange={(e) => setForm("condition", { note: e.target.value })} />
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "allergy"} title={editingRecord ? "Edit allergy" : "Add allergy"} onClose={closeModal} formId="allergy-form" saving={saving} error={formError}>
        <form id="allergy-form" className="form-grid" onSubmit={saveAllergy}>
          <CodePicker
            label="Allergen"
            catalog={ALLERGEN_CATALOG}
            code={forms.allergy.code}
            display={forms.allergy.display}
            onChange={(patch) => setForm("allergy", { ...patch, category: patch.category || forms.allergy.category })}
            required
          />
          <Field label="Category">
            <select value={forms.allergy.category} onChange={(e) => setForm("allergy", { category: e.target.value })}>
              <option value="medication">Medication</option>
              <option value="food">Food</option>
              <option value="environment">Environment</option>
              <option value="biologic">Biologic</option>
            </select>
          </Field>
          <Field label="Criticality">
            <select value={forms.allergy.criticality} onChange={(e) => setForm("allergy", { criticality: e.target.value })}>
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="unable-to-assess">Unable to assess</option>
            </select>
          </Field>
          <Field label="Clinical status">
            <select value={forms.allergy.clinicalStatus} onChange={(e) => setForm("allergy", { clinicalStatus: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="resolved">Resolved</option>
            </select>
          </Field>
          <Field label="Reaction">
            <select value={forms.allergy.reaction} onChange={(e) => setForm("allergy", { reaction: e.target.value })}>
              <option value="">—</option>
              {ALLERGY_REACTIONS.map((reaction) => (
                <option key={reaction} value={reaction}>
                  {reaction}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity">
            <select value={forms.allergy.severity} onChange={(e) => setForm("allergy", { severity: e.target.value })}>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "medication"} title={editingRecord ? "Edit medication" : "Prescribe medication"} onClose={closeModal} formId="medication-form" saving={saving} error={formError}>
        <form id="medication-form" className="form-grid" onSubmit={saveMedication}>
          <CodePicker label="Medication" catalog={MEDICATION_CATALOG} code={forms.medication.code} display={forms.medication.display} onChange={(patch) => setForm("medication", patch)} required />
          <Field label="Status">
            <select value={forms.medication.status} onChange={(e) => setForm("medication", { status: e.target.value })}>
              <option value="active">Active</option>
              <option value="on-hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="stopped">Stopped</option>
            </select>
          </Field>
          <Field label="Reason">
            <input value={forms.medication.reason} onChange={(e) => setForm("medication", { reason: e.target.value })} />
          </Field>
          <Field label="Dosage instructions" span2>
            <textarea rows="2" value={forms.medication.dosage} onChange={(e) => setForm("medication", { dosage: e.target.value })} placeholder="e.g. Take 1 tablet by mouth twice daily" />
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "observation"} title={editingRecord ? "Edit result" : "Record result"} onClose={closeModal} formId="observation-form" saving={saving} error={formError}>
        <form id="observation-form" className="form-grid" onSubmit={saveObservation}>
          <CodePicker
            label="Test / vital"
            catalog={OBSERVATION_CATALOG}
            code={forms.observation.code}
            display={forms.observation.display}
            onChange={(patch) => {
              const meta = findObservationMeta(patch.code);
              setForm("observation", { ...patch, unit: meta?.unit ?? forms.observation.unit });
            }}
            required
          />
          <Field label="Value">
            <input type="number" step="0.01" value={forms.observation.value} onChange={(e) => setForm("observation", { value: e.target.value })} required />
          </Field>
          <Field label="Unit">
            <input value={forms.observation.unit} onChange={(e) => setForm("observation", { unit: e.target.value })} required />
          </Field>
          <Field label="Note" span2>
            <textarea rows="2" value={forms.observation.note} onChange={(e) => setForm("observation", { note: e.target.value })} />
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "encounter"} title={editingRecord ? "Edit encounter" : "Document encounter"} onClose={closeModal} formId="encounter-form" saving={saving} error={formError} size="lg">
        <form id="encounter-form" className="form-grid" onSubmit={saveEncounter}>
          <Field label="Encounter type">
            <select value={forms.encounter.typeCode} onChange={(e) => setForm("encounter", { typeCode: e.target.value })}>
              {ENCOUNTER_TYPES.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.display}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={forms.encounter.status} onChange={(e) => setForm("encounter", { status: e.target.value })}>
              <option value="planned">Planned</option>
              <option value="arrived">Arrived</option>
              <option value="in-progress">In progress</option>
              <option value="finished">Finished</option>
            </select>
          </Field>
          <Field label="Reason">
            <input value={forms.encounter.reason} onChange={(e) => setForm("encounter", { reason: e.target.value })} />
          </Field>
          <Field label="Location">
            <input value={forms.encounter.location} onChange={(e) => setForm("encounter", { location: e.target.value })} />
          </Field>
          <Field label="Subjective" span2>
            <textarea rows="2" value={forms.encounter.s} onChange={(e) => setForm("encounter", { s: e.target.value })} placeholder="Patient-reported history" />
          </Field>
          <Field label="Objective" span2>
            <textarea rows="2" value={forms.encounter.o} onChange={(e) => setForm("encounter", { o: e.target.value })} placeholder="Exam findings, vitals" />
          </Field>
          <Field label="Assessment" span2>
            <textarea rows="2" value={forms.encounter.a} onChange={(e) => setForm("encounter", { a: e.target.value })} />
          </Field>
          <Field label="Plan" span2>
            <textarea rows="2" value={forms.encounter.p} onChange={(e) => setForm("encounter", { p: e.target.value })} />
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "task"} title={editingRecord ? "Edit care task" : "New care task"} onClose={closeModal} formId="task-form" saving={saving} error={formError}>
        <form id="task-form" className="form-grid" onSubmit={saveTask}>
          <Field label="Assignee">
            <select value={user.role === "practitioner" ? user.id : forms.task.ownerId} onChange={(e) => setForm("task", { ownerId: e.target.value })} disabled={user.role === "practitioner"}>
              {user.role === "admin" ? <option value="">Unassigned</option> : null}
              {(user.role === "practitioner" ? practitioners.filter((p) => p.id === user.id) : practitioners).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={forms.task.priority} onChange={(e) => setForm("task", { priority: e.target.value })}>
              {["routine", "urgent", "asap", "stat"].map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select value={forms.task.category} onChange={(e) => setForm("task", { category: e.target.value })}>
              {TASK_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={forms.task.dueDate} onChange={(e) => setForm("task", { dueDate: e.target.value })} />
          </Field>
          {editingRecord ? (
            <Field label="Status">
              <select value={forms.task.status} onChange={(e) => setForm("task", { status: e.target.value })}>
                {TASK_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Task summary" span2>
            <input value={forms.task.description} onChange={(e) => setForm("task", { description: e.target.value })} required />
          </Field>
          <Field label="Note" span2>
            <textarea rows="2" value={forms.task.note} onChange={(e) => setForm("task", { note: e.target.value })} />
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "appointment"} title="Book appointment" onClose={closeModal} formId="appointment-form" saving={saving} error={formError}>
        <form id="appointment-form" className="form-grid" onSubmit={createAppointment}>
          <Field label="Date">
            <input type="date" value={forms.appointment.appointmentDate} onChange={(e) => setForm("appointment", { appointmentDate: e.target.value })} required />
          </Field>
          <Field label="Practitioner">
            <select value={forms.appointment.practitionerId} onChange={(e) => setForm("appointment", { practitionerId: e.target.value })} disabled={user.role === "practitioner"} required>
              {availablePractitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service category">
            <select value={forms.appointment.serviceCategory} onChange={(e) => setForm("appointment", { serviceCategory: e.target.value })}>
              {SERVICE_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Slot">
            <select value={forms.appointment.slotValue} onChange={(e) => setForm("appointment", { slotValue: e.target.value })} required>
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
          <Field label="Reason" span2>
            <input value={forms.appointment.reason} onChange={(e) => setForm("appointment", { reason: e.target.value })} />
          </Field>
          {!isBookableDateInput(forms.appointment.appointmentDate) ? (
            <p className="banner banner-warning field-span-2">Slots are available Monday–Saturday only.</p>
          ) : availablePractitioners.length === 0 ? (
            <p className="banner banner-warning field-span-2">No practitioners available for this date.</p>
          ) : null}
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "appointmentEdit"} title="Edit appointment" onClose={closeModal} formId="appointment-edit-form" saving={saving} error={formError}>
        <form id="appointment-edit-form" className="form-grid" onSubmit={saveAppointmentEdit}>
          <Field label="When">
            <input value={editingRecord ? formatDateTime(editingRecord.start) : ""} disabled />
          </Field>
          <Field label="Status">
            <select value={forms.appointment.status} onChange={(e) => setForm("appointment", { status: e.target.value })}>
              {APPOINTMENT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service category">
            <select value={forms.appointment.serviceCategory} onChange={(e) => setForm("appointment", { serviceCategory: e.target.value })}>
              {SERVICE_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason" span2>
            <input value={forms.appointment.reason} onChange={(e) => setForm("appointment", { reason: e.target.value })} />
          </Field>
        </form>
      </ChartModal>

      <ChartModal open={activeModal === "patient"} title="Edit demographics" onClose={closeModal} formId="patient-form" saving={saving} error={formError} size="lg">
        <form id="patient-form" className="form-grid" onSubmit={savePatient}>
          <Field label="MRN">
            <input value={forms.patient.mrn} onChange={(e) => setForm("patient", { mrn: e.target.value })} placeholder="Optional" />
          </Field>
          <Field label="Gender">
            <select value={forms.patient.gender} onChange={(e) => setForm("patient", { gender: e.target.value })}>
              <option value="unknown">Unknown</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Given name">
            <input value={forms.patient.givenName} onChange={(e) => setForm("patient", { givenName: e.target.value })} required />
          </Field>
          <Field label="Family name">
            <input value={forms.patient.familyName} onChange={(e) => setForm("patient", { familyName: e.target.value })} required />
          </Field>
          <Field label="Birth date">
            <input type="date" value={forms.patient.birthDate} onChange={(e) => setForm("patient", { birthDate: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input value={forms.patient.phone} onChange={(e) => setForm("patient", { phone: e.target.value })} />
          </Field>
          <Field label="Email" span2>
            <input type="email" value={forms.patient.email} onChange={(e) => setForm("patient", { email: e.target.value })} />
          </Field>
          <Field label="Address line" span2>
            <input value={forms.patient.line1} onChange={(e) => setForm("patient", { line1: e.target.value })} />
          </Field>
          <Field label="City">
            <input value={forms.patient.city} onChange={(e) => setForm("patient", { city: e.target.value })} />
          </Field>
          <Field label="State">
            <input value={forms.patient.state} onChange={(e) => setForm("patient", { state: e.target.value })} />
          </Field>
          <Field label="Postal code">
            <input value={forms.patient.postalCode} onChange={(e) => setForm("patient", { postalCode: e.target.value })} />
          </Field>
        </form>
      </ChartModal>
    </section>
  );
};

const ChartModal = ({ open, title, onClose, formId, saving, error, size, children }) => (
  <Modal
    open={open}
    title={title}
    size={size}
    onClose={onClose}
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button form={formId} type="submit" loading={saving}>
          Save
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
    {children}
  </Modal>
);

export default PatientDetailPage;
