// 抓取台股（上市＋上櫃）收盤價，輸出 prices.json。需要 Node 18 以上。
import { writeFileSync } from 'node:fs';

async function get(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'accept': 'application/json'
    }
  });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 取得台灣當前日期字串 (YYYYMMDD)
const options = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' };
const [year, month, day] = new Intl.DateTimeFormat('en-CA', options).format(new Date()).split('-');
const todayYYYYMMDD = `${year}${month}${day}`;

const prices = {};
let tradeDate = null;

// 1. 上市（使用 TWSE 官網 MI_INDEX，結算更新速度遠快於 OpenAPI）
try {
  const twseUrl = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${todayYYYYMMDD}&type=ALLBUT0999`;
  const twseData = await get(twseUrl);

  if (twseData.stat === 'OK' && twseData.data9) {
    // 解析交易日期
    const rawDate = twseData.date; // 格式 "20261104"
    tradeDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    // 解析個股資料 (data9 通常為個股收盤價表格)
    for (const row of twseData.data9) {
      const code = String(row[0]).trim();
      const p = num(row[8]); // 第 9 欄 (Index 8) 為收盤價
      if (code && p) prices[code] = p;
    }
  } else {
    console.warn('TWSE 官網當日資料尚未上架，嘗試備用 OpenAPI...');
    // 備用方案：使用原 OpenAPI 介面
    const twseOpen = await get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    for (const x of twseOpen) {
      const p = num(x.ClosingPrice);
      if (p) prices[String(x.Code).trim()] = p;
    }
    const d = String(twseOpen[0]?.Date || '').replace(/\D/g, '');
    if (d.length === 7) tradeDate = `${+d.slice(0, 3) + 1911}-${d.slice(3, 5)}-${d.slice(5, 7)}`;
  }
} catch (e) {
  console.error('TWSE 抓取失敗:', e.message);
}

// 2. 上櫃（TPEx 櫃買中心 API）
try {
  const otc = await get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
  for (const x of otc) {
    const code = String(x.SecuritiesCompanyCode || '').trim();
    const p = num(x.Close);
    if (code && p && !(code in prices)) prices[code] = p;
  }
} catch (e) {
  console.warn('TPEx skipped:', e.message);
}

if (Object.keys(prices).length < 500) {
  throw new Error(`價格筆數太少 (${Object.keys(prices).length} 筆)，不寫入檔案`);
}

// 帶有時分秒的更新時間，方便確認執行時間點
const updatedTime = new Date().toLocaleString('sv', { timeZone: 'Asia/Taipei' });

writeFileSync('prices.json', JSON.stringify({
  updated: updatedTime,
  tradeDate: tradeDate || year + '-' + month + '-' + day,
  prices
}, null, 2));

console.log('更新成功！', `總計 ${Object.keys(prices).length} 筆`, '更新時間:', updatedTime, '交易日期:', tradeDate);
