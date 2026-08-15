import React, { useEffect, useState } from "react";
import { GameSnapshot } from "@bitpoker/poker-session/controller";
import { BetBounds } from "@bitpoker/poker-session/bet-bounds";
import { TableState } from "@bitpoker/poker-session/types";

// Pieces both tables share: a seat plate, the auto-hiding hand-result banner,
// and the persistent strip that stays once the session is over. Presentation
// only — all game data arrives as props.

export const Seat: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  stack?: string;
  active?: boolean;
  folded?: boolean;
  badges?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, subtitle, stack, active, folded, badges, children }) => (
  <div className="col" style={{ gap: 8 }}>
    <div
      className={`seat ${active ? "seat-active" : ""} ${
        folded ? "seat-folded" : ""
      }`}
    >
      <div className="list-main">
        <span className="seat-name">{title}</span>
        {subtitle && <span className="tiny" style={{ opacity: 0.75 }}>{subtitle}</span>}
      </div>
      {stack !== undefined && (
        <span className="seat-stack num">{stack}</span>
      )}
      {badges && <span className="seat-badges">{badges}</span>}
    </div>
    <div className="cards-row">{children}</div>
  </div>
);

// Pot-relative shortcuts for the bet slider. They replace a free-text amount
// box, which had to be typed in the engine's own unit (uchip) and so sat on
// the felt reading "40000" next to a button offering to raise to 0.04 CHIP.
// Every value is clamped into the legal range, so a shortcut can never offer
// a bet the engine would reject.
export const QuickSizes: React.FC<{
  bounds: BetBounds;
  pot: number;
  disabled: boolean;
  onPick: (target: number) => void;
}> = ({ bounds, pot, disabled, onPick }) => {
  const clamp = (target: number) =>
    Math.min(Math.max(Math.round(target), bounds.minTarget), bounds.maxTarget);
  const sizes: ReadonlyArray<{ label: string; target: number }> = [
    { label: "min", target: bounds.minTarget },
    { label: "½ pot", target: clamp(pot / 2) },
    { label: "pot", target: clamp(pot) },
    { label: bounds.maxIsTrueAllIn ? "all-in" : "max", target: bounds.maxTarget },
  ];
  // Two shortcuts can land on the same number in a small pot; show each once.
  const seen = new Set<number>();
  return (
    <span className="row" style={{ gap: 4 }}>
      {sizes
        .filter(({ target }) => !seen.has(target) && seen.add(target) !== null)
        .map(({ label, target }) => (
          <button
            key={label}
            className="btn btn-ghost btn-sm"
            disabled={disabled}
            onClick={() => onPick(target)}
          >
            {label}
          </button>
        ))}
    </span>
  );
};

// Non-modal hand-result banner: shows for a few seconds whenever a new hand
// settles (keyed on handsPlayed), then fades. The controller holds the settle
// frame ~2.6s before moving on, so the banner and the pacing agree.
export const ResultBanner: React.FC<{
  t: TableState;
  text: string;
}> = ({ t, text }) => {
  const [visibleFor, setVisibleFor] = useState<number | undefined>(undefined);
  const settledKey = t.settled ? t.handsPlayed ?? 0 : undefined;

  useEffect(() => {
    if (settledKey === undefined) {
      return;
    }
    setVisibleFor(settledKey);
    const timer = setTimeout(() => {
      setVisibleFor((cur) => (cur === settledKey ? undefined : cur));
    }, 2600);
    return () => clearTimeout(timer);
  }, [settledKey]);

  if (visibleFor === undefined) {
    return null;
  }
  // NOT data-testid="result": that id is the PERSISTENT settled line the e2e
  // driver asserts after the session; this banner auto-hides.
  return (
    <div className="hand-banner" data-testid="hand-banner">
      {text}
    </div>
  );
};

// Persistent strip once the session is over (done / error / disputed): the
// reason plus the cumulative session standings.
export const SessionStrip: React.FC<{
  snapshot: GameSnapshot;
  standings?: string;
}> = ({ snapshot, standings }) => {
  const { stage, message } = snapshot;
  if (stage !== "done" && stage !== "error" && stage !== "disputed") {
    return null;
  }
  const label =
    stage === "done"
      ? "Session over"
      : stage === "disputed"
      ? "Session disputed"
      : "Session error";
  return (
    <div className="session-strip" data-testid="session-strip">
      <b className={stage === "error" ? "bad" : stage === "done" ? "ok" : ""}>
        {label}
      </b>
      <span>{message}</span>
      {standings && <span className="num right">{standings}</span>}
    </div>
  );
};
