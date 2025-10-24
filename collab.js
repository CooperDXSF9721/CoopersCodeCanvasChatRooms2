// ==================== Firebase Config ====================
const firebaseConfig = {
  apiKey: "AIzaSyBUfT7u7tthl3Nm-ePsY7XWrdLK7YNoLVQ",
  authDomain: "cooperscodeart.firebaseapp.com",
  projectId: "cooperscodeart",
  storageBucket: "cooperscodeart.firebasestorage.app",
  messagingSenderId: "632091879350",
  appId: "1:632091879350:web:8c4e8f4f4f4f4f4f4f4f4f"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ==================== Global Variables ====================
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const sizePicker = document.getElementById('sizePicker');
const eraserBtn = document.getElementById('eraserBtn');
const clearBtn = document.getElementById('clearBtn');
const roomMenuBtn = document.getElementById('roomMenuBtn');
const roomDropdown = document.getElementById('roomDropdown');
const pageMenuBtn = document.getElementById('pageMenuBtn');
const pageDropdown = document.getElementById('pageDropdown');
const freeTextInput = document.getElementById('freeTextInput');
const textSizePicker = document.getElementById('textSizePicker');
const eyedropperBtn = document.getElementById('eyedropperBtn');

let drawing = false;
let isEraser = false;
let currentRoomId = 'public';
let currentPage = 1;
let userName = '';
let sessionId = '';
let roomDataRef = null;
let adminMode = false;
let localStream = null;
let mediaEnabled = false;
let peerConnections = new Map();
let remoteStreams = new Map();

const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ==================== Canvas Setup ====================
function resizeCanvas() {
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCtx.drawImage(canvas, 0, 0);

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  ctx.drawImage(tempCanvas, 0, 0);
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ==================== User Session ====================
function initializeUser() {
  sessionId = Math.random().toString(36).substring(2, 15);
  
  const storedName = localStorage.getItem('userName');
  if (storedName) {
    userName = storedName;
    joinRoom('public');
  } else {
    userName = prompt('Enter your name:') || 'Anonymous';
    localStorage.setItem('userName', userName);
    
    const adminPass = prompt('Enter admin password (or leave blank):');
    if (adminPass === 'cooperscode123') {
      adminMode = true;
      alert('Admin mode enabled!');
    }
    
    joinRoom('public');
  }
}

function changeUserName() {
  const newName = prompt('Enter new name:', userName);
  if (newName && newName.trim()) {
    userName = newName.trim();
    localStorage.setItem('userName', userName);
    
    if (currentRoomId !== 'public') {
      const userStatusRef = database.ref(`rooms/${currentRoomId}/users/${sessionId}`);
      userStatusRef.update({ name: userName });
    }
    
    alert('Name updated!');
  }
}

// ==================== Drawing Functions ====================
function startDrawing(e) {
  drawing = true;
  draw(e);
}

function stopDrawing() {
  if (!drawing) return;
  drawing = false;
  ctx.beginPath();
}

function draw(e) {
  if (!drawing) return;

  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
  const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

  ctx.lineWidth = sizePicker.value;
  ctx.lineCap = 'round';
  ctx.strokeStyle = isEraser ? '#ffffff' : colorPicker.value;

  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);

  if (roomDataRef) {
    roomDataRef.push({
      type: 'draw',
      x, y,
      color: isEraser ? '#ffffff' : colorPicker.value,
      size: sizePicker.value,
      user: userName,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  }
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startDrawing(e);
});
canvas.addEventListener('touchend', stopDrawing);
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  draw(e);
});

// ==================== Eyedropper ====================
let eyedropperMode = false;

eyedropperBtn.addEventListener('click', () => {
  eyedropperMode = !eyedropperMode;
  canvas.classList.toggle('eyedropper-mode', eyedropperMode);
  eyedropperBtn.textContent = eyedropperMode ? '✓ 🎨' : '🎨';
  eyedropperBtn.style.background = eyedropperMode ? 'hsl(142, 76%, 55%)' : '';
});

