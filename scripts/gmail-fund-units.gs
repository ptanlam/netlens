/**
 * Google Apps Script: read fund-purchase confirmation emails and confirm their units in
 * Netlens (POST /api/fund-units). Paste into script.google.com, set the two Script
 * Properties below, run `installTrigger` once. Reads VPBankS and Dragon Capital emails; for
 * another distributor, add a branch to `parse()` and its sender to `CONFIG.query`.
 *
 * Script Properties (Project Settings → Script Properties) — never in this file:
 *   CF_ACCESS_CLIENT_ID      the Access service token's Client ID
 *   CF_ACCESS_CLIENT_SECRET  the Access service token's Client Secret
 * Setup of that token: docs/CLOUDFLARE.md#the-fund-units-api
 */
const CONFIG = {
  url: 'https://netlens.lamphan.com/api/fund-units',
  // Only the confirmations: both senders mail other things too, and anything this matches
  // that `parse()` can't read is retried (and logged) every run for the whole 14 days.
  query:
    'newer_than:14d -label:netlens-done {' +
    '(from:no-reply@vpbanks.com.vn "Khối lượng CCQ đã khớp") ' +
    '(from:no_reply_t@mkt.dragoncapital.com.vn subject:"Confirmation Of Subscription")}',
  doneLabel: 'netlens-done',
};

function run() {
  const props = PropertiesService.getScriptProperties();
  const label = GmailApp.getUserLabelByName(CONFIG.doneLabel) || GmailApp.createLabel(CONFIG.doneLabel);
  // Oldest first (search gives newest first): an order without a date pairs with the oldest
  // awaiting buy, so the emails must be handled in the order the buys were made.
  for (const thread of GmailApp.search(CONFIG.query).reverse()) {
    let allDone = true;
    for (const message of thread.getMessages()) {
      const orders = parse(message.getFrom(), htmlToText(message.getBody()));
      // Unreadable: leave it for you (and a fixed `parse`) rather than file it away unseen.
      if (!orders.length) { console.warn('No order found in: ' + message.getSubject()); allDone = false; }
      // Each order is sent once, ever: the API pairs an order with the oldest awaiting buy, so
      // re-sending one (when its thread is retried for another email) would confirm the next.
      // shortcut: these keys are never pruned (~30 bytes each); fine for years of weekly buys.
      orders.forEach(function (order, i) {
        const key = 'sent:' + message.getId() + ':' + i;
        if (props.getProperty(key)) return;
        if (confirm(order)) props.setProperty(key, '1');
        else allDone = false;
      });
    }
    // A buy not found yet (not entered in Netlens, or its email came early) is retried next run.
    if (allDone) thread.addLabel(label);
  }
}

/**
 * An email's HTML as one line of text: tags out, entities decoded, whitespace collapsed.
 * Both senders' emails are HTML only, and Gmail's own plain-text rendering of them
 * (`getPlainBody`) is a layout neither the sender nor this script controls.
 */
