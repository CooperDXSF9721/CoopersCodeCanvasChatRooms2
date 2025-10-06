// ==================== Firebase Config ====================
const firebaseConfig = {
  apiKey: "AIzaSyBUfT7u7tthl3Nm-ePsY7XWrdLK7YNoLVQ",
  authDomain: "cooperscodeart.firebaseapp.com",
  projectId: "cooperscodeart",
  storageBucket: "cooperscodeart.firebasestorage.app",
  messagingSenderId: "632469567217",
  appId: "1:632469567217:web:14278c59ad762e67eedb50",
  measurementId: "G-NXS0EPJR61"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==================== WebRTC Voice/Video Chat ====================
let localStream = null;
let peerConnections = {};
let isAudioEnabled = false;
let isVideoEnabled = false;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function toggleAudio() {
  if (!isAudioEnabled) {
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        localStream = stream;
        isAudioEnabled = true;
        updateMediaButton('audio', true);
        announceMediaPresence();
        setupMediaListeners();
      })
      .catch(err => {
        console.error('Error accessing microphone:', err);
        alert('Could not access microphone. Please check permissions.');
      });
  } else {
    stopMedia();
  }
}

function toggleVideo() {
  if (!isVideoEnabled) {
    const constraints = { 
      audio: isAudioEnabled ? false : true, 
      video: { width: 320, height: 240 } 
    };
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        localStream = stream;
        isVideoEnabled = true;
        if (!isAudioEnabled && localStream.getAudioTracks().length > 0) {
          isAudioEnabled = true;
          updateMediaButton('audio', true);
        }
        updateMediaButton('video', true);
        showLocalVideo();
        announceMediaPresence();
        setupMediaListeners();
      })
      .catch(err => {
        console.error('Error accessing camera:', err);
        alert('Could not access camera. Please check permissions.');
      });
  } else {
    hideLocalVideo();
    if (localStream && localStream.getVideoTracks().length > 0) {
      localStream.getVideoTracks().forEach(track => track.stop());
      isVideoEnabled = false;
      updateMediaButton('video', false);
      
      if (isAudioEnabled) {
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .then(stream => {
            localStream = stream;
            announceMediaPresence();
          })
          .catch(err => {
            console.error('Error restarting audio:', err);
          });
      }
    }
  }
}

function stopMedia() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  
  isAudioEnabled = false;
  isVideoEnabled = false;
  updateMediaButton('audio', false);
  updateMediaButton('video', false);
  hideLocalVideo();
  removeAllRemoteVideos();
  
  if (currentRoomId && currentRoomId !== 'public') {
    db.ref(`rooms/${currentRoomId}/media/${getClientId()}`).remove();
  }
}

function updateMediaButton(type, enabled) {
  const btn = document.getElementById(type === 'audio' ? 'audioBtn' : 'videoBtn');
  if (btn) {
    btn.textContent = type === 'audio' 
      ? (enabled ? '🎤 Mute' : '🎤 Audio')
      : (enabled ? '📹 Stop Video' : '📹 Video');
    btn.style.background = enabled ? 'hsl(142, 76%, 45%)' : 'hsl(217, 20%, 24%)';
  }
}

function getClientId() {
  let clientId = localStorage.getItem('webrtc_client_id');
  if (!clientId) {
    clientId = 'client_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('webrtc_client_id', clientId);
  }
  return clientId;
}

function announceMediaPresence() {
  if (currentRoomId === 'public' || !localStream) return;
  
  db.ref(`rooms/${currentRoomId}/media/${getClientId()}`).set({
    timestamp: Date.now(),
    hasAudio: isAudioEnabled,
    hasVideo: isVideoEnabled
  });
}

function setupMediaListeners() {
  if (currentRoomId === 'public') return;
  
  const mediaRef = db.ref(`rooms/${currentRoomId}/media`);
  
  mediaRef.on('child_added', snapshot => {
    const clientId = snapshot.key;
    if (clientId !== getClientId() && localStream) {
      createPeerConnection(clientId, true);
    }
  });
  
  mediaRef.on('child_removed', snapshot => {
    const clientId = snapshot.key;
    if (peerConnections[clientId]) {
      peerConnections[clientId].close();
      delete peerConnections[clientId];
      removeRemoteVideo(clientId);
    }
  });
  
  const signalingRef = db.ref(`rooms/${currentRoomId}/signaling/${getClientId()}`);
  signalingRef.on('child_added', snapshot => {
    const data = snapshot.val();
    handleSignalingData(data);
    snapshot.ref.remove();
  });
}

async function createPeerConnection(remoteClientId, isInitiator) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[remoteClientId] = pc;
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  pc.ontrack = event => {
    if (event.streams && event.streams[0]) {
      showRemoteVideo(remoteClientId, event.streams[0]);
    }
  };
  
  pc.onicecandidate = event => {
    if (event.candidate) {
      db.ref(`rooms/${currentRoomId}/signaling/${remoteClientId}`).push({
        from: getClientId(),
        candidate: event.candidate.toJSON()
      });
    }
  };
  
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    db.ref(`rooms/${currentRoomId}/signaling/${remoteClientId}`).push({
      from: getClientId(),
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    });
  }
  
  return pc;
}

