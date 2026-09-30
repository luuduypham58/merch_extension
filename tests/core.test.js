const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const {
  parseListingFromAssistantText,
  resolveListingFieldMap,
  resolveArtworkInput,
  choosePreferredProducts,
  chooseProductPlan,
  DEFAULT_BOOK_LOVER_PROFILE,
  buildBatchPrompt,
  buildArtworkPrompt,
  creativeMemoryFromSavedDesigns,
  creativeVariationFromKey,
  creativeFingerprintForJob,
  buildListingPrompt,
  buildRegenerationPrompt,
  buildArtworkRetryPrompt,
  normalizeSavedDesign,
  safeTitleSlug
} = require("../merch-flow-core.js");

const JOB_ID = "a2e6a4d8-877f-4d11-9d8c-48b8a2ee8e3b";
const validListing = {
  merch_flow: true,
  job_id: JOB_ID,
  title: "Funny Bookworm Nightstand T-Shirt",
  brand: "Quiet Reader Club",
  bullet1: "A witty reading shirt for proud late-night book lovers.",
  bullet2: "A thoughtful gift for readers, librarians, and teachers.",
  description: "A comfortable graphic tee for anyone whose reading stack keeps growing."
};

function fenced(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

test("does not accept JSON-like placeholder data from a user prompt", () => {
  const userPromptSchema = fenced({
    merch_flow: true,
    job_id: "{{JOB_ID}}",
    title: "<FINAL_TITLE>",
    brand: "<FINAL_BRAND>",
    bullet1: "<FINAL_BULLET_1>",
    bullet2: "<FINAL_BULLET_2>",
    description: "<FINAL_DESCRIPTION>"
  });
  assert.equal(parseListingFromAssistantText(userPromptSchema, JOB_ID), null);
});

test("parses a valid assistant listing with the expected job id", () => {
  const result = parseListingFromAssistantText(`Here is the final listing:\n${fenced(validListing)}`, JOB_ID);
  assert.deepEqual(result, {
    jobId: JOB_ID,
    title: validListing.title,
    brand: validListing.brand,
    bullet1: validListing.bullet1,
    bullet2: validListing.bullet2,
    description: validListing.description
  });
});


test("parses a valid unfenced JSON object from assistant prose", () => {
  const result = parseListingFromAssistantText(`Done.\n${JSON.stringify(validListing)}\nPlease review it.`, JOB_ID);
  assert.equal(result.title, validListing.title);
  assert.equal(result.jobId, JOB_ID);
});

test("parses a valid JSON object in a generic code fence", () => {
  const result = parseListingFromAssistantText(`\`\`\`\n${JSON.stringify(validListing)}\n\`\`\``, JOB_ID);
  assert.equal(result.brand, validListing.brand);
});

test("rejects an assistant listing for a different job", () => {
  assert.equal(parseListingFromAssistantText(fenced({ ...validListing, job_id: "other-job" }), JOB_ID), null);
});

test("rejects known placeholder listing values", () => {
  assert.equal(parseListingFromAssistantText(fenced({ ...validListing, title: "under 60 characters" }), JOB_ID), null);
});

test("rejects the exact human-readable placeholders used by the listing prompt", () => {
  const placeholders = {
    ...validListing,
    title: "<FINAL AMAZON TITLE, MAX 60 CHARACTERS>",
    brand: "<FINAL ORIGINAL BRAND>",
    bullet1: "<FINAL CUSTOMER-FACING BULLET>",
    bullet2: "<FINAL GIFT/STYLE BULLET>",
    description: "<FINAL SHORT NATURAL DESCRIPTION>"
  };
  assert.equal(parseListingFromAssistantText(fenced(placeholders), JOB_ID), null);
});

test("rejects a listing with a missing field", () => {
  const incomplete = { ...validListing };
  delete incomplete.description;
  assert.equal(parseListingFromAssistantText(fenced(incomplete), JOB_ID), null);
});

test("uses the correct JSON block when multiple fenced blocks exist", () => {
  const wrong = fenced({ ...validListing, job_id: "old-job" });
  const result = parseListingFromAssistantText(`${wrong}\n${fenced(validListing)}`, JOB_ID);
  assert.equal(result.title, validListing.title);
});

test("does not crash on an incomplete streaming JSON block", () => {
  assert.equal(parseListingFromAssistantText("```json\n{\"merch_flow\": true", JOB_ID), null);
});

test("maps listing fields once and reports unresolved fields", () => {
  const fields = [
    { id: "product-title", kind: "text", labelText: "Product title" },
    { id: "brand-name", kind: "text", labelText: "Brand name" },
    { id: "feature-bullet-1", kind: "text", labelText: "Feature bullet 1" }
  ];
  const result = resolveListingFieldMap(fields);
  assert.equal(result.mapping.title.id, "product-title");
  assert.equal(result.mapping.brand.id, "brand-name");
  assert.equal(result.mapping.bullet1.id, "feature-bullet-1");
  assert.deepEqual(result.missing, ["bullet2", "description"]);
  assert.equal(new Set(result.filled.map((key) => result.mapping[key].id)).size, result.filled.length);
});

test("does not select a non-artwork file input", () => {
  const result = resolveArtworkInput([
    { id: "account-csv", kind: "file", accept: ".csv", contextText: "Upload sales report", visible: true, linkedControlVisible: true },
    { id: "tracking-image", kind: "file", accept: "image/png", contextText: "Profile image", visible: false, linkedControlVisible: false }
  ]);
  assert.equal(result.input, null);
});

test("selects a strongly identified artwork file input", () => {
  const result = resolveArtworkInput([
    { id: "artwork-upload", kind: "file", accept: "image/png", contextText: "Drag and drop artwork here. Upload PNG design.", visible: false, linkedControlVisible: true }
  ]);
  assert.equal(result.input.id, "artwork-upload");
});

test("maps Amazon plural key product features labels", () => {
  const fields = [
    { id: "title", kind: "text", labelText: "Product title" },
    { id: "brand", kind: "text", labelText: "Brand name" },
    { id: "feature-1", kind: "textarea", labelText: "Key product features 1" },
    { id: "feature-2", kind: "textarea", labelText: "Key product features 2" },
    { id: "description", kind: "textarea", labelText: "Product description" }
  ];
  const result = resolveListingFieldMap(fields);
  assert.deepEqual(result.missing, []);
  assert.equal(result.mapping.bullet1.id, "feature-1");
  assert.equal(result.mapping.bullet2.id, "feature-2");
});

test("selects Amazon artwork input when accept is blank but context is strong", () => {
  const result = resolveArtworkInput([
    {
      id: "amazon-dropzone-input",
      kind: "file",
      accept: "",
      contextText: "Drag and drop artwork here or click to browse for a file",
      visible: false,
      linkedControlVisible: false
    }
  ]);
  assert.equal(result.input.id, "amazon-dropzone-input");
});

test("still rejects blank file input without artwork context", () => {
  const result = resolveArtworkInput([
    {
      id: "generic-file",
      kind: "file",
      accept: "",
      contextText: "Attach document",
      visible: true,
      linkedControlVisible: true
    }
  ]);
  assert.equal(result.input, null);
});

test("ships with the monochrome winner grammar as the book-lover default", () => {
  assert.equal(DEFAULT_BOOK_LOVER_PROFILE.name, "book lovers");
  assert.equal(DEFAULT_BOOK_LOVER_PROFILE.language, "English");
  assert.equal(DEFAULT_BOOK_LOVER_PROFILE.style, "monochrome visual gag");
  assert.equal(DEFAULT_BOOK_LOVER_PROFILE.profileVersion, "book-winner-creative-scene-v3");
  assert.match(DEFAULT_BOOK_LOVER_PROFILE.winningStyle, /white-only/i);
  assert.match(DEFAULT_BOOK_LOVER_PROFILE.winningStyle, /pictogram/i);
  assert.match(DEFAULT_BOOK_LOVER_PROFILE.audience, /bookworms/i);
  assert.match(DEFAULT_BOOK_LOVER_PROFILE.avoid, /trademarks/i);
});


const AMAZON_PRODUCTS = [
  "Standard t-shirt", "Value Graphic T-shirt", "Premium t-shirt", "Comfort Colors heavyweight t-shirt",
  "V-neck t-shirt", "Tank top", "Long sleeve t-shirt", "Raglan", "Sweatshirt",
  "Comfort Colors Sweatshirt", "Comfort Colors Crop Sweatshirt", "Crop top", "Pullover hoodie",
  "Zip hoodie", "Performance Hoodie", "PopSockets", "iPhone cases", "Tote bag", "Throw pillows",
  "Tumbler", "Ceramic Mug", "Water Bottle"
].map((name) => ({ name, available: name !== "Value Graphic T-shirt" }));

test("chooses exactly ten safe default products with Standard t-shirt as primary", () => {
  const plan = chooseProductPlan(AMAZON_PRODUCTS, 10, { listing: validListing });
  assert.equal(plan.products.length, 10);
  assert.equal(plan.primary.name, "Standard t-shirt");
  assert.equal(plan.products[0].name, "Standard t-shirt");
  assert.equal(plan.products.filter((product) => ["Tote bag", "Ceramic Mug", "Tumbler", "Water Bottle", "Throw pillows", "iPhone cases", "PopSockets"].includes(product.name)).length <= 2, true);
});

test("book lover context selects relevant tote and mug instead of weak apparel variants", () => {
  const plan = chooseProductPlan(AMAZON_PRODUCTS, 10, {
    listing: validListing,
    nicheProfile: { name: "book lovers", audience: "readers, librarians and teachers", style: "clean retro" },
    artworkAnalysis: { aspectRatio: 0.8, coverage: 0.5 }
  });
  const names = plan.products.map((product) => product.name);
  assert.equal(plan.primary.name, "Standard t-shirt");
  assert.equal(names.includes("Tote bag"), true);
  assert.equal(names.includes("Ceramic Mug"), true);
  assert.equal(names.includes("Zip hoodie"), false);
  assert.equal(names.includes("Performance Hoodie"), false);
  assert.equal(plan.contextFlags.includes("bookish"), true);
});

test("fitness context promotes tank, performance hoodie, and water bottle", () => {
  const plan = chooseProductPlan(AMAZON_PRODUCTS, 10, {
    listing: { ...validListing, title: "Funny Gym Runner Workout Shirt", brand: "Active Pace Co", bullet1: "For runners and gym workouts", bullet2: "Fitness gift", description: "Outdoor training design" },
    nicheProfile: { name: "fitness runners" }
  });
  const names = plan.products.map((product) => product.name);
  assert.equal(names.includes("Tank top"), true);
  assert.equal(names.includes("Performance Hoodie"), true);
  assert.equal(names.includes("Water Bottle"), true);
  assert.equal(names.includes("Ceramic Mug"), false);
});

test("summer context avoids overloading warm garments", () => {
  const plan = chooseProductPlan(AMAZON_PRODUCTS, 10, {
    listing: { ...validListing, title: "Summer Beach Vacation Tee", bullet1: "Sunny beach trip", bullet2: "Vacation gift", description: "Tropical summer design" }
  });
  const names = plan.products.map((product) => product.name);
  assert.equal(names.includes("Tank top"), true);
  assert.equal(names.includes("V-neck t-shirt"), true);
  assert.equal(names.includes("Tote bag"), true);
});

test("skips unavailable products and never invents unknown products", () => {
  const products = [
    { name: "Standard t-shirt", available: false },
    { name: "Premium t-shirt", available: true },
    { name: "Ceramic Mug", available: true },
    { name: "Mystery Product", available: true }
  ];
  const selected = choosePreferredProducts(products, 10, { listing: validListing });
  assert.deepEqual(selected.map((product) => product.name), ["Premium t-shirt", "Ceramic Mug"]);
});


test("ChatGPT flow strictly confirms the Job ID marker instead of any new user message", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /Không xác nhận được brief có Job ID đã gửi/);
  assert.doesNotMatch(source, /messages\.length > previousUserCount/);
});

