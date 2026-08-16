// Getting into a game: the open intents anyone can join, and the form that
// creates one.
//
// Both do the same thing on chain — open an intent — and the difference is
// only who it names. Joining a listed game opens a mirrored intent aimed at
// its creator, and the chain pairs the two; there is no separate join tx.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PokerGame } from "@bitpoker/poker-session/controller";
import {
  ChainGameIntent,
  fetchChainHeight,
  fetchOpenIntents,
  joinableIntents,
  localGameName,
} from "@bitpoker/poker-session/lobby";
import {
  chipToUchip,
  formatChip,
  shortAddress,
  uchipLessThan,
  uchipToChip,
} from "@bitpoker/poker-session/chip";
import { PokerSession } from "../poker/session";
import { BrowserKeyBridge } from "../wallet/browser-key-bridge";
import { RecoveryCard } from "./recovery-card";
import { BECH32_PREFIX, CHAIN_ID, DEFAULT_LCD_URL } from "../config";
import { IconCards, IconPlus, IconRefresh } from "./icons";

interface Props {
  session: PokerSession;
  wallet: BrowserKeyBridge;
  address: string;
  playerName: string;
  balanceUchip: string;
  onEnterTable: () => void;
}

export const PlayView: React.FC<Props> = ({
  session,
  wallet,
  address,
  playerName,
  balanceUchip,
  onEnterTable,
}) => {
  const joinIntent = useCallback(
    (intent: ChainGameIntent) => {
      session.join({
        lcdUrl: DEFAULT_LCD_URL,
        chainId: CHAIN_ID,
        playerName,
        game: localGameName(intent.game_type),
        minStakeUchip: intent.min_stake,
        maxStakeUchip: intent.max_stake,
        opponent: intent.creator,
      });
      onEnterTable();
    },
    [session, playerName, onEnterTable]
  );

  const createGame = useCallback(
    (submit: {
      game: PokerGame;
      minStakeUchip: string;
      maxStakeUchip: string;
      opponent: string;
    }) => {
      session.join({
        lcdUrl: DEFAULT_LCD_URL,
        chainId: CHAIN_ID,
        playerName,
        game: submit.game,
        minStakeUchip: submit.minStakeUchip,
        maxStakeUchip: submit.maxStakeUchip,
        opponent: submit.opponent,
      });
      onEnterTable();
    },
    [session, playerName, onEnterTable]
  );

  return (
    <div className="page col" style={{ gap: 16 }}>
      {/* Money first: an escrow the player cannot see how to recover is worse
          than an empty lobby. */}
      <RecoveryCard wallet={wallet} address={address} />
      <div className="grid grid-2">
      <Lobby
        myAddress={address}
        enabled={!session.busy && !!address}
        onJoin={joinIntent}
      />
      <CreateGame
        enabled={!session.busy && !!address}
        balanceUchip={balanceUchip}
        onSubmit={createGame}
      />
      </div>
    </div>
  );
};

