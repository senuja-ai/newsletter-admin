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
const state = { section: 'feature', posts: [], editingId: null, user: null };
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
    } else {
      state.posts = [];
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

const millis = ts => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now());

async function savePost(e) {
  e.preventDefault();
  const s = currentSection();
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

async function togglePublished(post) {
  try {
    await fb.updateDoc(fb.doc(fb.db, 'posts', post.id), {
      published: !post.published, updatedAt: fb.serverTimestamp(), updatedBy: state.user.email,
    });
    toast(post.published ? 'Unpublished (now a draft)' : 'Published ✓');
    await loadPosts();
  } catch (err) { console.error(err); toast('Could not update.'); }
}

async function deletePost(post) {
  if (!confirm(`Delete "${post.title || post.body.slice(0, 40)}"? This can't be undone.`)) return;
  try {
    await fb.deleteDoc(fb.doc(fb.db, 'posts', post.id));
    if (state.editingId === post.id) closeEditor();
    toast('Deleted');
    await loadPosts();
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

const currentSection = () => SECTIONS.find(s => s.key === state.section);

function render() {
  const s = currentSection();

  // tabs
  for (const b of $('tabs').children) {
    const n = state.posts.filter(p => p.section === b.dataset.key).length;
    const sec = SECTIONS.find(x => x.key === b.dataset.key);
    b.textContent = sec.label;
    if (n) { const c = document.createElement('span'); c.className = 'count'; c.textContent = n; b.append(c); }
    b.setAttribute('aria-selected', String(b.dataset.key === s.key));
  }

  $('section-title').textContent = s.label;
  $('section-hint').textContent = s.hint;

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

  $('editor-title').textContent = (post ? 'Edit · ' : 'New · ') + s.label;
  $('f-title-wrap').hidden = !s.title;
  $('f-tag-wrap').hidden = !s.tag;
  $('f-date-wrap').hidden = !s.date;
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
  state.editingId = null;
  $('editor').hidden = true;
  $('post-form').reset();
  if (state.user) render();
}
