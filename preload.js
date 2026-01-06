const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.send('window-min'),
    maximize: () => ipcRenderer.send('window-max'),
    close: () => ipcRenderer.send('window-close'),

    search: (query) => ipcRenderer.invoke('search-song', query),
    play: (song) => ipcRenderer.invoke('play-song', song),
    resetRpc: () => ipcRenderer.send('reset-rpc'),
    download: (details) => ipcRenderer.invoke('download-song', details),

    getHomeData: () => ipcRenderer.invoke('get-home-data'),
    getPlaylists: () => ipcRenderer.invoke('get-playlists'),
    createPlaylist: (name) => ipcRenderer.invoke('create-playlist', name),
    deletePlaylist: (name) => ipcRenderer.invoke('delete-playlist', name),
    addToPlaylist: (data) => ipcRenderer.invoke('add-to-playlist', data),
    removeFromPlaylist: (data) => ipcRenderer.invoke('remove-from-playlist', data),
    isLiked: (songId) => ipcRenderer.invoke('check-is-liked', songId),
    importPlaylist: (url) => ipcRenderer.invoke('import-playlist', url),
    
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSetting: (data) => ipcRenderer.invoke('set-setting', data),
    
    // NEW DEBUG LISTENER
    onDebug: (callback) => ipcRenderer.on('console-log', callback) 
});