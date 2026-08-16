// Everything before the app: the testnet warning, and the three ways to get
// an account into this tab.
//
// The data-testid attributes here are the browser smoke test's grip on the
// page (tests/smoke.e2e.mjs) — keep them when restyling.
import React, { useCallback, useMemo, useState } from "react";
import { decryptArmoredPrivKey } from "../wallet/armor";
import { KeyHolder, deriveIdentity } from "../wallet/key-holder";
import {
  generateMnemonic,
  mnemonicToPrivKey,
  validateMnemonic,
} from "../wallet/mnemonic";
import { faucetConfigured } from "../wallet/faucet";
import { BECH32_PREFIX, DESKTOP_CLIENT_NOTE } from "../config";
import { IconAlert } from "./icons";

export const RiskGate: React.FC<{ onAccept: () => void }> = ({ onAccept }) => {
  const [ack, setAck] = useState(false);
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-mark" aria-hidden="true">
          ♠
        </div>
        <h1>BitPoker</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Heads-up Texas Hold&apos;em and ZhaJinHua against a real opponent,
          with the shuffle, the settlement and the disputes on chain.
        </p>

        <div className="notice notice-warn" style={{ margin: "18px 0 14px" }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <IconAlert />
            <b>Testnet and small stakes only</b>
          </div>
          This page holds your private key in the tab&apos;s memory to sign
          plays fast enough for a live hand. Anything that can run code on this
          origin — a bad script, a bad extension, a tampered deployment — can
          read it. {DESKTOP_CLIENT_NOTE}
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            data-testid="risk-ack"
          />
          <span className="small muted">
            I understand, and I will only use an account funded with testnet
            coins I can afford to lose.
          </span>
        </label>

        <button
          className="btn btn-primary btn-lg btn-block"
          style={{ marginTop: 18 }}
          disabled={!ack}
          onClick={onAccept}
          data-testid="risk-continue"
        >
          Continue
        </button>
      </div>
    </div>
  );
};

type EntryTab = "create" | "recover" | "file";

const TABS: ReadonlyArray<{ id: EntryTab; label: string }> = [
  { id: "create", label: "Create" },
  { id: "recover", label: "Recover" },
  { id: "file", label: "Key file" },
];

export const AccountEntry: React.FC<{
  keyHolder: KeyHolder;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, onLoaded }) => {
  const [tab, setTab] = useState<EntryTab>("create");

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>Get an account</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          Used in this tab only, never uploaded — but it stays in memory until
          you clear it or close the tab.
        </p>

        <div className="tabs" role="tablist" style={{ marginTop: 18 }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
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

// A new account is empty, so say where chips come from here rather than let
// the player discover it at the lobby when every stake is unaffordable.
const FUNDING_NOTE = faucetConfigured()
  ? "A new account starts with no CHIP. The wallet page has a faucet — have the invitation code you were sent ready."
  : "A new account starts with no CHIP. Ask whoever runs this testnet to send some to the address above before you sit down.";

const CreateAccount: React.FC<{
  keyHolder: KeyHolder;
  onLoaded: (address: string) => void;
}> = ({ keyHolder, onLoaded }) => {
  const [mnemonic, setMnemonic] = useState("");
  const [written, setWritten] = useState(false);
  const [error, setError] = useState("");

  // Derived, not stored: the address is a pure function of the words on
  // screen, and keeping it in state would be one more copy to clear.
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
    <div className="col">
      <p className="faint tiny" style={{ margin: 0 }}>
        A standard cosmos account (24 words, path{" "}
        <code>m/44&apos;/118&apos;/0&apos;/0/0</code>) — the same words recover
        it in the desktop and mobile clients, in Keplr, and with{" "}
        <code>pokerchaind keys add --recover</code>.
      </p>

      {!mnemonic && (
        <button
          className="btn btn-primary btn-block"
          onClick={onGenerate}
          data-testid="create-generate"
        >
          Generate a new account
        </button>
      )}

      {mnemonic && (
        <>
          <div className="notice notice-bad">
            Write these 24 words down now. They are not saved anywhere — close
            this tab without them and the account is gone for good.
          </div>
          <ol className="words" data-testid="create-mnemonic">
            {mnemonic.split(" ").map((word, i) => (
              <li key={`${i}-${word}`}>{word}</li>
            ))}
          </ol>
          <div className="small">
            <span className="faint">Address </span>
            <code className="mono" data-testid="create-address">
              {address}
            </code>
          </div>
          <p className="faint tiny" style={{ margin: 0 }}>
            {FUNDING_NOTE}
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={written}
              onChange={(e) => setWritten(e.target.checked)}
              data-testid="create-ack"
            />
            <span className="small">I have written down these 24 words</span>
          </label>

          <div className="row">
            <button
              className="btn btn-primary"
              onClick={onUse}
              disabled={!written}
              data-testid="create-use"
            >
              Use this account
            </button>
            <button className="btn btn-ghost" onClick={onGenerate}>
              Generate a different one
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="bad small" data-testid="key-error">
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
    <div className="col">
      <label className="field">
        <span className="label">Recovery phrase</span>
        <textarea
          className="textarea mono"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          rows={3}
          data-testid="recover-mnemonic"
          autoComplete="off"
          spellCheck={false}
          placeholder="12 or 24 words, from any BitPoker client or Keplr"
        />
      </label>

      <div className="small faint">
        {preview ? (
          <>
            Account{" "}
            <code className="mono" data-testid="recover-address">
              {preview}
            </code>
          </>
        ) : (
          "Enter a valid recovery phrase to see its address."
        )}
      </div>

      <button
        className="btn btn-primary"
        onClick={onRecover}
        disabled={!preview}
        data-testid="recover-use"
      >
        Recover account
      </button>

      {error && (
        <p className="bad small" data-testid="key-error">
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
    <div className="col">
      <p className="faint tiny" style={{ margin: 0 }}>
        Export one from a node with{" "}
        <code>pokerchaind keys export &lt;name&gt;</code> and save the output to
        a file.
      </p>

      <label className="field">
        <span className="label">Key file</span>
        <input
          className="input"
          type="file"
          accept=".txt,.asc,.key,text/plain"
          onChange={(e) => void onFile(e.target.files?.[0])}
          data-testid="key-file"
        />
      </label>
      {fileName && (
        <div className="tiny faint">
          loaded <code>{fileName}</code>
        </div>
      )}

      <label className="field">
        <span className="label">Passphrase</span>
        <input
          className="input"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          data-testid="key-passphrase"
        />
      </label>

      <button
        className="btn btn-primary"
        onClick={() => void onImport()}
        disabled={busy || !armor}
        data-testid="key-import"
      >
        {busy ? "Decrypting…" : "Load key"}
      </button>

      {error && (
        <p className="bad small" data-testid="key-error">
          {error}
        </p>
      )}
    </div>
  );
};
