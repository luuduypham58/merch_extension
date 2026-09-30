# v0.9.33

- Replaced the fixed `top setup + one stick figure + bottom punchline` grammar with job-specific creative lanes.
- Added 12 visual-construction families (POV, object gag, mini-scene, before/after, diagram, cutaway, multi-character blocking, etc.).
- Activated the existing 8-concept silent exploration rule in the actual compact image prompt.
- Added creative fingerprints to saved Vault designs so memory can avoid situation + construction, not only title wording.
- Increased recent concept-memory diversity while keeping new-image prompts below the compact routing ceiling.
- Bumped the default book profile to `book-winner-creative-scene-v3`.

# v0.9.32

- Replaced the oversized one-turn Merch brief with a compact two-sentence image request after a live one-sentence CDP probe generated successfully on the same ChatGPT profile.
- Removed routing-style metadata (`TASK_CLASS`, `INPUT_ASSETS`, `TEXT_TO_IMAGE_ONLY`) from new prompts and kept only the extension's neutral image-request marker.
- Made retries reuse only a compact brief; legacy oversized jobs fall back to a short book-lover pictogram request instead of replaying the old prompt.
- Kept the compact brief quality-aware by explicitly blocking the profile's saturated reader slogans, including `just one more chapter` and `I'd rather be reading`.
- Kept genuine-`img` capture, bounded retries, listing binding, Amazon upload verification, manual product/color selection, and never-Publish safeguards unchanged.

# v0.9.31

- Routed every explicit `TEXT_TO_IMAGE` + `INPUT_ASSETS: NONE` job through a verified clean normal ChatGPT composer instead of the unreliable Create image chip.
- Kept New-chat ownership, no-attachment checks, prompt markers, bounded retries, and the real-image-only listing gate unchanged.

# v0.9.30

- Removed `source image` wording from both initial and retry artwork prompts so ChatGPT's image router sees only an affirmative new-image instruction.
- Preserved the machine guards `TASK_CLASS: TEXT_TO_IMAGE`, `INPUT_ASSETS: NONE`, and `TEXT_TO_IMAGE_ONLY` plus the no-attachment runtime checks.

# v0.9.29

- Rejected every ChatGPT `canvas` as artwork, including defense-in-depth checks before capture and legacy storage reuse.
- Recognized English and Vietnamese image-tool refusals where a text-to-image request is treated as an edit requiring a source image, then opened a bounded fresh retry through the normal clean composer without an attachment.
- Kept listing generation hard-blocked until the current job/session has a genuine captured image.

# v0.9.28

- Prevented duplicate Amazon content-script runtimes after extension reload by registering a per-tab runtime and forcing one guarded reload when an active job is present.
- Added finite listing/product readiness timeout so AUTO moves to `needs-attention` instead of retrying indefinitely.
- Preserved the existing safety gate: Publish is never clicked automatically.

# v0.9.27

- Revalidate artwork trên DOM Amazon khi resume; không tin `artworkVerified` cũ sau page reload.
- Nếu uploader về trạng thái trống, reset checkpoint và tự upload lại đúng PNG cùng job.
- Tự bấm Save publish settings (không Publish), rồi chỉ bàn giao khi Publish/Review enabled.

# v0.9.26

- Đưa native checked setter + input/change lên trước `.click()` trong Select Products.
- Tránh Angular handler chậm ~15 giây và cancel state trên từng checkbox.
- Giữ click/label làm fallback cho UI variant khác, vẫn verify live state sau mỗi lựa chọn.

# v0.9.25

- Chờ positive artwork signal ổn định 1,8 giây để không tin preview tạm trước server validation.
- Nhận diện “Please upload a valid PNG” và chặn mọi success/listing/product continuation.
- Chỉ báo review khi Publish/Review control đang enabled; thêm watchdog 45 giây cho callback product selection bị kẹt.

# v0.9.24

- Thêm native checked setter + input/change fallback cho grid Select Products Angular hiện tại của Amazon.
- Vẫn đọc lại state sau event; không báo chọn thành công giả.
- Pending upload failed của bản cũ được cơ chế retryVersion tự thử lại sau khi reload extension.

# v0.9.23

- Suy ra assistant message index cho artwork tìm qua nhánh DOM fallback.
- Tự chữa `artworkMessageIndex: -1` khi candidate hiện tại khớp artwork đã lưu.
- Cho phép lấy listing hợp lệ cũ sau khi provenance được chữa, vẫn giữ binding Job ID/session/storage key/revision.

# v0.9.22

- Tự retry listing JSON malformed/missing sau cooldown, tối đa 2 lần.
- Sau giới hạn, ghi `listingFollowupError`, `listingFollowupExhaustedAt` và chuyển AUTO sang failed rõ ràng, vẫn giữ artwork.
- Không đánh dấu artwork retry exhausted nếu DOM đã có generated-image candidate đang được tải.

# v0.9.21

- Hỗ trợ assistant turn mới `section[data-turn="assistant"]` của ChatGPT cho cả artwork, listing và nhận diện lỗi routing.
- Cho phép tải signed URL ảnh qua fetch/background ngay cả khi `<img>` đang opacity 0 hoặc chưa có `naturalWidth`.
- Giữ tương thích markup cũ và loại duplicate user/assistant nodes khi cả hai selector cùng tồn tại.

# v0.9.20

- Nhận quyền một New chat đã bật Create image sau khi probe xác nhận route `/`, 0 message, 0 draft, 0 attachment và không phải Deep Research.
- Phân biệt text draft với chip tool trong contenteditable để chip Create image không làm kiểm tra “composer trống” thất bại.
- Route candidate chưa có trong deny-list nhưng thực tế chứa message sẽ bị content script từ chối, ghi vào deny-list và không được tin lại.

# v0.9.19

- Chặn vòng lặp Create image -> chat cũ -> New chat: route cũ trong deny-list giờ bật cờ fallback thay vì lặp click menu đến khi job chết.
- Fallback chỉ gửi brief `TEXT_TO_IMAGE_ONLY` trong đúng tab/session, không attachment, composer thường và New chat có 0 message.
- Vẫn giữ handshake route mới của v0.9.18 và hai lần kiểm tra fresh ngay trước Send.

# v0.9.18

- Phân biệt conversation mới rỗng do Create image tạo trước Send với chat lịch sử cũ.
- Content script arm một cửa sổ chuyển route 30 giây; background chỉ nhận route chưa nằm trong stale deny-list.
- Trước Send, content script đọc lại job, chờ route ứng viên ổn định thêm 1,5 giây và yêu cầu conversation vẫn có 0 message.
- Route cũ đã biết vẫn bị chặn kể cả trong transition window.

# v0.9.17

- Thay synthetic `dispatchEvent("click")` bằng native `HTMLElement.click()` để New chat thực sự commit state router của ChatGPT.
- Nhận diện menu Create image hiện tại qua `div.__menu-item`, đồng thời loại trừ sidebar/history conversation.
- Giữ nguyên `[data-inline-selection-pill]` Create image khi điền prompt vào ProseMirror thay vì xoá toàn bộ composer.
- Xác nhận lại pill sau khi điền prompt; không Send nếu image mode vừa bị mất.
- Giảm vòng dò menu từ 3 × 8,5 giây xuống 2 × 4,5 giây để trạng thái lỗi/fallback xuất hiện sớm.

# v0.9.16

- Job `failed` luôn được **Tiếp tục** bằng một phiên ChatGPT trắng mới thay vì retry trong tab hiện tại.
- Reset `freshRouteRepairCount`, cờ Send và stale routes khi mở phiên recovery.
- Fresh job dùng URL canonical `https://chatgpt.com/`; quyền sở hữu vẫn khóa bằng tab ID + session nonce trong storage.
- Mọi `/c/...` xuất hiện trước khi Send được thêm ngay vào deny-list, kể cả khi route đó chưa tồn tại lúc job bắt đầu.
- Đã xác nhận CDP thật trên Chrome 151 qua endpoint IPv6 `[::1]:9222`.

