import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api.js';
import { formatKurus, formatPercent, formatDuration } from '../lib/format.js';
import { Spinner, ErrorState, OutcomeBadge } from '../components/ui.js';
import type { Stats, Campaign, CallOutcome } from '../types.js';

// Sonuç dağılımını tutarlı bir sırada göster (en "değerliden" en nötrüne).
const OUTCOME_ORDER: CallOutcome[] = [
  'PROMISE_TO_PAY',
  'CALLBACK_REQUESTED',
  'DISPUTE',
  'ESCALATED_TO_HUMAN',
  'REFUSED',
  'WRONG_NUMBER',
  'NO_ANSWER',
];

export function DashboardPage() {
  const [campaignId, setCampaignId] = useState('');

  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch('/campaigns'),
  });

  const { data, isLoading, error } = useQuery<Stats>({
    queryKey: ['stats', campaignId],
    queryFn: () => apiFetch(`/stats${campaignId ? `?campaignId=${campaignId}` : ''}`),
    refetchInterval: 15000,
  });

  const selector = (
    <select className="select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
      <option value="">Tüm kampanyalar</option>
      {campaigns?.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="Veri yok" />;

  const maxOutcome = Math.max(1, ...Object.values(data.outcomes));

  return (
    <div>
      <div className="spread">
        <div>
          <h2 className="page-title">Genel Bakış</h2>
          <p className="page-sub">Ulaşma, ödeme sözü ve maliyet özeti.</p>
        </div>
        {selector}
      </div>

      {/* Sonuç / dönüşüm */}
      <div className="card">
        <strong>Sonuç</strong>
        <div className="kpis" style={{ marginTop: 10 }}>
          <Kpi label="Toplam arama" value={String(data.totals.calls)} />
          <Kpi label="Ulaşılan" value={String(data.totals.reached)} sub={formatPercent(data.rates.reachRate)} />
          <Kpi label="Ödeme sözü" value={String(data.promise.count)} sub={formatPercent(data.rates.promiseRate)} />
          <Kpi label="Sözlenen tutar" value={formatKurus(data.promise.totalAmount)} />
        </div>
      </div>

      {/* Maliyet — sonuç bazlı fiyatlamanın kârlılık göstergesi */}
      <div className="card">
        <strong>Maliyet</strong>
        <div className="kpis" style={{ marginTop: 10 }}>
          <Kpi label="Toplam maliyet" value={formatKurus(data.cost.totalTRY)} />
          <Kpi label="Arama başına" value={formatKurus(data.cost.perCallTRY)} />
          <Kpi label="Söz başına" value={formatKurus(data.cost.perPromiseTRY)} />
        </div>
      </div>

      {/* Kalite */}
      <div className="card">
        <strong>Kalite</strong>
        <div className="kpis" style={{ marginTop: 10 }}>
          <Kpi label="Ort. süre" value={formatDuration(data.quality.avgDurationSec)} />
          <Kpi label="Ort. yanıt" value={data.quality.avgResponseMs != null ? `${data.quality.avgResponseMs} ms` : '—'} />
          <Kpi label="p95 yanıt" value={data.quality.p95ResponseMs != null ? `${data.quality.p95ResponseMs} ms` : '—'} />
        </div>
      </div>

      {/* Sonuç dağılımı */}
      <div className="card">
        <strong>Sonuç dağılımı</strong>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {OUTCOME_ORDER.map((o) => {
            const n = data.outcomes[o] ?? 0;
            return (
              <div key={o} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <div style={{ width: 130, flexShrink: 0 }}>
                  <OutcomeBadge outcome={o} />
                </div>
                <div style={{ flex: 1, background: 'var(--bar-bg, #eef0f3)', borderRadius: 4, height: 10 }}>
                  <div
                    style={{
                      width: `${(n / maxOutcome) * 100}%`,
                      height: '100%',
                      background: 'var(--bar-fill, #4f6bed)',
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div className="num" style={{ width: 40, textAlign: 'right' }}>{n}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="label" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
