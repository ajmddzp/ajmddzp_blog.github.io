// 全局数据存储
let globalData = {
    allPapers: [],
    indexByDate: {},
    indexByKeyword: {}
};

// 当前视图状态
let appState = {
    filteredPapers: [], // 当前展示的论文列表（经过筛选的）
    sortOrder: 'desc'   // 'desc' (最新) 或 'asc' (最旧)
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();

    // 全局搜索监听
    document.getElementById('searchInput').addEventListener('input', (e) => {
        handleSearch(e.target.value);
    });
});

// 1. 初始化
async function initApp() {
    const loadingEl = document.getElementById('loading');
    try {
        const indexRes = await fetch('papers_index.json');
        if (!indexRes.ok) throw new Error("无法读取索引文件");
        const filenames = await indexRes.json();

        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const papers = await Promise.all(promises);

        processData(papers);

        // 初始展示全部
        appState.filteredPapers = globalData.allPapers;
        renderSidebar();
        renderPapers(); // 渲染

        document.getElementById('totalCount').innerText = globalData.allPapers.length;

    } catch (error) {
        console.error("Init Error:", error);
        document.getElementById('timeline').innerHTML = `<p style="text-align:center;padding:20px;color:red">加载失败: ${error.message}</p>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 2. 数据处理
function processData(papers) {
    // 默认按照 published_date 预排序一下
    papers.sort((a, b) => new Date(b.published_date) - new Date(a.published_date));

    globalData.allPapers = papers;
    globalData.indexByDate = {};
    globalData.indexByKeyword = {};

    papers.forEach(paper => {
        // 日期索引
        let dateKey = '其他';
        if (paper.published_date) {
            const date = new Date(paper.published_date);
            if (!isNaN(date)) {
                dateKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
            }
        }
        if (!globalData.indexByDate[dateKey]) globalData.indexByDate[dateKey] = [];
        globalData.indexByDate[dateKey].push(paper);

        // 关键词索引
        const keywords = [...(paper.extracted_keywords || []), ...(paper.keywords || [])];
        const uniqueKw = [...new Set(keywords.map(k => k.trim().toLowerCase()))];

        uniqueKw.forEach(kw => {
            if (kw.length < 2) return;
            if (!globalData.indexByKeyword[kw]) globalData.indexByKeyword[kw] = [];
            globalData.indexByKeyword[kw].push(paper);
        });
    });
}

// 3. 渲染侧边栏 (Top 15 关键词)
function renderSidebar() {
    // 日期列表
    const dateListEl = document.getElementById('dateIndexList');
    const sortedDates = Object.keys(globalData.indexByDate).sort((a, b) => b.localeCompare(a));

    dateListEl.innerHTML = `
        <li class="nav-item active" onclick="resetFilter(this)">
            <span>📚 全部论文</span>
            <span class="count">${globalData.allPapers.length}</span>
        </li>
    `;
    sortedDates.forEach(date => {
        dateListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('date', '${date}', this)">
                <span>📅 ${date}</span>
                <span class="count">${globalData.indexByDate[date].length}</span>
            </li>
        `;
    });

    // 热门关键词列表 (Top 15)
    const kwListEl = document.getElementById('keywordIndexList');
    const sortedKeywords = Object.keys(globalData.indexByKeyword)
        .map(key => ({ key: key, count: globalData.indexByKeyword[key].length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    kwListEl.innerHTML = '';
    sortedKeywords.forEach(item => {
        const displayKey = capitalize(item.key);
        kwListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('keyword', '${item.key}', this)">
                <span># ${displayKey}</span>
                <span class="count">${item.count}</span>
            </li>
        `;
    });
}

// 4. 筛选逻辑
function filterBy(type, value, element) {
    // UI 更新
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

    // 状态更新
    const statusEl = document.getElementById('filterStatus');
    const labelEl = document.getElementById('currentFilterLabel');
    statusEl.style.display = 'inline-flex';

    if (type === 'date') {
        appState.filteredPapers = globalData.indexByDate[value] || [];
        labelEl.innerText = `归档: ${value}`;
    } else if (type === 'keyword') {
        appState.filteredPapers = globalData.indexByKeyword[value] || [];
        labelEl.innerText = `关键词: #${capitalize(value)}`;

        // 如果是从 Modal 点击的，关闭 Modal
        closeModal('keywordModal');
    }

    renderPapers(); // 重新渲染列表

    // 移动端滚动
    if (window.innerWidth < 850) {
        document.querySelector('.content-area').scrollIntoView({ behavior: 'smooth' });
    }
}

// 5. 排序逻辑 (新功能)
function toggleSortOrder() {
    // 切换状态
    appState.sortOrder = appState.sortOrder === 'desc' ? 'asc' : 'desc';

    // 更新按钮文本
    const btn = document.getElementById('sortBtn');
    if (appState.sortOrder === 'desc') {
        btn.innerHTML = '📅 日期: 最新';
    } else {
        btn.innerHTML = '📅 日期: 最早';
    }

    renderPapers(); // 带着新的排序状态重新渲染
}

// 6. 渲染论文列表 (核心渲染函数)
function renderPapers() {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    // 1. 获取当前要展示的论文
    let papers = [...appState.filteredPapers];

    // 2. 根据当前设置排序
    papers.sort((a, b) => {
        const dateA = new Date(a.published_date || 0);
        const dateB = new Date(b.published_date || 0);
        return appState.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    // 3. 渲染
    if (papers.length === 0) {
        timeline.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">没有找到匹配的论文</div>';
        return;
    }

    papers.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card';

        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';
        const keywords = (paper.extracted_keywords || []).slice(0, 4);
        const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 2).join(', ') : (paper.authors || '未知');

        card.innerHTML = `
            <div class="paper-date">📅 ${dateStr} · ${authors}</div>
            <h3 class="paper-title">${paper.title}</h3>
            <div class="paper-abstract">${paper.abstract || '暂无摘要'}</div>
            <div class="paper-keywords">
                ${keywords.map(k => `<span class="tag">#${k}</span>`).join('')}
            </div>
        `;
        card.onclick = () => openPaperModal(paper);
        timeline.appendChild(card);
    });
}

// 7. 全量关键词 Modal (新功能)
function openKeywordModal() {
    const container = document.getElementById('allKeywordsContainer');
    container.innerHTML = '';

    // 获取所有关键词并排序 (按频率降序)
    const sortedKeywords = Object.keys(globalData.indexByKeyword)
        .map(key => ({ key: key, count: globalData.indexByKeyword[key].length }))
        .sort((a, b) => b.count - a.count); // 频率高的在前面

    sortedKeywords.forEach(item => {
        const tag = document.createElement('div');
        tag.className = 'cloud-tag';
        tag.innerHTML = `
            <span>${capitalize(item.key)}</span>
            <span class="count">${item.count}</span>
        `;
        // 点击关键词：调用筛选逻辑
        tag.onclick = () => filterBy('keyword', item.key);
        container.appendChild(tag);
    });

    const modal = document.getElementById('keywordModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// 搜索处理
function handleSearch(val) {
    val = val.toLowerCase().trim();
    const statusEl = document.getElementById('filterStatus');
    const labelEl = document.getElementById('currentFilterLabel');

    if (!val) {
        resetFilter();
        return;
    }

    // 在全量数据中搜索
    appState.filteredPapers = globalData.allPapers.filter(p => {
        const title = (p.title || '').toLowerCase();
        const abstract = (p.abstract || '').toLowerCase();
        const kws = (p.extracted_keywords || []).join(' ').toLowerCase();
        return title.includes(val) || abstract.includes(val) || kws.includes(val);
    });

    statusEl.style.display = 'inline-flex';
    labelEl.innerText = `搜索: "${val}"`;
    renderPapers();
}

function resetFilter(element) {
    if (element) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
    }
    appState.filteredPapers = globalData.allPapers;
    document.getElementById('filterStatus').style.display = 'none';
    document.getElementById('searchInput').value = '';
    renderPapers();
}

// 辅助函数
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    document.body.style.overflow = 'auto';
}

function openPaperModal(paper) {
    // ...复用之前的 Modal 逻辑...
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;

    // 渲染 Markdown
    const summaryHtml = typeof marked !== 'undefined' ? marked.parse(paper.detailed_summary || paper.abstract) : paper.abstract;

    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta">
            <p><strong>👥 作者:</strong> ${Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors}</p>
            <p><strong>📅 日期:</strong> ${paper.published_date}</p>
            <a href="${paper.url}" target="_blank" class="btn-link">📄 阅读全文</a>
        </div>
        <div class="markdown-body" style="line-height:1.6;color:#334155">${summaryHtml}</div>
    `;

    // QA
    const qaList = document.getElementById('qaList');
    if (paper.qa_pairs && paper.qa_pairs.length) {
        qaList.innerHTML = `<h3 style="margin-top:20px;border-top:1px solid #eee;padding-top:15px">🤖 AI 问答</h3>` +
            paper.qa_pairs.map(qa => `
            <div style="background:#f8fafc;padding:15px;border-radius:8px;margin-bottom:10px">
                <div style="font-weight:bold;color:#2563eb;margin-bottom:5px">Q: ${qa.question}</div>
                <div>${typeof marked !== 'undefined' ? marked.parse(qa.answer) : qa.answer}</div>
            </div>`).join('');
    } else {
        qaList.innerHTML = '';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}