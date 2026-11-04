// Nørre News writers' desk: log in, then create, edit, publish and delete posts.

// Loaded with a fresh ?v= each time so browsers never use an old cached copy.
const { firebaseConfig, databaseId } = await import(`./firebase-config.js?v=${Date.now()}`);

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// Every section of the newsletter, and which fields its posts use.
const SECTIONS = [
  { key: 'feature',   label: 'Top Story',      title: 'Headline', tag: null,            body: 'Story', maxWords: 1000, hint: 'The website shows the newest published top story. The first paragraph is shown larger. Up to 1000 words.' },
  { key: 'news',      label: 'School News',    title: 'Headline', tag: 'Tag (e.g. Halloween)', body: 'Article', maxWords: 1000, hint: 'Every published news card is shown, newest first. Long articles show a preview with "Read more". Up to 1000 words.' },
  { key: 'events',    label: 'Events',         title: 'Event name', tag: 'Month label if no date (e.g. Dec)', body: 'Details', date: true, hint: 'Shown soonest first. Events whose date has passed are hidden automatically.' },
  { key: 'spotlight', label: 'Spotlight',      title: 'Student / headline', tag: null,  body: 'Write-up', hint: 'The website shows the newest published spotlight.' },
  { key: 'corner',    label: 'Student Corner', title: 'Headline', tag: 'Tag (e.g. Mondays)', body: 'Text', hint: 'Clubs, tips and student notices. Every published card is shown, newest first.' },
  { key: 'gossip',    label: 'Gossip',         title: 'Headline', tag: null,            body: 'The gossip', hint: 'Keep it light and kind: no real names without the person\'s OK. Every published item is shown, newest first.' },
  { key: 'quote',     label: 'Quote',          title: null,       tag: 'Said by',       body: 'Quote', hint: 'The website shows the newest published quote (at the bottom of Student Corner).' },
];

// Articles live in their own collection ("articles") and get a full page with comments.
const ARTICLES = {
  key: 'articles', label: 'Articles', title: 'Title', body: 'Article', maxWords: 100000, article: true,
  hint: 'Full articles with their own page and a comments section. Every published article gets a summary card in the Articles section of the newsletter, linking to its page. Up to 100,000 words, with images.',
};
const collectionFor = key => (key === 'articles' ? 'articles' : 'posts');

// What the newsletter shows right now (the default text in newsletter/index.html).
// "Import current content" turns these into editable, published posts.
// Listed in the order they appear on the website.
const DEFAULTS = {
  feature: [
    { title: 'Welcome to our very first issue!', body: "This newsletter is written by students, for students. Every issue we'll share what's happening around school, upcoming events and celebrations, and the people who make Nørre what it is.\nHave an idea for a story, a photo you'd like to share, or a shout-out for a fellow student? Get in touch using the contact section at the bottom of the page. Contributions from everyone are welcome." },
  ],
  news: [
    { tag: 'Halloween', title: 'Halloween parties this weekend', body: "Halloween is almost here, and there's more than one party to choose from. Dig out your costume, check with the organisers for times and places, and get ready for a spooky weekend." },
    { tag: 'Out & About', title: 'Plans for light art in Copenhagen', body: "As the evenings get darker, Copenhagen lights up with art installations around the city. We're planning a group trip to see them. Let us know if you'd like to join!" },
  ],
  events: [
    { title: 'Halloween', date: '2026-10-31', body: 'Costumes, parties and plenty of sweets. Share your best costume photos with the newsletter team!' },
    { title: 'Christmas Celebrations', tag: 'Dec', body: 'Festive fun before the winter break. Details to follow in the next issue.' },
  ],
  spotlight: [
    { title: 'Your name could be here', body: "Each issue we feature a student: their projects, interests, or something they're proud of. Nominate someone (or yourself!) for the next issue." },
  ],
  corner: [
    { tag: 'Wednesdays', title: 'Volleyball Club', body: "The volleyball club meets every Wednesday and is looking for new members! Whether you're experienced or have never served a ball, come along and give it a try." },
    { tag: 'Mondays', title: 'Badminton Club', body: 'Badminton on Mondays is a more informal session. Just drop by, grab a racket and play for fun. No experience or commitment needed.' },
  ],
  gossip: [
    { title: 'The great canteen mystery', body: 'Someone keeps leaving perfectly folded paper cranes on the canteen tables every Friday. Nobody knows who. Theories welcome.' },
    { title: 'Overheard in the corridor', body: "\"I'm not procrastinating, I'm letting my ideas marinate.\" Honestly? Relatable." },
    { title: 'Costume rumours', body: 'Word is that at least one teacher is planning a Halloween costume this year. We\'ll be watching.' },
  ],
  quote: [
    { tag: 'Senuja', body: 'Every great newsletter needs an egoistic dude who happens to work with computers.' },
  ],
};

