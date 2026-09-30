const Core = globalThis.MerchFlowCore;
const DEFAULT_BOOK_PROFILE = Core.DEFAULT_BOOK_LOVER_PROFILE;
const TARGETS = {
  tshirt: { label: "T-shirt / Premium", width: 4500, height: 5400 },
  hoodie: { label: "Hoodie", width: 4500, height: 4050 },
  popsocket: { label: "PopSocket", width: 4167, height: 4167 }
};
const MAX_BYTES = 25 * 1024 * 1024;
const CHAT_JOB_TTL = 15 * 60 * 1000;
const UPLOAD_TTL = 30 * 60 * 1000;
const ARTWORK_TTL = 24 * 60 * 60 * 1000;
const AUTO_STALE_MS = 7 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const state = {
  sourceFile: null,
  processedBlob: null,
  processedName: "",
  processedStorageKey: "",
  processedAnalysis: null,
  referenceDataUrl: "",
  referenceName: "",
  listing: null,
  processingId: 0,
  reprocessTimer: null,
  promptJobId: "",
  sourceJobId: "",
  sourceStorageKey: "",
  sourceArtworkRevision: 0,
  sourceSessionNonce: "",
  sourceArtworkMessageIndex: -1,
  sourceKind: "",
  autoSource: false,
  autoFinalizeArtwork: false,
  finalArtwork: null,
  manualArtworkOverride: false,
  listingDirty: false,
  autoUploadKey: "",
  autoFlowBusy: false,
  oneClickBusy: false,
  vaultBusy: false,
  creativeMemory: []
};

function setStatus(id, message, tone = "") {
  const node = $(id);
  node.textContent = message;
  node.dataset.tone = tone;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function isFresh(item, ttl) {
  return Boolean(item?.createdAt && Date.now() - item.createdAt < ttl);
}

function collectListing() {
  return {
    title: $("listing-title").value.trim(),
    brand: $("listing-brand").value.trim(),
    bullet1: $("listing-bullet1").value.trim(),
    bullet2: $("listing-bullet2").value.trim(),
    description: $("listing-description").value.trim()
  };
}

function validateListingFields(listing) {
  const errors = [];
  if (!listing?.title?.trim()) errors.push("Title");
  if ((listing?.title || "").length > 60) errors.push("Title > 60 ký tự");
  for (const [key, label] of [["brand", "Brand"], ["bullet1", "Bullet 1"], ["bullet2", "Bullet 2"], ["description", "Description"]]) {
    if (!listing?.[key]?.trim()) errors.push(label);
  }
  return { valid: errors.length === 0, errors };
}

function isCompleteListing(listing) {
  return Boolean(listing && typeof listing.jobId === "string" && listing.jobId.trim() && validateListingFields(listing).valid);
}

function isChatGPTListing(listing) {
  if (!listing) return false;
  const source = String(listing.source || "").toLowerCase();
  // Legacy AI captures had no source tag. Treat unknown provenance as AI/untrusted;
  // only explicit user-authored sources may be rebound to another artwork.
  return !["manual", "pasted_json", "vault"].includes(source);
}

function currentArtworkBinding() {
  const artwork = state.finalArtwork || null;
  return {
    jobId: String(artwork?.jobId || state.sourceJobId || ""),
    artworkStorageKey: String(artwork?.sourceStorageKey || state.sourceStorageKey || ""),
    artworkRevision: Number(artwork?.artworkRevision ?? state.sourceArtworkRevision ?? 0),
    sessionNonce: String(artwork?.sessionNonce || state.sourceSessionNonce || ""),
    artworkMessageIndex: Number(artwork?.artworkMessageIndex ?? state.sourceArtworkMessageIndex ?? -1)
  };
}

function listingMatchesArtworkBinding(listing, binding = currentArtworkBinding()) {
  if (!isCompleteListing(listing) || !binding.jobId || listing.jobId !== binding.jobId) return false;
  if (!isChatGPTListing(listing)) return true;
  if (!binding.artworkStorageKey || !binding.sessionNonce) return false;
  return listing.artworkStorageKey === binding.artworkStorageKey
    && listing.sessionNonce === binding.sessionNonce
    && Number(listing.artworkRevision || 0) === Number(binding.artworkRevision || 0)
    && Number(listing.messageIndex ?? -1) > Number(binding.artworkMessageIndex ?? -1);
}

function updateListingTitleCount() {
  const length = $("listing-title").value.length;
  $("listing-title-count").textContent = `${length} / 60`;
  $("listing-title-count").style.color = length > 60 ? "var(--danger)" : "";
}

function updateFinalActionState() {
  const finalizedCurrent = Boolean(state.finalArtwork && state.processedStorageKey && state.finalArtwork.storageKey === state.processedStorageKey);
  $("finalize-artwork").disabled = !state.processedBlob || state.processedBlob.size > MAX_BYTES || finalizedCurrent;
  $("upload-merch").disabled = !finalizedCurrent || !state.processedBlob || state.processedBlob.size > MAX_BYTES;
  $("save-final-design").disabled = !(finalizedCurrent && validateListingFields(collectListing()).valid);
  $("artwork-source").dataset.final = finalizedCurrent ? "true" : "false";
}

function applyListing(listing, source = "ChatGPT", expectedJobId = "", expectedBinding = null) {
  if (!isCompleteListing(listing)) return false;
  const requiredJobId = String(expectedJobId || "").trim();
  if (requiredJobId && listing.jobId !== requiredJobId) return false;
  if (expectedBinding && isChatGPTListing(listing) && !listingMatchesArtworkBinding(listing, expectedBinding)) return false;
  state.listing = listing;
  state.listingDirty = false;
  $("listing-title").value = listing.title;
  $("listing-brand").value = listing.brand;
  $("listing-bullet1").value = listing.bullet1;
  $("listing-bullet2").value = listing.bullet2;
  $("listing-description").value = listing.description;
  $("listing-source").textContent = `Listing cuối: ${source}`;
  updateListingTitleCount();
  updateFinalActionState();
  return true;
}

function clearListingForm(message = "Đang chờ listing đúng Job ID") {
  state.listing = null;
  state.listingDirty = false;
  $("listing-title").value = "";
  $("listing-brand").value = "";
  $("listing-bullet1").value = "";
  $("listing-bullet2").value = "";
  $("listing-description").value = "";
  $("listing-source").textContent = message;
  updateListingTitleCount();
  updateFinalActionState();
}

async function resolveCurrentJobId({ create = true } = {}) {
  const data = await chrome.storage.local.get(["pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing", "finalListing", "processedArtwork", "finalArtwork", "autoRun"]);
  const jobId = state.sourceJobId || state.listing?.jobId || data.finalArtwork?.jobId || data.processedArtwork?.jobId || data.chatArtwork?.jobId || data.lastListing?.jobId || data.lastSentChatJob?.jobId || data.pendingChatJob?.jobId || data.autoRun?.jobId || state.promptJobId || "";
  if (jobId || !create) return jobId;
  state.promptJobId = crypto.randomUUID();
  return state.promptJobId;
}

async function saveFinalListing(source = "manual") {
  const fields = collectListing();
  const validation = validateListingFields(fields);
  if (!validation.valid) {
    setStatus("image-status", `Listing chưa đủ: ${validation.errors.join(", ")}.`, "error");
    return null;
  }
  const jobId = state.sourceJobId || await resolveCurrentJobId();
  const binding = currentArtworkBinding();
  const listing = {
    ...fields,
    jobId,
    source,
    finalSelected: true,
    artworkStorageKey: binding.artworkStorageKey,
    artworkRevision: binding.artworkRevision,
    sessionNonce: binding.sessionNonce,
    artworkMessageIndex: binding.artworkMessageIndex,
    updatedAt: Date.now()
  };
  state.listing = listing;
  state.listingDirty = false;
  await chrome.storage.local.set({ lastListing: listing, finalListing: listing });
  $("listing-source").textContent = source === "pasted_json" ? "Listing cuối: JSON thủ công" : "Listing cuối: nhập tay";
  updateFinalActionState();
  setStatus("image-status", "Đã lưu listing cuối. Có thể tiếp tục dù ChatGPT listing bị lỗi.", "success");
  return listing;
}

function parseManualListingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("JSON đang trống");
  const candidates = [raw];
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.unshift(match[1].trim());
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  let parsed = null;
  for (const candidate of candidates) {
    try { parsed = JSON.parse(candidate); break; } catch (_) {}
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Không parse được JSON");
  return {
    title: String(parsed.title || "").trim(),
    brand: String(parsed.brand || "").trim(),
    bullet1: String(parsed.bullet1 || "").trim(),
    bullet2: String(parsed.bullet2 || "").trim(),
    description: String(parsed.description || "").trim()
  };
}

async function applyManualListingJson(text = $("listing-raw-json").value) {
  try {
    const fields = parseManualListingJson(text);
    $("listing-title").value = fields.title;
    $("listing-brand").value = fields.brand;
    $("listing-bullet1").value = fields.bullet1;
    $("listing-bullet2").value = fields.bullet2;
    $("listing-description").value = fields.description;
    state.listingDirty = true;
    updateListingTitleCount();
    return await saveFinalListing("pasted_json");
  } catch (error) {
    setStatus("image-status", `JSON không hợp lệ: ${error.message}`, "error");
    return null;
  }
}

function setFlowStep(id, status) {
  const node = $(id);
  if (!node) return;
  node.classList.toggle("is-done", status === "done");
  node.classList.toggle("is-active", status === "active");
}

async function updateFlowUI() {
  const data = await chrome.storage.local.get([
    "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing", "finalListing",
    "processedArtwork", "finalArtwork", "pendingUpload", "merchStatus", "autoRun", "batchRun", "flowCancel"
  ]);
  const jobId = data.lastSentChatJob?.jobId
    || data.pendingChatJob?.jobId
    || data.chatArtwork?.jobId
    || data.lastListing?.jobId
    || data.finalArtwork?.jobId
    || data.processedArtwork?.jobId
    || data.pendingUpload?.jobId
    || data.autoRun?.jobId
    || data.batchRun?.currentJobId
    || "";
  $("flow-job").textContent = jobId ? `Job ${jobId.slice(0, 8)}…` : "Chưa có job";
  const autoButton = $("auto-book-flow");
  const batchActive = Boolean(data.batchRun && ["running", "paused", "failed"].includes(data.batchRun.status));
  const autoRunning = Boolean(data.autoRun?.jobId && !["review", "failed", "cancelled", "completed", "manual-override"].includes(data.autoRun?.status));
  const autoStale = Boolean(autoRunning && data.autoRun?.updatedAt && Date.now() - Number(data.autoRun.updatedAt) > AUTO_STALE_MS);
  const cancelButton = $("cancel-auto-flow");
  if (autoButton) {
    autoButton.disabled = state.oneClickBusy || autoRunning || batchActive;
    autoButton.dataset.running = autoRunning ? "true" : "false";
    autoButton.innerHTML = autoRunning ? 'AUTO đang chạy…' : 'Chạy AUTO 1 click <span>↗</span>';
  }
  if (cancelButton) {
    cancelButton.hidden = !autoRunning;
    cancelButton.disabled = false;
    cancelButton.textContent = autoStale ? "Hủy AUTO · đang kẹt" : "Hủy AUTO";
  }
  $("resume-flow").disabled = batchActive;
  $("regenerate-flow").disabled = batchActive;
  $("send-chatgpt").disabled = batchActive;
  if (batchActive) $("upload-merch").disabled = true;
  else updateFinalActionState();

  const manualFinalArtwork = Boolean(data.finalArtwork?.jobId === jobId && data.finalArtwork?.dataUrl && data.finalArtwork?.source !== "chatgpt");
  const promptDone = Boolean(data.lastSentChatJob?.jobId === jobId || manualFinalArtwork);
  const artworkDone = Boolean(
    (data.finalArtwork?.jobId === jobId && data.finalArtwork?.dataUrl)
    || (data.chatArtwork?.jobId === jobId && data.chatArtwork?.dataUrl)
  );
  const effectiveArtwork = data.finalArtwork?.jobId === jobId ? data.finalArtwork : data.processedArtwork?.jobId === jobId ? data.processedArtwork : data.chatArtwork?.jobId === jobId ? data.chatArtwork : null;
  const effectiveBinding = {
    jobId,
    artworkStorageKey: String(effectiveArtwork?.sourceStorageKey || effectiveArtwork?.storageKey || ""),
    artworkRevision: Number(effectiveArtwork?.artworkRevision || 0),
    sessionNonce: String(effectiveArtwork?.sessionNonce || ""),
    artworkMessageIndex: Number(effectiveArtwork?.artworkMessageIndex ?? -1)
  };
  const effectiveListing = data.finalListing?.jobId === jobId && isCompleteListing(data.finalListing) ? data.finalListing : data.lastListing;
  const listingDone = Boolean(effectiveListing?.jobId === jobId && isCompleteListing(effectiveListing)
    && (!isChatGPTListing(effectiveListing) || listingMatchesArtworkBinding(effectiveListing, effectiveBinding)));
  const merchStarted = Boolean(data.pendingUpload?.jobId === jobId || data.merchStatus?.jobId === jobId);
  const merchDone = Boolean(data.merchStatus?.jobId === jobId && data.merchStatus?.tone === "success" && /5\/5|điền đủ|đã chèn artwork/i.test(data.merchStatus.message || ""));

  const states = [promptDone, artworkDone, listingDone, merchDone];
  const firstIncomplete = states.findIndex((done) => !done);
  setFlowStep("flow-step-prompt", promptDone ? "done" : "active");
  setFlowStep("flow-step-artwork", artworkDone ? "done" : firstIncomplete === 1 ? "active" : "");
  setFlowStep("flow-step-listing", listingDone ? "done" : firstIncomplete === 2 ? "active" : "");
  setFlowStep("flow-step-merch", merchDone ? "done" : (merchStarted || firstIncomplete === 3) ? "active" : "");

  let message = "Mặc định ngách book lovers. Bấm “Chạy AUTO 1 click” để tạo ảnh, chuẩn hoá PNG và điền listing.";
  if (batchActive) message = data.batchRun.lastMessage || `Batch ${data.batchRun.completedCount || 0}/${data.batchRun.targetCount || 0} đang chạy; không mở Amazon Merch.`;
  let tone = "";
  if (!batchActive && jobId && !promptDone) message = "Job đã tạo nhưng prompt chưa gửi. Bấm “Tiếp tục job hiện tại”.";
  else if (!batchActive && promptDone && !artworkDone) message = "Đang chờ ChatGPT tạo artwork. Xong ảnh, extension sẽ tự chuyển sang Xử lý ảnh.";
  else if (!batchActive && artworkDone && !listingDone) message = "Artwork đã có. Extension đang tự xin listing JSON đúng Job ID.";
  else if (!batchActive && artworkDone && listingDone && !data.processedArtwork?.dataUrl) message = "Artwork + listing đã đủ. Đang chuẩn hoá PNG 4500 × 5400.";
  else if (!batchActive && data.pendingUpload) message = data.merchStatus?.message || "Đang tiếp tục job trên Amazon Merch.";
  else if (!batchActive && manualFinalArtwork && listingDone && data.processedArtwork?.dataUrl && !merchDone && !data.pendingUpload) {
    message = "Ảnh + listing đã chốt thủ công. Có thể Lưu vào Kho mẫu hoặc bấm Điền artwork + listing.";
    tone = "success";
  } else if (!batchActive && artworkDone && listingDone && data.processedArtwork?.dataUrl && !merchDone) {
    message = data.merchStatus?.message || "Đã sẵn sàng. Extension đang mở Amazon Merch và chèn artwork.";
    tone = "success";
  }
  if (autoStale && !merchDone) {
    message = "AUTO không cập nhật tiến độ hơn 7 phút. Có thể đang kẹt — bấm Hủy AUTO để dừng và reset sạch job hiện tại.";
    tone = "error";
  } else if (merchDone) {
    message = data.merchStatus?.message || "Ảnh + listing đã sẵn sàng. Anh chọn sản phẩm/màu, review rồi bấm Publish thủ công.";
    tone = "success";
  } else if (data.autoRun?.jobId === jobId && data.autoRun?.lastMessage) {
    message = data.autoRun.lastMessage;
    tone = data.autoRun.status === "failed" ? "error" : "";
  } else if (data.merchStatus?.tone === "error") {
    message = data.merchStatus.message;
    tone = "error";
  }
  $("flow-next").textContent = message;
  $("flow-next").dataset.tone = tone;
}

async function setSourceFile(file, metadata = {}) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("image-status", "Chọn file ảnh PNG, JPG hoặc WEBP.", "error");
    return;
  }
  state.processingId += 1;
  clearTimeout(state.reprocessTimer);
  state.sourceFile = file;
  state.processedBlob = null;
  state.processedName = "";
  state.processedStorageKey = "";
  state.processedAnalysis = null;
  state.sourceJobId = metadata.jobId || "";
  state.sourceStorageKey = metadata.storageKey || "";
  state.sourceArtworkRevision = Number(metadata.artworkRevision || 0);
  state.sourceSessionNonce = String(metadata.sessionNonce || "");
  state.sourceArtworkMessageIndex = Number(metadata.artworkMessageIndex ?? -1);
  state.sourceKind = metadata.source || (metadata.autoSource ? "chatgpt" : "manual-upload");
  state.autoSource = Boolean(metadata.autoSource);
  state.autoFinalizeArtwork = Boolean(metadata.autoFinalize);
  state.finalArtwork = null;
  state.manualArtworkOverride = Boolean(metadata.manualOverride);
  state.autoUploadKey = "";
  $("file-meta").classList.remove("is-hidden");
  $("file-name").textContent = file.name;
  $("file-size").textContent = `${formatBytes(file.size)} · ${file.type}`;
  $("process-image").disabled = false;
  $("download-image").disabled = true;
  $("upload-merch").disabled = true;
  $("preview-wrap").classList.add("is-hidden");
  await chrome.storage.local.remove(["processedArtwork", "finalArtwork", "pendingUpload"]);
  $("artwork-source").textContent = state.sourceKind === "chatgpt" ? "Nguồn: ChatGPT · chưa chốt" : state.sourceKind === "clipboard" ? "Nguồn: clipboard · chưa chốt" : state.sourceKind === "vault" ? "Nguồn: Kho mẫu · chưa chốt" : "Nguồn: upload thủ công · chưa chốt";
  updateFinalActionState();
  setStatus("image-status", "Sẵn sàng chuẩn hoá. Sau khi xử lý, bấm Chốt ảnh này để dùng làm artwork cuối.");
}

