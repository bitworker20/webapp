import React, { useEffect, useState } from "react";
import { GameSnapshot } from "@bitpoker/poker-session/controller";
import {
  TableState,
  ZjhActionKind,
  ZjhPlayer,
} from "@bitpoker/poker-session/types";
import {
  BetView,
  betActionCost,
  computeBetBounds,
} from "@bitpoker/poker-session/bet-bounds";
import { Cards, CardBacks } from "./cards";
import { QuickSizes, ResultBanner, Seat, SessionStrip } from "./table-chrome";

// ZhaJinHua (three-card brag): three private cards, blind/looked betting where
// looking doubles what a call costs, and compare as the way to force a
// showdown.
export const ZjhTable: React.FC<{
  t: TableState;
  me: number;
  peer: number;
  myTurn: boolean;
  snapshot: GameSnapshot;
  continueWish: boolean;
  act: (kind: number, amount?: number) => void;
  setContinueWish: (wish: boolean) => void;
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
  const players = (t.players as ZjhPlayer[] | undefined) ?? [];
  const my = players[me];
  const opp = players[peer];
  const looked = my?.looked ?? false;
  const darkBet = t.currentDarkBet ?? 0;
  const myCallCost = darkBet * (looked ? 2 : 1);

  // Session standings (matchmaking order) double as the ZJH stack source: the
  // ZJH table state has no per-seat stack, but stack = session chips carried
  // into this hand minus what this hand has committed.
  const mySession = matched?.meFirst
    ? t.sessionFirstChips
    : t.sessionSecondChips;
  const oppSession = matched?.meFirst
    ? t.sessionSecondChips
    : t.sessionFirstChips;
  const myStack = Math.max(0, (mySession ?? 0) - (my?.committed ?? 0));
  const oppStack = Math.max(0, (oppSession ?? 0) - (opp?.committed ?? 0));

  const betView: BetView = {
    game: "ZJH",
    pot: t.pot ?? 0,
    toCall: 0,
    currentBet: 0,
    lastRaiseSize: 0,
    bigBlind: 0,
    myCommitted: my?.committed ?? 0,
    myStack,
    oppCommitted: opp?.committed ?? 0,
    oppStack,
    currentDarkBet: darkBet,
    hasLooked: looked,
  };
  const bounds = computeBetBounds(betView);

  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (myTurn && bounds.hasBet) {
      setLevel((cur) =>
        cur >= bounds.minTarget && cur <= bounds.maxTarget
          ? cur
          : bounds.minTarget
      );
    }
  }, [myTurn, bounds.hasBet, bounds.minTarget, bounds.maxTarget]);
  const clamped = Math.min(Math.max(level, bounds.minTarget), bounds.maxTarget);
  const cost = betActionCost(betView, clamped);

  const standings =
    mySession !== undefined && oppSession !== undefined
      ? `you ${fmt(mySession)} / opponent ${fmt(oppSession)}`
      : undefined;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="felt col" style={{ gap: 14 }}>
        <div className="row wrap">
          <span className="pot num">Pot {fmt(t.pot ?? 0)}</span>
          <span className="tag tag-zjh">ZhaJinHua 三张</span>
          <span className="tag">Hand {t.handNumber ?? 1}</span>
          <span className="tag num">ante {fmt(t.ante ?? 0)}</span>
          {t.dealing ? (
            <span className="tag">dealing…</span>
          ) : (
            <span className="tag num">dark bet {fmt(darkBet)}</span>
          )}
          {t.button === me && <span className="tag">you deal</span>}
        </div>

        <Seat
          title="Opponent"
          subtitle={`${opp?.looked ? "looked" : "blind"} · in pot ${fmt(
            opp?.committed ?? 0
          )}`}
          stack={fmt(oppStack)}
          active={!myTurn && stage === "playing"}
          folded={opp?.folded}
          badges={
            <>
              {opp?.looked && <span className="badge">looked</span>}
              {opp?.folded && <span className="badge">folded</span>}
            </>
          }
        >
          {t.peerCards && t.peerCards.length > 0 ? (
            <Cards cards={t.peerCards} />
          ) : (
            <CardBacks count={3} />
          )}
        </Seat>

        <Seat
          title={`You (${matched?.meFirst ? "first" : "second"})`}
          subtitle={`${looked ? "looked" : "blind"} · in pot ${fmt(
            my?.committed ?? 0
          )}`}
          stack={fmt(myStack)}
          active={myTurn}
          folded={my?.folded}
          badges={
            <>
              {myTurn && <span className="badge">your turn</span>}
              {my?.folded && <span className="badge">folded</span>}
            </>
          }
        >
          {t.myCards && t.myCards.length > 0 ? (
            <Cards cards={t.myCards} />
          ) : looked ? (
            <span className="tiny" style={{ opacity: 0.7 }}>
              revealing…
            </span>
          ) : (
            <CardBacks count={3} />
          )}
        </Seat>

        <ResultBanner
          t={t}
          text={`Hand ${t.handsPlayed ?? 0} settled${
            standings ? ` — ${standings}` : ""
          }`}
        />
      </div>

      {stage === "playing" && (
        <>
          <div className="actionbar">
            <button
              className="btn"
              disabled={!myTurn}
              onClick={() => act(ZjhActionKind.Fold)}
            >
              Fold
            </button>
            <button
              className="btn"
              disabled={!myTurn || looked}
              onClick={() => act(ZjhActionKind.Look)}
              title="Looking doubles what every later call costs you"
            >
              Look
            </button>
            <button
              className="btn btn-primary"
              disabled={!myTurn}
              onClick={() => act(ZjhActionKind.Call)}
            >
              Call {myCallCost > 0 ? fmt(myCallCost) : ""}
            </button>
            <button
              className="btn"
              disabled={!myTurn}
              onClick={() => act(ZjhActionKind.Compare)}
            >
              Compare
            </button>

            {bounds.hasBet && (
              <div className="raise">
                <input
                  type="range"
                  min={bounds.minTarget}
                  max={bounds.maxTarget}
                  value={clamped}
                  onChange={(e) => setLevel(parseInt(e.target.value, 10))}
                  disabled={!myTurn}
                  aria-label="raise level"
                />
                <QuickSizes
                  bounds={bounds}
                  pot={t.pot ?? 0}
                  disabled={!myTurn}
                  onPick={setLevel}
                />
                <button
                  className="btn btn-primary"
                  disabled={!myTurn}
                  onClick={() => act(ZjhActionKind.Raise, clamped)}
                >
                  Raise to {fmt(clamped)}
                </button>
              </div>
            )}
          </div>

          <div className="row small faint">
            {bounds.hasBet && (
              <span className="num">
                {fmt(bounds.minTarget)} – {fmt(bounds.maxTarget)} (top =
                all-in) · pays {fmt(cost)}
                {looked ? " (looked ×2)" : ""}
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

      {(stage === "done" || stage === "disputed") && t.showdownComplete && (
        <div className="notice" data-testid="result">
          <b className="ok">showdown complete</b> —{" "}
          {matched?.meFirst ? "first" : "second"} seat
          {standings ? ` · ${standings}` : ""}
        </div>
      )}
    </div>
  );
};
