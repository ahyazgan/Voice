import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { formatKurus } from '../lib/format.js';
import { parseDebtorsCsv, type ParseResult } from '../lib/csv.js';

export function DebtorsUploadPage() {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const upload = useMutation({
    mutationFn: (rows: ParseResult['valid']) =>
      apiFetch<{ inserted: number }>('/debtors/bulk', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['debtors'] });
      navigate('/debtors');
    },
  });

  const onFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    setParsed(parseDebtorsCsv(text));
  };

  return (
    <div>
      <h2 className="page-title">Borçlu Yükle (CSV)</h2>
      <p className="page-sub">
        Sütunlar: <code>fullName, phoneE164, amountDue (TL), dueDate (YYYY-MM-DD), invoiceRef</code>
      </p>

      <div className="card">
        <input
          className="input"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        />
        {fileName && <span style={{ marginLeft: 12, color: 'var(--text-dim)' }}>{fileName}</span>}
      </div>

      {parsed && (
        <>
          <div className="card row" style={{ marginTop: 16 }}>
            <span className="badge ok">{parsed.valid.length} geçerli</span>
            {parsed.errors.length > 0 && <span className="badge danger">{parsed.errors.length} hatalı</span>}
            <button
              className="btn"
              disabled={parsed.valid.length === 0 || upload.isPending}
              onClick={() => upload.mutate(parsed.valid)}
              style={{ marginLeft: 'auto' }}
            >
              {upload.isPending ? 'Yükleniyor…' : `${parsed.valid.length} borçluyu yükle`}
            </button>
          </div>

          {upload.isError && (
            <div className="state error">Yükleme hatası: {(upload.error as Error).message}</div>
          )}

          {parsed.errors.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <strong>Hatalı satırlar (atlanacak):</strong>
              <ul>
                {parsed.errors.slice(0, 50).map((e) => (
                  <li key={e.row}>Satır {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {parsed.valid.length > 0 && (
            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr><th>Ad</th><th>Telefon</th><th>Tutar</th><th>Vade</th></tr>
              </thead>
              <tbody>
                {parsed.valid.slice(0, 100).map((d, i) => (
                  <tr key={i}>
                    <td>{d.fullName}</td>
                    <td className="num">{d.phoneE164}</td>
                    <td className="num">{formatKurus(d.amountDue)}</td>
                    <td>{d.dueDate.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
