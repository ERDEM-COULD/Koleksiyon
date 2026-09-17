const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LINKS_FILE = path.join(DATA_DIR, 'links.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'friendRequests.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const READS_FILE = path.join(DATA_DIR, 'reads.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function ensureFile(file) {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, '[]', 'utf8'); return; }
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw) { fs.writeFileSync(file, '[]', 'utf8'); return; }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) fs.writeFileSync(file, '[]', 'utf8');
    } catch { fs.writeFileSync(file, '[]', 'utf8'); }
}
[USERS_FILE, LINKS_FILE, REQUESTS_FILE, LIKES_FILE, MESSAGES_FILE, READS_FILE].forEach(ensureFile);

function readJSON(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw) return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch { fs.writeFileSync(file, '[]', 'utf8'); return []; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function normalizeName(n) { return String(n || '').trim().toLowerCase(); }
function makeId() { return crypto.randomBytes(8).toString('hex'); }

const sessions = new Map();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Yetkisiz.' });
    req.username = sessions.get(token);
    next();
}
function areFriends(a, b) {
    const users = readJSON(USERS_FILE);
    const ua = users.find(u => u.username === a);
    const ub = users.find(u => u.username === b);
    if (!ua || !ub) return false;
    return (ua.friends || []).includes(b) && (ub.friends || []).includes(a);
}
function getUserVisibility(u) { return u.visibility || (u.isPublic ? 'public' : 'private'); }

