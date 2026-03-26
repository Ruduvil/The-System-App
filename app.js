// ===== THE SYSTEM — Solo Leveling Life App (Firebase Edition) =====
(function(){
'use strict';

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
    apiKey: "AIzaSyCES-JLRAmCHvZnrj3ri_Hfoe2p1mv7h90",
    authDomain: "the-system-app-7adce.firebaseapp.com",
    projectId: "the-system-app-7adce",
    storageBucket: "the-system-app-7adce.firebasestorage.app",
    messagingSenderId: "939007623094",
    appId: "1:939007623094:web:ddb5fc93e44b5f566ecb17"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ===== REGISTER SERVICE WORKER =====
if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

// ===== CONSTANTS =====
const RANKS = ['E','D','C','B','A','S'];
const RANK_LEVELS = {E:1, D:10, C:25, B:50, A:80, S:100};
const DIFF_XP = {E:20, D:40, C:70, B:120, A:200, S:350};
const DIFF_STAT = {E:1, D:2, C:3, B:5, A:8, S:12};
const STAT_KEYS = ['str','int','vit','per','agi','sen'];
const STAT_NAMES = {str:'Strength',int:'Intelligence',vit:'Vitality',per:'Perception',agi:'Agility',sen:'Sense'};
const STAT_ICONS = {str:'💪',int:'🧠',vit:'❤️',per:'👁️',agi:'⚡',sen:'🌙'};
const STAT_CATS = {exercise:'str',productivity:'int',wellness:'vit'};
const SHADOW_THRESHOLD = 3;
const CAT_ICONS = {exercise:'🏋️',productivity:'📚',wellness:'💧'};
const VERIFIED_XP_BONUS = 1.5;
const PENALTY_STAT_LOSS = 2;

const DEFAULT_QUESTS = [
    {name:'Do 50 push-ups',category:'exercise',difficulty:'D',timerMins:0},
    {name:'Run 3km',category:'exercise',difficulty:'C',timerMins:0},
    {name:'30 min workout',category:'exercise',difficulty:'C',timerMins:30},
    {name:'Study for 1 hour',category:'productivity',difficulty:'C',timerMins:60},
    {name:'Complete 3 tasks',category:'productivity',difficulty:'D',timerMins:0},
    {name:'Read 30 pages',category:'productivity',difficulty:'D',timerMins:20},
    {name:'Drink 2L water',category:'wellness',difficulty:'E',timerMins:0},
    {name:'Sleep 8 hours',category:'wellness',difficulty:'D',timerMins:0},
    {name:'Meditate 10 min',category:'wellness',difficulty:'D',timerMins:10},
];

// ===== STATE =====
let state = null;
let currentHunterFilter = 'all-hunters';
let timerInterval = null;
let timerQuestId = null;
let unsubVerify = null; // Firestore listener

const $ = id => document.getElementById(id);
function getToday(){ return new Date().toISOString().split('T')[0]; }
function xpForLevel(lvl){ return lvl * 100; }
function getRank(level){ let rank='E'; for(const r of RANKS){ if(level >= RANK_LEVELS[r]) rank=r; } return rank; }
function totalStats(s){ return STAT_KEYS.reduce((a,k)=>a+s[k],0); }

function defaultState(name, uid){
    return {
        uid, name: name||'',
        level:1, xp:0,
        stats:{str:5,int:5,vit:5,per:5,agi:5,sen:5},
        statPoints:0,
        quests: DEFAULT_QUESTS.map((q,i)=>({...q, id:'q'+i, completed:false, verified:false, pendingVerify:false})),
        customQuestId:100,
        completedToday:0, xpToday:0,
        dayStreak:0, lastActiveDate:null,
        shadows:[], questHistory:{},
        allies:[], enemies:[],
        wins:0, losses:0,
        penaltyApplied:false,
    };
}

// ===== FIRESTORE HELPERS =====
async function saveState(){
    if(!state) return;
    const key = state.name.toLowerCase();
    await db.collection('hunters').doc(key).set(state, {merge:true});
}

async function loadState(name){
    const doc = await db.collection('hunters').doc(name.toLowerCase()).get();
    return doc.exists ? doc.data() : null;
}

async function getAllHunters(){
    const snap = await db.collection('hunters').get();
    return snap.docs.map(d=>d.data());
}

async function getHunter(name){
    const doc = await db.collection('hunters').doc(name.toLowerCase()).get();
    return doc.exists ? doc.data() : null;
}

// ===== BOOT =====
function boot(){
    const bootScreen = $('boot-screen');
    // Listen for auth state changes
    auth.onAuthStateChanged(async user => {
        setTimeout(()=>{
            bootScreen.classList.add('fade-out');
            setTimeout(async ()=>{
                bootScreen.classList.add('hidden');
                if(user){
                    // User is signed in — load their data
                    const displayName = user.displayName || user.email.split('@')[0];
                    const data = await loadState(displayName);
                    if(data){
                        state = data;
                        checkDayReset();
                        showApp();
                    } else {
                        showAuth();
                    }
                } else {
                    showAuth();
                }
            }, 600);
        }, 2000);
    });
}

// ===== AUTH =====
let authMode = 'register';
function showAuth(){ $('auth-screen').classList.remove('hidden'); $('app').classList.add('hidden'); updateAuthUI(); }
function updateAuthUI(){
    $('auth-title').textContent = authMode==='register' ? 'Hunter Registration' : 'Hunter Login';
    $('auth-prompt').textContent = authMode==='register' ? 'Create your Hunter profile.' : 'Welcome back, Hunter.';
    $('auth-submit').textContent = authMode==='register' ? 'REGISTER' : 'LOGIN';
    $('auth-switch-text').textContent = authMode==='register' ? 'Already a Hunter?' : 'New Hunter?';
    $('auth-switch-link').textContent = authMode==='register' ? 'Login' : 'Register';
    $('auth-error').classList.add('hidden');
    // Show/hide email field
    $('auth-email').style.display = authMode==='register' ? 'block' : 'none';
    $('auth-name').placeholder = authMode==='register' ? 'Hunter Name' : 'Hunter Name or Email';
}
$('auth-switch-link').addEventListener('click', e=>{ e.preventDefault(); authMode = authMode==='register'?'login':'register'; updateAuthUI(); });

$('auth-submit').addEventListener('click', async ()=>{
    const name = $('auth-name').value.trim();
    const email = $('auth-email').value.trim();
    const pass = $('auth-pass').value;
    const btn = $('auth-submit');
    btn.disabled = true; btn.textContent = '...';

    try {
        if(authMode==='register'){
            if(!name || !email || !pass){ showAuthError('Fill in all fields.'); return; }
            if(pass.length < 6){ showAuthError('Password must be at least 6 characters.'); return; }
            // Check if name is taken
            const existing = await getHunter(name);
            if(existing){ showAuthError('Hunter name already taken!'); return; }
            // Create Firebase Auth user
            const cred = await auth.createUserWithEmailAndPassword(email, pass);
            await cred.user.updateProfile({displayName: name});
            // Create Firestore document
            state = defaultState(name, cred.user.uid);
            await saveState();
            $('auth-screen').classList.add('hidden');
            showApp();
            toast('Hunter profile created. Welcome, '+name+'!');
        } else {
            if(!name || !pass){ showAuthError('Enter name/email and password.'); return; }
            // Try to login — name could be email or hunter name
            let loginEmail = name;
            if(!name.includes('@')){
                // Lookup email from hunter name
                const hunter = await getHunter(name);
                if(!hunter){ showAuthError('Hunter not found!'); return; }
                // Need to get email from auth — try common pattern
                // Actually, we store the email in Firestore too
                if(hunter.email) loginEmail = hunter.email;
                else { showAuthError('Hunter not found!'); return; }
            }
            const cred = await auth.signInWithEmailAndPassword(loginEmail, pass);
            const displayName = cred.user.displayName || loginEmail.split('@')[0];
            state = await loadState(displayName);
            if(!state){ showAuthError('Profile data not found.'); return; }
            checkDayReset();
            $('auth-screen').classList.add('hidden');
            showApp();
            toast('Welcome back, '+state.name+'!');
        }
    } catch(err){
        let msg = err.message;
        if(err.code === 'auth/email-already-in-use') msg = 'Email already registered!';
        if(err.code === 'auth/invalid-email') msg = 'Invalid email address.';
        if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Wrong password!';
        if(err.code === 'auth/user-not-found') msg = 'Account not found!';
        showAuthError(msg);
    } finally {
        btn.disabled = false;
        btn.textContent = authMode==='register' ? 'REGISTER' : 'LOGIN';
    }
});

$('auth-name').addEventListener('keydown',e=>{ if(e.key==='Enter'){ if(authMode==='register') $('auth-email').focus(); else $('auth-pass').focus(); }});
$('auth-email').addEventListener('keydown',e=>{ if(e.key==='Enter') $('auth-pass').focus(); });
$('auth-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') $('auth-submit').click(); });
function showAuthError(msg){ const el=$('auth-error'); el.textContent=msg; el.classList.remove('hidden'); }