function clearFile() {
  state.processingId += 1;
  clearTimeout(state.reprocessTimer);
  state.sourceFile = null;
  state.processedBlob = null;
  state.processedName = "";
  state.processedStorageKey = "";
  state.processedAnalysis = null;
  state.sourceJobId = "";
  state.sourceStorageKey = "";
  state.sourceArtworkRevision = 0;
  state.sourceSessionNonce = "";
  state.sourceArtworkMessageIndex = -1;
  state.sourceKind = "";
  state.autoSource = false;
  state.autoFinalizeArtwork = false;
  state.finalArtwork = null;
  state.manualArtworkOverride = false;
  state.autoUploadKey = "";
  $("file-input").value = "";
  $("file-meta").classList.add("is-hidden");
  $("preview-wrap").classList.add("is-hidden");
  $("process-image").disabled = true;
  $("download-image").disabled = true;
  $("upload-merch").disabled = true;
  chrome.storage.local.remove(["processedArtwork", "finalArtwork", "pendingUpload"]);
  $("artwork-source").textContent = "Chưa chọn artwork cuối";
  updateFinalActionState();
  setStatus("image-status", "Đã xoá artwork và upload job liên quan.");
}

async function setManualSourceFile(file, source = "manual-upload") {
  if (!file?.type?.startsWith("image/")) {
    setStatus("image-status", "Clipboard/file không chứa ảnh hợp lệ.", "error");
    return false;
  }
  // Manual replacement of the currently loaded artwork keeps that job. A brand-new
  // manual artwork gets a fresh job ID instead of inheriting lastListing/finalListing
  // from some older ChatGPT run.
  const existingJobId = String(state.sourceJobId || state.finalArtwork?.jobId || "").trim();
  const jobId = existingJobId || crypto.randomUUID();
  if (state.listing && (state.listing.jobId !== jobId || isChatGPTListing(state.listing) || state.sourceKind === "vault")) {
    clearListingForm(existingJobId ? "Artwork đã thay thủ công · listing ChatGPT cũ bị bỏ để tránh lệch revision" : "Artwork thủ công mới · cần listing đúng Job ID mới");
    await chrome.storage.local.remove(["lastListing", "finalListing"]);
  }
  await setSourceFile(file, { jobId, storageKey: `${source}:${crypto.randomUUID()}`, artworkRevision: Date.now(), sessionNonce: "", artworkMessageIndex: -1, source, autoSource: false, autoFinalize: false, manualOverride: true });
  const { autoRun } = await chrome.storage.local.get("autoRun");
  if (autoRun?.jobId === jobId && !["review", "failed", "cancelled", "completed"].includes(autoRun.status)) {
    await chrome.storage.local.set({ autoRun: { ...autoRun, status: "manual-override", lastMessage: "Đang dùng artwork thủ công; phản hồi AI đến muộn sẽ không ghi đè bản cuối.", updatedAt: Date.now() } });
  }
  return true;
}

async function pasteImageFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((value) => value.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      const ext = type.includes("jpeg") ? "jpg" : type.split("/")[1] || "png";
      const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type, lastModified: Date.now() });
      await setManualSourceFile(file, "clipboard");
      setStatus("image-status", "Đã lấy ảnh từ clipboard. Bấm Chuẩn hoá ảnh rồi Chốt ảnh này.", "success");
      return true;
    }
    throw new Error("Clipboard không có ảnh");
  } catch (error) {
    setStatus("image-status", `Không dán được ảnh: ${error.message}. Có thể Ctrl+V trực tiếp trong side panel.`, "error");
    return false;
  }
}

function isNearWhite(data, index) {
  const red = data[index], green = data[index + 1], blue = data[index + 2], alpha = data[index + 3];
  const min = Math.min(red, green, blue);
  return alpha > 0 && min > 242 && Math.max(red, green, blue) - min < 10;
}

function edgeLuminance(data, width, height) {
  let total = 0;
  let count = 0;
  const sample = (x, y) => {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3] / 255;
    if (alpha < 0.15) return;
    const lum = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    total += lum;
    count += 1;
  };
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 80));
  for (let x = 0; x < width; x += stepX) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { sample(0, y); sample(width - 1, y); }
  return count ? total / count : null;
}

function enforceWinnerWhiteOnly(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  let opaquePixels = 0;
  let opaqueLuminanceTotal = 0;
  const pixelCount = canvas.width * canvas.height;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 245) continue;
    opaquePixels += 1;
    opaqueLuminanceTotal += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }
  const opaqueCoverage = opaquePixels / Math.max(1, pixelCount);

  if (opaqueCoverage < 0.55) {
    // Mostly-transparent generated PNG: all visible pixels are treated as design and
    // recolored pure white. This removes unwanted black outlines/fringes as well.
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] <= 2) continue;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
    }
  } else {
    // Filled render (including a black rectangle with transparent outer margins): infer
    // the dominant background and extract only the contrasting foreground into alpha.
    const edgeLum = edgeLuminance(data, canvas.width, canvas.height);
    const opaqueAverageLum = opaquePixels ? opaqueLuminanceTotal / opaquePixels : 127.5;
    const backgroundLum = Number.isFinite(edgeLum) ? edgeLum : opaqueAverageLum;
    const darkBackground = backgroundLum < 128;
    for (let index = 0; index < data.length; index += 4) {
      const lum = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      const contrast = darkBackground ? lum - backgroundLum : backgroundLum - lum;
      const strength = Math.max(0, Math.min(1, (contrast - 18) / 105));
      const sourceAlpha = data[index + 3] / 255;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(255 * sourceAlpha * strength);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function removeWhiteConnectedToEdges(canvas) {
  const pixelCount = canvas.width * canvas.height;
  if (pixelCount > 8_000_000) throw new Error("Ảnh nguồn quá lớn để xoá nền an toàn; hãy tắt tuỳ chọn này hoặc dùng ảnh nhỏ hơn 8 MP.");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const position = y * canvas.width + x;
    if (visited[position] || !isNearWhite(data, position * 4)) return;
    visited[position] = 1;
    queue[tail++] = position;
  };
  for (let x = 0; x < canvas.width; x += 1) { enqueue(x, 0); enqueue(x, canvas.height - 1); }
  for (let y = 1; y < canvas.height - 1; y += 1) { enqueue(0, y); enqueue(canvas.width - 1, y); }
  while (head < tail) {
    const position = queue[head++];
    data[position * 4 + 3] = 0;
    const x = position % canvas.width;
    const y = Math.floor(position / canvas.width);
    enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
  }
  ctx.putImageData(image, 0, 0);
}

function findOpaqueBounds(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 8) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  }
  return right >= left && bottom >= top ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

function renderProcessedPreview(blob, target) {
  const previewUrl = URL.createObjectURL(blob);
  const previewImage = new Image();
  previewImage.onload = () => {
    const canvas = $("preview-canvas");
    canvas.width = 450;
    canvas.height = Math.round(450 * target.height / target.width);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(previewUrl);
    $("preview-empty").classList.add("is-hidden");
  };
  previewImage.src = previewUrl;
  $("preview-wrap").classList.remove("is-hidden");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
}

