// Supabase 配置
const SUPABASE_URL = 'https://hycwhikohozmeovgalfb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_79NgWYqq0wMHpv3y5mFEKQ_13f3BHLU';
let supabaseClient = null;

if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.error('Supabase client not loaded');
}

// 全局数据存储
let globalData = {
    allPapers: [],      // 存储所有论文的完整数据
    indexByDate: {},    // 归档索引： {'2025年12月': [paper1, paper2...]}
    indexByKeyword: {}, // 关键词索引： {'AI': [paper1...], 'CV': [paper2...]}
    currentDisplayedPapers: [], // 当前视图中需要显示的论文（用于切换排序时重绘）
    sortMode: 'date',           // 默认排序模式: 'date', 'keyword', 'likes'
    likesMap: {}        // 存储从后端获取的点赞数据 {'Title': count}
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

        // 并行加载所有 JSON 文件
        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const papers = await Promise.all(promises);

        // 新增：并行加载点赞数据
        await fetchLikes();

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

// 新增：从 Supabase 获取点赞数据
async function fetchLikes() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('likes')
            .select('title, likes');
        
        if (error) throw error;
        
        // 构建映射表
        if (data) {
            data.forEach(row => {
                globalData.likesMap[row.title] = row.likes;
            });
        }
    } catch (err) {
        console.error("获取点赞数据失败:", err);
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
        // 合并点赞数据 (如果 title 匹配)
        // 注意：这里假设 title 是唯一的，如果有重复 title 可能会共享点赞数
        paper.likes = globalData.likesMap[paper.title] || 0;
        // 标记是否在数据库中已存在行 (用于判断 insert 还是 update)
        paper.hasLikeRecord = globalData.likesMap.hasOwnProperty(paper.title);

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
        const keywords = [
            ...(paper.extracted_keywords || []),
            ...(paper.keywords || [])
        ];
        const uniqueKeywords = [...new Set(keywords.map(k => k.trim().toLowerCase()))];

        uniqueKeywords.forEach(kw => {
            if (kw.length < 2) return; 
            if (!globalData.indexByKeyword[kw]) globalData.indexByKeyword[kw] = [];
            globalData.indexByKeyword[kw].push(paper);
        });
    });
}

// 3. 渲染侧边栏 (保持不变)
function renderSidebar() {
    const dateListEl = document.getElementById('dateIndexList');
    const sortedDates = Object.keys(globalData.indexByDate).sort((a, b) => b.localeCompare(a));

    dateListEl.innerHTML = `
        <li class="nav-item active" onclick="resetFilter(this)">
            <span>&#128218; 全部论文</span>
            <span class="count">${globalData.allPapers.length}</span>
        </li>
    `;

    sortedDates.forEach(date => {
        const count = globalData.indexByDate[date].length;
        dateListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('date', '${date}', this)">
                <span>&#128197; ${date}</span>
                <span class="count">${count}</span>
            </li>
        `;
    });

    const kwListEl = document.getElementById('keywordIndexList');
    const sortedKeywords = Object.keys(globalData.indexByKeyword)
        .map(key => ({ key: key, count: globalData.indexByKeyword[key].length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15); 

    kwListEl.innerHTML = '';
    sortedKeywords.forEach(item => {
        const displayKey = item.key.charAt(0).toUpperCase() + item.key.slice(1);
        kwListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('keyword', '${item.key}', this)">
                <span># ${displayKey}</span>
                <span class="count">${item.count}</span>
            </li>
        `;
    });
}

// 4. 核心筛选逻辑 (保持不变)
function filterBy(type, value, element) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

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
        const displayVal = value.charAt(0).toUpperCase() + value.slice(1);
        labelText = `关键词: #${displayVal}`;
    }

    labelEl.innerText = labelText;
    renderPapers(filteredPapers);

    if (window.innerWidth < 850) {
        document.querySelector('.content-area').scrollIntoView({ behavior: 'smooth' });
    }
}

function resetFilter(element) {
    if (element) {
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
    }

    document.getElementById('filterStatus').style.display = 'none';
    document.getElementById('searchInput').value = '';
    renderPapers(globalData.allPapers);
}

// 切换排序模式 (修改)
function changeSort(mode, btnElement) {
    if (globalData.sortMode === mode) return;

    globalData.sortMode = mode;

    // 更新按钮样式
    document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    }

    renderPapers(globalData.currentDisplayedPapers);
}

