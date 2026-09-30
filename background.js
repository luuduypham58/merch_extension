importScripts("merch-flow-core.js", "vault-db.js");

const Core = globalThis.MerchFlowCore;
const VaultDB = globalThis.MerchFlowVaultDB;
const BATCH_MAX = 25;
const BATCH_JOB_TTL = 30 * 60 * 1000;
const AMAZON_RUNTIME_STORAGE_KEY = "merchFlowAmazonRuntimes";
let batchBusy = false;
const freshRouteRepairBusy = new Set();

async function registerMerchAmazonRuntime(tabId, message) {
  if (!tabId) return { registered: false, error: "Không xác định được tab Amazon" };
  const version = String(message.version || "");
  const instanceToken = String(message.instanceToken || "");
  const documentToken = String(message.documentToken || "");
  if (!version || !instanceToken || !documentToken) return { registered: false, error: "Thiếu runtime identity" };

  const stored = await chrome.storage.local.get([AMAZON_RUNTIME_STORAGE_KEY, "pendingUpload", "autoRun"]);
  const runtimes = stored[AMAZON_RUNTIME_STORAGE_KEY] && typeof stored[AMAZON_RUNTIME_STORAGE_KEY] === "object"
    ? { ...stored[AMAZON_RUNTIME_STORAGE_KEY] }
    : {};
  const key = String(tabId);
  const previous = runtimes[key] || null;
  const sameDocument = Boolean(previous && previous.documentToken === documentToken);
  const duplicateRuntime = Boolean(sameDocument && previous.instanceToken && previous.instanceToken !== instanceToken);
  const versionChangedInPlace = Boolean(sameDocument && previous.version && previous.version !== version);
  // A first runtime registration is only disruptive when an AUTO job is
  // active. Idle Amazon tabs do not need a forced reload.
  const firstRegistration = !previous && Boolean(stored.pendingUpload?.jobId || stored.autoRun?.jobId);
  const now = Date.now();
  const shouldReload = firstRegistration || duplicateRuntime || versionChangedInPlace;

  runtimes[key] = {
    tabId,
    version,
    instanceToken,
    documentToken,
    registeredAt: now,
    reloadRequestedAt: shouldReload ? now : 0
  };
  await chrome.storage.local.set({ [AMAZON_RUNTIME_STORAGE_KEY]: runtimes });

  if (!shouldReload) return { registered: true, reloading: false, version };
  try {
    await chrome.tabs.reload(tabId, { bypassCache: true });
    return { registered: true, reloading: true, version };
  } catch (error) {
    return { registered: false, reloading: false, error: error.message || "Không reload được tab Amazon" };
  }
}

function enablePinnedPanel() {
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

function allowedArtworkUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "chatgpt.com"
      || host === "chat.openai.com"
      || host.endsWith(".openai.com")
      || host.endsWith(".oaiusercontent.com")
      || host.endsWith(".blob.core.windows.net");
  } catch (_) {
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}


async function isJobCancelled(jobId) {
  if (!jobId) return false;
  const { flowCancel } = await chrome.storage.local.get("flowCancel");
  return Boolean(flowCancel?.jobId === jobId && flowCancel?.cancelledAt);
}

async function cancelAutoJob(jobId, cancelToken = "") {
  const data = await chrome.storage.local.get(["autoRun", "pendingChatJob", "lastSentChatJob", "pendingUpload"]);
  const resolvedJobId = jobId || data.autoRun?.jobId || data.lastSentChatJob?.jobId || data.pendingChatJob?.jobId || data.pendingUpload?.jobId || "";
  if (!resolvedJobId) return { cancelled: false, error: "Không có job đang chạy" };
  const now = Date.now();
  const flowCancel = { jobId: resolvedJobId, cancelToken: cancelToken || crypto.randomUUID(), cancelledAt: now, reason: "user" };
  const update = { flowCancel };
  if (data.autoRun?.jobId === resolvedJobId) {
    update.autoRun = { ...data.autoRun, status: "cancelled", lastMessage: "AUTO đã bị hủy thủ công. Job treo đã được reset.", updatedAt: now, cancelledAt: now };
  }
  await chrome.storage.local.set(update);
  await chrome.storage.local.remove([
    "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing",
    "processedArtwork", "pendingUpload", "lastAutoUpload", "merchStatus", "chatStatus"
  ]);

  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs
    .filter((tab) => isChatUrl(tab.url || "") || /^https:\/\/merch\.amazon\.com\//i.test(tab.url || ""))
    .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "MERCH_FLOW_CANCEL_JOB_V1", jobId: resolvedJobId, cancelToken: flowCancel.cancelToken }).catch(() => null)));
  return { cancelled: true, jobId: resolvedJobId };
}

