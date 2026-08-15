import React, { useEffect, useState } from "react";
import { GameSnapshot } from "@bitpoker/poker-session/controller";
import {
  PHASE_NAMES,
  PokerActionKind,
  TablePlayer,
  TableState,
} from "@bitpoker/poker-session/types";
import {
  BetView,
  betActionCost,
  computeBetBounds,
} from "@bitpoker/poker-session/bet-bounds";
import { Cards, CardBacks } from "./cards";
import { QuickSizes, ResultBanner, Seat, SessionStrip } from "./table-chrome";

// Texas Hold'em: board and hole cards on the felt, seat plates, and a
// bounds-validated action bar (the slider and the amount are clamped to what
// the engine will accept, so an illegal raise is not reachable from the UI).
export const ThTable: React.FC<{
  t: TableState;
  me: number;
  peer: number;
  myTurn: boolean;
  snapshot: GameSnapshot;
  continueWish: boolean;
  act: (kind: number, amount?: number) => void;
  setContinueWish: (wish: boolean) => void;
  // Formats in-game chip amounts (chain sessions: uchip -> CHIP).
  fmt: (amount: number) => string;
}> = ({
  t,
  me,
  peer,
  myTurn,
  snapshot,
  continueWish,
  act,
  setContinueWish,
  fmt,
}) => {
  const { stage, matched } = snapshot;
  const toCall = t.toCall ?? 0;
  const players = t.players as TablePlayer[] | undefined;
  const my = players?.[me];
  const opp = players?.[peer];

  const betView: BetView = {
    game: "TH",
    pot: t.pot ?? 0,
    toCall,
    currentBet: t.currentBet ?? 0,
    lastRaiseSize: t.lastRaiseSize ?? 0,
    bigBlind: t.bigBlind ?? 0,
    myCommitted: my?.committedRound ?? 0,
    myStack: my?.stack ?? 0,
    oppCommitted: opp?.committedRound ?? 0,
    oppStack: opp?.stack ?? 0,
    currentDarkBet: 0,
    hasLooked: false,
  };
  const bounds = computeBetBounds(betView);
  const isRaise = (t.currentBet ?? 0) > 0;

  // Bet amount as a number clamped into the legal bounds; re-anchor to the
  // minimum whenever the bounds move (a new decision arrived).
  const [amount, setAmount] = useState(0);
  useEffect(() => {
    if (myTurn && bounds.hasBet) {
      setAmount((cur) =>
        cur >= bounds.minTarget && cur <= bounds.maxTarget
          ? cur
          : bounds.minTarget
      );
    }
  }, [myTurn, bounds.hasBet, bounds.minTarget, bounds.maxTarget]);
  const clamped = Math.min(
    Math.max(amount, bounds.minTarget),
    bounds.maxTarget
  );
  const cost = betActionCost(betView, clamped);
  const atAllIn = bounds.maxIsTrueAllIn && clamped >= bounds.maxTarget;

  // Session standings (matchmaking order -> me/opponent via matched.meFirst).
  const mySession = matched?.meFirst
    ? t.sessionFirstChips
    : t.sessionSecondChips;
  const oppSession = matched?.meFirst
    ? t.sessionSecondChips
    : t.sessionFirstChips;
  const standings =
    mySession !== undefined && oppSession !== undefined
      ? `you ${fmt(mySession)} / opponent ${fmt(oppSession)}`
      : undefined;
  const total = (mySession ?? 0) + (oppSession ?? 0);
  const outcome =
    mySession !== undefined && oppSession !== undefined
      ? mySession * 2 > total
        ? "you are ahead"
        : mySession * 2 < total
        ? "opponent is ahead"
        : "even"
      : "";

  const submitBet = () => {
    if (atAllIn) {
      act(PokerActionKind.AllIn);
    } else if (isRaise) {
      act(PokerActionKind.Raise, clamped);
    } else {
      act(PokerActionKind.Bet, clamped);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="felt col" style={{ gap: 14 }}>
        <div className="row wrap">
          <span className="pot num">
            Pot {fmt(t.pot ?? 0)}
            {t.currentBet ? ` · bet ${fmt(t.currentBet)}` : ""}
          </span>
          <span className="tag">
            Hand {t.handNumber ?? 1} · {PHASE_NAMES[t.phase ?? 0]}
          </span>
          {t.dealing && <span className="tag">dealing…</span>}
          {t.button === me && <span className="tag">you have the button</span>}
        </div>

        <Seat
          title="Opponent"
          subtitle={opp?.committedRound ? `in ${fmt(opp.committedRound)}` : ""}
          stack={fmt(opp?.stack ?? 0)}
          active={!myTurn && stage === "playing"}
          folded={opp?.folded}
          badges={
            <>
              {opp?.allIn && <span className="badge badge-allin">ALL-IN</span>}
              {opp?.folded && <span className="badge">folded</span>}
              {t.button === peer && <span className="badge badge-btn">D</span>}
            </>
          }
        >
          {t.peerHoleCards && t.peerHoleCards.length > 0 ? (
            <Cards cards={t.peerHoleCards} />
          ) : (
            <CardBacks count={2} />
          )}
        </Seat>

        <div className="col" style={{ gap: 6 }}>
          <span className="tiny" style={{ opacity: 0.7 }}>
            BOARD
          </span>
          <div className="cards-row">
            <Cards cards={t.communityCards} slots={5} />
          </div>
        </div>

        <Seat
          title={`You (${matched?.meFirst ? "first" : "second"})`}
          subtitle={my?.committedRound ? `in ${fmt(my.committedRound)}` : ""}
          stack={fmt(my?.stack ?? 0)}
          active={myTurn}
          folded={my?.folded}
          badges={
            <>
              {myTurn && <span className="badge">your turn</span>}
              {my?.allIn && <span className="badge badge-allin">ALL-IN</span>}
              {my?.folded && <span className="badge">folded</span>}
              {t.button === me && <span className="badge badge-btn">D</span>}
            </>
          }
        >
          {t.myHoleCards && t.myHoleCards.length > 0 ? (
            <Cards cards={t.myHoleCards} />
          ) : (
            <CardBacks count={2} />
          )}
        </Seat>

        <ResultBanner
          t={t}
          text={`Hand ${t.handsPlayed ?? 0} settled${
            standings ? ` — ${standings} (${outcome})` : ""
          }`}
        />
      </div>

      {stage === "playing" && (
        <>
          <div className="actionbar">
            <button
              className="btn"
              disabled={!myTurn}
              onClick={() => act(PokerActionKind.Fold)}
            >
              Fold
            </button>
            <button
              className="btn"
              disabled={!myTurn || toCall > 0}
              onClick={() => act(PokerActionKind.Check)}
            >
              Check
            </button>
            <button
              className="btn btn-primary"
              disabled={!myTurn || toCall === 0}
              onClick={() => act(PokerActionKind.Call)}
            >
              Call {toCall > 0 ? fmt(toCall) : ""}
            </button>

            {bounds.hasBet && (
              <div className="raise">
                <input
                  type="range"
                  min={bounds.minTarget}
                  max={bounds.maxTarget}
                  value={clamped}
                  onChange={(e) => setAmount(parseInt(e.target.value, 10))}
                  disabled={!myTurn}
                  aria-label="bet amount"
                />
                <QuickSizes
                  bounds={bounds}
                  pot={t.pot ?? 0}
                  disabled={!myTurn}
                  onPick={setAmount}
                />
                <button
                  className="btn btn-primary"
                  disabled={!myTurn}
                  onClick={submitBet}
                >
                  {atAllIn
                    ? `All-in · ${fmt(cost)}`
                    : isRaise
                    ? `Raise to ${fmt(clamped)}`
                    : `Bet ${fmt(clamped)}`}
                </button>
              </div>
            )}
          </div>

          <div className="row small faint">
            {bounds.hasBet && (
              <span className="num">
                {fmt(bounds.minTarget)} – {fmt(bounds.maxTarget)}
                {bounds.maxIsTrueAllIn ? " (all-in)" : ""}
                {!atAllIn && isRaise ? ` · pays ${fmt(cost)}` : ""}
              </span>
            )}
            <label className="check right">
              <input
                type="checkbox"
                checked={!continueWish}
                onChange={(e) => setContinueWish(!e.target.checked)}
              />
              <span>
                Leave after this hand
                {!continueWish ? " (ends at this hand's settlement)" : ""}
              </span>
            </label>
          </div>
        </>
      )}

      <SessionStrip snapshot={snapshot} standings={standings} />

      {stage === "done" && standings && (
        <div className="notice" data-testid="result">
          <b className="ok">settled: {standings}</b> —{" "}
          {outcome === "you are ahead"
            ? "you win"
            : outcome === "opponent is ahead"
            ? "opponent wins"
            : "split pot"}
        </div>
      )}
    </div>
  );
};