# v0.9.15

- Ghi lại mọi conversation path `/c/...` đang tồn tại trước khi bắt đầu job; route cũ luôn bị chặn kể cả trong cửa sổ Send đã arm.
- Bắt cả điều hướng History API của ChatGPT bằng `webNavigation.onHistoryStateUpdated`, không còn phụ thuộc riêng `tabs.onUpdated`.
- Đóng tab ChatGPT cũ do Merch Flow quản lý trước khi nạp ChatGPT trong tab trắng mới.
- Kiểm tra New chat sạch lần hai sau thao tác storage bất đồng bộ và ngay trước click Send.
- Thêm shortcut Desktop `ChatGPT 3 - CDP 9222` dùng profile CDP riêng, ổn định qua các lần debug.

# v0.9.14

- Add a background-owned route guard for the managed job tab.
- A `/c/...` route is rejected until the content script explicitly arms the verified Send click.
- Restore the job-owned root URL with the same Job ID/session nonce when ChatGPT opens an old conversation.
- Cap route repair attempts and fail closed without sending if ChatGPT keeps restoring old history.

# v0.9.13

- Wait for a stable empty ChatGPT root instead of trusting the first transient blank composer.
- Re-check immediately before clicking Send and automatically recover when ChatGPT restores an old `/c/...` route late.
- Fall back to a job-owned root navigation when the visible New chat control does not take effect.
- Preserve saved listing provenance/binding metadata and keep Vault artwork/listing pairs uploadable.
- Synchronize all runtime and UI version labels.

