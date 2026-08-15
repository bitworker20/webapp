// The table screen: the session's progress while it is being set up, then the
// game itself.
//
// Everything before the first card is worth showing rather than hiding behind
// a spinner — opening an intent, waiting for a match, being handed a relay —
// because each step is a chain interaction the player paid for and may have
// to wait on.
import React from "react";
import { formatChip } from "@bitpoker/poker-session/chip";
import { PokerSession } from "../poker/session";
import { ThTable } from "../poker/ui/th-table";
import { ZjhTable } from "../poker/ui/zjh-table";
import { IconCards } from "./icons";

const STAGE_LABEL: Record<string, string> = {
  idle: "No game",
  connecting: "Opening the game",
  matching: "Waiting for an opponent",
  playing: "In play",
  done: "Session over",
  disputing: "Submitting dispute evidence",
  disputed: "Disputed",
  error: "Error",
};

export const TableView: React.FC<{
  session: PokerSession;
  onLeave: () => void;
}> = ({ session, onLeave }) => {
  const { snapshot } = session;
  const t = snapshot.table;
  const isZjh = t?.game === "ZJH";
  const me = t?.localSeat ?? 0;
  const peer = 1 - me;
  const myTurn = snapshot.wait === 0 && snapshot.stage === "playing";
  const finished = ["done", "disputed", "error"].includes(snapshot.stage);

  const tableProps = {
    me,
    peer,
    myTurn,
    snapshot,
    continueWish: snapshot.continueWish ?? true,
    act: session.act,
    setContinueWish: session.setContinueWish,
    // Chain sessions play in uchip; render as CHIP.
    fmt: snapshot.chain
      ? (amount: number) => formatChip(amount)
      : (amount: number) => String(amount),
  };

  if (snapshot.stage === "idle") {
    return (
      <div className="page">
        <div className="card empty">
          <IconCards size={22} />
          <span>No game in progress.</span>
          <span className="tiny">
            Join one from the lobby, or create your own.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-wide col" style={{ gap: 16 }}>
      <Progress session={session} />

      {t?.ready && isZjh && <ZjhTable t={t} {...tableProps} />}
      {t?.ready && !isZjh && <ThTable t={t} {...tableProps} />}

      {finished && (
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={onLeave}
            data-testid="leave-table"
          >
            Back to the lobby
          </button>
        </div>
      )}
    </div>
  );
};

const Progress: React.FC<{ session: PokerSession }> = ({ session }) => {
  const { snapshot } = session;
  const chain = snapshot.chain;
  const failed = snapshot.stage === "error";
  const waiting = ["connecting", "matching"].includes(snapshot.stage);

  return (
    <section className={`card card-pad col ${failed ? "" : ""}`}>
      <div className="row">
        {waiting && <span className="spinner" />}
        <b>{STAGE_LABEL[snapshot.stage] ?? snapshot.stage}</b>
        <span
          className={`small ${failed ? "bad" : "muted"}`}
          data-testid="status"
        >
          {snapshot.message}
        </span>
      </div>

      {chain && (
        <div className="session-strip" data-testid="chain">
          {chain.intentId && (
            <span>
              intent <span className="num">{chain.intentId}</span>
            </span>
          )}
          {chain.sessionId && (
            <span>
              session <span className="num">{chain.sessionId}</span>
            </span>
          )}
          {chain.relayId && <span>relay {chain.relayId}</span>}
          {chain.sessionStatus && <span>{chain.sessionStatus}</span>}
          {chain.resultTxHash && (
            <span className="mono tiny">
              result {chain.resultTxHash.slice(0, 12)}…
            </span>
          )}
          {chain.evidenceTxHash && (
            <span className="mono tiny">
              evidence {chain.evidenceTxHash.slice(0, 12)}…
            </span>
          )}
        </div>
      )}

      {snapshot.stage === "matching" && (
        <p className="faint tiny" style={{ margin: 0 }}>
          Your stake is escrowed on chain and the intent is live. It matches as
          soon as someone opens an overlapping one — leaving this page cancels
          nothing, but nobody can play your seat for you.
        </p>
      )}
    </section>
  );
};
