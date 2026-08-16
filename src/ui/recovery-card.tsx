// Sessions that stopped moving, and the one button that gets the money out.
//
// A matched session escrows both stakes. If the opponent never shows, or no
// relay ever takes the game, or the opponent never confirms a result, the
// stake sits there until somebody claims the timeout — and only the two
// players may. Without this card the player can see the money is gone and do
// nothing about it, which is the worst possible combination.
//
// A disputed session is the same problem one step further along: it needs a
// secret reveal and then an adjudication, and until the dispute deadline
// nobody but the two players can send either. The button changes verb; the
// promise it makes is the same one.
import React, { useCallback, useEffect, useState } from "react";
import { formatChip } from "@bitpoker/poker-session/chip";
import { fetchChainHeight } from "@bitpoker/poker-session/lobby";
import {
  RecoverableSession,
  RecoveryAction,
  fetchRecoverableSessions,
} from "@bitpoker/poker-session/recovery";
import {
  forgetSessionIdentity,
  sessionIdentityForIntent,
} from "@bitpoker/poker-session/session-vault";
import { BrowserKeyBridge } from "../wallet/browser-key-bridge";
import { CHAIN_ID, DEFAULT_LCD_URL } from "../config";
import { IconAlert, IconRefresh } from "./icons";

const ACTION_LABELS: Record<RecoveryAction, string> = {
  refund: "Refund",
  escalate: "Send to adjudication",
  reveal: "Reveal your cards",
  adjudicate: "Ask for a verdict",
};

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

  // One button, four messages. Which one is the chain's decision — see
  // @bitpoker/poker-session/recovery — this only carries it out.
  const run = useCallback(
    async (action: RecoveryAction, sessionId: string, intentId?: string) => {
      if (action === "reveal") {
        const identity = intentId
          ? sessionIdentityForIntent(intentId)
          : undefined;
        if (!identity) {
          throw new Error(
            "this browser no longer holds the secret for that session"
          );
        }
        return wallet.submitSecret(CHAIN_ID, {
          sessionId,
          secretKeyHex: identity.secretKeyHex,
          pubkeyHex: identity.pubkeyHex,
        });
      }
      if (action === "adjudicate") {
        return wallet.adjudicateSession(CHAIN_ID, sessionId);
      }
      return wallet.claimSessionTimeout(CHAIN_ID, sessionId);
    },
    [wallet]
  );

  const claim = useCallback(
    async ({ session, recovery, intentId }: RecoverableSession) => {
      const sessionId = session.session_id;
      setBusyId(sessionId);
      setError("");
      try {
        const result = await run(recovery.action, sessionId, intentId);
        if (result.code !== 0) {
          setError(
            result.rawLog || `the chain refused it (code ${result.code})`
          );
        } else if (recovery.action === "reveal" && intentId) {
          // On chain now, so the next poll offers the verdict instead. Keeping
          // it would also offer to reveal it again forever.
          forgetSessionIdentity(intentId);
        }
        // A refund or a payout shows up in the balance the app polls anyway.
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId("");
        await refresh();
      }
    },
    [run, refresh]
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
        {sessions.map((entry) => {
          const { session, recovery } = entry;
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
                onClick={() => void claim(entry)}
                data-testid={`recover-${session.session_id}`}
              >
                {busyId === session.session_id ? (
                  <span className="spinner" />
                ) : (
                  ACTION_LABELS[recovery.action]
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card-foot">
        A matched game escrows both stakes. These are the ones the chain will
        let you unwind — nobody else can do it for you. A verdict scores each
        seat on the cards it revealed, so reveal before you ask for one.
      </div>
    </section>
  );
};