test("ChatGPT flow can recover when the reference image was sent as a separate message", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /referenceAlreadySent/);
  assert.match(source, /prompt-after-reference/);
  assert.match(source, /allowPendingWithoutUrl/);
});

test("side panel resume uses the v6 retry path for failed prompt jobs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(source, /MERCH_FLOW_RESUME_V6/);
  assert.match(source, /Đã gửi lại đúng brief có Job ID/);
});

test("initial prompt uses the shared compact behavior-first artwork brief", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(source, /Core\.buildArtworkPrompt/);
  const prompt = buildArtworkPrompt({ jobId: JOB_ID, profile: DEFAULT_BOOK_LOVER_PROFILE });
  assert.match(prompt, /MERCH_FLOW_IMAGE_REQUEST: NEW/);
  assert.match(prompt, /render the image now/i);
  assert.match(prompt, /only solid white/i);
  assert.match(prompt, /instantly recognizable lived reader situation/i);
  assert.match(prompt, /never use these saturated concepts/i);
  assert.match(prompt, /just one more chapter/i);
  assert.ok(prompt.length < 1800, `compact artwork prompt is unexpectedly ${prompt.length} characters`);
  assert.doesNotMatch(prompt, /THINK SILENTLY|HIGH-VALUE READER TERRITORIES|FINAL SILENT SELF-CHECK/);
  assert.doesNotMatch(prompt, /Propose 5 fresh concepts/);
});

test("v0.9.34 uses strict fresh-chat ownership and removes legacy opener fallbacks", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.doesNotMatch(popup, /MERCH_FLOW_OPEN_CHAT_V1/);
  assert.doesNotMatch(background, /ensureManagedChatTab|findManagedChatCandidate|managedChatOpenChain/);
  assert.doesNotMatch(background, /Merch \(Flow\|Design\|Listing\)/);
  assert.match(background, /MERCH_FLOW_START_FRESH_CHAT_V1/);
  assert.match(background, /return "https:\/\/chatgpt\.com\/"/);
});

test("opening Chrome does not auto-start ChatGPT for a persisted batch", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const startup = background.match(/chrome\.runtime\.onStartup\.addListener\(async \(\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(startup, "startup listener should exist");
  assert.match(startup[1], /status: "paused"/);
  assert.doesNotMatch(startup[1], /startNextBatchJob\(/);
  assert.doesNotMatch(startup[1], /chrome\.tabs\.create/);
});

test("Amazon Merch content script never opens ChatGPT by itself", () => {
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  assert.doesNotMatch(merch, /MERCH_FLOW_OPEN_CHAT_V1/);
  assert.doesNotMatch(merch, /chatgpt\.com/);
  assert.doesNotMatch(merch, /chrome\.tabs\.create/);
});

test("batch startup migrates stale clean-retro book profiles to the winner profile", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(background, /staleDefaultProfile/);
  assert.match(background, /profileVersion: Core\.DEFAULT_BOOK_LOVER_PROFILE\.profileVersion/);
});

test("ChatGPT flow automatically retries artwork generation when a response has no image", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /ARTWORK_RETRY_MAX = 3/);
  assert.match(source, /maybeRequestArtworkRetry/);
  assert.match(source, /Core\.buildArtworkRetryPrompt/);
  const sourcePrompt = `MERCH_FLOW_JOB_ID: ${JOB_ID}\nMERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW\nCreate exactly ONE original artwork.`;
  const prompt = buildArtworkRetryPrompt(JOB_ID, 1, sourcePrompt);
  assert.match(prompt, /MERCH_FLOW_ARTWORK_RETRY/);
  assert.doesNotMatch(prompt, /MERCH_FLOW_IMAGE_MODE/);
  assert.match(prompt, /MERCH_FLOW_IMAGE_REQUEST: NEW/);
  assert.match(prompt, /Generate exactly one new transparent-background T-shirt artwork/i);
  assert.doesNotMatch(prompt, /ORIGINAL WRITTEN ARTWORK BRIEF FOLLOWS|Create exactly ONE original artwork/);
  assert.ok(prompt.length < 1800, `compact retry prompt is unexpectedly ${prompt.length} characters`);
});

