import { NavLink } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { initialsOf } from "../utils/display.js";

const NAV_GROUPS = [
  {
    title: "Clinical",
    links: [
      { to: "/", label: "Dashboard", icon: "dashboard", end: true },
      { to: "/patients", label: "Patients", icon: "patients" },
      { to: "/schedule", label: "Schedule", icon: "calendar" },
      { to: "/worklist", label: "Worklist", icon: "tasks", roles: ["admin", "practitioner"] }
    ]
  },
  {
    title: "Administration",
    links: [
      { to: "/users", label: "User access", icon: "users", roles: ["admin"] },
      { to: "/audit", label: "Audit logs", icon: "shield", roles: ["admin", "auditor"] }
    ]
  }
];

const linkClass = ({ isActive }) => (isActive ? "sidebar-link sidebar-link-active" : "sidebar-link");

const NavBar = ({ open, onNavigate }) => {
  const { user, logout } = useAuth();
  const role = user?.role;

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => !link.roles || link.roles.includes(role))
  })).filter((group) => group.links.length > 0);

  return (
    <aside id="sidebar-nav" className={open ? "sidebar sidebar-open" : "sidebar"}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">O</span>
        <div>
          <strong>OmiiEHR</strong>
          <span>Clinical workspace</span>
        </div>
      </div>

      <nav className="sidebar-content">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            <p className="sidebar-group-title">{group.title}</p>
            <div className="sidebar-group-links">
              {group.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={linkClass}
                  onClick={onNavigate}
                >
                  <Icon name={link.icon} size={18} />
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="avatar">{initialsOf(user?.fullName)}</span>
          <div className="grow">
            <p className="sidebar-user-name">
              {user?.fullName}
              <span className="sidebar-user-role">
                {user?.role}
              </span>
            </p>
            <p className="sidebar-user-email">{user?.email}</p>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={logout}>
          <Icon name="logout" size={15} />
          Sign out
        </button>
      </div>
    </aside>
  );
};

export default NavBar;
