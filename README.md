# MINT Lab Website

Ghost CMS theme for [mintresearch.org](https://mintresearch.org). Ported from the original static site design.

## Editing Content

Most content is managed through the **Ghost admin panel** at `https://mintresearch.org/ghost/`.

- **Publications, Events, News** — create/edit Posts, tag them `publication`, `event`, or `news`
- **Newsletter issues** — created automatically by the yesterday-in-ai daemon (tagged `yesterday-in-ai`)
- **About page** — edit the page tagged `#about` in Ghost admin
- **Research projects** — edit pages tagged `#research-project`

### People

The lab roster lives in `assets/data/people.json` in this repo. To update:

1. Edit `assets/data/people.json` — add/remove/update entries in `team`, `affiliates`, or `alumni`
2. Commit and push
3. Re-upload the theme (see below)

Each person entry:
```json
{
  "name": "Full Name",
  "role": "Role Title",
  "discipline": "Field",
  "bio": "Optional bio text",
  "photo": "assets/images/firstname-lastname.jpg",
  "links": [
    { "abbr": "Web", "url": "https://..." },
    { "abbr": "GS", "url": "https://scholar.google.com/..." }
  ]
}
```

Link abbreviations: `Web` (personal site), `LI` (LinkedIn), `PP` (PhilPeople), `GS` (Google Scholar).

### Images

Team photos go in `assets/images/`. Use lowercase, hyphenated filenames: `firstname-lastname.jpg`.

## Editing the Theme

The theme uses [Ghost Handlebars](https://ghost.org/docs/themes/) templates.

| File | What it controls |
|---|---|
| `home.hbs` | Homepage (hero, about, research, feed, people sections) |
| `index.hbs` | Newsletter archive at `/newsletter/` |
| `post.hbs` | Individual post/newsletter issue |
| `page.hbs` | Generic pages |
| `assets/css/screen.css` | All styles |
| `assets/js/main.js` | Navigation, people rendering, feed filters |
| `partials/` | Reusable components (nav, footer, subscribe form, etc.) |

### CSS Variables

```css
--navy: #0a1628;       /* dark backgrounds, headings */
--mint: #2ec4b6;       /* primary accent */
--mint-light: #5de8da; /* hover states */
--charcoal: #2d3436;   /* body text */
--gray: #636e72;       /* secondary text */
```

## House Tracker (private page)

`/coquelin/` is a private house-furnishing tracker (template `house-tracker.hbs`,
app `assets/js/house-tracker.js`, styles `assets/css/house-tracker.css`). It is
`noindex`, unlinked, and shows only an unlock screen until a GitHub token with
access to this repo is pasted in (stored in that browser's localStorage).

State lives in `assets/data/house-tracker.json`. The page reads/writes it via
the GitHub Contents API, so edits sync across devices — and agents can edit the
JSON directly in the repo (keep the schema: each item has `id`, `room`, `name`,
`source`, `status` one of `todo|ordered|delivered|done`, `suggested`, `notes`,
`dates`). The page looks for the data file on the saved branch, then the repo
default branch. Note the repo is public, so don't put anything sensitive
(addresses, prices are fine at your discretion) in the JSON.

Deploying the tracker requires **both** a theme re-upload (see below) **and**
re-uploading `routes.yaml` (Ghost admin → Settings → Labs → Routes) because of
the new `/coquelin/` route.

## Deploying Changes

After editing theme files:

```bash
# 1. Commit your changes
git add -A && git commit -m "description of change"
git push

# 2. Zip the theme (exclude .git)
cd /path/to/mint-ghost-theme
zip -r mint-ghost-theme.zip . -x '.git/*'

# 3. Upload via Ghost admin
#    Settings → Design → Change theme → Upload theme → select the zip
```

Or ask Minty to deploy — the migration script can upload the theme automatically.

## Local Preview

Ghost runs locally on the Mac Studio at `http://127.0.0.1:2368`. To test theme changes without deploying:

1. Edit files in this directory (it's the live theme directory)
2. Restart Ghost: `launchctl unload ~/Library/LaunchAgents/com.mintlab.ghost.plist && launchctl load ~/Library/LaunchAgents/com.mintlab.ghost.plist`
3. Visit `http://127.0.0.1:2368` (add header `X-Forwarded-Proto: https` or use a browser extension)

## Architecture

- **Ghost v6.19.3** on Node 22 LTS, MySQL 9.6
- **Cloudflare Tunnel** routes `mintresearch.org` → `localhost:2368`
- **Launchd daemons**: `com.mintlab.ghost` (Ghost CMS), `com.mintlab.cloudflared` (tunnel)
- **Newsletter delivery**: Ghost handles subscriber management and email via Mailgun (pending setup)

## Routes

| URL | What | Source |
|---|---|---|
| `/` | Homepage (single-page scroll) | `home.hbs` |
| `/newsletter/` | Newsletter archive | `index.hbs`, posts tagged `yesterday-in-ai` |
| `/newsletter/{slug}/` | Individual newsletter issue | `post.hbs` |
| `/feed/` | Publications, events, news | `index.hbs`, posts not tagged newsletter |
| `/feed/{slug}/` | Individual feed item | `post.hbs` |
| `/ghost/` | Admin panel | Ghost built-in |
