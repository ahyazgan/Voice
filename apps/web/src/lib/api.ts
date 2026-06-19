// Tek API erişim noktası. Base '/api' (vite proxy → :4000). Auth token'ı
// (Aşama 6) buraya tek noktadan eklenir.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...opts.headers,
    },
  });
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
  // 204 / boş gövde toleransı
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