test("image prep defaults to winner white-only transparent cleanup", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  assert.match(html, /id="winner-white-only" checked/);
  assert.match(popup, /function enforceWinnerWhiteOnly/);
  assert.match(popup, /winner-white-only/);
  assert.match(popup, /data\[index\] = 255/);
});

test("regenerate artwork starts a blank ChatGPT conversation with no image attachment and keeps the same job id", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const start = source.indexOf("async function regenerateArtwork() {");
  const end = source.indexOf("function downloadBlob", start);
  assert.ok(start >= 0 && end > start, "regenerateArtwork function should exist");
  const body = source.slice(start, end);
  assert.match(body, /const jobId = flowData\.lastSentChatJob\?\.jobId/);
  assert.match(body, /referenceDataUrl:\s*""/);
  assert.match(body, /runMode:\s*"fresh-artwork-attempt"/);
  assert.match(body, /MERCH_FLOW_START_FRESH_CHAT_V1/);
  assert.match(body, /sessionNonce = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(body, /MERCH_FLOW_REGENERATE_ARTWORK_V1/);
});

test("revision prompt creates a new capture boundary while preserving the job id", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(source, /Core\.buildRegenerationPrompt/);
  const prompt = buildRegenerationPrompt({ jobId: JOB_ID, revision: 2, profile: DEFAULT_BOOK_LOVER_PROFILE });
  assert.match(prompt, /MERCH_FLOW_ARTWORK_ATTEMPT: 2/);
  assert.match(prompt, new RegExp(`MERCH_FLOW_JOB_ID: ${JOB_ID}`));
  assert.doesNotMatch(prompt, /regenerate|revision|rejected/i);
  assert.doesNotMatch(prompt, /reference image|rejected artwork|previous artwork|image target|same conversation|attached winner/i);
});

test("fresh-chat regeneration persists revision metadata into the sent job boundary", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /regenerationRevision: Math\.max\(0, Number\(pendingChatJob\.regenerationRevision/);
  assert.match(source, /regenerationMessageIndex: pendingChatJob\.regenerationRevision/);
  assert.match(source, /conversationKey: location\.pathname/);
});

test("listing capture cannot reuse an old listing from before the latest revision marker", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /const latestMarker = findJobMarkerMessage\(job\.jobId\)/);
  assert.match(source, /Math\.max\(currentIndex, storedIndex, latestMarkerIndex\)/);
});


test("batch prompt is image-first and locked to the winner grammar", () => {
  const prompt = buildBatchPrompt({
    jobId: JOB_ID,
    index: 3,
    total: 10,
    batchId: "batch-test",
    profile: DEFAULT_BOOK_LOVER_PROFILE,
    avoidTitles: ["Weekend Chapter Forecast", "My Social Battery"]
  });
  assert.match(prompt, new RegExp(`MERCH_FLOW_JOB_ID: ${JOB_ID}`));
  assert.match(prompt, /MERCH_FLOW_BATCH: 3\/10/);
  assert.match(prompt, /only solid white/i);
  assert.match(prompt, /pictogram/i);
  assert.match(prompt, /Memory:/i);
  assert.match(prompt, /Visual construction:/i);
  assert.match(prompt, /Do not default to a lone centered reader/i);
  assert.match(prompt, /render the image now/i);
  assert.ok(prompt.length < 1800, `compact batch prompt is unexpectedly ${prompt.length} characters`);
  assert.doesNotMatch(prompt, /"job_id":/);
});

test("creative memory carries title plus description and de-duplicates recent saved concepts", () => {
  const memory = creativeMemoryFromSavedDesigns([
    { createdAt: 1, listing: { title: "Late Night Reader", description: "Reader stays awake until sunrise." } },
    { createdAt: 2, listing: { title: "Food At The Door", description: "Reader refuses interruption during a good chapter." } }
  ]);
  assert.equal(memory.length, 2);
  assert.match(memory[0], /Late Night Reader/);
  assert.match(memory[1], /good chapter/);
});

test("creative lanes materially vary situation territory and visual construction across jobs", () => {
  const lanes = Array.from({ length: 24 }, (_, index) => creativeVariationFromKey(`job-${index}`));
  assert.ok(new Set(lanes.map((lane) => lane.territory)).size >= 6);
  assert.ok(new Set(lanes.map((lane) => lane.construction)).size >= 6);
});

test("a 10-item batch rotates through ten different visual constructions", () => {
  const lanes = Array.from({ length: 10 }, (_, index) => creativeVariationFromKey(`batch-slot:batch-A:${index + 1}`));
  assert.equal(new Set(lanes.map((lane) => lane.construction)).size, 10);
  assert.equal(new Set(lanes.map((lane) => lane.territory)).size, 10);
});

test("creative fingerprint records the same lane assigned to the initial job", () => {
  const lane = creativeVariationFromKey(JOB_ID);
  const fingerprint = creativeFingerprintForJob({ jobId: JOB_ID, revision: 0 });
  assert.match(fingerprint, new RegExp(`territory=${lane.territory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(fingerprint, new RegExp(`construction=${lane.construction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("artwork prompt activates silent exploration without restoring the fixed stick-figure template", () => {
  const prompt = buildArtworkPrompt({ jobId: JOB_ID, profile: DEFAULT_BOOK_LOVER_PROFILE });
  assert.match(prompt, /Silently explore 8 different lived-reader concepts/i);
  assert.match(prompt, /Visual construction:/i);
  assert.match(prompt, /setup \+ punchline is optional/i);
  assert.doesNotMatch(prompt, /one simple white stick-figure\/book pictogram/i);
  assert.ok(prompt.length < 1800);
});

test("listing prompt is US-English, JSON-only, and title-capped", () => {
  const prompt = buildListingPrompt(JOB_ID);
  assert.match(prompt, /natural US English/i);
  assert.match(prompt, /60 characters or fewer/i);
  assert.match(prompt, /Return ONLY one fenced JSON object/i);
  assert.match(prompt, new RegExp(`"job_id": "${JOB_ID}"`));
});

test("saved design package requires matching listing and embedded image", () => {
  const design = normalizeSavedDesign({
    id: "saved-1",
    jobId: JOB_ID,
    artworkDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    artworkName: "artwork.png",
    listing: {
      jobId: JOB_ID,
      title: validListing.title,
      brand: validListing.brand,
      bullet1: validListing.bullet1,
      bullet2: validListing.bullet2,
      description: validListing.description,
      source: "chatgpt-selected",
      artworkStorageKey: "artwork-storage-1",
      artworkRevision: 2,
      sessionNonce: "session-1",
      artworkMessageIndex: 8,
      messageIndex: 10
    }
  });
  assert.equal(design.jobId, JOB_ID);
  assert.equal(design.listing.title, validListing.title);
  assert.equal(design.listing.source, "chatgpt-selected");
  assert.equal(design.creativeFingerprint, "");
  assert.equal(design.listing.artworkStorageKey, "artwork-storage-1");
  assert.equal(design.listing.artworkRevision, 2);
  assert.equal(design.listing.sessionNonce, "session-1");
  assert.equal(design.listing.artworkMessageIndex, 8);
  assert.equal(design.listing.messageIndex, 10);
  assert.equal(normalizeSavedDesign({ ...design, artworkDataUrl: "https://example.com/a.png" }), null);
});

test("safe saved filenames are stable and product-title friendly", () => {
  assert.equal(safeTitleSlug("Sorry, I'm Booked! Club"), "sorry-i-m-booked-club");
});

test("batch vault saves locally and does not send current batch to Amazon", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(background, /source: "batch-vault"/);
  assert.match(background, /savedDesigns: nextSaved/);
  assert.match(popup, /batchRun\?\.currentJobId === state\.sourceJobId/);
  assert.match(popup, /return false;/);
});

test("saved design upload always navigates to Amazon Add New", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /https:\/\/merch\.amazon\.com\/designs\/new/);
  assert.match(popup, /Đã chuyển tab Amazon sang Add New/);
  assert.match(popup, /Đưa lên Merch/);
});


test("revision prompt contains no image-target or reference language", () => {
  const prompt = buildRegenerationPrompt({ jobId: JOB_ID, revision: 3, profile: DEFAULT_BOOK_LOVER_PROFILE });
  assert.match(prompt, /render the image now/i);
  assert.doesNotMatch(prompt, /regenerate|revision|reference image|reference rule|use any reference|attached winner|rejected artwork|previous artwork|image target|not an edit|same conversation/i);
});

test("artwork capture rejects stale send or regeneration snapshots", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /Number\(currentJob\.sentAt \|\| 0\) !== Number\(job\?\.sentAt \|\| 0\)/);
  assert.match(source, /Number\(currentJob\.regenerationRevision \|\| 0\) !== Number\(job\?\.regenerationRevision \|\| 0\)/);
});

