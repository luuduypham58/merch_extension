(function exposeMerchFlowCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MerchFlowCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMerchFlowCore() {
  const PLACEHOLDERS = new Set([
    "under 60 characters",
    "original niche-relevant brand",
    "natural benefit/audience copy",
    "gift occasion/style copy",
    "short natural description"
  ]);

  const LISTING_KEYS = ["title", "brand", "bullet1", "bullet2", "description"];

  const DEFAULT_BOOK_LOVER_PROFILE = Object.freeze({
    name: "book lovers",
    profileVersion: "book-winner-creative-scene-v3",
    winningStyle: "Winner-style monochrome visual-gag humor: white-only ink intended for black/dark garments; bold uppercase block typography; thick clean vector/pictogram strokes; strong hierarchy, generous spacing, and instant readability from thumbnail size. Preserve the high-level winner DNA, but DO NOT lock every design to the same top-text / lone-stick-figure / bottom-text composition. Let the joke choose the construction: mini-scene, POV, object gag, diagram, split beat, cutaway, multi-character interaction, or another simple readable structure. No colored fills, gradients, shadows, 3D, vintage palette, distressed texture, or decorative filler. Use references only for high-level design DNA; never copy wording, exact layout, characters, pose sequence, or distinctive artwork.",
    language: "English",
    style: "monochrome visual gag",
    audience: "bookworms, avid readers, librarians, teachers, introverts, and cozy reading fans",
    avoid: "trademarks, copyrighted characters, brand names, copied slogans, political persuasion, generic clichés, keyword stuffing, colored artwork, gradients, shadows, 3D effects, distressed textures, and mockup backgrounds"
  });

  const BOOK_LOVER_CREATIVE_POLICY = Object.freeze({
    market: "United States",
    corePrinciple: "Sell reader recognition, not generic book-lover identity labels.",
    internalExplorationCount: 8,
    memoryLimit: 30,
    situationTerritories: [
      "reading versus sleep and late-night chapter spirals",
      "food, coffee, meals, and refusing to stop at a good part",
      "chores, errands, work, alarms, and responsibilities interrupted by reading",
      "partners, family, roommates, kids, pets, and household interruption etiquette",
      "TBR piles, buying books faster than reading them, and physical-book rituals",
      "libraries, holds, returns, due dates, librarians, and bookstore behavior",
      "carrying a book everywhere and reading in odd spare moments",
      "audiobook multitasking and switching between reading formats",
      "post-book hangover and emotional attachment after finishing a story",
      "cozy reading spaces, bed, couch, blanket, bath, travel, and waiting rooms"
    ],
    visualConstructions: [
      "POV hands interacting with books and real household objects",
      "mini-scene with two or more interacting subjects or objects",
      "object-only visual gag with no central human figure",
      "before-and-after or cause-and-effect two-beat composition",
      "fake warning, instruction, checklist, meter, or diagram",
      "cutaway or cross-section showing the hidden reader behavior",
      "multi-character interruption scene with readable blocking",
      "oversized book/object interacting physically with the reader",
      "environment-led scene where furniture or setting carries the joke",
      "visual equation, comparison, or labeled object relationship",
      "cropped close-up focused on hands, feet, face, or a specific action",
      "silhouette tableau with several storytelling props arranged as one gag"
    ],
    genericTerritories: [
      "book lover",
      "just one more chapter",
      "I'd rather be reading",
      "books are my happy place",
      "books over people",
      "eat sleep read repeat",
      "so many books so little time"
    ]
  });

  const PRODUCT_RULES = {
    "standard t shirt": { base: 100, kind: "apparel", primary: 18 },
    "premium t shirt": { base: 88, kind: "apparel", primary: 8 },
    "comfort colors heavyweight t shirt": { base: 86, kind: "apparel", primary: 10 },
    "comfort colors sweatshirt": { base: 72, kind: "apparel", primary: 3 },
    "sweatshirt": { base: 70, kind: "apparel", primary: 3 },
    "pullover hoodie": { base: 68, kind: "apparel", primary: 2 },
    "long sleeve t shirt": { base: 66, kind: "apparel", primary: 2 },
    "v neck t shirt": { base: 62, kind: "apparel", primary: 1 },
    "tank top": { base: 58, kind: "apparel", primary: 1 },
    "raglan": { base: 55, kind: "apparel", primary: 0 },
    "zip hoodie": { base: 50, kind: "apparel", primary: -8 },
    "performance hoodie": { base: 35, kind: "apparel", primary: 0 },
    "comfort colors crop sweatshirt": { base: 43, kind: "apparel", primary: -3 },
    "crop top": { base: 40, kind: "apparel", primary: -3 },
    "tote bag": { base: 46, kind: "accessory", primary: -30 },
    "ceramic mug": { base: 42, kind: "accessory", primary: -30 },
    "tumbler": { base: 38, kind: "accessory", primary: -30 },
    "water bottle": { base: 34, kind: "accessory", primary: -30 },
    "throw pillows": { base: 32, kind: "accessory", primary: -30 },
    "iphone cases": { base: 20, kind: "accessory", primary: -35 },
    "popsockets": { base: 18, kind: "accessory", primary: -35 }
  };

  const CONTEXT_GROUPS = {
    bookish: ["book", "bookworm", "reader", "reading", "library", "librarian", "chapter", "novel", "author", "literary", "tea", "coffee", "cozy"],
    teacherOffice: ["teacher", "school", "classroom", "professor", "educator", "office", "coworker", "nurse", "doctor", "therapist"],
    retro: ["retro", "vintage", "distressed", "nostalgic", "70s", "80s", "90s", "classic"],
    summer: ["summer", "beach", "vacation", "sun", "pool", "hot weather", "tropical"],
    winter: ["winter", "christmas", "holiday", "snow", "cold", "cozy season", "fall", "autumn"],
    fitness: ["fitness", "gym", "workout", "running", "runner", "sports", "athlete", "hiking", "outdoor", "cycling", "pickleball"],
    feminine: ["women", "woman", "girl", "mom", "mama", "mother", "wife", "bride", "bachelorette", "sister"],
    tech: ["gaming", "gamer", "coding", "programmer", "developer", "tech", "phone", "computer"],
    home: ["home", "couch", "bedroom", "decor", "nap", "sleep", "introvert", "cozy"]
  };
  const LISTING_FIELD_RULES = {
    title: ["product title", "listing title", "title"],
    brand: ["brand name", "brand"],
    bullet1: ["feature bullet 1", "key product feature 1", "key product features 1", "bullet point 1", "bullet 1", "bullet1"],
    bullet2: ["feature bullet 2", "key product feature 2", "key product features 2", "bullet point 2", "bullet 2", "bullet2"],
    description: ["product description", "description"]
  };

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function safeJsonBlocks(text) {
    const blocks = [];
    const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match;
    while ((match = pattern.exec(String(text || "")))) blocks.push(match[1]);
    return blocks;
  }

  function jsonObjectCandidates(text) {
    const source = String(text || "");
    const objects = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") {
        if (depth === 0) start = index;
        depth += 1;
      } else if (character === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objects.push(source.slice(start, index + 1));
          start = -1;
        }
      }
    }
    return objects;
  }

  function isPlaceholder(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || PLACEHOLDERS.has(normalized)) return true;
    // Listing prompts intentionally contain human-readable angle-bracket examples
    // such as <FINAL AMAZON TITLE, MAX 60 CHARACTERS>. Never accept any whole
    // angle-bracket token as final customer-facing copy.
    if (/^<[^<>]{1,160}>$/i.test(normalized)) return true;
    if (/^final[ _-].*(?:title|brand|bullet|description)$/i.test(normalized)) return true;
    return false;
  }

  function normalizeListing(value, expectedJobId) {
    if (!value || typeof value !== "object") return null;
    if (value.merch_flow !== true || value.job_id !== expectedJobId) return null;
    const listing = { jobId: expectedJobId };
    for (const key of LISTING_KEYS) {
      if (typeof value[key] !== "string") return null;
      const normalized = value[key].trim();
      if (isPlaceholder(normalized)) return null;
      listing[key] = normalized;
    }
    if (listing.title.length > 60) return null;
    return listing;
  }

  function parseListingFromAssistantText(text, expectedJobId) {
    if (!expectedJobId) return null;
    const fenced = safeJsonBlocks(text);
    const rawObjects = jsonObjectCandidates(text);
    const candidates = [...new Set([...fenced, ...rawObjects])];
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try {
        const listing = normalizeListing(JSON.parse(candidates[index].trim()), expectedJobId);
        if (listing) return listing;
      } catch (_) {
        // Ignore prose, partial streaming output, and unrelated JSON objects.
      }
    }
    return null;
  }

  function descriptorText(descriptor) {
    return normalizeText([
      descriptor.id,
      descriptor.name,
      descriptor.placeholder,
      descriptor.ariaLabel,
      descriptor.testId,
      descriptor.labelText,
      descriptor.contextText
    ].filter(Boolean).join(" "));
  }

  function scoreRuleMatch(text, rules) {
    return rules.reduce((score, rule, index) => score + (text.includes(rule) ? (rules.length - index) * 10 : 0), 0);
  }

  function resolveListingFieldMap(descriptors) {
    const available = descriptors.filter((descriptor) => descriptor && !descriptor.disabled && descriptor.kind !== "file");
    const usedIds = new Set();
    const mapping = {};
    const missing = [];

    for (const key of LISTING_KEYS) {
      const candidates = available
        .filter((descriptor) => !usedIds.has(descriptor.id))
        .map((descriptor) => ({ descriptor, score: scoreRuleMatch(descriptorText(descriptor), LISTING_FIELD_RULES[key]) }))
        .filter((candidate) => candidate.score >= 10)
        .sort((left, right) => right.score - left.score);
      const winner = candidates[0];
      if (!winner) {
        missing.push(key);
        continue;
      }
      mapping[key] = winner.descriptor;
      usedIds.add(winner.descriptor.id);
    }
    return { mapping, filled: Object.keys(mapping), missing };
  }


  function contextString(context) {
    const listing = context?.listing || {};
    const profile = context?.nicheProfile || context?.profile || {};
    return normalizeText([
      listing.title, listing.brand, listing.bullet1, listing.bullet2, listing.description,
      profile.name, profile.winningStyle, profile.style, profile.audience, profile.avoid,
      context?.niche, context?.audience, context?.style
    ].filter(Boolean).join(" "));
  }

  function groupMatch(text, group) {
    return (CONTEXT_GROUPS[group] || []).some((keyword) => text.includes(normalizeText(keyword)));
  }

  function scoreProductName(name, context) {
    const rule = PRODUCT_RULES[name];
    if (!rule) return -Infinity;
    const text = contextString(context);
    const artwork = context?.artworkAnalysis || {};
    let score = rule.base;
    const reasons = [];
    const add = (amount, reason) => { score += amount; if (amount) reasons.push(reason); };
    const accessoryIntent = ["bookish", "teacherOffice", "summer", "fitness", "tech", "home"].some((group) => groupMatch(text, group));
    if (rule.kind === "accessory" && !accessoryIntent) add(-40, "no accessory intent");

    if (groupMatch(text, "bookish")) {
      if (name === "tote bag") add(42, "bookish tote");
      if (name === "ceramic mug") add(38, "bookish mug");
      if (["comfort colors sweatshirt", "sweatshirt", "pullover hoodie"].includes(name)) add(14, "cozy reading");
      if (name === "long sleeve t shirt") add(9, "cozy reading");
      if (["tank top", "performance hoodie", "zip hoodie"].includes(name)) add(-12, "less bookish");
    }
    if (groupMatch(text, "teacherOffice")) {
      if (name === "tote bag") add(32, "work tote");
      if (name === "ceramic mug") add(26, "desk mug");
      if (name === "tumbler") add(22, "work tumbler");
    }
    if (groupMatch(text, "retro")) {
      if (name === "comfort colors heavyweight t shirt") add(20, "retro garment");
      if (name === "comfort colors sweatshirt") add(12, "retro garment");
      if (name === "raglan") add(9, "retro garment");
    }
    if (groupMatch(text, "summer")) {
      if (name === "tank top") add(30, "summer fit");
      if (name === "v neck t shirt") add(15, "summer fit");
      if (name === "tote bag") add(12, "summer tote");
      if (name === "water bottle") add(10, "summer hydration");
      if (["sweatshirt", "comfort colors sweatshirt", "pullover hoodie", "zip hoodie", "long sleeve t shirt"].includes(name)) add(-24, "warm garment");
    }
    if (groupMatch(text, "winter")) {
      if (["sweatshirt", "comfort colors sweatshirt", "pullover hoodie"].includes(name)) add(28, "cold weather");
      if (["long sleeve t shirt", "zip hoodie"].includes(name)) add(20, "cold weather");
      if (["tank top", "crop top", "comfort colors crop sweatshirt"].includes(name)) add(-26, "cold weather mismatch");
    }
    if (groupMatch(text, "fitness")) {
      if (name === "tank top") add(34, "fitness fit");
      if (name === "performance hoodie") add(31, "performance fit");
      if (name === "water bottle") add(29, "fitness accessory");
      if (name === "long sleeve t shirt") add(12, "training layer");
      if (["ceramic mug", "throw pillows"].includes(name)) add(-30, "fitness mismatch");
    }
    if (!groupMatch(text, "feminine") && ["crop top", "comfort colors crop sweatshirt"].includes(name)) add(-22, "no crop audience");
    if (!groupMatch(text, "fitness") && name === "performance hoodie") add(-12, "no performance intent");

    if (groupMatch(text, "feminine")) {
      if (name === "v neck t shirt") add(18, "audience fit");
      if (name === "comfort colors crop sweatshirt") add(16, "audience fit");
      if (name === "crop top") add(14, "audience fit");
      if (name === "tank top") add(10, "audience fit");
    }
    if (groupMatch(text, "tech")) {
      if (name === "iphone cases") add(28, "tech accessory");
      if (name === "popsockets") add(24, "tech accessory");
      if (name === "pullover hoodie") add(10, "tech hoodie");
    }
    if (groupMatch(text, "home")) {
      if (name === "throw pillows") add(30, "home decor");
      if (name === "ceramic mug") add(18, "home mug");
      if (["sweatshirt", "comfort colors sweatshirt", "pullover hoodie"].includes(name)) add(10, "cozy apparel");
    }

    const ratio = Number(artwork.aspectRatio || 0);
    const coverage = Number(artwork.coverage || 0);
    if (rule.kind === "accessory") {
      if (ratio && ratio < 0.62 && ["ceramic mug", "tumbler", "water bottle"].includes(name)) add(-18, "very tall art");
      if (ratio && ratio > 1.55 && ["tote bag", "throw pillows"].includes(name)) add(8, "wide art");
      if (coverage > 0.72 && ["iphone cases", "popsockets"].includes(name)) add(-12, "dense art");
    }
    if (name === "zip hoodie") add(-10, "center zipper risk");
    return { score, reasons, kind: rule.kind, primaryScore: score + rule.primary };
  }

  function chooseProductPlan(products, limit = 10, context = {}) {
    const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
    const ranked = (Array.isArray(products) ? products : [])
      .map((product, originalIndex) => {
        const name = normalizeText(product?.name);
        const scored = scoreProductName(name, context);
        return { product, originalIndex, name, ...scored };
      })
      .filter((entry) => entry.product && entry.product.available !== false && Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);

    const primaryPool = ranked.filter((entry) => entry.kind === "apparel");
    const primary = primaryPool.slice().sort((left, right) => right.primaryScore - left.primaryScore || right.score - left.score || left.originalIndex - right.originalIndex)[0] || ranked[0] || null;
    const selected = [];
    const selectedNames = new Set();
    const push = (entry) => {
      if (!entry || selectedNames.has(entry.name) || selected.length >= safeLimit) return;
      selected.push(entry);
      selectedNames.add(entry.name);
    };
    push(primary);

    const maxAccessories = safeLimit >= 8 ? 2 : Math.max(0, Math.floor(safeLimit / 4));
    let accessoryCount = selected.filter((entry) => entry.kind === "accessory").length;
    for (const entry of ranked) {
      if (selected.length >= safeLimit) break;
      if (entry.kind === "accessory" && accessoryCount >= maxAccessories) continue;
      push(entry);
      if (selectedNames.has(entry.name) && entry.kind === "accessory") accessoryCount = selected.filter((item) => item.kind === "accessory").length;
    }
    if (selected.length < safeLimit) {
      for (const entry of ranked) {
        if (selected.length >= safeLimit) break;
        push(entry);
      }
    }

    return {
      primary: primary?.product || null,
      products: selected.map((entry) => entry.product),
      scored: selected.map((entry) => ({ name: entry.product.name, score: entry.score, kind: entry.kind, reasons: entry.reasons })),
      contextFlags: Object.keys(CONTEXT_GROUPS).filter((group) => groupMatch(contextString(context), group))
    };
  }

  function choosePreferredProducts(products, limit = 10, context = {}) {
    return chooseProductPlan(products, limit, context).products;
  }

  function scoreArtworkInput(descriptor) {
    if (!descriptor || descriptor.kind !== "file" || descriptor.disabled) return { eligible: false, score: 0, reasons: [] };
    const accept = normalizeText(descriptor.accept);
    const text = descriptorText(descriptor);
    const reasons = [];
    let score = 0;
    const imageAccept = !accept || accept.includes("image") || accept.includes("png") || accept.includes("jpg") || accept.includes("jpeg") || accept.includes("webp");
    if (!imageAccept) return { eligible: false, score: 0, reasons };
    score += accept ? 20 : 8;
    reasons.push(accept ? "image accept" : "blank accept");
    const keywords = ["artwork", "design", "upload", "image", "png", "drag and drop", "browse", "choose file"];
    const matchingKeywords = keywords.filter((keyword) => text.includes(keyword));
    score += matchingKeywords.length * 8;
    reasons.push(...matchingKeywords);
    if (descriptor.visible || descriptor.linkedControlVisible) {
      score += 8;
      reasons.push("visible control");
    }
    const stronglyContextual = matchingKeywords.some((keyword) => ["artwork", "drag and drop", "browse", "choose file"].includes(keyword));
    return {
      eligible: matchingKeywords.length >= 1 && (descriptor.visible || descriptor.linkedControlVisible || stronglyContextual),
      score,
      reasons
    };
  }

  function resolveArtworkInput(descriptors) {
    const candidates = descriptors
      .map((descriptor) => ({ descriptor, ...scoreArtworkInput(descriptor) }))
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => right.score - left.score);
    if (!candidates.length) return { input: null, error: "Không tìm thấy ô upload artwork đủ tín hiệu an toàn." };
    if (candidates.length > 1 && candidates[0].score - candidates[1].score < 8) {
      return { input: null, error: "Có nhiều ô upload giống nhau; không xác định chắc chắn artwork field." };
    }
    return { input: candidates[0].descriptor, error: "" };
  }



  function safeTitleSlug(value, fallback = "design") {
    const normalized = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return normalized || fallback;
  }

  function normalizeSavedDesign(value) {
    if (!value || typeof value !== "object") return null;
    const jobId = String(value.jobId || value.job_id || "").trim();
    const artworkDataUrl = String(value.artworkDataUrl || value.artwork_data_url || "").trim();
    const listingValue = value.listing && typeof value.listing === "object" ? value.listing : value;
    const rawListing = {
      merch_flow: true,
      job_id: jobId,
      title: listingValue.title,
      brand: listingValue.brand,
      bullet1: listingValue.bullet1,
      bullet2: listingValue.bullet2,
      description: listingValue.description
    };
    const normalizedListing = normalizeListing(rawListing, jobId);
    if (!jobId || !normalizedListing || !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(artworkDataUrl)) return null;
    // Keep provenance/binding metadata with the saved pair. Dropping these fields
    // makes a later Vault upload look like an unrelated legacy AI listing.
    const listing = {
      ...normalizedListing,
      source: String(listingValue.source || ""),
      finalSelected: Boolean(listingValue.finalSelected),
      artworkStorageKey: String(listingValue.artworkStorageKey || ""),
      artworkRevision: Number(listingValue.artworkRevision || 0),
      sessionNonce: String(listingValue.sessionNonce || ""),
      artworkMessageIndex: Number(listingValue.artworkMessageIndex ?? -1),
      messageIndex: Number(listingValue.messageIndex ?? -1)
    };
    return {
      id: String(value.id || value.designId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
      jobId,
      createdAt: Number(value.createdAt || Date.now()),
      artworkDataUrl,
      artworkName: String(value.artworkName || value.artwork_name || `${safeTitleSlug(listing.title)}.png`),
      listing,
      nicheProfile: value.nicheProfile && typeof value.nicheProfile === "object" ? value.nicheProfile : {},
      batchId: String(value.batchId || ""),
      batchIndex: Number(value.batchIndex || 0),
      conversationKey: String(value.conversationKey || ""),
      creativeFingerprint: String(value.creativeFingerprint || "").replace(/\s+/g, " ").trim().slice(0, 360),
      source: String(value.source || "saved")
    };
  }

  function stableCreativeHash(value) {
    const text = String(value || "creative");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function creativeVariationFromKey(key = "") {
    const rawKey = String(key || "");
    const territories = BOOK_LOVER_CREATIVE_POLICY.situationTerritories;
    const constructions = BOOK_LOVER_CREATIVE_POLICY.visualConstructions;
    const batchMatch = rawKey.match(/^batch-slot:([^:]+):(\d+)$/);
    if (batchMatch) {
      const base = stableCreativeHash(batchMatch[1]);
      const slot = Math.max(1, Number(batchMatch[2]) || 1) - 1;
      return {
        territory: territories[(base + slot) % territories.length],
        construction: constructions[(Math.floor(base / Math.max(1, territories.length)) + slot) % constructions.length]
      };
    }
    const base = stableCreativeHash(rawKey);
    const territory = territories[base % territories.length];
    const construction = constructions[Math.floor(base / Math.max(1, territories.length)) % constructions.length];
    return { territory, construction };
  }

  function creativeFingerprintForJob({ jobId = "", revision = 0, batchId = "", batchIndex = 0 } = {}) {
    const attempt = Math.max(0, Number(revision) || 0);
    const slot = Math.max(0, Number(batchIndex) || 0);
    const key = batchId && slot > 0
      ? `batch-slot:${batchId}:${slot}`
      : (attempt > 0 ? `${jobId}:revision:${attempt}` : String(jobId || ""));
    const variation = creativeVariationFromKey(key);
    return `territory=${variation.territory}; construction=${variation.construction}`;
  }

  function normalizeCreativeMemory(items, limit = BOOK_LOVER_CREATIVE_POLICY.memoryLimit) {
    const source = Array.isArray(items) ? items : [];
    const result = [];
    const seen = new Set();
    for (let index = source.length - 1; index >= 0 && result.length < limit; index -= 1) {
      const raw = source[index];
      const text = typeof raw === "string"
        ? raw
        : [raw?.fingerprint, raw?.title, raw?.description].filter(Boolean).join(" — ");
      const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 220);
      if (!clean) continue;
      const key = normalizeText(clean);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
    return result.reverse();
  }

  function creativeMemoryFromSavedDesigns(savedDesigns, limit = BOOK_LOVER_CREATIVE_POLICY.memoryLimit) {
    return normalizeCreativeMemory((Array.isArray(savedDesigns) ? savedDesigns : [])
      .filter(Boolean)
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .map((design) => ({
        fingerprint: design?.creativeFingerprint || "",
        title: design?.listing?.title || design?.title || "",
        description: design?.listing?.description || design?.description || ""
      })), limit);
  }

  function creativeMemoryBlock(items) {
    const previous = normalizeCreativeMemory(items);
    if (!previous.length) return "";
    return `\nRECENT CONCEPT MEMORY — avoid the same underlying situation, not just the wording:\n${previous.map((item) => `- ${item}`).join("\n")}\n`;
  }

  function compactPromptValue(value, limit = 180) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, "'")
      .trim()
      .slice(0, Math.max(1, Number(limit) || 180))
      .replace(/[\s,;:.-]+$/g, "")
      .trim();
  }

  function buildCompactArtworkBody({ profile = {}, seed = "", avoidConcepts = [], variationKey = "" } = {}) {
    const niche = compactPromptValue(profile.name || DEFAULT_BOOK_LOVER_PROFILE.name, 55) || "book lovers";
    const angle = compactPromptValue(seed || "invent a fresh underused real-life reader behavior that becomes an instant visual gag", 125);
    const recent = normalizeCreativeMemory(avoidConcepts, 3).map((item) => compactPromptValue(item, 44)).filter(Boolean);
    const memory = recent.length ? ` Memory: ${recent.join(" | ")}.` : "";
    const saturated = BOOK_LOVER_CREATIVE_POLICY.genericTerritories.map((item) => compactPromptValue(item, 28)).join(", ");
    const variation = creativeVariationFromKey(variationKey || angle || niche);
    const customAvoid = compactPromptValue(profile.avoid || "", 58);
    const defaultAvoid = compactPromptValue(DEFAULT_BOOK_LOVER_PROFILE.avoid, 58);
    const extraAvoid = customAvoid && normalizeText(customAvoid) !== normalizeText(defaultAvoid) ? ` Also avoid: ${customAvoid}.` : "";

    return `Generate exactly one new transparent-background T-shirt artwork for the US ${niche} market. Inspiration: ${angle}. Silently explore ${BOOK_LOVER_CREATIVE_POLICY.internalExplorationCount} different lived-reader concepts; choose the freshest readable one. Job lane: ${variation.territory}. Visual construction: ${variation.construction}. Do not default to a lone centered reader holding a book. The gag must show an instantly recognizable lived reader situation. Vary viewpoint, setting, figures, props, blocking, and layout; use hands, people, pets, signs, panels, diagrams, or object-only humor as needed. Use short natural US-English text only if useful; setup + punchline is optional. Never use these saturated concepts: ${saturated}.${memory} Do not repeat situation, setting+props, blocking, or composition.
STYLE DNA: only solid white; bold uppercase block text; thick clean vector/pictogram strokes; transparent background; strong thumbnail readability on black. Storytelling props are allowed; no decorative filler, colors, gradients, shadows, 3D, distress, garment, background scene, or watermark.${extraAvoid} Render the image now with no explanation.`;
  }

  function buildArtworkPrompt({
    jobId,
    profile = {},
    seed = "",
    avoidConcepts = [],
    batchIndex = 0,
    batchTotal = 0,
    includeReferenceRule = false,
    variationKey = ""
  } = {}) {
    const resolvedJobId = String(jobId || "").trim();
    if (!resolvedJobId) throw new Error("Artwork prompt requires jobId");
    const batchLine = batchIndex && batchTotal
      ? `\nMERCH_FLOW_BATCH: ${Math.max(1, Number(batchIndex) || 1)}/${Math.max(1, Number(batchTotal) || 1)}`
      : "";
    const compactBrief = buildCompactArtworkBody({ profile, seed, avoidConcepts, variationKey: variationKey || resolvedJobId });
    return `MERCH_FLOW_JOB_ID: ${resolvedJobId}${batchLine}
MERCH_FLOW_IMAGE_REQUEST: NEW

${compactBrief}`;
  }

  function buildBatchPrompt({ jobId, index = 1, total = 1, batchId = "", profile = {}, avoidTitles = [], avoidConcepts = [] } = {}) {
    const memory = [...(Array.isArray(avoidConcepts) ? avoidConcepts : []), ...(Array.isArray(avoidTitles) ? avoidTitles : [])];
    return buildArtworkPrompt({
      jobId,
      profile,
      batchIndex: index,
      batchTotal: total,
      avoidConcepts: memory,
      includeReferenceRule: false,
      variationKey: batchId ? `batch-slot:${batchId}:${Math.max(1, Number(index) || 1)}` : jobId,
      seed: "Find a fresh, underused American book-lover situation with a strong visual gag. Make the underlying behavior clearly different from previous batch and vault concepts."
    });
  }

  function buildRegenerationPrompt({ jobId, revision = 1, profile = {}, avoidConcepts = [] } = {}) {
    const resolvedJobId = String(jobId || "").trim();
    if (!resolvedJobId) throw new Error("Artwork attempt prompt requires jobId");
    const attempt = Math.max(1, Number(revision) || 1);
    const base = buildArtworkPrompt({
      jobId: resolvedJobId,
      profile,
      avoidConcepts,
      includeReferenceRule: false,
      variationKey: `${resolvedJobId}:revision:${attempt}`,
      seed: "Select a strong, underused real-life American reader situation from recent concept memory. Make the behavior, visual story, setup, and punchline clearly distinct from the concepts in memory."
    });
    return base.replace(
      `MERCH_FLOW_JOB_ID: ${resolvedJobId}`,
      `MERCH_FLOW_JOB_ID: ${resolvedJobId}\nMERCH_FLOW_ARTWORK_ATTEMPT: ${attempt}`
    );
  }

  function buildArtworkRetryPrompt(jobId, retryNumber = 1, sourcePrompt = "") {
    const resolvedJobId = String(jobId || "").trim();
    if (!resolvedJobId) throw new Error("Artwork retry prompt requires jobId");
    const originalBrief = String(sourcePrompt || "")
      .replace(/^MERCH_FLOW_IMAGE_MODE:[^\n]*\n?/gim, "")
      .replace(/^MERCH_FLOW_ARTWORK_RETRY:[^\n]*\n?/gim, "")
      .replace(/^MERCH_FLOW_JOB_ID:[^\n]*\n?/gim, "")
      .replace(/^MERCH_FLOW_ARTWORK_ATTEMPT:[^\n]*\n?/gim, "")
      .replace(/^TASK_CLASS:[^\n]*\n?/gim, "")
      .replace(/^INPUT_ASSETS:[^\n]*\n?/gim, "")
      .replace(/^CONTEXT_SCOPE:[^\n]*\n?/gim, "")
      .replace(/^TEXT_TO_IMAGE_ONLY:[^\n]*\n?/gim, "")
      .replace(/^MERCH_FLOW_IMAGE_REQUEST:[^\n]*\n?/gim, "")
      .trim();
    const compactOriginal = originalBrief.length <= 1800
      && /Generate exactly one new transparent-background T-shirt artwork/i.test(originalBrief)
      ? originalBrief
      : buildCompactArtworkBody({
        profile: DEFAULT_BOOK_LOVER_PROFILE,
        seed: "invent a fresh, underused real-life reader behavior that becomes an instantly clear visual gag"
      });
    return `MERCH_FLOW_ARTWORK_RETRY: ${resolvedJobId}:${Math.max(1, Number(retryNumber) || 1)}
MERCH_FLOW_JOB_ID: ${resolvedJobId}
MERCH_FLOW_IMAGE_REQUEST: NEW

${compactOriginal}`;
  }

  function buildListingPrompt(jobId) {
    const resolvedJobId = String(jobId || "").trim();
    if (!resolvedJobId) throw new Error("Listing prompt requires jobId");
    return `MERCH_FLOW_LISTING_REQUEST: ${resolvedJobId}\n\nThe artwork for this job is already complete. Write the listing for that exact artwork, using natural US English and only claims supported by the visible design. Favor clear reader-relevant search language over keyword stuffing. Avoid trademarks, copyrighted names, brand references, unsupported trend claims, and awkward repetition. Title must be 60 characters or fewer. Return ONLY one fenced JSON object with real final values; no introduction, notes, checklist, or extra prose.\n\n\`\`\`json\n{\n  "merch_flow": true,\n  "job_id": "${resolvedJobId}",\n  "title": "<FINAL AMAZON TITLE, MAX 60 CHARACTERS>",\n  "brand": "<FINAL ORIGINAL BRAND>",\n  "bullet1": "<FINAL CUSTOMER-FACING BULLET>",\n  "bullet2": "<FINAL GIFT/STYLE BULLET>",\n  "description": "<FINAL SHORT NATURAL DESCRIPTION>"\n}\n\`\`\``;
  }

  return {
    LISTING_KEYS,
    DEFAULT_BOOK_LOVER_PROFILE,
    BOOK_LOVER_CREATIVE_POLICY,
    parseListingFromAssistantText,
    normalizeListing,
    resolveListingFieldMap,
    choosePreferredProducts,
    chooseProductPlan,
    scoreArtworkInput,
    resolveArtworkInput,
    safeTitleSlug,
    normalizeSavedDesign,
    normalizeCreativeMemory,
    creativeMemoryFromSavedDesigns,
    creativeVariationFromKey,
    creativeFingerprintForJob,
    buildArtworkPrompt,
    buildBatchPrompt,
    buildRegenerationPrompt,
    buildArtworkRetryPrompt,
    buildListingPrompt
  };
});
