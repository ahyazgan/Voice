import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { formatKurus, formatDate, formatTime, formatDuration } from '../lib/format.js';
import { Spinner, ErrorState, StatusBadge, OutcomeBadge } from '../components/ui.js';
import type { CallDetail } from '../types.js';

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: call, isLoading, error } = useQuery<CallDetail>({
    queryKey: ['call', id],
    queryFn: () => apiFetch(`/calls/${id}`),
    refetchInterval: (q) =>
      (q.state.data as CallDetail | undefined)?.status === 'RUNNING' ? 3000 : false,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!call) return <ErrorState message="Arama bulunamadı" />;

  const r = call.result;

  return (
    <div>
      <Link to="/calls">← Aramalar</Link>
      <div className="spread" style={{ marginTop: 12 }}>
        <div>
          <h2 className="page-title">{call.debtor.fullName}</h2>
          <p className="page-sub">
            {call.debtor.phoneE164} · borç {formatKurus(call.debtor.amountDue)} · vade {formatDate(call.debtor.dueDate)}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={call.status} />
          <OutcomeBadge outcome={call.outcome} />
        </div>
      </div>

      {/* Sonuç paneli */}
      {r && (
        <div className="card">
          <strong>Sonuç</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <OutcomeBadge outcome={r.outcome} />
            {r.outcome === 'PROMISE_TO_PAY' && (
              <span>
                Söz: <b>{formatKurus(r.promisedAmount)}</b>
                {r.promisedDate && <> · {formatDate(r.promisedDate)}</>}
              </span>
            )}
            {r.outcome === 'DISPUTE' && r.disputeReason && (
              <span>İtiraz gerekçesi: <i>{r.disputeReason}</i></span>
            )}
          </div>
        </div>
      )}

      {/* KPI */}
      {r && (
        <div className="card">
          <strong>Performans</strong>
          <div className="kpis" style={{ marginTop: 10 }}>
            <Kpi label="Süre" value={formatDuration(call.durationSec)} />
            <Kpi label="Ort. yanıt" value={r.avgResponseMs != null ? `${r.avgResponseMs} ms` : '—'} />
            <Kpi label="p95 yanıt" value={r.p95ResponseMs != null ? `${r.p95ResponseMs} ms` : '—'} />
            <Kpi label="Barge-in" value={String(r.bargeIns)} />
          </div>
        </div>
      )}

      {/* Maliyet */}
      {r && (
        <div className="card">
          <strong>Maliyet · {formatKurus(r.costTRY)}</strong>
          <div className="kpis" style={{ marginTop: 10 }}>
            <Kpi label="Telefon (sn)" value={String(r.telephonySec)} />
            <Kpi label="STT (sn)" value={String(r.sttSec)} />
            <Kpi label="LLM token (giriş)" value={String(r.llmTokensIn)} />
            <Kpi label="LLM token (çıkış)" value={String(r.llmTokensOut)} />
            <Kpi label="TTS karakter" value={String(r.ttsChars)} />
          </div>
        </div>
      )}

      {/* Transkript */}
      <div className="card">
        <strong>Transkript</strong>
        {call.transcript.length === 0 ? (
          <p className="page-sub" style={{ marginTop: 8 }}>Henüz transkript yok.</p>
        ) : (
          <div className="thread" style={{ marginTop: 12 }}>
            {call.transcript.map((t) => (
              <div key={t.id} className={`bubble ${t.speaker}`}>
                <div>{t.text}</div>
                <div className="meta">
                  {formatTime(t.at)}
                  {t.latencyMs != null && t.speaker === 'agent' && <> · {t.latencyMs} ms</>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
