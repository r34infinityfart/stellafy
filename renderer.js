// === STATE ===
const audio = new Audio();
let hls = null;
let queue = [];
let queueIndex = 0;
let currentSong = null;
let contextSong = null;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;

// === INIT ===
window.onload = async () => {
    // Debug
    if (window.api && window.api.onDebug) {
        window.api.onDebug((event, msg) => console.log(`[MAIN]: ${msg}`));
    }

    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'flex';

    // Settings
    const settings = await window.api.getSettings();
    const discordToggle = document.getElementById('setting-discord');
    if (discordToggle) discordToggle.checked = settings.discordRpc;

    const savedVol = settings.volume !== undefined ? settings.volume : 1;
    setVolume(savedVol);

    // Data
    loadRecents();
    await loadHome();
    await refreshPlaylists();

    setTimeout(() => {
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);
        }
    }, 1200);
};

// === ROUTER ===
window.router = (viewName) => {
    document.querySelectorAll('.view-section').forEach(e => e.classList.remove('active'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');
    
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    // Manual active class handling for sidebar based on view index
    const btns = document.querySelectorAll('.nav-btn');
    if(viewName==='home' && btns[0]) btns[0].classList.add('active');
    if(viewName==='search' && btns[1]) btns[1].classList.add('active');
    if(viewName==='settings' && btns[2]) btns[2].classList.add('active');
};

// === PLAYBACK ENGINE ===
async function playSong(song) {
    console.log("Playing:", song.title);
    currentSong = song;
    updateUI(song);

    if (hls) { hls.destroy(); hls = null; }

    const liked = await window.api.isLiked(song.id);
    updateLikeBtn(liked);

    // Backend Call
    const data = await window.api.play(song);
    
    if (!data || !data.streamUrl || data.error) {
        return showToast(data?.error || "Song unavailable", "error");
    }

    // Handle Stream
    if (Hls.isSupported() && data.streamUrl.includes('.m3u8')) {
        hls = new Hls();
        hls.loadSource(data.streamUrl);
        hls.attachMedia(audio);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            audio.play().catch(e => console.error(e));
            isPlaying = true;
            updatePlayBtn();
        });
    } else {
        audio.src = data.streamUrl;
        audio.play().catch(e => console.error(e));
        isPlaying = true;
        updatePlayBtn();
    }
}

function updateUI(song) {
    const art = document.getElementById('pb-art');
    const artBox = document.getElementById('pb-art-box');
    const title = document.getElementById('pb-title');
    const artist = document.getElementById('pb-artist');
    
    // Safety checks
    if(art) {
        art.src = song.thumbnail || '';
        art.onerror = () => { art.src = 'https://placehold.co/200/222/aaa?text=Music'; };
    }
    if(artBox) artBox.style.display = 'block';
    if(title) title.innerText = song.title;
    if(artist) artist.innerText = song.artist;

    // Sidebar
    const npImg = document.getElementById('np-img');
    const npCard = document.getElementById('np-card-sidebar');
    if(npImg && npCard) {
        npCard.style.display = 'block';
        npImg.src = song.thumbnail || '';
        document.getElementById('np-card-title').innerText = song.title;
        document.getElementById('np-card-artist').innerText = song.artist;
    }
}

function togglePlay() {
    if(!currentSong) return;
    if(isPlaying) audio.pause(); else audio.play();
    isPlaying = !isPlaying;
    updatePlayBtn();
}