async function handleSignalingData(data) {
  const { from, offer, answer, candidate } = data;
  
  if (!peerConnections[from] && (offer || answer)) {
    await createPeerConnection(from, false);
  }
  
  const pc = peerConnections[from];
  if (!pc) return;
  
  if (offer) {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    db.ref(`rooms/${currentRoomId}/signaling/${from}`).push({
      from: getClientId(),
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    });
  } else if (answer) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } else if (candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function showLocalVideo() {
  let container = document.getElementById('localVideoContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'localVideoContainer';
    container.style.cssText = `
      position: fixed;
      bottom: 100px;
      right: 20px;
      width: 240px;
      background: hsl(217, 25%, 16%);
      border: 2px solid hsl(217, 22%, 20%);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0px 10px 30px -4px hsl(0 0% 0% / 0.5);
      z-index: 900;
    `;
    document.body.appendChild(container);
  }
  
  let video = document.getElementById('localVideo');
  if (!video) {
    video = document.createElement('video');
    video.id = 'localVideo';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = 'width: 100%; display: block;';
    container.appendChild(video);
    
    const label = document.createElement('div');
    label.textContent = 'You';
    label.style.cssText = `
      position: absolute;
      bottom: 8px;
      left: 8px;
      background: hsl(0 0% 0% / 0.7);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    `;
    container.appendChild(label);
  }
  
  video.srcObject = localStream;
}

function hideLocalVideo() {
  const container = document.getElementById('localVideoContainer');
  if (container) {
    container.remove();
  }
}

function showRemoteVideo(clientId, stream) {
  let container = document.getElementById(`remoteVideo_${clientId}`);
  if (!container) {
    const remoteContainer = getOrCreateRemoteContainer();
    container = document.createElement('div');
    container.id = `remoteVideo_${clientId}`;
    container.style.cssText = `
      position: relative;
      width: 240px;
      background: hsl(217, 25%, 16%);
      border: 2px solid hsl(217, 22%, 20%);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 12px;
    `;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width: 100%; display: block;';
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.textContent = 'Peer';
    label.style.cssText = `
      position: absolute;
      bottom: 8px;
      left: 8px;
      background: hsl(0 0% 0% / 0.7);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    `;
    
    container.appendChild(video);
    container.appendChild(label);
    remoteContainer.appendChild(container);
  }
}

function removeRemoteVideo(clientId) {
  const container = document.getElementById(`remoteVideo_${clientId}`);
  if (container) {
    container.remove();
  }
}

function removeAllRemoteVideos() {
  const remoteContainer = document.getElementById('remoteVideosContainer');
  if (remoteContainer) {
    remoteContainer.remove();
  }
}

function getOrCreateRemoteContainer() {
  let container = document.getElementById('remoteVideosContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'remoteVideosContainer';
    container.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 20px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
      z-index: 900;
    `;
    document.body.appendChild(container);
  }
  return container;
}

// ==================== Room History Management ====================
function saveRoomToHistory(roomId) {
  if (roomId === 'public') return;
  
  try {
    let history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
    history = history.filter(item => item.roomId !== roomId);
    history.unshift({
      roomId: roomId,
      timestamp: Date.now()
    });
    history = history.slice(0, 10);
    localStorage.setItem('roomHistory', JSON.stringify(history));
  } catch (err) {
    console.error('Error saving room to history:', err);
  }
}

function removeRoomFromHistory(roomId) {
  try {
    let history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
    history = history.filter(item => item.roomId !== roomId);
    localStorage.setItem('roomHistory', JSON.stringify(history));
  } catch (err) {
    console.error('Error removing room from history:', err);
  }
}

async function loadRoomHistory() {
  const historyContainer = document.getElementById('roomHistoryList');
  if (!historyContainer) return;
  
  try {
    const history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
    
    if (history.length === 0) {
      historyContainer.innerHTML = '<p style="color: hsl(217, 10%, 70%); font-size: 13px; padding: 8px;">No recent rooms</p>';
      return;
    }
    
    historyContainer.innerHTML = '';
    
    for (const item of history) {
      const roomId = item.roomId;
      const roomSnapshot = await db.ref(`rooms/${roomId}`).once('value');
      const roomData = roomSnapshot.val();
      const isDeleted = !roomData || roomData.deleted === true;
      
      const roomItem = document.createElement('div');
      roomItem.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px;
        margin-bottom: 8px;
        background: hsl(217, 20%, 20%);
        border: 1px solid hsl(217, 20%, 25%);
        border-radius: 8px;
        ${isDeleted ? 'opacity: 0.5;' : ''}
      `;
      
      const roomInfo = document.createElement('div');
      roomInfo.style.cssText = 'flex: 1;';
      
      const roomIdText = document.createElement('div');
      roomIdText.textContent = roomId;
      roomIdText.style.cssText = `
        color: ${isDeleted ? 'hsl(0, 60%, 50%)' : 'hsl(220, 90%, 56%)'};
        font-weight: 600;
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        margin-bottom: 4px;
      `;
      
      const statusText = document.createElement('div');
      statusText.style.cssText = 'color: hsl(217, 10%, 70%); font-size: 12px;';
      
      if (isDeleted) {
        statusText.textContent = '🔒 Room Deleted';
      } else {
        const timeAgo = getTimeAgo(item.timestamp);
        statusText.textContent = `Last visited ${timeAgo}`;
      }
      
      roomInfo.appendChild(roomIdText);
      roomInfo.appendChild(statusText);
      
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 6px;';
      
      if (isDeleted) {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.style.cssText = `
          padding: 6px 14px;
          background: hsl(0, 84%, 48%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        `;
        removeBtn.onclick = () => {
          removeRoomFromHistory(roomId);
          loadRoomHistory();
        };
        btnContainer.appendChild(removeBtn);
      } else {
        const joinBtn = document.createElement('button');
        joinBtn.textContent = 'Join';
        joinBtn.style.cssText = `
          padding: 6px 14px;
          background: hsl(220, 90%, 56%);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        `;
        joinBtn.onclick = () => {
          joinRoom(roomId);
          roomDropdown.classList.remove('show');
        };
        btnContainer.appendChild(joinBtn);
      }
      
      roomItem.appendChild(roomInfo);
      roomItem.appendChild(btnContainer);
      historyContainer.appendChild(roomItem);
    }
  } catch (err) {
    console.error('Error loading room history:', err);
    historyContainer.innerHTML = '<p style="color: hsl(0, 60%, 50%); font-size: 13px; padding: 8px;">Error loading history</p>';
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

// ==================== Room Management ====================
let currentRoomId = null;
let currentPageId = 'page1';
let linesRef = null;
let textsRef = null;
let roomDeletedRef = null;
let roomClearedRef = null;
let isJoiningRoom = false;

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function joinRoom(roomId, password = null) {
  if (roomId !== 'public') {
    const roomRef = db.ref(`rooms/${roomId}`);
    const roomSnapshot = await roomRef.once('value');
    const roomData = roomSnapshot.val();
    
    if (!roomData || roomData.deleted === true) {
      alert('Room does not exist');
      joinRoom('public');
      return;
    }
    
    const passwordRef = db.ref(`rooms/${roomId}/password`);
    const passwordSnapshot = await passwordRef.once('value');
    const storedPassword = passwordSnapshot.val();

    if (storedPassword) {
      if (password === null) {
        const inputPassword = prompt('This room is password protected. Enter the passkey:');
        if (!inputPassword) {
          joinRoom('public');
          return;
        }
        password = inputPassword;
      }

      if (password !== storedPassword) {
        alert('Incorrect Passkey');
        joinRoom('public');
        return;
      }
    }
  }

  if (linesRef) linesRef.off();
  if (textsRef) textsRef.off();
  if (roomDeletedRef) roomDeletedRef.off();
  if (roomClearedRef) roomClearedRef.off();

  // Clean up media when switching rooms
  if (localStream) {
    stopMedia();
  }

  currentRoomId = roomId;
  currentPageId = 'page1';
  linesRef = db.ref(`rooms/${roomId}/pages/${currentPageId}/lines`);
  textsRef = db.ref(`rooms/${roomId}/pages/${currentPageId}/texts`);

  isJoiningRoom = true;
  linesCache.length = 0;
  textsCache.clear();
  drawAll();

  setupFirebaseListeners();
  setupRoomDeletionListener();
  setupRoomClearedListener();
  updateRoomIndicator();
  updatePageIndicator();

  window.location.hash = roomId;
  saveRoomToHistory(roomId);
  
  setTimeout(() => { isJoiningRoom = false; }, 1000);
}

function setupRoomDeletionListener() {
  if (currentRoomId === 'public') return;
  
  roomDeletedRef = db.ref(`rooms/${currentRoomId}/deleted`);
  roomDeletedRef.on('value', snapshot => {
    if (snapshot.val() === true) {
      alert('Sorry, this room has been deleted by the owner.');
      joinRoom('public');
    }
  });
}

function setupRoomClearedListener() {
  roomClearedRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/cleared`);
  roomClearedRef.on('value', snapshot => {
    if (!isJoiningRoom && snapshot.exists()) {
      linesCache.length = 0;
      textsCache.clear();
      drawAll();
    }
  });
}

async function updatePageIndicator() {
  const indicator = document.getElementById('pageIndicator');
  if (indicator && currentRoomId) {
    try {
      const pageSnapshot = await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/name`).once('value');
      const customName = pageSnapshot.val();
      
      if (customName) {
        indicator.textContent = customName;
      } else {
        const pageNum = currentPageId.replace('page', '');
        indicator.textContent = `Page ${pageNum}`;
      }
    } catch (err) {
      const pageNum = currentPageId.replace('page', '');
      indicator.textContent = `Page ${pageNum}`;
    }
  }
}

