// WatchParty — Клиентская логика совместного просмотра
const $ = (id) => document.getElementById(id);

let socket = null;
let player = null;
let isPlayerReady = false;
let isSyncing = false; // флаг, чтобы избежать бесконечного цикла отправки сокетов

let currentRoomId = '';
let myUsername = '';
let myColor = '';

let pendingVideoId = null;
let pendingTime = 0;
let pendingState = 'paused';

const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
  // Проверяем, есть ли комната в URL (?room=xyz)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    $('roomIdInput').value = roomParam;
  }

  // Случайный ник по умолчанию
  $('usernameInput').value = 'Зритель_' + Math.floor(Math.random() * 900 + 100);

  initEventListeners();
});

// YouTube API Callback
window.onYouTubeIframeAPIReady = function () {
  isPlayerReady = true;
  if (pendingVideoId) {
    createPlayer(pendingVideoId, pendingTime, pendingState);
  }
};

function createPlayer(videoId, startTime = 0, state = 'paused') {
  if (player) {
    player.destroy();
  }

  player = new YT.Player('player', {
    videoId: videoId,
    playerVars: {
      autoplay: state === 'playing' ? 1 : 0,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      start: Math.floor(startTime)
    },
    events: {
      onReady: (event) => {
        if (state === 'playing') {
          isSyncing = true;
          event.target.seekTo(startTime, true);
          event.target.playVideo();
        } else {
          isSyncing = true;
          event.target.seekTo(startTime, true);
          event.target.pauseVideo();
        }
      },
      onStateChange: onPlayerStateChange
    }
  });
}

function onPlayerStateChange(event) {
  if (isSyncing) {
    isSyncing = false;
    return;
  }

  const curTime = player.getCurrentTime();

  if (event.data === YT.PlayerState.PLAYING) {
    socket.emit('video:play', { time: curTime });
  } else if (event.data === YT.PlayerState.PAUSED) {
    socket.emit('video:pause', { time: curTime });
  }
}

// Парсинг ID видео из любой ссылки YouTube
function extractYouTubeId(url) {
  if (!url) return null;
  url = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url; // уже ID

  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

// ==================== СОБЫТИЯ И КНОПКИ ====================
function initEventListeners() {
  $('createRoomBtn').onclick = () => {
    const randomRoom = 'cinema-' + Math.random().toString(36).substr(2, 5);
    joinRoom(randomRoom);
  };

  $('joinRoomBtn').onclick = () => {
    const roomId = $('roomIdInput').value.trim() || 'main-room';
    joinRoom(roomId);
  };

  // Копирование ссылки
  $('copyInviteBtn').onclick = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('Ссылка на комнату скопирована!', '🔗');
    });
  };

  // Загрузка нового видео
  $('loadVideoBtn').onclick = submitNewVideo;
  $('videoUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitNewVideo();
  });

  // Отправка сообщений в чат
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text || !socket) return;
    socket.emit('chat:message', { text });
    input.value = '';
  };

  // Реакции
  document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.onclick = () => {
      const emoji = btn.getAttribute('data-emoji');
      if (socket) socket.emit('reaction:send', { emoji });
      launchReaction(emoji);
    };
  });
}

function submitNewVideo() {
  const url = $('videoUrlInput').value.trim();
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    showToast('Некорректная ссылка на YouTube', '⚠️');
    return;
  }
  $('videoUrlInput').value = '';
  socket.emit('video:change', { videoId });
}

// ==================== ВХОД В КОМНАТУ ====================
function joinRoom(roomId) {
  currentRoomId = roomId;
  myUsername = $('usernameInput').value.trim() || 'Зритель';
  myColor = colors[Math.floor(Math.random() * colors.length)];

  // Обновляем адресную строку браузера
  const newUrl = `${window.location.pathname}?room=${roomId}`;
  window.history.pushState({ path: newUrl }, '', newUrl);

  $('joinModal').style.display = 'none';
  $('cinemaApp').style.display = 'flex';
  $('currentRoomText').textContent = roomId;

  connectSocket();
}

// ==================== СОКЕТЫ ====================
function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('room:join', {
      roomId: currentRoomId,
      username: myUsername,
      color: myColor
    });
  });

  // Начальное состояние комнаты
  socket.on('room:state', ({ videoId, state, currentTime, users }) => {
    pendingVideoId = videoId;
    pendingTime = currentTime;
    pendingState = state;

    if (isPlayerReady) {
      createPlayer(videoId, currentTime, state);
    }
    updateUsersList(users);
  });

  // Смена видео
  socket.on('video:change', ({ videoId, user }) => {
    showToast(`${user} включил новое видео`, '🎬');
    if (player && player.loadVideoById) {
      isSyncing = true;
      player.loadVideoById(videoId, 0);
    } else {
      createPlayer(videoId, 0, 'playing');
    }
  });

  // Синхронный Play
  socket.on('video:play', ({ time, user }) => {
    if (!player || !player.playVideo) return;
    const curTime = player.getCurrentTime();
    isSyncing = true;
    if (Math.abs(curTime - time) > 1.5) {
      player.seekTo(time, true);
    }
    player.playVideo();
  });

  // Синхронный Pause
  socket.on('video:pause', ({ time, user }) => {
    if (!player || !player.pauseVideo) return;
    isSyncing = true;
    player.pauseVideo();
    if (Math.abs(player.getCurrentTime() - time) > 1.5) {
      player.seekTo(time, true);
    }
  });

  // Перемотка
  socket.on('video:seek', ({ time, user }) => {
    if (!player || !player.seekTo) return;
    isSyncing = true;
    player.seekTo(time, true);
  });

  // Список зрителей
  socket.on('users:update', (users) => {
    updateUsersList(users);
  });

  // Сообщения чата
  socket.on('chat:message', (msg) => {
    appendChatMessage(msg);
  });

  // Системные сообщения
  socket.on('chat:system', (text) => {
    appendSystemMessage(text);
  });

  // Летящая реакция от другого зрителя
  socket.on('reaction:fly', ({ emoji }) => {
    launchReaction(emoji);
  });
}

// ==================== ОТОБРАЖЕНИЕ ====================
function updateUsersList(users) {
  $('viewersCount').textContent = users.length;
  const list = $('viewersList');
  list.innerHTML = '';

  users.slice(0, 5).forEach((u) => {
    const pill = document.createElement('div');
    pill.className = 'viewer-pill';
    pill.style.backgroundColor = u.color || '#3b82f6';
    pill.textContent = (u.name || '?').charAt(0).toUpperCase();
    pill.title = u.name;
    list.appendChild(pill);
  });
}

function appendChatMessage(msg) {
  const container = $('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg';

  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-user" style="color: ${msg.color}">${esc(msg.user)}</span>
      <span class="chat-msg-time">${msg.time}</span>
    </div>
    <div class="chat-msg-text">${esc(msg.text)}</div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(text) {
  const container = $('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-system-msg';
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Анимация летящих реакций
function launchReaction(emoji) {
  const overlay = $('reactionOverlay');
  const span = document.createElement('span');
  span.className = 'flying-emoji';
  span.textContent = emoji;

  // Случайное смещение по горизонтали от 15% до 85%
  const randomX = Math.floor(Math.random() * 70 + 15);
  span.style.left = `${randomX}%`;

  overlay.appendChild(span);

  setTimeout(() => {
    span.remove();
  }, 2800);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function showToast(message, icon = 'ℹ️') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = `${icon} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}
