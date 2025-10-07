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

// ==================== User Management ====================
let userName = null;
let userSessionId = null;
let presenceRef = null;
let usersRef = null;

function generateSessionId() {
  return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getUserName() {
  // Try to get saved name from memory storage
  if (userName) return userName;
  
  // Check if we have a name in memory (simulated storage)
  const savedName = window.userNameCache;
  if (savedName) {
    userName = savedName;
    return userName;
  }
  
  // Prompt for name
  const name = prompt('Welcome! Please enter your name:');
  if (name && name.trim()) {
    userName = name.trim();
    window.userNameCache = userName; // Save to memory
    return userName;
  }
  
  // Default name if user cancels
  userName = 'Anonymous';
  window.userNameCache = userName;
  return userName;
}

function setupPresence(roomId) {
  if (!roomId || roomId === 'public') return;
  
  // Clean up previous presence
  if (presenceRef) {
    presenceRef.remove();
    presenceRef = null;
  }
  
  if (usersRef) {
    usersRef.off();
    usersRef = null;
  }
  
  // Generate unique session ID for this user
  userSessionId = generateSessionId();
  
  // Set up presence reference
  presenceRef = db.ref(`rooms/${roomId}/users/${userSessionId}`);
  usersRef = db.ref(`rooms/${roomId}/users`);
  
  // Set user data
  presenceRef.set({
    name: userName,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
  
  // Remove user when they disconnect
  presenceRef.onDisconnect().remove();
  
  // Listen for user changes
  usersRef.on('value', snapshot => {
    updateActiveUsers(snapshot);
  });
}

function updateActiveUsers(snapshot) {
  const usersContainer = document.getElementById('activeUsersList');
  const userCount = document.getElementById('activeUserCount');
  
  if (!snapshot.exists()) {
    if (usersContainer) {
      usersContainer.innerHTML = '<p style="color: hsl(217, 10%, 70%); font-size: 13px; padding: 8px;">No users online</p>';
    }
    if (userCount) {
      userCount.textContent = '0';
    }
    return;
  }
  
  const users = snapshot.val();
  const userList = Object.entries(users).map(([id, data]) => ({
    id,
    name: data.name || 'Anonymous',
    timestamp: data.timestamp || 0
  }));
  
  // Sort by join time (oldest first)
  userList.sort((a, b) => a.timestamp - b.timestamp);
  
  if (usersContainer) {
    usersContainer.innerHTML = '';
    
    userList.forEach(user => {
      const userItem = document.createElement('div');
      userItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        margin-bottom: 6px;
        background: hsl(217, 20%, 20%);
        border: 1px solid hsl(217, 20%, 25%);
        border-radius: 6px;
      `;
      
      const statusDot = document.createElement('div');
      statusDot.style.cssText = `
        width: 8px;
        height: 8px;
        background: hsl(142, 76%, 55%);
        border-radius: 50%;
        flex-shrink: 0;
      `;
      
      const nameText = document.createElement('div');
      nameText.textContent = user.name;
      nameText.style.cssText = `
        color: hsl(217, 10%, 92%);
        font-size: 14px;
        font-weight: 500;
      `;
      
      // Highlight current user
      if (user.id === userSessionId) {
        nameText.textContent += ' (you)';
        nameText.style.color = 'hsl(220, 90%, 56%)';
      }
      
      userItem.appendChild(statusDot);
      userItem.appendChild(nameText);
      usersContainer.appendChild(userItem);
    });
  }
  
  if (userCount) {
    userCount.textContent = userList.length.toString();
  }
}