// ============================================
// AUTH
// ============================================
app.post('/api/register', (req, res) => {
    try {
        const { username, password } = req.body || {};
        const name = String(username || '').trim();
        const pwd = String(password || '');
        if (!name || name.length < 2 || name.length > 20) return res.status(400).json({ error: 'Kullanıcı adı 2-20 karakter olmalı.' });
        if (!pwd || pwd.length < 3) return res.status(400).json({ error: 'Şifre en az 3 karakter olmalı.' });
        const users = readJSON(USERS_FILE);
        if (users.find(u => normalizeName(u.username) === normalizeName(name))) return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
        const user = {
            id: makeId(),
            username: name,
            password: pwd,
            visibility: 'public',
            isPublic: true,
            friendsOnly: false,
            friends: [],
            pinnedUsers: [],
            createdAt: new Date().toISOString()
        };
        users.push(user);
        writeJSON(USERS_FILE, users);
        const token = makeId();
        sessions.set(token, user.username);
        res.json({ token, username: user.username, visibility: user.visibility, isPublic: user.isPublic, friendsOnly: user.friendsOnly });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body || {};
        const users = readJSON(USERS_FILE);
        const user = users.find(u => normalizeName(u.username) === normalizeName(username) && u.password === password);
        if (!user) return res.status(401).json({ error: 'Kullanıcı adı veya şifre yanlış.' });
        if (!user.visibility) { user.visibility = user.isPublic ? 'public' : 'private'; writeJSON(USERS_FILE, users); }
        if (!user.pinnedUsers) { user.pinnedUsers = []; writeJSON(USERS_FILE, users); }
        const token = makeId();
        sessions.set(token, user.username);
        res.json({ token, username: user.username, visibility: user.visibility, isPublic: user.isPublic, friendsOnly: user.friendsOnly });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/logout', auth, (req, res) => {
    sessions.delete(req.headers['x-auth-token']);
    res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === req.username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı yok' });
    res.json({
        username: user.username,
        visibility: getUserVisibility(user),
        isPublic: user.isPublic,
        friendsOnly: user.friendsOnly,
        friends: user.friends || [],
        pinnedUsers: user.pinnedUsers || []
    });
});

// ============================================
// AYARLAR
// ============================================
app.post('/api/change-username', auth, (req, res) => {
    try {
        const { newUsername } = req.body || {};
        const newName = String(newUsername || '').trim();
        if (!newName || newName.length < 2 || newName.length > 20) return res.status(400).json({ error: 'Yeni ad 2-20 karakter olmalı.' });
        const users = readJSON(USERS_FILE);
        if (users.find(u => normalizeName(u.username) === normalizeName(newName) && u.username !== req.username)) return res.status(400).json({ error: 'Bu ad zaten alınmış.' });
        const user = users.find(u => u.username === req.username);
        if (!user) return res.status(404).json({ error: 'Kullanıcı yok' });
        const oldName = user.username;
        user.username = newName;
        writeJSON(USERS_FILE, users);

        const users2 = readJSON(USERS_FILE);
        users2.forEach(u => {
            if (u.friends && u.friends.includes(oldName)) u.friends = u.friends.map(f => f === oldName ? newName : f);
            if (u.pinnedUsers && u.pinnedUsers.includes(oldName)) u.pinnedUsers = u.pinnedUsers.map(f => f === oldName ? newName : f);
        });
        writeJSON(USERS_FILE, users2);

        for (const [token, name] of sessions.entries()) if (name === oldName) sessions.set(token, newName);

        const links = readJSON(LINKS_FILE);
        links.forEach(l => { if (l.owner === oldName) l.owner = newName; });
        writeJSON(LINKS_FILE, links);

        res.json({ username: newName });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/visibility', auth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const user = users.find(u => u.username === req.username);
        if (!user) return res.status(404).json({ error: 'Kullanıcı yok' });
        const v = req.body.visibility;
        if (!['private', 'public', 'friends'].includes(v)) return res.status(400).json({ error: 'Geçersiz görünürlük' });
        user.visibility = v;
        user.isPublic = (v === 'public');
        user.friendsOnly = (v === 'friends');
        writeJSON(USERS_FILE, users);
        res.json({ visibility: user.visibility });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// KULLANICILAR
// ============================================
app.get('/api/users', auth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const me = users.find(u => u.username === req.username);
        const requests = readJSON(REQUESTS_FILE);
        const pinned = me.pinnedUsers || [];
        const list = users
            .filter(u => u.username !== req.username)
            .map(u => ({
                username: u.username,
                visibility: getUserVisibility(u),
                isPublic: u.isPublic,
                friendsOnly: u.friendsOnly,
                friendCount: (u.friends || []).length,
                isFriend: (me.friends || []).includes(u.username),
                isPinned: pinned.includes(u.username),
                pendingRequest: requests.some(r => r.from === req.username && r.to === u.username && r.status === 'pending'),
                incomingRequest: requests.some(r => r.from === u.username && r.to === req.username && r.status === 'pending'),
                createdAt: u.createdAt
            }));
        res.json(list);
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// Arkadaşları listele (kendisi hariç)
app.get('/api/friends', auth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const me = users.find(u => u.username === req.username);
        if (!me) return res.status(404).json({ error: 'Kullanıcı yok' });
        const requests = readJSON(REQUESTS_FILE);
        const list = (me.friends || []).map(name => {
            const u = users.find(x => x.username === name);
            if (!u) return null;
            return {
                username: u.username,
                visibility: getUserVisibility(u),
                isPublic: u.isPublic,
                friendsOnly: u.friendsOnly,
                isPinned: (me.pinnedUsers || []).includes(u.username)
            };
        }).filter(Boolean);
        res.json(list);
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// Kullanıcı sabitleme
app.post('/api/users/:username/pin', auth, (req, res) => {
    try {
        const target = req.params.username;
        const users = readJSON(USERS_FILE);
        const me = users.find(u => u.username === req.username);
        if (!me) return res.status(404).json({ error: 'Kullanıcı yok' });
        if (target === req.username) return res.status(400).json({ error: 'Kendini sabitleyemezsin' });
        if (!users.find(u => u.username === target)) return res.status(404).json({ error: 'Hedef yok' });
        if (!me.pinnedUsers) me.pinnedUsers = [];
        const idx = me.pinnedUsers.indexOf(target);
        let pinned;
        if (idx === -1) { me.pinnedUsers.push(target); pinned = true; }
        else { me.pinnedUsers.splice(idx, 1); pinned = false; }
        writeJSON(USERS_FILE, users);
        res.json({ pinned, pinnedUsers: me.pinnedUsers });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.get('/api/users/:username', auth, (req, res) => {
    try {
        const users = readJSON(USERS_FILE);
        const user = users.find(u => normalizeName(u.username) === normalizeName(req.params.username));
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        const me = users.find(u => u.username === req.username);

        const isMe = user.username === req.username;
        const isFriend = areFriends(req.username, user.username);
        const visibility = getUserVisibility(user);

        let canSeeLinks = true, reason = '';
        if (!isMe) {
            if (visibility === 'private') { canSeeLinks = false; reason = 'gizli'; }
            else if (visibility === 'friends' && !isFriend) { canSeeLinks = false; reason = 'arkadas'; }
        }

        const links = readJSON(LINKS_FILE).filter(l => l.owner === user.username);
        const likes = readJSON(LIKES_FILE);
        const requests = readJSON(REQUESTS_FILE);
        const pendingOut = requests.some(r => r.from === req.username && r.to === user.username && r.status === 'pending');
        const pendingIn = requests.some(r => r.from === user.username && r.to === req.username && r.status === 'pending');

        res.json({
            username: user.username,
            visibility,
            isPublic: visibility === 'public',
            friendsOnly: visibility === 'friends',
            isFriend, isMe, canSeeLinks, reason,
            friendCount: (user.friends || []).length,
            isPinned: (me.pinnedUsers || []).includes(user.username),
            pendingOut, pendingIn,
            links: canSeeLinks ? links.map(l => {
                const lk = likes.filter(x => x.linkId === l.id);
                return { ...l, likeCount: lk.length, likedByMe: lk.some(x => x.user === req.username) };
            }) : []
        });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// LİNKLER
// ============================================
app.get('/api/links', auth, (req, res) => {
    try {
        const links = readJSON(LINKS_FILE).filter(l => l.owner === req.username);
        const likes = readJSON(LIKES_FILE);
        res.json(links.map(l => {
            const lk = likes.filter(x => x.linkId === l.id);
            return { ...l, likeCount: lk.length, likedByMe: lk.some(x => x.user === req.username) };
        }));
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/links', auth, (req, res) => {
    try {
        const links = readJSON(LINKS_FILE);
        const newLink = {
            id: makeId(), owner: req.username,
            title: String(req.body.title || '').trim(),
            url: String(req.body.url || '').trim(),
            pinned: !!req.body.pinned, favorite: !!req.body.favorite,
            tags: Array.isArray(req.body.tags) ? req.body.tags : [],
            note: String(req.body.note || '').trim(),
            clicks: 0, addedAt: new Date().toISOString()
        };
        if (!newLink.title || !newLink.url) return res.status(400).json({ error: 'Başlık ve URL gerekli' });
        links.push(newLink);
        writeJSON(LINKS_FILE, links);
        res.json({ ...newLink, likeCount: 0, likedByMe: false });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.put('/api/links/:id', auth, (req, res) => {
    try {
        const links = readJSON(LINKS_FILE);
        const link = links.find(l => l.id === req.params.id && l.owner === req.username);
        if (!link) return res.status(404).json({ error: 'Link bulunamadı' });
        Object.assign(link, {
            title: req.body.title ?? link.title,
            url: req.body.url ?? link.url,
            pinned: req.body.pinned ?? link.pinned,
            favorite: req.body.favorite ?? link.favorite,
            tags: req.body.tags ?? link.tags,
            note: req.body.note ?? link.note,
            clicks: req.body.clicks ?? link.clicks
        });
        writeJSON(LINKS_FILE, links);
        res.json(link);
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.delete('/api/links/:id', auth, (req, res) => {
    try {
        let links = readJSON(LINKS_FILE);
        const before = links.length;
        links = links.filter(l => !(l.id === req.params.id && l.owner === req.username));
        if (links.length === before) return res.status(404).json({ error: 'Link bulunamadı' });
        writeJSON(LINKS_FILE, links);
        let likes = readJSON(LIKES_FILE);
        likes = likes.filter(l => l.linkId !== req.params.id);
        writeJSON(LIKES_FILE, likes);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// BEĞENİ
// ============================================
app.post('/api/links/:id/like', auth, (req, res) => {
    try {
        const links = readJSON(LINKS_FILE);
        const link = links.find(l => l.id === req.params.id);
        if (!link) return res.status(404).json({ error: 'Link bulunamadı' });
        const users = readJSON(USERS_FILE);
        const owner = users.find(u => u.username === link.owner);
        if (!owner) return res.status(404).json({ error: 'Sahip yok' });
        if (link.owner !== req.username) {
            const vis = getUserVisibility(owner);
            if (vis === 'private') return res.status(403).json({ error: 'Profil gizli' });
            if (vis === 'friends' && !areFriends(req.username, link.owner)) return res.status(403).json({ error: 'Sadece arkadaşlar' });
        }
        let likes = readJSON(LIKES_FILE);
        const existing = likes.find(x => x.linkId === link.id && x.user === req.username);
        let liked;
        if (existing) { likes = likes.filter(x => !(x.linkId === link.id && x.user === req.username)); liked = false; }
        else { likes.push({ linkId: link.id, user: req.username, at: new Date().toISOString() }); liked = true; }
        writeJSON(LIKES_FILE, likes);
        const count = likes.filter(x => x.linkId === link.id).length;
        res.json({ liked, likeCount: count });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// ARKADAŞLIK
// ============================================
app.post('/api/friends/request', auth, (req, res) => {
    try {
        const { to } = req.body || {};
        const target = String(to || '').trim();
        if (!target) return res.status(400).json({ error: 'Hedef gerekli' });
        if (target === req.username) return res.status(400).json({ error: 'Kendine istek atamazsın' });
        const users = readJSON(USERS_FILE);
        if (!users.find(u => u.username === target)) return res.status(404).json({ error: 'Kullanıcı yok' });
        if (areFriends(req.username, target)) return res.status(400).json({ error: 'Zaten arkadaşsınız' });
        let requests = readJSON(REQUESTS_FILE);
        const existing = requests.find(r => r.status === 'pending' && ((r.from === req.username && r.to === target) || (r.from === target && r.to === req.username)));
        if (existing) return res.status(400).json({ error: 'Zaten bekleyen istek var' });
        requests.push({ id: makeId(), from: req.username, to: target, status: 'pending', createdAt: new Date().toISOString() });
        writeJSON(REQUESTS_FILE, requests);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/friends/respond', auth, (req, res) => {
    try {
        const { requestId, action } = req.body || {};
        let requests = readJSON(REQUESTS_FILE);
        const r = requests.find(x => x.id === requestId && x.to === req.username && x.status === 'pending');
        if (!r) return res.status(404).json({ error: 'İstek bulunamadı' });
        if (action === 'accept') {
            const users = readJSON(USERS_FILE);
            const from = users.find(u => u.username === r.from);
            const to = users.find(u => u.username === r.to);
            if (from && to) {
                if (!from.friends) from.friends = [];
                if (!to.friends) to.friends = [];
                if (!from.friends.includes(to.username)) from.friends.push(to.username);
                if (!to.friends.includes(from.username)) to.friends.push(from.username);
                writeJSON(USERS_FILE, users);
            }
            r.status = 'accepted';
        } else r.status = 'rejected';
        writeJSON(REQUESTS_FILE, requests);
        res.json({ ok: true, status: r.status });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/friends/remove', auth, (req, res) => {
    try {
        const { target } = req.body || {};
        const users = readJSON(USERS_FILE);
        const me = users.find(u => u.username === req.username);
        const other = users.find(u => u.username === target);
        if (me && me.friends) me.friends = me.friends.filter(f => f !== target);
        if (other && other.friends) other.friends = other.friends.filter(f => f !== req.username);
        writeJSON(USERS_FILE, users);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.get('/api/friends/requests', auth, (req, res) => {
    try {
        const requests = readJSON(REQUESTS_FILE);
        const incoming = requests.filter(r => r.to === req.username && r.status === 'pending').map(r => ({ id: r.id, from: r.from, createdAt: r.createdAt }));
        const outgoing = requests.filter(r => r.from === req.username && r.status === 'pending').map(r => ({ id: r.id, to: r.to, createdAt: r.createdAt }));
        res.json({ incoming, outgoing });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// MESAJLAR
// ============================================
app.get('/api/messages/:username', auth, (req, res) => {
    try {
        const other = req.params.username;
        const messages = readJSON(MESSAGES_FILE);
        const thread = messages
            .filter(m => (m.from === req.username && m.to === other) || (m.from === other && m.to === req.username))
            .sort((a, b) => new Date(a.at) - new Date(b.at));
        res.json(thread);
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.post('/api/messages', auth, (req, res) => {
    try {
        const { to, text } = req.body || {};
        const target = String(to || '').trim();
        const content = String(text || '').trim();
        if (!target || !content) return res.status(400).json({ error: 'Alıcı ve mesaj gerekli' });
        if (content.length > 2000) return res.status(400).json({ error: 'Mesaj çok uzun' });
        const users = readJSON(USERS_FILE);
        if (!users.find(u => u.username === target)) return res.status(404).json({ error: 'Kullanıcı yok' });
        const messages = readJSON(MESSAGES_FILE);
        const msg = { id: makeId(), from: req.username, to: target, text: content, at: new Date().toISOString() };
        messages.push(msg);
        writeJSON(MESSAGES_FILE, messages);
        res.json(msg);
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.put('/api/messages/:id', auth, (req, res) => {
    try {
        const messages = readJSON(MESSAGES_FILE);
        const msg = messages.find(m => m.id === req.params.id);
        if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı' });
        if (msg.from !== req.username) return res.status(403).json({ error: 'Sadece kendi mesajını düzenleyebilirsin' });
        const newText = String(req.body.text || '').trim();
        if (!newText) return res.status(400).json({ error: 'Mesaj boş olamaz' });
        if (newText.length > 2000) return res.status(400).json({ error: 'Mesaj çok uzun' });
        msg.text = newText;
        msg.editedAt = new Date().toISOString();
        writeJSON(MESSAGES_FILE, messages);
        res.json(msg);
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

app.delete('/api/messages/:id', auth, (req, res) => {
    try {
        let messages = readJSON(MESSAGES_FILE);
        const msg = messages.find(m => m.id === req.params.id);
        if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadı' });
        if (msg.from !== req.username) return res.status(403).json({ error: 'Sadece kendi mesajını silebilirsin' });
        messages = messages.filter(m => m.id !== req.params.id);
        writeJSON(MESSAGES_FILE, messages);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// Okunmamış mesajlar — kullanıcı bazlı
app.get('/api/messages-unread', auth, (req, res) => {
    try {
        const messages = readJSON(MESSAGES_FILE);
        const reads = readJSON(READS_FILE);
        const unread = {};
        messages.forEach(m => {
            if (m.to === req.username) {
                const r = reads.find(x => x.user === req.username && x.msgId === m.id);
                if (!r) unread[m.from] = (unread[m.from] || 0) + 1;
            }
        });
        res.json(unread);
    } catch { res.json({}); }
});

app.post('/api/messages/read', auth, (req, res) => {
    try {
        const { from } = req.body || {};
        const messages = readJSON(MESSAGES_FILE);
        let reads = readJSON(READS_FILE);
        messages.filter(m => m.from === from && m.to === req.username).forEach(m => {
            if (!reads.find(r => r.user === req.username && r.msgId === m.id)) {
                reads.push({ user: req.username, msgId: m.id });
            }
        });
        writeJSON(READS_FILE, reads);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// BİLDİRİM: hem arkadaşlık istekleri hem okunmamış mesajlar
// ============================================
app.get('/api/notifications', auth, (req, res) => {
    try {
        const requests = readJSON(REQUESTS_FILE);
        const incoming = requests.filter(r => r.to === req.username && r.status === 'pending').map(r => ({ id: r.id, from: r.from, createdAt: r.createdAt }));
        const outgoing = requests.filter(r => r.from === req.username && r.status === 'pending').map(r => ({ id: r.id, to: r.to, createdAt: r.createdAt }));

        const messages = readJSON(MESSAGES_FILE);
        const reads = readJSON(READS_FILE);
        const unreadBySender = {};
        const lastBySender = {};
        messages.forEach(m => {
            if (m.to === req.username) {
                const r = reads.find(x => x.user === req.username && x.msgId === m.id);
                if (!r) unreadBySender[m.from] = (unreadBySender[m.from] || 0) + 1;
                if (!lastBySender[m.from] || new Date(m.at) > new Date(lastBySender[m.from].at)) {
                    lastBySender[m.from] = m;
                }
            }
        });

        const messageNotifs = Object.keys(unreadBySender).map(sender => ({
            from: sender,
            count: unreadBySender[sender],
            lastText: lastBySender[sender] ? lastBySender[sender].text : '',
            lastAt: lastBySender[sender] ? lastBySender[sender].at : null
        })).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

        res.json({ incoming, outgoing, messages: messageNotifs });
    } catch (err) { res.status(500).json({ error: 'Sunucu hatası: ' + err.message }); }
});

// ============================================
// HEALTH & FALLBACK
// ============================================
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sunucu çalışıyor:`);
    console.log(`   → Yerel:  http://localhost:${PORT}`);
    console.log(`   → Ağ:     http://192.168.1.251:${PORT}`);
});