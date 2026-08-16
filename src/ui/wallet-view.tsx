// Balance, receive, and the send form.
//
// The fee line is the point of interest: it is not a constant printed next to
// the amount, it is the number the chain gave us for this exact transfer (see
// @bitpoker/poker-session/fees). It refreshes as the form changes, and the
// send button stays honest about what leaves the account.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  chipToUchip,
  formatChip,
  uchipLessThan,
  uchipToChip,
} from "@bitpoker/poker-session/chip";
import { Coin } from "@bitpoker/poker-session/fees";
import { BrowserKeyBridge } from "../wallet/browser-key-bridge";
import {
  claimFromFaucet,
  describeWait,
  FaucetError,
  FaucetInfo,
  FaucetPayout,
  fetchFaucetInfo,
} from "../wallet/faucet";
import { BECH32_PREFIX, CHAIN_ID } from "../config";
import { CopyButton } from "./shell";
import { IconReceive, IconSend } from "./icons";

interface Props {
  wallet: BrowserKeyBridge;
  address: string;
  balanceUchip: string;
  onSent: () => void;
}

type SendState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "sent"; hash: string }
  | { phase: "failed"; message: string };

export const WalletView: React.FC<Props> = ({
  wallet,
  address,
  balanceUchip,
  onSent,
}) => (
  <div className="page grid grid-2">
    <BalanceCard
      address={address}
      balanceUchip={balanceUchip}
      onFunded={onSent}
    />
    <SendCard wallet={wallet} balanceUchip={balanceUchip} onSent={onSent} />
  </div>
);

const BalanceCard: React.FC<{
  address: string;
  balanceUchip: string;
  onFunded: () => void;
}> = ({ address, balanceUchip, onFunded }) => (
  <section className="card card-pad">
    <div className="stat">
      <span className="k">Balance</span>
      <div className="hero-balance">
        <span className="amount num" data-testid="balance">
          {balanceUchip === "" ? "—" : uchipToChip(balanceUchip)}
        </span>
        <span className="denom">CHIP</span>
      </div>
      <span className="faint tiny num">
        {balanceUchip === "" ? "" : `${balanceUchip} uchip`}
      </span>
    </div>

    <div className="divider" style={{ margin: "18px 0 14px" }} />

    <div className="stat">
      <span className="k">
        <IconReceive size={12} /> Your address
      </span>
      <code
        className="mono small"
        style={{ wordBreak: "break-all", lineHeight: 1.6 }}
        data-testid="wallet-address"
      >
        {address}
      </code>
    </div>
    <div className="row" style={{ marginTop: 12 }}>
      <CopyButton value={address} label="Copy address" />
    </div>

    <FaucetPanel address={address} onFunded={onFunded} />
  </section>
);