// ===== LOGOUT =====
$('btn-logout').addEventListener('click', async ()=>{
    await saveState();
    if(unsubVerify) unsubVerify();
    await auth.signOut();
    state = null;
    $('app').classList.add('hidden');
    $('auth-name').value=''; $('auth-email').value=''; $('auth-pass').value='';
    authMode='login'; showAuth();
});

// ===== SHOW APP =====
function showApp(){
    $('app').classList.remove('hidden');
    $('top-bar-name').textContent = state.name;
    $('top-bar-status').style.color = 'var(--green)';
    // Save email for login lookup
    const user = auth.currentUser;
    if(user && user.email && !state.email){ state.email = user.email; saveState(); }
    renderAll();
    listenVerifications();
}

// ===== DAY RESET + PENALTY =====
function checkDayReset(){
    const today = getToday();
    if(state.lastActiveDate && state.lastActiveDate !== today){
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
        const yStr = yesterday.toISOString().split('T')[0];
        const totalQ = state.quests.length;
        const wasCompleted = state.completedToday;
        const uncompleted = totalQ - wasCompleted;
        if(state.lastActiveDate === yStr && wasCompleted > 0) state.dayStreak++;
        else if(state.lastActiveDate !== yStr) state.dayStreak = 0;
        if(uncompleted > totalQ / 2 && !state.penaltyApplied && totalQ > 0){
            state.pendingPenalty = {uncompleted, total:totalQ, completed:wasCompleted};
        }
        state.quests.forEach(q=>{ q.completed=false; q.verified=false; q.pendingVerify=false; });
        state.completedToday=0; state.xpToday=0; state.penaltyApplied=false;
    }
    if(!state.lastActiveDate) state.lastActiveDate = today;
    state.lastActiveDate = today;
    saveState();
    if(state.pendingPenalty) setTimeout(()=>showPenalty(state.pendingPenalty),500);
}

