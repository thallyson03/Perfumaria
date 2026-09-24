import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@revendedor/database";
import { authenticateUser } from "../lib/auth-guards.js";
import { mapProductPricing } from "../lib/product-price.js";
import {
  allocateKitComponents,
  computeKitAvailability,
  getKitAvailableStock,
} from "../services/kit.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const UPLOAD_ROOT = path.resolve(
  process.env.UPLOAD_DIR ?? path.join(rootDir, "uploads")
);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const kitItemSchema = z.object({
  componentProductId: z.string().uuid(),
  quantity: z.number().int().positive().max(50),
});

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(100).optional(),
  barcode: z.string().max(64).optional(),
  imageUrl: z.string().max(500).optional(),
  kind: z.enum(["simple", "kit"]).optional().default("simple"),
  price: z.number().positive("Preço de venda deve ser maior que zero"),
  cost: z
    .number({
      required_error: "Informe o custo de compra do produto",
      invalid_type_error: "Custo inválido",
    })
    .min(0.01, "Custo de compra deve ser maior que zero"),
  salePrice: z.number().positive().optional().nullable(),
  salePriceUntil: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional().default(true),
  kitItems: z.array(kitItemSchema).max(30).optional(),
});

function validatePromotion(
  data: { price: number; cost: number; salePrice?: number | null; salePriceUntil?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.salePrice == null) return;
  if (data.salePrice >= data.price) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Preço promocional deve ser menor que o preço normal",
      path: ["salePrice"],
    });
  }
  if (data.salePrice <= data.cost) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Preço promocional deve ser maior que o custo",
      path: ["salePrice"],
    });
  }
}

const createProductSchemaWithPromo = createProductSchema.superRefine(validatePromotion);

const createBatchSchema = z.object({
  batchNumber: z.string().max(100).optional(),
  expirationDate: z.string().date(),
  quantity: z.number().int().min(0),
});

