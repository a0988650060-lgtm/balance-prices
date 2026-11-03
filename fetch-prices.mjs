// 抓取台股（上市＋上櫃）收盤價，輸出 prices.json。需要 Node 18 以上。
import { writeFileSync } from 'node:fs';

async function get(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}
const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const prices = {};
const names = {};

// 上市（含大部分 ETF）
const twse = await get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
for (const x of twse) {
  const p = num(x.ClosingPrice);
  if (p) { const c = String(x.Code).trim(); prices[c] = p; names[c] = String(x.Name || '').trim(); }
}

// 上櫃（抓不到就略過，不影響上市資料）
try {
  const otc = await get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
  for (const x of otc) {
    const code = String(x.SecuritiesCompanyCode || '').trim();
    const p = num(x.Close);
    if (code && p && !(code in prices)) { prices[code] = p; names[code] = String(x.CompanyName || x.Name || '').trim(); }
  }
} catch (e) {
  console.warn('TPEx skipped:', e.message);
}

if (Object.keys(prices).length < 500) throw new Error('價格筆數太少，不寫入');

// 收盤價對應的交易日（民國 7 碼或西元 8 碼都能處理）
function toISO(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 7) return `${+d.slice(0, 3) + 1911}-${d.slice(3, 5)}-${d.slice(5, 7)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return null;
}
let tradeDate = toISO(twse[0] && twse[0].Date);
if (!tradeDate) {
  try {
    const avg = await get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL');
    tradeDate = toISO(avg[0] && avg[0].Date);
  } catch (e) {
    console.warn('no trade date:', e.message);
  }
}

const updated = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Taipei' });
writeFileSync('prices.json', JSON.stringify({ updated, tradeDate, prices, names }));
console.log('ok', Object.keys(prices).length, updated, tradeDate);
