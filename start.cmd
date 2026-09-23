@echo off
setlocal
pushd "%~dp0"
docker compose up --build --wait
if errorlevel 1 (
  echo.
  echo Startup failed. Check that Docker Desktop is running and the configured port is available.
  popd
  pause
  exit /b 1
)
echo.
echo EKT Match is ready. Open the published port shown below in your browser.
docker compose ps
popd
pause
exit /b 0
