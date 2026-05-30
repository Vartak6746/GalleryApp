const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const FOLDERS = APP_CONFIG.FOLDERS;

let visibleFolders = JSON.parse(localStorage.getItem('visibleFolders')) || FOLDERS;

let CURRENT_FILES = [];   
let FILTERED_FILES = [];  
let currentIndex = 0;
let currentFolderIndex = -1;

let isAtHomepage = true;
let isGridView = false;
let currentFilterType = 'all'; 
let isDiceMode = false;

let currentLayer = 1;      
let slideshowTimer = null;
let isSlideshowActive = false;
let slideTime = 1500;

// ==========================================
// 🔀 UTILS & SETUP
// ==========================================
function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

window.quitApp = function() { ipcRenderer.invoke('quit-app'); };

// ==========================================
// 🖱️ DROPDOWN MENUS LOGIC
// ==========================================
window.toggleDropdown = function(id) {
    document.getElementById(id).classList.toggle('show');
};

// Close dropdowns if clicked outside
window.onclick = function(event) {
    if (!event.target.matches('.nav-btn') && !event.target.matches('.nav-btn span')) {
        let dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
        }
    }
};

function populateDropdowns() {
    const folderList = document.getElementById('folder-dropdown');
    folderList.innerHTML = FOLDERS.map((folderPath, i) => {
        const name = folderPath.split('/').pop().replace(/_/g, ' ');
        return `<div class="dropdown-item ${i === currentFolderIndex ? 'active' : ''}" onclick="window.selectFolder(${i})">${name}</div>`;
    }).join('');

    const filterList = document.getElementById('filter-dropdown');
    const hasPhotos = CURRENT_FILES.some(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
    const hasVideos = CURRENT_FILES.some(f => /\.(mp4|webm|mov)$/i.test(f));

    let filters = [{ label: 'All Media', type: 'all' }];
    if (hasPhotos) filters.push({ label: 'Photos Only', type: 'photos' });
    if (hasVideos) filters.push({ label: 'Videos Only', type: 'videos' });

    filterList.innerHTML = filters.map(f => {
        return `<div class="dropdown-item ${f.type === currentFilterType ? 'active' : ''}" onclick="window.applyFilter('${f.type}', '${f.label}')">${f.label}</div>`;
    }).join('');
}

window.applyFilter = function(type, label) {
    currentFilterType = type;
    document.getElementById('filter-btn-text').innerText = label;
    
    if (type === 'photos') {
        FILTERED_FILES = CURRENT_FILES.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
    } else if (type === 'videos') {
        FILTERED_FILES = CURRENT_FILES.filter(f => /\.(mp4|webm|mov)$/i.test(f));
    } else {
        FILTERED_FILES = [...CURRENT_FILES];
    }
    
    currentIndex = 0; 
    populateDropdowns(); 
    if (isGridView) window.toggleGridView(true); else showMedia();
};

// ==========================================
// ⚙️ SETTINGS
// ==========================================
window.openSettings = function() {
    document.getElementById('input-speed').value = slideTime;
    
    // Build the checklist
    const container = document.getElementById('folder-checklist');
    container.innerHTML = FOLDERS.map((folderPath) => {
        if (folderPath.includes('Gallery_Favorites')) return '';
        const name = folderPath.split('/').pop().replace(/_/g, ' ');
        const isChecked = visibleFolders.includes(folderPath) ? 'checked' : '';
        return `
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.85rem; color: var(--text-main);">
                <input type="checkbox" value="${folderPath}" class="folder-toggle" ${isChecked}>
                ${name}
            </label>`;
    }).join('');

    document.getElementById('settings-modal').style.display = 'flex';
};

window.closeSettings = function() { document.getElementById('settings-modal').style.display = 'none'; };

window.saveSettings = function() {
    const speedInput = document.getElementById('input-speed').value;
    const colInput = document.getElementById('input-columns').value;
    if (speedInput) slideTime = parseInt(speedInput);
    if (colInput) document.getElementById('grid-content').style.gridTemplateColumns = `repeat(${colInput}, 1fr)`;
    
    // Save checklist
    const checkboxes = document.querySelectorAll('.folder-toggle');
    visibleFolders = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    localStorage.setItem('visibleFolders', JSON.stringify(visibleFolders));
    
    window.closeSettings();
    if (isAtHomepage) buildHomepageGrid();
};

// ==========================================
// 👻 GHOST MODE (Hides UI when idle)
// ==========================================
let idleTimer;
function resetIdleTimer() {
    document.body.classList.remove('ghost-mode');
    clearTimeout(idleTimer);
    if (!isAtHomepage && !isGridView) {
        idleTimer = setTimeout(() => { document.body.classList.add('ghost-mode'); }, 2500); 
    }
}
window.addEventListener('mousemove', resetIdleTimer);

// ==========================================
// 🍑 HOMEPAGE
// ==========================================
window.goHome = function() {
    isDiceMode = false;
    document.getElementById('standard-controls').style.display = 'flex';
    document.getElementById('dice-spin-again').style.display = 'none';
    isAtHomepage = true;
    currentFolderIndex = -1;
    document.getElementById('homepage').style.display = 'block';
    document.getElementById('top-bar').style.display = 'none';
    document.getElementById('bottom-controls').style.display = 'none';
    document.getElementById('video-controls').style.display = 'none';
    document.getElementById('counter-box').style.display = 'none';
    document.getElementById('grid-view').style.display = 'none';
    
    document.getElementById(`vid-layer-1`).pause();
    document.getElementById(`vid-layer-2`).pause();
    if (isSlideshowActive) window.toggleSlideshow(); 
    
    setTimeout(() => { document.getElementById('homepage').style.opacity = '1'; }, 10);
};

function morphBackground(folderPath) {
    const ambient = document.getElementById('ambient-glow');
    let searchPath = folderPath.includes('Gallery_Favorites') ? APP_CONFIG.FAVORITES_COVER : folderPath;
    try {
        if (fs.existsSync(searchPath)) {
            const files = fs.readdirSync(searchPath);
            const media = files.filter(f => /\.(jpg|jpeg|png|gif|mp4|webm|mov)$/i.test(f));
            const cover = media.find(f => f.toLowerCase().startsWith('cover')) || media[0];
            if (cover) {
                ambient.style.backgroundImage = `url("${encodeURI(`file://${path.join(searchPath, cover)}`)}")`;
                ambient.style.opacity = "0.4";
            }
        }
    } catch (e) {}
}

function buildHomepageGrid() {
    const grid = document.getElementById('folder-grid');
    let html = '';
    
    FOLDERS.forEach((folderPath, i) => {
        if (folderPath.includes('Gallery_Favorites')) return; 
        if (!visibleFolders.includes(folderPath)) return; 

        const folderName = folderPath.split('/').pop().replace(/_/g, ' ');
        let mediaHTML = '', imgCount = 0, vidCount = 0;
        try {
            if (fs.existsSync(folderPath)) {
                const actualFiles = fs.readdirSync(folderPath);
                imgCount = actualFiles.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f)).length;
                vidCount = actualFiles.filter(f => /\.(mp4|webm|mov)$/i.test(f)).length;
            }
            if (fs.existsSync(folderPath)) {
                const media = fs.readdirSync(folderPath).filter(f => /\.(jpg|jpeg|png|gif|mp4|webm|mov)$/i.test(f));
                const covers = media.filter(f => f.toLowerCase().startsWith('cover'));
                const chosen = covers.length > 0 ? covers[Math.floor(Math.random() * covers.length)] : media[0];
                if (chosen) {
                    const src = encodeURI(`file://${path.join(folderPath, chosen)}`) + `?v=${Date.now()}`;
                    mediaHTML = /\.(mp4|webm|mov)$/i.test(chosen) 
                        ? `<video class="folder-bg-media" src="${src}" muted loop autoplay></video>` 
                        : `<img class="folder-bg-media" src="${src}">`;
                }
            }
        } catch (err) {}

        html += `
            <div class="folder-card" onclick="window.selectFolder(${i})" onmouseenter="morphBackground('${folderPath}')">
                ${mediaHTML}
                <div class="folder-card-content">
                    <div class="folder-name">${folderName}</div>
                    <div class="folder-stats">${imgCount} Photos &nbsp;•&nbsp; ${vidCount} Videos</div>
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;
}

// ==========================================
// 🎲 DISCOVERY ROULETTE MODE
// ==========================================
window.spinDice = function() {
    let allMedia = [];
    
    // 1. Scan all visible folders for media
    visibleFolders.forEach(folderPath => {
        if (folderPath.includes('Gallery_Favorites')) return; // Skip favorites folder
        try {
            if (fs.existsSync(folderPath)) {
                const files = fs.readdirSync(folderPath);
                // Grab all photos and videos
                const media = files
                    .filter(f => /\.(jpg|jpeg|png|gif|mp4|webm|mov)$/i.test(f))
                    .map(f => path.join(folderPath, f));
                allMedia.push(...media);
            }
        } catch (e) {}
    });

    if (allMedia.length === 0) return alert("No media found to shuffle!");

    // 2. Pick one completely random file
    const randomFile = allMedia[Math.floor(Math.random() * allMedia.length)];
    
    // 3. Trick the gallery engine into thinking this is a 1-file folder
    FILTERED_FILES = [randomFile];
    currentIndex = 0;
    
    // 4. Update UI State
    isDiceMode = true;
    isAtHomepage = false;
    document.getElementById('homepage').style.opacity = '0';
    
    setTimeout(() => {
        document.getElementById('homepage').style.display = 'none';
        
        // Show navigation bars
        document.getElementById('top-bar').style.display = 'flex';
        document.getElementById('bottom-controls').style.display = 'flex';
        
        // Disable normal controls, enable giant dice button
        document.getElementById('standard-controls').style.display = 'none';
        document.getElementById('dice-spin-again').style.display = 'flex';
        
        // Hide counter box (since it would just say "1 / 1")
        document.getElementById('counter-box').style.display = 'none';
        
        // Send image to the dual-buffer viewer
        showMedia();
        resetIdleTimer();
    }, 400);
};

// ==========================================
// 📂 GALLERY ENGINE
// ==========================================
window.selectFolder = async function(index) {
    isDiceMode = false;
    document.getElementById('standard-controls').style.display = 'flex';
    document.getElementById('dice-spin-again').style.display = 'none';
    const res = await ipcRenderer.invoke('get-files', FOLDERS[index]);
    if (res.error) return alert("Folder not found!");

    CURRENT_FILES = shuffleArray(res.filePaths);
    currentFolderIndex = index;
    
    const folderName = FOLDERS[index].split('/').pop().replace(/_/g, ' ');
    document.getElementById('folder-btn-text').innerText = folderName;
    
    const hasPhotos = CURRENT_FILES.some(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
    const hasVideos = CURRENT_FILES.some(f => /\.(mp4|webm|mov)$/i.test(f));
    if (currentFilterType === 'videos' && !hasVideos) window.applyFilter('all', 'All Media');
    else if (currentFilterType === 'photos' && !hasPhotos) window.applyFilter('all', 'All Media');
    else window.applyFilter(currentFilterType, document.getElementById('filter-btn-text').innerText);

    populateDropdowns();

    currentIndex = 0;
    isAtHomepage = false;

    document.getElementById('homepage').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('homepage').style.display = 'none';
        
        document.getElementById('top-bar').style.display = 'flex';
        document.getElementById('bottom-controls').style.display = 'flex';
        document.getElementById('counter-box').style.display = 'flex';
        
        if (isGridView) window.toggleGridView(true); else showMedia();
        resetIdleTimer();
    }, 400);
};

// --- 🎬 CINEMATIC DUAL-BUFFER ---
function showMedia() {
    if (FILTERED_FILES.length === 0) return; 

    const file = FILTERED_FILES[currentIndex];
    const isVid = /\.(mp4|webm|mov)$/i.test(file);
    const safePath = encodeURI(`file://${file}`);

    const oldLayer = currentLayer;
    currentLayer = currentLayer === 1 ? 2 : 1;

    const nextImg = document.getElementById(`img-layer-${currentLayer}`);
    const nextVid = document.getElementById(`vid-layer-${currentLayer}`);
    const prevImg = document.getElementById(`img-layer-${oldLayer}`);
    const prevVid = document.getElementById(`vid-layer-${oldLayer}`);
    
    const videoControls = document.getElementById('video-controls');

    if (isVid) {
        nextVid.src = safePath; nextVid.classList.add('active'); nextImg.classList.remove('active'); 
        
        // Reset and Show Video Scrubber
        document.getElementById('vid-progress-bar').style.width = '0%';
        document.getElementById('vid-time').innerText = '0:00 / 0:00';
        document.getElementById('vid-play-btn').innerText = '⏸️';
        if(!isGridView) videoControls.style.display = 'flex';
    } else {
        nextImg.src = safePath; nextImg.classList.add('active'); nextVid.classList.remove('active'); 
        
        // Hide Video Scrubber
        videoControls.style.display = 'none';
    }

    prevImg.classList.remove('active'); prevVid.classList.remove('active');
    setTimeout(() => { if (!prevVid.classList.contains('active')) prevVid.pause(); }, 450);

    updateInterface();

    if (isSlideshowActive) scheduleNextSlide();
}

function updateInterface() {
    if (FILTERED_FILES.length === 0) return;
    document.getElementById('counter-display').innerText = `${currentIndex + 1} / ${FILTERED_FILES.length}`;
    updateFavoriteIcon();
}

// ==========================================
// 🎥 VIDEO SCRUBBER LOGIC
// ==========================================
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

['vid-layer-1', 'vid-layer-2'].forEach(id => {
    const vid = document.getElementById(id);
    vid.addEventListener('timeupdate', () => {
        // Only update UI if this buffer is the one currently visible on screen
        if (!vid.classList.contains('active') || isGridView) return; 
        const pct = (vid.currentTime / vid.duration) * 100;
        document.getElementById('vid-progress-bar').style.width = `${pct}%`;
        document.getElementById('vid-time').innerText = `${formatTime(vid.currentTime)} / ${formatTime(vid.duration)}`;
    });
});

window.toggleVideoPlay = function() {
    const activeVid = document.getElementById(`vid-layer-${currentLayer}`);
    const btn = document.getElementById('vid-play-btn');
    if (activeVid.paused) {
        activeVid.play();
        btn.innerText = '⏸️';
    } else {
        activeVid.pause();
        btn.innerText = '▶️';
    }
};

window.scrubVideo = function(e) {
    const activeVid = document.getElementById(`vid-layer-${currentLayer}`);
    const container = document.getElementById('vid-progress-container');
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = clickX / rect.width;
    activeVid.currentTime = pct * activeVid.duration;
};

// ==========================================
// 🖱️ MEDIA NAVIGATION CONTROLS
// ==========================================
window.nextMedia = function() { currentIndex = (currentIndex + 1) % FILTERED_FILES.length; showMedia(); };
window.prevMedia = function() { currentIndex = (currentIndex - 1 + FILTERED_FILES.length) % FILTERED_FILES.length; showMedia(); };

window.addEventListener('wheel', (e) => {
    if (isAtHomepage || isGridView) return;
    if (wheelThrottle) return;
    wheelThrottle = true; setTimeout(() => wheelThrottle = false, 60);
    if (e.deltaY > 0) window.nextMedia(); else if (e.deltaY < 0) window.prevMedia();
});
let wheelThrottle = false;

// ==========================================
// 🧩 GRID VIEW
// ==========================================
window.toggleGridView = function(forceRefresh = false) {
    if (!forceRefresh) isGridView = !isGridView;
    const gridView = document.getElementById('grid-view');
    const gridContent = document.getElementById('grid-content');
    const gridBtn = document.getElementById('grid-btn');
    const videoControls = document.getElementById('video-controls');
    
    gridView.style.display = isGridView ? 'block' : 'none';
    gridBtn.style.color = isGridView ? 'var(--accent)' : 'var(--text-muted)'; 

    if (isGridView) {
        videoControls.style.display = 'none'; // Ensure timeline hides on grid
        gridContent.innerHTML = FILTERED_FILES.map((f, i) => {
            const isVid = /\.(mp4|webm|mov)$/i.test(f);
            const safePath = encodeURI(`file://${f}`);
            return `
                <div class="grid-item ${i === currentIndex ? 'selected-thumb' : ''}" onclick="window.jumpTo(${i})">
                    ${isVid ? `<video src="${safePath}" muted autoplay loop></video>` : `<img src="${safePath}">`}
                </div>
            `;
        }).join('');
        
        setTimeout(() => {
            if (forceRefresh) gridView.scrollTop = 0;
            else {
                const activeItem = document.querySelector('.selected-thumb');
                if (activeItem) activeItem.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
        }, 10);
    } else {
        // If exiting grid and current file is video, bring scrubber back
        if (/\.(mp4|webm|mov)$/i.test(FILTERED_FILES[currentIndex])) {
            videoControls.style.display = 'flex';
        }
    }
    resetIdleTimer();
};

window.jumpTo = function(index) {
    currentIndex = index; window.toggleGridView(); showMedia();
};

// ==========================================
// 🍒 DYNAMIC FAVORITE TOGGLE
// ==========================================
function updateFavoriteIcon() {
    if (FILTERED_FILES.length === 0) return;
    const destPath = path.join(APP_CONFIG.FAVORITES_DEST, path.basename(FILTERED_FILES[currentIndex]));
    const favBtn = document.getElementById('fav-btn');
    if (favBtn) {
        if (fs.existsSync(destPath)) {
            favBtn.innerText = '🍒'; favBtn.style.filter = "grayscale(0%)";
        } else {
            favBtn.innerText = '❌'; favBtn.style.filter = "grayscale(100%)";
        }
    }
}

window.triggerFavorite = async function() {
    if (isAtHomepage || FILTERED_FILES.length === 0) return;
    const currentFile = FILTERED_FILES[currentIndex];
    const destFolder = APP_CONFIG.FAVORITES_DEST;
    
    try {
        if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
        const destPath = path.join(destFolder, path.basename(currentFile));
        const popup = document.getElementById('heart-popup');
        
        if (!fs.existsSync(destPath)) {
            await fs.promises.copyFile(currentFile, destPath);
            if (popup) { popup.innerText = '🍒 Saved to Favorites'; popup.classList.add('heart-animate'); setTimeout(() => popup.classList.remove('heart-animate'), 1500); }
        } else {
            await fs.promises.unlink(destPath);
            if (popup) { popup.innerText = '❌ Removed from Favorites'; popup.classList.add('heart-animate'); setTimeout(() => popup.classList.remove('heart-animate'), 1500); }
        }
        updateFavoriteIcon();
    } catch (error) { alert("Error: " + error.message); }
};

// ==========================================
// 🖼️ WALLPAPER & PLAYBACK
// ==========================================
window.setWallpaper = function() {
    if (FILTERED_FILES.length > 0) ipcRenderer.invoke('set-wallpaper', FILTERED_FILES[currentIndex]);
};

window.toggleSlideshow = function() {
    const dot = document.getElementById('slideshow-dot');
    const playBtn = document.getElementById('play-btn');
    
    if (isSlideshowActive) {
        // 🛑 Stop Slideshow
        isSlideshowActive = false;
        clearTimeout(slideshowTimer);
        document.getElementById('slideshow-progress').classList.remove('animate-progress');
        
        // Re-enable looping for the active video so it behaves normally again
        const activeVid = document.getElementById(`vid-layer-${currentLayer}`);
        if (activeVid) activeVid.loop = true;

        if(dot) dot.style.display = 'none';
        if(playBtn) { playBtn.innerText = '▶️'; playBtn.style.color = "var(--text-muted)"; }
    } else {
        // ▶️ Start Slideshow
        isSlideshowActive = true;
        if(dot) dot.style.display = 'block';
        if(playBtn) { playBtn.innerText = '⏸️'; playBtn.style.color = "var(--accent)"; }
        
        // If we start the slideshow on an image, jump to next immediately to feel responsive.
        // If we start on a video, just let it finish.
        if (!/\.(mp4|webm|mov)$/i.test(FILTERED_FILES[currentIndex])) {
            window.nextMedia(); 
        } else {
            scheduleNextSlide();
        }
    }
};

function scheduleNextSlide() {
    if (!isSlideshowActive || FILTERED_FILES.length === 0) return;
    
    clearTimeout(slideshowTimer);
    const bar = document.getElementById('slideshow-progress');
    const file = FILTERED_FILES[currentIndex];
    const isVid = /\.(mp4|webm|mov)$/i.test(file);
    const activeVid = document.getElementById(`vid-layer-${currentLayer}`);
    
    // Reset progress bar animation
    bar.classList.remove('animate-progress'); 
    void bar.offsetWidth; 

    if (isVid) {
        // It's a video! Stop it from looping so we can detect when it naturally ends
        activeVid.loop = false; 
        
        const startVidProgress = () => {
            const timeRemaining = (activeVid.duration - activeVid.currentTime) * 1000;
            bar.style.setProperty('--slide-time', timeRemaining + 'ms');
            bar.classList.add('animate-progress');
            
            // When the video finishes playing natively
            activeVid.onended = () => {
                activeVid.onended = null; // cleanup
                activeVid.loop = true; // reset for manual viewing later
                if (isSlideshowActive) window.nextMedia();
            };
        };

        // Ensure video metadata is loaded before reading duration
        if (!isNaN(activeVid.duration) && activeVid.duration > 0) {
            startVidProgress();
        } else {
            activeVid.addEventListener('loadedmetadata', startVidProgress, { once: true });
        }
    } else {
        // It's an image! Use the standard settings delay
        bar.style.setProperty('--slide-time', slideTime + 'ms');
        bar.classList.add('animate-progress');
        slideshowTimer = setTimeout(() => {
            if (isSlideshowActive) window.nextMedia();
        }, slideTime);
    }
}

// ==========================================
// ⌨️ KEYBOARD SHORTCUT ENGINE
// ==========================================
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; 

    // Cmd + , to open settings
    if (e.metaKey && e.key === ',') {
        e.preventDefault();
        window.openSettings();
    }
    
    // Cmd + R to refresh homepage grid
    if (e.metaKey && e.key.toLowerCase() === 'r') {
        e.preventDefault(); 
        if (isAtHomepage) buildHomepageGrid();
    }

    
    
    // 'F' key bypass to instantly open Gallery Favorites from anywhere
    if (e.key.toLowerCase() === 'f') {
        const favIndex = FOLDERS.findIndex(f => f.includes('Gallery_Favorites'));
        if (favIndex !== -1) window.selectFolder(favIndex);
    }
    
    if (!isAtHomepage) {
        if (e.key === 'd' || e.key === 'ArrowRight') { window.nextMedia(); }
        if (e.key === 'a' || e.key === 'ArrowLeft') { window.prevMedia(); }
        if (e.key === 'Escape') { window.goHome(); }
        if (e.key === 'z') { window.toggleGridView(); }
        if (e.key === ' ') { 
            e.preventDefault(); 
            if(!e.repeat) {
                if(document.getElementById('video-controls').style.display === 'flex' && !isGridView) {
                    window.toggleVideoPlay();
                } else {
                    window.toggleSlideshow(); 
                }
            }
        }
        if (e.key.toLowerCase() === 'x') { window.triggerFavorite(); }
    } else {
        if (e.key === 'Escape') { ipcRenderer.invoke('quit-app'); } 
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'e') {
        // Fallback in case overlay exists, though it's removed from HTML
        const overlay = document.getElementById('keybinds-overlay');
        if (overlay) overlay.style.display = 'none';
    }
});

// --- INITIALIZE ---
buildHomepageGrid();