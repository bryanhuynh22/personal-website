// Job photos uploaded from the browser (admin.html), stored in Vercel Blob.
// GET  -> { jobs: { [jobId]: [{ url, caption }] } }   (public, used by the site)
// POST -> admin actions; needs header "Authorization: Bearer <ADMIN_PASSWORD>"
//   { action: "check" }
//   { action: "upload", jobId, caption, filename, data }   (data = base64 JPEG/PNG/WebP)
//   { action: "caption", url, caption }
//   { action: "remove", url }
//   { action: "headshot", data }   (data = base64 image; replaces any previous headshot)
//   { action: "remove-headshot" }
//   { action: "logo", company, data }  /  { action: "remove-logo", company }   (company logo override)
// The photo list is a small JSON manifest; each change writes a new file under
// manifest/ (so no stale CDN copy is ever read) and prunes older ones.
import { createHash, timingSafeEqual } from "node:crypto";
import { put, list, del } from "@vercel/blob";
import profile from "../profile.json" with { type: "json" };

const JOB_IDS = new Set(profile.timeline.map((j) => j.id));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const COMPANIES = new Set(profile.timeline.map((j) => slug(j.company)));
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const KEEP_MANIFESTS = 5;

const hash = (s) => createHash("sha256").update(String(s)).digest();
function authorized(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const given = (req.headers.authorization || "").replace(/^Bearer /, "");
  return timingSafeEqual(hash(given), hash(expected));
}

async function readManifest() {
  const { blobs } = await list({ prefix: "manifest/" });
  if (!blobs.length) return { manifest: { jobs: {} }, blobs };
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const r = await fetch(blobs[0].url, { cache: "no-store" });
  return { manifest: r.ok ? await r.json() : { jobs: {} }, blobs };
}

async function writeManifest(manifest, oldBlobs) {
  await put(`manifest/${Date.now()}.json`, JSON.stringify(manifest), {
    access: "public", contentType: "application/json", addRandomSuffix: true,
  });
  const stale = oldBlobs.slice(KEEP_MANIFESTS - 1).map((b) => b.url);
  if (stale.length) await del(stale);
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { manifest } = await readManifest();
      res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=60");
      return res.json(manifest);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (!authorized(req)) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down password guessing
      return res.status(401).json({ error: "Wrong password." });
    }
    const body = req.body || {};
    if (body.action === "check") return res.json({ ok: true });

    const { manifest, blobs } = await readManifest();
    const all = Object.values(manifest.jobs).flat();

    if (body.action === "upload") {
      if (!JOB_IDS.has(body.jobId)) return res.status(400).json({ error: "Unknown job." });
      const [, type, data] = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.data || "") || [];
      if (!TYPES[type]) return res.status(400).json({ error: "Use a JPG, PNG or WebP image." });
      const name = String(body.filename || "photo").replace(/\.[^.]*$/, "").replace(/[^\w-]+/g, "-").slice(0, 40);
      const blob = await put(`jobs/${body.jobId}/${name}.${TYPES[type]}`, Buffer.from(data, "base64"), {
        access: "public", contentType: type, addRandomSuffix: true,
      });
      const photo = { url: blob.url, caption: String(body.caption || "").slice(0, 200) };
      (manifest.jobs[body.jobId] ||= []).push(photo);
      await writeManifest(manifest, blobs);
      return res.json({ ok: true, photo });
    }

    if (body.action === "headshot" || body.action === "remove-headshot") {
      const previous = manifest.headshot?.url;
      if (body.action === "headshot") {
        const [, type, data] = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.data || "") || [];
        if (!TYPES[type]) return res.status(400).json({ error: "Use a JPG, PNG or WebP image." });
        const blob = await put(`headshot/headshot.${TYPES[type]}`, Buffer.from(data, "base64"), {
          access: "public", contentType: type, addRandomSuffix: true,
        });
        manifest.headshot = { url: blob.url };
      } else {
        delete manifest.headshot;
      }
      await writeManifest(manifest, blobs);
      if (previous) await del(previous);
      return res.json({ ok: true, headshot: manifest.headshot || null });
    }

    if (body.action === "logo" || body.action === "remove-logo") {
      if (!COMPANIES.has(body.company)) return res.status(400).json({ error: "Unknown company." });
      manifest.logos ||= {};
      const previous = manifest.logos[body.company]?.url;
      if (body.action === "logo") {
        const [, type, data] = /^data:([\w/+.-]+);base64,(.+)$/.exec(body.data || "") || [];
        if (!TYPES[type]) return res.status(400).json({ error: "Use a JPG, PNG or WebP image." });
        const blob = await put(`logos/${body.company}.${TYPES[type]}`, Buffer.from(data, "base64"), {
          access: "public", contentType: type, addRandomSuffix: true,
        });
        manifest.logos[body.company] = { url: blob.url };
      } else {
        delete manifest.logos[body.company];
      }
      await writeManifest(manifest, blobs);
      if (previous) await del(previous);
      return res.json({ ok: true });
    }

    const photo = all.find((p) => p.url === body.url);
    if (!photo) return res.status(404).json({ error: "Photo not found." });

    if (body.action === "caption") {
      photo.caption = String(body.caption || "").slice(0, 200);
      await writeManifest(manifest, blobs);
      return res.json({ ok: true });
    }
    if (body.action === "remove") {
      for (const id of Object.keys(manifest.jobs)) {
        manifest.jobs[id] = manifest.jobs[id].filter((p) => p.url !== body.url);
      }
      await writeManifest(manifest, blobs);
      await del(body.url);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("photos error", err?.message);
    return res.status(500).json({ error: "Photo storage isn't available right now." });
  }
}
