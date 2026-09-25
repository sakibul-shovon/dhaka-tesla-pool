import { z } from "zod";

export const cancelPoolSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
export type CancelPoolInput = z.infer<typeof cancelPoolSchema>;