// The faucet, when this deployment has one.
//
// It is invitation-only on the public testnet, and the invitation lives on the
// project site rather than here — this page has no gate of its own — so the
// code is typed in rather than remembered. Nothing is stored: a claim is a
// once-a-day thing, and an invitation code sitting in localStorage is one more
// secret this page would be holding for no good reason.
const FaucetPanel: React.FC<{ address: string; onFunded: () => void }> = ({
  address,
  onFunded,
}) => {
  const [info, setInfo] = useState<FaucetInfo>();
  const [asked, setAsked] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState<FaucetState>({ phase: "idle" });

  useEffect(() => {
    let alive = true;
    void fetchFaucetInfo().then((answer) => {
      if (alive) {
        setInfo(answer);
        setAsked(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const onClaim = useCallback(async () => {
    setState({ phase: "claiming" });
    try {
      const payout = await claimFromFaucet({
        address,
        code: code.trim() || undefined,
      });
      setState({ phase: "paid", payout });
      onFunded();
    } catch (e) {
      const message =
        e instanceof FaucetError
          ? e.retryAfterSeconds > 0
            ? `${e.message} Try again in ${describeWait(e.retryAfterSeconds)}.`
            : e.message
          : "The faucet could not be reached.";
      setState({ phase: "refused", message });
    }
  }, [address, code, onFunded]);

  // Before the answer comes back, and on a build with no faucet, the page says
  // the same thing it always said: chips come from somewhere else.
  if (!asked || !info) {
    return (
      <p className="faint tiny" style={{ marginBottom: 0 }}>
        Send testnet CHIP here from another client or{" "}
        <code>pokerchaind tx bank send</code>.
      </p>
    );
  }

  const claiming = state.phase === "claiming";
  return (
    <div style={{ marginTop: 4 }} data-testid="faucet">
      <div className="divider" style={{ margin: "14px 0" }} />
      <span className="k">Faucet</span>
      <p className="faint tiny">
        {info.paused
          ? "The faucet is between top-ups — try again a little later."
          : `${formatChip(info.grantUchip)} of testnet chips per claim, once every ${describeWait(
              info.addressCooldownSeconds,
            )} per address.`}
      </p>

      {info.inviteRequired && (
        <label className="field">
          <span className="label">Invitation code</span>
          <input
            className="input mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            spellCheck={false}
            autoComplete="off"
            data-testid="faucet-code"
          />
        </label>
      )}

      {state.phase === "refused" && (
        <div className="notice notice-bad" data-testid="faucet-error">
          {state.message}
        </div>
      )}
      {state.phase === "paid" && (
        <div className="notice" data-testid="faucet-ok">
          <span className="ok">
            {state.payout.dryRun
              ? "Approved — this faucet sends nothing (dry run)."
              : `${formatChip(state.payout.amountUchip)} on the way.`}
          </span>{" "}
          {state.payout.txHash && (
            <code className="mono tiny">{state.payout.txHash}</code>
          )}
        </div>
      )}

      <button
        className="btn"
        disabled={info.paused || claiming}
        onClick={() => void onClaim()}
        data-testid="faucet-claim"
      >
        {claiming ? <span className="spinner" /> : <IconReceive size={12} />}
        {claiming ? "Asking…" : `Get ${formatChip(info.grantUchip)}`}
      </button>
    </div>
  );
};

type FaucetState =
  | { phase: "idle" }
  | { phase: "claiming" }
  | { phase: "paid"; payout: FaucetPayout }
  | { phase: "refused"; message: string };

const SendCard: React.FC<{
  wallet: BrowserKeyBridge;
  balanceUchip: string;
  onSent: () => void;
}> = ({ wallet, balanceUchip, onSent }) => {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [state, setState] = useState<SendState>({ phase: "idle" });
  const [estimate, setEstimate] = useState<{
    gasLimit: string;
    fee?: Coin;
  }>();
  const [estimating, setEstimating] = useState(false);

  const amountUchip = useMemo(() => {
    if (!amount.trim()) {
      return "";
    }
    try {
      return chipToUchip(amount.trim());
    } catch {
      return "";
    }
  }, [amount]);

  const toValid = to.startsWith(`${BECH32_PREFIX}1`) && to.length >= 39;
  const amountValid = amountUchip !== "" && amountUchip !== "0";
  const canQuote = toValid && amountValid;

  // Ask the chain what this exact transfer costs. Debounced, because it is a
  // simulation per keystroke otherwise.
  useEffect(() => {
    if (!canQuote) {
      setEstimate(undefined);
      return;
    }
    let alive = true;
    setEstimating(true);
    const timer = setTimeout(() => {
      wallet
        .estimateSend(CHAIN_ID, {
          toAddress: to,
          amount: { denom: "uchip", amount: amountUchip },
          memo: memo || undefined,
        })
        .then((quote) => {
          if (alive) {
            setEstimate(quote);
          }
        })
        .catch(() => {
          if (alive) {
            setEstimate(undefined);
          }
        })
        .finally(() => {
          if (alive) {
            setEstimating(false);
          }
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [wallet, to, amountUchip, memo, canQuote]);

  const total = useMemo(() => {
    if (!amountValid) {
      return "";
    }
    const fee = estimate?.fee?.amount ?? "0";
    return (BigInt(amountUchip) + BigInt(fee)).toString();
  }, [amountUchip, amountValid, estimate]);

  const affordable =
    total === "" || balanceUchip === "" || !uchipLessThan(balanceUchip, total);

  const onSend = useCallback(async () => {
    setState({ phase: "sending" });
    try {
      const result = await wallet.sendCoins(CHAIN_ID, {
        toAddress: to,
        amount: { denom: "uchip", amount: amountUchip },
        memo: memo || undefined,
      });
      if (result.code !== 0) {
        setState({ phase: "failed", message: result.rawLog || `code ${result.code}` });
        return;
      }
      setState({ phase: "sent", hash: result.txHash });
      setAmount("");
      setMemo("");
      onSent();
    } catch (e) {
      setState({
        phase: "failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [wallet, to, amountUchip, memo, onSent]);

  const sending = state.phase === "sending";

  return (
    <section className="card">
      <div className="card-head">
        <IconSend />
        <h2>Send CHIP</h2>
      </div>
      <div className="card-body col">
        <label className="field">
          <span className="label">To</span>
          <input
            className={`input mono ${to && !toValid ? "input-invalid" : ""}`}
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder={`${BECH32_PREFIX}1…`}
            spellCheck={false}
            autoComplete="off"
            data-testid="send-to"
          />
          {to && !toValid && (
            <span className="hint bad">
              Not a {BECH32_PREFIX} address on this chain.
            </span>
          )}
        </label>

        <label className="field">
          <span className="label">Amount</span>
          <span className="input-suffix">
            <input
              className={`input num ${
                amount && !amountValid ? "input-invalid" : ""
              }`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              data-testid="send-amount"
            />
            <span className="suffix">CHIP</span>
          </span>
        </label>

        <label className="field">
          <span className="label">
            Memo <span className="faint">optional</span>
          </span>
          <input
            className="input"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={256}
            data-testid="send-memo"
          />
        </label>

        <div className="divider" />

        <dl className="kv small">
          <dt>Network fee</dt>
          <dd className="num" data-testid="send-fee">
            {!canQuote ? (
              <span className="faint">—</span>
            ) : estimating ? (
              <span className="row">
                <span className="spinner" /> <span className="faint">quoting…</span>
              </span>
            ) : estimate?.fee ? (
              <>
                {formatChip(estimate.fee.amount)}{" "}
                <span className="faint tiny">
                  ({estimate.gasLimit} gas, price from the node)
                </span>
              </>
            ) : estimate ? (
              <>
                none{" "}
                <span className="faint tiny">
                  (this node charges no gas price)
                </span>
              </>
            ) : (
              <span className="faint">unavailable — the node did not quote</span>
            )}
          </dd>
          <dt>Total</dt>
          <dd className="num">
            {total === "" ? (
              <span className="faint">—</span>
            ) : (
              formatChip(total)
            )}
          </dd>
        </dl>

        {!affordable && (
          <div className="notice notice-bad" data-testid="send-insufficient">
            Not enough CHIP for the amount plus the fee.
          </div>
        )}
        {state.phase === "failed" && (
          <div className="notice notice-bad" data-testid="send-error">
            {state.message}
          </div>
        )}
        {state.phase === "sent" && (
          <div className="notice" data-testid="send-ok">
            <span className="ok">Sent.</span>{" "}
            <code className="mono tiny">{state.hash}</code>
          </div>
        )}

        <button
          className="btn btn-primary btn-lg"
          disabled={!canQuote || !affordable || sending}
          onClick={() => void onSend()}
          data-testid="send-submit"
        >
          {sending ? <span className="spinner" /> : <IconSend />}
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
};
