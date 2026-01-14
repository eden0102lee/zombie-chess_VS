const modeCards = Array.from(document.querySelectorAll("[data-mode-card]"));
const modeTitle = document.querySelector("[data-mode-title]");
const modeSummary = document.querySelector("[data-mode-summary]");
const statusList = document.querySelector("[data-status-list]");
const timelineList = document.querySelector("[data-timeline-list]");

const modeContent = {
    pve: {
        title: "玩家 VS 電腦",
        summary:
            "提供可自訂難度的本地 AI 對手，適合測試棋盤規則與操作節奏。",
        status: ["棋盤與回合邏輯", "AI 決策接口", "本地回放"],
        timeline: [
            "加入 AI 行為樹 / 搜尋策略接口",
            "設計難度檔與行為權重",
            "製作對局紀錄輸出（供訓練使用）",
        ],
    },
    evs: {
        title: "電腦 VS 電腦",
        summary:
            "快速跑多場對局觀察策略差異，支援批次模擬與統計。",
        status: ["雙 AI 引擎槽位", "模擬速度控制", "對局統計"],
        timeline: [
            "建立批次排程器",
            "整合勝率 / 分數輸出",
            "儲存對局資料供訓練" ,
        ],
    },
    training: {
        title: "AI 訓練",
        summary:
            "預留訓練流程與資料管線，將對局資料整理成可供模型使用的格式。",
        status: ["資料標記格式", "特徵輸出介面", "訓練資料集管理"],
        timeline: [
            "設定訓練資料 schema",
            "加入資料匯出與版本控制",
            "串接外部訓練流程" ,
        ],
    },
};

const renderList = (list, items) => {
    list.innerHTML = "";
    items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
    });
};

const setActiveMode = (modeKey) => {
    modeCards.forEach((card) => {
        card.classList.toggle("active", card.dataset.modeCard === modeKey);
    });
    const data = modeContent[modeKey];
    if (!data) return;
    modeTitle.textContent = data.title;
    modeSummary.textContent = data.summary;
    renderList(statusList, data.status);
    renderList(timelineList, data.timeline);
};

modeCards.forEach((card) => {
    card.addEventListener("click", () => {
        setActiveMode(card.dataset.modeCard);
    });
    const btn = card.querySelector("button");
    if (btn) {
        btn.addEventListener("click", (event) => {
            event.stopPropagation();
            setActiveMode(card.dataset.modeCard);
        });
    }
});

setActiveMode("pve");