async function switchPage(pageId) {
  if (pageId === currentPageId) return;
  
  if (linesRef) linesRef.off();
  if (textsRef) textsRef.off();
  if (roomClearedRef) roomClearedRef.off();
  
  currentPageId = pageId;
  linesRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/lines`);
  textsRef = db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/texts`);
  
  isJoiningRoom = true;
  linesCache.length = 0;
  textsCache.clear();
  drawAll();
  
  setupFirebaseListeners();
  setupRoomClearedListener();
  updatePageIndicator();
  
  setTimeout(() => { isJoiningRoom = false; }, 1000);
}

function updateRoomIndicator() {
  const indicator = document.getElementById('roomIndicator');
  const menuBtn = document.getElementById('roomMenuBtn');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const deleteBtn = document.getElementById('deleteRoomBtn');
  const copyBtn = document.getElementById('copyRoomBtn');
  const pageMenuBtn = document.getElementById('pageMenuBtn');
  
  // Create audio/video buttons if they don't exist
  let audioBtn = document.getElementById('audioBtn');
  let videoBtn = document.getElementById('videoBtn');
  
  if (!audioBtn) {
    const toolbar = document.getElementById('toolbar');
    audioBtn = document.createElement('button');
    audioBtn.id = 'audioBtn';
    audioBtn.className = 'secondary';
    audioBtn.textContent = '🎤 Audio';
    audioBtn.onclick = toggleAudio;
    toolbar.appendChild(audioBtn);
  }
  
  if (!videoBtn) {
    const toolbar = document.getElementById('toolbar');
    videoBtn = document.createElement('button');
    videoBtn.id = 'videoBtn';
    videoBtn.className = 'secondary';
    videoBtn.textContent = '📹 Video';
    videoBtn.onclick = toggleVideo;
    toolbar.appendChild(videoBtn);
  }

  if (indicator && currentRoomId) {
    if (currentRoomId === 'public') {
      indicator.textContent = 'Public Canvas';
      menuBtn?.classList.add('public');
      if (roomCodeDisplay) {
        roomCodeDisplay.textContent = 'You are on the public canvas';
        roomCodeDisplay.style.fontFamily = 'Inter, system-ui, sans-serif';
      }
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (copyBtn) copyBtn.style.display = 'none';
      if (pageMenuBtn) pageMenuBtn.style.display = 'none';
      if (audioBtn) audioBtn.style.display = 'none';
      if (videoBtn) videoBtn.style.display = 'none';
    } else {
      indicator.textContent = currentRoomId;
      menuBtn?.classList.remove('public');
      if (roomCodeDisplay) {
        roomCodeDisplay.textContent = currentRoomId;
        roomCodeDisplay.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
      }
      if (deleteBtn) deleteBtn.style.display = 'block';
      if (copyBtn) copyBtn.style.display = 'block';
      if (pageMenuBtn) pageMenuBtn.style.display = 'block';
      if (audioBtn) audioBtn.style.display = 'inline-block';
      if (videoBtn) videoBtn.style.display = 'inline-block';
    }
  }
}