const $ = id => document.getElementById(id);
const DEFAULT_MAX_WORDS = 800; // other sections keep their previous limit (~5000 characters)
const countWords = text => (text.trim().match(/\S+/g) || []).length;
const maxWordsFor = s => s.maxWords || DEFAULT_MAX_WORDS;

function updateWordCount() {
  const s = currentSection();
  const n = countWords($('f-body').value);
  const max = maxWordsFor(s);
  const c = $('f-count');
  c.textContent = n + ' / ' + max + ' words';
  c.classList.toggle('over', n > max);
}
const state = { section: 'feature', posts: [], articles: [], editingId: null, user: null };
let fb; // Firebase functions + instances

const isConfigured = firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE');
if (!isConfigured) {
  $('setup-notice').hidden = false;
} else {
  start().catch(err => {
    console.error(err);
    $('setup-notice').hidden = false;
    $('setup-notice').querySelector('p').textContent = 'Could not connect to Firebase. Check firebase-config.js and your internet connection.';
  });
}

async function start() {
  const appMod = await import(`${SDK}/firebase-app.js`);
  const authMod = await import(`${SDK}/firebase-auth.js`);
  const fsMod = await import(`${SDK}/firebase-firestore.js`);

  const app = appMod.initializeApp(firebaseConfig);
  fb = { ...authMod, ...fsMod, auth: authMod.getAuth(app), db: fsMod.getFirestore(app, databaseId || '(default)') };

  wireUpUI();

  fb.onAuthStateChanged(fb.auth, async user => {
    state.user = user;
    $('login-view').hidden = !!user;
    $('dashboard').hidden = !user;
    $('user-box').hidden = !user;
    if (user) {
      $('user-email').textContent = user.email;
      await loadPosts();
      await loadArticles();
    } else {
      state.posts = [];
      state.articles = [];
    }
  });
}

/* ---------- UI wiring ---------- */

function wireUpUI() {
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    try {
      await fb.signInWithEmailAndPassword(fb.auth, $('login-email').value.trim(), $('login-password').value);
      $('login-password').value = '';
    } catch (err) {
      $('login-error').textContent = friendlyAuthError(err);
    } finally {
      $('login-btn').disabled = false;
    }
  });

  $('logout-btn').addEventListener('click', () => { closeEditor(); fb.signOut(fb.auth); });
  $('new-btn').addEventListener('click', () => openEditor(null));
  $('cancel-btn').addEventListener('click', closeEditor);
  $('post-form').addEventListener('submit', savePost);
  $('f-body').addEventListener('input', updateWordCount);

  // ---- Images in articles ----
  $('img-upload-btn').addEventListener('click', () => $('img-file').click());
  $('img-file').addEventListener('change', () => { uploadImages([...$('img-file').files]); $('img-file').value = ''; });
  $('img-link-btn').addEventListener('click', () => insertAtCursor('![Caption](https://)', 11, 'https://'));
  $('f-body').addEventListener('paste', e => {
    if (!currentSection().article) return;
    const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); uploadImages(files); }
  });
  $('f-body').addEventListener('dragover', e => { if (currentSection().article) e.preventDefault(); });
  $('f-body').addEventListener('drop', e => {
    if (!currentSection().article) return;
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); uploadImages(files); }
  });

  // Tabs
  const tabs = $('tabs');
  for (const s of SECTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = s.key;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { state.section = s.key; closeEditor(); render(); });
    tabs.append(b);
  }
  const divider = document.createElement('span');
  divider.className = 'tab-divider';
  const art = document.createElement('button');
  art.type = 'button';
  art.dataset.key = ARTICLES.key;
  art.setAttribute('role', 'tab');
  art.addEventListener('click', () => { state.section = ARTICLES.key; closeEditor(); render(); });
  tabs.append(divider, art);
}

