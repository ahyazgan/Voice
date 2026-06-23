import type { MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch, apiDownload } from '../lib/api.js';
import { formatKurus, formatDateTime } from '../lib/format.js';
import { Spinner, ErrorState, EmptyState, StatusBadge, OutcomeBadge } from '../components/ui.js';
import type { CallListItem, CallStatus } from '../types.js';

const STATUS_FILTERS: { value: CallStatus | ''; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'SCHEDULED', label: 'Planlandı' },
  { value: 'QUEUED', label: 'Kuyrukta' },
  { value: 'RUNNING', label: 'Aranıyor' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'FAILED', label: 'Başarısız' },
];

export function CallsListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get('status') ?? '';
  const campaignId = params.get('campaignId') ?? '';

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (campaignId) qs.set('campaignId', campaignId);
  const query = qs.toString();

  const { data, isLoading, error } = useQuery<CallListItem[]>({
    queryKey: ['calls', status, campaignId],
    queryFn: () => apiFetch(`/calls${query ? `?${query}` : ''}`),
    // Aktif (planlı/kuyrukta/aranıyor) arama varsa periyodik yenile; aksi halde dur.
    refetchInterval: (q) => {
      const rows = q.state.data as CallListItem[] | undefined;
      const active = rows?.some((c) => ['SCHEDULED', 'QUEUED', 'RUNNING'].includes(c.status));
      return active ? 4000 : false;
    },
  });

  const setStatus = (s: string) => {
    const next = new URLSearchParams(params);
    s ? next.set('status', s) : next.delete('status');
    setParams(next);
  };

  return (
    <div>
      <h2 className="page-title">Aramalar</h2>
      <p className="page-sub">Sonuçları ve durumları izle.{campaignId && ' (kampanya filtreli)'}</p>

      <div className="spread" style={{ marginBottom: 16 }}>
        <div className="row">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`btn sm ${status === f.value ? '' : 'ghost'}`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          className="btn ghost sm"
          disabled={!data || data.length === 0}
          onClick={() => void apiDownload(`/calls/export.csv${query ? `?${query}` : ''}`, 'aramalar.csv')}
        >
          CSV indir
        </button>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorState message={(error as Error).message} />}
      {data && data.length === 0 && <EmptyState>Bu filtreye uygun arama yok.</EmptyState>}

      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Borçlu</th><th>Telefon</th><th>Tutar</th><th>Durum</th><th>Sonuç</th><th>Tarih</th></tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/calls/${c.id}`)}>
                <td><Link to={`/calls/${c.id}`} onClick={(e: MouseEvent) => e.stopPropagation()}>{c.debtor.fullName}</Link></td>
                <td className="num">{c.debtor.phoneE164}</td>
                <td className="num">{formatKurus(c.debtor.amountDue)}</td>
                <td><StatusBadge status={c.status} /></td>
                <td><OutcomeBadge outcome={c.outcome} /></td>
                <td>{formatDateTime(c.startedAt ?? c.scheduledFor ?? c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