function setupFirebaseListeners() {
  const lineKeys = new Map();
  
  linesRef.on('child_added', snapshot => {
    const line = snapshot.val();
    const key = snapshot.key;
    const index = linesCache.length;
    linesCache.push(line);
    lineKeys.set(key, index);
    
    line.points.forEach(p => {
      ctx.beginPath();
    ctx.arc(xi, yi, width / 2, 0, Math.PI * 2);
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
    }
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return points;
}

// ==================== Pointer Handling & Text Dragging ====================
function startDrawing(x, y) { drawing = true; current.x = x; current.y = y; }
function stopDrawing() { drawing = false; }

function textAtPoint(x, y) {
  let found = null;
  textsCache.forEach((t, key) => {
    const size = t.size || 40;
    const font = t.font || 'sans-serif';
    const content = t.text || '';
    if (!content) return;
    ctx.font = `${size}px ${font}`;
    ctx.textBaseline = 'top';
    const w = ctx.measureText(content).width;
    const h = size;
    if (x >= t.x && x <= t.x + w && y >= t.y && y <= t.y + h) {
      found = { key, t };
    }
  });
  return found;
}

let draggingTextKey = null;
let dragOffset = { x: 0, y: 0 };
let dragRAFQueued = false;
let latestDragPos = null;

function scheduleDragUpdate() {
  if (dragRAFQueued) return;
  dragRAFQueued = true;
  requestAnimationFrame(() => {
    dragRAFQueued = false;
    if (!draggingTextKey || !latestDragPos) return;
    const { x, y } = latestDragPos;
    const local = textsCache.get(draggingTextKey);
    if (local) { local.x = x; local.y = y; }
    drawAll();
    textsRef.child(draggingTextKey).update({ x, y });
  });
}

function handlePointerDown(x, y) {
  const hit = textAtPoint(x, y);
  if (hit) {
    draggingTextKey = hit.key;
    dragOffset.x = x - hit.t.x;
    dragOffset.y = y - hit.t.y;
    return;
  }
  startDrawing(x, y);
}

function drawMove(x, y) {
  if (draggingTextKey) {
    latestDragPos = { x: x - dragOffset.x, y: y - dragOffset.y };
    scheduleDragUpdate();
    return;
  }
  if (!drawing) return;
  const points = drawLineSmooth(current.x, current.y, x, y, brushColor, brushSize, eraserActive);
  if (eraserActive && points && points.length) {
    const removed = new Set();
    points.forEach(p => {
      const hit = textAtPoint(p.x, p.y);
      if (hit && !removed.has(hit.key)) {
        removed.add(hit.key);
        textsRef.child(hit.key).remove();
      }
    });
  }
  linesRef.push({ points, color: brushColor, width: brushSize, erase: eraserActive, timestamp: Date.now() });
  current.x = x;
  current.y = y;
}

function handlePointerUp() {
  drawing = false;
  draggingTextKey = null;
  latestDragPos = null;
  dragRAFQueued = false;
}

canvas.addEventListener('mousedown', e => handlePointerDown(e.clientX, e.clientY));
canvas.addEventListener('mouseup', () => handlePointerUp());
canvas.addEventListener('mouseout', () => handlePointerUp());
canvas.addEventListener('mousemove', e => drawMove(e.clientX, e.clientY));

canvas.addEventListener('touchstart', e => { 
  e.preventDefault(); 
  const t = e.touches[0]; 
  handlePointerDown(t.clientX, t.clientY); 
});
canvas.addEventListener('touchend', e => { 
  e.preventDefault(); 
  handlePointerUp(); 
});
canvas.addEventListener('touchmove', e => { 
  e.preventDefault(); 
  const t = e.touches[0]; 
  drawMove(t.clientX, t.clientY); 
});

// ==================== UI Controls ====================
const colorPicker = document.getElementById('colorPicker');
const sizePicker = document.getElementById('sizePicker');
if (sizePicker) {
  sizePicker.max = '200';
  sizePicker.setAttribute('max', '200');
}
const eraserBtn = document.getElementById('eraserBtn');
const clearBtn = document.getElementById('clearBtn');
const freeTextInput = document.getElementById('freeTextInput');

let textSizePicker = document.getElementById('textSizePicker');
let textFontPicker = document.getElementById('textFontPicker');
if (!textFontPicker) {
  const toolbarEl = document.getElementById('toolbar') || document.body;
  textFontPicker = document.createElement('select');
  textFontPicker.id = 'textFontPicker';
  textFontPicker.title = 'Text font';
  textFontPicker.style.padding = '8px 12px';
  textFontPicker.style.background = 'hsl(217, 20%, 20%)';
  textFontPicker.style.border = '1px solid hsl(217, 20%, 35%)';
  textFontPicker.style.borderRadius = '8px';
  textFontPicker.style.color = 'hsl(217, 10%, 92%)';
  textFontPicker.style.fontSize = '16px';
  textFontPicker.style.cursor = 'pointer';
  textFontPicker.style.minWidth = '140px';
  
  const fonts = [
    { name: 'Sans Serif', value: 'sans-serif' },
    { name: 'Serif', value: 'serif' },
    { name: 'Monospace', value: 'monospace' },
    { name: 'Arial', value: 'Arial, sans-serif' },
    { name: 'Times New Roman', value: '"Times New Roman", serif' },
    { name: 'Courier New', value: '"Courier New", monospace' },
    { name: 'Brush Script', value: '"Brush Script MT", cursive' }
  ];
  
  fonts.forEach(font => {
    const option = document.createElement('option');
    option.value = font.value;
    option.textContent = font.name;
    option.style.fontFamily = font.value;
    option.style.fontSize = '16px';
    textFontPicker.appendChild(option);
  });
  
  if (toolbarEl && freeTextInput && freeTextInput.parentElement === toolbarEl) {
    toolbarEl.insertBefore(textFontPicker, freeTextInput);
  } else if (toolbarEl) {
    toolbarEl.appendChild(textFontPicker);
  } else {
    document.body.appendChild(textFontPicker);
  }
}

const getTextSize = () => {
  const n = parseInt(textSizePicker.value, 10);
  if (Number.isNaN(n)) return 40;
  return Math.max(10, Math.min(200, n));
};

const getTextFont = () => {
  return textFontPicker.value || 'sans-serif';
};

colorPicker.addEventListener('change', e => {
  brushColor = e.target.value;
  eraserActive = false;
  eraserBtn.style.backgroundColor = '';
});

const updateBrushSize = (raw) => {
  const val = parseInt(raw, 10);
  if (!Number.isNaN(val)) {
    brushSize = Math.max(1, Math.min(200, val));
  }
};
sizePicker.addEventListener('input', e => updateBrushSize(e.target.value));
sizePicker.addEventListener('change', e => updateBrushSize(e.target.value));

eraserBtn.addEventListener('click', () => {
  eraserActive = !eraserActive;
  eraserBtn.style.backgroundColor = eraserActive ? 'orange' : '';
});

function findEmptySpace(textWidth, textHeight) {
  const padding = 20;
  const step = 50;
  const maxAttempts = 100;
  
  const toolbar = document.getElementById('toolbar');
  const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;
  const toolbarPadding = 20;
  
  function overlapsWithToolbar(x, y, w, h) {
    if (!toolbarRect) return false;
    return !(x > toolbarRect.right + toolbarPadding || 
             x + w < toolbarRect.left - toolbarPadding || 
             y > toolbarRect.bottom + toolbarPadding || 
             y + h < toolbarRect.top - toolbarPadding);
  }
  
  function overlapsWithText(x, y, w, h) {
    let hasOverlap = false;
    textsCache.forEach(t => {
      const tSize = t.size || 40;
      const tFont = t.font || 'sans-serif';
      const tContent = t.text || '';
      if (!tContent) return;
      
      ctx.font = `${tSize}px ${tFont}`;
      const tWidth = ctx.measureText(tContent).width;
      const tHeight = tSize;
      
      if (!(x + w + padding < t.x || 
            x > t.x + tWidth + padding || 
            y + h + padding < t.y || 
            y > t.y + tHeight + padding)) {
        hasOverlap = true;
      }
    });
    return hasOverlap;
  }
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const gridX = (attempt % 10) * step + 50;
    const gridY = Math.floor(attempt / 10) * step + 50;
    
    if (gridX + textWidth + padding > canvas.width || 
        gridY + textHeight + padding > canvas.height) {
      continue;
    }
    
    if (!overlapsWithToolbar(gridX, gridY, textWidth, textHeight) &&
        !overlapsWithText(gridX, gridY, textWidth, textHeight)) {
      return { x: gridX, y: gridY };
    }
  }
  
  let randomX, randomY;
  for (let i = 0; i < 20; i++) {
    randomX = Math.random() * (canvas.width - textWidth - 100) + 50;
    randomY = Math.random() * (canvas.height - textHeight - 100) + 50;
    
    if (!overlapsWithToolbar(randomX, randomY, textWidth, textHeight)) {
      return { x: randomX, y: randomY };
    }
  }
  
  return {
    x: canvas.width - textWidth - 100,
    y: canvas.height / 2
  };
}

function addTextToCanvas() {
  const content = (freeTextInput.value || '').trim();
  if (!content || !currentRoomId) return;
  const size = getTextSize();
  const font = getTextFont();
  
  ctx.font = `${size}px ${font}`;
  const textWidth = ctx.measureText(content).width;
  const textHeight = size;
  
  const margin = 50;
  const maxWidth = canvas.width - (margin * 2);
  const maxHeight = canvas.height - (margin * 2);
  
  if (textWidth > maxWidth || textHeight > maxHeight) {
    let maxFontSize = size;
    
    if (textWidth > maxWidth) {
      maxFontSize = Math.floor((maxWidth / textWidth) * size);
    }
    
    if (textHeight > maxHeight && maxFontSize > maxHeight) {
      maxFontSize = Math.min(maxFontSize, maxHeight);
    }
    
    alert(`Error: Text is too large to fit on the canvas!\n\nCurrent font size: ${size}px\nMaximum font size that would fit: ${maxFontSize}px\n\nPlease reduce the text size and try again.`);
    return;
  }
  
  const { x, y } = findEmptySpace(textWidth, textHeight);
  
  if (x + textWidth > canvas.width || y + textHeight > canvas.height) {
    alert(`Error: Cannot find space on canvas for text of this size.\n\nCurrent font size: ${size}px\nTry reducing the text size or clearing some existing text.`);
    return;
  }
  
  textsRef.push({ x, y, text: content, size, color: brushColor, font, timestamp: Date.now() });
  freeTextInput.value = '';
}

freeTextInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTextToCanvas();
  }
});

