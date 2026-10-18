import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MoneyCheck } from './pages/MoneyCheck';
import { ParcelDetail, ParcelNew, Parcels } from './pages/Parcels';
import { Payments } from './pages/Payments';
import { Platform, Staff } from './pages/Accounts';
import { Audit } from './pages/Audit';
import { VehicleForm } from './pages/VehicleForm';
import { PayoutDetail } from './pages/PayoutDetail';
import { Payouts } from './pages/Payouts';
import { Crew, Passengers } from './pages/People';
import { Reports } from './pages/Reports';
import { Import } from './pages/Import';
import { Stickers } from './pages/Stickers';
import { OwnerPage, Owners } from './pages/Owners';
import { Broadcast } from './pages/Broadcast';
import { RouteEdit } from './pages/RouteEdit';
import { Routes as RoutesPage } from './pages/Routes';
import { Statement } from './pages/Statement';
import { TripPage, Trips } from './pages/Trips';
import { VehicleDetail } from './pages/VehicleDetail';
import { Withdrawals } from './pages/Withdrawals';
import { Vehicles } from './pages/Vehicles';
import './styles.css';

function App() {
  const { user, checking } = useAuth();
  if (checking) return <p className="muted center-page">Loading…</p>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="payments" element={<Payments />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="vehicles/new" element={<VehicleForm />} />
        <Route path="vehicles/stickers" element={<Stickers />} />
        <Route path="import" element={<Import />} />
        <Route path="owners" element={<Owners />} />
        <Route path="message" element={<Broadcast />} />
        <Route path="owners/:id" element={<OwnerPage />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="vehicles/:id/edit" element={<VehicleForm />} />
        <Route path="staff" element={<Staff />} />
        {user.role === 'platform_admin' && <Route path="platform" element={<Platform />} />}
        <Route path="money-check" element={<MoneyCheck />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="payouts/:id" element={<PayoutDetail />} />
        <Route path="withdrawals" element={<Withdrawals />} />
        <Route path="trips" element={<Trips />} />
        <Route path="trips/:id" element={<TripPage />} />
        <Route path="parcels" element={<Parcels />} />
        <Route path="parcels/new" element={<ParcelNew />} />
        <Route path="parcels/:id" element={<ParcelDetail />} />
        <Route path="statement" element={<Statement />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="routes/:id" element={<RouteEdit />} />
        <Route path="crew" element={<Crew />} />
        <Route path="passengers" element={<Passengers />} />
        <Route path="reports" element={<Reports />} />
        <Route path="audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/office">
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
