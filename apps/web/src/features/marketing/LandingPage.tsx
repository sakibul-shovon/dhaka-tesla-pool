import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight,
  Car,
  Clock3,
  EyeOff,
  Gauge,
  MapPin,
  Navigation,
  Receipt,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { useZones } from "../../lib/zones.js";
import { ZoneDiagram } from "../../components/map/ZoneDiagram.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Button } from "../../components/ui/Button.js";
import { Select } from "../../components/ui/Select.js";
import { SectionHeader } from "../../components/layout/SectionHeader.js";
import rickshawPhoto from "../../assets/rickshaw-tesla.png";

const QUICK_TRIP_KEY = "dtp-quick-trip";

const HOW_IT_WORKS = [
  {
    Icon: MapPin,
    title: "Request your ride",
    body: "Pick a pickup and drop-off from Banani, Gulshan, Mohakhali and the rest of Dhaka's zones. You see the fare before you book — never after.",
  },
  {
    Icon: Users,
    title: "Share, if it makes sense",
    body: "When someone's headed a similar way in the same Tesla, you're offered a shared seat. Both of you pay less — the discount only applies once someone actually joins.",
  },
  {
    Icon: Navigation,
    title: "Track every step",
    body: "Waiting, matched, driver arrived, on the way, done. Your status updates automatically, and every ride keeps a full history.",
  },
] as const;

const RIDER_FEATURES = [
  "See your exact fare before you request — solo and pooled, side by side",
  "Track waiting → matched → arrived → on the way → done, live",
  "Cancel free any time before the driver starts your trip",
  "Pay cash, or keep a TeslaPay balance topped up",
];

const DRIVER_FEATURES = [
  "Go online in your zone and see every compatible request",
  "Bullet's 3 seats — the app enforces it, you never overbook",
  "One tap each for arrived, started, and every drop-off",
  "Full pool history with per-trip earnings",
];

function QuickTripWidget() {
  const zonesQuery = useZones();
  const zones = zonesQuery.data ?? [];
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      sessionStorage.setItem(QUICK_TRIP_KEY, JSON.stringify({ pickup, dropoff }));
    } catch {
      // Best-effort prefill only — registration still works without it.
    }
    navigate("/register");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-muted">Pickup</span>
          <Select value={pickup} onChange={(event) => setPickup(event.target.value)} required>
            <option value="" disabled>
              Choose a zone
            </option>
            {zones.map((zone) => (
              <option key={zone.code} value={zone.code}>
                {zone.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-muted">Drop-off</span>
          <Select value={dropoff} onChange={(event) => setDropoff(event.target.value)} required>
            <option value="" disabled>
              Choose a zone
            </option>
            {zones
              .filter((zone) => zone.code !== pickup)
              .map((zone) => (
                <option key={zone.code} value={zone.code}>
                  {zone.name}
                </option>
              ))}
          </Select>
        </label>
      </div>
      <Button
        type="submit"
        disabled={!pickup || !dropoff}
        className="mt-3 w-full"
        icon={<ArrowRight size={15} strokeWidth={2.25} />}
      >
        See your fare
      </Button>
    </form>
  );
}

function HeroVisual() {
  const zonesQuery = useZones();
  const zones = zonesQuery.data ?? [];

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-3xl border border-border bg-surface p-3 shadow-sm">
        <div className="aspect-[4/3] w-full sm:aspect-square">
          <ZoneDiagram
            zones={zones}
            highlightZoneCodes={["BANANI", "MOHAKHALI", "GULSHAN_1"]}
            connections={[
              ["BANANI", "MOHAKHALI"],
              ["BANANI", "GULSHAN_1"],
            ]}
            className="h-full w-full"
          />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="absolute -left-4 top-6 hidden rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-lg sm:block"
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
          Nusrat's fare
        </p>
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className="tabular text-sm text-text-faint line-through">
            {formatPaisaAsTaka(paisa(6750))}
          </span>
          <span className="tabular font-display text-lg font-bold text-text">
            {formatPaisaAsTaka(paisa(5400))}
          </span>
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.5 }}
        className="absolute -bottom-4 -right-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-lg sm:right-6"
      >
        <SeatMeter capacity={3} reserved={2} />
      </motion.div>
    </div>
  );
}

function WorkedExample() {
  const trips = [
    { name: "Nusrat", route: "Banani → Mohakhali", solo: 6750, pooled: 5400 },
    { name: "Rafiq", route: "Banani → Gulshan 1", solo: 7500, pooled: 6000 },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {trips.map((trip) => (
        <div key={trip.name} className="rounded-2xl border border-border bg-surface p-5">
          <p className="font-display text-sm font-semibold text-text">
            {trip.name} <span className="font-normal text-text-muted">· {trip.route}</span>
          </p>
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className="tabular text-lg text-text-faint line-through">
              {formatPaisaAsTaka(paisa(trip.solo))}
            </span>
            <span className="tabular font-display text-3xl font-bold text-text">
              {formatPaisaAsTaka(paisa(trip.pooled))}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            once she shares Bullet with a compatible rider
          </p>
        </div>
      ))}
    </div>
  );
}

