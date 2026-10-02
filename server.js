const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 5000;

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use(express.static(__dirname)); // поддержка работы и из корня

// Получить локальный IP для отображения в консоли
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// Комнаты: roomId -> { videoId, state, currentTime, lastTimestamp, users: Map }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      videoId: 'jfKfPfyJRdk', // lofi hip hop радио по умолчанию
      state: 'paused',
      currentTime: 0,
      lastTimestamp: Date.now(),
      users: new Map()
    });
  }
  return rooms.get(roomId);
}

function calculateCurrentTime(room) {
  if (room.state === 'playing') {
    const elapsed = (Date.now() - room.lastTimestamp) / 1000;
    return room.currentTime + elapsed;
  }
  return room.currentTime;
}

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentUser = null;

  socket.on('room:join', ({ roomId, username, color }) => {
    currentRoomId = roomId;
    currentUser = {
      id: socket.id,
      name: username || 'Зритель',
      color: color || '#3b82f6'
    };

    socket.join(roomId);
    const room = getOrCreateRoom(roomId);
    room.users.set(socket.id, currentUser);

    // Отправляем текущему пользователю состояние комнаты
    const curTime = calculateCurrentTime(room);
    socket.emit('room:state', {
      videoId: room.videoId,
      state: room.state,
      currentTime: curTime,
      users: Array.from(room.users.values())
    });

    // Оповещаем остальных участников
    socket.to(roomId).emit('users:update', Array.from(room.users.values()));
    socket.to(roomId).emit('chat:system', `${currentUser.name} зашёл в комнату 👋`);
  });

  // Смена видео
  socket.on('video:change', ({ videoId }) => {
    if (!currentRoomId) return;
    const room = getOrCreateRoom(currentRoomId);
    room.videoId = videoId;
    room.state = 'playing';
    room.currentTime = 0;
    room.lastTimestamp = Date.now();

    io.to(currentRoomId).emit('video:change', {
      videoId,
      user: currentUser?.name || 'Кто-то'
    });
  });

  // Запуск видео (Play)
  socket.on('video:play', ({ time }) => {
    if (!currentRoomId) return;
    const room = getOrCreateRoom(currentRoomId);
    room.state = 'playing';
    room.currentTime = time;
    room.lastTimestamp = Date.now();

    socket.to(currentRoomId).emit('video:play', {
      time,
      user: currentUser?.name
    });
  });

  // Пауза (Pause)
  socket.on('video:pause', ({ time }) => {
    if (!currentRoomId) return;
    const room = getOrCreateRoom(currentRoomId);
    room.state = 'paused';
    room.currentTime = time;
    room.lastTimestamp = Date.now();

    socket.to(currentRoomId).emit('video:pause', {
      time,
      user: currentUser?.name
    });
  });

  // Перемотка (Seek)
  socket.on('video:seek', ({ time }) => {
    if (!currentRoomId) return;
    const room = getOrCreateRoom(currentRoomId);
    room.currentTime = time;
    room.lastTimestamp = Date.now();

    socket.to(currentRoomId).emit('video:seek', {
      time,
      user: currentUser?.name
    });
  });

  // Чат
  socket.on('chat:message', ({ text }) => {
    if (!currentRoomId || !text?.trim()) return;
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      user: currentUser?.name || 'Аноним',
      color: currentUser?.color || '#3b82f6',
      text: text.trim(),
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomId).emit('chat:message', msg);
  });

  // Реакции (летающие эмодзи)
  socket.on('reaction:send', ({ emoji }) => {
    if (!currentRoomId || !emoji) return;
    io.to(currentRoomId).emit('reaction:fly', {
      emoji,
      user: currentUser?.name || ''
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      room.users.delete(socket.id);

      if (room.users.size === 0) {
        // Если комната пуста более 1 часа, можно чистить
      } else {
        io.to(currentRoomId).emit('users:update', Array.from(room.users.values()));
        if (currentUser) {
          io.to(currentRoomId).emit('chat:system', `${currentUser.name} вышел из комнаты`);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`\n==============================================`);
  console.log(`🍿  WatchParty (Кинотеатр с друзьями) запущен!`);
  console.log(`💻 Локально на ПК: http://localhost:${PORT}`);
  console.log(`📱 В сети Wi-Fi:   http://${ip}:${PORT}`);
  console.log(`==============================================\n`);
});
