(function merchFlowChatGPT() {
  const Core = globalThis.MerchFlowCore;
  const SCRIPT_VERSION = "0.9.34";
  if (!Core || globalThis.__MERCH_FLOW_CHAT_SCRIPT_VERSION__ === SCRIPT_VERSION) return;
  try { globalThis.__MERCH_FLOW_CHAT_CLEANUP__?.(); } catch (_) { /* previous v0.9+ instance */ }
  globalThis.__MERCH_FLOW_CHAT_SCRIPT_VERSION__ = SCRIPT_VERSION;
  globalThis.__MERCH_FLOW_CHAT_SCRIPT_READY__ = true;

  const MAX_WAIT_MS = 30000;
  const ATTACH_SIGNAL_WAIT_MS = 10000;
  const CREATE_IMAGE_MODE_WAIT_MS = 12000;
  const ARTWORK_MIN_EDGE = 220;
  const FOLLOWUP_RETRY_MS = 60 * 1000;
  const LISTING_RETRY_MAX = 2;
  const ARTWORK_RETRY_AFTER_MS = 75 * 1000;
  const ARTWORK_RETRY_COOLDOWN_MS = 90 * 1000;
  const ARTWORK_RETRY_MAX = 3;
  const initialUrl = new URL(location.href);
  const initialJobFromUrl = initialUrl.searchParams.get("merch_flow_job");
  const initialSessionNonce = initialUrl.searchParams.get("merch_flow_nonce") || "";
  let registeredTabId = 0;
  let registeredJobId = initialJobFromUrl || "";
  let registeredSessionNonce = initialSessionNonce;
  const registrationPromise = chrome.runtime.sendMessage({
    type: "MERCH_FLOW_REGISTER_CHAT_TAB_V1",
    jobId: initialJobFromUrl || "",
    conversationKey: location.pathname || "",
    sessionNonce: initialSessionNonce
  }).then((response) => {
    if (response?.registered) {
      registeredTabId = Number(response.tabId || 0);
      registeredJobId = String(response.jobId || registeredJobId || "");
      registeredSessionNonce = String(response.sessionNonce || registeredSessionNonce || "");
    }
    return response || null;
  }).catch(() => null);
  let flowBusy = false;
  let flowTimer = 0;
  let flowInterval = 0;
  const cancelledJobIds = new Set();

  function jobBelongsToThisChat(job) {
    if (!job?.jobId) return false;
    const sessionNonce = initialSessionNonce || registeredSessionNonce || "";
    if (job.sessionNonce && sessionNonce && job.sessionNonce !== sessionNonce) return false;
    if (registeredJobId && registeredJobId !== job.jobId) return false;
    return Boolean(initialJobFromUrl === job.jobId || registeredJobId === job.jobId || (!job.sessionNonce && !registeredJobId));
  }

  function explicitTextToImagePrompt(prompt = "") {
    const text = String(prompt || "");
    const compactRequest = /(?:^|\n)MERCH_FLOW_IMAGE_REQUEST:\s*NEW\s*(?:\n|$)/i.test(text);
    const legacyRequest = /(?:^|\n)TASK_CLASS:\s*TEXT_TO_IMAGE\s*(?:\n|$)/i.test(text)
      && /(?:^|\n)INPUT_ASSETS:\s*NONE\s*(?:\n|$)/i.test(text)
      && /(?:^|\n)TEXT_TO_IMAGE_ONLY:/i.test(text);
    return compactRequest || legacyRequest;
  }

  function currentSessionNonce() {
    return String(initialSessionNonce || registeredSessionNonce || "");
  }

  function specializedComposerContext(composer = findComposer()) {
    const scope = composerScope(composer);
    const descriptor = normalizedUiText(`${composer?.getAttribute?.("placeholder") || ""} ${composer?.getAttribute?.("aria-label") || ""}`);
    if (/get a detailed report|deep research|nghiên cứu sâu|research report|study mode|study and learn|học và nghiên cứu|agent mode|shopping research/.test(descriptor)) return true;
    if (!scope) return false;
    const nonImageTool = [...scope.querySelectorAll?.("button, [role='button'], [aria-pressed='true'], [data-state='on'], [data-state='checked'], [data-selected='true']") || []]
      .filter((node) => isVisible(node) && !node.closest?.("[role='menu'], [role='listbox'], [data-radix-menu-content]"))
      .find((node) => {
        const text = normalizedUiText(`${node.innerText || node.textContent || ""} ${node.getAttribute?.("aria-label") || ""} ${node.getAttribute?.("title") || ""}`);
        if (!text || text.length > 80) return false;
        return /^(search|web search|search the web|tìm kiếm|study|study and learn|study mode|học và nghiên cứu|deep research|nghiên cứu sâu|agent|agent mode|shopping research)$/i.test(text);
      });
    return Boolean(nonImageTool);
  }

  function canUseSafeTextToImageFallback(job, composer = findComposer()) {
    if (!job?.jobId || !explicitTextToImagePrompt(job.prompt)) return false;
    if (job.referenceDataUrl || job.referenceName) return false;
    if (!jobBelongsToThisChat(job)) return false;
    if (!composer || composerHasAttachedFile(composer)) return false;
    if (specializedComposerContext(composer)) return false;
    return Boolean(initialJobFromUrl === job.jobId || registeredJobId === job.jobId);
  }


  async function isJobCancelled(jobId) {
    if (!jobId) return false;
    if (cancelledJobIds.has(jobId)) return true;
    const { flowCancel } = await chrome.storage.local.get("flowCancel");
    const cancelled = Boolean(flowCancel?.jobId === jobId && flowCancel?.cancelledAt);
    if (cancelled) cancelledJobIds.add(jobId);
    return cancelled;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(getValue, timeoutMs = MAX_WAIT_MS, intervalMs = 300) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = getValue();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function isVisible(element) {
    if (!element || element.disabled) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function toast(message, tone = "info") {
    const existing = document.getElementById("merch-flow-chat-toast");
    if (existing) existing.remove();
    const node = document.createElement("div");
    node.id = "merch-flow-chat-toast";
    node.textContent = message;
    node.style.cssText = `position:fixed;z-index:2147483647;right:18px;bottom:18px;max-width:390px;padding:12px 14px;border-radius:10px;background:${tone === "error" ? "#7f241d" : tone === "warning" ? "#6f4d12" : "#1d3216"};color:#f5fff1;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px #0005`;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 8000);
  }

  function composerText(composer) {
    return composer?.matches("textarea, input") ? composer.value : (composer?.innerText || composer?.textContent || "");
  }

  function composerDraftText(composer) {
    if (!composer) return "";
    if (composer.matches("textarea, input")) return String(composer.value || "").trim();
    const clone = composer.cloneNode(true);
    clone.querySelectorAll?.("[data-inline-selection-pill]").forEach((pill) => pill.remove());
    return String(clone.textContent || "").replace(/\uFEFF/g, "").trim();
  }

  function findComposer() {
    const preferred = [
      '[data-testid="prompt-textarea"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Nhắn" i]',
      'textarea[data-id]',
      'form [contenteditable="true"]',
      'textarea',
      '[contenteditable="true"]'
    ];
    for (const selector of preferred) {
      const found = [...document.querySelectorAll(selector)]
        .find((element) => isVisible(element) && element.getAttribute("aria-disabled") !== "true");
      if (found) return found;
    }
    return null;
  }

  function setComposerValue(composer, value) {
    if (!composer?.isConnected) return false;
    composer.focus();
    if (composer.matches("textarea, input")) {
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(composer, value);
    } else if (composer.querySelector('[data-inline-selection-pill]')) {
      // Current ChatGPT renders the active Create image tool as a non-editable
      // pill inside #prompt-textarea. Replace only the editable tail so filling
      // the brief cannot silently remove image mode.
      const pills = [...composer.querySelectorAll('[data-inline-selection-pill]')];
      const lastPill = pills.at(-1);
      try {
        const selection = window.getSelection();
        const deleteRange = document.createRange();
        deleteRange.setStartAfter(lastPill);
        deleteRange.setEnd(composer, composer.childNodes.length);
        selection.removeAllRanges();
        selection.addRange(deleteRange);
        document.execCommand("delete", false);
        if (value) {
          const insertRange = document.createRange();
          insertRange.setStartAfter(lastPill);
          insertRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(insertRange);
          if (!document.execCommand("insertText", false, ` ${value}`)) lastPill.after(document.createTextNode(` ${value}`));
        }
      } catch (_) {
        return false;
      }
      if (!composer.querySelector('[data-inline-selection-pill]')) return false;
    } else if (!value) {
      // Empty-string validation via String.includes("") is always true. Handle
      // draft cleanup explicitly so a blocked Merch prompt cannot remain in an old chat.
      composer.replaceChildren();
    } else {
      let inserted = false;
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("delete", false);
        inserted = document.execCommand("insertText", false, value);
      } catch (_) {
        inserted = false;
      }
      if (!inserted || !composerText(composer).includes(value.slice(0, Math.min(40, value.length)))) {
        composer.replaceChildren(document.createTextNode(value));
      }
    }
    try {
      composer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value }));
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    } catch (_) {
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    }
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function fillLiveComposer(value, marker, timeoutMs = 12000) {
    const startedAt = Date.now();
    let attempts = 0;
    while (Date.now() - startedAt < timeoutMs && attempts < 5) {
      attempts += 1;
      const composer = await waitFor(() => {
        const current = findComposer();
        return current?.isConnected ? current : null;
      }, Math.min(4000, timeoutMs), 200);
      if (!composer) continue;
      const imageModeWasActive = imageModeChipVisible(composer);
      if (!setComposerValue(composer, value)) continue;
      const confirmed = await waitFor(() => {
        const current = findComposer();
        if (!current?.isConnected) return null;
        if (imageModeWasActive && !imageModeChipVisible(current)) return null;
        return composerText(current).includes(marker) ? current : null;
      }, 3000, 150);
      if (confirmed) return confirmed;
      await sleep(250);
    }
    return null;
  }

  function elementDescriptor(element) {
    if (!element) return "";
    return `${element.getAttribute?.("aria-label") || ""} ${element.getAttribute?.("title") || ""} ${element.getAttribute?.("data-testid") || ""} ${element.innerText || element.textContent || ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizedUiText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function createImageActionText(value) {
    const text = normalizedUiText(value);
    if (!text) return false;
    return /(?:^|\s)(?:create image|create an image|generate image|generate images|tạo ảnh|tạo hình ảnh)(?:\s|$)/i.test(text)
      || /visualize anything/i.test(text);
  }

  function createImageActionLabel(element) {
    return createImageActionText(elementDescriptor(element));
  }

  function closestActionTarget(element) {
    let current = element?.nodeType === Node.TEXT_NODE ? element.parentElement : element;
    let fallback = current;
    for (let depth = 0; current && depth < 7 && current !== document.body; depth += 1, current = current.parentElement) {
      if (!isVisible(current)) continue;
      const role = normalizedUiText(current.getAttribute?.("role"));
      if (
        current.matches?.('button, a, [role="menuitem"], [role="option"], [role="button"], [data-radix-collection-item], [tabindex]')
        || role === "menuitem"
        || role === "option"
        || role === "button"
      ) return current;
      const text = normalizedUiText(current.innerText || current.textContent);
      if (createImageActionText(text) && text.length <= 120) fallback = current;
    }
    return fallback;
  }

  function createImageActionScore(element) {
    if (!element || !isVisible(element) || !createImageActionLabel(element)) return -Infinity;
    const descriptor = normalizedUiText(elementDescriptor(element));
    const text = normalizedUiText(element.innerText || element.textContent);
    let score = 0;
    if (/visualize anything/i.test(descriptor)) score += 120;
    if (/^(?:create image|create an image|generate image|generate images|tạo ảnh|tạo hình ảnh)(?:\s|$)/i.test(descriptor)) score += 110;
    if (element.matches?.('[role="menuitem"], [role="option"], [data-radix-collection-item]')) score += 90;
    if (element.matches?.('button, [role="button"], [tabindex]')) score += 55;
    if (element.closest?.('[role="menu"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-state="open"]')) score += 70;
    if (text && text.length <= 80) score += 30;
    const childMatchCount = [...(element.children || [])].filter((child) => createImageActionLabel(child)).length;
    if (childMatchCount === 0) score += 20;
    const rect = element.getBoundingClientRect();
    if (rect.width > 80 && rect.width < 700 && rect.height > 24 && rect.height < 180) score += 20;
    return score;
  }

  function findCreateImageAction() {
    const candidates = new Set();
    const menuSelector = '[role="menu"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-state="open"]';
    const menuRoots = [...document.querySelectorAll(menuSelector)]
      .filter((element) => isVisible(element) && !element.closest?.('[data-message-author-role]'));

    // Only inspect the currently open menu/popover. Historical assistant text is
    // deliberately excluded so a previous phrase "Create image" can never be clicked.
    const selectors = '[role="menuitem"], [role="option"], [data-radix-collection-item], [data-testid*="image" i], button, [role="button"], [tabindex], div, span';
    for (const root of menuRoots) {
      for (const element of root.querySelectorAll(selectors)) {
        if (!isVisible(element) || element.closest?.('[data-message-author-role]') || !createImageActionLabel(element)) continue;
        const target = closestActionTarget(element) || element;
        if (target && root.contains(target) && isVisible(target)) candidates.add(target);
      }
      if (createImageActionLabel(root)) candidates.add(root);
    }

    // Semantic menu rows may themselves be the portal root and therefore have no
    // menu ancestor. Accept only explicit menuitem/option rows outside chat history.
    for (const element of document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item]')) {
      if (!isVisible(element) || element.closest?.('[data-message-author-role]') || !createImageActionLabel(element)) continue;
      candidates.add(element);
    }

    // ChatGPT's current composer popover uses a plain div.__menu-item with no
    // role/data-state. Accept the exact Create image row, while excluding every
    // sidebar/history item so a conversation title can never become a target.
    for (const element of document.querySelectorAll('div.__menu-item[tabindex], div.__menu-item[data-fill]')) {
      if (!isVisible(element) || element.closest?.('nav, aside, [data-sidebar-item], [data-message-author-role]')) continue;
      const text = normalizedUiText(element.innerText || element.textContent);
      if (!/^(?:create image|create an image|generate image|generate images|tạo ảnh|tạo hình ảnh)(?:\s+visualize anything)?$/i.test(text)) continue;
      const target = closestActionTarget(element) || element;
      const link = target.matches?.('a') ? target : target.closest?.('a');
      if (link?.getAttribute?.('href')?.startsWith('/c/')) continue;
      candidates.add(target);
    }

    return [...candidates]
      .map((element) => ({ element, score: createImageActionScore(element) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score)[0]?.element || null;
  }

  function findComposerPlusButton(composer = findComposer()) {
    const scope = composerScope(composer);
    const exact = [
      '[data-testid="composer-plus-btn"]',
      '[data-testid*="composer-plus" i]'
    ];
    for (const selector of exact) {
      const found = [...scope.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }

    const buttons = [...scope.querySelectorAll('button, [role="button"]')].filter(isVisible);
    const scored = buttons.map((element) => {
      const descriptor = elementDescriptor(element).toLowerCase();
      let score = 0;
      if (/(add files and more|add photos & files|add photos and files)/i.test(descriptor)) score += 100;
      if (/(attach|upload|add file|add attachment|đính kèm|tải tệp|thêm tệp|thêm ảnh)/i.test(descriptor)) score += 70;
      if (/(tools|công cụ|more)/i.test(descriptor)) score += 30;
      if (element.getAttribute('aria-haspopup') === 'menu') score += 25;
      if (/send|gửi|voice|microphone|mic|record/i.test(descriptor)) score -= 120;
      return { element, score };
    }).filter((candidate) => candidate.score > 0);
    scored.sort((left, right) => right.score - left.score);
    return scored[0]?.element || null;
  }

  function imageModeChipVisible(composer = findComposer()) {
    const scope = composerScope(composer);
    return [...scope.querySelectorAll('button, [role="button"], [data-testid], span, div')].some((element) => {
      if (!isVisible(element)) return false;
      if (element.closest('[role="menu"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper]')) return false;
      const descriptor = elementDescriptor(element).toLowerCase();
      return /^(?:create image|create an image|generate image|generate images|tạo ảnh|tạo hình ảnh)$/i.test(descriptor)
        || /(?:create image|tạo ảnh).{0,30}(?:remove|active|selected|đang bật|đã chọn)/i.test(descriptor);
    });
  }

  function clickUiElement(element) {
    if (!element) return false;
    try { element.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) { /* ignore */ }
    try { element.focus?.({ preventScroll: true }); } catch (_) { try { element.focus?.(); } catch (_) { /* ignore */ } }
    // HTMLElement.click() runs the element's activation behavior. Dispatching a
    // synthetic MouseEvent alone did not commit ChatGPT's New-chat router state.
    try { element.click(); return true; } catch (_) { /* event fallback below */ }
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
    const eventInit = { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0, buttons: 1 };
    try {
      if (typeof PointerEvent === "function") {
        element.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        element.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 }));
      }
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", { ...eventInit, buttons: 0 }));
      element.dispatchEvent(new MouseEvent("click", { ...eventInit, buttons: 0 }));
      return true;
    } catch (_) {
      try { element.click(); return true; } catch (_) { return false; }
    }
  }

  function visibleMenuDiagnostic() {
    const containers = [...document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-state="open"]')]
      .filter(isVisible);
    const texts = containers
      .map((element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((text) => text.length < 700);
    return texts.slice(0, 2).join(" | ").slice(0, 320);
  }

  async function activateCreateImageMode(composer) {
    let current = findComposer() || composer;
    if (!current) throw new Error("Không tìm thấy ô nhập để bật Create image");
    if (imageModeChipVisible(current)) return current;

    let action = findCreateImageAction();
    for (let attempt = 0; !action && attempt < 2; attempt += 1) {
      current = findComposer() || current;
      const plus = findComposerPlusButton(current);
      if (!plus) throw new Error("Không tìm thấy nút + / Add files and more của ChatGPT");
      clickUiElement(plus);
      await sleep(350 + attempt * 250);
      action = await waitFor(findCreateImageAction, 4500, 120);
      if (!action && attempt < 1) {
        // Close a half-open popover and retry. This handles UI animations and
        // cases where the first synthetic click only focuses the + button.
        try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); } catch (_) { /* ignore */ }
        await sleep(250);
      }
    }
    if (!action) {
      const diagnostic = visibleMenuDiagnostic();
      throw new Error(`Menu ChatGPT không tìm thấy Create image${diagnostic ? ` (đang thấy: ${diagnostic})` : ""}`);
    }

    clickUiElement(action);
    await sleep(550);
    const readyComposer = await waitFor(() => {
      const live = findComposer();
      if (!live?.isConnected) return null;
      return imageModeChipVisible(live) ? live : null;
    }, CREATE_IMAGE_MODE_WAIT_MS, 180);
    if (!readyComposer) throw new Error("Không xác nhận được Create image đã bật; không gửi prompt để tránh route nhầm image-edit");
    return readyComposer;
  }

  function findAttachmentInput() {
    return [...document.querySelectorAll('input[type="file"]')]
      .find((input) => !input.disabled && ((input.accept || "").toLowerCase().includes("image") || (input.accept || "") === "")) || null;
  }

  function findAttachmentButton() {
    return [...document.querySelectorAll("button, [role='button']")].find((element) => {
      const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("data-testid") || ""} ${element.textContent || ""}`.toLowerCase();
      return isVisible(element) && /(attach|upload|add file|add attachment|đính kèm|tải tệp|thêm tệp|thêm ảnh)/i.test(label);
    }) || null;
  }

  function composerScope(composer) {
    return composer?.closest("form") || composer?.parentElement?.parentElement?.parentElement || document.body;
  }

  function attachmentVisuals(scope = document) {
    const selectors = [
      "[data-testid*='attachment' i]",
      "[data-testid*='file' i]",
      "[data-testid*='upload' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='file' i]",
      "[aria-label*='remove' i]",
      "[aria-label*='xóa' i]",
      "img[src^='blob:']",
      "img[src^='data:image']",
      "button img"
    ];
    const nodes = new Set();
    for (const selector of selectors) {
      for (const node of scope.querySelectorAll(selector)) nodes.add(node);
    }
    return [...nodes].filter((node) => isVisible(node) || isVisible(node.closest?.("button, [role='button'], div")));
  }

  function attachmentTextMatches(referenceName, scope) {
    const name = String(referenceName || "").toLowerCase();
    const stem = name.replace(/\.[^.]+$/, "");
    const text = (scope?.innerText || scope?.textContent || "").toLowerCase();
    return Boolean(name && (text.includes(name) || (stem.length > 4 && text.includes(stem))));
  }

  function attachmentError(scope) {
    const text = (scope?.innerText || scope?.textContent || "").replace(/\s+/g, " ").trim();
    const match = text.match(/(?:upload failed|upload error|unable to upload|file upload failed|unsupported file|file too large|không thể tải|tải lên thất bại|tệp không được hỗ trợ)[^.]{0,180}/i);
    return match?.[0] || "";
  }


  function attachmentRemoveButtons(scope = document) {
    return [...scope.querySelectorAll("button, [role='button']")].filter((element) => {
      const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("data-testid") || ""}`.toLowerCase();
      return isVisible(element) && (
        /(?:remove|delete|clear).{0,40}(?:attachment|file|image|photo)/i.test(label)
        || /(?:attachment|file|image|photo).{0,40}(?:remove|delete|clear)/i.test(label)
        || /(?:xóa|gỡ).{0,40}(?:tệp|ảnh|đính kèm)/i.test(label)
      );
    });
  }

  function composerHasAttachedFile(composer) {
    const scope = composerScope(composer);
    const selectedInput = [...scope.querySelectorAll('input[type="file"]')].some((input) => input.files?.length);
    if (selectedInput) return true;
    if (scope.querySelector("img[src^='blob:'], img[src^='data:image']")) return true;
    return attachmentRemoveButtons(scope).length > 0;
  }

  async function ensureTextOnlyComposer(composer) {
    const scope = composerScope(composer);
    for (const input of scope.querySelectorAll('input[type="file"]')) {
      if (!input.files?.length) continue;
      try {
        const transfer = new DataTransfer();
        input.files = transfer.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) { /* remove-button pass below is the primary UI fallback */ }
    }
    for (const button of attachmentRemoveButtons(scope)) {
      try { button.click(); } catch (_) { /* best effort */ }
    }
    await sleep(450);
    const liveComposer = findComposer() || composer;
    if (composerHasAttachedFile(liveComposer)) {
      throw new Error("Ô ChatGPT vẫn còn ảnh/tệp cũ; không gửi job text-to-image để tránh bị route sang image-edit");
    }
    return liveComposer;
  }

  function sameSelectedFile(input, file) {
    const selected = input?.files?.[0];
    return Boolean(selected && selected.name === file.name && selected.size === file.size);
  }

  async function confirmAttachmentSelection(input, file, composer, baselineCount) {
    const scope = composerScope(composer);
    const startedAt = Date.now();
    while (Date.now() - startedAt < ATTACH_SIGNAL_WAIT_MS) {
      const error = attachmentError(scope);
      if (error) throw new Error(error);
      if (attachmentTextMatches(file.name, scope)) return { verified: true, signal: "filename" };
      if (attachmentVisuals(scope).length > baselineCount) return { verified: true, signal: "preview" };
      await sleep(350);
    }
    return { verified: false, signal: sameSelectedFile(input, file) ? "file-selected" : "picker-consumed" };
  }

  function findSendButton() {
    return [...document.querySelectorAll("button")].find((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""} ${button.getAttribute("data-testid") || ""} ${button.textContent || ""}`.toLowerCase();
      return isVisible(button) && !button.disabled && (label.includes("send") || label.includes("gửi") || button.getAttribute("data-testid") === "send-button");
    }) || null;
  }

  function generationInProgress() {
    return [...document.querySelectorAll("button")].some((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""} ${button.getAttribute("data-testid") || ""} ${button.textContent || ""}`.toLowerCase();
      return isVisible(button) && /(stop generating|stop response|stop|dừng tạo|dừng phản hồi)/i.test(label);
    });
  }

  function messageRole(message) {
    return String(
      message?.getAttribute?.("data-message-author-role")
      || message?.getAttribute?.("data-turn")
      || message?.closest?.("section[data-turn]")?.getAttribute?.("data-turn")
      || ""
    ).toLowerCase();
  }

  function conversationMessages() {
    return [...document.querySelectorAll('[data-message-author-role], section[data-turn="user"], section[data-turn="assistant"]')]
      .filter((message) => {
        if (!message.matches?.("section[data-turn]")) return true;
        const role = messageRole(message);
        return !message.querySelector?.(`[data-message-author-role="${role}"]`);
      });
  }

  function userMessages() {
    return conversationMessages().filter((message) => messageRole(message) === "user");
  }

  function assistantMessages() {
    return conversationMessages().filter((message) => messageRole(message) === "assistant");
  }

  function isConversationRoute() {
    return /(?:^|\/)c\/[^/]+/i.test(location.pathname || "");
  }

  function freshConversationIsClean(composer = findComposer(), job = null) {
    const conversationKey = isConversationRoute() ? (location.pathname || "") : "";
    const candidateAge = Date.now() - Number(job?.freshCandidateSeenAt || 0);
    const trustedEmptyCandidate = Boolean(
      conversationKey
      && job?.freshCandidateConversationKey === conversationKey
      && candidateAge >= 1200
      && candidateAge < 60000
    );
    return Boolean(
      composer
      && (!conversationKey || trustedEmptyCandidate)
      && conversationMessages().length === 0
      && !specializedComposerContext(composer)
    );
  }

  async function waitForStableFreshComposer(timeoutMs = 20000, stableMs = 1800) {
    const startedAt = Date.now();
    let stableSince = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const composer = findComposer();
      if (freshConversationIsClean(composer) && !composerDraftText(composer)) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return composer;
      } else {
        stableSince = 0;
      }
      await sleep(200);
    }
    return null;
  }

  function findNewChatControl() {
    const selectors = [
      '[data-testid="create-new-chat-button"]',
      'a[href="/"]',
      'button[aria-label*="new chat" i]',
      'a[aria-label*="new chat" i]',
      'button[title*="new chat" i]',
      'a[title*="new chat" i]'
    ];
    const seen = new Set();
    const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter((node) => {
      if (!node || seen.has(node) || !isVisible(node)) return false;
      seen.add(node);
      return true;
    });
    const named = candidates.find((node) => {
      const descriptor = normalizedUiText(`${node.innerText || node.textContent || ""} ${node.getAttribute?.("aria-label") || ""} ${node.getAttribute?.("title") || ""}`);
      return /(?:^|\b)(new chat|new conversation|chat mới|đoạn chat mới|cuộc trò chuyện mới)(?:\b|$)/i.test(descriptor);
    });
    if (named) return named;
    return candidates.find((node) => node.matches?.('a[href="/"]') && node.closest?.('nav, aside')) || null;
  }

  async function ensureFreshConversation(job, { forceNewChat = false } = {}) {
    if (!job?.freshConversationRequired) return findComposer();
    await registrationPromise;

    // ChatGPT can first render an empty root composer, then restore the previous
    // /c/... route a moment later. Require a stable clean state before trusting it.
    if (!forceNewChat) {
      const alreadyStable = await waitForStableFreshComposer(3200, 1800);
      if (alreadyStable) return alreadyStable;
    }

    await setChatStatus("AUTO: phát hiện chat cũ; đang mở New chat sạch trước khi gửi brief…", "warning", job.jobId);
    const newChat = findNewChatControl();
    if (!newChat) {
      throw new Error("AUTO yêu cầu chat mới nhưng không tìm thấy nút New chat; đã chặn gửi vào chat cũ");
    }
    clickUiElement(newChat);

    let cleanComposer = await waitForStableFreshComposer(12000, 1800);
    if (!cleanComposer) {
      // A direct root navigation is the bounded fallback when ChatGPT ignores a
      // synthetic New chat click. Storage keeps the job, so the reloaded content
      // script resumes the exact same session nonce instead of posting here.
      location.replace(new URL("/", location.origin).href);
      cleanComposer = await waitForStableFreshComposer(8000, 1800);
    }

    if (!cleanComposer) {
      throw new Error("AUTO không xác nhận được New chat sạch trong 20 giây; đã chặn gửi prompt vào conversation cũ");
    }
    return cleanComposer;
  }

  function assertFreshBeforeFirstSend(job) {
    if (!job?.freshConversationRequired) return;
    if (!freshConversationIsClean(findComposer(), job)) {
      const error = new Error("AUTO phát hiện conversation cũ ngay trước khi gửi; đang tự quay lại New chat sạch");
      error.code = "MERCH_FLOW_STALE_CONVERSATION";
      throw error;
    }
  }

  async function armFreshSend(job) {
    let current = (await chrome.storage.local.get("pendingChatJob")).pendingChatJob;
    if (!current || current.jobId !== job.jobId) throw new Error("Job không còn tồn tại ngay trước khi Send");
    if (isConversationRoute() && current.freshCandidateConversationKey === location.pathname) {
      await sleep(1500);
      current = (await chrome.storage.local.get("pendingChatJob")).pendingChatJob;
      if (!current || current.jobId !== job.jobId) throw new Error("Job không còn tồn tại khi xác nhận route Create image");
    }
    assertFreshBeforeFirstSend(current);
    const updated = await updatePendingJob(job.jobId, {
      freshSendArmedAt: Date.now(),
      freshRouteTransitionArmedAt: 0
    });
    if (!updated) throw new Error("Job không còn tồn tại ngay trước khi Send");
    // chrome.storage is asynchronous. ChatGPT may restore a route while that
    // write is pending, so prove the page is still empty again after it returns.
    // The caller's send.click() then runs synchronously in the next microtask.
    assertFreshBeforeFirstSend(updated);
  }

  async function prepareFreshArtworkComposer(job, { forceNewChat = false } = {}) {
    let composer = await ensureFreshConversation(job, { forceNewChat });
    if (!composer) composer = await waitFor(findComposer);
    if (!composer) throw new Error("Không tìm thấy ô nhập ChatGPT trong 30 giây");
    composer = await ensureTextOnlyComposer(composer);
    const transitionJob = await updatePendingJob(job.jobId, {
      freshRouteTransitionArmedAt: Date.now(),
      freshCandidateConversationKey: "",
      freshCandidateSeenAt: 0,
      freshSendArmedAt: 0
    });
    if (!transitionJob) throw new Error("Job không còn tồn tại trước khi bật Create image");
    Object.assign(job, transitionJob);
    if (transitionJob.createImageModeBypass) {
      composer = findComposer() || composer;
      if (!canUseSafeTextToImageFallback(job, composer)) {
        throw new Error("Không thể dùng fallback text-to-image an toàn sau khi ChatGPT khôi phục chat cũ");
      }
      const bypassJob = await updatePendingJob(job.jobId, {
        freshRouteTransitionArmedAt: 0,
        freshCandidateConversationKey: "",
        freshCandidateSeenAt: 0,
        freshSendArmedAt: 0
      });
      if (!bypassJob) throw new Error("Job không còn tồn tại khi chuyển sang fallback text-to-image");
      Object.assign(job, bypassJob);
      await setChatStatus(
        "Create image của profile này vừa kéo vào chat cũ; đã khóa New chat sạch và gửi brief tạo ảnh ngắn qua composer thường.",
        "warning",
        job.jobId
      );
      return composer;
    }
    await setChatStatus("Đang bật Create image để khóa đúng text-to-image…", "info", job.jobId);
    try {
      return await activateCreateImageMode(composer);
    } catch (imageModeError) {
      composer = findComposer() || composer;
      if (!canUseSafeTextToImageFallback(job, composer)) throw imageModeError;
      await setChatStatus(
        "ChatGPT không lộ chip Create image; dùng brief tạo ảnh ngắn trong đúng phiên sạch, không có attachment.",
        "warning",
        job.jobId
      );
      return composer;
    }
  }

  function messageHasImage(message) {
    if (!message) return false;
    if (message.querySelector("img, [data-testid*='attachment' i], [data-testid*='file' i]")) return true;
    const labelText = [...message.querySelectorAll("button, [role='button'], a")]
      .map((node) => `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`)
      .join(" ");
    return /(attachment|image|file|ảnh|tệp)/i.test(labelText);
  }

  function recentReferenceOnlyMessage() {
    return userMessages().slice(-4).reverse().find((message) => {
      const text = message.innerText || message.textContent || "";
      return messageHasImage(message) && !/MERCH_FLOW_JOB_ID:\s*/.test(text);
    }) || null;
  }

  async function sendMarkedPrompt(prompt, marker, { timeoutMs = 30000, detectReferenceOnly = false, beforeSend = null } = {}) {
    const composer = await fillLiveComposer(prompt, marker, 15000);
    if (!composer) throw new Error("ChatGPT không nhận brief vào ô nhập đang hoạt động");

    const send = await waitFor(findSendButton, timeoutMs, 200);
    if (!send) throw new Error("Nút gửi chưa sẵn sàng sau khi điền brief");
    if (beforeSend) await beforeSend(composer, send);

    const previousMessages = new Set(userMessages());
    send.click();
    const startedAt = Date.now();
    let referenceOnlyMessage = null;
    let referenceOnlySeenAt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const newMessages = userMessages().filter((message) => !previousMessages.has(message));
      const marked = newMessages.find((message) => (message.innerText || message.textContent || "").includes(marker));
      if (marked) return { message: marked, referenceOnly: false };
      if (detectReferenceOnly) {
        if (!referenceOnlyMessage) {
          referenceOnlyMessage = newMessages.find((message) => messageHasImage(message)) || null;
          if (referenceOnlyMessage) referenceOnlySeenAt = Date.now();
        }
        // Give the message DOM a moment to render its text before deciding ChatGPT split
        // the reference image into an attachment-only message.
        if (referenceOnlyMessage && Date.now() - referenceOnlySeenAt >= 1200) {
          const text = referenceOnlyMessage.innerText || referenceOnlyMessage.textContent || "";
          if (text.includes(marker)) return { message: referenceOnlyMessage, referenceOnly: false };
          return { message: referenceOnlyMessage, referenceOnly: true };
        }
      }
      await sleep(250);
    }
    throw new Error("Không xác nhận được brief có Job ID đã gửi");
  }

  async function setChatStatus(message, tone = "info", jobId = "") {
    if (jobId && await isJobCancelled(jobId)) return;
    const update = { chatStatus: { message, tone, jobId, updatedAt: Date.now() } };
    const { autoRun } = await chrome.storage.local.get("autoRun");
    if (autoRun?.jobId === jobId) {
      let status = autoRun.status || "chatgpt";
      if (tone === "error") status = "failed";
      else if (/đã gửi (?:prompt|đúng brief|brief)/i.test(message)) status = "generating";
      else if (/đã lấy listing|chuyển sang Merch/i.test(message)) status = "preparing-merch";
      else if (/đã lấy đúng artwork|artwork đã xong/i.test(message)) status = "capturing-listing";
      update.autoRun = { ...autoRun, status, lastMessage: message, updatedAt: Date.now() };
    }
    await chrome.storage.local.set(update);
  }

  async function updatePendingJob(jobId, patch) {
    const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
    if (!pendingChatJob || pendingChatJob.jobId !== jobId) return null;
    const next = { ...pendingChatJob, ...patch, lastAttemptAt: Date.now() };
    await chrome.storage.local.set({ pendingChatJob: next });
    return next;
  }

  async function updateLastSentJob(jobId, patch) {
    const { lastSentChatJob } = await chrome.storage.local.get("lastSentChatJob");
    if (!lastSentChatJob || lastSentChatJob.jobId !== jobId) return null;
    const next = { ...lastSentChatJob, ...patch };
    await chrome.storage.local.set({ lastSentChatJob: next });
    return next;
  }

  async function failJob(jobId, error) {
    await updatePendingJob(jobId, { status: "failed", lastError: error });
    await setChatStatus(`Chưa gửi được: ${error}. Job vẫn được giữ để thử lại.`, "error", jobId);
    toast(`Merch Flow: ${error}`, "error");
  }

  async function expectedJobs() {
    const { pendingChatJob, lastSentChatJob } = await chrome.storage.local.get(["pendingChatJob", "lastSentChatJob"]);
    return [pendingChatJob, lastSentChatJob]
      .filter((job) => job?.jobId && jobBelongsToThisChat(job))
      .sort((left, right) => (right.sentAt || right.createdAt || 0) - (left.sentAt || left.createdAt || 0));
  }

  async function captureListingForJobId(jobId, constraints = {}) {
    const expectedJobId = String(jobId || "").trim();
    if (!expectedJobId) return null;
    await registrationPromise;
    const activeNonce = currentSessionNonce();
    const expectedSessionNonce = String(constraints.expectedSessionNonce || "").trim();
    if (expectedSessionNonce && activeNonce !== expectedSessionNonce) return null;

    const { chatArtwork, lastSentChatJob } = await chrome.storage.local.get(["chatArtwork", "lastSentChatJob"]);
    if (!storedArtworkIsUsable(chatArtwork, expectedJobId)) return null;
    if (chatArtwork.sessionNonce && activeNonce && chatArtwork.sessionNonce !== activeNonce) return null;
    if (expectedSessionNonce && chatArtwork.sessionNonce !== expectedSessionNonce) return null;
    if (constraints.expectedArtworkStorageKey && chatArtwork.storageKey !== constraints.expectedArtworkStorageKey) return null;
    const expectedRevision = Number.isFinite(Number(constraints.expectedArtworkRevision)) ? Number(constraints.expectedArtworkRevision) : null;
    if (expectedRevision !== null && Number(chatArtwork.artworkRevision || 0) !== expectedRevision) return null;
    if (lastSentChatJob?.jobId === expectedJobId && expectedSessionNonce && lastSentChatJob.sessionNonce && lastSentChatJob.sessionNonce !== expectedSessionNonce) return null;

    const marker = findJobMarkerMessage(expectedJobId);
    if (!marker) return null;
    const messages = conversationMessages();
    const markerIndex = messages.indexOf(marker);
    if (markerIndex < 0) return null;
    const artworkIndex = Number(chatArtwork.artworkMessageIndex ?? -1);
    const requestedMinimum = Number(constraints.minimumListingMessageIndex ?? -1);
    const minimumIndex = Math.max(markerIndex, artworkIndex, Number.isFinite(requestedMinimum) ? requestedMinimum : -1);
    if (artworkIndex < 0) return null;

    for (let messageIndex = messages.length - 1; messageIndex > minimumIndex; messageIndex -= 1) {
      const message = messages[messageIndex];
      if (messageRole(message) !== "assistant") continue;
      const listing = Core.parseListingFromAssistantText(message.innerText || message.textContent || "", expectedJobId);
      if (!listing) continue;
      const stored = {
        ...listing,
        source: "chatgpt",
        capturedAt: Date.now(),
        messageIndex,
        artworkMessageIndex: artworkIndex,
        artworkStorageKey: chatArtwork.storageKey,
        artworkRevision: Number(chatArtwork.artworkRevision || 0),
        sessionNonce: chatArtwork.sessionNonce || activeNonce,
        conversationKey: chatArtwork.conversationKey || location.pathname
      };
      await chrome.storage.local.set({ lastListing: stored });
      return stored;
    }
    return null;
  }

  async function captureListing() {
    const jobs = await expectedJobs();
    if (!jobs.length) return null;
    const { chatArtwork } = await chrome.storage.local.get("chatArtwork");
    const messages = conversationMessages();
    const minimumListingIndexByJob = new Map(jobs.map((job) => {
      const currentArtwork = findArtworkVisual(job.jobId);
      const currentIndex = Number.isFinite(currentArtwork?.messageIndex) ? currentArtwork.messageIndex : -1;
      const storedIndex = chatArtwork?.jobId === job.jobId && Number.isFinite(chatArtwork.artworkMessageIndex)
        ? chatArtwork.artworkMessageIndex
        : -1;
      const latestMarker = findJobMarkerMessage(job.jobId);
      const latestMarkerIndex = latestMarker ? messages.indexOf(latestMarker) : -1;
      return [job.jobId, Math.max(currentIndex, storedIndex, latestMarkerIndex)];
    }));
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      if (messageRole(message) !== "assistant") continue;
      const text = message.innerText || message.textContent || "";
      for (const job of jobs) {
        if (await isJobCancelled(job.jobId)) continue;
        if (!storedArtworkIsUsable(chatArtwork, job.jobId)) continue;
        if (chatArtwork.sessionNonce && chatArtwork.sessionNonce !== currentSessionNonce()) continue;
        const artworkIndex = Number(chatArtwork.artworkMessageIndex ?? -1);
        if (artworkIndex < 0 || messageIndex <= artworkIndex) continue;
        const minimumListingIndex = minimumListingIndexByJob.get(job.jobId) ?? -1;
        if (messageIndex < minimumListingIndex) continue;
        const listing = Core.parseListingFromAssistantText(text, job.jobId);
        if (!listing) continue;
        const { lastListing } = await chrome.storage.local.get("lastListing");
        const unchanged = lastListing?.jobId === listing.jobId
          && lastListing.artworkStorageKey === chatArtwork.storageKey
          && lastListing.sessionNonce === (chatArtwork.sessionNonce || currentSessionNonce())
          && Number(lastListing.artworkRevision || 0) === Number(chatArtwork.artworkRevision || 0)
          && Number(lastListing.messageIndex ?? -1) > artworkIndex
          && Core.LISTING_KEYS.every((key) => lastListing[key] === listing[key]);
        if (unchanged) return lastListing;
        const stored = {
          ...listing,
          source: "chatgpt",
          capturedAt: Date.now(),
          messageIndex,
          artworkMessageIndex: artworkIndex,
          artworkStorageKey: chatArtwork.storageKey,
          artworkRevision: Number(chatArtwork.artworkRevision || 0),
          sessionNonce: chatArtwork.sessionNonce || currentSessionNonce(),
          conversationKey: chatArtwork.conversationKey || location.pathname
        };
        await chrome.storage.local.set({ lastListing: stored });
        const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
        if (pendingChatJob?.jobId === job.jobId) await chrome.storage.local.remove("pendingChatJob");
        await updateLastSentJob(job.jobId, { listingCapturedAt: Date.now(), listingFollowupError: "" });
        await setChatStatus("Đã lấy listing hợp lệ cho artwork mới nhất. Extension đang chuẩn hoá và chuyển sang Merch.", "success", job.jobId);
        return stored;
      }
    }
    return null;
  }

  function findJobMarkerMessage(jobId) {
    const marker = `MERCH_FLOW_JOB_ID: ${jobId}`;
    return userMessages().reverse().find((message) => (message.innerText || message.textContent || "").includes(marker)) || null;
  }

  function followsNode(node, candidate) {
    if (!node || !candidate || node === candidate || node.contains(candidate)) return false;
    return Boolean(node.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function visualDimensions(element) {
    if (element instanceof HTMLCanvasElement) {
      return { width: element.width || element.clientWidth, height: element.height || element.clientHeight };
    }
    if (element instanceof HTMLImageElement) {
      const rect = element.getBoundingClientRect();
      return { width: element.naturalWidth || rect.width, height: element.naturalHeight || rect.height };
    }
    return { width: 0, height: 0 };
  }

  function visualScore(element, order) {
    // ChatGPT uses large canvases for UI effects and temporary render surfaces.
    // They are not downloadable generated artwork and must never enter storage.
    if (!(element instanceof HTMLImageElement) || element instanceof HTMLCanvasElement) return 0;
    const role = messageRole(element.closest?.('[data-message-author-role], section[data-turn]'));
    if (role === "user" || element.closest?.("form")) return 0;
    const { width, height } = visualDimensions(element);
    if (width < ARTWORK_MIN_EDGE || height < ARTWORK_MIN_EDGE) return 0;
    const ratio = Math.max(width / height, height / width);
    if (ratio > 4.5) return 0;
    const label = `${element.alt || ""} ${element.getAttribute?.("aria-label") || ""} ${element.getAttribute?.("data-testid") || ""}`.toLowerCase();
    if (/(avatar|profile photo|company logo|favicon|emoji|icon)/i.test(label)) return 0;
    const nearby = `${element.closest?.("figure, [data-testid], article, section, div")?.innerText || ""} ${element.closest?.("figure, [data-testid], article, section, div")?.getAttribute?.("aria-label") || ""}`.toLowerCase();
    let score = width * height;
    if (role === "assistant") score += 2_000_000_000;
    if (/(generated image|image generated|artwork|download image|edit image|ảnh đã tạo|tải ảnh)/i.test(`${label} ${nearby}`)) score += 3_000_000_000;
    if (element.closest?.("figure")) score += 500_000_000;
    if (element.currentSrc?.includes("oaiusercontent") || element.src?.includes("oaiusercontent")) score += 1_000_000_000;
    score += order * 1_000_000;
    return score;
  }

  function fallbackArtworkConfidence(element) {
    if (!(element instanceof HTMLImageElement) || element instanceof HTMLCanvasElement) return 0;
    const source = element.currentSrc || element.src || "";
    const label = `${element.alt || ""} ${element.getAttribute?.("aria-label") || ""} ${element.getAttribute?.("data-testid") || ""}`.toLowerCase();
    const container = element.closest?.("figure, [data-testid], article, section, div");
    const nearby = `${container?.innerText || ""} ${container?.getAttribute?.("aria-label") || ""}`.toLowerCase();
    let confidence = 0;
    if (/oaiusercontent|oaidalleapiprodscus/i.test(source)) confidence += 4;
    if (/(generated image|image generated|download image|edit image|ảnh đã tạo|tải ảnh)/i.test(`${label} ${nearby}`)) confidence += 3;
    if (element.closest?.("figure")) confidence += 1;
    if (messageRole(element.closest?.('[data-message-author-role], section[data-turn]')) === "assistant") confidence += 3;
    return confidence;
  }

  function visualIdentity(element) {
    const source = element instanceof HTMLImageElement ? visualSourceUrl(element) : "";
    if (!source) return "unknown";
    if (source.startsWith("data:image/")) return `data:${source.length}:${source.slice(0, 48)}`;
    try {
      const url = new URL(source, location.href);
      return `${url.hostname}${url.pathname}`;
    } catch (_) {
      return source.slice(0, 240);
    }
  }

  function findArtworkVisual(jobId) {
    const markerMessage = findJobMarkerMessage(jobId);
    const messages = conversationMessages();
    const markerIndex = markerMessage ? messages.indexOf(markerMessage) : -1;
    let endIndex = messages.length;

    if (markerIndex >= 0) {
      for (let index = markerIndex + 1; index < messages.length; index += 1) {
        const message = messages[index];
        if (messageRole(message) !== "user") continue;
        const text = message.innerText || message.textContent || "";
        if (/MERCH_FLOW_JOB_ID:\s*/.test(text) && !text.includes(`MERCH_FLOW_JOB_ID: ${jobId}`)) {
          endIndex = index;
          break;
        }
      }

      // Prefer the newest assistant response containing a valid artwork visual.
      // This prevents an older, larger image in the same chat from winning by size.
      for (let messageIndex = endIndex - 1; messageIndex > markerIndex; messageIndex -= 1) {
        const message = messages[messageIndex];
        if (messageRole(message) !== "assistant") continue;
        const visuals = [...message.querySelectorAll("img")];
        const candidates = visuals
          .map((element, visualIndex) => ({
            element,
            score: visualScore(element, visualIndex),
            visualIndex
          }))
          .filter((candidate) => candidate.score)
          .sort((left, right) => right.score - left.score || right.visualIndex - left.visualIndex);
        const winner = candidates[0];
        if (winner) {
          const dimensions = visualDimensions(winner.element);
          const position = messageIndex * 10000 + winner.visualIndex;
          return {
            element: winner.element,
            position,
            candidateKey: `${location.pathname}|${position}|${dimensions.width}x${dimensions.height}|${visualIdentity(winner.element)}`,
            conversationKey: location.pathname,
            messageIndex,
            visualIndex: winner.visualIndex
          };
        }
      }
    }

    // Fallback for layouts where generated images are rendered outside the role container.
    const scope = document.querySelector("main") || document.body;
    const nextJobMessage = markerIndex >= 0 && endIndex < messages.length ? messages[endIndex] : null;
    const visuals = [...scope.querySelectorAll("img")];
    const candidates = [];
    visuals.forEach((element, order) => {
      if (markerMessage && !followsNode(markerMessage, element)) return;
      if (nextJobMessage && followsNode(nextJobMessage, element)) return;
      const messageIndex = messages.findIndex((message) => message === element || message.contains?.(element));
      if (markerIndex >= 0 && (messageIndex <= markerIndex || messageRole(messages[messageIndex]) !== "assistant")) return;
      const score = visualScore(element, order);
      const confidence = fallbackArtworkConfidence(element);
      if (!score || confidence < 3) return;
      const dimensions = visualDimensions(element);
      candidates.push({
        element,
        score,
        confidence,
        order,
        position: 1_000_000_000 + order,
        candidateKey: `${location.pathname}|fallback|${order}|${dimensions.width}x${dimensions.height}|${visualIdentity(element)}`,
        conversationKey: location.pathname,
        messageIndex
      });
    });
    candidates.sort((left, right) => right.confidence - left.confidence || right.score - left.score || right.order - left.order);
    return candidates[0] || null;
  }

  function visualSourceUrl(visual) {
    if (!(visual instanceof HTMLImageElement)) return "";
    const direct = visual.currentSrc || visual.src || "";
    if (direct) return direct;
    const link = visual.closest?.("a[href]")?.href || "";
    return /^(?:https:|blob:|data:image)/i.test(link) ? link : "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Không đọc được artwork"));
      reader.readAsDataURL(blob);
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
  }

  function storedArtworkIsUsable(artwork, jobId = "") {
    if (!artwork?.dataUrl || !String(artwork.dataUrl).startsWith("data:image/")) return false;
    if (jobId && artwork.jobId !== jobId) return false;
    const sourceUrl = String(artwork.sourceUrl || "").trim().toLowerCase();
    const candidateKey = String(artwork.candidateKey || "").trim().toLowerCase();
    return sourceUrl !== "canvas" && !/(?:^|[|/])canvas$/.test(candidateKey);
  }

  async function purgeLegacyCanvasArtifacts() {
    const keys = [
      "lastSentChatJob", "chatArtwork", "lastListing", "finalListing",
      "processedArtwork", "finalArtwork", "pendingUpload", "lastAutoUpload",
      "merchStatus", "chatStatus", "autoRun"
    ];
    const data = await chrome.storage.local.get(keys);
    const invalidArtwork = data.chatArtwork;
    const sourceUrl = String(invalidArtwork?.sourceUrl || "").trim().toLowerCase();
    const candidateKey = String(invalidArtwork?.candidateKey || "").trim().toLowerCase();
    const isLegacyCanvas = Boolean(
      invalidArtwork?.jobId
      && (sourceUrl === "canvas" || /(?:^|[|/])canvas$/.test(candidateKey))
    );
    if (!isLegacyCanvas) return false;

    const jobId = invalidArtwork.jobId;
    const remove = ["chatArtwork"];
    for (const key of ["lastListing", "finalListing", "processedArtwork", "finalArtwork", "pendingUpload", "lastAutoUpload", "merchStatus"]) {
      if (data[key]?.jobId === jobId) remove.push(key);
    }
    await chrome.storage.local.remove([...new Set(remove)]);

    const update = {
      chatStatus: {
        message: "Đã loại canvas giao diện bị lưu nhầm. Đang tự thử lại artwork trong phiên text-to-image sạch; chưa xin listing.",
        tone: "warning",
        jobId,
        updatedAt: Date.now()
      }
    };
    if (data.lastSentChatJob?.jobId === jobId) {
      update.lastSentChatJob = {
        ...data.lastSentChatJob,
        artworkCapturedAt: 0,
        artworkCandidateKey: "",
        artworkCaptureError: "",
        listingFollowupSentAt: 0,
        listingCapturedAt: 0,
        listingFollowupRetryCount: 0,
        listingFollowupExhaustedAt: 0,
        listingFollowupError: ""
      };
    }
    if (data.autoRun?.jobId === jobId) {
      update.autoRun = {
        ...data.autoRun,
        status: "generating",
        lastMessage: "Canvas giao diện giả đã bị xoá; đang chờ artwork thật từ phiên text-to-image sạch.",
        updatedAt: Date.now()
      };
    }
    await chrome.storage.local.set(update);
    return true;
  }

  async function repairExhaustedArtworkStatus() {
    const data = await chrome.storage.local.get(["lastSentChatJob", "chatArtwork", "autoRun"]);
    const job = data.lastSentChatJob;
    if (!job?.jobId || !job.artworkRetryExhaustedAt) return false;
    if (Number(job.artworkRetryCount || 0) < ARTWORK_RETRY_MAX) return false;
    if (storedArtworkIsUsable(data.chatArtwork, job.jobId)) return false;
    if (data.autoRun?.jobId !== job.jobId || ["failed", "cancelled", "completed", "manual-override"].includes(data.autoRun.status)) return false;
    const message = "ChatGPT không tạo được ảnh thật sau các phiên sạch. AUTO đã dừng ở artwork; không xin listing và không sang Amazon.";
    await chrome.storage.local.set({
      autoRun: { ...data.autoRun, status: "failed", lastMessage: message, updatedAt: Date.now() },
      chatStatus: { message, tone: "error", jobId: job.jobId, updatedAt: Date.now() }
    });
    return true;
  }

  async function storeArtwork(jobId, dataUrl, name, sourceUrl = "", candidate = null) {
    if (await isJobCancelled(jobId)) return false;
    if (!dataUrl || !String(dataUrl).startsWith("data:image/")) return false;
    const { chatArtwork } = await chrome.storage.local.get("chatArtwork");
    const candidatePosition = Number(candidate?.position || 0);
    const candidateKey = candidate?.candidateKey || "";
    const conversationKey = candidate?.conversationKey || location.pathname;

    const revised = Boolean(chatArtwork?.jobId === jobId && chatArtwork?.dataUrl && candidateKey && chatArtwork.candidateKey !== candidateKey);
    if (chatArtwork?.jobId === jobId && chatArtwork?.dataUrl) {
      if (candidateKey && chatArtwork.candidateKey === candidateKey) return { captured: true, revised: false };
    }
    if (revised) {
      await chrome.storage.local.remove("lastListing");
      await updateLastSentJob(jobId, { listingFollowupSentAt: 0, listingCapturedAt: 0 });
    }

    await chrome.storage.local.set({
      chatArtwork: {
        jobId,
        storageKey: crypto.randomUUID(),
        dataUrl,
        name,
        sourceUrl,
        candidateKey,
        candidatePosition,
        conversationKey,
        sessionNonce: currentSessionNonce(),
        artworkRevision: Number((await chrome.storage.local.get("lastSentChatJob")).lastSentChatJob?.regenerationRevision || 0),
        artworkMessageIndex: Number.isFinite(candidate?.messageIndex) ? candidate.messageIndex : -1,
        createdAt: Date.now()
      }
    });
    await updateLastSentJob(jobId, { artworkCapturedAt: Date.now(), artworkCandidateKey: candidateKey });
    await setChatStatus("Đã lấy đúng artwork mới nhất của Job ID. Đang yêu cầu listing JSON nếu câu trả lời chưa có.", "success", jobId);
    return { captured: true, revised };
  }

  async function captureArtwork(job) {
    if (await isJobCancelled(job?.jobId)) return null;
    const { lastSentChatJob: currentJob } = await chrome.storage.local.get("lastSentChatJob");
    // A capture started for an older send/revision must never write into the newer revision state.
    // This closes the race where AUTO was still scanning the previous artwork while Regenerate
    // had already posted a new prompt with the same job_id.
    if (!currentJob || currentJob.jobId !== job?.jobId) return null;
    if (Number(currentJob.sentAt || 0) !== Number(job?.sentAt || 0)) return null;
    if (Number(currentJob.regenerationRevision || 0) !== Number(job?.regenerationRevision || 0)) return null;
    const { chatArtwork } = await chrome.storage.local.get("chatArtwork");
    const storedArtwork = storedArtworkIsUsable(chatArtwork, job.jobId) ? chatArtwork : null;
    const candidate = findArtworkVisual(job.jobId);
    if (!candidate) return storedArtwork
      && (!storedArtwork.sessionNonce || storedArtwork.sessionNonce === currentSessionNonce())
      ? { captured: true, revised: false } : null;
    if (storedArtwork) {
      if (candidate.candidateKey && storedArtwork.candidateKey === candidate.candidateKey) {
        if (Number(storedArtwork.artworkMessageIndex ?? -1) < 0 && Number.isFinite(candidate.messageIndex) && candidate.messageIndex >= 0) {
          await chrome.storage.local.set({
            chatArtwork: { ...storedArtwork, artworkMessageIndex: candidate.messageIndex }
          });
        }
        return { captured: true, revised: false };
      }
    }

    const visual = candidate.element;
    const name = `merch-flow-${job.jobId.slice(0, 8)}.png`;

    try {
      // Defense in depth: even if a future DOM selector regresses, a ChatGPT
      // canvas can never be serialized and stored as generated artwork.
      if (!(visual instanceof HTMLImageElement) || visual instanceof HTMLCanvasElement) return false;

      const sourceUrl = visualSourceUrl(visual);
      if (!sourceUrl) return false;
      if (sourceUrl.startsWith("data:image/")) return storeArtwork(job.jobId, sourceUrl, name, sourceUrl.slice(0, 32), candidate);

      try {
        const response = await fetch(sourceUrl, { credentials: "include" });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type.startsWith("image/")) return storeArtwork(job.jobId, await blobToDataUrl(blob), name, sourceUrl, candidate);
        }
      } catch (_) {
        // Try canvas/background fetch below.
      }

      try {
        const canvas = document.createElement("canvas");
        canvas.width = visual.naturalWidth;
        canvas.height = visual.naturalHeight;
        canvas.getContext("2d").drawImage(visual, 0, 0);
        const blob = await canvasToBlob(canvas);
        if (blob) return storeArtwork(job.jobId, await blobToDataUrl(blob), name, sourceUrl, candidate);
      } catch (_) {
        // A cross-origin image can taint canvas; use the service worker fetch fallback.
      }

      if (/^https:\/\//i.test(sourceUrl)) {
        const result = await chrome.runtime.sendMessage({
          type: "MERCH_FLOW_FETCH_IMAGE_V1",
          url: sourceUrl,
          jobId: job.jobId,
          name,
          candidateKey: candidate.candidateKey,
          candidatePosition: candidate.position,
          candidateMessageIndex: candidate.messageIndex,
          conversationKey: candidate.conversationKey,
          sessionNonce: initialSessionNonce,
          captureStartedAt: Date.now()
        });
        if (result?.stored) {
          const revised = Boolean(storedArtwork && storedArtwork.candidateKey !== candidate.candidateKey && !result.ignoredOlderCandidate);
          if (revised) {
            await chrome.storage.local.remove("lastListing");
            await updateLastSentJob(job.jobId, { listingFollowupSentAt: 0, listingCapturedAt: 0 });
          }
          await updateLastSentJob(job.jobId, { artworkCapturedAt: Date.now(), artworkCandidateKey: candidate.candidateKey });
          await setChatStatus("Đã lấy đúng artwork mới nhất của Job ID. Đang yêu cầu listing JSON nếu cần.", "success", job.jobId);
          return { captured: true, revised };
        }
      }
    } catch (error) {
      await updateLastSentJob(job.jobId, { artworkCaptureError: error.message || "Không lấy được artwork" });
    }
    return false;
  }

  function assistantResponseAfterLatestJobMarker(jobId) {
    const marker = findJobMarkerMessage(jobId);
    if (!marker) return null;
    const messages = conversationMessages();
    const markerIndex = messages.indexOf(marker);
    if (markerIndex < 0) return null;
    for (let index = messages.length - 1; index > markerIndex; index -= 1) {
      if (messageRole(messages[index]) === "assistant") return messages[index];
    }
    return null;
  }

  function artworkRetryPrompt(jobId, retryNumber, sourcePrompt = "") {
    return Core.buildArtworkRetryPrompt(jobId, retryNumber, sourcePrompt);
  }

  function looksLikeImageRoutingFailure(message) {
    const text = String(message?.innerText || message?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) return false;
    return /(upload|attach|provide|identify|supply).{0,100}(image|photo|artwork|picture)/i.test(text)
      || /image tool.{0,160}treated.{0,120}(?:the )?request.{0,120}(?:as an? )?edit.{0,120}requir(?:e|ed|es|ing).{0,100}(?:a )?source image/i.test(text)
      || /(?:edit|editing).{0,120}requir(?:e|ed|es|ing).{0,100}(?:a |an )?(?:source|existing) (?:image|photo|artwork|picture)/i.test(text)
      || /image tool.{0,120}(?:treated|interpreted|routed).{0,100}(?:edit|editing).{0,100}(?:image )?target/i.test(text)
      || /(?:edit|editing).{0,80}(?:requiring|requires|needs?).{0,80}(?:existing )?(?:image|photo|artwork|picture) target/i.test(text)
      || /(?:existing )?(?:image|photo|artwork|picture) target.{0,80}(?:required|needed|missing|not found)/i.test(text)
      || /(image|photo|artwork|picture).{0,100}(target|source).{0,80}(missing|not found|needed|required)/i.test(text)
      || /(edit|editing|modify|transform).{0,100}(image|photo|artwork|picture)/i.test(text)
      || /no (?:usable )?(?:image|photo|artwork|picture) (?:target|source)/i.test(text)
      || /c[oô]ng c[uụ] t[aạ]o [aả]nh.{0,180}(?:nh[aầ]m|hi[eể]u|route|routing).{0,180}(?:ch[iỉ]nh s[uử]a|s[uử]a).{0,100}(?:[aả]nh|h[iì]nh)/i.test(text)
      || /kh[oô]ng th[eể] t[aạ]o [aả]nh.{0,180}(?:ch[iỉ]nh s[uử]a|s[uử]a|[aả]nh c[oó] s[aẵ]n)/i.test(text)
      || /ch[uư]a th[eể] t[aạ]o [aả]nh.{0,240}c[oô]ng c[uụ].{0,160}y[eê]u c[aầ]u.{0,120}[aả]nh m[uụ]c ti[eê]u.{0,120}ch[iỉ]nh s[uử]a/i.test(text)
      || /ch[iỉ]nh s[uử]a [aả]nh c[oó] s[aẵ]n/i.test(text)
      || /(?:t[uừ] ch[oố]i|kh[oô]ng th[eể]).{0,120}(?:image|[aả]nh).{0,120}(?:edit|ch[iỉ]nh s[uử]a)/i.test(text)
      || /cannot retry .*same turn/i.test(text);
  }

  async function maybeRequestArtworkRetry(job, { force = false } = {}) {
    if (await isJobCancelled(job?.jobId)) return false;
    if (!job?.jobId || generationInProgress() || !jobBelongsToThisChat(job)) return false;
    const { chatArtwork, lastSentChatJob } = await chrome.storage.local.get(["chatArtwork", "lastSentChatJob"]);
    if (storedArtworkIsUsable(chatArtwork, job.jobId)) return false;
    if (findArtworkVisual(job.jobId)) return false;
    if (lastSentChatJob?.jobId !== job.jobId || !jobBelongsToThisChat(lastSentChatJob)) return false;
    const latestAssistant = assistantResponseAfterLatestJobMarker(job.jobId);
    if (!latestAssistant) return false;
    const routingFailure = looksLikeImageRoutingFailure(latestAssistant);

    const retryCount = Math.max(0, Number(lastSentChatJob.artworkRetryCount || 0));
    if (retryCount >= ARTWORK_RETRY_MAX) {
      if (!lastSentChatJob.artworkRetryExhaustedAt) {
        await updateLastSentJob(job.jobId, { artworkRetryExhaustedAt: Date.now() });
        await setChatStatus("ChatGPT đã trả text nhưng chưa có ảnh sau các phiên sạch tự thử lại. AUTO đã dừng ở artwork; không xin listing.", "error", job.jobId);
      }
      return false;
    }

    const baseline = Number(lastSentChatJob.artworkRetrySentAt || lastSentChatJob.sentAt || lastSentChatJob.createdAt || 0);
    const requiredWait = routingFailure ? 2 * 1000 : (force ? 8 * 1000 : ARTWORK_RETRY_AFTER_MS);
    if (baseline && Date.now() - baseline < requiredWait) return false;
    const sourcePrompt = String(lastSentChatJob.sourcePrompt || "").trim();
    if (!sourcePrompt) return false;

    const retryNumber = retryCount + 1;
    if (routingFailure) await setChatStatus("Phát hiện ChatGPT đi nhầm image-edit/missing-image. Đang tự mở phiên text-to-image sạch để thử lại.", "warning", job.jobId);
    const recoveryPrompt = artworkRetryPrompt(job.jobId, retryNumber, sourcePrompt);
    const sessionNonce = crypto.randomUUID();
    await updateLastSentJob(job.jobId, { artworkRetryCount: retryNumber, artworkRetrySentAt: Date.now() });
    const result = await chrome.runtime.sendMessage({
      type: "MERCH_FLOW_START_FRESH_CHAT_V1",
      job: {
        jobId: job.jobId,
        prompt: recoveryPrompt,
        sourcePrompt,
        referenceDataUrl: "",
        referenceName: "",
        createdAt: Date.now(),
        lastAttemptAt: 0,
        status: "pending",
        lastError: "",
        runMode: "fresh-artwork-retry",
        regenerationRevision: Math.max(0, Number(lastSentChatJob.regenerationRevision || 0)),
        artworkRetryCount: retryNumber,
        // If ChatGPT's explicit Create image tool routed a text-only request into
        // image edit, the next clean turn must use the normal composer. The prompt
        // remains an explicit compact new-image request and still carries no attachment.
        createImageModeBypass: routingFailure,
        sessionNonce
      },
      activate: true,
      closePreviousManaged: true
    });
    if (!result?.opened) {
      await setChatStatus(`Không mở được phiên sạch tự thử lại: ${result?.error || "lỗi không xác định"}`, "error", job.jobId);
      return false;
    }
    return true;
  }

  function listingFollowupPrompt(jobId) {
    return Core.buildListingPrompt(jobId);
  }

  function assistantResponseAfterLatestListingRequest(jobId) {
    const marker = `MERCH_FLOW_LISTING_REQUEST: ${jobId}`;
    const messages = conversationMessages();
    let requestIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messageRole(messages[index]) !== "user") continue;
      if ((messages[index].innerText || messages[index].textContent || "").includes(marker)) {
        requestIndex = index;
        break;
      }
    }
    if (requestIndex < 0) return null;
    for (let index = messages.length - 1; index > requestIndex; index -= 1) {
      if (messageRole(messages[index]) === "assistant") return messages[index];
    }
    return null;
  }

  async function requestListingFollowup(job, { force = false } = {}) {
    if (await isJobCancelled(job?.jobId)) return false;
    const { lastListing, lastSentChatJob, chatArtwork } = await chrome.storage.local.get(["lastListing", "lastSentChatJob", "chatArtwork"]);
    if (lastListing?.jobId === job.jobId) return false;
    if (lastSentChatJob?.jobId !== job.jobId) return false;
    // Never request listing text unless this exact send/revision has produced a real captured artwork.
    if (!storedArtworkIsUsable(chatArtwork, job.jobId)) return false;
    if (chatArtwork.sessionNonce && chatArtwork.sessionNonce !== currentSessionNonce()) return false;
    if (!jobBelongsToThisChat(lastSentChatJob)) return false;
    if (Number(lastSentChatJob.sentAt || 0) !== Number(job?.sentAt || 0)) return false;
    if (Number(lastSentChatJob.regenerationRevision || 0) !== Number(job?.regenerationRevision || 0)) return false;
    const revisionBoundary = Number(lastSentChatJob.regenerationMessageIndex ?? -1);
    const artworkIndex = Number(chatArtwork.artworkMessageIndex ?? -1);
    if (revisionBoundary >= 0 && artworkIndex <= revisionBoundary) return false;
    const previousFollowupAt = Number(lastSentChatJob.listingFollowupSentAt || 0);
    const followupAge = Date.now() - previousFollowupAt;
    if (previousFollowupAt && followupAge < FOLLOWUP_RETRY_MS) return false;
    if (generationInProgress()) return false;

    const previousListingResponse = previousFollowupAt ? assistantResponseAfterLatestListingRequest(job.jobId) : null;
    const retryCount = Math.max(0, Number(lastSentChatJob.listingFollowupRetryCount || 0));
    if (previousFollowupAt && retryCount >= LISTING_RETRY_MAX) {
      if (!lastSentChatJob.listingFollowupExhaustedAt) {
        const error = "ChatGPT trả listing JSON thiếu hoặc không hợp lệ sau 2 lần tự thử lại";
        await updateLastSentJob(job.jobId, {
          listingFollowupExhaustedAt: Date.now(),
          listingFollowupError: error
        });
        await setChatStatus(`${error}. AUTO đã dừng rõ ràng; artwork vẫn được giữ.`, "error", job.jobId);
      }
      return false;
    }
    // A completed response that was not parsed is malformed. If no response node
    // appeared at all, the same bounded retry also recovers a silently dropped turn.
    const nextRetryCount = previousFollowupAt ? retryCount + 1 : retryCount;

    const composer = findComposer();
    if (!composer || composerText(composer).trim()) return false;

    const followup = listingFollowupPrompt(job.jobId);
    const marker = `MERCH_FLOW_LISTING_REQUEST: ${job.jobId}`;
    await updateLastSentJob(job.jobId, {
      listingFollowupSentAt: Date.now(),
      listingFollowupRetryCount: nextRetryCount,
      listingFollowupError: "",
      listingFollowupExhaustedAt: 0
    });
    try {
      await sendMarkedPrompt(followup, marker, { timeoutMs: 20000 });
    } catch (error) {
      await updateLastSentJob(job.jobId, { listingFollowupSentAt: 0, listingFollowupError: error.message || "Không gửi được prompt listing" });
      return false;
    }
    await setChatStatus(
      previousFollowupAt
        ? `Listing JSON trước ${previousListingResponse ? "bị thiếu/không hợp lệ" : "không có phản hồi"}; đã tự gửi lại (${nextRetryCount}/${LISTING_RETRY_MAX}).`
        : "Artwork đã xong; đã tự yêu cầu ChatGPT trả listing JSON riêng.",
      "info",
      job.jobId
    );
    return true;
  }

  async function autoCaptureFlow({ force = false } = {}) {
    if (flowBusy) return null;
    flowBusy = true;
    try {
      let listing = await captureListing();
      const { lastSentChatJob } = await chrome.storage.local.get("lastSentChatJob");
      if (!lastSentChatJob?.jobId) return listing ? { listing } : null;
      if (!jobBelongsToThisChat(lastSentChatJob)) return null;
      if (await isJobCancelled(lastSentChatJob.jobId)) return { cancelled: true };
      const captured = await captureArtwork(lastSentChatJob);
      if (!captured?.captured) {
        const artworkRetryRequested = await maybeRequestArtworkRetry(lastSentChatJob, { force });
        if (force && !artworkRetryRequested) await setChatStatus("Chưa thấy artwork đủ lớn trong cuộc trò chuyện này. Extension sẽ tiếp tục quét và tự thử yêu cầu ảnh lại nếu ChatGPT chỉ trả lời bằng text.", "warning", lastSentChatJob.jobId);
        return listing ? { listing, artworkRetryRequested } : { artworkRetryRequested };
      }
      if (captured.revised) listing = null;
      if (!listing) {
        await sleep(900);
        listing = await captureListing();
      }
      if (listing) return { listing, artwork: true };
      const followupRequested = await requestListingFollowup(lastSentChatJob, { force });
      return { listing: null, artwork: true, followupRequested };
    } finally {
      flowBusy = false;
    }
  }

  function scheduleAutoFlow(delay = 650) {
    clearTimeout(flowTimer);
    flowTimer = setTimeout(() => autoCaptureFlow().catch(() => {}), delay);
  }

  let observer = null;

  function startAutoCaptureWatchers() {
    if (!observer) {
      observer = new MutationObserver(() => scheduleAutoFlow());
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
    if (!flowInterval) flowInterval = setInterval(() => autoCaptureFlow().catch(() => {}), 2500);
  }

  async function armAutoCaptureWatchersForOwnedJob(expectedJobId = "") {
    await registrationPromise;
    const data = await chrome.storage.local.get(["pendingChatJob", "lastSentChatJob"]);
    const candidates = [data.lastSentChatJob, data.pendingChatJob].filter(Boolean);
    const job = candidates.find((candidate) => !expectedJobId || candidate.jobId === expectedJobId) || candidates[0];
    if (!job?.jobId || !jobBelongsToThisChat(job)) return false;
    startAutoCaptureWatchers();
    return true;
  }

  async function regenerateArtworkInCurrentConversation(message) {
    const jobId = String(message?.jobId || "").trim();
    const prompt = String(message?.prompt || "");
    const revision = Math.max(1, Number(message?.revision || 1));
    if (!jobId || !prompt) throw new Error("Thiếu Job ID hoặc prompt tạo lại artwork");

    const flowData = await chrome.storage.local.get([
      "pendingChatJob", "lastSentChatJob", "chatArtwork", "lastListing",
      "processedArtwork", "pendingUpload", "autoRun"
    ]);
    const activeJobId = flowData.lastSentChatJob?.jobId
      || flowData.pendingChatJob?.jobId
      || flowData.chatArtwork?.jobId
      || flowData.lastListing?.jobId
      || flowData.processedArtwork?.jobId
      || flowData.pendingUpload?.jobId
      || flowData.autoRun?.jobId
      || "";
    if (activeJobId && activeJobId !== jobId) throw new Error("Job ID không khớp cuộc trò chuyện hiện tại");

    const readyComposer = await waitFor(() => {
      if (generationInProgress()) return null;
      const composer = findComposer();
      if (!composer || composerText(composer).trim()) return null;
      return composer;
    }, 120000, 400);
    if (!readyComposer) throw new Error("ChatGPT đang bận hoặc ô nhập có nội dung; chưa ghi đè để tránh mất dữ liệu");

    const marker = `MERCH_FLOW_REGENERATE_ARTWORK: ${jobId}`;
    await setChatStatus("Đang bật Create image cho revision mới…", "info", jobId);
    let imageComposer = await ensureTextOnlyComposer(readyComposer);
    imageComposer = await activateCreateImageMode(imageComposer);
    if (!imageComposer) throw new Error("Không bật được Create image cho revision");
    await setChatStatus("Đang gửi yêu cầu tạo mẫu khác trong đúng cuộc chat hiện tại…", "info", jobId);
    const outcome = await sendMarkedPrompt(prompt, marker, { timeoutMs: 35000 });
    const messageIndex = conversationMessages().indexOf(outcome.message);
    const previous = flowData.lastSentChatJob || {};
    const now = Date.now();
    const nextLastSentChatJob = {
      ...previous,
      jobId,
      createdAt: previous.createdAt || now,
      sentAt: now,
      conversationKey: location.pathname,
      regenerationRevision: revision,
      regenerationPromptSentAt: now,
      regenerationMessageIndex: messageIndex,
      listingFollowupSentAt: 0,
      listingCapturedAt: 0,
      artworkCapturedAt: 0,
      artworkRetryCount: 0,
      artworkRetrySentAt: 0,
      artworkRetryExhaustedAt: 0,
      artworkCandidateKey: "",
      artworkCaptureError: "",
      runMode: previous.runMode || flowData.autoRun?.mode || "guided-auto"
    };
    const update = {
      lastSentChatJob: nextLastSentChatJob,
      chatStatus: {
        message: `Đã gửi revision ${revision} trong cuộc chat hiện tại. Đang chờ artwork mới.`,
        tone: "success",
        jobId,
        updatedAt: now
      }
    };
    if (flowData.autoRun?.jobId === jobId) {
      update.autoRun = {
        ...flowData.autoRun,
        status: "regenerating",
        lastMessage: `Đang tạo artwork revision ${revision} trong cuộc chat hiện tại…`,
        updatedAt: now
      };
    }
    await chrome.storage.local.set(update);
    await chrome.storage.local.remove([
      "pendingChatJob", "chatArtwork", "lastListing", "processedArtwork",
      "pendingUpload", "lastAutoUpload", "merchStatus"
    ]);
    toast("Merch Flow: Đang tạo mẫu khác trong đúng cuộc chat này.");
    scheduleAutoFlow(700);
    return { sent: true, jobId, revision, conversationKey: location.pathname, messageIndex };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MERCH_FLOW_CANCEL_JOB_V1") {
      const jobId = String(message?.jobId || "");
      if (jobId) cancelledJobIds.add(jobId);
      clearTimeout(flowTimer);
      flowBusy = false;
      toast("Merch Flow: AUTO đã hủy. Phản hồi đến muộn của job này sẽ bị bỏ qua.", "warning");
      sendResponse({ cancelled: true, jobId });
      return false;
    }
    if (message?.type === "MERCH_FLOW_PROBE_CLEAN_IMAGE_CHAT_V1") {
      const composer = findComposer();
      sendResponse({
        cleanImageComposer: Boolean(
          composer
          && !isConversationRoute()
          && conversationMessages().length === 0
          && !composerDraftText(composer)
          && imageModeChipVisible(composer)
          && !composerHasAttachedFile(composer)
          && !specializedComposerContext(composer)
        )
      });
      return false;
    }
    if (message?.type === "MERCH_FLOW_CLAIM_CLEAN_IMAGE_CHAT_V1") {
      (async () => {
        const jobId = String(message.jobId || "");
        const sessionNonce = String(message.sessionNonce || "");
        const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
        const composer = findComposer();
        if (!jobId || !sessionNonce || pendingChatJob?.jobId !== jobId || pendingChatJob?.sessionNonce !== sessionNonce) {
          throw new Error("Job/session không khớp tab Create image sạch");
        }
        if (
          !composer
          || isConversationRoute()
          || conversationMessages().length !== 0
          || composerDraftText(composer)
          || !imageModeChipVisible(composer)
          || composerHasAttachedFile(composer)
          || specializedComposerContext(composer)
        ) throw new Error("Tab không còn là New chat Create image sạch");
        registeredTabId = Number(message.tabId || pendingChatJob.chatTabId || 0);
        registeredJobId = jobId;
        registeredSessionNonce = sessionNonce;
        const result = await runChatJob({ allowPendingWithoutUrl: true, expectedJobId: jobId });
        return { claimed: true, ...result };
      })().then(sendResponse).catch((error) => sendResponse({ claimed: false, error: error.message || "Không nhận được job" }));
      return true;
    }
    const isGet = ["MERCH_FLOW_GET_LISTING_V6", "MERCH_FLOW_GET_LISTING_V5", "MERCH_FLOW_GET_LISTING_V4", "MERCH_FLOW_GET_LISTING_V3"].includes(message?.type);
    const isResume = ["MERCH_FLOW_RESUME_V6", "MERCH_FLOW_RESUME_V5"].includes(message?.type);
    const isRegenerate = message?.type === "MERCH_FLOW_REGENERATE_ARTWORK_V1";
    if (isRegenerate) {
      regenerateArtworkInCurrentConversation(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ sent: false, error: error.message || "Không tạo lại được artwork" }));
      return true;
    }
    if (isGet || isResume) {
      (async () => {
        let retry = null;
        if (isResume) {
          const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
          if (pendingChatJob?.jobId && ["pending", "running", "failed"].includes(pendingChatJob.status)) {
            retry = await runChatJob({ allowPendingWithoutUrl: true, expectedJobId: pendingChatJob.jobId });
          }
        }
        const expectedJobId = String(message?.expectedJobId || "").trim();
        if (isResume && !expectedJobId) throw new Error("Resume bị chặn: thiếu expectedJobId");
        const listingConstraints = {
          expectedSessionNonce: String(message?.expectedSessionNonce || ""),
          expectedArtworkStorageKey: String(message?.expectedArtworkStorageKey || ""),
          expectedArtworkRevision: message?.expectedArtworkRevision,
          minimumListingMessageIndex: message?.minimumListingMessageIndex
        };
        const exactListing = expectedJobId ? await captureListingForJobId(expectedJobId, listingConstraints) : null;
        const preflight = await chrome.storage.local.get(["lastSentChatJob"]);
        const expectedConversation = Boolean(expectedJobId && findJobMarkerMessage(expectedJobId));
        const canAdvanceExpectedFlow = Boolean(
          expectedConversation
          && preflight.lastSentChatJob?.jobId === expectedJobId
          && jobBelongsToThisChat(preflight.lastSentChatJob)
        );
        const result = exactListing
          ? { listing: exactListing }
          : expectedJobId
            ? (canAdvanceExpectedFlow ? await autoCaptureFlow({ force: isResume }) : null)
            : await autoCaptureFlow({ force: isResume });
        const { lastListing, chatArtwork, lastSentChatJob, pendingChatJob } = await chrome.storage.local.get(["lastListing", "chatArtwork", "lastSentChatJob", "pendingChatJob"]);
        const storedListingMatches = Boolean(
          lastListing?.jobId === expectedJobId
          && (!listingConstraints.expectedSessionNonce || lastListing.sessionNonce === listingConstraints.expectedSessionNonce)
          && (!listingConstraints.expectedArtworkStorageKey || lastListing.artworkStorageKey === listingConstraints.expectedArtworkStorageKey)
          && (listingConstraints.expectedArtworkRevision === undefined || Number(lastListing.artworkRevision || 0) === Number(listingConstraints.expectedArtworkRevision || 0))
          && (listingConstraints.minimumListingMessageIndex === undefined || Number(lastListing.messageIndex ?? -1) > Number(listingConstraints.minimumListingMessageIndex ?? -1))
        );
        const storedListing = expectedJobId ? (storedListingMatches ? lastListing : null) : (isResume ? null : (lastListing || null));
        const responseListing = result?.listing && (!expectedJobId || result.listing.jobId === expectedJobId)
          ? result.listing
          : storedListing;
        const responseJobId = expectedJobId || lastSentChatJob?.jobId || pendingChatJob?.jobId || "";
        return {
          listing: responseListing || null,
          artwork: Boolean(result?.artwork || storedArtworkIsUsable(chatArtwork, expectedJobId)),
          followupRequested: Boolean(result?.followupRequested && (!expectedJobId || lastSentChatJob?.jobId === expectedJobId)),
          retried: Boolean(retry?.sent),
          retryError: retry?.error || "",
          pending: Boolean(pendingChatJob?.jobId && (!expectedJobId || pendingChatJob.jobId === expectedJobId)),
          jobId: responseJobId
        };
      })()
        .then(sendResponse)
        .catch((error) => sendResponse({ listing: null, error: error.message }));
      return true;
    }
  });

  async function attachReference(job, composer) {
    await setChatStatus("Đang đính kèm ảnh tham chiếu…", "info", job.jobId);
    let input = findAttachmentInput();
    if (!input) {
      const button = findAttachmentButton();
      if (!button) throw new Error("Không tìm thấy nút đính kèm ảnh trên ChatGPT");
      button.click();
      input = await waitFor(findAttachmentInput);
    }
    if (!input) throw new Error("ChatGPT không hiện ô chọn ảnh trong 30 giây");

    const response = await fetch(job.referenceDataUrl);
    if (!response.ok) throw new Error("Không đọc được ảnh tham chiếu đã lưu local");
    const blob = await response.blob();
    const file = new File([blob], job.referenceName || "merch-flow-reference.jpg", { type: blob.type || "image/jpeg", lastModified: Date.now() });
    const scope = composerScope(composer);
    const baselineCount = attachmentVisuals(scope).length;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    if (!sameSelectedFile(input, file)) throw new Error("Không đưa được ảnh vào ô upload của ChatGPT");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const confirmation = await confirmAttachmentSelection(input, file, composer, baselineCount);
    await setChatStatus(
      confirmation.verified ? "Đã đính kèm ảnh tham chiếu." : "Ảnh đã được chọn; tiếp tục gửi dù ChatGPT không lộ preview cho extension.",
      confirmation.verified ? "success" : "info",
      job.jobId
    );
    return confirmation;
  }

  async function runChatJob({ allowPendingWithoutUrl = false, expectedJobId = "" } = {}) {
    if (globalThis.__MERCH_FLOW_CHAT_RUNNING__) return { running: true };
    const storedJob = await chrome.storage.local.get("pendingChatJob");
    let pendingChatJob = storedJob.pendingChatJob;
    const requestedJobId = expectedJobId || initialJobFromUrl || (allowPendingWithoutUrl ? pendingChatJob?.jobId : "");
    if (!pendingChatJob || !requestedJobId || pendingChatJob.jobId !== requestedJobId) return { skipped: true };
    await registrationPromise;
    const activeSessionNonce = initialSessionNonce || registeredSessionNonce || "";
    if (pendingChatJob.sessionNonce && activeSessionNonce && pendingChatJob.sessionNonce !== activeSessionNonce) return { skipped: true, wrongSession: true };
    if (pendingChatJob.sessionNonce && !activeSessionNonce) return { skipped: true, wrongSession: true };
    if (await isJobCancelled(pendingChatJob.jobId)) return { cancelled: true };
    if (Date.now() - pendingChatJob.createdAt > 15 * 60 * 1000) {
      await chrome.storage.local.remove("pendingChatJob");
      await setChatStatus("Job ChatGPT đã hết hạn sau 15 phút.", "error", pendingChatJob.jobId);
      return { expired: true };
    }

    // v0.9.5 migration guard: old pending jobs may still contain a local winner
    // attachment from pre-hardening builds. Strip it before touching the composer.
    if (pendingChatJob.referenceDataUrl || pendingChatJob.referenceName || pendingChatJob.referenceAlreadySent || pendingChatJob.recoveryMode) {
      pendingChatJob = {
        ...pendingChatJob,
        referenceDataUrl: "",
        referenceName: "",
        referenceAlreadySent: false,
        recoveryMode: ""
      };
      await chrome.storage.local.set({ pendingChatJob });
    }

    globalThis.__MERCH_FLOW_CHAT_RUNNING__ = true;
    const marker = `MERCH_FLOW_JOB_ID: ${pendingChatJob.jobId}`;
    let attachmentConfirmation = null;
    try {
      await updatePendingJob(pendingChatJob.jobId, { status: "running", lastError: "", freshSendArmedAt: 0 });
      await setChatStatus("Đang xác nhận đây là New chat sạch…", "info", pendingChatJob.jobId);
      let composer = await prepareFreshArtworkComposer(pendingChatJob);

      const inferredReferenceAlreadySent = Boolean(
        pendingChatJob.referenceAlreadySent
        || (pendingChatJob.status === "failed"
          && /không xác nhận được prompt đã gửi|không xác nhận được brief/i.test(pendingChatJob.lastError || "")
          && recentReferenceOnlyMessage())
      );
      if (inferredReferenceAlreadySent && !pendingChatJob.referenceAlreadySent) {
        await updatePendingJob(pendingChatJob.jobId, { referenceAlreadySent: true, recoveryMode: "prompt-after-reference" });
      }

      if (pendingChatJob.referenceDataUrl && !inferredReferenceAlreadySent) {
        attachmentConfirmation = await attachReference(pendingChatJob, composer);
        // ChatGPT commonly replaces the editor node after an attachment is added.
        // Never keep writing into the stale node captured before upload.
        composer = await waitFor(findComposer, 15000, 200);
        if (!composer) throw new Error("Ô nhập ChatGPT biến mất sau khi đính kèm ảnh");
      }

      await setChatStatus(
        inferredReferenceAlreadySent ? "Đang phục hồi brief…" : "Đang điền brief text-to-image có Job ID…",
        "info",
        pendingChatJob.jobId
      );

      let outcome = null;
      for (let sendAttempt = 0; sendAttempt < 3 && !outcome; sendAttempt += 1) {
        try {
          outcome = await sendMarkedPrompt(pendingChatJob.prompt, marker, {
            timeoutMs: 35000,
            detectReferenceOnly: Boolean(pendingChatJob.referenceDataUrl && !inferredReferenceAlreadySent),
            // This runs after the prompt and Send button are ready, immediately
            // before the click. It closes the late ChatGPT restore race seen in production.
            beforeSend: () => armFreshSend(pendingChatJob)
          });
        } catch (error) {
          if (error?.code !== "MERCH_FLOW_STALE_CONVERSATION" || sendAttempt >= 2) throw error;
          const rejectedConversationKey = isConversationRoute() ? String(location.pathname || "") : "";
          const currentJob = (await chrome.storage.local.get("pendingChatJob")).pendingChatJob;
          const staleConversationKeys = [...new Set([
            ...(Array.isArray(currentJob?.staleConversationKeys) ? currentJob.staleConversationKeys : []),
            rejectedConversationKey
          ].filter(Boolean))];
          await updatePendingJob(pendingChatJob.jobId, {
            freshSendArmedAt: 0,
            freshRouteTransitionArmedAt: 0,
            freshCandidateConversationKey: "",
            freshCandidateSeenAt: 0,
            staleConversationKeys,
            createImageModeBypass: Boolean(currentJob?.createImageModeBypass || (rejectedConversationKey && conversationMessages().length > 0))
          });
          const staleComposer = findComposer();
          if (staleComposer && composerText(staleComposer).includes(marker)) setComposerValue(staleComposer, "");
          await setChatStatus(
            `AUTO: ChatGPT vừa khôi phục chat cũ; đang tự mở lại New chat sạch (${sendAttempt + 1}/2)…`,
            "warning",
            pendingChatJob.jobId
          );
          composer = await prepareFreshArtworkComposer(pendingChatJob, { forceNewChat: true });
        }
      }
      if (!outcome) throw new Error("Không gửi được brief trong New chat sạch sau 3 lần thử");

      if (outcome.referenceOnly) {
        await updatePendingJob(pendingChatJob.jobId, {
          referenceAlreadySent: true,
          recoveryMode: "prompt-after-reference",
          status: "running",
          lastError: ""
        });
        await setChatStatus("ChatGPT đã gửi ảnh tham chiếu thành tin riêng. Đang chờ phản hồi xong rồi tự gửi brief, không cần thao tác.", "info", pendingChatJob.jobId);
        await waitFor(() => !generationInProgress() && findComposer(), 120000, 500);
        outcome = await sendMarkedPrompt(pendingChatJob.prompt, marker, {
          timeoutMs: 35000,
          beforeSend: () => armFreshSend(pendingChatJob)
        });
      }

      const imageVisibleAfterSend = pendingChatJob.referenceDataUrl
        ? Boolean(inferredReferenceAlreadySent || outcome.referenceOnly || messageHasImage(outcome.message) || recentReferenceOnlyMessage())
        : false;
      await chrome.storage.local.set({
        lastSentChatJob: {
          jobId: pendingChatJob.jobId,
          createdAt: pendingChatJob.createdAt,
          sentAt: Date.now(),
          sourcePrompt: pendingChatJob.sourcePrompt || pendingChatJob.prompt,
          sessionNonce: pendingChatJob.sessionNonce || initialSessionNonce,
          referenceExpected: Boolean(pendingChatJob.referenceDataUrl),
          referencePickerConfirmed: Boolean(attachmentConfirmation?.verified || inferredReferenceAlreadySent),
          referenceVisibleInMessage: imageVisibleAfterSend,
          listingFollowupSentAt: 0,
          artworkCapturedAt: 0,
          artworkRetryCount: Math.max(0, Number(pendingChatJob.artworkRetryCount || 0)),
          artworkRetrySentAt: 0,
          artworkRetryExhaustedAt: 0,
          conversationKey: location.pathname,
          chatTabId: pendingChatJob.chatTabId || 0,
          runMode: pendingChatJob.runMode || "guided",
          regenerationRevision: Math.max(0, Number(pendingChatJob.regenerationRevision || 0)),
          regenerationPromptSentAt: pendingChatJob.regenerationRevision ? Date.now() : 0,
          regenerationMessageIndex: pendingChatJob.regenerationRevision ? conversationMessages().indexOf(outcome.message) : -1
        }
      });
      await chrome.storage.local.remove("pendingChatJob");
      await setChatStatus("Đã gửi đúng brief có Job ID. Extension sẽ tự lấy artwork, xin listing và chuyển sang Merch.", "success", pendingChatJob.jobId);
      if (initialJobFromUrl) history.replaceState({}, document.title, location.pathname + location.hash);
      armAutoCaptureWatchersForOwnedJob(pendingChatJob.jobId).catch(() => {});
      scheduleAutoFlow(500);
      return { sent: true, jobId: pendingChatJob.jobId };
    } catch (error) {
      await failJob(pendingChatJob.jobId, error.message || "Lỗi không xác định");
      return { sent: false, error: error.message || "Lỗi không xác định", jobId: pendingChatJob.jobId };
    } finally {
      globalThis.__MERCH_FLOW_CHAT_RUNNING__ = false;
    }
  }

  globalThis.__MERCH_FLOW_CHAT_CLEANUP__ = () => {
    clearTimeout(flowTimer);
    if (flowInterval) clearInterval(flowInterval);
    try { observer?.disconnect(); } catch (_) { /* already disconnected */ }
    flowTimer = 0;
    flowInterval = 0;
  };

  purgeLegacyCanvasArtifacts()
    .catch(() => false)
    .then(() => repairExhaustedArtworkStatus().catch(() => false))
    .finally(() => armAutoCaptureWatchersForOwnedJob(initialJobFromUrl || registeredJobId).catch(() => false));
  if (initialJobFromUrl) {
    runChatJob({ expectedJobId: initialJobFromUrl });
  } else {
    registrationPromise.then(async (registration) => {
      if (!registration?.registered || !registration.jobId) return;
      const { pendingChatJob } = await chrome.storage.local.get("pendingChatJob");
      if (!pendingChatJob?.jobId || pendingChatJob.jobId !== registration.jobId) return;
      if (Number(pendingChatJob.chatTabId || 0) && registeredTabId && Number(pendingChatJob.chatTabId) !== registeredTabId) return;
      runChatJob({ allowPendingWithoutUrl: true, expectedJobId: pendingChatJob.jobId });
    }).catch(() => {});
  }
})();