// ===== PENALTY =====
function showPenalty(info){
    const losses = {};
    STAT_KEYS.forEach(k=>losses[k]=0);
    const ratio = info.uncompleted / info.total;
    const lossAmt = Math.max(1, Math.ceil(PENALTY_STAT_LOSS * ratio));
    for(let i=0;i<lossAmt;i++){
        const key = STAT_KEYS[Math.floor(Math.random()*STAT_KEYS.length)];
        losses[key]++;
    }
    let html='';
    STAT_KEYS.forEach(k=>{ if(losses[k]>0) html+=`<div class="penalty-line"><span>${STAT_ICONS[k]} ${STAT_NAMES[k]}</span><span class="p-loss">-${losses[k]}</span></div>`; });
    html+=`<div class="penalty-line" style="margin-top:6px;border-top:1px solid var(--panel-border);padding-top:6px"><span>Quests completed</span><span>${info.completed}/${info.total}</span></div>`;
    $('penalty-details').innerHTML=html;
    state._pendingLosses = losses;
    $('penalty-overlay').classList.remove('hidden');
}
$('btn-penalty-ok').addEventListener('click', async ()=>{
    if(state._pendingLosses){
        STAT_KEYS.forEach(k=>{ state.stats[k]=Math.max(1,state.stats[k]-(state._pendingLosses[k]||0)); });
        delete state._pendingLosses;
    }
    state.pendingPenalty=null; state.penaltyApplied=true;
    await saveState();
    $('penalty-overlay').classList.add('hidden');
    toast('⚠️ Penalty applied. Train harder, Hunter.');
    renderAll();
});

// ===== NAVIGATION =====
document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
        document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
        $('tab-'+tab).classList.add('active');
        if(tab==='shadows') renderShadows();
        if(tab==='hunters') renderHunters();
    });
});

// ===== RENDER ALL =====
function renderAll(){
    renderProfile(); renderStats(); renderQuests(); renderToday(); renderBattleRecord(); renderShadows();
}

// ===== RENDER PROFILE =====
function renderProfile(){
    $('player-name').textContent = state.name;
    $('player-level').textContent = state.level;
    const needed = xpForLevel(state.level);
    $('xp-fill').style.width = Math.min(100,(state.xp/needed)*100)+'%';
    $('xp-text').textContent = state.xp+' / '+needed;
    const rank = getRank(state.level);
    const badge = $('rank-badge');
    badge.textContent = rank; badge.className = 'rank-badge rank-'+rank;
}

// ===== RENDER STATS =====
function renderStats(){
    const grid=$('stats-grid'); grid.innerHTML='';
    STAT_KEYS.forEach(key=>{
        const val=state.stats[key];
        const maxBar=Math.max(50,...STAT_KEYS.map(k=>state.stats[k]));
        const item=document.createElement('div'); item.className='stat-item';
        item.innerHTML=`<div class="stat-icon">${STAT_ICONS[key]}</div><div class="stat-info"><div class="stat-name">${STAT_NAMES[key]}</div><div class="stat-val">${val}</div><div class="stat-bar-bg"><div class="stat-bar-fill ${key}" style="width:${(val/maxBar)*100}%"></div></div></div><button class="btn-stat-up ${state.statPoints>0?'visible':''}" data-stat="${key}">+</button>`;
        grid.appendChild(item);
    });
    grid.querySelectorAll('.btn-stat-up').forEach(btn=>{
        btn.addEventListener('click',async e=>{
            e.stopPropagation();
            if(state.statPoints>0){ state.stats[btn.dataset.stat]++; state.statPoints--; await saveState(); renderStats(); toast(`${STAT_NAMES[btn.dataset.stat]} increased!`); }
        });
    });
    const info=$('stat-points-info');
    if(state.statPoints>0){info.style.display='block';$('available-points').textContent=state.statPoints;}else{info.style.display='none';}
}

