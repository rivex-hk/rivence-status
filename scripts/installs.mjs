// The INSTALLS secret is the one place a hostname lives: a JSON map of label to host.
// Everything written to the repository, the data or the log names an install by its label.

export function parseInstalls(raw) {
  let installs;
  try {
    installs = JSON.parse(raw ?? "");
  } catch {
    throw new Error("INSTALLS is not valid JSON");
  }
  const valid =
    installs !== null &&
    typeof installs === "object" &&
    !Array.isArray(installs) &&
    Object.entries(installs).every(
      ([label, host]) =>
        /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(label) &&
        typeof host === "string" &&
        /^[a-z0-9.-]+$/i.test(host),
    );
  if (!valid)
    throw new Error("INSTALLS must be a JSON object of label to bare hostname");
  return installs;
}

export const slugOf = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function maskHosts(installs, log = console.log) {
  for (const host of Object.values(installs)) log(`::add-mask::${host}`);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactHosts(text, installs) {
  let redacted = text;
  for (const [label, host] of Object.entries(installs))
    redacted = redacted.replace(new RegExp(escapeRegExp(host), "gi"), label);
  return redacted;
}

export function assertNoHosts(serialized, installs) {
  const lower = serialized.toLowerCase();
  for (const [label, host] of Object.entries(installs))
    if (lower.includes(host.toLowerCase()))
      throw new Error(`refusing to write data that names the host of ${label}`);
}