canvas.addEventListener('click', (e) => {
  if (!eyedropperMode) return;

  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

  const pixel = ctx.getImageData(x, y, 1, 1).data;
  const hexColor = '#' + [pixel[0], pixel[1], pixel[2]].map(c => 
    c.toString(16).padStart(2, '0')).join('');

  colorPicker.value = hexColor;
  eyedropperMode = false;
  canvas.classList.remove('eyedropper-mode');
  eyedropperBtn.textContent = '🎨';
  eyedropperBtn.style.background = '';
});

// ==================== Eraser ====================
eraserBtn.addEventListener('click', () => {
  isEraser = !isEraser;
  eraserBtn.textContent = isEraser ? '✓ Eraser' : 'Eraser';
  eraserBtn.style.background = isEraser ? 'hsl(142, 76%, 55%)' : '';
});

// ==================== Free Text ====================
freeTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && freeTextInput.value.trim()) {
    const text = freeTextInput.value.trim();
    const size = parseInt(textSizePicker.value);
    
    const rect = canvas.getBoundingClientRect();
    const x = rect.width / 2;
    const y = rect.height / 2;

    ctx.font = `${size}px Arial`;
    const textWidth = ctx.measureText(text).width;
    const textHeight = size;

    if (x + textWidth > canvas.width || y + textHeight > canvas.height) {
      alert(`Error: Cannot find space on canvas for text of this size.\n\nCurrent font size: ${size}px\nTry reducing the text size or clearing some existing text.`);
      return;
    }

    ctx.fillStyle = colorPicker.value;
    ctx.fillText(text, x, y);

    if (roomDataRef) {
      roomDataRef.push({
        type: 'text',
        text,
        x, y,
        color: colorPicker.value,
        size,
        user: userName,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    }

    freeTextInput.value = '';
  }
});