function friendlyAuthError(err) {
  const code = err && err.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Wrong email or password.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a few minutes and try again.';
  if (code.includes('network')) return 'No connection. Check your internet and try again.';
  return 'Could not log in (' + (code || 'unknown error') + ').';
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Data ---------- */

async function loadPosts() {
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'posts'));
    state.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // First ever login: the database is empty, so load in what the newsletter
    // currently shows. After this, the admin and the website always match.
    if (!state.posts.length && !state.seeded) {
      state.seeded = true;
      await importDefaults(SECTIONS.map(s => s.key));
      return; // importDefaults reloads the posts and renders
    }

    // The first import was interrupted (e.g. the page was reloaded while saving):
    // some sections are still empty and nothing new has been written since.
    // Finish it once, so writers see everything the website shows.
    const missing = SECTIONS.map(s => s.key).filter(k => !state.posts.some(p => p.section === k));
    const created = state.posts.map(p => millis(p.createdAt));
    const onlyFirstImport = Math.max(...created) - Math.min(...created) < 10 * 60 * 1000;
    let finished = false;
    try { finished = localStorage.getItem('norre-import-finished') === '1'; } catch (e) {}
    if (missing.length && onlyFirstImport && !finished && !state.seeded) {
      state.seeded = true;
      await importDefaults(missing);
      try { localStorage.setItem('norre-import-finished', '1'); } catch (e) {}
      return;
    }
    try { localStorage.setItem('norre-import-finished', '1'); } catch (e) {}
  } catch (err) {
    console.error(err);
    state.posts = [];
    toast(err.code === 'permission-denied'
      ? 'This account is not on the writers list (check the Firestore rules).'
      : 'Could not load posts.');
  }
  render();
}

async function loadArticles() {
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'articles'));
    state.articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    state.articles = [];
    if (state.section === 'articles') toast(err.code === 'permission-denied'
      ? 'Articles are not allowed yet: update the Firestore rules (see README).'
      : 'Could not load articles.');
  }
  render();
}

const millis = ts => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now());

async function savePost(e) {
  e.preventDefault();
  const s = currentSection();
  if (s.article) return saveArticle();
  const data = {
    section: s.key,
    title: s.title ? $('f-title').value.trim() : '',
    tag: s.tag ? $('f-tag').value.trim() : '',
    date: s.date ? $('f-date').value : '',
    body: $('f-body').value.trim(),
    published: $('f-published').checked,
    updatedAt: fb.serverTimestamp(),
    updatedBy: state.user.email,
  };
  if (s.title && !data.title) { $('save-error').textContent = 'Please add a ' + s.title.toLowerCase() + '.'; return; }
  if (!data.body) { $('save-error').textContent = 'Please write some text.'; return; }
  const words = countWords(data.body);
  if (words > maxWordsFor(s)) { $('save-error').textContent = `Too long: ${words} words (the limit for ${s.label} is ${maxWordsFor(s)}).`; return; }

  $('save-btn').disabled = true;
  $('save-error').textContent = '';
  try {
    if (state.editingId) {
      await fb.updateDoc(fb.doc(fb.db, 'posts', state.editingId), data);
    } else {
      await fb.addDoc(fb.collection(fb.db, 'posts'), { ...data, createdAt: fb.serverTimestamp(), author: state.user.email });
    }
    toast(data.published ? 'Saved and published ✓' : 'Saved as draft ✓');
    closeEditor();
    await loadPosts();
  } catch (err) {
    console.error(err);
    $('save-error').textContent = err.code === 'permission-denied'
      ? 'Not allowed: this account is not on the writers list.'
      : 'Could not save. Try again.';
  } finally {
    $('save-btn').disabled = false;
  }
}