async function processImage(processingId = ++state.processingId) {
  if (!state.sourceFile || processingId !== state.processingId) return;
  const button = $("process-image");
  button.classList.add("is-busy");
  button.textContent = "Đang xử lý";
  button.disabled = true;
  $("download-image").disabled = true;
  $("upload-merch").disabled = true;
  try {
    const target = TARGETS[$("template").value];
    const bitmap = await createImageBitmap(state.sourceFile);
    if (processingId !== state.processingId) { bitmap.close(); return; }
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;
    sourceCanvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0);
    bitmap.close();
    if ($("winner-white-only").checked) enforceWinnerWhiteOnly(sourceCanvas);
    else if ($("remove-white").checked) removeWhiteConnectedToEdges(sourceCanvas);
    const bounds = findOpaqueBounds(sourceCanvas);
    const output = document.createElement("canvas");
    output.width = target.width;
    output.height = target.height;
    const ctx = output.getContext("2d", { alpha: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const margin = Number($("safe-margin").value);
    const usableWidth = target.width * (1 - margin * 2);
    const usableHeight = target.height * (1 - margin * 2);
    const scale = $("fit-mode").value === "cover" ? Math.max(usableWidth / bounds.width, usableHeight / bounds.height) : Math.min(usableWidth / bounds.width, usableHeight / bounds.height);
    const width = bounds.width * scale;
    const height = bounds.height * scale;
    ctx.drawImage(sourceCanvas, bounds.x, bounds.y, bounds.width, bounds.height, (target.width - width) / 2, (target.height - height) / 2, width, height);
    const blob = await canvasToBlob(output);
    if (!blob) throw new Error("Không tạo được PNG.");
    if (processingId !== state.processingId) return;
    const storageKey = crypto.randomUUID();
    const name = `${state.sourceFile.name.replace(/\.[^.]+$/, "")}-${$("template").value}-${target.width}x${target.height}-${storageKey.slice(0, 8)}.png`;
    const artworkAnalysis = {
      aspectRatio: Number((bounds.width / Math.max(1, bounds.height)).toFixed(4)),
      coverage: Number(((width / target.width) * (height / target.height)).toFixed(4)),
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      opaqueWidth: bounds.width,
      opaqueHeight: bounds.height
    };
    const dataUrl = await blobToDataUrl(blob);
    const processedRecord = { storageKey, dataUrl, name, template: $("template").value, jobId: state.sourceJobId, sourceStorageKey: state.sourceStorageKey, artworkRevision: state.sourceArtworkRevision, sessionNonce: state.sourceSessionNonce, artworkMessageIndex: state.sourceArtworkMessageIndex, source: state.sourceKind || (state.autoSource ? "chatgpt" : "manual-upload"), artworkAnalysis, createdAt: Date.now() };
    const shouldFinalize = state.autoSource || state.autoFinalizeArtwork;
    const finalRecord = shouldFinalize ? { ...processedRecord, finalSelected: true, finalizedAt: Date.now() } : null;
    const storageUpdate = { processedArtwork: processedRecord };
    if (finalRecord) storageUpdate.finalArtwork = finalRecord;
    await chrome.storage.local.set(storageUpdate);
    if (processingId !== state.processingId) return;
    state.processedBlob = blob;
    state.processedName = name;
    state.processedStorageKey = storageKey;
    state.processedAnalysis = artworkAnalysis;
    state.finalArtwork = finalRecord;
    $("output-size").textContent = `${target.width} × ${target.height} px · ${formatBytes(blob.size)}`;
    renderProcessedPreview(blob, target);
    $("download-image").disabled = false;
    if (finalRecord) $("artwork-source").textContent = `Artwork cuối: ${state.sourceKind === "chatgpt" ? "ChatGPT" : state.sourceKind === "vault" ? "Kho mẫu" : "manual"}`;
    else $("artwork-source").textContent = `Đã chuẩn hoá · chưa chốt (${state.sourceKind === "clipboard" ? "clipboard" : "upload"})`;
    updateFinalActionState();
    const upscaleNote = scale > 3 ? ` Ảnh nguồn đang phóng ${scale.toFixed(1)}×; hãy kiểm tra độ nét.` : "";
    const readyMessage = finalRecord ? `Đã chuẩn hoá và chốt artwork.${upscaleNote}` : `Đã chuẩn hoá PNG.${upscaleNote} Bấm “Chốt ảnh này” nếu đây là bản đẹp nhất.`;
    setStatus("image-status", blob.size > MAX_BYTES ? `PNG ${formatBytes(blob.size)} vượt 25 MB; chưa thể đưa vào Merch.` : readyMessage, blob.size > MAX_BYTES ? "error" : "success");
    if (blob.size <= MAX_BYTES && finalRecord) maybeAutoStartMerch();
  } catch (error) {
    if (processingId === state.processingId) setStatus("image-status", `Không xử lý được ảnh: ${error.message}`, "error");
  } finally {
    if (processingId === state.processingId) {
      button.classList.remove("is-busy");
      button.textContent = "Chuẩn hoá ảnh";
      button.disabled = !state.sourceFile;
    }
  }
}

async function finalizeArtwork() {
  if (!state.processedBlob || !state.processedStorageKey) {
    setStatus("image-status", "Chưa có ảnh đã chuẩn hoá để chốt.", "error");
    return false;
  }
  const { processedArtwork } = await chrome.storage.local.get("processedArtwork");
  if (!processedArtwork?.dataUrl || processedArtwork.storageKey !== state.processedStorageKey) {
    setStatus("image-status", "Không tìm thấy bản preview hiện tại trong storage.", "error");
    return false;
  }
  const finalArtwork = { ...processedArtwork, jobId: processedArtwork.jobId || state.sourceJobId || await resolveCurrentJobId(), source: processedArtwork.source || state.sourceKind || "manual-upload", finalSelected: true, finalizedAt: Date.now() };
  state.sourceJobId = finalArtwork.jobId;
  state.finalArtwork = finalArtwork;
  await chrome.storage.local.set({ finalArtwork });
  $("artwork-source").textContent = `Artwork cuối: ${finalArtwork.source === "clipboard" ? "clipboard" : finalArtwork.source === "chatgpt" ? "ChatGPT" : finalArtwork.source === "vault" ? "Kho mẫu" : "upload thủ công"}`;
  updateFinalActionState();
  setStatus("image-status", "Đã chốt artwork cuối. Anh có thể sửa listing, lưu Kho mẫu hoặc đưa thẳng lên Merch.", "success");
  return true;
}

function scheduleReprocess() {
  if (!state.sourceFile) return;
  const processingId = ++state.processingId;
  clearTimeout(state.reprocessTimer);
  state.reprocessTimer = setTimeout(() => processImage(processingId), 300);
}

function downloadPng() {
  if (!state.processedBlob) return;
  const url = URL.createObjectURL(state.processedBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.processedName || "merch-flow.png";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function ensureContentScript(tabId, files) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files });
    return true;
  } catch (_) {
    return false;
  }
}