test("listing followup requires artwork after the current revision boundary", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /!storedArtworkIsUsable\(chatArtwork, job\.jobId\)/);
  assert.match(source, /const revisionBoundary = Number\(lastSentChatJob\.regenerationMessageIndex/);
  assert.match(source, /if \(revisionBoundary >= 0 && artworkIndex <= revisionBoundary\) return false/);
});


test("v0.8.3 exposes a real cancel AUTO control", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(html, /id="cancel-auto-flow"/);
  assert.match(popup, /MERCH_FLOW_CANCEL_JOB_V1/);
  assert.match(popup, /Hủy AUTO/);
});

test("v0.8.3 guards late callbacks after cancellation", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(chat, /isJobCancelled/);
  assert.match(merch, /isJobCancelled/);
  assert.match(background, /flowCancel/);
  assert.match(background, /MERCH_FLOW_CANCEL_JOB_V1/);
});


test("v0.9.0 hard-blocks listing capture until a real artwork exists", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /if \(!storedArtworkIsUsable\(chatArtwork, job\.jobId\)\) continue/);
  assert.match(source, /if \(artworkIndex < 0 \|\| messageIndex <= artworkIndex\) continue/);
});

test("v0.9.0 isolates fresh artwork attempts with a session nonce", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(chat, /initialSessionNonce/);
  assert.match(chat, /jobBelongsToThisChat/);
  assert.match(background, /MERCH_FLOW_START_FRESH_CHAT_V1/);
  assert.match(background, /url: "about:blank"/);
  assert.match(background, /sessionNonce/);
  assert.match(background, /chatTabId: blankTab\.id/);
});

test("v0.9.0 fresh retry leaves a failed conversation instead of retrying inside it", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const retryStart = chat.indexOf("async function maybeRequestArtworkRetry");
  const retryEnd = chat.indexOf("function listingFollowupPrompt", retryStart);
  const retryBody = chat.slice(retryStart, retryEnd);
  assert.match(retryBody, /MERCH_FLOW_START_FRESH_CHAT_V1/);
  assert.doesNotMatch(retryBody, /sendMarkedPrompt\(/);
});

test("v0.9.34 manifest has a stable key and synchronized version badge", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  assert.equal(manifest.version, "0.9.34");
  assert.match(manifest.name, /v0\.9\.33/);
  assert.match(manifest.description, /v0\.9\.33/);
  assert.equal(typeof manifest.key, "string");
  assert.ok(manifest.key.length > 100);
  assert.match(html, /v0\.9\.33/);
});



test("v0.9.5 manual artwork sends through the fresh-chat manager", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const start = popup.indexOf("async function sendToChatGPT");
  const end = popup.indexOf("async function importListing", start);
  const body = popup.slice(start, end);
  assert.match(body, /MERCH_FLOW_START_FRESH_CHAT_V1/);
  assert.match(body, /closePreviousManaged:\s*true/);
  assert.match(body, /referenceDataUrl:\s*""/);
});

test("v0.9.5 batch artwork starts each item in a fresh session without reference attachment", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const start = background.indexOf("async function startNextBatchJob");
  const end = background.indexOf("async function startBatch", start);
  const body = background.slice(start, end);
  assert.match(body, /startFreshChatJob/);
  assert.match(body, /referenceDataUrl:\s*""/);
  assert.match(body, /sessionNonce:\s*crypto\.randomUUID\(\)/);
});

test("v0.9.5 retry path uses the hardened recovery prompt instead of replaying source unchanged", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const start = chat.indexOf("async function maybeRequestArtworkRetry");
  const end = chat.indexOf("function listingFollowupPrompt", start);
  const body = chat.slice(start, end);
  assert.match(body, /const recoveryPrompt = artworkRetryPrompt/);
  assert.match(body, /prompt:\s*recoveryPrompt/);
  assert.match(body, /sourcePrompt,/);
});


test("v0.9.5 detects image-edit routing failures and retries quickly", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function looksLikeImageRoutingFailure/);
  assert.match(chat, /routingFailure \? 2 \* 1000/);
  assert.match(chat, /image-edit\/missing-image/);
});

test("v0.9.29 never selects or serializes a ChatGPT UI canvas as artwork", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const findStart = chat.indexOf("function findArtworkVisual");
  const findEnd = chat.indexOf("function visualSourceUrl", findStart);
  const findBody = chat.slice(findStart, findEnd);
  const captureStart = chat.indexOf("async function captureArtwork");
  const captureEnd = chat.indexOf("function assistantResponseAfterLatestJobMarker", captureStart);
  const captureBody = chat.slice(captureStart, captureEnd);
  assert.doesNotMatch(findBody, /querySelectorAll\("img, canvas"\)/);
  assert.match(findBody, /querySelectorAll\("img"\)/);
  assert.match(chat, /element instanceof HTMLCanvasElement\) return 0/);
  assert.match(captureBody, /visual instanceof HTMLCanvasElement\) return false/);
  assert.doesNotMatch(captureBody, /storeArtwork\([^\n]+"canvas"/);
});

test("v0.9.29 detects the exact source-image routing refusal", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /image tool\.\{0,160\}treated/);
  assert.match(chat, /request\.\{0,120\}/);
  assert.match(chat, /source image/);
  assert.match(chat, /routingFailure \? 2 \* 1000/);
});

test("v0.9.29 retries image-edit routing through a normal clean composer with no attachment", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const retryStart = chat.indexOf("async function maybeRequestArtworkRetry");
  const retryEnd = chat.indexOf("function listingFollowupPrompt", retryStart);
  const retryBody = chat.slice(retryStart, retryEnd);
  assert.match(chat, /const ARTWORK_RETRY_MAX = 3/);
  assert.match(chat, /ch\[uư\]a th\[eể\] t\[aạ\]o \[aả\]nh/);
  assert.match(retryBody, /referenceDataUrl: ""/);
  assert.match(retryBody, /createImageModeBypass: routingFailure/);
  assert.match(background, /createImageModeBypass \? null : await findPreparedImageComposerTab/);
});