async function saveArticle() {
  const data = {
    title: $('f-title').value.trim(),
    subtitle: $('f-subtitle').value.trim(),
    authorName: $('f-author').value.trim(),
    coverUrl: $('f-cover').value.trim(),
    body: $('f-body').value.trim(),
    published: $('f-published').checked,
    updatedAt: fb.serverTimestamp(),
    updatedBy: state.user.email,
  };
  const err = m => { $('save-error').textContent = m; };
  if (!data.title) return err('Please add a title.');
  if (!data.authorName) return err('Please add the author\'s name.');
  if (data.coverUrl && !/^https:\/\//i.test(data.coverUrl)) return err('The cover image link must start with https://');
  if (!data.body) return err('Please write the article.');
  const words = countWords(data.body);
  if (words > ARTICLES.maxWords) return err(`Too long: ${words} words (the limit for articles is ${ARTICLES.maxWords}).`);
  try { localStorage.setItem('norre-author-name', data.authorName); } catch (e) {}

  $('save-btn').disabled = true;
  err('');
  try {
    if (state.editingId) {
      await fb.updateDoc(fb.doc(fb.db, 'articles', state.editingId), data);
    } else {
      // New articles use the ID reserved when the editor opened, so uploaded images stay attached.
      await fb.setDoc(fb.doc(fb.db, 'articles', state.draftId), { ...data, createdAt: fb.serverTimestamp(), author: state.user.email });
      state.uploaded = []; // saved: keep the images
    }
    toast(data.published ? 'Article saved and published ✓' : 'Article saved as draft ✓');
    closeEditor();
    await loadArticles();
  } catch (e) {
    console.error(e);
    err(e.code === 'permission-denied'
      ? 'Not allowed: update the Firestore rules for articles (see README), or check this account is a writer.'
      : 'Could not save. Try again.');
  } finally {
    $('save-btn').disabled = false;
  }
}

async function togglePublished(post) {
  const col = collectionFor(state.section);
  try {
    await fb.updateDoc(fb.doc(fb.db, col, post.id), {
      published: !post.published, updatedAt: fb.serverTimestamp(), updatedBy: state.user.email,
    });
    toast(post.published ? 'Unpublished (now a draft)' : 'Published ✓');
    if (col === 'articles') await loadArticles(); else await loadPosts();
  } catch (err) { console.error(err); toast('Could not update.'); }
}

async function deletePost(post) {
  if (!confirm(`Delete "${post.title || post.body.slice(0, 40)}"? This can't be undone.`)) return;
  const col = collectionFor(state.section);
  try {
    if (col === 'articles') {
      // Remove the article's comments too, so nothing is left behind.
      // Remove the article's comments and images too, so nothing is left behind.
      for (const sub of ['comments', 'images']) {
        const cs = await fb.getDocs(fb.collection(fb.db, 'articles', post.id, sub));
        for (const c of cs.docs) await fb.deleteDoc(c.ref);
      }
    }
    await fb.deleteDoc(fb.doc(fb.db, col, post.id));
    if (state.editingId === post.id) closeEditor();
    toast('Deleted');
    if (col === 'articles') await loadArticles(); else await loadPosts();
  } catch (err) { console.error(err); toast('Could not delete.'); }
}

// Copies the website's original text into editable posts for the given sections
// (only sections that have no posts yet, so nothing is ever duplicated).
// Runs automatically on the first login, when the database is still empty.
async function importDefaults(keys) {
  const empty = keys.filter(k => !state.posts.some(p => p.section === k));
  if (!empty.length) { toast('Nothing to import: those sections already have posts.'); return; }
  try {
    for (const key of empty) {
      // Add in reverse so the first item on the website ends up newest (shown first).
      for (const item of [...DEFAULTS[key]].reverse()) {
        await fb.addDoc(fb.collection(fb.db, 'posts'), {
          section: key,
          title: item.title || '',
          tag: item.tag || '',
          date: item.date || '',
          body: item.body,
          published: true,
          createdAt: fb.serverTimestamp(),
          updatedAt: fb.serverTimestamp(),
          author: state.user.email,
          updatedBy: state.user.email,
        });
      }
    }
    toast('Loaded the newsletter\'s current content ✓');
  } catch (err) {
    console.error(err);
    toast(err.code === 'permission-denied'
      ? 'Not allowed: this account is not on the writers list (check the Firestore rules).'
      : 'Loading the current content failed (' + (err.code || err.message) + '). Reload to try again.');
  }
  await loadPosts();
}

/* ---------- Rendering ---------- */

const currentSection = () => (state.section === ARTICLES.key ? ARTICLES : SECTIONS.find(s => s.key === state.section));

function render() {
  const s = currentSection();

  // tabs
  for (const b of $('tabs').children) {
    if (!b.dataset.key) continue; // divider
    const n = b.dataset.key === ARTICLES.key ? state.articles.length : state.posts.filter(p => p.section === b.dataset.key).length;
    const sec = b.dataset.key === ARTICLES.key ? ARTICLES : SECTIONS.find(x => x.key === b.dataset.key);
    b.textContent = sec.label;
    if (n) { const c = document.createElement('span'); c.className = 'count'; c.textContent = n; b.append(c); }
    b.setAttribute('aria-selected', String(b.dataset.key === s.key));
  }

  $('section-title').textContent = s.label;
  $('section-hint').textContent = s.hint;
  $('new-btn').textContent = s.article ? '+ New article' : '+ New post';
  if (s.article) return renderArticleList();

  const posts = state.posts
    .filter(p => p.section === s.key)
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));

  const list = $('post-list');
  list.replaceChildren();
  if (!posts.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'This section is empty, so it is hidden on the website. Click "+ New post" to add something.';
    list.append(li);
    return;
  }

  for (const p of posts) {
    const li = document.createElement('li');
    li.className = 'post' + (p.id === state.editingId ? ' editing' : '');

    const top = document.createElement('div');
    top.className = 'post-top';
    const h = document.createElement('h3');
    h.textContent = p.title || (p.body ? '“' + p.body.slice(0, 60) + (p.body.length > 60 ? '…' : '') + '”' : '(untitled)');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (p.published ? 'live' : 'draft');
    badge.textContent = p.published ? 'Live' : 'Draft';
    top.append(h, badge);

    const ex = document.createElement('p');
    ex.className = 'excerpt';
    ex.textContent = p.title ? p.body : (p.tag ? '— ' + p.tag : '');

    const meta = document.createElement('p');
    meta.className = 'meta';
    const when = p.updatedAt && p.updatedAt.toDate ? p.updatedAt.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'just now';
    meta.textContent = [p.tag && p.title ? p.tag : '', p.date ? 'Event: ' + p.date : '', 'Last edited ' + when + ' by ' + (p.updatedBy || p.author || '?')].filter(Boolean).join(' · ');

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Edit', 'ghost small', () => openEditor(p)),
      button(p.published ? 'Unpublish' : 'Publish', 'ghost small', () => togglePublished(p)),
      button('Delete', 'danger small', () => deletePost(p)),
    );

    li.append(top, ex, meta, actions);
    list.append(li);
  }
}

