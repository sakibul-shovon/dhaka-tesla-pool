import { z } from "zod";
import { zoneCodeSchema } from "../fares/schemas.js";

export const goOnlineSchema = z.object({ zone: zoneCodeSchema }).strict();
export type GoOnlineInput = z.infer<typeof goOnlineSchema>;
