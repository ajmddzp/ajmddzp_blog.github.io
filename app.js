// 1. 初始化 Supabase
const SUPABASE_URL = 'https://hycwhikohozmeovgalfb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_79NgWYqq0wMHpv3y5mFEKQ_13f3BHLU';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let globalData = {
    allPapers: [],
    indexByDate: {},
    currentDisplayedPapers: [],
    sortMode: 'date'
};

document.addEventListener('DOMContentLoaded', () => initApp());

// 2. 数据初始化
async function initApp() {
    const loadingEl = document.getElementById('loading');
    try {
        // 从 Supabase 获取所有数据
        const { data, error } = await supabaseClient
            .from('papers') // 请确认表名正确
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        globalData.allPapers = data;
        processData(data);
        renderSidebar();
        renderPapers(data);
        animateCount('totalCount', 0, data.length, 1000);
    } catch (error) {
        console.error("加载失败:", error);
    } finally {
        loadingEl.style.display = 'none';
    }
}

function processData(papers) {
    globalData.indexByDate = {};
    papers.forEach(p => {
        const date = new Date(p.created_at);
        const dateKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
        if (!globalData.indexByDate[dateKey]) globalData.indexByDate[dateKey] = [];
        globalData.indexByDate[dateKey].push(p);
    });
}

// 3. 渲染逻辑
function renderPapers(papers) {
    globalData.currentDisplayedPapers = papers;
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    const sorted = [...papers].sort((a, b) => {
        if (globalData.sortMode === 'likes') return (b.likes || 0) - (a.likes || 0);
        if (globalData.sortMode === 'date') return new Date(b.created_at) - new Date(a.created_at);
        return (a.title || '').localeCompare(b.title || '', 'zh-CN');
    });

    sorted.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card';
        card.innerHTML = `
            <div onclick="openModalById(${paper.id})">
                <div class="paper-date">�� ${paper.created_at.split('T')[0]}</div>
                <h3 class="paper-title">${paper.title}</h3>
                <div class="paper-abstract">${paper.abstract || '暂无摘要'}</div>
            </div>
            <div class="paper-footer">
                <div class="paper-keywords">
                    <span class="tag">#arXiv</span>
                </div>
                <button class="like-btn" id="like-${paper.id}" onclick="handleLike(event, ${paper.id})">
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    <span class="count">${paper.likes || 0}</span>
                </button>
            </div>
        `;
        timeline.appendChild(card);
    });
}

// 4. 点赞核心功能
async function handleLike(event, id) {
    event.stopPropagation();
    const btn = document.getElementById(`like-${id}`);
    const countSpan = btn.querySelector('.count');
    btn.classList.add('loading');
    
    try {
        const target = globalData.allPapers.find(p => p.id === id);
        const newLikes = (target.likes || 0) + 1;

        // 更新数据库
        const { error } = await supabaseClient
            .from('papers')
            .update({ likes: newLikes })
            .eq('id', id);

        if (error) throw error;

        // 同步前端数据并更新 UI
        target.likes = newLikes;
        countSpan.innerText = newLikes;
        renderSidebar(); // 实时更新侧边栏排行
    } catch (err) {
        console.error("点赞失败:", err);
    } finally {
        btn.classList.remove('loading');
    }
}

function renderSidebar() {
    // 渲染日期部分 (略过，结构同原代码)
    const hotList = document.getElementById('hotList');
    const sortedHot = [...globalData.allPapers].sort((a,b) => (b.likes||0) - (a.likes||0)).slice(0, 5);
    hotList.innerHTML = sortedHot.map(p => `
        <li class="nav-item" onclick="openModalById(${p.id})">
            <span>❤️ ${p.likes || 0} | ${p.title.substring(0, 20)}...</span>
        </li>
    `).join('');
}

function changeSort(mode, btn) {
    globalData.sortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPapers(globalData.currentDisplayedPapers);
}

// 原有逻辑保持兼容
window.openModalById = (id) => {
    const paper = globalData.allPapers.find(p => p.id === id);
    if (paper) openModal(paper);
};

function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;
    document.getElementById('paperDetails').innerHTML = `<p>${paper.abstract}</p>`;
    modal.classList.add('active');
}

document.querySelector('.close').onclick = () => {
    document.getElementById('paperModal').classList.remove('active');
    document.body.style.overflow = 'auto';
};

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