// ==================== Room UI ====================
const roomDropdown = document.getElementById('roomDropdown');
const roomMenuBtn = document.getElementById('roomMenuBtn');

roomMenuBtn?.addEventListener('click', () => {
  roomDropdown.classList.toggle('show');
  if (roomDropdown.classList.contains('show')) {
    loadRoomHistory();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.room-menu-container')) {
    roomDropdown?.classList.remove('show');
  }
});

document.getElementById('createRoomBtn')?.addEventListener('click', async () => {
  const roomId = generateRoomCode();
  const password = prompt('Set a passkey for this room (optional - leave blank for no password):');

  if (password && password.trim()) {
    await db.ref(`rooms/${roomId}/password`).set(password.trim());
  } else {
    await db.ref(`rooms/${roomId}/created`).set(true);
  }

  joinRoom(roomId);
  roomDropdown.classList.remove('show');
});

document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
  const roomId = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (roomId) {
    joinRoom(roomId);
    roomDropdown.classList.remove('show');
  }
});

document.getElementById('goPublicBtn')?.addEventListener('click', () => {
  joinRoom('public');
  roomDropdown.classList.remove('show');
});

document.getElementById('copyRoomBtn')?.addEventListener('click', () => {
  if (currentRoomId && currentRoomId !== 'public') {
    navigator.clipboard.writeText(currentRoomId);
    const btn = document.getElementById('copyRoomBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = originalText, 1500);
  }
});

document.getElementById('deleteRoomBtn')?.addEventListener('click', async () => {
  if (currentRoomId && currentRoomId !== 'public') {
    const confirmDelete = confirm(`Are you sure you want to delete room ${currentRoomId}? This will kick all users from the room.`);
    if (confirmDelete) {
      if (roomDeletedRef) roomDeletedRef.off();
      await db.ref(`rooms/${currentRoomId}/deleted`).set(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      await db.ref(`rooms/${currentRoomId}`).remove();
      joinRoom('public');
      roomDropdown.classList.remove('show');
    }
  }
});

// ==================== Page Management ====================
const pageDropdown = document.getElementById('pageDropdown');
const pageMenuBtn = document.getElementById('pageMenuBtn');

pageMenuBtn?.addEventListener('click', () => {
  if (currentRoomId === 'public') return;
  pageDropdown.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.page-menu-container')) {
    pageDropdown?.classList.remove('show');
  }
});

async function loadPagesList() {
  const pageListEl = document.getElementById('pagesList');
  if (!pageListEl || !currentRoomId) return;
  
  try {
    const pagesSnapshot = await db.ref(`rooms/${currentRoomId}/pages`).once('value');
    const pages = pagesSnapshot.val();
    
    pageListEl.innerHTML = '';
    
    if (!pages) {
      const pageBtn = createPageButton('page1', 1, 'Page 1', true);
      pageListEl.appendChild(pageBtn);
      return;
    }
    
    const pageIds = Object.keys(pages).sort((a, b) => {
      const numA = parseInt(a.replace('page', ''));
      const numB = parseInt(b.replace('page', ''));
      return numA - numB;
    });
    
    pageIds.forEach(pageId => {
      const pageNum = parseInt(pageId.replace('page', ''));
      const isActive = pageId === currentPageId;
      const pageName = pages[pageId].name || `Page ${pageNum}`;
      const pageBtn = createPageButton(pageId, pageNum, pageName, isActive);
      pageListEl.appendChild(pageBtn);
    });
  } catch (err) {
    console.error('Error loading pages:', err);
  }
}

function createPageButton(pageId, pageNum, pageName, isActive) {
  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    position: relative;
  `;
  
  const buttonGroup = document.createElement('div');
  buttonGroup.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;
  
  const renameBtn = document.createElement('button');
  renameBtn.textContent = '✏️';
  renameBtn.title = 'Rename page';
  renameBtn.style.cssText = `
    padding: 4px;
    background: hsl(220, 90%, 56%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  renameBtn.onclick = async (e) => {
    e.stopPropagation();
    const newName = prompt(`Enter new name for this page:`, pageName);
    if (newName && newName.trim()) {
      try {
        await db.ref(`rooms/${currentRoomId}/pages/${pageId}/name`).set(newName.trim());
        loadPagesList();
        if (pageId === currentPageId) {
          updatePageIndicator();
        }
      } catch (err) {
        console.error('Error renaming page:', err);
        alert('Failed to rename page. Please try again.');
      }
    }
  };
  
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Delete page';
  deleteBtn.style.cssText = `
    padding: 4px;
    background: hsl(0, 84%, 48%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    
    try {
      const pagesSnapshot = await db.ref(`rooms/${currentRoomId}/pages`).once('value');
      const pages = pagesSnapshot.val();
      const pageCount = pages ? Object.keys(pages).length : 0;
      
      if (pageCount <= 1) {
        alert('Sorry, you must have at least one page.');
        return;
      }
    } catch (err) {
      console.error('Error checking page count:', err);
    }
    
    if (confirm(`Are you sure you want to delete "${pageName}"? This will remove all content on this page.`)) {
      try {
        if (pageId === currentPageId) {
          await switchPage('page1');
        }
        
        await db.ref(`rooms/${currentRoomId}/pages/${pageId}`).remove();
        loadPagesList();
      } catch (err) {
        console.error('Error deleting page:', err);
        alert('Failed to delete page. Please try again.');
      }
    }
  };
  
  buttonGroup.appendChild(renameBtn);
  buttonGroup.appendChild(deleteBtn);
  
  const btn = document.createElement('button');
  btn.textContent = pageName;
  btn.className = isActive ? 'page-btn active' : 'page-btn';
  btn.style.flex = '1';
  btn.onclick = () => {
    switchPage(pageId);
    pageDropdown.classList.remove('show');
    loadPagesList();
  };
  
  container.appendChild(buttonGroup);
  container.appendChild(btn);
  
  return container;
}

document.getElementById('createPageBtn')?.addEventListener('click', async () => {
  try {
    const pagesSnapshot = await db.ref(`rooms/${currentRoomId}/pages`).once('value');
    const pages = pagesSnapshot.val();
    
    let maxPageNum = 1;
    if (pages) {
      Object.keys(pages).forEach(pageId => {
        const num = parseInt(pageId.replace('page', ''));
        if (num > maxPageNum) maxPageNum = num;
      });
    }
    
    const newPageNum = maxPageNum + 1;
    const newPageId = `page${newPageNum}`;
    
    await db.ref(`rooms/${currentRoomId}/pages/${newPageId}/created`).set(true);
    
    switchPage(newPageId);
    pageDropdown.classList.remove('show');
    loadPagesList();
  } catch (err) {
    console.error('Error creating page:', err);
    alert('Failed to create new page. Please try again.');
  }
});

pageMenuBtn?.addEventListener('click', () => {
  if (currentRoomId !== 'public' && pageDropdown.classList.contains('show')) {
    loadPagesList();
  }
});

// ==================== Admin ====================
(function setupAdmin() {
  const adminKey = "cooper";
  const isAdmin = prompt("Enter admin key to see admin tools (or cancel):") === adminKey;
  if (isAdmin) {
    clearBtn.style.display = 'inline-block';
    clearBtn.addEventListener('click', async () => {
      if (!currentRoomId) return;
      if (!confirm('Clear entire canvas? This will remove all drawings and text for everyone.')) return;
      try {
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/cleared`).set(Date.now());
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/lines`).remove();
        await db.ref(`rooms/${currentRoomId}/pages/${currentPageId}/texts`).remove();
        linesCache.length = 0;
        textsCache.clear();
        drawAll();
      } catch (err) {
        console.error('Failed to clear canvas data:', err);
        alert('Failed to clear canvas. Please try again.');
      }
    });
    
    const adminRoomBtn = document.createElement('button');
    adminRoomBtn.textContent = 'Manage Rooms';
    adminRoomBtn.className = 'secondary';
    adminRoomBtn.style.display = 'inline-block';
    document.getElementById('toolbar').appendChild(adminRoomBtn);
    
    const adminPanel = document.createElement('div');
    adminPanel.id = 'adminPanel';
    adminPanel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: hsl(217, 25%, 16%);
      border: 1px solid hsl(217, 22%, 20%);
      border-radius: 12px;
      padding: 20px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0px 30px 60px -12px hsl(0 0% 0% / 0.60);
      z-index: 2000;
      display: none;
    `;
    
    const panelTitle = document.createElement('h2');
    panelTitle.textContent = 'Admin: Room Management';
    panelTitle.style.cssText = 'margin-bottom: 16px; color: hsl(217, 10%, 92%); font-size: 18px;';
    adminPanel.appendChild(panelTitle);
    
    const roomList = document.createElement('div');
    roomList.id = 'adminRoomList';
    adminPanel.appendChild(roomList);
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      margin-top: 16px;
      padding: 8px 16px;
      background: hsl(217, 20%, 24%);
      color: hsl(217, 10%, 88%);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      width: 100%;
    `;
    closeBtn.onclick = () => { adminPanel.style.display = 'none'; };
    adminPanel.appendChild(closeBtn);
    
    document.body.appendChild(adminPanel);
    
    adminRoomBtn.addEventListener('click', async () => {
      adminPanel.style.display = 'block';
      roomList.innerHTML = '<p style="color: hsl(217, 10%, 80%);">Loading rooms...</p>';
      
      try {
        const roomsSnapshot = await db.ref('rooms').once('value');
        const rooms = roomsSnapshot.val();
        
        if (!rooms) {
          roomList.innerHTML = '<p style="color: hsl(217, 10%, 80%);">No private rooms found.</p>';
          return;
        }
        
        roomList.innerHTML = '';
        
        Object.keys(rooms).forEach(roomId => {
          if (roomId === 'public') return;
          
          const roomData = rooms[roomId];
          const password = roomData.password || 'None';
          
          let lastActivity = 'Unknown';
          let lastTimestamp = 0;
          
          if (roomData.pages) {
            Object.values(roomData.pages).forEach(page => {
              if (page.lines) {
                Object.values(page.lines).forEach(line => {
                  if (line.timestamp && line.timestamp > lastTimestamp) {
                    lastTimestamp = line.timestamp;
                  }
                });
              }
              if (page.texts) {
                Object.values(page.texts).forEach(text => {
                  if (text.timestamp && text.timestamp > lastTimestamp) {
                    lastTimestamp = text.timestamp;
                  }
                });
              }
            });
          }
          
          if (roomData.lines) {
            Object.values(roomData.lines).forEach(line => {
              if (line.timestamp && line.timestamp > lastTimestamp) {
                lastTimestamp = line.timestamp;
              }
            });
          }
          if (roomData.texts) {
            Object.values(roomData.texts).forEach(text => {
              if (text.timestamp && text.timestamp > lastTimestamp) {
                lastTimestamp = text.timestamp;
              }
            });
          }
          
          if (lastTimestamp > 0) {
            const date = new Date(lastTimestamp);
            lastActivity = date.toLocaleString();
          }
          
          let lineCount = 0;
          let textCount = 0;
          
          if (roomData.pages) {
            Object.values(roomData.pages).forEach(page => {
              if (page.lines) lineCount += Object.keys(page.lines).length;
              if (page.texts) textCount += Object.keys(page.texts).length;
            });
          }
          
          if (roomData.lines) lineCount += Object.keys(roomData.lines).length;
          if (roomData.texts) textCount += Object.keys(roomData.texts).length;
          
          const roomCard = document.createElement('div');
          roomCard.style.cssText = `
            background: hsl(217, 20%, 20%);
            border: 1px solid hsl(217, 20%, 25%);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
          `;
          
          roomCard.innerHTML = `
            <div style="color: hsl(220, 90%, 56%); font-weight: 600; font-family: 'JetBrains Mono', monospace; margin-bottom: 8px;">
              ${roomId}
            </div>
            <div style="color: hsl(217, 10%, 80%); font-size: 13px; margin-bottom: 8px;">
              <div>Password: ${password}</div>
              <div>Lines: ${lineCount} | Texts: ${textCount}</div>
              <div>Last Activity: ${lastActivity}</div>
            </div>
          `;
          
          const btnContainer = document.createElement('div');
          btnContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';
          
          const previewBtn = document.createElement('button');
          previewBtn.textContent = 'Preview';
          previewBtn.style.cssText = `
            padding: 6px 12px;
            background: hsl(220, 90%, 56%);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            flex: 1;
          `;
          previewBtn.onclick = () => {
            window.open(`#${roomId}`, '_blank');
          };
          
          const deleteBtn = document.createElement('button');
          deleteBtn.textContent = 'Delete';
          deleteBtn.style.cssText = `
            padding: 6px 12px;
            background: hsl(0, 84%, 48%);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            flex: 1;
          `;
          deleteBtn.onclick = async () => {
            if (confirm(`Delete room ${roomId}? This will kick all users.`)) {
              await db.ref(`rooms/${roomId}/deleted`).set(true);
              await new Promise(resolve => setTimeout(resolve, 500));
              await db.ref(`rooms/${roomId}`).remove();
              adminRoomBtn.click();
            }
          };
          
          btnContainer.appendChild(previewBtn);
          btnContainer.appendChild(deleteBtn);
          roomCard.appendChild(btnContainer);
          roomList.appendChild(roomCard);
        });
      } catch (err) {
        console.error('Error loading rooms:', err);
        roomList.innerHTML = '<p style="color: hsl(0, 84%, 48%);">Error loading rooms.</p>';
      }
    });
  }
})();

