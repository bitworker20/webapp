// Web client shell: risk gate -> key import -> the shared poker page.
//
// The only thing this file adds over the extension's entry point is key
// custody and the warnings that go with it. Everything below the bridge is the
// same code the extension runs (webapp/src/poker, aliased there as
// @bitpoker/poker-core).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PokerPage } from "./poker/page";
import { fetchUchipBalance } from "./poker/lobby";
import { formatChip, uchipLessThan } from "./poker/chip";
import { decryptArmoredPrivKey } from "./wallet/armor";
import { KeyHolder } from "./wallet/key-holder";
import {
  BrowserKeyBridge,
  IntentApprovalRequest,
} from "./wallet/browser-key-bridge";
import {
  BECH32_PREFIX,
  CHAIN_ID,
  DEFAULT_LCD_URL,
  DEFAULT_RELAY_URL,
  OVERFUNDED_WARNING_UCHIP,
} from "./config";
import {
  DESKTOP_CLIENT_NOTE,
  IntentApproval,
  RiskGate,
  TestnetBanner,
  styles,
} from "./ui/chrome";

interface PendingApproval {
  request: IntentApprovalRequest;
  decide: (approved: boolean) => void;
}

export const App: React.FC = () => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [address, setAddress] = useState("");
  const [lcdUrl, setLcdUrl] = useState(DEFAULT_LCD_URL);
  const [balanceUchip, setBalanceUchip] = useState("");
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();

  const keyHolder = useMemo(() => new KeyHolder(BECH32_PREFIX), []);
  const wallet = useMemo(
    () =>
      new BrowserKeyBridge({
        keyHolder,
        lcdUrl: DEFAULT_LCD_URL,
        // Resolve the promise from the modal's buttons.
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

  // The page owns the LCD field; keep the bridge's broadcast endpoint on it.
  useEffect(() => {
    wallet.setLcdUrl(lcdUrl);
  }, [wallet, lcdUrl]);

  useEffect(() => {
    if (!address) {
      setBalanceUchip("");
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const balance = await fetchUchipBalance(lcdUrl, address);
        if (alive) {
          setBalanceUchip(balance);
        }
      } catch {
        if (alive) {
          setBalanceUchip("");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [address, lcdUrl]);

  const onClearKey = useCallback(() => {
    keyHolder.unload();
    setAddress("");
  }, [keyHolder]);

  if (!acknowledged) {
    return <RiskGate onAccept={() => setAcknowledged(true)} />;
  }

  if (!address) {
    return (
      <KeyImport
        keyHolder={keyHolder}
        lcdUrl={lcdUrl}
        onLcdUrl={setLcdUrl}
        onLoaded={setAddress}
      />
    );
  }

  const overFunded =
    balanceUchip !== "" &&
    !uchipLessThan(balanceUchip, OVERFUNDED_WARNING_UCHIP);

  return (
    <>
      <PokerPage
        wallet={wallet}
        chainId={CHAIN_ID}
        defaults={{
          lcdUrl,
          relayUrl: DEFAULT_RELAY_URL,
          playerName: "WebPlayer",
        }}
        onLcdUrlChange={setLcdUrl}
        banner={
          <TestnetBanner
            address={address}
            balanceLabel={
              balanceUchip === "" ? undefined : `${formatChip(balanceUchip)} CHIP`
            }
            overFunded={overFunded}
            onClearKey={onClearKey}
          />
        }
      />
      {pendingApproval && (
        <IntentApproval
          request={pendingApproval.request}
          formatStake={(uchip) => `${formatChip(uchip)} CHIP`}
          onDecide={pendingApproval.decide}
        />
      )}
    </>
  );
};

const KeyImport: React.FC<{
  keyHolder: KeyHolder;
  lcdUrl: string;
  onLcdUrl: (url: string) => void;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, lcdUrl, onLcdUrl, onLoaded }) => {
  const [armor, setArmor] = useState("");
  const [fileName, setFileName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setArmor(await file.text());
    setFileName(file.name);
    setError("");
  }, []);

  const onImport = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      // argon2id takes ~0.5s and blocks this thread; yield once so the button
      // repaints as disabled. Moving it to a worker is a follow-up.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { privKey } = decryptArmoredPrivKey(armor, passphrase);
      const identity = keyHolder.load(privKey);
      // Do not keep the passphrase or the armored blob around after use.
      setPassphrase("");
      setArmor("");
      onLoaded(identity.bech32Address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [armor, passphrase, keyHolder, onLoaded]);

  return (
    <div style={styles.screen}>
      <div style={styles.panel}>
        <h1 style={{ marginTop: 0 }}>Load a testnet key</h1>
        <p style={{ opacity: 0.8 }}>
          Export one from a node with{" "}
          <code>pokerchaind keys export &lt;name&gt;</code> and save the output
          to a file. It is decrypted here in your browser and never uploaded —
          but it does stay in this tab&apos;s memory until you clear it or close
          the tab. {DESKTOP_CLIENT_NOTE}
        </p>

        <label style={styles.field}>
          Key file
          <input
            type="file"
            accept=".txt,.asc,.key,text/plain"
            onChange={(e) => void onFile(e.target.files?.[0])}
            style={styles.input}
            data-testid="key-file"
          />
        </label>
        {fileName && (
          <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
            loaded <code>{fileName}</code>
          </div>
        )}

        <label style={styles.field}>
          Passphrase
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            style={styles.input}
            data-testid="key-passphrase"
          />
        </label>

        <label style={styles.field}>
          Node REST (LCD) endpoint
          <input
            type="text"
            value={lcdUrl}
            onChange={(e) => onLcdUrl(e.target.value)}
            style={styles.input}
          />
        </label>

        <div style={{ marginTop: "1.2rem" }}>
          <button
            style={{ ...styles.primary, opacity: busy || !armor ? 0.5 : 1 }}
            onClick={() => void onImport()}
            disabled={busy || !armor}
            data-testid="key-import"
          >
            {busy ? "Decrypting…" : "Load key"}
          </button>
        </div>

        {error && (
          <p style={styles.error} data-testid="key-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
