// What this account has done on chain: transfers, game intents, settlements.
//
// Read from the node's tx index every time — the client stores nothing — so an
// unindexed node simply shows nothing. That is why the empty state says where
// the list comes from instead of claiming there is no history.
import React, { useCallback, useEffect, useState } from "react";
import { formatChip, shortAddress } from "@bitpoker/poker-session/chip";
import {
  ACTIVITY_LABELS,
  ActivityEntry,
  fetchActivity,
} from "../wallet/activity";
import { DEFAULT_LCD_URL } from "../config";
import { IconActivity, IconRefresh } from "./icons";

export const ActivityView: React.FC<{ address: string; reloadKey: number }> = ({
  address,
  reloadKey,
}) => {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await fetchActivity(DEFAULT_LCD_URL, address, "uchip"));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  return (
    <div className="page">
      <section className="card">
        <div className="card-head">
          <IconActivity />
          <h2>Activity</h2>
          <span className="right">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh"
            >
              {loading ? <span className="spinner" /> : <IconRefresh />}
            </button>
          </span>
        </div>

        {entries.length === 0 && (
          <div className="empty">
            {loading ? (
              <span className="spinner" />
            ) : (
              <>
                <IconActivity size={22} />
                <span>Nothing here yet.</span>
                <span className="tiny">
                  Transactions appear once they are in a block. A node with
                  transaction indexing switched off will never list them.
                </span>
              </>
            )}
          </div>
        )}

        <div className="list">
          {entries.map((entry) => (
            <Row key={entry.hash} entry={entry} />
          ))}
        </div>
      </section>
    </div>
  );
};

const Row: React.FC<{ entry: ActivityEntry }> = ({ entry }) => {
  const delta = BigInt(entry.deltaUchip || "0");
  const incoming = delta > 0n;
  const when = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : `height ${entry.height}`;

  return (
    <div className="list-row" data-testid="activity-row">
      <div className="list-main">
        <span className="list-title">
          {ACTIVITY_LABELS[entry.kind]}
          {entry.failed && <span className="bad small"> · failed</span>}
        </span>
        <span className="faint tiny ellipsis">
          {when}
          {entry.counterparty && ` · ${shortAddress(entry.counterparty)}`}
          {entry.memo && ` · “${entry.memo}”`}
        </span>
      </div>
      <div className="col right" style={{ gap: 0, alignItems: "flex-end" }}>
        <span
          className={`num ${incoming ? "amount-in" : "amount-out"}`}
          title={`${entry.deltaUchip} uchip`}
        >
          {delta === 0n
            ? "—"
            : `${incoming ? "+" : "−"}${formatChip(
                (delta < 0n ? -delta : delta).toString()
              )}`}
        </span>
        <span className="faint tiny num">
          fee {formatChip(entry.feeUchip)}
        </span>
      </div>
    </div>
  );
};
