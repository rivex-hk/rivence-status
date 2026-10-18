import {
  RANGES,
  dayOf,
  formatDay,
  heartbeat,
  overall,
  pastIncidents,
  shapeRow,
} from "./shape.mjs";

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
};

const getJson = async (path) => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
};

const tooltip = document.getElementById("tooltip");

function showTooltip(bar) {
  const { date, text, incidents } = bar.dataset;
  const titles = JSON.parse(incidents);
  tooltip.replaceChildren(
    el("strong", { text: formatDay(date) }),
    el("span", { text }),
    ...(titles.length
      ? [
          el(
            "ul",
            {},
            titles.map((title) => el("li", { text: title })),
          ),
        ]
      : []),
  );
  tooltip.hidden = false;
  const rect = bar.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    document.documentElement.clientWidth - width - 8,
  );
  tooltip.style.left = `${left + window.scrollX}px`;
  tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 8}px`;
}

const hideTooltip = () => {
  tooltip.hidden = true;
};

function barLabel(row, bar) {
  const incidents = bar.incidents.length
    ? `, incidents: ${bar.incidents.join("; ")}`
    : "";
  return `${row.label}, ${formatDay(bar.date)}: ${bar.text}${incidents}`;
}

function renderRow(row) {
  const bars = row.bars.map((bar, index) =>
    el("span", {
      class: "bar",
      role: "img",
      tabindex: index === row.bars.length - 1 ? "0" : "-1",
      "data-level": bar.level,
      "data-date": bar.date,
      "data-text": bar.text,
      "data-incidents": JSON.stringify(bar.incidents),
      "aria-label": barLabel(row, bar),
    }),
  );
  const ranges = (format) =>
    RANGES.map((range) =>
      el("span", { class: `range-${range}`, text: format(range) }),
    );
  return el("div", { class: "component" }, [
    el("div", { class: "component-head" }, [
      el("h3", { class: "component-name", text: row.label }),
      el("span", {
        class: "component-status",
        "data-status": row.status,
        text: row.statusText,
      }),
    ]),
    el(
      "div",
      {
        class: "bars",
        role: "group",
        "aria-label": `${row.label}, daily uptime, oldest first. Use the arrow keys to move between days.`,
      },
      bars,
    ),
    el("div", { class: "component-foot" }, [
      el(
        "span",
        {},
        ranges((range) => `${range} days ago`),
      ),
      el("span", { class: "rule" }),
      el(
        "span",
        {},
        ranges((range) =>
          row.uptime[range] ? `${row.uptime[range]} uptime` : "No data yet",
        ),
      ),
      el("span", { class: "rule" }),
      el("span", { text: "Today" }),
    ]),
  ]);
}

function renderIncidentDay(day) {
  const body = day.incidents.length
    ? day.incidents.map((incident) =>
        el("article", { class: "incident" }, [
          el("h4", { text: incident.title }),
          ...incident.updates.map((update) =>
            el("div", { class: "update" }, [
              el("p", {}, [
                el("strong", { text: update.label }),
                ` - ${update.body}`,
              ]),
              el("time", { class: "when", text: update.at }),
            ]),
          ),
        ]),
      )
    : [el("p", { class: "empty", text: day.emptyText })];
  return el("section", { class: "incident-day" }, [
    el("h3", { text: day.title }),
    ...body,
  ]);
}

function wireBars(container) {
  const visibleBars = (list) =>
    [...list.children].filter((bar) => bar.offsetParent !== null);
  container.addEventListener("pointerover", (event) => {
    if (event.target.classList.contains("bar")) showTooltip(event.target);
  });
  container.addEventListener("pointerout", (event) => {
    if (event.target.classList.contains("bar") && event.pointerType === "mouse")
      hideTooltip();
  });
  container.addEventListener("click", (event) => {
    if (event.target.classList.contains("bar")) showTooltip(event.target);
  });
  container.addEventListener("focusin", (event) => {
    if (event.target.classList.contains("bar")) showTooltip(event.target);
  });
  container.addEventListener("focusout", hideTooltip);
  container.addEventListener("keydown", (event) => {
    const bar = event.target;
    if (!bar.classList.contains("bar")) return;
    if (event.key === "Escape") return hideTooltip();
    const bars = visibleBars(bar.parentElement);
    const index = bars.indexOf(bar);
    const next = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: bars.length - 1,
    }[event.key];
    if (next === undefined || !bars[next]) return;
    event.preventDefault();
    bar.tabIndex = -1;
    bars[next].tabIndex = 0;
    bars[next].focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.classList?.contains("bar")) hideTooltip();
  });
  window.addEventListener("scroll", hideTooltip, { passive: true });
}

async function render() {
  const banner = document.getElementById("banner");
  const bannerText = document.getElementById("banner-text");
  const lastChecked = document.getElementById("last-checked");
  const components = document.getElementById("components");
  const incidentDays = document.getElementById("incident-days");
  try {
    const [status, beat, { incidents }] = await Promise.all([
      getJson("data/status.json"),
      getJson("data/heartbeat.json").catch(() => ({})),
      getJson("data/incidents.json").catch(() => ({ incidents: [] })),
    ]);
    const today = dayOf(Date.now());
    const uptimes = await Promise.all(
      status.installs.map((install) =>
        getJson(`data/uptime/${install.slug}.json`).catch(() => ({ days: [] })),
      ),
    );
    const pulse = heartbeat(beat.checkedAt, Date.now());
    const summary = overall(status.installs, pulse.stalled);
    banner.dataset.level = summary.level;
    bannerText.textContent = summary.text;
    lastChecked.textContent = pulse.text;
    lastChecked.dataset.stalled = String(pulse.stalled);
    components.replaceChildren(
      ...status.installs.map((install, i) =>
        renderRow(
          shapeRow(install, uptimes[i].days, incidents, today, pulse.stalled),
        ),
      ),
    );
    incidentDays.replaceChildren(
      ...pastIncidents(incidents, today).map(renderIncidentDay),
    );
  } catch {
    banner.dataset.level = "none";
    bannerText.textContent =
      "Status data is not available right now. Try again in a few minutes.";
    lastChecked.textContent = "";
  }
}

wireBars(document.getElementById("components"));
render();
setInterval(render, 5 * 60 * 1000);
