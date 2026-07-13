# mint-website

> **What this repo actually is (July 2026):** the home of **Summer Camps for
> Kids Who Aren't Sporty** (camps.mintresearch.org) and the family **house
> tracker** web app, plus the *retired* Ghost theme that used to power
> mintresearch.org. The live MINT Lab site is **not** served from this repo —
> it's an Astro static site on GitHub Pages from
> [`mint-philosophy/mintresearch.org`](https://github.com/mint-philosophy/mintresearch.org).

## How mintresearch.org is actually deployed (verified 2026-07-13)

| Host | What serves it | Evidence |
|---|---|---|
| `mintresearch.org` (+ `www`) | GitHub Pages, Astro static site from the `mintresearch.org` repo | `server: GitHub.com` headers, `/_astro/*.css` assets, apex A records 185.199.108–111.153; `/ghost/` returns 404 |
| `curator.mintresearch.org` | Separate app behind **Cloudflare Access** (email login) | 302 to `mintresearch.cloudflareaccess.com/cdn-cgi/access/login/...` |
| `camps.mintresearch.org` | **This repo** — GitHub Pages from the `gh-pages` branch | Custom domain registered via CNAME file; DNS record pending (see below) |

The Ghost-on-Mac-Studio + Cloudflare-tunnel setup described in this README's
earlier versions is no longer what production runs. The Ghost theme files
(`*.hbs`, `partials/`, `routes.yaml`, `assets/css/screen.css`,
`assets/js/main.js`, `assets/data/people.json`) are kept for reference but are
**not deployed anywhere**.

---

## Summer Camps for Kids Who Aren't Sporty

A private, sign-in-gated guide to 294 DC-area summer camps for kids who'd
rather build, draw, act, write, code, dig, sail or wander.

- **Live at:** https://camps.mintresearch.org (passphrase sign-in)
- **App:** `.github/pages/index.html` + `assets/js/camps-hub.js` + `assets/css/camps-hub.css`
- **Data:** `assets/data/camps.json` — 294 providers, every entry fact-checked
  (July 2026) with a per-entry `verification_note`; 22 sports-only camps are
  hidden by default behind a toggle
- **Views:** filterable directory · 2027 registration-opens calendar ·
  kid-profile matcher · AI concierge (Claude with search tools over the
  dataset, runs in the browser on the visitor's own Anthropic API key)

### Deployment pipeline (all automatic)

1. Push to `main` touching `camps.json`, the app JS/CSS, or `.github/pages/**`
2. `.github/workflows/deploy-camps-pages.yml` assembles the static site and
   force-pushes the `gh-pages` branch (CNAME `camps.mintresearch.org` baked in)
3. GitHub Pages publishes it (the "pages build and deployment" run)
4. `.github/workflows/verify-camps-pages.yml` (manual or on edit) runs a real
   Chromium against the live site: login wall, card counts, search, no JS errors
5. `.github/workflows/site-recon.yml` (manual or on edit) surveys what all the
   `mintresearch.org` hosts actually serve

A **weekly Routine** (Mondays 13:00 UTC, runs as a fresh Claude session)
re-verifies availability, watches for 2027 registration-date announcements,
closes entries from the dataset's `known_gaps` list, and pushes data-only
commits to `main` — which triggers step 1, so the live site stays current
with no manual steps.

### DNS (the one manual step, still pending)

In Cloudflare DNS for `mintresearch.org`, add:

```
CNAME  camps  →  mint-philosophy.github.io   (DNS only / grey cloud)
```

GitHub auto-issues the HTTPS certificate a few minutes after the record
propagates. Optionally add a Cloudflare Access application over
`camps.mintresearch.org` for curator-style email login on top of the in-page
passphrase gate.

### Access & data model

- Sign-in: passphrase checked against the SHA-256 constant `AUTH_HASH` at the
  top of `camps-hub.js`; remembered per device; sign-out in the footer. To
  rotate: `printf '%s' 'new-pass' | openssl dgst -sha256` and replace the hash.
- The page and app are gated but `camps.json` itself is public in this repo.
- Provider schema: `id`, `name`, `org`, `org_type`, `description`,
  `categories[]`, `tags[]` (controlled vocabularies at the top of
  `camps-hub.js`), `ages`, `areas[]`, `locations`, `price_band`
  (`free|$|$$|$$$|$$$$|varies`), `price_detail`, `financial_aid`, `hours`,
  `extended_care`, `url`, `url_register`, `url_more`, `phone`, `email`,
  `reg_2027{opens,mechanism,notes}`, `status_2026`, `sessions_2026`,
  `fit_notes`, `confidence`, `verification_note`.
- "Sports-only" (hidden by default) = `categories` contains `sports` and
  nothing beyond `sports`/`general-day-camp`.

---

## House tracker (`/coquelin/` — not currently deployed)

A private furnishing/move-in tracker: `house-tracker.hbs` +
`assets/js/house-tracker.js` + `assets/css/house-tracker.css`, state in
`assets/data/house-tracker.json` read/written through the GitHub Contents API
with a fine-grained PAT (so edits sync across devices and agents can edit the
JSON directly). Item schema: `id`, `room`, `name`, `source`, `status`
(`todo|ordered|delivered|done`), `suggested`, `notes`, `dates`, `priority`
(`urgent|normal|later`), `container` (owned goods arriving by sea — shown as
Coming → Arrived → In place).

It was built as a Ghost route and therefore has no live URL now that Ghost is
retired. To deploy it, give it the same treatment as the camps hub (its own
Pages workflow + subdomain) — the app is already self-contained.

---

## Legacy: Ghost theme (retired)

`home.hbs`, `index.hbs`, `post.hbs`, `page.hbs`, `author.hbs`, `tag.hbs`,
`partials/`, `routes.yaml`, `assets/css/screen.css`, `assets/js/main.js` and
`assets/data/people.json` are the old Ghost 6.x theme for the previous
mintresearch.org. Nothing deploys them. If Ghost is ever revived, see the git
history of this README for the theme-upload and local-preview instructions.
