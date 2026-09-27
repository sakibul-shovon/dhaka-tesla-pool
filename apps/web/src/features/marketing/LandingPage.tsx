import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { EyeOff, MapPin, Navigation, Receipt, ShieldCheck, Users, Wallet, ArrowRight } from "lucide-react";
import { formatPaisaAsTaka, paisa } from "@dhaka-tesla-pool/shared";
import { useZones } from "../../lib/zones.js";
import { ZoneDiagram } from "../../components/map/ZoneDiagram.js";
import { SeatMeter } from "../../components/ui/SeatMeter.js";
import { Button } from "../../components/ui/Button.js";
import { Select } from "../../components/ui/Select.js";
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

const TRUST_POINTS = [
  {
    Icon: Receipt,
    title: "See your fare before you book",
    body: "Every quote is computed up front and stored with your request — the price only ever goes down if a pool discount applies, never up.",
  },
  {
    Icon: ShieldCheck,
    title: "Seats, guaranteed",
    body: "A Tesla's capacity is enforced at the database level. You will never be squeezed into a seat that isn't actually free.",
  },
  {
    Icon: Wallet,
    title: "Ride your way",
    body: "Pay cash on arrival, or keep a TeslaPay balance topped up for a faster checkout.",
  },
  {
    Icon: EyeOff,
    title: "Your privacy, respected",
    body: "Sharing a Tesla shows you how many other riders are aboard — never who. Make it to Gulshan without making a new friend.",
  },
] as const;

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
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
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
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">Nusrat's fare</p>
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className="tabular text-sm text-text-faint line-through">{formatPaisaAsTaka(paisa(6750))}</span>
          <span className="tabular font-display text-lg font-bold text-text">{formatPaisaAsTaka(paisa(5400))}</span>
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

      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-text sm:text-3xl">How pooling works</h2>
          <div className="mt-10">
            <HowItWorksSection />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20 lg:px-8">
        <h2 className="font-display text-2xl font-bold text-text sm:text-3xl">Built on guarantees, not promises</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {TRUST_POINTS.map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-electric-soft text-electric">
                <Icon size={17} strokeWidth={2.25} />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-text">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 lg:py-20 lg:px-8">
          <img
            src={rickshawPhoto}
            alt="Jashim's battery rickshaw, decorated and branded as a 'Tesla' — the vehicle this whole product is built around"
            className="w-36 rounded-xl border-4 border-surface shadow-lg sm:w-40"
          />
          <p className="max-w-xl text-sm text-text-muted">
            In Dhaka, your Tesla may have three wheels — a battery rickshaw with a hand-painted badge, not a
            car. The pooling, the fares, and the seat-capacity math are all built around exactly that.
          </p>
        </div>
      </section>
    </div>
  );
}
