# Merch Flow v0.9.33

> **Cài sạch một lần:** vào `chrome://extensions`, gỡ hoặc tắt TOÀN BỘ bản Merch Flow cũ (0.8.x), rồi chỉ Load unpacked thư mục v0.9.33 này. Các bản unpacked cũ có extension ID khác nhau nên nếu cùng bật, chúng sẽ cùng điều khiển một tab ChatGPT. Từ v0.9.0 manifest có stable `key` để các bản sau dùng cùng một extension ID.

Core fix v0.9.33: artwork prompt vẫn compact để giữ text-to-image route ổn định, nhưng mỗi job được gán một creative lane gồm reader-situation territory + visual construction. Không còn khóa cứng top-text / một stick figure / bottom-punchline; Vault lưu creative fingerprint để tránh lặp cả tình huống lẫn bố cục.

---

# Merch Flow Extension



## v0.9.11 — Force New Chat AUTO + clean-session recovery

- `Create image` vẫn được xác minh fail-closed: extension không coi action biến mất là đã bật.
- Nếu ChatGPT hiện tại không lộ chip xác nhận, extension chỉ được phép gửi tiếp khi job thuộc đúng managed fresh session, prompt có `MERCH_FLOW_IMAGE_REQUEST: NEW`, composer không có attachment và không phải Deep Research/report composer. Trạng thái được ghi rõ là **safe fallback**, không giả vờ rằng Create image đã bật.
- Content script nhận lại Job ID/session nonce từ background theo đúng tab ID, nên vẫn chạy được nếu ChatGPT tự loại query string `merch_flow_*` trước khi script khởi động.
- `Tiếp tục job hiện tại` không còn fallback sang tab ChatGPT đang active/gần nhất khi có Job ID sống. Nếu managed tab mất, extension tự mở một fresh session mới cho đúng job.

## v0.9.9 — Fail-closed production hardening

- Amazon upload is considered successful only after a positive artwork acceptance signal; otherwise the job remains retryable and listing/product automation does not advance.
- Listing parser rejects the exact angle-bracket placeholders from the prompt schema.
- AUTO completion requires both 5/5 listing fields and the confirmed 10-product selection checkpoint.
- **Create image** discovery is scoped to the currently open menu/popover and activation requires a visible image-mode chip; historical chat text cannot satisfy detection.
- Listing import is locked to the current artwork Job ID, including manual artwork flows.
- Fallback artwork capture requires generated-image confidence signals. Large vault exports are split into bounded ZIP parts to reduce side-panel memory spikes.

## v0.8.1 — Behavior-first Creative Brain

- Giữ flow 1-click cũ, không thêm bước nhập liệu rườm rà.
- Single + Batch + Regenerate cùng dùng một creative brain cho book lovers Mỹ.
- ChatGPT tự âm thầm nghĩ nhiều reader situations rồi chỉ generate 1 winner cuối.
- Chống slogan generic và câu chữ kiểu AI; ưu tiên hành vi thật + visual gag hiểu trong ~1 giây.
- Kho mẫu trở thành memory chống lặp xuyên batch/session bằng title + description gần đây.
- Listing dùng natural US English, reader-relevant search language và tránh keyword stuffing/IP.

## v0.7.1 — chỉ một tab ChatGPT

Mở Amazon Merch hoặc mở lại Chrome **không tự chạy ChatGPT**. Create/AUTO/Resume đều đi qua một singleton tab manager, nên popup và batch không thể race tạo hai tab. Nếu v0.7.0 đã để lại hai tab Merch Flow, đóng bớt một tab một lần sau khi cập nhật; các lượt sau sẽ reuse tab còn lại.


Extension cá nhân cho workflow Amazon Merch on Demand, mặc định ngách **book lovers**.

## AUTO 1 click A → Z

Bấm **Chạy AUTO 1 click** một lần. Extension sẽ tạo artwork + listing, chuẩn hoá PNG 4500 × 5400, mở `https://merch.amazon.com/designs/new`, điền đủ 5 trường listing rồi dừng. Anh tự chọn sản phẩm/màu, review và Publish thủ công.

## Batch Vault — làm trước, mai đăng

Tab **Kho mẫu** dành cho lúc quota Amazon hôm nay đã hết:

