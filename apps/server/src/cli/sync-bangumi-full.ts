import "dotenv/config";
import { BangumiClient } from "@gal-yiba/data";
import { CatalogRepository, createDatabasePool, migrateDatabase } from "../db/index.js";

function arg(name: string, fallback?: string): string | undefined {
  const p=`--${name}=`; return process.argv.find(a=>a.startsWith(p))?.slice(p.length) ?? fallback;
}
const userAgent=process.env.BANGUMI_USER_AGENT;
if(!userAgent) throw new Error("BANGUMI_USER_AGENT_REQUIRED");
const pool=createDatabasePool();
try{
  await migrateDatabase(pool);
  const repo=new CatalogRepository(pool);
  const client=new BangumiClient({userAgent, ...(process.env.BANGUMI_ACCESS_TOKEN?{accessToken:process.env.BANGUMI_ACCESS_TOKEN}:{}), ...(process.env.BANGUMI_API_BASE?{baseUrl:process.env.BANGUMI_API_BASE}:{})});
  const limitPerPage=Math.min(100, Math.max(1, Number(arg("limit","100"))));
  const startOffset=Math.max(0, Number(arg("offset","0")));
  const maxPages=Number(arg("max-pages","50")); // 50*100=5000 max
  console.log(`[full-sync] base=${(client as any).baseUrl ?? process.env.BANGUMI_API_BASE} auth=${(client as any).isAuthenticated ?? !!process.env.BANGUMI_ACCESS_TOKEN} limit=${limitPerPage} offset=${startOffset} maxPages=${maxPages}`);
  let offset=startOffset, pages=0, inserted=0, updated=0, unchanged=0, totalFetched=0;
  for(let i=0;i<maxPages;i++){
    const batch=await client.browseRaw(offset, limitPerPage);
    if(batch.length===0){ console.log(`[full-sync] empty at offset ${offset}, stop`); break; }
    console.log(`[full-sync] page ${pages+1} offset ${offset} fetched ${batch.length}`);
    for(const subj of batch){
      const rec=client.normalizeRaw(subj);
      const r=await repo.upsertSourceRecord(rec);
      if(r==="inserted") inserted++; else if(r==="updated") updated++; else unchanged++;
      totalFetched++;
    }
    pages++; offset+=batch.length;
    if(batch.length < limitPerPage) break;
    await new Promise(r=>setTimeout(r, 220));
  }
  console.log(JSON.stringify({pages, totalFetched, inserted, updated, unchanged, nextOffset: offset}));
} finally { await pool.end(); }
