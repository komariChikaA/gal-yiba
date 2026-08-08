import { VndbClient } from "../dist/index.js";

const client = new VndbClient();
const page = await client.listVisualNovels(1, 1);
const first = page.items[0];
if (!first || first.source !== "vndb" || !first.sourceId.startsWith("v")) {
  throw new Error("VNDB_SMOKE_INVALID_RESPONSE");
}
console.log(
  JSON.stringify({
    source: first.source,
    sourceId: first.sourceId,
    hasTitle: first.title.length > 0,
    heroineHairColors: first.heroineHairColors,
    animeAdaptation: first.animeAdaptation,
    ageRating: first.ageRating,
    hasMore: page.hasMore,
  }),
);
