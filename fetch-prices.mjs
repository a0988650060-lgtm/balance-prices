// 抓取台股（上市＋上櫃）收盤價，輸出 prices.json。需要 Node 18 以上。
import { writeFileSync } from 'node:fs';

async function get(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'accept': 'application/json, text/javascript, */*; q=0.01'
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

// 1. 上市（優先使用 TWSE 官網 MI_INDEX）
try {
  // 注意：date 參數若帶入當天，TWSE 會回傳該日資料；若為非交易日則 stat 會為非 OK
  const twseUrl = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${todayYYYYMMDD}&type=ALLBUT0999&response=json`;
  const twseData = await get(twseUrl);

  if (twseData.stat === 'OK' && (twseData.tables || twseData.data9)) {
    // 解析 TWSE RWD 新版或舊版資料結構
    const stockTable = twseData.tables 
      ? twseData.tables.find(t => t.title && t.title.includes('每日收盤行情'))?.data
      : twseData.data9;

    if (stockTable && stockTable.length > 0) {
      // 從返回資料取得實際交易日 (格式通常為 20261104)
      const rawDate = String(twseData.date || todayYYYYMMDD);
      tradeDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

      for (const row of stockTable) {
        const code = String(row[0]).trim();
        const p = num(row[8]); // 收盤價位於第 9 欄 (Index 8)
        if (code && p) prices[code] = p;
      }
      console.log(`成功從 TWSE 官網抓取 ${tradeDate} 收盤價，共 ${Object.keys(prices).length} 筆`);
    }
  }
} catch (e) {
  console.warn('TWSE 官網抓取失敗，準備嘗試 OpenAPI 備用方案:', e.message);
}

// 2. 若 TWSE 官網未抓到（例如今日非交易日/颱風假/休市），退回 OpenAPI
if (Object.keys(prices).length === 0) {
  try {
    const twseOpen = await get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    for (const x of twseOpen) {
      const p = num(x.ClosingPrice);
      if (p) prices[String(x.Code).trim()] = p;
    }
    const d = String(twseOpen[0]?.Date || '').replace(/\D/g, '');
    if (d.length === 7) tradeDate = `${+d.slice(0, 3) + 1911}-${d.slice(3, 5)}-${d.slice(5, 7)}`;
    else if (d.length === 8) tradeDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    console.log(`使用 TWSE OpenAPI 備用方案取得 ${tradeDate} 資料`);
  } catch (e) {
    console.error('TWSE OpenAPI 抓取失敗:', e.message);
  }
}

// 3. 上櫃（TPEx 櫃買中心 API）
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

// 取得帶有時分秒的更新時間
const updatedTime = new Date().toLocaleString('sv', { timeZone: 'Asia/Taipei' });

writeFileSync('prices.json', JSON.stringify({
  updated: updatedTime,
  tradeDate: tradeDate || `${year}-${month}-${day}`,
  prices
}, null, 2));

console.log('完成！筆數:', Object.keys(prices).length, '更新時間:', updatedTime, '交易日期:', tradeDate);