async function sendToTabWithRetry(tabId, message, files) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response !== undefined) return response;
    if (!await ensureContentScript(tabId, files)) return response;
    return chrome.tabs.sendMessage(tabId, message);
  } catch (firstError) {
    if (!await ensureContentScript(tabId, files)) throw firstError;
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function listingPayload() {
  return {
    ...collectListing(),
    jobId: state.listing?.jobId || state.sourceJobId || ""
  };
}

async function loadChatArtwork(chatArtwork, autoProcess = true) {
  if (!chatArtwork?.dataUrl || !chatArtwork.storageKey || !chatArtwork.jobId || !isFresh(chatArtwork, ARTWORK_TTL)) return false;
  if (state.sourceStorageKey === chatArtwork.storageKey && state.sourceFile) return true;
  const { lastListing } = await chrome.storage.local.get("lastListing");
  const artworkMessageIndex = Number.isFinite(chatArtwork.artworkMessageIndex) ? chatArtwork.artworkMessageIndex : -1;
  const chatBinding = {
    jobId: chatArtwork.jobId,
    artworkStorageKey: chatArtwork.storageKey,
    artworkRevision: Number(chatArtwork.artworkRevision || 0),
    sessionNonce: String(chatArtwork.sessionNonce || ""),
    artworkMessageIndex
  };
  const listingMatchesArtwork = listingMatchesArtworkBinding(lastListing, chatBinding);
  if (!listingMatchesArtwork) {
    clearListingForm("Đang chờ listing mới khớp artwork mới nhất");
    await chrome.storage.local.remove("lastListing");
  }
  try {
    const response = await fetch(chatArtwork.dataUrl);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Dữ liệu ChatGPT không phải ảnh");
    const extension = blob.type.includes("webp") ? "webp" : blob.type.includes("jpeg") ? "jpg" : "png";
    const baseName = (chatArtwork.name || `merch-flow-${chatArtwork.jobId.slice(0, 8)}.${extension}`).replace(/\.[^.]+$/, "");
    const file = new File([blob], `${baseName}.${extension}`, { type: blob.type, lastModified: Date.now() });
    if (!listingMatchesArtwork) {
      clearListingForm("Đang chờ ChatGPT trả listing cho artwork mới nhất");
    } else if (state.listing?.jobId !== chatArtwork.jobId || Number(state.listing.messageIndex ?? -1) < artworkMessageIndex) {
      applyListing(lastListing, "ChatGPT");
    }
    $("winner-white-only").checked = true;
    $("remove-white").checked = false;
    await setSourceFile(file, { jobId: chatArtwork.jobId, storageKey: chatArtwork.storageKey, artworkRevision: chatArtwork.artworkRevision, sessionNonce: chatArtwork.sessionNonce, artworkMessageIndex: chatArtwork.artworkMessageIndex, source: "chatgpt", autoSource: true, autoFinalize: true, manualOverride: false });
    activatePanel("panel-image");
    setStatus("image-status", "Đã tự lấy artwork từ ChatGPT. Đang ép design về trắng-only, nền trong suốt và chuẩn hoá 4500 × 5400…", "info");
    if (autoProcess) await processImage(++state.processingId);
    return true;
  } catch (error) {
    setStatus("image-status", `Không tự lấy được artwork từ ChatGPT: ${error.message}. Có thể tải ảnh thủ công rồi kéo vào đây.`, "error");
    return false;
  }
}

async function findMerchTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const merchTabs = tabs.filter((tab) => /^https:\/\/merch\.amazon\.com\//i.test(tab.url || ""));
  return merchTabs.find((tab) => /\/designs\/new/i.test(tab.url || "")) || merchTabs[0] || null;
}

async function startUploadToMerch({ automatic = false } = {}) {
  if (!state.processedBlob || !state.processedStorageKey) return false;
  const finalizedCurrent = Boolean(state.finalArtwork && state.finalArtwork.storageKey === state.processedStorageKey);
  if (!finalizedCurrent) {
    setStatus("image-status", "Hãy bấm “Chốt ảnh này” trước khi đưa lên Merch.", "error");
    return false;
  }
  if (state.processedBlob.size > MAX_BYTES) {
    setStatus("image-status", "PNG vượt 25 MB nên chưa gửi.", "error");
    return false;
  }

  let listing = listingPayload();
  const binding = currentArtworkBinding();
  const listingBound = listingMatchesArtworkBinding(state.listing, binding);
  if (automatic && !listingBound) return false;
  if (!automatic && !listingBound && isChatGPTListing(state.listing) && !state.listingDirty) {
    setStatus("image-status", "Listing ChatGPT đang thuộc artwork revision/session khác. Hãy Import listing đúng revision hoặc sửa/lưu listing thủ công trước khi upload.", "error");
    return false;
  }
  if (!automatic && (state.listingDirty || !listingBound)) {
    const saved = await saveFinalListing(state.listing?.source === "pasted_json" ? "pasted_json" : "manual");
    if (!saved) return false;
    listing = saved;
  }
  const { nicheProfile, autoRun } = await chrome.storage.local.get(["nicheProfile", "autoRun"]);
  const productContext = {
    listing,
    nicheProfile: nicheProfile || {},
    artworkAnalysis: state.processedAnalysis || null
  };
  const flowJobId = state.sourceJobId || listing.jobId || "";
  const key = `${state.processedStorageKey}:${flowJobId || "manual"}`;
  const existing = (await chrome.storage.local.get("pendingUpload")).pendingUpload;
  const sameUpload = isFresh(existing, UPLOAD_TTL)
    && existing.artworkStorageKey === state.processedStorageKey
    && (!state.sourceJobId || existing.jobId === state.sourceJobId);
  const upload = sameUpload
    ? { ...existing, listing, productContext, flowKey: existing.flowKey || key, runMode: existing.runMode || (autoRun?.jobId === flowJobId ? (autoRun.mode || "book-lovers-image-listing") : "guided-auto"), status: ["artwork-set", "waiting-listing", "selecting-products"].includes(existing.status) ? existing.status : "pending", lastError: "" }
    : {
      uploadId: crypto.randomUUID(),
      artworkStorageKey: state.processedStorageKey,
      name: state.processedName,
      listing,
      productContext,
      jobId: flowJobId,
      flowKey: key,
      createdAt: Date.now(),
      lastAttemptAt: 0,
      status: "pending",
      lastError: "",
      automatic,
      runMode: autoRun?.jobId === flowJobId ? (autoRun.mode || "book-lovers-image-listing") : "guided-auto"
    };

  await chrome.storage.local.set({
    pendingUpload: upload,
    merchStatus: { message: "Đang chuyển sang Amazon Merch để chèn artwork…", tone: "info", uploadId: upload.uploadId, jobId: upload.jobId || "", updatedAt: Date.now() }
  });

  if (automatic) {
    state.autoUploadKey = key;
    await chrome.storage.local.set({ lastAutoUpload: { key, jobId: upload.jobId, createdAt: Date.now() } });
  }
  let tab = await findMerchTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://merch.amazon.com/designs/new", active: true });
    setStatus("image-status", "Đã mở Amazon Merch Add New. Extension sẽ tự chèn artwork và tiếp tục chờ form listing.", "info");
    return true;
  }
  if (!/\/designs\/new(?:[/?#]|$)/i.test(tab.url || "")) {
    tab = await chrome.tabs.update(tab.id, { url: "https://merch.amazon.com/designs/new", active: true });
    setStatus("image-status", "Đã chuyển tab Amazon sang Add New. Extension sẽ tự chèn artwork khi trang tải xong.", "info");
    return true;
  }

  await chrome.tabs.update(tab.id, { active: true });
  $("upload-merch").disabled = true;
  try {
    const result = await sendToTabWithRetry(tab.id, { type: "MERCH_FLOW_UPLOAD_V5", uploadId: upload.uploadId }, ["merch-flow-core.js", "merch-content.js"]);
    if (!result?.uploaded || result?.verified !== true) throw new Error(result?.error || "Amazon chưa xác nhận artwork");
    return true;
  } catch (error) {
    if (automatic) {
      state.autoUploadKey = "";
      const { lastAutoUpload } = await chrome.storage.local.get("lastAutoUpload");
      if (lastAutoUpload?.key === key) await chrome.storage.local.remove("lastAutoUpload");
    }
    setStatus("image-status", `Chưa chèn được: ${error.message}. Job vẫn được giữ để thử lại.`, "error");
    return false;
  } finally {
    $("upload-merch").disabled = !state.processedBlob || state.processedBlob.size > MAX_BYTES;
  }
}

async function maybeAutoStartMerch() {
  if (state.autoFlowBusy || !state.autoSource || !state.processedBlob || !state.processedStorageKey) return false;
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (batchRun?.currentJobId === state.sourceJobId && ["running", "paused", "failed"].includes(batchRun.status)) return false;
  if (!listingMatchesArtworkBinding(state.listing, currentArtworkBinding())) return false;
  const key = `${state.processedStorageKey}:${state.sourceJobId}`;
  if (state.autoUploadKey === key) return false;
  const { lastAutoUpload, pendingUpload } = await chrome.storage.local.get(["lastAutoUpload", "pendingUpload"]);
  const samePending = pendingUpload?.artworkStorageKey === state.processedStorageKey && pendingUpload?.jobId === state.sourceJobId;
  if (lastAutoUpload?.key === key && !samePending) {
    state.autoUploadKey = key;
    return false;
  }
  state.autoFlowBusy = true;
  try {
    setStatus("image-status", samePending ? "Đang tiếp tục job Amazon Merch còn dang dở…" : "Artwork và listing đã sẵn sàng. Đang tự chuyển sang Amazon Merch…", "success");
    return await startUploadToMerch({ automatic: true });
  } finally {
    state.autoFlowBusy = false;
  }
}

async function uploadToMerch() {
  return startUploadToMerch({ automatic: false });
}

function applyBookLoverDefaults({ clearIdea = true } = {}) {
  $("niche-name").value = DEFAULT_BOOK_PROFILE.name;
  $("winning-style").value = DEFAULT_BOOK_PROFILE.winningStyle;
  $("idea-language").value = DEFAULT_BOOK_PROFILE.language;
  $("idea-style").value = DEFAULT_BOOK_PROFILE.style;
  $("idea-audience").value = DEFAULT_BOOK_PROFILE.audience;
  $("idea-avoid").value = DEFAULT_BOOK_PROFILE.avoid;
  if (clearIdea) $("idea").value = "";
  refreshPrompt();
}

async function startBookLoverAutoFlow() {
  if (state.oneClickBusy) return;
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (batchRun && ["running", "paused", "failed"].includes(batchRun.status)) {
    activatePanel("panel-vault");
    setStatus("batch-status", "Batch đang chạy hoặc đang tạm dừng. Dừng batch trước khi chạy AUTO A→Z.", "error");
    return;
  }
  state.oneClickBusy = true;
  const button = $("auto-book-flow");
  if (button) {
    button.disabled = true;
    button.dataset.running = "true";
    button.textContent = "Đang khởi động AUTO…";
  }
  try {
    await chrome.storage.local.remove("flowCancel");
    applyBookLoverDefaults({ clearIdea: true });
    await saveNicheProfile();
    state.promptJobId = crypto.randomUUID();
    const jobId = state.promptJobId;
    await chrome.storage.local.set({
      autoRun: {
        jobId,
        mode: "book-lovers-image-listing",
        defaultNiche: DEFAULT_BOOK_PROFILE.name,
        status: "starting",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        lastMessage: "Đang mở ChatGPT và gửi brief book lovers…"
      }
    });
    activatePanel("panel-ideas");
    setStatus("idea-status", "AUTO đã bắt đầu: ChatGPT tạo mẫu + listing, sau đó extension chuẩn hoá ảnh và điền Merch.", "success");
    await updateFlowUI();
    await sendToChatGPT({ forceNew: true, autoRun: true });
  } catch (error) {
    const { autoRun } = await chrome.storage.local.get("autoRun");
    if (autoRun?.jobId) {
      await chrome.storage.local.set({ autoRun: { ...autoRun, status: "failed", lastMessage: `AUTO dừng: ${error.message}`, updatedAt: Date.now() } });
    }
    setStatus("idea-status", `Không khởi động được AUTO: ${error.message}`, "error");
  } finally {
    state.oneClickBusy = false;
    await updateFlowUI();
  }
}


async function cancelAutoFlow() {
  const data = await chrome.storage.local.get([
    "autoRun", "pendingChatJob", "lastSentChatJob", "pendingUpload"
  ]);
  const autoRun = data.autoRun;
  const active = Boolean(autoRun?.jobId && !["review", "failed", "cancelled", "completed"].includes(autoRun.status));
  if (!active) {
    setStatus("idea-status", "Không có AUTO đang chạy để hủy.", "info");
    await updateFlowUI();
    return false;
  }

  const jobId = autoRun.jobId;
  const cancelToken = crypto.randomUUID();
  state.oneClickBusy = false;
  state.autoFlowBusy = false;
  state.autoUploadKey = "";
  state.processingId += 1;
  clearTimeout(state.reprocessTimer);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "MERCH_FLOW_CANCEL_JOB_V1",
      jobId,
      cancelToken
    });
    if (!result?.cancelled) throw new Error(result?.error || "Không reset được AUTO");
    clearFile();
    clearListingForm("AUTO đã hủy; chưa có listing đang chờ");
    state.promptJobId = crypto.randomUUID();
    setStatus("idea-status", "Đã HỦY AUTO và reset job đang treo. Có thể chạy AUTO mới ngay.", "success");
    setStatus("image-status", "Automation đã dừng; extension sẽ bỏ qua mọi phản hồi đến muộn của job vừa hủy.", "info");
    await updateFlowUI();
    return true;
  } catch (error) {
    setStatus("idea-status", `Không hủy được AUTO: ${error.message}`, "error");
    return false;
  }
}

function currentPromptProfile() {
  return {
    name: $("niche-name").value.trim() || DEFAULT_BOOK_PROFILE.name,
    profileVersion: DEFAULT_BOOK_PROFILE.profileVersion,
    winningStyle: $("winning-style").value.trim() || DEFAULT_BOOK_PROFILE.winningStyle,
    language: $("idea-language").value || DEFAULT_BOOK_PROFILE.language,
    style: $("idea-style").value || DEFAULT_BOOK_PROFILE.style,
    audience: $("idea-audience").value.trim() || DEFAULT_BOOK_PROFILE.audience,
    avoid: $("idea-avoid").value.trim() || DEFAULT_BOOK_PROFILE.avoid
  };
}

function buildPrompt(jobId) {
  return Core.buildArtworkPrompt({
    jobId,
    profile: currentPromptProfile(),
    seed: $("idea").value.trim() || "Find a fresh, underused real-life book-lover situation or punchline that works as a simple visual gag",
    avoidConcepts: state.creativeMemory,
    includeReferenceRule: false
  });
}

function ensurePromptJobId() {
  if (!state.promptJobId) state.promptJobId = crypto.randomUUID();
  return state.promptJobId;
}

function refreshPrompt() {
  $("prompt-preview").textContent = buildPrompt(ensurePromptJobId());
}

async function copyPrompt() {
  const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
  const activeJob = isFresh(pendingChatJob, CHAT_JOB_TTL) && ["pending", "running"].includes(pendingChatJob.status);
  const jobId = activeJob ? pendingChatJob.jobId : (isFresh(pendingChatJob, CHAT_JOB_TTL) && ["draft", "failed"].includes(pendingChatJob.status) ? pendingChatJob.jobId : ensurePromptJobId());
  const now = Date.now();
  const prompt = activeJob ? pendingChatJob.prompt : buildPrompt(jobId);

  if (!activeJob) {
    await chrome.storage.local.set({
      pendingChatJob: {
        jobId,
        prompt,
        referenceDataUrl: "",
        referenceName: "",
        createdAt: pendingChatJob?.jobId === jobId ? pendingChatJob.createdAt : now,
        lastAttemptAt: 0,
        status: "draft",
        lastError: ""
      }
    });
  }

  state.promptJobId = jobId;
  await navigator.clipboard.writeText(prompt);
  setStatus("idea-status", activeJob ? "Đã copy prompt của job đang chạy." : `Đã copy prompt với Job ID thật: ${jobId.slice(0, 8)}…`, "success");
}

async function saveNicheProfile() {
  await chrome.storage.local.set({ nicheProfile: {
    name: $("niche-name").value.trim(), profileVersion: DEFAULT_BOOK_PROFILE.profileVersion, winningStyle: $("winning-style").value.trim(), language: $("idea-language").value,
    style: $("idea-style").value, audience: $("idea-audience").value.trim(), avoid: $("idea-avoid").value.trim(),
    referenceDataUrl: state.referenceDataUrl, referenceName: state.referenceName
  } });
}

async function openOrReuseManagedChat(jobId, { activate = true, preferredId = 0 } = {}) {
  const result = await chrome.runtime.sendMessage({
    type: "MERCH_FLOW_OPEN_CHAT_V1",
    jobId,
    activate,
    preferredId: Number(preferredId || 0)
  });
  if (!result?.opened || !result.tabId) throw new Error(result?.error || "Không mở được ChatGPT");
  return { id: result.tabId, url: result.url || "" };
}

async function sendToChatGPT({ forceNew = false, autoRun = false } = {}) {
  const activeBatch = (await chrome.storage.local.get("batchRun")).batchRun;
  if (activeBatch && ["running", "paused", "failed"].includes(activeBatch.status)) {
    activatePanel("panel-vault");
    setStatus("batch-status", "Batch đang hoạt động. Dừng batch trước khi gửi một job thủ công.", "error");
    return;
  }
  const stored = await chrome.storage.local.get("pendingChatJob");
  const pendingChatJob = forceNew ? null : stored.pendingChatJob;
  if (isFresh(pendingChatJob, CHAT_JOB_TTL) && pendingChatJob.status === "running") {
    setStatus("idea-status", "Job hiện đang chạy trên một tab ChatGPT. Chờ trạng thái hoặc mở lại sau khi fail.", "info");
    return;
  }
  if (isFresh(pendingChatJob, CHAT_JOB_TTL) && pendingChatJob.status === "pending" && Date.now() - (pendingChatJob.lastAttemptAt || 0) < 10000) {
    setStatus("idea-status", "Đang mở ChatGPT cho job hiện tại…", "info");
    return;
  }
  const retrying = !forceNew && isFresh(pendingChatJob, CHAT_JOB_TTL) && pendingChatJob.status !== "sent";
  const job = retrying
    ? {
      ...pendingChatJob,
      prompt: pendingChatJob.status === "draft" ? buildPrompt(pendingChatJob.jobId) : pendingChatJob.prompt,
      referenceDataUrl: "",
      referenceName: "",
      status: "pending",
      lastError: "",
      lastAttemptAt: Date.now(),
      sourcePrompt: pendingChatJob.sourcePrompt || pendingChatJob.prompt,
      sessionNonce: crypto.randomUUID()
    }
    : (() => {
      const jobId = ensurePromptJobId();
      const now = Date.now();
      return { jobId, prompt: buildPrompt(jobId), sourcePrompt: buildPrompt(jobId), referenceDataUrl: "", referenceName: "", createdAt: now, lastAttemptAt: now, status: "pending", lastError: "", runMode: autoRun ? "book-lovers-image-listing" : "guided", sessionNonce: crypto.randomUUID() };
    })();

  if (!retrying) {
    await chrome.storage.local.remove([
      "lastSentChatJob", "chatArtwork", "lastListing", "processedArtwork",
      "pendingUpload", "lastAutoUpload", "merchStatus"
    ]);
    if (!autoRun) await chrome.storage.local.remove("autoRun");
    clearListingForm("Đang chờ listing của artwork mới nhất");
    clearFile();
    setStatus("image-status", "Đang chờ artwork mới nhất đúng Job ID từ ChatGPT…", "info");
  }

  await saveNicheProfile();
  const storageUpdate = { pendingChatJob: job, chatStatus: { message: "Đang mở ChatGPT…", tone: "info", jobId: job.jobId, updatedAt: Date.now() } };
  if (autoRun) {
    const { autoRun: currentAutoRun } = await chrome.storage.local.get("autoRun");
    storageUpdate.autoRun = {
      ...(currentAutoRun || {}),
      jobId: job.jobId,
      mode: "book-lovers-image-listing",
      defaultNiche: DEFAULT_BOOK_PROFILE.name,
      status: "opening-chatgpt",
      startedAt: currentAutoRun?.startedAt || Date.now(),
      updatedAt: Date.now(),
      lastMessage: "Đang mở ChatGPT và gửi brief book lovers…"
    };
  }
  await chrome.storage.local.set(storageUpdate);
  $("send-chatgpt").textContent = retrying ? "Thử gửi lại job ↗" : "Tìm ý tưởng + vẽ ↗";
  const freshResult = await chrome.runtime.sendMessage({
    type: "MERCH_FLOW_START_FRESH_CHAT_V1",
    job: {
      ...job,
      sourcePrompt: job.sourcePrompt || job.prompt,
      referenceDataUrl: "",
      referenceName: "",
      sessionNonce: job.sessionNonce || crypto.randomUUID()
    },
    activate: true,
    closePreviousManaged: true
  });
  if (!freshResult?.opened || !freshResult.tabId) throw new Error(freshResult?.error || "Không mở được phiên ChatGPT sạch");
  state.promptJobId = crypto.randomUUID();
  refreshPrompt();
  setStatus("idea-status", autoRun ? "AUTO đang chạy trên ChatGPT. Không cần thao tác thêm." : "Đang mở ChatGPT…", "info");
  return job.jobId;
}

