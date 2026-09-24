import { z } from "zod";
import { isValidState, isValidZipCode, sanitizeAddressInput } from "./address.js";

export const deliveryAddressSchema = z.object({
  recipientName: z.string().min(2).max(255),
  phone: z.string().min(8).max(20),
  zipCode: z.string().min(8).max(9),
  street: z.string().min(2).max(255),
  number: z.string().min(1).max(20),
  complement: z.string().max(100).optional().nullable(),
  neighborhood: z.string().min(2).max(100),
  city: z.string().min(2).max(100),
  state: z.string().length(2),
});

export const fulfillmentSchema = z
  .object({
    fulfillmentType: z.enum(["delivery", "pickup"]),
    addressId: z.string().uuid().optional(),
    delivery: deliveryAddressSchema.optional(),
    saveAddress: z.boolean().optional(),
    addressLabel: z.string().max(50).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.fulfillmentType !== "delivery") return;

    if (!data.addressId && !data.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Endereço de entrega é obrigatório",
        path: ["delivery"],
      });
      return;
    }

    if (data.delivery) {
      const sanitized = sanitizeAddressInput(data.delivery);
      if (!isValidZipCode(sanitized.zipCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CEP inválido",
          path: ["delivery", "zipCode"],
        });
      }
      if (!isValidState(sanitized.state)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "UF inválida",
          path: ["delivery", "state"],
        });
      }
    }
  });

export type FulfillmentInput = z.infer<typeof fulfillmentSchema>;

export const addressUpsertSchema = deliveryAddressSchema.extend({
  label: z.string().max(50).optional(),
  isDefault: z.boolean().optional(),
});

export const addressPatchSchema = deliveryAddressSchema
  .partial()
  .extend({
    label: z.string().max(50).optional(),
    isDefault: z.boolean().optional(),
  });