function renderArticleList() {
  const list = $('post-list');
  list.replaceChildren();
  const articles = [...state.articles].sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  if (!articles.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No articles yet, so the Articles section is hidden on the website. Click "+ New article" to write the first one.';
    list.append(li);
    return;
  }
  const site = $('site-link').href.replace(/[^/]*$/, '');
  for (const a of articles) {
    const li = document.createElement('li');
    li.className = 'post' + (a.id === state.editingId ? ' editing' : '');
    const top = document.createElement('div');
    top.className = 'post-top';
    const h = document.createElement('h3');
    h.textContent = a.title || '(untitled)';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (a.published ? 'live' : 'draft');
    badge.textContent = a.published ? 'Live' : 'Draft';
    top.append(h, badge);
    const ex = document.createElement('p');
    ex.className = 'excerpt';
    ex.textContent = a.subtitle || a.body;
    const meta = document.createElement('p');
    meta.className = 'meta';
    const when = a.updatedAt && a.updatedAt.toDate ? a.updatedAt.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'just now';
    meta.textContent = ['By ' + (a.authorName || '?'), countWords(a.body || '') + ' words', 'Last edited ' + when + ' by ' + (a.updatedBy || a.author || '?')].join(' · ');
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Edit & comments', 'ghost small', () => openEditor(a)),
      button(a.published ? 'Unpublish' : 'Publish', 'ghost small', () => togglePublished(a)),
      button('Delete', 'danger small', () => deletePost(a)),
    );
    if (a.published) {
      const view = document.createElement('a');
      view.className = 'view-link';
      view.href = site + 'article.html?id=' + encodeURIComponent(a.id);
      view.target = '_blank';
      view.rel = 'noopener';
      view.textContent = 'View ↗';
      actions.append(view);
    }
    li.append(top, ex, meta, actions);
    list.append(li);
  }
}

