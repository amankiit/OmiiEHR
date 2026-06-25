import { useEffect } from "react";
import Icon from "./Icon.jsx";

/* ---------------- Button ---------------- */
export const Button = ({
  variant = "primary",
  size,
  icon,
  loading,
  block,
  children,
  className = "",
  ...rest
}) => {
  const classes = [
    "btn",
    `btn-${variant}`,
    size ? `btn-${size}` : "",
    block ? "btn-block" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
};

export const IconButton = ({ name, label, size = 18, className = "", children, ...rest }) => (
  <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
    <Icon name={name} size={size} />
    {children}
  </button>
);

/* ---------------- Card ---------------- */
export const Card = ({ children, className = "", ...rest }) => (
  <section className={`card ${className}`} {...rest}>
    {children}
  </section>
);

export const CardHeader = ({ title, icon, sub, actions }) => (
  <div className="card-header">
    <div>
      <h2>
        {icon ? <Icon name={icon} size={18} /> : null}
        {title}
      </h2>
      {sub ? <p className="section-sub">{sub}</p> : null}
    </div>
    {actions ? <div className="row">{actions}</div> : null}
  </div>
);

export const CardBody = ({ children, flush, className = "" }) => (
  <div className={`card-body ${flush ? "flush" : ""} ${className}`}>{children}</div>
);

/* ---------------- Badge ---------------- */
export const Badge = ({ tone = "neutral", dot, children, className = "" }) => (
  <span className={`badge badge-${tone} ${dot ? "badge-dot" : ""} ${className}`}>{children}</span>
);

const PRIORITY_TONE = { stat: "critical", asap: "critical", urgent: "warning", routine: "neutral" };
export const PriorityBadge = ({ priority = "routine" }) => (
  <Badge tone={PRIORITY_TONE[String(priority).toLowerCase()] || "neutral"}>{priority}</Badge>
);

const RISK_TONE = { high: "critical", medium: "warning", low: "success" };
export const RiskBadge = ({ tier, score }) => (
  <Badge tone={RISK_TONE[tier] || "neutral"} dot>
    {tier}
    {score !== undefined ? ` · ${score}` : ""}
  </Badge>
);

const APPT_TONE = {
  booked: "primary",
  arrived: "warning",
  "checked-in": "warning",
  fulfilled: "success",
  waitlist: "neutral",
  noshow: "critical",
  cancelled: "neutral",
  pending: "neutral",
  proposed: "neutral"
};
export const StatusBadge = ({ status }) => (
  <Badge tone={APPT_TONE[String(status).toLowerCase()] || "neutral"}>{status || "-"}</Badge>
);

/* ---------------- Field ---------------- */
export const Field = ({ label, hint, children, span2, className = "" }) => (
  <label className={`field ${span2 ? "field-span-2" : ""} ${className}`}>
    {label ? <span>{label}</span> : null}
    {children}
    {hint ? <span className="field-hint">{hint}</span> : null}
  </label>
);

export const TextInput = (props) => <input {...props} />;
export const Select = ({ children, ...props }) => <select {...props}>{children}</select>;
export const Textarea = (props) => <textarea {...props} />;

/* ---------------- Modal ---------------- */
export const Modal = ({ open, title, onClose, children, footer, size }) => {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal ${size === "lg" ? "modal-lg" : ""}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton name="close" label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

/* ---------------- Tabs ---------------- */
export const Tabs = ({ tabs, active, onChange }) => (
  <div className="tabs" role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        className={`tab ${active === tab.id ? "tab-active" : ""}`}
        onClick={() => onChange(tab.id)}
      >
        {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
        {tab.label}
        {tab.count !== undefined && tab.count !== null ? (
          <span className="tab-count">{tab.count}</span>
        ) : null}
      </button>
    ))}
  </div>
);

/* ---------------- Stat tile ---------------- */
export const StatTile = ({ label, value, foot, icon, tone, onClick }) => {
  const inner = (
    <>
      <div className="spread">
        <span className="stat-tile-label">{label}</span>
        {icon ? (
          <span className="stat-tile-accent">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <span className="stat-tile-value">{value}</span>
      {foot ? <span className="stat-tile-foot">{foot}</span> : null}
    </>
  );

  const className = `stat-tile ${tone ? `tone-${tone}` : ""}`;
  if (onClick) {
    return (
      <button type="button" className={className} style={{ textAlign: "left", cursor: "pointer" }} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
};

/* ---------------- Empty / spinner ---------------- */
export const EmptyState = ({ icon = "info", title, message, action }) => (
  <div className="empty-state">
    <Icon name={icon} size={34} strokeWidth={1.5} />
    {title ? <h3>{title}</h3> : null}
    {message ? <p className="muted-text">{message}</p> : null}
    {action}
  </div>
);

export const Loading = ({ label = "Loading…" }) => (
  <div className="loading-center">
    <span className="spinner spinner-lg" />
    {label}
  </div>
);

/* ---------------- Sparkline ---------------- */
export const Sparkline = ({ values = [], width = 120, height = 34, color = "var(--primary)" }) => {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length < 2) {
    return <span className="muted-text" style={{ fontSize: "0.74rem" }}>—</span>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);

  const path = points
    .map((value, index) => {
      const x = index * stepX;
      const y = height - 4 - ((value - min) / span) * (height - 8);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastX = (points.length - 1) * stepX;
  const lastY = height - 4 - ((points[points.length - 1] - min) / span) * (height - 8);

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.6" fill={color} />
    </svg>
  );
};
