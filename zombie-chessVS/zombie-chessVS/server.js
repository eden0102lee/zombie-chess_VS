const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { execSync } = require("child_process");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允許跨域，解決連線問題
        methods: ["GET", "POST"],
    },
});

const gitVersion = (() => {
    try {
        return execSync("git rev-parse --short HEAD", { cwd: __dirname })
            .toString()
            .trim();
    } catch (error) {
        console.warn("無法取得 git 版本資訊:", error.message);
        return "unknown";
    }
})();

// 提供靜態檔案 (HTML, CSS)
app.use(express.static(path.join(__dirname, "public")));

// ★★★ 關鍵修正 1：明確定義根目錄路由，回應健康檢查 ★★★
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/test", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "test", "index.html"));
});

// 另外增加一個專門的 health check API，有些平台會找這個
app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

app.get("/version", (req, res) => {
    res.status(200).json({ version: gitVersion });
});

// 遊戲房間狀態
const rooms = {};
const RECONNECT_WINDOW_MS = 60 * 1000;
const SOLO_MODES = new Set(["solo", "sim-bots", "bots-vs-bots"]);
const isSoloMode = (mode) => SOLO_MODES.has(mode);

const cleanupRoomPlayers = (room) => {
    const now = Date.now();
    room.players = room.players.filter(
        (player) =>
            !player.disconnectedAt ||
            now - player.disconnectedAt < RECONNECT_WINDOW_MS,
    );
};

const cleanupRooms = () => {
    Object.entries(rooms).forEach(([roomId, room]) => {
        cleanupRoomPlayers(room);
        if (room.players.length === 0) {
            delete rooms[roomId];
        }
    });
};

const buildRoomList = () => {
    cleanupRooms();
    return Object.entries(rooms).map(([roomId, room]) => ({
        roomId,
        players: room.players.length,
        mode: room.mode,
        maxPlayers: isSoloMode(room.mode) ? 1 : 2,
        canJoin: !isSoloMode(room.mode) && room.players.length < 2,
    }));
};

const emitRoomList = () => {
    io.emit("roomsUpdated", buildRoomList());
};

const emitPlayerList = (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit(
        "playerListUpdated",
        room.players.map((player) => ({
            num: player.num,
            nickname: player.nickname || "",
        })),
    );
};

