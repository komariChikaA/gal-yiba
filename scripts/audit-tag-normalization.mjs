import { selectImportantTags } from "../packages/shared/dist/index.js";

const pageArgument = process.argv.find((argument) =>
  argument.startsWith("--pages="),
);
const pages = Math.max(
  1,
  Math.min(50, Number(pageArgument?.split("=")[1] ?? 10)),
);
const unmapped = new Map();
let works = 0;
let withAny = 0;
let withThree = 0;
const noTagExamples = [];

for (let page = 1; page <= pages; page += 1) {
  const response = await fetch("https://api.vndb.org/kana/vn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filters: [],
      fields: "title,tags{id,name,rating,spoiler,category}",
      sort: "votecount",
      reverse: true,
      results: 100,
      page,
    }),
  });
  if (!response.ok) throw new Error(`VNDB returned ${response.status}`);
  const payload = await response.json();
  for (const visualNovel of payload.results) {
    works += 1;
    const sourceTags = visualNovel.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      score: tag.rating,
      spoilerLevel: tag.spoiler,
      category: tag.category,
    }));
    const selected = selectImportantTags(sourceTags, [], 0);
    if (selected.length > 0) withAny += 1;
    if (selected.length === 3) withThree += 1;
    if (selected.length === 0 && noTagExamples.length < 25) {
      noTagExamples.push({
        id: visualNovel.id,
        title: visualNovel.title,
        topContentTags: sourceTags
          .filter((tag) => tag.category === "cont" && tag.spoilerLevel === 0)
          .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
          .slice(0, 8)
          .map((tag) => tag.name),
      });
    }
    const selectedIds = new Set(selected.map((tag) => tag.id).filter(Boolean));
    for (const tag of sourceTags) {
      if (
        tag.category === "cont" &&
        tag.spoilerLevel === 0 &&
        !selectedIds.has(tag.id)
      ) {
        unmapped.set(tag.name, (unmapped.get(tag.name) ?? 0) + 1);
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      sampledWorks: works,
      atLeastOneRepresentativeTag: withAny,
      threeRepresentativeTags: withThree,
      noRepresentativeTag: works - withAny,
      noRepresentativeExamples: noTagExamples,
      topUnselectedContentTags: [...unmapped]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .slice(0, 40)
        .map(([name, count]) => ({ name, count })),
    },
    null,
    2,
  ),
);
