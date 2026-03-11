(function () {
    const DEFAULT_DIFFICULTY = "normal";

    const DIFFICULTY_PRESETS = {
        easy: {
            topK: 4,
            randomJitter: 18,
            opponentPressureWeight: 0.25,
            opponentSampleLimit: 8,
            secondPlyWeight: 0,
            mobilityWeight: 1.6,
            comboBonus: 18,
            moveBonus: 6,
            stackBonus: 16,
            jumpBaseBonus: 26,
            jumpScoreWeight: 18,
            jumpStackBaseBonus: 34,
            jumpStackScoreWeight: 16,
            sacrificePenalty: 32,
            reviveWeight: 10,
            emergencyDefensePenalty: 75,
            emptyJumpPenalty: 26,
            riskyJumpPenalty: 20,
            safeJumpBonus: 8,
            enemyImmediateScoreWeight: 22,
        },
        normal: {
            topK: 2,
            randomJitter: 10,
            opponentPressureWeight: 0.6,
            opponentSampleLimit: 18,
            secondPlyWeight: 0.18,
            mobilityWeight: 2.5,
            comboBonus: 35,
            moveBonus: 8,
            stackBonus: 28,
            jumpBaseBonus: 45,
            jumpScoreWeight: 30,
            jumpStackBaseBonus: 55,
            jumpStackScoreWeight: 26,
            sacrificePenalty: 20,
            reviveWeight: 14,
            emergencyDefensePenalty: 120,
            emptyJumpPenalty: 36,
            riskyJumpPenalty: 32,
            safeJumpBonus: 12,
            enemyImmediateScoreWeight: 28,
        },
        hard: {
            topK: 1,
            randomJitter: 4,
            opponentPressureWeight: 0.95,
            opponentSampleLimit: 40,
            secondPlyWeight: 0.32,
            mobilityWeight: 3.4,
            comboBonus: 52,
            moveBonus: 10,
            stackBonus: 36,
            jumpBaseBonus: 58,
            jumpScoreWeight: 38,
            jumpStackBaseBonus: 72,
            jumpStackScoreWeight: 34,
            sacrificePenalty: 48,
            reviveWeight: 18,
            emergencyDefensePenalty: 170,
            emptyJumpPenalty: 54,
            riskyJumpPenalty: 48,
            safeJumpBonus: 16,
            enemyImmediateScoreWeight: 36,
        },
    };

    class HeuristicAIAgent {
        constructor({ size, pieceVals, isAfterlife }) {
            this.size = size;
            this.pieceVals = pieceVals;
            this.isAfterlife = isAfterlife;
        }

        getDifficultyConfig(level) {
            return DIFFICULTY_PRESETS[level] || DIFFICULTY_PRESETS[DEFAULT_DIFFICULTY];
        }

        clonePiece(piece) {
            return {
                type: piece.type,
                val: piece.val,
                player: piece.player,
            };
        }

        cloneBoardState(srcBoard) {
            return srcBoard.map((row) =>
                row.map((stack) => stack.map((piece) => this.clonePiece(piece))),
            );
        }

        cloneSupplyState(srcSupply) {
            return {
                1: {
                    L: srcSupply[1].L,
                    M: srcSupply[1].M,
                    S: srcSupply[1].S,
                },
                2: {
                    L: srcSupply[2].L,
                    M: srcSupply[2].M,
                    S: srcSupply[2].S,
                },
            };
        }

        cloneMoveData(move) {
            return {
                ...move,
                victims: Array.isArray(move.victims)
                    ? move.victims.map((v) => ({ r: v.r, c: v.c }))
                    : [],
            };
        }

        cloneGameState(state) {
            return {
                board: this.cloneBoardState(state.board),
                scores: { 1: state.scores[1], 2: state.scores[2] },
                supply: this.cloneSupplyState(state.supply),
                turn: state.turn,
                isComboMode: !!state.isComboMode,
                selectedCell: state.selectedCell
                    ? { r: state.selectedCell.r, c: state.selectedCell.c }
                    : null,
                validMoves: (state.validMoves || []).map((m) => this.cloneMoveData(m)),
            };
        }

        getStackValue(stack) {
            return stack.reduce((sum, piece) => sum + piece.val, 0);
        }

        calcMovesForState(state, r, c) {
            const moves = [];
            const stack = state.board[r][c];
            if (!stack.length) return moves;

            const myVal = this.getStackValue(stack);
            const myBottomVal = stack[0].val;
            const p = state.turn;
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
                        nr < this.size &&
                        nc >= 0 &&
                        nc < this.size &&
                        !this.isAfterlife(nr, nc)
                    ) {
                        const target = state.board[nr][nc];
                        if (!target.length) {
                            moves.push({ r: nr, c: nc, type: "move" });
                        } else if (
                            target[0].player === p &&
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

                while (jr >= 0 && jr < this.size && jc >= 0 && jc < this.size) {
                    const tStack = state.board[jr][jc];
                    if (!tStack.length) {
                        if (Math.abs(jr - r) + Math.abs(jc - c) > 1 && myVal >= jumpedVal) {
                            moves.push({
                                r: jr,
                                c: jc,
                                type: this.isAfterlife(jr, jc) ? "sacrifice" : "jump",
                                score: enemyScore,
                                victims: victims.map((v) => ({ ...v })),
                            });
                        }
                        break;
                    }

                    const cellVal = this.getStackValue(tStack);
                    if (tStack[0].player === p) {
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
                                victims: victims.map((v) => ({ ...v })),
                            });
                        }
                    }

                    jumpedVal += cellVal;
                    if (tStack[0].player !== p) {
                        enemyScore += cellVal;
                        victims.push({ r: jr, c: jc });
                    }

                    jr += dr;
                    jc += dc;
                }
            });

            return moves;
        }

        getActionsForState(state) {
            const actions = [];
            const p = state.turn;

            if (!state.isComboMode) {
                ["L", "M", "S"].forEach((type) => {
                    if (state.supply[p][type] > 0) {
                        for (let r = 0; r < this.size; r++) {
                            for (let c = 0; c < this.size; c++) {
                                if (!this.isAfterlife(r, c) && state.board[r][c].length === 0) {
                                    actions.push({ kind: "revive", type, r, c });
                                }
                            }
                        }
                    }
                });
            }

            const candidates = [];
            if (state.isComboMode && state.selectedCell) {
                candidates.push(state.selectedCell);
            } else if (!state.isComboMode) {
                for (let r = 0; r < this.size; r++) {
                    for (let c = 0; c < this.size; c++) {
                        const stack = state.board[r][c];
                        if (stack.length && stack[0].player === p) candidates.push({ r, c });
                    }
                }
            }

            candidates.forEach((from) => {
                const moves = state.isComboMode
                    ? state.validMoves
                    : this.calcMovesForState(state, from.r, from.c);
                moves.forEach((moveData) => {
                    actions.push({
                        kind: "move",
                        from: { r: from.r, c: from.c },
                        to: { r: moveData.r, c: moveData.c },
                        moveData: this.cloneMoveData(moveData),
                    });
                });
            });

            return actions;
        }

        applyActionToState(baseState, action) {
            const state = this.cloneGameState(baseState);
            const p = state.turn;
            const enemy = p === 1 ? 2 : 1;

            const endTurn = () => {
                state.turn = enemy;
                state.isComboMode = false;
                state.selectedCell = null;
                state.validMoves = [];
            };

            if (action.kind === "revive") {
                const { type, r, c } = action;
                if (
                    state.supply[p][type] > 0 &&
                    !this.isAfterlife(r, c) &&
                    state.board[r][c].length === 0
                ) {
                    state.supply[p][type] -= 1;
                    state.board[r][c].push({
                        type,
                        val: this.pieceVals[type],
                        player: p,
                    });
                    endTurn();
                }
                return state;
            }

            if (action.kind !== "move") return state;

            const move = action.moveData;
            const sr = action.from.r;
            const sc = action.from.c;
            const mover = state.board[sr][sc].map((piece) => this.clonePiece(piece));
            if (!mover.length) return state;

            if (["jump", "sacrifice", "jump-stack"].includes(move.type)) {
                (move.victims || []).forEach((v) => {
                    const victimStack = state.board[v.r][v.c];
                    victimStack.forEach((piece) => {
                        state.supply[piece.player][piece.type] += 1;
                    });
                    state.board[v.r][v.c] = [];
                });
                state.scores[p] += move.score || 0;
            }

            state.board[sr][sc] = [];

            if (move.type === "sacrifice") {
                mover.forEach((piece) => {
                    state.supply[piece.player][piece.type] += 1;
                });
                endTurn();
                return state;
            }

            if (move.type === "jump-stack") {
                state.board[move.r][move.c].push(...mover);
                endTurn();
                return state;
            }

            if (move.type === "stack") {
                state.board[move.r][move.c].push(...mover);
                endTurn();
                return state;
            }

            state.board[move.r][move.c] = mover;

            if (move.type === "jump") {
                const nextMoves = this.calcMovesForState(state, move.r, move.c).filter(
                    (nm) =>
                        nm.type === "jump" ||
                        nm.type === "sacrifice" ||
                        nm.type === "jump-stack",
                );
                if (nextMoves.length > 0) {
                    state.isComboMode = true;
                    state.selectedCell = { r: move.r, c: move.c };
                    state.validMoves = nextMoves.map((nm) => this.cloneMoveData(nm));
                    return state;
                }
            }

            endTurn();
            return state;
        }

        getPositionalScore(state, playerNum) {
            let score = 0;
            for (let r = 0; r < this.size; r++) {
                for (let c = 0; c < this.size; c++) {
                    const stack = state.board[r][c];
                    if (!stack.length || stack[0].player !== playerNum) continue;
                    const stackVal = this.getStackValue(stack);
                    const centerDist = Math.abs(r - 3) + Math.abs(c - 3);
                    score += stackVal * 10;
                    score += Math.max(0, 5 - centerDist);
                    score += stack[stack.length - 1].val * 2;
                }
            }
            return score;
        }

        evaluateState(state, perspective, cfg) {
            const enemy = perspective === 1 ? 2 : 1;
            const scoreDiff = (state.scores[perspective] - state.scores[enemy]) * 120;
            const boardDiff =
                this.getPositionalScore(state, perspective) -
                this.getPositionalScore(state, enemy);
            const supplyDiff =
                ((state.supply[perspective].L - state.supply[enemy].L) * 10 +
                    (state.supply[perspective].M - state.supply[enemy].M) * 7 +
                    (state.supply[perspective].S - state.supply[enemy].S) * 4) *
                2;

            const myMobility = this.getActionsForState({
                ...this.cloneGameState(state),
                turn: perspective,
                isComboMode: false,
                selectedCell: null,
                validMoves: [],
            }).length;

            const enemyMobility = this.getActionsForState({
                ...this.cloneGameState(state),
                turn: enemy,
                isComboMode: false,
                selectedCell: null,
                validMoves: [],
            }).length;

            const mobilityDiff = (myMobility - enemyMobility) * cfg.mobilityWeight;
            return scoreDiff + boardDiff + supplyDiff + mobilityDiff;
        }

        evaluateAction(state, action, cfg) {
            const p = state.turn;
            const enemy = p === 1 ? 2 : 1;
            const nextState = this.applyActionToState(state, action);

            if (nextState.scores[p] >= 8) return 999999;

            let value = this.evaluateState(nextState, p, cfg);

            if (action.kind === "move") {
                const t = action.moveData.type;
                const gain = action.moveData.score || 0;
                if (t === "jump") value += cfg.jumpBaseBonus + gain * cfg.jumpScoreWeight;
                if (t === "jump-stack") {
                    value += cfg.jumpStackBaseBonus + gain * cfg.jumpStackScoreWeight;
                }
                if (t === "stack") value += cfg.stackBonus;
                if (t === "move") value += cfg.moveBonus;
                if (t === "sacrifice") value -= cfg.sacrificePenalty;

                // 避免 AI 做無意義跳躍：沒得分、沒連跳，且會把先手讓給對手
                if (t === "jump" && gain <= 0 && !nextState.isComboMode && nextState.turn === enemy) {
                    value -= cfg.emptyJumpPenalty;
                }
            } else if (action.kind === "revive") {
                value += this.pieceVals[action.type] * cfg.reviveWeight;
            }

            if (nextState.turn === enemy) {
                const oppActions = this.getActionsForState(nextState);
                let oppBest = -Infinity;
                let oppBestAction = null;
                let oppImmediateGain = 0;
                const sample = oppActions.slice(0, cfg.opponentSampleLimit);
                sample.forEach((oppAction) => {
                    const afterOpp = this.applyActionToState(nextState, oppAction);
                    const oppScore = this.evaluateState(afterOpp, enemy, cfg);
                    if (oppScore > oppBest) {
                        oppBest = oppScore;
                        oppBestAction = oppAction;
                    }

                    if (oppAction.kind === "move") {
                        oppImmediateGain = Math.max(
                            oppImmediateGain,
                            oppAction.moveData?.score || 0,
                        );
                    }
                });

                if (oppBest > -Infinity) {
                    value -= oppBest * cfg.opponentPressureWeight;
                }

                // 風險評估：若對手立刻有高分跳躍，額外降權
                value -= oppImmediateGain * cfg.enemyImmediateScoreWeight;

                // hard/normal 提升思考強度：模擬對手最佳應手後，我方回應品質
                if (
                    cfg.secondPlyWeight > 0 &&
                    oppBestAction &&
                    oppActions.length > 0
                ) {
                    const afterOppBest = this.applyActionToState(nextState, oppBestAction);
                    const myReplyActions = this
                        .getActionsForState(afterOppBest)
                        .slice(0, cfg.opponentSampleLimit);
                    let myReplyBest = -Infinity;
                    myReplyActions.forEach((myReply) => {
                        const afterMyReply = this.applyActionToState(afterOppBest, myReply);
                        const myReplyScore = this.evaluateState(afterMyReply, p, cfg);
                        if (myReplyScore > myReplyBest) myReplyBest = myReplyScore;
                    });

                    if (myReplyBest > -Infinity) {
                        value += myReplyBest * cfg.secondPlyWeight;
                    }
                }
            } else if (nextState.isComboMode) {
                value += cfg.comboBonus;
            }

            if (action.kind === "move" && action.moveData.type === "jump") {
                if (nextState.turn === enemy) {
                    value -= cfg.riskyJumpPenalty;
                } else {
                    value += cfg.safeJumpBonus;
                }
            }

            if (nextState.scores[enemy] >= 7 && nextState.turn === enemy) {
                value -= cfg.emergencyDefensePenalty;
            }

            value += (Math.random() - 0.5) * cfg.randomJitter;
            return value;
        }

        chooseAction(rawState, difficulty = DEFAULT_DIFFICULTY) {
            const cfg = this.getDifficultyConfig(difficulty);
            const state = this.cloneGameState(rawState);
            const actions = this.getActionsForState(state);
            if (!actions.length) return null;

            actions.forEach((action) => {
                action.finalScore = this.evaluateAction(state, action, cfg);
            });

            actions.sort((a, b) => b.finalScore - a.finalScore);
            const topK = Math.min(actions.length, cfg.topK);
            const picked = actions[Math.floor(Math.random() * topK)];
            return JSON.parse(JSON.stringify(picked));
        }
    }

    window.ZombieChessAI = {
        HeuristicAIAgent,
        DIFFICULTY_PRESETS,
        DEFAULT_DIFFICULTY,
    };
})();