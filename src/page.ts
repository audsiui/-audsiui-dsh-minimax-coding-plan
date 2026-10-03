/**
 * The console page, as one self-contained document.
 *
 * No build step, no CDN, no framework: the page is served by a loopback
 * listener whose URL carries a per-process secret, so everything it needs can
 * be inlined and nothing it loads can be a supply-chain path into the host.
 * All state arrives as JSON from the two `fetch` calls below; the document
 * never holds a credential.
 */

/**
 * Render the page document.
 * @param base - the tokenised path prefix every request is relative to.
 * @returns a complete HTML document.
 */
export function renderConsolePage(base: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>MiniMax Coding Plan</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d0f12; --panel: #16191e; --line: #262b33;
    --fg: #e6e9ef; --dim: #8b94a3; --accent: #f97316; --ok: #34d399; --bad: #f87171;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px; background: var(--bg); color: var(--fg);
    font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 620px; }
  h1 { font-size: 18px; margin: 0 0 2px; font-weight: 600; letter-spacing: .2px; }
  .sub { color: var(--dim); font-size: 12px; margin-bottom: 24px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .pill { font-size: 11px; padding: 2px 9px; border-radius: 99px; border: 1px solid var(--line); color: var(--dim); }
  .pill.on { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
  .pill.off { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
  .pill.busy { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  button {
    font: inherit; padding: 7px 15px; border-radius: 7px; cursor: pointer;
    border: 1px solid var(--line); background: #1e2229; color: var(--fg); transition: .12s;
  }
  button:hover:not(:disabled) { background: #262b33; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #1a1207; font-weight: 600; }
  button.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .code { font-size: 20px; letter-spacing: 3px; font-weight: 600; color: var(--accent); }
  .meta { color: var(--dim); font-size: 12px; margin-top: 10px; }
  a { color: var(--accent); }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 18px; }
  .seg button { border: 0; border-radius: 0; padding: 6px 16px; background: transparent; color: var(--dim); }
  .seg button[aria-pressed="true"] { background: #262b33; color: var(--fg); }
  .bar { height: 9px; background: #23272f; border-radius: 99px; overflow: hidden; margin: 7px 0 4px; }
  .bar > i { display: block; height: 100%; background: var(--accent); border-radius: 99px; transition: width .3s; }
  .bar.unlimited > i { background: var(--ok); }
  .legend { display: flex; justify-content: space-between; color: var(--dim); font-size: 12px; }
  .err { color: var(--bad); font-size: 12px; margin-top: 10px; }
  .foot { color: var(--dim); font-size: 11px; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
<main>
  <h1>MiniMax Coding Plan</h1>
  <div class="sub">DeepSeek Harness provider &middot; <span id="region">&mdash;</span></div>

  <div class="card">
    <div class="row">
      <span class="grow"><span class="pill" id="pill">读取中</span></span>
      <button class="primary" id="signin" disabled>登录</button>
      <button id="signout" disabled>登出</button>
    </div>
    <div id="body"></div>
  </div>

  <div class="card">
    <div class="seg">
      <button id="tab-interval" aria-pressed="true">本周期</button>
      <button id="tab-weekly" aria-pressed="false">本周</button>
    </div>
    <div id="quota"><div class="meta">尚未登录，暂无用量数据。</div></div>
    <div class="foot" id="stamp"></div>
  </div>
</main>

<script>
(function () {
  var BASE = ${JSON.stringify(base)};
  var $ = function (id) { return document.getElementById(id); };
  var tab = 'interval';
  var timer = null;

  // The service's own fields go into innerHTML, so escape rather than trust:
  // only the verification URL is interpolated, and it is escaped here.
  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtReset(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setBusy(on) {
    $('signin').disabled = on;
    $('signout').disabled = on;
  }

  function renderAccount(s) {
    var pill = $('pill'), body = $('body'), err = $('err');
    if (err) err.remove();
    pill.className = 'pill';

    if (s.status === 'signed-out') {
      pill.textContent = '未登录';
      setBusy(false);
      $('signin').disabled = false;
      $('signout').disabled = true;
      body.innerHTML = '<div class="meta">点击「登录」，浏览器会打开 MiniMax 验证页，'
        + '输入设备码后本页面会自动刷新。</div>';
    } else if (s.status === 'authorizing') {
      pill.textContent = '等待授权';
      pill.className = 'pill busy';
      setBusy(true);
      var href = esc(s.verificationUriComplete || s.verificationUri);
      body.innerHTML = '<div style="margin-top:14px">'
        + '<div class="meta">在浏览器中打开验证页并输入设备码：</div>'
        + '<div class="row" style="margin-top:8px"><span class="code">' + s.userCode + '</span>'
        + '<a class="grow" href="' + href + '" target="_blank" rel="noreferrer">打开验证页 &rarr;</a></div>'
        + '<div class="meta">有效期 ' + s.expiresInSec + ' 秒，页面每 2 秒自动检查。</div></div>';
    } else {
      pill.textContent = '已登录';
      pill.className = 'pill on';
      setBusy(false);
      $('signin').disabled = true;
      $('signout').disabled = false;
      body.innerHTML = '<div class="meta">账号 ' + (s.accountId || '&mdash;')
        + ' &middot; 令牌到期 ' + fmtReset(s.expiresAtMs) + '</div>';
    }
  }

  function renderQuota(q) {
    var host = $('quota');
    if (!q) { host.innerHTML = '<div class="meta">暂无用量数据。</div>'; return; }
    var w = null;
    for (var i = 0; i < q.windows.length; i++) if (q.windows[i].id === tab) w = q.windows[i];
    if (!w) { host.innerHTML = '<div class="meta">暂无用量数据。</div>'; return; }
    if (!w.present) {
      host.innerHTML = '<div class="meta">当前套餐未计量「' + w.label + '」额度。</div>';
      return;
    }
    var pct = w.totalPercent > 0 ? Math.round(w.usedPercent / w.totalPercent * 100) : 0;
    var left = Math.max(0, w.totalPercent - w.usedPercent);
    var bar = w.unlimited
      ? '<div class="bar unlimited"><i style="width:100%"></i></div>'
      : '<div class="bar"><i style="width:' + pct + '%"></i></div>';
    host.innerHTML = '<div class="row"><span class="grow" style="font-weight:600">' + w.label + '</span>'
      + (w.unlimited ? '<span class="pill on">不限量</span>' : '') + '</div>'
      + bar
      + '<div class="legend"><span>已用 ' + pct + '%</span><span>剩余 '
      + (w.unlimited ? '不限' : Math.round(left / w.totalPercent * 100) + '%') + '</span></div>'
      + (w.resetAtMs ? '<div class="meta" style="margin-top:10px">重置时间 ' + fmtReset(w.resetAtMs) + '</div>' : '');
    $('stamp').textContent = q.planLabel
      ? '套餐 ' + q.planLabel + ' · 数据取自 ' + new Date(q.fetchedAtMs).toLocaleTimeString()
      : '数据取自 ' + new Date(q.fetchedAtMs).toLocaleTimeString();
  }

  function refresh() {
    fetch(BASE + 'api/state', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (s) {
        $('region').textContent = '区域 ' + s.region;
        renderAccount(s);
        if (s.status === 'authorizing' && !timer) {
          timer = setInterval(refresh, 2000);
        } else if (s.status !== 'authorizing' && timer) {
          clearInterval(timer); timer = null;
        }
        if (s.quota) renderQuota(s.quota);
        else { $('quota').innerHTML = '<div class="meta">' + (s.quotaError || '暂无用量数据。') + '</div>'; $('stamp').textContent = ''; }
      })
      .catch(function (e) {
        var host = $('quota');
        if (!host.querySelector('.err')) {
          host.innerHTML = '<div class="err">读取失败：' + e.message + '</div>';
        }
      });
  }

  function act(endpoint) {
    setBusy(true);
    fetch(BASE + 'api/' + endpoint, { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || r.status); return b; }); })
      .then(refresh)
      .catch(function (e) {
        var body = $('body');
        var old = body.querySelector('.err');
        if (old) old.remove();
        var div = document.createElement('div');
        div.className = 'err'; div.textContent = e.message;
        body.appendChild(div);
        setBusy(false);
      });
  }

  $('signin').onclick = function () { act('sign-in'); };
  $('signout').onclick = function () { act('sign-out'); };
  $('tab-interval').onclick = function () { tab = 'interval'; $('tab-interval').setAttribute('aria-pressed', 'true'); $('tab-weekly').setAttribute('aria-pressed', 'false'); refresh(); };
  $('tab-weekly').onclick = function () { tab = 'weekly'; $('tab-weekly').setAttribute('aria-pressed', 'true'); $('tab-interval').setAttribute('aria-pressed', 'false'); refresh(); };
  refresh();
})();
</script>
</body>
</html>
`
}
