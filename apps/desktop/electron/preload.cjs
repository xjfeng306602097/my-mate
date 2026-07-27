const { contextBridge, ipcRenderer } = require("electron");

const desktopApi = Object.freeze({
  getHostInfo: () => ipcRenderer.invoke("my-mate:host:info"),
  getServiceStatus: () => ipcRenderer.invoke("my-mate:services:status"),
  restartServices: () => ipcRenderer.invoke("my-mate:services:restart"),
  getServiceLogs: (request) => ipcRenderer.invoke("my-mate:services:logs", request),
  onServiceStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("my-mate:services:status", listener);
    return () => ipcRenderer.removeListener("my-mate:services:status", listener);
  },
  dialog: Object.freeze({
    onRequest: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, request) => callback(request);
      ipcRenderer.on("my-mate:dialog:request", listener);
      return () => ipcRenderer.removeListener("my-mate:dialog:request", listener);
    },
    respond: (response) => ipcRenderer.invoke("my-mate:dialog:respond", response),
  }),
  application: Object.freeze({
    open: (request) => ipcRenderer.invoke("my-mate:application:open", request),
  }),
  capability: Object.freeze({
    execute: (request) => ipcRenderer.invoke("my-mate:capability:execute", request),
    approve: (request) => ipcRenderer.invoke("my-mate:capability:approve", request),
  }),
  runtime: Object.freeze({
    status: () => ipcRenderer.invoke("my-mate:runtime:status"),
    provision: () => ipcRenderer.invoke("my-mate:runtime:provision"),
  }),
  mcp: Object.freeze({
    configure: (request) => ipcRenderer.invoke("my-mate:mcp:configure", request),
  }),
  workspace: Object.freeze({
    get: () => ipcRenderer.invoke("my-mate:workspace:get"),
    projects: () => ipcRenderer.invoke("my-mate:workspace:projects"),
    choose: () => ipcRenderer.invoke("my-mate:workspace:choose"),
    create: (request) => ipcRenderer.invoke("my-mate:workspace:create", request),
    select: (request) => ipcRenderer.invoke("my-mate:workspace:select", request),
    moveTask: (request) => ipcRenderer.invoke("my-mate:workspace:move-task", request),
    archiveProject: (request) => ipcRenderer.invoke("my-mate:workspace:archive-project", request),
    list: (request) => ipcRenderer.invoke("my-mate:workspace:list", request),
    readText: (request) => ipcRenderer.invoke("my-mate:workspace:read-text", request),
    authorize: (request) => ipcRenderer.invoke("my-mate:workspace:authorize", request),
    revoke: (request) => ipcRenderer.invoke("my-mate:workspace:revoke", request),
    applyChangeSet: (request) => ipcRenderer.invoke("my-mate:workspace:apply-change-set", request),
    openExternal: (request) => ipcRenderer.invoke("my-mate:workspace:open-external", request),
    preview: (request) => ipcRenderer.invoke("my-mate:workspace:preview", request),
  }),
});

contextBridge.exposeInMainWorld("myMateDesktop", desktopApi);