1. Chọn số lượng 1–25 mẫu.
2. Bấm **Bắt đầu làm liên tục**.
3. Extension lần lượt tạo từng artwork trên ChatGPT, tự lấy ảnh rồi mới yêu cầu listing JSON riêng.
4. Mỗi mẫu hoàn tất được lưu local trong extension; Batch Vault không mở Amazon Merch và không dùng quota upload.
5. Có thể tạm dừng sau mẫu hiện tại, tiếp tục, hoặc dừng mà vẫn giữ những mẫu đã lưu.
6. Nút **Xuất ZIP** tạo một file gồm từng artwork và `listing.json`; mỗi mẫu cũng có nút tải gói `.merchflow.json` chứa cả ảnh và listing để backup/nhập lại.

Ngày hôm sau, mở **Kho mẫu** và bấm **Đưa lên Merch** ở mẫu muốn đăng. Extension tự chuẩn hoá ảnh, mở Add New, điền listing và dừng để anh chọn sản phẩm/màu.

Kho mẫu dùng `chrome.storage.local` với quyền `unlimitedStorage`. Gỡ extension sẽ xoá dữ liệu local, vì vậy nên xuất ZIP hoặc tải gói `.merchflow.json` để backup.

## Mặc định book lovers

- Niche: `book lovers`
- Audience: bookworms, avid readers, librarians, teachers, introverts, cozy reading fans
- Visual direction: monochrome pictogram winner — white-only artwork on transparent background for black/dark garments
- Listing language: English
- Product strategy: apparel-first; ưu tiên Standard T-shirt, Comfort Colors, sweatshirt/hoodie, tote và mug khi phù hợp
- Chọn sản phẩm/màu là bước thủ công để tránh Amazon áp lựa chọn sai cho từng áo

## Review và tạo lại mẫu

Nút **Tạo lại artwork** giữ nguyên Job ID nhưng mở một phiên ChatGPT sạch cho attempt mới. Không đính kèm ảnh cũ/reference; profile book lovers và creative memory vẫn được giữ bằng text.

## Cài đặt

1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Tắt hoặc gỡ bản Merch Flow cũ.
4. Bật **Developer mode**.
5. Chọn **Load unpacked** và trỏ vào thư mục `Merch Extension`.
6. Reload tab ChatGPT và Amazon Merch.
7. Mở side panel.

## Giới hạn an toàn

Extension không tự bấm Publish/Submit. Người dùng chịu trách nhiệm review artwork, sản phẩm, listing và rủi ro trademark trước khi xuất bản.


## v0.7.0 — Winner prompt + ổn định ChatGPT

- Prompt mặc định bám grammar của winner pictogram: chữ block trắng, pictogram đơn giản, khung minh hoạ bên trong, punchline cuối; không còn ép clean-retro nhiều màu.
- Prompt artwork tách khỏi listing: ưu tiên bắt ChatGPT tạo ảnh trước, listing được extension hỏi ở lượt sau.
- Bước xử lý ảnh có Winner mode mặc định: mọi pixel design được chuẩn hoá về trắng và nền thành trong suốt; ảnh nền đen/trắng đặc được tách foreground theo tương phản.
- Nếu ChatGPT chỉ trả text mà không tạo ảnh, extension tự thử lại tối đa 2 lần trong cùng Job ID.
- Một tab ChatGPT được tái sử dụng cho Merch Flow; batch không còn giật focus/mở tab mới ở mỗi mẫu.
- Có migration để profile book-lovers cũ không giữ DNA clean-retro sau khi nâng cấp.


## v0.9.3 Amazon recovery + artwork routing

- Every new artwork job now starts in a genuinely fresh ChatGPT session with a unique session nonce.
- Stored winner/reference images remain local-only and are NOT attached to artwork-generation jobs. The UI now states this explicitly. Style is conveyed only by the written Winner Style DNA, avoiding accidental image-edit routing.
- Removed the legacy `MERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW` metadata from every artwork and retry prompt. Prompts now begin directly with the Job ID and a plain brand-new-from-scratch generation instruction.
- Text-only artwork failures now retry in another fresh session using a hardened recovery prompt that embeds the entire original brief. v0.9.0 accidentally replayed the original prompt unchanged and left its recovery builder unused.
- Listing remains hard-blocked until a real artwork image is captured for the current job/session.


## Manual fallback (v0.9.11)
- Artwork can come from ChatGPT, file upload, clipboard paste, or a saved Vault design.
- Manual artwork must be normalized and explicitly finalized with **Chốt ảnh này** before Merch upload. AUTO artwork is finalized automatically.
- Listing can come from ChatGPT, manual field editing, or pasted JSON. Manual listing is saved against the current artwork Job ID.
- **Lưu vào Kho mẫu** stores the final artwork and final listing together for reuse/export.
