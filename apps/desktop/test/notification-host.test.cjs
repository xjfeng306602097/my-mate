const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopNotificationHost } = require("../src/notification-host.cjs");

test("desktop notification host shows unread schedule notifications once and routes clicks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-notifications-"));
  const shown = [];
  const clicks = [];
  class NotificationStub {
    static isSupported() { return true; }
    constructor(options) { this.options = options; this.listeners = {}; }
    on(name, callback) { this.listeners[name] = callback; }
    show() { shown.push(this.options); this.listeners.click?.(); }
  }
  const item = {
    notification_id: "notification-schedule-1",
    title: "Daily review completed",
    body: "The scheduled task completed.",
    severity: "success",
    session_id: "session-1",
  };
  const statePath = path.join(root, "seen.json");
  const host = new DesktopNotificationHost({
    Notification: NotificationStub,
    statePath,
    request: async () => ({ items: [item] }),
    onClick: (notification) => clicks.push(notification.session_id),
  });
  assert.deepEqual(await host.poll(), [item.notification_id]);
  assert.deepEqual(await host.poll(), []);
  assert.equal(shown.length, 1);
  assert.deepEqual(clicks, ["session-1"]);

  const restored = new DesktopNotificationHost({
    Notification: NotificationStub,
    statePath,
    request: async () => ({ items: [item] }),
  });
  await restored.restore();
  assert.deepEqual(await restored.poll(), []);
  fs.rmSync(root, { recursive: true, force: true });
});