// ==================== Initialize ====================
window.addEventListener('load', () => {
  const hashRoom = window.location.hash.substring(1);
  if (hashRoom) {
    joinRoom(hashRoom);
  } else {
    joinRoom('public');
  }
});
      ctx.arc(p.x, p.y, line.width / 2, 0, Math.PI * 2);
      if (line.erase) { 
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.fillStyle = 'rgba(0,0,0,1)'; 
      } else { 
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.fillStyle = line.color; 
      }
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  });

  linesRef.on('value', snapshot => {
    if (!isJoiningRoom && !snapshot.exists() && linesCache.length > 0) {
      linesCache.length = 0;
      lineKeys.clear();
      drawAll();
    }
  });

  textsRef.on('child_added', snapshot => {
    const key = snapshot.key;
    const val = snapshot.val();
    textsCache.set(key, val);
    drawAll();
  });

  textsRef.on('child_changed', snapshot => {
    const key = snapshot.key;
    const val = snapshot.val();
    textsCache.set(key, val);
    drawAll();
  });

  textsRef.on('child_removed', snapshot => {
    const key = snapshot.key;
    textsCache.delete(key);
    drawAll();
  });

  textsRef.on('value', snapshot => {
    if (!isJoiningRoom && !snapshot.exists() && textsCache.size > 0) {
      textsCache.clear();
      drawAll();
    }
  });
}

