import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { fhirApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { bundleToResources, patientFullName, patientMrn } from "../utils/fhir.js";
import { calculateAge, genderShort, initialsOf } from "../utils/display.js";

const GlobalSearch = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    const onClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced server-side search: the backend matches name/MRN/PID/DOB.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      fhirApi
        .searchPatients(token, term)
        .then((bundle) => {
          if (!cancelled) {
            setResults(bundleToResources(bundle).slice(0, 8));
            setActiveIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, token]);

  const go = (patient) => {
    setOpen(false);
    setQuery("");
    navigate(`/patients/${patient.id}`);
  };

  const onKeyDown = (event) => {
    if (!open || results.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[activeIndex] || results[0]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="global-search" ref={containerRef}>
      <div className="global-search-input">
        <Icon name="search" size={17} />
        <input
          value={query}
          placeholder="Search patients by name, MRN, or DOB"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && query.trim() ? (
        <div className="search-results">
          {results.length === 0 ? (
            <p className="search-empty">{searching ? "Searching…" : `No patients match “${query}”.`}</p>
          ) : (
            results.map((patient, index) => {
              const age = calculateAge(patient.birthDate);
              return (
                <div
                  key={patient.id}
                  className={`search-result ${index === activeIndex ? "search-result-active" : ""}`}
                  onMouseDown={() => go(patient)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="avatar">{initialsOf(patientFullName(patient))}</span>
                  <div className="grow">
                    <p className="search-result-name">{patientFullName(patient)}</p>
                    <p className="search-result-meta">
                      MRN {patientMrn(patient)} · {age != null ? `${age}y ` : ""}
                      {genderShort(patient.gender)} · DOB {patient.birthDate || "-"}
                    </p>
                  </div>
                  <Icon name="chevronRight" size={16} />
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
};

export default GlobalSearch;
