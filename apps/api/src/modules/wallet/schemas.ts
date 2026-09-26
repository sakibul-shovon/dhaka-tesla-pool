import { z } from "zod";

// Simulated top-up capped at ৳2,000 per call (plan §8.4).
export const MAX_TOPUP_PAISA = 200_000;

export const topupWalletSchema = z.object({ amountPaisa: z.number().int().min(1).max(MAX_TOPUP_PAISA) }).strict();
export type TopupWalletInput = z.infer<typeof topupWalletSchema>;
