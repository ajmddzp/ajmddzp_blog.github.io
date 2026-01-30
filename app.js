// 全局数据存储
let globalData = {
    allPapers: [],      // 存储所有论文的完整数据
    indexByDate: {},    // 归档索引： {'2025年12月': [paper1, paper2...]}
    indexByKeyword: {}, // 关键词索引： {'AI': [paper1...], 'CV': [paper2...]}
    currentDisplayedPapers: [], // 当前视图中需要显示的论文（用于切换排序时重绘）
    sortMode: 'date'            // 默认排序模式: 'date' 或 'keyword'
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

// 1. 初始化应用：加载数据
async function initApp() {
    const loadingEl = document.getElementById('loading');

    try {
        // 第一步：读取文件列表 (由 deploy.sh 生成)
        const indexRes = await fetch('papers_index.json');
        if (!indexRes.ok) throw new Error("无法读取索引文件，请检查是否运行了 deploy.sh");
        const filenames = await indexRes.json();

        console.log(`找到 ${filenames.length} 个文件，开始加载...`);

        // 第二步：并行加载所有 JSON 文件
        // 既然是静态博客，浏览器并发请求几百个小 JSON 文件通常非常快
        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const papers = await Promise.all(promises);

        // 第三步：处理数据
        processData(papers);

        // 第四步：渲染界面
        renderSidebar();
        renderPapers(globalData.allPapers); // 默认显示全部

        // 更新左上角大数字
        animateCount('totalCount', 0, globalData.allPapers.length, 1000);

    } catch (error) {
        console.error("初始化失败:", error);
        document.getElementById('timeline').innerHTML =
            `<div style="text-align:center; padding:40px; color:#ef4444;">
                <h3>⚠️ 加载失败</h3>
                <p>${error.message}</p>
                <p style="font-size:0.9rem; color:#64748b;">请确保你的 deploy.sh 脚本正确生成了 papers_index.json 文件</p>
            </div>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 2. 数据预处理：构建索引
function processData(papers) {
    // 默认按发布日期降序排序 (最新的在前面)
    papers.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));

    globalData.allPapers = papers;
    globalData.indexByDate = {};
    globalData.indexByKeyword = {};

    papers.forEach(paper => {
        // --- 日期归档索引 ---
        let dateKey = '其他日期';
        if (paper.published_date) {
            const date = new Date(paper.published_date);
            if (!isNaN(date)) {
                // 格式：2025年12月
                dateKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
            }
        }
        if (!globalData.indexByDate[dateKey]) globalData.indexByDate[dateKey] = [];
        globalData.indexByDate[dateKey].push(paper);

        // --- 关键词索引 ---
        // 尝试合并 extracted_keywords 和 keywords 字段
        const keywords = [
            ...(paper.extracted_keywords || []),
            ...(paper.keywords || [])
        ];

        // 去重并清洗
        const uniqueKeywords = [...new Set(keywords.map(k => k.trim().toLowerCase()))];

        uniqueKeywords.forEach(kw => {
            if (kw.length < 2) return; // 忽略太短的词
            if (!globalData.indexByKeyword[kw]) globalData.indexByKeyword[kw] = [];
            globalData.indexByKeyword[kw].push(paper);
        });
    });
}

// 3. 渲染侧边栏 (日期列表 + 热门关键词)
function renderSidebar() {
    // --- 渲染日期 ---
    const dateListEl = document.getElementById('dateIndexList');
    // 对日期 key 进行降序排序
    const sortedDates = Object.keys(globalData.indexByDate).sort((a, b) => b.localeCompare(a));

    // "全部" 按钮
    dateListEl.innerHTML = `
        <li class="nav-item active" onclick="resetFilter(this)">
            <span>�� 全部论文</span>
            <span class="count">${globalData.allPapers.length}</span>
        </li>
    `;

    sortedDates.forEach(date => {
        const count = globalData.indexByDate[date].length;
        dateListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('date', '${date}', this)">
                <span>�� ${date}</span>
                <span class="count">${count}</span>
            </li>
        `;
    });

    // --- 渲染关键词 (取 Top 15) ---
    const kwListEl = document.getElementById('keywordIndexList');
    // 将关键词按包含论文数量排序
    const sortedKeywords = Object.keys(globalData.indexByKeyword)
        .map(key => ({ key: key, count: globalData.indexByKeyword[key].length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15); // 只取前15个热门词

    kwListEl.innerHTML = '';
    sortedKeywords.forEach(item => {
        // 首字母大写优化显示
        const displayKey = item.key.charAt(0).toUpperCase() + item.key.slice(1);
        kwListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('keyword', '${item.key}', this)">
                <span># ${displayKey}</span>
                <span class="count">${item.count}</span>
            </li>
        `;
    });
}

// 4. 核心筛选逻辑
function filterBy(type, value, element) {
    // 切换激活状态样式
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

    // 显示筛选提示条
    const statusEl = document.getElementById('filterStatus');
    const labelEl = document.getElementById('currentFilterLabel');
    statusEl.style.display = 'flex';

    let filteredPapers = [];
    let labelText = '';

    if (type === 'date') {
        filteredPapers = globalData.indexByDate[value] || [];
        labelText = `${value}`;
    } else if (type === 'keyword') {
        filteredPapers = globalData.indexByKeyword[value] || [];
        // 首字母大写显示
        const displayVal = value.charAt(0).toUpperCase() + value.slice(1);
        labelText = `关键词: #${displayVal}`;
    }

    labelEl.innerText = labelText;
    renderPapers(filteredPapers);

    // 移动端体验优化：点击后自动滚动到内容区顶部
    if (window.innerWidth < 850) {
        document.querySelector('.content-area').scrollIntoView({ behavior: 'smooth' });
    }
}

// 重置筛选
function resetFilter(element) {
    if (element) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
    }

    document.getElementById('filterStatus').style.display = 'none';
    document.getElementById('searchInput').value = '';
    renderPapers(globalData.allPapers);
}

// 新增：切换排序模式
function changeSort(mode, btnElement) {
    if (globalData.sortMode === mode) return; // 模式未变则不处理

    // 1. 更新状态
    globalData.sortMode = mode;

    // 2. 更新按钮样式
    document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        // 如果是通过代码调用（非点击），手动更新类名
        const id = mode === 'date' ? 'sortByDateBtn' : 'sortByKeywordBtn';
        document.getElementById(id)?.classList.add('active');
    }

    // 3. 重新渲染当前列表（renderPapers 会自动读取 sortMode 并排序）
    renderPapers(globalData.currentDisplayedPapers);
}


// 5. 渲染论文卡片列表 (已修改为支持排序)
function renderPapers(papers) {
    // 1. 保存当前上下文，以便切换排序时使用
    globalData.currentDisplayedPapers = papers;

    const timeline = document.getElementById('timeline');
    timeline.innerHTML = ''; // 清空列表
    // window.scrollTo(0, 0);   // 回到顶部

    if (!papers || papers.length === 0) {
        timeline.innerHTML = `
            <div style="grid-column: 1/-1; text-align:center; padding:40px; color:#94a3b8;">
                <p>�� 没有找到匹配的论文</p>
            </div>`;
        return;
    }

    // 2. 创建副本并进行排序（不修改原始传入的数组）
    let displayList = [...papers];

    if (globalData.sortMode === 'date') {
        // 按日期降序（最新的在前）
        displayList.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    } else if (globalData.sortMode === 'keyword') {
        // 按第一个关键词的首字母 A-Z 排序，若相同则按日期
        displayList.sort((a, b) => {
            // 获取第一个关键词，如果没有则为空字符串
            const keyA = (a.extracted_keywords && a.extracted_keywords.length > 0)
                ? a.extracted_keywords[0].trim().toLowerCase() : '';
            const keyB = (b.extracted_keywords && b.extracted_keywords.length > 0)
                ? b.extracted_keywords[0].trim().toLowerCase() : '';

            // 字符串比较
            const compareResult = keyA.localeCompare(keyB, 'zh-CN'); // 支持中文拼音排序

            // 如果关键词相同，则按日期降序
            if (compareResult === 0) {
                return new Date(b.published_date || 0) - new Date(a.published_date || 0);
            }
            return compareResult;
        });
    }

    // 3. 渲染列表
    displayList.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card';

        // 日期处理
        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';

        // 关键词处理 (最多显示4个)
        const keywords = paper.extracted_keywords || [];
        const tagsHtml = keywords.slice(0, 4).map(k =>
            `<span class="tag">#${k}</span>`
        ).join('');

        // 作者处理
        const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 2).join(', ') + (paper.authors.length > 2 ? ' 等' : '') : (paper.authors || '未知作者');

        card.innerHTML = `
            <div class="paper-date">�� ${dateStr} · ${authors}</div>
            <h3 class="paper-title">${paper.title}</h3>
            <div class="paper-abstract">
                ${paper.abstract || '暂无摘要内容...'}
            </div>
            <div class="paper-keywords">
                ${tagsHtml}
            </div>
        `;

        // 点击打开详情
        card.onclick = () => openModal(paper);

        timeline.appendChild(card);
    });
}

