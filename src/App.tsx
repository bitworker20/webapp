// The web client: risk gate -> account -> a wallet that can also play poker.
//
// Everything the app needs that outlives a screen lives here — the key holder,
// the wallet bridge, the balance poll and the game session — so switching
// between the wallet and the table never interrupts a hand.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchUchipBalance } from "@bitpoker/poker-session/lobby";
import { uchipLessThan } from "@bitpoker/poker-session/chip";
import { fetchNodeGasPrice } from "@bitpoker/poker-session/fees";
import { KeyHolder } from "./wallet/key-holder";
import {
  BrowserKeyBridge,
  IntentApprovalRequest,
} from "./wallet/browser-key-bridge";
import { usePokerSession } from "./poker/session";
import {
  BECH32_PREFIX,
  DEFAULT_LCD_URL,
  OVERFUNDED_WARNING_UCHIP,
} from "./config";
import { AccountEntry, RiskGate } from "./ui/onboarding";
import {
  IntentApproval,
  Nav,
  TestnetBanner,
  TopBar,
  ViewId,
} from "./ui/shell";
import { WalletView } from "./ui/wallet-view";
import { PlayView } from "./ui/play-view";
import { TableView } from "./ui/table-view";
import { ActivityView } from "./ui/activity-view";
import { SettingsView } from "./ui/settings-view";
import "./app.css";

interface PendingApproval {
  request: IntentApprovalRequest;
  decide: (approved: boolean) => void;
}

const TITLES: Record<ViewId | "table", string> = {
  play: "Play",
  table: "Table",
  wallet: "Wallet",
  activity: "Activity",
  settings: "Settings",
};

export const App: React.FC = () => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [address, setAddress] = useState("");

  const keyHolder = useMemo(() => new KeyHolder(BECH32_PREFIX), []);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();
  const wallet = useMemo(
    () =>
      new BrowserKeyBridge({
        keyHolder,
        lcdUrl: DEFAULT_LCD_URL,
        // Resolved by the modal's buttons.
        onApproveIntent: (request) =>
          new Promise<boolean>((resolve) => {
            setPendingApproval({
              request,
              decide: (approved) => {
                setPendingApproval(undefined);
                resolve(approved);
              },
            });
          }),
      }),
    [keyHolder]
  );

  if (!acknowledged) {
    return <RiskGate onAccept={() => setAcknowledged(true)} />;
  }
  if (!address) {
    return <AccountEntry keyHolder={keyHolder} onLoaded={setAddress} />;
  }
  return (
    <>
      <SignedIn
        wallet={wallet}
        address={address}
        onClearKey={() => {
          keyHolder.unload();
          setAddress("");
        }}
      />
      {pendingApproval && (
        <IntentApproval
          request={pendingApproval.request}
          onDecide={pendingApproval.decide}
        />
      )}
    </>
  );
};

const SignedIn: React.FC<{
  wallet: BrowserKeyBridge;
  address: string;
  onClearKey: () => void;
}> = ({ wallet, address, onClearKey }) => {
  const [view, setView] = useState<ViewId>("play");
  const [atTable, setAtTable] = useState(false);
  const [playerName, setPlayerName] = useState("WebPlayer");
  const [balanceUchip, setBalanceUchip] = useState("");
  const [reachable, setReachable] = useState(true);
  const [gasPrice, setGasPrice] = useState<string>();
  // Bumped whenever something should have changed the account's history.
  const [ledgerKey, setLedgerKey] = useState(0);

  const session = usePokerSession(wallet);

  // Balance poll: the one number every screen shows, so it is polled once here
  // rather than by each of them.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const balance = await fetchUchipBalance(DEFAULT_LCD_URL, address);
        if (alive) {
          setBalanceUchip(balance);
          setReachable(true);
        }
      } catch {
        if (alive) {
          setReachable(false);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [address, ledgerKey]);

  // What the node charges, for the settings screen. The send flow asks again
  // per transfer; this is only to show the player what they are paying.
  useEffect(() => {
    let alive = true;
    void fetchNodeGasPrice(DEFAULT_LCD_URL, "uchip").then((price) => {
      if (alive) {
        setGasPrice(
          price
            ? price.amount === "0"
              ? "free (node charges nothing)"
              : `${price.amount} ${price.denom} / gas`
            : "not advertised by this node"
        );
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // A finished session is worth a history refresh: the settlement moved money.
  const stage = session.snapshot.stage;
  useEffect(() => {
    if (["done", "disputed"].includes(stage)) {
      setLedgerKey((n) => n + 1);
    }
  }, [stage]);

  const goPlay = useCallback(() => {
    setView("play");
    setAtTable(true);
  }, []);

  const leaveTable = useCallback(() => {
    session.clear();
    setAtTable(false);
  }, [session]);

  const overFunded =
    balanceUchip !== "" &&
    !uchipLessThan(balanceUchip, OVERFUNDED_WARNING_UCHIP);

  // The table takes over the Play slot while a session is live, so a player
  // cannot wander back to the lobby and open a second intent mid-hand.
  const showTable = view === "play" && (atTable || session.active);

  return (
    <div className="shell">
      <Nav
        view={view}
        onView={(next) => {
          setView(next);
          if (next === "play" && session.active) {
            setAtTable(true);
          }
        }}
        gameLive={session.busy}
      />
      <div className="main">
        <TestnetBanner overFunded={overFunded} onClearKey={onClearKey} />
        <TopBar
          title={TITLES[showTable ? "table" : view]}
          address={address}
          balanceUchip={balanceUchip}
          chainReachable={reachable}
        >
          {showTable && !session.busy && (
            <button className="btn btn-ghost btn-sm" onClick={leaveTable}>
              Leave table
            </button>
          )}
        </TopBar>

        {showTable ? (
          <TableView session={session} onLeave={leaveTable} />
        ) : view === "play" ? (
          <PlayView
            session={session}
            address={address}
            playerName={playerName}
            balanceUchip={balanceUchip}
            onEnterTable={goPlay}
          />
        ) : view === "wallet" ? (
          <WalletView
            wallet={wallet}
            address={address}
            balanceUchip={balanceUchip}
            onSent={() => setLedgerKey((n) => n + 1)}
          />
        ) : view === "activity" ? (
          <ActivityView address={address} reloadKey={ledgerKey} />
        ) : (
          <SettingsView
            session={session}
            wallet={wallet}
            playerName={playerName}
            onPlayerName={setPlayerName}
            onClearKey={onClearKey}
            gasPrice={gasPrice}
          />
        )}
      </div>
    </div>
  );
};
