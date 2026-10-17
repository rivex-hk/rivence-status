import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barLevel,
  downtimeText,
  overall,
  pastIncidents,
  shapeRow,
  uptimePercent,
} from "../site/shape.mjs";

const TODAY = "2026-10-17";
const incident = {
  number: 3,
  title: "EU-1 is not responding",
  installs: ["EU-1"],
  createdAt: "2026-10-15T10:00:00Z",
  closedAt: "2026-10-15T10:40:00Z",
  updates: [
    { at: "2026-10-15T10:00:00Z", body: "EU-1 failed its health check." },
    { at: "2026-10-15T10:15:00Z", body: "The database is restarting." },
    { at: "2026-10-15T10:40:00Z", body: "EU-1 is responding again." },
  ],
};

test("a row has 90 bars ending today, coloured by minutes down, with incident titles", () => {
  const row = shapeRow(
    { label: "EU-1", status: "up" },
    [
      { date: "2026-10-15", minutesDown: 40 },
      { date: "2026-10-16", minutesDown: 0 },
      { date: TODAY, minutesDown: 0 },
    ],
    [incident],
    TODAY,
  );
  assert.equal(row.bars.length, 90);
  assert.equal(row.bars.at(-1).date, TODAY);
  assert.equal(row.bars.at(-3).level, "partial");
  assert.equal(row.bars.at(-3).text, "40 minutes down");
  assert.deepEqual(row.bars.at(-3).incidents, ["EU-1 is not responding"]);
  assert.equal(row.bars[0].level, "none");
  assert.equal(row.statusText, "Operational");
  assert.equal(row.uptime[90], "99.07 %");
});

test("bar levels and downtime text never rely on colour alone", () => {
  assert.deepEqual([undefined, 0, 12, 90, 300].map(barLevel), [
    "none",
    "ok",
    "minor",
    "partial",
    "major",
  ]);
  assert.equal(downtimeText(125), "2 hours 5 minutes down");
  assert.equal(downtimeText(undefined), "No data");
});

test("uptime counts only days with data and never rounds up to 100", () => {
  assert.equal(
    uptimePercent([{ minutesDown: 1 }, { minutesDown: 0 }]),
    "99.96 %",
  );
  assert.equal(uptimePercent([{ minutesDown: undefined }]), null);
});

test("the banner shows the worst current state", () => {
  assert.equal(overall([{ status: "up" }]).text, "All Systems Operational");
  assert.equal(
    overall([{ status: "up" }, { status: "down" }]).text,
    "Partial System Outage",
  );
  assert.equal(overall([{ status: "down" }]).text, "Major System Outage");
});

test("past incidents list 15 days, newest first, with labelled updates", () => {
  const days = pastIncidents([incident], TODAY);
  assert.equal(days.length, 15);
  assert.equal(days[0].emptyText, "No incidents reported today.");
  const day = days.find((d) => d.date === "2026-10-15");
  assert.deepEqual(
    day.incidents[0].updates.map((u) => u.label),
    ["Resolved", "Update", "Investigating"],
  );
  assert.equal(day.incidents[0].updates[0].at, "Oct 15, 10:40 UTC");
});

test("a closed incident with no closing note still shows Resolved", () => {
  const silent = { ...incident, updates: [incident.updates[0]] };
  const [update] = pastIncidents([silent], TODAY).find(
    (d) => d.date === "2026-10-15",
  ).incidents[0].updates;
  assert.deepEqual(update, {
    label: "Resolved",
    body: "This incident has been resolved.",
    at: "Oct 15, 10:40 UTC",
  });
});
