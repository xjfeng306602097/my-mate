const fs = require("node:fs");
const path = require("node:path");

class DesktopNotificationHost {
  constructor(options = {}) {
    this.Notification = options.Notification;
    this.request = options.request;
    this.statePath = options.statePath || "";
    this.onClick = options.onClick || (() => {});
    this.intervalMs = options.intervalMs || 15_000;
    this.seen = new Set();
    this.timer = null;
    this.polling = false;
  }

  async restore() {
    if (!this.statePath) return;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.statePath, "utf8"));
      for (const id of Array.isArray(parsed?.seen) ? parsed.seen.slice(-500) : []) {
        if (typeof id === "string" && id) this.seen.add(id);
      }
    } catch {}
  }

  async persist() {
    if (!this.statePath) return;
    await fs.promises.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.promises.writeFile(
      this.statePath,
      JSON.stringify({ seen: [...this.seen].slice(-500) }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async poll() {
    if (this.polling || !this.Notification || typeof this.request !== "function") return [];
    if (typeof this.Notification.isSupported === "function" && !this.Notification.isSupported()) return [];
    this.polling = true;
    const shown = [];
    try {
      const response = await this.request();
      for (const item of Array.isArray(response?.items) ? response.items : []) {
        const id = typeof item?.notification_id === "string" ? item.notification_id : "";
        if (!id || this.seen.has(id) || item.dismissed_at) continue;
        const notification = new this.Notification({
          title: String(item.title || "My Mate").slice(0, 160),
          body: String(item.body || "A scheduled task has an update.").slice(0, 1_000),
          silent: item.severity === "success",
        });
        notification.on?.("click", () => this.onClick(item));
        notification.show();
        this.seen.add(id);
        shown.push(id);
      }
      if (shown.length) await this.persist();
      return shown;
    } finally {
      this.polling = false;
    }
  }

  async start() {
    await this.restore();
    await this.poll().catch(() => []);
    this.timer = setInterval(() => void this.poll().catch(() => []), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { DesktopNotificationHost };
