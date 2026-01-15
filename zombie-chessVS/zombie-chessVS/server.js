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
const SIZE = 7;
const PIECE_VALS = { L: 3, M: 2, S: 1 };
const MAX_PIECES = { L: 1, M: 4, S: 5 };

const isAfterlife = (r, c) => r === 0 || r === SIZE - 1 || c === 0 || c === SIZE - 1;

const getStackVal = (stack) => stack.reduce((a, b) => a + b.val, 0);

const getStackLabel = (stack) => stack.map((p) => p.type).join("");

const formatCell = (r, c) => `(${r + 1}, ${c + 1})`;

const formatPlayerShort = (playerNum) =>
    `<span class="log-player p${playerNum}">P${playerNum}</span>`;

const resetSelection = (state) => {
    state.selectedCell = null;
    state.reviveSelection = null;
    state.validMoves = [];
};

const enterComboWaitState = (state) => {
    state.selectedCell = null;
    state.validMoves = [];
    state.isComboMode = true;
};

const endTurn = (state) => {
    state.currentTurn = state.currentTurn === 1 ? 2 : 1;
    state.isComboMode = false;
    resetSelection(state);
};

const evaluateWinner = (state) => {
    if (state.scores[1] >= 8) return 1;
    if (state.scores[2] >= 8) return 2;
    return null;
};

const initGameState = () => {
    const board = Array.from({ length: SIZE }, () =>
        Array.from({ length: SIZE }, () => []),
    );
    const layout = [
        { r: 1, row: [2, 0, 3, 0, 2], p: 2 },
        { r: 2, row: [1, 1, 1, 1, 1], p: 2 },
        { r: 4, row: [1, 1, 1, 1, 1], p: 1 },
        { r: 5, row: [2, 0, 3, 0, 2], p: 1 },
    ];
    const used = { 1: { L: 0, M: 0, S: 0 }, 2: { L: 0, M: 0, S: 0 } };
    layout.forEach((cfg) => {
        cfg.row.forEach((val, cIdx) => {
            if (val > 0) {
                const type = val === 3 ? "L" : val === 2 ? "M" : "S";
                board[cfg.r][cIdx + 1].push({
                    type,
                    val,
                    player: cfg.p,
                });
                used[cfg.p][type] += 1;
            }
        });
    });
    const supply = { 1: {}, 2: {} };
    [1, 2].forEach((p) => {
        for (const k in MAX_PIECES) {
            supply[p][k] = MAX_PIECES[k] - used[p][k];
        }
    });
    return {
        board,
        scores: { 1: 0, 2: 0 },
        supply,
        currentTurn: 1,
        selectedCell: null,
        reviveSelection: null,
        validMoves: [],
        isComboMode: false,
        isGameOver: false,
        winner: null,
    };
};

