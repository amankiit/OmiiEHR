import { useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import NavBar from "./NavBar.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import Notifications from "./Notifications.jsx";
import Icon from "./Icon.jsx";

const LABELS = {
  patients: "Patients",
  schedule: "Schedule",
  worklist: "Worklist",
  users: "User access",
  audit: "Audit logs"
};

const isObjectId = (value) => /^[a-fA-F0-9]{24}$/.test(value);

const AppShell = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const breadcrumbs = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const items = [{ to: "/", label: "Dashboard", current: segments.length === 0 }];
    let path = "";
    segments.forEach((segment, index) => {
      path += `/${segment}`;
      items.push({
        to: path,
        label: LABELS[segment] || (isObjectId(segment) ? "Patient chart" : segment),
        current: index === segments.length - 1
      });
    });
    return items;
  }, [location.pathname]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <header className="mobile-bar">
        <Link to="/" className="mobile-brand">
          <span className="sidebar-brand-mark" style={{ width: 30, height: 30, fontSize: "0.95rem" }}>
            O
          </span>
          OmiiEHR
        </Link>
        <div className="row">
          <Notifications />
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen((value) => !value)}>
            <Icon name={menuOpen ? "close" : "menu"} size={20} />
          </button>
        </div>
      </header>

      <NavBar open={menuOpen} onNavigate={closeMenu} />
      {menuOpen ? <button type="button" className="sidebar-backdrop" aria-label="Close menu" onClick={closeMenu} /> : null}

      <div className="workspace-main">
        <header className="topbar">
          <nav className="breadcrumb-nav" aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={item.to} className="row" style={{ gap: "0.35rem" }}>
                {item.current ? (
                  <span className="breadcrumb-current">{item.label}</span>
                ) : (
                  <Link to={item.to} className="breadcrumb-item">
                    {item.label}
                  </Link>
                )}
                {index < breadcrumbs.length - 1 ? <span className="breadcrumb-sep">/</span> : null}
              </span>
            ))}
          </nav>

          <div className="topbar-actions">
            <GlobalSearch />
            <Notifications />
          </div>
        </header>

        <main className="page-shell" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppShell;
