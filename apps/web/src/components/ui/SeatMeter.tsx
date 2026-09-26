// plan §15.2's own shorthand for this exact meter: "●●○ 2/3 seats".
export function SeatMeter({ capacity, reserved }: { capacity: number; reserved: number }) {
  const seats = Array.from({ length: capacity }, (_, index) => index < reserved);

  return (
    <div className="flex items-center gap-2" aria-label={`${reserved} of ${capacity} seats occupied`}>
      <div className="flex gap-1">
        {seats.map((filled, index) => (
          <span
            key={index}
            aria-hidden
            className={"h-3 w-3 rounded-full " + (filled ? "bg-[--color-accent]" : "border border-neutral-300")}
          />
        ))}
      </div>
      <span className="text-sm text-neutral-500">
        {reserved}/{capacity} seats
      </span>
    </div>
  );
}
