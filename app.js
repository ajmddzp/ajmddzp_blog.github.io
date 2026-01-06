// GitHub Pages 纯静态版 app.js

// 状态变量
let allPapersIndex = []; // 存储所有文件名
let allPapersCache = []; // 存储已加载的论文数据
let currentPage = 0;
const PAGE_SIZE = 20;
let currentSortBy = 'date'; // date or relevance
let currentKeyword = null;

// DOM 元素
const timeline = document.getElementById('timeline');
const loading = document.getElementById('loading');
const searchInput = document.getElementById('searchInput');
const loadMoreBtn = document.getElementById('loadMore');
const paperModal = document.getElementById('paperModal');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadInitialData();
    setupEventListeners();
});

// 1. 加载索引文件 (papers_index.json)
async function loadInitialData() {
    showLoading(true);
    try {
        // 读取由 deploy.sh 生成的文件列表
        const response = await fetch('papers_index.json');
        if (!response.ok) throw new Error("无法读取索引文件");
        allPapersIndex = await response.json();

        // 开始加载第一页数据
        await loadPapers(0);
    } catch (error) {
        console.error(error);
        timeline.innerHTML = '<p style="text-align:center; padding:20px">⚠️ 无法加载数据，请确保 deploy.sh 脚本已运行并生成了索引。</p>';
    } finally {
        showLoading(false);
    }
}

// 2. 加载论文数据
async function loadPapers(page) {
    showLoading(true);

    // 计算需要加载哪些文件
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const filesToLoad = allPapersIndex.slice(start, end);

    if (filesToLoad.length === 0 && page === 0) {
        timeline.innerHTML = '<p style="text-align: center; padding: 40px;">暂无论文</p>';
        showLoading(false);
        return;
    }

    try {
        // 并行读取多个 JSON 文件
        const promises = filesToLoad.map(filename => fetch(filename).then(res => res.json()));
        const newPapers = await Promise.all(promises);

        // 加入缓存
        allPapersCache = [...allPapersCache, ...newPapers];

        // 渲染界面
        renderPapers(newPapers);

        // 处理"加载更多"按钮
        if (end >= allPapersIndex.length) {
            loadMoreBtn.style.display = 'none';
        } else {
            loadMoreBtn.style.display = 'block';
        }
    } catch (e) {
        console.error("加载具体论文失败", e);
    } finally {
        showLoading(false);
    }
}

// 3. 渲染卡片 (复用原本的 HTML 结构)
function renderPapers(papers) {
    if (currentPage === 0) timeline.innerHTML = '';

    papers.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card'; // 样式保持不变

        // 简单的日期处理
        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';
        const authors = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors;

        card.innerHTML = `
            <div class="paper-header">
                <div style="flex: 1;">
                    <p class="paper-date">📅 ${dateStr}</p>
                    <h3 class="paper-title">${paper.title}</h3>
                    <p class="paper-authors">${authors}</p>
                </div>
                <div class="paper-badges">
                    ${paper.relevance_score ? `<span class="relevance-badge">${paper.relevance_score}/10</span>` : ''}
                </div>
            </div>
            <div class="paper-abstract">${paper.abstract || '暂无摘要'}</div>
        `;

        // 点击事件：打开详情
        card.addEventListener('click', () => openStaticModal(paper));
        timeline.appendChild(card);
    });
}

// 4. 静态详情页弹窗
function openStaticModal(paper) {
    const modalTitle = document.getElementById('paperTitle');
    const modalDetails = document.getElementById('paperDetails');
    const qaList = document.getElementById('qaList');

    modalTitle.textContent = paper.title;

    // 生成详情 HTML
    modalDetails.innerHTML = `
        <div class="detail-section">
            <h3>作者</h3>
            <p>${Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors}</p>
        </div>
        <div class="detail-section">
            <h3>摘要</h3>
            <div class="markdown-content">${paper.abstract}</div>
        </div>
        <div class="detail-section">
            <h3>链接</h3>
            <a href="${paper.url}" target="_blank" class="btn btn-primary">查看原文 (PDF)</a>
        </div>
        ${paper.detailed_summary ? `
        <div class="detail-section">
            <h3>AI 深度总结</h3>
            <div class="markdown-content">${renderMarkdown(paper.detailed_summary)}</div>
        </div>` : ''}
    `;

    // 渲染预存的问答 (如果有)
    if (paper.qa_pairs && paper.qa_pairs.length > 0) {
        qaList.innerHTML = paper.qa_pairs.map(qa => `
            <div class="qa-item">
                <div class="qa-question">Q: ${qa.question}</div>
                <div class="qa-answer">${renderMarkdown(qa.answer)}</div>
            </div>
        `).join('');
    } else {
        qaList.innerHTML = '<p style="color:#999">暂无预设问答</p>';
    }

    // 隐藏无法使用的输入框
    document.querySelector('.ask-input-container').style.display = 'none';

    paperModal.classList.add('active');
}

// 5. 简单的本地搜索
function setupEventListeners() {
    // 搜索功能
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (!query) {
            currentPage = 0;
            timeline.innerHTML = '';
            loadPapers(0);
            return;
        }

        // 在已加载的缓存中搜索 (纯前端搜索)
        const filtered = allPapersCache.filter(p =>
            (p.title && p.title.toLowerCase().includes(query)) ||
            (p.abstract && p.abstract.toLowerCase().includes(query))
        );

        timeline.innerHTML = '';
        renderPapers(filtered);
        loadMoreBtn.style.display = 'none';
    });

    // 模态框关闭
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            paperModal.classList.remove('active');
            document.getElementById('configModal').classList.remove('active');
        });
    });

    // 加载更多
    loadMoreBtn.addEventListener('click', () => {
        currentPage++;
        loadPapers(currentPage);
    });

    // 禁用配置按钮 (因为无法保存到服务器)
    const configBtn = document.getElementById('configBtn');
    if (configBtn) configBtn.style.display = 'none';
    const fetchBtn = document.getElementById('fetchBtn');
    if (fetchBtn) fetchBtn.style.display = 'none';
}

// 辅助工具
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}
function renderMarkdown(text) {
    return typeof marked !== 'undefined' ? marked.parse(text) : text;
}