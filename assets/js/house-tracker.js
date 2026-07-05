/* House Tracker — private furnishing checklist.
 *
 * State lives in assets/data/house-tracker.json in the GitHub repo, read and
 * written through the GitHub Contents API with a personal access token the
 * user pastes in once per device (kept in localStorage). Without a token the
 * page shows nothing but the unlock screen, which is what makes it private
 * even though the page itself is public.
 */
(function () {
  'use strict';

  var OWNER = 'mint-philosophy';
  var REPO = 'mint-website';
  var DATA_PATH = 'assets/data/house-tracker.json';
  // Until the tracker branch is merged, the data file only exists there.
  var FALLBACK_BRANCH = 'claude/house-furnishing-tracker-uzeqcs';

  var LS_TOKEN = 'ht_token';
  var LS_BRANCH = 'ht_branch';

  var STAGES = ['todo', 'ordered', 'delivered', 'done'];
  var STAGE_LABEL = { todo: 'Need', ordered: 'Ordered', delivered: 'Delivered', done: 'Done' };
  var STAGE_HINT = {
    todo: 'Still to buy',
    ordered: 'Ordered / bought',
    delivered: 'Picked up or delivered',
    done: 'Installed / finished'
  };

  var state = {
    data: null,
    sha: null,
    branch: null,
    token: localStorage.getItem(LS_TOKEN) || '',
    filter: 'all',
    search: '',
    openNotes: {},
    collapsed: {},
    dirty: false,
    saving: false,
    saveTimer: null,
    lastSync: null,
    error: null
  };

  var app = document.getElementById('app');

  /* ---------- utilities ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() {
    return 'i-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function b64EncodeUtf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64DecodeUtf8(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- GitHub API ---------- */

  function gh(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'Authorization': 'Bearer ' + state.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, opts.headers || {});
    return fetch('https://api.github.com' + path, opts);
  }

  function fetchFile(branch) {
    return gh('/repos/' + OWNER + '/' + REPO + '/contents/' + DATA_PATH +
      '?ref=' + encodeURIComponent(branch) + '&t=' + Date.now());
  }

  function resolveBranchAndLoad() {
    var saved = localStorage.getItem(LS_BRANCH);
    var tries = saved ? [saved] : [];
    return gh('/repos/' + OWNER + '/' + REPO).then(function (res) {
      if (res.status === 401) throw { code: 'auth' };
      if (!res.ok) throw { code: 'repo', status: res.status };
      return res.json();
    }).then(function (repo) {
      if (tries.indexOf(repo.default_branch) === -1) tries.push(repo.default_branch);
      if (tries.indexOf(FALLBACK_BRANCH) === -1) tries.push(FALLBACK_BRANCH);
      var attempt = function (idx) {
        if (idx >= tries.length) throw { code: 'nodata', tried: tries };
        return fetchFile(tries[idx]).then(function (res) {
          if (res.status === 404) return attempt(idx + 1);
          if (res.status === 401) throw { code: 'auth' };
          if (!res.ok) throw { code: 'load', status: res.status };
          return res.json().then(function (file) {
            state.branch = tries[idx];
            localStorage.setItem(LS_BRANCH, tries[idx]);
            state.sha = file.sha;
            state.data = JSON.parse(b64DecodeUtf8(file.content));
            state.lastSync = new Date();
          });
        });
      };
      return attempt(0);
    });
  }

  function putFile() {
    var body = {
      message: 'House tracker: update from web',
      content: b64EncodeUtf8(JSON.stringify(state.data, null, 2) + '\n'),
      branch: state.branch
    };
    if (state.sha) body.sha = state.sha;
    return gh('/repos/' + OWNER + '/' + REPO + '/contents/' + DATA_PATH, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  function mergeRemote(remote) {
    // Union merge: local wins on items both sides know; keep remote-only items.
    var localIds = {};
    state.data.items.forEach(function (it) { localIds[it.id] = true; });
    remote.items.forEach(function (it) {
      if (!localIds[it.id]) state.data.items.push(it);
    });
    remote.roomOrder.forEach(function (r) {
      if (state.data.roomOrder.indexOf(r) === -1) state.data.roomOrder.push(r);
    });
  }

  function save() {
    if (state.saving || !state.dirty) return;
    state.saving = true;
    state.error = null;
    state.dirty = false;
    state.data.updatedAt = new Date().toISOString();
    renderSync();
    putFile().then(function (res) {
      if (res.status === 409) {
        // Someone else (another device, an agent) committed since we loaded.
        return fetchFile(state.branch).then(function (r2) {
          if (!r2.ok) throw { code: 'save', status: r2.status };
          return r2.json();
        }).then(function (file) {
          state.sha = file.sha;
          mergeRemote(JSON.parse(b64DecodeUtf8(file.content)));
          return putFile();
        });
      }
      return res;
    }).then(function (res) {
      if (!res.ok) throw { code: 'save', status: res.status };
      return res.json();
    }).then(function (out) {
      state.sha = out.content.sha;
      state.saving = false;
      state.lastSync = new Date();
      renderSync();
    }).catch(function (err) {
      state.saving = false;
      state.dirty = true;
      state.error = 'Save failed' + (err && err.status ? ' (HTTP ' + err.status + ')' : '') + ' — tap to retry';
      renderSync();
    });
  }

  function scheduleSave() {
    state.dirty = true;
    renderSync();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 1200);
  }

  /* ---------- data helpers ---------- */

  function itemsByRoom(room) {
    return state.data.items.filter(function (it) { return it.room === room; });
  }

  function allRooms() {
    var rooms = state.data.roomOrder.slice();
    state.data.items.forEach(function (it) {
      if (rooms.indexOf(it.room) === -1) rooms.push(it.room);
    });
    return rooms;
  }

  function setStatus(item, status) {
    item.status = status;
    item.dates = item.dates || {};
    if (status !== 'todo') item.dates[status] = todayISO();
    // Clear stamps for stages after the one just set.
    for (var i = STAGES.indexOf(status) + 1; i < STAGES.length; i++) delete item.dates[STAGES[i]];
    if (status === 'todo') item.dates = {};
    scheduleSave();
    render();
  }

  function matchesFilter(it) {
    if (state.search) {
      var q = state.search.toLowerCase();
      var hay = (it.name + ' ' + (it.source || '') + ' ' + (it.notes || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.filter === 'all') return true;
    if (state.filter === 'ideas') return !!it.suggested;
    return !it.suggested && it.status === state.filter;
  }

  /* ---------- rendering ---------- */

  function render() {
    if (!state.token) return renderGate();
    if (!state.data) return; // still loading
    renderApp();
  }

  function renderGate(msg) {
    app.innerHTML =
      '<div class="gate">' +
        '<div class="gate-card">' +
          '<div class="gate-lock">🔒</div>' +
          '<h1>House Tracker</h1>' +
          '<p>This page is private. Paste a GitHub token with access to the tracker to unlock it on this device.</p>' +
          (msg ? '<p class="gate-err">' + esc(msg) + '</p>' : '') +
          '<input id="gate-token" type="password" placeholder="github_pat_… or ghp_…" autocomplete="off">' +
          '<button id="gate-go">Unlock</button>' +
          '<details><summary>How to create a token</summary>' +
            '<ol>' +
              '<li>Go to <b>github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>' +
              '<li>Resource owner: <b>' + OWNER + '</b>. Repository access: only <b>' + REPO + '</b>.</li>' +
              '<li>Permissions → Repository → <b>Contents: Read and write</b>.</li>' +
              '<li>Generate, copy, paste here. (A classic token with <b>repo</b> scope also works.)</li>' +
            '</ol>' +
            '<p>The token stays in this browser only and is sent only to api.github.com.</p>' +
          '</details>' +
        '</div>' +
      '</div>';
    var input = document.getElementById('gate-token');
    var go = function () {
      var t = input.value.trim();
      if (!t) return;
      state.token = t;
      localStorage.setItem(LS_TOKEN, t);
      boot();
    };
    document.getElementById('gate-go').addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    input.focus();
  }

  function renderLoading(msg) {
    app.innerHTML = '<div class="gate"><div class="gate-card"><h1>House Tracker</h1><p>' + esc(msg) + '</p></div></div>';
  }

  function syncLabel() {
    if (state.error) return '<span class="sync err" id="sync">⚠ ' + esc(state.error) + '</span>';
    if (state.saving) return '<span class="sync busy" id="sync">Saving…</span>';
    if (state.dirty) return '<span class="sync busy" id="sync">Unsaved changes…</span>';
    if (state.lastSync) {
      return '<span class="sync ok" id="sync">Synced ✓ ' +
        state.lastSync.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '</span>';
    }
    return '<span class="sync" id="sync"></span>';
  }

  function renderSync() {
    var el = document.getElementById('sync');
    if (!el) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = syncLabel();
    el.replaceWith(tmp.firstChild);
    bindSyncRetry();
  }

  function bindSyncRetry() {
    var el = document.getElementById('sync');
    if (el && el.classList.contains('err')) {
      el.addEventListener('click', function () { state.dirty = true; save(); });
    }
  }

  function progressFor(items) {
    var real = items.filter(function (it) { return !it.suggested; });
    var done = real.filter(function (it) { return it.status === 'done'; }).length;
    return { done: done, total: real.length };
  }

  function itemRow(it) {
    var stamps = STAGES.filter(function (s) { return s !== 'todo' && it.dates && it.dates[s]; })
      .map(function (s) { return STAGE_LABEL[s].toLowerCase() + ' ' + fmtDate(it.dates[s]); })
      .join(' · ');
    var seg = STAGES.map(function (s) {
      return '<button class="seg s-' + s + (it.status === s ? ' on' : '') + '" title="' + STAGE_HINT[s] +
        '" data-act="status" data-id="' + it.id + '" data-status="' + s + '">' + STAGE_LABEL[s] + '</button>';
    }).join('');
    var notesOpen = !!state.openNotes[it.id];
    return '<div class="item' + (it.suggested ? ' suggested' : '') + ' st-' + it.status + '" data-id="' + it.id + '">' +
      '<div class="item-main">' +
        '<div class="item-name">' + esc(it.name) +
          (it.source ? ' <span class="src">' + esc(it.source) + '</span>' : '') +
          (it.suggested ? ' <span class="idea-badge">idea</span>' : '') +
        '</div>' +
        (stamps ? '<div class="stamps">' + esc(stamps) + '</div>' : '') +
        (!notesOpen && it.notes ? '<div class="note-preview" data-act="notes" data-id="' + it.id + '">📝 ' + esc(it.notes) + '</div>' : '') +
      '</div>' +
      '<div class="item-actions">' +
        (it.suggested
          ? '<button class="mini add" data-act="adopt" data-id="' + it.id + '">＋ Add to list</button>' +
            '<button class="mini dismiss" data-act="del" data-id="' + it.id + '">Dismiss</button>'
          : '<div class="segs">' + seg + '</div>' +
            '<button class="mini" data-act="notes" data-id="' + it.id + '" title="Notes">📝</button>' +
            '<button class="mini danger" data-act="del" data-id="' + it.id + '" title="Delete">✕</button>') +
      '</div>' +
      (notesOpen
        ? '<textarea class="notes-box" data-act="notes-edit" data-id="' + it.id + '" placeholder="Notes — model, price, link, delivery window…">' + esc(it.notes || '') + '</textarea>'
        : '') +
    '</div>';
  }

  function renderApp() {
    var overall = progressFor(state.data.items);
    var ideasCount = state.data.items.filter(function (it) { return it.suggested; }).length;
    var filters = [
      ['all', 'All'], ['todo', 'Need'], ['ordered', 'Ordered'],
      ['delivered', 'Delivered'], ['done', 'Done'], ['ideas', 'Ideas (' + ideasCount + ')']
    ];

    var html =
      '<header class="top">' +
        '<div class="top-row">' +
          '<h1>🏠 ' + esc(state.data.title || 'House Tracker') + '</h1>' +
          syncLabel() +
        '</div>' +
        '<div class="overall"><div class="bar"><div class="fill" style="width:' +
          (overall.total ? Math.round(100 * overall.done / overall.total) : 0) + '%"></div></div>' +
          '<span>' + overall.done + ' / ' + overall.total + ' done</span>' +
        '</div>' +
        '<div class="controls">' +
          filters.map(function (f) {
            return '<button class="chip' + (state.filter === f[0] ? ' on' : '') + '" data-act="filter" data-filter="' + f[0] + '">' + f[1] + '</button>';
          }).join('') +
          '<input id="search" type="search" placeholder="Search…" value="' + esc(state.search) + '">' +
          '<button class="chip" data-act="settings" title="Settings">⚙</button>' +
        '</div>' +
      '</header>';

    html += '<main>';
    allRooms().forEach(function (room) {
      var items = itemsByRoom(room);
      var visible = items.filter(matchesFilter);
      if (!visible.length && (state.filter !== 'all' || state.search)) return;
      var p = progressFor(items);
      var collapsed = !!state.collapsed[room];
      html += '<section class="room' + (collapsed ? ' collapsed' : '') + '">' +
        '<div class="room-head" data-act="collapse" data-room="' + esc(room) + '">' +
          '<h2>' + esc(room) + '</h2>' +
          '<span class="room-prog">' + p.done + '/' + p.total + '</span>' +
          '<span class="chev">' + (collapsed ? '▸' : '▾') + '</span>' +
        '</div>';
      if (!collapsed) {
        html += '<div class="room-items">' +
          visible.map(itemRow).join('') +
          '<form class="add-form" data-room="' + esc(room) + '">' +
            '<input name="name" placeholder="Add item…" autocomplete="off">' +
            '<input name="source" placeholder="Store (optional)" autocomplete="off">' +
            '<button type="submit">Add</button>' +
          '</form>' +
        '</div>';
      }
      html += '</section>';
    });
    html += '<button class="add-room" data-act="add-room">＋ Add room</button>';
    html += '</main>';

    app.innerHTML = html;
    bindApp();
  }

  function bindApp() {
    bindSyncRetry();
    app.querySelectorAll('[data-act]').forEach(function (el) {
      var act = el.getAttribute('data-act');
      if (act === 'notes-edit') {
        el.addEventListener('change', function () {
          var it = findItem(el.getAttribute('data-id'));
          if (it) { it.notes = el.value; scheduleSave(); }
        });
        el.addEventListener('blur', function () {
          var it = findItem(el.getAttribute('data-id'));
          if (it && it.notes !== el.value) { it.notes = el.value; scheduleSave(); }
        });
        return;
      }
      el.addEventListener('click', function (e) {
        e.preventDefault();
        handleAction(act, el);
      });
    });
    app.querySelectorAll('.add-form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = form.elements.name.value.trim();
        if (!name) return;
        state.data.items.push({
          id: uid(), room: form.getAttribute('data-room'), name: name,
          source: form.elements.source.value.trim(), status: 'todo',
          suggested: false, notes: '', dates: {}
        });
        scheduleSave();
        render();
      });
    });
    var search = document.getElementById('search');
    if (search) {
      search.addEventListener('input', function () {
        state.search = search.value;
        var pos = search.selectionStart;
        render();
        var s2 = document.getElementById('search');
        if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
      });
    }
  }

  function findItem(id) {
    return state.data.items.find(function (it) { return it.id === id; });
  }

  function handleAction(act, el) {
    var id = el.getAttribute('data-id');
    var it = id ? findItem(id) : null;
    switch (act) {
      case 'status':
        if (it) setStatus(it, el.getAttribute('data-status'));
        break;
      case 'notes':
        state.openNotes[id] = !state.openNotes[id];
        render();
        if (state.openNotes[id]) {
          var box = app.querySelector('.notes-box[data-id="' + id + '"]');
          if (box) box.focus();
        }
        break;
      case 'adopt':
        if (it) { it.suggested = false; scheduleSave(); render(); }
        break;
      case 'del':
        if (it && (it.suggested || confirm('Delete "' + it.name + '"?'))) {
          state.data.items = state.data.items.filter(function (x) { return x.id !== id; });
          scheduleSave();
          render();
        }
        break;
      case 'filter':
        state.filter = el.getAttribute('data-filter');
        render();
        break;
      case 'collapse':
        var room = el.getAttribute('data-room');
        state.collapsed[room] = !state.collapsed[room];
        render();
        break;
      case 'add-room':
        var name = prompt('Room name:');
        if (name && name.trim()) {
          state.data.roomOrder.push(name.trim());
          scheduleSave();
          render();
        }
        break;
      case 'settings':
        openSettings();
        break;
    }
  }

  function openSettings() {
    var branch = prompt(
      'Settings\n\nData branch (currently "' + state.branch + '").\n' +
      'Type a branch name to switch, "logout" to forget the token on this device, or Cancel to close.',
      state.branch
    );
    if (branch == null) return;
    branch = branch.trim();
    if (branch === 'logout') {
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_BRANCH);
      state.token = '';
      state.data = null;
      render();
    } else if (branch && branch !== state.branch) {
      localStorage.setItem(LS_BRANCH, branch);
      state.data = null;
      boot();
    }
  }

  /* ---------- boot ---------- */

  function boot() {
    renderLoading('Loading…');
    resolveBranchAndLoad().then(function () {
      render();
    }).catch(function (err) {
      if (err && err.code === 'auth') {
        localStorage.removeItem(LS_TOKEN);
        state.token = '';
        renderGate('That token was rejected by GitHub — check it and try again.');
      } else if (err && err.code === 'nodata') {
        renderLoading('No tracker data found on branches: ' + err.tried.join(', ') + '. Check the data branch in settings.');
      } else {
        renderLoading('Could not load the tracker (' + ((err && err.status) || (err && err.code) || err) + '). Refresh to retry.');
      }
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty || state.saving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.addEventListener('visibilitychange', function () {
    // Pick up edits made elsewhere (other devices, agents) when returning.
    if (document.visibilityState === 'visible' && state.data && !state.dirty && !state.saving &&
        state.lastSync && (Date.now() - state.lastSync.getTime()) > 60000) {
      resolveBranchAndLoad().then(render).catch(function () {});
    }
  });

  if (state.token) boot();
  else render();
})();