test("v0.9.34 sends every compact new-image job through the normal clean composer", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const start = background.indexOf("async function startFreshChatJob");
  const end = background.indexOf("async function clearTransientFlowData", start);
  const body = background.slice(start, end);
  assert.match(body, /const textOnlyNewImageJob =/);
  assert.match(body, /MERCH_FLOW_IMAGE_REQUEST:\\s\*NEW/);
  assert.match(body, /const createImageModeBypass = Boolean\(job\.createImageModeBypass \|\| textOnlyNewImageJob\)/);
  assert.match(body, /const preparedImageTab = createImageModeBypass \? null/);
  assert.match(body, /createImageModeBypass,/);
});

test("v0.9.29 marks bounded artwork exhaustion terminal instead of leaving AUTO spinning", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function repairExhaustedArtworkStatus/);
  assert.match(chat, /status: "failed", lastMessage: message/);
  assert.match(chat, /AUTO đã dừng ở artwork; không xin listing/);
  assert.match(chat, /repairExhaustedArtworkStatus\(\)/);
});

test("v0.9.29 rejects legacy canvas storage before artwork or listing can advance", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const captureListingStart = chat.indexOf("async function captureListing()");
  const captureListingEnd = chat.indexOf("function findJobMarkerMessage", captureListingStart);
  const captureListingBody = chat.slice(captureListingStart, captureListingEnd);
  const followupStart = chat.indexOf("async function requestListingFollowup");
  const followupEnd = chat.indexOf("async function autoCaptureFlow", followupStart);
  const followupBody = chat.slice(followupStart, followupEnd);
  assert.match(chat, /function storedArtworkIsUsable/);
  assert.match(chat, /sourceUrl !== "canvas"/);
  assert.match(captureListingBody, /storedArtworkIsUsable\(chatArtwork, job\.jobId\)/);
  assert.match(followupBody, /!storedArtworkIsUsable\(chatArtwork, job\.jobId\)/);
  assert.match(chat, /purgeLegacyCanvasArtifacts\(\)/);
});
test("v0.9.34 generation uses a compact marker and ignores stored reference attachments", () => {
  const noRef = buildArtworkPrompt({ jobId: JOB_ID, profile: DEFAULT_BOOK_LOVER_PROFILE });
  assert.doesNotMatch(noRef, /MERCH_FLOW_IMAGE_MODE/);
  assert.match(noRef, /MERCH_FLOW_IMAGE_REQUEST: NEW/);
  assert.match(noRef, /Generate exactly one new transparent-background T-shirt artwork/i);
  assert.doesNotMatch(noRef, /REFERENCE RULE|attached winner|Use any reference/i);
  const withRefProfile = { ...DEFAULT_BOOK_LOVER_PROFILE, referenceDataUrl: "data:image/png;base64,abc" };
  const batch = buildBatchPrompt({ jobId: JOB_ID, profile: withRefProfile });
  assert.doesNotMatch(batch, /MERCH_FLOW_IMAGE_MODE/);
  assert.doesNotMatch(batch, /REFERENCE RULE|attached winner|Use any reference/i);
});


test("v0.9.34 update reloads only managed flow tabs", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(merch, new RegExp(`SCRIPT_VERSION = "${manifest.version.replace(/\./g, "\\.")}"`));
  assert.doesNotMatch(background, /chrome\.tabs\.query\(\{ url: "https:\/\/merch\.amazon\.com\/\*" \}\)/);
  assert.match(background, /Object\.values\(data\[AMAZON_RUNTIME_STORAGE_KEY\]/);
});

test("v0.9.34 removes dormant automatic product selection and keeps manual handoff", () => {
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  assert.doesNotMatch(merch, /autoSelectTenProducts|PRODUCT_SELECTION_MAX_FAILURES|setCheckboxState/);
  assert.match(merch, /manualProductSelectionRequired: true/);
  assert.match(merch, /Anh tự chọn sản phẩm\/màu/);
  assert.match(html, /Anh tự chọn sản phẩm\/màu phù hợp/);
});

test("v0.9.5 reference UI is explicit that saved images are local-only", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(html, /Lưu mẫu thắng local \(không gửi ChatGPT\)/);
  assert.match(popup, /KHÔNG được gửi cho ChatGPT ở v0\.9\.11/);
});


test("v0.9.5 recognizes the exact existing-image-target routing refusal", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /image tool\.\{0,120\}/);
  assert.match(chat, /edit\|editing/);
  assert.match(chat, /existing /);
  assert.match(chat, /image\|photo\|artwork\|picture/);
  assert.match(chat, /target/);
});

test("v0.9.5 scrubs stale composer attachments before text-to-image send", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /async function ensureTextOnlyComposer/);
  assert.match(chat, /composer = await ensureTextOnlyComposer\(composer\)/);
  assert.match(chat, /referenceDataUrl: ""/);
  assert.match(chat, /referenceAlreadySent: false/);
});

test("v0.9.34 prompts use a neutral compact new-image marker", () => {
  const prompt = buildArtworkPrompt({ jobId: JOB_ID, profile: DEFAULT_BOOK_LOVER_PROFILE });
  assert.match(prompt, /MERCH_FLOW_IMAGE_REQUEST: NEW/);
  assert.match(prompt, /Generate exactly one new transparent-background T-shirt artwork/i);
  assert.doesNotMatch(prompt, /TASK_CLASS|INPUT_ASSETS|CONTEXT_SCOPE|TEXT_TO_IMAGE_ONLY/);
  assert.doesNotMatch(prompt, /uploaded artwork itself|source image|image target/i);
});

test("v0.9.34 new-image prompts stay compact and avoid edit-routing vocabulary", () => {
  const initial = buildArtworkPrompt({ jobId: JOB_ID, profile: DEFAULT_BOOK_LOVER_PROFILE });
  const retry = buildArtworkRetryPrompt(JOB_ID, 1, initial);
  for (const prompt of [initial, retry]) {
    assert.match(prompt, /MERCH_FLOW_IMAGE_REQUEST: NEW/i);
    assert.doesNotMatch(prompt, /source image|image target|not an edit|edit requiring|INPUT_ASSETS|TEXT_TO_IMAGE_ONLY/i);
    assert.ok(prompt.length < 1800, `new-image prompt is unexpectedly ${prompt.length} characters`);
  }
});

test("v0.9.5 recognizes the Vietnamese image-routing refusal shown by ChatGPT", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /c\[oô\]ng c\[uụ\] t\[aạ\]o \[aả\]nh/);
  assert.match(chat, /ch\[iỉ\]nh s\[uử\]a \[aả\]nh c\[oó\] s\[aẵ\]n/);
});

test("v0.9.34 retry prompt keeps one neutral marker and never nests routing headers", () => {
  const source = buildArtworkPrompt({ jobId: JOB_ID, profile: DEFAULT_BOOK_LOVER_PROFILE });
  const retry = buildArtworkRetryPrompt(JOB_ID, 1, source);
  assert.equal((retry.match(/MERCH_FLOW_IMAGE_REQUEST: NEW/g) || []).length, 1);
  assert.equal((retry.match(/MERCH_FLOW_JOB_ID:/g) || []).length, 1);
  assert.doesNotMatch(retry, /TASK_CLASS|INPUT_ASSETS|TEXT_TO_IMAGE_ONLY/);
});


