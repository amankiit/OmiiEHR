import { useState } from "react";
import { Field } from "./ui.jsx";

const CUSTOM = "__custom__";

// A coded-concept picker: choose from a curated catalog, or enter a code manually.
const CodePicker = ({ label, catalog, code, display, onChange, required }) => {
  const matched = catalog.find((item) => item.code === code);
  const [manual, setManual] = useState(Boolean(!matched && (code || display)));

  const onSelect = (event) => {
    const value = event.target.value;
    if (value === CUSTOM) {
      setManual(true);
      onChange({ code: "", display: "" });
      return;
    }
    setManual(false);
    const item = catalog.find((entry) => entry.code === value);
    onChange({ code: item?.code || "", display: item?.display || "", category: item?.category });
  };

  return (
    <>
      <Field label={label} span2>
        <select value={manual ? CUSTOM : matched ? code : ""} onChange={onSelect} required={required}>
          <option value="" disabled>
            Select…
          </option>
          {catalog.map((item) => (
            <option key={item.code} value={item.code}>
              {item.display}
            </option>
          ))}
          <option value={CUSTOM}>Custom entry…</option>
        </select>
      </Field>
      {manual ? (
        <>
          <Field label="Name">
            <input value={display} onChange={(event) => onChange({ code, display: event.target.value })} required={required} />
          </Field>
          <Field label="Code">
            <input value={code} onChange={(event) => onChange({ code: event.target.value, display })} required={required} />
          </Field>
        </>
      ) : null}
    </>
  );
};

export default CodePicker;
