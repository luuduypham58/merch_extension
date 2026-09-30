(function merchFlowMerch() {
  const Core = globalThis.MerchFlowCore;
  const SCRIPT_VERSION = "0.9.33";
  if (!Core || globalThis.__MERCH_FLOW_MERCH_SCRIPT_VERSION__ === SCRIPT_VERSION) return;
  globalThis.__MERCH_FLOW_MERCH_SCRIPT_VERSION__ = SCRIPT_VERSION;
  globalThis.__MERCH_FLOW_MERCH_SCRIPT_READY__ = true;

  const FORM_WAIT_MS = 12000;
  const VERIFY_WAIT_MS = 12000;
  const UPLOAD_TTL_MS = 30 * 60 * 1000;
  const PRODUCT_LIMIT = 10;
  const PRODUCT_MARKETPLACE = ".com";
  const PRODUCT_SELECTION_POLICY = "adaptive-book-v3";
  const PRODUCT_SELECTION_MAX_FAILURES = 3;
  const LISTING_READY_TIMEOUT_MS = 2 * 60 * 1000;
  const REVIEW_READY_TIMEOUT_MS = 45 * 1000;
  const fileCache = new Map();
  const runningUploads = new Map();
  const runtimeInstanceToken = crypto.randomUUID();
  const runtimeDocumentToken = String(performance.timeOrigin || location.href);
  let runtimeTakeoverPending = true;
  let listingBusy = false;
  let listingBusySince = 0;
  let listingDebounce = 0;
  let listingInterval = 0;
  let listingObserver = null;
  let productSelectionBusy = false;

  const runtimeRegistration = chrome.runtime.sendMessage({
    type: "MERCH_FLOW_REGISTER_MERCH_TAB_V1",
    version: SCRIPT_VERSION,
    instanceToken: runtimeInstanceToken,
    documentToken: runtimeDocumentToken
  }).then((result) => {
    runtimeTakeoverPending = Boolean(result?.reloading);
    return result || {};
  }).catch(() => {
    // A transient service-worker restart must not strand the page forever.
    runtimeTakeoverPending = false;
    return {};
  });


  async function isJobCancelled(jobId) {
    if (!jobId) return false;
    const { flowCancel } = await chrome.storage.local.get("flowCancel");
    return Boolean(flowCancel?.jobId === jobId && flowCancel?.cancelledAt);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!element) return false;
    try {
      const view = element.ownerDocument?.defaultView || window;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  function toast(message, tone = "info") {
    const existing = document.getElementById("merch-flow-toast");
    if (existing) existing.remove();
    const node = document.createElement("div");
    node.id = "merch-flow-toast";
    node.textContent = message;
    node.style.cssText = `position:fixed;z-index:2147483647;right:18px;bottom:18px;max-width:380px;padding:12px 14px;border-radius:10px;background:${tone === "error" ? "#7f241d" : tone === "info" ? "#29431d" : "#1d3216"};color:#f5fff1;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px #0005`;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 8000);
  }

  async function setMerchStatus(message, tone = "info", uploadId = "") {
    const { pendingUpload, autoRun } = await chrome.storage.local.get(["pendingUpload", "autoRun"]);
    const jobId = pendingUpload?.uploadId === uploadId ? (pendingUpload.jobId || "") : "";
    if (jobId && await isJobCancelled(jobId)) return;
    const update = { merchStatus: { message, tone, uploadId, jobId, updatedAt: Date.now() } };
    if (autoRun?.jobId === jobId) {
      let status = autoRun.status || "merch";
      if (tone === "error") status = "needs-attention";
      else if (/điền đủ 5\/5|AUTO A→Z hoàn tất/i.test(message)) status = "review";
      else if (/chọn .*sản phẩm|Select Products/i.test(message)) status = "selecting-products";
      else if (/listing/i.test(message)) status = "filling-listing";
      else if (/artwork|PNG/i.test(message)) status = "uploading-artwork";
      update.autoRun = { ...autoRun, status, lastMessage: message, updatedAt: Date.now() };
    }
    await chrome.storage.local.set(update);
  }

  async function updateUpload(uploadId, patch) {
    const { pendingUpload } = await chrome.storage.local.get("pendingUpload");
    if (!pendingUpload || pendingUpload.uploadId !== uploadId) throw new Error("Không còn upload job cần xử lý");
    if (await isJobCancelled(pendingUpload.jobId)) throw new Error("AUTO đã bị hủy");
    /* cancellation guard */
    if (!pendingUpload || pendingUpload.uploadId !== uploadId) return null;
    const next = { ...pendingUpload, ...patch, lastAttemptAt: Date.now() };
    await chrome.storage.local.set({ pendingUpload: next });
    return next;
  }

  async function failUpload(uploadId, error) {
    const failed = await updateUpload(uploadId, { status: "failed", lastError: error });
    if (failed?.flowKey) {
      const { lastAutoUpload } = await chrome.storage.local.get("lastAutoUpload");
      if (lastAutoUpload?.key === failed.flowKey) await chrome.storage.local.remove("lastAutoUpload");
    }
    await setMerchStatus(`Chưa chèn được artwork: ${error}. Job vẫn được giữ để thử lại.`, "error", uploadId);
    toast(`Merch Flow: ${error}`, "error");
  }

  function compactText(value, limit = 1600) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function collectSearchRoots() {
    const roots = [];
    const queue = [document];
    const seen = new Set();
    while (queue.length) {
      const root = queue.shift();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
      let elements = [];
      try { elements = [...root.querySelectorAll("*")]; } catch (_) { elements = []; }
      for (const element of elements) {
        if (element.shadowRoot) queue.push(element.shadowRoot);
        if (element.tagName === "IFRAME") {
          try {
            if (element.contentDocument?.documentElement) queue.push(element.contentDocument);
          } catch (_) {}
        }
      }
    }
    return roots;
  }

  function queryAllDeep(selector) {
    const found = [];
    const seen = new Set();
    for (const root of collectSearchRoots()) {
      let elements = [];
      try { elements = root.querySelectorAll(selector); } catch (_) { elements = []; }
      for (const element of elements) {
        if (!seen.has(element)) {
          seen.add(element);
          found.push(element);
        }
      }
    }
    return found;
  }

  function findLabelFor(input) {
    if (!input) return null;
    const root = input.getRootNode?.() || input.ownerDocument || document;
    if (input.id) {
      try {
        const direct = root.querySelector?.(`label[for="${cssEscape(input.id)}"]`)
          || input.ownerDocument?.querySelector?.(`label[for="${cssEscape(input.id)}"]`);
        if (direct) return direct;
      } catch (_) {}
    }
    return input.closest?.("label") || null;
  }

  function fieldContextText(element) {
    const parts = [];
    let current = element.parentElement;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      const text = compactText(current.innerText || current.textContent, 1200);
      if (text) parts.push(text);
    }
    return parts.join(" ");
  }

  function uploadControlVisible(input) {
    if (isVisible(input)) return true;
    const label = findLabelFor(input);
    if (isVisible(label)) return true;
    let current = input.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = compactText(current.innerText || current.textContent, 1600);
      if (isVisible(current) && /(artwork|design|upload|drag and drop|browse|choose file)/i.test(text)) return true;
    }
    return false;
  }

  function artworkContextText(input) {
    const parts = [];
    const label = findLabelFor(input);
    if (label) parts.push(compactText(label.innerText || label.textContent, 500));
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const root = input.getRootNode?.() || input.ownerDocument || document;
      for (const id of labelledBy.split(/\s+/)) {
        try {
          const node = root.getElementById?.(id) || input.ownerDocument?.getElementById?.(id);
          if (node) parts.push(compactText(node.innerText || node.textContent, 500));
        } catch (_) {}
      }
    }
    let current = input.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = compactText(current.innerText || current.textContent, 1800);
      if (text) parts.push(text);
      if (/(artwork|drag and drop|upload.*(png|artwork|design)|browse.*file|choose.*file)/i.test(text)) break;
    }
    return parts.join(" ");
  }

  function artworkDescriptors() {
    return queryAllDeep('input[type="file"]').map((input, index) => ({
      id: input.id || input.name || `merch-file-${index}`,
      kind: "file",
      accept: input.accept || input.getAttribute("accept") || "",
      name: input.name,
      ariaLabel: input.getAttribute("aria-label"),
      testId: input.getAttribute("data-testid"),
      labelText: compactText(findLabelFor(input)?.textContent, 500),
      contextText: artworkContextText(input),
      visible: isVisible(input),
      linkedControlVisible: uploadControlVisible(input),
      disabled: input.disabled,
      element: input
    }));
  }

  function pageLooksLikeArtworkUpload() {
    const text = compactText(document.body?.innerText || document.body?.textContent, 12000);
    return /create products/i.test(text)
      && /(drag and drop artwork here|click to browse for a file|artwork should be|view artwork guidelines)/i.test(text);
  }

  function resolveArtworkInput() {
    const descriptors = artworkDescriptors();
    const resolved = Core.resolveArtworkInput(descriptors);
    if (resolved.input) return resolved;

    const plausible = descriptors.filter((descriptor) => {
      if (descriptor.disabled) return false;
      const accept = compactText(descriptor.accept).toLowerCase();
      return !accept || /(image|png|jpe?g|webp|\.png|\.jpe?g)/.test(accept);
    });
    if (pageLooksLikeArtworkUpload() && plausible.length === 1) {
      return { input: plausible[0], error: "", fallback: "single-file-input" };
    }
    const contextual = plausible
      .map((descriptor) => ({
        descriptor,
        score: (/(artwork|drag and drop|browse.*file|upload.*png|design)/i.test(descriptor.contextText || "") ? 20 : 0)
          + (descriptor.linkedControlVisible ? 8 : 0)
          + (descriptor.visible ? 4 : 0)
      }))
      .sort((left, right) => right.score - left.score);
    if (contextual[0]?.score >= 20 && (!contextual[1] || contextual[0].score > contextual[1].score)) {
      return { input: contextual[0].descriptor, error: "", fallback: "context" };
    }
    return { ...resolved, descriptors };
  }

  function uploadContainer(element) {
    let current = element;
    let best = element?.parentElement || element || document.body;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const text = compactText(current.innerText || current.textContent, 2200).toLowerCase();
      if (/(artwork|drag and drop|upload.*(png|artwork|design)|browse.*file|choose.*file)/.test(text)) best = current;
      if (text.length > 2000 && best !== element) break;
    }
    return best || document.body;
  }

  function findUploadZone() {
    const elements = new Set();
    const phrase = /(drag and drop artwork here|click to browse for a file|artwork should be|upload artwork|browse.*file)/i;
    for (const root of collectSearchRoots()) {
      const doc = root.nodeType === 9 ? root : root.ownerDocument || root.host?.ownerDocument || document;
      let walker;
      try { walker = doc.createTreeWalker(root, 4); } catch (_) { walker = null; }
      if (!walker) continue;
      let node = walker.nextNode();
      while (node) {
        if (phrase.test(compactText(node.nodeValue, 500))) {
          let current = node.parentElement;
          for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) elements.add(current);
        }
        node = walker.nextNode();
      }
    }
    const candidates = [...elements]
      .filter((element) => isVisible(element))
      .map((element) => {
        const text = compactText(element.innerText || element.textContent, 700);
        let score = 0;
        if (/drag and drop artwork here/i.test(text)) score += 100;
        if (/click to browse for a file/i.test(text)) score += 90;
        if (/artwork should be/i.test(text)) score += 35;
        if (/upload artwork/i.test(text)) score += 45;
        if (/browse.*file/i.test(text)) score += 30;
        if (text.length > 450) score -= 30;
        const rect = element.getBoundingClientRect();
        const area = Math.max(1, rect.width * rect.height);
        return { element, text, score, area };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.area - right.area || left.text.length - right.text.length);
    return candidates[0]?.element || null;
  }

  function inputNearZone(zone, descriptors) {
    if (!zone || !descriptors?.length) return null;
    const related = descriptors.filter(({ element }) => {
      if (zone.contains?.(element) || element.contains?.(zone)) return true;
      let current = zone.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        if (current.contains?.(element)) return true;
      }
      return false;
    });
    return related.length === 1 ? related[0].element : null;
  }

  function findArtworkTarget() {
    const resolved = resolveArtworkInput();
    if (resolved.input?.element) {
      const input = resolved.input.element;
      return { kind: "input", element: input, input, container: uploadContainer(input), reason: resolved.fallback || "scored-input" };
    }
    const zone = findUploadZone();
    if (zone) {
      const nearby = inputNearZone(zone, resolved.descriptors || artworkDescriptors());
      if (nearby) return { kind: "input", element: nearby, input: nearby, container: uploadContainer(zone), reason: "zone-input" };
      return { kind: "dropzone", element: zone, input: null, container: uploadContainer(zone), reason: "dropzone" };
    }
    return null;
  }

  function artworkRemoveButton() {
    const candidates = queryAllDeep("button, [role='button']")
      .filter((element) => isVisible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
      .map((element) => {
        const label = compactText(`${element.innerText || element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("data-testid") || ""}`, 300).toLowerCase();
        const iconText = compactText([...element.querySelectorAll?.("svg, use, path") || []]
          .map((node) => `${node.getAttribute?.("data-icon") || ""} ${node.getAttribute?.("href") || ""} ${node.getAttribute?.("xlink:href") || ""}`)
          .join(" "), 300).toLowerCase();
        const context = fieldContextText(element).toLowerCase();
        let score = 0;
        if (/remove artwork|delete artwork|clear artwork|remove design|delete design/.test(label)) score += 100;
        if (/(remove|delete|clear|trash)/.test(label) && /(artwork|design|upload)/.test(context)) score += 60;
        if (/(trash|delete|remove)/.test(iconText) && /(artwork should be|upload artwork|create products)/.test(context)) score += 45;
        if (element.closest?.("[data-testid*='artwork' i], [class*='artwork' i], [id*='artwork' i]")) score += 25;
        return { element, score };
      })
      .filter((candidate) => candidate.score >= 60)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  }

  async function clearExistingArtworkIfNeeded(uploadId) {
    const remove = artworkRemoveButton();
    if (!remove) return false;
    await setMerchStatus("Đang gỡ artwork cũ để bảo đảm design mới nằm trên sản phẩm…", "info", uploadId);
    remove.scrollIntoView?.({ block: "center" });
    remove.click();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      if (!isVisible(remove) || /drag and drop artwork here|click to browse for a file/i.test(compactText(document.body?.innerText || document.body?.textContent, 12000))) {
        await sleep(300);
        return true;
      }
      await sleep(250);
    }
    return true;
  }

  function artworkEvidenceRoots(target) {
    const roots = [];
    const add = (node) => {
      if (!node || node === document.body || node === document.documentElement || roots.includes(node)) return;
      roots.push(node);
    };
    const container = target?.container || uploadContainer(target?.element);
    add(container);
    let current = container?.parentElement;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const text = compactText(current.innerText || current.textContent, 8000).toLowerCase();
      if (/(artwork|upload|create products|product preview|design)/.test(text) && text.length < 8000) add(current);
      if (roots.length >= 2) break;
    }
    return roots;
  }

  function artworkTargetSnapshot(target) {
    const roots = artworkEvidenceRoots(target);
    const visuals = [];
    const texts = [];
    for (const root of roots) {
      texts.push(compactText(root.innerText || root.textContent, 8000).toLowerCase());
      for (const element of [...root.querySelectorAll?.("img, canvas") || []]) {
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width < 80 || rect.height < 80) continue;
        if (element instanceof HTMLCanvasElement) visuals.push(`canvas:${element.width}x${element.height}`);
        else visuals.push(`${element.currentSrc || element.src || ""}|${element.naturalWidth || 0}x${element.naturalHeight || 0}`);
      }
    }
    return { visualFingerprint: [...new Set(visuals)].sort().join("\n"), text: texts.join(" ") };
  }

  async function waitForArtworkTarget() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < FORM_WAIT_MS) {
      const target = findArtworkTarget();
      if (target) return target;
      await sleep(350);
    }
    throw new Error("Không tìm thấy vùng tải artwork trên trang Amazon");
  }

  async function getFileForUpload(upload) {
    if (fileCache.has(upload.uploadId)) return fileCache.get(upload.uploadId);
    const promise = (async () => {
      const { processedArtwork } = await chrome.storage.local.get("processedArtwork");
      if (!processedArtwork?.dataUrl || processedArtwork.storageKey !== upload.artworkStorageKey) {
        throw new Error("Không tìm thấy artwork đã chuẩn hoá cho job này");
      }
      const response = await fetch(processedArtwork.dataUrl);
      const blob = await response.blob();
      return new File([blob], upload.name || processedArtwork.name || "merch-flow.png", { type: "image/png", lastModified: Date.now() });
    })();
    fileCache.set(upload.uploadId, promise);
    return promise;
  }

  function makeTransfer(file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    return transfer;
  }

  function setFile(input, file) {
    if (!input) return false;
    const transfer = makeTransfer(file);
    try {
      const view = input.ownerDocument?.defaultView || window;
      const Input = view.HTMLInputElement || HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(Input.prototype, "files")?.set;
      if (setter) setter.call(input, transfer.files);
      else input.files = transfer.files;
    } catch (_) {
      try { input.files = transfer.files; } catch (_) { return false; }
    }
    const assigned = isSameFile(input, file);
    for (const type of ["input", "change"]) {
      input.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    }
    return assigned;
  }

  function isSameFile(input, file) {
    const selected = input?.files?.[0];
    return Boolean(selected && selected.name === file.name && selected.size === file.size);
  }

  function createDragEvent(type, transfer) {
    try {
      return new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer });
    } catch (_) {
      const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(event, "dataTransfer", { value: transfer });
      return event;
    }
  }

  function dispatchDrop(element, file) {
    if (!element) return false;
    const transfer = makeTransfer(file);
    const targets = [];
    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) targets.push(current);
    let dispatched = false;
    for (const target of targets) {
      for (const type of ["dragenter", "dragover", "drop"]) {
        try {
          target.dispatchEvent(createDragEvent(type, transfer));
          dispatched = true;
        } catch (_) {}
      }
    }
    return dispatched;
  }

  function uploadError(container) {
    const localText = compactText(container?.innerText || container?.textContent, 5000);
    const pageText = compactText(document.body?.innerText || document.body?.textContent, 15000);
    const text = `${localText} ${pageText}`;
    const match = text.match(/(?:upload (?:failed|error)|unable to upload|invalid png|please upload a valid png|file is too large|unsupported file|tải lên thất bại|không thể tải|png không hợp lệ|tệp quá lớn|tệp không được hỗ trợ)[^.]{0,180}/i);
    return match?.[0] || "";
  }

  function artworkAccepted(target, file, baseline) {
    const container = target.container || uploadContainer(target.element);
    const localText = container && container !== document.body && container !== document.documentElement
      ? compactText(container.innerText || container.textContent, 5000).toLowerCase()
      : "";
    const current = artworkTargetSnapshot(target);
    const scopedText = `${localText} ${current.text}`.trim();
    const name = file.name.toLowerCase();
    const stem = name.replace(/\.[^.]+$/, "");
    const nameShown = scopedText.includes(name) || (stem.length > 4 && scopedText.includes(stem));
    const newProcessingSignal = /(upload complete|upload successful|processing artwork|artwork uploaded|processing your design)/.test(scopedText)
      && !/(upload complete|upload successful|processing artwork|artwork uploaded|processing your design)/.test(baseline.text || "");
    const previewChanged = Boolean(current.visualFingerprint && current.visualFingerprint !== baseline.visualFingerprint);
    return nameShown || newProcessingSignal || previewChanged;
  }

  async function verifyArtworkAccepted(target, file, baseline) {
    const container = target.container || uploadContainer(target.element);
    const startedAt = Date.now();
    let positiveSince = 0;
    while (Date.now() - startedAt < VERIFY_WAIT_MS) {
      const error = uploadError(container);
      if (error) throw new Error(error);
      if (artworkAccepted(target, file, baseline)) {
        if (!positiveSince) positiveSince = Date.now();
        // Amazon can render a temporary preview before server-side PNG validation
        // finishes. Require a stable positive window so a later error cannot be
        // reported as a completed AUTO run.
        if (Date.now() - positiveSince >= 1800) return { verified: true, optimistic: false };
      } else {
        positiveSince = 0;
      }
      await sleep(400);
    }
    return { verified: false, optimistic: true, pickerRetainedFile: isSameFile(target.input, file) };
  }

  function fieldDescriptors() {
    return queryAllDeep("input:not([type]), input[type='text'], textarea")
      .filter((element) => !element.disabled)
      .map((element, index) => ({
        id: element.id || `merch-listing-${index}`,
        kind: element.tagName.toLowerCase(),
        name: element.name,
        placeholder: element.placeholder,
        ariaLabel: element.getAttribute("aria-label"),
        testId: element.getAttribute("data-testid"),
        labelText: compactText(findLabelFor(element)?.textContent, 600),
        contextText: fieldContextText(element),
        disabled: element.disabled,
        element
      }));
  }

  function setNativeValue(element, value) {
    const view = element.ownerDocument?.defaultView || window;
    const TextArea = view.HTMLTextAreaElement || HTMLTextAreaElement;
    const Input = view.HTMLInputElement || HTMLInputElement;
    const prototype = element instanceof TextArea ? TextArea.prototype : Input.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    const InputEvt = view.InputEvent || InputEvent;
    const Evt = view.Event || Event;
    element.dispatchEvent(new InputEvt("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Evt("change", { bubbles: true, composed: true }));
    element.dispatchEvent(new Evt("blur", { bubbles: true, composed: true }));
  }

  function findSelectProductsButton() {
    return queryAllDeep("button, [role='button'], a").find((element) => {
      if (!isVisible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      const text = `${element.innerText || element.textContent || ""} ${element.getAttribute("aria-label") || ""}`.replace(/\s+/g, " ").trim();
      return /^select products?$/i.test(text) || /select products?/i.test(text);
    }) || null;
  }

  function highlightSelectProducts() {
    const button = findSelectProductsButton();
    if (!button) return false;
    button.dataset.merchFlowHighlight = "true";
    button.style.outline = "3px solid #9de25a";
    button.style.outlineOffset = "3px";
    button.style.borderRadius = "6px";
    button.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      if (button.dataset.merchFlowHighlight === "true") {
        button.style.outline = "";
        button.style.outlineOffset = "";
        delete button.dataset.merchFlowHighlight;
      }
    }, 12000);
    return true;
  }

  function findReviewPublishControl() {
    const candidates = queryAllDeep("button, [role='button'], input[type='submit'], a")
      .filter((element) => isVisible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
      .map((element) => {
        const text = compactText(`${element.innerText || element.textContent || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`, 220).toLowerCase();
        let score = 0;
        if (/review and (?:submit|publish)|review & (?:submit|publish)/.test(text)) score += 130;
        if (/publish products?|submit products?/.test(text)) score += 120;
        if (/review products?/.test(text)) score += 95;
        if (/submit for review/.test(text)) score += 90;
        if (/^publish$|^submit$|^review$/.test(text)) score += 55;
        if (/select products?|edit details|cancel|delete|remove/.test(text)) score -= 100;
        return { element, score };
      })
      .filter((candidate) => candidate.score >= 55)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  }

  function findSavePublishSettingsControl() {
    return queryAllDeep("button, [role='button'], input[type='button'], input[type='submit']").find((element) => {
      if (!isVisible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      const text = compactText(`${element.innerText || element.textContent || ""} ${element.value || ""}`, 120);
      return /^save publish settings$/i.test(text);
    }) || null;
  }

  function liveArtworkPresent() {
    const text = compactText(document.body?.innerText || document.body?.textContent, 16000);
    if (/please upload a valid png|upload a different file/i.test(text)) return false;
    if (/drag and drop artwork here|click to browse for a file/i.test(text)) return false;
    return /artwork should be/i.test(text) && /standard t-shirt/i.test(text) && /edit details/i.test(text);
  }

  async function waitForLiveArtwork(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (liveArtworkPresent()) return true;
      await sleep(250);
    }
    return liveArtworkPresent();
  }

  async function ensureReviewPublishControl(uploadId) {
    let review = findReviewPublishControl();
    if (review) return review;
    const save = findSavePublishSettingsControl();
    if (!save) return null;
    await setMerchStatus("Đã đủ artwork, sản phẩm và listing; đang lưu Publish settings trước khi bàn giao…", "info", uploadId);
    save.click();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      if (uploadError(findArtworkTarget()?.container || document.body)) return null;
      review = findReviewPublishControl();
      if (review) return review;
      await sleep(300);
    }
    return null;
  }

  function highlightReviewPublishControl() {
    const control = findReviewPublishControl();
    if (!control) return false;
    control.dataset.merchFlowReview = "true";
    control.style.outline = "4px solid #9de25a";
    control.style.outlineOffset = "4px";
    control.style.boxShadow = "0 0 0 7px rgba(157,226,90,.18)";
    control.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      if (control.dataset.merchFlowReview === "true") {
        control.style.outline = "";
        control.style.outlineOffset = "";
        control.style.boxShadow = "";
        delete control.dataset.merchFlowReview;
      }
    }, 20000);
    return true;
  }


  function findProductDialog() {
    const direct = queryAllDeep("[role='dialog'], dialog, [aria-modal='true']").find((element) => {
      if (!isVisible(element)) return false;
      const text = compactText(element.innerText || element.textContent, 4000);
      return /select products?/i.test(text) && element.querySelector?.("input[type='checkbox'], [role='checkbox']");
    });
    if (direct) return direct;

    const heading = queryAllDeep("h1, h2, h3, [role='heading']").find((element) => {
      if (!isVisible(element)) return false;
      return /^select products?$/i.test(compactText(element.innerText || element.textContent, 200));
    });
    if (!heading) return null;
    let current = heading.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (current.querySelectorAll?.("input[type='checkbox'], [role='checkbox']").length >= 5) return current;
    }
    return null;
  }

  async function waitForProductDialog(timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const dialog = findProductDialog();
      if (dialog) return dialog;
      await sleep(250);
    }
    return null;
  }

  function checkboxState(checkbox) {
    if (!checkbox) return false;
    if (typeof checkbox.checked === "boolean") return checkbox.checked;
    return checkbox.getAttribute("aria-checked") === "true";
  }

  async function setCheckboxState(checkbox, desired) {
    if (!checkbox || checkbox.disabled || checkbox.getAttribute("aria-disabled") === "true") return false;
    if (checkboxState(checkbox) === desired) return true;
    checkbox.scrollIntoView?.({ block: "nearest" });
    if (checkbox instanceof HTMLInputElement) {
      // Amazon's current Angular Select Products grid cancels HTMLElement.click()
      // and its synchronous handler is very slow. Use the native property/events
      // first; click remains a fallback for other Amazon UI variants.
      const view = checkbox.ownerDocument?.defaultView || window;
      const Input = view.HTMLInputElement || HTMLInputElement;
      Object.getOwnPropertyDescriptor(Input.prototype, "checked")?.set?.call(checkbox, desired);
      const Evt = view.Event || Event;
      checkbox.dispatchEvent(new Evt("input", { bubbles: true, composed: true }));
      checkbox.dispatchEvent(new Evt("change", { bubbles: true, composed: true }));
      await sleep(120);
      if (checkboxState(checkbox) === desired) return true;
    }
    checkbox.click();
    await sleep(90);
    if (checkboxState(checkbox) === desired) return true;
    const label = findLabelFor(checkbox) || checkbox.closest?.("label");
    if (label && label !== checkbox) {
      label.click();
      await sleep(90);
    }
    return checkboxState(checkbox) === desired;
  }

  function checkboxControls(root) {
    if (!root) return [];
    const nativeInputs = [...root.querySelectorAll("input[type='checkbox']")];
    if (nativeInputs.length) return nativeInputs;
    return [...root.querySelectorAll("[role='checkbox']")];
  }

  function productTableModel(dialog) {
    const tables = [...dialog.querySelectorAll("table")];
    for (const table of tables) {
      const rows = [...table.querySelectorAll("tr")];
      let marketplaceIndex = -1;
      for (const row of rows) {
        const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
        const index = cells.findIndex((cell) => compactText(cell.innerText || cell.textContent, 100).toLowerCase() === PRODUCT_MARKETPLACE);
        if (index >= 0) {
          marketplaceIndex = index;
          break;
        }
      }
      if (marketplaceIndex < 1) continue;

      const products = [];
      const allLeafCheckboxes = [];
      for (const row of rows) {
        const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
        if (cells.length <= marketplaceIndex) continue;
        const name = compactText(cells[0]?.innerText || cells[0]?.textContent, 240);
        if (!name || /^all products$/i.test(name) || /select\s+all/i.test(name)) continue;
        const rowCheckboxes = cells.slice(1).flatMap((cell) => checkboxControls(cell));
        allLeafCheckboxes.push(...rowCheckboxes);
        const marketplaceCell = cells[marketplaceIndex];
        const checkbox = checkboxControls(marketplaceCell)[0] || null;
        products.push({
          name,
          checkbox,
          row,
          available: Boolean(checkbox && !checkbox.disabled && checkbox.getAttribute("aria-disabled") !== "true")
        });
      }
      if (products.length) return { table, products, allLeafCheckboxes: [...new Set(allLeafCheckboxes)] };
    }
    return { table: null, products: [], allLeafCheckboxes: [] };
  }

  function findNoneControl(dialog) {
    return [...dialog.querySelectorAll("button, a, [role='button']")].find((element) => {
      if (!isVisible(element)) return false;
      return /^none$/i.test(compactText(element.innerText || element.textContent, 80));
    }) || null;
  }

  function findProductDialogAction(dialog) {
    const candidates = [...dialog.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
      .filter((element) => isVisible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true")
      .map((element) => ({
        element,
        text: compactText(`${element.innerText || element.textContent || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""}`, 200).toLowerCase()
      }));
    const preferred = [
      /save selections?/, /save products?/, /^save$/, /^apply$/, /^done$/, /^confirm$/, /^continue$/, /select products?/
    ];
    for (const pattern of preferred) {
      const match = candidates.find((candidate) => pattern.test(candidate.text) && !/close|cancel|none|all/.test(candidate.text));
      if (match) return match.element;
    }
    return null;
  }

  async function waitForProductDialogAction(dialog, timeoutMs = 7000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const liveDialog = findProductDialog() || dialog;
      const action = liveDialog ? findProductDialogAction(liveDialog) : null;
      if (action) return { action, dialog: liveDialog };
      await sleep(200);
    }
    return { action: null, dialog: findProductDialog() || dialog };
  }

  function findDialogClose(dialog) {
    return [...dialog.querySelectorAll("button, [role='button']")].find((element) => {
      if (!isVisible(element)) return false;
      const text = compactText(`${element.innerText || element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`, 120).toLowerCase();
      return /^(x|×)$/.test(text) || /close|dismiss/.test(text);
    }) || null;
  }

  async function autoSelectTenProducts(pendingUpload) {
    if (productSelectionBusy) return { attempted: true, completed: false, busy: true };
    if (pendingUpload?.productsSelectedAt
      && pendingUpload.selectedProductCount === PRODUCT_LIMIT
      && pendingUpload.productSelectionPolicy === PRODUCT_SELECTION_POLICY) {
      return { attempted: false, completed: true, count: PRODUCT_LIMIT, primary: pendingUpload.selectedPrimaryProduct || "", alreadyDone: true };
    }

    const previousFailures = Math.max(0, Number(pendingUpload?.productSelectionFailures || 0));
    if (previousFailures >= PRODUCT_SELECTION_MAX_FAILURES) {
      return { attempted: false, completed: false, blocked: true, error: pendingUpload.productSelectionError || "Select Products đã lỗi nhiều lần" };
    }

    let dialog = findProductDialog();
    const selectButton = findSelectProductsButton();
    if (!dialog && !selectButton) return { attempted: false, completed: false };

    productSelectionBusy = true;
    try {
      await updateUpload(pendingUpload.uploadId, { status: "selecting-products", lastError: "" });
      await setMerchStatus(`Đang phân tích niche/listing và chọn ${PRODUCT_LIMIT} sản phẩm phù hợp ở ${PRODUCT_MARKETPLACE}…`, "info", pendingUpload.uploadId);
      if (!dialog) {
        selectButton.scrollIntoView?.({ block: "center" });
        selectButton.click();
        dialog = await waitForProductDialog(12000);
      }
      if (!dialog) throw new Error("Không mở được hộp Select Products; có thể nút còn bị Amazon khóa trong lúc xử lý artwork");

      let model = productTableModel(dialog);
      if (!model.products.length) throw new Error("Không đọc được bảng sản phẩm Amazon");
      let plan = Core.chooseProductPlan(model.products, PRODUCT_LIMIT, pendingUpload.productContext || { listing: pendingUpload.listing });
      const targets = plan.products;
      if (targets.length < PRODUCT_LIMIT) throw new Error(`Chỉ tìm thấy ${targets.length}/${PRODUCT_LIMIT} sản phẩm phù hợp và khả dụng ở ${PRODUCT_MARKETPLACE}`);

      const none = findNoneControl(dialog);
      if (none) {
        none.click();
        await sleep(700);
      }

      dialog = findProductDialog() || dialog;
      model = productTableModel(dialog);
      for (const checkbox of model.allLeafCheckboxes) {
        if (checkboxState(checkbox)) await setCheckboxState(checkbox, false);
      }

      dialog = findProductDialog() || dialog;
      model = productTableModel(dialog);
      plan = Core.chooseProductPlan(model.products, PRODUCT_LIMIT, pendingUpload.productContext || { listing: pendingUpload.listing });
      const targetNames = plan.products.map((product) => product.name);
      const primaryName = plan.primary?.name || targetNames[0] || "";
      for (const productName of targetNames) {
        dialog = findProductDialog() || dialog;
        model = productTableModel(dialog);
        const product = model.products.find((candidate) => candidate.name === productName);
        if (!product || !await setCheckboxState(product.checkbox, true)) throw new Error(`Không chọn được ${productName}`);
        await sleep(80);
        dialog = findProductDialog() || dialog;
        const verifyModel = productTableModel(dialog);
        const verifyProduct = verifyModel.products.find((candidate) => candidate.name === productName);
        if (!verifyProduct || !checkboxState(verifyProduct.checkbox)) throw new Error(`Amazon không giữ lựa chọn ${productName}`);
      }

      dialog = findProductDialog() || dialog;
      model = productTableModel(dialog);
      const selectedCount = model.products.filter((product) => checkboxState(product.checkbox)).length;
      if (selectedCount !== PRODUCT_LIMIT) throw new Error(`Amazon đang chọn ${selectedCount} sản phẩm ở ${PRODUCT_MARKETPLACE} thay vì đúng ${PRODUCT_LIMIT}`);

      const ready = await waitForProductDialogAction(dialog, 8000);
      dialog = ready.dialog || dialog;
      const action = ready.action;
      if (!action) throw new Error("Không thấy nút Save/Apply/Done đang khả dụng trong Select Products");
      action.scrollIntoView?.({ block: "nearest" });
      action.click();
      let closeStartedAt = Date.now();
      while (Date.now() - closeStartedAt < 10000 && findProductDialog()) await sleep(250);
      if (findProductDialog()) {
        const retryAction = findProductDialogAction(findProductDialog());
        if (retryAction) {
          retryAction.click();
          closeStartedAt = Date.now();
          while (Date.now() - closeStartedAt < 5000 && findProductDialog()) await sleep(250);
        }
      }
      if (findProductDialog()) throw new Error("Hộp Select Products chưa đóng sau khi lưu; Amazon có thể đang báo lỗi hoặc đổi giao diện");

      await updateUpload(pendingUpload.uploadId, {
        status: "waiting-listing",
        productsSelectedAt: Date.now(),
        selectedProductCount: PRODUCT_LIMIT,
        selectedMarketplace: PRODUCT_MARKETPLACE,
        selectedProductNames: targetNames,
        selectedPrimaryProduct: primaryName,
        selectedContextFlags: plan.contextFlags || [],
        productSelectionPolicy: PRODUCT_SELECTION_POLICY,
        productSelectionFailures: 0,
        productSelectionError: "",
        reviewWaitStartedAt: 0,
        lastError: ""
      });
      const contextText = plan.contextFlags?.length ? ` Nhóm phù hợp: ${plan.contextFlags.join(", ")}.` : "";
      await setMerchStatus(`Đã chọn ${PRODUCT_LIMIT} sản phẩm ${PRODUCT_MARKETPLACE}. Chủ đạo: ${primaryName}.${contextText} Đang chờ form listing để điền 5/5 trường…`, "success", pendingUpload.uploadId);
      toast(`Merch Flow: đã chọn ${PRODUCT_LIMIT} sản phẩm. Chủ đạo: ${primaryName}.`, "success");
      return { attempted: true, completed: true, count: PRODUCT_LIMIT, primary: primaryName, products: targetNames, contextFlags: plan.contextFlags || [] };
    } catch (error) {
      const failures = previousFailures + 1;
      const blocked = failures >= PRODUCT_SELECTION_MAX_FAILURES;
      const message = error.message || "Không chọn được sản phẩm";
      await updateUpload(pendingUpload.uploadId, {
        status: blocked ? "failed" : "waiting-listing",
        productSelectionFailures: failures,
        productSelectionError: message,
        lastError: blocked ? message : ""
      });
      await setMerchStatus(
        blocked
          ? `Select Products lỗi ${failures} lần liên tiếp: ${message}. Extension đã dừng retry để không treo vô hạn; reload tab Amazon rồi bấm Điền artwork + listing để thử lại.`
          : `Chưa tự chọn đủ ${PRODUCT_LIMIT} sản phẩm: ${message}. Đang thử lại (${failures}/${PRODUCT_SELECTION_MAX_FAILURES})…`,
        "error",
        pendingUpload.uploadId
      );
      return { attempted: true, completed: false, blocked, error: message, failures };
    } finally {
      productSelectionBusy = false;
    }
  }

  function fillListingOnce(listing) {
    if (!listing) return { filled: [], missing: Core.LISTING_KEYS };
    const resolved = Core.resolveListingFieldMap(fieldDescriptors());
    const filled = [];
    const missing = [...resolved.missing];
    for (const key of resolved.filled) {
      const descriptor = resolved.mapping[key];
      if (!listing[key]) {
        missing.push(key);
        continue;
      }
      setNativeValue(descriptor.element, listing[key]);
      if (descriptor.element.value === listing[key]) filled.push(key);
      else missing.push(key);
    }
    return { filled, missing: [...new Set(missing)] };
  }

  function stopListingWatcher() {
    if (listingObserver) listingObserver.disconnect();
    listingObserver = null;
    if (listingInterval) clearInterval(listingInterval);
    listingInterval = 0;
    clearTimeout(listingDebounce);
  }

  function scheduleListingAttempt(delay = 500) {
    clearTimeout(listingDebounce);
    listingDebounce = setTimeout(() => attemptPendingListing().catch(() => {}), delay);
  }

  function ensureListingWatcher() {
    if (!listingObserver) {
      listingObserver = new MutationObserver(() => scheduleListingAttempt(700));
      listingObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    }
    if (!listingInterval) listingInterval = setInterval(() => attemptPendingListing().catch(() => {}), 2500);
  }

  async function attemptPendingListing() {
    if (listingBusy) {
      if (listingBusySince && Date.now() - listingBusySince > 45000) {
        listingBusy = false;
        productSelectionBusy = false;
        listingBusySince = 0;
      } else {
        return null;
      }
    }
    listingBusy = true;
    listingBusySince = Date.now();
    try {
      const { pendingUpload } = await chrome.storage.local.get("pendingUpload");
      if (pendingUpload?.jobId && await isJobCancelled(pendingUpload.jobId)) { stopListingWatcher(); return { cancelled: true }; }
      if (!pendingUpload || !["artwork-set", "waiting-listing", "selecting-products"].includes(pendingUpload.status)) {
        if (!pendingUpload) stopListingWatcher();
        return null;
      }
      // Fail closed: listing/product automation is not allowed to advance until
      // Amazon has produced a positive artwork-acceptance signal. This prevents
      // a visible listing form from being mistaken for proof that the new PNG was accepted.
      if (pendingUpload.artworkVerified !== true) {
        stopListingWatcher();
        await setMerchStatus("Amazon chưa xác nhận artwork mới. Chưa điền listing/chọn sản phẩm để tránh báo thành công giả.", "error", pendingUpload.uploadId);
        return { completed: false, blocked: true, reason: "artwork-unverified", report: { filled: [], missing: Core.LISTING_KEYS } };
      }
      if (Date.now() - pendingUpload.createdAt > UPLOAD_TTL_MS) {
        await updateUpload(pendingUpload.uploadId, { status: "failed", lastError: "Job hết hạn sau 30 phút" });
        await setMerchStatus("Artwork đã chèn nhưng job listing hết hạn sau 30 phút. Bấm lại nút để thử tiếp.", "error", pendingUpload.uploadId);
        stopListingWatcher();
        return null;
      }

      const report = fillListingOnce(pendingUpload.listing);
      // Product/colour selection is intentionally left to the seller. Amazon
      // may require per-product colour choices, so AUTO stops after the
      // artwork and five listing fields are genuinely present.
      if (!report.missing.length) {
        const currentUploadError = uploadError(findArtworkTarget()?.container || document.body);
        if (currentUploadError) {
          await updateUpload(pendingUpload.uploadId, { status: "failed", artworkVerified: false, lastError: currentUploadError });
          await setMerchStatus(`Amazon từ chối artwork: ${currentUploadError}. AUTO đã dừng; chưa coi form là sẵn sàng Publish.`, "error", pendingUpload.uploadId);
          stopListingWatcher();
          return { completed: false, blocked: true, report };
        }
        const message = "Artwork đã xác nhận và listing đã điền đủ 5/5. Anh tự chọn sản phẩm/màu trên Amazon rồi review; extension không tự chọn màu và không tự Publish.";
        await updateUpload(pendingUpload.uploadId, {
          status: "manual-products",
          listingWaitStartedAt: 0,
          reviewWaitStartedAt: 0,
          lastError: "",
          manualProductSelectionRequired: true
        });
        await setMerchStatus(message, "success", pendingUpload.uploadId);
        highlightReviewPublishControl();
        toast(message, "success");
        stopListingWatcher();
        return { completed: true, manualProducts: true, report };
      }

      const listingWaitStartedAt = Number(pendingUpload.listingWaitStartedAt || Date.now());
      if (Date.now() - listingWaitStartedAt >= LISTING_READY_TIMEOUT_MS) {
        const error = `Amazon chưa mở đủ form listing sau 2 phút; còn thiếu ${report.missing.join(", ")}`;
        await updateUpload(pendingUpload.uploadId, { status: "failed", listingWaitStartedAt, lastError: error });
        await setMerchStatus(`${error}. AUTO đã dừng để không chạy vòng lặp; artwork và dữ liệu listing vẫn được giữ.`, "error", pendingUpload.uploadId);
        stopListingWatcher();
        return { completed: false, blocked: true, report };
      }

      const signature = report.missing.join(",");
      if (pendingUpload.lastMissingSignature !== signature || pendingUpload.lastFilledCount !== report.filled.length) {
        await updateUpload(pendingUpload.uploadId, {
          status: "waiting-listing",
          listingWaitStartedAt,
          lastMissingSignature: signature,
          lastFilledCount: report.filled.length,
          lastError: ""
        });
        const selectProductsVisible = false;
        const fieldText = report.filled.length
          ? `Đã điền ${report.filled.length}/5 trường; đang chờ: ${report.missing.join(", ")}.`
          : "Artwork đã chèn; đang chờ Amazon mở form listing để điền 5 trường.";
        await setMerchStatus(fieldText, "info", pendingUpload.uploadId);
        if (selectProductsVisible) toast(fieldText, "info");
      }
      if (!pendingUpload.listingWaitStartedAt) {
        await updateUpload(pendingUpload.uploadId, { status: "waiting-listing", listingWaitStartedAt, lastError: "" });
      }
      ensureListingWatcher();
      return { completed: false, report };
    } finally {
      listingBusy = false;
      listingBusySince = 0;
    }
  }

  async function executeUpload(uploadId) {
    let { pendingUpload } = await chrome.storage.local.get("pendingUpload");
    if (!pendingUpload || pendingUpload.uploadId !== uploadId) throw new Error("Không còn upload job cần xử lý");
    if (Date.now() - pendingUpload.createdAt > UPLOAD_TTL_MS) throw new Error("Upload job đã hết hạn sau 30 phút");

    if (["artwork-set", "waiting-listing", "selecting-products"].includes(pendingUpload.status)) {
      if (pendingUpload.artworkVerified !== true) {
        stopListingWatcher();
        return { uploaded: false, transferred: true, verified: false, pendingVerification: true, error: "Amazon chưa xác nhận artwork" };
      }
      if (await waitForLiveArtwork()) {
        ensureListingWatcher();
        const result = await attemptPendingListing();
        return { uploaded: true, verified: true, report: result?.report || { filled: [], missing: Core.LISTING_KEYS } };
      }
      // Storage can survive an Amazon reload while the live draft loses its
      // artwork. Never trust the persisted verification without matching page
      // evidence; reset this same upload job and transfer the PNG again.
      pendingUpload = await updateUpload(uploadId, {
        status: "pending",
        artworkVerified: false,
        artworkVerifiedAt: 0,
        artworkSetAt: 0,
        productsSelectedAt: 0,
        selectedProductCount: 0,
        selectedProductNames: [],
        selectedPrimaryProduct: "",
        productSelectionFailures: 0,
        productSelectionError: "",
        lastError: ""
      });
      fileCache.delete(uploadId);
      await setMerchStatus("Amazon đã reload và mất artwork của job; đang tự upload lại đúng PNG trước khi đi tiếp…", "warning", uploadId);
    }

    await updateUpload(uploadId, {
      status: "running",
      lastError: "",
      retryVersion: SCRIPT_VERSION,
      productSelectionFailures: 0,
      productSelectionError: ""
    });
    await clearExistingArtworkIfNeeded(uploadId);
    await setMerchStatus("Đang tìm vùng tải artwork trên Amazon…", "info", uploadId);
    const target = await waitForArtworkTarget();
    await setMerchStatus("Đã tìm thấy vùng artwork, đang chèn đúng PNG của job hiện tại…", "info", uploadId);
    const file = await getFileForUpload(pendingUpload);
    const baseline = artworkTargetSnapshot(target);
    let transferred = false;
    if (target.input) transferred = setFile(target.input, file);
    if (!transferred) transferred = dispatchDrop(target.element || target.container, file);
    if (!transferred) throw new Error("Không chuyển được artwork vào vùng upload của Amazon");
    await updateUpload(uploadId, { status: "artwork-transferred", artworkSetAt: Date.now(), uploadMethod: target.reason, artworkVerified: false, lastError: "" });

    await setMerchStatus("Đã chuyển PNG vào Amazon; đang chờ tín hiệu xác nhận artwork thật…", "info", uploadId);
    const verification = await verifyArtworkAccepted(target, file, baseline);
    if (!verification.verified) {
      const message = "Đã chuyển file nhưng Amazon chưa xác nhận artwork. Job được giữ để thử lại; extension KHÔNG điền listing/chọn sản phẩm và KHÔNG báo upload thành công.";
      await updateUpload(uploadId, {
        status: "artwork-unverified",
        artworkVerified: false,
        artworkVerifiedAt: Date.now(),
        lastError: "Amazon chưa xác nhận artwork"
      });
      stopListingWatcher();
      await setMerchStatus(message, "error", uploadId);
      toast(message, "error");
      return { uploaded: false, transferred: true, verified: false, pendingVerification: true, error: "Amazon chưa xác nhận artwork", report: { filled: [], missing: Core.LISTING_KEYS } };
    }

    await updateUpload(uploadId, { status: "artwork-set", artworkVerified: true, artworkVerifiedAt: Date.now(), lastError: "" });
    ensureListingWatcher();
    const listingResult = await attemptPendingListing();
    const report = listingResult?.report || { filled: [], missing: Core.LISTING_KEYS };
    if (report.missing.length) {
      const message = report.filled.length
        ? `Amazon đã xác nhận artwork. Đã điền ${report.filled.length}/5 trường; đang chờ: ${report.missing.join(", ")}.`
        : "Amazon đã xác nhận artwork; extension sẽ chờ form listing rồi tự điền 5 trường. Anh tự chọn sản phẩm/màu sau đó.";
      await setMerchStatus(message, "info", uploadId);
      toast(message, "info");
    }
    return { uploaded: true, verified: true, report, waitingForListing: Boolean(report.missing.length) };
  }

  function startUpload(uploadId) {
    if (runtimeTakeoverPending) return Promise.resolve({ uploaded: false, reloading: true });
    if (runningUploads.has(uploadId)) return runningUploads.get(uploadId);
    const run = executeUpload(uploadId)
      .catch(async (error) => {
        await failUpload(uploadId, error.message || "Lỗi không xác định");
        return { uploaded: false, error: error.message || "Lỗi không xác định" };
      })
      .finally(() => runningUploads.delete(uploadId));
    runningUploads.set(uploadId, run);
    return run;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MERCH_FLOW_CANCEL_JOB_V1") {
      stopListingWatcher();
      listingBusy = false;
      productSelectionBusy = false;
      toast("Merch Flow: AUTO đã hủy. Đã dừng watcher trên Amazon.", "info");
      sendResponse({ cancelled: true, jobId: String(message.jobId || "") });
      return false;
    }
    if ((message?.type === "MERCH_FLOW_UPLOAD_V5" || message?.type === "MERCH_FLOW_UPLOAD_V4" || message?.type === "MERCH_FLOW_UPLOAD_V3") && message.uploadId) {
      startUpload(message.uploadId).then(sendResponse);
      return true;
    }
    if (message?.type === "MERCH_FLOW_FILL_LISTING_V5" || message?.type === "MERCH_FLOW_FILL_LISTING_V4" || message?.type === "MERCH_FLOW_FILL_LISTING_V3") {
      const report = fillListingOnce(message.listing);
      sendResponse({ report });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (runtimeTakeoverPending) return;
    if (area !== "local" || !changes.pendingUpload) return;
    const pendingUpload = changes.pendingUpload.newValue;
    if (!pendingUpload) {
      stopListingWatcher();
      return;
    }
    if (["pending", "running"].includes(pendingUpload.status)) {
      startUpload(pendingUpload.uploadId);
    } else if (["artwork-set", "waiting-listing", "selecting-products"].includes(pendingUpload.status)) {
      // Re-enter executeUpload so a page reload cannot leave stale
      // artworkVerified=true pointing at an empty Amazon uploader.
      startUpload(pendingUpload.uploadId);
    }
  });

  runtimeRegistration.then(async (runtime) => {
    if (runtime?.reloading) {
      stopListingWatcher();
      return;
    }
    const { pendingUpload } = await chrome.storage.local.get("pendingUpload");
    if (!pendingUpload) return;
    if (["pending", "running"].includes(pendingUpload.status)) {
      startUpload(pendingUpload.uploadId);
    } else if (pendingUpload.status === "failed" && pendingUpload.retryVersion !== SCRIPT_VERSION && Date.now() - pendingUpload.createdAt < UPLOAD_TTL_MS) {
      await updateUpload(pendingUpload.uploadId, { status: "pending", retryVersion: SCRIPT_VERSION, lastError: "" });
      await setMerchStatus("Đã cập nhật bộ nhận diện Amazon; đang tự thử lại job hiện tại…", "info", pendingUpload.uploadId);
      startUpload(pendingUpload.uploadId);
    } else if (["artwork-set", "waiting-listing", "selecting-products"].includes(pendingUpload.status)) {
      startUpload(pendingUpload.uploadId);
    }
  });
})();
