import { useQuery } from "@tanstack/react-query";
import { api } from "./api-client.js";
import type { Zone } from "./types.js";

// Zone list is fixed reference data (plan §7.1's 10-zone grid) — fetched
// once and cached indefinitely, shared by every screen that needs it
// instead of each page re-declaring the same query.
export function useZones() {
  return useQuery({
    queryKey: ["zones"],
    queryFn: ({ signal }) => api.get<Zone[]>("/zones", signal),
    staleTime: Infinity,
  });
}
