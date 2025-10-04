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

// ==================== Room Management ====================
let currentRoomId = null;
let linesRef = null;
let textsRef = null;
let roomDeletedRef = null;

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function joinRoom(roomId, password = null) {
  // Check if room has password protection (skip for public)
  if (roomId !== 'public') {
    const roomRef = db.ref(`rooms/${roomId}`);
    const roomSnapshot = await roomRef.once('value');
    
    // Check if room has any data (lines, texts, or password)
    const roomData = roomSnapshot.val();
    
    // Check if room was deleted or doesn't exist
    if (!roomData || roomData.deleted === true) {
      alert('Room does not exist');
      joinRoom('public');
      return;
    }
    
    const hasLines = roomData && roomData.lines;
    const hasTexts = roomData && roomData.texts;
    const hasPassword = roomData && roomData.password;
    
    // If room has been explicitly created (has password) or has content, it exists
    // Otherwise, treat it as a new room
    const roomExists = hasPassword || hasLines || hasTexts;
    
    if (!roomExists && roomData === null) {
      // Room doesn't exist at all
      alert('Room does not exist');
      joinRoom('public');
      return;
    }
    
    // Check password protection
    const passwordRef = db.ref(`rooms/${roomId}/password`);
    const passwordSnapshot = await passwordRef.once('value');
    const storedPassword = passwordSnapshot.val();

    if (storedPassword) {
      // Room is password protected
      if (password === null) {
        // Prompt for password
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

  currentRoomId = roomId;
  linesRef = db.ref(`rooms/${roomId}/lines`);
  textsRef = db.ref(`rooms/${roomId}/texts`);

  linesCache.length = 0;
  textsCache.clear();
  drawAll();

  setupFirebaseListeners();
  setupRoomDeletionListener();
  updateRoomIndicator();

  window.location.hash = roomId;
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

function updateRoomIndicator() {
  const indicator = document.getElementById('roomIndicator');
  const menuBtn = document.getElementById('roomMenuBtn');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const deleteBtn = document.getElementById('deleteRoomBtn');
  const copyBtn = document.getElementById('copyRoomBtn');

  if (indicator && currentRoomId) {
    if (currentRoomId === 'public') {
      indicator.textContent = 'Public Canvas';
      menuBtn?.classList.add('public');
      if (roomCodeDisplay) {
        roomCodeDisplay.textContent = 'You are on the public canvas';
        roomCodeDisplay.style.fontFamily = 'Inter, system-ui, sans-serif';
      }
      // Hide delete and copy buttons on public canvas
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (copyBtn) copyBtn.style.display = 'none';
    } else {
      indicator.textContent = currentRoomId;
      menuBtn?.classList.remove('public');
      if (roomCodeDisplay) {
        roomCodeDisplay.textContent = currentRoomId;
        roomCodeDisplay.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
      }
      // Show delete and copy buttons on private rooms
      if (deleteBtn) deleteBtn.style.display = 'block';
      if (copyBtn) copyBtn.style.display = 'block';
    }
  }
}

function setupFirebaseListeners() {
  linesRef.on('child_added', snapshot => {
    const line = snapshot.val();
    linesCache.push(line);
    line.points.forEach(p => {
      ctx.beginPath();
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
    if (!snapshot.exists()) {
      linesCache.length = 0;
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
  linesRef.push({ points, color: brushColor, width: brushSize, erase: eraserActive });
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
const addTextBtn = document.getElementById('addTextBtn');

let textSizePicker = document.getElementById('textSizePicker');
if (!textSizePicker) {
  const toolbarEl = document.getElementById('toolbar') || document.body;
  textSizePicker = document.createElement('input');
  textSizePicker.type = 'number';
  textSizePicker.id = 'textSizePicker';
  textSizePicker.min = '10';
  textSizePicker.max = '200';
  textSizePicker.value = '40';
  textSizePicker.title = 'Text size (px)';
  textSizePicker.style.width = '70px';
  if (toolbarEl && addTextBtn && addTextBtn.parentElement === toolbarEl) {
    toolbarEl.insertBefore(textSizePicker, addTextBtn);
  } else if (toolbarEl) {
    toolbarEl.appendChild(textSizePicker);
  } else {
    document.body.appendChild(textSizePicker);
  }
}

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
  
  if (toolbarEl && addTextBtn && addTextBtn.parentElement === toolbarEl) {
    toolbarEl.insertBefore(textFontPicker, addTextBtn);
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

addTextBtn.addEventListener('click', () => {
  const content = (freeTextInput.value || '').trim();
  if (!content || !currentRoomId) return;
  const size = getTextSize();
  const font = getTextFont();
  const x = current.x || canvas.width / 2;
  const y = current.y || canvas.height / 2;
  textsRef.push({ x, y, text: content, size, color: brushColor, font });
  freeTextInput.value = '';
});

// ==================== Room UI ====================
const roomDropdown = document.getElementById('roomDropdown');
const roomMenuBtn = document.getElementById('roomMenuBtn');

roomMenuBtn?.addEventListener('click', () => {
  roomDropdown.classList.toggle('show');
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
    // Save password to Firebase
    await db.ref(`rooms/${roomId}/password`).set(password.trim());
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
      // First, set the deleted flag to kick other users
      await db.ref(`rooms/${currentRoomId}/deleted`).set(true);
      
      // Wait a moment for other users to be kicked
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Then delete the entire room from Firebase
      await db.ref(`rooms/${currentRoomId}`).remove();
      
      alert('Room deleted successfully');
      joinRoom('public');
      roomDropdown.classList.remove('show');
    }
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
      try {
        await Promise.all([
          linesRef.remove(),
          textsRef.remove()
        ]);
      } catch (err) {
        console.error('Failed to clear canvas data:', err);
      }
    });
    
    // Create admin room management button
    const adminRoomBtn = document.createElement('button');
    adminRoomBtn.textContent = 'Manage Rooms';
    adminRoomBtn.className = 'secondary';
    adminRoomBtn.style.display = 'inline-block';
    document.getElementById('toolbar').appendChild(adminRoomBtn);
    
    // Create admin panel
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
          const hasPassword = roomData.password ? 'Yes' : 'No';
          const lineCount = roomData.lines ? Object.keys(roomData.lines).length : 0;
          const textCount = roomData.texts ? Object.keys(roomData.texts).length : 0;
          
          // Calculate last activity
          let lastActivity = 'Unknown';
          let lastTimestamp = 0;
          
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
              <div>Password Protected: ${hasPassword}</div>
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
              alert(`Room ${roomId} deleted`);
              adminRoomBtn.click(); // Refresh the list
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
