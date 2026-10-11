import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MoneyCheck } from './pages/MoneyCheck';
import { Payments } from './pages/Payments';
import { VehicleDetail } from './pages/VehicleDetail';
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
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="money-check" element={<MoneyCheck />} />
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