// 6. 模态框逻辑
function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;

    // 渲染 Markdown 摘要 (支持 LaTeX)
    const summaryHtml = renderMarkdown(paper.detailed_summary || paper.abstract);

    const authorsFull = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors;

    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta">
            <p><strong>�� 作者:</strong> ${authorsFull}</p>
            <p><strong>�� 发布时间:</strong> ${paper.published_date || '未知'}</p>
            <a href="${paper.url}" target="_blank" class="btn-link">�� 阅读全文 (PDF/ArXiv)</a>
        </div>
        
        <h3>�� 摘要 / 核心总结</h3>
        <div class="markdown-body" style="line-height:1.8; color:#334155;">
            ${summaryHtml}
        </div>
    `;

    // 渲染问答部分
    const qaList = document.getElementById('qaList');
    if (paper.qa_pairs && paper.qa_pairs.length) {
        qaList.innerHTML = `<h3 style="margin-top:30px; border-top:1px solid #e2e8f0; padding-top:20px;">�� AI 问答解析</h3>` +
            paper.qa_pairs.map(qa => `
            <div style="background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:15px; border:1px solid #e2e8f0;">
                <div style="font-weight:700; color:#2563eb; margin-bottom:10px; font-size:1.05rem;">Q: ${qa.question}</div>
                <div style="color:#475569;">${renderMarkdown(qa.answer)}</div>
            </div>
        `).join('');
    } else {
        qaList.innerHTML = '';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // 禁止背景滚动

    // 重新渲染 LaTeX
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(modal, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false }
            ]
        });
    }
}

// 关闭模态框
const modal = document.getElementById('paperModal');
const closeBtn = document.querySelector('.close');

function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

closeBtn.onclick = closeModal;
window.onclick = (e) => {
    if (e.target == modal) closeModal();
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
});

// 7. 全局搜索逻辑
const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();

    if (!val) {
        resetFilter(document.querySelector('.nav-item')); // 恢复到"全部"
        return;
    }

    // 执行搜索 (标题、摘要、关键词)
    const results = globalData.allPapers.filter(p => {
        const title = (p.title || '').toLowerCase();
        const abstract = (p.abstract || '').toLowerCase();
        const kws = (p.extracted_keywords || []).join(' ').toLowerCase();
        return title.includes(val) || abstract.includes(val) || kws.includes(val);
    });

    // 更新 UI 状态
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('filterStatus').style.display = 'flex';
    document.getElementById('currentFilterLabel').innerText = `搜索: "${val}"`;

    renderPapers(results);
});

// 工具函数：Markdown 渲染
function renderMarkdown(text) {
    if (!text) return '';
    return typeof marked !== 'undefined' ? marked.parse(text) : text;
}

// 工具函数：数字滚动动画
function animateCount(id, start, end, duration) {
    const obj = document.getElementById(id);
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// 事件监听器配置
function setupEventListeners() {
    // 这里可以添加其他全局事件
}