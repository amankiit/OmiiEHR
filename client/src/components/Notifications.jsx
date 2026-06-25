import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { fhirApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { bundleToResources } from "../utils/fhir.js";
import { formatTime } from "../utils/display.js";

const LEAD_MS = 30 * 60 * 1000; // notify for appointments within next 30 min
const POLL_MS = 60 * 1000;

const Notifications = () => {
  const { user, token } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = user?.role === "practitioner";

  const poll = useCallback(async () => {
    if (!active || !token) {
      return;
    }
    const now = new Date();
    const windowEnd = new Date(now.getTime() + LEAD_MS);
    const bundle = await fhirApi.listAppointments(token, {
      from: now.toISOString(),
      to: windowEnd.toISOString()
    });
    const upcoming = bundleToResources(bundle)
      .filter((appointment) => !["cancelled", "noshow"].includes(appointment.status))
      .map((appointment) => ({
        id: appointment.id,
        start: appointment.start,
        reason: appointment.reasonCode?.[0]?.text || appointment.description || "Appointment"
      }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    setItems(upcoming);
  }, [active, token]);

  useEffect(() => {
    if (!active) {
      setItems([]);
      return undefined;
    }
    poll().catch(() => {});
    const timer = setInterval(() => poll().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [active, poll]);

  useEffect(() => {
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!active) {
    return null;
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => setOpen((value) => !value)}>
        <Icon name="bell" size={18} />
        {items.length > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 999,
              background: "var(--critical)",
              color: "#fff",
              fontSize: "0.62rem",
              fontWeight: 800,
              display: "grid",
              placeItems: "center"
            }}
          >
            {items.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="search-results" style={{ width: 280, left: "auto", right: 0 }}>
          <div style={{ padding: "0.7rem 0.85rem", borderBottom: "1px solid var(--border)", fontWeight: 700 }}>
            Upcoming appointments
          </div>
          {items.length === 0 ? (
            <p className="search-empty">Nothing in the next 30 minutes.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="search-result" style={{ cursor: "default" }}>
                <span className="stat-tile-accent">
                  <Icon name="clock" size={15} />
                </span>
                <div className="grow">
                  <p className="search-result-name">{formatTime(item.start)}</p>
                  <p className="search-result-meta">{item.reason}</p>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
};

export default Notifications;