function htmlToText(html) {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

/** One email's text (see `htmlToText`) → the orders it confirms: [{ instrument, quantity, amount?, date? }]. */
function parse(from, body) {
  // NFC so the accented labels below match however the mail encoded them.
  body = body.normalize('NFC');

  if (/vpbanks\.com\.vn/i.test(from)) {
    // "…cho kỳ mua ngày 16/10/2026" is the buy's own date, the one Netlens has, so the order
    // pairs with exactly that buy. Labelled lines: "Mã CCQ: VCBF-TBF",
    // "Số tiền Mua CCQ: 1,000,000", "Khối lượng CCQ đã khớp: 26.67".
    if (!/Kết quả giao dịch\s*:\s*Thành công/i.test(body)) return [];
    const date = (body.match(/kỳ mua ngày\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1];
    const instrument = (body.match(/Mã CCQ\s*:\s*([A-Z0-9-]+)/i) || [])[1];
    const amount = (body.match(/Số tiền Mua CCQ\s*:\s*([\d,.]+)/i) || [])[1];
    const units = (body.match(/Khối lượng CCQ đã khớp\s*:\s*([\d,.]+)/i) || [])[1];
    if (!instrument || !units) return [];
    return [{
      instrument: instrument,
      quantity: enNumber(units),
      amount: amount ? enNumber(amount) : undefined,
      date: date ? isoDate(date) : undefined,
    }];
  }

  if (/dragoncapital\.com\.vn/i.test(from)) {
    // The fund is the end of the heading, "QUỸ ĐẦU TƯ CHỨNG KHOÁN NĂNG ĐỘNG DC - DCDS". Each
    // trade is a table row: trading date, registered amount, actual amount, NAV, units. That
    // date is the NAV date (T+1), not the buy's. The buy's date is the Order ID's first six
    // digits, YYMMDD ("261016…" for the 2026-10-16 buy), so the order pairs with
    // exactly that buy. An ID that doesn't start with a date is left unread, not guessed at.
    const instrument = (body.match(/QUỸ [^-]*?\s-\s*([A-Z0-9-]+)/) || [])[1];
    const id = body.match(/Order ID:\s*(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d+/);
    if (!instrument || !id) return [];
    const date = '20' + id[1] + '-' + id[2] + '-' + id[3];
    const num = '([\\d,]+(?:\\.\\d+)?)';
    const row = new RegExp('\\d{2}/\\d{2}/\\d{4}\\s+' + [num, num, num, num].join('\\s+'), 'g');
    return Array.from(body.matchAll(row), function (m) {
      return { instrument: instrument, amount: enNumber(m[1]), quantity: enNumber(m[4]), date: date };
    });
  }

  return [];
}

/** "9,000,000" → 9000000, "97.65" → 97.65: commas group thousands, the dot is the decimal. */
function enNumber(s) {
  return Number(s.replace(/,/g, ''));
}

/** "16/10/2026" → "2026-10-16". */
function isoDate(dmy) {
  const p = dmy.split('/');
  return p[2] + '-' + p[1] + '-' + p[0];
}

/** True when the order is settled: confirmed now, or nothing left to do for it. */
function confirm(order) {
  const props = PropertiesService.getScriptProperties();
  const id = (props.getProperty('CF_ACCESS_CLIENT_ID') || '').trim();
  const secret = (props.getProperty('CF_ACCESS_CLIENT_SECRET') || '').trim();
  if (!id || !secret) throw new Error('Set the CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET Script Properties.');
  const res = UrlFetchApp.fetch(CONFIG.url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(order),
    headers: {
      'CF-Access-Client-Id': id,
      'CF-Access-Client-Secret': secret,
    },
    // A rejected token is a redirect to the Access login page: surface it, don't follow it.
    followRedirects: false,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const location = res.getHeaders()['Location'] || res.getHeaders()['location'];
  console.log(code, JSON.stringify(order), location ? 'redirect to ' + location : res.getContentText().slice(0, 300));
  if (code === 200) return true;
  if (code === 404) return false;
  if (code === 302 || code === 401 || code === 403)
    // A redirect to the Access login page means the token wasn't accepted for this path: the
    // policy's action must be Service Auth (not Allow), on an Access app for this exact path.
    throw new Error('Cloudflare Access rejected the service token (' + code + '). See docs/CLOUDFLARE.md#the-fund-units-api.');
  return true; // 400/409: a bad parse or already confirmed; retrying the same email won't help.
}

/** Test: log what `run` would send from your real inbox, without sending or labelling. An
 *  email it can't read logs the start of its text, the text `parse` has to match. */
function dryRun() {
  for (const thread of GmailApp.search(CONFIG.query).reverse()) {
    for (const message of thread.getMessages()) {
      const body = htmlToText(message.getBody());
      const orders = parse(message.getFrom(), body);
      console.log(message.getDate() + ' | ' + message.getSubject() + '\n' +
        (orders.length ? JSON.stringify(orders) : 'NO ORDER, text:\n' + body.slice(0, 2000)));
    }
  }
}

/** Run once: checks the inbox every 15 minutes. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();
}
