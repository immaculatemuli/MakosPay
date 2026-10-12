import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';

const GROUPS = [
  {
    title: null,
    links: [{ to: '/', label: 'Dashboard', end: true }],
  },
  {
    title: 'Money',
    links: [
      { to: '/payments', label: 'Payments & refunds' },
      { to: '/payouts', label: 'Owner payouts' },
      { to: '/withdrawals', label: 'Passenger withdrawals' },
      { to: '/money-check', label: 'Money check' },
      { to: '/statement', label: 'M-Pesa statement' },
    ],
  },
  {
    title: 'Setup',
    links: [
      { to: '/routes', label: 'Routes & fares' },
      { to: '/vehicles', label: 'Vehicles & QR' },
      { to: '/crew', label: 'Crew' },
      { to: '/passengers', label: 'Passengers' },
    ],
  },
  {
    title: 'Records',
    links: [
      { to: '/reports', label: 'Problem reports' },
      { to: '/audit', label: 'Audit log' },
    ],
  },
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
          {GROUPS.map((g) => (
            <div key={g.title ?? 'home'}>
              {g.title && <div className="nav-group">{g.title}</div>}
              {g.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={'end' in l ? l.end : false}>
                  {l.label}
                </NavLink>
              ))}
            </div>
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
