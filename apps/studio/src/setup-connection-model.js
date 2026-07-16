export const NEW_SETUP_CONNECTION_ID = "__new__";

export function selectSetupConnection(connections, preferredId = "") {
  const active = (connections || []).filter((connection) => connection.status === "active");
  return active.find((connection) => connection.connection_id === preferredId)
    || active.find((connection) => connection.verification?.status === "verified")
    || active[0]
    || null;
}
