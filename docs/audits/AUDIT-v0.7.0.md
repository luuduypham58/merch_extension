# Audit Merch Flow v0.7.0

## Vấn đề phát hiện

1. Prompt mặc định `clean retro` + warm vintage palette không khớp mẫu winner monochrome pictogram trên áo đen.
2. Prompt cũ vừa bắt đề xuất 5 concept, vừa tạo artwork, vừa trả listing JSON trong cùng lượt; ChatGPT dễ ưu tiên trả text thay vì render ảnh.
3. Prompt cũ cấm `frame` trong khi winner dùng khung chữ nhật rõ ràng quanh scene pictogram.
4. Manual/AUTO tạo tab ChatGPT mới; batch còn focus tab lặp lại, gây cảm giác ChatGPT mở liên tục.
5. Không có recovery tự động khi assistant đã trả text nhưng chưa có ảnh.
6. Profile cũ lưu trong storage có thể giữ `clean retro` dù code đổi default.
7. Pipeline xử lý ảnh cũ chỉ xoá nền trắng nối biên, chưa phù hợp artwork trắng-only trên nền đen/tối.

## Fix đã áp dụng

- Profile winner: white-only, block uppercase, setup → framed pictogram scene → punchline.
- Prompt image-first/artwork-only; listing tách thành follow-up sau khi capture ảnh.
- Retry cùng Job ID tối đa 2 lần khi thiếu ảnh.
- Reuse một managed ChatGPT tab; batch không giật focus ở từng job.
- Migrate stale default profile sang winner profile.
- Chế độ cleanup winner ép foreground thành trắng tinh và background trong suốt.
- Giữ nguyên nguyên tắc không tự Publish/Submit.

## Kiểm thử

- `npm test`: 38/38 pass.
- `npm run check`: syntax check pass cho background/core/popup/merch-content/chatgpt-content.

## Giới hạn còn lại

Automated tests và static audit không thể đảm bảo 100% trước mọi thay đổi DOM/UI tương lai của ChatGPT hoặc Amazon Merch. Các selector/retry hiện đã có fallback và fail-safe, nhưng nếu UI nền tảng đổi lớn thì extension vẫn cần cập nhật.