io.on("connection", (socket) => {
    console.log("一位使用者連線:", socket.id);

    socket.emit("roomsUpdated", buildRoomList());

    socket.on("getRooms", () => {
        socket.emit("roomsUpdated", buildRoomList());
    });

    // 1. 玩家加入房間
    socket.on("joinRoom", (payload) => {
        const roomId =
            typeof payload === "string" ? payload : payload?.roomId;
        const requestedMode =
            typeof payload === "string" ? "multi" : payload?.mode || "multi";
        const action = typeof payload === "string" ? "join" : payload?.action;
        const playerId =
            typeof payload === "string" ? null : payload?.playerId || null;
        const nickname =
            typeof payload === "string" ? "" : payload?.nickname?.trim() || "";
        if (!roomId) {
            socket.emit("errorMsg", "房間號碼無效");
            return;
        }
        const resolvedPlayerId = playerId || socket.id;

        if (!rooms[roomId] && action === "join") {
            socket.emit("errorMsg", "房間不存在，請重新整理列表");
            return;
        }

        if (rooms[roomId] && action === "create") {
            socket.emit("errorMsg", "房間已存在，請改用加入");
            return;
        }

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                boardState: null,
                currentTurn: 1,
                mode: requestedMode,
                hostPlayerId: null,
            };
        }

        const room = rooms[roomId];
        if (isSoloMode(room.mode) && requestedMode !== room.mode) {
            socket.emit("errorMsg", "房間模式不符");
            return;
        }
        if (!isSoloMode(room.mode) && isSoloMode(requestedMode)) {
            socket.emit("errorMsg", "房間模式不符");
            return;
        }

        cleanupRoomPlayers(room);

        if (
            isSoloMode(room.mode) &&
            room.hostPlayerId &&
            room.hostPlayerId !== resolvedPlayerId
        ) {
            socket.emit("errorMsg", "此房間為單人房間，無法加入");
            return;
        }

        if (!room.players.length && action === "join") {
            socket.emit("errorMsg", "房間尚未建立完成");
            return;
        }

        // 檢查重複加入
        const existingPlayer = room.players.find(
            (p) => p.playerId === resolvedPlayerId,
        );
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.connected = true;
            existingPlayer.disconnectedAt = null;
            existingPlayer.nickname = nickname;
            socket.join(roomId);
            socket.emit("playerAssigned", {
                playerNum: existingPlayer.num,
                roomId,
                roomMode: room.mode,
                isSoloHost:
                    isSoloMode(room.mode) &&
                    room.hostPlayerId === resolvedPlayerId,
            });
            emitPlayerList(roomId);
            if (room.boardState) {
                socket.emit("stateUpdated", {
                    board: room.boardState.board,
                    scores: room.boardState.scores,
                    supply: room.boardState.supply,
                    turn: room.currentTurn,
                });
            }
            return;
        }

        if (room.players.length >= 2) {
            socket.emit("errorMsg", "房間已滿");
            return;
        }

        if (isSoloMode(room.mode)) {
            room.hostPlayerId = resolvedPlayerId;
        }

        const playerNum = room.players.length + 1;
        room.players.push({
            id: socket.id,
            num: playerNum,
            playerId: resolvedPlayerId,
            nickname,
            connected: true,
            disconnectedAt: null,
        });
        socket.join(roomId);

        console.log(
            `玩家 ${resolvedPlayerId} (${socket.id}) 加入房間 ${roomId} 作為 P${playerNum}`,
        );

        socket.emit("playerAssigned", {
            playerNum,
            roomId,
            roomMode: room.mode,
            isSoloHost:
                isSoloMode(room.mode) &&
                room.hostPlayerId === resolvedPlayerId,
        });

        emitPlayerList(roomId);
        // 補發狀態給後加入者
        if (room.boardState) {
            socket.emit("stateUpdated", {
                board: room.boardState.board,
                scores: room.boardState.scores,
                supply: room.boardState.supply,
                turn: room.currentTurn,
            });
        }

        emitRoomList();

        if (isSoloMode(room.mode)) {
            io.to(roomId).emit("gameStart", { msg: "單人模式開始！" });
        } else if (room.players.length === 2) {
            io.to(roomId).emit("gameStart", { msg: "遊戲開始！" });
        }
    });

    // 2. 接收玩家更新
    socket.on("updateGame", ({ roomId, newState }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.boardState = newState;

        // ★★★ 修正點：伺服器不再自動切換回合，而是信任前端傳來的 newState.turn ★★★
        // 這樣可以支援「連跳」過程中，更新棋盤但不換手
        room.currentTurn = newState.turn;

        // 廣播給房間內所有人
        io.to(roomId).emit("stateUpdated", {
            board: newState.board,
            scores: newState.scores,
            supply: newState.supply,
            turn: newState.turn,
        });
    });

    socket.on("playerAction", ({ roomId, message }) => {
        if (!rooms[roomId]) return;
        io.to(roomId).emit("playerAction", { message });
    });

    // 3. 斷線處理
    socket.on("disconnect", () => {
        console.log("使用者斷線:", socket.id);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const player = room.players.find((p) => p.id === socket.id);
            if (player) {
                player.connected = false;
                player.disconnectedAt = Date.now();
                player.id = null;
                io.to(roomId).emit("playerDisconnected", {
                    nickname: player.nickname || `P${player.num}`,
                    playerNum: player.num,
                    countdownSeconds: Math.ceil(RECONNECT_WINDOW_MS / 1000),
                });
                emitRoomList();
                setTimeout(() => {
                    const latestRoom = rooms[roomId];
                    if (!latestRoom) return;
                    cleanupRoomPlayers(latestRoom);
                    if (latestRoom.players.length === 0) {
                        delete rooms[roomId];
                    }
                    emitRoomList();
                }, RECONNECT_WINDOW_MS + 500);
                break;
            }
        }
    });
});

// ★★★ 關鍵修正 2：Port 設定與 Host 綁定 ★★★
// Replit 或 Render 會自動注入 process.env.PORT (通常是 3000, 5000, 8080 等)
const PORT = process.env.PORT || 3000;

// 重要：綁定 '0.0.0.0' 讓外部可以連線
server.listen(PORT, "0.0.0.0", () => {
    console.log(`伺服器啟動中，監聽 Port: ${PORT}`);
});