# v0.9.12

- Resume/import listing now bind to Job ID + artwork storage key + regeneration revision + ChatGPT session nonce + post-artwork message index.
- Stale ChatGPT listings are never silently rebound to a manual/revised artwork.
- Amazon artwork verification fingerprints only the upload/artwork evidence container instead of the whole page.
- TEXT_TO_IMAGE fallback rejects active Search/Study/Agent/Research tool contexts.
- ZIP export uses 24 MB / 3-design chunks and chunked base64 decoding to lower peak side-panel RAM.

# v0.9.11 — Force New Chat for AUTO

- AUTO/fresh artwork jobs now require an actually empty ChatGPT conversation before any prompt is sent.
- If ChatGPT restores an old `/c/...` conversation in a newly created browser tab, the content script clicks **New chat** and waits for zero prior messages.
- If a clean conversation cannot be confirmed, the job fails closed instead of posting into the old chat.
- Session ownership recovery now accepts the registered session nonce when ChatGPT strips the launch query parameters.
- Added a final pre-send guard so route/history changes cannot race the prompt into an old conversation.

# Changelog

## 0.9.10

- Preserve strict Create image verification but add a guarded TEXT_TO_IMAGE_ONLY fallback for extension-owned fresh sessions with no attachment.
- Detect Deep Research/report composers and refuse the fallback there.
- Recover managed job/session ownership by tab ID when ChatGPT strips the merch_flow query params.
- Never resume a live job in an arbitrary active/recent ChatGPT tab; reopen a clean managed session instead.


## 0.9.9
- Fail closed when Amazon has not positively confirmed the uploaded artwork; no listing/product automation and no success result until verified.
- Require the 10-product selection checkpoint before a job can complete.
- Reject all angle-bracket listing placeholders, including the exact human-readable prompt placeholders.
- Require an explicit Create image mode chip after clicking the open menu; historical page text can no longer satisfy detection.
- Bind imported listings to the current artwork Job ID and remove cross-job `lastListing` fallback.
- Require confidence signals for out-of-message artwork fallback capture.
- Split large vault exports into bounded ZIP parts and confirm single-design deletion.