function renderToday(){
    $('today-completed').textContent=state.completedToday;
    $('today-xp').textContent=state.xpToday;
    $('today-streak').textContent=state.dayStreak;
}
function renderBattleRecord(){
    $('total-wins').textContent=state.wins||0;
    $('total-losses').textContent=state.losses||0;
    const total=(state.wins||0)+(state.losses||0);
    $('win-rate').textContent=total>0?Math.round(((state.wins||0)/total)*100)+'%':'0%';
}

// ===== QUESTS =====
let currentFilter='all';
function renderQuests(){
    const list=$('quests-list'); list.innerHTML='';
    let filtered=state.quests.filter(q=>currentFilter==='all'||q.category===currentFilter);
    filtered.sort((a,b)=>a.completed-b.completed);
    filtered.forEach(q=>{
        const card=document.createElement('div');
        card.className=`quest-card ${q.category} ${q.completed?'completed':''}`;
        let badges='';
        if(q.timerMins>0 && !q.completed) badges+=`<span class="quest-badge timed">⏱ ${q.timerMins}m</span>`;
        if(q.completed && q.verified) badges+=`<span class="quest-badge verified">✅ Verified</span>`;
        else if(q.completed && q.pendingVerify) badges+=`<span class="quest-badge pending">⏳ Pending</span>`;
        else if(q.completed && !q.verified) badges+=`<span class="quest-badge unverified">⚠️ Unverified</span>`;
        card.innerHTML=`<div class="quest-check">${q.completed?'✓':''}</div><div class="quest-info"><div class="quest-title">${q.name}${badges}</div><div class="quest-meta">${CAT_ICONS[q.category]} ${q.category} • +${DIFF_XP[q.difficulty]} XP${q.verified?' (×1.5)':''}</div></div><span class="quest-diff ${q.difficulty}">${q.difficulty}</span>`;
        if(!q.completed) card.addEventListener('click',()=>startQuestCompletion(q.id));
        list.appendChild(card);
    });
}
document.querySelectorAll('.filter-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
        document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); currentFilter=btn.dataset.filter; renderQuests();
    });
});

// ===== QUEST COMPLETION =====
function startQuestCompletion(id){
    const quest=state.quests.find(q=>q.id===id);
    if(!quest||quest.completed) return;
    if(quest.timerMins && quest.timerMins>0) startTimer(quest);
    else completeQuest(id, false);
}

// ===== TIMER =====
function startTimer(quest){
    timerQuestId=quest.id;
    const totalSecs=quest.timerMins*60;
    let remaining=totalSecs;
    const circumference=2*Math.PI*54;
    $('timer-quest-name').textContent=quest.name;
    $('timer-overlay').classList.remove('hidden');
    function update(){
        const mins=Math.floor(remaining/60), secs=remaining%60;
        $('timer-display').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        $('timer-progress').style.strokeDashoffset=circumference*(1-(totalSecs-remaining)/totalSecs);
        if(remaining<=0){ clearInterval(timerInterval); timerInterval=null; $('timer-overlay').classList.add('hidden'); completeQuest(timerQuestId,true); timerQuestId=null; return; }
        remaining--;
    }
    update();
    timerInterval=setInterval(update,1000);
}
$('btn-cancel-timer').addEventListener('click',()=>{
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
    $('timer-overlay').classList.add('hidden'); timerQuestId=null; toast('Quest timer abandoned.');
});

