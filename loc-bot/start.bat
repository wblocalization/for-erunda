@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Loc Bot

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 22 или новее с https://nodejs.org и запустите этот файл ещё раз.
  pause
  exit /b 1
)

if not exist "..\loc-helper\lib\core.js" (
  echo Рядом с папкой loc-bot должна лежать папка loc-helper из того же архива.
  pause
  exit /b 1
)

if not exist config.json (
  copy config.example.json config.json >nul
  echo Создан файл config.json. Сейчас он откроется в Блокноте:
  echo впишите токен бота Band, токен Tracker, свой логин и сохраните файл.
  echo Потом запустите start.bat ещё раз.
  notepad config.json
  exit /b 0
)

echo Запускаю бота. Он работает, пока открыто это окно. Чтобы остановить, нажмите Ctrl+C.
echo.
node bot.js
echo.
echo Бот остановился.
pause