const calcMoves = (state, r, c) => {
    const moves = [];
    const stack = state.board[r][c];
    if (stack.length === 0) return [];
    const myVal = getStackVal(stack);
    const myBottomVal = stack[0].val;
    const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
    ];

    dirs.forEach(([dr, dc]) => {
        if (!state.isComboMode) {
            const nr = r + dr;
            const nc = c + dc;
            if (
                nr >= 0 &&
                nr < SIZE &&
                nc >= 0 &&
                nc < SIZE &&
                !isAfterlife(nr, nc)
            ) {
                const target = state.board[nr][nc];
                if (target.length === 0) {
                    moves.push({ r: nr, c: nc, type: "move" });
                } else if (
                    target[0].player === state.currentTurn &&
                    myBottomVal < target[target.length - 1].val
                ) {
                    moves.push({ r: nr, c: nc, type: "stack" });
                }
            }
        }

        let jr = r + dr;
        let jc = c + dc;
        let enemyScore = 0;
        let jumpedVal = 0;
        const victims = [];

        while (jr >= 0 && jr < SIZE && jc >= 0 && jc < SIZE) {
            const tStack = state.board[jr][jc];

            if (tStack.length === 0) {
                if (
                    Math.abs(jr - r) + Math.abs(jc - c) > 1 &&
                    myVal >= jumpedVal
                ) {
                    const isSacrifice = isAfterlife(jr, jc);
                    moves.push({
                        r: jr,
                        c: jc,
                        type: isSacrifice ? "sacrifice" : "jump",
                        score: enemyScore,
                        victims: [...victims],
                    });
                }
                break;
            }

            const cellVal = getStackVal(tStack);

            if (tStack[0].player === state.currentTurn) {
                if (
                    Math.abs(jr - r) + Math.abs(jc - c) > 1 &&
                    myVal >= jumpedVal &&
                    myBottomVal < tStack[tStack.length - 1].val
                ) {
                    moves.push({
                        r: jr,
                        c: jc,
                        type: "jump-stack",
                        score: enemyScore,
                        victims: [...victims],
                    });
                }
            }

            jumpedVal += cellVal;

            if (tStack[0].player !== state.currentTurn) {
                enemyScore += cellVal;
                victims.push({ r: jr, c: jc });
            }

            jr += dr;
            jc += dc;
        }
    });

    return moves;
};

const applyMove = (state, move) => {
    if (!state.selectedCell) {
        return null;
    }
    const { r: sr, c: sc } = state.selectedCell;
    const mover = state.board[sr][sc];
    const moverLabel = getStackLabel(mover);
    const playerLabel = formatPlayerShort(state.currentTurn);
    const actionBase = `${playerLabel} ${moverLabel} ${formatCell(sr, sc)}→`;

    if (["jump", "sacrifice", "jump-stack"].includes(move.type)) {
        move.victims.forEach((v) => {
            state.board[v.r][v.c].forEach((p) => {
                state.supply[p.player][p.type] += 1;
            });
            state.board[v.r][v.c] = [];
        });
        state.scores[state.currentTurn] += move.score;
    }
    state.board[sr][sc] = [];

    if (move.type === "sacrifice") {
        mover.forEach((p) => {
            state.supply[p.player][p.type] += 1;
        });
        enterComboWaitState(state);
        return `${actionBase}${formatCell(move.r, move.c)} 捨身 +${move.score}`;
    }
    if (move.type === "jump-stack") {
        state.board[move.r][move.c].push(...mover);
        enterComboWaitState(state);
        return `${actionBase}${formatCell(move.r, move.c)} 跳疊 +${move.score}`;
    }

    if (move.type === "stack") {
        state.board[move.r][move.c].push(...mover);
    } else {
        state.board[move.r][move.c] = mover;
    }

    if (move.type === "jump") {
        const nextMoves = calcMoves(state, move.r, move.c).filter((nm) =>
            ["jump", "sacrifice", "jump-stack"].includes(nm.type),
        );
        if (nextMoves.length > 0) {
            state.isComboMode = true;
            state.selectedCell = { r: move.r, c: move.c };
            state.validMoves = nextMoves;
            return `${actionBase}${formatCell(move.r, move.c)} 跳 +${move.score}`;
        }
    }

    endTurn(state);
    return `${actionBase}${formatCell(move.r, move.c)} ${
        move.type === "move"
            ? "移動"
            : move.type === "stack"
              ? "堆疊"
              : `跳 +${move.score}`
    }`;
};

const buildStatePayload = (state) => ({
    board: state.board,
    scores: state.scores,
    supply: state.supply,
    turn: state.currentTurn,
    selectedCell: state.selectedCell,
    validMoves: state.validMoves,
    isComboMode: state.isComboMode,
    reviveSelection: state.reviveSelection,
    isGameOver: state.isGameOver,
    winner: state.winner,
});

const getPlayerNum = (room, socketId) => {
    const player = room.players.find((p) => p.id === socketId);
    return player?.num || null;
};

