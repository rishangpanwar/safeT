/**
 * Release builds of Android apps refuse plain http:// by default. The Smart Tourist server runs on
 * a laptop on the local Wi-Fi (http://192.168.x.x:4000), so the installed app must be allowed to
 * reach it. (Debug builds already allow it; this makes the release .apk behave the same.)
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
