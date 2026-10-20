// Self-check for the email parsers in gmail-fund-units.gs: node scripts/check-gmail-fund-units.mjs
// The samples keep the markup of real confirmations (both are HTML only), personal details removed.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('./gmail-fund-units.gs', import.meta.url), 'utf8'), ctx);
const read = (from, html) => JSON.parse(JSON.stringify(ctx.parse(from, ctx.htmlToText(html))));

const li = (text) =>
  `<li class="ListParagraph" style="margin-left: 10.52pt;"><span style="font-family: 'Times New Roman';">${text}</span></li>`;
const vp = `<div>
<p style="color: #29b04d;"><strong>Kính gửi Quý Khách hàng:</strong><strong> NGUYỄN VĂN A</strong></p>
<p><span style="font-family: 'Times New Roman';">Công ty Cổ phần chứng khoán VPBank (VPBankS) trân trọng thông báo kết quả khớp Lệnh Mua định kỳ Chứng chỉ Quỹ của Quý khách theo Kế hoạch mua mã 0000000</span><span style="font-family: 'Times New Roman';">, cho kỳ mua ngày</span><span style="font-weight: bold; color: #29b04d;"> 16/10/2026</span><span>, chi tiết như sau:</span></p>
<table class="TableGrid"><tbody>
<tr><td><ul type="disc">\r\n${li('Mã CCQ: VCBF-TBF')}\r\n</ul></td></tr>
<tr><td><ul type="disc">\r\n${li('Số tiền Mua CCQ: 1,000,000')}\r\n</ul></td></tr>
<tr><td><ul type="disc">\r\n${li('Khối lượng CCQ đã khớp: 26.67')}\r\n</ul></td></tr>
<tr><td><ul type="disc">\r\n${li('Giá mua CCQ: 37,483.79')}\r\n${li('Phí giao dịch mua: 0')}\r\n${li('Phiên giao dịch: 19/10/2026')}\r\n${li('Kết quả giao dịch: Thành công')}\r\n</ul></td></tr>
</tbody></table></div>`;

const cell = (text) =>
  `\t\t\t<td style="font-family: Verdana; border: 1px dashed rgb(187, 187, 187);">\r\n\t\t\t<p><span data-mce-style="font-weight: 400;" style="font-weight: 400;">${text}</span></p>\r\n\t\t\t</td>\r\n`;
const dc = `<p style="text-align: center;"><strong>XÁC NHẬN KẾT QUẢ MUA</strong></p>
<p style="text-align: center;"><span style="font-weight: 400;">CONFIRMATION OF SUBSCRIPTION </span></p>
<p style="text-align: center;"><strong>QUỸ ĐẦU TƯ CHỨNG KHOÁN NĂNG ĐỘNG DC<span>&nbsp;</span>- DCDS</strong><span style="font-weight: 400;"> </span></p>
<table class="mce-item-table"><tbody>
<tr><td><strong>Tên nhà đầu tư/ </strong><span>Investor name:</span></td><td>NGUYỄN VĂN A</td></tr>
<tr><td><strong>Địa chỉ/ </strong><span>Mailing address:</span></td><td><span>1/2A3 Đường Số 1, Quận 1 - Viet Nam</span></td></tr>
<tr><td><strong>Số giao dịch/ </strong><span>Order ID:</span></td><td>2610160000000</td></tr>
<tr><td><strong>Ngày giao dịch/ </strong><span>Trading date:</span></td><td>19/10/2026</td></tr>
</tbody></table>
<table class="mce-item-table"><tbody>
<tr><td colspan="4"><p><strong>Số dư đầu kỳ</strong><span>/ Prior period closing balance </span></p></td>${cell('&nbsp; 4,301.16')}</tr>
<tr>\r\n\t\t\t<td style="font-family: Verdana;">\r\n\t\t\t<p>19/10/2026</p>\r\n\t\t\t</td>\r\n${cell('  9,000,000')}${cell(' 9,000,000')}${cell('  92,164.47')}${cell('  97.65')}\t\t</tr>
<tr><td colspan="4"><p><strong>Số dư cuối kỳ</strong><span>/ Closing balance </span></p></td>${cell('  4,398.81')}</tr>
</tbody></table>
<div>Công ty Cổ phần Quản lý Quỹ Đầu tư Dragon Capital Việt Nam</div>`;

assert.deepStrictEqual(read('VPBank Securities <no-reply@vpbanks.com.vn>', vp), [
  { instrument: 'VCBF-TBF', quantity: 26.67, amount: 1000000, date: '2026-10-16' },
]);
// Decomposed accents (NFD) still match.
assert.strictEqual(read('no-reply@vpbanks.com.vn', vp.normalize('NFD')).length, 1);
// A failed order is not confirmed.
assert.strictEqual(read('no-reply@vpbanks.com.vn', vp.replace('Thành công', 'Không thành công')).length, 0);

assert.deepStrictEqual(read('Dragon Capital Vietnam <no_reply_t@mkt.dragoncapital.com.vn>', dc), [
  { instrument: 'DCDS', amount: 9000000, quantity: 97.65, date: '2026-10-16' },
]);
// An Order ID that doesn't start with a YYMMDD date: unread, rather than paired with a guess.
assert.strictEqual(read('x@dragoncapital.com.vn', dc.replace('2610160000000', '2613160000000')).length, 0);
// The balance rows and the address (which has its own "/" and " - ") are not orders.
assert.strictEqual(read('x@dragoncapital.com.vn', dc.replace(/<p>19\/10\/2026<\/p>/, '')).length, 0);

assert.strictEqual(read('someone@else.com', vp).length, 0);
assert.strictEqual(ctx.htmlToText('a&#7871;&#x1EBF;&amp;<b>b</b>\r\n\tc'), 'aếế& b c');
console.log('ok');