const canControlPlayer = (room, playerNum, socketId) => {
    if (isSoloMode(room.mode)) {
        return room.hostPlayerId && room.hostPlayerId === socketId;
    }
    return getPlayerNum(room, socketId) === playerNum;
};

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
                gameState: initGameState(),
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
            if (room.gameState) {
                socket.emit("stateUpdated", buildStatePayload(room.gameState));
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
        if (room.gameState) {
            socket.emit("stateUpdated", buildStatePayload(room.gameState));
        }

        emitRoomList();

        if (isSoloMode(room.mode)) {
            io.to(roomId).emit("gameStart", { msg: "單人模式開始！" });
        } else if (room.players.length === 2) {
            io.to(roomId).emit("gameStart", { msg: "遊戲開始！" });
        }
    });

    // 2. 接收玩家操作，伺服器統一處理
    socket.on("gameAction", ({ roomId, action }) => {
        const room = rooms[roomId];
        if (!room || !room.gameState || !action) return;
        const state = room.gameState;

        if (state.isGameOver) {
            socket.emit("stateUpdated", buildStatePayload(state));
            return;
        }

        const playerNum = getPlayerNum(room, socket.id);
        const canActOnTurn = canControlPlayer(
            room,
            state.currentTurn,
            socket.id,
        );

        const sendUpdate = (message) => {
            const winner = evaluateWinner(state);
            if (winner) {
                state.isGameOver = true;
                state.winner = winner;
            }
            if (message) {
                io.to(roomId).emit("playerAction", { message });
            }
            io.to(roomId).emit("stateUpdated", buildStatePayload(state));
        };

        if (!canActOnTurn) {
            socket.emit("errorMsg", "現在不是你的回合");
            return;
        }

        switch (action.type) {
            case "selectCell": {
                if (state.isComboMode) return;
                const { r, c } = action;
                if (
                    r == null ||
                    c == null ||
                    r < 0 ||
                    r >= SIZE ||
                    c < 0 ||
                    c >= SIZE
                )
                    return;
                const stack = state.board[r][c];
                if (stack.length === 0 || stack[0].player !== state.currentTurn)
                    return;
                if (
                    state.selectedCell &&
                    state.selectedCell.r === r &&
                    state.selectedCell.c === c
                ) {
                    resetSelection(state);
                } else {
                    state.selectedCell = { r, c };
                    state.reviveSelection = null;
                    state.validMoves = calcMoves(state, r, c);
                }
                sendUpdate();
                break;
            }
            case "performMove": {
                const { r, c } = action;
                if (r == null || c == null) return;
                const move = state.validMoves.find(
                    (m) => m.r === r && m.c === c,
                );
                if (!move) return;
                const message = applyMove(state, move);
                sendUpdate(message);
                break;
            }
            case "reviveSelect": {
                if (state.isComboMode) return;
                const { pieceType } = action;
                if (!pieceType || !state.supply[state.currentTurn][pieceType])
                    return;
                state.reviveSelection = pieceType;
                state.selectedCell = null;
                state.validMoves = [];
                sendUpdate();
                break;
            }
            case "revivePlace": {
                const { r, c } = action;
                if (!state.reviveSelection) return;
                if (r == null || c == null) return;
                if (isAfterlife(r, c)) return;
                if (state.board[r][c].length > 0) return;
                const type = state.reviveSelection;
                if (state.supply[state.currentTurn][type] <= 0) return;
                state.supply[state.currentTurn][type] -= 1;
                state.board[r][c].push({
                    type,
                    val: PIECE_VALS[type],
                    player: state.currentTurn,
                });
                const message = `${formatPlayerShort(
                    state.currentTurn,
                )} 復活 ${type} → ${formatCell(r, c)}`;
                endTurn(state);
                sendUpdate(message);
                break;
            }
            case "endTurn": {
                if (!state.isComboMode) return;
                const message = `${formatPlayerShort(
                    state.currentTurn,
                )} 回合結束`;
                endTurn(state);
                sendUpdate(message);
                break;
            }
            default:
                break;
        }
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
