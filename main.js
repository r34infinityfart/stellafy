const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const YTDlpWrap = require('yt-dlp-wrap').default;
const DiscordRPC = require('discord-rpc');
const { autoUpdater } = require('electron-updater');
const DataManager = require('./dataManager');

const DISCORD_CLIENT_ID = '1456139891359350876'; 

// PATHS
const IS_WIN = process.platform === 'win32';
const BINARY_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const BINARY_PATH = path.join(app.getPath('userData'), BINARY_NAME);

let rpc;
let mainWindow;
const db = new DataManager();
const ytDlp = new YTDlpWrap(BINARY_PATH);

// SC Fallback
let SC_CLIENT_ID = 'BeGNuC2J617a23cT7f5aK4y5E89a1c6a'; 

// --- DEBUG LOGGER ---
function sendLog(msg) {
    console.log(msg);
    if(mainWindow) mainWindow.webContents.send('console-log', msg);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 900, minHeight: 600,
        frame: false, backgroundColor: '#000000',
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    mainWindow.loadFile('index.html');
    // OPEN DEV TOOLS AUTOMATICALLY FOR DEBUGGING
    mainWindow.webContents.openDevTools(); 
}

app.whenReady().then(async () => {
    createWindow();
    
    sendLog(`[Init] Checking Audio Engine at: ${BINARY_PATH}`);
    if (!fs.existsSync(BINARY_PATH)) {
        sendLog("[Init] Engine not found. Downloading...");
        try { await YTDlpWrap.downloadFromGithub(BINARY_PATH); sendLog("[Init] Download success."); } 
        catch (e) { sendLog(`[Init] Download FAILED: ${e.message}`); }
    } else {
        sendLog("[Init] Engine found.");
    }

    const id = await getClientId();
    if(id) { SC_CLIENT_ID = id; sendLog(`[Init] Scraped SC ID: ${id}`); }
    else sendLog("[Init] Using Fallback SC ID");

    if (db.getSettings().discordRpc) initDiscord();
});

// === AUDIO RESOLVER (WITH LOGS) ===
async function resolveAudio(song) {
    let streamUrl = null;
    let duration = song.duration || 0;

    // 1. Try Native SC
    if (song.apiLink && song.source === 'soundcloud') {
        sendLog(`[Play] Trying Direct SoundCloud API: ${song.apiLink}`);
        try {
            const sep = song.apiLink.includes('?') ? '&' : '?';
            const res = await fetch(`${song.apiLink}${sep}client_id=${SC_CLIENT_ID}`);
            if (res.ok) {
                const json = await res.json();
                if (json.url) return { streamUrl: json.url, duration };
            }
            sendLog(`[Play] SC Native failed (Status ${res.status})`);
        } catch (e) { sendLog(`[Play] SC Native Error: ${e.message}`); }
    }

    // 2. Try yt-dlp (YouTube Search)
    let query = song.queryObj || `${song.artist} - ${song.title}`;
    // Clean query
    query = query.replace(/[^\w\s\-]/gi, ''); // Remove weird chars
    
    const searchString = `ytsearch1:${query} audio`;
    sendLog(`[Play] Trying yt-dlp search: "${searchString}"`);

    try {
        const metadata = await ytDlp.execPromise([
            searchString,
            '-f', 'bestaudio[ext=m4a]/bestaudio', // Prefer m4a for compatibility
            '--get-url',       
            '--print', 'duration',
            '--no-warnings',
            '--force-ipv4'
        ]);

        const lines = metadata.trim().split('\n');
        // Filter out lines that aren't URLs
        streamUrl = lines.find(l => l.startsWith('http'));
        const durLine = lines.find(l => !isNaN(parseFloat(l)) && l.length < 15);
        if (durLine) duration = parseFloat(durLine) * 1000;

        if (!streamUrl) {
            sendLog("[Play] yt-dlp ran but returned no URL.");
            throw new Error("No URL extracted");
        }

        sendLog(`[Play] Success! URL Found.`);
        return { streamUrl, duration };

    } catch (e) {
        sendLog(`[Play] FATAL yt-dlp Error: ${e.message}`);
        throw new Error("Could not resolve audio");
    }
}

// --- IPC HANDLERS ---

ipcMain.handle('search-song', async (event, query) => {
    // A. Spotify
    if (query.includes('spotify.com/track')) {
        const meta = await getSpotifyMetadata(query);
        if (meta) return [{
            id: query, queryObj: `${meta.artist} - ${meta.title}`, 
            title: meta.title, artist: meta.artist, thumbnail: meta.thumbnail,
            duration: 0, likes: 0, source: 'spotify'
        }];
    }

    // B. iTunes (Primary)
    let results = [];
    try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=10`);
        const json = await res.json();
        results = json.results.map(i => ({
            id: i.trackId.toString(),
            queryObj: `${i.artistName} - ${i.trackName}`, 
            apiLink: null,
            title: i.trackName, artist: i.artistName,
            thumbnail: i.artworkUrl100.replace('100x100bb', '600x600bb'),
            duration: i.trackTimeMillis, likes: 0, source: 'itunes'
        }));
    } catch(e) { sendLog(`[Search] iTunes Error: ${e.message}`); }

    // C. SoundCloud (Secondary)
    try {
        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${SC_CLIENT_ID}&limit=10`;
        const res = await fetch(url);
        const json = await res.json();
        (json.collection || []).forEach(t => {
            if (t.policy === 'SNIP' || t.duration < 30000) return;
            const media = t.media?.transcodings?.find(f => f.format.protocol === 'progressive' || f.format.protocol === 'hls');
            if (media) {
                results.push({
                    id: t.permalink_url, apiLink: media.url,
                    title: t.title, artist: t.user.username,
                    thumbnail: t.artwork_url ? t.artwork_url.replace('large', 't500x500') : '',
                    duration: t.duration, likes: t.likes_count, source: 'soundcloud'
                });
            }
        });
    } catch (e) {}

    return results;
});

