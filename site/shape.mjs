// Pure data shaping for the page: everything app.js renders is decided here, so it is testable.

export const RANGES = [30, 60, 90];
export const INCIDENT_DAYS = 15;
// Must equal the cron step in .github/workflows/probe.yml (a test reads the workflow and checks).
export const PROBE_INTERVAL_MINUTES = 5;
// Three missed runs: GitHub delays scheduled runs now and then, so one or two late ones are normal.
export const STALE_AFTER_MINUTES = 3 * PROBE_INTERVAL_MINUTES;
const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 1440;

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const stampFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
export const formatDay = (date) =>
  dateFormat.format(new Date(`${date}T00:00:00Z`));
export const formatStamp = (iso) => `${stampFormat.format(new Date(iso))} UTC`;

export function lastDays(today, count) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    dayOf(end - (count - 1 - i) * DAY_MS),
  );
}

export function barLevel(minutesDown) {
  if (minutesDown === undefined) return "none";
  if (minutesDown === 0) return "ok";
  if (minutesDown <= 30) return "minor";
  if (minutesDown <= 120) return "partial";
  return "major";
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function downtimeText(minutesDown) {
  if (minutesDown === undefined) return "No data";
  if (minutesDown === 0) return "No downtime";
  const hours = Math.floor(minutesDown / 60);
  const minutes = minutesDown % 60;
  return `${[hours && plural(hours, "hour"), minutes && plural(minutes, "minute")].filter(Boolean).join(" ")} down`;
}

export function uptimePercent(days) {
  const known = days.filter((day) => day.minutesDown !== undefined);
  if (known.length === 0) return null;
  const down = known.reduce((sum, day) => sum + day.minutesDown, 0);
  const percent =
    (100 * (known.length * MINUTES_PER_DAY - down)) /
    (known.length * MINUTES_PER_DAY);
  return `${(Math.floor(percent * 100) / 100).toFixed(2)} %`;
}

const touches = (incident, label, date) => {
  const from = dayOf(incident.createdAt);
  const to = incident.closedAt ? dayOf(incident.closedAt) : "9999-12-31";
  return incident.installs.includes(label) && from <= date && date <= to;
};

// The probe rewrites data/heartbeat.json on every run, even when nothing else changed, so its
// time is the newest proof the probe is alive. A missing or unreadable time counts as stalled.
export function heartbeat(checkedAt, now) {
  const time = Date.parse(checkedAt ?? "");
  if (Number.isNaN(time))
    return { stalled: true, text: "No probe has reported yet" };
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  const ago =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${plural(minutes, "minute")} ago`
        : `${plural(Math.floor(minutes / 60), "hour")} ago`;
  return {
    stalled: minutes > STALE_AFTER_MINUTES,
    text: `Last checked ${formatStamp(time)} (${ago})`,
  };
}

export function shapeRow(
  install,
  uptimeDays,
  incidents,
  today,
  stalled = false,
) {
  const minutesByDate = new Map(
    uptimeDays.map((day) => [day.date, day.minutesDown]),
  );
  const bars = lastDays(today, Math.max(...RANGES)).map((date) => {
    const minutesDown = minutesByDate.get(date);
    const titles = incidents
      .filter((i) => touches(i, install.label, date))
      .map((i) => i.title);
    return {
      date,
      level: barLevel(minutesDown),
      minutesDown,
      incidents: titles,
      text: downtimeText(minutesDown),
    };
  });
  const uptime = Object.fromEntries(
    RANGES.map((range) => [range, uptimePercent(bars.slice(-range))]),
  );
  const down = install.status === "down";
  return {
    label: install.label,
    status: stalled ? "unknown" : down ? "down" : "up",
    statusText: stalled
      ? "Status unknown"
      : down
        ? "Major Outage"
        : "Operational",
    bars,
    uptime,
  };
}

export function overall(installs, stalled = false) {
  if (stalled)
    return { level: "stalled", text: "Status unknown - probes stalled" };
  const down = installs.filter((install) => install.status === "down").length;
  if (installs.length === 0)
    return { level: "none", text: "No installs are watched yet" };
  if (down === 0) return { level: "ok", text: "All Systems Operational" };
  if (down === installs.length)
    return { level: "major", text: "Major System Outage" };
  return { level: "partial", text: "Partial System Outage" };
}

function updatesOf(incident) {
  const newestFirst = [...incident.updates].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  const shaped = newestFirst.map((update, index) => ({
    label: index === newestFirst.length - 1 ? "Investigating" : "Update",
    body: update.body,
    at: formatStamp(update.at),
  }));
  if (incident.closedAt) {
    if (shaped.length > 1) shaped[0].label = "Resolved";
    else
      shaped.unshift({
        label: "Resolved",
        body: "This incident has been resolved.",
        at: formatStamp(incident.closedAt),
      });
  }
  return shaped;
}

export function pastIncidents(incidents, today) {
  return lastDays(today, INCIDENT_DAYS)
    .reverse()
    .map((date) => ({
      date,
      title: formatDay(date),
      emptyText:
        date === today
          ? "No incidents reported today."
          : "No incidents reported.",
      incidents: incidents
        .filter((incident) => dayOf(incident.createdAt) === date)
        .map((incident) => ({
          title: incident.title,
          updates: updatesOf(incident),
        })),
    }));
}
