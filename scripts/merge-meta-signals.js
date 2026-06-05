import fs from "fs";

const number = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

function words(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
}

function scoreMatch(product, signal) {
  const pText = [product.name, product.category, product.supplier, ...(product.tags || [])].join(" ").toLowerCase();
  const kWords = words(signal.keyword);
  if (!kWords.length) return 0;
  let hits = 0;
  for (const w of kWords) if (pText.includes(w)) hits++;
  return hits / kWords.length;
}

function main() {
  if (!fs.existsSync("products.json")) throw new Error("products.json not found");
  if (!fs.existsSync("meta-trends.json")) {
    console.log("No meta-trends.json found. Skipping.");
    return;
  }

  const products = JSON.parse(fs.readFileSync("products.json", "utf-8"));
  const meta = JSON.parse(fs.readFileSync("meta-trends.json", "utf-8"));
  const signals = Array.isArray(meta.signals) ? meta.signals : [];

  const enhanced = products.map(product => {
    let best = null;
    let bestMatch = 0;

    for (const signal of signals) {
      const match = scoreMatch(product, signal);
      if (match > bestMatch) {
        best = signal;
        bestMatch = match;
      }
    }

    if (best && bestMatch >= 0.45) {
      const boost = Math.round(number(best.metaAdScore) * Math.min(1, bestMatch));
      product.metaSignal = {
        keyword: best.keyword,
        activeAds: best.activeAds,
        totalAds: best.totalAds,
        avgRunDays: best.avgRunDays,
        metaAdScore: best.metaAdScore,
        match: Number(bestMatch.toFixed(2)),
        sampleAds: best.sampleAds || []
      };
      product.winningScore = Math.round(number(product.winningScore) + boost);
      product.trend = Math.min(100, Math.round(number(product.trend) + boost * 0.35));
      product.tags = Array.from(new Set([...(product.tags || []), "Meta validated"]));
    } else {
      product.metaSignal = { keyword: null, activeAds: 0, totalAds: 0, avgRunDays: 0, metaAdScore: 0, match: 0, sampleAds: [] };
    }
    return product;
  });

  enhanced.sort((a, b) => number(b.winningScore) - number(a.winningScore));
  fs.writeFileSync("products.json", JSON.stringify(enhanced, null, 2));

  const oldMeta = fs.existsSync("products-meta.json") ? JSON.parse(fs.readFileSync("products-meta.json", "utf-8")) : {};
  fs.writeFileSync("products-meta.json", JSON.stringify({
    ...oldMeta,
    metaEnhancedAt: new Date().toISOString(),
    metaSignals: signals.length,
    metaSource: meta.source || "Apify Meta Ad Library Scraper"
  }, null, 2));

  console.log(`Merged ${signals.length} Meta signals into ${enhanced.length} products.`);
}

main();
