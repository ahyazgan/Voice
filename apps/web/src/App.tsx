import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import { apiFetch, auth } from './lib/api.js';
import { DebtorsListPage } from './pages/DebtorsListPage.js';
import { DebtorsUploadPage } from './pages/DebtorsUploadPage.js';
import { CampaignsListPage } from './pages/CampaignsListPage.js';
import { CallsListPage } from './pages/CallsListPage.js';
import { CallDetailPage } from './pages/CallDetailPage.js';
import { LoginPage } from './pages/LoginPage.js';

interface MeResponse {
  user: { sub: string; authDisabled?: boolean } | null;
}

export function App() {
  const navigate = useNavigate();
  // /me hem auth açık mı (authDisabled) hem token geçerli mi sorularını cevaplar.
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ['me', auth.get()],
    queryFn: () => apiFetch('/me'),
    retry: false,
  });

  const onLogin = window.location.pathname === '/login';
  if (isLoading && !onLogin) return <div className="state">Yükleniyor…</div>;

  const authDisabled = data?.user?.authDisabled === true;
  const loggedIn = authDisabled || !!data?.user;

  if (!loggedIn && !onLogin) {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/calls" replace />} />
      <Route
        path="*"
        element={
          <div className="app">
            <aside className="sidebar">
              <h1>Tahsilat Paneli</h1>
              <nav>
                <NavLink to="/debtors">Borçlular</NavLink>
                <NavLink to="/campaigns">Kampanyalar</NavLink>
                <NavLink to="/calls">Aramalar</NavLink>
              </nav>
              {!authDisabled && (
                <button
                  className="btn ghost sm"
                  style={{ marginTop: 16, width: '100%' }}
                  onClick={() => { auth.clear(); navigate('/login'); }}
                >
                  Çıkış
                </button>
              )}
            </aside>
            <main className="content">
              <Routes>
                <Route path="/" element={<Navigate to="/calls" replace />} />
                <Route path="/debtors" element={<DebtorsListPage />} />
                <Route path="/debtors/upload" element={<DebtorsUploadPage />} />
                <Route path="/campaigns" element={<CampaignsListPage />} />
                <Route path="/calls" element={<CallsListPage />} />
                <Route path="/calls/:id" element={<CallDetailPage />} />
                <Route path="*" element={<div className="state">Sayfa bulunamadı.</div>} />
              </Routes>
            </main>
          </div>
        }
      />
    </Routes>
  );
}