// ==================== Clear Canvas ====================
clearBtn.addEventListener('click', () => {
  if (confirm('Clear the entire canvas? This cannot be undone.')) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (roomDataRef) {
      roomDataRef.push({
        type: 'clear',
        user: userName,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    }
  }
});

// ==================== Room Management ====================
function joinRoom(roomId) {
  if (currentRoomId !== 'public' && currentRoomId !== roomId) {
    leaveCurrentRoom();
  }

  currentRoomId = roomId;
  currentPage = 1;
  
  updateRoomUI();
  loadRoomHistory();
  loadPages();
  
  if (roomId === 'public') {
    roomDataRef = database.ref('public/page1');
    clearBtn.style.display = 'none';
    
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('cameraContainer').style.display = 'none';
    
    cleanupCamera();
  } else {
    roomDataRef = database.ref(`rooms/${roomId}/pages/page${currentPage}`);
    
    if (adminMode) {
      clearBtn.style.display = 'block';
    }
    
    document.getElementById('chatContainer').style.display = 'block';
    document.getElementById('cameraContainer').style.display = 'block';
    
    addToRoomHistory(roomId);
    setupUserPresence(roomId);
    setupChat(roomId);
    setupCameraForRoom(roomId);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  loadCanvas();
  
  roomDataRef.on('child_added', (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.type === 'draw') {
      ctx.lineWidth = data.size;
      ctx.lineCap = 'round';
      ctx.strokeStyle = data.color;
      ctx.lineTo(data.x, data.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(data.x, data.y);
    } else if (data.type === 'text') {
      ctx.font = `${data.size}px Arial`;
      ctx.fillStyle = data.color;
      ctx.fillText(data.text, data.x, data.y);
    } else if (data.type === 'clear') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
}

function leaveCurrentRoom() {
  if (currentRoomId === 'public') return;
  
  const userStatusRef = database.ref(`rooms/${currentRoomId}/users/${sessionId}`);
  userStatusRef.remove();
  
  cleanupCamera();
  cleanupChat();
}

function updateRoomUI() {
  const indicator = document.getElementById('roomIndicator');
  const codeDisplay = document.getElementById('roomCodeDisplay');
  const copyBtn = document.getElementById('copyRoomBtn');
  const deleteBtn = document.getElementById('deleteRoomBtn');
  const goPublicBtn = document.getElementById('goPublicBtn');
  
  if (currentRoomId === 'public') {
    indicator.textContent = 'Public Canvas';
    codeDisplay.textContent = 'PUBLIC';
    roomMenuBtn.classList.add('public');
    copyBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
    goPublicBtn.style.display = 'none';
  } else {
    indicator.textContent = currentRoomId;
    codeDisplay.textContent = currentRoomId;
    roomMenuBtn.classList.remove('public');
    copyBtn.style.display = 'block';
    deleteBtn.style.display = adminMode ? 'block' : 'none';
    goPublicBtn.style.display = 'block';
  }
}

function loadCanvas() {
  if (!roomDataRef) return;
  
  roomDataRef.once('value', (snapshot) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    
    const data = snapshot.val();
    if (!data) return;

    Object.values(data).forEach(item => {
      if (item.type === 'draw') {
        ctx.lineWidth = item.size;
        ctx.lineCap = 'round';
        ctx.strokeStyle = item.color;
        ctx.lineTo(item.x, item.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
      } else if (item.type === 'text') {
        ctx.font = `${item.size}px Arial`;
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, item.x, item.y);
      }
    });
  });
}

// ==================== Room History ====================
function addToRoomHistory(roomId) {
  const history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
  
  const existingIndex = history.findIndex(r => r.roomId === roomId);
  if (existingIndex !== -1) {
    history.splice(existingIndex, 1);
  }
  
  history.unshift({
    roomId,
    timestamp: Date.now()
  });
  
  if (history.length > 10) {
    history.pop();
  }
  
  localStorage.setItem('roomHistory', JSON.stringify(history));
  loadRoomHistory();
}

async function loadRoomHistory() {
  const historyContainer = document.getElementById('roomHistoryList');
  const history = JSON.parse(localStorage.getItem('roomHistory') || '[]');
  
  if (history.length === 0) {
    historyContainer.innerHTML = '<p style="color: hsl(217, 10%, 60%); font-size: 13px; padding: 8px;">No recent rooms</p>';
    return;
  }

  try {
    const roomElements = await Promise.all(history.map(async (item) => {
      const snapshot = await database.ref(`rooms/${item.roomId}`).once('value');
      const exists = snapshot.exists();
      const isDeleted = !exists;
      
      const roomItem = document.createElement('div');
      roomItem.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px;
        margin-bottom: 8px;
        background: ${isDeleted ? 'hsl(0, 60%, 15%)' : 'hsl(217, 20%, 20%)'};
        border-radius: 8px;
        cursor: ${isDeleted ? 'not-allowed' : 'pointer'};
        transition: background 150ms;
        border: 1px solid ${isDeleted ? 'hsl(0, 60%, 25%)' : 'hsl(217, 20%, 25%)'};
        opacity: ${isDeleted ? '0.6' : '1'};
      `;
      
      if (!isDeleted) {
        roomItem.addEventListener('mouseenter', () => {
          roomItem.style.background = 'hsl(217, 20%, 24%)';
        });
        roomItem.addEventListener('mouseleave', () => {
          roomItem.style.background = 'hsl(217, 20%, 20%)';
        });
      }
      
      const roomInfo = document.createElement('div');
      roomInfo.style.cssText = 'flex: 1;';
      
      const roomIdText = document.createElement('div');
      roomIdText.textContent = item.roomId;
      roomIdText.style.cssText = `
        color: ${isDeleted ? 'hsl(0, 60%, 50%)' : 'hsl(220, 90%, 56%)'};
        font-weight: 600;
        font-family: 'JetBrains Mono', monospace;
        margin-bottom: 4px;
      `;
      
      const timeText = document.createElement('div');
      timeText.textContent = isDeleted ? 'Room deleted' : getTimeAgo(item.timestamp);
      timeText.style.cssText = `
        color: ${isDeleted ? 'hsl(0, 60%, 60%)' : 'hsl(217, 10%, 60%)'};
        font-size: 12px;
      `;
      
      roomInfo.appendChild(roomIdText);
      roomInfo.appendChild(timeText);
      roomItem.appendChild(roomInfo);
      
      if (!isDeleted) {
        roomItem.addEventListener('click', () => {
          joinRoom(item.roomId);
          roomDropdown.classList.remove('show');
        });
      }
      
      return roomItem;
    }));

    historyContainer.innerHTML = '';
    roomElements.forEach(el => historyContainer.appendChild(el));
  } catch (err) {
    console.error('Error loading room history:', err);
    historyContainer.innerHTML = '<p style="color: hsl(0, 60%, 50%); font-size: 13px; padding: 8px;">Error loading history</p>';
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ==================== Page Management ====================
function loadPages() {
  const pagesList = document.getElementById('pagesList');
  pagesList.innerHTML = '';
  
  const pagesRef = currentRoomId === 'public' 
    ? database.ref('public')
    : database.ref(`rooms/${currentRoomId}/pages`);
  
  pagesRef.once('value', (snapshot) => {
    const pages = snapshot.val() || {};
    const pageNumbers = Object.keys(pages)
      .map(key => parseInt(key.replace('page', '')))
      .sort((a, b) => a - b);
    
    if (pageNumbers.length === 0) {
      pageNumbers.push(1);
    }
    
    pageNumbers.forEach(pageNum => {
      const pageBtn = document.createElement('button');
      pageBtn.textContent = `Page ${pageNum}`;
      pageBtn.className = 'page-btn';
      if (pageNum === currentPage) {
        pageBtn.classList.add('active');
      }
      
      pageBtn.addEventListener('click', () => {
        switchPage(pageNum);
        pageDropdown.classList.remove('show');
      });
      
      pagesList.appendChild(pageBtn);
    });
  });
}

function switchPage(pageNum) {
  currentPage = pageNum;
  
  roomDataRef.off();
  
  if (currentRoomId === 'public') {
    roomDataRef = database.ref(`public/page${pageNum}`);
  } else {
    roomDataRef = database.ref(`rooms/${currentRoomId}/pages/page${pageNum}`);
  }
  
  document.getElementById('pageIndicator').textContent = `Page ${pageNum}`;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  loadCanvas();
  loadPages();
  
  roomDataRef.on('child_added', (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.type === 'draw') {
      ctx.lineWidth = data.size;
      ctx.lineCap = 'round';
      ctx.strokeStyle = data.color;
      ctx.lineTo(data.x, data.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(data.x, data.y);
    } else if (data.type === 'text') {
      ctx.font = `${data.size}px Arial`;
      ctx.fillStyle = data.color;
      ctx.fillText(data.text, data.x, data.y);
    } else if (data.type === 'clear') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
}

document.getElementById('createPageBtn')?.addEventListener('click', () => {
  const pagesRef = currentRoomId === 'public' 
    ? database.ref('public')
    : database.ref(`rooms/${currentRoomId}/pages`);
  
  pagesRef.once('value', (snapshot) => {
    const pages = snapshot.val() || {};
    const pageNumbers = Object.keys(pages)
      .map(key => parseInt(key.replace('page', '')))
      .sort((a, b) => a - b);
    
    const newPageNum = pageNumbers.length > 0 ? Math.max(...pageNumbers) + 1 : 1;
    
    const newPageRef = currentRoomId === 'public'
      ? database.ref(`public/page${newPageNum}`)
      : database.ref(`rooms/${currentRoomId}/pages/page${newPageNum}`);
    
    newPageRef.set({
      created: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
      switchPage(newPageNum);
      pageDropdown.classList.remove('show');
    });
  });
});

// ==================== User Presence ====================
function setupUserPresence(roomId) {
  const userStatusRef = database.ref(`rooms/${roomId}/users/${sessionId}`);
  
  userStatusRef.set({
    name: userName,
    online: true,
    lastSeen: firebase.database.ServerValue.TIMESTAMP
  });
  
  userStatusRef.onDisconnect().remove();
  
  const usersRef = database.ref(`rooms/${roomId}/users`);
  usersRef.on('value', (snapshot) => {
    const users = snapshot.val() || {};
    const activeUsers = Object.values(users).filter(u => u.online);
    
    document.getElementById('activeUserCount').textContent = activeUsers.length;
    
    const usersList = document.getElementById('activeUsersList');
    usersList.innerHTML = '';
    
    if (activeUsers.length === 0) {
      document.getElementById('activeUsersSection').style.display = 'none';
      document.getElementById('activeUsersDivider').style.display = 'none';
    } else {
      document.getElementById('activeUsersSection').style.display = 'block';
      document.getElementById('activeUsersDivider').style.display = 'block';
      
      activeUsers.forEach(user => {
        const userItem = document.createElement('div');
        userItem.textContent = user.name;
        userItem.style.cssText = `
          padding: 8px 12px;
          background: hsl(217, 20%, 20%);
          border-radius: 6px;
          margin-bottom: 6px;
          font-size: 13px;
          color: hsl(217, 10%, 88%);
        `;
        usersList.appendChild(userItem);
      });
    }
  });
}

// ==================== Chat System ====================
function setupChat(roomId) {
  const chatRef = database.ref(`rooms/${roomId}/chat`);
  const messagesContainer = document.getElementById('chatMessages');
  
  chatRef.off();
  messagesContainer.innerHTML = '';
  
  chatRef.on('child_added', (snapshot) => {
    const message = snapshot.val();
    if (!message) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
      margin-bottom: 12px;
      padding: 8px 12px;
      background: hsl(217, 20%, 20%);
      border-radius: 8px;
      word-wrap: break-word;
    `;
    
    const authorSpan = document.createElement('div');
    authorSpan.textContent = message.user;
    authorSpan.style.cssText = `
      font-weight: 600;
      color: hsl(220, 90%, 56%);
      margin-bottom: 4px;
      font-size: 13px;
    `;
    
    const textSpan = document.createElement('div');
    textSpan.textContent = message.text;
    textSpan.style.cssText = `
      color: hsl(217, 10%, 88%);
      font-size: 14px;
    `;
    
    messageDiv.appendChild(authorSpan);
    messageDiv.appendChild(textSpan);
    messagesContainer.appendChild(messageDiv);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

function cleanupChat() {
  if (currentRoomId === 'public') return;
  
  const chatRef = database.ref(`rooms/${currentRoomId}/chat`);
  chatRef.off();
}

function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message || currentRoomId === 'public') return;
  
  const chatRef = database.ref(`rooms/${currentRoomId}/chat`);
  chatRef.push({
    user: userName,
    text: message,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
  
  input.value = '';
}

document.getElementById('sendChatBtn')?.addEventListener('click', sendMessage);
document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// ==================== Camera & Microphone System ====================
const allCamerasRef = database.ref('cameras');
let cameraStatusRef = null;
const negotiating = new Map();

async function setupCameraForRoom(roomId) {
  if (roomId === 'public') {
    const cameraContainer = document.getElementById('cameraContainer');
    if (cameraContainer) cameraContainer.style.display = 'none';
    
    cleanupCamera();
    return;
  }

  cameraStatusRef = database.ref(`cameras/${roomId}/${sessionId}`);
  
  cameraStatusRef.set({
    name: userName,
    enabled: false,
    online: true,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });

  cameraStatusRef.onDisconnect().remove();

  const roomCamerasRef = database.ref(`cameras/${roomId}`);
  
  roomCamerasRef.on('child_added', async (snapshot) => {
    const sessionId = snapshot.key;
    const data = snapshot.val();
    
    console.log('Camera child_added:', sessionId, data);
    
    if (sessionId === window.sessionId || !data.online) return;
    
    if (data.enabled) {
      if (!peerConnections.has(sessionId)) {
        await createPeerConnection(sessionId, true);
      }
    }
    
    updateCameraDisplay();
  });

  roomCamerasRef.on('child_changed', async (snapshot) => {
    const sessionId = snapshot.key;
    const data = snapshot.val();
    
    console.log('Camera child_changed:', sessionId, data);
    
    if (sessionId === window.sessionId) return;
    
    if (!data.online) {
      closePeerConnection(sessionId);
    } else if (data.enabled) {
      if (!peerConnections.has(sessionId)) {
        await createPeerConnection(sessionId, true);
      }
    } else {
      // Keep connection open even if they disable camera
      // They might still be receiving
    }
    
    updateCameraDisplay();
  });

  roomCamerasRef.on('child_removed', (snapshot) => {
    const sessionId = snapshot.key;
    console.log('Camera child_removed:', sessionId);
    closePeerConnection(sessionId);
    updateCameraDisplay();
  });

  updateCameraDisplay();
}

async function createPeerConnection(remoteSessionId, isInitiator) {
  if (peerConnections.has(remoteSessionId)) {
    return peerConnections.get(remoteSessionId);
  }
  
  const peerConnection = new RTCPeerConnection(rtcConfiguration);
  peerConnections.set(remoteSessionId, peerConnection);
  
  console.log(`Creating peer connection with ${remoteSessionId}, initiator: ${isInitiator}`);
  
  // Add local tracks if we have them
  if (localStream) {
    localStream.getTracks().forEach(track => {
      console.log(`Adding ${track.kind} track to peer connection`);
      peerConnection.addTrack(track, localStream);
    });
  }
  
  // Handle incoming tracks
  peerConnection.ontrack = (event) => {
    console.log(`Received ${event.track.kind} track from ${remoteSessionId}`);
    
    if (!remoteStreams.has(remoteSessionId)) {
      remoteStreams.set(remoteSessionId, new MediaStream());
    }
    
    const stream = remoteStreams.get(remoteSessionId);
    stream.addTrack(event.track);
    
    updateCameraDisplay();
  };
  
  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      database.ref(`signaling/${currentRoomId}/${remoteSessionId}/candidates/${sessionId}`).push({
        candidate: event.candidate.toJSON(),
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    }
  };
  
  // Handle connection state
  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state with ${remoteSessionId}: ${peerConnection.connectionState}`);
    
    if (peerConnection.connectionState === 'disconnected' || 
        peerConnection.connectionState === 'failed') {
      console.log(`Connection failed with ${remoteSessionId}, attempting to reconnect...`);
      setTimeout(() => {
        if (peerConnection.connectionState === 'failed') {
          closePeerConnection(remoteSessionId);
        }
      }, 5000);
    }
  };
  
  // Handle automatic negotiation
  peerConnection.onnegotiationneeded = async () => {
    if (negotiating.get(remoteSessionId)) {
      console.log('Already negotiating, skipping...');
      return;
    }
    
    try {
      negotiating.set(remoteSessionId, true);
      console.log(`Creating offer for ${remoteSessionId}`);
      
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      await database.ref(`signaling/${currentRoomId}/${remoteSessionId}/offer/${sessionId}`).set({
        sdp: offer.sdp,
        type: offer.type,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      
      console.log(`Offer sent to ${remoteSessionId}`);
    } catch (err) {
      console.error('Error during negotiation:', err);
    } finally {
      negotiating.set(remoteSessionId, false);
    }
  };
  
  // Listen for offers
  database.ref(`signaling/${currentRoomId}/${sessionId}/offer`).on('child_added', async (snapshot) => {
    const offerData = snapshot.val();
    const offererId = snapshot.key;
    
    if (!offerData || offererId === sessionId) return;
    
    console.log(`Received offer from ${offererId}`);
    
    try {
      const pc = peerConnections.get(offererId) || await createPeerConnection(offererId, false);
      
      await pc.setRemoteDescription(new RTCSessionDescription(offerData));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await database.ref(`signaling/${currentRoomId}/${offererId}/answer/${sessionId}`).set({
        sdp: answer.sdp,
        type: answer.type,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      
      console.log(`Answer sent to ${offererId}`);
      snapshot.ref.remove();
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  });
  
  // Listen for answers
  database.ref(`signaling/${currentRoomId}/${sessionId}/answer`).on('child_added', async (snapshot) => {
    const answerData = snapshot.val();
    const answererId = snapshot.key;
    
    if (!answerData || answererId === sessionId) return;
    
    console.log(`Received answer from ${answererId}`);
    
    try {
      const pc = peerConnections.get(answererId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answerData));
        console.log(`Remote description set for ${answererId}`);
      }
      snapshot.ref.remove();
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  });
  
  // Listen for ICE candidates
  database.ref(`signaling/${currentRoomId}/${sessionId}/candidates`).on('child_added', async (snapshot) => {
    const candidateData = snapshot.val();
    const senderId = snapshot.key;
    
    if (!candidateData || senderId === sessionId) return;
    
    try {
      const pc = peerConnections.get(senderId);
      if (pc && candidateData.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidateData.candidate));
        console.log(`ICE candidate added from ${senderId}`);
      }
      snapshot.ref.remove();
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  });
  
  // If we're the initiator, start negotiation
  if (isInitiator && localStream && localStream.getTracks().length > 0) {
    // Trigger negotiation
    setTimeout(() => {
      if (peerConnection.signalingState === 'stable') {
        peerConnection.dispatchEvent(new Event('negotiationneeded'));
      }
    }, 100);
  }
  
  return peerConnection;
}

function closePeerConnection(remoteSessionId) {
  const pc = peerConnections.get(remoteSessionId);
  if (pc) {
    console.log(`Closing peer connection with ${remoteSessionId}`);
    pc.close();
    peerConnections.delete(remoteSessionId);
  }
  
  remoteStreams.delete(remoteSessionId);
  negotiating.delete(remoteSessionId);
  
  updateCameraDisplay();
}

async function updateCameraDisplay() {
  const videosContainer = document.getElementById('cameraVideos');
  if (!videosContainer) return;
  
  const snapshot = await allCamerasRef.child(currentRoomId).once('value');
  
  // Save existing video elements to preserve streams
  const existingVideos = {};
  videosContainer.querySelectorAll('video').forEach(video => {
    existingVideos[video.id] = video;
  });
  
  videosContainer.innerHTML = '';
  
  if (!snapshot.exists()) {
    videosContainer.innerHTML = '<p style="color: hsl(217, 10%, 60%); font-size: 13px; padding: 10px; text-align: center;">No active cameras</p>';
    return;
  }
  
  const cameras = snapshot.val();
  
  for (const [sid, data] of Object.entries(cameras)) {
    if (!data.online) continue;
    
    const isCurrentUser = sid === sessionId;
    const videoId = `video-${sid}`;
    
    const videoItem = document.createElement('div');
    videoItem.className = data.enabled ? 'camera-video-item' : 'camera-video-item disabled';
    
    if (data.enabled) {
      let video = existingVideos[videoId];
      
      if (!video) {
        video = document.createElement('video');
        video.id = videoId;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = isCurrentUser;
      }
      
      if (isCurrentUser && localStream) {
        video.srcObject = localStream;
      } else if (remoteStreams.has(sid)) {
        video.srcObject = remoteStreams.get(sid);
        video.muted = false;
      }
      
      videoItem.appendChild(video);
      
      const label = document.createElement('div');
      label.className = 'camera-video-label';
      label.textContent = data.name + (isCurrentUser ? ' (You)' : '');
      videoItem.appendChild(label);
    } else {
      const nameDisplay = document.createElement('div');
      nameDisplay.className = 'user-name-display';
      nameDisplay.textContent = data.name;
      videoItem.appendChild(nameDisplay);
    }
    
    videosContainer.appendChild(videoItem);
  }
}

async function toggleMedia() {
  if (!currentRoomId || currentRoomId === 'public') return;
  
  mediaEnabled = !mediaEnabled;
  
  if (mediaEnabled) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 },
        audio: true
      });
      
      localStream = newStream;
      
      console.log('Media stream obtained:', localStream.getTracks().map(t => t.kind));
      
      // Add tracks to existing peer connections
      for (const [remoteSessionId, pc] of peerConnections.entries()) {
        localStream.getTracks().forEach(track => {
          const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            pc.addTrack(track, localStream);
          }
        });
      }
      
      // Update Firebase status
      if (cameraStatusRef) {
        await cameraStatusRef.update({
          enabled: true,
          timestamp: firebase.database.ServerValue.TIMESTAMP
        });
      }
      
      // Create connections with other users who have media enabled
      const snapshot = await allCamerasRef.child(currentRoomId).once('value');
      if (snapshot.exists()) {
        const cameras = snapshot.val();
        for (const [sid, data] of Object.entries(cameras)) {
          if (sid !== sessionId && data.online && data.enabled && !peerConnections.has(sid)) {
            await createPeerConnection(sid, false);
          }
        }
      }
      
      updateCameraButton();
      updateCameraDisplay();
    } catch (err) {
      console.error('Error enabling media:', err);
      alert('Could not access camera/microphone. Please check permissions.');
      mediaEnabled = false;
      updateCameraButton();
    }
  } else {
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
      });
      localStream = null;
    }
    
    // Remove tracks from peer connections
    for (const [remoteSessionId, pc] of peerConnections.entries()) {
      pc.getSenders().forEach(sender => {
        if (sender.track) {
          pc.removeTrack(sender);
        }
      });
    }
    
    // Update Firebase status
    if (cameraStatusRef) {
      await cameraStatusRef.update({
        enabled: false,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    }
    
    updateCameraButton();
    updateCameraDisplay();
  }
}

function updateCameraButton() {
  const btn = document.getElementById('toggleCameraBtn');
  if (!btn) return;
  
  if (mediaEnabled) {
    btn.textContent = '🔴 Disable Camera & Mic';
    btn.classList.add('disabled');
  } else {
    btn.textContent = '🎥 Enable Camera & Mic';
    btn.classList.remove('disabled');
  }
}

function cleanupCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  for (const [sessionId, pc] of peerConnections.entries()) {
    pc.close();
  }
  
  peerConnections.clear();
  remoteStreams.clear();
  negotiating.clear();
  
  if (cameraStatusRef) {
    cameraStatusRef.off();
    cameraStatusRef = null;
  }
  
  allCamerasRef.off();
  
  mediaEnabled = false;
  updateCameraButton();
}

// ==================== Room Creation & Deletion ====================
document.getElementById('createRoomBtn')?.addEventListener('click', () => {
  const roomId = generateRoomId();
  const roomRef = database.ref(`rooms/${roomId}`);
  
  roomRef.set({
    created: firebase.database.ServerValue.TIMESTAMP,
    creator: userName,
    pages: {
      page1: {
        created: firebase.database.ServerValue.TIMESTAMP
      }
    }
  }).then(() => {
    joinRoom(roomId);
    roomDropdown.classList.remove('show');
  });
});

document.getElementById('deleteRoomBtn')?.addEventListener('click', () => {
  if (!adminMode || currentRoomId === 'public') return;
  
  if (confirm(`Delete room ${currentRoomId}? This cannot be undone.`)) {
    database.ref(`rooms/${currentRoomId}`).remove().then(() => {
      joinRoom('public');
      roomDropdown.classList.remove('show');
    });
  }
});

document.getElementById('goPublicBtn')?.addEventListener('click', () => {
  joinRoom('public');
  roomDropdown.classList.remove('show');
});

document.getElementById('copyRoomBtn')?.addEventListener('click', () => {
  if (currentRoomId === 'public') return;
  
  navigator.clipboard.writeText(currentRoomId).then(() => {
    const btn = document.getElementById('copyRoomBtn');
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
});

document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
  const roomId = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (roomId) {
    joinRoom(roomId);
    roomDropdown.classList.remove('show');
  }
});

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ==================== UI Event Listeners ====================
roomMenuBtn?.addEventListener('click', () => {
  roomDropdown.classList.toggle('show');
  pageDropdown.classList.remove('show');
});

pageMenuBtn?.addEventListener('click', () => {
  if (currentRoomId === 'public') {
    return;
  }
  pageDropdown.classList.toggle('show');
  roomDropdown.classList.remove('show');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.room-menu-container')) {
    roomDropdown.classList.remove('show');
  }
  if (!e.target.closest('.page-menu-container')) {
    pageDropdown.classList.remove('show');
  }
});

// Chat UI
const chatMenuBtn = document.getElementById('chatMenuBtn');
const chatPanel = document.getElementById('chatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');

chatMenuBtn?.addEventListener('click', () => {
  const isVisible = chatPanel.style.display === 'flex';
  chatPanel.style.display = isVisible ? 'none' : 'flex';
});

closeChatBtn?.addEventListener('click', () => {
  chatPanel.style.display = 'none';
});

// Camera UI
const cameraMenuBtn = document.getElementById('cameraMenuBtn');
const cameraPanel = document.getElementById('cameraPanel');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const toggleCameraBtn = document.getElementById('toggleCameraBtn');

cameraMenuBtn?.addEventListener('click', () => {
  const isVisible = cameraPanel.style.display === 'flex';
  cameraPanel.style.display = isVisible ? 'none' : 'flex';
});

closeCameraBtn?.addEventListener('click', () => {
  cameraPanel.style.display = 'none';
});

toggleCameraBtn?.addEventListener('click', toggleMedia);

// ==================== Initialize ====================
window.sessionId = sessionId;
initializeUser();
