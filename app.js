// --- 1. Supabase 初始化配置 ---
const SUPABASE_URL = 'https://hycwhikohozmeovgalfb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_79NgWYqq0wMHpv3y5mFEKQ_13f3BHLU';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 全局数据存储
let globalData = {
    allPapers: [],      
    indexByDate: {},    
    indexByKeyword: {}, 
    currentDisplayedPapers: [], 
    sortMode: 'date',  // 'date', 'keyword', 或 'likes'
    likesMap: {}       // 缓存各论文点赞数：{ paperId: count }
};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupSearch(); // 补全搜索监听
});

// --- 2. 初始化与 UI 构造 ---
async function initApp() {
    const loadingEl = document.getElementById('loading');
    // 在工具栏添加“点赞排序”按钮
    addLikesSortButton();

    try {
        const indexRes = await fetch('papers_index.json');
        if (!indexRes.ok) throw new Error("无法读取索引文件");
        const filenames = await indexRes.json();
        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const papers = await Promise.all(promises);

        processData(papers);
        renderSidebar();
        
        // 初次加载先获取所有点赞数据，再渲染
        await fetchAllLikes();
        renderPapers(globalData.allPapers); 
        animateCount('totalCount', 0, globalData.allPapers.length, 1000);

    } catch (error) {
        console.error("初始化失败:", error);
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 动态添加点赞排序按钮到 HTML
function addLikesSortButton() {
    const sortControls = document.querySelector('.sort-controls');
    if (sortControls) {
        const btn = document.createElement('button');
        btn.className = 'sort-btn';
        btn.id = 'sortByLikesBtn';
        btn.innerHTML = '�� 最多点赞';
        btn.onclick = () => changeSort('likes', btn);
        sortControls.appendChild(btn);
    }
}

// --- 3. 数据处理与渲染 ---
function processData(papers) {
    globalData.allPapers = papers;
    globalData.indexByDate = {};
    globalData.indexByKeyword = {};

    papers.forEach(paper => {
        // 日期索引
        let dateKey = '其他日期';
        if (paper.published_date) {
            const date = new Date(paper.published_date);
            if (!isNaN(date)) dateKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
        }
        if (!globalData.indexByDate[dateKey]) globalData.indexByDate[dateKey] = [];
        globalData.indexByDate[dateKey].push(paper);

        // 关键词索引
        const keywords = [...(paper.extracted_keywords || []), ...(paper.keywords || [])];
        keywords.forEach(kw => {
            const k = kw.trim().toLowerCase();
            if (k.length < 2) return;
            if (!globalData.indexByKeyword[k]) globalData.indexByKeyword[k] = [];
            globalData.indexByKeyword[k].push(paper);
        });
    });
}

function renderPapers(papers) {
    globalData.currentDisplayedPapers = papers;
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = ''; 

    let displayList = [...papers];

    // 排序逻辑
    if (globalData.sortMode === 'likes') {
        displayList.sort((a, b) => {
            const countA = globalData.likesMap[getPaperId(a)] || 0;
            const countB = globalData.likesMap[getPaperId(b)] || 0;
            return countB - countA; // 点赞多在前面
        });
    } else if (globalData.sortMode === 'keyword') {
        displayList.sort((a, b) => {
            const keyA = (a.extracted_keywords?.[0] || '').toLowerCase();
            const keyB = (b.extracted_keywords?.[0] || '').toLowerCase();
            return keyA.localeCompare(keyB, 'zh-CN');
        });
    } else {
        displayList.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    }

    displayList.forEach(paper => {
        const paperId = getPaperId(paper);
        const card = document.createElement('div');
        card.className = 'paper-card';
        const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 2).join(', ') : (paper.authors || '未知');
        const likesCount = globalData.likesMap[paperId] || 0;

        card.innerHTML = `
            <div class="paper-date">�� ${paper.published_date?.split('T')[0] || '未知'} · ${authors}</div>
            <h3 class="paper-title">${paper.title}</h3>
            <div class="paper-abstract">${paper.abstract || ''}</div>
            <div class="paper-keywords">${(paper.extracted_keywords || []).slice(0, 3).map(k => `<span class="tag">#${k}</span>`).join('')}</div>
            <div class="like-container" id="like-${paperId}">
                <span class="like-icon">❤️</span>
                <span class="like-count" id="count-${paperId}">${likesCount}</span>
            </div>
        `;

        card.onclick = (e) => {
            if (e.target.closest('.like-container')) return;
            openModal(paper);
        };

        timeline.appendChild(card);

        card.querySelector('.like-container').onclick = (e) => {
            e.stopPropagation();
            handleLikeClick(paperId, paper.title);
        };
    });
}

// --- 4. 数据库交互逻辑 ---
function getPaperId(paper) {
    return paper.id ? parseInt(paper.id) : Math.abs(hashCode(paper.title));
}

async function fetchAllLikes() {
    const { data, error } = await supabaseClient.from('likes').select('id, likes');
    if (data) {
        data.forEach(item => { globalData.likesMap[item.id] = item.likes; });
    }
}

async function handleLikeClick(id, title) {
    const countEl = document.getElementById(`count-${id}`);
    let currentVal = parseInt(countEl.innerText);
    
    currentVal++;
    countEl.innerText = currentVal;
    globalData.likesMap[id] = currentVal; // 更新缓存

    await supabaseClient.from('likes').upsert({ 
        id: id, 
        title: title.substring(0, 200), 
        likes: currentVal 
    }, { onConflict: 'id' });
}

// --- 5. 搜索与过滤补全 ---
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (!val) { resetFilter(); return; }

        const results = globalData.allPapers.filter(p => 
            (p.title || '').toLowerCase().includes(val) || 
            (p.abstract || '').toLowerCase().includes(val)
        );
        
        document.getElementById('filterStatus').style.display = 'flex';
        document.getElementById('currentFilterLabel').innerText = `搜索: "${val}"`;
        renderPapers(results);
    });
}

// 切换排序
function changeSort(mode, btnElement) {
    globalData.sortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    renderPapers(globalData.currentDisplayedPapers);
}

// 辅助函数
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

// 原有模态框、侧边栏逻辑保持不变
function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;
    const summaryHtml = typeof marked !== 'undefined' ? marked.parse(paper.detailed_summary || paper.abstract) : paper.abstract;
    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta"><p>�� 作者: ${Array.isArray(paper.authors)?paper.authors.join(', '):paper.authors}</p><p>�� 时间: ${paper.published_date||'未知'}</p></div>
        <h3>摘要</h3><div class="markdown-body">${summaryHtml}</div>
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function resetFilter() {
    document.getElementById('filterStatus').style.display = 'none';
    document.getElementById('searchInput').value = '';
    renderPapers(globalData.allPapers);
}

function renderSidebar() {
    const dateListEl = document.getElementById('dateIndexList');
    const sortedDates = Object.keys(globalData.indexByDate).sort((a,b)=>b.localeCompare(a));
    dateListEl.innerHTML = `<li class="nav-item active" onclick="resetFilter()"><span>�� 全部</span><span class="count">${globalData.allPapers.length}</span></li>`;
    sortedDates.forEach(date => {
        dateListEl.innerHTML += `<li class="nav-item" onclick="filterByDate('${date}', this)"><span>�� ${date}</span><span class="count">${globalData.indexByDate[date].length}</span></li>`;
    });
}

function filterByDate(date, el) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    renderPapers(globalData.indexByDate[date]);
}

function animateCount(id, s, e, d) {
    const obj = document.getElementById(id);
    let startT = null;
    const step = (t) => {
        if (!startT) startT = t;
        const progress = Math.min((t - startT) / d, 1);
        obj.innerHTML = Math.floor(progress * (e - s) + s);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}