async function importListing() {
  const expectedJobId = String(state.sourceJobId || await resolveCurrentJobId({ create: false }) || "").trim();
  if (!expectedJobId) {
    setStatus("image-status", "Chưa có Job ID của artwork hiện tại để khóa listing.", "error");
    return;
  }

  const binding = currentArtworkBinding();
  const tabs = (await chrome.tabs.query({ currentWindow: true }))
    .filter((candidate) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(candidate.url || ""));
  for (const tab of tabs) {
    try {
      const response = await sendToTabWithRetry(
        tab.id,
        { type: "MERCH_FLOW_GET_LISTING_V6", expectedJobId, expectedArtworkStorageKey: binding.artworkStorageKey, expectedArtworkRevision: binding.artworkRevision, expectedSessionNonce: binding.sessionNonce, minimumListingMessageIndex: binding.artworkMessageIndex },
        ["merch-flow-core.js", "chatgpt-content.js"]
      );
      if (response?.listing?.jobId !== expectedJobId || !listingMatchesArtworkBinding(response.listing, binding)) continue;
      if (applyListing(response.listing, "ChatGPT", expectedJobId, binding)) {
        const selected = { ...response.listing, source: "chatgpt-selected", finalSelected: true, updatedAt: Date.now() };
        state.listing = selected;
        await chrome.storage.local.set({ lastListing: selected, finalListing: selected });
        setStatus("image-status", "Đã chọn listing ChatGPT đúng Job ID của artwork hiện tại.", "success");
        maybeAutoStartMerch();
        return;
      }
      if (response?.followupRequested && response?.jobId === expectedJobId) {
        setStatus("image-status", "Artwork đã có. Extension vừa yêu cầu listing JSON cho đúng Job ID hiện tại; chờ phản hồi rồi import lại.", "info");
        return;
      }
    } catch (_) {
      // Try the next ChatGPT tab. Never accept a different job as fallback.
    }
  }

  const { lastListing } = await chrome.storage.local.get("lastListing");
  if (listingMatchesArtworkBinding(lastListing, binding) && applyListing(lastListing, "job hiện tại", expectedJobId, binding)) {
    const selected = { ...lastListing, source: lastListing?.source || "chatgpt-selected", finalSelected: true, updatedAt: Date.now() };
    state.listing = selected;
    await chrome.storage.local.set({ finalListing: selected });
    setStatus("image-status", "Đã nạp listing đã lưu đúng Job ID của artwork hiện tại.", "success");
    maybeAutoStartMerch();
  } else {
    setStatus("image-status", `Không tìm thấy listing hợp lệ cho Job ID ${expectedJobId.slice(0, 8)}…; không dùng listing cũ của job khác.`, "error");
  }
}

async function fillListingOnMerch() {
  const listing = collectListing();
  if (!Object.values(listing).some(Boolean)) {
    setStatus("image-status", "Chưa có listing để điền.", "error");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https:\/\/merch\.amazon\.com\//i.test(tab?.url || "")) {
    setStatus("image-status", "Mở đúng form Merch trước khi điền listing.", "error");
    return;
  }
  try {
    const result = await sendToTabWithRetry(tab.id, { type: "MERCH_FLOW_FILL_LISTING_V5", listing }, ["merch-flow-core.js", "merch-content.js"]);
    const report = result?.report || { filled: [], missing: Core.LISTING_KEYS };
    setStatus("image-status", `Đã điền ${report.filled.length}/5 trường listing.${report.missing.length ? ` Chưa điền: ${report.missing.join(", ")}.` : ""}`, report.missing.length ? "info" : "success");
  } catch (error) {
    setStatus("image-status", `Không điền được listing: ${error.message}`, "error");
  }
}

async function reopenPendingJobFresh(pending) {
  const recoveryJob = {
    ...pending,
    status: "pending",
    lastError: "",
    lastAttemptAt: Date.now(),
    chatTabId: 0,
    chatUrl: "",
    sessionNonce: crypto.randomUUID(),
    freshRouteRepairCount: 0,
    freshRouteTransitionArmedAt: 0,
    freshCandidateConversationKey: "",
    freshCandidateSeenAt: 0,
    freshSendArmedAt: 0,
    staleConversationKeys: []
  };
  const { autoRun } = await chrome.storage.local.get("autoRun");
  if (autoRun?.jobId === pending.jobId) {
    await chrome.storage.local.set({
      autoRun: {
        ...autoRun,
        status: "opening-chatgpt",
        lastError: "",
        lastMessage: "Đang mở lại job thất bại trong một New chat sạch…",
        updatedAt: Date.now()
      }
    });
  }
  return chrome.runtime.sendMessage({
    type: "MERCH_FLOW_START_FRESH_CHAT_V1",
    job: recoveryJob,
    activate: true,
    closePreviousManaged: true
  });
}

async function resumeCurrentFlow() {
  const { batchRun } = await chrome.storage.local.get("batchRun");
  if (batchRun && ["running", "paused", "failed"].includes(batchRun.status)) {
    activatePanel("panel-vault");
    setStatus("batch-status", "Đây là batch. Dùng nút Tạm dừng/Tiếp tục trong Kho mẫu.", "info");
    return;
  }
  setStatus("idea-status", "Đang quét lại artwork và listing trong tab ChatGPT…", "info");
  $("flow-next").textContent = "Đang quét lại tab ChatGPT và tiếp tục đúng Job ID…";
  const flowData = await chrome.storage.local.get(["pendingChatJob", "lastSentChatJob", "chatArtwork"]);
  const expectedJobId = String(state.sourceJobId || flowData.chatArtwork?.jobId || flowData.lastSentChatJob?.jobId || flowData.pendingChatJob?.jobId || "").trim();
  if (!expectedJobId) {
    setStatus("idea-status", "Không có Job ID hiện tại để Resume an toàn.", "error");
    return;
  }
  const failedPending = flowData.pendingChatJob;
  if (failedPending?.jobId === expectedJobId && failedPending?.prompt && failedPending.status === "failed") {
    const freshResult = await reopenPendingJobFresh(failedPending);
    if (freshResult?.opened) {
      setStatus("idea-status", "Job thất bại đã được reset route guard và mở lại trong New chat sạch.", "success");
      return;
    }
    setStatus("idea-status", `Không mở lại được phiên sạch của job: ${freshResult?.error || "lỗi không xác định"}`, "error");
    return;
  }
  const binding = currentArtworkBinding();
  const chatTab = await findCurrentJobChatTab(flowData);
  if (!chatTab) {
    const { chatArtwork, lastListing } = await chrome.storage.local.get(["chatArtwork", "lastListing"]);
    if (chatArtwork?.dataUrl && chatArtwork.jobId === expectedJobId) await loadChatArtwork(chatArtwork, true);
    const refreshedBinding = currentArtworkBinding();
    if (listingMatchesArtworkBinding(lastListing, refreshedBinding)) applyListing(lastListing, "ChatGPT đúng artwork", expectedJobId, refreshedBinding);
    await maybeAutoStartMerch();
    await updateFlowUI();

    const pending = flowData.pendingChatJob;
    if (pending?.jobId && pending?.prompt && ["pending", "running", "failed"].includes(pending.status)) {
      const freshResult = await reopenPendingJobFresh(pending);
      if (freshResult?.opened) {
        setStatus("idea-status", "Tab của job cũ không còn hợp lệ. Đã tự mở một phiên ChatGPT sạch để tiếp tục đúng Job ID.", "success");
        return;
      }
      setStatus("idea-status", `Không mở lại được phiên sạch của job: ${freshResult?.error || "lỗi không xác định"}`, "error");
      return;
    }

    if (!chatArtwork?.dataUrl && !listingMatchesArtworkBinding(lastListing, currentArtworkBinding())) setStatus("idea-status", "Không thấy tab/dữ liệu ChatGPT thuộc đúng job + artwork revision hiện tại.", "error");
    return;
  }
  try {
    const response = await sendToTabWithRetry(chatTab.id, { type: "MERCH_FLOW_RESUME_V6", expectedJobId, expectedArtworkStorageKey: binding.artworkStorageKey, expectedArtworkRevision: binding.artworkRevision, expectedSessionNonce: binding.sessionNonce, minimumListingMessageIndex: binding.artworkMessageIndex }, ["merch-flow-core.js", "chatgpt-content.js"]);
    if (response?.error) throw new Error(response.error);
    if (response?.artwork) activatePanel("panel-image");
    if (response?.listing && listingMatchesArtworkBinding(response.listing, binding)) applyListing(response.listing, "ChatGPT", expectedJobId, binding);
    if (response?.retried) setStatus("idea-status", "Đã gửi lại đúng brief có Job ID. Giờ chỉ cần chờ ChatGPT tạo artwork; extension sẽ tự chạy tiếp.", "success");
    else if (response?.retryError) setStatus("idea-status", `Chưa gửi lại được: ${response.retryError}`, "error");
    else if (response?.followupRequested) setStatus("image-status", "Đã tự gửi yêu cầu listing JSON. Chờ ChatGPT trả lời, extension sẽ chạy tiếp.", "info");
    else setStatus("idea-status", "Đã quét lại job. Extension sẽ tiếp tục tự động khi dữ liệu xuất hiện.", "success");
    await updateFlowUI();
  } catch (error) {
    setStatus("idea-status", `Không tiếp tục được: ${error.message}`, "error");
  }
}

function chatConversationPath(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    if (!/^(chatgpt\.com|chat\.openai\.com)$/i.test(url.hostname)) return "";
    return url.pathname || "/";
  } catch (_) {
    return "";
  }
}

async function findCurrentJobChatTab(flowData) {
  const tabs = (await chrome.tabs.query({}))
    .filter((tab) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || ""));
  if (!tabs.length) return null;

  const { merchFlowChatTabId } = await chrome.storage.local.get("merchFlowChatTabId");
  const storedTabIds = [
    Number(flowData.lastSentChatJob?.chatTabId || flowData.pendingChatJob?.chatTabId || 0),
    Number(merchFlowChatTabId || 0)
  ].filter(Boolean);
  for (const storedTabId of storedTabIds) {
    const storedTab = tabs.find((tab) => tab.id === storedTabId);
    if (storedTab) return storedTab;
  }

  const conversationKey = flowData.chatArtwork?.conversationKey
    || flowData.lastSentChatJob?.conversationKey
    || "";
  if (conversationKey) {
    const matchingConversation = tabs.find((tab) => chatConversationPath(tab.url) === conversationKey);
    if (matchingConversation) return matchingConversation;
  }

  const expectedJobId = String(flowData.pendingChatJob?.jobId || flowData.lastSentChatJob?.jobId || flowData.chatArtwork?.jobId || "").trim();
  if (expectedJobId) return null; // Never resume a live job in an arbitrary personal/Deep Research tab.

  const activeChat = tabs.find((tab) => tab.active);
  if (activeChat) return activeChat;
  return [...tabs].sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0] || null;
}

function buildRegenerationPrompt(jobId, revision) {
  return Core.buildRegenerationPrompt({
    jobId,
    revision,
    profile: currentPromptProfile(),
    avoidConcepts: state.creativeMemory
  });
}