// 5. 渲染论文卡片列表 (修改：添加点赞和Likes排序)
function renderPapers(papers) {
    globalData.currentDisplayedPapers = papers;

    const timeline = document.getElementById('timeline');
    timeline.innerHTML = ''; 

    if (!papers || papers.length === 0) {
        timeline.innerHTML = `
            <div style="grid-column: 1/-1; text-align:center; padding:40px; color:#94a3b8;">
                <p>&#9888; 没有找到匹配的论文</p>
            </div>`;
        return;
    }

    let displayList = [...papers];

    // 排序逻辑
    if (globalData.sortMode === 'date') {
        displayList.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    } else if (globalData.sortMode === 'keyword') {
        displayList.sort((a, b) => {
            const keyA = (a.extracted_keywords && a.extracted_keywords.length > 0)
                ? a.extracted_keywords[0].trim().toLowerCase() : '';
            const keyB = (b.extracted_keywords && b.extracted_keywords.length > 0)
                ? b.extracted_keywords[0].trim().toLowerCase() : '';
            const compareResult = keyA.localeCompare(keyB, 'zh-CN');
            if (compareResult === 0) {
                return new Date(b.published_date || 0) - new Date(a.published_date || 0);
            }
            return compareResult;
        });
    } else if (globalData.sortMode === 'likes') {
        // 新增：按点赞数排序
        displayList.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    }

    displayList.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card';

        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';
        const keywords = paper.extracted_keywords || [];
        const tagsHtml = keywords.slice(0, 4).map(k =>
            `<span class="tag">#${k}</span>`
        ).join('');

        const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 2).join(', ') + (paper.authors.length > 2 ? ' 等' : '') : (paper.authors || '未知作者');

        // 构建卡片 HTML
        card.innerHTML = `
            <div class="paper-date">&#127911; ${dateStr} · ${authors}</div>
            <h3 class="paper-title">${paper.title}</h3>
            <div class="paper-abstract">
                ${paper.abstract || '暂无摘要内容...'}
            </div>
            
            <div class="card-footer">
                <div class="paper-keywords">
                    ${tagsHtml}
                </div>
                <button class="like-btn" title="点赞">
                    <span class="heart-icon">&#10084;</span> 
                    <span class="like-count">${paper.likes || 0}</span>
                </button>
            </div>
        `;

        card.onclick = () => openModal(paper);

        // 绑定点赞事件
        const likeBtn = card.querySelector('.like-btn');
        likeBtn.onclick = (e) => {
            e.stopPropagation(); // 阻止冒泡，不触发卡片打开
            handleLike(paper, likeBtn);
        };

        timeline.appendChild(card);
    });
}

// 新增：处理点赞逻辑
async function handleLike(paper, btnElement) {
    if (!supabaseClient) {
        alert("Supabase 未初始化，无法点赞");
        return;
    }

    // 1. 乐观更新 UI (立即+1)
    paper.likes = (paper.likes || 0) + 1;
    const countSpan = btnElement.querySelector('.like-count');
    countSpan.innerText = paper.likes;
    
    // 添加动画效果
    btnElement.classList.add('liked-anim');
    setTimeout(() => btnElement.classList.remove('liked-anim'), 300);

    try {
        if (paper.hasLikeRecord) {
            // 已存在行：更新
            const { error } = await supabaseClient
                .from('likes')
                .update({ likes: paper.likes })
                .eq('title', paper.title);
            
            if (error) throw error;
        } else {
            // 不存在行 (0 -> 1)：插入
            // 这里我们使用 title 作为标识。ID 由 Supabase 自动生成
            const { error } = await supabaseClient
                .from('likes')
                .insert([{ title: paper.title, likes: paper.likes }]);
            
            if (error) throw error;
            paper.hasLikeRecord = true; // 标记为已存在
        }
    } catch (err) {
        console.error("点赞同步失败:", err);
        // 如果失败，回滚 UI (可选，这里为了简单暂不回滚，只是打日志)
        // paper.likes--;
        // countSpan.innerText = paper.likes;
    }
}

// 6. 模态框逻辑 (保持不变)
function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;

    const summaryHtml = renderMarkdown(paper.detailed_summary || paper.abstract);
    const authorsFull = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors;

    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta">
            <p><strong>&#128221; 作者:</strong> ${authorsFull}</p>
            <p><strong>&#128197; 发布时间:</strong> ${paper.published_date || '未知'}</p>
            <p><strong>&#10084; 获赞:</strong> ${paper.likes || 0}</p>
            <a href="${paper.url}" target="_blank" class="btn-link">&#127911; 阅读全文 (PDF/ArXiv)</a>
        </div>
        
        <h3>&#128221; 摘要 / 核心总结</h3>
        <div class="markdown-body" style="line-height:1.8; color:#334155;">
            ${summaryHtml}
        </div>
    `;

    const qaList = document.getElementById('qaList');
    if (paper.qa_pairs && paper.qa_pairs.length) {
        qaList.innerHTML = `<h3 style="margin-top:30px; border-top:1px solid #e2e8f0; padding-top:20px;">&#128218; AI 问答解析</h3>` +
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
    document.body.style.overflow = 'hidden'; 

    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(modal, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false }
            ]
        });
    }
}

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

// 7. 全局搜索逻辑 (保持不变)
const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();

    if (!val) {
        resetFilter(document.querySelector('.nav-item')); 
        return;
    }

    const results = globalData.allPapers.filter(p => {
        const title = (p.title || '').toLowerCase();
        const abstract = (p.abstract || '').toLowerCase();
        const kws = (p.extracted_keywords || []).join(' ').toLowerCase();
        return title.includes(val) || abstract.includes(val) || kws.includes(val);
    });

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('filterStatus').style.display = 'flex';
    document.getElementById('currentFilterLabel').innerText = `搜索: "${val}"`;

    renderPapers(results);
});

function renderMarkdown(text) {
    if (!text) return '';
    return typeof marked !== 'undefined' ? marked.parse(text) : text;
}

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

function setupEventListeners() {
    // 监听排序按钮
    document.getElementById('sortByDateBtn').addEventListener('click', (e) => changeSort('date', e.target));
    document.getElementById('sortByKeywordBtn').addEventListener('click', (e) => changeSort('keyword', e.target));
    document.getElementById('sortByLikesBtn').addEventListener('click', (e) => changeSort('likes', e.target));
}