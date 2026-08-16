// Sessions that stopped moving, and the one button that gets the money out.
//
// A matched session escrows both stakes. If the opponent never shows, or no
// relay ever takes the game, or the opponent never confirms a result, the
// stake sits there until somebody claims the timeout — and only the two
// players may. Without this card the player can see the money is gone and do
// nothing about it, which is the worst possible combination.
import React, { useCallback, useEffect, useState } from "react";
import { formatChip } from "@bitpoker/poker-session/chip";
import { fetchChainHeight } from "@bitpoker/poker-session/lobby";
import {
  RecoverableSession,
  fetchRecoverableSessions,
} from "@bitpoker/poker-session/recovery";
import { BrowserKeyBridge } from "../wallet/browser-key-bridge";
import { CHAIN_ID, DEFAULT_LCD_URL } from "../config";
import { IconAlert, IconRefresh } from "./icons";

export const RecoveryCard: React.FC<{
  wallet: BrowserKeyBridge;
  address: string;
}> = ({ wallet, address }) => {
  const [sessions, setSessions] = useState<RecoverableSession[]>([]);
  const [height, setHeight] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const chainHeight = await fetchChainHeight(DEFAULT_LCD_URL);
    setHeight(chainHeight);
    setSessions(
      await fetchRecoverableSessions(DEFAULT_LCD_URL, address, chainHeight)
    );
  }, [address]);

  useEffect(() => {
    void refresh();
    // Slower than the lobby: these change on a deadline, not on an opponent.
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const claim = useCallback(
    async (sessionId: string) => {
      setBusyId(sessionId);
      setError("");
      try {
        const result = await wallet.claimSessionTimeout(CHAIN_ID, sessionId);
        if (result.code !== 0) {
          setError(result.rawLog || `the chain refused it (code ${result.code})`);
        }
        // The refund shows up in the balance the app polls anyway.
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId("");
        await refresh();
      }
    },
    [wallet, refresh]
  );

  if (sessions.length === 0) {
    return null;
  }

  return (
    <section className="card" data-testid="recovery">
      <div className="card-head">
        <IconAlert />
        <h2>Unfinished games</h2>
        <span className="right">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void refresh()}
            title="Refresh"
          >
            <IconRefresh />
          </button>
        </span>
      </div>

      {error && (
        <div className="card-body">
          <div className="notice notice-bad">{error}</div>
        </div>
      )}

      <div className="list">
        {sessions.map(({ session, recovery }) => {
          const waiting = recovery.kind === "wait";
          const blocks = recovery.atHeight - height;
          return (
            <div className="list-row" key={session.session_id}>
              <div className="list-main">
                <span className="list-title">
                  Session <span className="num">{session.session_id}</span>
                  <span className="faint">
                    {" "}
                    · {formatChip(session.stake)} at stake
                  </span>
                </span>
                <span className="faint tiny">
                  {recovery.reason}
                  {waiting && blocks > 0 && (
                    <>
                      {" "}
                      · about {blocks} block{blocks === 1 ? "" : "s"} to go
                    </>
                  )}
                </span>
              </div>
              <button
                className={`btn btn-sm right ${
                  waiting ? "btn-ghost" : "btn-primary"
                }`}
                disabled={waiting || busyId === session.session_id}
                onClick={() => void claim(session.session_id)}
                data-testid={`recover-${session.session_id}`}
              >
                {busyId === session.session_id ? (
                  <span className="spinner" />
                ) : recovery.kind === "escalate" ? (
                  "Send to adjudication"
                ) : (
                  "Refund"
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card-foot">
        A matched game escrows both stakes. These are the ones the chain will
        let you unwind — nobody else can do it for you.
      </div>
    </section>
  );
};
