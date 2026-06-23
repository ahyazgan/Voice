import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { Spinner, ErrorState, EmptyState, CampaignBadge } from '../components/ui.js';
import type { Campaign } from '../types.js';

export function CampaignsListPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch('/campaigns'),
  });

  const action = useMutation({
    mutationFn: ({ id, op }: { id: string; op: 'pause' | 'resume' | 'cancel' }) =>
      apiFetch(`/campaigns/${id}/${op}`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['calls'] });
    },
  });

  return (
    <div>
      <h2 className="page-title">Kampanyalar</h2>
      <p className="page-sub">Çalışan kampanyaları duraklat, devam ettir veya iptal et.</p>

      {isLoading && <Spinner />}
      {error && <ErrorState message={(error as Error).message} />}
      {data && data.length === 0 && (
        <EmptyState>Henüz kampanya yok. <Link to="/debtors">Borçlu seçip başlat</Link>.</EmptyState>
      )}

      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Ad</th><th>Durum</th><th>Arama</th><th>Ulaşılan</th><th>Ödeme sözü</th>
              <th>Oluşturma</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><CampaignBadge status={c.status} /></td>
                <td className="num">{c._count?.calls ?? 0}</td>
                <td className="num">{c.metrics?.reached ?? 0}</td>
                <td className="num">{c.metrics?.promises ?? 0}</td>
                <td>{formatDateTime(c.createdAt)}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {c.status === 'ACTIVE' && (
                      <button className="btn ghost sm" disabled={action.isPending}
                        onClick={() => action.mutate({ id: c.id, op: 'pause' })}>Duraklat</button>
                    )}
                    {c.status === 'PAUSED' && (
                      <button className="btn sm" disabled={action.isPending}
                        onClick={() => action.mutate({ id: c.id, op: 'resume' })}>Devam</button>
                    )}
                    {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
                      <button className="btn danger sm" disabled={action.isPending}
                        onClick={() => action.mutate({ id: c.id, op: 'cancel' })}>İptal</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
