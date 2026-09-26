import { useRef } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { MapPin, Navigation, Receipt, ShieldCheck, Users, Wallet, EyeOff } from "lucide-react";
import { useZones } from "../../lib/zones.js";
import { ZoneDiagram } from "../../components/map/ZoneDiagram.js";
import rickshawPhoto from "../../assets/rickshaw-tesla.png";

gsap.registerPlugin(ScrollTrigger);

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

export function LandingPage() {
  const zonesQuery = useZones();
  const zones = zonesQuery.data ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      // Respect the OS setting the same way Motion does elsewhere in the app
      // (plan §8) — GSAP has no global equivalent to MotionConfig, so each
      // scroll-triggered set-piece needs its own matchMedia branch.
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const reveals = gsap.utils.toArray<HTMLElement>("[data-reveal]");
        for (const el of reveals) {
          gsap.from(el, {
            opacity: 0,
            y: 24,
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 88%" },
          });
        }
      });
      return () => mm.revert();
    },
    { scope: containerRef, dependencies: [zones.length] },
  );

  return (
    <div ref={containerRef}>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24 lg:px-8">
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent-strong">
            Dhaka's shared-ride pilot
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-text sm:text-5xl">
            Share a seat. Split the fare.
            <br />
            Survive Dhaka traffic.
          </h1>
          <p className="mt-4 max-w-md text-base text-text-muted">
            Request a ride across ten Dhaka zones. When someone's headed your way, split a Tesla and
            the fare — automatically, fairly, and transparently.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/register"
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent shadow-sm transition-[filter] hover:brightness-95"
            >
              Get started
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-border-strong px-5 py-2.5 text-sm font-semibold text-text transition-colors hover:border-accent hover:text-accent-strong"
            >
              Sign in
            </Link>
          </div>
        </div>
        <div data-reveal className="aspect-square w-full">
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
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20 lg:px-8">
          <h2 data-reveal className="font-display text-2xl font-bold text-text sm:text-3xl">
            How pooling works
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {HOW_IT_WORKS.map(({ Icon, title, body }, index) => (
              <div key={title} data-reveal>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                  <Icon size={18} strokeWidth={2.25} />
                </span>
                <p className="mt-4 font-display text-sm font-semibold uppercase tracking-wide text-text-faint">
                  Step {index + 1}
                </p>
                <h3 className="mt-1 font-display text-lg font-semibold text-text">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20 lg:px-8">
        <h2 data-reveal className="font-display text-2xl font-bold text-text sm:text-3xl">
          Built on guarantees, not promises
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {TRUST_POINTS.map(({ Icon, title, body }) => (
            <div
              key={title}
              data-reveal
              className="flex gap-4 rounded-2xl border border-border bg-surface p-5"
            >
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
        <div
          data-reveal
          className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-14 text-center sm:px-6 lg:py-20 lg:px-8"
        >
          <img
            src={rickshawPhoto}
            alt="Jashim's battery rickshaw, decorated and branded as a 'Tesla' — the vehicle this whole product is built around"
            className="w-36 rounded-xl border-4 border-surface shadow-lg sm:w-40"
          />
          <p className="max-w-xl text-sm text-text-muted">
            In Dhaka, your Tesla may have three wheels — a battery rickshaw with a hand-painted
            badge, not a car. The pooling, the fares, and the seat-capacity math are all built
            around exactly that.
          </p>
        </div>
      </section>
    </div>
  );
}