## 0.9.8
- Added manual artwork fallback: explicit upload, clipboard image paste, source badge, and “Chốt ảnh này”.
- Added manual listing fallback: editable final fields, title counter, raw JSON paste/apply, and copy-final-JSON.
- Manual listing is rebound to the active artwork Job ID so AI parse failures no longer block completion.
- Added “Lưu vào Kho mẫu” for a final artwork + final listing pair.
- Merch upload now requires a finalized artwork and a complete listing, while AUTO keeps auto-finalizing its own artwork.

## v0.9.7 — 2026-08-21

- Hardened **Create image** discovery against the current ChatGPT `+` menu DOM: semantic menu items, Radix collection rows, tabindex rows, and text-node/div/span fallbacks are all supported.
- Replaced bare `.click()` with pointer/mouse event dispatch plus retry logic so opening the `+` popover and selecting **Create image** works more reliably in the side-panel automation path.
- Added menu diagnostics to the visible failure message when ChatGPT changes the menu again.
- Text-only jobs still fail closed: no prompt is sent unless Create image mode is activated.

## v0.9.6 — 2026-08-21

- Explicitly selects ChatGPT **Create image** from the composer `+` menu for every text-only artwork generation attempt.
- Clears stale attachments before tool selection and aborts instead of sending when image mode cannot be confirmed.
- Applies the same image-mode activation to fresh retries and artwork regeneration.

# v0.9.5 — Vietnamese routing recovery + hard text-only lock

- Recognizes the Vietnamese ChatGPT refusal seen in production, including “nhầm ... chỉnh sửa ảnh có sẵn”, as an image-routing failure.
- Routing failures now take the fast ~2-second fresh-session retry path instead of the normal long artwork wait.
- Artwork and retry prompts now carry explicit `TASK_CLASS: TEXT_TO_IMAGE`, `INPUT_ASSETS: NONE`, and `CONTEXT_SCOPE: CURRENT_MESSAGE_ONLY` guards.
- Retry prompts strip old routing headers before replay so the recovery brief contains one clean text-to-image directive instead of nested metadata.
- Bumped all runtime/version badges to v0.9.5 and added regression tests for the Vietnamese refusal.

# v0.9.4 — Text-to-image routing hardening

- Merch artwork jobs are now forcibly attachment-free even when a stale pre-v0.9.4 pending job still contains reference fields.
- Fresh ChatGPT jobs clear legacy reference/recovery state and remove any stale composer file/preview before sending the brief.
- Added exact recovery detection for ChatGPT responses such as “image tool ... treated this turn as an edit requiring an existing image target”.
- Image-routing failures retry in a fresh ChatGPT session after ~2 seconds instead of falling into the normal long artwork wait.
- Artwork prompts now explicitly mark text-to-image mode and replace ambiguous “uploaded artwork” wording with “final generated artwork”.

# Changelog

## v0.9.3
- Fixed Amazon content-script version drift: `merch-content.js` was still identifying itself as v0.8.3 inside the v0.9.2 package, so already-open Merch tabs could keep stale code.
- Extension update now reloads managed Amazon Merch tabs as well as ChatGPT tabs.
- Hardened Select Products: ignores disabled buttons, verifies each .com checkbox after React re-render, counts only .com product selections, waits for an enabled Save/Apply/Done action, retries one save, and stops after 3 failures instead of looping forever.
- Product selection is attempted even when some listing fields are already visible.
- Clarified reference-image behavior: the saved winner image is local-only and is not sent to ChatGPT; only the written Winner Style DNA affects generation.

## v0.9.2 CLEAN
- Removed `MERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW` from all artwork and retry prompts.
- Simplified the first artwork instruction to a plain brand-new-from-scratch generation request.
- Retry builder strips the legacy image-mode marker from any stale source prompt before replaying it in a fresh session.
- Kept fresh-session isolation, empty reference attachments, fast routing-failure retry, and the hard artwork-before-listing gate.

