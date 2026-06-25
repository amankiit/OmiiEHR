import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Button, Card, CardBody, Field } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const HIGHLIGHTS = [
  "FHIR R4 longitudinal patient charts",
  "Clinical decision support & risk stratification",
  "HIPAA-aligned audit trail on every access"
];

const LoginPage = () => {
  const { isAuthenticated, login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(form);
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-hero">
        <div className="login-hero-mark">
          <span className="sidebar-brand-mark">O</span>
          OmiiEHR
        </div>
        <div>
          <h2>The clinical workspace for modern care teams.</h2>
          <ul>
            {HIGHLIGHTS.map((item) => (
              <li key={item}>
                <Icon name="check" size={18} />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p style={{ opacity: 0.75, fontSize: "0.82rem" }}>FHIR R4 · HIPAA Security Rule controls</p>
      </div>

      <div className="login-panel">
        <Card className="login-card">
          <CardBody>
            <h1>Sign in</h1>
            <p className="muted-text" style={{ marginTop: "0.3rem", marginBottom: "1.2rem" }}>
              Use your clinician or administrator credentials.
            </p>

            {error ? (
              <p className="banner banner-error" style={{ marginBottom: "1rem" }}>
                <Icon name="alert" size={16} />
                {error}
              </p>
            ) : null}

            <form onSubmit={onSubmit} className="stack">
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  required
                />
              </Field>
              <Button type="submit" loading={loading} block>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="muted-text" style={{ marginTop: "1.2rem", textAlign: "center" }}>
              New patient?{" "}
              <Link to="/patient-register" className="inline-link">
                Register through the patient portal
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
