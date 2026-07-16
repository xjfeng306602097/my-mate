const path = require("node:path");

const UNSAFE_NAME_PATTERN = /(?:uninstall|remove|delete|cleanup|installer|setup|\u5378\u8f7d|\u5220\u9664|\u79fb\u9664|\u5b89\u88c5)/iu;
const UNSAFE_APP_ID_PATTERN = /(?:uninstall|unins\d*|remove|delete|cleanup|installer|setup|updater?)(?:[^a-z0-9]|$)/iu;

function normalizedApplicationName(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function isUnsafeApplicationTarget(item) {
  if (!item || typeof item.Name !== "string" || typeof item.AppID !== "string") return true;
  return UNSAFE_NAME_PATTERN.test(item.Name) || UNSAFE_APP_ID_PATTERN.test(item.AppID);
}

function selectInstalledApplication(items, requestedName) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => !isUnsafeApplicationTarget(item));
  const normalizedQuery = normalizedApplicationName(requestedName);
  const exact = candidates.filter(
    (item) => normalizedApplicationName(item.Name) === normalizedQuery,
  );
  if (exact.length === 1) return { ok: true, item: exact[0] };
  if (exact.length > 1 || candidates.length > 1) {
    return {
      ok: false,
      code: "desktop_application_ambiguous",
      message: `Multiple safe applications matched ${requestedName}.`,
    };
  }
  if (candidates.length === 1) return { ok: true, item: candidates[0] };
  return {
    ok: false,
    code: "desktop_application_not_found",
    message: `${requestedName} was not found in the Windows application list.`,
  };
}

function applicationExecutableLabel(item) {
  const appId = typeof item?.AppID === "string" ? item.AppID : "";
  return path.win32.basename(appId) || "registered application";
}

module.exports = {
  applicationExecutableLabel,
  isUnsafeApplicationTarget,
  selectInstalledApplication,
};
