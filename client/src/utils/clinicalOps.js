const ACTIVE_CONDITION_STATUSES = new Set(["active", "recurrence", "relapse"]);
const CLOSED_TASK_STATUSES = new Set([
  "completed",
  "cancelled",
  "rejected",
  "failed",
  "entered-in-error"
]);

const A1C_CODES = new Set(["4548-4"]);
const SYSTOLIC_BP_CODES = new Set(["8480-6"]);
const DIASTOLIC_BP_CODES = new Set(["8462-4"]);

const normalize = (value) => String(value || "").trim().toLowerCase();

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (older, newer = new Date()) => {
  if (!older) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((newer.getTime() - older.getTime()) / (1000 * 60 * 60 * 24));
};

const codingOf = (resource) => resource?.code?.coding?.[0] || {};

const textOf = (resource) =>
  normalize(codingOf(resource).display || codingOf(resource).code || resource?.code?.text || "");

const statusOfCondition = (condition) =>
  normalize(condition?.clinicalStatus?.coding?.[0]?.code || condition?.clinicalStatus?.text || "");

const numberFromObservation = (observation) => {
  const value = observation?.valueQuantity?.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const latestByDate = (items, dateSelector) => {
  const sorted = [...items].sort((a, b) => {
    const dateA = toDate(dateSelector(a));
    const dateB = toDate(dateSelector(b));
    return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
  });

  return sorted[0] || null;
};

const latestObservationByCodes = (observations, codeSet) => {
  const matching = observations.filter((observation) =>
    codeSet.has(normalize(observation?.code?.coding?.[0]?.code))
  );

  return latestByDate(matching, (observation) => observation.effectiveDateTime || observation.issued);
};

const hasRecentObservation = (observations, codeSet, lookbackDays) => {
  const latest = latestObservationByCodes(observations, codeSet);
  if (!latest) {
    return false;
  }

  const observedAt = toDate(latest.effectiveDateTime || latest.issued);
  return daysBetween(observedAt) <= lookbackDays;
};

const hasUpcomingAppointmentWithin = (appointments, lookaheadDays, now = new Date()) => {
  const end = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

  return appointments.some((appointment) => {
    const start = toDate(appointment.start);
    if (!start) {
      return false;
    }

    return start >= now && start <= end && normalize(appointment.status) !== "cancelled";
  });
};

const appointmentDescription = (appointment) => {
  return normalize(
    appointment?.serviceCategory?.[0]?.text ||
      appointment?.description ||
      appointment?.reasonCode?.[0]?.text ||
      ""
  );
};

export const isTaskOpen = (task) => !CLOSED_TASK_STATUSES.has(normalize(task?.status));

export const getTaskDueDate = (task) => {
  return (
    task?.executionPeriod?.end ||
    task?.dueDate ||
    task?.restriction?.period?.end ||
    task?.authoredOn ||
    null
  );
};

export const isTaskOverdue = (task, now = new Date()) => {
  if (!isTaskOpen(task)) {
    return false;
  }

  const dueDate = toDate(getTaskDueDate(task));
  return Boolean(dueDate && dueDate.getTime() < now.getTime());
};

export const extractPatientIdFromReference = (reference) => {
  const [resourceType, id] = String(reference || "").split("/");
  if (resourceType !== "Patient" || !id) {
    return "";
  }

  return id;
};

export const extractPatientIdFromAppointment = (appointment) => {
  const participant = appointment?.participant?.find((entry) =>
    String(entry.actor?.reference || "").startsWith("Patient/")
  );

  return extractPatientIdFromReference(participant?.actor?.reference);
};

export const groupByPatient = (resources, getPatientId) => {
  return resources.reduce((map, resource) => {
    const patientId = getPatientId(resource);
    if (!patientId) {
      return map;
    }

    const current = map.get(patientId) || [];
    current.push(resource);
    map.set(patientId, current);
    return map;
  }, new Map());
};

export const classifyRiskTier = (score) => {
  if (score >= 8) {
    return "high";
  }

  if (score >= 4) {
    return "medium";
  }

  return "low";
};

export const buildPatientRiskProfile = ({
  conditions = [],
  allergies = [],
  medications = [],
  observations = [],
  encounters = [],
  appointments = [],
  tasks = []
}) => {
  const activeConditions = conditions.filter((condition) =>
    ACTIVE_CONDITION_STATUSES.has(statusOfCondition(condition))
  );

  const activeMedications = medications.filter(
    (medication) => !["stopped", "completed", "cancelled", "entered-in-error"].includes(normalize(medication.status))
  );

  const severeAllergies = allergies.filter((allergy) => {
    const reactionSeverity = normalize(allergy?.reaction?.[0]?.severity);
    return normalize(allergy.criticality) === "high" || reactionSeverity === "severe";
  });

  const activeAllergies = allergies.filter(
    (allergy) =>
      normalize(allergy?.clinicalStatus?.coding?.[0]?.code || allergy?.clinicalStatus?.text || "active") === "active"
  );

  const latestSystolic = latestObservationByCodes(observations, SYSTOLIC_BP_CODES);
  const latestDiastolic = latestObservationByCodes(observations, DIASTOLIC_BP_CODES);
  const latestA1c = latestObservationByCodes(observations, A1C_CODES);
  const systolicValue = numberFromObservation(latestSystolic);
  const diastolicValue = numberFromObservation(latestDiastolic);
  const a1cValue = numberFromObservation(latestA1c);

  const hasDiabetes = activeConditions.some((condition) => {
    const code = normalize(codingOf(condition).code);
    const label = textOf(condition);
    return code === "44054006" || label.includes("diabetes");
  });

  const hasHypertension = activeConditions.some((condition) => textOf(condition).includes("hypertension"));

  const careGaps = [];
  const safetyAlerts = [];

  if (hasDiabetes && !hasRecentObservation(observations, A1C_CODES, 180)) {
    careGaps.push({
      severity: "high",
      title: "HbA1c follow-up overdue",
      detail: "No HbA1c result found in the last 180 days for an active diabetes condition."
    });
  }

  if ((hasHypertension || (systolicValue || 0) >= 140 || (diastolicValue || 0) >= 90) && !hasRecentObservation(observations, SYSTOLIC_BP_CODES, 30)) {
    careGaps.push({
      severity: "medium",
      title: "Blood pressure follow-up needed",
      detail: "No recent blood-pressure observation found in the last 30 days."
    });
  }

  const latestEncounter = latestByDate(encounters, (encounter) => encounter.period?.start);
  if (!latestEncounter || daysBetween(toDate(latestEncounter.period?.start)) > 180) {
    careGaps.push({
      severity: "medium",
      title: "Continuity-of-care visit due",
      detail: "No encounter documented in the last 180 days."
    });
  }

  const hasMedicationReviewVisit = appointments.some((appointment) => {
    const description = appointmentDescription(appointment);
    const start = toDate(appointment.start);
    return (
      Boolean(start) &&
      daysBetween(start) <= 120 &&
      (description.includes("medication review") || description.includes("follow-up"))
    );
  });

  if (activeMedications.length >= 5 && !hasMedicationReviewVisit) {
    careGaps.push({
      severity: "medium",
      title: "Medication reconciliation due",
      detail: "Polypharmacy profile without a recent medication-review follow-up."
    });
  }

  // Only flag a missing follow-up when the patient has some clinical context to
  // follow up on — an active condition, an active allergy, or an open/assigned task.
  // Patients with none of these are not surfaced with this care gap.
  const hasClinicalContext =
    activeConditions.length > 0 || activeAllergies.length > 0 || tasks.length > 0;

  if (hasClinicalContext && !hasUpcomingAppointmentWithin(appointments, 60)) {
    careGaps.push({
      severity: "low",
      title: "No upcoming follow-up appointment",
      detail: "No booked appointment found in the next 60 days."
    });
  }

  if (severeAllergies.length > 0) {
    safetyAlerts.push({
      severity: "high",
      title: "Severe allergy profile",
      detail: `${severeAllergies.length} severe/high-criticality allergy record(s) require active review.`
    });
  }

  const medicationConflicts = activeMedications.filter((medication) => {
    const medicationLabel = normalize(
      medication?.medicationCodeableConcept?.coding?.[0]?.display ||
        medication?.medicationCodeableConcept?.coding?.[0]?.code
    );

    if (!medicationLabel) {
      return false;
    }

    return allergies.some((allergy) => {
      if (!normalize((allergy.category || []).join(" ")).includes("medication")) {
        return false;
      }

      const allergyLabel = textOf(allergy);
      if (!allergyLabel) {
        return false;
      }

      return medicationLabel.includes(allergyLabel) || allergyLabel.includes(medicationLabel);
    });
  });

  if (medicationConflicts.length > 0) {
    safetyAlerts.push({
      severity: "high",
      title: "Potential allergy-medication conflict",
      detail: `${medicationConflicts.length} active medication(s) may conflict with allergy records.`
    });
  }

  if ((systolicValue || 0) >= 180 || (diastolicValue || 0) >= 120) {
    safetyAlerts.push({
      severity: "high",
      title: "Hypertensive crisis threshold",
      detail: `Latest BP ${systolicValue || "-"} / ${diastolicValue || "-"} mmHg is above crisis threshold.`
    });
  }

  if (activeMedications.length >= 8) {
    safetyAlerts.push({
      severity: "medium",
      title: "Polypharmacy review recommended",
      detail: `${activeMedications.length} active medications detected.`
    });
  }

  const openTasks = tasks.filter(isTaskOpen);
  const overdueTasks = openTasks.filter((task) => isTaskOverdue(task));

  let score = 0;
  score += safetyAlerts.filter((alert) => alert.severity === "high").length * 4;
  score += safetyAlerts.filter((alert) => alert.severity === "medium").length * 2;
  score += careGaps.filter((gap) => gap.severity === "high").length * 3;
  score += careGaps.filter((gap) => gap.severity === "medium").length * 2;
  score += careGaps.filter((gap) => gap.severity === "low").length;

  if (overdueTasks.length > 0) {
    score += 2;
  }
  if (openTasks.length >= 5) {
    score += 1;
  }

  return {
    score,
    tier: classifyRiskTier(score),
    careGaps,
    safetyAlerts,
    latestVitals: {
      systolic: systolicValue,
      diastolic: diastolicValue,
      a1c: a1cValue
    },
    activeConditionCount: activeConditions.length,
    activeAllergyCount: activeAllergies.length,
    activeMedicationCount: activeMedications.length,
    openTaskCount: openTasks.length,
    overdueTaskCount: overdueTasks.length
  };
};

export const calculateDayNoShowRate = (appointments, day = new Date()) => {
  const sameDay = appointments.filter((appointment) => {
    const start = toDate(appointment.start);
    return Boolean(start && start.toDateString() === day.toDateString());
  });

  if (sameDay.length === 0) {
    return 0;
  }

  const noShows = sameDay.filter((appointment) => normalize(appointment.status) === "noshow");
  return Math.round((noShows.length / sameDay.length) * 1000) / 10;
};

export const calculateNoShowRate = (appointments, lookbackDays = 90, now = new Date()) => {
  const lowerBound = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const historical = appointments.filter((appointment) => {
    const start = toDate(appointment.start);
    return Boolean(start && start >= lowerBound && start <= now);
  });

  if (historical.length === 0) {
    return 0;
  }

  const noShows = historical.filter((appointment) => normalize(appointment.status) === "noshow");
  return Math.round((noShows.length / historical.length) * 1000) / 10;
};

export const calculateServiceMix = (appointments) => {
  const counts = appointments.reduce((map, appointment) => {
    const label =
      appointment?.serviceCategory?.[0]?.text ||
      appointment?.serviceCategory?.[0]?.coding?.[0]?.display ||
      "Unspecified";

    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map());

  return Array.from(counts.entries())
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count);
};
