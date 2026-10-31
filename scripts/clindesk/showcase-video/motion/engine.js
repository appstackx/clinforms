/* Frame-accurate motion engine for the ClinDesk showcase. window.init(TL) builds the layers; await window.seek(t) poses
   every layer for time t (seconds) and resolves when all images for that frame are decoded. Nothing is time-driven by
   the browser: no CSS transitions or animations are used. */
(() => {
  const stage = document.getElementById("stage");
  const capEl = document.getElementById("cap");
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    lin: (x) => x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    in: (x) => x * x * x,
  };
  let TL = null;
  const els = [];
  const imgCache = new Map();

  function frameUrl(L, t) {
    // t = seconds into the take; L.n frames at 30 fps
    const k = Math.max(0, Math.min(L.n - 1, Math.round(t * 30)));
    return `${L.seq}/${String(k).padStart(5, "0")}.jpg`;
  }
  function setImg(img, url) {
    if (img.__src === url) return null;
    img.__src = url;
    img.src = url;
    return img.decode().catch(() => {});
  }
  /** Envelope 0..1 for a layer: fade/transform in over `inDur`, out over `outDur`. */
  function env(L, t) {
    const a = clamp((t - L.start) / (L.inDur ?? 0.5));
    const b = clamp((L.end - t) / (L.outDur ?? 0.4));
    return { a, b, k: Math.min(a, b) };
  }

  function camAt(L, lt) {
    const cam = L.cam || [{ t: 0, cx: L.W / 2, cy: L.H / 2, z: 1 }];
    const dur = L.end - L.start;
    const u = dur > 0 ? lt / dur : 0;
    if (u <= cam[0].t) return cam[0];
    for (let i = 1; i < cam.length; i++) {
      if (u <= cam[i].t) {
        const p = cam[i - 1], q = cam[i];
        const k = (E[q.ease || "inout"])(clamp((u - p.t) / (q.t - p.t)));
        return { cx: lerp(p.cx, q.cx, k), cy: lerp(p.cy, q.cy, k), z: lerp(p.z, q.z, k) };
      }
    }
    return cam[cam.length - 1];
  }
  /** Map a source rect [x,y,w,h] (take pixels) to stage pixels through layer L's camera at stage time t. */
  function mapRect(L, t, r) {
    const lt = t - L.start;
    const c = camAt(L, lt);
    const s0 = L.box.w / L.W;
    const s = s0 * c.z;
    let left = L.box.w / 2 - c.cx * s, top = L.box.h / 2 - c.cy * s;
    left = Math.min(0, Math.max(L.box.w - L.W * s, left));
    top = Math.min(0, Math.max(L.box.h - L.H * s, top));
    return { x: L.box.x + left + r[0] * s, y: L.box.y + top + r[1] * s, w: r[2] * s, h: r[3] * s, s, left, top };
  }

  const builders = {
    ground(L) {
      const d = document.createElement("div");
      d.className = "layer ground " + (L.cls || "");
      d.style.background = L.color;
      return d;
    },
    app(L) {
      const d = document.createElement("div");
      d.className = "layer panel " + (L.cls || "");
      Object.assign(d.style, { left: L.box.x + "px", top: L.box.y + "px", width: L.box.w + "px", height: L.box.h + "px" });
      const img = document.createElement("img");
      img.width = L.W; img.height = L.H;
      d.appendChild(img);
      d.__img = img;
      return d;
    },
    phone(L) {
      const d = document.createElement("div");
      d.className = "layer phone";
      Object.assign(d.style, { left: L.box.x + "px", top: L.box.y + "px", width: L.box.w + "px", height: L.box.h + "px" });
      d.innerHTML = `<div class="scr"><img></div><div class="notch"></div>`;
      d.__img = d.querySelector("img");
      return d;
    },
    html(L) {
      const d = document.createElement("div");
      d.className = "layer " + (L.cls || "");
      d.innerHTML = L.html;
      if (L.box) Object.assign(d.style, { left: L.box.x + "px", top: L.box.y + "px", width: L.box.w ? L.box.w + "px" : "", height: L.box.h ? L.box.h + "px" : "" });
      if (L.style) Object.assign(d.style, L.style);
      d.__anims = [...d.querySelectorAll("[data-in]")];
      return d;
    },
    ring(L) {
      const d = document.createElement("div");
      d.className = "layer ring";
      return d;
    },
  };

  function animChildren(d, lt, L) {
    for (const el of d.__anims) {
      const tin = parseFloat(el.dataset.in);
      const dur = parseFloat(el.dataset.dur || "0.6");
      const kind = el.dataset.anim || "rise";
      const p = (E[el.dataset.ease || (kind === "pop" ? "back" : "out")])(clamp((lt - tin) / dur));
      const tout = el.dataset.out !== undefined ? parseFloat(el.dataset.out) : null;
      const q = tout !== null ? 1 - E.inout(clamp((lt - tout) / 0.4)) : 1;
      const dist = parseFloat(el.dataset.dist || "50");
      const base = el.dataset.base || "";
      if (kind === "rise") { el.style.opacity = p * q; el.style.transform = `${base} translateY(${(1 - p) * dist - (1 - q) * 20}px)`; }
      else if (kind === "fade") { el.style.opacity = p * q; }
      else if (kind === "ghost") { el.style.opacity = 0.18 + 0.82 * p; el.style.transform = `${base} translateY(${(1 - p) * 14}px)`; }
      else if (kind === "left") { el.style.opacity = p * q; el.style.transform = `${base} translateX(${(1 - p) * -dist}px)`; }
      else if (kind === "right") { el.style.opacity = p * q; el.style.transform = `${base} translateX(${(1 - p) * dist}px)`; }
      else if (kind === "pop") { el.style.opacity = clamp(p * 2) * q; el.style.transform = `${base} scale(${0.6 + 0.4 * p})`; }
      else if (kind === "wipe") { el.style.opacity = q; el.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; }
      else if (kind === "wipeup") { el.style.opacity = q; el.style.clipPath = `inset(${(1 - p) * 100}% 0 0 0)`; }
      else if (kind === "draw") { el.style.strokeDasharray = "1"; el.style.strokeDashoffset = String(1 - p); el.style.opacity = q; }
      else if (kind === "count") {
        const from = parseFloat(el.dataset.from), to = parseFloat(el.dataset.to);
        const v = from + (to - from) * p;
        el.textContent = (el.dataset.fmt || "{}").replace("{}", el.dataset.pad ? String(Math.round(v)).padStart(+el.dataset.pad, "0") : String(Math.round(v)));
      } else if (kind === "type") {
        const full = el.dataset.text;
        el.textContent = full.slice(0, Math.round(full.length * p));
        el.style.opacity = q;
      }
    }
  }

  function pose(L, d, t) {
    const on = t >= L.start && t < L.end;
    d.style.display = on ? "" : "none";
    if (!on) return null;
    const lt = t - L.start;
    const { a, b, k } = env(L, t);
    const enter = L.enter || "fade";
    const exit = L.exit || "fade";
    const ea = E.out(a), eb = E.inout(b);
    let tf = "", op = 1;
    if (enter === "fade") op *= ea;
    else if (enter === "rise") { op *= clamp(ea * 1.6); tf += ` translateY(${(1 - ea) * 70}px) scale(${0.955 + 0.045 * ea}) rotateX(${(1 - ea) * 7}deg)`; }
    else if (enter === "drop") { op *= clamp(ea * 1.6); tf += ` translateY(${(1 - ea) * -60}px) scale(${1.04 - 0.04 * ea})`; }
    else if (enter === "left") { op *= clamp(ea * 1.6); tf += ` translateX(${(1 - ea) * -140}px)`; }
    else if (enter === "right") { op *= clamp(ea * 1.6); tf += ` translateX(${(1 - ea) * 140}px)`; }
    else if (enter === "slideup") { tf += ` translateY(${(1 - ea) * 1100}px)`; }
    else if (enter === "pop") { const p = E.back(a); op *= clamp(a * 2); tf += ` scale(${0.85 + 0.15 * p})`; }
    else if (enter === "cut") {}
    if (exit === "fade") op *= eb;
    else if (exit === "sink") { op *= eb; tf += ` translateY(${(1 - eb) * 40}px) scale(${0.97 + 0.03 * eb})`; }
    else if (exit === "up") { tf += ` translateY(${(1 - eb) * -1100}px)`; }
    else if (exit === "left") { op *= eb; tf += ` translateX(${(1 - eb) * -160}px)`; }
    else if (exit === "cut") {}
    if (L.float) { const f = L.float; tf += ` translate(${Math.sin(lt * 0.5) * f}px, ${Math.cos(lt * 0.4) * f}px)`; }
    if (L.tilt) tf += ` rotate(${L.tilt}deg)`;
    if (L.dim) { const dk = L.dim; d.style.filter = `brightness(${1 - dk.v * E.inout(clamp((lt - dk.at) / 0.4))})`; }
    d.style.opacity = op;
    d.style.transform = (L.bt || "") + tf;
    let wait = null;
    if (L.type === "app" || L.type === "phone") {
      const ft = L.freezeAt !== undefined ? L.freezeAt : L.from + Math.min(lt * (L.rate || 1), (L.maxT ?? 1e9) - L.from);
      wait = setImg(d.__img, frameUrl(L, ft));
      if (L.type === "app") {
        const r = mapRect(L, t, [0, 0, L.W, L.H]);
        d.__img.style.transform = `translate(${r.left}px, ${r.top}px) scale(${r.s})`;
      } else {
        d.__img.style.width = "100%";
      }
    }
    if (L.type === "ring") {
      const host = TL.layers.find((x) => x.id === L.on);
      const r0 = mapRect(host, t, L.rect);
      const pad = L.pad ?? 10;
      const bx = host.box, x1 = Math.max(r0.x, bx.x + pad + 2), y1 = Math.max(r0.y, bx.y + pad + 2), x2 = Math.min(r0.x + r0.w, bx.x + bx.w - pad - 2), y2 = Math.min(r0.y + r0.h, bx.y + bx.h - pad - 2);
      const r = { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
      Object.assign(d.style, { left: r.x - pad + "px", top: r.y - pad + "px", width: r.w + 2 * pad + "px", height: r.h + 2 * pad + "px" });
      const p = E.back(clamp(lt / 0.45));
      d.style.transform = `scale(${1.25 - 0.25 * p})`;
      d.style.opacity = clamp(lt / 0.2) * eb;
    }
    if (L.follow) {
      // an html layer positioned relative to a source rect of an app layer
      const host = TL.layers.find((x) => x.id === L.follow.on);
      const r = mapRect(host, t, L.follow.rect);
      const fx = L.follow.ax ?? 0, fy = L.follow.ay ?? 0;
      d.style.left = r.x + r.w * fx + (L.follow.dx || 0) + "px";
      d.style.top = r.y + r.h * fy + (L.follow.dy || 0) + "px";
    }
    if (d.__anims && d.__anims.length) animChildren(d, lt, L);
    return wait;
  }

  /** QA: visible text boxes (labels, callouts, tags, card text, phone) that intersect the caption pill. */
  window.capOverlaps = () => {
    const pill = capEl.querySelector(".pill");
    if (!pill) return [];
    const c = pill.getBoundingClientRect();
    const hits = [];
    TL.layers.forEach((L, i) => {
      const d = els[i];
      if (d.style.display === "none" || parseFloat(d.style.opacity || "1") < 0.05) return;
      if (L.type === "app" || L.type === "ground" || L.type === "ring") return;
      const nodes = L.type === "phone" ? [d] : [...d.querySelectorAll("*")].filter((e) => e.children.length === 0 && (e.textContent.trim() || e.tagName === "IMG" || e.tagName === "svg"));
      for (const e of nodes) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        let o = 1; for (let x = e; x && x !== document.body; x = x.parentElement) o *= parseFloat(getComputedStyle(x).opacity);
        if (o < 0.05) continue;
        if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) hits.push(`${L.id}:${(e.textContent || e.tagName).trim().slice(0, 40)}`);
      }
    });
    return hits;
  };
  window.init = (tl) => {
    TL = tl;
    stage.innerHTML = "";
    els.length = 0;
    tl.layers.forEach((L, i) => {
      const d = builders[L.type](L);
      d.style.zIndex = String(L.z ?? i);
      d.style.display = "none";
      stage.appendChild(d);
      els.push(d);
    });
    return document.fonts.ready.then(() => true);
  };
  window.seek = async (t) => {
    const waits = [];
    TL.layers.forEach((L, i) => { const w = pose(L, els[i], t); if (w) waits.push(w); });
    // captions
    const ci = TL.captions.findIndex((q) => t >= q.start && t < q.end);
    const c = ci >= 0 ? TL.captions[ci] : null;
    const html = c ? `<span class="pill">${c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>` : "";
    if (capEl.__h !== html) { capEl.innerHTML = html; capEl.__h = html; }
    if (c) {
      const prev = TL.captions[ci - 1], next = TL.captions[ci + 1];
      const fin = !(prev && c.start - prev.end < 0.06), fout = !(next && next.start - c.end < 0.06);
      capEl.style.opacity = Math.min(fin ? clamp((t - c.start) / 0.15) : 1, fout ? clamp((c.end - t) / 0.15) : 1);
    }
    await Promise.all(waits);
    return true;
  };
})();
