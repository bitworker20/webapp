// The app frame: navigation, the account strip, and the two things that
// interrupt everything else — the testnet banner and the intent approval.
import React, { useCallback, useEffect, useState } from "react";
import {
  formatChip,
  shortAddress,
  uchipToChip,
} from "@bitpoker/poker-session/chip";
import { IntentApprovalRequest } from "../wallet/browser-key-bridge";
import { DESKTOP_CLIENT_NOTE } from "../config";
import {
  IconActivity,
  IconAlert,
  IconCards,
  IconCheck,
  IconCopy,
  IconSettings,
  IconWallet,
} from "./icons";

export type ViewId = "wallet" | "play" | "activity" | "settings";

export const VIEWS: ReadonlyArray<{
  id: ViewId;
  label: string;
  icon: React.FC<{ size?: number }>;
}> = [
  { id: "play", label: "Play", icon: IconCards },
  { id: "wallet", label: "Wallet", icon: IconWallet },
  { id: "activity", label: "Activity", icon: IconActivity },
  { id: "settings", label: "Settings", icon: IconSettings },
];

export const Nav: React.FC<{
  view: ViewId;
  onView: (view: ViewId) => void;
  gameLive: boolean;
}> = ({ view, onView, gameLive }) => (
  <nav className="nav">
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        ♠
      </span>
      BitPoker
    </div>
    {VIEWS.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        className="nav-item"
        aria-current={view === id ? "page" : undefined}
        onClick={() => onView(id)}
        data-testid={`nav-${id}`}
      >
        <span className="nav-icon">
          <Icon />
        </span>
        <span>{label}</span>
        {id === "play" && gameLive && (
          <span className="nav-badge" title="a hand is in progress">
            live
          </span>
        )}
      </button>
    ))}
    <div className="nav-foot">
      Testnet client. {DESKTOP_CLIENT_NOTE}
    </div>
  </nav>
);

export const TopBar: React.FC<{
  title: string;
  address: string;
  balanceUchip: string;
  chainReachable: boolean;
  children?: React.ReactNode;
}> = ({ title, address, balanceUchip, chainReachable, children }) => (
  <header className="topbar">
    <span className="topbar-title">{title}</span>
    <span className="topbar-spacer" />
    {children}
    <span
      className={`pill ${chainReachable ? "pill-accent" : "pill-bad"}`}
      title={chainReachable ? "node reachable" : "cannot reach the node"}
      data-testid="chain-pill"
    >
      <span className={`dot ${chainReachable ? "dot-live" : ""}`} />
      {chainReachable ? "on chain" : "offline"}
    </span>
    <span className="pill num" data-testid="topbar-balance">
      {balanceUchip === "" ? "— CHIP" : formatChip(balanceUchip)}
    </span>
    <CopyButton value={address} label={shortAddress(address)} />
  </header>
);

export const CopyButton: React.FC<{
  value: string;
  label?: string;
  className?: string;
}> = ({ value, label, className }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions). The
      // address is on screen either way, so this is not worth an error.
    }
  }, [value]);

  return (
    <button
      className={className ?? "btn btn-ghost btn-sm"}
      onClick={() => void onCopy()}
      title={value}
      data-address={value}
      data-testid="copy-address"
    >
      {copied ? <IconCheck /> : <IconCopy />}
      <span className="mono">{copied ? "copied" : label ?? value}</span>
    </button>
  );
};

// Not dismissible, and always at the top of the app rather than on one screen:
// the key is in this tab for as long as the tab is open.
export const TestnetBanner: React.FC<{
  overFunded: boolean;
  onClearKey: () => void;
}> = ({ overFunded, onClearKey }) => (
  <div className={`banner ${overFunded ? "banner-bad" : ""}`} data-testid="testnet-banner">
    <IconAlert />
    {overFunded ? (
      <span>
        <b>This account holds more than this client is meant for.</b> Move the
        balance to a wallet that keeps its key outside the browser.
      </span>
    ) : (
      <span>
        Testnet client — the key lives in this tab. {DESKTOP_CLIENT_NOTE}
      </span>
    )}
    <span className="topbar-spacer" />
    <button className="btn btn-ghost btn-sm" onClick={onClearKey}>
      Clear key
    </button>
  </div>
);

// The one transaction that locks funds. A confirmation, not a security
// boundary — see the note at the top of browser-key-bridge.ts.
export const IntentApproval: React.FC<{
  request: IntentApprovalRequest;
  onDecide: (approved: boolean) => void;
}> = ({ request, onDecide }) => {
  const range =
    request.minStake === request.maxStake
      ? formatChip(request.minStake)
      : `${uchipToChip(request.minStake)} – ${formatChip(request.maxStake)}`;

  return (
    <div className="scrim" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2>Open a game intent</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            This transaction escrows your stake until the session settles.
          </p>
        </div>
        <div className="modal-body">
          <dl className="kv">
            <dt>Game</dt>
            <dd>{request.gameType === 2 ? "ZhaJinHua" : "Texas Hold'em"}</dd>
            <dt>Stake</dt>
            <dd className="num">{range}</dd>
            <dt>Opponent</dt>
            <dd className="mono small">
              {request.opponent && request.opponent !== "ANY"
                ? request.opponent
                : "anyone (open match)"}
            </dd>
            <dt>Chain</dt>
            <dd className="small">{request.chainId}</dd>
          </dl>
        </div>
        <div className="modal-foot">
          <button
            className="btn btn-ghost"
            onClick={() => onDecide(false)}
            data-testid="intent-reject"
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onDecide(true)}
            data-testid="intent-approve"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
};