// ===== COMPLETE QUEST =====
async function completeQuest(id, timerVerified){
    const quest=state.quests.find(q=>q.id===id);
    if(!quest||quest.completed) return;
    quest.completed=true;
    quest.verified=timerVerified;
    quest.pendingVerify=false;

    let xpGain=DIFF_XP[quest.difficulty];
    const statGain=DIFF_STAT[quest.difficulty];
    if(timerVerified) xpGain=Math.floor(xpGain*VERIFIED_XP_BONUS);

    state.xp+=xpGain; state.xpToday+=xpGain; state.completedToday++;
    const mainStat=STAT_CATS[quest.category]||'per';
    state.stats[mainStat]+=statGain;
    const others=STAT_KEYS.filter(k=>k!==mainStat);
    state.stats[others[Math.floor(Math.random()*others.length)]]+=Math.max(1,Math.floor(statGain/2));

    // Quest history for shadows
    const today=getToday();
    if(!state.questHistory) state.questHistory={};
    if(!state.questHistory[quest.name]) state.questHistory[quest.name]={streak:0,lastDate:null,category:quest.category};
    const hist=state.questHistory[quest.name];
    const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
    const yStr=yesterday.toISOString().split('T')[0];
    hist.streak=(hist.lastDate===yStr||hist.lastDate===today)?hist.streak+1:1;
    hist.lastDate=today;
    if(hist.streak>=SHADOW_THRESHOLD){
        if(!state.shadows) state.shadows=[];
        const ex=state.shadows.find(s=>s.name===quest.name);
        if(!ex){
            const icons=['⚔️','🗡️','🛡️','👤','💀','🦇','🐉','🔥','❄️','⚡','🌑','👁️'];
            state.shadows.push({name:quest.name,category:quest.category,streak:hist.streak,icon:icons[Math.floor(Math.random()*icons.length)]});
            setTimeout(()=>toast(`Shadow Soldier recruited: "${quest.name}"!`),1500);
        } else ex.streak=hist.streak;
    }

    // Send verification to allies (via Firestore)
    if(!timerVerified && state.allies && state.allies.length>0){
        quest.pendingVerify=true;
        const verifyId = Date.now()+'_'+Math.random().toString(36).substr(2,5);
        for(const allyName of state.allies){
            await db.collection('verifications').add({
                from: state.name,
                to: allyName.toLowerCase(),
                questName: quest.name,
                questId: quest.id,
                date: today,
                verifyId,
                status: 'pending'
            });
        }
        toast(`Quest completed! +${xpGain} XP. Sent for verification.`);
    } else {
        const vMsg=timerVerified?' (Timer ✅)':'';
        toast(`Quest completed! +${xpGain} XP, +${statGain} ${STAT_NAMES[mainStat]}${vMsg}`);
    }

    checkLevelUp(); await saveState(); renderAll();
}

// ===== LISTEN FOR VERIFICATION REQUESTS (real-time) =====
function listenVerifications(){
    if(unsubVerify) unsubVerify();
    const myName = state.name.toLowerCase();
    unsubVerify = db.collection('verifications')
        .where('to','==',myName)
        .where('status','==','pending')
        .onSnapshot(snap=>{
            // Update verify badge count if on hunters tab
            const btn = document.querySelector('.hunter-sub-btn[data-htab="verify"]');
            if(btn){
                const count = snap.size;
                btn.textContent = count > 0 ? `✅ Verify (${count})` : '✅ Verify';
            }
            // If currently on verify tab, re-render
            if(currentHunterFilter==='verify') renderHunters();
        });
}

// ===== SOCIAL VERIFICATION =====
async function handleVerification(docId, fromName, questId, approved){
    // Update the verification doc
    await db.collection('verifications').doc(docId).update({status: approved?'approved':'denied'});

    // Update the original hunter's quest
    const fromData = await getHunter(fromName);
    if(fromData){
        const quest = fromData.quests.find(q=>q.id===questId);
        if(quest){
            if(approved){
                quest.verified=true; quest.pendingVerify=false;
                const bonusXP = Math.floor(DIFF_XP[quest.difficulty]*(VERIFIED_XP_BONUS-1));
                fromData.xp+=bonusXP; fromData.xpToday+=bonusXP;
            } else {
                quest.completed=false; quest.verified=false; quest.pendingVerify=false;
                fromData.xp=Math.max(0,fromData.xp-DIFF_XP[quest.difficulty]);
                fromData.completedToday=Math.max(0,fromData.completedToday-1);
                const mainStat=STAT_CATS[quest.category]||'per';
                fromData.stats[mainStat]=Math.max(1,fromData.stats[mainStat]-DIFF_STAT[quest.difficulty]);
            }
            await db.collection('hunters').doc(fromName.toLowerCase()).set(fromData,{merge:true});
        }
    }
    toast(approved?`✅ Verified ${fromName}'s quest!`:`❌ Denied ${fromName}'s quest.`);
}

// ===== LEVEL UP =====
function checkLevelUp(){
    let leveledUp=false, oldRank=getRank(state.level);
    while(state.xp>=xpForLevel(state.level)){ state.xp-=xpForLevel(state.level); state.level++; state.statPoints++; leveledUp=true; }
    if(leveledUp){ showLevelUp(); const newRank=getRank(state.level); if(newRank!==oldRank)setTimeout(()=>showRankUp(newRank),2500); }
}
function showLevelUp(){ $('levelup-level').textContent='Level '+state.level; $('levelup-overlay').classList.remove('hidden'); setTimeout(()=>$('levelup-overlay').classList.add('hidden'),2200); }
function showRankUp(rank){ $('rankup-badge').textContent=rank; $('rankup-rank').textContent=rank+'-Rank Hunter'; $('rankup-overlay').classList.remove('hidden'); setTimeout(()=>$('rankup-overlay').classList.add('hidden'),3000); }