function HowItWorksSection() {
  const [active, setActive] = useState(0);
  const step = HOW_IT_WORKS[active] ?? HOW_IT_WORKS[0];

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="space-y-2">
        {HOW_IT_WORKS.map((item, index) => (
          <button
            key={item.title}
            type="button"
            onClick={() => setActive(index)}
            onMouseEnter={() => setActive(index)}
            className={`flex w-full items-start gap-4 rounded-2xl border p-5 text-left transition-colors ${
              active === index
                ? "border-accent bg-accent-soft"
                : "border-border bg-surface hover:border-border-strong"
            }`}
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-surface-raised text-accent-strong lg:hidden">
              <item.Icon size={18} strokeWidth={2.25} />
            </span>
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wide text-text-faint">
                Step {index + 1}
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold text-text">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{item.body}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="sticky top-24 hidden self-start lg:block">
        <div className="flex aspect-square flex-col items-center justify-center gap-4 rounded-3xl border border-border bg-surface p-10">
          {step && <step.Icon size={72} strokeWidth={1.25} className="text-accent" />}
          {step && <p className="font-display text-lg font-semibold text-text">{step.title}</p>}
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div>
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24 lg:px-8">
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent-strong">
            Dhaka's shared-ride pilot
          </p>
          <h1 className="mt-3 text-balance font-display text-4xl font-bold leading-[1.1] text-text sm:text-5xl lg:text-6xl">
            Share a seat. Split the fare. Survive Dhaka traffic.
          </h1>
          <p className="mt-5 max-w-md text-lg text-text-muted">
            Request a ride across ten Dhaka zones. When someone's headed your way, split a Tesla and
            the fare — automatically, fairly, and transparently.
          </p>
          <div className="mt-8 max-w-sm">
            <QuickTripWidget />
          </div>
          <p className="mt-4 text-sm text-text-faint">
            Already riding?{" "}
            <Link to="/login" className="font-medium text-accent-strong hover:underline">
              Sign in
            </Link>
          </p>
        </div>
        <HeroVisual />
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20 lg:px-8">
          <SectionHeader
            eyebrow="Real numbers, not marketing math"
            title="The PRD's own example, run for real"
            description="Nusrat and Rafiq board Bullet within a minute of each other, headed the same way. Here's exactly what they each pay."
          />
          <div className="mt-10">
            <WorkedExample />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24 lg:px-8">
        <SectionHeader eyebrow="How it works" title="Three steps, every time" />
        <div className="mt-10">
          <HowItWorksSection />
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24 lg:px-8">
          <SectionHeader eyebrow="Built on guarantees" title="Not promises — enforced rules" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-bg p-6 sm:col-span-2 sm:row-span-2 lg:col-span-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                <Gauge size={19} strokeWidth={2.25} />
              </span>
              <h3 className="mt-4 font-display text-xl font-semibold text-text">
                Last seat, one winner
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                Two passengers can race for the same last seat at the exact same instant. The
                database itself — not luck — makes sure exactly one of them gets it, and the other
                sees "that seat was just taken" instantly.
              </p>
              <div className="mt-5 max-w-[220px]">
                <SeatMeter capacity={3} reserved={3} />
              </div>
            </div>
            {[
              {
                Icon: Receipt,
                title: "Fare, locked",
                body: "Never charged above your original quote.",
              },
              {
                Icon: ShieldCheck,
                title: "Capacity, enforced",
                body: "A Tesla can't be overbooked, by design.",
              },
              {
                Icon: Wallet,
                title: "Cash or TeslaPay",
                body: "Your choice, every time you book.",
              },
              {
                Icon: EyeOff,
                title: "Privacy, respected",
                body: "Co-riders see a count, never a name.",
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-border bg-bg p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric-soft text-electric">
                  <Icon size={16} strokeWidth={2.25} />
                </span>
                <h3 className="mt-3 font-display text-sm font-semibold text-text">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24 lg:px-8">
        <SectionHeader
          eyebrow="One app, two seats at the table"
          title="Built for riders and drivers alike"
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
              <Users size={20} strokeWidth={2.25} />
            </span>
            <h3 className="mt-4 font-display text-xl font-semibold text-text">For riders</h3>
            <ul className="mt-4 space-y-3">
              {RIDER_FEATURES.map((feature) => (
                <li key={feature} className="flex gap-2.5 text-sm text-text-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link to="/register">
              <Button className="mt-6" icon={<ArrowRight size={15} strokeWidth={2.25} />}>
                Request a ride
              </Button>
            </Link>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-electric-soft text-electric">
              <Car size={20} strokeWidth={2.25} />
            </span>
            <h3 className="mt-4 font-display text-xl font-semibold text-text">For drivers</h3>
            <ul className="mt-4 space-y-3">
              {DRIVER_FEATURES.map((feature) => (
                <li key={feature} className="flex gap-2.5 text-sm text-text-muted">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-electric" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-text-faint">
              Driver accounts are set up by an admin — talk to your Dhaka Tesla Pool contact to get
              one.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 lg:py-20 lg:px-8">
          <img
            src={rickshawPhoto}
            alt="Jashim's battery rickshaw, decorated and branded as a 'Tesla' — the vehicle this whole product is built around"
            className="w-36 -rotate-2 rounded-xl border-4 border-bg shadow-lg sm:w-40"
          />
          <p className="max-w-xl text-sm text-text-muted">
            In Dhaka, your Tesla may have three wheels — a battery rickshaw with a hand-painted
            badge, not a car. The pooling, the fares, and the seat-capacity math are all built
            around exactly that.
          </p>
        </div>
      </section>

      <section className="bg-text">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:py-20 lg:px-8">
          <h2 className="text-balance font-display text-3xl font-bold text-bg sm:text-4xl">
            Ready to share your first Tesla?
          </h2>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register">
              <Button className="px-6 py-3">Get started</Button>
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-bg/25 px-6 py-3 text-sm font-semibold text-bg transition-colors hover:border-bg/50"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-bg/60">
            <Clock3 size={13} strokeWidth={2.25} />
            Free-tier hosting — the first request of the day may take a minute to wake up.
          </p>
        </div>
      </section>
    </div>
  );
}
