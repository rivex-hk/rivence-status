import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findDue,
  issueFor,
  openIssues,
  parseHosts,
} from "../scripts/cert-days.mjs";

const NOW = new Date("2026-10-17T06:00:00Z");
const inDays = (days) => ({
  validTo: new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000),
});

const readerFor = (byHost) => async (host) => {
  const outcome = byHost[host];
  if (outcome instanceof Error) throw outcome;
  return outcome;
};

test("a certificate 10 days from expiry is reported", async () => {
  const due = await findDue(
    { "EU-1": "a.example" },
    { readCert: readerFor({ "a.example": inDays(10) }), now: NOW },
  );
  assert.deepEqual(
    due.map(({ label, kind, days }) => ({ label, kind, days })),
    [{ label: "EU-1", kind: "expiring", days: 10 }],
  );
});

test("a certificate 40 days from expiry is not reported", async () => {
  const due = await findDue(
    { "EU-1": "a.example" },
    { readCert: readerFor({ "a.example": inDays(40) }), now: NOW },
  );
  assert.deepEqual(due, []);
});

test("an unreachable host is reported as a failure, not skipped", async () => {
  const unreachable = Object.assign(
    new Error("getaddrinfo ENOTFOUND b.example"),
    { code: "ENOTFOUND" },
  );
  const due = await findDue(
    { "EU-1": "a.example", "EU-2": "b.example" },
    {
      readCert: readerFor({
        "a.example": inDays(40),
        "b.example": unreachable,
      }),
      now: NOW,
    },
  );
  assert.deepEqual(due, [
    { label: "EU-2", kind: "unreachable", code: "ENOTFOUND" },
  ]);
});

test("an issue never carries the hostname, even from the error text", async () => {
  const leaky = Object.assign(
    new Error("Hostname/IP does not match: b.example"),
    { code: "not a code b.example" },
  );
  const due = await findDue(
    { "EU-2": "b.example" },
    { readCert: readerFor({ "b.example": leaky }), now: NOW },
  );
  const { title, body } = issueFor(due[0]);
  assert.doesNotMatch(`${title}\n${body}`, /b\.example/);
  assert.match(title, /EU-2/);
});

test("no second issue opens for a label while one is open", async () => {
  const created = [];
  const api = {
    listOpen: async () => [
      {
        body: issueFor({
          label: "EU-1",
          kind: "unreachable",
          code: "ENOTFOUND",
        }).body,
      },
    ],
    create: async (issue) => created.push(issue),
  };
  const due = [
    { label: "EU-1", kind: "expiring", days: 3, validTo: inDays(3).validTo },
    { label: "EU-10", kind: "unreachable", code: "ETIMEDOUT" },
  ];
  assert.deepEqual(await openIssues(due, api), ["EU-10"]);
  assert.equal(created.length, 1);
});

test("CERT_HOSTS must map labels to bare hostnames", () => {
  assert.deepEqual(parseHosts('{"EU-1":"a.example"}'), { "EU-1": "a.example" });
  assert.throws(() => parseHosts('{"EU-1":"https://a.example/"}'));
  assert.throws(() => parseHosts('["a.example"]'));
  assert.throws(() => parseHosts(undefined));
});
