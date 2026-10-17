import tls from "node:tls";
import { pathToFileURL } from "node:url";

export const WARN_DAYS = 14;
export const ISSUE_LABEL = "cert-expiry";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 15_000;

export function readCertificate(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: CONNECT_TIMEOUT_MS },
      () => {
        const { valid_to: validTo } = socket.getPeerCertificate();
        socket.end();
        if (validTo) resolve({ validTo: new Date(validTo) });
        else
          reject(
            Object.assign(new Error("no certificate"), {
              code: "NO_CERTIFICATE",
            }),
          );
      },
    );
    socket.on("timeout", () =>
      socket.destroy(
        Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      ),
    );
    socket.on("error", reject);
  });
}

export function parseHosts(raw) {
  let hosts;
  try {
    hosts = JSON.parse(raw ?? "");
  } catch {
    throw new Error("CERT_HOSTS is not valid JSON");
  }
  const valid =
    hosts !== null &&
    typeof hosts === "object" &&
    !Array.isArray(hosts) &&
    Object.entries(hosts).every(
      ([label, host]) =>
        label.trim() && typeof host === "string" && /^[a-z0-9.-]+$/i.test(host),
    );
  if (!valid)
    throw new Error(
      "CERT_HOSTS must be a JSON object of label to bare hostname",
    );
  return hosts;
}

const errorCode = (error) =>
  /^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "UNREACHABLE";

export async function findDue(
  hosts,
  { readCert = readCertificate, now = new Date() } = {},
) {
  const due = [];
  for (const [label, host] of Object.entries(hosts)) {
    try {
      const { validTo } = await readCert(host);
      const days = Math.floor((validTo.getTime() - now.getTime()) / DAY_MS);
      if (days <= WARN_DAYS)
        due.push({ label, kind: "expiring", days, validTo });
    } catch (error) {
      due.push({ label, kind: "unreachable", code: errorCode(error) });
    }
  }
  return due;
}

const marker = (label) => `<!-- cert-days label=${label} -->`;

export function issueFor(finding) {
  const { label } = finding;
  if (finding.kind === "expiring") {
    const date = finding.validTo.toISOString().slice(0, 10);
    return {
      title: `Certificate: ${label} expires in ${finding.days} days`,
      body: `${marker(label)}\nThe TLS certificate of **${label}** expires in **${finding.days} days** (${date}).\n\nRenewal runs inside the install; find out why it has not renewed. Close this issue once the new certificate is served.`,
    };
  }
  return {
    title: `Certificate: ${label} could not be read (${finding.code})`,
    body: `${marker(label)}\nThe certificate of **${label}** could not be read: \`${finding.code}\`.\n\nAn unreadable certificate is treated as a failure, never skipped. Close this issue once the install answers again.`,
  };
}

export async function openIssues(due, api) {
  const open = await api.listOpen();
  const opened = [];
  for (const finding of due) {
    if (
      open.some((issue) => (issue.body ?? "").includes(marker(finding.label)))
    ) {
      console.log(`${finding.label}: an issue is already open`);
      continue;
    }
    await api.create(issueFor(finding));
    console.log(`${finding.label}: opened an issue (${finding.kind})`);
    opened.push(finding.label);
  }
  return opened;
}

function githubIssues({
  token,
  repository,
  apiUrl = "https://api.github.com",
}) {
  const request = async (path, init = {}) => {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!response.ok)
      throw new Error(
        `GitHub API ${init.method ?? "GET"} ${path}: ${response.status}`,
      );
    return response.json();
  };
  return {
    listOpen: () =>
      request(`/issues?state=open&labels=${ISSUE_LABEL}&per_page=100`),
    create: ({ title, body }) =>
      request("/issues", {
        method: "POST",
        body: JSON.stringify({ title, body, labels: [ISSUE_LABEL] }),
      }),
  };
}

async function main() {
  const hosts = parseHosts(process.env.CERT_HOSTS);
  for (const host of Object.values(hosts)) console.log(`::add-mask::${host}`);
  const due = await findDue(hosts);
  console.log(
    `${Object.keys(hosts).length} certificates read, ${due.length} need attention`,
  );
  if (due.length === 0) return;
  await openIssues(
    due,
    githubIssues({
      token: process.env.GITHUB_TOKEN,
      repository: process.env.GITHUB_REPOSITORY,
      apiUrl: process.env.GITHUB_API_URL,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
