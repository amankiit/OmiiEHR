import { Badge, RiskBadge } from "./ui.jsx";
import Icon from "./Icon.jsx";
import {
  patientFullName,
  patientMrn,
  patientPid,
  patientContact,
  pickCodingDisplay
} from "../utils/fhir.js";
import { calculateAge, genderShort, initialsOf } from "../utils/display.js";

const Fact = ({ label, value }) => (
  <div>
    <p className="banner-fact-label">{label}</p>
    <p className="banner-fact-value">{value}</p>
  </div>
);

const PatientBanner = ({ patient, allergies = [], riskProfile, activeProblemCount = 0 }) => {
  const age = calculateAge(patient.birthDate);
  const contact = patientContact(patient);
  const allergyNames = allergies.map((allergy) => pickCodingDisplay(allergy)).filter(Boolean);

  return (
    <div className="patient-banner">
      <span className="avatar">{initialsOf(patientFullName(patient))}</span>

      <div className="patient-banner-id">
        <h1>{patientFullName(patient)}</h1>
        <div className="patient-banner-tags">
          <Badge tone="neutral">
            {age != null ? `${age}y` : "Age —"} · {genderShort(patient.gender)}
          </Badge>
          <Badge tone="neutral">MRN {patientMrn(patient)}</Badge>
          {riskProfile ? <RiskBadge tier={riskProfile.tier} score={riskProfile.score} /> : null}
          {allergyNames.length > 0 ? (
            <span className="allergy-flag" title={allergyNames.join(", ")}>
              <Icon name="allergy" size={13} />
              {allergyNames.length} {allergyNames.length === 1 ? "allergy" : "allergies"}
            </span>
          ) : (
            <Badge tone="success" dot>
              NKDA
            </Badge>
          )}
        </div>
      </div>

      <div className="patient-banner-facts">
        <Fact label="DOB" value={patient.birthDate || "—"} />
        <Fact label="PID" value={patientPid(patient)} />
        <Fact label="Active problems" value={activeProblemCount} />
        <Fact label="Phone" value={contact.phone} />
      </div>
    </div>
  );
};

export default PatientBanner;