// ===== TOAST =====
function toast(msg){
    const el=document.createElement('div'); el.className='toast';
    el.innerHTML=`<span class="system-tag">[System]</span> ${msg}`;
    $('toast-container').appendChild(el);
    setTimeout(()=>{ el.classList.add('fade-out'); setTimeout(()=>el.remove(),300); },3000);
}

// ===== ADD QUEST =====
let newQuestCat='exercise', newQuestDiff='D', newQuestTimer=0;
$('btn-add-quest').addEventListener('click',()=>{ $('quest-modal').classList.remove('hidden'); $('quest-name-input').value=''; $('quest-name-input').focus(); });
$('btn-close-modal').addEventListener('click',()=>$('quest-modal').classList.add('hidden'));
$('quest-modal').addEventListener('click',e=>{ if(e.target===$('quest-modal'))$('quest-modal').classList.add('hidden'); });
document.querySelectorAll('.cat-btn').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); newQuestCat=btn.dataset.cat; }));
document.querySelectorAll('.diff-btn').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); newQuestDiff=btn.dataset.diff; }));
document.querySelectorAll('.timer-btn').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.timer-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); newQuestTimer=parseInt(btn.dataset.mins); }));
$('btn-create-quest').addEventListener('click',async ()=>{
    const name=$('quest-name-input').value.trim(); if(!name)return;
    state.quests.push({id:'cq'+(state.customQuestId++),name,category:newQuestCat,difficulty:newQuestDiff,timerMins:newQuestTimer,completed:false,verified:false,pendingVerify:false});
    await saveState(); $('quest-modal').classList.add('hidden'); renderQuests();
    toast(`New quest: "${name}"${newQuestTimer>0?' (⏱ '+newQuestTimer+'m)':''}`);
});

// ===== SHADOWS =====
function renderShadows(){
    const grid=$('shadows-grid'),empty=$('shadow-empty');
    if(!state.shadows||!state.shadows.length){ grid.innerHTML=''; grid.appendChild(empty); empty.style.display='block'; return; }
    empty.style.display='none'; grid.innerHTML='';
    state.shadows.forEach(s=>{
        const card=document.createElement('div'); card.className='shadow-card';
        card.innerHTML=`<div class="shadow-icon">${s.icon}</div><div class="shadow-name">${s.name}</div><div class="shadow-streak">🔥 ${s.streak} days</div>`;
        grid.appendChild(card);
    });
}

// ===== HUNTERS TAB =====
document.querySelectorAll('.hunter-sub-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
        document.querySelectorAll('.hunter-sub-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); currentHunterFilter=btn.dataset.htab; renderHunters();
    });
});

