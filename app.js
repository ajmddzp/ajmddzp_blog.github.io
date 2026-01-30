// ==========================================
// 0. Supabase 初始化配置
// ==========================================
// �� 必填：请替换为你 Supabase 控制台 "Project Settings -> API" 中的真实值
const SUPABASE_URL = 'https://hycwhikohozmeovgalfb.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_79NgWYqq0wMHpv3y5mFEKQ_13f3BHLU';

let supabase = null;

if (typeof window.supabase !== 'undefined') {
    const { createClient } = window.supabase;
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("Supabase SDK 初始化成功");
} else {
    console.error("Supabase SDK 未加载，请检查 index.html");
}

// 全局数据存储
let globalData = {
    allPapers: [],
    indexByDate: {},
    indexByKeyword: {},
    currentDisplayedPapers: [],
    sortMode: 'date',
    // 存储云端点赞数据 {'论文标题': 12}
    likesMap: {} 
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

// 1. 初始化应用
async function initApp() {
    const loadingEl = document.getElementById('loading');
    try {
        const indexRes = await fetch('papers_index.json');
        if (!indexRes.ok) throw new Error("无法读取索引文件");
        const filenames = await indexRes.json();
        
        console.log(`找到 ${filenames.length} 个文件，开始加载...`);
        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const papers = await Promise.all(promises);

        processData(papers);
        renderSidebar();
        renderPapers(globalData.allPapers);
        animateCount('totalCount', 0, globalData.allPapers.length, 1000);

    } catch (error) {
        console.error("初始化失败:", error);
        document.getElementById('timeline').innerHTML = 
            `<div style="padding:40px; text-align:center;">加载失败: ${error.message}</div>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 2. 数据处理
function processData(papers) {
    papers.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    
    globalData.allPapers = papers;
    globalData.indexByDate = {};
    globalData.indexByKeyword = {};

    papers.forEach(paper => {
        // 默认点赞数为0
        paper.recommend = 0;

        // 日期索引
        let dateKey = '其他日期';
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
        const uniqueKeywords = [...new Set(keywords.map(k => k.trim().toLowerCase()))];
        uniqueKeywords.forEach(kw => {
            if (kw.length < 2) return;
            if (!globalData.indexByKeyword[kw]) globalData.indexByKeyword[kw] = [];
            globalData.indexByKeyword[kw].push(paper);
        });
    });

    // �� 核心：异步拉取云端点赞数据
    fetchLikesFromSupabase();
}

// ==========================================
// �� Supabase: 拉取所有点赞数据
// ==========================================
async function fetchLikesFromSupabase() {
    if (!supabase) return;

    // 查询所有记录
    const { data, error } = await supabase
        .from('paper_stats')
        .select('title, likes');

    if (error) {
        console.error("Supabase 拉取失败:", error);
        return;
    }

    if (data) {
        data.forEach(item => {
            globalData.likesMap[item.title] = item.likes;
            
            // 同步更新内存对象
            const paper = globalData.allPapers.find(p => p.title === item.title);
            if (paper) {
                paper.recommend = item.likes;
            }
        });
        console.log(`从 Supabase 同步了 ${data.length} 条点赞数据`);
        // 仅刷新页面上的数字
        updateLikesOnPage();
    }
}

// 辅助：只更新数字，不重绘
function updateLikesOnPage() {
    document.querySelectorAll('.paper-card').forEach(card => {
        const titleEl = card.querySelector('.paper-title');
        if (titleEl) {
            const title = titleEl.innerText;
            const countSpan = card.querySelector('.like-count');
            if (globalData.likesMap[title] !== undefined && countSpan) {
                countSpan.innerText = globalData.likesMap[title];
            }
        }
    });
}

// ==========================================
// �� Supabase: 处理点赞交互
// ==========================================
async function handleLike(btnElement, paperTitle) {
    if (!supabase) {
        alert("Supabase 配置未生效");
        return;
    }

    // 1. 乐观更新 (前端先变数字)
    const countSpan = btnElement.querySelector('.like-count');
    let currentCount = parseInt(countSpan.innerText) || 0;
    let newCount = currentCount + 1;
    
    countSpan.innerText = newCount;
    btnElement.classList.add('liked-anim');
    setTimeout(() => btnElement.classList.remove('liked-anim'), 300);

    // 更新内存
    const paper = globalData.allPapers.find(p => p.title === paperTitle);
    if (paper) paper.recommend = newCount;
    globalData.likesMap[paperTitle] = newCount;

    // 2. 提交到后端 (Upsert: 更新或插入)
    const { error } = await supabase
        .from('paper_stats')
        .upsert(
            { title: paperTitle, likes: newCount },
            { onConflict: 'title' }
        );

    if (error) {
        console.error("点赞失败:", error);
        // 如果失败，回滚数字
        countSpan.innerText = currentCount; 
        alert("网络错误，点赞失败");
    } else {
        console.log("点赞已同步到 Supabase");
    }
}

// 3. 渲染侧边栏
function renderSidebar() {
    const dateListEl = document.getElementById('dateIndexList');
    const sortedDates = Object.keys(globalData.indexByDate).sort((a, b) => b.localeCompare(a));

    dateListEl.innerHTML = `
        <li class="nav-item active" onclick="resetFilter(this)">
            <span>�� 全部论文</span>
            <span class="count">${globalData.allPapers.length}</span>
        </li>
    `;
    sortedDates.forEach(date => {
        dateListEl.innerHTML += `
            <li class="nav-item" onclick="filterBy('date', '${date}', this)">
                <span>�� ${date}</span>
                <span class="count">${globalData.indexByDate[date].length}</span>
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

// 4. 筛选逻辑
function filterBy(type, value, element) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

    document.getElementById('filterStatus').style.display = 'flex';
    let filteredPapers = [];
    let labelText = '';

    if (type === 'date') {
        filteredPapers = globalData.indexByDate[value] || [];
        labelText = value;
    } else if (type === 'keyword') {
        filteredPapers = globalData.indexByKeyword[value] || [];
        labelText = `关键词: #${value}`;
    }

    document.getElementById('currentFilterLabel').innerText = labelText;
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

function changeSort(mode, btnElement) {
    if (globalData.sortMode === mode) return;
    globalData.sortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    renderPapers(globalData.currentDisplayedPapers);
}

// 5. 渲染列表
function renderPapers(papers) {
    globalData.currentDisplayedPapers = papers;
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    if (!papers || papers.length === 0) {
        timeline.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8;">�� 没有找到匹配的论文</div>';
        return;
    }

    let displayList = [...papers];

    // 排序逻辑
    if (globalData.sortMode === 'date') {
        displayList.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    } else if (globalData.sortMode === 'recommend') {
        displayList.sort((a, b) => (b.recommend || 0) - (a.recommend || 0));
    } else if (globalData.sortMode === 'keyword') {
        displayList.sort((a, b) => {
            const kA = (a.extracted_keywords?.[0] || '').toLowerCase();
            const kB = (b.extracted_keywords?.[0] || '').toLowerCase();
            return kA.localeCompare(kB, 'zh-CN') || (new Date(b.published_date) - new Date(a.published_date));
        });
    }

    displayList.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card';
        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';
        const keywords = (paper.extracted_keywords || []).slice(0, 4).map(k => `<span class="tag">#${k}</span>`).join('');
        const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 2).join(', ') : (paper.authors || '未知');
        const recommendCount = paper.recommend || 0;

        card.innerHTML = `
            <div class="paper-date">�� ${dateStr} · ${authors}</div>
            <h3 class="paper-title">${paper.title}</h3>
            <div class="paper-abstract">${paper.abstract || '暂无摘要'}</div>
            <div class="paper-keywords">${keywords}</div>
            
            <div class="paper-actions">
                <button class="like-btn" onclick="handleLike(this, '${paper.title}')">
                    &#128077; <span class="like-count">${recommendCount}</span>
                </button>
            </div>
        `;

        card.onclick = (e) => {
            if (e.target.closest('.like-btn')) return;
            openModal(paper);
        };
        timeline.appendChild(card);
    });
}

