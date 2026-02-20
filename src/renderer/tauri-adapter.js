(function () {
  const getCoreInvoke = () => {
    if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke;
    if (window.__TAURI_INTERNALS__?.invoke) return window.__TAURI_INTERNALS__.invoke;
    return null;
  };

  const invoke = async (cmd, args = {}) => {
    const fn = getCoreInvoke();
    if (!fn) {
      throw new Error("Tauri bridge unavailable");
    }
    return fn(cmd, args);
  };

  const noop = async () => null;

  window.assistantApi = {
    openPath: (filePath) => invoke("open_path", { filePath }),
    openInFolder: (filePath) => invoke("open_in_folder", { filePath }),
    hideWindow: () => invoke("hide_window"),
    beginDrag: () => invoke("begin_drag"),
    search: (query) => invoke("search", { query }),
    getIndexStatus: () => invoke("get_index_status"),
    getSettings: () => invoke("get_settings"),
    chooseFolders: noop,
    setRoots: noop,
    startIndexing: () => invoke("start_indexing"),
    pauseIndexing: () => invoke("pause_indexing"),
    refreshIndex: () => invoke("refresh_index"),
    openSettings: () => invoke("open_settings"),
    closeSettings: () => invoke("close_settings"),
    setWindowHeight: (h) => invoke("set_window_height", { height: h }),
    getReportPath: () => invoke("get_report_path"),
    openReport: () => invoke("open_report"),
    updateSettings: (partial) => invoke("update_settings", { partial }),
    getAiStatus: () => invoke("get_ai_status"),
    installAi: () => invoke("install_ai"),
    removeAi: () => invoke("remove_ai"),
    openSortWindow: () => invoke("open_sort_window"),
    closeSortWindow: () => invoke("close_sort_window"),
    beginDragSort: () => invoke("begin_drag_sort"),
    resizeSortWindow: (width, height) => invoke("resize_sort_window", { width, height }),
    getDuplicateResult: () => invoke("get_duplicate_result"),
    startDuplicateSort: (mode) => invoke("start_duplicate_sort", { mode }),
    deleteDuplicateFiles: (paths) => invoke("delete_duplicate_files", { pathsToDelete: paths }),
    askAi: (query, filePaths) => invoke("ask_ai", { query, filePaths }),
    createFileFromAi: (payload) => invoke("create_file_from_ai", { payload }),
    getSystemProfile: () => invoke("get_system_profile"),
    getRecommendedModel: () => invoke("get_recommended_model")
    ,
    getAppUpdateStatus: () => invoke("get_app_update_status"),
    checkAppUpdate: (manual) => invoke("check_app_update", { manual }),
    installAppUpdate: () => invoke("install_app_update")
  };

  const tauriEvent = window.__TAURI__?.event;
  const relay = (name) => {
    if (!tauriEvent?.listen) return;
    const listenPromise = tauriEvent.listen(name, (event) => {
      window.dispatchEvent(new CustomEvent(name, { detail: event?.payload || {} }));
    });
    if (listenPromise && typeof listenPromise.catch === "function") {
      listenPromise.catch(() => {});
    }
  };

  [
    "index-status",
    "settings-updated",
    "index-throttle",
    "ai-status",
    "ai-progress",
    "app-update-status",
    "sort-progress",
    "sort-opened",
    "focus-input"
  ].forEach(relay);

  setTimeout(async () => {
    try {
      const st = await window.assistantApi.getIndexStatus();
      window.dispatchEvent(new CustomEvent("index-status", { detail: st || {} }));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("focus-input"));
  }, 10);
})();
