import React from "react";
import { TableCard } from "@bitpoker/poker-session/types";

// Printed card artwork, staged at the site root from
// packages/poker-session/assets (see ASSETS.md). A backend card name is the
// canonical "<rank><suit>" form — "AS", "TD", "QC" — and the artwork is named
// by spelled-out suit and numeric rank, so "QC" -> CLUB-12-QUEEN.svg.
const SUIT_NAMES: Record<string, string> = {
  S: "SPADE",
  H: "HEART",
  D: "DIAMOND",
  C: "CLUB",
};
const RANK_STEMS: Record<string, string> = {
  A: "1",
  T: "10",
  J: "11-JACK",
  Q: "12-QUEEN",
  K: "13-KING",
};

// Addressed by plain URL rather than imported: the same file is bundled by
// Vite here and by webpack in the extension, and a plain URL is the one form
// both agree on (a template-literal `require` is a webpack context module,
// `import.meta.glob` is Vite-only).
const CARD_ASSET_BASE = "cards/";

function faceUrl(name: string): string | undefined {
  const suit = SUIT_NAMES[name.slice(-1)];
  if (suit === undefined) {
    return undefined;
  }
  const rank = name.slice(0, -1);
  const stem = RANK_STEMS[rank] ?? rank;
  return `${CARD_ASSET_BASE}${suit}-${stem}.svg`;
}

export const CardView: React.FC<{ card: TableCard; small?: boolean }> = ({
  card,
  small,
}) => {
  const src = faceUrl(card.name);
  if (src === undefined) {
    return null;
  }
  return (
    <img
      className={`card-img ${small ? "card-img-sm" : ""}`}
      src={src}
      alt={card.name}
      title={card.name}
    />
  );
};

export const CardBack: React.FC<{ small?: boolean }> = ({ small }) => (
  <img
    className={`card-img ${small ? "card-img-sm" : ""}`}
    src={`${CARD_ASSET_BASE}card-back.png`}
    alt="face-down card"
  />
);

export const CardBacks: React.FC<{ count: number; small?: boolean }> = ({
  count,
  small,
}) => (
  <React.Fragment>
    {Array.from({ length: count }, (_, i) => (
      <CardBack key={i} small={small} />
    ))}
  </React.Fragment>
);

// An empty slot per undealt card, so the board keeps its shape instead of
// jumping a row taller when the flop lands.
export const CardSlots: React.FC<{ count: number }> = ({ count }) => (
  <React.Fragment>
    {Array.from({ length: count }, (_, i) => (
      <span className="card-slot" key={i} />
    ))}
  </React.Fragment>
);

export const Cards: React.FC<{
  cards?: TableCard[];
  slots?: number;
  small?: boolean;
}> = ({ cards, slots = 0, small }) => {
  const dealt = cards ?? [];
  return (
    <React.Fragment>
      {dealt.map((c) => (
        <CardView key={c.index} card={c} small={small} />
      ))}
      {slots > dealt.length && <CardSlots count={slots - dealt.length} />}
    </React.Fragment>
  );
};