test("v0.9.7 explicitly activates Create image before text-to-image artwork send", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function findComposerPlusButton/);
  assert.match(chat, /function findCreateImageAction/);
  assert.match(chat, /function activateCreateImageMode/);
  assert.match(chat, /composer-plus-btn/);
  assert.match(chat, /visualize anything/i);
  const prepareStart = chat.indexOf("async function prepareFreshArtworkComposer");
  const prepareEnd = chat.indexOf("function messageHasImage", prepareStart);
  const prepareBody = chat.slice(prepareStart, prepareEnd);
  const clearIndex = prepareBody.indexOf("ensureTextOnlyComposer(composer)");
  const imageIndex = prepareBody.indexOf("activateCreateImageMode(composer)");
  assert.ok(clearIndex >= 0 && imageIndex > clearIndex);
  const runStart = chat.indexOf("async function runChatJob");
  const runBody = chat.slice(runStart);
  const prepareIndex = runBody.indexOf("prepareFreshArtworkComposer(pendingChatJob)");
  const sendIndex = runBody.indexOf("sendMarkedPrompt(pendingChatJob.prompt");
  assert.ok(prepareIndex >= 0 && sendIndex > prepareIndex);
});

test("v0.9.7 artwork regeneration also activates Create image before sending", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const start = chat.indexOf("async function regenerateArtworkInCurrentConversation");
  const end = chat.indexOf("chrome.runtime.onMessage.addListener", start);
  const body = chat.slice(start, end);
  assert.match(body, /ensureTextOnlyComposer\(readyComposer\)/);
  assert.match(body, /activateCreateImageMode\(imageComposer\)/);
  assert.match(body, /sendMarkedPrompt\(prompt, marker/);
});


test("v0.9.9 finds Create image only inside current menu/popover markup", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.doesNotMatch(chat, /document\.createTreeWalker\(document\.body, NodeFilter\.SHOW_TEXT\)/);
  assert.match(chat, /const menuRoots =/);
  assert.match(chat, /data-radix-collection-item/);
  assert.match(chat, /Historical assistant text is/);
  assert.match(chat, /function clickUiElement/);
  assert.match(chat, /PointerEvent/);
  assert.match(chat, /attempt < 2/);
  assert.match(chat, /visibleMenuDiagnostic/);
});


test("v0.9.9 exposes manual artwork and listing fallback controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(html, /id="paste-image"/);
  assert.match(html, /id="finalize-artwork"/);
  assert.match(html, /id="save-final-listing"/);
  assert.match(html, /id="listing-raw-json"/);
  assert.match(html, /id="save-final-design"/);
  assert.match(popup, /async function saveFinalListing/);
  assert.match(popup, /async function finalizeArtwork/);
  assert.match(popup, /async function saveCurrentDesignToVault/);
});

test("manual Merch upload requires finalized artwork", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /Hãy bấm “Chốt ảnh này” trước khi đưa lên Merch/);
  assert.match(popup, /state\.listingDirty/);
});


test("v0.9.9 fails closed when Amazon artwork verification is missing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  assert.match(source, /artwork-unverified/);
  assert.match(source, /uploaded: false, transferred: true, verified: false/);
  assert.match(source, /pendingUpload\.artworkVerified !== true/);
});

test("v0.9.9 leaves product and colour selection to the seller", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  assert.match(source, /manualProductSelectionRequired: true/);
  assert.match(source, /Anh tự chọn sản phẩm\/màu/);
  assert.match(source, /status: "manual-products"/);
});

test("v0.9.9 requires a visible Create image mode chip after clicking the menu action", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /return imageModeChipVisible\(live\) \? live : null/);
  assert.doesNotMatch(source, /return stillOpen \? null : live/);
  assert.match(source, /Historical assistant text is/);
});

test("v0.9.9 binds imported listing to the current artwork job", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(source, /expectedJobId/);
  assert.match(source, /response\?\.listing\?\.jobId !== expectedJobId/);
  assert.match(source, /listingMatchesArtworkBinding\(lastListing, binding\)/);
});


test("v0.9.9 expected-job listing reads do not advance unrelated ChatGPT tabs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(source, /expectedConversation/);
  assert.match(source, /canAdvanceExpectedFlow/);
  assert.match(source, /expectedJobId\s*\? \(canAdvanceExpectedFlow \? await autoCaptureFlow/);
});


test("v0.9.34 uses a guarded compact-image fallback instead of falsely confirming Create image", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function canUseSafeTextToImageFallback/);
  assert.match(chat, /explicitTextToImagePrompt/);
  assert.match(chat, /MERCH_FLOW_IMAGE_REQUEST:\\s\*NEW/);
  assert.match(chat, /composerHasAttachedFile/);
  assert.match(chat, /specializedComposerContext/);
  assert.match(chat, /brief tạo ảnh ngắn/);
  assert.match(chat, /if \(!canUseSafeTextToImageFallback\(job, composer\)\) throw imageModeError/);
});

test("v0.9.10 refuses safe fallback in Deep Research/report composer", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /get a detailed report\|deep research\|nghiên cứu sâu\|research report/);
  assert.match(chat, /if \(specializedComposerContext\(composer\)\) return false/);
});

test("v0.9.10 recovers managed job ownership after ChatGPT strips query params", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(chat, /registrationPromise/);
  assert.match(chat, /registeredSessionNonce/);
  assert.match(chat, /registeredJobId/);
  assert.match(chat, /runChatJob\(\{ allowPendingWithoutUrl: true, expectedJobId: pendingChatJob\.jobId \}\)/);
  assert.match(background, /sessionNonce: String\(message\.sessionNonce \|\| matchedJob\?\.sessionNonce \|\| ""\)/);
});

test("v0.9.10 never resumes a live job in an arbitrary active ChatGPT tab", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /if \(expectedJobId\) return null; \/\/ Never resume a live job in an arbitrary personal\/Deep Research tab\./);
  assert.match(popup, /Tab của job cũ không còn hợp lệ\. Đã tự mở một phiên ChatGPT sạch/);
  assert.match(popup, /MERCH_FLOW_START_FRESH_CHAT_V1/);
});


test("v0.9.11 AUTO proves an empty New chat before sending", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(background, /freshConversationRequired:\s*true/);
  assert.match(chat, /async function ensureFreshConversation\(job, \{ forceNewChat = false \} = \{\}\)/);
  assert.match(chat, /findNewChatControl/);
  assert.match(chat, /function freshConversationIsClean/);
  assert.match(chat, /conversationMessages\(\)\.length === 0/);
  assert.match(chat, /AUTO yêu cầu chat mới nhưng không tìm thấy nút New chat/);
  assert.match(chat, /beforeSend: \(\) => armFreshSend\(pendingChatJob\)/);
});

test("v0.9.11 session recovery uses registered nonce after ChatGPT strips launch query", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /const activeSessionNonce = initialSessionNonce \|\| registeredSessionNonce \|\| ""/);
  assert.match(chat, /await registrationPromise/);
});


test("v0.9.12 Resume always sends expected job plus artwork revision/session binding", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(popup, /MERCH_FLOW_RESUME_V6", expectedJobId, expectedArtworkStorageKey: binding\.artworkStorageKey, expectedArtworkRevision: binding\.artworkRevision, expectedSessionNonce: binding\.sessionNonce/);
  assert.match(chat, /Resume bị chặn: thiếu expectedJobId/);
  assert.match(chat, /storedListingMatches/);
});

test("v0.9.12 listing import is bound to current artwork storage key revision nonce and message index", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(popup, /expectedArtworkStorageKey: binding\.artworkStorageKey/);
  assert.match(popup, /expectedArtworkRevision: binding\.artworkRevision/);
  assert.match(popup, /expectedSessionNonce: binding\.sessionNonce/);
  assert.match(chat, /messageIndex > minimumIndex/);
  assert.match(chat, /artworkStorageKey: chatArtwork\.storageKey/);
  assert.match(chat, /artworkRevision: Number\(chatArtwork\.artworkRevision \|\| 0\)/);
});