async function regenerateArtwork() {
  const activeBatch = (await chrome.storage.local.get("batchRun")).batchRun;
  if (activeBatch && ["running", "paused", "failed"].includes(activeBatch.status)) {
    activatePanel("panel-vault");
    setStatus("batch-status", "Batch đang hoạt động. Xoá mẫu không ưng trong Kho mẫu hoặc dừng batch trước khi tạo mẫu khác.", "info");
    return;
  }

  await chrome.storage.local.remove("flowCancel");
  const flowData = await chrome.storage.local.get([
    "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing",
    "processedArtwork", "pendingUpload", "autoRun"
  ]);
  const jobId = flowData.lastSentChatJob?.jobId
    || flowData.pendingChatJob?.jobId
    || flowData.chatArtwork?.jobId
    || flowData.lastListing?.jobId
    || flowData.processedArtwork?.jobId
    || flowData.pendingUpload?.jobId
    || flowData.autoRun?.jobId
    || "";

  if (!jobId) {
    setStatus("idea-status", "Chưa có job hiện tại để tạo mẫu khác. Hãy chạy AUTO hoặc gửi brief trước.", "error");
    return;
  }

  const attempt = Number(flowData.lastSentChatJob?.regenerationRevision || 0) + 1;
  const prompt = buildRegenerationPrompt(jobId, attempt);
  const now = Date.now();
  const sessionNonce = crypto.randomUUID();
  const freshJob = {
    jobId,
    prompt,
    sourcePrompt: prompt,
    referenceDataUrl: "",
    referenceName: "",
    createdAt: now,
    lastAttemptAt: 0,
    status: "pending",
    lastError: "",
    runMode: "fresh-artwork-attempt",
    regenerationRevision: attempt,
    artworkRetryCount: 0,
    sessionNonce
  };

  const update = {
    chatStatus: {
      message: `Đang mở phiên ChatGPT sạch cho artwork attempt ${attempt}.`,
      tone: "info",
      jobId,
      updatedAt: now
    }
  };
  if (flowData.autoRun?.jobId === jobId) {
    update.autoRun = {
      ...flowData.autoRun,
      status: "regenerating",
      lastMessage: `Đang tạo artwork attempt ${attempt} trong phiên ChatGPT sạch…`,
      updatedAt: now
    };
  }

  await chrome.storage.local.remove([
    "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing", "processedArtwork",
    "pendingUpload", "lastAutoUpload", "merchStatus"
  ]);
  await chrome.storage.local.set(update);

  state.promptJobId = jobId;
  clearListingForm("Đang chờ listing của artwork mới");
  clearFile();
  activatePanel("panel-ideas");
  setStatus("idea-status", `Đang tạo artwork attempt ${attempt} trong một phiên ChatGPT sạch.`, "info");
  setStatus("image-status", "Chỉ khi bắt được ảnh mới thật thì flow mới được phép xin listing.", "info");
  $("flow-next").textContent = "Artwork mới chạy trong phiên sạch; không mang ảnh hay hội thoại cũ sang.";

  try {
    const result = await chrome.runtime.sendMessage({
      type: "MERCH_FLOW_START_FRESH_CHAT_V1",
      job: freshJob,
      activate: true,
      closePreviousManaged: true
    });
    if (!result?.opened || !result.tabId) throw new Error(result?.error || "Không mở được phiên ChatGPT sạch");
    setStatus("idea-status", `Artwork attempt ${attempt} đã được gửi sang phiên sạch.`, "success");
    await updateFlowUI();
  } catch (error) {
    await chrome.storage.local.set({
      pendingChatJob: { ...freshJob, status: "failed", lastError: error.message || "Không mở được phiên ChatGPT sạch", lastAttemptAt: Date.now() }
    });
    setStatus("idea-status", `Không mở được phiên sạch: ${error.message}`, "error");
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function dataUrlBytes(dataUrl) {
  const [header, body = ""] = String(dataUrl || "").split(",", 2);
  if (!/;base64$/i.test(header)) return new TextEncoder().encode(decodeURIComponent(body));
  const estimated = Math.floor(body.length * 3 / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0);
  const bytes = new Uint8Array(Math.max(0, estimated));
  const chunkChars = 1024 * 1024; // multiple of 4; avoid one full-size atob binary string in RAM.
  let writeOffset = 0;
  for (let offset = 0; offset < body.length; offset += chunkChars) {
    const binary = atob(body.slice(offset, Math.min(body.length, offset + chunkChars)));
    for (let index = 0; index < binary.length; index += 1) bytes[writeOffset++] = binary.charCodeAt(index);
  }
  return writeOffset === bytes.length ? bytes : bytes.slice(0, writeOffset);
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
  };
}

function zipHeader(size, writer) {
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  writer(view);
  return new Uint8Array(buffer);
}

function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const stamp = dosDateTime();
  for (const file of files) {
    const nameBytes = encoder.encode(file.name.replace(/\\/g, "/"));
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const crc = crc32(data);
    const localHeader = zipHeader(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, stamp.time, true);
      view.setUint16(12, stamp.date, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
    });
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = zipHeader(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, stamp.time, true);
      view.setUint16(14, stamp.date, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, data.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, localOffset, true);
    });
    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + data.length;
  }
  const central = concatBytes(centralParts);
  const end = zipHeader(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, central.length, true);
    view.setUint32(16, localOffset, true);
    view.setUint16(20, 0, true);
  });
  return new Blob([...localParts, central, end], { type: "application/zip" });
}

async function saveCurrentDesignToVault() {
  try {
    if (!state.finalArtwork || state.finalArtwork.storageKey !== state.processedStorageKey) {
      setStatus("image-status", "Chưa có artwork cuối. Bấm “Chốt ảnh này” trước.", "error");
      return false;
    }
    let listing = state.listing;
    if (state.listingDirty || !isCompleteListing(listing)) listing = await saveFinalListing("manual");
    if (!listing) return false;
    const jobId = state.finalArtwork.jobId || listing.jobId || await resolveCurrentJobId();
    if (listing.jobId !== jobId || (isChatGPTListing(listing) && !listingMatchesArtworkBinding(listing, currentArtworkBinding()))) {
      if (isChatGPTListing(listing)) {
        setStatus("image-status", "Không lưu Kho mẫu: listing ChatGPT thuộc job/artwork revision khác. Hãy import đúng listing hoặc lưu lại các field dưới dạng manual.", "error");
        return false;
      }
      listing = { ...listing, jobId, source: listing.source || "manual", finalSelected: true, updatedAt: Date.now() };
      state.listing = listing;
      await chrome.storage.local.set({ lastListing: listing });
    }
    const { nicheProfile, savedDesigns } = await chrome.storage.local.get(["nicheProfile", "savedDesigns"]);
    const design = Core.normalizeSavedDesign({
      id: `manual:${jobId}`,
      jobId,
      createdAt: Date.now(),
      artworkDataUrl: state.finalArtwork.dataUrl,
      artworkName: state.finalArtwork.name || state.processedName,
      listing,
      nicheProfile: nicheProfile || {},
      creativeFingerprint: state.finalArtwork.source === "chatgpt"
        ? Core.creativeFingerprintForJob({ jobId, revision: Number(state.finalArtwork.artworkRevision || listing.artworkRevision || 0) })
        : "",
      source: state.finalArtwork.source === "chatgpt" ? "chatgpt-final" : "manual-final"
    });
    if (!design) throw new Error("Artwork hoặc listing cuối chưa hợp lệ");
    const current = Array.isArray(savedDesigns) ? savedDesigns : [];
    const next = current.filter((item) => item.jobId !== jobId);
    next.push(design);
    await chrome.storage.local.set({ savedDesigns: next });
    await renderVaultUI();
    setStatus("image-status", "Đã lưu ảnh + JSON cuối vào Kho mẫu. Job này đã đủ dữ liệu để dùng lại hoặc export.", "success");
    return true;
  } catch (error) {
    setStatus("image-status", `Không lưu được mẫu cuối: ${error.message}`, "error");
    return false;
  }
}

function savedPackage(design) {
  return {
    merch_flow_package: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    design: {
      id: design.id,
      jobId: design.jobId,
      createdAt: design.createdAt,
      artworkDataUrl: design.artworkDataUrl,
      artworkName: design.artworkName,
      listing: design.listing,
      nicheProfile: design.nicheProfile || {},
      batchId: design.batchId || "",
      batchIndex: design.batchIndex || 0,
      creativeFingerprint: design.creativeFingerprint || "",
      source: design.source || "saved"
    }
  };
}

async function getSavedDesigns() {
  const { savedDesigns } = await chrome.storage.local.get("savedDesigns");
  return (Array.isArray(savedDesigns) ? savedDesigns : [])
    .map((design) => Core.normalizeSavedDesign(design))
    .filter(Boolean)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

function formatSavedDate(timestamp) {
  try { return new Date(timestamp).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (_) { return ""; }
}

async function exportSavedPackage(design) {
  const normalized = Core.normalizeSavedDesign(design);
  if (!normalized) return;
  const slug = Core.safeTitleSlug(normalized.listing.title, `design-${normalized.jobId.slice(0, 8)}`);
  const json = JSON.stringify(savedPackage(normalized), null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), `${slug}.merchflow.json`);
}

function estimatedDataUrlBytes(dataUrl) {
  const value = String(dataUrl || "");
  const comma = value.indexOf(",");
  if (comma < 0) return 0;
  const header = value.slice(0, comma);
  const body = value.slice(comma + 1);
  return /;base64$/i.test(header) ? Math.floor(body.length * 3 / 4) : body.length;
}

function zipDesignChunks(designs, maxCount = 3, maxEstimatedBytes = 24 * 1024 * 1024) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  for (const design of designs) {
    const nextBytes = estimatedDataUrlBytes(design.artworkDataUrl);
    if (current.length && (current.length >= maxCount || bytes + nextBytes > maxEstimatedBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(design);
    bytes += nextBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function exportAllSavedZip() {
  const designs = await getSavedDesigns();
  if (!designs.length) {
    setStatus("batch-status", "Kho mẫu đang trống, chưa có gì để xuất.", "error");
    return;
  }
  const ordered = designs.slice().reverse();
  const chunks = zipDesignChunks(ordered);
  const day = new Date().toISOString().slice(0, 10);
  let globalIndex = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const encoder = new TextEncoder();
    const files = [];
    const manifest = [];
    for (const design of chunks[chunkIndex]) {
      globalIndex += 1;
      const order = String(globalIndex).padStart(3, "0");
      const slug = Core.safeTitleSlug(design.listing.title, `design-${design.jobId.slice(0, 8)}`);
      const folder = `${order}-${slug}`;
      const extensionMatch = design.artworkDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);/i);
      const extension = extensionMatch?.[1]?.toLowerCase() === "jpeg" ? "jpg" : (extensionMatch?.[1]?.toLowerCase() || "png");
      files.push({ name: `${folder}/artwork.${extension}`, bytes: dataUrlBytes(design.artworkDataUrl) });
      files.push({ name: `${folder}/listing.json`, bytes: encoder.encode(JSON.stringify({ job_id: design.jobId, ...design.listing }, null, 2)) });
      manifest.push({ id: design.id, jobId: design.jobId, folder, title: design.listing.title, brand: design.listing.brand, createdAt: design.createdAt });
    }
    files.push({ name: "manifest.json", bytes: encoder.encode(JSON.stringify({ merch_flow_library: true, version: 1, exportedAt: new Date().toISOString(), part: chunkIndex + 1, parts: chunks.length, designs: manifest }, null, 2)) });
    const zip = buildStoreZip(files);
    const suffix = chunks.length > 1 ? `-part-${String(chunkIndex + 1).padStart(2, "0")}-of-${String(chunks.length).padStart(2, "0")}` : "";
    downloadBlob(zip, `Merch-Flow-Book-Lovers-${day}${suffix}.zip`);
    // Yield and let the previous download URL be released before decoding the next batch.
    if (chunkIndex < chunks.length - 1) await new Promise((resolve) => setTimeout(resolve, 1700));
  }
  setStatus("batch-status", chunks.length > 1
    ? `Đã xuất ${designs.length} mẫu thành ${chunks.length} ZIP nhỏ để tránh treo side panel.`
    : `Đã xuất ZIP gồm ${designs.length} artwork và listing.`, "success");
}

async function importSavedPackage(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const candidates = parsed?.merch_flow_package ? [parsed.design] : Array.isArray(parsed?.designs) ? parsed.designs : [parsed.design || parsed];
    const imported = candidates.map((item) => Core.normalizeSavedDesign(item)).filter(Boolean);
    if (!imported.length) throw new Error("File không chứa gói Merch Flow hợp lệ");
    const current = await getSavedDesigns();
    const byJob = new Map(current.map((design) => [design.jobId, design]));
    for (const design of imported) byJob.set(design.jobId, design);
    await chrome.storage.local.set({ savedDesigns: [...byJob.values()] });
    setStatus("batch-status", `Đã nhập ${imported.length} mẫu vào Kho mẫu.`, "success");
    await renderVaultUI();
  } catch (error) {
    setStatus("batch-status", `Không nhập được gói: ${error.message}`, "error");
  } finally {
    $("vault-import").value = "";
  }
}

