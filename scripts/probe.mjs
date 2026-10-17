import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureLabels, githubClient } from "./github.mjs";
import {
  assertNoHosts,
  maskHosts,
  parseInstalls,
  redactHosts,
  slugOf,
} from "./installs.mjs";

export const PROBE_TIMEOUT_MS = 10_000;
export const RETRY_DELAY_MS = 5_000;
export const HISTORY_DAYS = 90;
export const MAX_GAP_MINUTES = 30;
export const INCIDENT_LABEL = "incident";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const byDate = (a, b) => a.date.localeCompare(b.date);

// --- the pure state machine ---------------------------------------------------

export function transition(prev, result, now) {
  const at = now.toISOString();
  const wasDown = prev?.status === "down";
  if (result.up) {
    if (!wasDown)
      return {
        state: { status: "up", since: prev?.since ?? at, issue: null },
        action: null,
      };
    const action = prev.issue
      ? { type: "close", issue: prev.issue, downSince: prev.since }
      : null;
    return { state: { status: "up", since: at, issue: null }, action };
  }
  if (wasDown && prev.issue)
    return {
      state: { status: "down", since: prev.since, issue: prev.issue },
      action: null,
    };
  return {
    state: { status: "down", since: wasDown ? prev.since : at, issue: null },
    action: { type: "open", detail: result.detail },
  };
}

export function accrueDown(days, from, to) {
  const totals = new Map(days.map((day) => [day.date, day.minutesDown]));
  const end = to.getTime();
  let time = Math.max(from.getTime(), end - MAX_GAP_MINUTES * MINUTE_MS);
  while (time < end) {
    const pieceEnd = Math.min(end, (Math.floor(time / DAY_MS) + 1) * DAY_MS);
    const date = dayOf(time);
    const minutes =
      (totals.get(date) ?? 0) + Math.round((pieceEnd - time) / MINUTE_MS);
    totals.set(date, Math.min(minutes, 24 * 60));
    time = pieceEnd;
  }
  return [...totals]
    .map(([date, minutesDown]) => ({ date, minutesDown }))
    .sort(byDate);
}

export function rollDays(days, now) {
  const today = dayOf(now);
  const oldest = dayOf(now.getTime() - (HISTORY_DAYS - 1) * DAY_MS);
  const withToday = days.some((day) => day.date === today)
    ? days
    : [...days, { date: today, minutesDown: 0 }];
  return withToday.filter((day) => day.date >= oldest).sort(byDate);
}

export function step(before, results, now) {
  const previous = new Map(
    (before.status?.installs ?? []).map((i) => [i.label, i]),
  );
  const installs = [];
  const uptime = {};
  const actions = [];
  for (const [label, result] of Object.entries(results)) {
    const slug = slugOf(label);
    const prev = previous.get(label);
    const { state, action } = transition(prev, result, now);
    let days = before.uptime[slug]?.days ?? [];
    if (prev?.status === "down" && prev.checkedAt)
      days = accrueDown(days, new Date(prev.checkedAt), now);
    uptime[slug] = { label, days: rollDays(days, now) };
    installs.push({ label, slug, ...state, checkedAt: now.toISOString() });
    if (action) actions.push({ ...action, label, slug });
  }
  return { status: { installs }, uptime, actions };
}

export function openIssueText(label, detail, now) {
  const time = now.toISOString().slice(11, 16);
  return {
    title: `${label} is not responding`,
    body: `<!-- probe label=${label} -->\n${label} failed its health check at ${time} UTC (${detail}). We are investigating.`,
  };
}

export function recoveryText(label, downSince, now) {
  const minutes = Math.max(
    1,
    Math.round((now - new Date(downSince)) / MINUTE_MS),
  );
  return `${label} is responding again. It was unavailable for about ${minutes} minutes.`;
}

const cleanText = (text, installs) =>
  redactHosts((text ?? "").replace(/<!--[\s\S]*?-->/g, ""), installs).trim();

export function shapeIncidents(issues, commentsByNumber, installs, now) {
  const oldest = now.getTime() - HISTORY_DAYS * DAY_MS;
  const labelBySlug = new Map(
    Object.keys(installs).map((label) => [slugOf(label), label]),
  );
  const incidents = issues
    .filter((issue) => !issue.pull_request)
    .filter(
      (issue) =>
        issue.state === "open" || Date.parse(issue.created_at) >= oldest,
    )
    .map((issue) => {
      const updates = [
        { at: issue.created_at, body: cleanText(issue.body, installs) },
        ...(commentsByNumber[issue.number] ?? []).map((comment) => ({
          at: comment.created_at,
          body: cleanText(comment.body, installs),
        })),
      ].filter((update) => update.body);
      return {
        number: issue.number,
        title: cleanText(issue.title, installs),
        installs: issue.labels
          .map((label) =>
            labelBySlug.get(typeof label === "string" ? label : label.name),
          )
          .filter(Boolean),
        createdAt: issue.created_at,
        closedAt: issue.state === "closed" ? issue.closed_at : null,
        updates,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { incidents };
}

// --- I/O ------------------------------------------------------------------------

const errorCode = (error) => {
  const code = error?.cause?.code ?? error?.code ?? "";
  return /^[A-Z0-9_]+$/.test(code) ? code : "NETWORK_ERROR";
};

export async function probeOnce(host, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`https://${host}/api/health/ready`, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "rivence-status" },
    });
    await response.body?.cancel();
    return response.status === 200
      ? { up: true }
      : { up: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    return error?.name === "TimeoutError"
      ? { up: false, detail: "no answer within 10 seconds" }
      : { up: false, detail: `could not connect, ${errorCode(error)}` };
  }
}

