export const SLOT_INTERVAL_MINUTES = 15;
export const CLINIC_OPEN_MINUTES = 9 * 60;
export const CLINIC_CLOSE_MINUTES = 12 * 60;
export const SERVICE_CATEGORY_OPTIONS = [
  "Outpatient",
  "Follow-up",
  "Primary Care",
  "Preventive Care",
  "Annual Wellness Visit",
  "Chronic Disease Management",
  "Medication Review",
  "Post-Discharge Follow-up",
  "Urgent Care",
  "Behavioral Health",
  "Cardiology Consultation",
  "Dermatology Consultation",
  "Orthopedic Consultation",
  "Telehealth Visit",
  "Immunization"
];

// Only confirmed appointments occupy a slot; pending patient requests do not block.
const blockingStatuses = new Set(["booked", "arrived", "checked-in", "fulfilled"]);
const bookableWeekdays = new Set([1, 2, 3, 4, 5, 6]);

const pad = (value) => String(value).padStart(2, "0");

export const toDateInputValue = (date) => {
  const normalized = new Date(date);
  if (Number.isNaN(normalized.getTime())) {
    return "";
  }

  const year = normalized.getFullYear();
  const month = pad(normalized.getMonth() + 1);
  const day = pad(normalized.getDate());

  return `${year}-${month}-${day}`;
};

export const getNextBookableDateInput = (fromDate = new Date()) => {
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < 14; i += 1) {
    if (bookableWeekdays.has(cursor.getDay())) {
      return toDateInputValue(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return toDateInputValue(fromDate);
};

export const isBookableDateInput = (dateInput) => {
  if (!dateInput) {
    return false;
  }

  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return bookableWeekdays.has(date.getDay());
};

const format12Hour = (totalMinutes) => {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${pad(hours12)}:${pad(minutes)} ${period}`;
};

export const buildDailySlots = () => {
  const slots = [];

  for (
    let minutes = CLINIC_OPEN_MINUTES;
    minutes < CLINIC_CLOSE_MINUTES;
    minutes += SLOT_INTERVAL_MINUTES
  ) {
    const next = minutes + SLOT_INTERVAL_MINUTES;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    slots.push({
      value: `${pad(hour)}:${pad(minute)}`,
      label: `${format12Hour(minutes)} - ${format12Hour(next)}`
    });
  }

  return slots;
};

export const getDayRangeFromDateInput = (dateInput) => {
  const start = new Date(`${dateInput}T00:00:00`);
  const end = new Date(`${dateInput}T23:59:59.999`);
  return { start, end };
};

export const getSlotRange = (dateInput, slotValue) => {
  if (!dateInput || !slotValue) {
    return null;
  }

  const [hours, minutes] = slotValue.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const start = new Date(`${dateInput}T00:00:00`);
  start.setHours(hours, minutes, 0, 0);

  const end = new Date(start.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);

  return { start, end };
};

export const getPractitionerIdFromAppointment = (appointment) => {
  const participant = appointment.participant?.find((record) =>
    String(record.actor?.reference || "").startsWith("Practitioner/")
  );

  const reference = participant?.actor?.reference || "";
  return reference.startsWith("Practitioner/") ? reference.slice("Practitioner/".length) : "";
};

export const isBlockingAppointmentStatus = (status) => blockingStatuses.has(status || "");

export const isSlotUnavailable = ({ appointments, practitionerId, dateInput, slotValue }) => {
  if (!isBookableDateInput(dateInput)) {
    return true;
  }

  const slotRange = getSlotRange(dateInput, slotValue);
  if (!slotRange) {
    return true;
  }

  return appointments.some((appointment) => {
    if (!isBlockingAppointmentStatus(appointment.status)) {
      return false;
    }

    const appointmentPractitionerId = getPractitionerIdFromAppointment(appointment);
    if (appointmentPractitionerId !== practitionerId) {
      return false;
    }

    const appointmentStart = new Date(appointment.start);
    const appointmentEnd = new Date(appointment.end);

    if (Number.isNaN(appointmentStart.getTime()) || Number.isNaN(appointmentEnd.getTime())) {
      return false;
    }

    return appointmentStart < slotRange.end && appointmentEnd > slotRange.start;
  });
};

export const practitionerHasAvailableSlot = ({ appointments, practitionerId, dateInput }) => {
  if (!isBookableDateInput(dateInput)) {
    return false;
  }

  const slots = buildDailySlots();

  return slots.some(
    (slot) =>
      !isSlotUnavailable({
        appointments,
        practitionerId,
        dateInput,
        slotValue: slot.value
      })
  );
};