ipcMain.handle('play-song', async (event, song) => {
    try {
        const result = await resolveAudio(song);
        db.addToHistory(song);
        setDiscordActivity(song, Date.now() + result.duration);
        return { streamUrl: result.streamUrl };
    } catch (e) {
        return { error: e.message };
    }
});

// IMPORT
ipcMain.handle('import-playlist', async (event, url) => {
    try {
        sendLog(`[Import] Fetching: ${url}`);
        let idMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
        if (!idMatch) throw new Error("Invalid URL");
        
        const res = await fetch(`https://open.spotify.com/embed/playlist/${idMatch[1]}`);
        const html = await res.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
        if (!match) throw new Error("Parse Error");

        const json = JSON.parse(match[1]);
        const trackList = json.props?.pageProps?.state?.data?.entity?.trackList;
        if (!trackList) throw new Error("No tracks found");

        const name = json.props.pageProps.state.data.entity.title || "Imported";
        const songs = trackList.map(t => {
            let img = 'https://placehold.co/200';
            if (t.coverArt?.sources?.[0]?.url) img = t.coverArt.sources[0].url;
            return {
                id: t.uri || `spot_${Math.random()}`,
                queryObj: `${t.subtitle} - ${t.title}`,
                apiLink: null,
                title: t.title, artist: t.subtitle, thumbnail: img,
                duration: t.duration, likes: 0, source: 'spotify_import'
            };
        });
        
        db.importPlaylist(name, songs);
        return { success: true, name: name, count: songs.length };
    } catch (e) { 
        sendLog(`[Import] Error: ${e.message}`);
        return { success: false, error: e.message }; 
    }
});

// Download
ipcMain.handle('download-song', async (event, { title, mediaUrl }) => {
    try {
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').trim(); 
        const downloadPath = path.join(app.getPath('downloads'), `${safeTitle}.mp3`);
        
        let input = mediaUrl;
        if (!input.startsWith('http') || input.includes('api-v2')) {
            // Strip special chars for safety
            const cleanTitle = title.replace(/[^\w\s]/gi, '');
            input = `ytsearch1:${cleanTitle} audio`;
        }

        sendLog(`[DL] Command: ${input}`);

        await ytDlp.execPromise([
            input, '-o', downloadPath, '-f', 'bestaudio', '--no-playlist'
        ]);

        if (fs.existsSync(downloadPath)) return { success: true, path: downloadPath };
        else throw new Error("File missing");
    } catch (e) { return { success: false, error: e.message }; }
});

// DISCORD
async function initDiscord() {
    try {
        rpc = new DiscordRPC.Client({ transport: 'ipc' });
        rpc.on('ready', () => {});
        await rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(()=>{});
    } catch (e) {}
}
function setDiscordActivity(song, endTime) {
    if(!rpc || !db.getSettings().discordRpc) return;
    rpc.setActivity({
        details: song.title.substring(0,127), state: `by ${song.artist}`.substring(0,127),
        startTimestamp: Date.now(), endTimestamp: endTime,
        largeImageKey: 'stellafy_logo', instance: false
    }).catch(()=>{});
}
ipcMain.on('reset-rpc', () => { if(rpc) rpc.clearActivity(); });

// STANDARD IPC
ipcMain.handle('get-home-data', async () => ({ history: db.getHistory().slice(0, 12), recommendations: [] }));
ipcMain.handle('get-playlists', () => db.getPlaylists());
ipcMain.handle('create-playlist', (e, n) => db.createPlaylist(n));
ipcMain.handle('delete-playlist', (e, n) => db.deletePlaylist(n));
ipcMain.handle('add-to-playlist', (e, d) => db.addToPlaylist(d.name, d.song));
ipcMain.handle('remove-from-playlist', (e, d) => db.removeFromPlaylist(d.name, d.songId));
ipcMain.handle('check-is-liked', (e, id) => db.isLiked(id));
ipcMain.handle('get-settings', () => db.getSettings());
ipcMain.handle('set-setting', (e, d) => db.setSetting(d.key, d.value));
ipcMain.on('window-min', () => mainWindow.minimize());
ipcMain.on('window-max', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => app.quit());

// HELPERS
async function getSpotifyMetadata(url) {
    try {
        const res = await fetch(url);
        const html = await res.text();
        const getMeta = (p) => { const m = html.match(new RegExp(`<meta property="${p}" content="(.*?)"`)); return m ? m[1].replace(/&#039;/g, "'").replace(/&quot;/g, '"') : null; };
        return { title: getMeta('og:title'), artist: getMeta('og:description').split('·')[0].trim(), thumbnail: getMeta('og:image') };
    } catch (e) { return null; }
}
async function getClientId() {
    try {
        const html = await (await fetch("https://soundcloud.com")).text();
        const urls = html.match(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g);
        if(!urls) return null;
        for(let i=urls.length-1; i>=0; i--) {
            const url = urls[i].match(/src="([^"]+)"/)[1];
            const js = await (await fetch(url)).text();
            const id = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
            if(id) return id[1];
        }
    } catch(e) {}
    return null;
}