## v0.9.1 CLEAN
- Force all artwork jobs into fresh text-to-image sessions with unique nonces.
- Stop attaching saved style-reference images during artwork generation.
- Harden artwork prompts with an explicit text-to-image mode marker.
- Fix unused recovery prompt: fresh retries now embed the full original brief instead of replaying the same failing request.
- Keep the artwork-before-listing hard gate.

## 0.9.0
- Rebuilt regenerate/retry as isolated fresh ChatGPT sessions with session nonce.
- Removed regenerate/rejected/reference/edit wording from artwork-attempt prompt.
- Hard gate: no listing capture/request until a real image is captured after the current artwork prompt.
- Fresh retry opens a clean session instead of prompting again inside a failed conversation.
- Added content-script session isolation and v0.9+ cleanup hook.
- Added stable manifest key to prevent future unpacked builds from becoming parallel extension IDs.
- On extension update, reload known managed ChatGPT tabs to remove stale injected scripts.

## 0.8.3
- Added Hủy AUTO / force reset and cancellation guards across popup, ChatGPT, background artwork fetch, and Amazon Merch.
- Added stale AUTO warning after 7 minutes without progress.

# Changelog

## 0.8.2 — Fresh-chat regeneration
- Regenerate no longer stays in an image-bearing conversation.
- No reference attachment is sent on regeneration.
- Regeneration prompt removes edit/reference/target language.
- Same Job ID is preserved while image context is reset.
- Revision capture/listing boundary metadata is preserved.

## 0.8.1 — Behavior-first creative intelligence

- Refactored single, batch, regeneration, retry, and listing prompts around one shared creative brain.
- Book-lover ideation now silently explores multiple real-life US reader behaviors before selecting one winner.
- Added explicit anti-generic gates for saturated book slogans and AI-sounding copy.
- Added visual-gag quality gates: specific situation, one-second readability, pictogram carries the joke, compact copy.
- Added vault-wide concept memory using recent saved title + description, so new batches avoid old situations across sessions.
- Batch generation now uses the whole saved-design vault for de-duplication instead of only titles from the active batch.
- Regeneration requires a materially new underlying situation rather than a cosmetic reskin.
- Artwork retry preserves the already-selected concept instead of accidentally brainstorming a new one.
- Listing follow-up now requests natural US English, reader-relevant search language, and avoids keyword stuffing/IP references.
- Bumped the default profile to `book-winner-pictogram-v2`.

## v0.7.1 — 2026-08-12

- Fix duplicate ChatGPT tabs: popup and batch now use one serialized background tab manager.
- Restored Merch Flow ChatGPT tabs register themselves so later jobs reuse the same tab.
- Chrome startup no longer resumes a batch automatically; an unfinished running batch becomes paused until **Tiếp tục** is clicked.
- Opening Amazon Merch alone never intentionally opens ChatGPT.

## v0.7.0

- Khóa prompt mặc định theo winner bookworm: **white-only monochrome pictogram**, chữ block uppercase, setup trên + khung pictogram giữa + punchline dưới, tối ưu cho áo đen/tối.
- Bỏ flow “đề xuất 5 concept + JSON listing” khỏi prompt tạo ảnh; lượt đầu chỉ yêu cầu **GENERATE EXACTLY ONE IMAGE NOW**, listing được hỏi riêng sau khi bắt được artwork.
- Cho phép/khuyến khích **khung chữ nhật bên trong pictogram** như ngữ pháp của mẫu winner; bỏ mâu thuẫn cũ từng cấm frame.
- Tự retry tối đa 2 lần nếu ChatGPT đã trả lời nhưng không render ảnh, đồng thời giữ nguyên Job ID.
- Dùng một ChatGPT tab được quản lý và tái sử dụng; batch không còn liên tục bật/focus tab ChatGPT ở mỗi job.
- Tự migrate profile book-lovers mặc định cũ `clean retro` sang profile winner mới mà vẫn giữ ảnh tham chiếu đã lưu.
- Thêm chế độ xử lý **Winner: trắng hoàn toàn + nền trong suốt**, dọn màu đen/viền tối còn sót trước khi đưa lên Merch.
- Đồng bộ version script/UI lên 0.7.0; 38/38 tests + syntax checks đạt.

