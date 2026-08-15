// The live game, as a single piece of state the whole app can read.
//
// The controller outlives any one screen: a player who opens the wallet
// mid-hand must not drop the session, and the nav has to be able to show that
// a hand is running. So it is owned here, above the views, and the screens
// only read the snapshot and call in.
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChainJoinOptions,
  GameSnapshot,
  PokerGameController,
} from "@bitpoker/poker-session/controller";
import { PokerWalletBridge } from "@bitpoker/poker-session/wallet-bridge";

const IDLE: GameSnapshot = { stage: "idle", message: "", wait: 1 };

// Stages where starting a new game is safe. Anything else means a session is
// mid-flight, holding escrow or a relay connection.
const SETTLED_STAGES = ["idle", "error", "done", "disputed"];

export interface PokerSession {
  snapshot: GameSnapshot;
  // A session is in flight: joining, matching, dealing or playing.
  busy: boolean;
  // There is a table worth looking at (in flight, or finished but not cleared).
  active: boolean;
  join(options: ChainJoinOptions): void;
  act(kind: number, amount?: number): void;
  setContinueWish(wish: boolean): void;
  // Back to an empty lobby. Drops the finished controller rather than reusing
  // it: a fresh one gets a fresh worker, so nothing from the last hand — wasm
  // session state included — can leak into the next.
  clear(): void;
  runSelfTest(): Promise<string>;
}

export function usePokerSession(wallet: PokerWalletBridge): PokerSession {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(IDLE);
  // Bumped by clear() to build a new controller.
  const [generation, setGeneration] = useState(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const controller = useMemo(() => {
    void generation;
    return new PokerGameController(setSnapshot, wallet);
  }, [wallet, generation]);

  const busy = !SETTLED_STAGES.includes(snapshot.stage);

  const join = useCallback(
    (options: ChainJoinOptions) => {
      void controller.joinChain(options).catch(() => {
        // joinChain reports failures through the snapshot; the rejection is
        // the same news arriving twice.
      });
    },
    [controller]
  );

  const act = useCallback(
    (kind: number, amount?: number) => {
      void controller.act(kind, amount ?? 0);
    },
    [controller]
  );

  const setContinueWish = useCallback(
    (wish: boolean) => {
      void controller.setContinueWish(wish);
    },
    [controller]
  );

  const clear = useCallback(() => {
    setSnapshot(IDLE);
    setGeneration((n) => n + 1);
  }, []);

  const runSelfTest = useCallback(() => controller.runSelfTest(), [controller]);

  return {
    snapshot,
    busy,
    active: snapshot.stage !== "idle",
    join,
    act,
    setContinueWish,
    clear,
    runSelfTest,
  };
}
