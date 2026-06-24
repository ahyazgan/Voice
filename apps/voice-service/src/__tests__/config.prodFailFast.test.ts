import { describe, it, expect } from 'vitest';
import { requireProductionSecrets } from '../config.js';

describe('requireProductionSecrets (prod fail-fast)', () => {
  it('production + eksik sır → fırlatır', () => {
    expect(() =>
      requireProductionSecrets({ NODE_ENV: 'production', INTERNAL_API_SECRET: undefined, INBOUND_WS_TOKEN: undefined }),
    ).toThrow(/INTERNAL_API_SECRET/);
  });

  it('production + tek eksik sır → o sırrı bildirir', () => {
    expect(() =>
      requireProductionSecrets({ NODE_ENV: 'production', INTERNAL_API_SECRET: 's', INBOUND_WS_TOKEN: undefined }),
    ).toThrow(/INBOUND_WS_TOKEN/);
  });

  it('production + tüm sırlar dolu → geçer', () => {
    expect(() =>
      requireProductionSecrets({ NODE_ENV: 'production', INTERNAL_API_SECRET: 's', INBOUND_WS_TOKEN: 't' }),
    ).not.toThrow();
  });

  it('development → boş sırlarla bile geçer (yerel dev)', () => {
    expect(() =>
      requireProductionSecrets({ NODE_ENV: 'development', INTERNAL_API_SECRET: undefined, INBOUND_WS_TOKEN: undefined }),
    ).not.toThrow();
  });
});