async function deleteSavedDesign(id) {
  const designs = await getSavedDesigns();
  const design = designs.find((item) => item.id === id);
  const label = design?.listing?.title ? `“${design.listing.title}”` : "mẫu này";
  if (!confirm(`Xoá ${label} khỏi Kho mẫu?`)) return;
  await chrome.storage.local.set({ savedDesigns: designs.filter((item) => item.id !== id) });
  await renderVaultUI();
}

async function clearSavedDesigns() {
  if (!confirm("Xoá toàn bộ artwork và listing trong Kho mẫu?")) return;
  await chrome.storage.local.remove("savedDesigns");
  setStatus("batch-status", "Đã xoá toàn bộ Kho mẫu.", "success");
  await renderVaultUI();
}

async function loadSavedDesign(design, { upload = false } = {}) {
  const normalized = Core.normalizeSavedDesign(design);
  if (!normalized) {
    setStatus("batch-status", "Mẫu lưu bị thiếu ảnh hoặc listing.", "error");
    return false;
  }
  state.vaultBusy = true;
  try {
    const vaultListing = { ...normalized.listing, jobId: normalized.jobId, source: "vault", finalSelected: true };
    applyListing(vaultListing, "Kho mẫu", normalized.jobId);
    const response = await fetch(normalized.artworkDataUrl);
    const blob = await response.blob();
    const extension = blob.type.includes("webp") ? "webp" : blob.type.includes("jpeg") ? "jpg" : "png";
    const file = new File([blob], normalized.artworkName || `${Core.safeTitleSlug(normalized.listing.title)}.${extension}`, { type: blob.type || "image/png", lastModified: Date.now() });
    $("remove-white").checked = true;
    await setSourceFile(file, { jobId: normalized.jobId, storageKey: `vault:${normalized.id}`, source: "vault", autoSource: false, autoFinalize: true, manualOverride: true });
    activatePanel("panel-image");
    setStatus("image-status", `Đã nạp “${normalized.listing.title}” từ Kho mẫu. Đang chuẩn hoá PNG…`, "info");
    await processImage(++state.processingId);
    if (upload) {
      setStatus("image-status", "Đã chuẩn hoá. Đang mở Amazon Merch Add New và điền mẫu đã chọn…", "success");
      await startUploadToMerch({ automatic: false });
    }
    return true;
  } catch (error) {
    setStatus("batch-status", `Không nạp được mẫu: ${error.message}`, "error");
    return false;
  } finally {
    state.vaultBusy = false;
  }
}

function createVaultItem(design, displayIndex) {
  const item = document.createElement("article");
  item.className = "vault-item";
  const thumb = document.createElement("div");
  thumb.className = "vault-thumb";
  const image = document.createElement("img");
  image.src = design.artworkDataUrl;
  image.alt = design.listing.title;
  const index = document.createElement("span");
  index.className = "vault-index";
  index.textContent = `#${displayIndex}`;
  thumb.append(image, index);

  const copy = document.createElement("div");
  copy.className = "vault-copy";
  const title = document.createElement("h3");
  title.textContent = design.listing.title;
  const description = document.createElement("p");
  description.textContent = design.listing.description;
  const meta = document.createElement("div");
  meta.className = "vault-meta";
  const dateMeta = document.createElement("span");
  dateMeta.textContent = formatSavedDate(design.createdAt);
  const brandMeta = document.createElement("span");
  brandMeta.textContent = design.listing.brand;
  meta.append(dateMeta, brandMeta);

  const actions = document.createElement("div");
  actions.className = "vault-actions";
  const load = document.createElement("button");
  load.className = "button secondary";
  load.textContent = "Nạp để xem";
  load.addEventListener("click", () => loadSavedDesign(design));
  const upload = document.createElement("button");
  upload.className = "button primary";
  upload.textContent = "Đưa lên Merch";
  upload.addEventListener("click", () => loadSavedDesign(design, { upload: true }));
  actions.append(load, upload);

  const mini = document.createElement("div");
  mini.className = "vault-mini-actions";
  const exportButton = document.createElement("button");
  exportButton.textContent = "Tải gói .merchflow";
  exportButton.addEventListener("click", () => exportSavedPackage(design));
  const remove = document.createElement("button");
  remove.className = "danger";
  remove.textContent = "Xoá";
  remove.addEventListener("click", () => deleteSavedDesign(design.id));
  mini.append(exportButton, remove);
  copy.append(title, description, meta, actions, mini);
  item.append(thumb, copy);
  return item;
}

async function renderVaultUI() {
  const { batchRun } = await chrome.storage.local.get("batchRun");
  const designs = await getSavedDesigns();
  const target = Math.max(1, Number(batchRun?.targetCount || $("batch-count").value || 10));
  const completed = Number(batchRun?.completedCount || 0);
  $("batch-progress").textContent = `${completed} / ${target}`;
  $("batch-progress-bar").style.width = `${Math.min(100, Math.round(completed / target * 100))}%`;
  $("vault-count").textContent = `${designs.length} mẫu đã lưu`;
  if (batchRun?.targetCount) $("batch-count").value = String(batchRun.targetCount);
  const active = batchRun && ["running", "paused", "failed"].includes(batchRun.status);
  $("batch-count").disabled = Boolean(active);
  $("batch-start").disabled = Boolean(active);
  $("batch-pause").disabled = !active;
  $("batch-stop").disabled = !active;
  $("batch-pause").textContent = batchRun?.status === "running" ? "Tạm dừng" : "Tiếp tục";
  const tone = batchRun?.status === "failed" ? "error" : batchRun?.status === "completed" ? "success" : "";
  setStatus("batch-status", batchRun?.lastMessage || "Chưa chạy batch. Mẫu sẽ lưu local trong extension, không dùng quota Amazon.", tone);

  const list = $("vault-list");
  list.replaceChildren();
  if (!designs.length) {
    const empty = document.createElement("div");
    empty.className = "vault-empty";
    empty.textContent = "Chưa có mẫu. Chọn số lượng rồi bấm “Bắt đầu làm liên tục”.";
    list.append(empty);
  } else {
    designs.forEach((design, index) => list.append(createVaultItem(design, designs.length - index)));
  }
  $("vault-export-all").disabled = !designs.length;
  $("vault-clear").disabled = !designs.length;
}

async function startBatchVault() {
  if (state.vaultBusy) return;
  state.vaultBusy = true;
  try {
    applyBookLoverDefaults({ clearIdea: true });
    await saveNicheProfile();
    const targetCount = Math.max(1, Math.min(25, Math.floor(Number($("batch-count").value) || 10)));
    clearListingForm("Batch đang lưu listing riêng trong Kho mẫu");
    clearFile();
    setStatus("batch-status", `Đang khởi động batch ${targetCount} mẫu book lovers…`, "info");
    const response = await chrome.runtime.sendMessage({ type: "MERCH_FLOW_BATCH_START_V1", targetCount });
    if (!response?.started) throw new Error(response?.error || "Không khởi động được batch");
    activatePanel("panel-vault");
    await renderVaultUI();
  } catch (error) {
    setStatus("batch-status", `Không chạy được batch: ${error.message}`, "error");
  } finally {
    state.vaultBusy = false;
  }
}

async function toggleBatchPause() {
  const { batchRun } = await chrome.storage.local.get("batchRun");
  const type = batchRun?.status === "running" ? "MERCH_FLOW_BATCH_PAUSE_V1" : "MERCH_FLOW_BATCH_RESUME_V1";
  const response = await chrome.runtime.sendMessage({ type });
  if (response?.error) setStatus("batch-status", response.error, "error");
  await renderVaultUI();
}

async function stopBatchVault() {
  await chrome.runtime.sendMessage({ type: "MERCH_FLOW_BATCH_STOP_V1" });
  await renderVaultUI();
}

async function resizeReference(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", .84);
}

async function setReference(file) {
  if (!file?.type.startsWith("image/")) return;
  try {
    state.referenceDataUrl = await resizeReference(file);
    state.referenceName = `${file.name.replace(/\.[^.]+$/, "")}-reference.jpg`;
    $("reference-label").textContent = `✓ ${file.name}`;
    $("clear-reference").classList.remove("is-hidden");
    await saveNicheProfile();
    setStatus("idea-status", "Đã lưu ảnh mẫu local. Ảnh này KHÔNG được gửi cho ChatGPT ở v0.9.11; chỉ nội dung trong ô DNA style mới ảnh hưởng prompt.", "success");
  } catch (error) {
    setStatus("idea-status", `Không đọc được ảnh tham chiếu: ${error.message}`, "error");
  }
}

async function clearReference() {
  state.referenceDataUrl = "";
  state.referenceName = "";
  $("reference-input").value = "";
  $("reference-label").textContent = "＋ Lưu mẫu thắng local (không gửi ChatGPT)";
  $("clear-reference").classList.add("is-hidden");
  await saveNicheProfile();
  setStatus("idea-status", "Đã xoá ảnh tham chiếu.");
}

async function cleanExpiredData() {
  const { pendingChatJob, pendingUpload, processedArtwork, finalArtwork, chatArtwork, batchRun } = await chrome.storage.local.get(["pendingChatJob", "pendingUpload", "processedArtwork", "finalArtwork", "chatArtwork", "batchRun"]);
  const remove = [];
  const activeBatchJob = batchRun?.currentJobId && pendingChatJob?.jobId === batchRun.currentJobId && ["running", "paused", "failed"].includes(batchRun.status);
  if (pendingChatJob && !activeBatchJob && !isFresh(pendingChatJob, CHAT_JOB_TTL)) remove.push("pendingChatJob");
  if (pendingUpload && !isFresh(pendingUpload, UPLOAD_TTL)) remove.push("pendingUpload");
  if (processedArtwork && !isFresh(processedArtwork, ARTWORK_TTL)) remove.push("processedArtwork");
  if (finalArtwork && !isFresh({ createdAt: finalArtwork.finalizedAt || finalArtwork.createdAt }, ARTWORK_TTL)) remove.push("finalArtwork");
  if (chatArtwork && !isFresh(chatArtwork, ARTWORK_TTL)) remove.push("chatArtwork");
  if (remove.length) await chrome.storage.local.remove(remove);
}

