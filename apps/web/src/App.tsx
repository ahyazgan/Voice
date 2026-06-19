import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { DebtorsListPage } from './pages/DebtorsListPage.js';
import { DebtorsUploadPage } from './pages/DebtorsUploadPage.js';
import { CampaignsListPage } from './pages/CampaignsListPage.js';
import { CallsListPage } from './pages/CallsListPage.js';
import { CallDetailPage } from './pages/CallDetailPage.js';

export function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Tahsilat Paneli</h1>
        <nav>
          <NavLink to="/debtors">Borçlular</NavLink>
          <NavLink to="/campaigns">Kampanyalar</NavLink>
          <NavLink to="/calls">Aramalar</NavLink>
        </nav>
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
  );
}