# Merch Flow v0.6.0

- Thêm tab **Kho mẫu / Batch Vault** cho phép tạo liên tục 1–25 mẫu book lovers mà không mở Amazon Merch.
- Background service worker tự chạy tuần tự từng Job ID, bắt artwork + listing rồi lưu local; không cần side panel mở liên tục để chuyển sang job tiếp theo.
- Tự tránh lặp lại title đã dùng trong cùng batch và yêu cầu một artwork duy nhất cho mỗi job.
- Có Tạm dừng, Tiếp tục và Dừng; khi tạm dừng, mẫu hiện tại được lưu xong rồi mới dừng trước mẫu kế tiếp.
- Mỗi mẫu lưu kèm ảnh, listing, profile, Job ID và metadata; có thể tải gói `.merchflow.json`, nhập lại gói, hoặc xuất ZIP toàn bộ artwork + listing.
- Nút **Đưa lên Merch** nạp mẫu đã lưu, chuẩn hoá PNG 4500 × 5400, luôn mở `/designs/new`, chọn 10 sản phẩm `.com` và điền listing.
- Chặn AUTO A→Z và auto-upload trong lúc batch đang chạy để không dùng quota Amazon ngoài ý muốn.
- 33/33 tests đạt; vẫn không tự Publish/Submit.

# Merch Flow v0.5.2

- Sửa nút **Tạo lại artwork**: không còn tạo Job ID mới hoặc mở cửa sổ ChatGPT mới.
- Tìm lại đúng cuộc trò chuyện theo `chatTabId`/`conversationKey`, ưu tiên tab đã tạo artwork của job hiện tại.
- Giữ nguyên Job ID, ảnh tham chiếu, profile book lovers, AUTO state và draft Amazon Merch.
- Chỉ xoá artwork/listing/PNG cũ sau khi ChatGPT xác nhận đã nhận prompt revision trong cuộc chat hiện tại.
- Prompt revision chứa cả `MERCH_FLOW_REGENERATE_ARTWORK` và `MERCH_FLOW_JOB_ID` để đặt ranh giới bắt artwork/listing mới.
- Chặn việc parser lấy lại listing cũ trong lúc artwork revision chưa render.
- Khi không tìm thấy đúng cuộc chat, fail-safe và yêu cầu mở lại chat; không tự đoán, không mở chat mới.
- Sau artwork mới, extension tiếp tục chuẩn hoá, thay artwork trên draft Merch, giữ flow 10 sản phẩm `.com` và dừng trước Publish.

# Merch Flow v0.5.1

- Fix lỗi ChatGPT gửi riêng ảnh tham chiếu rồi làm mất brief. Nếu ảnh bị tách thành một tin nhắn, extension chờ phản hồi xong và tự gửi brief ở tin kế tiếp.
- Luôn tìm lại editor đang hoạt động sau khi upload ảnh; không ghi prompt vào node composer cũ đã bị ChatGPT thay thế.
- Chỉ xác nhận thành công khi tin nhắn người dùng thật sự chứa đúng `MERCH_FLOW_JOB_ID`; không còn coi một tin ảnh trống là prompt đã gửi.
- Nút **Tiếp tục job hiện tại** có thể khôi phục job failed ngay trên cuộc trò chuyện hiện có, kể cả URL đã mất query `merch_flow_job`.
- Flow UI không đánh dấu bước Prompt hoàn tất khi job vẫn đang failed/pending.

## 0.5.0

