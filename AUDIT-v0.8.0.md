# Audit v0.8.0 — Behavior-first Book Lover Creative Brain

## Mục tiêu

Nâng chất lượng ý tưởng mà không tăng số click: extension vẫn gửi brief sang ChatGPT, nhưng creative intelligence nằm trong prompt dùng chung thay vì để từng flow tự viết prompt riêng.

## Đã nâng cấp

- Single AUTO, manual send, Batch Vault và Regenerate dùng chung `Core.buildArtworkPrompt`.
- Prompt bắt model tự khám phá nhiều hành vi thật của avid readers Mỹ nhưng không hiển thị brainstorming; chỉ generate 1 winner.
- Chặn các territory quá generic như `book lover`, `just one more chapter`, `I'd rather be reading`, `books > people` nếu không có tình huống mới đủ cụ thể.
- Quality gate ưu tiên reader recognition, pictogram kể được joke, copy ngắn, natural American English và evergreen behavior.
- Vault memory lấy tối đa 30 concept gần đây từ `title + description`; single và batch đều dùng memory này để tránh lặp underlying situation.
- Batch không còn chỉ tránh title của batch hiện tại; nó nhớ các mẫu đã lưu từ các batch/session trước.
- Regenerate phải đổi cả underlying situation, không chỉ thay slogan hoặc pose.
- Artwork retry giữ concept đang chọn và chỉ yêu cầu generate ảnh lại, tránh drift sang ý khác.
- Listing follow-up được gom vào core, yêu cầu natural US English, title <= 60, reader-relevant search language, không keyword stuffing/IP.
- Content-script version bump lên 0.8.0 để reload extension áp dụng logic mới ngay.

## UX

Không thêm form, database hay bước bấm mới. Kho mẫu sẵn có chính là creative memory.

## Validation

- `npm run check`: PASS
- `node --test tests/*.test.js`: 42/42 PASS
