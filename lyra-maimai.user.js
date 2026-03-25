// ==UserScript==
// @name         Lyra Maimai 数据捕获
// @description  用于捕获「电棍」版本的舞萌数据
// @version      1.1.1
// @author       GoldSheep3 with Gemini
// @match        https://*/maimai/music
// @match        https://*/maimai/music?*
// @updateURL    https://github.com/goldsheep3/utilities/raw/refs/heads/master/lyra-maimai.user.js
// @downloadURL  https://github.com/goldsheep3/utilities/raw/refs/heads/master/lyra-maimai.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    let dataMap = new Map();

    // 提取文件名并清洗，统一 standard 为 std
    const getImgName = (src) => {
        if (!src) return "";
        let name = src.split('/').pop().replace(/\.[^/.]+$/, "");
        name = name.replace('music_icon_', '').replace('music_', '').replace('diff_', '');
        return name === 'standard' ? 'std' : name;
    };

    const RANK_WEIGHT = {
        combo: { "fc": 1, "fcp": 2, "ap": 3, "app": 4 },
        sync: { "fs": 1, "fsp": 2, "fdx": 3, "fdxp": 4 }
    };

    const getWeight = (type, name) => RANK_WEIGHT[type][name] || 0;

    // --- 1. 核心捕获逻辑 ---
    function captureCurrentVisibleItems() {
        const playlogItems = document.querySelectorAll('.n-list-item');
        const tileItems = document.querySelectorAll('.tile');
        let updateCount = 0;

        const processItem = (raw, isPlaylog) => {
            if (!raw || !raw.title) return;

            // 统一类型命名
            const typeKey = raw.type === 'standard' ? 'std' : raw.type;
            const sheetId = `${raw.title}__dxrt__${typeKey}__dxrt__${raw.diff}`;

            // 直接以 sheetId 作为 Key 获取旧数据
            const old = dataMap.get(sheetId) || { achievement: 0, dxscore: 0, combo: "", sync: "", play_time: "" };

            // 择优判定
            const isAchvBetter = raw.achievement > old.achievement;
            const isDxBetter = (raw.dxscore || 0) > old.dxscore;
            const isComboBetter = getWeight('combo', raw.combo) > getWeight('combo', old.combo);
            const isSyncBetter = getWeight('sync', raw.sync) > getWeight('sync', old.sync);

            if (isAchvBetter || isDxBetter || isComboBetter || isSyncBetter) {
                const merged = {
                    sheetId: sheetId,
                    achievementRate: Math.max(old.achievement, raw.achievement),
                    title: raw.title,
                    type: typeKey,
                    diff: raw.diff,
                    achievement: Math.max(old.achievement, raw.achievement),
                    dxscore: Math.max(old.dxscore, (raw.dxscore || 0)),
                    combo: isComboBetter ? raw.combo : old.combo,
                    sync: isSyncBetter ? raw.sync : old.sync,
                    play_time: (isPlaylog && raw.play_time) ? raw.play_time : old.play_time
                };
                dataMap.set(sheetId, merged);
                updateCount++;
            }
        };

        // A. 抓取原版列表 (Playlog/Record)
        playlogItems.forEach(node => {
            const isPlaylog = !!node.querySelector('.mai-music-box');
            let raw = null;
            if (isPlaylog) {
                const badgeImgs = Array.from(node.querySelectorAll('.playlog_score'));
                raw = {
                    title: node.querySelector('.mai-music-title span')?.innerText.trim(),
                    type: getImgName(node.querySelector('.playlog_music_kind_icon')?.src),
                    diff: getImgName(node.querySelector('#diff_and_date img')?.src),
                    achievement: parseFloat(node.querySelector('.mai-music-info_achievement_score span')?.innerText.replace(/[^\d.]/g, '')),
                    dxscore: parseInt(node.querySelector('.score')?.innerText.split('/')[0].trim()) || 0,
                    combo: getImgName(badgeImgs[0]?.src),
                    sync: getImgName(badgeImgs[1]?.src),
                    play_time: node.querySelector('.sub_title span:last-child')?.innerText.trim()
                };
            } else if (node.querySelector('.music_name_block')) {
                const rateImgs = Array.from(node.querySelectorAll('.music_rate_block img'));
                raw = {
                    title: node.querySelector('.music_name_block').innerText.trim(),
                    type: getImgName(node.querySelector('.music_kind_icon')?.src),
                    diff: getImgName(node.querySelector('img[src*="diff_"]')?.src),
                    achievement: parseFloat(node.querySelector('.music_score_block')?.innerText.replace(/[^\d.]/g, '')),
                    dxscore: parseInt(node.querySelector('.music_score_block span')?.innerText.trim()) || 0,
                    combo: getImgName(rateImgs[1]?.src),
                    sync: getImgName(rateImgs[2]?.src),
                    play_time: ""
                };
            }
            processItem(raw, isPlaylog);
        });

        // B. 抓取新版 Best50 栅格
        tileItems.forEach(node => {
            const title = node.querySelector('.title')?.innerText.trim();
            const typeImg = getImgName(node.querySelector('.kind')?.src);
            const diffImg = getImgName(node.querySelector('.diff')?.src);
            const achvStr = node.querySelector('.row .val')?.innerText || "0";
            const comboImg = node.querySelector('.badges img[alt="combo"]')?.src;
            const syncImg = node.querySelector('.badges img[alt="sync"]')?.src;

            const raw = {
                title: title,
                type: typeImg, // getImgName 已处理过 std
                diff: diffImg,
                achievement: parseFloat(achvStr.replace(/[^\d.]/g, '')),
                dxscore: 0,
                combo: getImgName(comboImg),
                sync: getImgName(syncImg),
                play_time: ""
            };
            processItem(raw, false);
        });

        updateClearButtonText();
        return updateCount;
    }

    // --- 2. 导出与持久化 ---
    function exportFlatJson() {
        const savedData = GM_getValue("maimai_records", []);
        if (savedData.length === 0) return alert("没有数据可供导出！");
        const blob = new Blob([JSON.stringify(savedData, null, 2)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `maimai_unified_profile_${Date.now()}.json`;
        a.click();
    }

    async function autoScrollAndCollect() {
        const originalZoom = document.body.style.zoom || "1";
        const savedData = GM_getValue("maimai_records", []);

        // 确保初始化加载时也是按 sheetId 索引
        savedData.forEach(item => dataMap.set(item.sheetId, item));

        document.body.style.zoom = "0.4";
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 800));

        let lastHeight = 0, sameHeightCount = 0;
        while (sameHeightCount < 3) {
            captureCurrentVisibleItems();
            window.scrollBy(0, 2200);
            await new Promise(r => setTimeout(r, 800));
            let currentHeight = document.documentElement.scrollHeight;
            if (currentHeight === lastHeight) sameHeightCount++;
            else { lastHeight = currentHeight; sameHeightCount = 0; }
        }

        document.body.style.zoom = originalZoom;
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

        const finalArray = Array.from(dataMap.values());
        GM_setValue("maimai_records", finalArray);
        updateClearButtonText();
        alert(`同步结束。当前档案共 ${finalArray.length} 条数据。`);
    }

    function updateClearButtonText() {
        const btn = document.getElementById('tm-clear-btn');
        if (btn) {
            const len = GM_getValue("maimai_records", []).length;
            btn.innerText = `🗑️ 清除 ${len} 谱面`;
        }
    }

    function createUI() {
        if (document.getElementById('tm-capture-container')) return;
        const container = document.createElement('div');
        container.id = "tm-capture-container";
        container.style = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;gap:8px;align-items:center;background:rgba(255,255,255,0.95);padding:10px;border-radius:15px;box-shadow:0 8px 32px rgba(0,0,0,0.3);backdrop-filter:blur(4px);border:1px solid #ddd;";

        const baseStyle = "padding:8px 16px;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;white-space:nowrap;transition:transform 0.1s;";

        const btnCatch = document.createElement('button');
        btnCatch.innerText = "🔄 同步档案";
        btnCatch.style = baseStyle + "background:#00b8a9;";
        btnCatch.onclick = autoScrollAndCollect;

        const btnExport = document.createElement('button');
        btnExport.innerText = "📥 导出档案";
        btnExport.style = baseStyle + "background:#3775de;";
        btnExport.onclick = exportFlatJson;

        const btnClear = document.createElement('button');
        btnClear.id = 'tm-clear-btn';
        btnClear.style = baseStyle + "background:#ff4d4f;";
        btnClear.onclick = () => { if(confirm("确定清空本地档案吗？所有 sheetId 数据将被抹除。")) { GM_deleteValue("maimai_records"); dataMap.clear(); updateClearButtonText(); }};

        container.appendChild(btnCatch);
        container.appendChild(btnExport);
        container.appendChild(btnClear);
        document.body.appendChild(container);
        updateClearButtonText();
    }

    setTimeout(createUI, 1000);
})();
