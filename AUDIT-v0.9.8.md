# Merch Flow v0.9.8 — Manual Fallback / Final Override

## Mục tiêu
Giữ nguyên AUTO flow hiện tại nhưng cho phép người dùng chốt artwork và listing thủ công khi AI cần tinh chỉnh hoặc trả kết quả lỗi/chậm.

## Artwork fallback
- Chọn ảnh thủ công từ máy.
- Dán ảnh từ clipboard / Ctrl+V.
- Chuẩn hoá ảnh bằng pipeline hiện có.
- `Chốt ảnh này` tạo `finalArtwork` trước khi upload Merch.
- Hiển thị nguồn artwork (AI / upload / clipboard / vault).
- Artwork thủ công đã chốt không bị response ChatGPT đến muộn ghi đè.

## Listing fallback
- Các field Title / Brand / Bullet 1 / Bullet 2 / Description vẫn sửa trực tiếp được.
- Live counter cho Title và chặn Title > 60 ký tự.
- `Lưu listing cuối` lưu listing nhập tay thành `finalListing`.
- `Dán JSON` + raw JSON editor + `Áp dụng JSON`.
- `Copy JSON cuối` để lấy package listing đã chốt.
- Listing thủ công đã chốt không bị response ChatGPT đến muộn ghi đè.

## Final package
- Upload Merch yêu cầu artwork hiện tại đã được chốt.
- Có thể lưu final artwork + final listing cùng Job ID vào `Kho mẫu`.
- AUTO-generated artwork/listing vẫn hoạt động như trước; manual override là đường song song, không thay AUTO.

## QA
- `npm test`: 69/69 pass.
- `npm run check`: tất cả JavaScript syntax checks pass.
- Manifest / content scripts / footer đồng bộ version 0.9.8.
