# mint-website

> **What this repo actually is (July 2026):** the *retired* Ghost theme that
> used to power mintresearch.org, plus the **state file for the house
> tracker** web app. The live MINT Lab site — including the camp guide and the
> house tracker pages — is served from
> [`mint-philosophy/mintresearch.org`](https://github.com/mint-philosophy/mintresearch.org)
> (hand-edited static HTML in `public/`, auto-deployed to GitHub Pages on
> every push to `main`).

## Where things moved

| Thing | Lives at | Source |
|---|---|---|
| Summer Camps for Kids Who Aren't Sporty | **https://camps.mintresearch.org** (canonical, passphrase sign-in); also mirrored at https://mintresearch.org/camps/ | `mintresearch.org` repo, `public/camps/` (`index.html`, `camps-hub.js`, `camps-hub.css`, `camps.json`) |
| House tracker | https://mintresearch.org/coquelin/ (GitHub-token unlock) | `mintresearch.org` repo, `public/coquelin/` — **but its state stays in this repo**, see below |

Both pages' source of truth is a folder under `public/` in the
`mintresearch.org` repo, deployed automatically by that repo's GitHub Actions
workflow on every push to `main`. Per Seth's preference, standalone apps like
the camp guide also get their own subdomain: this repo's
`.github/workflows/deploy-camps-subdomain.yml` mirrors `public/camps/` onto
the `gh-pages` branch daily (and on dispatch) with the
`camps.mintresearch.org` CNAME baked in, and GitHub Pages serves it. DNS:
Cloudflare needs `CNAME camps → mint-philosophy.github.io` (DNS only / grey
cloud); GitHub auto-issues the HTTPS cert once it propagates.

## House tracker state (the one live thing in this repo)

`assets/data/house-tracker.json` is the tracker's database. The page at
mintresearch.org/coquelin/ reads and writes it through the GitHub Contents API
with a fine-grained PAT scoped to this repo (pasted once per device, kept in
localStorage). Keeping the state here — rather than in the `mintresearch.org`
repo — means tracker saves don't trigger site deploys.

Agents may edit the JSON directly. Item schema: `id`, `room`, `name`,
`source`, `status` (`todo|ordered|delivered|done`), `suggested`, `notes`,
`dates`, `priority` (`urgent|normal|later`), `container` (owned goods arriving
by sea — shown as Coming → Arrived → In place instead of the buy pipeline).
This repo is public, so nothing sensitive in the JSON (no addresses).

## Camp guide data

`public/camps/camps.json` in the `mintresearch.org` repo — 294 providers,
fact-checked July 2026, per-entry `verification_note`, controlled category/tag
vocabularies documented at the top of `camps-hub.js`. A weekly Routine
(Mondays 13:00 UTC, fresh Claude session) re-verifies availability, watches
for 2027 registration announcements, closes `known_gaps` entries, and pushes
data-only commits — each push auto-deploys the site, so the guide stays
current with no manual steps.

Sign-in: passphrase checked against the SHA-256 constant `AUTH_HASH` at the
top of `camps-hub.js`; to rotate, `printf '%s' 'new-pass' | openssl dgst
-sha256` and replace the hash. The page is gated but `camps.json` itself is
public.

## Legacy: Ghost theme (retired)

`home.hbs`, `index.hbs`, `post.hbs`, `page.hbs`, `author.hbs`, `tag.hbs`,
`partials/`, `routes.yaml`, `assets/css/screen.css`, `assets/js/main.js` and
`assets/data/people.json` are the old Ghost 6.x theme for the previous
mintresearch.org. Nothing deploys them. If Ghost is ever revived, see the git
history of this README for the theme-upload and local-preview instructions.
