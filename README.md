# jonathan-castro.com

Personal portfolio and live-running tools site by **Jonathan Castro**.

Hosted on GitHub Pages, backed by a self-managed Debian 13 server
(`api.jonathan-castro.com`) that runs the APIs powering the interactive
pages.

**Live:** https://jonathan-castro.com

---

## 🗂️ Pages

| Path | What it is |
|---|---|
| `/home/` | Landing page — who I am, what I build, what lives on the site. |
| `/security-ops/` | **Security Operations Center.** An interconnected dashboard that merges five security tools (LAN discovery, vulnerability scanning, network traffic analysis, SIEM log analysis, threat visualization) into a single workspace where the tools **share state**. Discovery feeds scans, scan findings feed the threat graph, and cross-tool correlations surface automatically. |
| `/homelab/` | Live homelab dashboard — CPU, memory, disk, temps, service health, network. |
| `/finance/` | Finance hub — market tracking plus personal budgeting (Plaid-backed). |
| `/tech-news/` | Curated tech-news aggregator with source filtering and search. |

---

## 🏗️ Architecture

### Frontend (this repo)
- Hand-written HTML, CSS, and vanilla JavaScript — no framework, no build step.
- `navigation.js` injects the global nav on every page from a single config.
- `navigation.css` holds the shared design tokens (ember palette, type stack,
  motion easings, breakpoints) — imported by every page.
- `shared.js` exposes `window.SOCState`, a pub/sub state bus used by every
  tool on the Security Ops page. State is persisted to `localStorage` so it
  survives page reloads.
- Each page folder owns its own `index.html`, `styles.css`, and `scripts.js`.

### Backend (separate repo, same server)
- Debian 13 on a self-managed box.
- Node.js services exposed at `api.jonathan-castro.com`.
- MariaDB for persistent storage.
- nginx reverse-proxy in front of the Node services, TLS terminated at the edge.
- Cloudflare in front of everything — DNS, CDN, security headers, rate limiting.

### Hosting
- Repo pushed to GitHub → GitHub Pages serves `jonathan-castro.com`.
- `CNAME` file configures the apex custom domain.
- DNS managed in Cloudflare.
- Backend API is reached from the frontend via HTTPS — no CORS gymnastics because
  Cloudflare fronts both origins.

---

## 📁 File layout

```
site/
├── index.html              ← root redirect to /home/
├── _config.yml             ← Jekyll pass-through config
├── CNAME                   ← apex custom domain
├── navigation.js           ← master nav controller (single source of truth)
├── navigation.css          ← design tokens + nav styles (site-wide)
├── shared.js               ← SOCState bus (heart of the Security Ops page)
├── assets/                 ← logos, favicon, background videos
├── home/                   ← page 1
├── security-ops/           ← page 2 (the interconnected SOC)
├── homelab/                ← page 3
├── finance/                ← page 4
└── tech-news/              ← page 5
```

Every page folder holds exactly three files: `index.html`, `styles.css`,
`scripts.js`. Scoped styling keeps pages independent, while global tokens
in `navigation.css` keep the whole site visually coherent.

---

## 🎨 Design

Dark, ember-accented aesthetic. Orange-red accent (`#ff6b35`) on a near-black
surface palette. Typography pairs **Rajdhani** for display, **Inter** for body,
and **JetBrains Mono** for code and data. Every interactive element has a
keyboard focus ring, and the site respects `prefers-reduced-motion`.

---

## ⚙️ Local development

No build step — just serve the folder with any static server:

```bash
cd site
python -m http.server 8000
# then open http://localhost:8000/home/
```

Pages that hit the API require `api.jonathan-castro.com` to be reachable —
since that endpoint is publicly exposed, local development works out of the
box without tunneling.

---

## 📄 License

All rights reserved. Source is public for portfolio viewing and is **not**
licensed for reuse, redistribution, or derivative works without written
permission.

---

*Site and tools designed and built by Jonathan Castro.*