async function hydrate() {
  await cleanExpiredData();
  const { nicheProfile, lastListing, finalListing, processedArtwork, finalArtwork, chatArtwork, chatStatus, merchStatus, pendingChatJob, batchRun, savedDesigns } = await chrome.storage.local.get(["nicheProfile", "lastListing", "finalListing", "processedArtwork", "finalArtwork", "chatArtwork", "chatStatus", "merchStatus", "pendingChatJob", "batchRun", "savedDesigns"]);
  state.creativeMemory = Core.creativeMemoryFromSavedDesigns(savedDesigns || []);
  const shouldMigrateBookProfile = nicheProfile?.name?.trim() === DEFAULT_BOOK_PROFILE.name
    && nicheProfile?.profileVersion !== DEFAULT_BOOK_PROFILE.profileVersion;
  const resolvedProfile = shouldMigrateBookProfile
    ? { ...DEFAULT_BOOK_PROFILE, referenceDataUrl: nicheProfile?.referenceDataUrl || "", referenceName: nicheProfile?.referenceName || "" }
    : (nicheProfile?.name?.trim()
      ? nicheProfile
      : { ...DEFAULT_BOOK_PROFILE, referenceDataUrl: nicheProfile?.referenceDataUrl || "", referenceName: nicheProfile?.referenceName || "" });
  $("niche-name").value = resolvedProfile.name || DEFAULT_BOOK_PROFILE.name;
  $("winning-style").value = resolvedProfile.winningStyle || DEFAULT_BOOK_PROFILE.winningStyle;
  $("idea-language").value = resolvedProfile.language || DEFAULT_BOOK_PROFILE.language;
  $("idea-style").value = resolvedProfile.style || DEFAULT_BOOK_PROFILE.style;
  $("idea-audience").value = resolvedProfile.audience || DEFAULT_BOOK_PROFILE.audience;
  $("idea-avoid").value = resolvedProfile.avoid || DEFAULT_BOOK_PROFILE.avoid;
  state.referenceDataUrl = resolvedProfile.referenceDataUrl || "";
  state.referenceName = resolvedProfile.referenceName || "";
  if (state.referenceName) { $("reference-label").textContent = `✓ ${state.referenceName}`; $("clear-reference").classList.remove("is-hidden"); }
  if (!nicheProfile?.name?.trim() || shouldMigrateBookProfile) await chrome.storage.local.set({ nicheProfile: resolvedProfile });
  const activeBatchJobId = batchRun?.currentJobId && ["running", "paused", "failed"].includes(batchRun.status) ? batchRun.currentJobId : "";
  if (lastListing && !isCompleteListing(lastListing)) await chrome.storage.local.remove("lastListing");
  if (finalListing && !isCompleteListing(finalListing)) await chrome.storage.local.remove("finalListing");
  const restoredFinalMatches = finalListing && [finalArtwork?.jobId, processedArtwork?.jobId, chatArtwork?.jobId, pendingChatJob?.jobId].filter(Boolean).includes(finalListing.jobId);
  const restoredListing = restoredFinalMatches ? finalListing : lastListing;
  if (processedArtwork?.dataUrl && processedArtwork.storageKey && isFresh(processedArtwork, ARTWORK_TTL)) {
    try {
      const response = await fetch(processedArtwork.dataUrl);
      state.processedBlob = await response.blob();
      state.processedName = processedArtwork.name;
      state.processedStorageKey = processedArtwork.storageKey;
      state.processedAnalysis = processedArtwork.artworkAnalysis || null;
      state.sourceJobId = processedArtwork.jobId || "";
      state.sourceStorageKey = processedArtwork.sourceStorageKey || "";
      state.sourceArtworkRevision = Number(processedArtwork.artworkRevision || 0);
      state.sourceSessionNonce = String(processedArtwork.sessionNonce || "");
      state.sourceArtworkMessageIndex = Number(processedArtwork.artworkMessageIndex ?? -1);
      state.sourceKind = processedArtwork.source || (processedArtwork.sourceStorageKey ? "chatgpt" : "manual-upload");
      state.autoSource = state.sourceKind === "chatgpt";
      state.autoFinalizeArtwork = false;
      state.finalArtwork = finalArtwork?.storageKey === processedArtwork.storageKey ? finalArtwork : null;
      state.manualArtworkOverride = state.sourceKind !== "chatgpt";
      const target = TARGETS[processedArtwork.template] || TARGETS.tshirt;
      $("template").value = processedArtwork.template || "tshirt";
      $("output-size").textContent = `${target.width} × ${target.height} px · ${formatBytes(state.processedBlob.size)}`;
      renderProcessedPreview(state.processedBlob, target);
      $("download-image").disabled = false;
      $("artwork-source").textContent = state.finalArtwork ? `Artwork cuối: ${state.finalArtwork.source === "chatgpt" ? "ChatGPT" : state.finalArtwork.source === "clipboard" ? "clipboard" : state.finalArtwork.source === "vault" ? "Kho mẫu" : "manual"}` : "Đã có preview · chưa chốt artwork";
      updateFinalActionState();
    } catch (_) { await chrome.storage.local.remove("processedArtwork"); }
  } else if (processedArtwork && !processedArtwork.storageKey) {
    await chrome.storage.local.remove("processedArtwork");
  }
  if (restoredListing?.jobId !== activeBatchJobId && (!isChatGPTListing(restoredListing) || listingMatchesArtworkBinding(restoredListing, currentArtworkBinding()))) {
    applyListing(restoredListing, restoredListing?.source === "manual" ? "nhập tay" : restoredListing?.source === "pasted_json" ? "JSON thủ công" : restoredListing?.source === "chatgpt-selected" ? "ChatGPT đã chốt" : "ChatGPT đúng artwork");
  }
  if (chatStatus) setStatus("idea-status", chatStatus.message, chatStatus.tone);
  if (merchStatus) setStatus("image-status", merchStatus.message, merchStatus.tone);
  if (pendingChatJob && isFresh(pendingChatJob, CHAT_JOB_TTL)) {
    state.promptJobId = pendingChatJob.jobId;
    $("send-chatgpt").textContent = pendingChatJob.status === "draft" ? "Gửi job đã copy ↗" : "Thử gửi lại job ↗";
  } else {
    state.promptJobId = crypto.randomUUID();
  }
  refreshPrompt();
  const processedMatchesChat = Boolean(chatArtwork?.storageKey && processedArtwork?.sourceStorageKey === chatArtwork.storageKey);
  const manualProcessedActive = Boolean(processedArtwork?.dataUrl && processedArtwork?.source && processedArtwork.source !== "chatgpt" && processedArtwork.jobId === (finalArtwork?.jobId || processedArtwork.jobId));
  if (chatArtwork?.dataUrl && !processedMatchesChat && !manualProcessedActive && chatArtwork.jobId !== activeBatchJobId) await loadChatArtwork(chatArtwork, true);
  else if (!activeBatchJobId) await maybeAutoStartMerch();
  await renderVaultUI();
  if (batchRun && ["running", "paused", "failed"].includes(batchRun.status)) activatePanel("panel-vault");
  updateListingTitleCount();
  updateFinalActionState();
  await updateFlowUI();
}

function activatePanel(panelId) {
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.getAttribute("aria-controls") === panelId;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    const active = panel.id === panelId;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => activatePanel(tab.getAttribute("aria-controls"))));
}

$("file-input").addEventListener("change", (event) => setManualSourceFile(event.target.files[0], "manual-upload"));
$("pick-image-manual").addEventListener("click", () => $("file-input").click());
$("paste-image").addEventListener("click", pasteImageFromClipboard);
$("clear-file").addEventListener("click", clearFile);
$("process-image").addEventListener("click", () => processImage(++state.processingId));
$("finalize-artwork").addEventListener("click", finalizeArtwork);
$("download-image").addEventListener("click", downloadPng);
$("save-final-design").addEventListener("click", saveCurrentDesignToVault);
$("upload-merch").addEventListener("click", uploadToMerch);
["template", "fit-mode", "safe-margin", "winner-white-only", "remove-white"].forEach((id) => $(id).addEventListener("change", scheduleReprocess));
["niche-name", "winning-style", "idea", "idea-language", "idea-style", "idea-audience", "idea-avoid"].forEach((id) => $(id).addEventListener("input", () => { refreshPrompt(); saveNicheProfile(); }));
$("generate-brief").addEventListener("click", refreshPrompt);
$("copy-prompt").addEventListener("click", copyPrompt);
$("send-chatgpt").addEventListener("click", sendToChatGPT);
$("import-listing").addEventListener("click", importListing);
$("fill-listing").addEventListener("click", fillListingOnMerch);
$("save-final-listing").addEventListener("click", () => saveFinalListing("manual"));
$("apply-listing-json").addEventListener("click", () => applyManualListingJson());
$("paste-listing-json").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    $("listing-raw-json").value = text;
    await applyManualListingJson(text);
  } catch (error) {
    setStatus("image-status", `Không đọc được clipboard text: ${error.message}`, "error");
  }
});
$("copy-final-json").addEventListener("click", async () => {
  const listing = isCompleteListing(state.listing) && !state.listingDirty ? state.listing : await saveFinalListing("manual");
  if (!listing) return;
  const payload = { merch_flow: true, job_id: listing.jobId, title: listing.title, brand: listing.brand, bullet1: listing.bullet1, bullet2: listing.bullet2, description: listing.description };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  setStatus("image-status", "Đã copy JSON cuối.", "success");
});
["listing-title", "listing-brand", "listing-bullet1", "listing-bullet2", "listing-description"].forEach((id) => $(id).addEventListener("input", () => {
  state.listingDirty = true;
  $("listing-source").textContent = "Đã sửa tay · chưa lưu";
  updateListingTitleCount();
  updateFinalActionState();
}));
$("reference-input").addEventListener("change", (event) => setReference(event.target.files[0]));
$("clear-reference").addEventListener("click", clearReference);
$("resume-flow").addEventListener("click", resumeCurrentFlow);
$("regenerate-flow").addEventListener("click", regenerateArtwork);
$("auto-book-flow").addEventListener("click", startBookLoverAutoFlow);
$("cancel-auto-flow").addEventListener("click", cancelAutoFlow);
$("batch-start").addEventListener("click", startBatchVault);
$("batch-pause").addEventListener("click", toggleBatchPause);
$("batch-stop").addEventListener("click", stopBatchVault);
$("vault-export-all").addEventListener("click", exportAllSavedZip);
$("vault-import").addEventListener("change", (event) => importSavedPackage(event.target.files?.[0]));
$("vault-clear").addEventListener("click", clearSavedDesigns);

const dropzone = $("dropzone");
["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("is-dragover"); }));
["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("is-dragover"); }));
dropzone.addEventListener("drop", (event) => setManualSourceFile(event.dataTransfer.files[0], "manual-upload"));
window.addEventListener("paste", async (event) => {
  if (document.activeElement === $("listing-raw-json") || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type?.startsWith("image/"));
  const file = item?.getAsFile?.();
  if (!file) return;
  event.preventDefault();
  await setManualSourceFile(file, "clipboard");
  setStatus("image-status", "Đã nhận ảnh bằng Ctrl+V. Bấm Chuẩn hoá ảnh rồi Chốt ảnh này.", "success");
});

async function handleStorageChanges(changes, area) {
  if (area !== "local") return;
  if (changes.savedDesigns) {
    state.creativeMemory = Core.creativeMemoryFromSavedDesigns(changes.savedDesigns.newValue || []);
    refreshPrompt();
  }
  if (changes.chatStatus?.newValue) setStatus("idea-status", changes.chatStatus.newValue.message, changes.chatStatus.newValue.tone);
  if (changes.merchStatus?.newValue) setStatus("image-status", changes.merchStatus.newValue.message, changes.merchStatus.newValue.tone);
  const { batchRun } = await chrome.storage.local.get("batchRun");
  const batchJobId = batchRun?.currentJobId && ["running", "paused", "failed"].includes(batchRun.status) ? batchRun.currentJobId : "";

  if (changes.chatArtwork?.newValue && changes.chatArtwork.newValue.jobId !== batchJobId) {
    const incomingArtwork = changes.chatArtwork.newValue;
    if (state.manualArtworkOverride && state.sourceJobId === incomingArtwork.jobId) {
      setStatus("image-status", "ChatGPT vừa trả thêm một ảnh, nhưng đã bỏ qua vì artwork thủ công đang được khóa làm bản hiện tại.", "info");
    } else {
      activatePanel("panel-image");
      await loadChatArtwork(incomingArtwork, true);
    }
  }
  if (changes.lastListing && !changes.lastListing.newValue && !batchJobId) {
    const { finalListing } = await chrome.storage.local.get("finalListing");
    const keepManualFinal = finalListing && ["manual", "pasted_json"].includes(finalListing.source) &&
      (!state.sourceJobId || !finalListing.jobId || finalListing.jobId === state.sourceJobId);
    if (keepManualFinal) {
      applyListing(finalListing, finalListing.source === "pasted_json" ? "JSON thủ công" : "nhập tay");
    } else {
      clearListingForm("Đang chờ listing mới khớp artwork mới nhất");
    }
  }
  if (changes.lastListing?.newValue && changes.lastListing.newValue.jobId !== batchJobId) {
    const listing = changes.lastListing.newValue;
    const { finalListing } = await chrome.storage.local.get("finalListing");
    const manualFinalLocked = finalListing?.jobId === listing.jobId && ["manual", "pasted_json"].includes(finalListing?.source) && !["manual", "pasted_json"].includes(listing?.source);
    if (manualFinalLocked) {
      applyListing(finalListing, finalListing.source === "pasted_json" ? "JSON thủ công" : "nhập tay");
      setStatus("image-status", "ChatGPT vừa trả listing mới, nhưng listing thủ công đã chốt nên không bị ghi đè.", "info");
    } else {
      const binding = currentArtworkBinding();
      if (isChatGPTListing(listing) && state.sourceJobId && !listingMatchesArtworkBinding(listing, binding)) {
        setStatus("image-status", "Đã bỏ qua listing ChatGPT cũ vì không khớp artwork revision/session hiện tại.", "info");
        return;
      }
      const applied = applyListing(listing, listing?.source === "manual" ? "nhập tay" : listing?.source === "pasted_json" ? "JSON thủ công" : listing?.source === "chatgpt-selected" ? "ChatGPT đã chốt" : "ChatGPT", state.sourceJobId || "", isChatGPTListing(listing) && state.sourceJobId ? binding : null);
      if (applied) {
        activatePanel("panel-image");
        $("send-chatgpt").textContent = "Tìm ý tưởng + vẽ ↗";
        const matchedArtwork = state.sourceJobId && state.sourceJobId === listing.jobId;
        const nextStep = ["manual", "pasted_json"].includes(listing?.source)
          ? "Đã chốt listing thủ công. Artwork hiện tại sẽ không bị ép tạo lại."
          : matchedArtwork
            ? "Đã lấy listing đúng artwork. Extension đang chuẩn hoá và tự chuyển sang Merch."
            : "Đã lấy listing. Đang chờ artwork cùng Job ID từ ChatGPT.";
        setStatus("image-status", nextStep, "success");
        await maybeAutoStartMerch();
      }
      if (listing.jobId === state.promptJobId && !["manual", "pasted_json"].includes(listing?.source)) {
        state.promptJobId = crypto.randomUUID();
        refreshPrompt();
      }
    }
  }
  if (changes.batchRun || changes.savedDesigns) await renderVaultUI();
  if (["pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing", "finalListing", "processedArtwork", "finalArtwork", "pendingUpload", "merchStatus", "chatStatus", "autoRun", "batchRun", "savedDesigns", "flowCancel"].some((key) => changes[key])) await updateFlowUI();
}

chrome.storage.onChanged.addListener((changes, area) => {
  handleStorageChanges(changes, area).catch((error) => console.error("Merch Flow storage update failed", error));
});

setupTabs();
hydrate();
