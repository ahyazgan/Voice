import type { FastifyInstance } from 'fastify';

// İskelet: gerçek auth (JWT, session, OIDC vb.) sonraki adımda eklenir.
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', async () => {
    return { user: null };
  });
}