// ==================== Canvas Setup ====================
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const linesCache = [];
const textsCache = new Map();

function drawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  linesCache.forEach(line => {
    const { points, color, width, erase } = line;
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, width/2, 0, Math.PI*2);
      if (erase) { 
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.fillStyle = 'rgba(0,0,0,1)'; 
      } else { 
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.fillStyle = color; 
      }
      ctx.fill();
    });
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.textBaseline = 'top';
  textsCache.forEach(obj => {
    const size = obj.size || 40;
    const color = obj.color || '#000';
    const font = obj.font || 'sans-serif';
    const content = obj.text || '';
    if (!content) return;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(content, obj.x, obj.y);
  });
}

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drawAll();
});

// ==================== Drawing State ====================
let brushColor = "#000000";
let brushSize = 4;
let drawing = false;
let current = { x: 0, y: 0 };
let eraserActive = false;

function drawLineSmooth(x0, y0, x1, y1, color = brushColor, width = brushSize, erase = false) {
  const points = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.sqrt(dx*dx + dy*dy);
  const steps = Math.ceil(distance / 2);

  for (let i = 0; i <= steps; i++) {
    const xi = x0 + (dx * i) / steps;
    const yi = y0 + (dy * i) / steps;
    points.push({ x: xi, y: yi });
    ctx.beginPath();
