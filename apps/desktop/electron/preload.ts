import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.chuDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('chu:translucency:support')
const hudWindowing = ipcRenderer.sendSync('chu:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true
const launchFlags = ipcRenderer.sendSync('chu:launch-flags')

contextBridge.exposeInMainWorld('chuDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  getConnection: (profile, opts) => ipcRenderer.invoke('chu:connection', profile, opts),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('chu:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('chu:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('chu:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('chu:backend:touch', profile),
  getPoolLimits: () => ipcRenderer.invoke('chu:pool-limits:get'),
  setPoolLimits: limits => ipcRenderer.invoke('chu:pool-limits:set', limits),
  getGatewayWsUrl: profile => ipcRenderer.invoke('chu:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('chu:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('chu:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('chu:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('chu:window:openInTerminal', sessionId, opts),
  openWindow: () => ipcRenderer.invoke('chu:window:openInstance'),
  openBrowserWindow: tabId => ipcRenderer.invoke('chu:window:openBrowser', tabId),
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('chu:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('chu:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('chu:ambient:claim', key),
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('chu:wake-indicator:get'),
    setState: state => ipcRenderer.send('chu:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('chu:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('chu:wake-indicator:state', listener)
    }
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('chu:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('chu:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('chu:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('chu:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('chu:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('chu:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('chu:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('chu:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('chu:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('chu:hud:open', request),
    close: () => ipcRenderer.invoke('chu:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('chu:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('chu:hud:begin-move'),
    endMove: () => ipcRenderer.send('chu:hud:end-move'),
    moveBy: delta => ipcRenderer.send('chu:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('chu:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('chu:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('chu:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('chu:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('chu:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('chu:hud:goto', listener)

      return () => ipcRenderer.removeListener('chu:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('chu:hud:changed', listener)

      return () => ipcRenderer.removeListener('chu:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('chu:hud:cursor', listener)

      return () => ipcRenderer.removeListener('chu:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('chu:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('chu:hud:game-overlay', listener)
    }
  },
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('chu:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('chu:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('chu:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('chu:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('chu:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('chu:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('chu:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('chu:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('chu:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('chu:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('chu:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('chu:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('chu:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('chu:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('chu:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('chu:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('chu:connections:list'),
    save: payload => ipcRenderer.invoke('chu:connections:save', payload),
    remove: id => ipcRenderer.invoke('chu:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('chu:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('chu:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('chu:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('chu:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('chu:connections:update-managed', id),
    // Fan out `chu update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('chu:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:connections:changed', listener)

      return () => ipcRenderer.removeListener('chu:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('chu:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('chu:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('chu:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('chu:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('chu:connection-config:oauth-logout', remoteUrl),
  // Chu Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('chu:cloud:status'),
    login: () => ipcRenderer.invoke('chu:cloud:login'),
    logout: () => ipcRenderer.invoke('chu:cloud:logout'),
    discover: org => ipcRenderer.invoke('chu:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('chu:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    get: () => ipcRenderer.invoke('chu:profile:get'),
    remember: name => ipcRenderer.invoke('chu:profile:remember', name),
    set: name => ipcRenderer.invoke('chu:profile:set', name)
  },
  api: request => ipcRenderer.invoke('chu:api', request),
  notify: payload => ipcRenderer.invoke('chu:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('chu:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('chu:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('chu:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('chu:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('chu:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('chu:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('chu:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('chu:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('chu:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('chu:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('chu:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('chu:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('chu:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('chu:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('chu:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('chu:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('chu:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('chu:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('chu:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('chu:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('chu:capturePreview', payload),
  saveClipboardImage: () => ipcRenderer.invoke('chu:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('chu:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('chu:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('chu:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('chu:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('chu:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('chu:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('chu:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('chu:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('chu:keep-awake', on),
  setDisableF12: blocked => ipcRenderer.send('chu:devtools:disable-f12', blocked),
  setPreviewShortcutActive: active => ipcRenderer.send('chu:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('chu:openExternal', url),
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('chu:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('chu:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('chu:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('chu:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('chu:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('chu:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('chu:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('chu:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('chu:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('chu:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('chu:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('chu:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('chu:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('chu:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:zoom:changed', listener)

      return () => ipcRenderer.removeListener('chu:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('chu:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('chu:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('chu:logs:renderer-error', report),
  readDir: dirPath => ipcRenderer.invoke('chu:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('chu:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('chu:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('chu:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('chu:fs:desktopPluginsRoot'),
  logsRoot: () => ipcRenderer.invoke('chu:fs:logsRoot'),
  agentPluginsRoot: () => ipcRenderer.invoke('chu:fs:agentPluginsRoot'),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('chu:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('chu:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('chu:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('chu:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('chu:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('chu:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('chu:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('chu:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('chu:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('chu:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('chu:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('chu:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('chu:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('chu:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('chu:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('chu:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('chu:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('chu:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('chu:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('chu:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('chu:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('chu:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('chu:git:review:prList', repoPath, branches, numbers),
      fetchPrComment: (repoPath, url) => ipcRenderer.invoke('chu:git:review:fetchPrComment', repoPath, url),
      createPr: repoPath => ipcRenderer.invoke('chu:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('chu:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('chu:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('chu:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('chu:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('chu:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('chu:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `chu:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `chu:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('chu:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('chu:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('chu:preview-nav', listener)

    return () => ipcRenderer.removeListener('chu:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('chu:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('chu:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('chu:open-updates', listener)

    return () => ipcRenderer.removeListener('chu:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:deep-link', listener)

    return () => ipcRenderer.removeListener('chu:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('chu:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('chu:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('chu:plugin:installDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:window-state-changed', listener)

    return () => ipcRenderer.removeListener('chu:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('chu:focus-session', listener)

    return () => ipcRenderer.removeListener('chu:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:notification-action', listener)

    return () => ipcRenderer.removeListener('chu:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:notification-activate', listener)

    return () => ipcRenderer.removeListener('chu:notification-activate', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('chu:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:backend-exit', listener)

    return () => ipcRenderer.removeListener('chu:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('chu:connection:applied', listener)

    return () => ipcRenderer.removeListener('chu:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('chu:power-resume', listener)

    return () => ipcRenderer.removeListener('chu:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('chu:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('chu:power-battery', listener)

    return () => ipcRenderer.removeListener('chu:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:boot-progress', listener)

    return () => ipcRenderer.removeListener('chu:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('chu:bootstrap:get'),
  continueBootstrapLocal: () => ipcRenderer.invoke('chu:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('chu:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('chu:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('chu:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('chu:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('chu:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('chu:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('chu:version'),
  relaunchApp: () => ipcRenderer.invoke('chu:app:relaunch'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('chu:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('chu:uninstall:summary'),
    run: mode => ipcRenderer.invoke('chu:uninstall:run', { mode })
  },
  updates: {
    check: () => ipcRenderer.invoke('chu:updates:check'),
    apply: opts => ipcRenderer.invoke('chu:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('chu:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('chu:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('chu:updates:progress', listener)

      return () => ipcRenderer.removeListener('chu:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('chu:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('chu:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('chu:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('chu:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('chu:found-in-page', listener)

    return () => ipcRenderer.removeListener('chu:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('chu:open-find-bar', listener)

    return () => ipcRenderer.removeListener('chu:open-find-bar', listener)
  }
})
