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
    sortMode: 'date'            
};

// 页面加载后启动
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// 加载数据逻辑
async function initApp() {
    const loadingEl = document.getElementById('loading');
    try {
        const indexRes = await fetch('papers_index.json');
        if (!indexRes.ok) throw new Error("无法读取索引文件");
        const filenames = await indexRes.json();
        const promises = filenames.map(name => fetch(name).then(r => r.json()));
        const papers = await Promise.all(promises);

        processData(papers);
        renderSidebar();
        renderPapers(globalData.allPapers); 
        animateCount('totalCount', 0, globalData.allPapers.length, 1000);

    } catch (error) {
        console.error("初始化失败:", error);
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 数据预处理
function processData(papers) {
    papers.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    globalData.allPapers = papers;
    globalData.indexByDate = {};
    globalData.indexByKeyword = {};

    papers.forEach(paper => {
        let dateKey = '其他日期';
        if (paper.published_date) {
            const date = new Date(paper.published_date);
            if (!isNaN(date)) {
                dateKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
            }
        }
        if (!globalData.indexByDate[dateKey]) globalData.indexByDate[dateKey] = [];
        globalData.indexByDate[dateKey].push(paper);

        const keywords = [...(paper.extracted_keywords || []), ...(paper.keywords || [])];
        const uniqueKeywords = [...new Set(keywords.map(k => k.trim().toLowerCase()))];
        uniqueKeywords.forEach(kw => {
            if (kw.length < 2) return;
            if (!globalData.indexByKeyword[kw]) globalData.indexByKeyword[kw] = [];
            globalData.indexByKeyword[kw].push(paper);
        });
    });
}

// 核心：渲染论文卡片并同步点赞数
function renderPapers(papers) {
    globalData.currentDisplayedPapers = papers;
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = ''; 

    if (!papers || papers.length === 0) {
        timeline.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#94a3b8;"><p>⚠️ 没有找到匹配的论文</p></div>`;
        return;
    }

    // 复制并根据当前模式排序
    let displayList = [...papers];
    if (globalData.sortMode === 'keyword') {
        displayList.sort((a, b) => {
            const keyA = (a.extracted_keywords && a.extracted_keywords.length > 0) ? a.extracted_keywords[0].trim().toLowerCase() : '';
            const keyB = (b.extracted_keywords && b.extracted_keywords.length > 0) ? b.extracted_keywords[0].trim().toLowerCase() : '';
            return keyA.localeCompare(keyB, 'zh-CN');
        });
    } else {
        displayList.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    }

    displayList.forEach(paper => {
        // 生成唯一的数字 ID (因为你的 likes 表 id 是 int8 类型)
        // 逻辑：如果 paper 本身有数字 ID 则用它，否则从标题生成一个数字
        const paperId = paper.id ? parseInt(paper.id) : Math.abs(hashCode(paper.title));
        
        const card = document.createElement('div');
        card.className = 'paper-card';
        const dateStr = paper.published_date ? paper.published_date.split('T')[0] : '未知日期';
        const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 2).join(', ') + (paper.authors.length > 2 ? ' 等' : '') : (paper.authors || '未知作者');

        card.innerHTML = `
            <div class="paper-date">&#127911; ${dateStr} · ${authors}</div>
            <h3 class="paper-title">${paper.title}</h3>
            <div class="paper-abstract">${paper.abstract || '暂无摘要内容...'}</div>
            <div class="paper-keywords">${(paper.extracted_keywords || []).slice(0, 3).map(k => `<span class="tag">#${k}</span>`).join('')}</div>
            <div class="like-container" id="like-${paperId}">
                <span class="like-icon">❤️</span>
                <span class="like-count" id="count-${paperId}">0</span>
            </div>
        `;

        // 点击卡片进入详情，排除点击点赞按钮的情况
        card.onclick = (e) => {
            if (e.target.closest('.like-container')) return;
            openModal(paper);
        };

        timeline.appendChild(card);

        // 异步获取点赞数
        refreshLikes(paperId);

        // 绑定点赞点击事件
        const likeBtn = card.querySelector(`#like-${paperId}`);
        likeBtn.onclick = (e) => {
            e.stopPropagation(); // 防止触发打开弹窗
            handleLikeClick(paperId, paper.title);
        };
    });
}

// --- 数据库交互：获取点赞数 ---
async function refreshLikes(id) {
    const { data, error } = await supabaseClient
        .from('likes')
        .select('likes')
        .eq('id', id)
        .single();
    if (data) document.getElementById(`count-${id}`).innerText = data.likes;
}

// --- 数据库交互：点赞 +1 (Upsert 逻辑) ---
async function handleLikeClick(id, title) {
    const countEl = document.getElementById(`count-${id}`);
    const btnEl = document.getElementById(`like-${id}`);
    let currentVal = parseInt(countEl.innerText);

    // 乐观 UI 更新
    btnEl.classList.add('liked');
    countEl.innerText = currentVal + 1;

    // 向 Supabase 写入：如果 id 存在则更新，不存在则插入
    const { data, error } = await supabaseClient
        .from('likes')
        .upsert({ 
            id: id, 
            title: title.substring(0, 255), // 限制长度
            likes: currentVal + 1,
            created_at: new Date()
        }, { onConflict: 'id' });

    if (error) {
        console.error("Supabase 同步错误:", error);
    }
}

// 辅助函数：将标题转为数字 ID (用于 int8 匹配)
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; 
    }
    return Math.abs(hash);
}

