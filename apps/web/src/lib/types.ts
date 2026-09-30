// Mirrors the DTOs the API actually returns (apps/api/src/modules/*/repository.ts
// toXDTO functions), not the full plan §12.2 contract verbatim.
export interface User {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
}

export interface DriverVehicle {
  id: string;
  name: string;
  capacity: number;
  isOnline: boolean;
  currentZone: string | null;
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  vehicle: DriverVehicle;
}

export type RideStatus =
  "REQUESTED" | "MATCHED" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";

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
  pool: PoolSummaryForRide | null;
}

// The pool a passenger's own ride belongs to, once matched (plan §15.2's
// pool card: "Bullet · Jashim · 2/3 seats · shared with 1 rider").
export interface PoolSummaryForRide {
  poolId: string;
  vehicleName: string;
  driverFirstName: string;
  status: PoolStatus;
  capacitySnapshot: number;
  seatsReserved: number;
  sharedWithCount: number;
}

// A compatible OPEN pool a passenger's unmatched request could join
// directly (plan §12.2's `GET /ride-requests/:id/pool-offers`).
export interface PoolOffer {
  poolId: string;
  vehicleName: string;
  driverFirstName: string;
  seatsLeft: number;
  sharedWithCount: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
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

export interface WalletSummary {
  balancePaisa: number;
}

export interface WalletTransaction {
  id: string;
  type: "TOPUP" | "DEBIT";
  amountPaisa: number;
  rideRequestId: string | null;
  createdAt: string;
}

export interface FareQuote {
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
}

export const ACTIVE_RIDE_STATUSES: readonly RideStatus[] = [
  "REQUESTED",
  "MATCHED",
  "DRIVER_ARRIVED",
  "STARTED",
];
export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = ["COMPLETED", "CANCELLED"];

export interface DriverStatus {
  vehicleId: string;
  name: string;
  capacity: number;
  isOnline: boolean;
  currentZone: string | null;
  activePoolId: string | null;
}

export interface RelevantRequest {
  id: string;
  pickupZone: string;
  dropoffZone: string;
  seats: number;
  distanceDkm: number;
  soloFarePaisa: number;
  pooledFarePaisa: number;
  createdAt: string;
}

export type PoolStatus = "OPEN" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";
export const TERMINAL_POOL_STATUSES: readonly PoolStatus[] = ["COMPLETED", "CANCELLED"];

export interface Pool {
  id: string;
  vehicleId: string;
  driverId: string;
  pickupZone: string;
  status: PoolStatus;
  capacitySnapshot: number;
  seatsReserved: number;
  createdAt: string;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface PoolWithEarnings extends Pool {
  earningsPaisa: number;
}

export interface PoolMember {
  membershipId: string;
  rideRequestId: string;
  passengerName: string;
  seats: number;
  dropoffZone: string;
  finalFarePaisa: number | null;
  sharedRide: boolean | null;
  joinedAt: string;
  releasedAt: string | null;
  droppedOffAt: string | null;
}

export interface PoolDetail {
  pool: Pool;
  members: PoolMember[];
}

export interface AcceptResult {
  pool: Pool;
  membershipId: string;
}

export interface PoolStatusHistoryEntry {
  id: number;
  fromStatus: PoolStatus | null;
  toStatus: PoolStatus;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

// Admin panel (ADR-019) — read-mostly oversight plus account suspension.
export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  role: "PASSENGER" | "DRIVER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface AccountStatusHistoryEntry {
  id: number;
  fromStatus: "ACTIVE" | "SUSPENDED";
  toStatus: "ACTIVE" | "SUSPENDED";
  actorUserId: string;
  reason: string | null;
  createdAt: string;
}

export interface AccountDetail extends AccountSummary {
  statusHistory: AccountStatusHistoryEntry[];
  passenger: {
    recentRides: RideRequest[];
    wallet: { balancePaisa: number; transactions: WalletTransaction[] };
  } | null;
  driver: {
    vehicle: DriverVehicle | null;
    recentPools: PoolWithEarnings[];
  } | null;
}

// Unlike the passenger's own RideRequest, this carries the rider's identity
// (ADR-019 draws the "co-riders see a count, admins see a name" line here)
// and never carries `pool` on the list — only the detail view does.
export interface AdminRideRequest {
  id: string;
  passengerId: string;
  passengerName: string;
  passengerEmail: string;
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

export interface AdminRidePool extends PoolSummaryForRide {
  members: PoolMember[];
}

export interface AdminRideDetail extends AdminRideRequest {
  pool: AdminRidePool | null;
  history: RideStatusHistoryEntry[];
}

export interface AdminZoneStats {
  zoneCode: string;
  zoneName: string;
  onlineDrivers: number;
  openRequests: number;
  activePools: number;
}

export interface AdminStats {
  totals: {
    totalRides: number;
    activeRides: number;
    completedRides: number;
    cancelledRides: number;
    onlineDrivers: number;
    activePools: number;
  };
  byZone: AdminZoneStats[];
}
