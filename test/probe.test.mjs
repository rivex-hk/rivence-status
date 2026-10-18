import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accrueDown,
  filesToWrite,
  heartbeatText,
  probeOnce,
  rollDays,
  shapeIncidents,
  step,
} from "../scripts/probe.mjs";

const INSTALLS = { "EU-1": "app.example.com" };
const at = (iso) => new Date(iso);
const empty = { status: null, uptime: {} };
const UP = { "EU-1": { up: true } };
const DOWN = { "EU-1": { up: false, detail: "HTTP 503" } };

const downState = (overrides = {}) => ({
  status: {
    installs: [
      {
        label: "EU-1",
        slug: "eu-1",
        status: "down",
        since: "2026-10-17T10:00:00.000Z",
        issue: 7,
        checkedAt: "2026-10-17T10:00:00.000Z",
        ...overrides,
      },
    ],
  },
  uptime: {
    "eu-1": { label: "EU-1", days: [{ date: "2026-10-17", minutesDown: 0 }] },
  },
});

test("up to down opens exactly one issue", () => {
  const { status, actions } = step(empty, DOWN, at("2026-10-17T10:00:00Z"));
  assert.deepEqual(actions, [
    { type: "open", detail: "HTTP 503", label: "EU-1", slug: "eu-1" },
  ]);
  assert.equal(status.installs[0].status, "down");
  assert.equal(status.installs[0].since, "2026-10-17T10:00:00.000Z");
});

test("down to down opens nothing and keeps the issue and the start time", () => {
  const { status, actions } = step(
    downState(),
    DOWN,
    at("2026-10-17T10:05:00Z"),
  );
  assert.deepEqual(actions, []);
  assert.equal(status.installs[0].issue, 7);
  assert.equal(status.installs[0].since, "2026-10-17T10:00:00.000Z");
});

test("down to down retries the issue when opening it failed before", () => {
  const { actions } = step(
    downState({ issue: null }),
    DOWN,
    at("2026-10-17T10:05:00Z"),
  );
  assert.equal(actions[0].type, "open");
});

test("down to up closes the issue", () => {
  const { status, actions } = step(downState(), UP, at("2026-10-17T10:20:00Z"));
  assert.deepEqual(actions, [
    {
      type: "close",
      issue: 7,
      downSince: "2026-10-17T10:00:00.000Z",
      label: "EU-1",
      slug: "eu-1",
    },
  ]);
  assert.equal(status.installs[0].status, "up");
  assert.equal(status.installs[0].issue, null);
});

test("minutes down accrue from the last down check, not before the first failure", () => {
  const first = step(empty, DOWN, at("2026-10-17T10:00:00Z"));
  assert.equal(first.uptime["eu-1"].days.at(-1).minutesDown, 0);
  const second = step(downState(), DOWN, at("2026-10-17T10:05:00Z"));
  assert.equal(second.uptime["eu-1"].days.at(-1).minutesDown, 5);
  const recovered = step(downState(), UP, at("2026-10-17T10:12:00Z"));
  assert.equal(recovered.uptime["eu-1"].days.at(-1).minutesDown, 12);
});

test("an interval across midnight is split between the two days", () => {
  const days = accrueDown(
    [],
    at("2026-10-17T23:57:00Z"),
    at("2026-10-18T00:04:00Z"),
  );
  assert.deepEqual(days, [
    { date: "2026-10-17", minutesDown: 3 },
    { date: "2026-10-18", minutesDown: 4 },
  ]);
});

test("a gap longer than 30 minutes between runs counts only its last 30", () => {
  const days = accrueDown(
    [],
    at("2026-10-17T08:00:00Z"),
    at("2026-10-17T12:00:00Z"),
  );
  assert.deepEqual(days, [{ date: "2026-10-17", minutesDown: 30 }]);
});

test("a new day starts at zero minutes down", () => {
  const days = rollDays(
    [{ date: "2026-10-17", minutesDown: 40 }],
    at("2026-10-18T00:01:00Z"),
  );
  assert.deepEqual(days, [
    { date: "2026-10-17", minutesDown: 40 },
    { date: "2026-10-18", minutesDown: 0 },
  ]);
});

test("history keeps only the last 90 days", () => {
  const days = Array.from({ length: 120 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 1) + i * 86_400_000)
      .toISOString()
      .slice(0, 10),
    minutesDown: i,
  }));
  const kept = rollDays(days, at("2026-10-28T12:00:00Z"));
  assert.equal(kept.length, 90);
  assert.equal(kept[0].date, "2026-07-31");
  assert.equal(kept.at(-1).date, "2026-10-28");
});