const Lobby: React.FC<{
  myAddress: string;
  enabled: boolean;
  onJoin: (intent: ChainGameIntent) => void;
}> = ({ myAddress, enabled, onJoin }) => {
  const [intents, setIntents] = useState<ChainGameIntent[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // The height is what tells an expired offer from a live one: expired
      // intents stay PENDING on chain, and joining one costs a fee for a game
      // that can never start.
      const [all, height] = await Promise.all([
        fetchOpenIntents(DEFAULT_LCD_URL),
        fetchChainHeight(DEFAULT_LCD_URL),
      ]);
      setIntents(joinableIntents(all, myAddress, height));
      setError("");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoaded(true);
    }
  }, [myAddress]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <section className="card" data-testid="lobby">
      <div className="card-head">
        <IconCards />
        <h2>Open games</h2>
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
          <div className="notice notice-bad">Lobby unavailable: {error}</div>
        </div>
      )}

      {!error && intents.length === 0 && (
        <div className="empty">
          {loaded ? (
            <>
              <IconCards size={22} />
              <span>Nobody is waiting right now.</span>
              <span className="tiny">
                Create a game and the next player who opens the lobby will see
                it.
              </span>
            </>
          ) : (
            <span className="spinner" />
          )}
        </div>
      )}

      <div className="list">
        {intents.map((intent) => {
          const game = localGameName(intent.game_type);
          const same = intent.min_stake === intent.max_stake;
          return (
            <div className="list-row" key={intent.intent_id}>
              <span className={`tag ${game === "ZJH" ? "tag-zjh" : "tag-th"}`}>
                {game === "ZJH" ? "ZhaJinHua" : "Hold'em"}
              </span>
              <div className="list-main">
                <span className="list-title num">
                  {same
                    ? formatChip(intent.min_stake)
                    : `${uchipToChip(intent.min_stake)} – ${formatChip(
                        intent.max_stake
                      )}`}
                </span>
                <span className="faint tiny mono">
                  {shortAddress(intent.creator)}
                  {intent.opponent === myAddress && (
                    <span className="ok"> · challenges you</span>
                  )}
                </span>
              </div>
              <button
                className="btn btn-primary btn-sm right"
                disabled={!enabled}
                onClick={() => onJoin(intent)}
                data-testid="lobby-join"
              >
                Join
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const CreateGame: React.FC<{
  enabled: boolean;
  balanceUchip: string;
  onSubmit: (submit: {
    game: PokerGame;
    minStakeUchip: string;
    maxStakeUchip: string;
    opponent: string;
  }) => void;
}> = ({ enabled, balanceUchip, onSubmit }) => {
  const [game, setGame] = useState<PokerGame>("TH");
  const [anyOpponent, setAnyOpponent] = useState(true);
  const [opponent, setOpponent] = useState("");
  const [minChip, setMinChip] = useState("1");
  const [maxChip, setMaxChip] = useState("1");

  // Validation is derived, never stored: convert both stakes, then apply the
  // same rules as the chain (min > 0, min <= max) plus the balance guard.
  const check = useMemo((): { error?: string; min?: string; max?: string } => {
    let min: string;
    let max: string;
    try {
      min = chipToUchip(minChip);
      max = chipToUchip(maxChip);
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
    if (min === "0") {
      return { error: "The minimum stake must be greater than zero." };
    }
    if (uchipLessThan(max, min)) {
      return { error: "The minimum stake cannot exceed the maximum." };
    }
    if (
      balanceUchip &&
      /^[0-9]+$/.test(balanceUchip) &&
      uchipLessThan(balanceUchip, max)
    ) {
      return { error: "The maximum stake exceeds your balance." };
    }
    if (!anyOpponent && !opponent.trim().startsWith(`${BECH32_PREFIX}1`)) {
      return {
        error: `Enter the opponent's ${BECH32_PREFIX}1… address, or allow anyone.`,
      };
    }
    return { min, max };
  }, [minChip, maxChip, balanceUchip, anyOpponent, opponent]);

  // Raising min above max drags max along (on blur, so typing "10" over "1"
  // does not fight the user).
  const coerceMax = () => {
    try {
      if (uchipLessThan(chipToUchip(maxChip), chipToUchip(minChip))) {
        setMaxChip(minChip);
      }
    } catch {
      // leave malformed input for the validator to report
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <IconPlus />
        <h2>Create a game</h2>
      </div>
      <div className="card-body col">
        <div className="field">
          <span className="label">Game</span>
          <div className="segmented">
            <button
              aria-pressed={game === "TH"}
              onClick={() => setGame("TH")}
              disabled={!enabled}
              data-testid="create-game-th"
            >
              Texas Hold&apos;em
            </button>
            <button
              aria-pressed={game === "ZJH"}
              onClick={() => setGame("ZJH")}
              disabled={!enabled}
              data-testid="create-game-zjh"
            >
              ZhaJinHua 三张
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">Stake range</span>
          <div className="row">
            <span className="input-suffix" style={{ flex: 1 }}>
              <input
                className="input num"
                value={minChip}
                onChange={(e) => setMinChip(e.target.value)}
                onBlur={coerceMax}
                disabled={!enabled}
                inputMode="decimal"
                data-testid="create-min"
              />
              <span className="suffix">CHIP</span>
            </span>
            <span className="faint">to</span>
            <span className="input-suffix" style={{ flex: 1 }}>
              <input
                className="input num"
                value={maxChip}
                onChange={(e) => setMaxChip(e.target.value)}
                disabled={!enabled}
                inputMode="decimal"
                data-testid="create-max"
              />
              <span className="suffix">CHIP</span>
            </span>
          </div>
          <span className="hint">
            The chain matches two players whose ranges overlap, and the session
            plays for the matched amount. Your balance:{" "}
            <span className="num">
              {balanceUchip ? formatChip(balanceUchip) : "… CHIP"}
            </span>
          </span>
        </div>

        <div className="field">
          <span className="label">Opponent</span>
          <label className="check">
            <input
              type="checkbox"
              checked={anyOpponent}
              onChange={(e) => setAnyOpponent(e.target.checked)}
              disabled={!enabled}
              data-testid="create-any"
            />
            <span className="small">Anyone (open matchmaking)</span>
          </label>
          {!anyOpponent && (
            <input
              className="input mono"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder={`${BECH32_PREFIX}1…`}
              disabled={!enabled}
              spellCheck={false}
              data-testid="create-opponent"
            />
          )}
        </div>

        {check.error && enabled && (
          <div className="notice notice-bad">{check.error}</div>
        )}

        <button
          className="btn btn-primary btn-lg"
          disabled={!enabled || !!check.error}
          data-testid="create-game"
          onClick={() => {
            if (check.min && check.max) {
              onSubmit({
                game,
                minStakeUchip: check.min,
                maxStakeUchip: check.max,
                opponent: anyOpponent ? "ANY" : opponent.trim(),
              });
            }
          }}
        >
          Create and wait
        </button>
        <span className="faint tiny">
          Opening the intent escrows your stake until the session settles.
        </span>
      </div>
    </section>
  );
};
