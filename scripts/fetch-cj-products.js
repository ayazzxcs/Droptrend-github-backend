import fs from "fs";
import fetch from "node-fetch";

const CJ_EMAIL = process.env.CJ_EMAIL;
const CJ_API_KEY = process.env.CJ_API_KEY;
const MAX_PAGES = Number(process.env.MAX_PAGES || 50);
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 200);

if (!CJ_EMAIL || !CJ_API_KEY) {
  console.error("Missing CJ_EMAIL or CJ_API_KEY GitHub secrets.");
  process.exit(1);
}

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

async function cjRequest(path, options = {}, token) {
  const res = await fetch(`${CJ_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "CJ-Access-Token": token } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`CJ request failed ${res.status}: ${text}`);
  return data;
}

async function getToken() {
  const data = await cjRequest("/authentication/getAccessToken", {
    method: "POST",
    body: JSON.stringify({ email: CJ_EMAIL, password: CJ_API_KEY })
  });
  const token = data?.data?.accessToken || data?.data?.access_token || data?.accessToken;
  if (!token) throw new Error(`No access token returned: ${JSON.stringify(data).slice(0, 500)}`);
  return token;
}

function normalizeProduct(p) {
  const cost = Number(p.sellPrice || p.sellprice || p.price || p.productPrice || 0);
  const shipping = Number(p.shippingPrice || p.shipping || 0);
  const suggestedPrice = Math.ceil((cost + shipping) * 2.2 || 0);
  const profit = Math.max(0, suggestedPrice - cost - shipping);
  const margin = suggestedPrice ? Math.round((profit / suggestedPrice) * 100) : 0;

  return {
    id: p.pid || p.productId || p.id || p.sku || cryptoRandom(),
    name: p.productNameEn || p.productName || p.name || "Untitled product",
    image: p.productImage || p.productImageSet?.[0] || p.image || p.bigImage || "",
    supplier: "CJdropshipping",
    supplierPrice: cost,
    shippingPrice: shipping,
    suggestedPrice,
    profit,
    margin,
    currency: "USD",
    category: p.categoryName || p.productType || "General",
    supplierUrl: p.productUrl || p.productLink || p.shopUrl || "https://www.cjdropshipping.com/",
    trendScore: Math.min(100, Math.max(45, margin + Math.floor(Math.random() * 35))),
    raw: p
  };
}

function cryptoRandom() {
  return `cj_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

async function fetchProductsPage(token, pageNum) {
  // CJ product list endpoint commonly supports pageNum/pageSize.
  // If CJ changes response shape, this parser still tries common locations.
  const query = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(PAGE_SIZE) });
  const data = await cjRequest(`/product/list?${query.toString()}`, { method: "GET" }, token);
  const list = data?.data?.list || data?.data?.content || data?.data || data?.list || [];
  return Array.isArray(list) ? list : [];
}

async function main() {
  console.log("Getting CJ access token...");
  const token = await getToken();
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`Fetching page ${page}/${MAX_PAGES}...`);
    const items = await fetchProductsPage(token, page);
    if (!items.length) {
      console.log("No more products returned. Stopping.");
      break;
    }

    for (const item of items) {
      const normalized = normalizeProduct(item);
      if (!seen.has(normalized.id)) {
        seen.add(normalized.id);
        all.push(normalized);
      }
    }

    if (items.length < PAGE_SIZE) {
      console.log("Last page reached.");
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    }

  all.sort((a, b) => (b.trendScore || 0) - (a.trendScore || 0));

  fs.writeFileSync("products.json", JSON.stringify(all, null, 2));
  fs.writeFileSync("products-meta.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    count: all.length,
    maxPages: MAX_PAGES,
    pageSize: PAGE_SIZE,
    source: "CJdropshipping"
  }, null, 2));

  console.log(`Saved ${all.length} products to products.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
