/* The DC Summer Camp Guide — public hub.
 *
 * Data lives in assets/data/camps.json in the mint-philosophy/mint-website
 * repo. The page fetches it from GitHub raw (main first, then the working
 * branch, then the theme-bundled copy) so data updates pushed by the weekly
 * refresh routine appear without a theme redeploy.
 *
 * The concierge panel talks to the Anthropic API directly from the browser
 * (user-supplied key, stored locally) and gives Claude tools to search this
 * dataset — genuine agentic recommendation over the same data the filters use.
 */
(function () {
  'use strict';

  // Private preview: page is sign-in gated for now (single user). To change the
  // passphrase, put the sha256 hex of the new one here. Note the underlying
  // camps.json is still public in the GitHub repo — this gates the app, not the data.
  var AUTH_HASH = '298ad48fce2fbb1ed100ce1abc418906dc2017d137670b9fcbed9315a0f14b21';
  var AUTH_LS = 'camps_auth_v1';

  var DATA_SOURCES = [
    'https://raw.githubusercontent.com/mint-philosophy/mint-website/main/assets/data/camps.json',
    'https://raw.githubusercontent.com/mint-philosophy/mint-website/claude/house-furnishing-tracker-uzeqcs/assets/data/camps.json',
    window.CAMPS_ASSET_URL
  ];

  var CATLABEL = {
    'theatre': 'Theatre', 'music': 'Music', 'visual-arts': 'Visual arts', 'film-media': 'Film & media',
    'maker-stem': 'Maker & STEM', 'coding': 'Coding', 'writing': 'Writing', 'academics': 'Academics',
    'debate-civics': 'Debate & civics', 'history-museum': 'History & museums', 'nature-outdoors': 'Nature & outdoors',
    'farm-animals': 'Farm & animals', 'adventure': 'Adventure', 'sailing-paddling': 'Sailing & paddling',
    'general-day-camp': 'General day camp', 'sports': 'Sports', 'dance-movement': 'Dance & movement',
    'circus': 'Circus', 'chess-games': 'Chess & games', 'language-culture': 'Language & culture',
    'cooking': 'Cooking', 'leadership-cit': 'Leadership & CIT', 'volunteering': 'Volunteering',
    'overnight': 'Overnight', 'faith-based': 'Faith-based', 'special-needs': 'Special needs'
  };
  var PRICELABEL = { 'free': 'Free', '$': 'Under $250/wk', '$$': '$250-450/wk', '$$$': '$450-700/wk', '$$$$': '$700+/wk', 'varies': 'Varies' };
  var ORGLABEL = { government: 'Government', nonprofit: 'Nonprofit', private: 'Private', university: 'University', museum: 'Museum', religious: 'Religious', school: 'School-run' };

  var state = {
    data: null,
    q: '',
    cats: {},
    org: 'all',
    price: 'all',
    area: 'all',
    age: '',
    need: {},           // financial-aid, aftercare, beginner-friendly, teen-program, special-needs-inclusive, overnight
    showSports: false,  // site theme: camps for kids who aren't sporty — sports-first camps opt-in
    view: 'directory',  // directory | calendar | match | concierge
    expanded: {},
    chat: [],
    chatBusy: false
  };

  // "Sports-first" = nothing to offer a non-sporty kid: only sports (plus at
  // most generic day-camp filler). Sports+arts, sports+adventure etc. stay.
  function sportsFirst(p) {
    var c = p.categories || [];
    return c.indexOf('sports') > -1 && c.every(function (x) { return x === 'sports' || x === 'general-day-camp'; });
  }

  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- data loading ---------------- */

  function load(i) {
    if (i >= DATA_SOURCES.length) {
      app.innerHTML = '<div class="shell"><p class="err">Could not load the camp dataset. Refresh to retry.</p></div>';
      return;
    }
    fetch(DATA_SOURCES[i] + (DATA_SOURCES[i].indexOf('raw.githubusercontent') > -1 ? '?t=' + Date.now() : ''))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        d.providers.forEach(function (p, idx) {
          p.id = p.id || (p.name || 'p').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'p' + idx;
        });
        state.data = d;
        render();
      })
      .catch(function () { load(i + 1); });
  }

  /* ---------------- search & filter ---------------- */

  function ageFits(p, age) {
    // ages is free text: "6-14", "entering grades 9-11", "Pre-K through grade 12".
    // Grade ranges convert to approximate ages (grade N ≈ ages N+5 to N+6).
    var s = String(p.ages || '');
    var re = /(ages?\s*)?(grades?\s*)?(\d+)\s*(?:-|–|to|through)\s*(?:grades?\s*)?(\d+)/ig;
    var m, best = null;
    while ((m = re.exec(s)) !== null) {
      var isGrade = !!m[2] || /grade/i.test(s.slice(Math.max(0, m.index - 12), m.index));
      var lo = parseInt(m[3], 10), hi = parseInt(m[4], 10);
      if (isGrade) { lo += 5; hi += 6; }
      if (!best) best = { lo: lo, hi: hi, aged: !!m[1] && !isGrade };
      else if (!!m[1] && !isGrade && !best.aged) best = { lo: lo, hi: hi, aged: true };
      else if (!best.aged) { best.lo = Math.min(best.lo, lo); best.hi = Math.max(best.hi, hi); }
    }
    if (!best) return true; // unknown — don't exclude
    return age >= best.lo - 0.5 && age <= best.hi + 0.5;
  }

  function searchScore(p, q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return 1;
    var name = (p.name + ' ' + (p.org || '')).toLowerCase();
    var meta = ((p.categories || []).join(' ') + ' ' + (p.tags || []).join(' ')).toLowerCase();
    var body = ((p.description || '') + ' ' + (p.fit_notes || '') + ' ' + (p.areas || []).join(' ') + ' ' + (p.locations || '')).toLowerCase();
    var score = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var hit = 0;
      if (name.indexOf(t) > -1) hit += 5;
      if (meta.indexOf(t) > -1) hit += 3;
      if (body.indexOf(t) > -1) hit += 2;
      if (!hit) return 0; // AND semantics
      score += hit;
    }
    return score;
  }

  function activeCats() {
    return Object.keys(state.cats).filter(function (k) { return state.cats[k]; });
  }

  function filtered() {
    var cats = activeCats();
    var needs = Object.keys(state.need).filter(function (k) { return state.need[k]; });
    var age = state.age === '' ? null : parseFloat(state.age);
    var sportsOverride = state.showSports || state.cats['sports'];
    return state.data.providers
      .map(function (p) { return { p: p, s: searchScore(p, state.q) }; })
      .filter(function (x) {
        var p = x.p;
        if (x.s === 0) return false;
        if (!sportsOverride && sportsFirst(p)) return false;
        if (cats.length && !cats.some(function (c) { return (p.categories || []).indexOf(c) > -1; })) return false;
        if (state.org !== 'all' && p.org_type !== state.org) return false;
        if (state.price !== 'all' && p.price_band !== state.price) return false;
        if (state.area !== 'all' && (p.areas || []).indexOf(state.area) === -1 && (p.areas || []).indexOf('Multiple') === -1) return false;
        if (age != null && !ageFits(p, age)) return false;
        for (var i = 0; i < needs.length; i++) {
          if ((p.tags || []).indexOf(needs[i]) === -1) return false;
        }
        return true;
      })
      .sort(function (a, b) { return b.s - a.s || a.p.name.localeCompare(b.p.name); })
      .map(function (x) { return x.p; });
  }

  /* ---------------- card rendering ---------------- */

  function chip(txt, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(txt) + '</span>'; }

  function card(p) {
    var open = !!state.expanded[p.id];
    var cats = (p.categories || []).map(function (c) { return chip(CATLABEL[c] || c, 'cat'); }).join('');
    var reg = p.reg_2027 || {};
    var links = '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">Official site ↗</a>';
    if (p.url_register) links += ' <a href="' + esc(p.url_register) + '" target="_blank" rel="noopener">Register ↗</a>';
    if (p.url_more) links += ' <a href="' + esc(p.url_more) + '" target="_blank" rel="noopener">More info ↗</a>';

    var details = '';
    if (open) {
      details =
        '<dl class="detail">' +
        (p.locations ? '<dt>Locations</dt><dd>' + esc(p.locations) + '</dd>' : '') +
        (p.hours ? '<dt>Hours</dt><dd>' + esc(p.hours) + (p.extended_care ? ' · ' + esc(p.extended_care) : '') + '</dd>' : '') +
        (p.price_detail ? '<dt>Cost detail</dt><dd>' + esc(p.price_detail) + '</dd>' : '') +
        (p.financial_aid ? '<dt>Financial aid</dt><dd>' + esc(p.financial_aid) + '</dd>' : '') +
        (p.sessions_2026 ? '<dt>2026 sessions</dt><dd>' + esc(p.sessions_2026) + '</dd>' : '') +
        (p.fit_notes ? '<dt>Who it suits</dt><dd>' + esc(p.fit_notes) + '</dd>' : '') +
        ((p.phone || p.email) ? '<dt>Contact</dt><dd>' + esc([p.phone, p.email].filter(Boolean).join(' · ')) + '</dd>' : '') +
        '<dt>Tags</dt><dd class="tagline">' + (p.tags || []).map(function (t) { return chip(t, 'tag'); }).join('') + '</dd>' +
        (p.confidence !== 'high' ? '<dt>Confidence</dt><dd>' + esc(p.confidence) + ' — verify details with the provider</dd>' : '') +
        '</dl>';
    }

    return '<article class="card" id="c-' + esc(p.id) + '">' +
      '<div class="card-top">' + chip(ORGLABEL[p.org_type] || p.org_type, 'org') + chip(PRICELABEL[p.price_band] || p.price_band, 'price') +
        ((p.tags || []).indexOf('financial-aid') > -1 || (p.tags || []).indexOf('sliding-scale') > -1 || p.price_band === 'free' ? chip('aid available', 'aid') : '') +
      '</div>' +
      '<h3>' + esc(p.name) + '</h3>' +
      (p.org && p.org !== p.name ? '<div class="org-line">' + esc(p.org) + '</div>' : '') +
      '<div class="cats">' + cats + '</div>' +
      '<p class="desc">' + esc(p.description) + '</p>' +
      '<dl class="facts">' +
        '<dt>Ages</dt><dd>' + esc(p.ages) + '</dd>' +
        '<dt>Where</dt><dd>' + esc((p.areas || []).join(', ')) + '</dd>' +
        '<dt>2026</dt><dd>' + esc(p.status_2026 || 'unknown') + '</dd>' +
        '<dt>2027</dt><dd>' + esc('Registration ' + (reg.opens ? 'opens ' + reg.opens : 'timing unknown') + (reg.mechanism ? ' · ' + reg.mechanism : '')) + '</dd>' +
      '</dl>' +
      details +
      '<div class="card-foot">' +
        '<span class="links">' + links + '</span>' +
        '<button class="mini" data-act="expand" data-id="' + esc(p.id) + '">' + (open ? 'Less' : 'Details') + '</button>' +
      '</div>' +
    '</article>';
  }

  /* ---------------- views ---------------- */

  function directoryView() {
    var list = filtered();
    var allAreas = {};
    state.data.providers.forEach(function (p) { (p.areas || []).forEach(function (a) { allAreas[a] = 1; }); });
    var catCounts = {};
    state.data.providers.forEach(function (p) { (p.categories || []).forEach(function (c) { catCounts[c] = (catCounts[c] || 0) + 1; }); });

    var html = '<div class="filters">' +
      '<div class="frow">' +
        '<input id="q" type="search" placeholder="Search camps, interests, neighborhoods…" value="' + esc(state.q) + '">' +
        '<input id="age" type="number" min="2" max="18" placeholder="Kid’s age" value="' + esc(state.age) + '">' +
        '<select id="org"><option value="all">Any provider type</option>' +
          Object.keys(ORGLABEL).map(function (k) { return '<option value="' + k + '"' + (state.org === k ? ' selected' : '') + '>' + ORGLABEL[k] + '</option>'; }).join('') +
        '</select>' +
        '<select id="price"><option value="all">Any price</option>' +
          Object.keys(PRICELABEL).map(function (k) { return '<option value="' + esc(k) + '"' + (state.price === k ? ' selected' : '') + '>' + PRICELABEL[k] + '</option>'; }).join('') +
        '</select>' +
        '<select id="area"><option value="all">Any area</option>' +
          Object.keys(allAreas).sort().map(function (a) { return '<option value="' + esc(a) + '"' + (state.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="frow cats-row">' +
        Object.keys(CATLABEL).filter(function (c) { return catCounts[c]; }).map(function (c) {
          return '<button class="fchip' + (state.cats[c] ? ' on' : '') + '" data-act="cat" data-cat="' + c + '">' + CATLABEL[c] + ' <small>' + catCounts[c] + '</small></button>';
        }).join('') +
      '</div>' +
      '<div class="frow needs-row">' +
        [['financial-aid', 'Financial aid'], ['aftercare', 'Aftercare'], ['beginner-friendly', 'Beginner-friendly'], ['teen-program', 'Teens 13+'], ['special-needs-inclusive', 'Special-needs inclusive'], ['overnight', 'Overnight'], ['late-availability-2026', 'Openings now (2026)']].map(function (n) {
          return '<button class="fchip need' + (state.need[n[0]] ? ' on' : '') + '" data-act="need" data-need="' + n[0] + '">' + n[1] + '</button>';
        }).join('') +
        '<button class="fchip sporty' + (state.showSports ? ' on' : '') + '" data-act="sports" title="This guide hides camps that are only about sports; toggle to see them">' +
          (state.showSports ? 'Hide' : 'Show') + ' sports-only camps (' + state.data.providers.filter(sportsFirst).length + ')' +
        '</button>' +
        '<span class="count">' + list.length + ' of ' + state.data.providers.length + '</span>' +
      '</div>' +
    '</div>';

    html += '<div class="grid">' + list.map(card).join('') + '</div>';
    if (!list.length) html += '<p class="empty">Nothing matches — widen the filters, or ask the concierge.</p>';
    return html;
  }

  function monthIndex(txt) {
    var months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    var t = String(txt || '').toLowerCase();
    for (var i = 0; i < months.length; i++) if (t.indexOf(months[i]) > -1) return i;
    return -1;
  }

  function calendarView() {
    var buckets = {};
    state.data.providers.forEach(function (p) {
      var reg = p.reg_2027 || {};
      var mi = monthIndex(reg.opens);
      var key = mi === -1 ? 'Timing unknown / rolling' : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mi];
      (buckets[key] = buckets[key] || []).push(p);
    });
    var order = ['October', 'November', 'December', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'Timing unknown / rolling'];
    var html = '<p class="lead">When 2027 registration opens, by month — the DC camp year effectively starts in December. Set reminders; the lottery camps and nature camps are gone within days.</p><div class="tl">';
    order.forEach(function (m) {
      if (!buckets[m]) return;
      html += '<div class="tl-month"><h3>' + m + '</h3><ul>' +
        buckets[m].sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (p) {
          var reg = p.reg_2027 || {};
          return '<li><a href="#" data-act="jump" data-id="' + esc(p.id) + '"><b>' + esc(p.name) + '</b></a> — ' +
            esc(reg.mechanism || '') + (reg.notes ? '. ' + esc(reg.notes) : '') + '</li>';
        }).join('') + '</ul></div>';
    });
    return html + '</div>';
  }

  function matchView() {
    var catOpts = Object.keys(CATLABEL).map(function (c) { return '<option value="' + c + '">' + CATLABEL[c] + '</option>'; }).join('');
    return '<p class="lead">Answer a few questions and get a ranked shortlist scored against every camp in the dataset. For anything more nuanced, use the concierge.</p>' +
      '<form id="match-form" class="match-form">' +
        '<label>Kid’s age <input name="age" type="number" min="2" max="18" required></label>' +
        '<label>Top interest <select name="c1"><option value="">—</option>' + catOpts + '</select></label>' +
        '<label>Second interest <select name="c2"><option value="">—</option>' + catOpts + '</select></label>' +
        '<label>Third interest <select name="c3"><option value="">—</option>' + catOpts + '</select></label>' +
        '<label>Budget <select name="budget"><option value="">Any</option><option value="free">Free only</option><option value="$">Up to ~$250/wk</option><option value="$$">Up to ~$450/wk</option><option value="$$$">Up to ~$700/wk</option></select></label>' +
        '<label><input type="checkbox" name="beginner"> Total beginner — no experience</label>' +
        '<label><input type="checkbox" name="aftercare"> Needs aftercare (working parents)</label>' +
        '<label><input type="checkbox" name="aid"> Needs financial aid</label>' +
        '<label><input type="checkbox" name="inclusive"> Needs special-needs support</label>' +
        '<button type="submit">Rank the camps</button>' +
      '</form><div id="match-results"></div>';
  }

  function runMatch(form) {
    var age = parseFloat(form.elements.age.value);
    var wants = [form.elements.c1.value, form.elements.c2.value, form.elements.c3.value].filter(Boolean);
    var budget = form.elements.budget.value;
    var budgetRank = { 'free': 0, '$': 1, '$$': 2, '$$$': 3, '$$$$': 4, 'varies': 2.5 };
    var scored = state.data.providers.map(function (p) {
      var s = 0, why = [];
      if (!ageFits(p, age)) return null;
      s += 1;
      wants.forEach(function (c, i) {
        if ((p.categories || []).indexOf(c) > -1) { s += (3 - i) * 3; why.push(CATLABEL[c]); }
      });
      if (wants.length && !why.length) s -= 4;
      if (budget && budgetRank[p.price_band] > budgetRank[budget]) { s -= 6; why.push('over budget'); }
      var tags = p.tags || [];
      if (form.elements.beginner.checked && (tags.indexOf('beginner-friendly') > -1 || tags.indexOf('no-experience-needed') > -1)) { s += 3; why.push('beginner-friendly'); }
      if (form.elements.aftercare.checked) { if (tags.indexOf('aftercare') > -1) { s += 2; why.push('aftercare'); } else s -= 2; }
      if (form.elements.aid.checked) { if (tags.indexOf('financial-aid') > -1 || tags.indexOf('sliding-scale') > -1 || p.price_band === 'free') { s += 3; why.push('aid'); } else s -= 3; }
      if (form.elements.inclusive.checked) { if (tags.indexOf('special-needs-inclusive') > -1) { s += 5; why.push('inclusive'); } else s -= 4; }
      if (age >= 13 && tags.indexOf('teen-program') > -1) s += 2;
      return { p: p, s: s, why: why };
    }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).slice(0, 10);

    document.getElementById('match-results').innerHTML =
      '<h3 class="match-h">Top matches</h3>' +
      scored.map(function (x, i) {
        return '<div class="match-row"><span class="rank">' + (i + 1) + '</span><div>' +
          '<a href="#" data-act="jump" data-id="' + esc(x.p.id) + '"><b>' + esc(x.p.name) + '</b></a>' +
          ' <span class="why">' + esc(x.why.slice(0, 4).join(' · ')) + '</span>' +
          '<div class="mini-desc">' + esc((x.p.description || '').slice(0, 160)) + '</div>' +
        '</div></div>';
      }).join('');
  }

  /* ---------------- concierge ---------------- */

  var KEY_LS = 'camps_anthropic_key';

  function conciergeView() {
    var key = localStorage.getItem(KEY_LS);
    if (!key) {
      return '<p class="lead">The concierge is Claude with search tools over this dataset — describe your kid in as much nuance as you like ("11, dyslexic, obsessed with mushrooms, melts down in big groups, we both work until 6") and it will reason about genuine fit, not just filter tags.</p>' +
        '<div class="key-setup"><p>It runs on your own Anthropic API key, used directly from this browser and stored only on this device. Get one at <a href="https://platform.claude.com" target="_blank" rel="noopener">platform.claude.com</a> (usage is billed to your account; a conversation costs a few cents).</p>' +
        '<input id="api-key" type="password" placeholder="sk-ant-…">' +
        '<button class="primary" data-act="save-key">Start</button></div>';
    }
    var msgs = state.chat.map(function (m) {
      return '<div class="msg ' + m.role + '">' + renderMd(m.text) + '</div>';
    }).join('');
    return '<div class="chat">' +
      '<div class="chat-log" id="chat-log">' +
        (state.chat.length ? msgs : '<div class="msg assistant">Tell me about your kid — age, interests, temperament, logistics, budget — and I’ll work out what actually fits. I can also compare specific camps or plan a full summer schedule.</div>') +
        (state.chatBusy ? '<div class="msg assistant busy">Thinking…</div>' : '') +
      '</div>' +
      '<form id="chat-form" class="chat-form">' +
        '<textarea id="chat-input" rows="2" placeholder="Describe your kid, or ask anything about DC camps…"></textarea>' +
        '<button type="submit"' + (state.chatBusy ? ' disabled' : '') + '>Send</button>' +
      '</form>' +
      '<div class="chat-foot"><button class="linky" data-act="forget-key">Forget my API key</button></div>' +
    '</div>';
  }

  function renderMd(t) {
    // minimal: escape, then bold + line breaks + bullets
    var out = esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return out.split(/\n/).map(function (line) {
      if (/^\s*[-•]\s+/.test(line)) return '<div class="li">' + line.replace(/^\s*[-•]\s+/, '') + '</div>';
      return line ? '<p>' + line + '</p>' : '';
    }).join('');
  }

  var TOOLS = [
    {
      name: 'search_camps',
      description: 'Search the DC camp dataset. Returns compact summaries ranked by relevance. Use multiple searches with different angles for thorough coverage.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search over names, descriptions, tags' },
          categories: { type: 'array', items: { type: 'string' }, description: 'Filter to any of these category keys' },
          age: { type: 'number', description: 'Child age — excludes camps whose stated range does not fit' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Require ALL of these tag keys' },
          max_price_band: { type: 'string', description: 'One of: free, $, $$, $$$, $$$$' },
          limit: { type: 'number', description: 'Max results, default 8' }
        }
      }
    },
    {
      name: 'get_camp',
      description: 'Fetch the full record for one camp by id (from search results), including 2026 status, 2027 registration mechanics, aid, contacts and links.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    },
    {
      name: 'list_taxonomy',
      description: 'List all category keys, tag keys, areas and provider types in the dataset with counts. Call this first if unsure what vocabulary to search with.',
      input_schema: { type: 'object', properties: {} }
    }
  ];

  function runTool(name, input) {
    var ps = state.data.providers;
    if (name === 'list_taxonomy') {
      var count = function (field) {
        var m = {};
        ps.forEach(function (p) { (p[field] || []).forEach(function (v) { m[v] = (m[v] || 0) + 1; }); });
        return m;
      };
      var orgs = {};
      ps.forEach(function (p) { orgs[p.org_type] = (orgs[p.org_type] || 0) + 1; });
      return JSON.stringify({ total: ps.length, categories: count('categories'), tags: count('tags'), areas: count('areas'), org_types: orgs });
    }
    if (name === 'get_camp') {
      var hit = ps.find(function (p) { return p.id === input.id; });
      return hit ? JSON.stringify(hit) : 'No camp with id ' + input.id;
    }
    if (name === 'search_camps') {
      var budgetRank = { 'free': 0, '$': 1, '$$': 2, '$$$': 3, '$$$$': 4, 'varies': 99 };
      var res = ps.map(function (p) {
        return { p: p, s: input.query ? searchScore(p, input.query) : 1 };
      }).filter(function (x) {
        var p = x.p;
        if (x.s === 0) return false;
        if (input.categories && input.categories.length && !input.categories.some(function (c) { return (p.categories || []).indexOf(c) > -1; })) return false;
        if (input.tags && input.tags.length && !input.tags.every(function (t) { return (p.tags || []).indexOf(t) > -1; })) return false;
        if (input.age != null && !ageFits(p, input.age)) return false;
        if (input.max_price_band && budgetRank[p.price_band] > budgetRank[input.max_price_band] && p.price_band !== 'varies') return false;
        return true;
      }).sort(function (a, b) { return b.s - a.s; }).slice(0, input.limit || 8)
        .map(function (x) {
          var p = x.p;
          return { id: p.id, name: p.name, org_type: p.org_type, categories: p.categories, ages: p.ages, areas: p.areas, price_band: p.price_band, tags: p.tags, summary: (p.description || '').slice(0, 220), status_2026: (p.status_2026 || '').slice(0, 140), reg_2027_opens: (p.reg_2027 || {}).opens };
        });
      return JSON.stringify({ matches: res, note: res.length ? '' : 'No matches — try list_taxonomy or broader terms.' });
    }
    return 'Unknown tool';
  }

  function systemPrompt() {
    return 'You are the concierge for "Summer Camps for Kids Who Aren’t Sporty" (camps.mintresearch.org), an independently maintained dataset of ' +
      state.data.providers.length + ' Washington-DC-area summer camps and programs, last updated ' + (state.data.updated || 'recently') + '. ' +
      'You help parents — often newcomers with zero local knowledge — find genuinely good fits for their specific kid. ' +
      'The site’s premise: the kid is not sporty. Default away from sports-first camps entirely; competitive athletics only if the parent explicitly asks. ' +
      'Gentle, non-competitive, beginner-level physical things (nature hikes, sailing, climbing, circus, riding, learn-to-swim) are fine when they fit the kid — frame them as adventures, not sports.\n\n' +
      'Method: use search_camps and get_camp liberally (several searches from different angles beats one). Reason about the whole kid — temperament, siblings, logistics, budget — not just interest keywords. ' +
      'Distinguish clearly between what is still bookable for 2026 (status_2026) and what to plan for 2027 (reg_2027: when registration opens and how it works — lotteries and nature camps sell out in days). ' +
      'Recommend 3-6 options with honest trade-offs, name the registration mechanics for each, and flag anything a parent must verify directly (the dataset is researched, not official). ' +
      'If the ask is vague, ask at most 2 clarifying questions before searching. Keep answers conversational and specific — no generic filler.';
  }

  function sendChat(text) {
    var key = localStorage.getItem(KEY_LS);
    state.chat.push({ role: 'user', text: text });
    state.chatBusy = true;
    render();

    var messages = state.chat.map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text }; });

    function callAPI(msgs, depth) {
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 3000,
          thinking: { type: 'adaptive' },
          system: systemPrompt(),
          tools: TOOLS,
          messages: msgs
        })
      }).then(function (r) {
        if (r.status === 401) throw new Error('That API key was rejected — use "Forget my API key" below and re-enter it.');
        if (r.status === 429) throw new Error('Rate-limited by the API — wait a moment and try again.');
        if (!r.ok) return r.json().then(function (e) { throw new Error((e.error && e.error.message) || 'API error ' + r.status); });
        return r.json();
      }).then(function (resp) {
        if (resp.stop_reason === 'refusal') throw new Error('The model declined that request.');
        if (resp.stop_reason === 'tool_use' && depth < 8) {
          var results = resp.content.filter(function (b) { return b.type === 'tool_use'; }).map(function (b) {
            return { type: 'tool_result', tool_use_id: b.id, content: runTool(b.name, b.input || {}) };
          });
          // Pass content back unchanged (thinking blocks included), all tool results in one user turn.
          return callAPI(msgs.concat([{ role: 'assistant', content: resp.content }, { role: 'user', content: results }]), depth + 1);
        }
        var text = resp.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
        return text || '(no answer — try rephrasing)';
      });
    }

    callAPI(messages, 0).then(function (answer) {
      state.chat.push({ role: 'assistant', text: answer });
    }).catch(function (e) {
      state.chat.push({ role: 'assistant', text: '⚠ ' + e.message });
    }).then(function () {
      state.chatBusy = false;
      render();
      var log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    });
  }

  /* ---------------- shell ---------------- */

  function authed() {
    return localStorage.getItem(AUTH_LS) === AUTH_HASH;
  }

  function sha256Hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  function renderLogin(err) {
    app.innerHTML =
      '<div class="login-wall"><div class="login-card">' +
        '<div class="eyebrow">Private preview</div>' +
        '<h1>Summer Camps for Kids Who Aren’t Sporty</h1>' +
        '<p>The DC-area guide. Not public yet — sign in to continue.</p>' +
        (err ? '<p class="login-err">' + esc(err) + '</p>' : '') +
        '<form id="login-form">' +
          '<input id="login-pass" type="password" placeholder="Passphrase" autocomplete="current-password" autofocus>' +
          '<button type="submit">Sign in</button>' +
        '</form>' +
      '</div></div>';
    document.getElementById('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = document.getElementById('login-pass').value;
      sha256Hex(v).then(function (h) {
        if (h === AUTH_HASH) { localStorage.setItem(AUTH_LS, h); render(); }
        else renderLogin('That passphrase isn’t right.');
      });
    });
  }

  function render() {
    if (!authed()) { renderLogin(); return; }
    if (!state.data) { app.innerHTML = '<div class="shell"><p class="loading">Loading the guide…</p></div>'; return; }
    var d = state.data;
    var views = [['directory', 'Directory'], ['calendar', '2027 calendar'], ['match', 'Find a fit'], ['concierge', 'Ask the concierge']];
    app.innerHTML =
      '<header class="mast"><div class="shell">' +
        '<div class="eyebrow">Private preview · DC + close-in Maryland · updated ' + esc(d.updated || '') + '</div>' +
        '<h1>Summer Camps for Kids Who Aren’t Sporty</h1>' +
        '<p class="dek">For kids who’d rather build, draw, act, write, code, dig, sail or wander: every camp we can find — government, nonprofit, private, museum, YMCA and school-run — tagged, searchable, and honest about how registration really works. Sports-only camps are here too, just switched off by default.</p>' +
        '<div class="statrow"><div class="stat"><b>' + d.providers.length + '</b><span>programs</span></div>' +
        '<div class="stat"><b>' + d.providers.filter(function (p) { return p.price_band === 'free' || (p.tags || []).indexOf('financial-aid') > -1; }).length + '</b><span>free or aided</span></div>' +
        '<div class="stat"><b>' + d.providers.filter(function (p) { return (p.tags || []).indexOf('teen-program') > -1; }).length + '</b><span>serve teens</span></div></div>' +
      '</div></header>' +
      '<nav class="viewnav"><div class="shell">' +
        views.map(function (v) { return '<button class="vtab' + (state.view === v[0] ? ' on' : '') + '" data-act="view" data-view="' + v[0] + '">' + v[1] + '</button>'; }).join('') +
      '</div></nav>' +
      '<main class="shell">' +
        (state.view === 'directory' ? directoryView() :
         state.view === 'calendar' ? calendarView() :
         state.view === 'match' ? matchView() : conciergeView()) +
      '</main>' +
      '<footer><div class="shell"><p>Private preview — researched with AI assistance and checked against official sources, but not official: always confirm dates, prices and availability with the provider. ' +
      'Dataset: <a href="https://raw.githubusercontent.com/mint-philosophy/mint-website/main/assets/data/camps.json" target="_blank" rel="noopener">camps.json</a> · refreshed weekly. <button class="linky" data-act="signout">Sign out on this device</button></p></div></footer>';
    bind();
  }

  function bind() {
    app.querySelectorAll('[data-act]').forEach(function (el) {
      var act = el.getAttribute('data-act');
      el.addEventListener('click', function (e) {
        if (act === 'jump') {
          e.preventDefault();
          state.view = 'directory';
          state.q = ''; state.cats = {}; state.need = {}; state.org = 'all'; state.price = 'all'; state.area = 'all'; state.age = '';
          var id = el.getAttribute('data-id');
          state.expanded[id] = true;
          render();
          var c = document.getElementById('c-' + id);
          if (c) c.scrollIntoView({ block: 'center' });
          return;
        }
        if (act === 'view') { state.view = el.getAttribute('data-view'); render(); }
        if (act === 'cat') { var c2 = el.getAttribute('data-cat'); state.cats[c2] = !state.cats[c2]; render(); }
        if (act === 'need') { var n = el.getAttribute('data-need'); state.need[n] = !state.need[n]; render(); }
        if (act === 'sports') { state.showSports = !state.showSports; render(); }
        if (act === 'expand') { var id2 = el.getAttribute('data-id'); state.expanded[id2] = !state.expanded[id2]; render(); }
        if (act === 'save-key') {
          var v = document.getElementById('api-key').value.trim();
          if (v) { localStorage.setItem(KEY_LS, v); render(); }
        }
        if (act === 'forget-key') { localStorage.removeItem(KEY_LS); state.chat = []; render(); }
        if (act === 'signout') { localStorage.removeItem(AUTH_LS); render(); }
      });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', debounce(function () { state.q = q.value; rerenderDirectory(); }, 200));
    var age = document.getElementById('age');
    if (age) age.addEventListener('input', debounce(function () { state.age = age.value; rerenderDirectory(); }, 300));
    ['org', 'price', 'area'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (sel) sel.addEventListener('change', function () { state[id] = sel.value; render(); });
    });
    var mf = document.getElementById('match-form');
    if (mf) mf.addEventListener('submit', function (e) { e.preventDefault(); runMatch(mf); });
    var cf = document.getElementById('chat-form');
    if (cf) cf.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('chat-input');
      var t = input.value.trim();
      if (t && !state.chatBusy) { input.value = ''; sendChat(t); }
    });
  }

  function rerenderDirectory() {
    // re-render while keeping focus in the inputs
    var qEl = document.getElementById('q');
    var focusId = document.activeElement && document.activeElement.id;
    var pos = qEl && focusId === 'q' ? qEl.selectionStart : null;
    render();
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) { el.focus(); if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); }
    }
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  render();
  load(0);
})();