/* ---------- Images ---------- */

// Images are stored in Firestore (free) next to the article, so they are
// shrunk first: at most 1600 px wide/high and under ~700 KB each.
const MAX_IMAGE_SIDE = 1600;
const MAX_IMAGE_CHARS = 700000;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Not an image the browser can read'));
    img.src = src;
  });
}

async function compressImage(file) {
  const original = await readAsDataUrl(file);
  // Small GIFs stay as they are, so animations keep working.
  if (file.type === 'image/gif' && original.length <= MAX_IMAGE_CHARS) return { data: original, type: 'image/gif' };
  const img = await loadImg(original);
  let side = MAX_IMAGE_SIDE;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const quality = Math.max(0.5, 0.85 - attempt * 0.07);
    let data = canvas.toDataURL('image/webp', quality);
    let type = 'image/webp';
    if (!data.startsWith('data:image/webp')) { data = canvas.toDataURL('image/jpeg', quality); type = 'image/jpeg'; }
    if (data.length <= MAX_IMAGE_CHARS) return { data, type };
    side = Math.round(side * 0.8);
  }
  throw new Error('This image is too large even after shrinking it.');
}

async function uploadImages(files) {
  if (!files.length) return;
  const status = $('img-status');
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = `Uploading image ${i + 1} of ${files.length}…`;
    try {
      const { data, type } = await compressImage(file);
      const ref = await fb.addDoc(fb.collection(fb.db, 'articles', state.draftId, 'images'), {
        data, type, name: String(file.name || 'image').slice(0, 120), createdAt: fb.serverTimestamp(),
      });
      if (!state.editingId) state.uploaded.push(ref.id);
      insertAtCursor(`![Caption](img:${ref.id})`, 2, 'Caption');
      addImageThumb(ref.id, data);
    } catch (err) {
      console.error(err);
      status.textContent = err.code === 'permission-denied'
        ? 'Images are not allowed yet: publish the new Firestore rules (see README).'
        : 'Could not add "' + (file.name || 'image') + '": ' + err.message;
      return;
    }
  }
  status.textContent = files.length === 1 ? 'Image added ✓ Type a caption in place of "Caption".' : files.length + ' images added ✓';
}

// Puts text at the cursor on its own line and selects part of it (e.g. "Caption") for typing over.
function insertAtCursor(text, selectFrom, selectWord) {
  const ta = $('f-body');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const pre = before && !before.endsWith('\n') ? '\n' : '';
  const post = after.startsWith('\n') ? '' : '\n';
  ta.value = before + pre + text + post + after;
  const s0 = before.length + pre.length + selectFrom;
  ta.focus();
  ta.setSelectionRange(s0, s0 + selectWord.length);
  updateWordCount();
}

async function loadImageList() {
  const articleId = state.draftId;
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'articles', articleId, 'images'));
    if (state.draftId !== articleId) return;
    $('image-list').replaceChildren();
    snap.forEach(d => addImageThumb(d.id, d.data().data));
  } catch (err) { console.error(err); }
}

function addImageThumb(id, data) {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.src = data;
  img.alt = '';
  const used = () => $('f-body').value.includes('(img:' + id + ')');
  const ins = button('Insert', 'ghost small', () => insertAtCursor(`![Caption](img:${id})`, 2, 'Caption'));
  const del = button('Delete', 'danger small', async () => {
    if (!confirm(used() ? 'This image is used in the article. Delete it and remove it from the text?' : 'Delete this image?')) return;
    try {
      await fb.deleteDoc(fb.doc(fb.db, 'articles', state.draftId, 'images', id));
      const ta = $('f-body');
      ta.value = ta.value.replace(new RegExp('^!\\[[^\\]]*\\]\\(img:' + id + '\\)\\n?', 'gm'), '');
      updateWordCount();
      li.remove();
      state.uploaded = (state.uploaded || []).filter(x => x !== id);
    } catch (err) { console.error(err); toast('Could not delete the image.'); }
  });
  li.append(img, ins, del);
  $('image-list').append(li);
}

/* ---------- Comment moderation ---------- */

