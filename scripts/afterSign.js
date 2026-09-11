/**
 * electron-builder afterSign hook — ad-hoc code signing for unsigned CI builds.
 *
 * WHY: GitHub Actions has no Apple Developer certificate, so electron-builder
 * skips macOS code signing. An unsigned app that was downloaded (quarantined)
 * makes macOS show the misleading "App is damaged and can't be opened" error
 * on Apple Silicon. Ad-hoc signing (identity "-") produces a valid signature
 * with no certificate, which:
 *   - downgrades the Gatekeeper error to the friendlier "unidentified
 *     developer" dialog (with an "Open Anyway" path), and
 *   - makes `xattr -cr <app>` reliably effective for users.
 *
 * A real certificate (CSC_LINK secret) always wins: we verify first and
 * leave properly-signed builds untouched.
 *
 * Author: Abhishek <abhishek.aks@gmail.com> | https://github.com/abhishekamf
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'mac') return;

  const product = (context.packager && context.packager.appInfo && context.packager.appInfo.productFilename) || 'Research AI Assistant';
  const appPath = path.join(context.appOutDir, `${product}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterSign] app bundle not found at ${appPath}, skipping ad-hoc sign`);
    return;
  }

  // If the bundle is already validly signed (e.g. a real Developer ID via
  // CSC_LINK), leave it alone.
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log('[afterSign] app is already validly signed — not touching it');
    return;
  } catch (e) { /* not validly signed -> ad-hoc sign below */ }

  try {
    console.log(`[afterSign] ad-hoc signing ${appPath} (prevents the "damaged" Gatekeeper error)…`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    // verify our work
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log('[afterSign] ✓ ad-hoc signature applied and verified');
  } catch (e) {
    // Never fail the whole build because of this — unsigned builds still
    // work for users who run `xattr -cr` on the app.
    console.warn(`[afterSign] ad-hoc signing failed (build continues): ${e.message}`);
  }
};