- Thêm nút AUTO A→Z một click, mặc định ngách book lovers.
- Tự nạp profile book lovers khi cài mới hoặc profile đang trống.
- Giữ ảnh tham chiếu đã lưu; không có ảnh vẫn chạy được.
- Theo dõi trạng thái auto xuyên suốt ChatGPT → xử lý ảnh → Amazon Merch.
- Tự chọn đúng 10 sản phẩm `.com` theo logic thích ứng và điền listing 5/5.
- Dừng ở bước review, highlight Review/Publish khi nhận diện được; không tự Publish.
- Sửa trạng thái hoàn tất để giữ đúng Job ID sau khi pending upload được dọn.

## 0.4.3

- Thay danh sách 10 sản phẩm cố định bằng bộ chọn thích ứng theo niche, audience, style và listing.
- Chọn 1 sản phẩm apparel chủ đạo và 9 sản phẩm phù hợp, tổng đúng 10 ô tại marketplace .com.
- Phân loại bookish/teacher/cozy, retro, summer, winter, fitness, feminine, tech và home.
- Tối đa 2 accessory; chỉ thêm tote, mug, tumbler, water bottle, pillow hoặc phone accessory khi có tín hiệu liên quan.
- Phân tích tỷ lệ và độ phủ artwork để giảm sản phẩm dễ hiển thị kém.
- Tránh zip hoodie cho thiết kế giữa ngực và không chọn crop/performance khi thiếu ngữ cảnh.
- Tự re-select job v0.4.2 theo policy mới, không cần tạo lại artwork/listing.
- Hiển thị sản phẩm chủ đạo và nhóm ngữ cảnh trong trạng thái Merch.
- 20/20 tests đạt; không tự Submit/Publish.

## 0.4.2

- Luôn ưu tiên artwork mới nhất trong phạm vi đúng Job ID; không còn lấy ảnh cũ chỉ vì ảnh cũ lớn hơn.
- Cho phép thay thế artwork đã cache khi ChatGPT tạo phiên bản mới hơn trong cùng job.
- Khi tạo job mới, xoá sạch artwork, listing, PNG và upload job của job trước để tránh ghép nhầm.
- Chặn tác vụ tải ảnh nền của job cũ ghi đè lên job đang chạy.
- Tự mở Select Products, bỏ lựa chọn cũ và chọn đúng 10 sản phẩm apparel ở marketplace .com.
- Tự đóng/lưu hộp Select Products rồi tiếp tục điền đủ 5 trường listing.
- Không tự Submit/Publish.

## 0.4.1

- Sửa nhận diện uploader Amazon khi `input[type=file]` bị ẩn, thiếu `accept`, nằm trong Shadow DOM hoặc iframe cùng nguồn.
- Thêm phương án thả file trực tiếp vào vùng “Drag and drop artwork here” nếu không lấy được input.
- Không còn chờ cứng 30 giây; tự thử lại job v0.4.0 đang lỗi sau khi extension reload.
- Quét sâu các trường listing và nút Select Products trong DOM động.

## 0.4.0

- Quét artwork rộng hơn trong DOM ChatGPT, hỗ trợ output ảnh nằm ngoài khối assistant message truyền thống.
- Tự thử lại việc bắt artwork/listing theo chu kỳ, không phụ thuộc hoàn toàn vào một MutationObserver.
- Thêm nút **Tiếp tục job hiện tại** để ép quét lại và gửi lại follow-up listing khi cần.
- Thêm nút **Tạo lại artwork** để tạo Job ID mới nhưng giữ nguyên cấu hình ngách.
- Thêm thanh tiến độ Prompt → Artwork → Listing → Merch và phần help “Xong rồi làm gì?”.
- Tự chuyển sang tab Xử lý ảnh ngay khi bắt được artwork.
- Highlight nút **Select Products** trên Amazon và hướng dẫn bước người dùng bắt buộc phải chọn.
- Giữ watcher listing tối đa 30 phút và tự điền khi form Amazon xuất hiện.

## 0.3.3

- Tự lấy artwork và listing từ ChatGPT.
- Tự chuẩn hoá ảnh và mở Amazon Merch.
