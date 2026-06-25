import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../api.js";
import { buildDailySlots, getNextBookableDateInput, getSlotRange, isBookableDateInput } from "../utils/scheduling.js";
import { SERVICE_CATEGORY_OPTIONS, PRACTITIONER_ROLES } from "../utils/catalog.js";
import { Button, Card, CardBody, CardHeader, Field } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const emptyRegister = {
  givenName: "",
  familyName: "",
  birthDate: "",
  gender: "unknown",
  phone: "",
  email: "",
  line1: "",
  city: "",
  state: "",
  postalCode: ""
};

const emptyRequest = {
  pid: "",
  practitionerType: "all",
  practitionerId: "",
  appointmentDate: getNextBookableDateInput(),
  slotValue: "",
  serviceCategory: "Outpatient",
  reason: ""
};

const SLOTS = buildDailySlots();

const PatientPortalPage = () => {
  const [mode, setMode] = useState("register");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [practitioners, setPractitioners] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    publicApi
      .listPractitioners()
      .then((response) => setPractitioners(response.data || []))
      .catch(() => {});
  }, []);

  // Fetch which slots are already taken for the chosen practitioner + date.
  useEffect(() => {
    const { practitionerId, appointmentDate } = requestForm;
    if (mode !== "request" || !practitionerId || !isBookableDateInput(appointmentDate)) {
      setUnavailable([]);
      return undefined;
    }
    let cancelled = false;
    publicApi
      .getAvailability(practitionerId, appointmentDate)
      .then((response) => {
        if (!cancelled) {
          setUnavailable(response.unavailable || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, requestForm.practitionerId, requestForm.appointmentDate]);

  // Clear a selected slot if it becomes unavailable.
  useEffect(() => {
    if (requestForm.slotValue && unavailable.includes(requestForm.slotValue)) {
      setRequestForm((prev) => ({ ...prev, slotValue: "" }));
    }
  }, [unavailable, requestForm.slotValue]);

  const updateRegister = (key) => (event) => setRegisterForm((prev) => ({ ...prev, [key]: event.target.value }));
  const updateRequest = (key) => (event) => setRequestForm((prev) => ({ ...prev, [key]: event.target.value }));

  // Practitioners matching the chosen type; changing the type clears the selection.
  const filteredPractitioners =
    requestForm.practitionerType === "all"
      ? practitioners
      : practitioners.filter((p) => p.practitionerRole === requestForm.practitionerType);

  const onPractitionerTypeChange = (event) =>
    setRequestForm((prev) => ({ ...prev, practitionerType: event.target.value, practitionerId: "" }));

  const switchMode = (next) => {
    setError("");
    setRequested(false);
    setMode(next);
  };

  const onRegister = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await publicApi.registerPatient(registerForm);
      setRegistered(response);
      setRegisterForm(emptyRegister);
      setRequestForm((prev) => ({ ...prev, pid: response.pid }));
    } catch (err) {
      setError(err.message || "Unable to complete registration");
    } finally {
      setLoading(false);
    }
  };

  const onRequest = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const slot = getSlotRange(requestForm.appointmentDate, requestForm.slotValue);
      if (!slot) {
        throw new Error("Please choose a date and time slot");
      }
      await publicApi.requestAppointment({
        pid: requestForm.pid.trim(),
        practitionerId: requestForm.practitionerId,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        serviceCategory: requestForm.serviceCategory,
        reason: requestForm.reason
      });
      setRequested(true);
      setRequestForm((prev) => ({ ...prev, slotValue: "", reason: "" }));
    } catch (err) {
      setError(err.message || "Unable to submit appointment request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2.5rem 1rem" }}>
      <div style={{ width: "100%", maxWidth: 640 }} className="stack">
        <div className="row" style={{ justifyContent: "center", gap: "0.6rem" }}>
          <span className="sidebar-brand-mark">O</span>
          <strong style={{ fontSize: "1.2rem" }}>OmiiEHR Patient Portal</strong>
        </div>

        <div className="segmented" style={{ alignSelf: "center" }}>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>
            New registration
          </button>
          <button type="button" className={mode === "request" ? "active" : ""} onClick={() => switchMode("request")}>
            Request appointment
          </button>
        </div>

        {error ? (
          <p className="banner banner-error">
            <Icon name="alert" size={16} />
            {error}
          </p>
        ) : null}

        {mode === "register" ? (
          registered ? (
            <Card>
              <CardBody>
                <div className="empty-state">
                  <Icon name="check" size={40} strokeWidth={2} style={{ color: "var(--success)" }} />
                  <h2>Registration submitted</h2>
                  <p className="muted-text">Your registration is pending staff approval. Keep your Patient ID (PID):</p>
                  <p style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "0.04em" }}>{registered.pid}</p>
                  <div className="row">
                    <Button icon="calendar" onClick={() => switchMode("request")}>
                      Request an appointment
                    </Button>
                    <Link to="/login" className="btn btn-secondary">
                      Staff sign in
                    </Link>
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="New patient registration" sub="A unique 7-digit PID is generated; an administrator approves your record." />
              <CardBody>
                <form className="form-grid" onSubmit={onRegister}>
                  <Field label="Given name">
                    <input value={registerForm.givenName} onChange={updateRegister("givenName")} required />
                  </Field>
                  <Field label="Family name">
                    <input value={registerForm.familyName} onChange={updateRegister("familyName")} required />
                  </Field>
                  <Field label="Birth date">
                    <input type="date" value={registerForm.birthDate} onChange={updateRegister("birthDate")} required />
                  </Field>
                  <Field label="Gender">
                    <select value={registerForm.gender} onChange={updateRegister("gender")}>
                      <option value="unknown">Unknown</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Phone">
                    <input value={registerForm.phone} onChange={updateRegister("phone")} />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={registerForm.email} onChange={updateRegister("email")} />
                  </Field>
                  <Field label="Address line" span2>
                    <input value={registerForm.line1} onChange={updateRegister("line1")} />
                  </Field>
                  <Field label="City">
                    <input value={registerForm.city} onChange={updateRegister("city")} />
                  </Field>
                  <Field label="State">
                    <input value={registerForm.state} onChange={updateRegister("state")} />
                  </Field>
                  <Field label="Postal code">
                    <input value={registerForm.postalCode} onChange={updateRegister("postalCode")} />
                  </Field>
                  <div className="field-span-2 spread">
                    <Link to="/login" className="inline-link">
                      Back to staff sign in
                    </Link>
                    <Button type="submit" loading={loading}>
                      {loading ? "Submitting…" : "Submit registration"}
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          )
        ) : (
          <Card>
            <CardHeader title="Request an appointment" sub="Enter your Patient ID (PID) and choose a practitioner and time. Staff will confirm your request." />
            <CardBody>
              {requested ? (
                <div className="empty-state">
                  <Icon name="check" size={40} strokeWidth={2} style={{ color: "var(--success)" }} />
                  <h2>Request submitted</h2>
                  <p className="muted-text">Your appointment request is pending confirmation by the clinic.</p>
                  <Link to="/login" className="btn btn-secondary btn-sm">
                    Staff sign in
                  </Link>
                </div>
              ) : (
                <form className="form-grid" onSubmit={onRequest}>
                  <Field label="Patient ID (PID)" span2 hint="Shown after you register">
                    <input value={requestForm.pid} onChange={updateRequest("pid")} required />
                  </Field>
                  <Field label="Practitioner type">
                    <select value={requestForm.practitionerType} onChange={onPractitionerTypeChange}>
                      <option value="all">All practitioners</option>
                      {PRACTITIONER_ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.plural}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Practitioner">
                    <select value={requestForm.practitionerId} onChange={updateRequest("practitionerId")} required>
                      <option value="" disabled>
                        {filteredPractitioners.length === 0 ? "No practitioners available" : "Select a practitioner"}
                      </option>
                      {filteredPractitioners.map((practitioner) => (
                        <option key={practitioner.id} value={practitioner.id}>
                          {practitioner.fullName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Preferred date">
                    <input type="date" value={requestForm.appointmentDate} onChange={updateRequest("appointmentDate")} required />
                  </Field>
                  <Field label="Preferred time">
                    <select value={requestForm.slotValue} onChange={updateRequest("slotValue")} required>
                      <option value="" disabled>
                        Choose a slot
                      </option>
                      {SLOTS.map((slot) => {
                        const taken = unavailable.includes(slot.value);
                        return (
                          <option key={slot.value} value={slot.value} disabled={taken}>
                            {slot.label}
                            {taken ? " (unavailable)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                  <Field label="Visit type">
                    <select value={requestForm.serviceCategory} onChange={updateRequest("serviceCategory")}>
                      {SERVICE_CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reason for visit">
                    <input value={requestForm.reason} onChange={updateRequest("reason")} placeholder="Optional" />
                  </Field>
                  {!isBookableDateInput(requestForm.appointmentDate) ? (
                    <p className="banner banner-warning field-span-2">Appointments are available Monday–Saturday only.</p>
                  ) : requestForm.practitionerId && SLOTS.every((slot) => unavailable.includes(slot.value)) ? (
                    <p className="banner banner-warning field-span-2">
                      No open slots on this date — please choose another day.
                    </p>
                  ) : null}
                  <div className="field-span-2 spread">
                    <Link to="/login" className="inline-link">
                      Back to staff sign in
                    </Link>
                    <Button type="submit" loading={loading} disabled={!isBookableDateInput(requestForm.appointmentDate)}>
                      {loading ? "Submitting…" : "Submit request"}
                    </Button>
                  </div>
                </form>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
};

export default PatientPortalPage;