// --- 以下为原有的 UI 辅助函数 ---

function openModal(paper) {
    const modal = document.getElementById('paperModal');
    document.getElementById('paperTitle').innerText = paper.title;
    const summaryHtml = typeof marked !== 'undefined' ? marked.parse(paper.detailed_summary || paper.abstract) : paper.abstract;
    const authorsFull = Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors;

    document.getElementById('paperDetails').innerHTML = `
        <div class="detail-meta">
            <p><strong>�� 作者:</strong> ${authorsFull}</p>
            <p><strong>�� 发布时间:</strong> ${paper.published_date || '未知'}</p>
            <a href="${paper.url}" target="_blank" class="btn-link">�� 阅读全文 (PDF/ArXiv)</a>
        </div>
        <h3>�� 摘要 / 核心总结</h3>
        <div class="markdown-body">${summaryHtml}</div>
    `;

    if (paper.qa_pairs && paper.qa_pairs.length) {
        document.getElementById('qaList').innerHTML = `<h3 style="margin-top:30px; border-top:1px solid #e2e8f0; padding-top:20px;">�� AI 问答解析</h3>` +
            paper.qa_pairs.map(qa => `<div style="background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:15px; border:1px solid #e2e8f0;"><div style="font-weight:700; color:#2563eb; margin-bottom:10px;">Q: ${qa.question}</div><div>${typeof marked !== 'undefined' ? marked.parse(qa.answer) : qa.answer}</div></div>`).join('');
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(modal, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
    }
}

const modal = document.getElementById('paperModal');
const closeBtn = document.querySelector('.close');
function closeModal() { modal.classList.remove('active'); document.body.style.overflow = 'auto'; }
closeBtn.onclick = closeModal;
window.onclick = (e) => { if (e.target == modal) closeModal(); }

function changeSort(mode, btnElement) {
    globalData.sortMode = mode;
    document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    renderPapers(globalData.currentDisplayedPapers);
}

function resetFilter(element) {
    document.getElementById('filterStatus').style.display = 'none';
    document.getElementById('searchInput').value = '';
    renderPapers(globalData.allPapers);
}

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

function renderSidebar() {
    const dateListEl = document.getElementById('dateIndexList');
    const sortedDates = Object.keys(globalData.indexByDate).sort((a, b) => b.localeCompare(a));
    dateListEl.innerHTML = `<li class="nav-item active" onclick="resetFilter(this)"><span>�� 全部论文</span><span class="count">${globalData.allPapers.length}</span></li>`;
    sortedDates.forEach(date => {
        dateListEl.innerHTML += `<li class="nav-item" onclick="filterBy('date', '${date}', this)"><span>�� ${date}</span><span class="count">${globalData.indexByDate[date].length}</span></li>`;
    });
}

function filterBy(type, value, element) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    document.getElementById('filterStatus').style.display = 'flex';
    document.getElementById('currentFilterLabel').innerText = value;
    const filtered = type === 'date' ? globalData.indexByDate[value] : globalData.indexByKeyword[value];
    renderPapers(filtered);
}