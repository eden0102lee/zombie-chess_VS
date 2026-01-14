# 離線訓練 AI 與整合指南（Zombie Chess Online）

本文件說明如何在**無網路**的環境離線訓練 AI，並把模型接回目前的多人連線遊戲架構。

## 1) 建立可批量模擬的規則引擎

目前規則主要在前端執行，因此訓練前需要抽出**純規則引擎**（無 UI）。
建議建立一個模組（例如 `ai/engine`），提供以下函式：

- `getLegalActions(state): Action[]`
- `applyAction(state, action): nextState`
- `isTerminal(state): boolean`
- `getWinner(state): 1 | 2 | null`

### 狀態資料建議格式
與目前前端 `stateUpdated` 使用的結構一致：

```json
{
  "board": [[/* 格子堆疊 */]],
  "scores": {"1": 0, "2": 0},
  "supply": {"1": {"L": 1, "M": 4, "S": 5}, "2": {"L": 1, "M": 4, "S": 5}},
  "turn": 1
}
```

> 重點：**訓練的狀態與線上遊戲的 state 必須一致**，後續才能無縫導入。

## 2) 方案 A：自我對弈強化學習（RL）一步一步流程

以下流程以**離線自我對弈**為主，建議先完成規則引擎，再循序推進資料收集、訓練與整合。

### Step 1：把前端規則抽成可模擬引擎

建立一個 headless 引擎（建議路徑 `ai/engine`），確保：

1. 所有合法動作都可枚舉（`getLegalActions`）。
2. 套用動作可產生新狀態（`applyAction`）。
3. 終局與勝負可判定（`isTerminal` / `getWinner`）。

### Step 2：定義動作編碼與狀態序列化

為了讓 RL 訓練可穩定運作，請先定義統一的 Action 格式與序列化方式，例如：

```json
{
  "type": "move|jump|revive",
  "from": [x, y],
  "to": [x, y],
  "stack": [/* 被選取的棋子序列 */]
}
```

並提供：

- `encodeState(state) -> tensor/array`
- `encodeAction(action) -> index`

### Step 3：建立自我對弈資料產生器

用規則引擎大量自我對弈，記錄：

```
(state, action, reward, next_state, done)
```

**獎勵建議**：

- 勝利：+1
- 失敗：-1
- 平局（若有）：0
- 中間過程可加入分數增減作 shaping（小幅度）

### Step 4：選擇一個 RL 訓練起點

建議從最容易落地的 **DQN** 或 **PPO** 開始：

- **DQN**：動作空間固定、離散時較好上手
- **PPO**：對大型動作空間較穩定

> 若動作數巨大，可先用 heuristic 限制合法動作數量，再逐步開放。

### Step 5：訓練與評估

離線訓練時請持續做**自我對弈評估**：

- 每 N 回合固定用舊模型 vs 新模型
- 記錄勝率與平均回合數
- 若勝率明顯提升再進行模型更新

### Step 6：模型匯出

建議優先用 `ONNX` 或 `JSON + 推論程式`：

- 跨語言部署：`ONNX`
- 輕量部署：`JSON + 推論程式`

## 3) 整合回遊戲（建議路線）

### 路線 1：AI 作為 Socket 客戶端（推薦入門）

建立一個 AI 程式（Node/Python），
使用 Socket.IO 連線伺服器，加入房間後當玩家 2。

事件流程：

1. `joinRoom` → 加入房間
2. `stateUpdated` → 收到狀態
3. `updateGame` → 回傳 AI 更新後的新狀態

### 路線 2：AI 內建在伺服器

在 `server.js` 中：

- 偵測單人模式
- 回合輪到 AI 時，直接呼叫推論函式
- 由伺服器送出 `stateUpdated`

## 4) 最小可行導入清單

1. **完成規則引擎與 Action 編碼**
2. **建立自我對弈資料產生器**
3. **完成一個 baseline（DQN/PPO）**
4. **輸出模型與推論程式**
5. **先以 Socket 客戶端接回遊戲**

---

如要開始實作 AI 客戶端或伺服器內建 AI，可先建立：

```
/ai
  /engine
  /models
  bot-client.js
```

並把推論點放在 `stateUpdated` / 回合切換處理。
