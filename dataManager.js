const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class DataManager {
    constructor() {
        this.path = path.join(app.getPath('userData'), 'stella.json');
        this.data = this.loadData();
        this.ensureDefaults();
    }

    loadData() {
        try {
            if (fs.existsSync(this.path)) {
                return JSON.parse(fs.readFileSync(this.path));
            }
        } catch (error) {
            console.error("Data file corrupt or missing, resetting:", error);
        }
        return this.getDefaults();
    }

    getDefaults() {
        return {
            history: [],
            playlists: [
                { name: 'Favorites', songs: [], locked: true }
            ],
            settings: {
                discordRpc: true,
                volume: 1
            }
        };
    }

    ensureDefaults() {
        if (!this.data.playlists) this.data.playlists = [];
        if (!this.data.playlists.find(p => p.name === 'Favorites')) {
            this.data.playlists.unshift({ name: 'Favorites', songs: [], locked: true });
        }
        if (!this.data.history) this.data.history = [];
        if (!this.data.settings) this.data.settings = { discordRpc: true, volume: 1 };
        this.save();
    }

    save() {
        try {
            fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error("Failed to save data:", e);
        }
    }

    getHistory() { return this.data.history; }
    
    addToHistory(song) {
        if (!song || !song.id) return;
        this.data.history = this.data.history.filter(s => s.id !== song.id);
        this.data.history.unshift(song);
        if (this.data.history.length > 50) this.data.history.pop();
        this.save();
    }

    getPlaylists() { return this.data.playlists; }

    createPlaylist(name) {
        if (name === 'Favorites') return;
        if (!this.data.playlists.find(p => p.name === name)) {
            this.data.playlists.push({ name, songs: [], locked: false });
            this.save();
        }
    }

    deletePlaylist(name) {
        if (name === 'Favorites') return false;
        const idx = this.data.playlists.findIndex(p => p.name === name);
        if (idx > -1) {
            this.data.playlists.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    addToPlaylist(playlistName, song) {
        const pl = this.data.playlists.find(p => p.name === playlistName);
        if (pl) {
            if (!pl.songs.find(s => s.id === song.id)) {
                pl.songs.push(song);
                this.save();
                return true;
            }
        }
        return false;
    }

    removeFromPlaylist(playlistName, songId) {
        const pl = this.data.playlists.find(p => p.name === playlistName);
        if (pl) {
            pl.songs = pl.songs.filter(s => s.id !== songId);
            this.save();
            return true;
        }
        return false;
    }

    isLiked(songId) {
        const fav = this.data.playlists.find(p => p.name === 'Favorites');
        return fav ? !!fav.songs.find(s => s.id === songId) : false;
    }

    getSettings() { return this.data.settings; }
    
    setSetting(key, value) {
        if(!this.data.settings) this.data.settings = {};
        this.data.settings[key] = value;
        this.save();
    }
    // ... inside DataManager class ...

    importPlaylist(name, songs) {
        // If playlist exists, merge; otherwise create
        let pl = this.data.playlists.find(p => p.name === name);
        if (!pl) {
            pl = { name: name, songs: [], locked: false };
            this.data.playlists.push(pl);
        }
        
        // Add songs (preventing duplicates within the playlist)
        songs.forEach(song => {
            if (!pl.songs.find(s => s.id === song.id || s.title === song.title)) {
                pl.songs.push(song);
            }
        });
        
        this.save();
        return pl.songs.length;
    }
}

module.exports = DataManager;