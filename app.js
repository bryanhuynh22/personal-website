// Renders the page from profile.json and runs the chat widget.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const [profile, uploaded] = await Promise.all([
  fetch("profile.json").then((r) => r.json()),
  // Photos added from admin.html; the site still works if photo storage isn't set up.
  fetch("/api/photos").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
]);
const firstName = profile.name.split(" ")[0];

// Headshot: uploaded from admin.html, or a "headshot" path in profile.json; initials until then.
const headshot = uploaded.headshot?.url || profile.headshot;
const initials = profile.name.split(",")[0].split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
for (const slot of document.querySelectorAll("[data-avatar]")) {
  if (headshot) {
    const img = el("img");
    img.src = headshot;
    img.alt = `Photo of ${profile.name.split(",")[0]}`;
    slot.append(img);
  } else {
    slot.textContent = initials;
    slot.setAttribute("aria-hidden", "true");
  }
}

// Company logos: uploaded from admin.html > "logo" in profile.json > the company website's icon > initials.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function logoTile(job, cls = "logo") {
  const tile = el("div", cls);
  const fallback = () => {
    tile.replaceChildren(job.company.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    tile.classList.add("logo-initials");
  };
  const src = uploaded.logos?.[slug(job.company)]?.url || job.logo ||
    (job.website && `https://www.google.com/s2/favicons?domain=${job.website}&sz=128`);
  if (!src) { fallback(); return tile; }
  const img = el("img");
  img.alt = `${job.company} logo`;
  img.loading = "lazy";
  // Tiny or missing icons look worse than initials, so fall back for those.
  img.onload = () => { if (!src.endsWith(".svg") && img.naturalWidth < 32) fallback(); };
  img.onerror = fallback;
  img.src = src;
  tile.append(img);
  return tile;
}

$("brand").textContent = profile.name;
$("name").textContent = profile.name;
$("headline").textContent = profile.headline;
$("summary").textContent = profile.summary;
$("location").textContent = profile.location;
$("footer-name").textContent = profile.name;
$("year").textContent = new Date().getFullYear();
document.title = `${profile.name} · Project Manager`;

for (const s of profile.stats) {
  const d = el("div", "stat");
  d.append(el("b", null, s.value), el("span", null, s.label));
  $("stats").append(d);
}

const seen = new Set();
for (const job of profile.timeline) {
  if (seen.has(job.company)) continue;
  seen.add(job.company);
  const item = el("li", "company-item");
  item.append(logoTile(job, "logo logo-lg"), el("span", null, job.company));
  $("company-strip").append(item);
}

for (const job of profile.timeline) {
  const li = el("li");
  const head = el("div", "job-head");
  const text = el("div");
  text.append(el("div", "when", `${job.start} – ${job.end}`), el("h3", null, job.title),
    el("div", "company", [job.company, job.location].filter(Boolean).join(" · ")));
  head.append(logoTile(job), text);
  li.append(head, el("p", null, job.summary));
  const ul = el("ul");
  for (const a of job.achievements) ul.append(el("li", null, a));
  li.append(ul);
  const photos = [...(job.photos || []), ...(uploaded.jobs?.[job.id] || [])];
  if (photos.length) {
    const g = el("div", "gallery");
    for (const ph of photos) {
      const b = el("button", "thumb");
      b.setAttribute("aria-label", ph.caption || `Photo from ${job.company}`);
      const img = el("img");
      img.src = ph.src || ph.url; img.alt = ph.caption || ""; img.loading = "lazy";
      b.append(img);
      b.addEventListener("click", () => showPhoto(ph));
      g.append(b);
    }
    li.append(g);
  }
  $("timeline-list").append(li);
}

function showPhoto(ph) {
  $("lightbox-img").src = ph.src || ph.url;
  $("lightbox-img").alt = ph.caption || "";
  $("lightbox-caption").textContent = ph.caption || "";
  $("lightbox").showModal();
}
$("lightbox").addEventListener("click", () => $("lightbox").close());

for (const h of profile.highlights) {
  const c = el("article", "card");
  c.append(el("h3", null, h.title), el("div", "metric", h.metric), el("p", null, h.description));
  $("highlight-cards").append(c);
}

for (const s of profile.skills) $("skill-list").append(el("li", null, s));
for (const c of profile.certifications) $("cert-list").append(el("li", null, c));
for (const e of profile.education) $("edu-list").append(el("li", null, e));

const links = [["Email me", `mailto:${profile.contact.email}`, true],
  ["LinkedIn", profile.contact.linkedin], ["Résumé", profile.contact.resume]];
for (const [label, href, primary] of links) {
  if (!href) continue;
  const a = el("a", primary ? "btn primary" : "btn", label);
  a.href = href;
  if (!href.startsWith("mailto:")) { a.target = "_blank"; a.rel = "noopener"; }
  $("contact-links").append(a);
}

// Chat widget
const chat = $("chat"), log = $("chat-log"), input = $("chat-input"), fab = document.querySelector(".chat-fab");
const history = [];
const add = (role, text, extra = "") => {
  const m = el("div", `msg ${role} ${extra}`.trim(), text);
  log.append(m);
  log.scrollTop = log.scrollHeight;
  return m;
};
$("chat-name").textContent = `Ask about ${firstName}'s career`;
add("assistant", `Hi! I can answer questions about ${firstName}'s experience as a project manager. What would you like to know?`);

// Hide every chat entry point until the chat API reports it's configured.
const chatReady = await fetch("/api/chat").then((r) => r.json()).then((d) => d.enabled).catch(() => false);
if (!chatReady) document.querySelectorAll("[data-open-chat]").forEach((b) => (b.hidden = true));

const open = () => { chat.hidden = false; fab.hidden = true; input.focus(); };
document.querySelectorAll("[data-open-chat]").forEach((b) => b.addEventListener("click", open));
$("chat-close").addEventListener("click", () => { chat.hidden = true; fab.hidden = false; });

async function ask(question) {
  question = question.trim();
  if (!question) return;
  $("chat-suggest").hidden = true;
  add("user", question);
  history.push({ role: "user", content: question });
  const pending = add("assistant", "Thinking…", "typing");
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await r.json();
    const reply = data.reply || data.error || "Something went wrong.";
    pending.textContent = reply;
    if (data.reply) history.push({ role: "assistant", content: reply });
    else history.pop();
  } catch {
    pending.textContent = `I'm offline right now. You can reach ${firstName} at ${profile.contact.email}.`;
    history.pop();
  }
  pending.classList.remove("typing");
}

$("chat-form").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); input.value = ""; });
document.querySelectorAll("#chat-suggest button").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
