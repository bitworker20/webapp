// Web client shell: risk gate -> key import -> the shared poker page.
//
// The only thing this file adds over the extension's entry point is key
// custody and the warnings that go with it. Everything below the bridge is the
// same code the extension runs (webapp/src/poker, aliased there as
// @bitpoker/poker-core).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PokerPage } from "./poker/page";
import { fetchUchipBalance } from "@bitpoker/poker-session/lobby";
import { formatChip, uchipLessThan } from "@bitpoker/poker-session/chip";
import { decryptArmoredPrivKey } from "./wallet/armor";
import { KeyHolder, deriveIdentity } from "./wallet/key-holder";
import {
  generateMnemonic,
  mnemonicToPrivKey,
  validateMnemonic,
} from "./wallet/mnemonic";
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
      <KeyImport keyHolder={keyHolder} onLoaded={setAddress} />
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
        endpointsFixed
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

type EntryTab = "create" | "recover" | "file";

const TABS: ReadonlyArray<{ id: EntryTab; label: string }> = [
  { id: "create", label: "Create account" },
  { id: "recover", label: "Recover" },
  { id: "file", label: "Key file" },
];

// Three ways in, and "create" is first on purpose: a browser visitor has no
// node, so telling them to run `pokerchaind keys export` was a dead end for
// everyone who did not already have the chain installed.
const KeyImport: React.FC<{
  keyHolder: KeyHolder;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, onLoaded }) => {
  const [tab, setTab] = useState<EntryTab>("create");

  return (
    <div style={styles.screen}>
      <div style={styles.panel}>
        <h1 style={{ marginTop: 0 }}>Get a testnet account</h1>
        <p style={{ opacity: 0.8 }}>
          The key is used here in your browser and never uploaded — but it does
          stay in this tab&apos;s memory until you clear it or close the tab.{" "}
          {DESKTOP_CLIENT_NOTE}
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={tab === id ? styles.primary : styles.secondary}
              data-testid={`tab-${id}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "create" && (
          <CreateAccount keyHolder={keyHolder} onLoaded={onLoaded} />
        )}
        {tab === "recover" && (
          <RecoverAccount keyHolder={keyHolder} onLoaded={onLoaded} />
        )}
        {tab === "file" && (
          <KeyFileImport keyHolder={keyHolder} onLoaded={onLoaded} />
        )}
      </div>
    </div>
  );
};

// A new account is empty, and there is no faucet, so say so here rather than
// let the player discover it at the lobby when every stake is unaffordable.
const FUNDING_NOTE =
  "A new account starts with no CHIP. Ask whoever runs this testnet to send some to the address above before you sit down.";

const CreateAccount: React.FC<{
  keyHolder: KeyHolder;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, onLoaded }) => {
  const [mnemonic, setMnemonic] = useState("");
  const [written, setWritten] = useState(false);
  const [error, setError] = useState("");

  // Derived, not stored: the address is a pure function of the words on screen,
  // and keeping it in state would be one more copy to clear.
  const address = useMemo(() => {
    if (!mnemonic) {
      return "";
    }
    try {
      const priv = mnemonicToPrivKey(mnemonic);
      const identity = deriveIdentity(priv, BECH32_PREFIX);
      priv.fill(0);
      return identity.bech32Address;
    } catch {
      return "";
    }
  }, [mnemonic]);

  const onGenerate = useCallback(() => {
    setError("");
    setWritten(false);
    setMnemonic(generateMnemonic());
  }, []);

  const onUse = useCallback(() => {
    setError("");
    try {
      const identity = keyHolder.load(mnemonicToPrivKey(mnemonic));
      setMnemonic("");
      onLoaded(identity.bech32Address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mnemonic, keyHolder, onLoaded]);

  return (
    <div>
      <p style={{ opacity: 0.8 }}>
        Creates a standard cosmos account (24 words, path{" "}
        <code>m/44&apos;/118&apos;/0&apos;/0/0</code>). The same words recover
        the same account in the desktop and mobile clients, in Keplr, and with{" "}
        <code>pokerchaind keys add --recover</code>.
      </p>

      {!mnemonic && (
        <button
          style={styles.primary}
          onClick={onGenerate}
          data-testid="create-generate"
        >
          Generate a new account
        </button>
      )}

      {mnemonic && (
        <>
          <p style={{ ...styles.error, opacity: 1 }}>
            Write these 24 words down now. They are not saved anywhere — close
            this tab without them and the account is gone for good.
          </p>
          <ol
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))",
              gap: "0.25rem 0.75rem",
              fontFamily: "monospace",
              background: "#0c0a09",
              borderRadius: 6,
              padding: "0.75rem 0.75rem 0.75rem 2.5rem",
            }}
            data-testid="create-mnemonic"
          >
            {mnemonic.split(" ").map((word, i) => (
              <li key={`${i}-${word}`}>{word}</li>
            ))}
          </ol>

          <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
            Address: <code data-testid="create-address">{address}</code>
          </div>
          <p style={{ opacity: 0.75, fontSize: "0.85rem" }}>{FUNDING_NOTE}</p>

          <label
            style={{ ...styles.field, display: "flex", gap: "0.5rem" }}
          >
            <input
              type="checkbox"
              checked={written}
              onChange={(e) => setWritten(e.target.checked)}
              data-testid="create-ack"
            />
            I have written down these 24 words
          </label>

          <div style={{ marginTop: "1.2rem", display: "flex", gap: "0.5rem" }}>
            <button
              style={{ ...styles.primary, opacity: written ? 1 : 0.5 }}
              onClick={onUse}
              disabled={!written}
              data-testid="create-use"
            >
              Use this account
            </button>
            <button style={styles.secondary} onClick={onGenerate}>
              Generate a different one
            </button>
          </div>
        </>
      )}

      {error && (
        <p style={styles.error} data-testid="key-error">
          {error}
        </p>
      )}
    </div>
  );
};

const RecoverAccount: React.FC<{
  keyHolder: KeyHolder;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, onLoaded }) => {
  const [mnemonic, setMnemonic] = useState("");
  const [error, setError] = useState("");

  // Previewing the address before committing turns "wrong account" from a
  // discovery at the lobby into something the player sees while typing.
  const preview = useMemo(() => {
    if (!validateMnemonic(mnemonic)) {
      return "";
    }
    try {
      const priv = mnemonicToPrivKey(mnemonic);
      const identity = deriveIdentity(priv, BECH32_PREFIX);
      priv.fill(0);
      return identity.bech32Address;
    } catch {
      return "";
    }
  }, [mnemonic]);

  const onRecover = useCallback(() => {
    setError("");
    try {
      const identity = keyHolder.load(mnemonicToPrivKey(mnemonic));
      setMnemonic("");
      onLoaded(identity.bech32Address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mnemonic, keyHolder, onLoaded]);

  return (
    <div>
      <p style={{ opacity: 0.8 }}>
        Paste the 12 or 24 words from another BitPoker client, Keplr, or{" "}
        <code>pokerchaind keys add</code>. Spacing and capitalisation do not
        matter.
      </p>

      <label style={styles.field}>
        Recovery phrase
        <textarea
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          rows={3}
          style={{ ...styles.input, fontFamily: "monospace" }}
          data-testid="recover-mnemonic"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.8 }}>
        {preview ? (
          <>
            Account: <code data-testid="recover-address">{preview}</code>
          </>
        ) : (
          "Enter a valid recovery phrase to see its address."
        )}
      </div>

      <div style={{ marginTop: "1.2rem" }}>
        <button
          style={{ ...styles.primary, opacity: preview ? 1 : 0.5 }}
          onClick={onRecover}
          disabled={!preview}
          data-testid="recover-use"
        >
          Recover account
        </button>
      </div>

      {error && (
        <p style={styles.error} data-testid="key-error">
          {error}
        </p>
      )}
    </div>
  );
};

const KeyFileImport: React.FC<{
  keyHolder: KeyHolder;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, onLoaded }) => {
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
    <div>
      <p style={{ opacity: 0.8 }}>
        Export one from a node with{" "}
        <code>pokerchaind keys export &lt;name&gt;</code> and save the output to
        a file.
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
  );
};