async function renderHunters(){
    const list=$('hunters-list'); list.innerHTML='<div class="hunters-empty">Loading...</div>';

    // VERIFY TAB
    if(currentHunterFilter==='verify'){
        const myName=state.name.toLowerCase();
        const snap=await db.collection('verifications').where('to','==',myName).where('status','==','pending').get();
        if(snap.empty){ list.innerHTML='<div class="hunters-empty">No pending verifications.</div>'; return; }
        list.innerHTML='';
        snap.forEach(doc=>{
            const v=doc.data();
            const card=document.createElement('div'); card.className='verify-card';
            card.innerHTML=`<div class="v-info"><div class="v-name">${v.from}</div><div class="v-quest">Completed: "${v.questName}" on ${v.date}</div></div><div class="h-actions"><button class="h-btn verify-btn" data-docid="${doc.id}" data-from="${v.from}" data-qid="${v.questId}">✅</button><button class="h-btn deny-btn" data-docid="${doc.id}" data-from="${v.from}" data-qid="${v.questId}">❌</button></div>`;
            list.appendChild(card);
        });
        list.querySelectorAll('.verify-btn').forEach(btn=>btn.addEventListener('click',()=>handleVerification(btn.dataset.docid,btn.dataset.from,btn.dataset.qid,true)));
        list.querySelectorAll('.deny-btn').forEach(btn=>btn.addEventListener('click',()=>handleVerification(btn.dataset.docid,btn.dataset.from,btn.dataset.qid,false)));
        return;
    }

    // NORMAL TABS
    const allHunters = await getAllHunters();
    const myName=state.name.toLowerCase();
    let hunters=allHunters;
    if(currentHunterFilter==='allies') hunters=hunters.filter(h=>state.allies&&state.allies.includes(h.name.toLowerCase()));
    else if(currentHunterFilter==='enemies') hunters=hunters.filter(h=>state.enemies&&state.enemies.includes(h.name.toLowerCase()));
    if(!hunters.length){ list.innerHTML=`<div class="hunters-empty">${currentHunterFilter==='all-hunters'?'No Hunters registered yet.':currentHunterFilter==='allies'?'No allies yet.':'No enemies yet.'}</div>`; return; }
    hunters.sort((a,b)=>{ if(a.name.toLowerCase()===myName)return -1; if(b.name.toLowerCase()===myName)return 1; return b.level-a.level; });
    list.innerHTML='';
    hunters.forEach(h=>{
        const hKey=h.name.toLowerCase(), isSelf=hKey===myName;
        const isAlly=state.allies&&state.allies.includes(hKey);
        const isEnemy=state.enemies&&state.enemies.includes(hKey);
        const rank=getRank(h.level);
        const card=document.createElement('div');
        card.className=`hunter-card ${isSelf?'is-self':''} ${isAlly?'is-ally':''} ${isEnemy?'is-enemy':''}`;
        let actions='';
        if(!isSelf){
            if(!isAlly&&!isEnemy) actions=`<button class="h-btn" data-action="ally" data-name="${hKey}">🤝 Ally</button><button class="h-btn" data-action="enemy" data-name="${hKey}">💀 Enemy</button>`;
            else if(isAlly) actions=`<button class="h-btn ally" data-action="remove-ally" data-name="${hKey}">🤝 Allied</button>`;
            else actions=`<button class="h-btn fight" data-action="fight" data-name="${hKey}">⚔️ Fight</button><button class="h-btn enemy" data-action="remove-enemy" data-name="${hKey}">✕</button>`;
        }
        const ts=totalStats(h.stats);
        card.innerHTML=`<div class="h-rank rank-badge rank-${rank}" style="width:40px;height:40px;font-size:1rem">${rank}</div><div class="h-info"><div class="h-name">${h.name}${isSelf?' (You)':''}</div><div class="h-detail">Lv.${h.level} • Power: ${ts} • W${h.wins||0}/L${h.losses||0}</div></div><div class="h-actions">${actions}</div>`;
        list.appendChild(card);
    });
    list.querySelectorAll('.h-btn').forEach(btn=>{
        btn.addEventListener('click',async e=>{
            e.stopPropagation();
            const action=btn.dataset.action, name=btn.dataset.name;
            if(!state.allies) state.allies=[];
            if(!state.enemies) state.enemies=[];
            if(action==='ally'){ state.allies.push(name); state.enemies=state.enemies.filter(n=>n!==name); await saveState(); renderHunters(); toast(`${name} added as Ally!`); }
            else if(action==='enemy'){ state.enemies.push(name); state.allies=state.allies.filter(n=>n!==name); await saveState(); renderHunters(); toast(`${name} marked as Enemy!`); }
            else if(action==='remove-ally'){ state.allies=state.allies.filter(n=>n!==name); await saveState(); renderHunters(); toast('Removed ally.'); }
            else if(action==='remove-enemy'){ state.enemies=state.enemies.filter(n=>n!==name); await saveState(); renderHunters(); toast('Removed enemy.'); }
            else if(action==='fight'){ startBattle(name); }
        });
    });
}

// ===== BATTLE =====
let battle=null;
function calcHP(stats){return 50+stats.vit*8;} function calcAtk(stats){return 3+stats.str*2;} function calcMagic(stats){return 3+stats.int*2;}
function calcDef(stats){return 1+Math.floor(stats.vit*0.8);} function calcDodge(stats){return Math.min(40,5+stats.agi*1.2);} function calcCrit(stats){return Math.min(35,5+stats.per*1.0);}

