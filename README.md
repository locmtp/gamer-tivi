# Gamer Tivi

Web ghép cặp game thủ ngẫu nhiên và gọi video (WebRTC). Không cần cài thư viện, chỉ cần Node.js 18 trở lên.

    node server.js          # mặc định http://localhost:3000 (đổi bằng PORT=8080)

## Tính năng
- Đăng nhập / đăng ký (mật khẩu băm scrypt, dữ liệu lưu ở `data/users.json`)
- Chọn 1 trong 6 game: Liên Minh Huyền Thoại, Valorant, Free Fire, PUBG Mobile, Liên Quân Mobile, Tất cả
- Chọn quốc gia: chỉ ghép người cùng nước ("Tất cả quốc gia" ghép với mọi nơi)
- Quy tắc ghép: cùng game (hoặc một bên chọn "Tất cả") và cùng quốc gia
- Trong cuộc gọi: 11 filter màu (đối phương cũng thấy), bật/tắt mic/cam, "Người tiếp theo"
- Menu người dùng ở trang chủ: Thay đổi thông tin, Đổi mật khẩu, Tuỳ chỉnh camera (chọn thiết bị, độ phân giải, độ sáng/tương phản, lật gương)

## Triển khai thật
- Camera/micro chỉ hoạt động trên HTTPS (hoặc localhost): đặt sau Nginx/Caddy có SSL (nhớ chuyển tiếp WebSocket `/ws`).
- Chỉ có STUN của Google. Người dùng sau NAT chặt cần máy chủ TURN (ví dụ coturn): thêm vào `ICE` trong `public/app.js`.
- Filter dùng `ctx.filter` của canvas (Chrome, Edge, Firefox). Safari chưa hỗ trợ: filter chỉ hiện ở máy mình, đối phương không thấy.