test("v0.9.12 stale ChatGPT listing is not silently rebound to manual artwork", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /listing ChatGPT cũ bị bỏ để tránh lệch revision/);
  assert.match(popup, /Không lưu Kho mẫu: listing ChatGPT thuộc job\/artwork revision khác/);
  assert.match(popup, /Listing ChatGPT đang thuộc artwork revision\/session khác/);
});

test("v0.9.12 Amazon artwork fingerprint is scoped to upload evidence roots", () => {
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  assert.match(merch, /function artworkEvidenceRoots/);
  assert.match(merch, /function artworkTargetSnapshot/);
  assert.doesNotMatch(merch, /function artworkPageSnapshot/);
  assert.match(merch, /const baseline = artworkTargetSnapshot\(target\)/);
});

test("v0.9.12 safe image fallback rejects Search Study and Agent tool contexts", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /search the web/);
  assert.match(chat, /study and learn/);
  assert.match(chat, /agent mode/);
  assert.match(chat, /shopping research/);
});

test("v0.9.12 ZIP export caps chunks and decodes base64 incrementally", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /zipDesignChunks\(designs, maxCount = 3, maxEstimatedBytes = 24 \* 1024 \* 1024\)/);
  assert.match(popup, /const chunkChars = 1024 \* 1024/);
  assert.doesNotMatch(popup, /const binary = atob\(body\);\s*const bytes/);
});


test("v0.9.12 automatic upload and storage listener require exact listing artwork binding", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /if \(!listingMatchesArtworkBinding\(state\.listing, currentArtworkBinding\(\)\)\) return false/);
  assert.match(popup, /Đã bỏ qua listing ChatGPT cũ vì không khớp artwork revision\/session hiện tại/);
});

test("v0.9.12 Amazon acceptance does not read document body as positive evidence", () => {
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  const start = merch.indexOf("function artworkAccepted");
  const end = merch.indexOf("async function verifyArtworkAccepted", start);
  const body = merch.slice(start, end);
  assert.match(body, /container !== document\.body/);
  assert.doesNotMatch(body, /document\.body\?\.innerText/);
});


test("v0.9.12 treats legacy unknown listing provenance as untrusted ChatGPT data", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /Legacy AI captures had no source tag/);
  assert.match(popup, /return !\["manual", "pasted_json", "vault"\]\.includes\(source\)/);
});

test("v0.9.13 recovers a late old-chat restore immediately before Send", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function waitForStableFreshComposer/);
  assert.match(chat, /stableMs = 1800/);
  assert.match(chat, /beforeSend: \(\) => armFreshSend\(pendingChatJob\)/);
  assert.match(chat, /MERCH_FLOW_STALE_CONVERSATION/);
  assert.match(chat, /prepareFreshArtworkComposer\(pendingChatJob, \{ forceNewChat: true \}\)/);
  assert.match(chat, /location\.replace\(new URL\("\/", location\.origin\)\.href\)/);
  assert.match(chat, /else if \(!value\)/);
});

test("v0.9.13 Vault upload keeps the saved artwork-listing pair trusted", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  assert.match(popup, /const vaultListing = \{ \.\.\.normalized\.listing, jobId: normalized\.jobId, source: "vault"/);
  assert.match(popup, /\["manual", "pasted_json", "vault"\]/);
});

test("v0.9.14 background owns the fresh route until the verified Send click", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(background, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(background, /freshSendArmedAt/);
  assert.match(background, /freshRouteRepairCount/);
  assert.match(background, /freshJobUrl\(next, repairCount\)/);
  assert.match(chat, /async function armFreshSend/);
  assert.match(chat, /freshSendArmedAt: Date\.now\(\)/);
  assert.match(chat, /freshSendArmedAt: 0/);
});

test("v0.9.15 blocks known old conversation paths across ChatGPT SPA navigation", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.match(background, /staleConversationKeys/);
  assert.match(background, /knownStaleConversation/);
  assert.match(background, /chrome\.webNavigation\.onHistoryStateUpdated\.addListener/);
  assert.match(background, /if \(!knownStaleConversation && job\.freshSendArmedAt/);
  const armStart = chat.indexOf("async function armFreshSend");
  const armEnd = chat.indexOf("async function prepareFreshArtworkComposer", armStart);
  const armBody = chat.slice(armStart, armEnd);
  const firstAssertion = armBody.indexOf("assertFreshBeforeFirstSend(current);");
  const storageArm = armBody.indexOf("await updatePendingJob");
  const finalAssertion = armBody.indexOf("assertFreshBeforeFirstSend(updated);");
  assert.ok(firstAssertion >= 0 && storageArm > firstAssertion && finalAssertion > storageArm);
});

test("v0.9.15 closes the previous managed chat before loading the fresh tab", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const start = background.indexOf("async function startFreshChatJob");
  const end = background.indexOf("async function clearTransientFlowData", start);
  const body = background.slice(start, end);
  assert.ok(body.indexOf("chrome.tabs.remove(previousManagedId)") < body.indexOf("chrome.tabs.update(blankTab.id"));
});

test("v0.9.16 restarts failed jobs in a canonical-root managed tab", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(popup, /failedPending\.status === "failed"/);
  assert.match(popup, /reopenPendingJobFresh\(failedPending\)/);
  assert.match(popup, /freshRouteRepairCount: 0/);
  assert.match(background, /return "https:\/\/chatgpt\.com\/"/);
  assert.match(background, /staleConversationKeys = \[\.\.\.new Set/);
  assert.match(background, /changedConversation/);
  assert.match(chat, /location\.replace\(new URL\("\/", location\.origin\)\.href\)/);
});

test("v0.9.17 activates current ChatGPT controls and preserves the Create image pill", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(chat, /div\.__menu-item\[tabindex\]/);
  assert.match(chat, /\[data-inline-selection-pill\]/);
  assert.match(chat, /imageModeWasActive/);
  assert.match(chat, /element\.click\(\); return true/);
  assert.match(background, /unknown query parameters can trigger SPA history restore/);
});

test("v0.9.18 trusts one stable empty Create image route without trusting stale history", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(background, /freshRouteTransitionArmedAt/);
  assert.match(background, /freshCandidateConversationKey: changedConversation/);
  assert.match(background, /!knownStaleConversation/);
  assert.match(chat, /trustedEmptyCandidate/);
  assert.match(chat, /candidateAge >= 1200/);
  assert.match(chat, /conversationMessages\(\)\.length === 0/);
  assert.match(chat, /await sleep\(1500\)/);
  assert.match(chat, /Object\.assign\(job, transitionJob\)/);
});

test("v0.9.19 escapes a Create image old-chat restore loop through the guarded fallback", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(background, /const createImageRestoreBlocked = Boolean/);
  assert.match(background, /knownStaleConversation[\s\S]*job\.freshRouteTransitionArmedAt/);
  assert.match(background, /createImageModeBypass: Boolean\(job\.createImageModeBypass \|\| createImageRestoreBlocked\)/);
  const prepareStart = chat.indexOf("async function prepareFreshArtworkComposer");
  const prepareEnd = chat.indexOf("async function confirmFreshRouteTransition", prepareStart);
  const prepareBody = chat.slice(prepareStart, prepareEnd > prepareStart ? prepareEnd : undefined);
  assert.match(prepareBody, /if \(transitionJob\.createImageModeBypass\)/);
  assert.match(prepareBody, /canUseSafeTextToImageFallback\(job, composer\)/);
  assert.ok(prepareBody.indexOf("createImageModeBypass") < prepareBody.indexOf("activateCreateImageMode(composer)"));
  assert.match(prepareBody, /freshRouteTransitionArmedAt: 0/);
});

