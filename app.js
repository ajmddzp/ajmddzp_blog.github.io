// 1. 初始化 Supabase 客户端
const SUPABASE_URL = 'https://hycwhikohozmeovgalfb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_79NgWYqq0wMHpv3y5mFEKQ_13f3BHLU';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 全局状态
let globalData = {
    allPapers: [],      
    indexByDate: {},    
    indexByKeyword: {}, 
    currentDisplayedPapers: [], 
    sortMode: 'date'            
};

document.addEventListener('DOMContentLoaded', () => initApp());

// 2. 初始化：合并 Github 数据与 Supabase Likes
async function initApp() {
    const loadingEl = document.getElementById('loading');
    try {
        // 第一步：从 Github 获取静态索引
        const indexRes = await fetch('papers_index.json');
        if (!indexRes.ok) throw new Error("无法读取本地索引文件");
        const filenames = await indexRes.json();

        // 第二步：加载所有本地 JSON 文件内容
        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const localPapers = await Promise.all(promises);

        // 第三步：从 Supabase 批量拉取 likes 数据
        // 我们假设数据库中 title 或文件名作为唯一标识。这里推荐使用 title。
        const { data: remoteLikes, error } = await supabaseClient
            .from('papers')
            .select('title, likes');

        // 创建一个映射表方便快速查询
        const likesMap = {};
        if (remoteLikes) {
            remoteLikes.forEach(item => { likesMap[item.title] = item.likes; });
        }

        // 第四步：合并数据
        const mergedData = localPapers.map(p => ({
            ...p,
            likes: likesMap[p.title] || 0 // 如果数据库没记录，默认为 0
        }));

        processData(mergedData);
        renderSidebar();
        renderPapers(globalData.allPapers);
        animateCount('totalCount', 0, globalData.allPapers.length, 1000);

    } catch (error) {
        console.error("加载失败:", error);
    } finally {
        loadingEl.style.display = 'none';
    }
}

function processData(papers) {
    // 默认按发布日期降序
    papers.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    globalData.allPapers = papers;
    globalData.indexByDate = {};
    globalData.indexByKeyword = {};

    papers.forEach(paper => {
        // 日期索引
        let dateKey = '其他日期';
        if (paper.published_date) {
            const date = new Date(paper.published_date);
            dateKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
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
}

// 3. 点赞交互逻辑
async function handleLike(event, title) {
    event.stopPropagation();
    const btn = event.currentTarget;
    const countSpan = btn.querySelector('.count');
    btn.classList.add('loading');

    try {
        // 使用 Supabase 的 rpc 或通过先查后改的方式实现 likes + 1
        // 这里使用更简单的方式：先获取当前值
        const { data } = await supabaseClient
            .from('papers')
            .select('likes')
            .eq('title', title)
            .single();

        let currentLikes = data ? data.likes : 0;
        let newLikes = currentLikes + 1;

        // 更新或插入
        const { error } = await supabaseClient
            .from('papers')
            .upsert({ title: title, likes: newLikes }, { onConflict: 'title' });

        if (error) throw error;

        // 更新本地内存中的数据
        const paper = globalData.allPapers.find(p => p.title === title);
        if (paper) paper.likes = newLikes;

        countSpan.innerText = newLikes;
        renderSidebar(); // 刷新热门排行
    } catch (err) {
        console.error("点赞同步失败:", err);
    } finally {
        btn.classList.remove('loading');
    }
}

function renderPapers(papers) {
    globalData.currentDisplayedPapers = papers;
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    let displayList = [...papers];

    // 排序逻辑
    if (globalData.sortMode === 'date') {
        displayList.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    } else if (globalData.sortMode === 'likes') {
        displayList.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    } else if (globalData.sortMode === 'keyword') {
        displayList.sort((a, b) => (a.extracted_keywords?.[0] || '').localeCompare(b.extracted_keywords?.[0] || ''));
    }

    displayList.forEach(paper => {
        const card = document.createElement('div');
        card.className = 'paper-card';
        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';
        const keywordsHtml = (paper.extracted_keywords || []).slice(0, 3).map(k => `<span class="tag">#${k}</span>`).join('');

        card.innerHTML = `
            <div onclick="openModalByTitle('${encodeURIComponent(paper.title)}')">
                <div class="paper-date">�� ${dateStr}</div>
                <h3 class="paper-title">${paper.title}</h3>
                <div class="paper-abstract">${paper.abstract || '...'}</div>
            </div>
            <div class="paper-footer">
                <div class="paper-keywords">${keywordsHtml}</div>
                <button class="like-btn" onclick="handleLike(event, '${paper.title.replace(/'/g, "\\'")}')">
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    <span class="count">${paper.likes || 0}</span>
                </button>
            </div>
        `;
        timeline.appendChild(card);
    });
}

function renderSidebar() {
    // 渲染日期
    const dateListEl = document.getElementById('dateIndexList');
    const sortedDates = Object.keys(globalData.indexByDate).sort((a, b) => b.localeCompare(a));
    dateListEl.innerHTML = `<li class="nav-item active" onclick="resetFilter(this)"><span>�� 全部论文</span><span class="count">${globalData.allPapers.length}</span></li>`;
    sortedDates.forEach(date => {
        dateListEl.innerHTML += `<li class="nav-item" onclick="filterBy('date', '${date}', this)"><span>�� ${date}</span><span class="count">${globalData.indexByDate[date].length}</span></li>`;
    });

    // 渲染热门推荐 (基于 Likes)
    const hotListEl = document.getElementById('hotList');
    const sortedHot = [...globalData.allPapers]
        .filter(p => p.likes > 0)
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 5);

    hotListEl.innerHTML = sortedHot.length ? '' : '<li class="nav-item" style="color:#94a3b8">暂无点赞</li>';
    sortedHot.forEach(p => {
        hotListEl.innerHTML += `
            <li class="nav-item" onclick="openModalByTitle('${encodeURIComponent(p.title)}')">
                <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">❤️ ${p.likes} | ${p.title}</span>
            </li>
        `;
    });
}

// 辅助功能
window.openModalByTitle = (encodedTitle) => {
    const title = decodeURIComponent(encodedTitle);
    const paper = globalData.allPapers.find(p => p.title === title);
    if (paper) openModal(paper);
};

function changeSort(mode, btn) {
    globalData.sortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPapers(globalData.currentDisplayedPapers);
}

function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;
    const summaryHtml = renderMarkdown(paper.detailed_summary || paper.abstract);
    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta">
            <p><strong>�� 发布时间:</strong> ${paper.published_date || '未知'}</p>
            <p><strong>❤️ 点赞热度:</strong> ${paper.likes || 0}</p>
            <a href="${paper.url}" target="_blank" class="btn-link">�� 阅读全文 (ArXiv)</a>
        </div>
        <div class="markdown-body">${summaryHtml}</div>
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function resetFilter(el) {
    if(el) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
    }
    document.getElementById('filterStatus').style.display = 'none';
    renderPapers(globalData.allPapers);
}

function filterBy(type, val, el) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    const filtered = globalData.indexByDate[val] || [];
    document.getElementById('filterStatus').style.display = 'flex';
    document.getElementById('currentFilterLabel').innerText = val;
    renderPapers(filtered);
}

function closeModal() {
    document.getElementById('paperModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

document.querySelector('.close').onclick = closeModal;
window.onclick = (e) => { if(e.target.className === 'modal active') closeModal(); };

function renderMarkdown(t) { return marked.parse(t); }
function animateCount(id, s, e, d) {
    const obj = document.getElementById(id);
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / d, 1);
        obj.innerHTML = Math.floor(progress * (e - s) + s);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}