async function fetchAndStoreArtwork(message) {
  if (!message?.jobId || !allowedArtworkUrl(message.url)) throw new Error("URL artwork không được phép");
  if (await isJobCancelled(message.jobId)) throw new Error("Job đã bị hủy");
  const beforeFetch = await chrome.storage.local.get(["pendingChatJob", "lastSentChatJob", "chatArtwork"]);
  const activeJobId = beforeFetch.lastSentChatJob?.jobId || beforeFetch.pendingChatJob?.jobId || "";
  if (activeJobId && activeJobId !== message.jobId) throw new Error("Bỏ qua artwork của job cũ");
  const captureStartedAt = Number(message.captureStartedAt || Date.now());
  if (beforeFetch.chatArtwork?.jobId === message.jobId
      && message.candidateKey
      && beforeFetch.chatArtwork.candidateKey === message.candidateKey) {
    return { stored: true, ignoredDuplicateCandidate: true, storageKey: beforeFetch.chatArtwork.storageKey };
  }
  const response = await fetch(message.url, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được artwork (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Nguồn tải về không phải ảnh");
  if (blob.size > 30 * 1024 * 1024) throw new Error("Artwork vượt 30 MB");
  const dataUrl = `data:${blob.type};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;
  if (await isJobCancelled(message.jobId)) throw new Error("Job đã bị hủy trong lúc tải artwork");
  const afterFetch = await chrome.storage.local.get(["pendingChatJob", "lastSentChatJob", "chatArtwork"]);
  const currentJobId = afterFetch.lastSentChatJob?.jobId || afterFetch.pendingChatJob?.jobId || "";
  if (currentJobId && currentJobId !== message.jobId) throw new Error("Bỏ qua artwork của job cũ");
  if (afterFetch.chatArtwork?.jobId === message.jobId
      && afterFetch.chatArtwork.candidateKey !== (message.candidateKey || "")
      && Number(afterFetch.chatArtwork.createdAt || 0) >= captureStartedAt) {
    return { stored: true, ignoredOlderCandidate: true, storageKey: afterFetch.chatArtwork.storageKey };
  }
  const artwork = {
    jobId: message.jobId,
    storageKey: crypto.randomUUID(),
    dataUrl,
    name: message.name || `merch-flow-${String(message.jobId).slice(0, 8)}.png`,
    sourceUrl: message.url,
    candidateKey: message.candidateKey || "",
    candidatePosition: Number(message.candidatePosition || 0),
    conversationKey: message.conversationKey || "",
    sessionNonce: message.sessionNonce || afterFetch.lastSentChatJob?.sessionNonce || "",
    artworkMessageIndex: Number.isFinite(message.candidateMessageIndex) ? message.candidateMessageIndex : -1,
    createdAt: Date.now()
  };
  await chrome.storage.local.set({ chatArtwork: artwork });
  return { stored: true, storageKey: artwork.storageKey, size: blob.size };
}

function isCompleteListing(listing, jobId = "") {
  return Boolean(listing
    && (!jobId || listing.jobId === jobId)
    && typeof listing.title === "string"
    && listing.title.trim()
    && listing.title.length <= 60
    && ["brand", "bullet1", "bullet2", "description"].every((key) => typeof listing[key] === "string" && listing[key].trim()));
}

function clampBatchCount(value) {
  return Math.max(1, Math.min(BATCH_MAX, Math.floor(Number(value) || 1)));
}

async function getChatTab(tabId) {
  if (!tabId) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || "") ? tab : null;
  } catch (_) {
    return null;
  }
}

function isChatUrl(url = "") {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url);
}

function isConversationUrl(url = "") {
  try { return /(?:^|\/)c\/[^/]+/i.test(new URL(url).pathname || ""); }
  catch (_) { return false; }
}

function conversationPath(url = "") {
  try {
    const pathname = new URL(url).pathname || "";
    return /(?:^|\/)c\/[^/]+/i.test(pathname) ? pathname : "";
  } catch (_) {
    return "";
  }
}

function freshJobUrl(job, repairCount = 0) {
  // The managed tab id + session nonce in storage own the job. Keep ChatGPT on
  // its canonical root: unknown query parameters can trigger SPA history restore.
  void job;
  void repairCount;
  return "https://chatgpt.com/";
}

async function findPreparedImageComposerTab(openChatTabs = []) {
  for (const tab of openChatTabs) {
    if (!tab?.id || !/^https:\/\/chatgpt\.com\/?(?:[?#].*)?$/i.test(tab.url || "")) continue;
    try {
      const probe = await chrome.tabs.sendMessage(tab.id, { type: "MERCH_FLOW_PROBE_CLEAN_IMAGE_CHAT_V1" });
      if (probe?.cleanImageComposer) return tab;
    } catch (_) { /* content script unavailable or tab still loading */ }
  }
  return null;
}


async function startFreshChatJob(job, { activate = true, closePreviousManaged = true } = {}) {
  const jobId = String(job?.jobId || "").trim();
  if (!jobId || !String(job?.prompt || "").trim()) throw new Error("Thiếu Job ID hoặc prompt cho phiên ChatGPT sạch");
  const prompt = String(job.prompt || "");
  const textOnlyNewImageJob = (/(?:^|\n)MERCH_FLOW_IMAGE_REQUEST:\s*NEW\s*(?:\n|$)/i.test(prompt)
    || (/(?:^|\n)TASK_CLASS:\s*TEXT_TO_IMAGE\s*(?:\n|$)/i.test(prompt)
      && /(?:^|\n)INPUT_ASSETS:\s*NONE\s*(?:\n|$)/i.test(prompt)
      && /(?:^|\n)TEXT_TO_IMAGE_ONLY:/i.test(prompt)))
    && !job.referenceDataUrl
    && !job.referenceName;
  // The explicit Create image chip is currently routing some clean text-only
  // requests into image-edit. For true no-input generation, use the normal New
  // chat composer and let the affirmative prompt invoke image generation.
  const createImageModeBypass = Boolean(job.createImageModeBypass || textOnlyNewImageJob);
  const previous = await chrome.storage.local.get(["merchFlowChatTabId", "pendingChatJob", "lastSentChatJob"]);
  const previousManagedId = Number(previous.merchFlowChatTabId || previous.lastSentChatJob?.chatTabId || previous.pendingChatJob?.chatTabId || 0);
  const openChatTabs = (await chrome.tabs.query({}).catch(() => []))
    .filter((tab) => isChatUrl(tab.url || ""));
  // A retry recovering from an image-edit routing failure intentionally uses a
  // normal clean composer; do not reclaim an already prepared Create image tab.
  const preparedImageTab = createImageModeBypass ? null : await findPreparedImageComposerTab(openChatTabs);
  const staleConversationKeys = [...new Set([
    ...(Array.isArray(job.staleConversationKeys) ? job.staleConversationKeys : []),
    previous.lastSentChatJob?.conversationKey || "",
    ...openChatTabs.map((tab) => conversationPath(tab.url || ""))
  ].filter((key) => /^\/c\/[^/]+/i.test(String(key || ""))))];
  const sessionNonce = String(job.sessionNonce || crypto.randomUUID());
  const blankTab = preparedImageTab || await chrome.tabs.create({ url: "about:blank", active: activate });
  const pendingChatJob = {
    ...job,
    jobId,
    // Merch artwork generation is text-to-image only. Never carry a saved/stale
    // reference attachment into a fresh ChatGPT composer.
    referenceDataUrl: "",
    referenceName: "",
    referenceAlreadySent: false,
    recoveryMode: "",
    sessionNonce,
    freshConversationRequired: true,
    freshConversationRequestedAt: Date.now(),
    staleConversationKeys,
    freshRouteRepairCount: 0,
    freshRouteTransitionArmedAt: 0,
    freshCandidateConversationKey: "",
    freshCandidateSeenAt: 0,
    createImageModeBypass,
    preparedImageMode: Boolean(preparedImageTab),
    freshSendArmedAt: 0,
    chatTabId: blankTab.id,
    chatUrl: "",
    status: "pending",
    lastError: "",
    lastAttemptAt: 0
  };
  await chrome.storage.local.remove(["lastSentChatJob", "chatArtwork", "lastListing", "processedArtwork", "pendingUpload", "lastAutoUpload", "merchStatus"]);
  await chrome.storage.local.set({ pendingChatJob, merchFlowChatTabId: blankTab.id });
  const url = freshJobUrl(pendingChatJob);
  // Close the old managed page before ChatGPT boots in the blank tab. This keeps
  // the profile's last live /c/... route from winning the initial SPA hydration.
  if (closePreviousManaged && previousManagedId && previousManagedId !== blankTab.id) {
    try { await chrome.tabs.remove(previousManagedId); } catch (_) { /* old tab already gone */ }
  }
  let tab;
  try {
    if (preparedImageTab) {
      tab = await chrome.tabs.update(blankTab.id, { active: activate });
      const claim = await chrome.tabs.sendMessage(blankTab.id, {
        type: "MERCH_FLOW_CLAIM_CLEAN_IMAGE_CHAT_V1",
        jobId,
        sessionNonce,
        tabId: blankTab.id
      });
      if (!claim?.claimed) throw new Error(claim?.error || "Tab Create image sạch không nhận job");
    } else {
      tab = await chrome.tabs.update(blankTab.id, { url, active: activate });
    }
  } catch (error) {
    await chrome.storage.local.set({ pendingChatJob: { ...pendingChatJob, status: "failed", lastError: error.message || "Không điều hướng được ChatGPT", lastAttemptAt: Date.now() } });
    throw error;
  }
  return { opened: true, tabId: tab.id, url: tab.url || url, sessionNonce };
}

async function clearTransientFlowData() {
  await chrome.storage.local.remove([
    "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing",
    "processedArtwork", "pendingUpload", "lastAutoUpload", "merchStatus", "autoRun"
  ]);
}

async function ensureVaultMetadata(savedDesigns) {
  if (!VaultDB) throw new Error("Vault IndexedDB chưa sẵn sàng");
  const migrated = await VaultDB.migrateLegacy(Array.isArray(savedDesigns) ? savedDesigns : []);
  if (migrated.changed) await chrome.storage.local.set({ savedDesigns: migrated.metadata });
  return migrated.metadata;
}

async function startNextBatchJob() {
  if (batchBusy) return;
  batchBusy = true;
  try {
    const data = await chrome.storage.local.get(["batchRun", "savedDesigns", "nicheProfile"]);
    const run = data.batchRun;
    if (!run || run.status !== "running") return;
    if (run.currentJobId) return;
    const completedCount = Number(run.completedCount || 0);
    const targetCount = clampBatchCount(run.targetCount);
    if (completedCount >= targetCount) {
      await chrome.storage.local.set({
        batchRun: {
          ...run,
          status: "completed",
          completedCount,
          currentJobId: "",
          jobStartedAt: 0,
          lastMessage: `Đã lưu đủ ${completedCount}/${targetCount} mẫu. Có thể đóng ChatGPT và mai mở Kho mẫu để đăng.`,
          updatedAt: Date.now(),
          completedAt: Date.now()
        }
      });
      await chrome.alarms.clear("merch-flow-batch-watch");
      return;
    }

    const profile = run.profileSnapshot || data.nicheProfile || Core.DEFAULT_BOOK_LOVER_PROFILE;
    const allSavedDesigns = await ensureVaultMetadata(data.savedDesigns);
    const batchDesigns = allSavedDesigns
      .filter((design) => design.batchId === run.id)
      .sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0));
    const creativeMemory = Core.creativeMemoryFromSavedDesigns(allSavedDesigns);
    const index = completedCount + 1;
    const jobId = crypto.randomUUID();
    const prompt = Core.buildBatchPrompt({
      jobId,
      index,
      total: targetCount,
      batchId: run.id,
      profile,
      avoidTitles: batchDesigns.map((design) => design.listing?.title).filter(Boolean),
      avoidConcepts: creativeMemory
    });
    const now = Date.now();
    await clearTransientFlowData();
    const pendingChatJob = {
      jobId,
      prompt,
      referenceDataUrl: "",
      referenceName: "",
      createdAt: now,
      lastAttemptAt: now,
      status: "pending",
      lastError: "",
      runMode: "batch-vault",
      batchId: run.id,
      batchIndex: index
    };
    const nextRun = {
      ...run,
      targetCount,
      currentJobId: jobId,
      currentIndex: index,
      jobStartedAt: now,
      status: "running",
      lastMessage: `Đang tạo mẫu ${index}/${targetCount} trên ChatGPT…`,
      updatedAt: now
    };
    await chrome.storage.local.set({
      pendingChatJob,
      batchRun: nextRun,
      chatStatus: { message: nextRun.lastMessage, tone: "info", jobId, updatedAt: now }
    });
    const fresh = await startFreshChatJob({
      ...pendingChatJob,
      sourcePrompt: prompt,
      sessionNonce: crypto.randomUUID()
    }, { activate: true, closePreviousManaged: true });
    const latest = await chrome.storage.local.get(["pendingChatJob", "batchRun"]);
    if (latest.pendingChatJob?.jobId === jobId && latest.batchRun?.id === run.id) {
      await chrome.storage.local.set({
        pendingChatJob: { ...latest.pendingChatJob, chatTabId: fresh.tabId, chatUrl: fresh.url || "", lastAttemptAt: Date.now() },
        batchRun: { ...latest.batchRun, chatTabId: fresh.tabId, updatedAt: Date.now() }
      });
    }
  } catch (error) {
    const { batchRun } = await chrome.storage.local.get("batchRun");
    if (batchRun) {
      await chrome.storage.local.set({
        batchRun: { ...batchRun, status: "failed", lastMessage: `Batch dừng: ${error.message}`, lastError: error.message, updatedAt: Date.now() }
      });
    }
  } finally {
    batchBusy = false;
  }
}

async function finalizeCurrentBatchDesign() {
  if (batchBusy) return;
  batchBusy = true;
  try {
    const data = await chrome.storage.local.get(["batchRun", "savedDesigns", "chatArtwork", "lastListing", "lastSentChatJob", "nicheProfile"]);
    const run = data.batchRun;
    if (!run || !["running", "paused"].includes(run.status) || !run.currentJobId) return;
    const jobId = run.currentJobId;
    const artwork = data.chatArtwork;
    const listing = data.lastListing;
    if (!artwork?.dataUrl || artwork.jobId !== jobId || !isCompleteListing(listing, jobId)) return;
    const artworkIndex = Number.isFinite(artwork.artworkMessageIndex) ? artwork.artworkMessageIndex : -1;
    const listingIndex = Number.isFinite(listing.messageIndex) ? listing.messageIndex : -1;
    if (artworkIndex >= 0 && listingIndex >= 0 && listingIndex < artworkIndex) return;

    const savedDesigns = await ensureVaultMetadata(data.savedDesigns);
    if (savedDesigns.some((design) => design.jobId === jobId)) {
      await chrome.storage.local.set({ batchRun: { ...run, currentJobId: "", completedCount: Math.max(Number(run.completedCount || 0), Number(run.currentIndex || 0)), updatedAt: Date.now() } });
      return;
    }

    const design = Core.normalizeSavedDesign({
      id: crypto.randomUUID(),
      jobId,
      createdAt: Date.now(),
      artworkDataUrl: artwork.dataUrl,
      artworkName: artwork.name || `${Core.safeTitleSlug(listing.title)}.png`,
      listing,
      nicheProfile: run.profileSnapshot || data.nicheProfile || Core.DEFAULT_BOOK_LOVER_PROFILE,
      batchId: run.id,
      batchIndex: Number(run.currentIndex || Number(run.completedCount || 0) + 1),
      conversationKey: artwork.conversationKey || data.lastSentChatJob?.conversationKey || "",
      creativeFingerprint: Core.creativeFingerprintForJob({
        jobId,
        revision: Number(artwork.artworkRevision || listing.artworkRevision || 0),
        batchId: run.id,
        batchIndex: Number(run.currentIndex || Number(run.completedCount || 0) + 1)
      }),
      source: "batch-vault"
    });
    if (!design) throw new Error("Artwork hoặc listing batch không hợp lệ");
    await VaultDB.putDesign(design);
    const nextSaved = [...savedDesigns.filter((item) => item.jobId !== jobId), VaultDB.metadataFromDesign(design)];
    const completedCount = Number(run.completedCount || 0) + 1;
    const done = completedCount >= clampBatchCount(run.targetCount);
    const paused = run.status === "paused";
    const nextRun = {
      ...run,
      completedCount,
      currentJobId: "",
      currentIndex: 0,
      jobStartedAt: 0,
      status: done ? "completed" : (paused ? "paused" : "running"),
      lastMessage: done
        ? `Đã lưu đủ ${completedCount}/${run.targetCount} mẫu. Mai vào Kho mẫu và chọn “Đưa lên Merch”.`
        : paused
          ? `Đã lưu mẫu ${completedCount}/${run.targetCount} và tạm dừng trước mẫu tiếp theo.`
          : `Đã lưu mẫu ${completedCount}/${run.targetCount}. Đang chuẩn bị mẫu tiếp theo…`,
      updatedAt: Date.now(),
      completedAt: done ? Date.now() : 0
    };
    await chrome.storage.local.set({ savedDesigns: nextSaved, batchRun: nextRun });
    if (done) await chrome.alarms.clear("merch-flow-batch-watch");
    await chrome.storage.local.remove([
      "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing",
      "processedArtwork", "pendingUpload", "lastAutoUpload", "merchStatus"
    ]);
    if (!done && !paused) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      batchBusy = false;
      await startNextBatchJob();
      return;
    }
  } catch (error) {
    const { batchRun } = await chrome.storage.local.get("batchRun");
    if (batchRun) {
      await chrome.storage.local.set({
        batchRun: { ...batchRun, status: "failed", lastMessage: `Không lưu được mẫu: ${error.message}`, lastError: error.message, updatedAt: Date.now() }
      });
    }
  } finally {
    batchBusy = false;
  }
}

async function startBatch(message) {
  const targetCount = clampBatchCount(message?.targetCount || 10);
  const data = await chrome.storage.local.get(["batchRun", "nicheProfile"]);
  if (data.batchRun?.status === "running") return { started: false, error: "Batch đang chạy" };
  const storedProfile = data.nicheProfile || {};
  const staleDefaultProfile = storedProfile.name === Core.DEFAULT_BOOK_LOVER_PROFILE.name
    && storedProfile.profileVersion !== Core.DEFAULT_BOOK_LOVER_PROFILE.profileVersion;
  const profile = {
    ...Core.DEFAULT_BOOK_LOVER_PROFILE,
    ...(staleDefaultProfile
      ? { referenceDataUrl: storedProfile.referenceDataUrl || "", referenceName: storedProfile.referenceName || "" }
      : storedProfile),
    name: Core.DEFAULT_BOOK_LOVER_PROFILE.name,
    profileVersion: Core.DEFAULT_BOOK_LOVER_PROFILE.profileVersion
  };
  const run = {
    id: crypto.randomUUID(),
    status: "running",
    targetCount,
    completedCount: 0,
    currentJobId: "",
    currentIndex: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    profileSnapshot: profile,
    lastMessage: `Đang chuẩn bị batch ${targetCount} mẫu book lovers…`,
    chatTabId: 0
  };
  await clearTransientFlowData();
  await chrome.storage.local.set({ batchRun: run, nicheProfile: profile });
  await chrome.alarms.create("merch-flow-batch-watch", { periodInMinutes: 1 });
  await startNextBatchJob();
  return { started: true, batchId: run.id, targetCount };
}

async function pauseBatch() {
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (!batchRun) return { paused: false };
  await chrome.storage.local.set({ batchRun: { ...batchRun, status: "paused", lastMessage: batchRun.currentJobId ? "Đang tạm dừng: mẫu hiện tại sẽ được lưu xong, sau đó không tạo mẫu tiếp theo." : "Đã tạm dừng trước mẫu tiếp theo.", updatedAt: Date.now() } });
  return { paused: true };
}

async function resumeBatch() {
  const data = await chrome.storage.local.get(["batchRun", "pendingChatJob"]);
  const batchRun = data.batchRun;
  if (!batchRun) return { resumed: false, error: "Chưa có batch" };
  const wasFailed = batchRun.status === "failed";
  const next = { ...batchRun, status: "running", lastMessage: batchRun.currentJobId ? "Đang tiếp tục job hiện tại…" : "Đang tạo mẫu tiếp theo…", updatedAt: Date.now() };
  await chrome.storage.local.set({ batchRun: next });
  await chrome.alarms.create("merch-flow-batch-watch", { periodInMinutes: 1 });
  await finalizeCurrentBatchDesign();

  const latest = await chrome.storage.local.get(["batchRun", "pendingChatJob"]);
  if (!latest.batchRun?.currentJobId) {
    await startNextBatchJob();
    return { resumed: true };
  }

  const pending = latest.pendingChatJob;
  if (pending?.jobId === latest.batchRun.currentJobId) {
    const existing = await getChatTab(Number(pending.chatTabId || latest.batchRun.chatTabId || 0));
    if (pending.status === "failed" || !existing) {
      const retryJob = { ...pending, status: "pending", lastError: "", lastAttemptAt: Date.now(), sourcePrompt: pending.sourcePrompt || pending.prompt, sessionNonce: crypto.randomUUID() };
      const fresh = await startFreshChatJob(retryJob, { activate: true, closePreviousManaged: true });
      const stored = await chrome.storage.local.get("pendingChatJob");
      await chrome.storage.local.set({
        pendingChatJob: stored.pendingChatJob?.jobId === retryJob.jobId ? { ...stored.pendingChatJob, chatTabId: fresh.tabId, chatUrl: fresh.url || "", lastAttemptAt: Date.now() } : stored.pendingChatJob,
        batchRun: { ...latest.batchRun, chatTabId: fresh.tabId, jobStartedAt: Date.now(), lastMessage: "Đã mở New chat sạch để tiếp tục mẫu batch đang dở…", updatedAt: Date.now() }
      });
    } else {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.storage.local.set({ batchRun: { ...latest.batchRun, chatTabId: existing.id, lastMessage: "Đã đưa tab ChatGPT thuộc đúng job ra trước; đang tiếp tục theo state hiện tại…", updatedAt: Date.now() } });
    }
  } else if (wasFailed && !pending) {
    await chrome.storage.local.set({ batchRun: { ...latest.batchRun, currentJobId: "", currentIndex: 0, jobStartedAt: 0, lastMessage: "Job cũ không còn dữ liệu để tiếp tục; đang tạo lại đúng vị trí batch…", updatedAt: Date.now() } });
    await startNextBatchJob();
  } else {
    await chrome.storage.local.set({ batchRun: { ...latest.batchRun, status: "failed", lastError: "Không còn state ChatGPT khớp job batch", lastMessage: "Không tìm thấy state/tab thuộc đúng Job ID. Batch đã dừng an toàn để tránh chiếm nhầm chat cá nhân.", updatedAt: Date.now() } });
  }
  return { resumed: true };
}

async function stopBatch() {
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (!batchRun) return { stopped: false };
  await chrome.storage.local.set({ batchRun: { ...batchRun, status: "stopped", currentJobId: "", jobStartedAt: 0, lastMessage: `Đã dừng. Giữ lại ${batchRun.completedCount || 0} mẫu đã lưu.`, updatedAt: Date.now() } });
  await chrome.storage.local.remove(["pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing", "chatStatus"]);
  await chrome.alarms.clear("merch-flow-batch-watch");
  return { stopped: true };
}

async function checkBatchWatchdog() {
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (!batchRun || batchRun.status !== "running" || !batchRun.currentJobId || !batchRun.jobStartedAt) return;
  const age = Date.now() - Number(batchRun.jobStartedAt || 0);
  if (age < BATCH_JOB_TTL) return;
  await chrome.storage.local.set({
    batchRun: {
      ...batchRun,
      status: "failed",
      lastError: "Job ChatGPT quá 30 phút chưa hoàn tất",
      lastMessage: `Mẫu ${batchRun.currentIndex || "?"}/${batchRun.targetCount || "?"} quá 30 phút chưa xong. Bấm Tiếp tục để tạo lại vị trí này.`,
      updatedAt: Date.now()
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "merch-flow-batch-watch") checkBatchWatchdog().catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(["batchRun", "merchFlowChatTabId", AMAZON_RUNTIME_STORAGE_KEY]).then((data) => {
    const update = {};
    if (Number(data.merchFlowChatTabId || 0) === Number(tabId)) update.merchFlowChatTabId = 0;
    const runtimes = data[AMAZON_RUNTIME_STORAGE_KEY] && typeof data[AMAZON_RUNTIME_STORAGE_KEY] === "object" ? { ...data[AMAZON_RUNTIME_STORAGE_KEY] } : {};
    if (runtimes[String(tabId)]) {
      delete runtimes[String(tabId)];
      update[AMAZON_RUNTIME_STORAGE_KEY] = runtimes;
    }
    const batchRun = data.batchRun;
    if (batchRun && Number(batchRun.chatTabId || 0) === Number(tabId) && ["running", "paused"].includes(batchRun.status)) {
      update.batchRun = { ...batchRun, status: "failed", lastError: "Tab ChatGPT batch đã bị đóng", lastMessage: "Tab ChatGPT dùng cho batch đã bị đóng. Bấm Tiếp tục để chạy lại mẫu hiện tại trong New chat sạch.", updatedAt: Date.now() };
    }
    if (Object.keys(update).length) chrome.storage.local.set(update);
  }).catch(() => {});
});

async function guardFreshConversationRoute(tabId, changedUrl) {
  if (!changedUrl || !isConversationUrl(changedUrl) || freshRouteRepairBusy.has(tabId)) return;
  freshRouteRepairBusy.add(tabId);
  try {
    const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
    const job = pendingChatJob;
    if (!job?.freshConversationRequired || Number(job.chatTabId || 0) !== Number(tabId)) return;
    if (!["pending", "running"].includes(job.status)) return;

    // A /c/... route is legitimate only after the content script has proved a
    // clean composer and armed the exact Send click. Even while armed, a route
    // that existed before this job is always stale and must never be reused.
    const changedConversation = conversationPath(changedUrl);
    const knownStaleConversation = (job.staleConversationKeys || []).includes(changedConversation);
    const armedAge = Date.now() - Number(job.freshSendArmedAt || 0);
    if (!knownStaleConversation && job.freshSendArmedAt && armedAge >= 0 && armedAge < 15000) return;

    // Create image can allocate a brand-new empty /c/... route before Send.
    // Accept exactly an unknown route during the short content-armed transition;
    // the content script still requires zero messages and a stable dwell before Send.
    const transitionAge = Date.now() - Number(job.freshRouteTransitionArmedAt || 0);
    if (!knownStaleConversation && job.freshRouteTransitionArmedAt && transitionAge >= 0 && transitionAge < 30000) {
      await chrome.storage.local.set({
        pendingChatJob: {
          ...job,
          freshCandidateConversationKey: changedConversation,
          freshCandidateSeenAt: Date.now(),
          lastAttemptAt: Date.now()
        }
      });
      return;
    }

    // In some ChatGPT profiles the Create image menu restores the last image
    // conversation instead of enabling the tool on the empty composer. Once we
    // prove that the restored /c/... is in this job's deny-list, return to root
    // and let the content script use its guarded compact image-request fallback.
    // Retrying the same menu click only creates a root -> old chat loop.
    const createImageRestoreBlocked = Boolean(
      knownStaleConversation
      && job.freshRouteTransitionArmedAt
      && transitionAge >= 0
      && transitionAge < 30000
    );

    const repairCount = Math.max(0, Number(job.freshRouteRepairCount || 0)) + 1;
    const staleConversationKeys = [...new Set([
      ...(Array.isArray(job.staleConversationKeys) ? job.staleConversationKeys : []),
      changedConversation
    ].filter(Boolean))];
    if (repairCount > 5) {
      await chrome.storage.local.set({
        pendingChatJob: {
          ...job,
          status: "failed",
          lastError: "ChatGPT liên tục khôi phục chat cũ; đã chặn Send",
          lastAttemptAt: Date.now(),
          freshRouteRepairCount: repairCount,
          staleConversationKeys
        }
      });
      return;
    }

    const next = {
      ...job,
      status: "running",
      lastError: "",
      lastAttemptAt: Date.now(),
      freshRouteRepairCount: repairCount,
      staleConversationKeys,
      freshRouteTransitionArmedAt: 0,
      freshCandidateConversationKey: "",
      freshCandidateSeenAt: 0,
      createImageModeBypass: Boolean(job.createImageModeBypass || createImageRestoreBlocked),
      freshSendArmedAt: 0
    };
    await chrome.storage.local.set({
      pendingChatJob: next,
      chatStatus: {
        message: createImageRestoreBlocked
          ? "AUTO: menu Create image kéo vào chat cũ; đang về New chat sạch và chuyển sang text-to-image an toàn…"
          : `AUTO: ChatGPT tự mở chat cũ; background đang kéo về New chat sạch (${repairCount}/5)…`,
        tone: "warning",
        jobId: job.jobId,
        updatedAt: Date.now()
      }
    });
    await chrome.tabs.update(tabId, { url: freshJobUrl(next, repairCount), active: true });
  } finally {
    freshRouteRepairBusy.delete(tabId);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  guardFreshConversationRoute(tabId, String(changeInfo?.url || "")).catch(() => {});
});

// ChatGPT changes conversations through the History API. tabs.onUpdated is not
// guaranteed to report every SPA transition, so guard both committed loads and
// pushState/replaceState navigations for the exact job-owned top-level tab.
if (chrome.webNavigation?.onCommitted && chrome.webNavigation?.onHistoryStateUpdated) {
  const guardWebNavigation = (details) => {
    if (Number(details?.frameId || 0) !== 0) return;
    guardFreshConversationRoute(details.tabId, String(details.url || "")).catch(() => {});
  };
  chrome.webNavigation.onCommitted.addListener(guardWebNavigation);
  chrome.webNavigation.onHistoryStateUpdated.addListener(guardWebNavigation);
}

enablePinnedPanel().catch(console.error);
chrome.runtime.onInstalled.addListener(async (details) => {
  await enablePinnedPanel().catch(console.error);
  const vaultState = await chrome.storage.local.get("savedDesigns");
  await ensureVaultMetadata(vaultState.savedDesigns).catch(console.error);
  if (details?.reason !== "update") return;

  const data = await chrome.storage.local.get(["merchFlowChatTabId", "pendingChatJob", "lastSentChatJob", "batchRun", AMAZON_RUNTIME_STORAGE_KEY, "pendingUpload", "autoRun"]);
  const managedChatIds = [data.merchFlowChatTabId, data.pendingChatJob?.chatTabId, data.lastSentChatJob?.chatTabId, data.batchRun?.chatTabId].map(Number).filter(Boolean);
  const activeMerchJob = Boolean(data.pendingUpload?.jobId || data.autoRun?.jobId);
  const runtimeIds = activeMerchJob ? Object.values(data[AMAZON_RUNTIME_STORAGE_KEY] || {}).map((runtime) => Number(runtime?.tabId || 0)).filter(Boolean) : [];
  const reloadIds = new Set([...managedChatIds, ...runtimeIds]);
  await Promise.allSettled([...reloadIds].map(async (tabId) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isChatUrl(tab.url || "") || /^https:\/\/merch\.amazon\.com\//i.test(tab.url || "")) await chrome.tabs.reload(tabId);
    } catch (_) { /* managed tab already closed */ }
  }));
});
chrome.runtime.onStartup.addListener(async () => {
  await enablePinnedPanel().catch(console.error);
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (batchRun?.status === "running") {
    await chrome.storage.local.set({
      batchRun: {
        ...batchRun,
        status: "paused",
        lastMessage: batchRun.currentJobId
          ? "Chrome vừa mở lại. Batch được tạm dừng; job hiện tại có thể hoàn tất nhưng extension sẽ không tự mở ChatGPT tiếp."
          : "Chrome vừa mở lại. Batch đang tạm dừng; bấm Tiếp tục khi muốn chạy ChatGPT.",
        updatedAt: Date.now()
      }
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.chatArtwork || changes.lastListing) finalizeCurrentBatchDesign();
  if (changes.batchRun?.newValue?.status === "running" && !changes.batchRun.newValue.currentJobId) startNextBatchJob();
  if (changes.pendingChatJob?.newValue?.status === "failed") {
    chrome.storage.local.get("batchRun").then(({ batchRun }) => {
      if (batchRun?.status === "running" && batchRun.currentJobId === changes.pendingChatJob.newValue.jobId) {
        chrome.storage.local.set({ batchRun: { ...batchRun, status: "failed", lastMessage: `ChatGPT dừng ở mẫu ${batchRun.currentIndex || "?"}: ${changes.pendingChatJob.newValue.lastError || "không gửi được prompt"}`, lastError: changes.pendingChatJob.newValue.lastError || "", updatedAt: Date.now() } });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MERCH_FLOW_REGISTER_MERCH_TAB_V1") {
    registerMerchAmazonRuntime(sender?.tab?.id, message)
      .then(sendResponse)
      .catch((error) => sendResponse({ registered: false, reloading: false, error: error.message || "Không đăng ký được runtime Amazon" }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_CANCEL_JOB_V1") {
    cancelAutoJob(String(message.jobId || ""), String(message.cancelToken || ""))
      .then(sendResponse)
      .catch((error) => sendResponse({ cancelled: false, error: error.message || "Không hủy được AUTO" }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_START_FRESH_CHAT_V1") {
    startFreshChatJob(message.job || {}, {
      activate: message.activate !== false,
      closePreviousManaged: message.closePreviousManaged !== false
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ opened: false, error: error.message || "Không mở được phiên ChatGPT sạch" }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_REGISTER_CHAT_TAB_V1") {
    const tabId = sender?.tab?.id;
    chrome.storage.local.get(["merchFlowChatTabId", "lastSentChatJob", "pendingChatJob", "batchRun"]).then((data) => {
      const known = [data.merchFlowChatTabId, data.lastSentChatJob?.chatTabId, data.pendingChatJob?.chatTabId, data.batchRun?.chatTabId].map(Number).filter(Boolean);
      const conversationKey = data.lastSentChatJob?.conversationKey || "";
      const sameConversation = Boolean(conversationKey && message.conversationKey === conversationKey);
      if (tabId && isChatUrl(sender.tab?.url || "") && (known.includes(Number(tabId)) || sameConversation)) {
        const matchedJob = [data.pendingChatJob, data.lastSentChatJob]
          .find((job) => job?.jobId && Number(job.chatTabId || 0) === Number(tabId))
          || (sameConversation ? data.lastSentChatJob : null);
        return chrome.storage.local.set({ merchFlowChatTabId: tabId }).then(() => sendResponse({
          registered: true,
          tabId,
          jobId: String(matchedJob?.jobId || ""),
          sessionNonce: String(matchedJob?.sessionNonce || message.sessionNonce || "")
        }));
      }
      sendResponse({ registered: false });
    }).catch((error) => sendResponse({ registered: false, error: error.message }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_FETCH_IMAGE_V1") {
    fetchAndStoreArtwork(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ stored: false, error: error.message || "Không tải được artwork" }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_BATCH_START_V1") {
    startBatch(message).then(sendResponse).catch((error) => sendResponse({ started: false, error: error.message }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_BATCH_PAUSE_V1") {
    pauseBatch().then(sendResponse).catch((error) => sendResponse({ paused: false, error: error.message }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_BATCH_RESUME_V1") {
    resumeBatch().then(sendResponse).catch((error) => sendResponse({ resumed: false, error: error.message }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_BATCH_STOP_V1") {
    stopBatch().then(sendResponse).catch((error) => sendResponse({ stopped: false, error: error.message }));
    return true;
  }
  if (message?.type === "MERCH_FLOW_BATCH_NUDGE_V1") {
    finalizeCurrentBatchDesign().then(() => startNextBatchJob()).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
