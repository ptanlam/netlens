/**
 * Google Apps Script: read fund-purchase confirmation emails and confirm their units in
 * Netlens (POST /api/fund-units). Paste into script.google.com, set the two Script
 * Properties below, adapt `parse()` to your fund's email, run `installTrigger` once.
 *
 * Script Properties (Project Settings → Script Properties) — never in this file:
 *   CF_ACCESS_CLIENT_ID      the Access service token's Client ID
 *   CF_ACCESS_CLIENT_SECRET  the Access service token's Client Secret
 * Setup of that token: docs/CLOUDFLARE.md#the-fund-units-api
 */
const CONFIG = {
  url: 'https://netlens.lamphan.com/api/fund-units',
  // Which emails are confirmations. Narrow it to your fund's sender and subject.
  query: 'from:(YOUR-FUND-SENDER) newer_than:14d -label:netlens-done',
  doneLabel: 'netlens-done',
};

function run() {
  const props = PropertiesService.getScriptProperties();
  const label = GmailApp.getUserLabelByName(CONFIG.doneLabel) || GmailApp.createLabel(CONFIG.doneLabel);
  for (const thread of GmailApp.search(CONFIG.query)) {
    let allDone = true;
    for (const message of thread.getMessages()) {
      const orders = parse(message.getPlainBody());
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
 * One email → the orders it confirms: [{ instrument, quantity, amount?, date? }].
 * shortcut: the patterns below are a guess at a Vietnamese fund email; replace them with
 * the wording of yours. Add `date` (the buy's date, YYYY-MM-DD, as entered in Netlens) if
 * the email shows it: it pairs the email with exactly that buy instead of the oldest one.
 */
function parse(body) {
  const instrument = (body.match(/Mã (?:quỹ|CCQ)\s*[:：]?\s*([A-Z0-9-]+)/i) || [])[1];
  const units = (body.match(/Số lượng (?:CCQ|chứng chỉ quỹ)[^0-9]*([\d.,]+)/i) || [])[1];
  if (!instrument || !units) return [];
  return [{ instrument: instrument, quantity: viNumber(units) }];
}

/** "1.234,56" → 1234.56: dots group thousands, the comma is the decimal point. */
function viNumber(s) {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

/** True when the order is settled: confirmed now, or nothing left to do for it. */
function confirm(order) {
  const props = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(CONFIG.url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(order),
    headers: {
      'CF-Access-Client-Id': props.getProperty('CF_ACCESS_CLIENT_ID'),
      'CF-Access-Client-Secret': props.getProperty('CF_ACCESS_CLIENT_SECRET'),
    },
    // A rejected token is a redirect to the Access login page: surface it, don't follow it.
    followRedirects: false,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  console.log(code, JSON.stringify(order), res.getContentText().slice(0, 300));
  if (code === 200) return true;
  if (code === 404) return false;
  if (code === 302 || code === 401 || code === 403)
    throw new Error('Cloudflare Access rejected the service token — check the Script Properties.');
  return true; // 400/409: a bad parse or already confirmed; retrying the same email won't help.
}

/** Run once: checks the inbox every 15 minutes. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();
}