test("incidents keep 90 days, carry their updates and never a hostname", () => {
  const issues = [
    {
      number: 3,
      title: "EU-1 is not responding",
      body: "<!-- probe label=EU-1 -->\nEU-1 failed its health check.",
      state: "closed",
      created_at: "2026-10-16T10:00:00Z",
      closed_at: "2026-10-16T10:30:00Z",
      comments: 1,
      labels: [{ name: "incident" }, { name: "eu-1" }],
    },
    {
      number: 1,
      title: "Old",
      body: "x",
      state: "closed",
      created_at: "2026-06-01T10:00:00Z",
      closed_at: "2026-06-01T11:00:00Z",
      comments: 0,
      labels: [{ name: "incident" }],
    },
    {
      number: 2,
      pull_request: {},
      title: "PR",
      state: "open",
      created_at: "2026-10-16T10:00:00Z",
      labels: [],
    },
  ];
  const comments = {
    3: [
      {
        created_at: "2026-10-16T10:20:00Z",
        body: "Restarted app.example.com.",
      },
    ],
  };
  const { incidents } = shapeIncidents(
    issues,
    comments,
    INSTALLS,
    at("2026-10-17T10:00:00Z"),
  );
  assert.deepEqual(incidents, [
    {
      number: 3,
      title: "EU-1 is not responding",
      installs: ["EU-1"],
      createdAt: "2026-10-16T10:00:00Z",
      closedAt: "2026-10-16T10:30:00Z",
      updates: [
        { at: "2026-10-16T10:00:00Z", body: "EU-1 failed its health check." },
        { at: "2026-10-16T10:20:00Z", body: "Restarted EU-1." },
      ],
    },
  ]);
});

test("nothing is written while every install stays up on the same day", () => {
  const now = at("2026-10-17T10:05:00Z");
  const before = {
    status: {
      installs: [
        {
          label: "EU-1",
          slug: "eu-1",
          status: "up",
          since: "2026-10-01T00:00:00.000Z",
          issue: null,
          checkedAt: "2026-10-17T10:00:00.000Z",
        },
      ],
    },
    uptime: {
      "eu-1": { label: "EU-1", days: [{ date: "2026-10-17", minutesDown: 0 }] },
    },
  };
  const after = { ...step(before, UP, now), incidents: { incidents: [] } };
  const previousTexts = {
    "status.json": `${JSON.stringify(before.status, null, 2)}\n`,
    "uptime/eu-1.json": `${JSON.stringify(before.uptime["eu-1"], null, 2)}\n`,
    "incidents.json": `${JSON.stringify({ incidents: [] }, null, 2)}\n`,
  };
  assert.deepEqual(filesToWrite(before, after, previousTexts, INSTALLS), {});
  const nextDay = {
    ...step(before, UP, at("2026-10-18T00:02:00Z")),
    incidents: { incidents: [] },
  };
  assert.deepEqual(
    Object.keys(filesToWrite(before, nextDay, previousTexts, INSTALLS)).sort(),
    ["status.json", "uptime/eu-1.json"],
  );
});

test("written data never names a host", () => {
  const after = {
    ...step(empty, DOWN, at("2026-10-17T10:00:00Z")),
    incidents: { incidents: [{ title: "app.example.com down" }] },
  };
  assert.throws(() => filesToWrite(empty, after, {}, INSTALLS), /EU-1/);
  const clean = { ...after, incidents: { incidents: [] } };
  const files = filesToWrite(empty, clean, {}, INSTALLS);
  assert.ok(
    Object.values(files).every((text) => !text.includes("example.com")),
  );
});

test("a probe is up only on HTTP 200; a redirect, an error and a timeout are down", async () => {
  const answering = (status) => async () => ({ status, body: null });
  assert.deepEqual(await probeOnce("h", answering(200)), { up: true });
  assert.deepEqual(await probeOnce("h", answering(302)), {
    up: false,
    detail: "HTTP 302",
  });
  const refused = async () => {
    throw Object.assign(new TypeError("fetch failed: h"), {
      cause: { code: "ECONNREFUSED" },
    });
  };
  assert.deepEqual(await probeOnce("h", refused), {
    up: false,
    detail: "could not connect, ECONNREFUSED",
  });
  const slow = async () => {
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  };
  assert.deepEqual(await probeOnce("h", slow), {
    up: false,
    detail: "no answer within 10 seconds",
  });
});

test("the heartbeat file carries the run time, so it changes on every run", () => {
  assert.deepEqual(JSON.parse(heartbeatText(at("2026-10-17T10:05:00Z"))), {
    checkedAt: "2026-10-17T10:05:00.000Z",
  });
  assert.notEqual(
    heartbeatText(at("2026-10-17T10:05:00Z")),
    heartbeatText(at("2026-10-17T10:10:00Z")),
  );
});
