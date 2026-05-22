import { useQuery } from '@tanstack/react-query';

interface Call {
  id: string;
  status: string;
  debtor: { fullName: string; phoneE164: string; amountDue: number };
  result?: { outcome: string; promisedAmount?: number; promisedDate?: string };
}

export function App() {
  const { data, isLoading, error } = useQuery<Call[]>({
    queryKey: ['calls'],
    queryFn: () => fetch('/api/calls').then((r) => r.json()),
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 960 }}>
      <h1>Tahsilat Paneli</h1>
      <p>Aramalar ve sonuçları.</p>

      {isLoading && <p>Yükleniyor…</p>}
      {error && <p style={{ color: 'crimson' }}>Hata oluştu.</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Borçlu</th>
            <th>Telefon</th>
            <th>Tutar</th>
            <th>Durum</th>
            <th>Sonuç</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((c) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{c.debtor.fullName}</td>
              <td>{c.debtor.phoneE164}</td>
              <td>{(c.debtor.amountDue / 100).toFixed(2)} TL</td>
              <td>{c.status}</td>
              <td>{c.result?.outcome ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