async function probeConfirmed(host) {
  const first = await probeOnce(host);
  if (first.up) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return probeOnce(host);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function readData(dataDir, installs) {
  const uptime = {};
  for (const label of Object.keys(installs))
    uptime[slugOf(label)] = await readJson(
      join(dataDir, "uptime", `${slugOf(label)}.json`),
      null,
    );
  return { status: await readJson(join(dataDir, "status.json"), null), uptime };
}

async function perform(action, status, request, now) {
  const install = status.installs.find((i) => i.label === action.label);
  if (action.type === "open") {
    await ensureLabels(request, [INCIDENT_LABEL, action.slug]);
    const issue = await request("/issues", {
      method: "POST",
      body: JSON.stringify({
        ...openIssueText(action.label, action.detail, now),
        labels: [INCIDENT_LABEL, action.slug],
      }),
    });
    install.issue = issue.number;
    console.log(`${action.label}: opened issue #${issue.number}`);
    return;
  }
  await request(`/issues/${action.issue}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: recoveryText(action.label, action.downSince, now),
    }),
  });
  await request(`/issues/${action.issue}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
  console.log(`${action.label}: closed issue #${action.issue}`);
}

async function syncIncidents(request, installs, now) {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString();
  const issues = await request(
    `/issues?labels=${INCIDENT_LABEL}&state=all&since=${since}&per_page=100`,
  );
  const comments = {};
  for (const issue of issues.filter((i) => i.comments > 0))
    comments[issue.number] = await request(
      `/issues/${issue.number}/comments?per_page=100`,
    );
  return shapeIncidents(issues, comments, installs, now);
}

export function serialize(value, installs) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  assertNoHosts(text, installs);
  return text;
}

const withoutCheckTimes = (status) =>
  JSON.stringify(
    status?.installs?.map(({ checkedAt, ...rest }) => rest) ?? null,
  );

export function filesToWrite(before, after, previousTexts, installs) {
  const files = {};
  for (const [slug, data] of Object.entries(after.uptime)) {
    const text = serialize(data, installs);
    if (text !== previousTexts[`uptime/${slug}.json`])
      files[`uptime/${slug}.json`] = text;
  }
  const incidents = serialize(after.incidents, installs);
  if (incidents !== previousTexts["incidents.json"])
    files["incidents.json"] = incidents;
  const anyDown = after.status.installs.some((i) => i.status === "down");
  const statusMoved =
    withoutCheckTimes(before.status) !== withoutCheckTimes(after.status);
  if (statusMoved || anyDown || Object.keys(files).length > 0)
    files["status.json"] = serialize(after.status, installs);
  return files;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir)
    throw new Error("usage: node scripts/probe.mjs <data directory>");
  const installs = parseInstalls(process.env.INSTALLS);
  maskHosts(installs);
  const now = new Date();

  const results = {};
  for (const [label, host] of Object.entries(installs)) {
    results[label] = await probeConfirmed(host);
    console.log(
      `${label}: ${results[label].up ? "up" : `down (${results[label].detail})`}`,
    );
  }

  const before = await readData(dataDir, installs);
  const { status, uptime, actions } = step(before, results, now);
  const request = githubClient();
  for (const action of actions) await perform(action, status, request, now);
  const incidents = await syncIncidents(request, installs, now);

  const names = [
    "status.json",
    "incidents.json",
    ...Object.keys(uptime).map((s) => `uptime/${s}.json`),
  ];
  const previousTexts = {};
  for (const name of names)
    previousTexts[name] = await readFile(join(dataDir, name), "utf8").catch(
      () => undefined,
    );
  const files = filesToWrite(
    before,
    { status, uptime, incidents },
    previousTexts,
    installs,
  );

  await mkdir(join(dataDir, "uptime"), { recursive: true });
  for (const [name, text] of Object.entries(files))
    await writeFile(join(dataDir, name), text);
  console.log(
    Object.keys(files).length
      ? `wrote ${Object.keys(files).join(", ")}`
      : "no change",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
