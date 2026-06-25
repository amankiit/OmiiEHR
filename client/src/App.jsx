import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AuditPage from "./pages/AuditPage.jsx";
import WorklistPage from "./pages/WorklistPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import PatientDetailPage from "./pages/PatientDetailPage.jsx";
import PatientPortalPage from "./pages/PatientPortalPage.jsx";
import PatientsPage from "./pages/PatientsPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import UsersPage from "./pages/UsersPage.jsx";

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/patient-register" element={<PatientPortalPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/worklist"
          element={
            <ProtectedRoute roles={["admin", "practitioner"]}>
              <WorklistPage />
            </ProtectedRoute>
          }
        />
        <Route path="/command-center" element={<Navigate to="/worklist" replace />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:id" element={<PatientDetailPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={["admin"]}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute roles={["admin", "auditor"]}>
              <AuditPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
};

export default App;
