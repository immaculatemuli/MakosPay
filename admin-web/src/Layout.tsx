import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { OfficeSearch } from './attention';
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
      { to: '/refund-requests', label: 'Refunds asked by crew' },
      { to: '/money-check', label: 'Money check' },
      { to: '/downloads', label: 'Reports & downloads' },
      { to: '/statement', label: 'M-Pesa statement' },
    ],
  },
  {
    title: 'Bookings & parcels',
    links: [
      { to: '/trips', label: 'Bookings & trips' },
      { to: '/parcels', label: 'Parcels' },
    ],
  },
  {
    title: 'Setup',
    links: [
      { to: '/routes', label: 'Routes & fares' },
      { to: '/vehicles', label: 'Vehicles & QR' },
      { to: '/tracker', label: 'Vehicle tracker' },
      { to: '/owners', label: 'Vehicle owners' },
      { to: '/crew', label: 'Crew' },
      { to: '/message', label: 'Message crew' },
      { to: '/passengers', label: 'Passengers' },
      { to: '/import', label: 'Import from Excel' },
    ],
  },
  {
    title: 'Records',
    links: [
      { to: '/reports', label: 'Problem reports' },
      { to: '/audit', label: 'Audit log' },
    ],
  },
  {
    title: 'Accounts',
    links: [{ to: '/staff', label: 'Office staff' }],
  },
];

export function Layout() {
  const { user, saccoName, signOut } = useAuth();
  // The Platform page is only for platform admins (the API refuses everyone else anyway).
  const groups = user?.role === 'platform_admin' ? GROUPS.map((g) => (g.title === 'Accounts' ? { ...g, links: [...g.links, { to: '/platform', label: 'Platform' }] } : g)) : GROUPS;
  // On a phone the menu is folded away behind a Menu button, and folds again after choosing a page.
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);
  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? ' menu-open' : ''}`}>
        <div className="brand">
          FarePay
          <small>{saccoName ? `${saccoName} office` : 'SACCO office'}</small>
        </div>
        <button type="button" className="secondary menu-button" aria-expanded={menuOpen} aria-controls="main-menu" onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? '✕ Close' : '☰ Menu'}
        </button>
        <OfficeSearch />
        <nav className="nav" id="main-menu" aria-label="Main">
          {groups.map((g) => (
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
