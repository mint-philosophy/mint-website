/**
 * MINT Lab Ghost Theme — Main JavaScript
 * =======================================
 * Ported from the static site inline script.
 * Handles: navigation, scroll progress, people rendering,
 * feed filtering, project card expand/collapse.
 */

(function () {
  'use strict';

  // ---- Helpers ----

  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return document.querySelectorAll(selector); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') { node.textContent = attrs[k]; }
      else if (k === 'html') { node.innerHTML = attrs[k]; }
      else if (k === 'className') { node.className = attrs[k]; }
      else if (k.startsWith('on')) { node.addEventListener(k.slice(2).toLowerCase(), attrs[k]); }
      else { node.setAttribute(k, attrs[k]); }
    });
    if (children) children.forEach(function (c) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }


  // ---- Navigation ----

  var hamburger = $('#nav-hamburger');
  var navLinks = $('#nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    // Close mobile nav when a link is clicked
    navLinks.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }


  // ---- Scroll Progress Bar ----

  var progressBar = $('#scroll-progress');
  if (progressBar) {
    window.addEventListener('scroll', function () {
      var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      var scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      var progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      progressBar.style.width = progress + '%';
    });
  }


  // ---- Project Card Expand/Collapse ----

  var projectHeaders = $$('.project-header');
  projectHeaders.forEach(function (header) {
    header.addEventListener('click', function () {
      var card = header.closest('.project-card');
      if (!card) return;
      var detail = card.querySelector('.project-detail');
      if (!detail) return;
      var isExpanded = card.classList.toggle('expanded');
      if (isExpanded) {
        detail.style.maxHeight = detail.scrollHeight + 'px';
      } else {
        detail.style.maxHeight = '0';
      }
    });
  });


  // ---- Feed Filtering ----

  var feedFilters = $('#feed-filters');
  var feedList = $('#feed-list');
  var feedShowMore = $('#feed-show-more');

  if (feedFilters && feedList) {
    var INITIAL_COUNT = 8;
    var currentFilter = 'all';
    var showAll = false;

    function applyFeedFilter() {
      var items = feedList.querySelectorAll('.feed-item');
      var visibleCount = 0;
      var totalMatching = 0;

      items.forEach(function (item) {
        var type = item.getAttribute('data-type') || '';
        var matches = (currentFilter === 'all') || (type === currentFilter);

        if (matches) {
          totalMatching++;
          if (showAll || visibleCount < INITIAL_COUNT) {
            item.classList.remove('hidden');
            visibleCount++;
          } else {
            item.classList.add('hidden');
          }
        } else {
          item.classList.add('hidden');
        }
      });

      // Update show more button
      if (feedShowMore) {
        if (totalMatching <= INITIAL_COUNT) {
          feedShowMore.style.display = 'none';
        } else {
          feedShowMore.style.display = 'inline-block';
          feedShowMore.textContent = showAll ? 'Show less' : 'Show all (' + totalMatching + ')';
        }
      }
    }

    // Filter button clicks
    feedFilters.addEventListener('click', function (e) {
      var btn = e.target.closest('.feed-filter');
      if (!btn) return;
      currentFilter = btn.getAttribute('data-filter') || 'all';
      showAll = false;
      $$('.feed-filter').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyFeedFilter();
    });

    // Show more button
    if (feedShowMore) {
      feedShowMore.addEventListener('click', function () {
        showAll = !showAll;
        applyFeedFilter();
      });
    }

    // Initial filter application
    applyFeedFilter();
  }


  // ---- People Section (Client-Side Rendered from JSON) ----

  var peopleContainer = $('#people-container');
  if (peopleContainer) {
    // Determine the path to people.json using the theme assets path
    // Ghost serves theme assets at /assets/ — we need the full path
    var scriptTags = document.querySelectorAll('script[src]');
    var assetsBase = '';
    for (var i = 0; i < scriptTags.length; i++) {
      var src = scriptTags[i].getAttribute('src');
      if (src && src.indexOf('js/main.js') !== -1) {
        assetsBase = src.replace('js/main.js', '');
        break;
      }
    }
    var peopleUrl = assetsBase + 'data/people.json';

    fetch(peopleUrl)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderPeople(data);
      })
      .catch(function (err) {
        console.error('Failed to load people data:', err);
      });
  }

  function renderPeople(data) {
    var groups = [
      { key: 'team', label: 'Team', defaultOpen: true },
      { key: 'affiliates', label: 'Affiliates', defaultOpen: false },
      { key: 'alumni', label: 'Alumni', defaultOpen: false }
    ];

    groups.forEach(function (group) {
      var people = data[group.key];
      if (!people || !people.length) return;

      var groupDiv = el('div', { className: 'people-group' + (group.defaultOpen ? ' expanded' : '') });

      var headerEl = el('div', { className: 'people-group-header' }, [
        el('h3', {}, [
          document.createTextNode(group.label),
          el('span', { className: 'people-count', text: '(' + people.length + ')' })
        ]),
        el('span', { className: 'people-toggle', text: '\u25BC' })
      ]);

      var grid = el('div', { className: 'people-grid' });
      if (group.defaultOpen) {
        grid.style.maxHeight = 'none';
      }

      people.forEach(function (person) {
        // Avatar: use photo if available, otherwise initials on a colored circle
        var avatar = el('div', { className: 'person-avatar' });
        if (person.photo) {
          avatar.appendChild(el('img', { src: person.photo, alt: person.name }));
        } else {
          var initials = person.name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map(function(w) { return w[0]; }).join('').slice(0, 2);
          avatar.textContent = initials;
          // Stable color from name hash
          var hash = 0;
          for (var i = 0; i < person.name.length; i++) hash = person.name.charCodeAt(i) + ((hash << 5) - hash);
          var hue = ((hash % 360) + 360) % 360;
          avatar.style.background = 'hsl(' + hue + ', 45%, 45%)';
        }

        // Links
        var linkLabels = { Web: 'Personal website', LI: 'LinkedIn', PP: 'PhilPeople', GS: 'Google Scholar' };
        var linksEl = null;
        if (person.links && person.links.length) {
          linksEl = el('div', { className: 'person-links' });
          person.links.forEach(function (link) {
            var a = el('a', { text: link.abbr });
            a.href = link.url;
            a.title = linkLabels[link.abbr] || link.abbr;
            a.target = '_blank';
            a.rel = 'noopener';
            linksEl.appendChild(a);
          });
        }

        var header = el('div', { className: 'person-card-header' }, [
          avatar,
          el('div', { className: 'person-card-info' }, [
            el('div', { className: 'person-name', text: person.name }),
            el('div', { className: 'person-role', text: person.role }),
            person.discipline ? el('div', { className: 'person-discipline', text: person.discipline }) : null
          ]),
          linksEl
        ]);

        var article = /^[aeiou]/i.test(person.role) ? 'an' : 'a';
        var bioText = person.bio || person.name + ' is ' + article + ' ' + person.role + ' at the MINT Lab. Their research engages with questions at the intersection of technology, ethics, and society. This is a placeholder bio\u200A\u2014\u200Aan updated version will be available soon.';
        var bio = el('div', { className: 'person-bio' }, [
          el('p', { text: bioText })
        ]);

        var card = el('div', { className: 'person-card' }, [header, bio]);

        card.addEventListener('click', function (e) {
          if (e.target.closest('a')) return;
          var isExpanded = card.classList.toggle('expanded');
          if (isExpanded) {
            bio.style.maxHeight = bio.scrollHeight + 'px';
          } else {
            bio.style.maxHeight = '0';
          }
        });

        grid.appendChild(card);
      });

      headerEl.addEventListener('click', function () {
        var isExpanded = groupDiv.classList.toggle('expanded');
        if (isExpanded) {
          grid.style.maxHeight = grid.scrollHeight + 'px';
          grid.addEventListener('transitionend', function handler() {
            grid.removeEventListener('transitionend', handler);
            if (groupDiv.classList.contains('expanded')) {
              grid.style.maxHeight = 'none';
            }
          }, { once: true });
        } else {
          // Reset any expanded bios before collapsing
          grid.querySelectorAll('.person-card.expanded').forEach(function (c) {
            c.classList.remove('expanded');
            c.querySelector('.person-bio').style.maxHeight = '0';
          });
          // Set explicit height first so transition works
          grid.style.maxHeight = grid.scrollHeight + 'px';
          // Force reflow
          grid.offsetHeight;
          grid.style.maxHeight = '0';
        }
      });

      groupDiv.appendChild(headerEl);
      groupDiv.appendChild(grid);
      peopleContainer.appendChild(groupDiv);
    });
  }

})();
