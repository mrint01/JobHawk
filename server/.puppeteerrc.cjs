/**
 * Skip Puppeteer's own Chrome download (~170 MB). Playwright already installs
 * Chromium in postinstall, and src/utils/browser.ts falls back to that binary.
 * Keeps Railway builds under the build timeout.
 */
module.exports = {
  skipDownload: true,
}
