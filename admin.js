// Photo manager: sign in with ADMIN_PASSWORD, then upload/caption/remove photos per job.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const store = {
  get: () => { try { return sessionStorage.getItem("pw") || ""; } catch { return ""; } },
  set: (v) => { try { v ? sessionStorage.setItem("pw", v) : sessionStorage.removeItem("pw"); } catch {} },
};
let password = store.get();

async function api(body) {
  const r = await fetch("/api/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${password}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// Shrink big phone photos so uploads stay fast and under the 4.5 MB request limit.
async function toDataUrl(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error(`${file.name}: this browser can't read that format. Please use JPG or PNG.`); }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length < 4_000_000) return url;
  }
  throw new Error(`${file.name} is too large.`);
}

async function render() {
  const [profile, uploaded] = await Promise.all([
    fetch("profile.json").then((r) => r.json()),
    fetch("/api/photos", { cache: "no-store" }).then((r) => r.json()),
  ]);
  const root = $("jobs");
  root.replaceChildren();
  for (const job of profile.timeline) {
    const sec = el("section", "admin-job");
    sec.append(el("h2", null, `${job.title} · ${job.company}`), el("p", "when", `${job.start} – ${job.end}`));

    const grid = el("div", "admin-grid");
    for (const ph of uploaded.jobs?.[job.id] || []) {
      const card = el("div", "admin-photo");
      const img = el("img"); img.src = ph.url; img.alt = ph.caption;
      const cap = el("input"); cap.value = ph.caption; cap.placeholder = "Caption"; cap.maxLength = 200;
      const save = el("button", "btn", "Save caption");
      const remove = el("button", "btn danger", "Delete");
      const msg = el("p", "admin-msg");
      save.onclick = () => run(msg, "Saved.", () => api({ action: "caption", url: ph.url, caption: cap.value }));
      remove.onclick = () => confirm("Delete this photo from your site?") &&
        run(msg, "", () => api({ action: "remove", url: ph.url }), true);
      const actions = el("div", "row"); actions.append(save, remove);
      card.append(img, cap, actions, msg);
      grid.append(card);
    }
    if (!grid.children.length) grid.append(el("p", "admin-empty", "No photos yet."));

    const form = el("form", "admin-upload");
    const files = el("input"); files.type = "file"; files.accept = "image/*"; files.multiple = true; files.required = true;
    const cap = el("input"); cap.placeholder = "Caption (optional, applies to each photo)"; cap.maxLength = 200;
    const go = el("button", "btn primary", "Upload");
    const msg = el("p", "admin-msg");
    form.append(files, cap, go, msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        const list = [...files.files];
        for (const [i, f] of list.entries()) {
          msg.textContent = `Uploading ${i + 1} of ${list.length}…`;
          await api({ action: "upload", jobId: job.id, caption: cap.value, filename: f.name, data: await toDataUrl(f) });
        }
        await render();
      } catch (err) {
        msg.textContent = err.message;
        go.disabled = false;
      }
    };
    sec.append(grid, form);
    root.append(sec);
  }
}

async function run(msg, done, fn, rerender) {
  msg.textContent = "Working…";
  try { await fn(); msg.textContent = done; if (rerender) await render(); }
  catch (err) { msg.textContent = err.message; }
}

async function signIn() {
  try {
    await api({ action: "check" });
  } catch (err) {
    $("login-msg").textContent = err.message;
    store.set("");
    return;
  }
  store.set(password);
  $("login").hidden = true;
  $("sign-out").hidden = false;
  $("jobs").hidden = false;
  try { await render(); }
  catch { $("jobs").replaceChildren(el("p", "admin-msg", "Couldn't load your photos. Try reloading.")); }
}

$("login").onsubmit = (e) => {
  e.preventDefault();
  password = $("password").value;
  $("login-msg").textContent = "Checking…";
  signIn();
};
$("sign-out").onclick = () => { store.set(""); location.reload(); };
if (password) signIn();
