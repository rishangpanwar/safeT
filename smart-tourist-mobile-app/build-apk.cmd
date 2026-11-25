@echo off
setlocal
rem Builds the installable Android app: ..\dist\SmartTourist.apk
rem Needs the Android SDK in D:\dev-tools\android-sdk and JDK 17 (both already set up on this PC).
rem First build ~20-40 min; later builds are much faster. Run "build-apk.cmd clean" after changing app.json.
cd /d "%~dp0"

set "ANDROID_HOME=D:\dev-tools\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "GRADLE_USER_HOME=D:\dev-tools\gradle"
if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Amazon Corretto\jdk17.0.8_7"
set "NODE_ENV=production"

rem Use the installed Node.js if it works; otherwise the portable copy.
set "PORTABLE_NODE=D:\dev-tools\node\node-v24.22.3-win-x64"
node -e "process.exit(0)" >nul 2>&1 || set "PATH=%PORTABLE_NODE%;%PATH%"

if /i "%~1"=="clean" if exist android rmdir /s /q android
if not exist android (
  call npx expo prebuild --platform android --no-install || goto :failed
)
if not exist android\local.properties (echo sdk.dir=D\:/dev-tools/android-sdk)> android\local.properties

pushd android
call gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a "-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m" || (popd & goto :failed)
popd

if not exist ..\dist mkdir ..\dist
copy /y android\app\build\outputs\apk\release\app-release.apk ..\dist\SmartTourist.apk >nul || goto :failed
echo.
echo Built: %~dp0..\dist\SmartTourist.apk
echo Copy it to your Android phone and open it (allow "Install unknown apps" when asked).
pause
exit /b 0

:failed
echo.
echo Build failed - see the messages above.
pause
exit /b 1
