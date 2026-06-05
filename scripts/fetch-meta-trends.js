import fs from "fs";
import fetch from "node-fetch";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = process.env.META_ACTOR_ID || "webdatalabs/meta-ad-library-scraper";
const COUNTRY = process.env.META_COUNTRY || "US";
const MAX_ADS_PER_QUERY = Number(process.env.META_MAX_ADS_PER_QUERY || 20);

if (!APIFY_TOKEN) {
  console.error("Missing APIFY_TOKEN secret.");
  process.exit(1);
}

const queries = [
  "pet products", "cat litter box", "dog stairs", "pet grooming", "pet accessories",
  "kitchen gadget", "home decor", "home storage", "beauty tools", "skincare",
  "ice roller", "face roller", "hair care", "wireless charger", "phone accessories",
  "led lights", "fitness products", "home workout", "car accessories", "cleaning tools"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function apify(path, options = {}) {
  const url = `https://api.apify.com/v2${path}${path.includes("?") ? "&" : "?"}token=${APIFY_TOKEN}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Apify error ${res.status}: ${JSON.stringify(data).slice(0, 700)}`);
  return data;
}

async function runActor() {
  const input = {
    searchQueries: queries,
    country: COUNTRY,
    adStatus: "active",
    adType: "all",
    mediaType: "all",
    maxAdsPerQuery: MAX_ADS_PER_QUERY
  };

  const run = await apify(`/acts/${encodeURIComponent(ACTOR_ID)}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  const runId = run?.data?.id;
  if (!runId) throw new Error("No Apify run ID returned.");

  for (let i = 0; i < 90; i++) {
    const status = await apify(`/actor-runs/${runId}`);
    const runStatus = status?.data?.status;
    console.log("Apify status:", runStatus);

    if (runStatus === "SUCCEEDED") return status?.data?.defaultDatasetId;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) {
      throw new Error(`Apify run ended with status ${runStatus}`);
    }
    await sleep(10000);
  }
  throw new Error("Apify run timeout.");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function keywordsForAd(ad) {
  const text = [ad.pageName, ad.adCopy, ad.headline, ad.landingUrl].map(cleanText).join(" ").toLowerCase();
  const matched = [];
  for (const q of queries) {
    const parts = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (parts.some(w => text.includes(w))) matched.push(q);
  }
  return matched.length ? matched : ["general"];
}

function normalizeAd(ad) {
  return {
    pageName: cleanText(ad.pageName),
    adCopy: cleanText(ad.adCopy),
    headline: cleanText(ad.headline),
    isActive: Boolean(ad.isActive),
    platforms: Array.isArray(ad.platforms) ? ad.platforms : [],
    runDurationDays: Number(ad.runDurationDays || 0),
    sentimentLabel: cleanText(ad.sentimentLabel),
    ctaType: cleanText(ad.ctaType),
    landingUrl: cleanText(ad.landingUrl),
    keywords: keywordsForAd(ad)
  };
}

async function main() {
  const datasetId = await runActor();
  if (!datasetId) throw new Error("No dataset ID returned.");

  const items = await apify(`/datasets/${datasetId}/items?clean=true&format=json`);
  const ads = Array.isArray(items) ? items.map(normalizeAd).filter(a => a.pageName || a.adCopy || a.headline) : [];

  const byKeyword = {};
  for (const ad of ads) {
    for (const keyword of ad.keywords) {
      byKeyword[keyword] ||= { keyword, activeAds: 0, totalAds: 0, avgRunDays: 0, platforms: {}, sampleAds: [] };
      const s = byKeyword[keyword];
      s.totalAds++;
      if (ad.isActive) s.activeAds++;
      s.avgRunDays += ad.runDurationDays || 0;
      for (const p of ad.platforms) s.platforms[p] = (s.platforms[p] || 0) + 1;
      if (s.sampleAds.length < 3) {
        s.sampleAds.push({
          pageName: ad.pageName,
          headline: ad.headline,
          adCopy: ad.adCopy.slice(0, 180),
          landingUrl: ad.landingUrl,
          runDurationDays: ad.runDurationDays
        });
      }
    }
  }

  const signals = Object.values(byKeyword).map(s => {
    s.avgRunDays = s.totalAds ? Math.round(s.avgRunDays / s.totalAds) : 0;
    const volume = Math.min(60, Math.log10(s.activeAds + 1) * 35);
    const duration = Math.min(25, Math.log10(s.avgRunDays + 1) * 14);
    const platform = Math.min(15, Object.keys(s.platforms).length * 4);
    s.metaAdScore = Math.round(volume + duration + platform);
    return s;
  }).sort((a, b) => b.metaAdScore - a.metaAdScore);

  fs.writeFileSync("meta-ads.json", JSON.stringify(ads, null, 2));
  fs.writeFileSync("meta-trends.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: "Apify Meta Ad Library Scraper",
    actorId: ACTOR_ID,
    country: COUNTRY,
    adCount: ads.length,
    signals
  }, null, 2));

  console.log(`Saved ${ads.length} ads and ${signals.length} signals.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
