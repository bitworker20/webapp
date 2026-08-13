// The web client's own chrome: the pieces that exist because this client holds
// the key in page memory. None of it is a security control — the point is that
// a player is never more than one glance away from knowing what they are using
// and what it is safe to put in it.
import React from "react";

export const DESKTOP_CLIENT_NOTE =
  "For real funds use the desktop or mobile client, where the key lives outside the browser.";

const palette = {
  warnBg: "#7c2d12",
  warnBorder: "#c2410c",
  dangerBg: "#7f1d1d",
  text: "#fff7ed",
  panel: "#1c1917",
  panelBorder: "#44403c",
};

export const styles = {
  screen: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#e7e5e4",
    background: "#0c0a09",
    minHeight: "100vh",
    margin: 0,
    padding: "1.5rem",
    boxSizing: "border-box",
  } as React.CSSProperties,
  panel: {
    maxWidth: "38rem",
    margin: "0 auto",
    background: palette.panel,
    border: `1px solid ${palette.panelBorder}`,
    borderRadius: 10,
    padding: "1.5rem",
  } as React.CSSProperties,
  field: { display: "block", marginTop: "1rem" } as React.CSSProperties,
  input: {
    display: "block",
    width: "100%",
    marginTop: "0.35rem",
    padding: "0.5rem",
    borderRadius: 6,
    border: `1px solid ${palette.panelBorder}`,
    background: "#0c0a09",
    color: "#e7e5e4",
    boxSizing: "border-box",
  } as React.CSSProperties,
  primary: {
    padding: "0.55rem 1.1rem",
    borderRadius: 6,
    border: "none",
    background: "#c2410c",
    color: palette.text,
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,
  secondary: {
    padding: "0.55rem 1.1rem",
    borderRadius: 6,
    border: `1px solid ${palette.panelBorder}`,
    background: "transparent",
    color: "#e7e5e4",
    cursor: "pointer",
  } as React.CSSProperties,
  error: { color: "#fca5a5", marginTop: "1rem" } as React.CSSProperties,
};

// Always on screen while a key is loaded.
export const TestnetBanner: React.FC<{
  address: string;
  balanceLabel?: string;
  overFunded: boolean;
  onClearKey: () => void;
}> = ({ address, balanceLabel, overFunded, onClearKey }) => (
  <div
    style={{
      background: overFunded ? palette.dangerBg : palette.warnBg,
      border: `1px solid ${overFunded ? "#b91c1c" : palette.warnBorder}`,
      color: palette.text,
      borderRadius: 8,
      padding: "0.6rem 0.9rem",
      marginBottom: "1rem",
      display: "flex",
      flexWrap: "wrap",
      gap: "0.5rem",
      alignItems: "center",
      justifyContent: "space-between",
    }}
    data-testid="testnet-banner"
  >
    <div>
      <strong>Testnet key held in this browser tab.</strong>{" "}
      {overFunded
        ? "This account holds more than this client is meant for — move funds out."
        : DESKTOP_CLIENT_NOTE}
      <div style={{ fontSize: "0.8rem", opacity: 0.85, marginTop: "0.2rem" }}>
        <code>{address}</code>
        {balanceLabel ? ` · ${balanceLabel}` : ""}
      </div>
    </div>
    <button style={styles.secondary} onClick={onClearKey}>
      Clear key
    </button>
  </div>
);

// Shown once, before the import form is reachable.
export const RiskGate: React.FC<{ onAccept: () => void }> = ({ onAccept }) => {
  const [acknowledged, setAcknowledged] = React.useState(false);
  return (
    <div style={styles.screen}>
      <div style={styles.panel}>
        <h1 style={{ marginTop: 0 }}>BitPoker web client</h1>
        <p>
          This client decrypts your key inside this web page and keeps it in the
          tab&apos;s memory while you play. That is weaker than the desktop,
          mobile and extension clients, and the difference is not something we
          can engineer away in a web page:
        </p>
        <ul style={{ lineHeight: 1.6 }}>
          <li>
            Any code that runs on this origin can read the key — that includes a
            compromised dependency, a cross-site scripting bug, and browser
            extensions you have installed.
          </li>
          <li>
            Whoever controls the server or the domain controls the code your
            browser runs, and could serve a version that steals the key without
            leaving a trace.
          </li>
          <li>
            While a game is open, a compromised page can also act as you — make
            losing moves or mishandle a dispute — without needing the key at
            all.
          </li>
        </ul>
        <p>
          <strong>
            Use a throwaway testnet account holding only what you can afford to
            lose.
          </strong>{" "}
          {DESKTOP_CLIENT_NOTE}
        </p>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            data-testid="risk-ack"
          />
          I understand, and this is a testnet account with small stakes.
        </label>
        <div style={{ marginTop: "1.2rem" }}>
          <button
            style={{ ...styles.primary, opacity: acknowledged ? 1 : 0.5 }}
            disabled={!acknowledged}
            onClick={onAccept}
            data-testid="risk-continue"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export interface IntentApprovalProps {
  request: {
    signer: string;
    chainId: string;
    gameType: number;
    minStake: string;
    maxStake: string;
    opponent: string;
  };
  formatStake: (uchip: string) => string;
  onDecide: (approved: boolean) => void;
}

// The one confirmation in the flow: opening an intent escrows the stake when
// it matches. Every other transaction in a session releases or defends escrow
// already at risk and runs against a protocol deadline, so prompting there
// would forfeit hands.
export const IntentApproval: React.FC<IntentApprovalProps> = ({
  request,
  formatStake,
  onDecide,
}) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "1rem",
      zIndex: 10,
    }}
    data-testid="intent-approval"
  >
    <div style={{ ...styles.panel, maxWidth: "26rem" }}>
      <h2 style={{ marginTop: 0 }}>Lock funds for a game?</h2>
      <p>
        Opening this game intent escrows your stake on chain as soon as an
        opponent matches it.
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.4rem 1rem" }}>
        <dt style={{ opacity: 0.7 }}>Game</dt>
        <dd style={{ margin: 0 }}>
          {request.gameType === 2 ? "ZhaJinHua" : "Texas Hold'em"}
        </dd>
        <dt style={{ opacity: 0.7 }}>Stake</dt>
        <dd style={{ margin: 0 }}>
          {request.minStake === request.maxStake
            ? formatStake(request.minStake)
            : `${formatStake(request.minStake)} – ${formatStake(request.maxStake)}`}
        </dd>
        <dt style={{ opacity: 0.7 }}>Opponent</dt>
        <dd style={{ margin: 0 }}>
          {request.opponent ? <code>{request.opponent}</code> : "anyone"}
        </dd>
        <dt style={{ opacity: 0.7 }}>From</dt>
        <dd style={{ margin: 0, wordBreak: "break-all" }}>
          <code>{request.signer}</code>
        </dd>
      </dl>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.2rem" }}>
        <button
          style={styles.primary}
          onClick={() => onDecide(true)}
          data-testid="intent-approve"
        >
          Approve
        </button>
        <button style={styles.secondary} onClick={() => onDecide(false)}>
          Reject
        </button>
      </div>
    </div>
  </div>
);
