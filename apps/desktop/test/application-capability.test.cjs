const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applicationExecutableLabel,
  isUnsafeApplicationTarget,
  selectInstalledApplication,
} = require("../src/application-capability.cjs");

const safeMeeting = {
  Name: "Tencent Meeting",
  AppID: "{ProgramFiles}\\Tencent\\WeMeet\\WeMeetApp.exe",
};

test("application selection rejects uninstallers by executable id even when the display name is corrupted", () => {
  const uninstaller = {
    Name: "corrupted display name",
    AppID: "{ProgramFiles}\\Tencent\\WeMeet\\3.35.1.435\\WeMeetUninstall.exe",
  };
  assert.equal(isUnsafeApplicationTarget(uninstaller), true);
  assert.deepEqual(selectInstalledApplication([uninstaller, safeMeeting], "Tencent Meeting"), {
    ok: true,
    item: safeMeeting,
  });
});

test("application selection fails closed when multiple safe applications match", () => {
  const second = { Name: "Tencent Meeting Rooms", AppID: "TencentRooms.exe" };
  const result = selectInstalledApplication([safeMeeting, second], "Tencent");
  assert.equal(result.ok, false);
  assert.equal(result.code, "desktop_application_ambiguous");
});

test("application confirmation exposes only the registered executable label", () => {
  assert.equal(applicationExecutableLabel(safeMeeting), "WeMeetApp.exe");
});
