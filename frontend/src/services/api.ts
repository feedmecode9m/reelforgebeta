import type { Reel } from '../types/reel';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE.replace(/\/$/, '')}${normalizedPath}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new ApiError(message || `Request failed (${response.status})`, response.status);
  }

  return response.json() as Promise<T>;
}

export async function fetchHealth(): Promise<{ status: string; database?: string }> {
  return request('/health');
}

export async function fetchReels(): Promise<Reel[]> {
  return request<Reel[]>('/api/reels');
}

export async function seedPlaceholderReels(): Promise<Reel[]> {
  return request<Reel[]>('/api/reels/seed', { method: 'POST' });
}
