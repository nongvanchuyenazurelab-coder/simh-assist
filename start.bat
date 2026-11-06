@echo off
chcp 65001 > nul
title YTCS Multi-Account Manager
color 0b

echo =================================================================
echo        YTCS HMIS - QUẢN TRỊ ĐA TÀI KHOẢN (MULTI-ACCOUNT)
echo =================================================================
echo.
echo  Đang kiểm tra môi trường Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LỖI] Chưa tìm thấy Node.js trên máy tính!
    echo Vui lòng cài đặt Node.js từ https://nodejs.org/ để tiếp tục.
    pause
    exit /b
)

echo [OK] Đã tìm thấy Node.js.
echo  Đang khởi động máy chủ Web Proxy tại http://localhost:8888 ...
echo.

:: Tự động mở trình duyệt sau 1.5 giây
start "" powershell -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8888'"

:: Chạy server node
node "%~dp0server.js"

pause
