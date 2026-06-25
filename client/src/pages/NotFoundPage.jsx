import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui.jsx";

const NotFoundPage = () => (
  <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
    <div className="card card-pad" style={{ maxWidth: 420, textAlign: "center" }}>
      <EmptyState
        icon="info"
        title="Page not found"
        message="The page you are looking for doesn’t exist or has moved."
        action={
          <Link to="/" className="btn btn-primary btn-sm" style={{ marginTop: "0.5rem" }}>
            Back to dashboard
          </Link>
        }
      />
    </div>
  </div>
);

export default NotFoundPage;