test("v0.9.20 claims an existing verified clean Create image composer", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(background, /async function findPreparedImageComposerTab/);
  assert.match(background, /MERCH_FLOW_PROBE_CLEAN_IMAGE_CHAT_V1/);
  assert.match(background, /MERCH_FLOW_CLAIM_CLEAN_IMAGE_CHAT_V1/);
  assert.match(background, /preparedImageMode: Boolean\(preparedImageTab\)/);
  assert.match(background, /const chatTabs = await chrome\.tabs\.query/);
  assert.match(chat, /function composerDraftText/);
  assert.match(chat, /message\?\.type === "MERCH_FLOW_PROBE_CLEAN_IMAGE_CHAT_V1"/);
  assert.match(chat, /message\?\.type === "MERCH_FLOW_CLAIM_CLEAN_IMAGE_CHAT_V1"/);
  assert.match(chat, /registeredSessionNonce = sessionNonce/);
});

test("v0.9.20 denies a non-empty route candidate before retrying Create image", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /const rejectedConversationKey = isConversationRoute\(\)/);
  assert.match(chat, /staleConversationKeys/);
  assert.match(chat, /rejectedConversationKey && conversationMessages\(\)\.length > 0/);
  assert.match(chat, /freshCandidateConversationKey: ""/);
});

test("v0.9.21 captures current assistant-turn image markup before the img element finishes loading", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function messageRole/);
  assert.match(chat, /section\[data-turn="assistant"\]/);
  assert.match(chat, /messageRole\(message\) !== "assistant"/);
  assert.match(chat, /messageRole\(element\.closest\?\.\('\[data-message-author-role\], section\[data-turn\]'\)\)/);
  const captureStart = chat.indexOf("async function captureArtwork");
  const captureEnd = chat.indexOf("function assistantResponseAfterLatestJobMarker", captureStart);
  const captureBody = chat.slice(captureStart, captureEnd);
  assert.doesNotMatch(captureBody, /!visual\.complete \|\| !visual\.naturalWidth/);
  assert.match(captureBody, /const sourceUrl = visualSourceUrl\(visual\)/);
  assert.match(captureBody, /MERCH_FLOW_FETCH_IMAGE_V1/);
});

test("v0.9.22 retries malformed listing JSON automatically and then fails bounded", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /const LISTING_RETRY_MAX = 2/);
  assert.match(chat, /function assistantResponseAfterLatestListingRequest/);
  assert.match(chat, /previousFollowupAt && followupAge < FOLLOWUP_RETRY_MS/);
  assert.match(chat, /listingFollowupRetryCount: nextRetryCount/);
  assert.match(chat, /listingFollowupExhaustedAt/);
  assert.match(chat, /AUTO đã dừng rõ ràng; artwork vẫn được giữ/);
  assert.doesNotMatch(chat, /lastSentChatJob\.listingFollowupSentAt && \(!force/);
});

test("v0.9.23 binds fallback artwork to its assistant message and repairs legacy minus-one provenance", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  const fallbackStart = chat.indexOf("// Fallback for layouts where generated images");
  const fallbackEnd = chat.indexOf("function visualSourceUrl", fallbackStart);
  const fallbackBody = chat.slice(fallbackStart, fallbackEnd);
  assert.match(fallbackBody, /const messageIndex = messages\.findIndex/);
  assert.match(fallbackBody, /messageRole\(messages\[messageIndex\]\) !== "assistant"/);
  assert.match(fallbackBody, /messageIndex\n/);
  const captureStart = chat.indexOf("async function captureArtwork");
  const captureEnd = chat.indexOf("function assistantResponseAfterLatestJobMarker", captureStart);
  const captureBody = chat.slice(captureStart, captureEnd);
  assert.match(captureBody, /Number\(storedArtwork\.artworkMessageIndex \?\? -1\) < 0/);
  assert.match(captureBody, /chatArtwork: \{ \.\.\.storedArtwork, artworkMessageIndex: candidate\.messageIndex \}/);
});

test("v0.9.34 Vault metadata strips artwork base64 and profile reference payloads", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "vault-db.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  const metadata = sandbox.MerchFlowVaultDB.metadataFromDesign({
    id: "d1",
    jobId: "j1",
    createdAt: 1,
    artworkDataUrl: "data:image/png;base64,AAAA",
    artworkName: "a.png",
    listing: { title: "T", description: "D" },
    nicheProfile: { name: "book lovers", referenceDataUrl: "data:image/png;base64,BBBB" }
  });
  assert.equal(metadata.artworkStore, "indexeddb");
  assert.equal(metadata.artworkDataUrl, undefined);
  assert.equal(metadata.nicheProfile.referenceDataUrl, "");
});

test("v0.9.25 requires stable artwork acceptance before listing handoff", () => {
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  assert.match(merch, /please upload a valid png/);
  assert.match(merch, /let positiveSince = 0/);
  assert.match(merch, /Date\.now\(\) - positiveSince >= 1800/);
  assert.match(merch, /listingBusySince && Date\.now\(\) - listingBusySince > 45000/);
  assert.match(merch, /highlightReviewPublishControl/);
  assert.match(merch, /manualProductSelectionRequired/);
  const attemptStart = merch.indexOf("async function attemptPendingListing");
  const attemptEnd = merch.indexOf("async function executeUpload", attemptStart);
  const attemptBody = merch.slice(attemptStart, attemptEnd);
  const completion = attemptBody.indexOf("manualProductSelectionRequired");
  assert.ok(completion >= 0);
  assert.doesNotMatch(attemptBody, /ensureReviewPublishControl\(pendingUpload\.uploadId\)/);
});

test("v0.9.34 ChatGPT polling is lazy and owned-job gated", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "chatgpt-content.js"), "utf8");
  assert.match(chat, /function startAutoCaptureWatchers/);
  assert.match(chat, /async function armAutoCaptureWatchersForOwnedJob/);
  assert.match(chat, /!jobBelongsToThisChat\(job\)/);
  assert.doesNotMatch(chat, /const observer = new MutationObserver/);
});

test("v0.9.28 revalidates live artwork and takes over stale Amazon runtimes", () => {
  const merch = fs.readFileSync(path.join(__dirname, "..", "merch-content.js"), "utf8");
  assert.match(merch, /function liveArtworkPresent/);
  assert.match(merch, /drag and drop artwork here\|click to browse for a file/);
  assert.match(merch, /if \(await waitForLiveArtwork\(\)\)/);
  assert.match(merch, /Amazon đã reload và mất artwork của job/);
  assert.match(merch, /fileCache\.delete\(uploadId\)/);
  assert.match(merch, /MERCH_FLOW_REGISTER_MERCH_TAB_V1/);
  assert.match(merch, /const LISTING_READY_TIMEOUT_MS = 2 \* 60 \* 1000/);
  assert.match(merch, /status: "manual-products"/);
  assert.match(merch, /listingBusySince && Date\.now\(\) - listingBusySince > 45000/);
  assert.match(merch, /reviewWaitStartedAt/);
  assert.match(merch, /runtimeTakeoverPending/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), /MERCH_FLOW_REGISTER_MERCH_TAB_V1/);
  assert.match(merch, /Re-enter executeUpload so a page reload/);
  assert.doesNotMatch(merch, /else if \(\["artwork-set", "waiting-listing", "selecting-products"\]\.[\s\S]{0,100}ensureListingWatcher\(\);\s*scheduleListingAttempt\(300\)/);
});


test("v0.9.34 background cleans closed Amazon runtime registrations", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(background, /delete runtimes\[String\(tabId\)\]/);
  assert.match(background, /update\[AMAZON_RUNTIME_STORAGE_KEY\] = runtimes/);
});

test("v0.9.34 manifest drops unused activeTab and loads Vault helper", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.match(html, /vault-db\.js/);
  assert.match(background, /importScripts\("merch-flow-core\.js", "vault-db\.js"\)/);
});
