// Settings, plus the diagnostics the browser smoke test drives.
//
// There is no endpoint field: on a deployed page the node is the publisher's
// choice, not the player's, because a node someone was talked into pasting can
// lie about balances, session state and relay assignments. It is shown here
// read-only so a player can at least see where their client is pointed.
import React, { useState } from "react";
import { PokerSession } from "../poker/session";
import { BrowserKeyBridge } from "../wallet/browser-key-bridge";
import {
  CHAIN_ID,
  DEFAULT_LCD_URL,
  DEFAULT_RELAY_URL,
  DESKTOP_CLIENT_NOTE,
} from "../config";
import { IconSettings } from "./icons";

export const SettingsView: React.FC<{
  session: PokerSession;
  wallet: BrowserKeyBridge;
  playerName: string;
  onPlayerName: (name: string) => void;
  onClearKey: () => void;
  gasPrice?: string;
}> = ({
  session,
  wallet,
  playerName,
  onPlayerName,
  onClearKey,
  gasPrice,
}) => (
  <div className="page grid grid-2">
    <section className="card">
      <div className="card-head">
        <IconSettings />
        <h2>Client</h2>
      </div>
      <div className="card-body col">
        <label className="field">
          <span className="label">Display name at the table</span>
          <input
            className="input"
            value={playerName}
            onChange={(e) => onPlayerName(e.target.value)}
            maxLength={32}
            data-testid="player-name"
          />
          <span className="hint">
            Shown to your opponent. It is not an identity — the chain knows you
            by your address.
          </span>
        </label>

        <div className="divider" />

        <dl className="kv small">
          <dt>Chain</dt>
          <dd className="mono">{CHAIN_ID}</dd>
          <dt>Node</dt>
          <dd className="mono ellipsis">{DEFAULT_LCD_URL}</dd>
          <dt>Relay</dt>
          <dd className="mono ellipsis">{DEFAULT_RELAY_URL}</dd>
          <dt>Gas price</dt>
          <dd className="num" data-testid="gas-price">
            {gasPrice ?? "asking the node…"}
          </dd>
        </dl>
        <span className="faint tiny">
          Endpoints come from the deployment, not from this page. The gas price
          is read from the node itself, per transaction.
        </span>
      </div>
    </section>

    <div className="col" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head">
          <h2>Key</h2>
        </div>
        <div className="card-body col">
          <p className="muted small" style={{ margin: 0 }}>
            The key is in this tab&apos;s memory. Clearing it — or closing the
            tab — removes it; you will need the recovery phrase or key file to
            come back. {DESKTOP_CLIENT_NOTE}
          </p>
          <button
            className="btn btn-danger"
            onClick={onClearKey}
            disabled={session.busy}
            title={
              session.busy ? "finish or leave the current session first" : ""
            }
          >
            Clear the key from this tab
          </button>
        </div>
      </section>

      <Diagnostics session={session} wallet={wallet} />
    </div>
  </div>
);

// Dev/e2e diagnostics: the gamecore self-test in the worker, and a raw sign
// round-trip through the wallet bridge. The browser smoke test keys off
// data-testid="selftest".
const Diagnostics: React.FC<{
  session: PokerSession;
  wallet: BrowserKeyBridge;
}> = ({ session, wallet }) => {
  const [selfTest, setSelfTest] = useState("");
  const [sign, setSign] = useState("");

  return (
    <section className="card">
      <div className="card-head">
        <h2>Diagnostics</h2>
        <span className="sub right">gamecore + signing</span>
      </div>
      <div className="card-body col">
        <div className="row">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSelfTest("running…");
              session
                .runSelfTest()
                .then(setSelfTest)
                .catch((e) => setSelfTest(`ERROR: ${e.message}`));
            }}
          >
            Run gamecore selfTest
          </button>
          <span
            className={`tiny ${selfTest.startsWith("OK") ? "ok" : "bad"}`}
            data-testid="selftest"
          >
            {selfTest}
          </span>
        </div>

        <div className="row">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSign("signing…");
              wallet
                .signPayload(
                  CHAIN_ID,
                  "bitpoker-relay-client-hello-v1\npoker-page-test"
                )
                .then((res) =>
                  setSign(`OK ${res.signature.length / 2} bytes`)
                )
                .catch((e) => setSign(`ERROR: ${e.message ?? e}`));
            }}
          >
            Test raw sign
          </button>
          <span className={`tiny ${sign.startsWith("OK") ? "ok" : "bad"}`}>
            {sign}
          </span>
        </div>
      </div>
      <div className="card-foot">
        Card faces: Vector Playing Cards 3.2 by Chris Aguilar, licensed under
        LGPL-3.0.
      </div>
    </section>
  );
};