function publicImageUrl(relativePath: string): string {
  return `/uploads/${relativePath.replace(/\\/g, "/")}`;
}

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.get("/public", async (req, reply) => {
    if (!req.tenantId) {
      const hasHeader = Boolean(
        req.headers["x-tenant-domain"] ?? req.headers["x-tenant-subdomain"]
      );
      return reply.status(400).send({
        error: hasHeader
          ? "Loja não encontrada para este domínio"
          : "Informe X-Tenant-Domain (ex: loja.localhost)",
      });
    }

    return withTenant(prisma, req.tenantId, async (tx) => {
      const products = await tx.product.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: {
          batches: {
            select: {
              id: true,
              quantity: true,
              reservedQuantity: true,
              expirationDate: true,
            },
          },
          kitItems: {
            include: {
              component: {
                select: {
                  id: true,
                  name: true,
                  batches: {
                    select: { quantity: true, reservedQuantity: true },
                  },
                },
              },
            },
          },
        },
      });

      return products
        .map((p) => {
          const pricing = mapProductPricing(p);

          if (p.kind === "kit") {
            const availableStock = computeKitAvailability(
              p.kitItems.map((item) => ({
                quantity: item.quantity,
                available: item.component.batches.reduce(
                  (s, b) => s + (b.quantity - b.reservedQuantity),
                  0
                ),
              }))
            );
            return {
              id: p.id,
              name: p.name,
              sku: p.sku,
              barcode: p.barcode,
              imageUrl: p.imageUrl,
              kind: p.kind,
              price: pricing.effectivePrice,
              listPrice: pricing.listPrice,
              originalPrice: pricing.originalPrice,
              onSale: pricing.onSale,
              salePriceUntil: p.salePriceUntil,
              availableStock,
              batches: [] as Array<{
                id: string;
                available: number;
                expirationDate: Date;
              }>,
              kitItems: p.kitItems.map((i) => ({
                componentProductId: i.componentProductId,
                componentName: i.component.name,
                quantity: i.quantity,
              })),
              nearestExpiration: null as Date | null,
            };
          }

          const batches = p.batches
            .map((b) => ({
              id: b.id,
              available: b.quantity - b.reservedQuantity,
              expirationDate: b.expirationDate,
            }))
            .filter((b) => b.available > 0)
            .sort(
              (a, b) =>
                new Date(a.expirationDate).getTime() -
                new Date(b.expirationDate).getTime()
            );

          const availableStock = batches.reduce((sum, b) => sum + b.available, 0);
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            imageUrl: p.imageUrl,
            kind: p.kind,
            price: pricing.effectivePrice,
            listPrice: pricing.listPrice,
            originalPrice: pricing.originalPrice,
            onSale: pricing.onSale,
            salePriceUntil: p.salePriceUntil,
            availableStock,
            batches,
            kitItems: [],
            nearestExpiration: batches[0]?.expirationDate ?? null,
          };
        })
        .filter((p) => p.availableStock > 0);
    });
  });

  app.register(async (privateApp) => {
    privateApp.addHook("preHandler", authenticateUser);

    privateApp.get("/", async (req) => {
      const tenantId = req.tenantId!;
      return withTenant(prisma, tenantId, async (tx) => {
        const products = await tx.product.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            batches: true,
            kitItems: {
              include: {
                component: {
                  select: {
                    id: true,
                    name: true,
                    batches: {
                      select: { quantity: true, reservedQuantity: true },
                    },
                  },
                },
              },
            },
          },
        });
        return products.map((p) => {
          const pricing = mapProductPricing(p);
          const availableStock =
            p.kind === "kit"
              ? computeKitAvailability(
                  p.kitItems.map((item) => ({
                    quantity: item.quantity,
                    available: item.component.batches.reduce(
                      (s, b) => s + (b.quantity - b.reservedQuantity),
                      0
                    ),
                  }))
                )
              : p.batches.reduce(
                  (s, b) => s + (b.quantity - b.reservedQuantity),
                  0
                );
          return {
            ...pricing,
            availableStock,
            kitItems: p.kitItems.map((i) => ({
              id: i.id,
              componentProductId: i.componentProductId,
              componentName: i.component.name,
              quantity: i.quantity,
            })),
          };
        });
      });
    });

    privateApp.get("/by-barcode/:code", async (req, reply) => {
      const { code } = req.params as { code: string };
      const tenantId = req.tenantId!;
      const product = await withTenant(prisma, tenantId, (tx) =>
        tx.product.findFirst({
          where: { barcode: code },
          include: { batches: true },
        })
      );
      if (!product) {
        return reply.status(404).send({ error: "Produto não encontrado para este código" });
      }
      return {
        ...mapProductPricing(product),
        batches: product.batches,
      };
    });

    privateApp.post("/upload-image", async (req, reply) => {
      const tenantId = req.tenantId!;
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ error: "Arquivo de imagem obrigatório" });
      }
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return reply.status(400).send({
          error: "Formato inválido. Use JPEG, PNG, WebP ou GIF",
        });
      }

      const ext =
        file.mimetype === "image/png"
          ? "png"
          : file.mimetype === "image/webp"
            ? "webp"
            : file.mimetype === "image/gif"
              ? "gif"
              : "jpg";

      const dir = path.join(UPLOAD_ROOT, tenantId, "products");
      await mkdir(dir, { recursive: true });
      const filename = `${randomUUID()}.${ext}`;
      const absolute = path.join(dir, filename);

      let size = 0;
      file.file.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          file.file.destroy(new Error("Arquivo excede 5MB"));
        }
      });

      try {
        await pipeline(file.file, createWriteStream(absolute));
      } catch {
        return reply.status(400).send({ error: "Falha no upload (máx. 5MB)" });
      }

      const relative = path.join(tenantId, "products", filename);
      const imageUrl = publicImageUrl(relative);
      return { imageUrl };
    });

    privateApp.post("/", async (req, reply) => {
      const parsed = createProductSchemaWithPromo.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const tenantId = req.tenantId!;
      const kind = parsed.data.kind ?? "simple";
      const kitItems = parsed.data.kitItems ?? [];

      if (kind === "kit") {
        if (kitItems.length < 1) {
          return reply
            .status(400)
            .send({ error: "Informe ao menos 1 componente no kit" });
        }
        const ids = kitItems.map((i) => i.componentProductId);
        if (new Set(ids).size !== ids.length) {
          return reply
            .status(400)
            .send({ error: "Componente duplicado no kit" });
        }
      }

      try {
        const product = await withTenant(prisma, tenantId, async (tx) => {
          if (kind === "kit") {
            const components = await tx.product.findMany({
              where: { id: { in: kitItems.map((i) => i.componentProductId) } },
            });
            if (components.length !== kitItems.length) {
              throw Object.assign(new Error("Componente inválido"), {
                statusCode: 400,
              });
            }
            if (components.some((c) => c.kind === "kit")) {
              throw Object.assign(
                new Error("Não é permitido kit dentro de kit"),
                { statusCode: 400 }
              );
            }
          }

          const created = await tx.product.create({
            data: {
              tenantId,
              name: parsed.data.name,
              sku: parsed.data.sku || null,
              barcode: parsed.data.barcode || null,
              imageUrl: parsed.data.imageUrl || null,
              kind,
              price: parsed.data.price,
              cost: parsed.data.cost,
              salePrice: parsed.data.salePrice ?? null,
              salePriceUntil: parsed.data.salePriceUntil
                ? new Date(parsed.data.salePriceUntil)
                : null,
              isActive: parsed.data.isActive,
              ...(kind === "kit"
                ? {
                    kitItems: {
                      create: kitItems.map((item) => ({
                        tenantId,
                        componentProductId: item.componentProductId,
                        quantity: item.quantity,
                      })),
                    },
                  }
                : {}),
            },
            include: {
              kitItems: {
                include: { component: { select: { id: true, name: true } } },
              },
            },
          });
          return created;
        });
        return reply.status(201).send({
          ...mapProductPricing(product),
          kitItems: product.kitItems?.map((i) => ({
            id: i.id,
            componentProductId: i.componentProductId,
            componentName: i.component.name,
            quantity: i.quantity,
          })),
        });
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 409;
        const message =
          err instanceof Error ? err.message : "SKU ou código já cadastrado";
        return reply.status(status === 400 ? 400 : 409).send({ error: message });
      }
    });

    privateApp.put("/:productId/kit-items", async (req, reply) => {
      const { productId } = req.params as { productId: string };
      const schema = z.object({
        items: z.array(kitItemSchema).min(1).max(30),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const tenantId = req.tenantId!;
      const ids = parsed.data.items.map((i) => i.componentProductId);
      if (new Set(ids).size !== ids.length) {
        return reply.status(400).send({ error: "Componente duplicado" });
      }
      if (ids.includes(productId)) {
        return reply
          .status(400)
          .send({ error: "Kit não pode conter a si mesmo" });
      }

      try {
        const result = await withTenant(prisma, tenantId, async (tx) => {
          const kit = await tx.product.findFirst({ where: { id: productId } });
          if (!kit) return null;
          if (kit.kind !== "kit") {
            throw Object.assign(new Error("Produto não é um kit"), {
              statusCode: 400,
            });
          }
          const components = await tx.product.findMany({
            where: { id: { in: ids } },
          });
          if (components.length !== ids.length) {
            throw Object.assign(new Error("Componente inválido"), {
              statusCode: 400,
            });
          }
          if (components.some((c) => c.kind === "kit")) {
            throw Object.assign(new Error("Não é permitido kit dentro de kit"), {
              statusCode: 400,
            });
          }

          await tx.kitItem.deleteMany({ where: { kitProductId: productId } });
          await tx.kitItem.createMany({
            data: parsed.data.items.map((item) => ({
              tenantId,
              kitProductId: productId,
              componentProductId: item.componentProductId,
              quantity: item.quantity,
            })),
          });

          const availableStock = await getKitAvailableStock(tx, productId);
          const items = await tx.kitItem.findMany({
            where: { kitProductId: productId },
            include: { component: { select: { id: true, name: true } } },
          });
          return {
            availableStock,
            kitItems: items.map((i) => ({
              id: i.id,
              componentProductId: i.componentProductId,
              componentName: i.component.name,
              quantity: i.quantity,
            })),
          };
        });
        if (!result) {
          return reply.status(404).send({ error: "Kit não encontrado" });
        }
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Falha ao salvar composição";
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 400;
        return reply.status(status).send({ error: message });
      }
    });

    privateApp.patch("/:productId", async (req, reply) => {
      const { productId } = req.params as { productId: string };
      const schema = createProductSchema.partial();
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const tenantId = req.tenantId!;
      try {
        const updated = await withTenant(prisma, tenantId, async (tx) => {
        const existing = await tx.product.findFirst({ where: { id: productId } });
        if (!existing) return null;

        const next = {
          price:
            parsed.data.price !== undefined
              ? parsed.data.price
              : Number(existing.price),
          cost:
            parsed.data.cost !== undefined
              ? parsed.data.cost
              : Number(existing.cost),
          salePrice:
            parsed.data.salePrice !== undefined
              ? parsed.data.salePrice
              : existing.salePrice != null
                ? Number(existing.salePrice)
                : null,
          salePriceUntil:
            parsed.data.salePriceUntil !== undefined
              ? parsed.data.salePriceUntil
              : existing.salePriceUntil?.toISOString() ?? null,
        };

        const promoCheck = createProductSchema
          .partial()
          .extend({
            price: z.number().positive(),
            cost: z.number().min(0.01),
          })
          .superRefine(validatePromotion)
          .safeParse(next);

        if (!promoCheck.success) {
          throw Object.assign(new Error("Dados de promoção inválidos"), {
            statusCode: 400,
            details: promoCheck.error.flatten(),
          });
        }

        return tx.product.update({
          where: { id: productId },
          data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku || null } : {}),
            ...(parsed.data.barcode !== undefined
              ? { barcode: parsed.data.barcode || null }
              : {}),
            ...(parsed.data.imageUrl !== undefined
              ? { imageUrl: parsed.data.imageUrl || null }
              : {}),
            ...(parsed.data.price !== undefined ? { price: parsed.data.price } : {}),
            ...(parsed.data.cost !== undefined ? { cost: parsed.data.cost } : {}),
            ...(parsed.data.salePrice !== undefined
              ? { salePrice: parsed.data.salePrice }
              : {}),
            ...(parsed.data.salePriceUntil !== undefined
              ? {
                  salePriceUntil: parsed.data.salePriceUntil
                    ? new Date(parsed.data.salePriceUntil)
                    : null,
                }
              : {}),
            ...(parsed.data.isActive !== undefined
              ? { isActive: parsed.data.isActive }
              : {}),
          },
        });
      });
      if (!updated) return reply.status(404).send({ error: "Produto não encontrado" });
      return mapProductPricing(updated);
      } catch (err) {
        const e = err as Error & { statusCode?: number; details?: unknown };
        if (e.statusCode === 400) {
          return reply.status(400).send({ error: e.details ?? e.message });
        }
        throw err;
      }
    });

    privateApp.post("/:productId/allocate-kit", async (req, reply) => {
      const { productId } = req.params as { productId: string };
      const schema = z.object({
        quantity: z.number().int().positive().max(50),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const tenantId = req.tenantId!;
      try {
        const result = await withTenant(prisma, tenantId, (tx) =>
          allocateKitComponents(tx, productId, parsed.data.quantity)
        );
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Falha ao montar kit";
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 400;
        return reply.status(status).send({ error: message });
      }
    });

    privateApp.get("/:productId/batches", async (req, reply) => {
      const { productId } = req.params as { productId: string };
      const tenantId = req.tenantId!;
      const batches = await withTenant(prisma, tenantId, (tx) =>
        tx.productBatch.findMany({
          where: { productId },
          orderBy: { expirationDate: "asc" },
        })
      );
      return reply.send(batches);
    });

    privateApp.post("/:productId/batches", async (req, reply) => {
      const { productId } = req.params as { productId: string };
      const parsed = createBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const tenantId = req.tenantId!;

      try {
        const batch = await withTenant(prisma, tenantId, async (tx) => {
          const product = await tx.product.findFirst({ where: { id: productId } });
          if (!product) return null;
          if (product.kind === "kit") {
            throw Object.assign(
              new Error(
                "Kits não possuem lote próprio — estoque vem dos componentes"
              ),
              { statusCode: 400 }
            );
          }
          return tx.productBatch.create({
            data: {
              tenantId,
              productId,
              batchNumber: parsed.data.batchNumber,
              expirationDate: new Date(parsed.data.expirationDate),
              quantity: parsed.data.quantity,
            },
          });
        });

        if (!batch) return reply.status(404).send({ error: "Produto não encontrado" });
        return reply.status(201).send(batch);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Falha ao criar lote";
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 500;
        return reply.status(status).send({ error: message });
      }
    });
  });
};
