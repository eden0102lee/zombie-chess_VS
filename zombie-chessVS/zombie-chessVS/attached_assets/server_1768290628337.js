const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允許跨域，解決連線問題
        methods: ["GET", "POST"]
    }
});

// 提供靜態檔案 (HTML, CSS)
app.use(express.static(path.join(__dirname, 'public')));

// ★★★ 關鍵修正 1：明確定義根目錄路由，回應健康檢查 ★★★
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 另外增加一個專門的 health check API，有些平台會找這個
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 遊戲房間狀態
const rooms = {};

io.on('connection', (socket) => {
    console.log('一位使用者連線:', socket.id);

    // 1. 玩家加入房間
    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                boardState: null,
                currentTurn: 1
            };
        }

        const room = rooms[roomId];

        // 檢查重複加入
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (existingPlayer) {
             socket.emit('playerAssigned', { playerNum: existingPlayer.num, roomId });
             if (room.boardState) {
                socket.emit('stateUpdated', {
                    board: room.boardState.board,
                    scores: room.boardState.scores,
                    supply: room.boardState.supply,
                    turn: room.currentTurn
                });
             }
             return;
        }

        if (room.players.length >= 2) {
            socket.emit('errorMsg', '房間已滿');
            return;
        }

        const playerNum = room.players.length + 1;
        room.players.push({ id: socket.id, num: playerNum });
        socket.join(roomId);

        console.log(`玩家 ${socket.id} 加入房間 ${roomId} 作為 P${playerNum}`);

        socket.emit('playerAssigned', { playerNum, roomId });

        // 補發狀態給後加入者
        if (room.boardState) {
            socket.emit('stateUpdated', {
                board: room.boardState.board,
                scores: room.boardState.scores,
                supply: room.boardState.supply,
                turn: room.currentTurn
            });
        }

        if (room.players.length === 2) {
            io.to(roomId).emit('gameStart', { msg: '遊戲開始！' });
        }
    });

    // 2. 接收玩家更新
    socket.on('updateGame', ({ roomId, newState }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.boardState = newState;
        room.currentTurn = newState.turn; // 直接信任前端傳來的回合 (因為前端有處理連跳邏輯)

        // 廣播給房間內所有人
        io.to(roomId).emit('stateUpdated', {
            board: newState.board,
            scores: newState.scores,
            supply: newState.supply,
            turn: newState.turn
        });
    });

    // 3. 斷線處理
    socket.on('disconnect', () => {
        console.log('使用者斷線:', socket.id);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                io.to(roomId).emit('playerDisconnected');
                delete rooms[roomId]; 
                break;
            }
        }
    });
});

// ★★★ 關鍵修正 2：Port 設定與 Host 綁定 ★★★
// Replit 或 Render 會自動注入 process.env.PORT (通常是 3000, 5000, 8080 等)
const PORT = process.env.PORT || 3000;

// 重要：綁定 '0.0.0.0' 讓外部可以連線
server.listen(PORT, '0.0.0.0', () => {
    console.log(`伺服器啟動中，監聽 Port: ${PORT}`);
});