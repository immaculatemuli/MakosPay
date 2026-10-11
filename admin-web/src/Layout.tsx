import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/payments', label: 'Payments' },
  { to: '/vehicles', label: 'Vehicles & QR' },
  { to: '/money-check', label: 'Money check' },
];

export function Layout() {
  const { user, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          FarePay
          <small>SACCO office</small>
        </div>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <div>{user?.name}</div>
          <button className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
