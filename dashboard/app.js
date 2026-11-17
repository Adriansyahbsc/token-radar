// Token Launch Radar dashboard. Renders window.RADAR (written beside this
// folder as ../data.js by main.ts). No network, no imports, no external
// addresses: the page works from disk exactly as the dossier shows it.
(function () {
  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  if (!R) { $('sub').textContent = 'No data.js found: run main.ts first.'; return; }

  var money = function (n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  };
  var pct = function (n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  $('sub').textContent = R.board_size + ' pre-token protocols ranked · ' + R.watchlist_size +
    ' on the watchlist · ' + R.early_size + ' early finds below the ' + money(R.floor_usd) +
    ' floor · snapshot as of ' + R.as_of;
  $('modelver').textContent = R.model_version;
  $('foot').textContent = 'Source: ' + R.source + ' · Global median peer multiple ×' +
    R.global_peer_multiple + ' · Implied values are this radar\u2019s own claim, not a prediction of a launch.';

  R.categories.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('fcat').appendChild(o); });
  R.chains.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('fchain').appendChild(o); });

  var selected = null;

  function farmList(row) {
    return '<ol>' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  }

  function showDetail(row) {
    selected = row.slug;
    var peers = R.live.filter(function (l) { return (l.category || 'Uncategorised') === (row.category || 'Uncategorised'); }).slice(0, 5);
    var peerHtml = peers.length
      ? '<ul>' + peers.map(function (l) { return '<li>' + esc(l.name) + ' — mcap ' + money(l.mcap_usd) + ' / TVL ' + money(l.tvl_usd) + ' = ×' + (l.mcap_tvl === null ? '—' : l.mcap_tvl) + '</li>'; }).join('') + '</ul>'
      : '<p class="hint">No live peer in this category in the top set; the global median multiple was used.</p>';
    $('detail').innerHTML =
      '<h2>' + esc(row.name) + (row.watchlist ? ' <span class="watch">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="hint">' + esc(row.slug) + ' · records no token in this snapshot</p>' +
      '<dl>' +
      '<dt>Rank</dt><dd>#' + row.rank + ' of ' + R.board_size + '</dd>' +
      '<dt>Implied value</dt><dd class="implied">' + money(row.implied_value_usd) + '</dd>' +
      '<dt>TVL</dt><dd>' + money(row.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + pct(row.change_7d) + '</dd>' +
      '<dt>Category</dt><dd>' + esc(row.category || 'Uncategorised') + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(row.chains.join(', ') || '—') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + (row.listed_at || 'unknown') + (row.age_days === null ? '' : ' (' + row.age_days + ' days)') + '</dd>' +
      '</dl>' +
      '<h3>How the value is built</h3><dl>' +
      '<dt>Peer multiple</dt><dd>×' + row.model.peer_multiple + ' (' + esc(row.model.peer_source) + ')</dd>' +
      '<dt>Growth adj.</dt><dd>×' + row.model.growth_multiplier + '</dd>' +
      '<dt>Maturity adj.</dt><dd>×' + row.model.maturity_multiplier + '</dd>' +
      '<dt>Breadth adj.</dt><dd>×' + row.model.breadth_multiplier + '</dd>' +
      '<dt>Check</dt><dd>' + money(row.tvl_usd) + ' × ' + row.model.peer_multiple + ' × ' + row.model.growth_multiplier +
      ' × ' + row.model.maturity_multiplier + ' × ' + row.model.breadth_multiplier + ' ≈ ' + money(row.implied_value_usd) + '</dd>' +
      '</dl>' +
      '<h3>Live peers behind the multiple</h3>' + peerHtml +
      '<h3>Farm plan</h3>' + farmList(row);
    render();
  }

  function currentRows() {
    if ($('flive').checked) return null;
    var q = $('q').value.trim().toLowerCase();
    var cat = $('fcat').value, chain = $('fchain').value, watchOnly = $('fwatch').checked;
    var rows = R.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && (r.category || 'Uncategorised') !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (watchOnly && !r.watchlist) return false;
      return true;
    });
    var sort = $('fsort').value;
    if (sort === 'tvl') rows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'growth') rows.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (sort === 'age') rows.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else rows.sort(function (a, b) { return a.rank - b.rank; });
    return rows;
  }

  function render() {
    var tbody = $('rows');
    if ($('flive').checked) {
      $('count').textContent = R.live.length + ' live-token peers';
      tbody.innerHTML = R.live.map(function (l) {
        return '<tr><td>·</td><td><span class="name">' + esc(l.name) + '</span><br><span class="slug">' + esc(l.slug) + '</span></td>' +
          '<td>' + esc(l.category || '—') + '</td><td>' + esc(l.chains.slice(0, 3).join(', ')) + '</td>' +
          '<td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + pct(l.change_7d) + '</td>' +
          '<td class="num">' + (l.mcap_tvl === null ? '—' : '×' + l.mcap_tvl) + '</td>' +
          '<td class="num implied">' + money(l.mcap_usd) + ' (actual)</td><td></td></tr>';
      }).join('');
      $('empty').hidden = R.live.length > 0;
      return;
    }
    var rows = currentRows();
    $('count').textContent = rows.length + ' of ' + R.board_size + ' protocols shown';
    $('empty').hidden = rows.length > 0;
    tbody.innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="watch">WL</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">×' + r.model.peer_multiple + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td>›</td></tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () {
        var row = R.rows.filter(function (r) { return r.slug === tr.getAttribute('data-slug'); })[0];
        if (row) showDetail(row);
      });
    });
  }

  ['q', 'fcat', 'fchain', 'fsort', 'fwatch', 'flive'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
  if (R.rows.length > 0) showDetail(R.rows[0]);
})();
