import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/index.js';

const CreateDebtorSchema = z.object({
  fullName: z.string().min(1),
  phoneE164: z.string().regex(/^\+\d{8,15}$/),
  amountDue: z.number().int().nonnegative(),
  dueDate: z.string().datetime(),
  invoiceRef: z.string().optional(),
});

export async function debtorsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/debtors', async () => {
    return prisma.debtor.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  });

  app.post('/debtors', async (req, reply) => {
    const body = CreateDebtorSchema.parse(req.body);
    const debtor = await prisma.debtor.create({
      // invoiceRef opsiyonel; Prisma alanı `string | null` → undefined yerine null normalize.
      data: { ...body, invoiceRef: body.invoiceRef ?? null, currency: 'TRY' },
    });
    reply.code(201);
    return debtor;
  });

  // Toplu yükleme: panel CSV'yi client'ta parse/valide edip dizi gönderir,
  // burada tek transaction'da yazılır (tek-tek POST'tan atomik ve hızlı).
  const BulkSchema = z.object({ rows: z.array(CreateDebtorSchema).min(1).max(2000) });
  app.post('/debtors/bulk', async (req, reply) => {
    const { rows } = BulkSchema.parse(req.body);
    const result = await prisma.debtor.createMany({
      data: rows.map((r) => ({ ...r, invoiceRef: r.invoiceRef ?? null, currency: 'TRY' })),
      // phoneE164 @unique: CSV çift yüklemesinde aynı numarayı yeniden ekleme.
      skipDuplicates: true,
    });
    reply.code(201);
    return { inserted: result.count };
  });
}