async function startBattle(enemyName){
    const enemyAcc=await getHunter(enemyName);
    if(!enemyAcc){toast('Enemy not found!');return;}
    const myHP=calcHP(state.stats), eHP=calcHP(enemyAcc.stats);
    battle={enemy:enemyAcc,myHP,myMaxHP:myHP,eHP,eMaxHP:eHP,myDodging:false,over:false};
    $('b-left-name').textContent=state.name; $('b-left-rank').textContent=getRank(state.level); $('b-left-level').textContent='Lv.'+state.level;
    $('b-right-name').textContent=enemyAcc.name; $('b-right-rank').textContent=getRank(enemyAcc.level); $('b-right-level').textContent='Lv.'+enemyAcc.level;
    updateBattleHP();
    $('battle-log').innerHTML='<p>⚔️ Battle begins! Choose your action.</p>';
    $('battle-actions').classList.remove('hidden'); $('battle-result').classList.add('hidden');
    $('battle-overlay').classList.remove('hidden');
}
function updateBattleHP(){
    $('b-left-hp').style.width=Math.max(0,(battle.myHP/battle.myMaxHP)*100)+'%';
    $('b-right-hp').style.width=Math.max(0,(battle.eHP/battle.eMaxHP)*100)+'%';
    $('b-left-hp-text').textContent=Math.max(0,battle.myHP)+'/'+battle.myMaxHP;
    $('b-right-hp-text').textContent=Math.max(0,battle.eHP)+'/'+battle.eMaxHP;
}
function battleLog(msg,cls){const p=document.createElement('p');if(cls)p.className=cls;p.textContent=msg;const log=$('battle-log');log.appendChild(p);log.scrollTop=log.scrollHeight;}
function playerAction(type){
    if(battle.over)return;
    const myS=state.stats,eS=battle.enemy.stats;
    battle.myDodging=false;
    if(type==='attack'){
        if(Math.random()*100<calcDodge(eS)){battleLog(`${battle.enemy.name} dodged!`,'dodge');}
        else{let dmg=calcAtk(myS)-calcDef(eS)+Math.floor(Math.random()*6);dmg=Math.max(1,dmg);if(Math.random()*100<calcCrit(myS)){dmg=Math.floor(dmg*1.8);battleLog(`💥 CRITICAL! ${dmg} damage!`,'crit');}else{battleLog(`You attack for ${dmg}.`,'dmg');}battle.eHP-=dmg;}
    }else if(type==='magic'){
        let dmg=calcMagic(myS)-Math.floor(calcDef(eS)*0.5)+Math.floor(Math.random()*8);dmg=Math.max(1,dmg);
        if(Math.random()*100<calcCrit(myS)*0.7){dmg=Math.floor(dmg*2);battleLog(`✨ MAGIC CRIT! ${dmg}!`,'crit');}else{battleLog(`🔮 Magic for ${dmg}.`,'dmg');}battle.eHP-=dmg;
    }else{battle.myDodging=true;battleLog(`💨 Defensive stance...`,'dodge');}
    updateBattleHP();
    if(battle.eHP<=0){endBattle(true);return;}
    setTimeout(()=>enemyTurn(),600);
}
function enemyTurn(){
    if(battle.over)return;
    const eS=battle.enemy.stats,myS=state.stats;
    const actions=['attack','attack','magic','dodge'];
    const action=actions[Math.floor(Math.random()*actions.length)];
    if(action==='attack'){
        let dc=calcDodge(myS);if(battle.myDodging)dc=Math.min(80,dc*2);
        if(Math.random()*100<dc){battleLog(`Dodged ${battle.enemy.name}!`,'dodge');}
        else{let dmg=calcAtk(eS)-calcDef(myS)+Math.floor(Math.random()*6);dmg=Math.max(1,dmg);if(Math.random()*100<calcCrit(eS)){dmg=Math.floor(dmg*1.8);battleLog(`💥 ${battle.enemy.name} CRIT ${dmg}!`,'crit');}else{battleLog(`${battle.enemy.name} attacks ${dmg}.`,'dmg');}battle.myHP-=dmg;}
    }else if(action==='magic'){let dmg=calcMagic(eS)-Math.floor(calcDef(myS)*0.5)+Math.floor(Math.random()*8);dmg=Math.max(1,dmg);battleLog(`${battle.enemy.name} magic ${dmg}.`,'dmg');battle.myHP-=dmg;
    }else{battleLog(`${battle.enemy.name} defensive stance.`,'dodge');}
    updateBattleHP();
    if(battle.myHP<=0)endBattle(false);
}
async function endBattle(won){
    battle.over=true;$('battle-actions').classList.add('hidden');
    if(won){
        $('result-text').textContent='VICTORY';$('result-text').className='result-text victory';
        const xpGain=30+battle.enemy.level*10;$('result-xp').textContent=`+${xpGain} XP`;
        state.xp+=xpGain;state.xpToday+=xpGain;state.wins=(state.wins||0)+1;
        battleLog(`🏆 ${battle.enemy.name} defeated!`,'heal');checkLevelUp();
    }else{
        $('result-text').textContent='DEFEAT';$('result-text').className='result-text defeat';
        $('result-xp').textContent='Train harder, Hunter.';
        state.losses=(state.losses||0)+1;battleLog(`💀 Defeated by ${battle.enemy.name}.`,'dmg');
    }
    await saveState();renderAll();$('battle-result').classList.remove('hidden');
}
$('btn-attack').addEventListener('click',()=>playerAction('attack'));
$('btn-magic').addEventListener('click',()=>playerAction('magic'));
$('btn-dodge').addEventListener('click',()=>playerAction('dodge'));
$('btn-battle-close').addEventListener('click',()=>{$('battle-overlay').classList.add('hidden');battle=null;});

// ===== INIT =====
boot();
})();
