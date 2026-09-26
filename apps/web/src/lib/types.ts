// Mirrors the DTOs the API actually returns (apps/api/src/modules/*/repository.ts
// toXDTO functions) — not the full plan §12.2 contract, since the backend
// doesn't expose pool/vehicle/driver fields on a passenger's ride yet
// (feature/ride-requests' documented deviation; still true as of this
// session — see this branch's session report).
export interface User {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER";
  status: "ACTIVE" | "SUSPENDED";
}

export type RideStatus = "REQUESTED" | "MATCHED" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";

export interface RideRequest {
  id: string;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
  paymentMethod: "CASH" | "TESLAPAY";
  status: RideStatus;
  cancelReason: string | null;
  createdAt: string;
  matchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface RideStatusHistoryEntry {
  id: number;
  fromStatus: RideStatus | null;
  toStatus: RideStatus;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface Zone {
  code: string;
  name: string;
  xDkm: number;
  yDkm: number;
}

export interface FareQuote {
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
}

export const ACTIVE_RIDE_STATUSES: readonly RideStatus[] = ["REQUESTED", "MATCHED", "DRIVER_ARRIVED", "STARTED"];
export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = ["COMPLETED", "CANCELLED"];