function updatePlayBtn() {
    const btn = document.getElementById('btn-play');
    if(btn) btn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

// === CONTROLS ===
document.getElementById('btn-play').onclick = togglePlay;
document.getElementById('btn-next').onclick = () => {
    if(queue.length === 0) return;
    if(isShuffle) queueIndex = Math.floor(Math.random()*queue.length);
    else { queueIndex++; if(queueIndex >= queue.length) queueIndex=0; }
    playSong(queue[queueIndex]);
};
document.getElementById('btn-prev').onclick = () => {
    if(audio.currentTime > 3) audio.currentTime = 0;
    else if(queueIndex > 0) { queueIndex--; playSong(queue[queueIndex]); }
};
document.getElementById('btn-shuffle').onclick = function() { isShuffle=!isShuffle; this.classList.toggle('active', isShuffle); };
document.getElementById('btn-repeat').onclick = function() { isRepeat=!isRepeat; this.classList.toggle('active', isRepeat); };

audio.onended = () => {
    if(isRepeat) { audio.currentTime=0; audio.play(); }
    else document.getElementById('btn-next').click();
};

// Progress
audio.addEventListener('timeupdate', () => {
    if(!audio.duration) return;
    const pct = (audio.currentTime/audio.duration)*100;
    const fill = document.getElementById('prog-fill');
    if(fill) fill.style.width = pct+'%';
    document.getElementById('t-curr').innerText = fmtTime(audio.currentTime);
    document.getElementById('t-total').innerText = fmtTime(audio.duration);
});
document.getElementById('prog-cont').onclick = (e) => {
    const width = document.getElementById('prog-cont').clientWidth;
    audio.currentTime = (e.offsetX / width) * audio.duration;
};

// Volume
function setVolume(val) {
    const safe = Math.min(Math.max(val, 0), 1);
    audio.volume = safe;
    const slider = document.getElementById('vol-slider');
    if(slider) {
        slider.value = safe;
        slider.style.background = `linear-gradient(to right, #fff ${safe*100}%, #4d4d4d ${safe*100}%)`;
    }
    window.api.setSetting({key:'volume', value: safe});
}
const volSlider = document.getElementById('vol-slider');
if(volSlider) volSlider.oninput = (e) => setVolume(parseFloat(e.target.value));

// === SEARCH & CARDS ===
async function performSearch(query) {
    if(!query) return;
    
    // Save Recent
    let recents = JSON.parse(localStorage.getItem('stellafy_recents') || '[]');
    if(!recents.includes(query)) { 
        recents.unshift(query); 
        if(recents.length > 5) recents.pop(); 
        localStorage.setItem('stellafy_recents', JSON.stringify(recents)); 
        loadRecents();
    }

    const grid = document.getElementById('search-results');
    grid.innerHTML = '<div style="color:#aaa; grid-column:1/-1; text-align:center;">Searching...</div>';
    
    const res = await window.api.search(query);
    grid.innerHTML = '';
    
    if(res.length === 0) {
        grid.innerHTML = '<div style="color:#aaa; grid-column:1/-1; text-align:center;">No results.</div>';
        return;
    }

    queue = res;
    res.forEach((s, i) => {
        const c = createCard(s);
        c.onclick = () => { queueIndex=i; playSong(s); };
        grid.appendChild(c);
    });
}

const sInput = document.getElementById('search-input');
if(sInput) sInput.addEventListener('keypress', (e) => { if(e.key==='Enter') performSearch(e.target.value.trim()); });

function createCard(song) {
    const div = document.createElement('div');
    div.className = 'song-card';
    div.innerHTML = `
        <div class="song-img-box">
            <img src="${song.thumbnail || ''}" onerror="this.src='https://placehold.co/200'" loading="lazy">
            <div class="play-float-btn"><i class="fa-solid fa-play"></i></div>
        </div>
        <div class="song-title">${song.title}</div>
        <div class="song-desc">${song.artist}</div>
    `;
    div.oncontextmenu = (e) => { e.preventDefault(); openContext(e, song); };
    return div;
}

function loadRecents() {
    const r = JSON.parse(localStorage.getItem('stellafy_recents') || '[]');
    const d = document.getElementById('recent-searches-list');
    if(!d) return;
    d.innerHTML = '';
    r.forEach(t => {
        const tag = document.createElement('div');
        tag.className = 'recent-search-tag';
        tag.innerText = t;
        tag.onclick = () => { document.getElementById('search-input').value=t; performSearch(t); };
        d.appendChild(tag);
    });
}

// === HOME & LIBRARY ===
async function loadHome() {
    const data = await window.api.getHomeData();
    const grid = document.getElementById('history-grid');
    if(!grid) return;
    grid.innerHTML = '';
    if(data.history.length === 0) grid.innerHTML = '<div style="color:#666">No history yet.</div>';
    data.history.forEach(s => {
        const c = createCard(s);
        c.onclick = () => playSong(s);
        grid.appendChild(c);
    });
}

async function refreshPlaylists() {
    const playlists = await window.api.getPlaylists();
    const ul = document.getElementById('playlists');
    if(!ul) return;
    ul.innerHTML = '';
    playlists.forEach(pl => {
        const li = document.createElement('li');
        li.className = 'pl-item';
        let html = `<span>${pl.name}</span>`;
        if(pl.locked) html += ` <i class="fa-solid fa-lock pl-icon-lock"></i>`;
        else html += `<i class="fa-solid fa-trash pl-delete"></i>`;
        li.innerHTML = html;
        
        li.onclick = (e) => {
            if(e.target.classList.contains('pl-delete')) deletePlaylist(pl.name);
            else openLibrary(pl);
        };
        ul.appendChild(li);
    });
}

function openLibrary(pl) {
    router('library');
    document.getElementById('lib-name').innerText = pl.name;
    document.getElementById('lib-meta').innerText = `${pl.songs.length} songs`;
    const div = document.getElementById('lib-list');
    div.innerHTML = '';
    queue = pl.songs;
    
    if(pl.songs.length === 0) div.innerHTML = '<div style="padding:20px; color:#666">Empty playlist.</div>';
    
    pl.songs.forEach((s, idx) => {
        const r = document.createElement('div');
        r.className = 'track-row';
        r.innerHTML = `
            <div>${idx+1}</div>
            <div class="t-meta"><img src="${s.thumbnail}" onerror="this.src='https://placehold.co/200'">${s.title}</div>
            <div>${s.artist}</div>
            <div>${fmtTimeMs(s.duration)}</div>
        `;
        r.onclick = () => { queueIndex=idx; playSong(s); };
        r.oncontextmenu = (e) => { e.preventDefault(); openContext(e, s); };
        div.appendChild(r);
    });
    
    const playAll = document.getElementById('lib-play-big');
    if(playAll) playAll.onclick = () => { if(pl.songs.length>0) { queueIndex=0; playSong(pl.songs[0]); }};
}

async function deletePlaylist(name) {
    if(await showModal("Delete", `Delete "${name}"?`)) {
        await window.api.deletePlaylist(name);
        refreshPlaylists();
        if(document.getElementById('lib-name').innerText === name) router('home');
    }
}

// === DOWNLOAD & ACTIONS ===
const btnDl = document.getElementById('btn-dl');
if(btnDl) btnDl.onclick = () => performDownload(currentSong);

const btnCtxDl = document.getElementById('c-dl');
if(btnCtxDl) btnCtxDl.onclick = () => { performDownload(contextSong); document.getElementById('context-menu').style.display='none'; };

async function performDownload(song) {
    if(!song) return showToast("No song", "error");
    showToast("Downloading...", "info");
    const res = await window.api.download({ title: song.title, mediaUrl: song.mediaUrl || song.queryObj || song.id });
    showToast(res.success ? "Saved!" : "Failed", res.success?'success':'error');
}

// === UTILS ===
function updateLikeBtn(l) {
    const btn = document.getElementById('btn-like');
    if(!btn) return;
    btn.classList.toggle('active', l);
    btn.innerHTML = l ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
}

const likeBtn = document.getElementById('btn-like');
if(likeBtn) likeBtn.onclick = async () => {
    if(!currentSong) return;
    const isLiked = likeBtn.classList.contains('active');
    if(isLiked) { await window.api.removeFromPlaylist({name:'Favorites', songId:currentSong.id}); updateLikeBtn(false); showToast("Unliked"); }
    else { await window.api.addToPlaylist({name:'Favorites', song:currentSong}); updateLikeBtn(true); showToast("Liked"); }
    refreshPlaylists();
};

function fmtTime(s) { if(isNaN(s)||s<0) return "0:00"; const m=Math.floor(s/60), sc=Math.floor(s%60); return `${m}:${sc<10?'0':''}${sc}`; }
function fmtTimeMs(ms) { return fmtTime(ms/1000); }

function showToast(msg, type='normal') {
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = msg;
    t.style.borderLeft = type==='success'?'4px solid #1DB954':(type==='error'?'4px solid red':'4px solid #2E74D6');
    t.style.opacity='1'; t.style.bottom='120px';
    setTimeout(()=>{t.style.opacity='0';t.style.bottom='100px';}, 3000);
}

// Modal
let modalRes;
function showModal(title, text, input=false, btn="OK") {
    return new Promise(r => {
        document.getElementById('m-title').innerText=title;
        document.getElementById('m-text').innerText=text;
        const i = document.getElementById('m-input');
        i.style.display = input?'block':'none'; i.value='';
        document.getElementById('m-confirm').innerText=btn;
        document.getElementById('modal-backdrop').style.display='flex';
        if(input) i.focus();
        modalRes = (val) => { document.getElementById('modal-backdrop').style.display='none'; r(val); };
    });
}
document.getElementById('m-confirm').onclick = () => modalRes(document.getElementById('m-input').value||true);
document.getElementById('m-cancel').onclick = () => modalRes(false);

// Context
function openContext(e, song) {
    contextSong = song;
    const m = document.getElementById('context-menu');
    m.style.display = 'block';
    let x=e.pageX, y=e.pageY;
    if(y+150>window.innerHeight) y=window.innerHeight-150;
    m.style.left = x+'px'; m.style.top = y+'px';
}

document.getElementById('c-pl').onclick = async () => {
    const pl = await window.api.getPlaylists();
    const name = await showModal("Add to...", `Playlist name:\n(${pl.map(p=>p.name).join(', ')})`, true);
    if(name) {
        const ok = await window.api.addToPlaylist({name, song:contextSong});
        showToast(ok ? "Added!" : "Failed/Duplicate");
    }
    document.getElementById('context-menu').style.display='none';
};
document.getElementById('c-fav').onclick = async () => {
    await window.api.addToPlaylist({name:'Favorites', song:contextSong});
    showToast("Liked");
    document.getElementById('context-menu').style.display='none';
};

// Window Buttons
document.getElementById('btn-min').onclick = () => window.api.minimize();
document.getElementById('btn-max').onclick = () => window.api.maximize();
document.getElementById('btn-close').onclick = () => window.api.close();
document.getElementById('btn-info').onclick = () => document.getElementById('about-overlay').style.display='flex';
document.getElementById('about-close').onclick = () => document.getElementById('about-overlay').style.display='none';

// Settings
const setDiscord = document.getElementById('setting-discord');
if(setDiscord) setDiscord.onchange = (e) => window.api.setSetting({key:'discordRpc', value:e.target.checked});

// PL Import
const importBtn = document.getElementById('import-pl-btn');
if(importBtn) importBtn.onclick = async () => {
    const url = await showModal("Import", "Spotify URL:", true, "Import");
    if(url && url.includes('spotify')) {
        showToast("Importing...", "info");
        const res = await window.api.importPlaylist(url);
        if(res.success) { showToast(`Imported ${res.count} songs`, "success"); refreshPlaylists(); }
        else showToast("Import Failed", "error");
    }
};
document.getElementById('create-pl-btn').onclick = async () => {
    const n = await showModal("New Playlist", "Name:", true, "Create");
    if(n) { await window.api.createPlaylist(n); refreshPlaylists(); }
};