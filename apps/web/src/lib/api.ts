// Tek API erişim noktası. Base '/api' (vite proxy → :4000). Bearer token
// localStorage'dan eklenir; 401'de token silinip login'e yönlendirilir.

const TOKEN_KEY = 'panel_token';

export const auth = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (t: string): void => localStorage.setItem(TOKEN_KEY, t),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = auth.get();
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });

  if (res.status === 401) {
    // Token geçersiz/süresi dolmuş → temizle, login'e at (login isteği hariç).
    auth.clear();
    if (!path.startsWith('/login') && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'unauthorized');
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ?? detail;
    } catch {
      /* gövde JSON değil */
    }
    throw new ApiError(res.status, detail);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Auth'lu dosya indirme. apiFetch JSON parse ettiği için CSV/binary'de
 * kullanılmaz; bu yardımcı bearer token ekleyip blob'u indirir.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const token = auth.get();
  const res = await fetch(`/api${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    auth.clear();
    window.location.href = '/login';
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);

  // Dosya adını Content-Disposition'dan al, yoksa fallback.
  const cd = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
