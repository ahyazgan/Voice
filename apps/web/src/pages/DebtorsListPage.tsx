import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { formatKurus, formatDate } from '../lib/format.js';
import { Spinner, ErrorState, EmptyState } from '../components/ui.js';
import { StartCampaignModal } from '../components/StartCampaignModal.js';
import type { Debtor } from '../types.js';

export function DebtorsListPage() {
  const { data, isLoading, error } = useQuery<Debtor[]>({
    queryKey: ['debtors'],
    queryFn: () => apiFetch('/debtors'),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = !!data?.length && data.every((d) => selected.has(d.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set((data ?? []).map((d) => d.id)));

  return (
    <div>
      <div className="spread">
        <div>
          <h2 className="page-title">Borçlular</h2>
          <p className="page-sub">Liste yükle, seç, kampanya başlat.</p>
        </div>
        <Link className="btn ghost" to="/debtors/upload">CSV Yükle</Link>
      </div>

      {selected.size > 0 && (
        <div className="card spread" style={{ marginBottom: 16 }}>
          <span>{selected.size} borçlu seçili</span>
          <button className="btn" onClick={() => setCampaignOpen(true)}>Kampanya Başlat</button>
        </div>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorState message={(error as Error).message} />}
      {data && data.length === 0 && (
        <EmptyState>Henüz borçlu yok. <Link to="/debtors/upload">CSV yükle</Link>.</EmptyState>
      )}

      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
              <th>Ad</th>
              <th>Telefon</th>
              <th>Tutar</th>
              <th>Vade</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} /></td>
                <td>{d.fullName}</td>
                <td className="num">{d.phoneE164}</td>
                <td className="num">{formatKurus(d.amountDue)}</td>
                <td>{formatDate(d.dueDate)}</td>
                <td>{d.doNotCall && <span className="badge danger">Aranmaz</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {campaignOpen && (
        <StartCampaignModal
          debtorIds={[...selected]}
          onClose={() => setCampaignOpen(false)}
          onDone={() => { setCampaignOpen(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