// 6. Modal 逻辑
function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;
    const summaryHtml = typeof marked !== 'undefined' ? marked.parse(paper.detailed_summary || paper.abstract) : paper.abstract;

    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta">
            <p><strong>�� 作者:</strong> ${paper.authors}</p>
            <p><strong>�� 发布时间:</strong> ${paper.published_date}</p>
            <p><strong>�� 热门度:</strong> ${paper.recommend || 0}</p>
            <a href="${paper.url}" target="_blank" class="btn-link">�� 阅读全文</a>
        </div>
        <div class="markdown-body" style="line-height:1.8; color:#334155;">${summaryHtml}</div>
    `;

    const qaList = document.getElementById('qaList');
    if (paper.qa_pairs && paper.qa_pairs.length) {
        qaList.innerHTML = `<h3 style="margin-top:30px; border-top:1px solid #e2e8f0; padding-top:20px;">�� AI 问答</h3>` +
            paper.qa_pairs.map(qa => `
            <div style="background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:15px; border:1px solid #e2e8f0;">
                <div style="font-weight:700; color:#2563eb; margin-bottom:10px;">Q: ${qa.question}</div>
                <div style="color:#475569;">${typeof marked !== 'undefined' ? marked.parse(qa.answer) : qa.answer}</div>
            </div>`).join('');
    } else {
        qaList.innerHTML = '';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(modal, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
    }
}

// 7. 辅助函数
const modal = document.getElementById('paperModal');
document.querySelector('.close').onclick = () => { modal.classList.remove('active'); document.body.style.overflow = 'auto'; };
window.onclick = (e) => { if (e.target == modal) { modal.classList.remove('active'); document.body.style.overflow = 'auto'; }};

document.getElementById('searchInput').addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    if (!val) { resetFilter(document.querySelector('.nav-item')); return; }
    
    const results = globalData.allPapers.filter(p => {
        return (p.title||'').toLowerCase().includes(val) || 
               (p.abstract||'').toLowerCase().includes(val) || 
               (p.extracted_keywords||[]).join(' ').toLowerCase().includes(val);
    });

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('filterStatus').style.display = 'flex';
    document.getElementById('currentFilterLabel').innerText = `搜索: "${val}"`;
    renderPapers(results);
});

function animateCount(id, start, end, duration) {
    const obj = document.getElementById(id);
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

function setupEventListeners() {}