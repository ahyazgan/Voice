import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import type { Campaign } from '../types.js';

interface Props {
  debtorIds: string[];
  onClose: () => void;
  onDone: () => void;
}

export function StartCampaignModal({ debtorIds, onClose, onDone }: Props) {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Campaign>('/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), debtorIds }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['calls'] });
      onDone();
      navigate('/calls');
    },
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Kampanya Başlat</h3>
        <p className="page-sub">{debtorIds.length} borçlu aranacak.</p>
        <div className="field">
          <label>Kampanya adı</label>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder="Örn. Haziran geç ödemeler"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {create.isError && (
          <div className="state error">Hata: {(create.error as Error).message}</div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn ghost" onClick={onClose}>Vazgeç</button>
          <button
            className="btn"
            disabled={!name.trim() || debtorIds.length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Başlatılıyor…' : 'Başlat'}
          </button>
        </div>
      </div>
    </div>
  );
}