async function loadComments(articleId) {
  const box = $('comments-admin');
  const list = $('comment-list');
  box.hidden = false;
  list.replaceChildren();
  $('comments-admin-title').textContent = 'Comments';
  try {
    const snap = await fb.getDocs(fb.collection(fb.db, 'articles', articleId, 'comments'));
    if (state.editingId !== articleId) return; // editor moved on
    const comments = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    $('comments-admin-title').textContent = comments.length + (comments.length === 1 ? ' comment' : ' comments');
    if (!comments.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No comments yet.';
      list.append(li);
      return;
    }
    for (const c of comments) {
      const li = document.createElement('li');
      const top = document.createElement('div');
      top.className = 'c-top';
      const who = document.createElement('strong');
      who.textContent = c.name || 'Anonymous';
      const when = document.createElement('span');
      when.className = 'c-when';
      when.textContent = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      who.append(when);
      top.append(who, button('Delete', 'danger small', async () => {
        if (!confirm('Delete this comment by ' + (c.name || 'Anonymous') + '?')) return;
        try {
          await fb.deleteDoc(fb.doc(fb.db, 'articles', articleId, 'comments', c.id));
          toast('Comment deleted');
          loadComments(articleId);
        } catch (e) { console.error(e); toast('Could not delete the comment.'); }
      }));
      const p = document.createElement('p');
      p.textContent = c.text || '';
      li.append(top, p);
      list.append(li);
    }
  } catch (e) {
    console.error(e);
    $('comments-admin-title').textContent = 'Comments could not be loaded';
  }
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function openEditor(post) {
  const s = currentSection();
  state.editingId = post ? post.id : null;
  // Articles get their ID straight away, so images can be uploaded before the first save.
  state.draftId = s.article ? (post ? post.id : fb.doc(fb.collection(fb.db, 'articles')).id) : null;
  state.uploaded = [];

  $('editor-title').textContent = (post ? 'Edit · ' : 'New · ') + (s.article ? 'Article' : s.label);
  $('f-title-wrap').hidden = !s.title;
  $('f-tag-wrap').hidden = !s.tag;
  $('f-date-wrap').hidden = !s.date;
  for (const id of ['f-subtitle-wrap', 'f-author-wrap', 'f-cover-wrap', 'f-help', 'f-images']) $(id).hidden = !s.article;
  $('f-body').maxLength = s.article ? 900000 : 9000;
  $('img-status').textContent = '';
  $('image-list').replaceChildren();
  if (s.article && post) loadImageList();
  $('f-body').rows = s.article ? 20 : 12;
  let lastAuthor = '';
  try { lastAuthor = localStorage.getItem('norre-author-name') || ''; } catch (e) {}
  $('f-subtitle').value = post ? post.subtitle || '' : '';
  $('f-author').value = post ? post.authorName || '' : lastAuthor;
  $('f-cover').value = post ? post.coverUrl || '' : '';
  $('comments-admin').hidden = true;
  if (s.article && post) loadComments(post.id);
  if (s.title) $('f-title-label').textContent = s.title;
  if (s.tag) $('f-tag-label').textContent = s.tag;
  $('f-body-label').textContent = s.body;

  $('f-title').value = post ? post.title || '' : '';
  $('f-tag').value = post ? post.tag || '' : '';
  $('f-date').value = post ? post.date || '' : '';
  $('f-body').value = post ? post.body || '' : '';
  updateWordCount();
  $('f-published').checked = post ? !!post.published : true;
  $('save-error').textContent = '';

  $('editor').hidden = false;
  render();
  (s.title ? $('f-title') : $('f-body')).focus();
  if (window.innerWidth < 900) $('editor').scrollIntoView({ behavior: 'smooth' });
}

function closeEditor() {
  // A new article that was never saved: remove the images uploaded for it.
  if (!state.editingId && state.draftId && state.uploaded && state.uploaded.length) {
    const draft = state.draftId;
    for (const id of state.uploaded) fb.deleteDoc(fb.doc(fb.db, 'articles', draft, 'images', id)).catch(() => {});
  }
  state.uploaded = [];
  state.draftId = null;
  state.editingId = null;
  $('editor').hidden = true;
  $('comments-admin').hidden = true;
  $('post-form').reset();
  if (state.user) render();
}
